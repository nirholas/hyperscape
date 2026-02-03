/**
 * Market Data Provider - Supplies Real-time Crypto Prices to Agent Context
 *
 * Production-ready ElizaOS provider that supplies top cryptocurrency prices
 * to the agent's context for informed decision-making and conversations.
 *
 * Features:
 * - Top 10 crypto prices with 24h changes
 * - 60-second cache with automatic refresh
 * - Human-readable formatted output
 * - Gaming token prices (MANA, SAND, AXS)
 * - Market sentiment indicators
 * - REST API fallback for reliability
 *
 * Context Output Example:
 * ```
 * # Current Crypto Market Prices
 *
 * Market Sentiment: 🟢 Bullish (7/10 coins up)
 *
 * | Coin | Price | 24h Change |
 * |------|-------|------------|
 * | BTC | $67,234.56 | 📈 +2.34% |
 * | ETH | $3,456.78 | 📉 -1.23% |
 * ...
 *
 * Last updated: 2:34:56 PM
 * ```
 *
 * @module marketProvider
 * @author Hyperscape Team
 * @license Apache-2.0
 */

import type {
  Provider,
  IAgentRuntime,
  Memory,
  State,
  ProviderResult,
} from "@elizaos/core";
import { logger } from "@elizaos/core";
import type { HyperscapeService } from "../services/HyperscapeService.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Market price data structure
 */
interface MarketPrice {
  /** Trading symbol (e.g., 'BTCUSDT') */
  symbol: string;
  /** Display name (e.g., 'BTC') */
  displayName: string;
  /** Current price in USD */
  price: number;
  /** 24h price change percentage */
  change24h: number;
  /** 24h trading volume */
  volume24h: number;
  /** Market cap rank (1 = highest) */
  rank: number;
  /** Timestamp of price data */
  timestamp: number;
}

/**
 * Cached market data
 */
interface CachedMarketData {
  prices: MarketPrice[];
  timestamp: number;
  sentiment: "bullish" | "bearish" | "neutral";
  upCount: number;
  downCount: number;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Cache TTL in milliseconds (60 seconds)
 */
const CACHE_TTL_MS = 60 * 1000;

/**
 * Top 10 coins to track (by relevance to gaming)
 */
const TOP_COINS = [
  { symbol: "BTCUSDT", name: "BTC", fullName: "Bitcoin" },
  { symbol: "ETHUSDT", name: "ETH", fullName: "Ethereum" },
  { symbol: "BNBUSDT", name: "BNB", fullName: "BNB Chain" },
  { symbol: "SOLUSDT", name: "SOL", fullName: "Solana" },
  { symbol: "MATICUSDT", name: "MATIC", fullName: "Polygon" },
  { symbol: "MANAUSDT", name: "MANA", fullName: "Decentraland" },
  { symbol: "SANDUSDT", name: "SAND", fullName: "The Sandbox" },
  { symbol: "AXSUSDT", name: "AXS", fullName: "Axie Infinity" },
  { symbol: "GALAUSDT", name: "GALA", fullName: "Gala Games" },
  { symbol: "IMXUSDT", name: "IMX", fullName: "Immutable X" },
] as const;

// ============================================================================
// Cache Storage
// ============================================================================

/**
 * In-memory cache for market data
 */
let marketCache: CachedMarketData | null = null;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Format a price for display
 * @param price - Numeric price
 * @returns Formatted price string
 */
function formatPrice(price: number): string {
  if (price >= 1000) {
    return `$${price.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
  if (price >= 1) {
    return `$${price.toFixed(2)}`;
  }
  // For small prices (e.g., some gaming tokens)
  if (price >= 0.01) {
    return `$${price.toFixed(4)}`;
  }
  return `$${price.toPrecision(4)}`;
}

/**
 * Format percentage change with emoji
 * @param change - Percentage change
 * @returns Formatted change string
 */
function formatChange(change: number): string {
  const emoji = change >= 0 ? "📈" : "📉";
  const sign = change >= 0 ? "+" : "";
  return `${emoji} ${sign}${change.toFixed(2)}%`;
}

/**
 * Get market sentiment based on price changes
 * @param prices - Array of market prices
 * @returns Sentiment data
 */
function calculateSentiment(prices: MarketPrice[]): {
  sentiment: "bullish" | "bearish" | "neutral";
  upCount: number;
  downCount: number;
} {
  let upCount = 0;
  let downCount = 0;

  for (const price of prices) {
    if (price.change24h >= 0) {
      upCount++;
    } else {
      downCount++;
    }
  }

  let sentiment: "bullish" | "bearish" | "neutral";
  if (upCount >= prices.length * 0.6) {
    sentiment = "bullish";
  } else if (downCount >= prices.length * 0.6) {
    sentiment = "bearish";
  } else {
    sentiment = "neutral";
  }

  return { sentiment, upCount, downCount };
}

/**
 * Get sentiment emoji
 * @param sentiment - Market sentiment
 * @returns Emoji indicator
 */
function getSentimentEmoji(
  sentiment: "bullish" | "bearish" | "neutral",
): string {
  switch (sentiment) {
    case "bullish":
      return "🟢";
    case "bearish":
      return "🔴";
    default:
      return "🟡";
  }
}

/**
 * Check if cache is still valid
 * @returns True if cache is valid
 */
function isCacheValid(): boolean {
  if (!marketCache) return false;
  return Date.now() - marketCache.timestamp < CACHE_TTL_MS;
}

/**
 * Fetch market data from Binance API
 * @returns Array of market prices
 */
async function fetchMarketData(): Promise<MarketPrice[]> {
  const symbols = TOP_COINS.map((c) => c.symbol);
  const prices: MarketPrice[] = [];

  try {
    // Fetch all tickers in one request
    const symbolsParam = JSON.stringify(symbols);
    const response = await fetch(
      `https://api.binance.com/api/v3/ticker/24hr?symbols=${encodeURIComponent(symbolsParam)}`,
    );

    if (!response.ok) {
      throw new Error(`Binance API error: ${response.status}`);
    }

    const data = await response.json();

    for (let i = 0; i < data.length; i++) {
      const ticker = data[i];
      const coinInfo = TOP_COINS.find((c) => c.symbol === ticker.symbol);

      if (coinInfo) {
        prices.push({
          symbol: ticker.symbol,
          displayName: coinInfo.name,
          price: parseFloat(ticker.lastPrice),
          change24h: parseFloat(ticker.priceChangePercent),
          volume24h: parseFloat(ticker.volume),
          rank: TOP_COINS.findIndex((c) => c.symbol === ticker.symbol) + 1,
          timestamp: Date.now(),
        });
      }
    }

    // Sort by original rank order
    prices.sort((a, b) => a.rank - b.rank);

    return prices;
  } catch (error) {
    logger.error(`[marketProvider] Failed to fetch market data: ${error}`);
    return [];
  }
}

