/**
 * Market Data System - Enterprise-grade Real-time Cryptocurrency Price Feeds
 *
 * Comprehensive market data integration with Binance for powering
 * tokenized in-game economies in Hyperscape.
 *
 * Features:
 * - Real-time WebSocket price streaming
 * - Automatic reconnection with exponential backoff
 * - REST API fallback for high availability
 * - Multiple concurrent subscriptions with throttling
 * - Historical OHLCV data retrieval
 * - Comprehensive health monitoring
 * - Production-ready error handling
 *
 * @example
 * ```typescript
 * import {
 *   createPriceFeed,
 *   createDefaultPriceFeed,
 *   getGlobalPriceFeed,
 *   BinancePriceFeed,
 * } from './systems/market';
 *
 * // Option 1: Create with specific config
 * const feed = createPriceFeed({
 *   symbols: ['BTCUSDT', 'ETHUSDT'],
 *   useWebSocket: true,
 *   debug: process.env.NODE_ENV !== 'production',
 * });
 *
 * // Option 2: Use default configuration
 * const defaultFeed = createDefaultPriceFeed();
 *
 * // Option 3: Use global singleton
 * const globalFeed = getGlobalPriceFeed();
 *
 * // Start the feed
 * await feed.start();
 *
 * // Get current prices
 * const btcPrice = feed.getPrice('BTCUSDT');
 * console.log(`BTC: $${btcPrice?.price.toLocaleString()}`);
 *
 * // Subscribe to updates
 * const unsubscribe = feed.subscribe({
 *   symbols: ['BTCUSDT', 'ETHUSDT'],
 *   callback: (tick) => {
 *     console.log(`${tick.symbol}: $${tick.price} (${tick.change24h > 0 ? '+' : ''}${tick.change24h.toFixed(2)}%)`);
 *   },
 *   minInterval: 1000, // Throttle to 1 update/second per symbol
 * });
 *
 * // Get historical data
 * const candles = await feed.getHistoricalPrices('BTCUSDT', '1h', 24);
 *
 * // Check health status
 * const health = feed.getHealth();
 * if (!health.isHealthy) {
 *   alertOps('Price feed unhealthy', health);
 * }
 *
 * // Cleanup
 * unsubscribe();
 * feed.stop();
 * ```
 *
 * @module market
 * @version 1.0.0
 */

// ============================================================================
// Main Service Export
// ============================================================================

export { BinancePriceFeed } from "./BinancePriceFeed";

// ============================================================================
// Price Oracle Export
// ============================================================================

export {
  PriceOracle,
  createPriceOracle,
  getGlobalOracle,
  hasGlobalOracle,
  resetGlobalOracle,
  type PriceOracleConfig,
  type AggregatedPrice,
  type GameCurrencyConfig,
  type OracleHealth,
  type OraclePriceCallback,
  type DeviationAlertCallback,
} from "./PriceOracle";

// ============================================================================
// Server-side Types Export
// ============================================================================

export type {
  // Binance REST API response types
  BinanceTickerPriceResponse,
  BinanceTicker24hrResponse,
  BinanceRollingTickerResponse,
  BinanceBookTickerResponse,
  BinanceAvgPriceResponse,
  BinanceKlineResponse,
  BinanceDepthResponse,
  BinanceTradeResponse,
  BinanceAggTradeResponse,
  BinanceExchangeInfoResponse,
  BinanceRateLimitInfo,
  BinanceSymbolInfo,
  BinanceSymbolFilter,
  BinancePriceFilter,
  BinanceLotSizeFilter,
  BinanceMinNotionalFilter,
  BinanceOtherFilter,
  BinanceApiError,

  // Binance WebSocket message types
  BinanceWsTickerMessage,
  BinanceWsMiniTickerMessage,
  BinanceWsBookTickerMessage,
  BinanceWsTradeMessage,
  BinanceWsAggTradeMessage,
  BinanceWsKlineMessage,
  BinanceWsKlineData,
  BinanceWsDepthMessage,
  BinanceWsCombinedStreamMessage,
  BinanceWsMessage,
  BinanceWsSubscribeRequest,
  BinanceWsSubscribeResponse,

  // Internal types
  CachedPriceTick,
  PriceCache,
  SubscriptionEntry,
  SubscriptionRegistry,
  WebSocketState,
} from "./types";

// Export constants
export {
  BINANCE_ENDPOINTS,
  BINANCE_LIMITS,
  BINANCE_ERROR_CODES,
} from "./types";

