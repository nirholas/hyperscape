/**
 * PriceOracle - Aggregated Multi-Source Price Oracle for Game Economies
 *
 * Provides reliable price data by aggregating multiple price feeds and
 * computing median prices. Designed for in-game economy conversions
 * and tokenized asset pricing.
 *
 * Features:
 * - Multiple price feed aggregation with median calculation
 * - Stale data detection and automatic source exclusion
 * - Game currency conversion utilities
 * - Price deviation alerts for market anomalies
 * - Thread-safe subscription management
 * - Comprehensive health monitoring
 *
 * Architecture:
 * - Feed registry with named sources
 * - Per-symbol price aggregation
 * - Configurable staleness thresholds
 * - Event-driven price updates
 *
 * @example
 * ```typescript
 * const oracle = new PriceOracle({
 *   stalePriceThreshold: 30000,
 *   minFeedsForMedian: 1,
 *   deviationAlertThreshold: 5,
 * });
 *
 * // Add price feeds
 * oracle.addFeed('binance', binanceFeed);
 * oracle.addFeed('backup', backupFeed);
 *
 * // Start the oracle
 * await oracle.start();
 *
 * // Get aggregated price (median across feeds)
 * const btcPrice = oracle.getPrice('BTCUSDT');
 *
 * // Convert game currency to USD
 * const usdValue = oracle.convertToUSD('1000', 'GOLD');
 *
 * // Subscribe to price updates
 * oracle.subscribe((symbol, price) => {
 *   console.log(`${symbol}: $${price}`);
 * });
 * ```
 *
 * @module market/PriceOracle
 * @version 1.0.0
 */

import type { PriceTick, PriceSubscription } from "@hyperscape/shared";
import { BinancePriceFeed } from "./BinancePriceFeed";

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration for the PriceOracle
 */
export interface PriceOracleConfig {
  /**
   * Threshold for considering a price stale (ms)
   * Prices older than this are excluded from median calculation
   * @default 60000
   */
  stalePriceThreshold?: number;

  /**
   * Minimum number of valid feeds required to compute a price
   * @default 1
   */
  minFeedsForMedian?: number;

  /**
   * Percentage deviation that triggers an alert
   * @default 5 (5%)
   */
  deviationAlertThreshold?: number;

  /**
   * Update interval for aggregated prices (ms)
   * @default 1000
   */
  updateInterval?: number;

  /**
   * Enable debug logging
   * @default false
   */
  debug?: boolean;

  /**
   * Custom logger function
   */
  logger?: (
    level: string,
    message: string,
    context?: Record<string, unknown>,
  ) => void;
}

/**
 * Resolved configuration with defaults
 */
interface ResolvedOracleConfig {
  stalePriceThreshold: number;
  minFeedsForMedian: number;
  deviationAlertThreshold: number;
  updateInterval: number;
  debug: boolean;
  logger: (
    level: string,
    message: string,
    context?: Record<string, unknown>,
  ) => void;
}

/**
 * Aggregated price with metadata
 */
export interface AggregatedPrice {
  /** Trading symbol */
  symbol: string;
  /** Median price across all valid feeds */
  price: number;
  /** Timestamp of most recent price used */
  timestamp: number;
  /** Number of feeds contributing to this price */
  feedCount: number;
  /** Names of feeds contributing */
  feeds: string[];
  /** Standard deviation across feeds (0 if single feed) */
  deviation: number;
  /** Whether price is considered reliable */
  isReliable: boolean;
  /** 24h change percentage (averaged) */
  change24h: number;
  /** 24h volume (summed) */
  volume24h: number;
}

/**
 * Game currency configuration
 */
export interface GameCurrencyConfig {
  /** Symbol for the game currency (e.g., 'GOLD') */
  symbol: string;
  /** USD value per unit of game currency */
  usdPerUnit: number;
  /** Crypto token backing the currency (e.g., 'USDT') */
  backingToken?: string;
  /** Conversion rate from backing token */
  backingRate?: number;
}

/**
 * Oracle health status
 */
