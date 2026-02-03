/**
 * @fileoverview X402 Payment Protocol Type Definitions
 * @module @hyperscape/shared/web3/x402/types
 *
 * Type definitions for the X402 HTTP-402 payment protocol integration.
 * Enables AI agents to make autonomous cryptocurrency payments using
 * USDs (Sperax) stablecoin on Arbitrum with auto-yield.
 *
 * @see https://docs.cdp.coinbase.com/x402
 * @see https://docs.sperax.io/
 */

/**
 * Supported blockchain networks for X402 payments
 */
export enum X402Network {
  /** Arbitrum One - Primary network for USDs */
  Arbitrum = "arbitrum",
  /** Arbitrum Sepolia - Testnet */
  ArbitrumSepolia = "arbitrum-sepolia",
  /** Base - Coinbase L2 */
  Base = "base",
  /** Ethereum Mainnet */
  Ethereum = "ethereum",
  /** Polygon PoS */
  Polygon = "polygon",
  /** Optimism */
  Optimism = "optimism",
  /** BNB Smart Chain */
  BSC = "bsc",
}

/**
 * Payment transaction status
 */
export enum PaymentStatus {
  /** Transaction submitted, awaiting confirmation */
  Pending = "pending",
  /** Transaction confirmed on-chain */
  Confirmed = "confirmed",
  /** Transaction failed or reverted */
  Failed = "failed",
  /** Transaction timed out */
  Timeout = "timeout",
  /** Payment was rejected by user or policy */
  Rejected = "rejected",
}

/**
 * Supported payment tokens
 */
export type X402Token =
  | "USDs" // Sperax USD - auto-yield stablecoin
  | "USDC" // Circle USD
  | "USDT" // Tether USD
  | "DAI" // MakerDAO DAI
  | "ETH" // Native Ether
  | "MATIC" // Polygon native token
  | "BNB"; // BNB native token

/**
 * Token decimal precision mapping
 */
export const TOKEN_DECIMALS: Record<X402Token, number> = {
  USDs: 18,
  USDC: 6,
  USDT: 6,
  DAI: 18,
  ETH: 18,
  MATIC: 18,
  BNB: 18,
};

/**
 * Chain ID mapping for supported networks
 */
export const CHAIN_IDS: Record<X402Network, number> = {
  [X402Network.Arbitrum]: 42161,
  [X402Network.ArbitrumSepolia]: 421614,
  [X402Network.Base]: 8453,
  [X402Network.Ethereum]: 1,
  [X402Network.Polygon]: 137,
  [X402Network.Optimism]: 10,
  [X402Network.BSC]: 56,
};

/**
 * EVM address type (0x-prefixed hex string)
 */
export type Address = `0x${string}`;

/**
 * Transaction hash type (0x-prefixed hex string)
 */
export type TxHash = `0x${string}`;

/**
 * X402 client configuration
 */
export interface X402Config {
  /** Private key for signing transactions (hex string, with or without 0x prefix) */
  privateKey?: string;

  /** Primary blockchain network */
  chain: X402Network;

  /** Facilitator server URL for gasless transactions */
  facilitatorUrl?: string;

  /** Custom RPC endpoint URL */
  rpcUrl?: string;

  /** Enable fallback RPC providers */
  enableFallback?: boolean;

  /** Transaction timeout in milliseconds (default: 60000) */
  timeout?: number;

  /** Wallet address (derived from privateKey if not provided) */
  walletAddress?: Address;

  /** Maximum payment amount per transaction (in USD) */
  maxPaymentPerTx?: string;

  /** Auto-approve payments under this amount (in USD) */
  autoApproveUnder?: string;
}

/**
 * Payment request parameters
 */
export interface X402PaymentRequest {
  /** Recipient wallet address */
  recipient: Address;

  /** Payment amount as decimal string (e.g., "1.50" for $1.50) */
  amount: string;

  /** Payment token (default: USDs) */
  token?: X402Token;

  /** Optional payment memo/reference */
  memo?: string;

  /** Use gasless EIP-3009 transfer (default: true for USDs) */
  gasless?: boolean;

  /** Payment deadline timestamp (Unix seconds) */
  deadline?: number;

  /** Unique payment reference/nonce */
  reference?: string;

  /** Override chain for this payment */
  chain?: X402Network;
}

/**
 * Payment response after transaction execution
 */
export interface X402PaymentResponse {
  /** Transaction hash */
  txHash: TxHash;

  /** Payment status */
  status: PaymentStatus;

  /** Transaction fee in native token (as decimal string) */
  fee: string;

  /** Block timestamp when confirmed (Unix seconds) */
  timestamp: number;

  /** Block number (if confirmed) */
  blockNumber?: number;

  /** Actual amount transferred (may differ due to rebasing) */
  actualAmount?: string;

  /** Error message if failed */
  error?: string;
}

/**
 * Wallet balance information
 */
export interface X402Balance {
  /** USDs balance (as decimal string) */
  usds: string;

