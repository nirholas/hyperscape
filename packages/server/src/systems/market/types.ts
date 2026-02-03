/**
 * Binance API Types - Server-side types for Binance API responses
 *
 * Comprehensive TypeScript definitions for:
 * - Binance REST API responses
 * - Binance WebSocket message formats
 * - Internal cache and state management structures
 *
 * All types match the official Binance API documentation:
 * https://binance-docs.github.io/apidocs/spot/en/
 *
 * @module market/types
 * @version 1.0.0
 */

import type { PriceTick } from "@hyperscape/shared";

// ============================================================================
// Binance REST API Response Types
// ============================================================================

/**
 * Response from GET /api/v3/ticker/price
 * Simple price endpoint - lowest latency
 */
export interface BinanceTickerPriceResponse {
  readonly symbol: string;
  readonly price: string;
}

/**
 * Response from GET /api/v3/ticker/24hr
 * Full 24-hour rolling window statistics
 */
export interface BinanceTicker24hrResponse {
  /** Trading pair symbol */
  readonly symbol: string;
  /** Price change in quote currency */
  readonly priceChange: string;
  /** Price change as percentage */
  readonly priceChangePercent: string;
  /** Weighted average price */
  readonly weightedAvgPrice: string;
  /** Previous day close price */
  readonly prevClosePrice: string;
  /** Last (current) price */
  readonly lastPrice: string;
  /** Last quantity */
  readonly lastQty: string;
  /** Best bid price */
  readonly bidPrice: string;
  /** Best bid quantity */
  readonly bidQty: string;
  /** Best ask price */
  readonly askPrice: string;
  /** Best ask quantity */
  readonly askQty: string;
  /** Open price */
  readonly openPrice: string;
  /** Highest price in period */
  readonly highPrice: string;
  /** Lowest price in period */
  readonly lowPrice: string;
  /** Total traded base asset volume */
  readonly volume: string;
  /** Total traded quote asset volume */
  readonly quoteVolume: string;
  /** Statistics window open time (Unix ms) */
  readonly openTime: number;
  /** Statistics window close time (Unix ms) */
  readonly closeTime: number;
  /** First trade ID in window */
  readonly firstId: number;
  /** Last trade ID in window */
  readonly lastId: number;
  /** Number of trades in window */
  readonly count: number;
}

/**
 * Response from GET /api/v3/ticker (rolling window)
 * Supports custom window sizes
 */
export interface BinanceRollingTickerResponse {
  readonly symbol: string;
  readonly priceChange: string;
  readonly priceChangePercent: string;
  readonly weightedAvgPrice: string;
  readonly openPrice: string;
  readonly highPrice: string;
  readonly lowPrice: string;
  readonly lastPrice: string;
  readonly volume: string;
  readonly quoteVolume: string;
  readonly openTime: number;
  readonly closeTime: number;
  readonly firstId: number;
  readonly lastId: number;
  readonly count: number;
}

/**
 * Response from GET /api/v3/ticker/bookTicker
 * Best bid/ask prices and quantities
 */
export interface BinanceBookTickerResponse {
  readonly symbol: string;
  readonly bidPrice: string;
  readonly bidQty: string;
  readonly askPrice: string;
  readonly askQty: string;
}

/**
 * Response from GET /api/v3/avgPrice
 * 5-minute average price
 */
export interface BinanceAvgPriceResponse {
  readonly mins: number;
  readonly price: string;
  readonly closeTime: number;
}

/**
 * Response from GET /api/v3/klines
 * Array format for OHLCV candlestick data
 *
 * Index mapping:
 * [0] Open time (ms)
 * [1] Open price (string)
 * [2] High price (string)
 * [3] Low price (string)
 * [4] Close price (string)
 * [5] Volume (string)
 * [6] Close time (ms)
 * [7] Quote asset volume (string)
 * [8] Number of trades
 * [9] Taker buy base asset volume (string)
 * [10] Taker buy quote asset volume (string)
 * [11] Unused/Ignore (string)
 */
export type BinanceKlineResponse = readonly [
  openTime: number,
  open: string,
  high: string,
  low: string,
  close: string,
  volume: string,
  closeTime: number,
  quoteVolume: string,
  trades: number,
  takerBuyBaseVolume: string,
  takerBuyQuoteVolume: string,
  ignore: string,
];

