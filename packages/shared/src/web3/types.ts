/**
 * @fileoverview Unified Web3 Types for Multi-Chain Wallet Management
 * @module @hyperscape/shared/web3/types
 *
 * Provides unified type definitions that abstract across different blockchain
 * networks (EVM chains, Solana) for consistent wallet management in Hyperscape.
 */

// ============================================================================
// Chain & Network Types
// ============================================================================

/**
 * Supported chain types in Hyperscape
 */
export type ChainType = "evm" | "solana";

/**
 * Supported network identifiers
 */
export type NetworkId =
  | "arbitrum"
  | "arbitrum-sepolia"
  | "base"
  | "ethereum"
  | "polygon"
  | "optimism"
  | "bnb"
  | "bnb-testnet"
  | "solana-mainnet"
  | "solana-devnet"
  | "solana-testnet";

/**
 * Chain type mapping for each network
 */
export const NETWORK_CHAIN_TYPE: Record<NetworkId, ChainType> = {
  arbitrum: "evm",
  "arbitrum-sepolia": "evm",
  base: "evm",
  ethereum: "evm",
  polygon: "evm",
  optimism: "evm",
  bnb: "evm",
  "bnb-testnet": "evm",
  "solana-mainnet": "solana",
  "solana-devnet": "solana",
  "solana-testnet": "solana",
} as const;

/**
 * Network metadata for UI display
 */
export interface NetworkMetadata {
  /** Network ID */
  id: NetworkId;
  /** Display name */
  name: string;
  /** Chain type */
  type: ChainType;
  /** Chain ID (EVM only) */
  chainId?: number;
  /** Native token symbol */
  nativeToken: string;
  /** Network icon name */
  icon: string;
  /** Whether this is a testnet */
  testnet: boolean;
  /** Block explorer URL */
  explorerUrl: string;
  /** RPC endpoint */
  rpcUrl: string;
}

/**
 * Network metadata registry
 */
export const NETWORK_METADATA: Record<NetworkId, NetworkMetadata> = {
  arbitrum: {
    id: "arbitrum",
    name: "Arbitrum One",
    type: "evm",
    chainId: 42161,
    nativeToken: "ETH",
    icon: "arbitrum",
    testnet: false,
    explorerUrl: "https://arbiscan.io",
    rpcUrl: "https://arb1.arbitrum.io/rpc",
  },
  "arbitrum-sepolia": {
    id: "arbitrum-sepolia",
    name: "Arbitrum Sepolia",
    type: "evm",
    chainId: 421614,
    nativeToken: "ETH",
    icon: "arbitrum",
    testnet: true,
    explorerUrl: "https://sepolia.arbiscan.io",
    rpcUrl: "https://sepolia-rollup.arbitrum.io/rpc",
  },
  base: {
    id: "base",
    name: "Base",
    type: "evm",
    chainId: 8453,
    nativeToken: "ETH",
    icon: "base",
    testnet: false,
    explorerUrl: "https://basescan.org",
    rpcUrl: "https://mainnet.base.org",
  },
  ethereum: {
    id: "ethereum",
    name: "Ethereum",
    type: "evm",
    chainId: 1,
    nativeToken: "ETH",
    icon: "ethereum",
    testnet: false,
    explorerUrl: "https://etherscan.io",
    rpcUrl: "https://eth.llamarpc.com",
  },
  polygon: {
    id: "polygon",
    name: "Polygon",
    type: "evm",
    chainId: 137,
    nativeToken: "MATIC",
    icon: "polygon",
    testnet: false,
    explorerUrl: "https://polygonscan.com",
    rpcUrl: "https://polygon-rpc.com",
  },
  optimism: {
    id: "optimism",
    name: "Optimism",
    type: "evm",
    chainId: 10,
    nativeToken: "ETH",
    icon: "optimism",
    testnet: false,
    explorerUrl: "https://optimistic.etherscan.io",
    rpcUrl: "https://mainnet.optimism.io",
  },
  bnb: {
    id: "bnb",
    name: "BNB Chain",
    type: "evm",
    chainId: 56,
    nativeToken: "BNB",
    icon: "bnb",
    testnet: false,
    explorerUrl: "https://bscscan.com",
    rpcUrl: "https://bsc-dataseed.binance.org",
  },
  "bnb-testnet": {
    id: "bnb-testnet",
    name: "BNB Testnet",
    type: "evm",
    chainId: 97,
    nativeToken: "BNB",
    icon: "bnb",
    testnet: true,
    explorerUrl: "https://testnet.bscscan.com",
    rpcUrl: "https://data-seed-prebsc-1-s1.binance.org:8545",
  },
  "solana-mainnet": {
    id: "solana-mainnet",
    name: "Solana",
    type: "solana",
    nativeToken: "SOL",
    icon: "solana",
    testnet: false,
    explorerUrl: "https://solscan.io",
    rpcUrl: "https://api.mainnet-beta.solana.com",
  },
  "solana-devnet": {
    id: "solana-devnet",
    name: "Solana Devnet",
    type: "solana",
    nativeToken: "SOL",
    icon: "solana",
    testnet: true,
    explorerUrl: "https://solscan.io?cluster=devnet",
    rpcUrl: "https://api.devnet.solana.com",
  },
  "solana-testnet": {
    id: "solana-testnet",
    name: "Solana Testnet",
    type: "solana",
    nativeToken: "SOL",
    icon: "solana",
    testnet: true,
    explorerUrl: "https://solscan.io?cluster=testnet",
    rpcUrl: "https://api.testnet.solana.com",
  },
};

