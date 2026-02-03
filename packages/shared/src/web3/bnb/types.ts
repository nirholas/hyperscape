/**
 * BNB Chain (BSC) Type Definitions
 *
 * Type definitions for BNB Chain operations including configuration,
 * token information, transfers, and balances.
 *
 * @module web3/bnb/types
 * @author Hyperscape
 * @license MIT
 */

/**
 * Configuration for BNB Chain client
 */
export interface BNBConfig {
  /** RPC URL for the BNB Chain network */
  rpcUrl: string;
  /** Private key for signing transactions (optional for read-only operations) */
  privateKey?: string;
  /** Wallet address (optional - used when private key is provided but address derivation is external) */
  walletAddress?: string;
  /** Chain ID (56 for mainnet, 97 for testnet) */
  chainId: number;
  /** Optional timeout for RPC requests in milliseconds */
  timeout?: number;
  /** Optional number of retry attempts for failed requests */
  retryAttempts?: number;
  /** Optional delay between retries in milliseconds */
  retryDelay?: number;
}

/**
 * Information about an ERC-20 token
 */
export interface TokenInfo {
  /** Contract address of the token */
  address: string;
  /** Token symbol (e.g., "BUSD", "USDT") */
  symbol: string;
  /** Number of decimal places */
  decimals: number;
  /** Full name of the token */
  name: string;
  /** Total supply of the token (optional) */
  totalSupply?: string;
}

/**
 * Request parameters for a transfer operation
 */
export interface TransferRequest {
  /** Recipient address */
  to: string;
  /** Amount to transfer (in token units, e.g., "1.5" for 1.5 tokens) */
  amount: string;
  /** Token contract address (optional, omit for native BNB transfer) */
  token?: string;
  /** Optional gas limit override */
  gasLimit?: string;
  /** Optional gas price override in Gwei */
  gasPrice?: string;
  /** Optional nonce override */
  nonce?: number;
}

/**
 * Result of a transfer operation
 */
export interface TransferResult {
  /** Transaction hash */
  txHash: string;
  /** Transaction status ('pending', 'success', 'failed') */
  status: TransactionStatus;
  /** Gas used by the transaction (available after confirmation) */
  gasUsed?: string;
  /** Block number where transaction was included */
  blockNumber?: number;
  /** Effective gas price used */
  effectiveGasPrice?: string;
  /** From address */
  from: string;
  /** To address */
  to: string;
  /** Amount transferred */
  amount: string;
  /** Token address if token transfer, undefined for native BNB */
  token?: string;
}

/**
 * Transaction status enum
 */
export type TransactionStatus = "pending" | "success" | "failed";

/**
 * Balance information for an address
 */
export interface BNBBalance {
  /** Native BNB balance in BNB (formatted) */
  bnb: string;
  /** Native BNB balance in Wei (raw) */
  bnbWei: string;
  /** Token balances mapped by token address */
  tokens: Map<string, TokenBalance>;
}

/**
 * Token balance information
 */
export interface TokenBalance {
  /** Token contract address */
  address: string;
  /** Token symbol */
  symbol: string;
  /** Token decimals */
  decimals: number;
  /** Balance in token units (formatted) */
  balance: string;
  /** Balance in smallest unit (raw) */
  balanceRaw: string;
}

/**
 * Gas estimation result
 */
export interface GasEstimate {
  /** Estimated gas limit */
  gasLimit: string;
  /** Current gas price in Wei */
  gasPrice: string;
  /** Current gas price in Gwei */
  gasPriceGwei: string;
  /** Estimated total cost in BNB */
  estimatedCost: string;
  /** Estimated total cost in Wei */
  estimatedCostWei: string;
}

/**
 * Approval request parameters
 */
export interface ApprovalRequest {
  /** Token contract address */
  token: string;
  /** Spender address to approve */
  spender: string;
  /** Amount to approve (use 'max' for unlimited) */
  amount: string;
  /** Optional gas limit override */
  gasLimit?: string;
  /** Optional gas price override in Gwei */
  gasPrice?: string;
}

/**
 * Transaction receipt
 */
export interface TransactionReceipt {
  /** Transaction hash */
  txHash: string;
  /** Block number */
  blockNumber: number;
  /** Block hash */
  blockHash: string;
  /** Transaction index in block */
  transactionIndex: number;
  /** Gas used */
  gasUsed: string;
  /** Effective gas price */
  effectiveGasPrice: string;
  /** Status (1 = success, 0 = failed) */
  status: number;
  /** From address */
  from: string;
  /** To address */
  to: string;
  /** Contract address (if contract creation) */
  contractAddress?: string;
  /** Logs emitted by the transaction */
  logs: TransactionLog[];
}

/**
 * Transaction log entry
 */
export interface TransactionLog {
  /** Log index */
  logIndex: number;
  /** Contract address that emitted the log */
  address: string;
  /** Indexed topics */
  topics: string[];
  /** Log data */
  data: string;
}

/**
 * Error types for BNB Chain operations
 */
export class BNBError extends Error {
  /** Error code */
  code: BNBErrorCode;
  /** Original error if wrapped */
  cause?: Error;

  constructor(message: string, code: BNBErrorCode, cause?: Error) {
    super(message);
    this.name = "BNBError";
    this.code = code;
    this.cause = cause;
  }
}

/**
 * Error codes for BNB Chain operations
 */
export enum BNBErrorCode {
  /** Invalid configuration */
  INVALID_CONFIG = "INVALID_CONFIG",
  /** Invalid address format */
  INVALID_ADDRESS = "INVALID_ADDRESS",
  /** Invalid amount format */
  INVALID_AMOUNT = "INVALID_AMOUNT",
  /** Insufficient balance */
  INSUFFICIENT_BALANCE = "INSUFFICIENT_BALANCE",
  /** Insufficient gas */
  INSUFFICIENT_GAS = "INSUFFICIENT_GAS",
  /** Transaction failed */
  TRANSACTION_FAILED = "TRANSACTION_FAILED",
  /** Transaction reverted */
  TRANSACTION_REVERTED = "TRANSACTION_REVERTED",
  /** RPC error */
  RPC_ERROR = "RPC_ERROR",
  /** Network error */
  NETWORK_ERROR = "NETWORK_ERROR",
  /** Timeout error */
  TIMEOUT_ERROR = "TIMEOUT_ERROR",
  /** Private key required */
  PRIVATE_KEY_REQUIRED = "PRIVATE_KEY_REQUIRED",
  /** Contract not found */
  CONTRACT_NOT_FOUND = "CONTRACT_NOT_FOUND",
  /** Unknown error */
  UNKNOWN_ERROR = "UNKNOWN_ERROR",
}

/**
 * Event types emitted by the BNB client
 */
export interface BNBClientEvents {
  /** Transaction sent */
  transactionSent: (txHash: string) => void;
  /** Transaction confirmed */
  transactionConfirmed: (receipt: TransactionReceipt) => void;
  /** Transaction failed */
  transactionFailed: (txHash: string, error: Error) => void;
  /** RPC retry */
  rpcRetry: (attempt: number, maxAttempts: number, error: Error) => void;
}

/**
 * Options for waiting for transaction confirmation
 */
export interface WaitForTransactionOptions {
  /** Number of confirmations to wait for */
  confirmations?: number;
  /** Timeout in milliseconds */
  timeout?: number;
  /** Polling interval in milliseconds */
  pollingInterval?: number;
}
