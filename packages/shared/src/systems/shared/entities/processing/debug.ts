/**
 * Debug configuration for the processing system.
 *
 * Uses environment variable to enable/disable debug logging.
 * In production builds, the bundler can tree-shake or dead-code-eliminate
 * blocks guarded by `if (DEBUG_PROCESSING)`.
 *
 * Usage:
 * ```typescript
 * import { DEBUG_PROCESSING } from './processing/debug';
 *
 * if (DEBUG_PROCESSING) {
 *   console.log('[Processing DEBUG] ...');
 * }
 * ```
 */

/**
 * Enable verbose processing system logging.
 * - In development: controlled by HYPERSCAPE_DEBUG_PROCESSING env var
 * - In production: always false (dead code elimination)
 */
export const DEBUG_PROCESSING =
  process.env.NODE_ENV !== "production" &&
  process.env.HYPERSCAPE_DEBUG_PROCESSING === "true";