export interface OracleHealth {
  /** Whether oracle is running */
  isRunning: boolean;
  /** Number of registered feeds */
  feedCount: number;
  /** Number of healthy feeds */
  healthyFeeds: number;
  /** Symbols with valid prices */
  validSymbols: number;
  /** Total symbols being tracked */
  totalSymbols: number;
  /** Last price update timestamp */
  lastUpdateTime: number | null;
  /** Any alerts or warnings */
  alerts: string[];
  /** Health check timestamp */
  checkedAt: number;
}

/**
 * Price update callback
 */
export type OraclePriceCallback = (
  symbol: string,
  price: AggregatedPrice,
) => void;

/**
 * Deviation alert callback
 */
export type DeviationAlertCallback = (
  symbol: string,
  deviation: number,
  prices: { feed: string; price: number }[],
) => void;

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: ResolvedOracleConfig = {
  stalePriceThreshold: 60000,
  minFeedsForMedian: 1,
  deviationAlertThreshold: 5,
  updateInterval: 1000,
  debug: false,
  logger: (level, message, context) => {
    const prefix = `[PriceOracle][${level.toUpperCase()}]`;
    if (context) {
      console.log(prefix, message, context);
    } else {
      console.log(prefix, message);
    }
  },
};

// ============================================================================
// PriceOracle Class
// ============================================================================

/**
 * Multi-source price aggregation oracle for game economies
 *
 * Aggregates prices from multiple feeds (e.g., Binance, backup sources)
 * and provides median prices with reliability indicators.
 */
export class PriceOracle {
  // ============================================================================
  // Private Properties
  // ============================================================================

  /** Resolved configuration */
  private readonly config: ResolvedOracleConfig;

  /** Registered price feeds */
  private readonly feeds: Map<string, BinancePriceFeed> = new Map();

  /** Aggregated price cache */
  private readonly priceCache: Map<string, AggregatedPrice> = new Map();

  /** Game currency configurations */
  private readonly gameCurrencies: Map<string, GameCurrencyConfig> = new Map();

  /** Price update subscribers */
  private readonly priceSubscribers: Set<OraclePriceCallback> = new Set();

  /** Deviation alert subscribers */
  private readonly deviationSubscribers: Set<DeviationAlertCallback> =
    new Set();

  /** Update interval handle */
  private updateIntervalHandle: ReturnType<typeof setInterval> | null = null;

  /** Running state */
  private isRunning = false;

  /** Last update timestamp */
  private lastUpdateTime: number | null = null;

  /** Accumulated alerts */
  private alerts: string[] = [];

  // ============================================================================
  // Constructor
  // ============================================================================

  /**
   * Create a new PriceOracle instance
   *
   * @param config - Configuration options
   *
   * @example
   * ```typescript
   * const oracle = new PriceOracle({
   *   stalePriceThreshold: 30000,
   *   deviationAlertThreshold: 3,
   *   debug: true,
   * });
   * ```
   */
  constructor(config: PriceOracleConfig = {}) {
    this.config = {
      stalePriceThreshold:
        config.stalePriceThreshold ?? DEFAULT_CONFIG.stalePriceThreshold,
      minFeedsForMedian:
        config.minFeedsForMedian ?? DEFAULT_CONFIG.minFeedsForMedian,
      deviationAlertThreshold:
        config.deviationAlertThreshold ??
        DEFAULT_CONFIG.deviationAlertThreshold,
      updateInterval: config.updateInterval ?? DEFAULT_CONFIG.updateInterval,
      debug: config.debug ?? DEFAULT_CONFIG.debug,
      logger: config.logger ?? DEFAULT_CONFIG.logger,
    };

    this.log("info", "PriceOracle initialized", {
      stalePriceThreshold: this.config.stalePriceThreshold,
      minFeedsForMedian: this.config.minFeedsForMedian,
    });
  }

  // ============================================================================
  // Public Methods - Feed Management
  // ============================================================================

  /**
   * Add a price feed to the oracle
   *
   * @param name - Unique identifier for this feed
   * @param feed - BinancePriceFeed instance
   *
   * @example
   * ```typescript
   * const feed = new BinancePriceFeed({ symbols: ['BTCUSDT'] });
   * oracle.addFeed('binance', feed);
   * ```
   */
  addFeed(name: string, feed: BinancePriceFeed): void {
    if (this.feeds.has(name)) {
      this.log("warn", `Feed '${name}' already exists, replacing`);
    }

    this.feeds.set(name, feed);
    this.log("info", `Added feed: ${name}`);

    // Subscribe to feed updates if oracle is running
    if (this.isRunning) {
      this.subscribeToFeed(name, feed);
    }
  }

