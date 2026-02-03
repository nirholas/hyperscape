/**
 * Solana Actions - Wallet generation, balance check, transfers, vanity addresses
 *
 * Production-ready Solana blockchain actions for Hyperscape AI agents.
 * Enables agents to manage Solana wallets and perform SOL transfers.
 *
 * Features:
 * - Secure wallet generation with Ed25519
 * - Balance checking on any Solana cluster
 * - SOL transfers with validation
 * - Vanity address generation with progress updates
 * - Devnet airdrop support
 *
 * Environment Variables:
 * - SOLANA_CLUSTER: Network (mainnet-beta, devnet, testnet)
 * - SOLANA_RPC_URL: Optional custom RPC endpoint
 * - SOLANA_SECRET_KEY: Optional pre-existing wallet (JSON array format)
 *
 * @module actions/solana
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
import { z } from "zod";
import {
  SolanaWalletService,
  DEVNET_RPC_URL,
  MAINNET_RPC_URL,
  TESTNET_RPC_URL,
  lamportsToSol,
  solToLamports,
  isMainnetCluster,
  type SolanaWallet,
  type SolanaCluster,
  type VanityProgress,
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

/** Max vanity pattern length (longer = exponentially slower) */
const MAX_VANITY_LENGTH = 4;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Gets the configured Solana RPC URL
 */