// Export type guards
export {
  isTickerMessage,
  isMiniTickerMessage,
  isBookTickerMessage,
  isTradeMessage,
  isAggTradeMessage,
  isKlineMessage,
  isDepthMessage,
  isCombinedStreamMessage,
  isBinanceError,
} from "./types";

// Export parsing utilities
export {
  parseTickerMessage,
  parseRestTicker,
  cachedToPriceTick,
  createDefaultWebSocketState,
} from "./types";

// ============================================================================
// Re-export Shared Types (for convenience)
// ============================================================================

export type {
  // Core price types
  PriceTick,
  MiniPriceTick,
  PriceCandle,
  AggregateTrade,
  OrderBookLevel,
  OrderBook,

  // Subscription types
  PriceSubscription,
  PriceUpdateCallback,
  MiniPriceUpdateCallback,
  CandleUpdateCallback,
  ErrorCallback,
  CandleSubscription,

  // Configuration types
  MarketDataConfig,
  ResolvedMarketConfig,

  // Health & monitoring types
  PriceFeedHealth,
  PriceFeedMetrics,
  PriceFeedConnectionState,

  // Event types
  PriceFeedEventType,
  PriceUpdateEvent,
  CandleUpdateEvent,
  ConnectionStateChangeEvent,
  PriceFeedErrorEvent,
  ReconnectingEvent,
  PriceFeedEvent,
  PriceFeedEventListener,

  // Utility types
  SupportedPair,
  KlineInterval,
  SymbolPrice,
  PriceChange,
  SymbolStats,
} from "@hyperscape/shared";

// Export shared constants and utilities
export {
  // Constants
  SUPPORTED_PAIRS,
  DEFAULT_MARKET_CONFIG,
  KLINE_INTERVALS,
  MarketDataErrorCode,

  // Type guards
  isSupportedPair,
  isValidKlineInterval,

  // Utilities
  normalizeSymbol,
  parseTradingPair,
  intervalToMs,
  convertToGameCurrency,
  formatPrice,
  calculatePriceChange,

  // Error class
  MarketDataError,
} from "@hyperscape/shared";

// ============================================================================
// Factory Functions
// ============================================================================

import type { MarketDataConfig } from "@hyperscape/shared";
import { BinancePriceFeed } from "./BinancePriceFeed";

/**
 * Create a new price feed instance with custom configuration
 *
 * Use this when you need full control over the configuration,
 * such as specific symbol lists or custom update intervals.
 *
 * @param config - Configuration options for the price feed
 * @returns A new BinancePriceFeed instance (not started)
 *
 * @example
 * ```typescript
 * const feed = createPriceFeed({
 *   symbols: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'],
 *   useWebSocket: true,
 *   debug: true,
 *   stalePriceThreshold: 30000,
 * });
 *
 * await feed.start();
 * ```
 */
export function createPriceFeed(config: MarketDataConfig): BinancePriceFeed {
  return new BinancePriceFeed(config);
}

/**
 * Create a price feed with default configuration for gaming
 *
 * Includes all commonly-used pairs for gaming/metaverse applications
 * with sensible defaults for production use.
 *
 * @param options - Optional configuration overrides
 * @returns A new BinancePriceFeed instance with gaming-optimized defaults
 *
 * @example
 * ```typescript
 * // Quick setup with defaults
 * const feed = createDefaultPriceFeed();
 * await feed.start();
 *
 * // Or with some overrides
 * const debugFeed = createDefaultPriceFeed({
 *   debug: true,
 *   updateInterval: 2000,
 * });
 * ```
 */
export function createDefaultPriceFeed(
  options?: Partial<Omit<MarketDataConfig, "symbols">>,
): BinancePriceFeed {
  return new BinancePriceFeed({
    // Gaming/metaverse relevant pairs
    symbols: [
      // Major pairs
      "BTCUSDT",
      "ETHUSDT",
      "BNBUSDT",
      "SOLUSDT",

      // Gaming tokens
      "MANAUSDT", // Decentraland
      "SANDUSDT", // The Sandbox
      "AXSUSDT", // Axie Infinity
      "ENJUSDT", // Enjin
      "GALAUSDT", // Gala Games
      "IMXUSDT", // Immutable X

      // Popular alts
      "MATICUSDT",
      "AVAXUSDT",
      "LINKUSDT",
    ],
    useWebSocket: true,
    enableRestFallback: true,
    ...options,
  });
}

/**
 * Create a minimal price feed for testing or low-resource environments
 *
 * Only tracks BTC and ETH, uses REST polling instead of WebSocket.
 *
 * @param options - Optional configuration overrides
 * @returns A new BinancePriceFeed instance with minimal configuration
 *
 * @example
 * ```typescript
 * const testFeed = createMinimalPriceFeed({ debug: true });
 * await testFeed.start();
 * ```
 */