  /**
   * Remove a price feed from the oracle
   *
   * @param name - Feed identifier to remove
   *
   * @example
   * ```typescript
   * oracle.removeFeed('backup');
   * ```
   */
  removeFeed(name: string): void {
    const feed = this.feeds.get(name);
    if (!feed) {
      this.log("warn", `Feed '${name}' not found`);
      return;
    }

    this.feeds.delete(name);
    this.log("info", `Removed feed: ${name}`);
  }

  /**
   * Get list of registered feed names
   *
   * @returns Array of feed names
   */
  getFeedNames(): string[] {
    return Array.from(this.feeds.keys());
  }

  // ============================================================================
  // Public Methods - Lifecycle
  // ============================================================================

  /**
   * Start the price oracle
   *
   * Begins aggregating prices from all registered feeds.
   *
   * @example
   * ```typescript
   * await oracle.start();
   * ```
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      this.log("warn", "Oracle already running");
      return;
    }

    this.isRunning = true;
    this.log("info", "Starting PriceOracle...");

    // Subscribe to all feeds
    for (const [name, feed] of this.feeds) {
      this.subscribeToFeed(name, feed);
    }

    // Start aggregation interval
    this.updateIntervalHandle = setInterval(() => {
      this.aggregatePrices();
    }, this.config.updateInterval);

    // Initial aggregation
    this.aggregatePrices();

    this.log("info", "PriceOracle started", { feedCount: this.feeds.size });
  }

  /**
   * Stop the price oracle
   *
   * @example
   * ```typescript
   * oracle.stop();
   * ```
   */
  stop(): void {
    if (!this.isRunning) {
      this.log("warn", "Oracle not running");
      return;
    }

    this.isRunning = false;

    if (this.updateIntervalHandle) {
      clearInterval(this.updateIntervalHandle);
      this.updateIntervalHandle = null;
    }

    this.priceCache.clear();
    this.alerts = [];

    this.log("info", "PriceOracle stopped");
  }

  // ============================================================================
  // Public Methods - Price Access
  // ============================================================================

  /**
   * Get the aggregated price for a symbol
   *
   * Returns median price across all valid feeds.
   *
   * @param symbol - Trading pair symbol (e.g., 'BTCUSDT')
   * @returns Aggregated price or null if unavailable
   *
   * @example
   * ```typescript
   * const price = oracle.getPrice('BTCUSDT');
   * if (price && price.isReliable) {
   *   console.log(`BTC: $${price.price}`);
   * }
   * ```
   */
  getPrice(symbol: string): AggregatedPrice | null {
    const normalized = symbol.toUpperCase();
    return this.priceCache.get(normalized) ?? null;
  }

  /**
   * Get aggregated prices for multiple symbols
   *
   * @param symbols - Array of trading pair symbols
   * @returns Map of symbol to aggregated price
   */
  getPrices(symbols: string[]): Map<string, AggregatedPrice> {
    const result = new Map<string, AggregatedPrice>();

    for (const symbol of symbols) {
      const price = this.getPrice(symbol);
      if (price) {
        result.set(symbol.toUpperCase(), price);
      }
    }

    return result;
  }

  /**
   * Get all aggregated prices
   *
   * @returns Map of all symbol to aggregated price entries
   */
  getAllPrices(): Map<string, AggregatedPrice> {
    return new Map(this.priceCache);
  }

  /**
   * Get raw price from a specific feed
   *
   * Useful for debugging or comparing feed prices.
   *
   * @param feedName - Name of the feed
   * @param symbol - Trading pair symbol
   * @returns Price tick or null
   */
  getFeedPrice(feedName: string, symbol: string): PriceTick | null {
    const feed = this.feeds.get(feedName);
    if (!feed) {
      return null;
    }
    return feed.getPrice(symbol);
  }

  // ============================================================================
  // Public Methods - Game Currency Conversion
  // ============================================================================