/**
 * Response from GET /api/v3/depth
 * Order book snapshot
 */
export interface BinanceDepthResponse {
  readonly lastUpdateId: number;
  readonly bids: readonly (readonly [price: string, quantity: string])[];
  readonly asks: readonly (readonly [price: string, quantity: string])[];
}

/**
 * Response from GET /api/v3/trades
 * Recent trades list
 */
export interface BinanceTradeResponse {
  readonly id: number;
  readonly price: string;
  readonly qty: string;
  readonly quoteQty: string;
  readonly time: number;
  readonly isBuyerMaker: boolean;
  readonly isBestMatch: boolean;
}

/**
 * Response from GET /api/v3/aggTrades
 * Aggregated trades
 */
export interface BinanceAggTradeResponse {
  /** Aggregate trade ID */
  readonly a: number;
  /** Price */
  readonly p: string;
  /** Quantity */
  readonly q: string;
  /** First trade ID */
  readonly f: number;
  /** Last trade ID */
  readonly l: number;
  /** Timestamp */
  readonly T: number;
  /** Was the buyer the maker? */
  readonly m: boolean;
  /** Was the trade the best price match? */
  readonly M: boolean;
}

/**
 * Response from GET /api/v3/exchangeInfo
 * Exchange trading rules and symbol info
 */
export interface BinanceExchangeInfoResponse {
  readonly timezone: string;
  readonly serverTime: number;
  readonly rateLimits: readonly BinanceRateLimitInfo[];
  readonly exchangeFilters: readonly unknown[];
  readonly symbols: readonly BinanceSymbolInfo[];
}

/**
 * Rate limit information from exchange info
 */
export interface BinanceRateLimitInfo {
  readonly rateLimitType: "REQUEST_WEIGHT" | "ORDERS" | "RAW_REQUESTS";
  readonly interval: "SECOND" | "MINUTE" | "DAY";
  readonly intervalNum: number;
  readonly limit: number;
}

/**
 * Symbol information from exchange info
 */
export interface BinanceSymbolInfo {
  readonly symbol: string;
  readonly status: "TRADING" | "HALT" | "BREAK";
  readonly baseAsset: string;
  readonly baseAssetPrecision: number;
  readonly quoteAsset: string;
  readonly quotePrecision: number;
  readonly quoteAssetPrecision: number;
  readonly orderTypes: readonly string[];
  readonly icebergAllowed: boolean;
  readonly ocoAllowed: boolean;
  readonly isSpotTradingAllowed: boolean;
  readonly isMarginTradingAllowed: boolean;
  readonly filters: readonly BinanceSymbolFilter[];
  readonly permissions: readonly string[];
}

/**
 * Symbol filter (various types)
 */
export type BinanceSymbolFilter =
  | BinancePriceFilter
  | BinanceLotSizeFilter
  | BinanceMinNotionalFilter
  | BinanceOtherFilter;

export interface BinancePriceFilter {
  readonly filterType: "PRICE_FILTER";
  readonly minPrice: string;
  readonly maxPrice: string;
  readonly tickSize: string;
}

export interface BinanceLotSizeFilter {
  readonly filterType: "LOT_SIZE";
  readonly minQty: string;
  readonly maxQty: string;
  readonly stepSize: string;
}

export interface BinanceMinNotionalFilter {
  readonly filterType: "MIN_NOTIONAL" | "NOTIONAL";
  readonly minNotional: string;
  readonly applyToMarket?: boolean;
  readonly avgPriceMins?: number;
}

export interface BinanceOtherFilter {
  readonly filterType: string;
  readonly [key: string]: unknown;
}

/**
 * Binance API error response
 */
export interface BinanceApiError {
  readonly code: number;
  readonly msg: string;
}

// ============================================================================
// Binance WebSocket Types
// ============================================================================

/**
 * WebSocket 24hr Ticker stream message
 * Stream: <symbol>@ticker
 *
 * Full ticker with all statistics
 */
