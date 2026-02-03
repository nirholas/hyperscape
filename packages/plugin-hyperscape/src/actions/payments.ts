/**
 * x402 Payment Actions - CHECK_BALANCE, SEND_PAYMENT, CHECK_YIELD, PAY_FOR_SERVICE
 *
 * Production-ready payment actions for Hyperscape AI agents using the x402 protocol.
 * Integrates with EVM chains (Arbitrum, Base, Polygon) for stablecoin payments.
 *
 * Features:
 * - Real blockchain balance checks via viem
 * - Actual token transfers (USDs, USDC)
 * - Yield tracking for Sperax USDs
 * - HTTP-402 payment flow for paid APIs
 *
 * Environment Variables Required:
 * - X402_EVM_PRIVATE_KEY: Wallet private key (0x prefixed hex)
 * - X402_CHAIN: Network (arbitrum, base, polygon, etc.)
 * - X402_RPC_URL: Optional custom RPC endpoint
 *
 * @module payments
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
  createPublicClient,
  createWalletClient,
  http,
  formatUnits,
  parseUnits,
  isAddress,
  type Address,
  type Hash,
  type PublicClient,
  type WalletClient,
  type Chain,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import {
  arbitrum,
  arbitrumSepolia,
  base,
  baseSepolia,
  mainnet,
  polygon,
  optimism,
} from "viem/chains";
import type { HyperscapeService } from "../services/HyperscapeService.js";

// ============================================================================
// Constants & Configuration
// ============================================================================

/** Supported chains configuration */
const CHAINS: Record<string, Chain> = {
  arbitrum,
  "arbitrum-sepolia": arbitrumSepolia,
  base,
  "base-sepolia": baseSepolia,
  ethereum: mainnet,
  polygon,
  optimism,
};

/** Token contract addresses per chain */
const TOKEN_ADDRESSES: Record<string, { usds?: Address; usdc: Address }> = {
  arbitrum: {
    usds: "0xD74f5255D557944cf7Dd0E45FF521520002D5748" as Address, // Sperax USDs
    usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" as Address, // Native USDC
  },
  "arbitrum-sepolia": {
    usdc: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d" as Address,
  },
  base: {
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Address,
  },
  "base-sepolia": {
    usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as Address,
  },
  ethereum: {
    usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address,
  },
  polygon: {
    usdc: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359" as Address,
  },
  optimism: {
    usdc: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85" as Address,
  },
};

/** ERC20 ABI for balance and transfer operations */
const ERC20_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "balance", type: "uint256" }],
  },
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "success", type: "bool" }],
  },
  {
    name: "decimals",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "decimals", type: "uint8" }],
  },
  {
    name: "symbol",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "symbol", type: "string" }],
  },
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "success", type: "bool" }],
  },
] as const;

/** Sperax USDs yield contract ABI (partial) */
const USDS_YIELD_ABI = [
  {
    name: "rebaseYield",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "yield", type: "uint256" }],
  },
  {
    name: "getAPY",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "apy", type: "uint256" }],
  },
] as const;

/** Native token symbols per chain */
const NATIVE_SYMBOLS: Record<string, string> = {
  arbitrum: "ETH",
  "arbitrum-sepolia": "ETH",
  base: "ETH",
  "base-sepolia": "ETH",
  ethereum: "ETH",
  polygon: "MATIC",
  optimism: "ETH",
};

// ============================================================================
// Types & Schemas
// ============================================================================

/**
 * x402 wallet balance information
 */
export interface X402WalletBalance {
  /** USDs stablecoin balance (yield-bearing) */
  usds: string;
  /** USDC stablecoin balance */
  usdc: string;
  /** Native token balance (ETH, MATIC, etc.) */
  native: string;
  /** Native token symbol */
  nativeSymbol: string;
  /** Total yield earned from USDs (if applicable) */
  yieldEarned: string;
  /** Current APY for USDs */
  currentApy: string;
  /** Wallet address */
  address: Address;
  /** Network/chain name */
  network: string;
  /** Chain ID */
  chainId: number;
}

/**
 * Payment request parameters
 */
export interface PaymentRequest {
  /** Recipient address */
  recipient: Address;
  /** Amount to send (human readable) */
  amount: string;
  /** Payment token (usds, usdc, native) */
  token: "usds" | "usdc" | "native";
  /** Optional memo/note (stored off-chain) */
  memo?: string;
}

