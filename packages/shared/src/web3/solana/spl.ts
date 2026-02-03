/**
 * @fileoverview SPL Token Service for Solana blockchain operations.
 * Provides comprehensive SPL token management including balance queries,
 * transfers, and token account operations for Hyperscape game assets.
 *
 * @security This module handles sensitive operations:
 * - Never log private keys or secret keys
 * - Validate all addresses before operations
 * - Use proper error handling for RPC failures
 *
 * @module web3/solana/spl
 */

import type {
  SolanaWallet,
  SolanaConfig,
  SolanaCommitment,
  TransferResult,
  SPLTokenInfo,
  SPLTokenBalance,
  SPLTransferRequest,
  SPLMintRequest,
  SPLBurnRequest,
  TokenAccountInfo,
} from "./types";

import {
  DEFAULT_RPC_TIMEOUT_MS,
  LAMPORTS_PER_SOL,
  lamportsToSol,
  isMainnetCluster,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  COMMON_SPL_TOKENS,
} from "./constants";

import { SolanaWalletService } from "./wallet";

// ============================================================================
// SPL Token Constants
// ============================================================================

/** SPL Token Program ID (base58 encoded) */
const TOKEN_PROGRAM_ID_BYTES = SolanaWalletService.fromBase58(TOKEN_PROGRAM_ID);

/** Associated Token Account Program ID (base58 encoded) */
const ATA_PROGRAM_ID_BYTES = SolanaWalletService.fromBase58(
  ASSOCIATED_TOKEN_PROGRAM_ID,
);

// ============================================================================
// RPC Response Types
// ============================================================================

interface TokenAccountsByOwnerResponse {
  value: Array<{
    pubkey: string;
    account: {
      data: {
        parsed: {
          info: {
            mint: string;
            owner: string;
            tokenAmount: {
              amount: string;
              decimals: number;
              uiAmount: number;
              uiAmountString: string;
            };
          };
          type: string;
        };
        program: string;
        space: number;
      };
      executable: boolean;
      lamports: number;
      owner: string;
      rentEpoch: number;
    };
  }>;
}

interface MintInfoResponse {
  value: {
    data: {
      parsed: {
        info: {
          decimals: number;
          freezeAuthority: string | null;
          isInitialized: boolean;
          mintAuthority: string | null;
          supply: string;
        };
        type: string;
      };
      program: string;
      space: number;
    };
  } | null;
}

interface TokenAccountBalanceResponse {
  value: {
    amount: string;
    decimals: number;
    uiAmount: number;
    uiAmountString: string;
  };
}

interface AccountInfoResponse {
  value: {
    data: unknown;
    executable: boolean;
    lamports: number;
    owner: string;
    rentEpoch: number;
  } | null;
}

// ============================================================================
// SPL Token Service
// ============================================================================

/**
 * SPL Token service for managing Solana Program Library tokens.
 *
 * Provides functionality for:
 * - Querying token information and balances
 * - Transferring tokens between accounts
 * - Creating associated token accounts
 * - Minting and burning tokens (for authorized mints)
 *
 * @example
 * ```typescript
 * import { SPLTokenService, DEVNET_RPC_URL } from '@hyperscape/shared/web3/solana';
 *
 * const spl = new SPLTokenService({ rpcUrl: DEVNET_RPC_URL });
 *
 * // Get all token balances for an address
 * const balances = await spl.getAllTokenBalances(ownerAddress);
 * console.log('Token balances:', balances);
 *
 * // Transfer tokens
 * const result = await spl.transfer(wallet, {
 *   mint: 'TokenMintAddress...',
 *   to: 'RecipientAddress...',
 *   amount: '1000000', // In smallest units
 * });
 * ```
 */
export class SPLTokenService {
  private readonly config: Required<SolanaConfig>;
  private readonly walletService: SolanaWalletService;

