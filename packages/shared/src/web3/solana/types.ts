/**
 * @fileoverview Type definitions for Solana wallet operations in Hyperscape.
 * Provides strongly-typed interfaces for wallet management, balance queries,
 * and transaction operations on the Solana blockchain.
 * @module web3/solana/types
 */

/**
 * Represents a Solana wallet keypair with both public and secret keys.
 * The secret key is stored as a Uint8Array for security - it should never
 * be converted to a string or logged.
 *
 * @security The secretKey must be handled with care:
 * - Never log or expose the secretKey
 * - Clear the secretKey from memory when no longer needed
 * - Use SolanaWalletService.zeroize() to securely clear the wallet
 */
export interface SolanaWallet {
  /**
   * The 32-byte Ed25519 public key as a Uint8Array.
   * Can be converted to a Base58 address string for display.
   */
  publicKey: Uint8Array;

  /**
   * The 64-byte Ed25519 secret key (seed + public key).
   * @security Never log, expose, or store in plaintext.
   */
  secretKey: Uint8Array;
}

/**
 * Exportable wallet format compatible with Solana CLI tools.
 * The secretKey is represented as a JSON array of numbers,
 * which is the standard format used by `solana-keygen`.
 *
 * @example
 * // Solana CLI compatible format
 * const exported: SolanaWalletExport = {
 *   publicKey: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
 *   secretKey: [1, 2, 3, ...] // 64 bytes as number array
 * };
 */
export interface SolanaWalletExport {
  /**
   * The Base58-encoded public key (address).
   */
  publicKey: string;

  /**
   * The secret key as an array of 64 numbers (0-255).
   * This format is compatible with Solana CLI's keypair JSON files.
   */
  secretKey: number[];
}

/**
 * Configuration options for connecting to a Solana RPC endpoint.
 */
export interface SolanaConfig {
  /**
   * The RPC endpoint URL for the Solana cluster.
   * @example "https://api.mainnet-beta.solana.com"
   * @example "https://api.devnet.solana.com"
   */
  rpcUrl: string;

  /**
   * The commitment level for transaction confirmation.
   * - "processed": Query the most recent block which has reached 1 confirmation
   * - "confirmed": Query the most recent block which has reached 1 confirmation by the cluster
   * - "finalized": Query the most recent block which has been finalized by the cluster
   * @default "confirmed"
   */
  commitment?: SolanaCommitment;

  /**
   * Request timeout in milliseconds.
   * @default 30000
   */
  timeout?: number;
}

/**
 * Solana commitment levels for transaction confirmation.
 */
export type SolanaCommitment = "processed" | "confirmed" | "finalized";

/**
 * Represents a Solana account balance with both SOL and lamports values.
 * SOL is the user-friendly decimal representation, while lamports is the
 * native integer representation used on-chain.
 */
export interface SolanaBalance {
  /**
   * Balance in SOL as a decimal string (e.g., "1.5").
   * Uses string to preserve precision for large values.
   */
  sol: string;

  /**
   * Balance in lamports as a string (e.g., "1500000000").
   * 1 SOL = 1,000,000,000 lamports.
   * Uses string to handle values larger than Number.MAX_SAFE_INTEGER.
   */
  lamports: string;
}

/**
 * Request parameters for transferring SOL between accounts.
 */
export interface TransferRequest {
  /**
   * The recipient's Base58-encoded public key (address).
   */
  to: string;

  /**
   * The amount to transfer in lamports as a string.
   * Use string to handle large values precisely.
   */
  lamports: string;

  /**
   * Optional memo to attach to the transaction.
   * Requires the Memo program to be included.
   */
  memo?: string;
}

/**
 * Result of a successful SOL transfer transaction.
 */
export interface TransferResult {
  /**
   * The Base58-encoded transaction signature.
   * Can be used to look up the transaction on a block explorer.
   */
  signature: string;

  /**
   * The status of the transaction.
   */
  status: TransactionStatus;

  /**
   * The slot number where the transaction was processed.
   */
  slot?: number;

  /**
   * Confirmation count at the time of response.
   */
  confirmations?: number;
}

/**
 * Possible transaction status values.
 */
export type TransactionStatus =
  | "pending"
  | "confirmed"
  | "finalized"
  | "failed";

/**
 * Options for generating vanity addresses with custom prefixes or suffixes.
 * Vanity generation is computationally expensive - longer patterns take
 * exponentially longer to find.
 */
export interface VanityOptions {
  /**
   * The prefix that the generated address should start with.
   * Must contain only valid Base58 characters (excludes 0, O, I, l).
   * @example "So" for addresses starting with "So..."
   */
  prefix?: string;

  /**
   * The suffix that the generated address should end with.
   * Must contain only valid Base58 characters.
   * @example "AI" for addresses ending with "...AI"
   */
  suffix?: string;

  /**
   * Whether to perform case-insensitive matching.
   * @default false
   */
  ignoreCase?: boolean;

  /**
   * Maximum number of attempts before giving up.
   * If not specified, generation continues until a match is found.
   * @warning Long patterns may never be found in a reasonable time.
   */
  maxAttempts?: number;