export interface BinanceWsTickerMessage {
  /** Event type: '24hrTicker' */
  readonly e: "24hrTicker";
  /** Event time (Unix ms) */
  readonly E: number;
  /** Symbol */
  readonly s: string;
  /** Price change */
  readonly p: string;
  /** Price change percent */
  readonly P: string;
  /** Weighted average price */
  readonly w: string;
  /** First trade price (before 24hr window) */
  readonly x: string;
  /** Last (current) price */
  readonly c: string;
  /** Last quantity */
  readonly Q: string;
  /** Best bid price */
  readonly b: string;
  /** Best bid quantity */
  readonly B: string;
  /** Best ask price */
  readonly a: string;
  /** Best ask quantity */
  readonly A: string;
  /** Open price */
  readonly o: string;
  /** High price */
  readonly h: string;
  /** Low price */
  readonly l: string;
  /** Base asset volume */
  readonly v: string;
  /** Quote asset volume */
  readonly q: string;
  /** Statistics open time */
  readonly O: number;
  /** Statistics close time */
  readonly C: number;
  /** First trade ID */
  readonly F: number;
  /** Last trade ID */
  readonly L: number;
  /** Number of trades */
  readonly n: number;
}

/**
 * WebSocket Mini Ticker stream message
 * Stream: <symbol>@miniTicker or !miniTicker@arr
 *
 * Lightweight ticker with essential data
 */
export interface BinanceWsMiniTickerMessage {
  /** Event type: '24hrMiniTicker' */
  readonly e: "24hrMiniTicker";
  /** Event time (Unix ms) */
  readonly E: number;
  /** Symbol */
  readonly s: string;
  /** Close (current) price */
  readonly c: string;
  /** Open price */
  readonly o: string;
  /** High price */
  readonly h: string;
  /** Low price */
  readonly l: string;
  /** Base asset volume */
  readonly v: string;
  /** Quote asset volume */
  readonly q: string;
}

/**
 * WebSocket Book Ticker stream message
 * Stream: <symbol>@bookTicker
 *
 * Best bid/ask updates (real-time)
 */
export interface BinanceWsBookTickerMessage {
  /** Update ID */
  readonly u: number;
  /** Symbol */
  readonly s: string;
  /** Best bid price */
  readonly b: string;
  /** Best bid quantity */
  readonly B: string;
  /** Best ask price */
  readonly a: string;
  /** Best ask quantity */
  readonly A: string;
}

/**
 * WebSocket Trade stream message
 * Stream: <symbol>@trade
 *
 * Real-time trade updates
 */
export interface BinanceWsTradeMessage {
  /** Event type: 'trade' */
  readonly e: "trade";
  /** Event time (Unix ms) */
  readonly E: number;
  /** Symbol */
  readonly s: string;
  /** Trade ID */
  readonly t: number;
  /** Price */
  readonly p: string;
  /** Quantity */
  readonly q: string;
  /** Buyer order ID */
  readonly b: number;
  /** Seller order ID */
  readonly a: number;
  /** Trade time (Unix ms) */
  readonly T: number;
  /** Is buyer the market maker? */
  readonly m: boolean;
  /** Ignore */
  readonly M: boolean;
}

/**
 * WebSocket Aggregate Trade stream message
 * Stream: <symbol>@aggTrade
 *
 * Aggregated trade updates
 */
export interface BinanceWsAggTradeMessage {
  /** Event type: 'aggTrade' */
  readonly e: "aggTrade";
  /** Event time (Unix ms) */
  readonly E: number;
  /** Symbol */
  readonly s: string;
  /** Aggregate trade ID */
  readonly a: number;
  /** Price */
  readonly p: string;
  /** Quantity */
  readonly q: string;
  /** First trade ID */
  readonly f: number;
  /** Last trade ID */
  readonly l: number;
  /** Trade time (Unix ms) */
  readonly T: number;
  /** Is buyer the market maker? */
  readonly m: boolean;
  /** Ignore */
  readonly M: boolean;
}

/**
 * WebSocket Kline/Candlestick stream message
 * Stream: <symbol>@kline_<interval>
 *
 * Real-time candlestick updates
 */
