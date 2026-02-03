/**
 * BinancePriceFeed - Enterprise-grade Real-time Cryptocurrency Price Feed Service
 *
 * Production-ready service providing real-time price data from Binance
 * for in-game tokenized economy features.
 *
 * Features:
 * - Real-time WebSocket price streaming with automatic reconnection
 * - Exponential backoff reconnection with jitter
 * - REST API fallback when WebSocket unavailable
 * - In-memory price cache with staleness detection
 * - Multiple concurrent subscriptions with throttling
 * - Historical OHLCV data retrieval
 * - Comprehensive health monitoring and metrics
 * - Rate limit awareness and request queuing
 * - Graceful shutdown with cleanup
 *
 * Architecture:
 * - Event-driven design with typed events
 * - Immutable price tick objects
 * - Thread-safe subscription management
 * - Memory-efficient circular buffer for metrics
 *
 * @example
 * ```typescript
 * const feed = new BinancePriceFeed({
 *   symbols: ['BTCUSDT', 'ETHUSDT'],
 *   useWebSocket: true,
 *   debug: true,
 * });
 *
 * await feed.start();
 *
 * // Subscribe to price updates
 * const unsubscribe = feed.subscribe({
 *   symbols: ['BTCUSDT'],
 *   callback: (tick) => {
 *     console.log(`BTC: $${tick.price} (${tick.change24h > 0 ? '+' : ''}${tick.change24h.toFixed(2)}%)`);
 *   },
 *   minInterval: 1000, // Max 1 update per second
 * });
 *
 * // Get current price synchronously
 * const btcPrice = feed.getPrice('BTCUSDT');
 *
 * // Get historical data
 * const candles = await feed.getHistoricalPrices('BTCUSDT', '1h', 24);
 *
 * // Check health
 * const health = feed.getHealth();
 * console.log(`Status: ${health.state}, Fresh: ${health.pricesAreFresh}`);
 *
 * // Cleanup
 * unsubscribe();
 * feed.stop();
 * ```
 *
 * @module market/BinancePriceFeed
 * @version 1.0.0
 */

import type {
  MarketDataConfig,
  PriceTick,
  PriceSubscription,
  PriceCandle,
  PriceFeedHealth,
  PriceFeedConnectionState,
  ResolvedMarketConfig,
  PriceFeedMetrics,
} from "@hyperscape/shared";
import {
  DEFAULT_MARKET_CONFIG,
  isValidKlineInterval,
} from "@hyperscape/shared";

import {
  type CachedPriceTick,
  type PriceCache,
  type SubscriptionEntry,
  type SubscriptionRegistry,
  type WebSocketState,
  type BinanceWsTickerMessage,
  type BinanceWsCombinedStreamMessage,
  type BinanceKlineResponse,
  type BinanceTicker24hrResponse,
  BINANCE_ENDPOINTS,
  BINANCE_LIMITS,
  isTickerMessage,
  isCombinedStreamMessage,
  parseTickerMessage,
  parseRestTicker,
  cachedToPriceTick,
  createDefaultWebSocketState,
  isBinanceError,
} from "./types";

// ============================================================================
// Constants
// ============================================================================

/** Maximum size of metrics history buffer */
const METRICS_BUFFER_SIZE = 60;

/** Health check stale threshold (ms) */
const DEFAULT_STALE_THRESHOLD = 60000;

/** Minimum reconnect delay (ms) */
const MIN_RECONNECT_DELAY = 100;

/** Maximum reconnect delay (ms) */
const MAX_RECONNECT_DELAY = 30000;

// ============================================================================
// BinancePriceFeed Class
// ============================================================================

/**
 * Real-time cryptocurrency price feed service using Binance API
 *
 * Provides streaming price updates via WebSocket with automatic
 * fallback to REST polling. Designed for high reliability and
 * low latency in production environments.
 */
export class BinancePriceFeed {
  // ============================================================================
  // Private Properties
  // ============================================================================

  /** Resolved configuration with defaults */
  private readonly config: ResolvedMarketConfig;

  /** In-memory price cache */
  private readonly priceCache: PriceCache = new Map();

  /** Active subscriptions registry */
  private readonly subscriptions: SubscriptionRegistry = new Map();

  /** Subscription ID counter */
  private subscriptionIdCounter = 0;

  /** WebSocket connection state */
  private wsState: WebSocketState;

  /** Service start timestamp */
  private startedAt: number | null = null;

  /** Whether service is running */
  private isRunning = false;

  /** REST polling interval handle */
  private restPollInterval: ReturnType<typeof setInterval> | null = null;

  /** Health check interval handle */
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null;

  /** Metrics collection */
  private metrics: {
    messagesTotal: number;
    messagesPerMinute: number[];
    reconnectsTotal: number;
    errorsTotal: number;
    lastErrorTime: number | null;
    lastErrorMessage: string | null;
    latencies: number[];
    callbacksTotal: number;
    callbackErrors: number;
  };

  /** Mutable symbols list (can be expanded at runtime) */
  private trackedSymbols: string[];

  // ============================================================================
  // Constructor
  // ============================================================================

