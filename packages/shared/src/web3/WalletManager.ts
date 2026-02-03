/**
 * @fileoverview Unified Multi-Chain Wallet Manager
 * @module @hyperscape/shared/web3/WalletManager
 *
 * Provides a unified interface for managing wallets across multiple blockchain
 * networks (EVM chains via x402, BNB Chain, and Solana) in Hyperscape.
 *
 * @example
 * ```typescript
 * import { WalletManager } from '@hyperscape/shared/web3';
 *
 * const manager = new WalletManager({
 *   autoConnect: true,
 *   preferredNetworks: ['arbitrum', 'solana-mainnet'],
 * });
 *
 * // Add a wallet
 * const wallet = await manager.addWallet('evm', 'arbitrum', privateKey);
 *
 * // Get balance
 * const balance = await manager.getBalance(wallet.id);
 *
 * // Send transaction
 * const tx = await manager.send({
 *   walletId: wallet.id,
 *   to: '0x...',
 *   amount: '1.5',
 *   token: 'USDs',
 * });
 * ```
 */

import { X402Client, X402Network, type X402Balance } from "./x402";
import { BNBClient, type BNBBalance } from "./bnb";
import {
  SolanaWalletService,
  type SolanaWallet,
  type SolanaBalance,
} from "./solana";
import {
  type ChainType,
  type NetworkId,
  type UnifiedWallet,
  type UnifiedBalance,
  type UnifiedTransaction,
  type TransactionType,
  type TransactionStatus,
  type WalletManagerConfig,
  type SendTransactionParams,
  type FeeEstimate,
  type WalletEvent,
  type WalletEventType,
  type WalletEventListener,
  type TokenBalance,
  NETWORK_METADATA,
  NETWORK_CHAIN_TYPE,
  DEFAULT_WALLET_MANAGER_CONFIG,
  WalletError,
  WalletErrorCode,
  isEvmNetwork,
  isSolanaNetwork,
  getExplorerTxUrl,
  generateWalletId,
} from "./types";

// ============================================================================
// Internal Types
// ============================================================================

/**
 * Internal wallet data including sensitive information
 */
interface InternalWallet extends UnifiedWallet {
  /** Private key (encrypted in storage) */
  privateKey?: string;
  /** Solana keypair (if Solana wallet) */
  solanaWallet?: SolanaWallet;
}

/**
 * Client instances for different networks
 */
type NetworkClient = X402Client | BNBClient | SolanaWalletService;

/**
 * Cached balance data
 */
interface CachedBalance {
  balance: UnifiedBalance;
  expiresAt: number;
}

// ============================================================================
// Network Mapping
// ============================================================================

/**
 * Map NetworkId to X402Network
 */
function networkIdToX402Network(networkId: NetworkId): X402Network | null {
  const mapping: Partial<Record<NetworkId, X402Network>> = {
    arbitrum: X402Network.Arbitrum,
    "arbitrum-sepolia": X402Network.ArbitrumSepolia,
    base: X402Network.Base,
    ethereum: X402Network.Ethereum,
    polygon: X402Network.Polygon,
    optimism: X402Network.Optimism,
    bnb: X402Network.BSC,
  };
  return mapping[networkId] ?? null;
}

/**
 * Map NetworkId to BNB chain ID
 */
function networkIdToBnbChainId(networkId: NetworkId): number | null {
  const mapping: Partial<Record<NetworkId, number>> = {
    bnb: 56,
    "bnb-testnet": 97,
  };
  return mapping[networkId] ?? null;
}

/**
 * Map NetworkId to Solana cluster
 */
function networkIdToSolanaCluster(
  networkId: NetworkId,
): "mainnet-beta" | "devnet" | "testnet" | null {
  const mapping: Partial<
    Record<NetworkId, "mainnet-beta" | "devnet" | "testnet">
  > = {
    "solana-mainnet": "mainnet-beta",
    "solana-devnet": "devnet",
    "solana-testnet": "testnet",
  };
  return mapping[networkId] ?? null;
}

// ============================================================================
// Wallet Manager
// ============================================================================