export interface BinanceWsKlineMessage {
  /** Event type: 'kline' */
  readonly e: "kline";
  /** Event time (Unix ms) */
  readonly E: number;
  /** Symbol */
  readonly s: string;
  /** Kline data */
  readonly k: BinanceWsKlineData;
}

/**
 * Kline data within WebSocket message
 */
export interface BinanceWsKlineData {
  /** Kline start time */
  readonly t: number;
  /** Kline close time */
  readonly T: number;
  /** Symbol */
  readonly s: string;
  /** Interval */
  readonly i: string;
  /** First trade ID */
  readonly f: number;
  /** Last trade ID */
  readonly L: number;
  /** Open price */
  readonly o: string;
  /** Close price */
  readonly c: string;
  /** High price */
  readonly h: string;
  /** Low price */
  readonly l: string;
  /** Base asset volume */
  readonly v: string;
  /** Number of trades */
  readonly n: number;
  /** Is this kline closed? */
  readonly x: boolean;
  /** Quote asset volume */
  readonly q: string;
  /** Taker buy base asset volume */
  readonly V: string;
  /** Taker buy quote asset volume */
  readonly Q: string;
  /** Ignore */
  readonly B: string;
}

/**
 * WebSocket Depth stream message
 * Stream: <symbol>@depth<levels> or <symbol>@depth
 *
 * Order book updates
 */
export interface BinanceWsDepthMessage {
  /** Event type: 'depthUpdate' */
  readonly e: "depthUpdate";
  /** Event time (Unix ms) */
  readonly E: number;
  /** Symbol */
  readonly s: string;
  /** First update ID in event */
  readonly U: number;
  /** Final update ID in event */
  readonly u: number;
  /** Bids to update */
  readonly b: readonly (readonly [price: string, quantity: string])[];
  /** Asks to update */
  readonly a: readonly (readonly [price: string, quantity: string])[];
}

/**
 * Combined/Multiplexed stream wrapper
 * Used when connecting to multiple streams via single connection
 */
export interface BinanceWsCombinedStreamMessage<T = BinanceWsTickerMessage> {
  /** Stream name (e.g., 'btcusdt@ticker') */
  readonly stream: string;
  /** Stream data */
  readonly data: T;
}

/**
 * Union of all WebSocket message types
 */
export type BinanceWsMessage =
  | BinanceWsTickerMessage
  | BinanceWsMiniTickerMessage
  | BinanceWsBookTickerMessage
  | BinanceWsTradeMessage
  | BinanceWsAggTradeMessage
  | BinanceWsKlineMessage
  | BinanceWsDepthMessage;

/**
 * WebSocket subscription request
 */
export interface BinanceWsSubscribeRequest {
  readonly method: "SUBSCRIBE" | "UNSUBSCRIBE";
  readonly params: readonly string[];
  readonly id: number;
}

/**
 * WebSocket subscription response
 */
export interface BinanceWsSubscribeResponse {
  readonly result: null;
  readonly id: number;
}

// ============================================================================
// Internal Cache Types
// ============================================================================

/**
 * Cached price entry with full metadata
 *
 * Extends PriceTick with internal tracking fields
 */
export interface CachedPriceTick {
  // Core price data (matches PriceTick)
  readonly symbol: string;
  readonly price: number;
  readonly timestamp: number;
  readonly volume24h: number;
  readonly change24h: number;
  readonly high24h: number;
  readonly low24h: number;
  readonly bidPrice: number;
  readonly askPrice: number;
  readonly spreadPercent: number;
  readonly vwap: number;
  readonly tradeCount: number;
  readonly quoteVolume: number;

  // Internal tracking
  /** Local timestamp when cache was updated */
  readonly localUpdateTime: number;
  /** Number of updates received for this symbol */
  readonly updateCount: number;
  /** Source of this update (ws or rest) */
  readonly source: "websocket" | "rest";
  /** Latency from exchange to cache (ms) */
  readonly latencyMs: number;
}

/**
 * Price cache map type
 */
export type PriceCache = Map<string, CachedPriceTick>;

/**
 * Subscription entry in the registry
 */