  /**
   * Register a game currency for conversion
   *
   * @param config - Game currency configuration
   *
   * @example
   * ```typescript
   * oracle.registerGameCurrency({
   *   symbol: 'GOLD',
   *   usdPerUnit: 0.001, // 1000 GOLD = $1
   * });
   *
   * oracle.registerGameCurrency({
   *   symbol: 'GEMS',
   *   usdPerUnit: 0.01, // 100 GEMS = $1
   *   backingToken: 'USDT',
   *   backingRate: 100, // 1 USDT = 100 GEMS
   * });
   * ```
   */
  registerGameCurrency(config: GameCurrencyConfig): void {
    this.gameCurrencies.set(config.symbol.toUpperCase(), config);
    this.log("info", `Registered game currency: ${config.symbol}`, {
      usdPerUnit: config.usdPerUnit,
    });
  }

  /**
   * Convert game currency amount to USD value
   *
   * @param amount - Amount of game currency
   * @param gameCurrency - Game currency symbol
   * @returns USD value as string
   *
   * @example
   * ```typescript
   * const usd = oracle.convertToUSD('5000', 'GOLD');
   * console.log(`5000 GOLD = $${usd}`);
   * ```
   */
  convertToUSD(amount: string, gameCurrency: string): string {
    const currency = this.gameCurrencies.get(gameCurrency.toUpperCase());
    if (!currency) {
      this.log("warn", `Unknown game currency: ${gameCurrency}`);
      return "0";
    }

    const amountNum = parseFloat(amount);
    if (isNaN(amountNum)) {
      return "0";
    }

    const usdValue = amountNum * currency.usdPerUnit;
    return usdValue.toFixed(2);
  }

  /**
   * Convert USD amount to game currency
   *
   * @param usdAmount - USD amount
   * @param gameCurrency - Target game currency symbol
   * @returns Game currency amount as string
   *
   * @example
   * ```typescript
   * const gold = oracle.convertFromUSD('10.00', 'GOLD');
   * console.log(`$10 = ${gold} GOLD`);
   * ```
   */
  convertFromUSD(usdAmount: string, gameCurrency: string): string {
    const currency = this.gameCurrencies.get(gameCurrency.toUpperCase());
    if (!currency) {
      this.log("warn", `Unknown game currency: ${gameCurrency}`);
      return "0";
    }

    const usdNum = parseFloat(usdAmount);
    if (isNaN(usdNum) || currency.usdPerUnit === 0) {
      return "0";
    }

    const gameAmount = usdNum / currency.usdPerUnit;
    return gameAmount.toFixed(0);
  }

  /**
   * Convert crypto amount to game currency
   *
   * @param amount - Crypto amount
   * @param cryptoSymbol - Crypto symbol (e.g., 'BTCUSDT')
   * @param gameCurrency - Target game currency symbol
   * @returns Game currency amount as string
   *
   * @example
   * ```typescript
   * const gold = oracle.convertCryptoToGame('0.001', 'BTCUSDT', 'GOLD');
   * console.log(`0.001 BTC = ${gold} GOLD`);
   * ```
   */
  convertCryptoToGame(
    amount: string,
    cryptoSymbol: string,
    gameCurrency: string,
  ): string {
    const price = this.getPrice(cryptoSymbol);
    if (!price) {
      this.log("warn", `No price for ${cryptoSymbol}`);
      return "0";
    }

    const amountNum = parseFloat(amount);
    if (isNaN(amountNum)) {
      return "0";
    }

    const usdValue = amountNum * price.price;
    return this.convertFromUSD(usdValue.toString(), gameCurrency);
  }

  // ============================================================================
  // Public Methods - Subscriptions
  // ============================================================================

  /**
   * Subscribe to aggregated price updates
   *
   * @param callback - Function called on each price update
   * @returns Unsubscribe function
   *
   * @example
   * ```typescript
   * const unsub = oracle.subscribe((symbol, price) => {
   *   console.log(`${symbol}: $${price.price} (${price.feedCount} feeds)`);
   * });
   *
   * // Later...
   * unsub();
   * ```
   */
  subscribe(callback: OraclePriceCallback): () => void {
    this.priceSubscribers.add(callback);

    return () => {
      this.priceSubscribers.delete(callback);
    };
  }

