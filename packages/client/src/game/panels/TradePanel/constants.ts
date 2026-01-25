/**
 * Trade Panel Constants
 *
 * Configuration constants for the trade panel UI.
 */

// ============================================================================
// Grid Layout
// ============================================================================

/** Number of columns in trade grid (OSRS style) */
export const TRADE_GRID_COLS = 4;

/** Number of rows in trade grid */
export const TRADE_GRID_ROWS = 7;

/** Total number of trade slots (28, matches inventory) */
export const TRADE_SLOTS = TRADE_GRID_COLS * TRADE_GRID_ROWS;

// ============================================================================
// Timing
// ============================================================================

/** Duration to display removed item indicator (anti-scam feature) */
export const REMOVED_ITEM_DISPLAY_MS = 5000;

/** Interval for checking and clearing expired removed item indicators */
export const REMOVED_ITEM_CHECK_INTERVAL_MS = 500;