  /**
   * Create a new BinancePriceFeed instance
   *
   * @param config - Configuration options
   *
   * @example
   * ```typescript
   * const feed = new BinancePriceFeed({
   *   symbols: ['BTCUSDT', 'ETHUSDT'],
   *   useWebSocket: true,
   *   debug: process.env.NODE_ENV !== 'production',
   * });
   * ```
   */
  constructor(config: MarketDataConfig) {
    // Resolve configuration with defaults
    this.config = {
      symbols: config.symbols ?? DEFAULT_MARKET_CONFIG.symbols,
      updateInterval:
        config.updateInterval ?? DEFAULT_MARKET_CONFIG.updateInterval,
      useWebSocket: config.useWebSocket ?? DEFAULT_MARKET_CONFIG.useWebSocket,
      useTestnet: config.useTestnet ?? DEFAULT_MARKET_CONFIG.useTestnet,
      maxReconnectAttempts:
        config.maxReconnectAttempts ??
        DEFAULT_MARKET_CONFIG.maxReconnectAttempts,
      reconnectDelay:
        config.reconnectDelay ?? DEFAULT_MARKET_CONFIG.reconnectDelay,
      debug: config.debug ?? DEFAULT_MARKET_CONFIG.debug,
      stalePriceThreshold:
        config.stalePriceThreshold ?? DEFAULT_MARKET_CONFIG.stalePriceThreshold,
      enableRestFallback:
        config.enableRestFallback ?? DEFAULT_MARKET_CONFIG.enableRestFallback,
      apiKey: config.apiKey,
      apiSecret: config.apiSecret,
      logger: config.logger ?? this.defaultLogger.bind(this),
    };

    // Initialize mutable symbols list
    this.trackedSymbols = [...this.config.symbols].map((s) => s.toUpperCase());

    // Initialize WebSocket state
    this.wsState = createDefaultWebSocketState();

    // Initialize metrics
    this.metrics = {
      messagesTotal: 0,
      messagesPerMinute: [],
      reconnectsTotal: 0,
      errorsTotal: 0,
      lastErrorTime: null,
      lastErrorMessage: null,
      latencies: [],
      callbacksTotal: 0,
      callbackErrors: 0,
    };

    this.log("info", "BinancePriceFeed initialized", {
      symbols: this.trackedSymbols,
      useWebSocket: this.config.useWebSocket,
      useTestnet: this.config.useTestnet,
    });
  }

  // ============================================================================
  // Public Methods - Lifecycle
  // ============================================================================

  /**
   * Start the price feed service
   *
   * Establishes WebSocket connection or starts REST polling based on config.
   * Safe to call multiple times (idempotent).
   *
   * @returns Promise that resolves when initial connection is established
   * @throws Error if initial connection fails and no fallback available
   *
   * @example
   * ```typescript
   * await feed.start();
   * console.log('Price feed is now running');
   * ```
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      this.log("warn", "Service already running, ignoring start()");
      return;
    }

    this.isRunning = true;
    this.startedAt = Date.now();
    this.log("info", "Starting price feed service...");

    // Initialize cache entries for all tracked symbols
    for (const symbol of this.trackedSymbols) {
      this.initializeCacheEntry(symbol);
    }

    // Start health check interval
    this.startHealthCheck();

    // Connect based on configuration
    if (this.config.useWebSocket) {
      try {
        await this.connectWebSocket();
      } catch (error) {
        this.log("error", "WebSocket connection failed", { error });

        if (this.config.enableRestFallback) {
          this.log("info", "Falling back to REST polling");
          await this.startRestPolling();
        } else {
          this.isRunning = false;
          throw error;
        }
      }
    } else {
      await this.startRestPolling();
    }

    this.log("info", "Price feed service started successfully");
  }

  /**
   * Stop the price feed service
   *
   * Gracefully shuts down all connections, clears subscriptions,
   * and releases resources. Safe to call multiple times (idempotent).
   *
   * @example
   * ```typescript
   * feed.stop();
   * console.log('Price feed stopped');
   * ```
   */
  stop(): void {
    if (!this.isRunning) {
      this.log("warn", "Service not running, ignoring stop()");
      return;
    }

    this.log("info", "Stopping price feed service...");
    this.isRunning = false;

    // Stop health check
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    // Close WebSocket
    this.closeWebSocket();

    // Stop REST polling
    if (this.restPollInterval) {
      clearInterval(this.restPollInterval);
      this.restPollInterval = null;
    }

    // Clear all subscriptions
    this.subscriptions.clear();

    // Clear price cache
    this.priceCache.clear();

    this.startedAt = null;
    this.log("info", "Price feed service stopped");
  }

  /**
   * Restart the service (stop then start)
   *
   * Useful for applying configuration changes or recovering from errors.
   *
   * @example
   * ```typescript
   * await feed.restart();
   * ```
   */
  async restart(): Promise<void> {
    this.log("info", "Restarting price feed service...");
    this.stop();
    await this.start();
  }

  // ============================================================================
  // Public Methods - Price Access
  // ============================================================================

  /**
   * Get the current cached price for a symbol
   *
   * Returns immediately from cache. Returns null if symbol
   * is not being tracked or no price data available yet.
   *
   * @param symbol - Trading pair symbol (e.g., 'BTCUSDT')
   * @returns Price tick or null if not available
   *
   * @example
   * ```typescript
   * const btc = feed.getPrice('BTCUSDT');
   * if (btc) {
   *   console.log(`BTC: $${btc.price.toLocaleString()}`);
   * }
   * ```
   */
  getPrice(symbol: string): PriceTick | null {
    const normalizedSymbol = symbol.toUpperCase();
    const cached = this.priceCache.get(normalizedSymbol);

    if (!cached || cached.price === 0) {
      return null;
    }

    return cachedToPriceTick(cached);
  }

