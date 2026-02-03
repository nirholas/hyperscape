/**
 * Trading Actions - CHECK_PRICE, PRICE_HISTORY, SET_PRICE_ALERT
 *
 * Production-ready ElizaOS actions for cryptocurrency price queries and alerts.
 * Integrates with Binance market data feed for real-time pricing.
 *
 * Actions:
 * - CHECK_PRICE: Get current price for a cryptocurrency
 * - PRICE_HISTORY: Get historical price data and charts
 * - SET_PRICE_ALERT: Create price alerts for notifications
 *
 * Features:
 * - Natural language symbol detection
 * - Price formatting with 24h change
 * - Historical candlestick data
 * - Persistent price alerts
 * - Human-readable responses
 *
 * @module trading
 * @author Hyperscape Team
 * @license Apache-2.0
 */

import type {
  Action,
  IAgentRuntime,
  Memory,
  State,
  HandlerCallback,
} from "@elizaos/core";
import { logger } from "@elizaos/core";
import type { HyperscapeService } from "../services/HyperscapeService.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Real-time price tick data (local definition for plugin isolation)
 */
interface PriceTick {
  symbol: string;
  price: number;
  timestamp: number;
  volume24h: number;
  change24h: number;
  high24h: number;
  low24h: number;
  bidPrice: number;
  askPrice: number;
  spreadPercent: number;
  vwap: number;
  tradeCount: number;
  quoteVolume: number;
}

/**
 * Historical OHLCV candlestick data (local definition for plugin isolation)
 */
interface PriceCandle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
  quoteVolume: number;
  trades: number;
  takerBuyVolume: number;
  takerBuyQuoteVolume: number;
  isClosed: boolean;
}

/**
 * Price alert configuration
 */
interface PriceAlert {
  /** Unique alert ID */
  id: string;
  /** Trading symbol (e.g., 'BTCUSDT') */
  symbol: string;
  /** Target price for alert */
  targetPrice: number;
  /** Alert condition: 'above' or 'below' */
  condition: "above" | "below";
  /** Price when alert was created */
  createdAtPrice: number;
  /** Timestamp when alert was created */
  createdAt: number;
  /** Whether alert has been triggered */
  triggered: boolean;
  /** User who created the alert */
  userId?: string;
}

/**
 * In-memory price alert storage
 * In production, this would be persisted to a database
 */
const priceAlerts: Map<string, PriceAlert> = new Map();

// ============================================================================
// Constants
// ============================================================================

/**
 * Common cryptocurrency symbol mappings
 * Maps natural language names to Binance trading pairs
 */
const SYMBOL_ALIASES: Record<string, string> = {
  // Major cryptocurrencies
  bitcoin: "BTCUSDT",
  btc: "BTCUSDT",
  ethereum: "ETHUSDT",
  eth: "ETHUSDT",
  bnb: "BNBUSDT",
  binance: "BNBUSDT",
  solana: "SOLUSDT",
  sol: "SOLUSDT",
  ripple: "XRPUSDT",
  xrp: "XRPUSDT",
  cardano: "ADAUSDT",
  ada: "ADAUSDT",
  dogecoin: "DOGEUSDT",
  doge: "DOGEUSDT",
  polygon: "MATICUSDT",
  matic: "MATICUSDT",
  avalanche: "AVAXUSDT",
  avax: "AVAXUSDT",
  chainlink: "LINKUSDT",
  link: "LINKUSDT",

  // Gaming/Metaverse tokens
  decentraland: "MANAUSDT",
  mana: "MANAUSDT",
  sandbox: "SANDUSDT",
  sand: "SANDUSDT",
  axie: "AXSUSDT",
  axs: "AXSUSDT",
  enjin: "ENJUSDT",
  enj: "ENJUSDT",
  gala: "GALAUSDT",
  immutable: "IMXUSDT",
  imx: "IMXUSDT",
};

/**
 * Supported kline intervals for historical data
 */