  /** USDC balance (as decimal string) */
  usdc: string;

  /** Native token balance (ETH/MATIC/BNB) */
  native: string;

  /** Total yield earned from USDs (as decimal string) */
  yieldEarned: string;

  /** Current APY percentage (e.g., 8.5 for 8.5%) */
  apy: number;

  /** Whether the wallet is opted into rebasing */
  isRebasing: boolean;

  /** Last balance update timestamp */
  updatedAt: number;
}

/**
 * Yield information for USDs holdings
 */
export interface X402YieldInfo {
  /** Total yield earned (as decimal string in USD) */
  earned: string;

  /** Current APY percentage */
  apy: number;

  /** Estimated daily yield (as decimal string in USD) */
  dailyEstimate: string;

  /** Estimated monthly yield (as decimal string in USD) */
  monthlyEstimate: string;

  /** Whether rebasing is enabled */
  isRebasing: boolean;

  /** Last rebase timestamp */
  lastRebaseAt?: number;
}

/**
 * Fee estimation result
 */
export interface X402FeeEstimate {
  /** Estimated gas fee in native token */
  gasFee: string;

  /** Estimated gas fee in USD */
  gasFeeUsd: string;

  /** Whether gasless transfer is available */
  gaslessAvailable: boolean;

  /** Facilitator fee for gasless transfer (if applicable) */
  facilitatorFee?: string;

  /** Total estimated cost in USD */
  totalFeeUsd: string;
}

/**
 * Payment event types for event listeners
 */
export type X402PaymentEvent =
  | { type: "payment_initiated"; data: X402PaymentRequest }
  | { type: "payment_pending"; data: { txHash: TxHash } }
  | { type: "payment_confirmed"; data: X402PaymentResponse }
  | { type: "payment_failed"; data: { error: string; txHash?: TxHash } };

/**
 * Payment event listener callback
 */
export type X402PaymentEventListener = (
  event: X402PaymentEvent,
) => void | Promise<void>;

/**
 * X402 error codes
 */
export enum X402ErrorCode {
  /** Invalid payment request parameters */
  InvalidPaymentRequest = "INVALID_PAYMENT_REQUEST",
  /** Insufficient token balance */
  InsufficientBalance = "INSUFFICIENT_BALANCE",
  /** Payment timed out */
  PaymentTimeout = "PAYMENT_TIMEOUT",
  /** Transaction failed on-chain */
  TransactionFailed = "TRANSACTION_FAILED",
  /** Payment verification failed */
  VerificationFailed = "VERIFICATION_FAILED",
  /** Unsupported blockchain network */
  UnsupportedChain = "UNSUPPORTED_CHAIN",
  /** Unsupported payment token */
  UnsupportedToken = "UNSUPPORTED_TOKEN",
  /** Network/RPC error */
  NetworkError = "NETWORK_ERROR",
  /** Invalid signature */
  InvalidSignature = "INVALID_SIGNATURE",
  /** Payment rejected by policy */
  PaymentRejected = "PAYMENT_REJECTED",
  /** Rate limit exceeded */
  RateLimitExceeded = "RATE_LIMIT_EXCEEDED",
  /** Facilitator service error */
  FacilitatorError = "FACILITATOR_ERROR",
  /** Configuration error */
  ConfigurationError = "CONFIGURATION_ERROR",
  /** Wallet not initialized */
  WALLET_NOT_INITIALIZED = "WALLET_NOT_INITIALIZED",
}

/**
 * X402 custom error class
 */
export class X402Error extends Error {
  public readonly code: X402ErrorCode;
  public readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    code: X402ErrorCode,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "X402Error";
    this.code = code;
    this.details = details;

    // Maintain proper prototype chain
    Object.setPrototypeOf(this, X402Error.prototype);
  }

  /**
   * Create error from unknown caught value
   */
  static fromUnknown(
    error: unknown,
    fallbackCode: X402ErrorCode = X402ErrorCode.NetworkError,
  ): X402Error {
    if (error instanceof X402Error) {
      return error;
    }
    if (error instanceof Error) {
      return new X402Error(error.message, fallbackCode, {
        originalError: error.name,
      });
    }
    return new X402Error(String(error), fallbackCode);
  }
}

/**
 * HTTP 402 response structure from payment-required endpoints
 */
export interface HTTP402Response {
  /** HTTP status code (always 402) */
  status: 402;

  /** Response headers with payment information */
  headers: {
    /** WWW-Authenticate header with payment details */
    "www-authenticate": string;
    /** Content type */
    "content-type"?: string;
  };

  /** Optional error message */
  message?: string;

  /** Parsed payment request */
  paymentRequest?: X402PaymentRequest;
}

/**
 * Payment verification result
 */
export interface X402PaymentVerification {
  /** Whether the payment was verified successfully */
  verified: boolean;

  /** Transaction details if verified */
  transaction?: X402PaymentResponse;

  /** Error message if verification failed */
  error?: string;

  /** Verification timestamp */
  verifiedAt: number;
}