/**
 * Unified multi-chain wallet manager
 *
 * Manages wallets across EVM chains (via x402 protocol), BNB Chain, and Solana.
 * Provides a consistent interface for balance queries, transactions, and events.
 */
export class WalletManager {
  /** Configuration */
  private readonly config: Required<WalletManagerConfig>;

  /** Wallet storage */
  private readonly wallets: Map<string, InternalWallet> = new Map();

  /** Network client instances */
  private readonly clients: Map<string, NetworkClient> = new Map();

  /** Balance cache */
  private readonly balanceCache: Map<string, CachedBalance> = new Map();

  /** Event listeners */
  private readonly listeners: Set<WalletEventListener> = new Set();

  /** Balance refresh interval ID */
  private balanceRefreshIntervalId: ReturnType<typeof setInterval> | null =
    null;

  /**
   * Create a new WalletManager instance
   * @param config - Configuration options
   */
  constructor(config: WalletManagerConfig = {}) {
    this.config = { ...DEFAULT_WALLET_MANAGER_CONFIG, ...config };

    // Load persisted wallets
    if (typeof window !== "undefined" && this.config.autoConnect) {
      this.loadFromStorage();
    }

    // Start balance refresh
    if (this.config.balanceRefreshInterval > 0) {
      this.startBalanceRefresh();
    }
  }

  // ==========================================================================
  // Wallet Management
  // ==========================================================================

  /**
   * Add a new wallet
   * @param type - Chain type ('evm' or 'solana')
   * @param network - Network identifier
   * @param privateKey - Private key (optional for read-only)
   * @param label - Optional wallet label
   * @returns The created wallet
   */
  async addWallet(
    type: ChainType,
    network: NetworkId,
    privateKey?: string,
    label?: string,
  ): Promise<UnifiedWallet> {
    // Validate network matches type
    if (NETWORK_CHAIN_TYPE[network] !== type) {
      throw new WalletError(
        `Network ${network} is not a ${type} network`,
        WalletErrorCode.NOT_SUPPORTED,
      );
    }

    const id = generateWalletId();
    let address: string;
    let solanaWallet: SolanaWallet | undefined;

    if (type === "evm") {
      // Create EVM client to derive address
      const client = this.getOrCreateEvmClient(network, privateKey);
      address = client.getAddress();
    } else {
      // Solana
      if (privateKey) {
        // Import from private key
        const secretKey = this.decodePrivateKey(privateKey);
        solanaWallet = SolanaWalletService.fromSecretKey(secretKey);
        address = SolanaWalletService.getPublicKeyBase58(solanaWallet);
      } else {
        // Generate new wallet
        solanaWallet = SolanaWalletService.generate();
        address = SolanaWalletService.getPublicKeyBase58(solanaWallet);
      }
    }

    const wallet: InternalWallet = {
      id,
      type,
      network,
      address,
      label,
      isConnected: true,
      createdAt: Date.now(),
      privateKey,
      solanaWallet,
    };

    this.wallets.set(id, wallet);
    this.emitEvent("wallet_added", { wallet: this.toPublicWallet(wallet) });
    this.saveToStorage();

    return this.toPublicWallet(wallet);
  }

  /**
   * Generate a new wallet
   * @param network - Network identifier
   * @param label - Optional wallet label
   * @returns The created wallet with private key
   */
  async generateWallet(
    network: NetworkId,
    label?: string,
  ): Promise<{ wallet: UnifiedWallet; privateKey: string }> {
    const type = NETWORK_CHAIN_TYPE[network];

    if (type === "solana") {
      const solanaWallet = SolanaWalletService.generate();
      const privateKey = this.encodePrivateKey(solanaWallet.secretKey);
      const wallet = await this.addWallet(type, network, privateKey, label);
      return { wallet, privateKey };
    } else {
      // EVM - generate random private key
      const privateKey = this.generateEvmPrivateKey();
      const wallet = await this.addWallet(type, network, privateKey, label);
      return { wallet, privateKey };
    }
  }