// ============================================================================
// Unified Wallet Types
// ============================================================================

/**
 * Unified wallet representation across all chains
 */
export interface UnifiedWallet {
  /** Unique wallet identifier (uuid) */
  id: string;
  /** Chain type (evm or solana) */
  type: ChainType;
  /** Network identifier */
  network: NetworkId;
  /** Wallet address (0x... for EVM, base58 for Solana) */
  address: string;
  /** Optional user-defined label */
  label?: string;
  /** Connection status */
  isConnected: boolean;
  /** Timestamp when wallet was added */
  createdAt: number;
  /** Last activity timestamp */
  lastActivity?: number;
}

/**
 * Token balance information
 */
export interface TokenBalance {
  /** Token symbol (e.g., "USDC", "USDs") */
  symbol: string;
  /** Formatted balance string (e.g., "1,234.56") */
  balance: string;
  /** USD equivalent value */
  usd: string;
  /** Token contract address */
  address: string;
  /** Token decimals */
  decimals: number;
  /** Token logo URL (optional) */
  logoUrl?: string;
}

/**
 * Unified balance representation
 */
export interface UnifiedBalance {
  /** Associated wallet */
  wallet: UnifiedWallet;
  /** Native token balance */
  native: {
    /** Native token symbol */
    symbol: string;
    /** Formatted balance */
    balance: string;
    /** USD equivalent */
    usd: string;
  };
  /** Token balances */
  tokens: TokenBalance[];
  /** Total portfolio value in USD */
  totalUsd: string;
  /** Yield earnings (if applicable, e.g., USDs) */
  yieldEarned?: string;
  /** Last updated timestamp */
  updatedAt: number;
}

/**
 * Transaction type enumeration
 */
export type TransactionType =
  | "send"
  | "receive"
  | "swap"
  | "approve"
  | "mint"
  | "burn"
  | "stake"
  | "unstake";

/**
 * Transaction status enumeration
 */
export type TransactionStatus = "pending" | "confirmed" | "failed";

/**
 * Unified transaction representation
 */
export interface UnifiedTransaction {
  /** Transaction unique identifier */
  id: string;
  /** Associated wallet */
  wallet: UnifiedWallet;
  /** Transaction type */
  type: TransactionType;
  /** Transaction status */
  status: TransactionStatus;
  /** Transaction amount */
  amount: string;
  /** Token symbol */
  token: string;
  /** Recipient address (for outgoing) */
  to?: string;
  /** Sender address (for incoming) */
  from?: string;
  /** Transaction timestamp (Unix ms) */
  timestamp: number;
  /** On-chain transaction hash */
  txHash: string;
  /** Block explorer URL */
  explorerUrl: string;
  /** Gas/fee paid */
  fee?: string;
  /** Block number */
  blockNumber?: number;
  /** Optional memo */
  memo?: string;
}

// ============================================================================
// Wallet Manager Configuration
// ============================================================================

/**
 * Wallet manager configuration options
 */
export interface WalletManagerConfig {
  /** Auto-connect to previously connected wallets */
  autoConnect?: boolean;
  /** Preferred networks to show first */
  preferredNetworks?: NetworkId[];
  /** Enable testnet networks */
  enableTestnets?: boolean;
  /** Balance refresh interval in milliseconds */
  balanceRefreshInterval?: number;
  /** Storage key for wallet persistence */
  storageKey?: string;
  /** Encryption key for secure storage */
  encryptionKey?: string;
}

/**
 * Default wallet manager configuration
 */
export const DEFAULT_WALLET_MANAGER_CONFIG: Required<WalletManagerConfig> = {
  autoConnect: true,
  preferredNetworks: ["arbitrum", "solana-mainnet", "bnb"],
  enableTestnets: false,
  balanceRefreshInterval: 30000,
  storageKey: "hyperscape-wallets",
  encryptionKey: "",
};

// ============================================================================
// Send/Transfer Types
// ============================================================================

/**
 * Parameters for sending a transaction
 */
export interface SendTransactionParams {
  /** Wallet ID to send from */
  walletId: string;
  /** Recipient address */
  to: string;
  /** Amount to send */
  amount: string;
  /** Token address (optional, native token if omitted) */
  token?: string;
  /** Optional memo */
  memo?: string;
  /** Use gasless transaction if available */
  gasless?: boolean;
}