export interface SubscriptionEntry {
  /** Unique subscription ID */
  readonly id: string;
  /** Symbols this subscription is tracking */
  readonly symbols: Set<string>;
  /** Callback function for updates */
  readonly callback: (tick: PriceTick) => void;
  /** Minimum interval between callbacks (ms) */
  readonly minInterval: number;
  /** Last callback time per symbol */
  readonly lastCallTime: Map<string, number>;
  /** Error callback */
  readonly onError?: (error: Error, context?: string) => void;
  /** Optional label for debugging */
  readonly label?: string;
  /** Whether to emit cached prices on subscribe */
  readonly emitCached: boolean;
  /** Creation timestamp */
  readonly createdAt: number;
  /** Total callbacks made */
  callbackCount: number;
  /** Errors encountered */
  errorCount: number;
}

/**
 * Subscription registry type
 */
export type SubscriptionRegistry = Map<string, SubscriptionEntry>;

// ============================================================================
// WebSocket Connection State
// ============================================================================

/**
 * Internal WebSocket connection state tracking
 */
export interface WebSocketState {
  /** The WebSocket instance (null if disconnected) */
  ws: WebSocket | null;

  /** Current connection state */
  state:
    | "disconnected"
    | "connecting"
    | "connected"
    | "reconnecting"
    | "degraded"
    | "error";

  /** Number of reconnection attempts since last successful connection */
  reconnectAttempts: number;

  /** Timestamp when connection was established (null if not connected) */
  connectedAt: number | null;

  /** Timestamp of last received message */
  lastMessageAt: number | null;

  /** Streams pending subscription after connection */
  pendingStreams: string[];

  /** Currently active streams */
  activeStreams: Set<string>;

  /** Ping interval handle */
  pingInterval: ReturnType<typeof setInterval> | null;

  /** Reconnect timeout handle */
  reconnectTimeout: ReturnType<typeof setTimeout> | null;

  /** Last ping sent timestamp */
  lastPingAt: number | null;

  /** Last pong received timestamp */
  lastPongAt: number | null;

  /** Connection URL */
  url: string | null;

  /** Message sequence number */
  messageSequence: number;

  /** Total messages received */
  messagesReceived: number;

  /** Total bytes received */
  bytesReceived: number;

  /** Connection error if any */
  lastError: Error | null;
}

/**
 * Default WebSocket state factory
 */
export function createDefaultWebSocketState(): WebSocketState {
  return {
    ws: null,
    state: "disconnected",
    reconnectAttempts: 0,
    connectedAt: null,
    lastMessageAt: null,
    pendingStreams: [],
    activeStreams: new Set(),
    pingInterval: null,
    reconnectTimeout: null,
    lastPingAt: null,
    lastPongAt: null,
    url: null,
    messageSequence: 0,
    messagesReceived: 0,
    bytesReceived: 0,
    lastError: null,
  };
}

// ============================================================================
// Binance API Configuration Constants
// ============================================================================

/**
 * Binance API endpoints
 */
export const BINANCE_ENDPOINTS = {
  // Production WebSocket endpoints
  WS_BASE: "wss://stream.binance.com:9443",
  WS_COMBINED: "wss://stream.binance.com:9443/stream",
  WS_RAW: "wss://stream.binance.com:9443/ws",

  // Production REST API
  REST_BASE: "https://api.binance.com",

  // Testnet endpoints
  WS_TESTNET: "wss://testnet.binance.vision/ws",
  WS_TESTNET_COMBINED: "wss://testnet.binance.vision/stream",
  REST_TESTNET: "https://testnet.binance.vision",

  // Alternative endpoints (for redundancy)
  WS_BACKUP_1: "wss://stream.binance.com:443/ws",
  REST_BACKUP_1: "https://api1.binance.com",
  REST_BACKUP_2: "https://api2.binance.com",
  REST_BACKUP_3: "https://api3.binance.com",
} as const;

/**
 * Binance API rate limits and constraints
 */