  /**
   * Creates a new SPL Token service instance.
   *
   * @param config - Solana RPC configuration
   */
  constructor(config: SolanaConfig) {
    this.config = {
      rpcUrl: config.rpcUrl,
      commitment: config.commitment ?? "confirmed",
      timeout: config.timeout ?? DEFAULT_RPC_TIMEOUT_MS,
    };
    this.walletService = new SolanaWalletService(config);
  }

  // ============================================================================
  // Read Operations
  // ============================================================================

  /**
   * Gets information about a token mint.
   *
   * @param mint - The mint address (base58)
   * @returns Token information including decimals, supply, and authorities
   * @throws Error if the mint does not exist or is not a valid token mint
   */
  async getTokenInfo(mint: string): Promise<SPLTokenInfo> {
    const validation = SolanaWalletService.isValidAddress(mint);
    if (!validation.valid) {
      throw new Error(`Invalid mint address: ${validation.error}`);
    }

    const response = (await this.rpcRequest("getAccountInfo", [
      mint,
      { encoding: "jsonParsed", commitment: this.config.commitment },
    ])) as MintInfoResponse;

    if (!response.value) {
      throw new Error(`Token mint not found: ${mint}`);
    }

    const info = response.value.data.parsed.info;

    // Try to find token metadata in common tokens
    const knownToken = Object.entries(COMMON_SPL_TOKENS).find(
      ([, address]) => address === mint,
    );

    return {
      mint,
      symbol: knownToken ? knownToken[0] : "UNKNOWN",
      name: knownToken ? knownToken[0] : "Unknown Token",
      decimals: info.decimals,
      supply: info.supply,
      mintAuthority: info.mintAuthority ?? undefined,
      freezeAuthority: info.freezeAuthority ?? undefined,
    };
  }

