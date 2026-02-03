/**
 * Market Data Types - Shared types for real-time crypto price feeds
 *
 * Enterprise-grade type definitions for cryptocurrency market data integration.
 * Used across server and client for in-game tokenized economy features.
 *
 * Features:
 * - Comprehensive price tick data with bid/ask spreads
 * - OHLCV candlestick data for historical analysis
 * - Flexible subscription system with throttling
 * - Health monitoring and diagnostics
 * - Event-driven architecture support
 *
 * @module market
 * @version 1.0.0
 */

// ============================================================================
// Supported Trading Pairs
// ============================================================================

/**
 * Supported cryptocurrency trading pairs for in-game economy
 *
 * These pairs are curated for:
 * - High liquidity (tight spreads, minimal slippage)
 * - Market cap stability
 * - Binance availability
 * - Gaming/metaverse relevance
 */
export const SUPPORTED_PAIRS = [
  // Tier 1: Major pairs - highest liquidity
  "BTCUSDT",
  "ETHUSDT",
  "BNBUSDT",

  // Tier 2: Large cap alts
  "SOLUSDT",
  "XRPUSDT",
  "ADAUSDT",
  "AVAXUSDT",

  // Tier 3: Gaming/Metaverse relevant
  "MATICUSDT", // Polygon - gaming L2
  "LINKUSDT", // Chainlink - oracles
  "DOGEUSDT", // Meme economy

  // Tier 4: Emerging gaming tokens
  "MANAUSDT", // Decentraland
  "SANDUSDT", // The Sandbox
  "AXSUSDT", // Axie Infinity
  "ENJUSDT", // Enjin
  "GALAUSDT", // Gala Games
  "IMXUSDT", // Immutable X
] as const;

export type SupportedPair = (typeof SUPPORTED_PAIRS)[number];

/**
 * Type guard to check if a symbol is a supported trading pair
 * @param symbol - Symbol to validate
 * @returns True if symbol is in SUPPORTED_PAIRS
 */
export function isSupportedPair(symbol: string): symbol is SupportedPair {
  return SUPPORTED_PAIRS.includes(symbol.toUpperCase() as SupportedPair);
}

/**
 * Normalize a trading pair symbol to standard format
 * @param symbol - Raw symbol input
 * @returns Normalized uppercase symbol
 */
