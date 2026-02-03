/**
 * @fileoverview X402 Payment System Types for Hyperscape Server
 * @module @hyperscape/server/systems/payments/types
 *
 * Type definitions for server-side payment processing, verification,
 * and payment history tracking.
 */

import type {
  Address,
  TxHash,
  X402PaymentRequest,
  X402PaymentResponse,
  PaymentStatus,
  X402Network,
  X402Token,
} from "@hyperscape/shared";

// ============================================================================
// Payment Record Types
// ============================================================================

/**
 * Stored payment record in database
 */
export interface PaymentRecord {
  /** Unique payment ID (UUID) */
  id: string;

  /** Transaction hash on blockchain */
  txHash: TxHash;

  /** Sender address */
  from: Address;

  /** Recipient address */
  to: Address;

  /** Payment amount (as decimal string) */
  amount: string;

  /** Payment token symbol */
  token: X402Token;

  /** Blockchain network */
  network: X402Network;

  /** Payment status */
  status: PaymentStatus;

  /** Block number when confirmed */
  blockNumber?: number;

  /** Block timestamp when confirmed (Unix seconds) */
  blockTimestamp?: number;

  /** Gas fee paid (as decimal string in native token) */
  gasFee?: string;

  /** Gas fee in USD */
  gasFeeUsd?: string;

  /** Payment memo/reference */
  memo?: string;

  /** Associated player ID in Hyperscape */
  playerId?: string;

  /** Associated agent ID (for AI agent payments) */
  agentId?: string;

  /** Service/product being paid for */
  serviceType?: PaymentServiceType;

  /** Additional metadata */
  metadata?: Record<string, unknown>;

  /** Record creation timestamp */
  createdAt: Date;

  /** Last status update timestamp */
  updatedAt: Date;

  /** Verification timestamp */
  verifiedAt?: Date;
}

/**
 * Types of services that can be paid for
 */
export enum PaymentServiceType {
  /** Generic payment/transfer */
  Transfer = "transfer",
  /** Premium API access */
  ApiAccess = "api_access",
  /** In-game item purchase */
  ItemPurchase = "item_purchase",
  /** Subscription payment */
  Subscription = "subscription",
  /** Tipping another player/agent */
  Tip = "tip",
  /** Marketplace transaction */
  Marketplace = "marketplace",
  /** Service fee */
  ServiceFee = "service_fee",
  /** Deposit to game wallet */
  Deposit = "deposit",
  /** Withdrawal from game wallet */
  Withdrawal = "withdrawal",
}

// ============================================================================
// Payment Request/Response Types
// ============================================================================

/**
 * Server-side payment request (extends base with additional server fields)
 */
export interface ServerPaymentRequest extends X402PaymentRequest {
  /** Player ID making the payment */
  playerId?: string;

  /** Agent ID making the payment */
  agentId?: string;

  /** Service type being paid for */
  serviceType?: PaymentServiceType;

  /** Additional metadata for tracking */
  metadata?: Record<string, unknown>;

  /** Idempotency key to prevent duplicate payments */
  idempotencyKey?: string;
}

/**
 * Payment verification request
 */
export interface PaymentVerificationRequest {
  /** Transaction hash to verify */
  txHash: TxHash;

  /** Expected recipient address */
  expectedRecipient: Address;

  /** Expected amount (with tolerance) */
  expectedAmount: string;

  /** Amount tolerance percentage (default: 0.1%) */
  tolerance?: number;

  /** Expected token */
  expectedToken?: X402Token;

  /** Network to verify on */
  network?: X402Network;

  /** Maximum age of transaction in seconds (default: 3600) */
  maxAge?: number;
}

/**
 * Payment verification response
 */
export interface PaymentVerificationResponse {
  /** Whether verification passed */
  verified: boolean;

  /** Payment record if found and verified */
  payment?: PaymentRecord;

  /** Transaction details from blockchain */
  transaction?: X402PaymentResponse;

  /** Verification failure reason */
  failureReason?: PaymentVerificationFailure;

  /** Detailed error message */
  errorMessage?: string;

  /** Timestamp of verification */
  verifiedAt: number;
}

/**
 * Payment verification failure reasons
 */
export enum PaymentVerificationFailure {
  /** Transaction not found */
  TransactionNotFound = "transaction_not_found",
  /** Transaction still pending */
  TransactionPending = "transaction_pending",
  /** Transaction failed/reverted */
  TransactionFailed = "transaction_failed",
  /** Recipient address mismatch */
  RecipientMismatch = "recipient_mismatch",
  /** Amount below expected */
  AmountMismatch = "amount_mismatch",
  /** Token type mismatch */
  TokenMismatch = "token_mismatch",
  /** Transaction too old */
  TransactionExpired = "transaction_expired",
  /** Network mismatch */
  NetworkMismatch = "network_mismatch",
  /** Blockchain RPC error */
  RpcError = "rpc_error",
}

// ============================================================================
// Payment Invoice Types
// ============================================================================

/**
 * Payment invoice/request for paywalled content
 */
export interface PaymentInvoice {
  /** Unique invoice ID */
  id: string;

  /** Recipient address (where to pay) */
  recipient: Address;

  /** Amount to pay */
  amount: string;

  /** Token to use */
  token: X402Token;

  /** Network to pay on */
  network: X402Network;