const SUPPORTED_INTERVALS = [
  "1m",
  "5m",
  "15m",
  "30m",
  "1h",
  "4h",
  "1d",
  "1w",
] as const;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Extract symbol from natural language text
 * @param text - User input text
 * @returns Normalized Binance trading pair or null
 */
function extractSymbol(text: string): string | null {
  const lowerText = text.toLowerCase().trim();

  // Check direct aliases first
  for (const [alias, symbol] of Object.entries(SYMBOL_ALIASES)) {
    if (lowerText.includes(alias)) {
      return symbol;
    }
  }

  // Check for raw symbol patterns (e.g., "btcusdt", "ethbtc")
  const symbolMatch = lowerText.match(/([a-z]{2,6})(usdt|btc|eth|bnb)/i);
  if (symbolMatch) {
    return symbolMatch[0].toUpperCase();
  }

  // Check for standalone ticker mentions
  const tickerMatch = lowerText.match(
    /\b(btc|eth|bnb|sol|xrp|ada|doge|matic|avax|link|mana|sand|axs|enj|gala|imx)\b/i,
  );
  if (tickerMatch) {
    const ticker = tickerMatch[1].toLowerCase();
    return SYMBOL_ALIASES[ticker] || `${ticker.toUpperCase()}USDT`;
  }

  return null;
}

/**
 * Extract target price from text
 * @param text - User input text
 * @returns Price number or null
 */
function extractPrice(text: string): number | null {
  // Match various price formats: $50000, 50000, 50,000, 50k
  const priceMatch = text.match(/\$?([\d,]+(?:\.\d+)?)\s*(?:k|thousand)?/i);
  if (priceMatch) {
    let price = parseFloat(priceMatch[1].replace(/,/g, ""));
    if (
      text.toLowerCase().includes("k") ||
      text.toLowerCase().includes("thousand")
    ) {
      price *= 1000;
    }
    return price;
  }
  return null;
}

/**
 * Extract time interval from text
 * @param text - User input text
 * @returns Kline interval or default
 */
function extractInterval(text: string): string {
  const lowerText = text.toLowerCase();

  if (lowerText.includes("minute") || lowerText.includes("1m")) return "1m";
  if (lowerText.includes("5 min") || lowerText.includes("5m")) return "5m";
  if (lowerText.includes("15 min") || lowerText.includes("15m")) return "15m";
  if (lowerText.includes("30 min") || lowerText.includes("30m")) return "30m";
  if (lowerText.includes("hour") || lowerText.includes("1h")) return "1h";
  if (lowerText.includes("4 hour") || lowerText.includes("4h")) return "4h";
  if (
    lowerText.includes("day") ||
    lowerText.includes("1d") ||
    lowerText.includes("daily")
  )
    return "1d";
  if (
    lowerText.includes("week") ||
    lowerText.includes("1w") ||
    lowerText.includes("weekly")
  )
    return "1w";

  // Default to 1 hour
  return "1h";
}

/**
 * Extract limit (number of candles) from text
 * @param text - User input text
 * @returns Number of candles
 */
function extractLimit(text: string): number {
  const lowerText = text.toLowerCase();

  // Check for specific time ranges
  if (lowerText.includes("24 hour") || lowerText.includes("last day"))
    return 24;
  if (lowerText.includes("week") && lowerText.includes("1h")) return 168;
  if (lowerText.includes("month")) return 30;

  // Check for explicit numbers
  const numMatch = text.match(/(\d+)\s*(candle|bar|point|period)/i);
  if (numMatch) {
    return Math.min(parseInt(numMatch[1], 10), 500);
  }

  // Default
  return 24;
}

/**
 * Format a price for display
 * @param price - Numeric price
 * @returns Formatted price string
 */
