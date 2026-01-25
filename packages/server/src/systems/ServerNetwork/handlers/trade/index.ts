/**
 * Trade Handlers - Barrel Export
 *
 * All trade-related packet handlers organized into focused modules:
 *
 * - request.ts: Trade request initiation and response
 * - items.ts: Add, remove, and set quantity for trade items
 * - acceptance.ts: Accept, cancel accept, and cancel trade
 * - swap.ts: Atomic item swap execution (internal)
 * - helpers.ts: Shared utilities (not exported externally)
 * - types.ts: Handler-specific types
 */

// Request handlers
export { handleTradeRequest, handleTradeRequestRespond } from "./request";

// Item handlers
export {
  handleTradeAddItem,
  handleTradeRemoveItem,
  handleTradeSetQuantity,
} from "./items";

// Acceptance handlers
export {
  handleTradeAccept,
  handleTradeCancelAccept,
  handleTradeCancel,
} from "./acceptance";

// Re-export types for consumers that need them
export type { DatabaseConnection, TradeSwapResult } from "./types";
