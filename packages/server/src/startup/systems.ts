/**
 * Systems Module - Server system initialization and lifecycle management
 *
 * Handles initialization of server-side systems that run alongside the ECS world,
 * including market data feeds, payment systems, and other background services.
 *
 * This module manages systems that:
 * - Need to start after the world is initialized
 * - Run independently of the ECS tick loop
 * - Provide data/services to the game systems
 *
 * Usage:
 * ```typescript
 * import { initializeServerSystems, shutdownServerSystems } from './startup/systems.js';
 *
 * // After world initialization
 * const systems = await initializeServerSystems(config);
 *
 * // During shutdown
 * await shutdownServerSystems(systems);
 * ```
 */

import { BinancePriceFeed } from "../systems/market/index.js";
import type { ServerConfig } from "./config.js";

/**
 * Server systems context containing all initialized systems
 */
export interface ServerSystemsContext {
  /** Binance price feed for real-time crypto prices */
  priceFeed: BinancePriceFeed | null;
}

/**
 * Default symbols to track for in-game economy
 */
const DEFAULT_PRICE_FEED_SYMBOLS = [
  "BTCUSDT",
  "ETHUSDT",
  "SOLUSDT",
  "BNBUSDT",
  "MATICUSDT",
  "MANAUSDT", // Decentraland - gaming
  "SANDUSDT", // Sandbox - gaming
  "AXSUSDT", // Axie Infinity - gaming
];

/**
 * Initialize server-side systems
 *
 * This function initializes systems that run outside the ECS world but
 * provide data and services to the game. These systems are started after
 * the world is initialized to ensure proper sequencing.
 *
 * @param config - Server configuration
 * @returns Promise resolving to initialized systems context
 */
export async function initializeServerSystems(
  config: ServerConfig,
): Promise<ServerSystemsContext> {
  console.log("[Systems] Initializing server systems...");

  let priceFeed: BinancePriceFeed | null = null;

  // Initialize Binance price feed if enabled
  const enablePriceFeed = process.env.ENABLE_PRICE_FEED !== "false";

  if (enablePriceFeed) {
    try {
      console.log("[Systems] Starting Binance price feed...");

      // Parse custom symbols from environment or use defaults
      const symbolsEnv = process.env.PRICE_FEED_SYMBOLS;
      const symbols = symbolsEnv
        ? symbolsEnv.split(",").map((s) => s.trim().toUpperCase())
        : DEFAULT_PRICE_FEED_SYMBOLS;

      // Parse update interval from environment or use default
      const updateInterval = parseInt(
        process.env.PRICE_FEED_INTERVAL || "5000",
        10,
      );

      // Determine if we should use WebSocket based on environment
      const useWebSocket = process.env.PRICE_FEED_USE_WEBSOCKET !== "false";

      priceFeed = new BinancePriceFeed({
        symbols,
        updateInterval,
        useWebSocket,
        debug: config.nodeEnv === "development",
      });

      await priceFeed.start();

      // Log initial status
      const health = priceFeed.getHealth();
      console.log(
        `[Systems] ✅ Price feed started (${symbols.length} symbols, WebSocket: ${useWebSocket})`,
      );
      console.log(
        `[Systems]    Status: ${health.isHealthy ? "Healthy" : "Degraded"}`,
      );

      // Optionally make price feed globally available for systems
      (globalThis as Record<string, unknown>).__HYPERSCAPE_PRICE_FEED__ =
        priceFeed;
    } catch (error) {
      console.error("[Systems] ⚠️ Failed to start price feed:", error);
      console.error("[Systems]    Market data will be unavailable");
      // Don't throw - market data is non-critical for gameplay
    }
  } else {
    console.log("[Systems] Price feed disabled (ENABLE_PRICE_FEED=false)");
  }

  console.log("[Systems] ✅ Server systems initialized");

  return {
    priceFeed,
  };
}

/**
 * Shutdown server systems gracefully
 *
 * Stops all background systems and releases resources.
 *
 * @param context - Server systems context from initialization
 */
export async function shutdownServerSystems(
  context: ServerSystemsContext,
): Promise<void> {
  console.log("[Systems] Shutting down server systems...");

  if (context.priceFeed) {
    try {
      context.priceFeed.stop();
      console.log("[Systems] ✅ Price feed stopped");
    } catch (error) {
      console.error("[Systems] ⚠️ Error stopping price feed:", error);
    }
  }

  // Clean up global reference
  delete (globalThis as Record<string, unknown>).__HYPERSCAPE_PRICE_FEED__;

  console.log("[Systems] ✅ Server systems shutdown complete");
}

/**
 * Get the global price feed instance
 *
 * Utility function to access the price feed from anywhere in the server.
 *
 * @returns BinancePriceFeed instance or null if not initialized
 */
export function getGlobalPriceFeed(): BinancePriceFeed | null {
  return (
    ((globalThis as Record<string, unknown>)
      .__HYPERSCAPE_PRICE_FEED__ as BinancePriceFeed | null) || null
  );
}