export function normalizeSymbol(symbol: string): string {
  return symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Extract base and quote currencies from a pair
 * @param pair - Trading pair (e.g., 'BTCUSDT')
 * @returns Object with base and quote currencies
 */
export function parseTradingPair(pair: string): {
  base: string;
  quote: string;
} {
  const normalized = normalizeSymbol(pair);
  // Common quote currencies in order of precedence
  const quotes = ["USDT", "USDC", "BUSD", "USD", "BTC", "ETH", "BNB"];

  for (const quote of quotes) {
    if (normalized.endsWith(quote)) {
      return {
        base: normalized.slice(0, -quote.length),
        quote,
      };
    }
  }

  // Fallback: assume last 4 chars are quote
  return {
    base: normalized.slice(0, -4),
    quote: normalized.slice(-4),
  };
}

// ============================================================================
// Price Data Types
// ============================================================================

/**
 * Real-time price tick with full market data
 *
 * Represents a single price update from the exchange with all relevant
 * market metrics for informed decision-making.
 */
export interface PriceTick {
  /** Trading pair symbol (e.g., 'BTCUSDT') */
  readonly symbol: string;

  /** Current/last traded price in quote currency */
  readonly price: number;

  /** Exchange timestamp when this price was recorded (Unix ms) */
  readonly timestamp: number;

  /** 24-hour trading volume in base currency */
  readonly volume24h: number;

  /** 24-hour price change as percentage (e.g., 2.5 = +2.5%) */
  readonly change24h: number;

  /** Highest price in the last 24 hours */
  readonly high24h: number;

  /** Lowest price in the last 24 hours */
  readonly low24h: number;

  /** Best bid (buy) price - highest price buyers willing to pay */
  readonly bidPrice: number;

  /** Best ask (sell) price - lowest price sellers willing to accept */
  readonly askPrice: number;

  /** Bid-ask spread as percentage of mid price */
  readonly spreadPercent: number;

  /** Volume-weighted average price over 24h */
  readonly vwap: number;

  /** Number of trades in 24h period */
  readonly tradeCount: number;

  /** Quote asset volume (volume * price) */
  readonly quoteVolume: number;
}

/**
 * Lightweight price tick for high-frequency updates
 * Use when full PriceTick data is not needed
 */
export interface MiniPriceTick {
  readonly symbol: string;
  readonly price: number;
  readonly timestamp: number;
  readonly change24h: number;
}

/**
 * Historical OHLCV candlestick data
 *
 * Standard candlestick format for charting and technical analysis.
 * Each candle represents price action over a specific time interval.
 */
export interface PriceCandle {
  /** Candle open time (Unix ms) */
  readonly openTime: number;

  /** Opening price at start of period */
  readonly open: number;

  /** Highest price during the period */
  readonly high: number;

  /** Lowest price during the period */
  readonly low: number;

  /** Closing price at end of period */
  readonly close: number;

  /** Trading volume in base currency */
  readonly volume: number;

  /** Candle close time (Unix ms) */
  readonly closeTime: number;

  /** Quote asset volume (sum of price * quantity for all trades) */
  readonly quoteVolume: number;

  /** Total number of trades during the period */
  readonly trades: number;

  /** Taker buy volume (aggressive buyers) */
  readonly takerBuyVolume: number;

  /** Taker buy quote volume */
  readonly takerBuyQuoteVolume: number;

  /** Whether this candle is complete (closed) */
  readonly isClosed: boolean;
}

/**
 * Aggregated trade data
 */
export interface AggregateTrade {
  readonly aggregateTradeId: number;
  readonly price: number;
  readonly quantity: number;
  readonly firstTradeId: number;
  readonly lastTradeId: number;
  readonly timestamp: number;
  readonly isBuyerMaker: boolean;
}

/**
 * Order book depth level
 */
export interface OrderBookLevel {
  readonly price: number;
  readonly quantity: number;
}

/**
 * Order book snapshot
 */
export interface OrderBook {
  readonly symbol: string;
  readonly lastUpdateId: number;
  readonly bids: readonly OrderBookLevel[];
  readonly asks: readonly OrderBookLevel[];
  readonly timestamp: number;
}

// ============================================================================
// Subscription Types
// ============================================================================

/**
 * Callback function signature for price updates
 */
export type PriceUpdateCallback = (tick: PriceTick) => void;

/**
 * Callback function signature for mini price updates
 */
export type MiniPriceUpdateCallback = (tick: MiniPriceTick) => void;

/**
 * Callback function signature for candle updates
 */
export type CandleUpdateCallback = (candle: PriceCandle) => void;

/**
 * Callback function signature for errors
 */
export type ErrorCallback = (error: Error, context?: string) => void;

/**
 * Price subscription configuration
 *
 * Defines what symbols to track and how to handle updates.
 * Supports throttling to prevent callback flooding.
 */
export interface PriceSubscription {
  /** Symbols to subscribe to (will be normalized to uppercase) */
  readonly symbols: readonly string[];

  /** Callback invoked on each price update */
  readonly callback: PriceUpdateCallback;

  /**
   * Minimum interval between callbacks per symbol (ms)
   * Use to throttle high-frequency updates
   * @default 0 (no throttling)
   */
  readonly minInterval?: number;

  /**
   * Optional error callback for subscription-specific errors
   */
  readonly onError?: ErrorCallback;

  /**
   * Whether to receive initial cached price on subscribe
   * @default true
   */
  readonly emitCached?: boolean;

  /**
   * Custom identifier for this subscription (for debugging)
   */
  readonly label?: string;
}

/**
 * Candle/Kline subscription configuration
 */
export interface CandleSubscription {
  readonly symbol: string;
  readonly interval: KlineInterval;
  readonly callback: CandleUpdateCallback;
  readonly onError?: ErrorCallback;
}

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Market data service configuration
 *
 * All settings for initializing the price feed service.
 * Sensible defaults are provided for most options.
 */
export interface MarketDataConfig {
  /**
   * Binance API key (optional for public endpoints)
   * Required for higher rate limits and private endpoints
   */
  readonly apiKey?: string;

  /**
   * Binance API secret (optional for public endpoints)
   * Required for authenticated requests
   */
  readonly apiSecret?: string;

  /**
   * Trading pairs to track
   * Can be expanded at runtime via addSymbol()
   */
  readonly symbols: readonly string[];

  /**
   * Update interval for REST polling fallback (ms)
   * Used when WebSocket is unavailable or as backup
   * @default 5000
   */
  readonly updateInterval?: number;

  /**
   * Whether to use WebSocket for real-time updates
   * Falls back to REST polling if false or on WS failure
   * @default true
   */
  readonly useWebSocket?: boolean;

  /**
   * Use Binance testnet instead of production
   * Useful for development/testing
   * @default false
   */
  readonly useTestnet?: boolean;

  /**
   * Maximum WebSocket reconnection attempts before fallback
   * @default 10
   */
  readonly maxReconnectAttempts?: number;

  /**
   * Base delay between reconnection attempts (ms)
   * Actual delay uses exponential backoff
   * @default 1000
   */
  readonly reconnectDelay?: number;

  /**
   * Enable debug logging to console
   * @default false
   */
  readonly debug?: boolean;

  /**
   * Stale price threshold (ms)
   * Prices older than this are considered stale
   * @default 60000
   */
  readonly stalePriceThreshold?: number;

  /**
   * Enable automatic REST fallback on WS issues
   * @default true
   */
  readonly enableRestFallback?: boolean;

  /**
   * Custom logger function
   * @default console.log
   */
  readonly logger?: (
    message: string,
    context?: Record<string, unknown>,
  ) => void;
}

/**
 * Default market data configuration values
 */
export const DEFAULT_MARKET_CONFIG = {
  symbols: ["BTCUSDT", "ETHUSDT", "SOLUSDT"] as readonly string[],
  updateInterval: 5000,
  useWebSocket: true,
  useTestnet: false,
  maxReconnectAttempts: 10,
  reconnectDelay: 1000,
  debug: false,
  stalePriceThreshold: 60000,
  enableRestFallback: true,
} as const satisfies Omit<
  Required<MarketDataConfig>,
  "apiKey" | "apiSecret" | "logger"
>;

/**
 * Resolved configuration with all defaults applied
 */
export type ResolvedMarketConfig = Required<
  Omit<MarketDataConfig, "apiKey" | "apiSecret" | "logger">
> & {
  readonly apiKey?: string;
  readonly apiSecret?: string;
  readonly logger: (message: string, context?: Record<string, unknown>) => void;
};

// ============================================================================
// Service Status Types
// ============================================================================

/**
 * Connection state for the price feed service
 */
export type PriceFeedConnectionState =
  | "disconnected" // Not connected, not attempting
  | "connecting" // Initial connection in progress
  | "connected" // WebSocket connected and receiving data
  | "reconnecting" // Lost connection, attempting to reconnect
  | "degraded" // Connected but experiencing issues
  | "error"; // Fatal error, manual intervention required

/**
 * Comprehensive health check result
 *
 * Use for monitoring, alerting, and diagnostics.
 */
export interface PriceFeedHealth {
  /** Current connection state */
  readonly state: PriceFeedConnectionState;

  /** Whether the service is operational (can serve prices) */
  readonly isHealthy: boolean;

  /** Whether prices are fresh (within stale threshold) */
  readonly pricesAreFresh: boolean;

  /** Number of symbols being tracked */
  readonly trackedSymbols: number;

  /** Number of symbols with fresh prices */
  readonly freshSymbolCount: number;

  /** Number of active subscriptions */
  readonly activeSubscriptions: number;

  /** Last successful price update timestamp (Unix ms) */
  readonly lastUpdateTime: number | null;

  /** Milliseconds since last update */
  readonly timeSinceLastUpdate: number | null;

  /** Current reconnection attempt number (0 if connected) */
  readonly reconnectAttempts: number;

  /** Total messages received since start */
  readonly messagesReceived: number;

  /** Messages received in last minute */
  readonly messagesPerMinute: number;

  /** Any current error message */
  readonly error?: string;

  /** Service uptime in milliseconds */
  readonly uptime: number;

  /** Whether using WebSocket or REST fallback */
  readonly connectionMode: "websocket" | "rest" | "none";

  /** Memory usage estimate (bytes) */
  readonly memoryCacheSize: number;

  /** Timestamp of this health check */
  readonly checkedAt: number;
}

/**
 * Detailed metrics for monitoring
 */
export interface PriceFeedMetrics {
  readonly messagesTotal: number;
  readonly messagesPerSecond: number;
  readonly reconnectsTotal: number;
  readonly errorsTotal: number;
  readonly lastErrorTime: number | null;
  readonly lastErrorMessage: string | null;
  readonly avgLatencyMs: number;
  readonly maxLatencyMs: number;
  readonly cacheHitRate: number;
  readonly subscriptionCallbacksTotal: number;
  readonly subscriptionCallbackErrors: number;
}

// ============================================================================
// Event Types
// ============================================================================

/**
 * Events emitted by the price feed service
 */
export type PriceFeedEventType =
  | "price_update"
  | "candle_update"
  | "connection_state_change"
  | "error"
  | "reconnecting"
  | "reconnected"
  | "subscribed"
  | "unsubscribed"
  | "health_degraded"
  | "health_restored";

/**
 * Base event interface
 */
interface BasePriceFeedEvent {
  readonly type: PriceFeedEventType;
  readonly timestamp: number;
}

/**
 * Price update event payload
 */
export interface PriceUpdateEvent extends BasePriceFeedEvent {
  readonly type: "price_update";
  readonly tick: PriceTick;
  readonly latencyMs: number;
}

/**
 * Candle update event payload
 */
export interface CandleUpdateEvent extends BasePriceFeedEvent {
  readonly type: "candle_update";
  readonly candle: PriceCandle;
  readonly symbol: string;
  readonly interval: KlineInterval;
}

/**
 * Connection state change event payload
 */
export interface ConnectionStateChangeEvent extends BasePriceFeedEvent {
  readonly type: "connection_state_change";
  readonly previousState: PriceFeedConnectionState;
  readonly currentState: PriceFeedConnectionState;
  readonly reason?: string;
}

/**
 * Error event payload
 */
export interface PriceFeedErrorEvent extends BasePriceFeedEvent {
  readonly type: "error";
  readonly error: Error;
  readonly recoverable: boolean;
  readonly context?: string;
  readonly code?: string;
}

/**
 * Reconnecting event payload
 */
export interface ReconnectingEvent extends BasePriceFeedEvent {
  readonly type: "reconnecting";
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly nextRetryMs: number;
}

/**
 * Union type for all price feed events
 */
export type PriceFeedEvent =
  | PriceUpdateEvent
  | CandleUpdateEvent
  | ConnectionStateChangeEvent
  | PriceFeedErrorEvent
  | ReconnectingEvent;

/**
 * Event listener callback type
 */
export type PriceFeedEventListener<T extends PriceFeedEvent = PriceFeedEvent> =
  (event: T) => void;

// ============================================================================
// Kline/Candlestick Intervals
// ============================================================================

/**
 * Supported candlestick intervals
 * Matches Binance API supported intervals
 */
export const KLINE_INTERVALS = [
  "1s", // 1 second (recent addition)
  "1m", // 1 minute
  "3m", // 3 minutes
  "5m", // 5 minutes
  "15m", // 15 minutes
  "30m", // 30 minutes
  "1h", // 1 hour
  "2h", // 2 hours
  "4h", // 4 hours
  "6h", // 6 hours
  "8h", // 8 hours
  "12h", // 12 hours
  "1d", // 1 day
  "3d", // 3 days
  "1w", // 1 week
  "1M", // 1 month
] as const;

export type KlineInterval = (typeof KLINE_INTERVALS)[number];

/**
 * Type guard to validate kline interval
 * @param interval - String to validate
 * @returns True if valid interval
 */
export function isValidKlineInterval(
  interval: string,
): interval is KlineInterval {
  return KLINE_INTERVALS.includes(interval as KlineInterval);
}

/**
 * Convert interval to milliseconds
 * @param interval - Kline interval
 * @returns Duration in milliseconds
 */
export function intervalToMs(interval: KlineInterval): number {
  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
    M: 30 * 24 * 60 * 60 * 1000, // Approximate
  };

  const match = interval.match(/^(\d+)([smhdwM])$/);
  if (!match) {
    throw new Error(`Invalid interval format: ${interval}`);
  }

  const [, value, unit] = match;
  return parseInt(value, 10) * multipliers[unit];
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Base error class for market data errors
 */
export class MarketDataError extends Error {
  readonly code: string;
  readonly recoverable: boolean;
  readonly timestamp: number;

  constructor(message: string, code: string, recoverable: boolean = true) {
    super(message);
    this.name = "MarketDataError";
    this.code = code;
    this.recoverable = recoverable;
    this.timestamp = Date.now();
  }
}

/**
 * Error codes for market data operations
 */
export const MarketDataErrorCode = {
  CONNECTION_FAILED: "CONNECTION_FAILED",
  CONNECTION_LOST: "CONNECTION_LOST",
  INVALID_SYMBOL: "INVALID_SYMBOL",
  RATE_LIMITED: "RATE_LIMITED",
  API_ERROR: "API_ERROR",
  PARSE_ERROR: "PARSE_ERROR",
  TIMEOUT: "TIMEOUT",
  SUBSCRIPTION_FAILED: "SUBSCRIPTION_FAILED",
  STALE_DATA: "STALE_DATA",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type MarketDataErrorCode =
  (typeof MarketDataErrorCode)[keyof typeof MarketDataErrorCode];

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Price with symbol for batch operations
 */
export interface SymbolPrice {
  readonly symbol: string;
  readonly price: number;
}

/**
 * Price change summary
 */
export interface PriceChange {
  readonly symbol: string;
  readonly priceChange: number;
  readonly priceChangePercent: number;
  readonly prevClosePrice: number;
  readonly currentPrice: number;
}

/**
 * Symbol statistics summary
 */
export interface SymbolStats {
  readonly symbol: string;
  readonly openPrice: number;
  readonly highPrice: number;
  readonly lowPrice: number;
  readonly lastPrice: number;
  readonly volume: number;
  readonly quoteVolume: number;
  readonly openTime: number;
  readonly closeTime: number;
  readonly tradeCount: number;
}

/**
 * Convert price in USD to in-game currency
 * @param usdPrice - Price in USD
 * @param conversionRate - In-game currency per USD
 * @returns Price in in-game currency
 */
export function convertToGameCurrency(
  usdPrice: number,
  conversionRate: number,
): number {
  return Math.round(usdPrice * conversionRate * 100) / 100;
}

/**
 * Format price for display
 * @param price - Numeric price
 * @param decimals - Decimal places to show
 * @returns Formatted price string
 */
export function formatPrice(price: number, decimals: number = 2): string {
  if (price >= 1000) {
    return price.toLocaleString("en-US", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }
  if (price >= 1) {
    return price.toFixed(decimals);
  }
  // For small prices, show more decimals
  const sigFigs = Math.max(decimals, 4);
  return price.toPrecision(sigFigs);
}

/**
 * Calculate percentage change between two prices
 * @param oldPrice - Previous price
 * @param newPrice - Current price
 * @returns Percentage change (e.g., 5.25 for +5.25%)
 */
export function calculatePriceChange(
  oldPrice: number,
  newPrice: number,
): number {
  if (oldPrice === 0) return 0;
  return ((newPrice - oldPrice) / oldPrice) * 100;
}