  /**
   * Get current cached prices for multiple symbols
   *
   * Returns a Map with only the symbols that have valid price data.
   *
   * @param symbols - Array of trading pair symbols
   * @returns Map of symbol to price tick
   *
   * @example
   * ```typescript
   * const prices = feed.getPrices(['BTCUSDT', 'ETHUSDT', 'SOLUSDT']);
   * for (const [symbol, tick] of prices) {
   *   console.log(`${symbol}: $${tick.price}`);
   * }
   * ```
   */
  getPrices(symbols: string[]): Map<string, PriceTick> {
    const result = new Map<string, PriceTick>();

    for (const symbol of symbols) {
      const price = this.getPrice(symbol);
      if (price) {
        result.set(symbol.toUpperCase(), price);
      }
    }

    return result;
  }

  /**
   * Get all cached prices
   *
   * @returns Map of all symbol to price tick entries with valid data
   *
   * @example
   * ```typescript
   * const allPrices = feed.getAllPrices();
   * console.log(`Tracking ${allPrices.size} symbols`);
   * ```
   */
  getAllPrices(): Map<string, PriceTick> {
    const result = new Map<string, PriceTick>();

    for (const [symbol, cached] of this.priceCache) {
      if (cached.price > 0) {
        result.set(symbol, cachedToPriceTick(cached));
      }
    }

    return result;
  }

  /**
   * Check if a price is stale (older than threshold)
   *
   * @param symbol - Trading pair symbol
   * @returns true if price is stale or unavailable
   *
   * @example
   * ```typescript
   * if (feed.isPriceStale('BTCUSDT')) {
   *   console.warn('BTC price may be outdated');
   * }
   * ```
   */
  isPriceStale(symbol: string): boolean {
    const cached = this.priceCache.get(symbol.toUpperCase());

    if (!cached || cached.price === 0) {
      return true;
    }

    const age = Date.now() - cached.localUpdateTime;
    return age > this.config.stalePriceThreshold;
  }

  // ============================================================================
  // Public Methods - Subscriptions
  // ============================================================================

  /**
   * Subscribe to price updates for specific symbols
   *
   * Returns an unsubscribe function that should be called when
   * updates are no longer needed.
   *
   * @param subscription - Subscription configuration
   * @returns Unsubscribe function
   *
   * @example
   * ```typescript
   * const unsubscribe = feed.subscribe({
   *   symbols: ['BTCUSDT', 'ETHUSDT'],
   *   callback: (tick) => {
   *     updateUI(tick.symbol, tick.price);
   *   },
   *   minInterval: 500, // Throttle to max 2 updates/second
   *   onError: (err) => console.error('Subscription error:', err),
   * });
   *
   * // Later, when done:
   * unsubscribe();
   * ```
   */
  subscribe(subscription: PriceSubscription): () => void {
    const id = `sub_${++this.subscriptionIdCounter}_${Date.now()}`;

    const normalizedSymbols = new Set(
      subscription.symbols.map((s) => s.toUpperCase()),
    );

    const entry: SubscriptionEntry = {
      id,
      symbols: normalizedSymbols,
      callback: subscription.callback,
      minInterval: subscription.minInterval ?? 0,
      lastCallTime: new Map(),
      onError: subscription.onError,
      label: subscription.label,
      emitCached: subscription.emitCached ?? true,
      createdAt: Date.now(),
      callbackCount: 0,
      errorCount: 0,
    };

    this.subscriptions.set(id, entry);
    this.log("debug", `Subscription created: ${id}`, {
      symbols: Array.from(normalizedSymbols),
      minInterval: entry.minInterval,
      label: entry.label,
    });

    // Add any new symbols to tracking
    for (const symbol of normalizedSymbols) {
      if (!this.trackedSymbols.includes(symbol)) {
        this.addSymbol(symbol);
      }
    }

    // Emit cached prices if requested
    if (entry.emitCached) {
      for (const symbol of normalizedSymbols) {
        const cached = this.priceCache.get(symbol);
        if (cached && cached.price > 0) {
          this.safeCallback(entry, cachedToPriceTick(cached));
        }
      }
    }

    // Return unsubscribe function
    return () => {
      const removed = this.subscriptions.delete(id);
      if (removed) {
        this.log("debug", `Subscription removed: ${id}`);
      }
    };
  }

  /**
   * Get current subscription count
   *
   * @returns Number of active subscriptions
   */
  getSubscriptionCount(): number {
    return this.subscriptions.size;
  }

  // ============================================================================
  // Public Methods - Historical Data
  // ============================================================================