/**
 * Fetch market data, using cache if available
 * @returns Cached market data
 */
async function getMarketData(): Promise<CachedMarketData | null> {
  // Return cached data if valid
  if (isCacheValid() && marketCache) {
    return marketCache;
  }

  // Fetch fresh data
  const prices = await fetchMarketData();

  if (prices.length === 0) {
    // Return stale cache if fetch failed
    return marketCache;
  }

  // Calculate sentiment
  const { sentiment, upCount, downCount } = calculateSentiment(prices);

  // Update cache
  marketCache = {
    prices,
    timestamp: Date.now(),
    sentiment,
    upCount,
    downCount,
  };

  return marketCache;
}

/**
 * Format market data as a readable string for agent context
 * @param data - Market data
 * @returns Formatted string
 */
function formatMarketContext(data: CachedMarketData): string {
  const sentimentEmoji = getSentimentEmoji(data.sentiment);
  const sentimentText =
    data.sentiment.charAt(0).toUpperCase() + data.sentiment.slice(1);

  let output = `# Current Crypto Market Prices\n\n`;
  output += `**Market Sentiment**: ${sentimentEmoji} ${sentimentText} (${data.upCount}/${data.prices.length} coins up)\n\n`;

  // Table header
  output += `| Coin | Price | 24h Change |\n`;
  output += `|------|-------|------------|\n`;

  // Table rows
  for (const price of data.prices) {
    output += `| ${price.displayName} | ${formatPrice(price.price)} | ${formatChange(price.change24h)} |\n`;
  }

  // Footer
  const updateTime = new Date(data.timestamp).toLocaleTimeString();
  output += `\n_Last updated: ${updateTime}_\n`;

  // Notable changes
  const bigMovers = data.prices.filter((p) => Math.abs(p.change24h) >= 5);
  if (bigMovers.length > 0) {
    output += `\n**Notable Movers**:\n`;
    for (const mover of bigMovers) {
      const direction = mover.change24h >= 0 ? "up" : "down";
      output += `- ${mover.displayName} is ${direction} ${Math.abs(mover.change24h).toFixed(1)}%\n`;
    }
  }

  return output;
}

// ============================================================================
// Market Provider
// ============================================================================

/**
 * Market data provider for ElizaOS agents
 *
 * Supplies real-time cryptocurrency prices to the agent's context,
 * enabling informed responses about market conditions.
 *
 * Updates every 60 seconds via TTL cache.
 */