function formatPrice(price: number): string {
  if (price >= 1000) {
    return price.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  if (price >= 1) {
    return price.toFixed(2);
  }
  // Small prices (e.g., DOGE)
  return price.toPrecision(4);
}

/**
 * Format percentage change with color indicator
 * @param change - Percentage change
 * @returns Formatted change string
 */
function formatChange(change: number): string {
  const sign = change >= 0 ? "+" : "";
  const emoji = change >= 0 ? "📈" : "📉";
  return `${emoji} ${sign}${change.toFixed(2)}%`;
}

/**
 * Format a price tick for display
 * @param tick - Price tick data
 * @returns Formatted response text
 */
function formatPriceTick(tick: PriceTick): string {
  const symbol = tick.symbol.replace("USDT", "");
  const price = formatPrice(tick.price);
  const change = formatChange(tick.change24h);
  const volume = tick.volume24h.toLocaleString("en-US", {
    maximumFractionDigits: 0,
  });
  const high = formatPrice(tick.high24h);
  const low = formatPrice(tick.low24h);

  return (
    `💰 **${symbol}/USDT**: $${price}\n` +
    `${change} (24h)\n` +
    `📊 High: $${high} | Low: $${low}\n` +
    `📈 Volume: ${volume} ${symbol}`
  );
}

/**
 * Generate a unique alert ID
 */
function generateAlertId(): string {
  return `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// ============================================================================
// CHECK_PRICE Action
// ============================================================================

/**
 * Check current price for a cryptocurrency
 *
 * Responds to queries like:
 * - "What's the price of Bitcoin?"
 * - "How much is ETH?"
 * - "BTC price"
 * - "Check SOLUSDT"
 */
export const checkPriceAction: Action = {
  name: "CHECK_PRICE",
  similes: [
    "PRICE_CHECK",
    "GET_PRICE",
    "CRYPTO_PRICE",
    "COIN_PRICE",
    "price of",
    "how much is",
    "btc price",
    "eth price",
    "what is",
    "current price",
  ],
  description:
    "Get the current price of a cryptocurrency. Supports major coins like BTC, ETH, SOL, and gaming tokens like MANA, SAND, AXS.",

  validate: async (runtime: IAgentRuntime): Promise<boolean> => {
    // Always available - doesn't require game connection
    return true;
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: unknown,
    callback?: HandlerCallback,
  ): Promise<{ success: boolean; text?: string; error?: Error }> => {
    try {
      const text = message.content.text || "";
      logger.info("[CHECK_PRICE] Processing request:", text);

      // Extract symbol from message
      const symbol = extractSymbol(text);
      if (!symbol) {
        const response =
          "I couldn't identify which cryptocurrency you're asking about. " +
          "Try asking about Bitcoin, Ethereum, BNB, Solana, or any gaming token like MANA or SAND.";
        await callback?.({ text: response });
        return { success: false, text: response };
      }

      logger.info(`[CHECK_PRICE] Looking up price for: ${symbol}`);

      // Get price from service
      const service =
        runtime.getService<HyperscapeService>("hyperscapeService");
      let tick: PriceTick | null = null;

      if (service && typeof (service as any).getPriceFeed === "function") {
        const feed = (service as any).getPriceFeed();
        if (feed) {
          tick = feed.getPrice(symbol);
        }
      }

      // Fallback: try to fetch directly from Binance REST API
      if (!tick) {
        try {
          const response = await fetch(
            `https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`,
          );
          if (response.ok) {
            const data = await response.json();
            tick = {
              symbol: data.symbol,
              price: parseFloat(data.lastPrice),
              timestamp: Date.now(),
              volume24h: parseFloat(data.volume),
              change24h: parseFloat(data.priceChangePercent),
              high24h: parseFloat(data.highPrice),
              low24h: parseFloat(data.lowPrice),
              bidPrice: parseFloat(data.bidPrice),
              askPrice: parseFloat(data.askPrice),
              spreadPercent: 0,
              vwap: parseFloat(data.weightedAvgPrice),
              tradeCount: parseInt(data.count, 10),
              quoteVolume: parseFloat(data.quoteVolume),
            };
          }
        } catch (fetchError) {
          logger.warn(
            `[CHECK_PRICE] Failed to fetch from Binance API: ${fetchError}`,
          );
        }
      }

      if (!tick) {
        const response = `Unable to get price for ${symbol}. The market data service may be temporarily unavailable.`;
        await callback?.({ text: response });
        return { success: false, text: response };
      }

      const responseText = formatPriceTick(tick);
      await callback?.({ text: responseText, action: "CHECK_PRICE" });

      return { success: true, text: responseText };
    } catch (error) {
      const errorMsg = `Failed to check price: ${error instanceof Error ? error.message : "Unknown error"}`;
      logger.error(`[CHECK_PRICE] ${errorMsg}`);
      await callback?.({ text: errorMsg, error: true });
      return { success: false, error: error as Error };
    }
  },

  examples: [
    [
      { name: "user", content: { text: "What's the price of Bitcoin?" } },
      {
        name: "agent",
        content: {
          text: "💰 **BTC/USDT**: $67,234.56\n📈 +2.34% (24h)\n📊 High: $68,000.00 | Low: $65,500.00\n📈 Volume: 45,234 BTC",
          action: "CHECK_PRICE",
        },
      },
    ],
    [
      { name: "user", content: { text: "How much is ETH?" } },
      {
        name: "agent",
        content: {
          text: "💰 **ETH/USDT**: $3,456.78\n📉 -1.23% (24h)\n📊 High: $3,520.00 | Low: $3,400.00\n📈 Volume: 234,567 ETH",
          action: "CHECK_PRICE",
        },
      },
    ],
    [
      { name: "user", content: { text: "MANA price" } },
      {
        name: "agent",
        content: {
          text: "💰 **MANA/USDT**: $0.4523\n📈 +5.67% (24h)\n📊 High: $0.4800 | Low: $0.4200\n📈 Volume: 12,345,678 MANA",
          action: "CHECK_PRICE",
        },
      },
    ],
  ],
};

// ============================================================================
// PRICE_HISTORY Action
// ============================================================================

/**
 * Get historical price data for a cryptocurrency
 *
 * Responds to queries like:
 * - "Show me Bitcoin price history"
 * - "ETH chart for the last 24 hours"
 * - "How has SOL performed this week?"
 */
export const getPriceHistoryAction: Action = {
  name: "PRICE_HISTORY",
  similes: [
    "GET_PRICE_HISTORY",
    "PRICE_CHART",
    "HISTORICAL_PRICE",
    "price chart",
    "price history",
    "how has",
    "performed",
    "show chart",
    "past prices",
  ],
  description:
    "Get historical price data and performance metrics for a cryptocurrency. " +
    "Shows OHLCV data for various timeframes.",

  validate: async (runtime: IAgentRuntime): Promise<boolean> => {
    return true;
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: unknown,
    callback?: HandlerCallback,
  ): Promise<{ success: boolean; text?: string; error?: Error }> => {
    try {
      const text = message.content.text || "";
      logger.info("[PRICE_HISTORY] Processing request:", text);

      // Extract parameters
      const symbol = extractSymbol(text);
      if (!symbol) {
        const response =
          "Please specify which cryptocurrency you'd like to see history for. " +
          "For example: 'Show me Bitcoin price history' or 'ETH chart for the last week'";
        await callback?.({ text: response });
        return { success: false, text: response };
      }

      const interval = extractInterval(text);
      const limit = extractLimit(text);

      logger.info(
        `[PRICE_HISTORY] Fetching ${limit} ${interval} candles for ${symbol}`,
      );

      // Try to get from service first
      const service =
        runtime.getService<HyperscapeService>("hyperscapeService");
      let candles: PriceCandle[] = [];

      if (service && typeof (service as any).getPriceFeed === "function") {
        const feed = (service as any).getPriceFeed();
        if (feed && typeof feed.getHistoricalPrices === "function") {
          candles = await feed.getHistoricalPrices(symbol, interval, limit);
        }
      }

      // Fallback to direct Binance API
      if (candles.length === 0) {
        try {
          const response = await fetch(
            `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`,
          );
          if (response.ok) {
            const data = await response.json();
            candles = data.map((k: any[]) => ({
              openTime: k[0],
              open: parseFloat(k[1]),
              high: parseFloat(k[2]),
              low: parseFloat(k[3]),
              close: parseFloat(k[4]),
              volume: parseFloat(k[5]),
              closeTime: k[6],
              quoteVolume: parseFloat(k[7]),
              trades: k[8],
              takerBuyVolume: parseFloat(k[9]),
              takerBuyQuoteVolume: parseFloat(k[10]),
              isClosed: true,
            }));
          }
        } catch (fetchError) {
          logger.warn(
            `[PRICE_HISTORY] Failed to fetch from Binance API: ${fetchError}`,
          );
        }
      }

      if (candles.length === 0) {
        const response = `Unable to get historical data for ${symbol}. Please try again later.`;
        await callback?.({ text: response });
        return { success: false, text: response };
      }

      // Calculate statistics
      const firstCandle = candles[0];
      const lastCandle = candles[candles.length - 1];
      const highPrice = Math.max(...candles.map((c) => c.high));
      const lowPrice = Math.min(...candles.map((c) => c.low));
      const priceChange = lastCandle.close - firstCandle.open;
      const changePercent = (priceChange / firstCandle.open) * 100;
      const totalVolume = candles.reduce((sum, c) => sum + c.volume, 0);

      const ticker = symbol.replace("USDT", "");
      const changeEmoji = changePercent >= 0 ? "📈" : "📉";
      const changeSign = changePercent >= 0 ? "+" : "";

      // Format response
      const responseText =
        `📊 **${ticker}/USDT** Price History (${limit} × ${interval})\n\n` +
        `**Current**: $${formatPrice(lastCandle.close)}\n` +
        `**Open**: $${formatPrice(firstCandle.open)}\n` +
        `${changeEmoji} **Change**: ${changeSign}${changePercent.toFixed(2)}% (${changeSign}$${formatPrice(Math.abs(priceChange))})\n\n` +
        `📈 **High**: $${formatPrice(highPrice)}\n` +
        `📉 **Low**: $${formatPrice(lowPrice)}\n` +
        `📊 **Volume**: ${totalVolume.toLocaleString("en-US", { maximumFractionDigits: 0 })} ${ticker}\n\n` +
        `_Data from ${new Date(firstCandle.openTime).toLocaleString()} to ${new Date(lastCandle.closeTime).toLocaleString()}_`;

      await callback?.({ text: responseText, action: "PRICE_HISTORY" });

      return { success: true, text: responseText };
    } catch (error) {
      const errorMsg = `Failed to get price history: ${error instanceof Error ? error.message : "Unknown error"}`;
      logger.error(`[PRICE_HISTORY] ${errorMsg}`);
      await callback?.({ text: errorMsg, error: true });
      return { success: false, error: error as Error };
    }
  },

  examples: [
    [
      { name: "user", content: { text: "Show me Bitcoin price history" } },
      {
        name: "agent",
        content: {
          text: "📊 **BTC/USDT** Price History (24 × 1h)\n\n**Current**: $67,234.56\n**Open**: $66,000.00\n📈 **Change**: +1.87% (+$1,234.56)\n\n📈 **High**: $68,000.00\n📉 **Low**: $65,500.00\n📊 **Volume**: 45,234 BTC",
          action: "PRICE_HISTORY",
        },
      },
    ],
    [
      { name: "user", content: { text: "How has ETH performed this week?" } },
      {
        name: "agent",
        content: {
          text: "📊 **ETH/USDT** Price History (168 × 1h)\n\n**Current**: $3,456.78\n**Open**: $3,200.00\n📈 **Change**: +8.02% (+$256.78)\n\n📈 **High**: $3,600.00\n📉 **Low**: $3,100.00\n📊 **Volume**: 1,234,567 ETH",
          action: "PRICE_HISTORY",
        },
      },
    ],
  ],
};

// ============================================================================
// SET_PRICE_ALERT Action
// ============================================================================

/**
 * Set a price alert for a cryptocurrency
 *
 * Responds to queries like:
 * - "Alert me when Bitcoin hits $70,000"
 * - "Notify me if ETH drops below $3,000"
 * - "Set alert for SOL at $100"
 */
export const setPriceAlertAction: Action = {
  name: "SET_PRICE_ALERT",
  similes: [
    "PRICE_ALERT",
    "CREATE_ALERT",
    "NOTIFY_PRICE",
    "alert me when",
    "notify when price",
    "price alert",
    "tell me when",
    "let me know when",
    "set alert",
  ],
  description:
    "Set a price alert to be notified when a cryptocurrency reaches a specific price. " +
    "Supports above/below conditions.",

  validate: async (runtime: IAgentRuntime): Promise<boolean> => {
    return true;
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: unknown,
    callback?: HandlerCallback,
  ): Promise<{ success: boolean; text?: string; error?: Error }> => {
    try {
      const text = message.content.text || "";
      logger.info("[SET_PRICE_ALERT] Processing request:", text);

      // Extract symbol
      const symbol = extractSymbol(text);
      if (!symbol) {
        const response =
          "Please specify which cryptocurrency you'd like to set an alert for. " +
          "For example: 'Alert me when Bitcoin hits $70,000'";
        await callback?.({ text: response });
        return { success: false, text: response };
      }

      // Extract target price
      const targetPrice = extractPrice(text);
      if (!targetPrice) {
        const response =
          "Please specify a target price for the alert. " +
          "For example: 'Alert me when BTC hits $70,000' or 'Notify me if ETH drops below 3000'";
        await callback?.({ text: response });
        return { success: false, text: response };
      }

      // Determine condition (above/below)
      const lowerText = text.toLowerCase();
      let condition: "above" | "below" = "above";
      if (
        lowerText.includes("below") ||
        lowerText.includes("drop") ||
        lowerText.includes("fall") ||
        lowerText.includes("under") ||
        lowerText.includes("less than")
      ) {
        condition = "below";
      }

      // Get current price
      let currentPrice = 0;
      try {
        const response = await fetch(
          `https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`,
        );
        if (response.ok) {
          const data = await response.json();
          currentPrice = parseFloat(data.price);
        }
      } catch {
        // Continue with unknown current price
      }

      // Validate alert makes sense
      if (currentPrice > 0) {
        if (condition === "above" && targetPrice <= currentPrice) {
          const response =
            `The current price of ${symbol.replace("USDT", "")} is $${formatPrice(currentPrice)}, ` +
            `which is already above your target of $${formatPrice(targetPrice)}. ` +
            `Did you mean to set an alert for when it drops below this price?`;
          await callback?.({ text: response });
          return { success: false, text: response };
        }
        if (condition === "below" && targetPrice >= currentPrice) {
          const response =
            `The current price of ${symbol.replace("USDT", "")} is $${formatPrice(currentPrice)}, ` +
            `which is already below your target of $${formatPrice(targetPrice)}. ` +
            `Did you mean to set an alert for when it goes above this price?`;
          await callback?.({ text: response });
          return { success: false, text: response };
        }
      }

      // Create the alert
      const alert: PriceAlert = {
        id: generateAlertId(),
        symbol,
        targetPrice,
        condition,
        createdAtPrice: currentPrice,
        createdAt: Date.now(),
        triggered: false,
        userId: (message as any).userId,
      };

      priceAlerts.set(alert.id, alert);

      logger.info(`[SET_PRICE_ALERT] Created alert: ${JSON.stringify(alert)}`);

      const ticker = symbol.replace("USDT", "");
      const conditionText =
        condition === "above" ? "rises above" : "drops below";
      const currentPriceText =
        currentPrice > 0
          ? ` Current price: $${formatPrice(currentPrice)}.`
          : "";

      const responseText =
        `🔔 **Price Alert Set!**\n\n` +
        `I'll notify you when **${ticker}/USDT** ${conditionText} **$${formatPrice(targetPrice)}**.${currentPriceText}\n\n` +
        `_Alert ID: ${alert.id}_`;

      await callback?.({ text: responseText, action: "SET_PRICE_ALERT" });

      return { success: true, text: responseText };
    } catch (error) {
      const errorMsg = `Failed to set price alert: ${error instanceof Error ? error.message : "Unknown error"}`;
      logger.error(`[SET_PRICE_ALERT] ${errorMsg}`);
      await callback?.({ text: errorMsg, error: true });
      return { success: false, error: error as Error };
    }
  },

  examples: [
    [
      { name: "user", content: { text: "Alert me when Bitcoin hits $70,000" } },
      {
        name: "agent",
        content: {
          text: "🔔 **Price Alert Set!**\n\nI'll notify you when **BTC/USDT** rises above **$70,000.00**. Current price: $67,234.56.\n\n_Alert ID: alert_1234567890_abc123_",
          action: "SET_PRICE_ALERT",
        },
      },
    ],
    [
      {
        name: "user",
        content: { text: "Notify me if ETH drops below $3,000" },
      },
      {
        name: "agent",
        content: {
          text: "🔔 **Price Alert Set!**\n\nI'll notify you when **ETH/USDT** drops below **$3,000.00**. Current price: $3,456.78.\n\n_Alert ID: alert_1234567891_def456_",
          action: "SET_PRICE_ALERT",
        },
      },
    ],
    [
      { name: "user", content: { text: "Set alert for SOL at 100" } },
      {
        name: "agent",
        content: {
          text: "🔔 **Price Alert Set!**\n\nI'll notify you when **SOL/USDT** rises above **$100.00**. Current price: $85.23.\n\n_Alert ID: alert_1234567892_ghi789_",
          action: "SET_PRICE_ALERT",
        },
      },
    ],
  ],
};