export const BINANCE_LIMITS = {
  /** Maximum streams per WebSocket connection */
  MAX_STREAMS_PER_CONNECTION: 1024,

  /** Maximum WebSocket connections per IP */
  MAX_WS_CONNECTIONS: 5,

  /** WebSocket message rate limit (messages per second) */
  WS_MESSAGE_RATE_LIMIT: 5,

  /** REST API weight limit per minute (IP-based) */
  REST_WEIGHT_LIMIT_PER_MINUTE: 1200,

  /** REST API order limit per second */
  REST_ORDER_LIMIT_PER_SECOND: 10,

  /** REST API order limit per day */
  REST_ORDER_LIMIT_PER_DAY: 200000,

  /** Maximum klines per request */
  MAX_KLINES_PER_REQUEST: 1000,

  /** Maximum trades per request */
  MAX_TRADES_PER_REQUEST: 1000,

  /** Maximum depth levels */
  MAX_DEPTH_LIMIT: 5000,

  /** WebSocket ping interval (must ping within 3 minutes) */
  WS_PING_INTERVAL_MS: 180000,

  /** WebSocket connection timeout */
  WS_CONNECTION_TIMEOUT_MS: 10000,

  /** WebSocket pong timeout (consider dead if no pong within this) */
  WS_PONG_TIMEOUT_MS: 10000,

  /** Maximum reconnection attempts before fallback */
  MAX_RECONNECT_ATTEMPTS: 10,

  /** Maximum time to wait for response */
  REQUEST_TIMEOUT_MS: 30000,
} as const;

/**
 * Common Binance error codes
 */
export const BINANCE_ERROR_CODES = {
  UNKNOWN: -1000,
  DISCONNECTED: -1001,
  UNAUTHORIZED: -1002,
  TOO_MANY_REQUESTS: -1003,
  UNEXPECTED_RESPONSE: -1006,
  TIMEOUT: -1007,
  INVALID_MESSAGE: -1013,
  UNKNOWN_ORDER_COMPOSITION: -1014,
  TOO_MANY_ORDERS: -1015,
  SERVICE_SHUTTING_DOWN: -1016,
  UNSUPPORTED_OPERATION: -1020,
  INVALID_TIMESTAMP: -1021,
  INVALID_SIGNATURE: -1022,
  ILLEGAL_CHARS: -1100,
  TOO_MANY_PARAMETERS: -1101,
  MANDATORY_PARAM_EMPTY: -1102,
  UNKNOWN_PARAM: -1103,
  PARAM_EMPTY: -1105,
  PARAM_NOT_REQUIRED: -1106,
  BAD_PRECISION: -1111,
  NO_DEPTH: -1112,
  INVALID_LISTEN_KEY: -1125,
} as const;

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Check if message is a 24hr ticker message
 */
export function isTickerMessage(msg: unknown): msg is BinanceWsTickerMessage {
  return (
    typeof msg === "object" &&
    msg !== null &&
    "e" in msg &&
    (msg as BinanceWsTickerMessage).e === "24hrTicker"
  );
}

/**
 * Check if message is a mini ticker message
 */
export function isMiniTickerMessage(
  msg: unknown,
): msg is BinanceWsMiniTickerMessage {
  return (
    typeof msg === "object" &&
    msg !== null &&
    "e" in msg &&
    (msg as BinanceWsMiniTickerMessage).e === "24hrMiniTicker"
  );
}

/**
 * Check if message is a book ticker message
 */
export function isBookTickerMessage(
  msg: unknown,
): msg is BinanceWsBookTickerMessage {
  return (
    typeof msg === "object" &&
    msg !== null &&
    "u" in msg &&
    "s" in msg &&
    "b" in msg &&
    "a" in msg &&
    !("e" in msg)
  );
}

/**
 * Check if message is a trade message
 */
export function isTradeMessage(msg: unknown): msg is BinanceWsTradeMessage {
  return (
    typeof msg === "object" &&
    msg !== null &&
    "e" in msg &&
    (msg as BinanceWsTradeMessage).e === "trade"
  );
}

/**
 * Check if message is an aggregate trade message
 */
export function isAggTradeMessage(
  msg: unknown,
): msg is BinanceWsAggTradeMessage {
  return (
    typeof msg === "object" &&
    msg !== null &&
    "e" in msg &&
    (msg as BinanceWsAggTradeMessage).e === "aggTrade"
  );
}

/**
 * Check if message is a kline message
 */