  /** Human-readable description */
  description: string;

  /** Service type */
  serviceType: PaymentServiceType;

  /** Invoice expiration timestamp (Unix seconds) */
  expiresAt: number;

  /** Additional metadata */
  metadata?: Record<string, unknown>;

  /** Creation timestamp */
  createdAt: number;

  /** Whether invoice has been paid */
  isPaid: boolean;

  /** Payment transaction hash if paid */
  paymentTxHash?: TxHash;
}

/**
 * Create invoice request
 */
export interface CreateInvoiceRequest {
  /** Recipient address */
  recipient: Address;

  /** Amount to pay */
  amount: string;

  /** Token to use (default: USDs) */
  token?: X402Token;

  /** Network (default: Arbitrum) */
  network?: X402Network;

  /** Human-readable description */
  description: string;

  /** Service type */
  serviceType: PaymentServiceType;

  /** Invoice validity duration in seconds (default: 3600) */
  validityDuration?: number;

  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Webhook Types
// ============================================================================

/**
 * Payment webhook event types
 */
export enum PaymentWebhookEvent {
  /** Payment confirmed on-chain */
  PaymentConfirmed = "payment.confirmed",
  /** Payment failed */
  PaymentFailed = "payment.failed",
  /** Invoice paid */
  InvoicePaid = "invoice.paid",
  /** Invoice expired */
  InvoiceExpired = "invoice.expired",
}

/**
 * Webhook payload structure
 */
export interface PaymentWebhookPayload {
  /** Event type */
  event: PaymentWebhookEvent;

  /** Event timestamp */
  timestamp: number;

  /** Event data */
  data: PaymentRecord | PaymentInvoice;

  /** Webhook signature for verification */
  signature?: string;
}

// ============================================================================
// Query Types
// ============================================================================

/**
 * Payment history query options
 */
export interface PaymentHistoryQuery {
  /** Filter by sender address */
  from?: Address;

  /** Filter by recipient address */
  to?: Address;

  /** Filter by player ID */
  playerId?: string;

  /** Filter by agent ID */
  agentId?: string;

  /** Filter by status */
  status?: PaymentStatus | PaymentStatus[];

  /** Filter by service type */
  serviceType?: PaymentServiceType | PaymentServiceType[];

  /** Filter by token */
  token?: X402Token;

  /** Filter by network */
  network?: X402Network;

  /** Minimum amount */
  minAmount?: string;

  /** Maximum amount */
  maxAmount?: string;

  /** Start date (Unix timestamp or ISO string) */
  startDate?: number | string;

  /** End date (Unix timestamp or ISO string) */
  endDate?: number | string;

  /** Maximum number of results (default: 50) */
  limit?: number;

  /** Offset for pagination */
  offset?: number;

  /** Sort field */
  sortBy?: "createdAt" | "amount" | "blockNumber";

  /** Sort direction */
  sortDirection?: "asc" | "desc";
}

/**
 * Payment history response
 */
export interface PaymentHistoryResponse {
  /** Payment records */
  payments: PaymentRecord[];

  /** Total count (for pagination) */
  totalCount: number;

  /** Whether there are more results */
  hasMore: boolean;

  /** Query metadata */
  query: PaymentHistoryQuery;
}

// ============================================================================
// Statistics Types
// ============================================================================

/**
 * Payment statistics for an address
 */
export interface PaymentStatistics {
  /** Address being queried */
  address: Address;

  /** Total payments sent */
  totalSent: {
    count: number;
    amount: string;
    amountUsd: string;
  };

  /** Total payments received */
  totalReceived: {
    count: number;
    amount: string;
    amountUsd: string;
  };

  /** Total fees paid */
  totalFees: {
    amount: string;
    amountUsd: string;
  };

  /** Breakdown by token */
  byToken: Record<
    X402Token,
    {
      sent: { count: number; amount: string };
      received: { count: number; amount: string };
    }
  >;

  /** Breakdown by service type */
  byServiceType: Record<
    PaymentServiceType,
    {
      count: number;
      amount: string;
    }
  >;

  /** Query period */
  period: {
    start: Date;
    end: Date;
  };
}

// ============================================================================
// Service Configuration Types
// ============================================================================

/**
 * X402 Payment Service configuration
 */
export interface X402PaymentServiceConfig {
  /** Default network for payments */
  defaultNetwork: X402Network;

  /** Service wallet address (for receiving payments) */
  serviceWallet: Address;

  /** Service wallet private key (for making refunds) */
  serviceWalletPrivateKey?: string;

  /** RPC URLs per network */
  rpcUrls?: Partial<Record<X402Network, string>>;

  /** Payment verification settings */
  verification: {
    /** Default amount tolerance percentage */
    defaultTolerance: number;
    /** Maximum transaction age for verification */
    maxTransactionAge: number;
    /** Number of confirmations required */
    confirmationsRequired: number;
  };

  /** Webhook configuration */
  webhooks?: {
    /** Webhook endpoint URL */
    url: string;
    /** Webhook secret for signing */
    secret: string;
    /** Events to send */
    events: PaymentWebhookEvent[];
  };

  /** Rate limiting configuration */
  rateLimit?: {
    /** Maximum requests per minute per address */
    maxRequestsPerMinute: number;
    /** Maximum payment amount per day per address */
    maxDailyAmount: string;
  };
}