  /**
   * Callback function for progress reporting.
   * Called approximately every 1000 attempts.
   * @param progress - Progress information including attempts and rate
   */
  onProgress?: (progress: VanityProgress) => void;
}

/**
 * Progress information during vanity address generation.
 */
export interface VanityProgress {
  /**
   * Number of attempts made so far.
   */
  attempts: number;

  /**
   * Current generation rate in attempts per second.
   */
  rate: number;

  /**
   * Estimated total attempts needed to find a match.
   */
  estimatedTotal: number;

  /**
   * Estimated time remaining in milliseconds.
   */
  estimatedTimeMs: number;
}

/**
 * Result of vanity address generation.
 */
export interface VanityResult {
  /**
   * The generated wallet matching the vanity criteria.
   */
  wallet: SolanaWallet;

  /**
   * Number of attempts it took to find the address.
   */
  attempts: number;

  /**
   * Time taken in milliseconds.
   */
  durationMs: number;
}

/**
 * RPC error response from Solana.
 */
export interface SolanaRpcError {
  /**
   * Error code.
   */
  code: number;

  /**
   * Error message.
   */
  message: string;

  /**
   * Additional error data.
   */
  data?: unknown;
}

/**
 * Airdrop request result (devnet/testnet only).
 */
export interface AirdropResult {
  /**
   * The transaction signature for the airdrop.
   */
  signature: string;

  /**
   * Amount of lamports airdropped.
   */
  lamports: string;
}

/**
 * Recent blockhash information from the cluster.
 */
export interface BlockhashInfo {
  /**
   * The Base58-encoded blockhash.
   */
  blockhash: string;

  /**
   * Last valid block height for transactions using this blockhash.
   */
  lastValidBlockHeight: number;
}

/**
 * Solana network cluster identifier.
 */
export type SolanaCluster = "mainnet-beta" | "devnet" | "testnet" | "localnet";

/**
 * Options for saving a wallet to a file.
 */
export interface WalletSaveOptions {
  /**
   * File path to save the wallet keypair.
   */
  filePath: string;

  /**
   * Whether to overwrite an existing file.
   * @default false
   */
  overwrite?: boolean;

  /**
   * Whether to set secure file permissions (0600).
   * @default true
   */
  securePermissions?: boolean;
}

/**
 * Result of wallet address validation.
 */
export interface AddressValidation {
  /**
   * Whether the address is valid.
   */
  valid: boolean;

  /**
   * Error message if validation failed.
   */
  error?: string;

  /**
   * The decoded public key bytes if valid.
   */
  publicKey?: Uint8Array;
}

// ============================================================================
// SPL Token Types
// ============================================================================

/**
 * Information about an SPL token mint.
 */
export interface SPLTokenInfo {
  /**
   * The mint address (base58).
   */
  mint: string;

  /**
   * Token symbol (e.g., "USDC", "USDT").
   */
  symbol: string;

  /**
   * Human-readable token name.
   */
  name: string;

  /**
   * Number of decimal places.
   */
  decimals: number;

  /**
   * Total supply in smallest units.
   */
  supply?: string;

  /**
   * Mint authority address (if any).
   */
  mintAuthority?: string;

  /**
   * Freeze authority address (if any).
   */
  freezeAuthority?: string;
}

/**
 * SPL token balance for an account.
 */
export interface SPLTokenBalance {
  /**
   * The token mint address.
   */
  mint: string;

  /**
   * Balance in smallest units (as string for precision).
   */
  balance: string;

  /**
   * Token decimals.
   */
  decimals: number;

  /**
   * User-friendly balance string (e.g., "1.5").
   */
  uiBalance: string;

  /**
   * The token account address holding the balance.
   */
  tokenAccount?: string;
}

/**
 * Request parameters for SPL token transfer.
 */
export interface SPLTransferRequest {
  /**
   * The token mint address.
   */
  mint: string;

  /**
   * Recipient's wallet address (not token account).
   */
  to: string;

  /**
   * Amount to transfer in smallest units.
   */
  amount: string;
}

/**
 * Request parameters for minting SPL tokens.
 * Requires mint authority.
 */
export interface SPLMintRequest {
  /**
   * The token mint address.
   */
  mint: string;

  /**
   * Destination wallet address.
   */
  destination: string;

  /**
   * Amount to mint in smallest units.
   */
  amount: string;
}

/**
 * Request parameters for burning SPL tokens.
 */
export interface SPLBurnRequest {
  /**
   * The token mint address.
   */
  mint: string;

  /**
   * Amount to burn in smallest units.
   */
  amount: string;
}

/**
 * Information about a token account.
 */
export interface TokenAccountInfo {
  /**
   * Token account address.
   */
  address: string;

  /**
   * Token mint address.
   */
  mint: string;

  /**
   * Owner wallet address.
   */
  owner: string;

  /**
   * Balance in smallest units.
   */
  balance: string;

  /**
   * Token decimals.
   */
  decimals: number;
}