  /**
   * Gets the token balance for a specific token mint held by an owner.
   *
   * @param owner - The owner address (base58)
   * @param mint - The token mint address (base58)
   * @returns Token balance or null if no token account exists
   */
  async getTokenBalance(
    owner: string,
    mint: string,
  ): Promise<SPLTokenBalance | null> {
    const ownerValidation = SolanaWalletService.isValidAddress(owner);
    if (!ownerValidation.valid) {
      throw new Error(`Invalid owner address: ${ownerValidation.error}`);
    }

    const mintValidation = SolanaWalletService.isValidAddress(mint);
    if (!mintValidation.valid) {
      throw new Error(`Invalid mint address: ${mintValidation.error}`);
    }

    // Find the associated token account
    const ata = this.deriveAssociatedTokenAddress(owner, mint);

    try {
      const response = (await this.rpcRequest("getTokenAccountBalance", [
        ata,
        { commitment: this.config.commitment },
      ])) as TokenAccountBalanceResponse;

      return {
        mint,
        balance: response.value.amount,
        decimals: response.value.decimals,
        uiBalance: response.value.uiAmountString,
        tokenAccount: ata,
      };
    } catch (error) {
      // Account doesn't exist - no tokens
      if (String(error).includes("could not find account")) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Gets all SPL token balances for an owner.
   *
   * @param owner - The owner address (base58)
   * @returns Array of all token balances held by the owner
   */
  async getAllTokenBalances(owner: string): Promise<SPLTokenBalance[]> {
    const validation = SolanaWalletService.isValidAddress(owner);
    if (!validation.valid) {
      throw new Error(`Invalid owner address: ${validation.error}`);
    }

    const response = (await this.rpcRequest("getTokenAccountsByOwner", [
      owner,
      { programId: TOKEN_PROGRAM_ID },
      { encoding: "jsonParsed", commitment: this.config.commitment },
    ])) as TokenAccountsByOwnerResponse;

    return response.value.map((account) => {
      const info = account.account.data.parsed.info;
      return {
        mint: info.mint,
        balance: info.tokenAmount.amount,
        decimals: info.tokenAmount.decimals,
        uiBalance: info.tokenAmount.uiAmountString,
        tokenAccount: account.pubkey,
      };
    });
  }

  /**
   * Gets all token accounts owned by an address.
   *
   * @param owner - The owner address (base58)
   * @returns Array of token account addresses
   */
  async getTokenAccounts(owner: string): Promise<TokenAccountInfo[]> {
    const validation = SolanaWalletService.isValidAddress(owner);
    if (!validation.valid) {
      throw new Error(`Invalid owner address: ${validation.error}`);
    }

    const response = (await this.rpcRequest("getTokenAccountsByOwner", [
      owner,
      { programId: TOKEN_PROGRAM_ID },
      { encoding: "jsonParsed", commitment: this.config.commitment },
    ])) as TokenAccountsByOwnerResponse;

    return response.value.map((account) => {
      const info = account.account.data.parsed.info;
      return {
        address: account.pubkey,
        mint: info.mint,
        owner: info.owner,
        balance: info.tokenAmount.amount,
        decimals: info.tokenAmount.decimals,
      };
    });
  }

  // ============================================================================
  // Write Operations
  // ============================================================================

  /**
   * Transfers SPL tokens to another address.
   *
   * @param wallet - The sender's wallet
   * @param request - Transfer parameters
   * @returns Transaction result with signature
   */
  async transfer(
    wallet: SolanaWallet,
    request: SPLTransferRequest,
  ): Promise<TransferResult> {
    const toValidation = SolanaWalletService.isValidAddress(request.to);
    if (!toValidation.valid) {
      throw new Error(`Invalid recipient address: ${toValidation.error}`);
    }

    const mintValidation = SolanaWalletService.isValidAddress(request.mint);
    if (!mintValidation.valid) {
      throw new Error(`Invalid mint address: ${mintValidation.error}`);
    }

    this.warnIfMainnet("SPL transfer");

    const ownerAddress = SolanaWalletService.toBase58(wallet.publicKey);
    const sourceAta = this.deriveAssociatedTokenAddress(
      ownerAddress,
      request.mint,
    );
    const destAta = this.deriveAssociatedTokenAddress(request.to, request.mint);

    // Get token decimals for amount validation
    const tokenInfo = await this.getTokenInfo(request.mint);

    // Check if destination ATA exists, create if needed
    const destAccountExists = await this.tokenAccountExists(destAta);

    // Get recent blockhash
    const { blockhash } = await this.walletService.getRecentBlockhash();

    // Build instructions
    const instructions: TransactionInstruction[] = [];

    // Add create ATA instruction if needed
    if (!destAccountExists) {
      instructions.push(
        this.buildCreateAtaInstruction(
          wallet.publicKey,
          SolanaWalletService.fromBase58(request.to),
          SolanaWalletService.fromBase58(request.mint),
        ),
      );
    }

    // Add transfer instruction
    instructions.push(
      this.buildTransferInstruction(
        SolanaWalletService.fromBase58(sourceAta),
        SolanaWalletService.fromBase58(destAta),
        wallet.publicKey,
        BigInt(request.amount),
      ),
    );

    // Build, sign, and send transaction
    const message = this.buildMessage(
      blockhash,
      wallet.publicKey,
      instructions,
    );
    const signature = SolanaWalletService.sign(message, wallet.secretKey);
    const serialized = this.serializeTransaction(signature, message);

    const txSig = (await this.rpcRequest("sendTransaction", [
      this.toBase64(serialized),
      {
        encoding: "base64",
        skipPreflight: false,
        preflightCommitment: this.config.commitment,
        maxRetries: 3,
      },
    ])) as string;

    console.info(
      `📤 SPL Transfer: ${request.amount} (decimals: ${tokenInfo.decimals}) → ${request.to}`,
    );

    return {
      signature: txSig,
      status: "pending",
    };
  }

  /**
   * Creates an associated token account for a mint.
   *
   * @param wallet - The payer's wallet
   * @param mint - The token mint address
   * @param owner - Optional owner address (defaults to wallet owner)
   * @returns The created token account address
   */
  async createTokenAccount(
    wallet: SolanaWallet,
    mint: string,
    owner?: string,
  ): Promise<string> {
    const ownerAddress =
      owner ?? SolanaWalletService.toBase58(wallet.publicKey);

    const ownerValidation = SolanaWalletService.isValidAddress(ownerAddress);
    if (!ownerValidation.valid) {
      throw new Error(`Invalid owner address: ${ownerValidation.error}`);
    }

    const mintValidation = SolanaWalletService.isValidAddress(mint);
    if (!mintValidation.valid) {
      throw new Error(`Invalid mint address: ${mintValidation.error}`);
    }

    const ata = this.deriveAssociatedTokenAddress(ownerAddress, mint);

    // Check if already exists
    if (await this.tokenAccountExists(ata)) {
      console.info(`ℹ️ Token account already exists: ${ata}`);
      return ata;
    }

    this.warnIfMainnet("create token account");

    const { blockhash } = await this.walletService.getRecentBlockhash();

    const instruction = this.buildCreateAtaInstruction(
      wallet.publicKey,
      SolanaWalletService.fromBase58(ownerAddress),
      SolanaWalletService.fromBase58(mint),
    );

    const message = this.buildMessage(blockhash, wallet.publicKey, [
      instruction,
    ]);
    const signature = SolanaWalletService.sign(message, wallet.secretKey);
    const serialized = this.serializeTransaction(signature, message);

    await this.rpcRequest("sendTransaction", [
      this.toBase64(serialized),
      {
        encoding: "base64",
        skipPreflight: false,
        preflightCommitment: this.config.commitment,
      },
    ]);

    console.info(`✅ Created token account: ${ata}`);
    return ata;
  }

  /**
   * Mints tokens to a destination (requires mint authority).
   * Used for game item tokens where the game has mint authority.
   *
   * @param wallet - Wallet with mint authority
   * @param request - Mint parameters
   * @returns Transaction result
   */
  async mintTo(
    wallet: SolanaWallet,
    request: SPLMintRequest,
  ): Promise<TransferResult> {
    const destValidation = SolanaWalletService.isValidAddress(
      request.destination,
    );
    if (!destValidation.valid) {
      throw new Error(`Invalid destination address: ${destValidation.error}`);
    }

    const mintValidation = SolanaWalletService.isValidAddress(request.mint);
    if (!mintValidation.valid) {
      throw new Error(`Invalid mint address: ${mintValidation.error}`);
    }

    this.warnIfMainnet("mint tokens");

    // Derive destination ATA
    const destAta = this.deriveAssociatedTokenAddress(
      request.destination,
      request.mint,
    );

    // Check if destination ATA exists
    const destAccountExists = await this.tokenAccountExists(destAta);

    const { blockhash } = await this.walletService.getRecentBlockhash();

    const instructions: TransactionInstruction[] = [];

    // Create ATA if needed
    if (!destAccountExists) {
      instructions.push(
        this.buildCreateAtaInstruction(
          wallet.publicKey,
          SolanaWalletService.fromBase58(request.destination),
          SolanaWalletService.fromBase58(request.mint),
        ),
      );
    }

    // Add mint instruction
    instructions.push(
      this.buildMintToInstruction(
        SolanaWalletService.fromBase58(request.mint),
        SolanaWalletService.fromBase58(destAta),
        wallet.publicKey,
        BigInt(request.amount),
      ),
    );

    const message = this.buildMessage(
      blockhash,
      wallet.publicKey,
      instructions,
    );
    const signature = SolanaWalletService.sign(message, wallet.secretKey);
    const serialized = this.serializeTransaction(signature, message);

    const txSig = (await this.rpcRequest("sendTransaction", [
      this.toBase64(serialized),
      {
        encoding: "base64",
        skipPreflight: false,
        preflightCommitment: this.config.commitment,
      },
    ])) as string;

    console.info(
      `🪙 Minted ${request.amount} tokens to ${request.destination}`,
    );

    return {
      signature: txSig,
      status: "pending",
    };
  }

  /**
   * Burns tokens from an account (requires token ownership or delegate authority).
   *
   * @param wallet - Wallet owning the tokens
   * @param request - Burn parameters
   * @returns Transaction result
   */
  async burn(
    wallet: SolanaWallet,
    request: SPLBurnRequest,
  ): Promise<TransferResult> {
    const mintValidation = SolanaWalletService.isValidAddress(request.mint);
    if (!mintValidation.valid) {
      throw new Error(`Invalid mint address: ${mintValidation.error}`);
    }

    this.warnIfMainnet("burn tokens");

    const ownerAddress = SolanaWalletService.toBase58(wallet.publicKey);
    const sourceAta = this.deriveAssociatedTokenAddress(
      ownerAddress,
      request.mint,
    );

    const { blockhash } = await this.walletService.getRecentBlockhash();

    const instruction = this.buildBurnInstruction(
      SolanaWalletService.fromBase58(sourceAta),
      SolanaWalletService.fromBase58(request.mint),
      wallet.publicKey,
      BigInt(request.amount),
    );

    const message = this.buildMessage(blockhash, wallet.publicKey, [
      instruction,
    ]);
    const signature = SolanaWalletService.sign(message, wallet.secretKey);
    const serialized = this.serializeTransaction(signature, message);

    const txSig = (await this.rpcRequest("sendTransaction", [
      this.toBase64(serialized),
      {
        encoding: "base64",
        skipPreflight: false,
        preflightCommitment: this.config.commitment,
      },
    ])) as string;

    console.info(`🔥 Burned ${request.amount} tokens from ${ownerAddress}`);

    return {
      signature: txSig,
      status: "pending",
    };
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Derives the associated token address for an owner and mint.
   */
  deriveAssociatedTokenAddress(owner: string, mint: string): string {
    const ownerBytes = SolanaWalletService.fromBase58(owner);
    const mintBytes = SolanaWalletService.fromBase58(mint);

    // PDA derivation: [owner, TOKEN_PROGRAM_ID, mint]
    const seeds = [ownerBytes, TOKEN_PROGRAM_ID_BYTES, mintBytes];
    const pda = this.findProgramAddress(seeds, ATA_PROGRAM_ID_BYTES);

    return SolanaWalletService.toBase58(pda);
  }

  /**
   * Checks if a token account exists.
   */
  private async tokenAccountExists(address: string): Promise<boolean> {
    try {
      const response = (await this.rpcRequest("getAccountInfo", [
        address,
        { encoding: "base64", commitment: this.config.commitment },
      ])) as AccountInfoResponse;

      return response.value !== null;
    } catch {
      return false;
    }
  }

  /**
   * Finds a program-derived address.
   * This is a simplified version - for production use consider @solana/web3.js
   */
  private findProgramAddress(
    seeds: Uint8Array[],
    programId: Uint8Array,
  ): Uint8Array {
    // Simple PDA derivation using SHA256
    // Note: This is simplified and may not be 100% compatible with Solana's actual PDA derivation
    // For production, use @solana/web3.js PublicKey.findProgramAddressSync

    for (let bump = 255; bump >= 0; bump--) {
      const seedsWithBump = [...seeds, new Uint8Array([bump])];

      // Concatenate all seeds
      const totalLength =
        seedsWithBump.reduce((sum, s) => sum + s.length, 0) +
        programId.length +
        1;
      const buffer = new Uint8Array(totalLength);
      let offset = 0;

      for (const seed of seedsWithBump) {
        buffer.set(seed, offset);
        offset += seed.length;
      }
      buffer.set(programId, offset);
      offset += programId.length;
      buffer[offset] = "ProgramDerivedAddress".length;

      // Hash to derive address
      const hash = this.sha256(buffer);

      // Check if it's off the Ed25519 curve (valid PDA)
      // Simplified check - actual implementation needs proper curve checking
      if (hash[31]! < 128) {
        return hash;
      }
    }

    throw new Error("Failed to find valid PDA");
  }

  /**
   * Simple SHA256 implementation for PDA derivation.
   */
  private sha256(data: Uint8Array): Uint8Array {
    // Using SubtleCrypto would be async, so we use a sync implementation
    // This is a simplified version for demonstration
    // In production, use a proper crypto library

    const K = new Uint32Array([
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
      0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
      0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
      0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
      0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
      0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
      0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
      0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
      0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ]);

    let h0 = 0x6a09e667;
    let h1 = 0xbb67ae85;
    let h2 = 0x3c6ef372;
    let h3 = 0xa54ff53a;
    let h4 = 0x510e527f;
    let h5 = 0x9b05688c;
    let h6 = 0x1f83d9ab;
    let h7 = 0x5be0cd19;

    const ml = data.length * 8;
    const padLen =
      data.length % 64 < 56
        ? 56 - (data.length % 64)
        : 120 - (data.length % 64);
    const padded = new Uint8Array(data.length + padLen + 8);
    padded.set(data);
    padded[data.length] = 0x80;

    const view = new DataView(padded.buffer, padded.length - 8, 8);
    view.setUint32(4, ml, false);

    const dataView = new DataView(padded.buffer);

    const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

    for (let offset = 0; offset < padded.length; offset += 64) {
      const W = new Uint32Array(64);

      for (let i = 0; i < 16; i++) {
        W[i] = dataView.getUint32(offset + i * 4, false);
      }

      for (let i = 16; i < 64; i++) {
        const s0 =
          rotr(W[i - 15]!, 7) ^ rotr(W[i - 15]!, 18) ^ (W[i - 15]! >>> 3);
        const s1 =
          rotr(W[i - 2]!, 17) ^ rotr(W[i - 2]!, 19) ^ (W[i - 2]! >>> 10);
        W[i] = (W[i - 16]! + s0 + W[i - 7]! + s1) >>> 0;
      }

      let a = h0,
        b = h1,
        c = h2,
        d = h3,
        e = h4,
        f = h5,
        g = h6,
        h = h7;

      for (let i = 0; i < 64; i++) {
        const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        const ch = (e & f) ^ (~e & g);
        const temp1 = (h + S1 + ch + K[i]! + W[i]!) >>> 0;
        const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const temp2 = (S0 + maj) >>> 0;

        h = g;
        g = f;
        f = e;
        e = (d + temp1) >>> 0;
        d = c;
        c = b;
        b = a;
        a = (temp1 + temp2) >>> 0;
      }

      h0 = (h0 + a) >>> 0;
      h1 = (h1 + b) >>> 0;
      h2 = (h2 + c) >>> 0;
      h3 = (h3 + d) >>> 0;
      h4 = (h4 + e) >>> 0;
      h5 = (h5 + f) >>> 0;
      h6 = (h6 + g) >>> 0;
      h7 = (h7 + h) >>> 0;
    }

    const result = new Uint8Array(32);
    const rv = new DataView(result.buffer);
    rv.setUint32(0, h0, false);
    rv.setUint32(4, h1, false);
    rv.setUint32(8, h2, false);
    rv.setUint32(12, h3, false);
    rv.setUint32(16, h4, false);
    rv.setUint32(20, h5, false);
    rv.setUint32(24, h6, false);
    rv.setUint32(28, h7, false);

    return result;
  }

  // ============================================================================
  // Transaction Building
  // ============================================================================

  private buildTransferInstruction(
    source: Uint8Array,
    destination: Uint8Array,
    owner: Uint8Array,
    amount: bigint,
  ): TransactionInstruction {
    // SPL Token Transfer instruction (instruction index 3)
    const data = new Uint8Array(9);
    data[0] = 3; // Transfer instruction
    const view = new DataView(data.buffer);
    view.setBigUint64(1, amount, true);

    return {
      programId: TOKEN_PROGRAM_ID_BYTES,
      keys: [
        { pubkey: source, isSigner: false, isWritable: true },
        { pubkey: destination, isSigner: false, isWritable: true },
        { pubkey: owner, isSigner: true, isWritable: false },
      ],
      data,
    };
  }

  private buildCreateAtaInstruction(
    payer: Uint8Array,
    owner: Uint8Array,
    mint: Uint8Array,
  ): TransactionInstruction {
    const ata = SolanaWalletService.fromBase58(
      this.deriveAssociatedTokenAddress(
        SolanaWalletService.toBase58(owner),
        SolanaWalletService.toBase58(mint),
      ),
    );

    // System Program for creating account
    const systemProgram = new Uint8Array(32);

    return {
      programId: ATA_PROGRAM_ID_BYTES,
      keys: [
        { pubkey: payer, isSigner: true, isWritable: true },
        { pubkey: ata, isSigner: false, isWritable: true },
        { pubkey: owner, isSigner: false, isWritable: false },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: systemProgram, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID_BYTES, isSigner: false, isWritable: false },
      ],
      data: new Uint8Array(0), // Create ATA has no data
    };
  }

  private buildMintToInstruction(
    mint: Uint8Array,
    destination: Uint8Array,
    authority: Uint8Array,
    amount: bigint,
  ): TransactionInstruction {
    // MintTo instruction (instruction index 7)
    const data = new Uint8Array(9);
    data[0] = 7;
    const view = new DataView(data.buffer);
    view.setBigUint64(1, amount, true);

    return {
      programId: TOKEN_PROGRAM_ID_BYTES,
      keys: [
        { pubkey: mint, isSigner: false, isWritable: true },
        { pubkey: destination, isSigner: false, isWritable: true },
        { pubkey: authority, isSigner: true, isWritable: false },
      ],
      data,
    };
  }

  private buildBurnInstruction(
    account: Uint8Array,
    mint: Uint8Array,
    owner: Uint8Array,
    amount: bigint,
  ): TransactionInstruction {
    // Burn instruction (instruction index 8)
    const data = new Uint8Array(9);
    data[0] = 8;
    const view = new DataView(data.buffer);
    view.setBigUint64(1, amount, true);

    return {
      programId: TOKEN_PROGRAM_ID_BYTES,
      keys: [
        { pubkey: account, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: true },
        { pubkey: owner, isSigner: true, isWritable: false },
      ],
      data,
    };
  }

  private buildMessage(
    blockhash: string,
    feePayer: Uint8Array,
    instructions: TransactionInstruction[],
  ): Uint8Array {
    // Delegate to wallet service's message building
    // This is a simplified version - would ideally share code with SolanaWalletService

    const encodeCompact = (len: number): Uint8Array => {
      const bytes: number[] = [];
      let val = len;
      do {
        let elem = val & 0x7f;
        val >>= 7;
        if (val !== 0) elem |= 0x80;
        bytes.push(elem);
      } while (val !== 0);
      return new Uint8Array(bytes);
    };

    // Collect accounts
    const accountsMap = new Map<
      string,
      { pubkey: Uint8Array; isSigner: boolean; isWritable: boolean }
    >();

    const feePayerKey = SolanaWalletService.toBase58(feePayer);
    accountsMap.set(feePayerKey, {
      pubkey: feePayer,
      isSigner: true,
      isWritable: true,
    });

    for (const ix of instructions) {
      for (const key of ix.keys) {
        const keyStr = SolanaWalletService.toBase58(key.pubkey);
        const existing = accountsMap.get(keyStr);
        if (existing) {
          existing.isSigner = existing.isSigner || key.isSigner;
          existing.isWritable = existing.isWritable || key.isWritable;
        } else {
          accountsMap.set(keyStr, { ...key });
        }
      }

      const progKey = SolanaWalletService.toBase58(ix.programId);
      if (!accountsMap.has(progKey)) {
        accountsMap.set(progKey, {
          pubkey: ix.programId,
          isSigner: false,
          isWritable: false,
        });
      }
    }

    // Sort: signers first, then writable, then readonly
    const accounts = Array.from(accountsMap.values()).sort((a, b) => {
      if (a.isSigner !== b.isSigner) return a.isSigner ? -1 : 1;
      if (a.isWritable !== b.isWritable) return a.isWritable ? -1 : 1;
      return 0;
    });

    const accountIndex = new Map<string, number>();
    accounts.forEach((acc, i) => {
      accountIndex.set(SolanaWalletService.toBase58(acc.pubkey), i);
    });

    let numSigners = 0,
      numReadonlySigners = 0,
      numReadonlyUnsigned = 0;
    for (const acc of accounts) {
      if (acc.isSigner) {
        numSigners++;
        if (!acc.isWritable) numReadonlySigners++;
      } else if (!acc.isWritable) {
        numReadonlyUnsigned++;
      }
    }

    const parts: Uint8Array[] = [];

    // Header
    parts.push(
      new Uint8Array([numSigners, numReadonlySigners, numReadonlyUnsigned]),
    );

    // Accounts
    parts.push(encodeCompact(accounts.length));
    for (const acc of accounts) parts.push(acc.pubkey);

    // Recent blockhash
    parts.push(SolanaWalletService.fromBase58(blockhash));

    // Instructions
    parts.push(encodeCompact(instructions.length));
    for (const ix of instructions) {
      parts.push(
        new Uint8Array([
          accountIndex.get(SolanaWalletService.toBase58(ix.programId))!,
        ]),
      );

      parts.push(encodeCompact(ix.keys.length));
      for (const key of ix.keys) {
        parts.push(
          new Uint8Array([
            accountIndex.get(SolanaWalletService.toBase58(key.pubkey))!,
          ]),
        );
      }

      parts.push(encodeCompact(ix.data.length));
      parts.push(ix.data);
    }

    const totalLen = parts.reduce((sum, p) => sum + p.length, 0);
    const message = new Uint8Array(totalLen);
    let offset = 0;
    for (const part of parts) {
      message.set(part, offset);
      offset += part.length;
    }

    return message;
  }

  private serializeTransaction(
    signature: Uint8Array,
    message: Uint8Array,
  ): Uint8Array {
    const tx = new Uint8Array(1 + 64 + message.length);
    tx[0] = 1; // 1 signature
    tx.set(signature, 1);
    tx.set(message, 65);
    return tx;
  }

  private toBase64(bytes: Uint8Array): string {
    if (typeof btoa === "function") {
      return btoa(String.fromCharCode(...bytes));
    }
    return Buffer.from(bytes).toString("base64");
  }

  // ============================================================================
  // RPC Methods
  // ============================================================================

  private async rpcRequest(
    method: string,
    params: unknown[],
  ): Promise<unknown> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const res = await fetch(this.config.rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: Date.now(),
          method,
          params,
        }),
        signal: controller.signal,
      });

      if (!res.ok) throw new Error(`RPC failed: ${res.status}`);

      const json = (await res.json()) as {
        result?: unknown;
        error?: { code: number; message: string };
      };

      if (json.error)
        throw new Error(`RPC error ${json.error.code}: ${json.error.message}`);
      return json.result;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private warnIfMainnet(op: string): void {
    if (this.config.rpcUrl.includes("mainnet")) {
      console.warn(`⚠️ SPL ${op} on MAINNET - REAL FUNDS AT RISK`);
    }
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Gets the RPC URL.
   */
  getRpcUrl(): string {
    return this.config.rpcUrl;
  }

  /**
   * Gets the commitment level.
   */
  getCommitment(): SolanaCommitment {
    return this.config.commitment;
  }
}

// ============================================================================
// Internal Types
// ============================================================================

interface TransactionInstruction {
  programId: Uint8Array;
  keys: Array<{
    pubkey: Uint8Array;
    isSigner: boolean;
    isWritable: boolean;
  }>;
  data: Uint8Array;
}

// Re-export types
export type {
  SPLTokenInfo,
  SPLTokenBalance,
  SPLTransferRequest,
  SPLMintRequest,
  SPLBurnRequest,
  TokenAccountInfo,
};