export function isKlineMessage(msg: unknown): msg is BinanceWsKlineMessage {
  return (
    typeof msg === "object" &&
    msg !== null &&
    "e" in msg &&
    (msg as BinanceWsKlineMessage).e === "kline"
  );
}

/**
 * Check if message is a depth update message
 */
export function isDepthMessage(msg: unknown): msg is BinanceWsDepthMessage {
  return (
    typeof msg === "object" &&
    msg !== null &&
    "e" in msg &&
    (msg as BinanceWsDepthMessage).e === "depthUpdate"
  );
}

/**
 * Check if message is a combined stream message
 */
export function isCombinedStreamMessage(
  msg: unknown,
): msg is BinanceWsCombinedStreamMessage {
  return (
    typeof msg === "object" && msg !== null && "stream" in msg && "data" in msg
  );
}

/**
 * Check if response is a Binance API error
 */
export function isBinanceError(response: unknown): response is BinanceApiError {
  return (
    typeof response === "object" &&
    response !== null &&
    "code" in response &&
    "msg" in response &&
    typeof (response as BinanceApiError).code === "number"
  );
}

// ============================================================================
// Parsing Utilities
// ============================================================================

/**
 * Parse Binance WebSocket ticker to CachedPriceTick
 */
export function parseTickerMessage(
  msg: BinanceWsTickerMessage,
  source: "websocket" | "rest" = "websocket",
): CachedPriceTick {
  const now = Date.now();
  const price = parseFloat(msg.c);
  const bidPrice = parseFloat(msg.b);
  const askPrice = parseFloat(msg.a);
  const midPrice = (bidPrice + askPrice) / 2;

  return {
    symbol: msg.s,
    price,
    timestamp: msg.E,
    volume24h: parseFloat(msg.v),
    change24h: parseFloat(msg.P),
    high24h: parseFloat(msg.h),
    low24h: parseFloat(msg.l),
    bidPrice,
    askPrice,
    spreadPercent: midPrice > 0 ? ((askPrice - bidPrice) / midPrice) * 100 : 0,
    vwap: parseFloat(msg.w),
    tradeCount: msg.n,
    quoteVolume: parseFloat(msg.q),
    localUpdateTime: now,
    updateCount: 1,
    source,
    latencyMs: now - msg.E,
  };
}

/**
 * Parse REST 24hr ticker to CachedPriceTick
 */
export function parseRestTicker(
  ticker: BinanceTicker24hrResponse,
  source: "rest" = "rest",
): CachedPriceTick {
  const now = Date.now();
  const price = parseFloat(ticker.lastPrice);
  const bidPrice = parseFloat(ticker.bidPrice);
  const askPrice = parseFloat(ticker.askPrice);
  const midPrice = (bidPrice + askPrice) / 2;

  return {
    symbol: ticker.symbol,
    price,
    timestamp: ticker.closeTime,
    volume24h: parseFloat(ticker.volume),
    change24h: parseFloat(ticker.priceChangePercent),
    high24h: parseFloat(ticker.highPrice),
    low24h: parseFloat(ticker.lowPrice),
    bidPrice,
    askPrice,
    spreadPercent: midPrice > 0 ? ((askPrice - bidPrice) / midPrice) * 100 : 0,
    vwap: parseFloat(ticker.weightedAvgPrice),
    tradeCount: ticker.count,
    quoteVolume: parseFloat(ticker.quoteVolume),
    localUpdateTime: now,
    updateCount: 1,
    source,
    latencyMs: now - ticker.closeTime,
  };
}

/**
 * Convert CachedPriceTick to PriceTick for external use
 */
export function cachedToPriceTick(cached: CachedPriceTick): PriceTick {
  return {
    symbol: cached.symbol,
    price: cached.price,
    timestamp: cached.timestamp,
    volume24h: cached.volume24h,
    change24h: cached.change24h,
    high24h: cached.high24h,
    low24h: cached.low24h,
    bidPrice: cached.bidPrice,
    askPrice: cached.askPrice,
    spreadPercent: cached.spreadPercent,
    vwap: cached.vwap,
    tradeCount: cached.tradeCount,
    quoteVolume: cached.quoteVolume,
  };
}