  /**
   * Subscribe to price deviation alerts
   *
   * Called when prices across feeds deviate more than threshold.
   *
   * @param callback - Alert callback function
   * @returns Unsubscribe function
   *
   * @example
   * ```typescript
   * oracle.onDeviationAlert((symbol, deviation, prices) => {
   *   console.warn(`Price deviation for ${symbol}: ${deviation}%`);
   *   prices.forEach(p => console.log(`  ${p.feed}: $${p.price}`));
   * });
   * ```
   */
  onDeviationAlert(callback: DeviationAlertCallback): () => void {
    this.deviationSubscribers.add(callback);

    return () => {
      this.deviationSubscribers.delete(callback);
    };
  }

  // ============================================================================
  // Public Methods - Health & Monitoring
  // ============================================================================

  /**
   * Get oracle health status
   *
   * @returns Health status object
   *
   * @example
   * ```typescript
   * const health = oracle.getHealth();
   * if (!health.isRunning || health.healthyFeeds === 0) {
   *   alertOps('Price oracle unhealthy', health);
   * }
   * ```
   */
  getHealth(): OracleHealth {
    let healthyFeeds = 0;

    for (const [, feed] of this.feeds) {
      const feedHealth = feed.getHealth();
      if (feedHealth.isHealthy) {
        healthyFeeds++;
      }
    }

    return {
      isRunning: this.isRunning,
      feedCount: this.feeds.size,
      healthyFeeds,
      validSymbols: this.priceCache.size,
      totalSymbols: this.getTrackedSymbols().size,
      lastUpdateTime: this.lastUpdateTime,
      alerts: [...this.alerts],
      checkedAt: Date.now(),
    };
  }