  /**
   * Remove a wallet
   * @param walletId - Wallet ID to remove
   */
  removeWallet(walletId: string): void {
    const wallet = this.wallets.get(walletId);
    if (!wallet) {
      throw new WalletError(
        "Wallet not found",
        WalletErrorCode.WALLET_NOT_FOUND,
      );
    }

    // Clear sensitive data
    if (wallet.solanaWallet) {
      SolanaWalletService.zeroize(wallet.solanaWallet);
    }

    this.wallets.delete(walletId);
    this.clients.delete(walletId);
    this.balanceCache.delete(walletId);

    this.emitEvent("wallet_removed", { wallet: this.toPublicWallet(wallet) });
    this.saveToStorage();
  }

  /**
   * Get a wallet by ID
   * @param walletId - Wallet ID
   * @returns The wallet or undefined
   */
  getWallet(walletId: string): UnifiedWallet | undefined {
    const wallet = this.wallets.get(walletId);
    return wallet ? this.toPublicWallet(wallet) : undefined;
  }

  /**
   * Get all wallets
   * @returns Array of all wallets
   */
  getWallets(): UnifiedWallet[] {
    return Array.from(this.wallets.values()).map((w) => this.toPublicWallet(w));
  }

  /**
   * Get wallets by chain type
   * @param type - Chain type filter
   * @returns Filtered wallets
   */
  getWalletsByChain(type: ChainType): UnifiedWallet[] {
    return this.getWallets().filter((w) => w.type === type);
  }

  /**
   * Get wallets by network
   * @param network - Network ID filter
   * @returns Filtered wallets
   */
  getWalletsByNetwork(network: NetworkId): UnifiedWallet[] {
    return this.getWallets().filter((w) => w.network === network);
  }

  /**
   * Update wallet label
   * @param walletId - Wallet ID
   * @param label - New label
   */
  updateWalletLabel(walletId: string, label: string): void {
    const wallet = this.wallets.get(walletId);
    if (!wallet) {
      throw new WalletError(
        "Wallet not found",
        WalletErrorCode.WALLET_NOT_FOUND,
      );
    }

    wallet.label = label;
    this.emitEvent("wallet_updated", { wallet: this.toPublicWallet(wallet) });
    this.saveToStorage();
  }

  // ==========================================================================
  // Balance Operations
  // ==========================================================================

  /**
   * Get balance for a wallet
   * @param walletId - Wallet ID
   * @param forceRefresh - Skip cache
   * @returns Unified balance
   */
  async getBalance(
    walletId: string,
    forceRefresh = false,
  ): Promise<UnifiedBalance> {
    const wallet = this.wallets.get(walletId);
    if (!wallet) {
      throw new WalletError(
        "Wallet not found",
        WalletErrorCode.WALLET_NOT_FOUND,
      );
    }

    // Check cache
    if (!forceRefresh) {
      const cached = this.balanceCache.get(walletId);
      if (cached && cached.expiresAt > Date.now()) {
        return cached.balance;
      }
    }

    let balance: UnifiedBalance;

    try {
      if (wallet.type === "evm") {
        balance = await this.getEvmBalance(wallet);
      } else {
        balance = await this.getSolanaBalance(wallet);
      }

      // Cache the result
      this.balanceCache.set(walletId, {
        balance,
        expiresAt: Date.now() + this.config.balanceRefreshInterval,
      });

      this.emitEvent("balance_updated", {
        wallet: this.toPublicWallet(wallet),
        balance,
      });

      return balance;
    } catch (error) {
      throw new WalletError(
        `Failed to fetch balance: ${error instanceof Error ? error.message : "Unknown error"}`,
        WalletErrorCode.NETWORK_ERROR,
        { originalError: error },
      );
    }
  }

  /**
   * Get balances for all wallets
   * @returns Array of balances
   */
  async getAllBalances(): Promise<UnifiedBalance[]> {
    const walletIds = Array.from(this.wallets.keys());
    const balances = await Promise.all(
      walletIds.map((id) => this.getBalance(id).catch(() => null)),
    );
    return balances.filter((b): b is UnifiedBalance => b !== null);
  }

