/**
 * @fileoverview X402 Payment Protocol Module
 * @module @hyperscape/shared/web3/x402
 *
 * X402 HTTP-402 payment protocol integration for Hyperscape.
 * Enables AI agents to make autonomous cryptocurrency payments using
 * USDs (Sperax) stablecoin on Arbitrum with auto-yield (5-8% APY).
 *
 * ## Features
 *
 * - **HTTP 402 Payment Required** - Standard protocol for programmatic payments
 * - **USDs Auto-Yield** - Earn 5-8% APY while holding stablecoins
 * - **Gasless Transfers** - EIP-3009 support for zero-gas payments
 * - **Multi-Chain Support** - Arbitrum, Base, Ethereum, Polygon, Optimism
 *
 * ## Quick Start
 *
 * ```typescript
 * import { X402Client, X402Network } from '@hyperscape/shared/web3/x402';
 *
 * // Create client
 * const client = new X402Client({
 *   chain: X402Network.Arbitrum,
 *   privateKey: process.env.WALLET_PRIVATE_KEY,
 * });
 *
 * // Make a gasless payment
 * const response = await client.pay({
 *   recipient: '0x1234...',
 *   amount: '5.00',
 *   token: 'USDs',
 *   gasless: true,
 *   memo: 'API call payment'
 * });
 *
 * // Check yield earnings
 * const yieldInfo = await client.getYieldInfo('0x1234...');
 * console.log(`Earned: $${yieldInfo.earned}, APY: ${yieldInfo.apy}%`);
 * ```
 *
 * ## Architecture
 *
 * ```
 * ┌─────────────────────────────────────────────────────────────┐
 * │                      Hyperscape Game                        │
 * │                                                             │
 * │  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐     │
 * │  │   ElizaOS   │    │   Player    │    │    NPC      │     │
 * │  │   Agents    │    │   Wallet    │    │  Merchant   │     │
 * │  └──────┬──────┘    └──────┬──────┘    └──────┬──────┘     │
 * │         │                  │                  │             │
 * │         └──────────────────┼──────────────────┘             │
 * │                            │                                │
 * │                   ┌────────▼────────┐                       │
 * │                   │   X402Client    │                       │
 * │                   └────────┬────────┘                       │
 * └────────────────────────────┼────────────────────────────────┘
 *                              │
 *              ┌───────────────┼───────────────┐
 *              │               │               │
 *     ┌────────▼────────┐ ┌────▼────┐ ┌───────▼───────┐
 *     │   Facilitator   │ │  RPC    │ │  Sperax Vault │
 *     │   (Gasless)     │ │ Provider│ │   (Yield)     │
 *     └─────────────────┘ └─────────┘ └───────────────┘
 * ```
 *
 * @see https://docs.cdp.coinbase.com/x402
 * @see https://docs.sperax.io/
 */

// ============================================================================
// Type Exports
// ============================================================================

export {
  // Enums
  X402Network,
  PaymentStatus,
  X402ErrorCode,

  // Types
  type X402Token,
  type Address,
  type TxHash,
  type X402Config,
  type X402PaymentRequest,
  type X402PaymentResponse,
  type X402Balance,
  type X402YieldInfo,
  type X402FeeEstimate,
  type X402PaymentEvent,
  type X402PaymentEventListener,
  type HTTP402Response,
  type X402PaymentVerification,

  // Constants from types
  TOKEN_DECIMALS,
  CHAIN_IDS,

  // Error class
  X402Error,
} from "./types";

// ============================================================================
// Constant Exports
// ============================================================================

export {
  // Contract addresses
  SPERAX_CONTRACTS,

  // URLs
  DEFAULT_FACILITATOR_URL,
  TESTNET_FACILITATOR_URL,
  DEFAULT_RPC_URLS,
  FALLBACK_RPC_URLS,

  // Token addresses
  TOKEN_ADDRESSES,
  NATIVE_TOKEN,

  // Block explorers
  BLOCK_EXPLORERS,

  // Configuration constants
  DEFAULT_TX_TIMEOUT,
  GAS_LIMIT_MULTIPLIER,
  DEFAULT_CONFIRMATIONS,
  MAX_RPC_RETRIES,
  RPC_RETRY_DELAY,

  // ABI definitions
  ERC20_ABI,
  USDS_ABI,
  EIP3009_ABI,
  SPERAX_VAULT_ABI,

  // HTTP 402 headers
  HTTP402_HEADERS,

  // Payment limits
  ESTIMATED_USDS_APY,
  MIN_PAYMENT_AMOUNT,
  MAX_PAYMENT_AMOUNT,

  // Event signatures
  TRANSFER_EVENT_SIGNATURE,
} from "./constants";

// ============================================================================
// Client Exports
// ============================================================================

export {
  X402Client,
  createX402Client,
  createArbitrumClient,
  createBaseClient,
  createMockX402Client,
} from "./client";

// ============================================================================
// Re-export everything as default namespace for convenience
// ============================================================================

import * as types from "./types";
import * as constants from "./constants";
import * as client from "./client";

/**
 * X402 module namespace containing all exports
 */
export const X402 = {
  ...types,
  ...constants,
  ...client,
} as const;

export default X402;
