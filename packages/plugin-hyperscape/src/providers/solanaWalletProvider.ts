/**
 * solanaWalletProvider - Supplies Solana wallet context to the agent
 *
 * Production-ready wallet provider that integrates with Solana RPC
 * to provide real-time balance and account information.
 *
 * Provides:
 * - Wallet address (if configured)
 * - SOL balance
 * - SPL token balances
 * - Network status
 *
 * Features:
 * - 30-second TTL cache for balance data
 * - Human-readable formatting for agent consumption
 * - Automatic refresh on cache expiry
 * - Real blockchain integration via Solana RPC
 *
 * Environment Variables:
 * - SOLANA_CLUSTER: Network (mainnet-beta, devnet, testnet)
 * - SOLANA_RPC_URL: Optional custom RPC endpoint
 * - SOLANA_SECRET_KEY: Optional pre-existing wallet (JSON array format)
 *
 * @module providers/solanaWalletProvider
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
import {
  SolanaWalletService,
  SPLTokenService,
  DEVNET_RPC_URL,
  MAINNET_RPC_URL,
  TESTNET_RPC_URL,
  lamportsToSol,
  isMainnetCluster,
  COMMON_SPL_TOKENS,
  type SolanaCluster,
  type SolanaBalance,
  type SPLTokenBalance,
} from "@hyperscape/shared";

// ============================================================================
// Constants & Configuration
// ============================================================================

/** Supported Solana clusters */
const CLUSTER_RPC_URLS: Record<string, string> = {
  "mainnet-beta": MAINNET_RPC_URL,
  mainnet: MAINNET_RPC_URL,
  devnet: DEVNET_RPC_URL,
  testnet: TESTNET_RPC_URL,
};

/** Default cluster for operations */
const DEFAULT_CLUSTER = "devnet";

/** Cache time-to-live in milliseconds (30 seconds) */
const CACHE_TTL_MS = 30 * 1000;

/** Maximum number of token balances to display */
const MAX_TOKENS_DISPLAYED = 10;

// ============================================================================
// Types
// ============================================================================

/**
 * Solana wallet balance data structure
 */
export interface SolanaWalletData {
  /** Wallet address (base58) */
  address: string;
  /** Network/cluster name */
  cluster: SolanaCluster;
  /** SOL balance (human readable) */
  solBalance: string;
  /** SOL balance in lamports */
  lamports: string;
  /** SPL token balances */
  tokens: SPLTokenBalance[];
  /** Total estimated USD value (if available) */
  estimatedValueUsd?: string;
  /** Whether on mainnet (real funds) */
  isMainnet: boolean;
  /** Whether airdrop is available */
  canAirdrop: boolean;
  /** Cache timestamp */
  lastUpdated: number;
  /** Whether wallet is properly configured */
  isConfigured: boolean;
}

/**
 * Cached balance with TTL tracking
 */
interface CachedBalance {
  data: SolanaWalletData;
  timestamp: number;
}

// ============================================================================
// Cache Storage
// ============================================================================

/** In-memory cache for wallet balances, keyed by runtime ID */
const balanceCache = new Map<string, CachedBalance>();

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Gets the configured Solana RPC URL
 */
function getSolanaRpcUrl(): string {
  if (process.env.SOLANA_RPC_URL) {
    return process.env.SOLANA_RPC_URL;
  }

  const cluster = process.env.SOLANA_CLUSTER?.toLowerCase() || DEFAULT_CLUSTER;
  return CLUSTER_RPC_URLS[cluster] || DEVNET_RPC_URL;
}

/**
 * Gets the current cluster name
 */
function getCurrentCluster(): SolanaCluster {
  const cluster = process.env.SOLANA_CLUSTER?.toLowerCase() || DEFAULT_CLUSTER;
  if (cluster === "mainnet") return "mainnet-beta";
  return cluster as SolanaCluster;
}

/**
 * Format SOL amount for display
 */
function formatSol(sol: string): string {
  const num = parseFloat(sol);
  if (num === 0) return "0 SOL";
  if (num < 0.001) return `${num.toExponential(2)} SOL`;
  return `${num.toLocaleString(undefined, { maximumFractionDigits: 9 })} SOL`;
}