  /**
   * Get all unique symbols tracked across all feeds
   *
   * @returns Set of symbol strings
   */
  getTrackedSymbols(): Set<string> {
    const symbols = new Set<string>();

    for (const [, feed] of this.feeds) {
      const prices = feed.getAllPrices();
      for (const symbol of prices.keys()) {
        symbols.add(symbol);
      }
    }

    return symbols;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Subscribe to a feed's price updates
   */
  private subscribeToFeed(name: string, feed: BinancePriceFeed): void {
    // Get all symbols from the feed
    const prices = feed.getAllPrices();
    const symbols = Array.from(prices.keys());

    if (symbols.length === 0) {
      this.log("debug", `Feed ${name} has no symbols yet`);
      return;
    }

    feed.subscribe({
      symbols,
      callback: (tick) => {
        this.log("debug", `Price update from ${name}`, {
          symbol: tick.symbol,
          price: tick.price,
        });
      },
    });
  }

  /**
   * Aggregate prices from all feeds
   */
  private aggregatePrices(): void {
    const now = Date.now();
    const allSymbols = this.getTrackedSymbols();

    for (const symbol of allSymbols) {
      const feedPrices: { feed: string; price: number; tick: PriceTick }[] = [];

      // Collect prices from all feeds
      for (const [feedName, feed] of this.feeds) {
        const tick = feed.getPrice(symbol);
        if (!tick) continue;

        // Check staleness
        const age = now - tick.timestamp;
        if (age > this.config.stalePriceThreshold) {
          this.log("debug", `Stale price from ${feedName} for ${symbol}`, {
            age,
            threshold: this.config.stalePriceThreshold,
          });
          continue;
        }

        feedPrices.push({ feed: feedName, price: tick.price, tick });
      }

      // Need minimum feeds
      if (feedPrices.length < this.config.minFeedsForMedian) {
        continue;
      }

      // Calculate median price
      const sortedPrices = feedPrices.map((p) => p.price).sort((a, b) => a - b);
      const mid = Math.floor(sortedPrices.length / 2);
      const medianPrice =
        sortedPrices.length % 2 === 0
          ? (sortedPrices[mid - 1] + sortedPrices[mid]) / 2
          : sortedPrices[mid];

      // Calculate standard deviation
      const mean =
        sortedPrices.reduce((a, b) => a + b, 0) / sortedPrices.length;
      const squaredDiffs = sortedPrices.map((p) => Math.pow(p - mean, 2));
      const avgSquaredDiff =
        squaredDiffs.reduce((a, b) => a + b, 0) / sortedPrices.length;
      const stdDev = Math.sqrt(avgSquaredDiff);
      const deviationPercent = mean > 0 ? (stdDev / mean) * 100 : 0;

      // Check for deviation alerts
      if (
        deviationPercent > this.config.deviationAlertThreshold &&
        feedPrices.length > 1
      ) {
        this.emitDeviationAlert(
          symbol,
          deviationPercent,
          feedPrices.map((p) => ({ feed: p.feed, price: p.price })),
        );
      }

      // Calculate averages for other metrics
      const avgChange24h =
        feedPrices.reduce((sum, p) => sum + p.tick.change24h, 0) /
        feedPrices.length;
      const totalVolume = feedPrices.reduce(
        (sum, p) => sum + p.tick.volume24h,
        0,
      );
      const latestTimestamp = Math.max(
        ...feedPrices.map((p) => p.tick.timestamp),
      );

      // Create aggregated price
      const aggregated: AggregatedPrice = {
        symbol,
        price: medianPrice,
        timestamp: latestTimestamp,
        feedCount: feedPrices.length,
        feeds: feedPrices.map((p) => p.feed),
        deviation: deviationPercent,
        isReliable:
          feedPrices.length >= this.config.minFeedsForMedian &&
          deviationPercent < this.config.deviationAlertThreshold,
        change24h: avgChange24h,
        volume24h: totalVolume,
      };

      // Update cache
      this.priceCache.set(symbol, aggregated);

      // Notify subscribers
      this.emitPriceUpdate(symbol, aggregated);
    }

    this.lastUpdateTime = now;
  }

  /**
   * Emit price update to subscribers
   */
  private emitPriceUpdate(symbol: string, price: AggregatedPrice): void {
    for (const callback of this.priceSubscribers) {
      try {
        callback(symbol, price);
      } catch (error) {
        this.log("error", "Price subscriber callback error", {
          error: (error as Error).message,
        });
      }
    }
  }

  /**
   * Emit deviation alert to subscribers
   */
  private emitDeviationAlert(
    symbol: string,
    deviation: number,
    prices: { feed: string; price: number }[],
  ): void {
    const alertMsg = `Price deviation for ${symbol}: ${deviation.toFixed(2)}%`;
    this.alerts.push(alertMsg);

    // Keep only last 10 alerts
    if (this.alerts.length > 10) {
      this.alerts.shift();
    }

    for (const callback of this.deviationSubscribers) {
      try {
        callback(symbol, deviation, prices);
      } catch (error) {
        this.log("error", "Deviation subscriber callback error", {
          error: (error as Error).message,
        });
      }
    }
  }

  /**
   * Log a message
   */
  private log(
    level: string,
    message: string,
    context?: Record<string, unknown>,
  ): void {
    if (level === "debug" && !this.config.debug) {
      return;
    }
    this.config.logger(level, message, context);
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a price oracle with default configuration
 *
 * @param feeds - Optional initial feeds to add
 * @returns Configured PriceOracle instance
 *
 * @example
 * ```typescript
 * const binanceFeed = new BinancePriceFeed({ symbols: ['BTCUSDT'] });
 * const oracle = createPriceOracle({ binance: binanceFeed });
 * await oracle.start();
 * ```
 */
export function createPriceOracle(
  feeds?: Record<string, BinancePriceFeed>,
  config?: PriceOracleConfig,
): PriceOracle {
  const oracle = new PriceOracle(config);

  if (feeds) {
    for (const [name, feed] of Object.entries(feeds)) {
      oracle.addFeed(name, feed);
    }
  }

  return oracle;
}

// ============================================================================
// Singleton Management
// ============================================================================

let globalOracle: PriceOracle | null = null;

/**
 * Get or create the global PriceOracle instance
 *
 * @param config - Configuration (only used on first call)
 * @returns Global PriceOracle instance
 */
export function getGlobalOracle(config?: PriceOracleConfig): PriceOracle {
  if (!globalOracle) {
    globalOracle = new PriceOracle(config);
  }
  return globalOracle;
}

/**
 * Check if global oracle exists
 */
export function hasGlobalOracle(): boolean {
  return globalOracle !== null;
}

/**
 * Reset the global oracle
 */
export function resetGlobalOracle(): void {
  if (globalOracle) {
    globalOracle.stop();
    globalOracle = null;
  }
}
