/**
 * @fileoverview Server-side Payment System Exports
 * @module @hyperscape/server/systems/payments
 *
 * Provides x402 payment verification and invoice management
 * for the Hyperscape server infrastructure.
 *
 * @example
 * ```typescript
 * import {
 *   X402PaymentService,
 *   PaymentServiceType,
 *   PaymentVerificationFailure,
 * } from '@hyperscape/server/systems/payments';
 *
 * const paymentService = new X402PaymentService({
 *   defaultNetwork: X402Network.Arbitrum,
 *   serviceWallet: '0x...',
 *   verification: {
 *     defaultTolerance: 0.1,
 *     maxTransactionAge: 3600,
 *     confirmationsRequired: 1,
 *   }
 * });
 * ```
 */

// Service
export { X402PaymentService, default } from "./X402PaymentService";

// Types
export {
  // Enums
  PaymentServiceType,
  PaymentVerificationFailure,
  PaymentWebhookEvent,

  // Interfaces - Core
  type PaymentRecord,
  type PaymentInvoice,
  type ServerPaymentRequest,

  // Interfaces - Verification
  type PaymentVerificationRequest,
  type PaymentVerificationResponse,

  // Interfaces - History
  type PaymentHistoryQuery,
  type PaymentHistoryResponse,
  type PaymentStatistics,

  // Interfaces - Invoices
  type CreateInvoiceRequest,

  // Interfaces - Webhooks
  type PaymentWebhookPayload,

  // Interfaces - Config
  type X402PaymentServiceConfig,
} from "./types";