export function createMinimalPriceFeed(
  options?: Partial<Omit<MarketDataConfig, "symbols">>,
): BinancePriceFeed {
  return new BinancePriceFeed({
    symbols: ["BTCUSDT", "ETHUSDT"],
    useWebSocket: false,
    updateInterval: 10000,
    enableRestFallback: true,
    ...options,
  });
}

// ============================================================================
// Singleton Management
// ============================================================================

/** Global singleton instance */
let globalPriceFeed: BinancePriceFeed | null = null;

/** Lock to prevent concurrent initialization */
let initializingGlobal = false;

/**
 * Get or create a global singleton price feed instance
 *
 * Use this for server-wide access to market data without passing
 * the instance around. The singleton is lazily initialized on first call.
 *
 * Thread-safe: handles concurrent first-access correctly.
 *
 * @param config - Configuration (only used on first call to create instance)
 * @returns The global BinancePriceFeed instance
 *
 * @example
 * ```typescript
 * // In initialization code (e.g., server startup)
 * const feed = getGlobalPriceFeed({
 *   symbols: ['BTCUSDT', 'ETHUSDT'],
 *   useWebSocket: true,
 * });
 * await feed.start();
 *
 * // Elsewhere in the application (no config needed)
 * const price = getGlobalPriceFeed().getPrice('BTCUSDT');
 *
 * // In health check endpoint
 * const health = getGlobalPriceFeed().getHealth();
 * ```
 */
export function getGlobalPriceFeed(
  config?: MarketDataConfig,
): BinancePriceFeed {
  if (globalPriceFeed) {
    return globalPriceFeed;
  }

  // Prevent concurrent initialization
  if (initializingGlobal) {
    throw new Error("Global price feed initialization already in progress");
  }

  initializingGlobal = true;

  try {
    if (config) {
      globalPriceFeed = createPriceFeed(config);
    } else {
      globalPriceFeed = createDefaultPriceFeed();
    }

    return globalPriceFeed;
  } finally {
    initializingGlobal = false;
  }
}

/**
 * Check if global price feed has been initialized
 *
 * @returns true if global instance exists
 */
export function hasGlobalPriceFeed(): boolean {
  return globalPriceFeed !== null;
}

/**
 * Reset the global price feed instance
 *
 * Stops the existing instance if running and clears the reference.
 * Useful for testing or reconfiguration.
 *
 * @example
 * ```typescript
 * // In test teardown
 * resetGlobalPriceFeed();
 *
 * // In reconfiguration code
 * resetGlobalPriceFeed();
 * const newFeed = getGlobalPriceFeed({ symbols: ['BTCUSDT'] });
 * await newFeed.start();
 * ```
 */
export function resetGlobalPriceFeed(): void {
  if (globalPriceFeed) {
    try {
      globalPriceFeed.stop();
    } catch {
      // Ignore errors during cleanup
    }
    globalPriceFeed = null;
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Quick helper to get a price from the global feed
 *
 * Returns null if global feed is not initialized or price unavailable.
 *
 * @param symbol - Trading pair symbol
 * @returns Price tick or null
 *
 * @example
 * ```typescript
 * const btc = getGlobalPrice('BTCUSDT');
 * if (btc) {
 *   displayPrice(btc.price);
 * }
 * ```
 */
export function getGlobalPrice(
  symbol: string,
): import("@hyperscape/shared").PriceTick | null {
  if (!globalPriceFeed) {
    return null;
  }
  return globalPriceFeed.getPrice(symbol);
}

/**
 * Quick helper to check global feed health
 *
 * Returns unhealthy status if global feed is not initialized.
 *
 * @returns Health status object
 */
export function getGlobalHealth(): import("@hyperscape/shared").PriceFeedHealth {
  if (!globalPriceFeed) {
    return {
      state: "disconnected",
      isHealthy: false,
      pricesAreFresh: false,
      trackedSymbols: 0,
      freshSymbolCount: 0,
      activeSubscriptions: 0,
      lastUpdateTime: null,
      timeSinceLastUpdate: null,
      reconnectAttempts: 0,
      messagesReceived: 0,
      messagesPerMinute: 0,
      error: "Global price feed not initialized",
      uptime: 0,
      connectionMode: "none",
      memoryCacheSize: 0,
      checkedAt: Date.now(),
    };
  }
  return globalPriceFeed.getHealth();
}