  /**
   * Get total portfolio value in USD
   * @returns Total USD value as string
   */
  async getTotalBalanceUsd(): Promise<string> {
    const balances = await this.getAllBalances();
    const total = balances.reduce(
      (sum, b) => sum + parseFloat(b.totalUsd || "0"),
      0,
    );
    return total.toFixed(2);
  }

  // ==========================================================================
  // Transaction Operations
  // ==========================================================================

  /**
   * Send a transaction
   * @param params - Transaction parameters
   * @returns Transaction result
   */
  async send(params: SendTransactionParams): Promise<UnifiedTransaction> {
    const wallet = this.wallets.get(params.walletId);
    if (!wallet) {
      throw new WalletError(
        "Wallet not found",
        WalletErrorCode.WALLET_NOT_FOUND,
      );
    }

    if (!wallet.privateKey && !wallet.solanaWallet) {
      throw new WalletError(
        "Wallet is read-only (no private key)",
        WalletErrorCode.NOT_SUPPORTED,
      );
    }

    // Validate amount
    const amount = parseFloat(params.amount);
    if (isNaN(amount) || amount <= 0) {
      throw new WalletError("Invalid amount", WalletErrorCode.INVALID_AMOUNT);
    }

    // Emit pending event
    const pendingTx: UnifiedTransaction = {
      id: generateWalletId(),
      wallet: this.toPublicWallet(wallet),
      type: "send",
      status: "pending",
      amount: params.amount,
      token: params.token || NETWORK_METADATA[wallet.network].nativeToken,
      to: params.to,
      timestamp: Date.now(),
      txHash: "",
      explorerUrl: "",
      memo: params.memo,
    };

    this.emitEvent("transaction_pending", {
      wallet: this.toPublicWallet(wallet),
      transaction: pendingTx,
    });

    try {
      let txHash: string;

      if (wallet.type === "evm") {
        txHash = await this.sendEvmTransaction(wallet, params);
      } else {
        txHash = await this.sendSolanaTransaction(wallet, params);
      }

      const confirmedTx: UnifiedTransaction = {
        ...pendingTx,
        status: "confirmed",
        txHash,
        explorerUrl: getExplorerTxUrl(wallet.network, txHash),
      };

      this.emitEvent("transaction_confirmed", {
        wallet: this.toPublicWallet(wallet),
        transaction: confirmedTx,
      });

      // Invalidate balance cache
      this.balanceCache.delete(params.walletId);

      return confirmedTx;
    } catch (error) {
      const failedTx: UnifiedTransaction = {
        ...pendingTx,
        status: "failed",
      };

      this.emitEvent("transaction_failed", {
        wallet: this.toPublicWallet(wallet),
        transaction: failedTx,
      });

      throw new WalletError(
        `Transaction failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        WalletErrorCode.TRANSACTION_FAILED,
        { originalError: error },
      );
    }
  }

  /**
   * Estimate transaction fee
   * @param params - Transaction parameters
   * @returns Fee estimate
   */
  async estimateFee(params: SendTransactionParams): Promise<FeeEstimate> {
    const wallet = this.wallets.get(params.walletId);
    if (!wallet) {
      throw new WalletError(
        "Wallet not found",
        WalletErrorCode.WALLET_NOT_FOUND,
      );
    }

    // Simplified fee estimation
    if (wallet.type === "evm") {
      const client = this.getOrCreateEvmClient(
        wallet.network,
        wallet.privateKey,
      );
      const estimate = await client.estimateFee({
        recipient: params.to as `0x${string}`,
        amount: params.amount,
        token: (params.token as "USDs" | "USDC") || "USDs",
      });

      return {
        fee: estimate.gasFee,
        feeUsd: estimate.totalFeeUsd,
        estimatedTime: 30,
        gaslessAvailable: estimate.gaslessAvailable,
      };
    } else {
      // Solana - flat fee estimate
      return {
        fee: "0.000005",
        feeUsd: "0.001",
        estimatedTime: 2,
        gaslessAvailable: false,
      };
    }
  }

  /**
   * Get transaction history for a wallet
   * @param walletId - Wallet ID
   * @param limit - Maximum number of transactions
   * @returns Array of transactions
   */
  async getTransactionHistory(
    walletId: string,
    _limit = 50,
  ): Promise<UnifiedTransaction[]> {
    const wallet = this.wallets.get(walletId);
    if (!wallet) {
      throw new WalletError(
        "Wallet not found",
        WalletErrorCode.WALLET_NOT_FOUND,
      );
    }

    // Note: This would require indexer integration for full history
    // For now, return empty array - transactions are tracked via events
    return [];
  }

  // ==========================================================================
  // Events
  // ==========================================================================

  /**
   * Subscribe to wallet events
   * @param callback - Event listener callback
   * @returns Unsubscribe function
   */
  subscribe(callback: WalletEventListener): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /**
   * Emit a wallet event
   */
  private emitEvent(
    type: WalletEventType,
    data: Partial<WalletEvent> = {},
  ): void {
    const event: WalletEvent = {
      type,
      timestamp: Date.now(),
      ...data,
    };

    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error("Wallet event listener error:", error);
      }
    }
  }

  // ==========================================================================
  // Persistence
  // ==========================================================================

  /**
   * Export wallets as encrypted JSON
   * @param password - Encryption password
   * @returns Encrypted JSON string
   */
  exportWallets(password?: string): string {
    const walletData = Array.from(this.wallets.values()).map((w) => ({
      ...this.toPublicWallet(w),
      privateKey: w.privateKey,
      solanaSecretKey: w.solanaWallet
        ? Array.from(w.solanaWallet.secretKey)
        : undefined,
    }));

    const json = JSON.stringify(walletData);

    if (password) {
      // Simple XOR encryption (use proper encryption in production)
      return this.simpleEncrypt(json, password);
    }

    return json;
  }

  /**
   * Import wallets from encrypted JSON
   * @param data - Encrypted JSON string
   * @param password - Encryption password
   */
  async importWallets(data: string, password?: string): Promise<void> {
    let json = data;

    if (password) {
      json = this.simpleDecrypt(data, password);
    }

    const walletData = JSON.parse(json);

    for (const w of walletData) {
      const type = NETWORK_CHAIN_TYPE[w.network as NetworkId];
      if (w.privateKey) {
        await this.addWallet(type, w.network, w.privateKey, w.label);
      } else if (w.solanaSecretKey) {
        const privateKey = this.encodePrivateKey(
          new Uint8Array(w.solanaSecretKey),
        );
        await this.addWallet(type, w.network, privateKey, w.label);
      }
    }
  }

  /**
   * Clear all wallets
   */
  clearAll(): void {
    // Zeroize sensitive data
    for (const wallet of this.wallets.values()) {
      if (wallet.solanaWallet) {
        SolanaWalletService.zeroize(wallet.solanaWallet);
      }
    }

    this.wallets.clear();
    this.clients.clear();
    this.balanceCache.clear();
    this.saveToStorage();
  }

  /**
   * Destroy the manager and cleanup resources
   */
  destroy(): void {
    if (this.balanceRefreshIntervalId) {
      clearInterval(this.balanceRefreshIntervalId);
    }
    this.clearAll();
    this.listeners.clear();
  }

  // ==========================================================================
  // Private Helpers - EVM
  // ==========================================================================

  /**
   * Get or create an EVM client for a network
   */
  private getOrCreateEvmClient(
    network: NetworkId,
    privateKey?: string,
  ): X402Client {
    const clientKey = `evm-${network}`;
    let client = this.clients.get(clientKey) as X402Client | undefined;

    if (!client) {
      const x402Network = networkIdToX402Network(network);
      if (!x402Network) {
        throw new WalletError(
          `Network ${network} not supported for EVM`,
          WalletErrorCode.NOT_SUPPORTED,
        );
      }

      client = new X402Client({
        chain: x402Network,
        privateKey,
        rpcUrl: NETWORK_METADATA[network].rpcUrl,
      });
      this.clients.set(clientKey, client);
    }

    return client;
  }

  /**
   * Get EVM balance
   */
  private async getEvmBalance(wallet: InternalWallet): Promise<UnifiedBalance> {
    const client = this.getOrCreateEvmClient(wallet.network, wallet.privateKey);
    const balance: X402Balance = await client.getBalance(
      wallet.address as `0x${string}`,
    );

    const metadata = NETWORK_METADATA[wallet.network];
    const tokens: TokenBalance[] = [];

    // Add USDs if present
    if (balance.usds && parseFloat(balance.usds) > 0) {
      tokens.push({
        symbol: "USDs",
        balance: balance.usds,
        usd: balance.usds, // USDs is pegged to $1
        address: "0xD74f5255D557944cf7Dd0E45FF521520002D5748",
        decimals: 18,
      });
    }

    // Add USDC if present
    if (balance.usdc && parseFloat(balance.usdc) > 0) {
      tokens.push({
        symbol: "USDC",
        balance: balance.usdc,
        usd: balance.usdc, // USDC is pegged to $1
        address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
        decimals: 6,
      });
    }

    // Calculate total USD (native token price would need an oracle)
    const tokensUsd = tokens.reduce((sum, t) => sum + parseFloat(t.usd), 0);
    // Estimate native token USD (simplified - use price oracle in production)
    const nativeUsd = parseFloat(balance.native) * 2000; // Rough ETH price estimate

    return {
      wallet: this.toPublicWallet(wallet),
      native: {
        symbol: metadata.nativeToken,
        balance: balance.native,
        usd: nativeUsd.toFixed(2),
      },
      tokens,
      totalUsd: (tokensUsd + nativeUsd).toFixed(2),
      yieldEarned: balance.yieldEarned,
      updatedAt: Date.now(),
    };
  }

  /**
   * Send EVM transaction
   */
  private async sendEvmTransaction(
    wallet: InternalWallet,
    params: SendTransactionParams,
  ): Promise<string> {
    const client = this.getOrCreateEvmClient(wallet.network, wallet.privateKey);

    const response = await client.pay({
      recipient: params.to as `0x${string}`,
      amount: params.amount,
      token: (params.token as "USDs" | "USDC") || "USDs",
      memo: params.memo,
      gasless: params.gasless,
    });

    return response.txHash;
  }

  // ==========================================================================
  // Private Helpers - Solana
  // ==========================================================================

  /**
   * Get or create a Solana client
   */
  private getOrCreateSolanaClient(network: NetworkId): SolanaWalletService {
    const clientKey = `solana-${network}`;
    let client = this.clients.get(clientKey) as SolanaWalletService | undefined;

    if (!client) {
      const rpcUrl = NETWORK_METADATA[network].rpcUrl;
      client = new SolanaWalletService({ rpcUrl });
      this.clients.set(clientKey, client);
    }

    return client;
  }

  /**
   * Get Solana balance
   */
  private async getSolanaBalance(
    wallet: InternalWallet,
  ): Promise<UnifiedBalance> {
    const client = this.getOrCreateSolanaClient(wallet.network);
    const balance: SolanaBalance = await client.getBalance(wallet.address);

    // Estimate SOL USD value (use price oracle in production)
    const solUsd = parseFloat(balance.sol) * 150; // Rough SOL price estimate

    return {
      wallet: this.toPublicWallet(wallet),
      native: {
        symbol: "SOL",
        balance: balance.sol,
        usd: solUsd.toFixed(2),
      },
      tokens: [], // SPL tokens would need additional RPC calls
      totalUsd: solUsd.toFixed(2),
      updatedAt: Date.now(),
    };
  }

  /**
   * Send Solana transaction
   */
  private async sendSolanaTransaction(
    wallet: InternalWallet,
    params: SendTransactionParams,
  ): Promise<string> {
    if (!wallet.solanaWallet) {
      throw new WalletError(
        "Solana wallet not available",
        WalletErrorCode.NOT_SUPPORTED,
      );
    }

    const client = this.getOrCreateSolanaClient(wallet.network);

    // Convert amount to lamports
    const lamports = (parseFloat(params.amount) * 1_000_000_000).toString();

    const result = await client.transfer(wallet.solanaWallet, {
      to: params.to,
      lamports,
      memo: params.memo,
    });

    return result.signature;
  }

  // ==========================================================================
  // Private Helpers - Utilities
  // ==========================================================================

  /**
   * Convert internal wallet to public wallet
   */
  private toPublicWallet(wallet: InternalWallet): UnifiedWallet {
    return {
      id: wallet.id,
      type: wallet.type,
      network: wallet.network,
      address: wallet.address,
      label: wallet.label,
      isConnected: wallet.isConnected,
      createdAt: wallet.createdAt,
      lastActivity: wallet.lastActivity,
    };
  }

  /**
   * Generate random EVM private key
   */
  private generateEvmPrivateKey(): string {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return (
      "0x" +
      Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
    );
  }

  /**
   * Decode private key from string
   */
  private decodePrivateKey(key: string): Uint8Array {
    // Handle hex-encoded key
    if (key.startsWith("0x")) {
      const hex = key.slice(2);
      const bytes = new Uint8Array(hex.length / 2);
      for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
      }
      return bytes;
    }

    // Handle base58 or raw bytes
    try {
      // Try JSON array format
      const arr = JSON.parse(key);
      if (Array.isArray(arr)) {
        return new Uint8Array(arr);
      }
    } catch {
      // Not JSON
    }

    // Assume base58 - would need proper decoder
    throw new WalletError(
      "Unsupported private key format",
      WalletErrorCode.INVALID_ADDRESS,
    );
  }

  /**
   * Encode private key to string
   */
  private encodePrivateKey(key: Uint8Array): string {
    return (
      "0x" +
      Array.from(key)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
    );
  }

  /**
   * Simple XOR encryption (use proper encryption in production)
   */
  private simpleEncrypt(data: string, password: string): string {
    const encoder = new TextEncoder();
    const dataBytes = encoder.encode(data);
    const keyBytes = encoder.encode(password);

    const encrypted = new Uint8Array(dataBytes.length);
    for (let i = 0; i < dataBytes.length; i++) {
      encrypted[i] = dataBytes[i]! ^ keyBytes[i % keyBytes.length]!;
    }

    return btoa(String.fromCharCode(...encrypted));
  }

  /**
   * Simple XOR decryption
   */
  private simpleDecrypt(data: string, password: string): string {
    const encoder = new TextEncoder();
    const encrypted = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const keyBytes = encoder.encode(password);

    const decrypted = new Uint8Array(encrypted.length);
    for (let i = 0; i < encrypted.length; i++) {
      decrypted[i] = encrypted[i]! ^ keyBytes[i % keyBytes.length]!;
    }

    return new TextDecoder().decode(decrypted);
  }

  /**
   * Save wallets to local storage
   */
  private saveToStorage(): void {
    if (typeof window === "undefined") return;

    try {
      const data = this.exportWallets(this.config.encryptionKey || undefined);
      localStorage.setItem(this.config.storageKey, data);
    } catch (error) {
      console.error("Failed to save wallets to storage:", error);
    }
  }

  /**
   * Load wallets from local storage
   */
  private loadFromStorage(): void {
    if (typeof window === "undefined") return;

    try {
      const data = localStorage.getItem(this.config.storageKey);
      if (data) {
        // Note: importWallets is async but we fire-and-forget during construction
        this.importWallets(data, this.config.encryptionKey || undefined).catch(
          (error) =>
            console.error("Failed to load wallets from storage:", error),
        );
      }
    } catch (error) {
      console.error("Failed to load wallets from storage:", error);
    }
  }

  /**
   * Start balance auto-refresh
   */
  private startBalanceRefresh(): void {
    this.balanceRefreshIntervalId = setInterval(() => {
      for (const walletId of this.wallets.keys()) {
        this.getBalance(walletId).catch(() => {
          // Silently fail on refresh errors
        });
      }
    }, this.config.balanceRefreshInterval);
  }
}

/**
 * Create a new WalletManager instance
 * @param config - Configuration options
 * @returns WalletManager instance
 */
export function createWalletManager(
  config?: WalletManagerConfig,
): WalletManager {
  return new WalletManager(config);
}