/**
 * Format token amount for display
 */
function formatTokenAmount(balance: SPLTokenBalance): string {
  const num = parseFloat(balance.uiBalance);
  if (num === 0) return "0";
  if (num < 0.01) return num.toExponential(2);
  return num.toLocaleString(undefined, {
    maximumFractionDigits: balance.decimals,
  });
}

/**
 * Get token symbol from mint address
 */
function getTokenSymbol(mint: string): string {
  const entry = Object.entries(COMMON_SPL_TOKENS).find(
    ([, address]) => address === mint,
  );
  return entry ? entry[0] : `${mint.slice(0, 4)}...${mint.slice(-4)}`;
}

/**
 * Gets the wallet address from runtime settings
 */
async function getWalletAddress(
  runtime: IAgentRuntime,
): Promise<string | null> {
  // Check for wallet in environment
  const envKey = process.env.SOLANA_SECRET_KEY;
  if (envKey) {
    try {
      const secretKey = JSON.parse(envKey) as number[];
      const wallet = SolanaWalletService.fromSecretKey(
        new Uint8Array(secretKey),
      );
      const address = SolanaWalletService.toBase58(wallet.publicKey);
      SolanaWalletService.zeroize(wallet);
      return address;
    } catch (e) {
      logger.warn("[SolanaProvider] Failed to parse SOLANA_SECRET_KEY");
    }
  }

  // Check for wallet in runtime settings
  const storedKey = runtime.getSetting("SOLANA_SECRET_KEY");
  if (storedKey && typeof storedKey === "string") {
    try {
      const secretKey = JSON.parse(storedKey) as number[];
      const wallet = SolanaWalletService.fromSecretKey(
        new Uint8Array(secretKey),
      );
      const address = SolanaWalletService.toBase58(wallet.publicKey);
      SolanaWalletService.zeroize(wallet);
      return address;
    } catch (e) {
      logger.warn("[SolanaProvider] Failed to parse stored wallet");
    }
  }

  return null;
}

/**
 * Fetches fresh wallet data from the blockchain
 */
async function fetchWalletData(
  address: string,
): Promise<Omit<SolanaWalletData, "isConfigured">> {
  const rpcUrl = getSolanaRpcUrl();
  const cluster = getCurrentCluster();

  const walletService = new SolanaWalletService({
    rpcUrl,
    commitment: "confirmed",
  });

  const splService = new SPLTokenService({
    rpcUrl,
    commitment: "confirmed",
  });

  // Fetch SOL balance
  let solBalance: SolanaBalance;
  try {
    solBalance = await walletService.getBalance(address);
  } catch (error) {
    logger.warn(`[SolanaProvider] Failed to fetch SOL balance: ${error}`);
    solBalance = { sol: "0", lamports: "0" };
  }

  // Fetch SPL token balances
  let tokens: SPLTokenBalance[] = [];
  try {
    tokens = await splService.getAllTokenBalances(address);
    // Sort by value and limit
    tokens = tokens
      .filter((t) => parseFloat(t.balance) > 0)
      .slice(0, MAX_TOKENS_DISPLAYED);
  } catch (error) {
    logger.warn(`[SolanaProvider] Failed to fetch token balances: ${error}`);
  }

  return {
    address,
    cluster,
    solBalance: solBalance.sol,
    lamports: solBalance.lamports,
    tokens,
    isMainnet: isMainnetCluster(cluster),
    canAirdrop: cluster === "devnet" || cluster === "testnet",
    lastUpdated: Date.now(),
  };
}

/**
 * Gets cached or fetches fresh wallet data
 */