/**
 * Fee estimate for a transaction
 */
export interface FeeEstimate {
  /** Estimated fee in native token */
  fee: string;
  /** Fee in USD */
  feeUsd: string;
  /** Estimated time in seconds */
  estimatedTime: number;
  /** Whether gasless is available */
  gaslessAvailable: boolean;
}

// ============================================================================
// Event Types
// ============================================================================

/**
 * Wallet event types
 */
export type WalletEventType =
  | "wallet_added"
  | "wallet_removed"
  | "wallet_updated"
  | "balance_updated"
  | "transaction_pending"
  | "transaction_confirmed"
  | "transaction_failed"
  | "network_changed"
  | "connection_changed";

/**
 * Wallet event payload
 */
export interface WalletEvent {
  /** Event type */
  type: WalletEventType;
  /** Associated wallet (if applicable) */
  wallet?: UnifiedWallet;
  /** Transaction data (if applicable) */
  transaction?: UnifiedTransaction;
  /** Balance data (if applicable) */
  balance?: UnifiedBalance;
  /** Event timestamp */
  timestamp: number;
}

/**
 * Wallet event listener callback
 */
export type WalletEventListener = (event: WalletEvent) => void;

// ============================================================================
// Error Types
// ============================================================================

/**
 * Wallet error codes
 */
export enum WalletErrorCode {
  /** Wallet not found */
  WALLET_NOT_FOUND = "WALLET_NOT_FOUND",
  /** Invalid address format */
  INVALID_ADDRESS = "INVALID_ADDRESS",
  /** Insufficient balance */
  INSUFFICIENT_BALANCE = "INSUFFICIENT_BALANCE",
  /** Transaction failed */
  TRANSACTION_FAILED = "TRANSACTION_FAILED",
  /** Network error */
  NETWORK_ERROR = "NETWORK_ERROR",
  /** User rejected */
  USER_REJECTED = "USER_REJECTED",
  /** Not supported on network */
  NOT_SUPPORTED = "NOT_SUPPORTED",
  /** Invalid amount */
  INVALID_AMOUNT = "INVALID_AMOUNT",
  /** Timeout */
  TIMEOUT = "TIMEOUT",
  /** Unknown error */
  UNKNOWN = "UNKNOWN",
}

/**
 * Wallet error class
 */
export class WalletError extends Error {
  constructor(
    message: string,
    public readonly code: WalletErrorCode,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "WalletError";
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if a network is an EVM network
 */
export function isEvmNetwork(network: NetworkId): boolean {
  return NETWORK_CHAIN_TYPE[network] === "evm";
}

/**
 * Check if a network is a Solana network
 */
export function isSolanaNetwork(network: NetworkId): boolean {
  return NETWORK_CHAIN_TYPE[network] === "solana";
}

/**
 * Check if a network is a testnet
 */
export function isTestnet(network: NetworkId): boolean {
  return NETWORK_METADATA[network]?.testnet ?? false;
}

/**
 * Get explorer URL for a transaction
 */
export function getExplorerTxUrl(network: NetworkId, txHash: string): string {
  const metadata = NETWORK_METADATA[network];
  if (!metadata) return "";

  if (isEvmNetwork(network)) {
    return `${metadata.explorerUrl}/tx/${txHash}`;
  } else {
    // Solana
    const clusterParam =
      network === "solana-mainnet"
        ? ""
        : `?cluster=${network.replace("solana-", "")}`;
    return `${metadata.explorerUrl}/tx/${txHash}${clusterParam}`;
  }
}

/**
 * Get explorer URL for an address
 */
export function getExplorerAddressUrl(
  network: NetworkId,
  address: string,
): string {
  const metadata = NETWORK_METADATA[network];
  if (!metadata) return "";

  if (isEvmNetwork(network)) {
    return `${metadata.explorerUrl}/address/${address}`;
  } else {
    // Solana
    const clusterParam =
      network === "solana-mainnet"
        ? ""
        : `?cluster=${network.replace("solana-", "")}`;
    return `${metadata.explorerUrl}/account/${address}${clusterParam}`;
  }
}

/**
 * Truncate address for display
 */
export function truncateAddress(
  address: string,
  startChars = 6,
  endChars = 4,
): string {
  if (address.length <= startChars + endChars) return address;
  return `${address.slice(0, startChars)}...${address.slice(-endChars)}`;
}

/**
 * Format USD amount for display
 */
export function formatUsd(amount: string | number): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  if (isNaN(num)) return "$0.00";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

/**
 * Format token amount for display
 */
export function formatTokenAmount(
  amount: string | number,
  decimals = 4,
): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  if (isNaN(num)) return "0";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  }).format(num);
}

/**
 * Generate a unique wallet ID
 */
export function generateWalletId(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