function getSolanaRpcUrl(): string {
  // Check for custom RPC URL first
  if (process.env.SOLANA_RPC_URL) {
    return process.env.SOLANA_RPC_URL;
  }

  // Use cluster-based URL
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
 * Creates a Solana wallet service instance
 */
function createService(): SolanaWalletService {
  return new SolanaWalletService({
    rpcUrl: getSolanaRpcUrl(),
    commitment: "confirmed",
  });
}

/**
 * Gets or creates the agent's Solana wallet
 * Stores wallet in runtime settings
 */
async function getOrCreateWallet(
  runtime: IAgentRuntime,
): Promise<SolanaWallet> {
  // Check for existing wallet in environment
  const existingKey = process.env.SOLANA_SECRET_KEY;
  if (existingKey) {
    try {
      const secretKey = JSON.parse(existingKey) as number[];
      return SolanaWalletService.fromSecretKey(new Uint8Array(secretKey));
    } catch (e) {
      logger.warn("[Solana] Failed to parse SOLANA_SECRET_KEY:", String(e));
    }
  }

  // Check for wallet stored in runtime settings
  const storedKey = runtime.getSetting("SOLANA_SECRET_KEY");
  if (storedKey && typeof storedKey === "string") {
    try {
      const secretKey = JSON.parse(storedKey) as number[];
      return SolanaWalletService.fromSecretKey(new Uint8Array(secretKey));
    } catch (e) {
      logger.warn("[Solana] Failed to parse stored wallet:", String(e));
    }
  }

  // Generate new wallet
  const wallet = SolanaWalletService.generate();
  const address = SolanaWalletService.toBase58(wallet.publicKey);

  // Store the wallet (in memory only - would need secure storage for production)
  const exported = SolanaWalletService.toExport(wallet);
  runtime.setSetting("SOLANA_SECRET_KEY", JSON.stringify(exported.secretKey));

  logger.info(`[Solana] Generated new wallet: ${address}`);
  return wallet;
}

/**
 * Format a Solana balance for display
 */
function formatBalance(sol: string): string {
  const num = parseFloat(sol);
  if (num === 0) return "0 SOL";
  if (num < 0.001) return `${num.toExponential(2)} SOL`;
  return `${num.toLocaleString(undefined, { maximumFractionDigits: 9 })} SOL`;
}

// ============================================================================
// Validation Schemas
// ============================================================================

/** Schema for balance check parameters */
const balanceParamsSchema = z.object({
  address: z.string().min(32).max(44).optional(),
});

/** Schema for transfer parameters */
const transferParamsSchema = z.object({
  to: z.string().min(32).max(44),
  amount: z.string().regex(/^\d+\.?\d*$/, "Invalid amount format"),
  memo: z.string().max(256).optional(),
});

/** Schema for vanity address parameters */
const vanityParamsSchema = z.object({
  prefix: z.string().max(MAX_VANITY_LENGTH).optional(),
  suffix: z.string().max(MAX_VANITY_LENGTH).optional(),
  ignoreCase: z.boolean().optional().default(false),
});

/** Schema for airdrop parameters */
const airdropParamsSchema = z.object({
  amount: z
    .string()
    .regex(/^\d+\.?\d*$/)
    .default("1"),
  address: z.string().min(32).max(44).optional(),
});

// ============================================================================
// Actions
// ============================================================================

/**
 * Generate a new Solana wallet
 */
export const generateSolanaWalletAction: Action = {
  name: "GENERATE_SOLANA_WALLET",
  similes: [
    "create solana wallet",
    "new solana address",
    "generate sol wallet",
    "create sol address",
    "make solana wallet",
  ],
  description: "Generates a new Solana wallet with secure Ed25519 keypair",

  validate: async (_runtime: IAgentRuntime) => {
    return true; // No validation needed for generation
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: unknown,
    callback?: HandlerCallback,
  ) => {
    logger.info("[Solana] Generating new wallet...");

    try {
      // Generate a fresh wallet (not using stored one)
      const wallet = SolanaWalletService.generate();
      const address = SolanaWalletService.toBase58(wallet.publicKey);
      const exported = SolanaWalletService.toExport(wallet);

      // Store as the agent's wallet
      runtime.setSetting(
        "SOLANA_SECRET_KEY",
        JSON.stringify(exported.secretKey),
      );

      const cluster = getCurrentCluster();
      const explorerUrl =
        cluster === "mainnet-beta"
          ? `https://solscan.io/account/${address}`
          : `https://solscan.io/account/${address}?cluster=${cluster}`;

      // Clear sensitive data
      SolanaWalletService.zeroize(wallet);

      const response = `✅ **New Solana Wallet Generated**

📍 **Address:** \`${address}\`
🌐 **Network:** ${cluster}
🔗 **Explorer:** ${explorerUrl}

⚠️ **Security Notes:**
- The private key is stored securely in memory
- For production, export and backup your keypair
- Never share your private key with anyone

💡 Use "check solana balance" to see your balance.`;

      if (callback) {
        await callback({
          text: response,
          content: {
            success: true,
            address,
            cluster,
            explorerUrl,
          },
        });
      }

      return {
        success: true,
        text: response,
        values: { address, cluster, explorerUrl },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error("[Solana] Failed to generate wallet:", errorMessage);

      if (callback) {
        await callback({
          text: `❌ Failed to generate Solana wallet: ${errorMessage}`,
          content: { success: false, error: errorMessage },
        });
      }

      return { success: false, error: error as Error };
    }
  },

  examples: [
    [
      {
        name: "{{user1}}",
        content: { text: "Create a new Solana wallet for me" },
      },
      {
        name: "{{agentName}}",
        content: {
          text: "I'll generate a new Solana wallet for you...",
          actions: ["GENERATE_SOLANA_WALLET"],
        },
      },
    ],
    [
      {
        name: "{{user1}}",
        content: { text: "I need a Solana address" },
      },
      {
        name: "{{agentName}}",
        content: {
          text: "Let me create a Solana wallet for you...",
          actions: ["GENERATE_SOLANA_WALLET"],
        },
      },
    ],
  ],
};

/**
 * Check Solana wallet balance
 */
export const checkSolanaBalanceAction: Action = {
  name: "CHECK_SOLANA_BALANCE",
  similes: [
    "solana balance",
    "how much sol",
    "sol wallet balance",
    "check sol",
    "my solana balance",
    "sol balance",
  ],
  description: "Checks the SOL balance of a Solana wallet",

  validate: async (_runtime: IAgentRuntime) => {
    return true;
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: unknown,
    callback?: HandlerCallback,
  ) => {
    logger.info("[Solana] Checking balance...");

    try {
      // Parse optional address from message
      const text =
        typeof message.content === "string"
          ? message.content
          : message.content?.text || "";

      // Try to extract an address from the message
      const addressMatch = text.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/);
      let targetAddress: string;

      if (addressMatch) {
        // Validate the extracted address
        const validation = SolanaWalletService.isValidAddress(addressMatch[0]);
        if (validation.valid) {
          targetAddress = addressMatch[0];
        } else {
          // Fall back to agent's wallet
          const wallet = await getOrCreateWallet(runtime);
          targetAddress = SolanaWalletService.toBase58(wallet.publicKey);
          SolanaWalletService.zeroize(wallet);
        }
      } else {
        // Use agent's wallet
        const wallet = await getOrCreateWallet(runtime);
        targetAddress = SolanaWalletService.toBase58(wallet.publicKey);
        SolanaWalletService.zeroize(wallet);
      }

      const service = createService();
      const balance = await service.getBalance(targetAddress);
      const cluster = getCurrentCluster();

      const explorerUrl =
        cluster === "mainnet-beta"
          ? `https://solscan.io/account/${targetAddress}`
          : `https://solscan.io/account/${targetAddress}?cluster=${cluster}`;

      const isOwnWallet = !addressMatch;
      const walletLabel = isOwnWallet ? "Your Solana Wallet" : "Wallet";

      const response = `💰 **${walletLabel} Balance**

📍 **Address:** \`${targetAddress}\`
💎 **Balance:** ${formatBalance(balance.sol)}
🔢 **Lamports:** ${balance.lamports}
🌐 **Network:** ${cluster}
🔗 **Explorer:** ${explorerUrl}`;

      if (callback) {
        await callback({
          text: response,
          content: {
            success: true,
            address: targetAddress,
            balance: balance.sol,
            lamports: balance.lamports,
            cluster,
            isOwnWallet,
          },
        });
      }

      return {
        success: true,
        text: response,
        values: {
          address: targetAddress,
          balance: balance.sol,
          lamports: balance.lamports,
          cluster,
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error("[Solana] Failed to check balance:", errorMessage);

      if (callback) {
        await callback({
          text: `❌ Failed to check Solana balance: ${errorMessage}`,
          content: { success: false, error: errorMessage },
        });
      }

      return { success: false, error: error as Error };
    }
  },

  examples: [
    [
      {
        name: "{{user1}}",
        content: { text: "What's my Solana balance?" },
      },
      {
        name: "{{agentName}}",
        content: {
          text: "Let me check your Solana balance...",
          actions: ["CHECK_SOLANA_BALANCE"],
        },
      },
    ],
    [
      {
        name: "{{user1}}",
        content: {
          text: "Check balance of 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
        },
      },
      {
        name: "{{agentName}}",
        content: {
          text: "I'll check the balance of that address...",
          actions: ["CHECK_SOLANA_BALANCE"],
        },
      },
    ],
  ],
};

/**
 * Send SOL to another address
 */
export const sendSolAction: Action = {
  name: "SEND_SOL",
  similes: [
    "send sol",
    "transfer solana",
    "send solana",
    "transfer sol",
    "pay with sol",
    "send lamports",
  ],
  description: "Sends SOL from your wallet to another Solana address",

  validate: async (_runtime: IAgentRuntime) => {
    // Must have a wallet configured
    const hasWallet =
      !!process.env.SOLANA_SECRET_KEY ||
      !!_runtime.getSetting("SOLANA_SECRET_KEY");
    return hasWallet;
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: unknown,
    callback?: HandlerCallback,
  ) => {
    logger.info("[Solana] Processing SOL transfer...");

    try {
      // Parse transfer details from message
      const text =
        typeof message.content === "string"
          ? message.content
          : message.content?.text || "";

      // Extract address
      const addressMatch = text.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/);
      if (!addressMatch) {
        if (callback) {
          await callback({
            text: "❌ Please provide a valid Solana address to send to.",
            content: { success: false, error: "No address provided" },
          });
        }
        return { success: false, error: new Error("No address provided") };
      }

      const toAddress = addressMatch[0];
      const validation = SolanaWalletService.isValidAddress(toAddress);
      if (!validation.valid) {
        if (callback) {
          await callback({
            text: `❌ Invalid Solana address: ${validation.error}`,
            content: { success: false, error: validation.error },
          });
        }
        return { success: false, error: new Error(validation.error) };
      }

      // Extract amount
      const amountMatch = text.match(/(\d+\.?\d*)\s*(sol|SOL|lamports)?/i);
      if (!amountMatch) {
        if (callback) {
          await callback({
            text: "❌ Please specify an amount to send (e.g., '0.1 SOL').",
            content: { success: false, error: "No amount provided" },
          });
        }
        return { success: false, error: new Error("No amount provided") };
      }

      const amountStr = amountMatch[1];
      const unit = amountMatch[2]?.toLowerCase() || "sol";
      const lamports =
        unit === "lamports"
          ? amountStr
          : solToLamports(parseFloat(amountStr)).toString();

      // Warn on mainnet
      const cluster = getCurrentCluster();
      if (isMainnetCluster(cluster)) {
        logger.warn("[Solana] ⚠️ MAINNET TRANSFER - REAL FUNDS");
      }

      // Get wallet and create service
      const wallet = await getOrCreateWallet(runtime);
      const fromAddress = SolanaWalletService.toBase58(wallet.publicKey);
      const service = createService();

      // Check balance first
      const balance = await service.getBalance(fromAddress);
      if (BigInt(balance.lamports) < BigInt(lamports)) {
        SolanaWalletService.zeroize(wallet);
        if (callback) {
          await callback({
            text: `❌ Insufficient balance. You have ${formatBalance(balance.sol)} but tried to send ${formatBalance(lamportsToSol(lamports))}.`,
            content: { success: false, error: "Insufficient balance" },
          });
        }
        return { success: false, error: new Error("Insufficient balance") };
      }

      // Execute transfer
      const result = await service.transfer(wallet, {
        to: toAddress,
        lamports,
      });

      // Clean up
      SolanaWalletService.zeroize(wallet);

      const explorerUrl =
        cluster === "mainnet-beta"
          ? `https://solscan.io/tx/${result.signature}`
          : `https://solscan.io/tx/${result.signature}?cluster=${cluster}`;

      const response = `✅ **SOL Transfer Sent!**

📤 **From:** \`${fromAddress}\`
📥 **To:** \`${toAddress}\`
💎 **Amount:** ${formatBalance(lamportsToSol(lamports))}
📝 **Signature:** \`${result.signature}\`
📊 **Status:** ${result.status}
🌐 **Network:** ${cluster}
🔗 **Explorer:** ${explorerUrl}`;

      if (callback) {
        await callback({
          text: response,
          content: {
            success: true,
            signature: result.signature,
            from: fromAddress,
            to: toAddress,
            amount: lamportsToSol(lamports),
            lamports,
            status: result.status,
            explorerUrl,
          },
        });
      }

      return {
        success: true,
        text: response,
        values: {
          signature: result.signature,
          from: fromAddress,
          to: toAddress,
          amount: lamportsToSol(lamports),
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error("[Solana] Transfer failed:", errorMessage);

      if (callback) {
        await callback({
          text: `❌ Transfer failed: ${errorMessage}`,
          content: { success: false, error: errorMessage },
        });
      }

      return { success: false, error: error as Error };
    }
  },

  examples: [
    [
      {
        name: "{{user1}}",
        content: {
          text: "Send 0.1 SOL to 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
        },
      },
      {
        name: "{{agentName}}",
        content: {
          text: "I'll send 0.1 SOL to that address...",
          actions: ["SEND_SOL"],
        },
      },
    ],
    [
      {
        name: "{{user1}}",
        content: { text: "Transfer 1 SOL to my friend at ABC123..." },
      },
      {
        name: "{{agentName}}",
        content: {
          text: "Processing the SOL transfer...",
          actions: ["SEND_SOL"],
        },
      },
    ],
  ],
};

/**
 * Generate a vanity Solana address
 */
export const generateVanityAddressAction: Action = {
  name: "GENERATE_VANITY_ADDRESS",
  similes: [
    "vanity address",
    "custom address",
    "address starting with",
    "address ending with",
    "custom solana address",
    "personalized address",
  ],
  description:
    "Generates a Solana vanity address with a custom prefix or suffix",

  validate: async (_runtime: IAgentRuntime) => {
    return true;
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: unknown,
    callback?: HandlerCallback,
  ) => {
    logger.info("[Solana] Generating vanity address...");

    try {
      // Parse vanity options from message
      const text =
        typeof message.content === "string"
          ? message.content
          : message.content?.text || "";

      // Extract prefix pattern
      const prefixMatch = text.match(
        /(?:prefix|starting?\s*with|begins?\s*with)\s*[:\-]?\s*["']?([1-9A-HJ-NP-Za-km-z]+)["']?/i,
      );
      const suffixMatch = text.match(
        /(?:suffix|ending?\s*with|ends?\s*with)\s*[:\-]?\s*["']?([1-9A-HJ-NP-Za-km-z]+)["']?/i,
      );

      const prefix = prefixMatch?.[1];
      const suffix = suffixMatch?.[1];

      if (!prefix && !suffix) {
        if (callback) {
          await callback({
            text: `❌ Please specify a prefix or suffix for your vanity address.

**Examples:**
- "Generate address starting with 'Sol'"
- "Create address ending with 'AI'"
- "Vanity address with prefix 'Game' and suffix 'X'"

⚠️ Note: Longer patterns take exponentially longer to generate. Max ${MAX_VANITY_LENGTH} characters recommended.`,
            content: { success: false, error: "No pattern specified" },
          });
        }
        return { success: false, error: new Error("No pattern specified") };
      }

      // Validate pattern length
      const totalLength = (prefix?.length || 0) + (suffix?.length || 0);
      if (totalLength > MAX_VANITY_LENGTH) {
        if (callback) {
          await callback({
            text: `❌ Pattern too long! Combined prefix+suffix must be ≤${MAX_VANITY_LENGTH} characters.

Your pattern: ${prefix || ""}...${suffix || ""} (${totalLength} chars)

💡 Tip: Each additional character makes generation ~58x slower.`,
            content: { success: false, error: "Pattern too long" },
          });
        }
        return { success: false, error: new Error("Pattern too long") };
      }

      // Notify user about potentially long operation
      if (callback) {
        const estimatedAttempts = Math.pow(58, totalLength);
        await callback({
          text: `🔄 Generating vanity address...

**Pattern:** ${prefix ? `starts with "${prefix}"` : ""}${prefix && suffix ? " and " : ""}${suffix ? `ends with "${suffix}"` : ""}
**Estimated attempts:** ~${estimatedAttempts.toLocaleString()}

This may take a while. I'll update you on progress...`,
          content: { status: "generating", prefix, suffix, estimatedAttempts },
        });
      }

      let lastProgress: VanityProgress | null = null;

      const result = await SolanaWalletService.generateVanity({
        prefix,
        suffix,
        ignoreCase:
          text.toLowerCase().includes("case insensitive") ||
          text.toLowerCase().includes("ignore case"),
        maxAttempts: 10_000_000, // Safety limit
        onProgress: (progress) => {
          lastProgress = progress;
          // Log progress periodically
          if (progress.attempts % 100_000 === 0) {
            logger.info(
              `[Solana] Vanity generation: ${progress.attempts.toLocaleString()} attempts, ` +
                `${Math.round(progress.rate).toLocaleString()}/sec`,
            );
          }
        },
      });

      const address = SolanaWalletService.toBase58(result.wallet.publicKey);
      const exported = SolanaWalletService.toExport(result.wallet);

      // Store as the agent's wallet
      runtime.setSetting(
        "SOLANA_SECRET_KEY",
        JSON.stringify(exported.secretKey),
      );

      const cluster = getCurrentCluster();
      const explorerUrl =
        cluster === "mainnet-beta"
          ? `https://solscan.io/account/${address}`
          : `https://solscan.io/account/${address}?cluster=${cluster}`;

      // Clean up
      SolanaWalletService.zeroize(result.wallet);

      const response = `✅ **Vanity Address Generated!**

📍 **Address:** \`${address}\`
🎯 **Pattern:** ${prefix ? `prefix "${prefix}"` : ""}${prefix && suffix ? " + " : ""}${suffix ? `suffix "${suffix}"` : ""}
🔄 **Attempts:** ${result.attempts.toLocaleString()}
⏱️ **Time:** ${(result.durationMs / 1000).toFixed(1)}s
🌐 **Network:** ${cluster}
🔗 **Explorer:** ${explorerUrl}

⚠️ The private key has been stored. Make sure to back it up securely!`;

      if (callback) {
        await callback({
          text: response,
          content: {
            success: true,
            address,
            prefix,
            suffix,
            attempts: result.attempts,
            durationMs: result.durationMs,
            explorerUrl,
          },
        });
      }

      return {
        success: true,
        text: response,
        values: {
          address,
          prefix,
          suffix,
          attempts: result.attempts,
          durationMs: result.durationMs,
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error("[Solana] Vanity generation failed:", errorMessage);

      if (callback) {
        await callback({
          text: `❌ Vanity address generation failed: ${errorMessage}`,
          content: { success: false, error: errorMessage },
        });
      }

      return { success: false, error: error as Error };
    }
  },

  examples: [
    [
      {
        name: "{{user1}}",
        content: { text: "Generate an address starting with 'Sol'" },
      },
      {
        name: "{{agentName}}",
        content: {
          text: "I'll generate a vanity address with that prefix...",
          actions: ["GENERATE_VANITY_ADDRESS"],
        },
      },
    ],
    [
      {
        name: "{{user1}}",
        content: { text: "Create a custom Solana address ending with 'AI'" },
      },
      {
        name: "{{agentName}}",
        content: {
          text: "Generating a vanity address ending with 'AI'...",
          actions: ["GENERATE_VANITY_ADDRESS"],
        },
      },
    ],
  ],
};

/**
 * Request devnet airdrop
 */
export const requestSolanaAirdropAction: Action = {
  name: "REQUEST_SOLANA_AIRDROP",
  similes: [
    "airdrop sol",
    "get test sol",
    "devnet airdrop",
    "free sol",
    "faucet",
    "request sol",
  ],
  description:
    "Requests a SOL airdrop on devnet or testnet (not available on mainnet)",

  validate: async (_runtime: IAgentRuntime) => {
    const cluster = getCurrentCluster();
    // Airdrops only work on devnet/testnet
    return cluster === "devnet" || cluster === "testnet";
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: unknown,
    callback?: HandlerCallback,
  ) => {
    logger.info("[Solana] Requesting airdrop...");

    try {
      const cluster = getCurrentCluster();

      // Verify we're not on mainnet
      if (isMainnetCluster(cluster)) {
        if (callback) {
          await callback({
            text: "❌ Airdrops are not available on mainnet. Please switch to devnet or testnet.",
            content: {
              success: false,
              error: "Mainnet does not support airdrops",
            },
          });
        }
        return {
          success: false,
          error: new Error("Mainnet does not support airdrops"),
        };
      }

      // Parse optional amount from message
      const text =
        typeof message.content === "string"
          ? message.content
          : message.content?.text || "";

      const amountMatch = text.match(/(\d+\.?\d*)\s*sol/i);
      let requestAmount = 1; // Default 1 SOL

      if (amountMatch) {
        requestAmount = parseFloat(amountMatch[1]);
        // Cap at 2 SOL (devnet limit)
        if (requestAmount > 2) {
          requestAmount = 2;
          logger.info(
            "[Solana] Capping airdrop request to 2 SOL (devnet limit)",
          );
        }
      }

      // Get wallet
      const wallet = await getOrCreateWallet(runtime);
      const address = SolanaWalletService.toBase58(wallet.publicKey);
      SolanaWalletService.zeroize(wallet);

      // Request airdrop
      const service = createService();
      const lamports = solToLamports(requestAmount).toString();
      const result = await service.requestAirdrop(address, lamports);

      const explorerUrl = `https://solscan.io/tx/${result.signature}?cluster=${cluster}`;

      const response = `💧 **Airdrop Requested!**

📍 **Address:** \`${address}\`
💎 **Amount:** ${requestAmount} SOL
📝 **Signature:** \`${result.signature}\`
🌐 **Network:** ${cluster}
🔗 **Explorer:** ${explorerUrl}

⏳ The airdrop should arrive within a few seconds. Use "check solana balance" to verify.`;

      if (callback) {
        await callback({
          text: response,
          content: {
            success: true,
            signature: result.signature,
            address,
            amount: requestAmount.toString(),
            cluster,
            explorerUrl,
          },
        });
      }

      return {
        success: true,
        text: response,
        values: {
          signature: result.signature,
          address,
          amount: requestAmount.toString(),
          cluster,
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error("[Solana] Airdrop failed:", errorMessage);

      // Check for rate limiting
      const isRateLimited =
        errorMessage.includes("rate limit") ||
        errorMessage.includes("too many requests");

      if (callback) {
        await callback({
          text: isRateLimited
            ? "❌ Airdrop rate limited. Please wait a few minutes and try again."
            : `❌ Airdrop failed: ${errorMessage}`,
          content: { success: false, error: errorMessage, isRateLimited },
        });
      }

      return { success: false, error: error as Error };
    }
  },

  examples: [
    [
      {
        name: "{{user1}}",
        content: { text: "Give me some test SOL" },
      },
      {
        name: "{{agentName}}",
        content: {
          text: "I'll request an airdrop from the devnet faucet...",
          actions: ["REQUEST_SOLANA_AIRDROP"],
        },
      },
    ],
    [
      {
        name: "{{user1}}",
        content: { text: "Airdrop 2 SOL to my wallet" },
      },
      {
        name: "{{agentName}}",
        content: {
          text: "Requesting 2 SOL from the devnet faucet...",
          actions: ["REQUEST_SOLANA_AIRDROP"],
        },
      },
    ],
  ],
};

// ============================================================================
// Exports
// ============================================================================

/**
 * All Solana actions for the plugin
 */
export const solanaActions = [
  generateSolanaWalletAction,
  checkSolanaBalanceAction,
  sendSolAction,
  generateVanityAddressAction,
  requestSolanaAirdropAction,
];