async function getWalletData(
  runtime: IAgentRuntime,
): Promise<SolanaWalletData | null> {
  const address = await getWalletAddress(runtime);

  if (!address) {
    return null;
  }

  const cacheKey = `${runtime.agentId}-solana-${address}`;
  const cached = balanceCache.get(cacheKey);

  // Check if cache is still valid
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  // Fetch fresh data
  try {
    const freshData = await fetchWalletData(address);
    const walletData: SolanaWalletData = {
      ...freshData,
      isConfigured: true,
    };

    // Update cache
    balanceCache.set(cacheKey, {
      data: walletData,
      timestamp: Date.now(),
    });

    return walletData;
  } catch (error) {
    logger.error(`[SolanaProvider] Failed to fetch wallet data: ${error}`);

    // Return stale cache if available
    if (cached) {
      logger.warn("[SolanaProvider] Using stale cached data");
      return cached.data;
    }

    return null;
  }
}

/**
 * Formats wallet data for agent consumption
 */
function formatWalletDataForAgent(data: SolanaWalletData | null): string {
  if (!data) {
    return `## Solana Wallet

**Status:** Not Configured

No Solana wallet is currently configured. Use "generate solana wallet" to create one.

**Available Actions:**
- Generate Solana Wallet: Create a new Solana wallet
- Generate Vanity Address: Create an address with custom prefix/suffix`;
  }

  const lines: string[] = [
    "## Solana Wallet",
    "",
    `**Address:** \`${data.address}\``,
    `**Network:** ${data.cluster}${data.isMainnet ? " ⚠️ MAINNET (Real Funds)" : ""}`,
    `**SOL Balance:** ${formatSol(data.solBalance)}`,
  ];

  // Add token balances if any
  if (data.tokens.length > 0) {
    lines.push("");
    lines.push("**SPL Token Balances:**");
    for (const token of data.tokens) {
      const symbol = getTokenSymbol(token.mint);
      lines.push(`- ${symbol}: ${formatTokenAmount(token)}`);
    }
  }

  // Add available actions
  lines.push("");
  lines.push("**Available Actions:**");
  lines.push("- Check Solana Balance: View current balance");
  lines.push("- Send SOL: Transfer SOL to another address");

  if (data.canAirdrop) {
    lines.push("- Request Airdrop: Get test SOL from faucet");
  }

  // Add network warning
  if (data.isMainnet) {
    lines.push("");
    lines.push(
      "⚠️ **Warning:** You are on MAINNET. Transactions involve real funds.",
    );
  }

  // Add cache info
  const cacheAge = Math.round((Date.now() - data.lastUpdated) / 1000);
  lines.push("");
  lines.push(`_Balance updated ${cacheAge}s ago_`);

  return lines.join("\n");
}

// ============================================================================
// Provider Implementation
// ============================================================================

/**
 * Solana wallet provider for ElizaOS agents.
 *
 * Provides real-time Solana wallet information including:
 * - SOL balance
 * - SPL token balances
 * - Network status
 * - Available actions
 *
 * @example
 * // The provider is automatically registered with the plugin
 * // Agent will have access to wallet context in conversations
 */
export const solanaWalletProvider: Provider = {
  name: "solanaWalletProvider",
  description:
    "Provides Solana wallet address, SOL balance, and SPL token information",

  get: async (
    runtime: IAgentRuntime,
    _message: Memory,
    _state?: State,
  ): Promise<ProviderResult> => {
    try {
      const walletData = await getWalletData(runtime);
      const formattedOutput = formatWalletDataForAgent(walletData);

      return {
        text: formattedOutput,
        values: walletData
          ? {
              solanaAddress: walletData.address,
              solanaCluster: walletData.cluster,
              solanaSolBalance: walletData.solBalance,
              solanaLamports: walletData.lamports,
              solanaTokenCount: walletData.tokens.length,
              solanaIsMainnet: walletData.isMainnet,
              solanaCanAirdrop: walletData.canAirdrop,
              solanaIsConfigured: walletData.isConfigured,
            }
          : {
              solanaIsConfigured: false,
            },
      };
    } catch (error) {
      logger.error(`[SolanaProvider] Error: ${error}`);
      return {
        text: "## Solana Wallet\n\n**Status:** Error fetching wallet data\n\nPlease try again later.",
        values: {
          solanaIsConfigured: false,
          solanaError: String(error),
        },
      };
    }
  },
};

// ============================================================================
// Exports
// ============================================================================

export default solanaWalletProvider;