export const marketProvider: Provider = {
  name: "marketProvider",
  description:
    "Provides real-time cryptocurrency market prices including major coins (BTC, ETH, SOL) " +
    "and gaming tokens (MANA, SAND, AXS). Updates every 60 seconds.",

  /**
   * Get market data for agent context
   *
   * @param runtime - Agent runtime
   * @param message - Current message
   * @param state - Current state
   * @returns Provider result with market data
   */
  get: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
  ): Promise<ProviderResult> => {
    try {
      logger.debug("[marketProvider] Fetching market data");

      // Try to use service price feed if available
      const service =
        runtime.getService<HyperscapeService>("hyperscapeService");
      let usedServiceFeed = false;

      if (service && typeof (service as any).getPriceFeed === "function") {
        const feed = (service as any).getPriceFeed();
        if (feed) {
          const allPrices = feed.getAllPrices();
          if (allPrices.size > 0) {
            // Convert feed prices to our format
            const prices: MarketPrice[] = [];

            for (const coinInfo of TOP_COINS) {
              const tick = allPrices.get(coinInfo.symbol);
              if (tick) {
                prices.push({
                  symbol: coinInfo.symbol,
                  displayName: coinInfo.name,
                  price: tick.price,
                  change24h: tick.change24h,
                  volume24h: tick.volume24h,
                  rank:
                    TOP_COINS.findIndex((c) => c.symbol === coinInfo.symbol) +
                    1,
                  timestamp: tick.timestamp,
                });
              }
            }

            if (prices.length > 0) {
              const { sentiment, upCount, downCount } =
                calculateSentiment(prices);
              marketCache = {
                prices,
                timestamp: Date.now(),
                sentiment,
                upCount,
                downCount,
              };
              usedServiceFeed = true;
            }
          }
        }
      }

      // Fallback to direct API fetch
      if (!usedServiceFeed) {
        await getMarketData();
      }

      if (!marketCache) {
        return {
          text: "Market data temporarily unavailable. Please try again later.",
          values: {},
        };
      }

      const contextText = formatMarketContext(marketCache);

      logger.debug(
        `[marketProvider] Returning ${marketCache.prices.length} prices, sentiment: ${marketCache.sentiment}`,
      );

      return {
        text: contextText,
        values: {
          marketSentiment: marketCache.sentiment,
          btcPrice:
            marketCache.prices.find((p) => p.displayName === "BTC")?.price ?? 0,
          ethPrice:
            marketCache.prices.find((p) => p.displayName === "ETH")?.price ?? 0,
          topGainers: marketCache.prices
            .filter((p) => p.change24h > 0)
            .sort((a, b) => b.change24h - a.change24h)
            .slice(0, 3)
            .map((p) => p.displayName),
          topLosers: marketCache.prices
            .filter((p) => p.change24h < 0)
            .sort((a, b) => a.change24h - b.change24h)
            .slice(0, 3)
            .map((p) => p.displayName),
          lastUpdated: new Date(marketCache.timestamp).toISOString(),
        },
      };
    } catch (error) {
      logger.error(`[marketProvider] Error: ${error}`);
      return {
        text: "Unable to fetch market data at this time.",
        values: {},
      };
    }
  },
};

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Force refresh market data cache
 * @returns Updated market data or null
 */
export async function refreshMarketCache(): Promise<CachedMarketData | null> {
  marketCache = null;
  return getMarketData();
}

/**
 * Get current cache status
 * @returns Cache info
 */
export function getCacheStatus(): {
  isCached: boolean;
  ageMs: number | null;
  priceCount: number;
} {
  return {
    isCached: !!marketCache,
    ageMs: marketCache ? Date.now() - marketCache.timestamp : null,
    priceCount: marketCache?.prices.length ?? 0,
  };
}

/**
 * Get price for a specific symbol from cache
 * @param symbol - Trading pair (e.g., 'BTCUSDT') or short name (e.g., 'BTC')
 * @returns Market price or null
 */
export function getCachedPrice(symbol: string): MarketPrice | null {
  if (!marketCache) return null;

  const upperSymbol = symbol.toUpperCase();

  // Try exact match first
  let price = marketCache.prices.find((p) => p.symbol === upperSymbol);
  if (price) return price;

  // Try display name match
  price = marketCache.prices.find((p) => p.displayName === upperSymbol);
  if (price) return price;

  // Try with USDT suffix
  if (!upperSymbol.endsWith("USDT")) {
    price = marketCache.prices.find((p) => p.symbol === `${upperSymbol}USDT`);
  }

  return price ?? null;
}

/**
 * Get all cached prices
 * @returns Array of cached prices or empty array
 */
export function getAllCachedPrices(): MarketPrice[] {
  return marketCache?.prices ?? [];
}

/**
 * Get current market sentiment
 * @returns Sentiment or null if no data
 */
export function getMarketSentiment(): {
  sentiment: "bullish" | "bearish" | "neutral";
  upCount: number;
  downCount: number;
} | null {
  if (!marketCache) return null;

  return {
    sentiment: marketCache.sentiment,
    upCount: marketCache.upCount,
    downCount: marketCache.downCount,
  };
}

export default marketProvider;