  /**
   * Get historical price data (candlesticks/klines)
   *
   * Fetches OHLCV data from Binance REST API.
   *
   * @param symbol - Trading pair symbol
   * @param interval - Candlestick interval (e.g., '1h', '1d')
   * @param limit - Number of candles to retrieve (max 1000)
   * @param startTime - Optional start time (Unix ms)
   * @param endTime - Optional end time (Unix ms)
   * @returns Array of price candles
   *
   * @example
   * ```typescript
   * // Get last 24 hourly candles
   * const candles = await feed.getHistoricalPrices('BTCUSDT', '1h', 24);
   *
   * // Calculate 24h high/low
   * const high = Math.max(...candles.map(c => c.high));
   * const low = Math.min(...candles.map(c => c.low));
   * ```
   */
  async getHistoricalPrices(
    symbol: string,
    interval: string,
    limit: number = 100,
    startTime?: number,
    endTime?: number,
  ): Promise<PriceCandle[]> {
    if (!isValidKlineInterval(interval)) {
      throw new Error(
        `Invalid interval: ${interval}. Valid intervals: 1s, 1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 6h, 8h, 12h, 1d, 3d, 1w, 1M`,
      );
    }

    const validLimit = Math.min(
      Math.max(1, limit),
      BINANCE_LIMITS.MAX_KLINES_PER_REQUEST,
    );

    const baseUrl = this.config.useTestnet
      ? BINANCE_ENDPOINTS.REST_TESTNET
      : BINANCE_ENDPOINTS.REST_BASE;

    // Build query parameters
    const params = new URLSearchParams({
      symbol: symbol.toUpperCase(),
      interval,
      limit: validLimit.toString(),
    });

    if (startTime !== undefined) {
      params.set("startTime", startTime.toString());
    }
    if (endTime !== undefined) {
      params.set("endTime", endTime.toString());
    }

    const url = `${baseUrl}/api/v3/klines?${params.toString()}`;

    try {
      const response = await this.fetchWithTimeout(url);

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorBody}`);
      }

      const data = (await response.json()) as BinanceKlineResponse[];

      return data.map((kline) => ({
        openTime: kline[0],
        open: parseFloat(kline[1]),
        high: parseFloat(kline[2]),
        low: parseFloat(kline[3]),
        close: parseFloat(kline[4]),
        volume: parseFloat(kline[5]),
        closeTime: kline[6],
        quoteVolume: parseFloat(kline[7]),
        trades: kline[8],
        takerBuyVolume: parseFloat(kline[9]),
        takerBuyQuoteVolume: parseFloat(kline[10]),
        isClosed: true,
      }));
    } catch (error) {
      this.recordError(error as Error, "getHistoricalPrices");
      throw error;
    }
  }

  /**
   * Get 24hr ticker statistics for a symbol
   *
   * @param symbol - Trading pair symbol
   * @returns Full 24hr statistics
   */
  async get24hrStats(symbol: string): Promise<PriceTick> {
    const baseUrl = this.config.useTestnet
      ? BINANCE_ENDPOINTS.REST_TESTNET
      : BINANCE_ENDPOINTS.REST_BASE;

    const url = `${baseUrl}/api/v3/ticker/24hr?symbol=${symbol.toUpperCase()}`;

    try {
      const response = await this.fetchWithTimeout(url);

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorBody}`);
      }

      const data = (await response.json()) as BinanceTicker24hrResponse;
      const cached = parseRestTicker(data);

      return cachedToPriceTick(cached);
    } catch (error) {
      this.recordError(error as Error, "get24hrStats");
      throw error;
    }
  }

  // ============================================================================
  // Public Methods - Symbol Management
  // ============================================================================

  /**
   * Add a new symbol to track
   *
   * If WebSocket is connected, will reconnect to add the new stream.
   *
   * @param symbol - Trading pair symbol to add
   *
   * @example
   * ```typescript
   * feed.addSymbol('LINKUSDT');
   * ```
   */
  addSymbol(symbol: string): void {
    const normalizedSymbol = symbol.toUpperCase();

    if (this.trackedSymbols.includes(normalizedSymbol)) {
      this.log("debug", `Symbol ${normalizedSymbol} already tracked`);
      return;
    }

    this.trackedSymbols.push(normalizedSymbol);
    this.initializeCacheEntry(normalizedSymbol);

    this.log("info", `Added symbol: ${normalizedSymbol}`);

    // Reconnect WebSocket to add new stream
    if (this.wsState.state === "connected" && this.config.useWebSocket) {
      this.log("info", "Reconnecting WebSocket to add new symbol stream");
      this.reconnectWebSocket();
    }
  }

  /**
   * Remove a symbol from tracking
   *
   * Note: Existing subscriptions for this symbol will stop receiving updates.
   *
   * @param symbol - Trading pair symbol to remove
   */
  removeSymbol(symbol: string): void {
    const normalizedSymbol = symbol.toUpperCase();
    const index = this.trackedSymbols.indexOf(normalizedSymbol);

    if (index === -1) {
      this.log("debug", `Symbol ${normalizedSymbol} not tracked`);
      return;
    }

    this.trackedSymbols.splice(index, 1);
    this.priceCache.delete(normalizedSymbol);

    this.log("info", `Removed symbol: ${normalizedSymbol}`);

    // Reconnect WebSocket to remove stream
    if (this.wsState.state === "connected" && this.config.useWebSocket) {
      this.log("info", "Reconnecting WebSocket to remove symbol stream");
      this.reconnectWebSocket();
    }
  }

  /**
   * Get list of currently tracked symbols
   *
   * @returns Array of tracked symbol strings
   */
  getTrackedSymbols(): string[] {
    return [...this.trackedSymbols];
  }

  // ============================================================================
  // Public Methods - Health & Monitoring
  // ============================================================================

  /**
   * Get comprehensive health status
   *
   * Use for monitoring, alerting, and diagnostics.
   *
   * @returns Health check result with all metrics
   *
   * @example
   * ```typescript
   * const health = feed.getHealth();
   *
   * if (!health.isHealthy) {
   *   console.error(`Price feed unhealthy: ${health.error}`);
   *   alertOps(health);
   * }
   *
   * // Log metrics
   * console.log(`Uptime: ${health.uptime}ms`);
   * console.log(`Messages/min: ${health.messagesPerMinute}`);
   * console.log(`Fresh symbols: ${health.freshSymbolCount}/${health.trackedSymbols}`);
   * ```
   */
  getHealth(): PriceFeedHealth {
    const now = Date.now();
    const lastUpdate = this.wsState.lastMessageAt;

    // Count fresh symbols
    let freshCount = 0;
    for (const cached of this.priceCache.values()) {
      if (
        cached.price > 0 &&
        now - cached.localUpdateTime < this.config.stalePriceThreshold
      ) {
        freshCount++;
      }
    }

    // Calculate messages per minute
    const recentMessages = this.metrics.messagesPerMinute.slice(-60);
    const messagesPerMinute = recentMessages.reduce((a, b) => a + b, 0);

    // Determine connection mode
    let connectionMode: "websocket" | "rest" | "none" = "none";
    if (this.wsState.state === "connected") {
      connectionMode = "websocket";
    } else if (this.restPollInterval) {
      connectionMode = "rest";
    }

    // Estimate memory usage
    const memoryCacheSize = this.priceCache.size * 200; // ~200 bytes per entry estimate

    const pricesAreFresh =
      freshCount > 0 && freshCount >= this.priceCache.size * 0.8;

    return {
      state: this.wsState.state as PriceFeedConnectionState,
      isHealthy: this.isHealthy(),
      pricesAreFresh,
      trackedSymbols: this.priceCache.size,
      freshSymbolCount: freshCount,
      activeSubscriptions: this.subscriptions.size,
      lastUpdateTime: lastUpdate,
      timeSinceLastUpdate: lastUpdate ? now - lastUpdate : null,
      reconnectAttempts: this.wsState.reconnectAttempts,
      messagesReceived: this.metrics.messagesTotal,
      messagesPerMinute,
      error: this.metrics.lastErrorMessage ?? undefined,
      uptime: this.startedAt ? now - this.startedAt : 0,
      connectionMode,
      memoryCacheSize,
      checkedAt: now,
    };
  }

  /**
   * Get detailed metrics for monitoring systems
   *
   * @returns Metrics object suitable for Prometheus/Datadog/etc.
   */
  getMetrics(): PriceFeedMetrics {
    const latencies = this.metrics.latencies.slice(-100);
    const avgLatency =
      latencies.length > 0
        ? latencies.reduce((a, b) => a + b, 0) / latencies.length
        : 0;
    const maxLatency = latencies.length > 0 ? Math.max(...latencies) : 0;

    // Calculate cache hit rate (simplified)
    const cacheHitRate =
      this.metrics.callbacksTotal > 0
        ? (this.metrics.callbacksTotal - this.metrics.callbackErrors) /
          this.metrics.callbacksTotal
        : 1;

    const recentMessages = this.metrics.messagesPerMinute.slice(-60);
    const messagesPerSecond =
      recentMessages.length > 0
        ? recentMessages.reduce((a, b) => a + b, 0) / 60
        : 0;

    return {
      messagesTotal: this.metrics.messagesTotal,
      messagesPerSecond,
      reconnectsTotal: this.metrics.reconnectsTotal,
      errorsTotal: this.metrics.errorsTotal,
      lastErrorTime: this.metrics.lastErrorTime,
      lastErrorMessage: this.metrics.lastErrorMessage,
      avgLatencyMs: Math.round(avgLatency),
      maxLatencyMs: Math.round(maxLatency),
      cacheHitRate,
      subscriptionCallbacksTotal: this.metrics.callbacksTotal,
      subscriptionCallbackErrors: this.metrics.callbackErrors,
    };
  }

  /**
   * Check if the service is operational
   *
   * @returns true if service can serve price data
   */
  isHealthy(): boolean {
    if (!this.isRunning) {
      return false;
    }

    // Check connection
    if (this.config.useWebSocket) {
      if (
        this.wsState.state !== "connected" &&
        this.wsState.state !== "degraded"
      ) {
        // Check if REST fallback is running
        if (!this.restPollInterval) {
          return false;
        }
      }
    }

    // Check for recent updates (within 2x the stale threshold)
    const lastMessage = this.wsState.lastMessageAt;
    if (lastMessage) {
      const timeSinceUpdate = Date.now() - lastMessage;
      if (timeSinceUpdate > this.config.stalePriceThreshold * 2) {
        return false;
      }
    }

    return true;
  }

  /**
   * Get current connection state
   *
   * @returns Current connection state string
   */
  getConnectionState(): PriceFeedConnectionState {
    return this.wsState.state as PriceFeedConnectionState;
  }

  // ============================================================================
  // Private Methods - WebSocket Management
  // ============================================================================

  /**
   * Establish WebSocket connection to Binance
   */
  private async connectWebSocket(): Promise<void> {
    // Close existing connection if any
    if (this.wsState.ws) {
      this.closeWebSocket();
    }

    this.wsState.state = "connecting";
    this.log("info", "Connecting to Binance WebSocket...");

    return new Promise<void>((resolve, reject) => {
      try {
        // Build combined streams URL
        const streams = this.trackedSymbols
          .map((s) => `${s.toLowerCase()}@ticker`)
          .join("/");

        const baseUrl = this.config.useTestnet
          ? BINANCE_ENDPOINTS.WS_TESTNET_COMBINED
          : BINANCE_ENDPOINTS.WS_COMBINED;

        const wsUrl = `${baseUrl}?streams=${streams}`;
        this.wsState.url = wsUrl;

        this.log("debug", `WebSocket URL: ${wsUrl}`);

        // Create WebSocket connection
        const ws = new WebSocket(wsUrl);

        // Connection timeout
        const connectionTimeout = setTimeout(() => {
          if (this.wsState.state === "connecting") {
            ws.close();
            reject(new Error("WebSocket connection timeout"));
          }
        }, BINANCE_LIMITS.WS_CONNECTION_TIMEOUT_MS);

        ws.onopen = () => {
          clearTimeout(connectionTimeout);
          this.handleWebSocketOpen();
          resolve();
        };

        ws.onmessage = (event) => {
          this.handleWebSocketMessage(event.data);
        };

        ws.onerror = (event) => {
          clearTimeout(connectionTimeout);
          this.handleWebSocketError(event);
          if (this.wsState.state === "connecting") {
            reject(new Error("WebSocket connection error"));
          }
        };

        ws.onclose = (event) => {
          clearTimeout(connectionTimeout);
          this.handleWebSocketClose(event.code, event.reason);
        };

        this.wsState.ws = ws;
      } catch (error) {
        this.wsState.state = "error";
        reject(error);
      }
    });
  }

  /**
   * Handle WebSocket open event
   */
  private handleWebSocketOpen(): void {
    this.log("info", "WebSocket connected successfully");
    this.wsState.state = "connected";
    this.wsState.connectedAt = Date.now();
    this.wsState.reconnectAttempts = 0;
    this.wsState.lastError = null;

    // Update active streams
    this.wsState.activeStreams = new Set(
      this.trackedSymbols.map((s) => `${s.toLowerCase()}@ticker`),
    );

    // Start ping interval to keep connection alive
    this.startPingInterval();
  }

  /**
   * Handle WebSocket message
   */
  private handleWebSocketMessage(data: string | ArrayBuffer): void {
    try {
      const dataStr =
        typeof data === "string" ? data : new TextDecoder().decode(data);
      const message = JSON.parse(dataStr);

      this.wsState.lastMessageAt = Date.now();
      this.wsState.messagesReceived++;
      this.metrics.messagesTotal++;

      // Track messages per minute
      if (this.metrics.messagesPerMinute.length >= METRICS_BUFFER_SIZE) {
        this.metrics.messagesPerMinute.shift();
      }
      this.metrics.messagesPerMinute.push(1);

      // Process message based on type
      if (isCombinedStreamMessage(message)) {
        this.processCombinedStreamMessage(message);
      } else if (isTickerMessage(message)) {
        this.processTickerMessage(message);
      }
    } catch (error) {
      this.log("error", "Failed to parse WebSocket message", { error });
      this.recordError(error as Error, "parseMessage");
    }
  }

  /**
   * Handle WebSocket error
   */
  private handleWebSocketError(event: Event): void {
    this.log("error", "WebSocket error occurred", { event });
    this.wsState.lastError = new Error("WebSocket error");
    this.recordError(this.wsState.lastError, "websocket");

    if (this.wsState.state === "connected") {
      this.wsState.state = "degraded";
    }
  }

  /**
   * Handle WebSocket close
   */
  private handleWebSocketClose(code: number, reason: string): void {
    this.log("info", `WebSocket closed: ${code} - ${reason}`);

    const wasConnected =
      this.wsState.state === "connected" || this.wsState.state === "degraded";
    this.wsState.state = "disconnected";
    this.wsState.connectedAt = null;

    // Stop ping interval
    this.stopPingInterval();

    // Attempt reconnection if service is still running
    if (this.isRunning && wasConnected) {
      this.scheduleReconnect();
    }
  }

  /**
   * Close WebSocket connection cleanly
   */
  private closeWebSocket(): void {
    this.stopPingInterval();

    if (this.wsState.reconnectTimeout) {
      clearTimeout(this.wsState.reconnectTimeout);
      this.wsState.reconnectTimeout = null;
    }

    if (this.wsState.ws) {
      // Remove event handlers to prevent callbacks after close
      this.wsState.ws.onopen = null;
      this.wsState.ws.onmessage = null;
      this.wsState.ws.onerror = null;
      this.wsState.ws.onclose = null;

      if (
        this.wsState.ws.readyState === WebSocket.OPEN ||
        this.wsState.ws.readyState === WebSocket.CONNECTING
      ) {
        this.wsState.ws.close(1000, "Client closing");
      }

      this.wsState.ws = null;
    }

    this.wsState.state = "disconnected";
    this.wsState.activeStreams.clear();
  }

  /**
   * Schedule WebSocket reconnection with exponential backoff
   */
  private scheduleReconnect(): void {
    if (!this.isRunning) {
      return;
    }

    // Check if max attempts exceeded
    if (this.wsState.reconnectAttempts >= this.config.maxReconnectAttempts) {
      this.log("warn", "Max reconnection attempts reached");

      if (this.config.enableRestFallback) {
        this.log("info", "Falling back to REST polling");
        this.startRestPolling();
      } else {
        this.wsState.state = "error";
      }
      return;
    }

    this.wsState.state = "reconnecting";
    this.wsState.reconnectAttempts++;
    this.metrics.reconnectsTotal++;

    // Calculate delay with exponential backoff and jitter
    const baseDelay = this.config.reconnectDelay;
    const exponentialDelay =
      baseDelay * Math.pow(2, this.wsState.reconnectAttempts - 1);
    const jitter = Math.random() * 0.3 * exponentialDelay; // ±30% jitter
    const delay = Math.min(
      Math.max(exponentialDelay + jitter, MIN_RECONNECT_DELAY),
      MAX_RECONNECT_DELAY,
    );

    this.log(
      "info",
      `Reconnecting in ${Math.round(delay)}ms (attempt ${this.wsState.reconnectAttempts}/${this.config.maxReconnectAttempts})`,
    );

    this.wsState.reconnectTimeout = setTimeout(async () => {
      try {
        await this.connectWebSocket();
      } catch (error) {
        this.log("error", "Reconnection failed", { error });
        this.scheduleReconnect();
      }
    }, delay);
  }

  /**
   * Force immediate WebSocket reconnection
   */
  private reconnectWebSocket(): void {
    this.closeWebSocket();
    this.wsState.reconnectAttempts = 0;
    this.connectWebSocket().catch((error) => {
      this.log("error", "Reconnection failed", { error });
      this.scheduleReconnect();
    });
  }

  /**
   * Start WebSocket ping interval
   */
  private startPingInterval(): void {
    this.stopPingInterval();

    this.wsState.pingInterval = setInterval(() => {
      if (this.wsState.ws?.readyState === WebSocket.OPEN) {
        this.wsState.lastPingAt = Date.now();
        // Binance WebSocket doesn't require explicit pings, but we send a pong frame
        // to keep the connection alive through proxies/load balancers
        try {
          this.wsState.ws.send(JSON.stringify({ method: "ping" }));
        } catch (error) {
          this.log("warn", "Failed to send ping", { error });
        }
      }
    }, BINANCE_LIMITS.WS_PING_INTERVAL_MS);
  }

  /**
   * Stop WebSocket ping interval
   */
  private stopPingInterval(): void {
    if (this.wsState.pingInterval) {
      clearInterval(this.wsState.pingInterval);
      this.wsState.pingInterval = null;
    }
  }

  // ============================================================================
  // Private Methods - Message Processing
  // ============================================================================

  /**
   * Process combined stream message
   */
  private processCombinedStreamMessage(
    message: BinanceWsCombinedStreamMessage,
  ): void {
    if (isTickerMessage(message.data)) {
      this.processTickerMessage(message.data);
    }
  }

  /**
   * Process ticker message and update cache
   */
  private processTickerMessage(message: BinanceWsTickerMessage): void {
    const symbol = message.s;
    const now = Date.now();

    // Parse and update cache
    const cached = parseTickerMessage(message, "websocket");
    const existingEntry = this.priceCache.get(symbol);

    // Update with incremented count
    const updatedCache: CachedPriceTick = {
      ...cached,
      updateCount: (existingEntry?.updateCount ?? 0) + 1,
    };

    this.priceCache.set(symbol, updatedCache);

    // Track latency
    if (this.metrics.latencies.length >= METRICS_BUFFER_SIZE) {
      this.metrics.latencies.shift();
    }
    this.metrics.latencies.push(cached.latencyMs);

    // Notify subscribers
    this.notifySubscribers(symbol, cachedToPriceTick(updatedCache));
  }

  // ============================================================================
  // Private Methods - REST Polling
  // ============================================================================

  /**
   * Start REST API polling as fallback
   */
  private async startRestPolling(): Promise<void> {
    if (this.restPollInterval) {
      return; // Already running
    }

    this.log("info", "Starting REST polling");

    // Fetch immediately
    await this.fetchPricesViaRest();

    // Set up polling interval
    this.restPollInterval = setInterval(async () => {
      await this.fetchPricesViaRest();
    }, this.config.updateInterval);
  }

  /**
   * Stop REST polling
   */
  private stopRestPolling(): void {
    if (this.restPollInterval) {
      clearInterval(this.restPollInterval);
      this.restPollInterval = null;
      this.log("info", "Stopped REST polling");
    }
  }

  /**
   * Fetch prices via REST API
   */
  private async fetchPricesViaRest(): Promise<void> {
    const baseUrl = this.config.useTestnet
      ? BINANCE_ENDPOINTS.REST_TESTNET
      : BINANCE_ENDPOINTS.REST_BASE;

    try {
      // Fetch 24hr tickers for all symbols
      const symbolsParam = JSON.stringify(this.trackedSymbols);
      const url = `${baseUrl}/api/v3/ticker/24hr?symbols=${encodeURIComponent(symbolsParam)}`;

      const response = await this.fetchWithTimeout(url);

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorBody}`);
      }

      const data = (await response.json()) as BinanceTicker24hrResponse[];
      const now = Date.now();

      this.wsState.lastMessageAt = now;
      this.metrics.messagesTotal += data.length;

      for (const ticker of data) {
        const cached = parseRestTicker(ticker);
        const existingEntry = this.priceCache.get(ticker.symbol);

        const updatedCache: CachedPriceTick = {
          ...cached,
          updateCount: (existingEntry?.updateCount ?? 0) + 1,
        };

        this.priceCache.set(ticker.symbol, updatedCache);
        this.notifySubscribers(ticker.symbol, cachedToPriceTick(updatedCache));
      }
    } catch (error) {
      this.log("error", "REST polling failed", { error });
      this.recordError(error as Error, "restPolling");
    }
  }

  // ============================================================================
  // Private Methods - Subscription Management
  // ============================================================================

  /**
   * Notify all relevant subscribers of a price update
   */
  private notifySubscribers(symbol: string, tick: PriceTick): void {
    const now = Date.now();

    for (const subscription of this.subscriptions.values()) {
      if (!subscription.symbols.has(symbol)) {
        continue;
      }

      // Check throttling
      const lastCall = subscription.lastCallTime.get(symbol) ?? 0;
      if (now - lastCall < subscription.minInterval) {
        continue;
      }

      subscription.lastCallTime.set(symbol, now);
      this.safeCallback(subscription, tick);
    }
  }

  /**
   * Safely invoke subscription callback with error handling
   */
  private safeCallback(subscription: SubscriptionEntry, tick: PriceTick): void {
    try {
      subscription.callback(tick);
      subscription.callbackCount++;
      this.metrics.callbacksTotal++;
    } catch (error) {
      subscription.errorCount++;
      this.metrics.callbackErrors++;

      this.log("error", `Subscription callback error [${subscription.id}]`, {
        error,
      });

      if (subscription.onError) {
        try {
          subscription.onError(error as Error, `callback for ${tick.symbol}`);
        } catch (errorCallbackError) {
          this.log("error", "Error callback also failed", {
            errorCallbackError,
          });
        }
      }
    }
  }

  // ============================================================================
  // Private Methods - Utilities
  // ============================================================================

  /**
   * Initialize a cache entry for a symbol
   */
  private initializeCacheEntry(symbol: string): void {
    const normalizedSymbol = symbol.toUpperCase();

    if (this.priceCache.has(normalizedSymbol)) {
      return;
    }

    this.priceCache.set(normalizedSymbol, {
      symbol: normalizedSymbol,
      price: 0,
      timestamp: 0,
      volume24h: 0,
      change24h: 0,
      high24h: 0,
      low24h: 0,
      bidPrice: 0,
      askPrice: 0,
      spreadPercent: 0,
      vwap: 0,
      tradeCount: 0,
      quoteVolume: 0,
      localUpdateTime: 0,
      updateCount: 0,
      source: "rest",
      latencyMs: 0,
    });
  }

  /**
   * Start periodic health check
   */
  private startHealthCheck(): void {
    if (this.healthCheckInterval) {
      return;
    }

    this.healthCheckInterval = setInterval(() => {
      // Record messages per minute bucket
      if (this.metrics.messagesPerMinute.length >= METRICS_BUFFER_SIZE) {
        this.metrics.messagesPerMinute.shift();
      }
      this.metrics.messagesPerMinute.push(0);

      // Check for stale connection
      if (this.config.useWebSocket && this.wsState.state === "connected") {
        const lastMessage = this.wsState.lastMessageAt;
        if (
          lastMessage &&
          Date.now() - lastMessage > this.config.stalePriceThreshold
        ) {
          this.log("warn", "WebSocket connection appears stale, reconnecting");
          this.wsState.state = "degraded";
          this.reconnectWebSocket();
        }
      }
    }, 1000);
  }

  /**
   * Fetch with timeout
   */
  private async fetchWithTimeout(
    url: string,
    options?: RequestInit,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      BINANCE_LIMITS.REQUEST_TIMEOUT_MS,
    );

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return response;
    } catch (error) {
      clearTimeout(timeout);
      throw error;
    }
  }

  /**
   * Record an error for metrics
   */
  private recordError(error: Error, context: string): void {
    this.metrics.errorsTotal++;
    this.metrics.lastErrorTime = Date.now();
    this.metrics.lastErrorMessage = `[${context}] ${error.message}`;
  }

  /**
   * Default logger implementation
   */
  private defaultLogger(
    message: string,
    context?: Record<string, unknown>,
  ): void {
    if (this.config.debug) {
      const timestamp = new Date().toISOString();
      console.log(
        `[${timestamp}] [BinancePriceFeed] ${message}`,
        context ?? "",
      );
    }
  }

  /**
   * Log helper with level support
   */
  private log(
    level: "debug" | "info" | "warn" | "error",
    message: string,
    context?: Record<string, unknown>,
  ): void {
    // Always log errors, only log others if debug enabled
    if (level === "error" || this.config.debug) {
      const prefix =
        level === "error"
          ? "❌"
          : level === "warn"
            ? "⚠️"
            : level === "info"
              ? "ℹ️"
              : "🔍";
      this.config.logger(`${prefix} ${message}`, context);
    }
  }
}