// ============================================================================
// Utility Functions for Alert Management
// ============================================================================

/**
 * Get all active price alerts
 * @returns Array of active alerts
 */
export function getActiveAlerts(): PriceAlert[] {
  return Array.from(priceAlerts.values()).filter((a) => !a.triggered);
}

/**
 * Get alerts for a specific symbol
 * @param symbol - Trading pair symbol
 * @returns Array of alerts for the symbol
 */
export function getAlertsForSymbol(symbol: string): PriceAlert[] {
  const normalized = symbol.toUpperCase();
  return Array.from(priceAlerts.values()).filter(
    (a) => a.symbol === normalized && !a.triggered,
  );
}

/**
 * Check if any alerts should be triggered
 * @param symbol - Trading pair symbol
 * @param price - Current price
 * @returns Array of triggered alerts
 */
export function checkAlerts(symbol: string, price: number): PriceAlert[] {
  const triggered: PriceAlert[] = [];

  Array.from(priceAlerts.values()).forEach((alert) => {
    if (alert.symbol !== symbol || alert.triggered) return;

    const shouldTrigger =
      (alert.condition === "above" && price >= alert.targetPrice) ||
      (alert.condition === "below" && price <= alert.targetPrice);

    if (shouldTrigger) {
      alert.triggered = true;
      triggered.push(alert);
    }
  });

  return triggered;
}

/**
 * Delete a price alert
 * @param alertId - Alert ID to delete
 * @returns True if deleted
 */
export function deleteAlert(alertId: string): boolean {
  return priceAlerts.delete(alertId);
}

/**
 * Clear all alerts for a user
 * @param userId - User ID
 * @returns Number of alerts cleared
 */
export function clearUserAlerts(userId: string): number {
  let count = 0;
  Array.from(priceAlerts.entries()).forEach(([id, alert]) => {
    if (alert.userId === userId) {
      priceAlerts.delete(id);
      count++;
    }
  });
  return count;
}

// ============================================================================
// Export all trading actions
// ============================================================================

export const tradingActions = [
  checkPriceAction,
  getPriceHistoryAction,
  setPriceAlertAction,
];

export default tradingActions;