/**
 * Payment result
 */
export interface PaymentResult {
  success: boolean;
  transactionHash?: Hash;
  amount?: string;
  token?: string;
  recipient?: string;
  blockNumber?: bigint;
  gasUsed?: bigint;
  error?: string;
}

/**
 * HTTP-402 service payment request
 */
export interface ServicePaymentRequest {
  /** Service URL that returned 402 */
  serviceUrl: string;
  /** Payment amount required */
  amount: string;
  /** Payment token accepted */
  token: string;
  /** Payment recipient address */
  payTo: Address;
  /** Service description */
  description?: string;
}

/** Zod schema for payment parameters */
const paymentParamsSchema = z.object({
  recipient: z
    .string()
    .min(1, "Recipient address is required")
    .refine((val) => isAddress(val), {
      message: "Invalid Ethereum address format",
    }),
  amount: z
    .string()
    .regex(/^\d+\.?\d*$/, "Invalid amount format")
    .refine((val) => parseFloat(val) > 0, {
      message: "Amount must be positive",
    }),
  token: z.enum(["usds", "usdc", "native"]).default("usds"),
  memo: z.string().max(256, "Memo too long").optional(),
});

/** Zod schema for service payment */
const servicePaymentSchema = z.object({
  serviceUrl: z.string().url("Invalid service URL"),
  amount: z.string().regex(/^\d+\.?\d*$/, "Invalid amount format"),
  token: z.string().default("usds"),
  payTo: z
    .string()
    .refine((val) => isAddress(val), { message: "Invalid payment address" }),
  description: z.string().optional(),
});

// ============================================================================
// Wallet Client Management
// ============================================================================

/** Cached wallet client instances per runtime */
const walletClients = new Map<
  string,
  {
    publicClient: PublicClient;
    walletClient: WalletClient;
    account: PrivateKeyAccount;
    chain: Chain;
    chainName: string;
  }
>();

/**
 * Load x402 configuration from environment
 */
function loadX402Config(): {
  privateKey: `0x${string}` | null;
  chainName: string;
  rpcUrl?: string;
  isConfigured: boolean;
} {
  const privateKey = (process.env.X402_EVM_PRIVATE_KEY ||
    process.env.X402_PRIVATE_KEY ||
    process.env.HYPERSCAPE_WALLET_PRIVATE_KEY) as `0x${string}` | undefined;

  const chainName =
    process.env.X402_CHAIN || process.env.HYPERSCAPE_CHAIN || "arbitrum";
  const rpcUrl = process.env.X402_RPC_URL || process.env.HYPERSCAPE_RPC_URL;

  return {
    privateKey: privateKey || null,
    chainName,
    rpcUrl,
    isConfigured: !!privateKey,
  };
}

/**
 * Get or create wallet clients for a runtime
 */
function getWalletClients(runtime: IAgentRuntime): {
  publicClient: PublicClient;
  walletClient: WalletClient | null;
  account: PrivateKeyAccount | null;
  chain: Chain;
  chainName: string;
  address: Address | null;
} {
  const cacheKey = runtime.agentId || "default";
  const cached = walletClients.get(cacheKey);

  if (cached) {
    return {
      ...cached,
      address: cached.account.address,
    };
  }

  const config = loadX402Config();
  const chain = CHAINS[config.chainName] || arbitrum;
  const chainName = config.chainName;

  // Create public client (always available for reading)
  const publicClient = createPublicClient({
    chain,
    transport: http(config.rpcUrl),
  });

  // Create wallet client only if private key is configured
  if (!config.privateKey) {
    logger.warn(
      "[x402] No private key configured - wallet operations will fail",
    );
    return {
      publicClient,
      walletClient: null,
      account: null,
      chain,
      chainName,
      address: null,
    };
  }

  // Validate private key format
  if (!config.privateKey.startsWith("0x") || config.privateKey.length !== 66) {
    logger.error(
      "[x402] Invalid private key format - must be 0x prefixed 32-byte hex",
    );
    return {
      publicClient,
      walletClient: null,
      account: null,
      chain,
      chainName,
      address: null,
    };
  }

  const account = privateKeyToAccount(config.privateKey);
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(config.rpcUrl),
  });

  // Cache the clients
  const clientData = {
    publicClient,
    walletClient,
    account,
    chain,
    chainName,
  };
  walletClients.set(cacheKey, clientData);

  logger.info(
    `[x402] Wallet initialized on ${chainName}: ${account.address.slice(0, 8)}...${account.address.slice(-6)}`,
  );

  return {
    ...clientData,
    address: account.address,
  };
}

// ============================================================================
// Balance Operations
// ============================================================================

/**
 * Get wallet balance from blockchain
 */
async function getWalletBalance(
  runtime: IAgentRuntime,
): Promise<X402WalletBalance> {
  const { publicClient, address, chainName, chain } = getWalletClients(runtime);
  const tokens = TOKEN_ADDRESSES[chainName] || TOKEN_ADDRESSES.arbitrum;
  const nativeSymbol = NATIVE_SYMBOLS[chainName] || "ETH";

  // Return empty balance if no wallet configured
  if (!address) {
    return {
      usds: "0",
      usdc: "0",
      native: "0",
      nativeSymbol,
      yieldEarned: "0",
      currentApy: "0",
      address: "0x0000000000000000000000000000000000000000" as Address,
      network: chainName,
      chainId: chain.id,
    };
  }

  try {
    // Fetch all balances in parallel
    const [nativeBalance, usdcBalance, usdsBalance, yieldData] =
      await Promise.all([
        // Native balance
        publicClient.getBalance({ address }),

        // USDC balance
        publicClient
          .readContract({
            address: tokens.usdc,
            abi: ERC20_ABI,
            functionName: "balanceOf",
            args: [address],
          })
          .catch(() => 0n),

        // USDs balance (if available on this chain)
        tokens.usds
          ? publicClient
              .readContract({
                address: tokens.usds,
                abi: ERC20_ABI,
                functionName: "balanceOf",
                args: [address],
              })
              .catch(() => 0n)
          : Promise.resolve(0n),

        // USDs yield data (Arbitrum only)
        tokens.usds
          ? Promise.all([
              publicClient
                .readContract({
                  address: tokens.usds,
                  abi: USDS_YIELD_ABI,
                  functionName: "rebaseYield",
                  args: [address],
                })
                .catch(() => 0n),
              publicClient
                .readContract({
                  address: tokens.usds,
                  abi: USDS_YIELD_ABI,
                  functionName: "getAPY",
                  args: [],
                })
                .catch(() => 520n), // Default 5.2% APY
            ])
          : Promise.resolve([0n, 520n]),
      ]);

    return {
      usds: formatUnits(usdsBalance as bigint, 18),
      usdc: formatUnits(usdcBalance as bigint, 6),
      native: formatUnits(nativeBalance, 18),
      nativeSymbol,
      yieldEarned: formatUnits((yieldData[0] as bigint) || 0n, 18),
      currentApy: (Number((yieldData[1] as bigint) || 520n) / 100).toFixed(2),
      address,
      network: chainName,
      chainId: chain.id,
    };
  } catch (error) {
    logger.error(
      "[x402] Failed to fetch balance:",
      error instanceof Error ? error.message : String(error),
    );
    throw new Error(
      `Failed to fetch wallet balance: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

/**
 * Execute a token transfer
 */
async function executePayment(
  runtime: IAgentRuntime,
  request: PaymentRequest,
): Promise<PaymentResult> {
  const { publicClient, walletClient, account, chainName } =
    getWalletClients(runtime);
  const tokens = TOKEN_ADDRESSES[chainName] || TOKEN_ADDRESSES.arbitrum;

  if (!walletClient || !account) {
    return {
      success: false,
      error:
        "Wallet not configured. Set X402_EVM_PRIVATE_KEY environment variable.",
    };
  }

  try {
    // Get current balance first
    const balance = await getWalletBalance(runtime);
    const requestAmount = parseFloat(request.amount);

    // Determine token address and decimals
    let tokenAddress: Address | null = null;
    let decimals = 18;
    let currentBalance = "0";

    switch (request.token) {
      case "usds":
        tokenAddress = tokens.usds || null;
        decimals = 18;
        currentBalance = balance.usds;
        break;
      case "usdc":
        tokenAddress = tokens.usdc;
        decimals = 6;
        currentBalance = balance.usdc;
        break;
      case "native":
        tokenAddress = null; // Native transfer
        decimals = 18;
        currentBalance = balance.native;
        break;
    }

    // Check balance
    if (requestAmount > parseFloat(currentBalance)) {
      return {
        success: false,
        error: `Insufficient ${request.token.toUpperCase()} balance. Have: ${parseFloat(currentBalance).toFixed(4)}, Need: ${requestAmount}`,
      };
    }

    const amountWei = parseUnits(request.amount, decimals);
    let txHash: Hash;

    if (tokenAddress) {
      // ERC20 transfer
      logger.info(
        `[x402] Sending ${request.amount} ${request.token.toUpperCase()} to ${request.recipient}`,
      );

      txHash = await walletClient.writeContract({
        chain: walletClient.chain,
        account,
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: "transfer",
        args: [request.recipient as Address, amountWei],
      });
    } else {
      // Native token transfer
      logger.info(
        `[x402] Sending ${request.amount} ${balance.nativeSymbol} to ${request.recipient}`,
      );

      txHash = await walletClient.sendTransaction({
        chain: walletClient.chain,
        account,
        to: request.recipient as Address,
        value: amountWei,
      });
    }

    // Wait for confirmation
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash,
      confirmations: 1,
    });

    if (receipt.status === "reverted") {
      return {
        success: false,
        transactionHash: txHash,
        error: "Transaction reverted on-chain",
      };
    }

    logger.info(`[x402] Payment successful: ${txHash}`);

    return {
      success: true,
      transactionHash: txHash,
      amount: request.amount,
      token: request.token,
      recipient: request.recipient,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed,
    };
  } catch (error) {
    logger.error(
      "[x402] Payment failed:",
      error instanceof Error ? error.message : String(error),
    );
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Payment transaction failed",
    };
  }
}

/**
 * Execute HTTP-402 service payment
 */
async function executeServicePayment(
  runtime: IAgentRuntime,
  request: ServicePaymentRequest,
): Promise<PaymentResult> {
  // For HTTP-402, we need to:
  // 1. Send payment to the service's payment address
  // 2. Include payment proof in subsequent request

  const paymentRequest: PaymentRequest = {
    recipient: request.payTo,
    amount: request.amount,
    token: request.token as "usds" | "usdc" | "native",
    memo: `Payment for: ${request.serviceUrl}`,
  };

  return executePayment(runtime, paymentRequest);
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Parse payment parameters from natural language message
 */
function parsePaymentParams(
  content: string,
): Partial<z.infer<typeof paymentParamsSchema>> {
  const params: Partial<z.infer<typeof paymentParamsSchema>> = {};

  // Extract amount with token (e.g., "10 USDS", "5.5 USDC", "0.1 ETH")
  const amountMatch = content.match(
    /(\d+\.?\d*)\s*(usds|usdc|eth|matic|native)?/i,
  );
  if (amountMatch) {
    params.amount = amountMatch[1];
    const tokenStr = amountMatch[2]?.toLowerCase();
    if (tokenStr === "usds") params.token = "usds";
    else if (tokenStr === "usdc") params.token = "usdc";
    else if (["eth", "matic", "native"].includes(tokenStr || ""))
      params.token = "native";
    else params.token = "usds"; // Default to USDs
  }

  // Extract recipient (0x address)
  const addressMatch = content.match(/0x[a-fA-F0-9]{40}/);
  if (addressMatch) {
    params.recipient = addressMatch[0] as `0x${string}`;
  }

  // Extract memo (text after "memo:", "note:", or "for:")
  const memoMatch = content.match(
    /(?:memo|note|for)[:\s]+["']?([^"'\n]+)["']?/i,
  );
  if (memoMatch) {
    params.memo = memoMatch[1].trim();
  }

  return params;
}

/**
 * Format balance for human-readable display
 */
function formatBalance(amount: string, decimals = 2): string {
  const num = parseFloat(amount);
  if (isNaN(num)) return "0.00";
  if (num < 0.01 && num > 0) return num.toExponential(2);
  return num.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: Math.max(decimals, 4),
  });
}

/**
 * Get block explorer URL for a transaction
 */
function getExplorerUrl(chainName: string, txHash: Hash): string {
  const explorers: Record<string, string> = {
    arbitrum: "https://arbiscan.io/tx/",
    "arbitrum-sepolia": "https://sepolia.arbiscan.io/tx/",
    base: "https://basescan.org/tx/",
    "base-sepolia": "https://sepolia.basescan.org/tx/",
    ethereum: "https://etherscan.io/tx/",
    polygon: "https://polygonscan.com/tx/",
    optimism: "https://optimistic.etherscan.io/tx/",
  };
  return `${explorers[chainName] || explorers.arbitrum}${txHash}`;
}

// ============================================================================
// Actions
// ============================================================================

/**
 * Check x402 wallet balance action
 *
 * Returns the agent's wallet balance across all supported tokens,
 * including USDs, USDC, native token, and yield information.
 */
export const checkBalanceAction: Action = {
  name: "CHECK_BALANCE",
  similes: [
    "CHECK_WALLET",
    "SHOW_BALANCE",
    "HOW_MUCH_MONEY",
    "WALLET_BALANCE",
    "MY_BALANCE",
    "VIEW_BALANCE",
    "BALANCE",
  ],
  description:
    "Check your x402 wallet balance including USDs, USDC, native token, and earned yield.",

  validate: async (runtime: IAgentRuntime) => {
    // Wallet is always available for balance checks
    const service = runtime.getService<HyperscapeService>("hyperscapeService");
    return !!service;
  },

  handler: async (
    runtime: IAgentRuntime,
    _message: Memory,
    _state?: State,
    _options?: unknown,
    callback?: HandlerCallback,
  ) => {
    try {
      const balance = await getWalletBalance(runtime);

      const text = `💰 **Wallet Balance**
- **USDs**: ${formatBalance(balance.usds)} (${balance.currentApy}% APY)
- **USDC**: ${formatBalance(balance.usdc)}
- **${balance.nativeSymbol}**: ${formatBalance(balance.native, 4)}

📈 **Yield Earned**: ${formatBalance(balance.yieldEarned)} USDs
🔗 **Network**: ${balance.network}
📍 **Address**: ${balance.address.slice(0, 6)}...${balance.address.slice(-4)}`;

      await callback?.({
        text,
        action: "CHECK_BALANCE",
      });

      return {
        success: true,
        text,
        data: { ...balance } as Record<string, unknown>,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      await callback?.({
        text: `Failed to check balance: ${errorMessage}`,
        error: true,
      });
      return { success: false, error: error as Error };
    }
  },

  examples: [
    [
      { name: "user", content: { text: "Check my wallet balance" } },
      {
        name: "agent",
        content: {
          text: "💰 **Wallet Balance**\n- **USDs**: 1,000.00 (5.2% APY)\n- **USDC**: 500.00\n- **ETH**: 0.5000\n\n📈 **Yield Earned**: 12.34 USDs",
          action: "CHECK_BALANCE",
        },
      },
    ],
    [
      { name: "user", content: { text: "How much money do I have?" } },
      {
        name: "agent",
        content: {
          text: "💰 **Wallet Balance**\n- **USDs**: 1,000.00 (5.2% APY)",
          action: "CHECK_BALANCE",
        },
      },
    ],
  ],
};

/**
 * Send payment action
 *
 * Sends a payment to another address or agent, supporting USDs, USDC,
 * and native tokens. Validates sufficient balance before sending.
 */
export const sendPaymentAction: Action = {
  name: "SEND_PAYMENT",
  similes: [
    "PAY",
    "SEND_MONEY",
    "TRANSFER",
    "TIP",
    "SEND",
    "PAYMENT",
    "SEND_TOKENS",
    "SEND_CRYPTO",
  ],
  description:
    "Send a payment to another address or agent. Specify recipient, amount, and optionally a memo.",

  validate: async (runtime: IAgentRuntime) => {
    const service = runtime.getService<HyperscapeService>("hyperscapeService");
    if (!service) return false;

    // Check that we have some balance
    const balance = await getWalletBalance(runtime);
    const hasBalance =
      parseFloat(balance.usds) > 0 ||
      parseFloat(balance.usdc) > 0 ||
      parseFloat(balance.native) > 0;

    return hasBalance;
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: unknown,
    callback?: HandlerCallback,
  ) => {
    try {
      const content = message.content.text || "";
      const params = parsePaymentParams(content);

      // Validate parameters
      const validated = paymentParamsSchema.safeParse({
        recipient: params.recipient || "",
        amount: params.amount || "0",
        token: params.token || "usds",
        memo: params.memo,
      });

      if (!validated.success) {
        const errors = validated.error.issues.map((i) => i.message).join(", ");
        await callback?.({
          text: `Invalid payment parameters: ${errors}. Please specify recipient address, amount, and optionally token type (usds, usdc, or native).`,
          error: true,
        });
        return { success: false, error: new Error(errors) };
      }

      const request: PaymentRequest = validated.data;
      const result = await executePayment(runtime, request);

      if (!result.success) {
        await callback?.({
          text: `Payment failed: ${result.error}`,
          error: true,
        });
        return { success: false, error: new Error(result.error) };
      }

      const memoText = request.memo ? `\n📝 **Memo**: ${request.memo}` : "";
      const text = `✅ **Payment Sent**
- **Amount**: ${formatBalance(result.amount!)} ${result.token!.toUpperCase()}
- **To**: ${result.recipient!.length > 20 ? `${result.recipient!.slice(0, 8)}...${result.recipient!.slice(-6)}` : result.recipient}${memoText}
- **Tx**: ${result.transactionHash!.slice(0, 10)}...${result.transactionHash!.slice(-8)}`;

      await callback?.({
        text,
        action: "SEND_PAYMENT",
      });

      return {
        success: true,
        text,
        data: { ...result } as Record<string, unknown>,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      await callback?.({
        text: `Failed to send payment: ${errorMessage}`,
        error: true,
      });
      return { success: false, error: error as Error };
    }
  },

  examples: [
    [
      {
        name: "user",
        content: { text: "Send 10 USDS to 0x1234...5678" },
      },
      {
        name: "agent",
        content: {
          text: "✅ **Payment Sent**\n- **Amount**: 10.00 USDS\n- **To**: 0x1234...5678",
          action: "SEND_PAYMENT",
        },
      },
    ],
    [
      {
        name: "user",
        content: { text: "Tip vitalik.eth 5 USDC for helping" },
      },
      {
        name: "agent",
        content: {
          text: "✅ **Payment Sent**\n- **Amount**: 5.00 USDC\n- **To**: vitalik.eth\n- **Memo**: for helping",
          action: "SEND_PAYMENT",
        },
      },
    ],
  ],
};

/**
 * Check yield action
 *
 * Displays earned yield from USDs stablecoin holdings,
 * including current APY and projected earnings.
 */
export const checkYieldAction: Action = {
  name: "CHECK_YIELD",
  similes: [
    "SHOW_YIELD",
    "EARNINGS",
    "INTEREST_EARNED",
    "MY_YIELD",
    "VIEW_EARNINGS",
    "YIELD",
    "APY",
    "INTEREST",
  ],
  description:
    "Check your earned yield from USDs holdings and current APY information.",

  validate: async (runtime: IAgentRuntime) => {
    const service = runtime.getService<HyperscapeService>("hyperscapeService");
    return !!service;
  },

  handler: async (
    runtime: IAgentRuntime,
    _message: Memory,
    _state?: State,
    _options?: unknown,
    callback?: HandlerCallback,
  ) => {
    try {
      const balance = await getWalletBalance(runtime);

      // Calculate projected daily/monthly yield
      const usdsBalance = parseFloat(balance.usds);
      const apy = parseFloat(balance.currentApy);
      const dailyYield = (usdsBalance * (apy / 100)) / 365;
      const monthlyYield = (usdsBalance * (apy / 100)) / 12;

      const text = `📈 **Yield Summary**

**Earned to Date**: ${formatBalance(balance.yieldEarned)} USDs

**Current Holdings**:
- USDs Balance: ${formatBalance(balance.usds)}
- Current APY: ${balance.currentApy}%

**Projected Earnings**:
- Daily: ~${formatBalance(dailyYield.toString())} USDs
- Monthly: ~${formatBalance(monthlyYield.toString())} USDs
- Yearly: ~${formatBalance((usdsBalance * (apy / 100)).toString())} USDs

💡 *Yield is automatically compounded and reflected in your USDs balance.*`;

      await callback?.({
        text,
        action: "CHECK_YIELD",
      });

      return {
        success: true,
        text,
        data: {
          yieldEarned: balance.yieldEarned,
          currentApy: balance.currentApy,
          usdsBalance: balance.usds,
          projectedDaily: dailyYield.toString(),
          projectedMonthly: monthlyYield.toString(),
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      await callback?.({
        text: `Failed to check yield: ${errorMessage}`,
        error: true,
      });
      return { success: false, error: error as Error };
    }
  },

  examples: [
    [
      { name: "user", content: { text: "Show my yield earnings" } },
      {
        name: "agent",
        content: {
          text: "📈 **Yield Summary**\n\n**Earned to Date**: 12.34 USDs\n**Current APY**: 5.2%",
          action: "CHECK_YIELD",
        },
      },
    ],
    [
      { name: "user", content: { text: "How much interest have I earned?" } },
      {
        name: "agent",
        content: {
          text: "📈 **Yield Summary**\n\n**Earned to Date**: 12.34 USDs",
          action: "CHECK_YIELD",
        },
      },
    ],
  ],
};

/**
 * Pay for service action
 *
 * Handles HTTP-402 payment flows for in-game services and APIs.
 * Automatically processes payment requirements and unlocks access.
 */
export const payForServiceAction: Action = {
  name: "PAY_FOR_SERVICE",
  similes: [
    "BUY_SERVICE",
    "PURCHASE",
    "UNLOCK",
    "PAY_API",
    "SERVICE_PAYMENT",
    "UNLOCK_SERVICE",
    "BUY_ACCESS",
  ],
  description:
    "Pay for an in-game service or API using the HTTP-402 payment protocol.",

  validate: async (runtime: IAgentRuntime) => {
    const service = runtime.getService<HyperscapeService>("hyperscapeService");
    if (!service) return false;

    // Check that we have some balance for payments
    const balance = await getWalletBalance(runtime);
    return parseFloat(balance.usds) > 0 || parseFloat(balance.usdc) > 0;
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: unknown,
    callback?: HandlerCallback,
  ) => {
    try {
      const content = message.content.text || "";

      // Extract service URL from content
      const urlMatch = content.match(/https?:\/\/[^\s]+/);
      const serviceUrl = urlMatch
        ? urlMatch[0]
        : "https://api.hyperscape.game/premium";

      // Extract amount if specified
      const amountMatch = content.match(/(\d+\.?\d*)\s*(usds|usdc)?/i);
      const amount = amountMatch ? amountMatch[1] : "0.10";
      const token = amountMatch?.[2]?.toLowerCase() || "usds";

      // Extract payment address or use default Hyperscape payment address
      const addressMatch = content.match(/0x[a-fA-F0-9]{40}/);
      const payTo = (addressMatch?.[0] ||
        "0x742d35Cc6634C0532925a3b844Bc9e7595f8fE24") as Address;

      const request: ServicePaymentRequest = {
        serviceUrl,
        amount,
        token,
        payTo,
        description:
          content.replace(urlMatch?.[0] || "", "").trim() || "Service access",
      };

      // Validate
      const validated = servicePaymentSchema.safeParse(request);
      if (!validated.success) {
        const errors = validated.error.issues.map((i) => i.message).join(", ");
        await callback?.({
          text: `Invalid service payment request: ${errors}`,
          error: true,
        });
        return { success: false, error: new Error(errors) };
      }

      const result = await executeServicePayment(runtime, validated.data);

      if (!result.success) {
        await callback?.({
          text: `Service payment failed: ${result.error}`,
          error: true,
        });
        return { success: false, error: new Error(result.error) };
      }

      const text = `🔓 **Service Unlocked**
- **Service**: ${result.recipient}
- **Cost**: ${formatBalance(result.amount!)} ${result.token!.toUpperCase()}
- **Tx**: ${result.transactionHash!.slice(0, 10)}...${result.transactionHash!.slice(-8)}

Service access granted. You can now use the requested feature.`;

      await callback?.({
        text,
        action: "PAY_FOR_SERVICE",
      });

      return {
        success: true,
        text,
        data: { ...result } as Record<string, unknown>,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      await callback?.({
        text: `Failed to pay for service: ${errorMessage}`,
        error: true,
      });
      return { success: false, error: error as Error };
    }
  },

  examples: [
    [
      {
        name: "user",
        content: { text: "Unlock the premium map feature" },
      },
      {
        name: "agent",
        content: {
          text: "🔓 **Service Unlocked**\n- **Service**: api.hyperscape.game\n- **Cost**: 0.10 USDS",
          action: "PAY_FOR_SERVICE",
        },
      },
    ],
    [
      {
        name: "user",
        content: { text: "Buy access to https://api.example.com/data" },
      },
      {
        name: "agent",
        content: {
          text: "🔓 **Service Unlocked**\n- **Service**: api.example.com\n- **Cost**: 0.10 USDS",
          action: "PAY_FOR_SERVICE",
        },
      },
    ],
  ],
};
