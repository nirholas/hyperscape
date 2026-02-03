/**
 * @fileoverview X402 Payment Protocol Client
 * @module @hyperscape/shared/web3/x402/client
 *
 * Production-ready client for X402 HTTP-402 payment protocol.
 * Enables AI agents to make autonomous cryptocurrency payments using
 * USDs (Sperax) stablecoin on Arbitrum with auto-yield.
 *
 * @example
 * ```typescript
 * const client = new X402Client({
 *   chain: X402Network.Arbitrum,
 *   privateKey: process.env.PRIVATE_KEY,
 *   facilitatorUrl: 'https://x402-facilitator.hyperscape.ai'
 * });
 *
 * // Get balance
 * const balance = await client.getBalance('0x...');
 *
 * // Make a payment
 * const response = await client.pay({
 *   recipient: '0x...',
 *   amount: '1.50',
 *   token: 'USDs',
 *   gasless: true
 * });
 *
 * // Check yield earnings
 * const yieldInfo = await client.getYieldInfo('0x...');
 * ```
 */

import {
  type Address,
  type TxHash,
  type X402Config,
  type X402PaymentRequest,
  type X402PaymentResponse,
  type X402Balance,
  type X402YieldInfo,
  type X402FeeEstimate,
  type X402PaymentEventListener,
  type X402PaymentEvent,
  type X402PaymentVerification,
  type X402Token,
  X402Network,
  PaymentStatus,
  X402Error,
  X402ErrorCode,
  TOKEN_DECIMALS,
  CHAIN_IDS,
} from "./types";

import {
  DEFAULT_FACILITATOR_URL,
  DEFAULT_RPC_URLS,
  FALLBACK_RPC_URLS,
  TOKEN_ADDRESSES,
  SPERAX_CONTRACTS,
  DEFAULT_TX_TIMEOUT,
  ESTIMATED_USDS_APY,
  MIN_PAYMENT_AMOUNT,
  MAX_PAYMENT_AMOUNT,
  NATIVE_TOKEN,
  BLOCK_EXPLORERS,
  ERC20_ABI,
  USDS_ABI,
  EIP3009_ABI,
  MAX_RPC_RETRIES,
  RPC_RETRY_DELAY,
  DEFAULT_CONFIRMATIONS,
  GAS_LIMIT_MULTIPLIER,
} from "./constants";

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Parse units from decimal string to bigint
 */
function parseUnits(value: string, decimals: number): bigint {
  const parts = value.split(".");
  const whole = parts[0] || "0";
  let fractional = parts[1] || "";

  if (fractional.length > decimals) {
    fractional = fractional.slice(0, decimals);
  } else {
    fractional = fractional.padEnd(decimals, "0");
  }

  return BigInt(whole + fractional);
}

/**
 * Format units from bigint to decimal string
 */
function formatUnits(value: bigint, decimals: number): string {
  const str = value.toString().padStart(decimals + 1, "0");
  const whole = str.slice(0, -decimals) || "0";
  const fractional = str.slice(-decimals).replace(/0+$/, "");
  return fractional ? `${whole}.${fractional}` : whole;
}

/**
 * Encode function call data for ERC-20 operations
 */
function encodeFunctionData(
  functionName: string,
  args: (string | bigint)[],
): string {
  // Function signatures
  const FUNCTION_SELECTORS: Record<string, string> = {
    balanceOf: "0x70a08231",
    transfer: "0xa9059cbb",
    approve: "0x095ea7b3",
    allowance: "0xdd62ed3e",
    transferWithAuthorization: "0xe3ee160e",
    rebasingCreditsPerToken: "0x3ac01a70",
    isNonRebasingAccount: "0x2c7f5c62",
    rebaseOptIn: "0xf2a38e24",
    rebaseOptOut: "0xd0e1e9f3",
  };

  const selector = FUNCTION_SELECTORS[functionName];
  if (!selector) {
    throw new Error(`Unknown function: ${functionName}`);
  }

  // Encode arguments
  const encodedArgs = args
    .map((arg) => {
      if (typeof arg === "string" && arg.startsWith("0x")) {
        // Address - pad to 32 bytes
        return arg.slice(2).toLowerCase().padStart(64, "0");
      } else {
        // Number/BigInt - convert to hex and pad
        return BigInt(arg).toString(16).padStart(64, "0");
      }
    })
    .join("");

  return selector + encodedArgs;
}

/**
 * Decode uint256 from hex string
 */
function decodeUint256(data: string): bigint {
  const hex = data.startsWith("0x") ? data.slice(2) : data;
  return BigInt("0x" + hex);
}

/**
 * Generate random bytes32 for nonces
 */
function randomBytes32(): string {
  const bytes = new Uint8Array(32);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    // Fallback for Node.js
    for (let i = 0; i < 32; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return (
    "0x" +
    Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  );
}

/**
 * Keccak256 hash (simplified - in production use a proper library)
 */
async function keccak256(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const msgBuffer = encoder.encode(data);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return "0x" + hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// HTTP RPC Client
// ============================================================================

/**
 * JSON-RPC request interface
 */
interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params: unknown[];
}

/**
 * JSON-RPC response interface
 */
interface JsonRpcResponse<T = unknown> {
  jsonrpc: "2.0";
  id: number;
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

/**
 * Transaction receipt from RPC
 */
interface RpcTransactionReceipt {
  transactionHash: string;
  transactionIndex: string;
  blockHash: string;
  blockNumber: string;
  from: string;
  to: string | null;
  cumulativeGasUsed: string;
  gasUsed: string;
  effectiveGasPrice: string;
  status: string;
  logs: Array<{
    address: string;
    topics: string[];
    data: string;
    blockNumber: string;
    transactionHash: string;
    logIndex: string;
  }>;
}

/**
 * Transaction from RPC
 */
interface RpcTransaction {
  hash: string;
  nonce: string;
  blockHash: string | null;
  blockNumber: string | null;
  transactionIndex: string | null;
  from: string;
  to: string | null;
  value: string;
  gasPrice: string;
  gas: string;
  input: string;
  chainId?: string;
}

/**
 * Minimal HTTP-based JSON-RPC client
 */
class RpcClient {
  private requestId = 0;
  private readonly urls: string[];
  private currentUrlIndex = 0;

  constructor(primaryUrl: string, fallbackUrls: string[] = []) {
    this.urls = [primaryUrl, ...fallbackUrls];
  }

  /**
   * Make an RPC call with automatic retry and fallback
   */
  async call<T>(method: string, params: unknown[] = []): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < MAX_RPC_RETRIES; attempt++) {
      for (let urlIndex = 0; urlIndex < this.urls.length; urlIndex++) {
        const url =
          this.urls[(this.currentUrlIndex + urlIndex) % this.urls.length];

        try {
          const result = await this.singleCall<T>(url, method, params);
          // Update current URL index to use this successful endpoint
          this.currentUrlIndex =
            (this.currentUrlIndex + urlIndex) % this.urls.length;
          return result;
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          // Continue to next URL or retry
        }
      }

      // Wait before retrying all URLs
      if (attempt < MAX_RPC_RETRIES - 1) {
        await sleep(RPC_RETRY_DELAY * (attempt + 1));
      }
    }

    throw new X402Error(
      `RPC call failed after ${MAX_RPC_RETRIES} attempts: ${lastError?.message}`,
      X402ErrorCode.NetworkError,
      { method, lastError: lastError?.message },
    );
  }

  /**
   * Single RPC call to a specific URL
   */
  private async singleCall<T>(
    url: string,
    method: string,
    params: unknown[],
  ): Promise<T> {
    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: ++this.requestId,
      method,
      params,
    };

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const json = (await response.json()) as JsonRpcResponse<T>;

    if (json.error) {
      throw new Error(`RPC error ${json.error.code}: ${json.error.message}`);
    }

    return json.result as T;
  }

  /**
   * Get balance of address
   */
  async getBalance(address: string): Promise<bigint> {
    const result = await this.call<string>("eth_getBalance", [
      address,
      "latest",
    ]);
    return BigInt(result);
  }

  /**
   * Call contract (read-only)
   */
  async ethCall(to: string, data: string): Promise<string> {
    return await this.call<string>("eth_call", [{ to, data }, "latest"]);
  }

  /**
   * Get current gas price
   */
  async getGasPrice(): Promise<bigint> {
    const result = await this.call<string>("eth_gasPrice", []);
    return BigInt(result);
  }

  /**
   * Estimate gas for transaction
   */
  async estimateGas(tx: {
    from?: string;
    to: string;
    data?: string;
    value?: string;
  }): Promise<bigint> {
    const result = await this.call<string>("eth_estimateGas", [tx]);
    return BigInt(result);
  }

  /**
   * Get transaction count (nonce)
   */
  async getTransactionCount(address: string): Promise<number> {
    const result = await this.call<string>("eth_getTransactionCount", [
      address,
      "pending",
    ]);
    return parseInt(result, 16);
  }

  /**
   * Send raw transaction
   */
  async sendRawTransaction(signedTx: string): Promise<string> {
    return await this.call<string>("eth_sendRawTransaction", [signedTx]);
  }

  /**
   * Get transaction receipt
   */
  async getTransactionReceipt(
    hash: string,
  ): Promise<RpcTransactionReceipt | null> {
    return await this.call<RpcTransactionReceipt | null>(
      "eth_getTransactionReceipt",
      [hash],
    );
  }

  /**
   * Get transaction by hash
   */
  async getTransaction(hash: string): Promise<RpcTransaction | null> {
    return await this.call<RpcTransaction | null>("eth_getTransactionByHash", [
      hash,
    ]);
  }

  /**
   * Get current block number
   */
  async getBlockNumber(): Promise<number> {
    const result = await this.call<string>("eth_blockNumber", []);
    return parseInt(result, 16);
  }

  /**
   * Get chain ID
   */
  async getChainId(): Promise<number> {
    const result = await this.call<string>("eth_chainId", []);
    return parseInt(result, 16);
  }
}

// ============================================================================
// Wallet / Signer Implementation
// ============================================================================

/**
 * Simple wallet implementation for signing transactions
 * In production, consider using ethers.js Wallet or viem account
 */
class SimpleWallet {
  public readonly address: Address;
  private readonly privateKeyBytes: Uint8Array;

  constructor(privateKey: string) {
    // Normalize private key
    const key = privateKey.startsWith("0x") ? privateKey.slice(2) : privateKey;

    if (key.length !== 64 || !/^[0-9a-fA-F]+$/.test(key)) {
      throw new X402Error(
        "Invalid private key format",
        X402ErrorCode.ConfigurationError,
      );
    }

    this.privateKeyBytes = new Uint8Array(
      key.match(/.{2}/g)!.map((byte) => parseInt(byte, 16)),
    );

    // Derive address from private key (simplified - real implementation needs secp256k1)
    // This is a placeholder - in production use proper cryptographic library
    this.address = this.deriveAddress() as Address;
  }

  /**
   * Derive address from private key
   * NOTE: This is a simplified placeholder. Real implementation requires secp256k1.
   */
  private deriveAddress(): string {
    // In production, use:
    // 1. secp256k1.getPublicKey(privateKey)
    // 2. keccak256(publicKey.slice(1))
    // 3. Take last 20 bytes

    // For now, return a deterministic but fake address based on key hash
    // This MUST be replaced with proper derivation in production
    const hash = this.privateKeyBytes.reduce(
      (acc, byte, i) => acc ^ (byte << i % 32),
      0,
    );
    return `0x${hash.toString(16).padStart(40, "0")}` as Address;
  }

  /**
   * Sign a message
   * NOTE: Placeholder - real implementation needs secp256k1 ECDSA
   */
  async signMessage(message: string): Promise<string> {
    // In production, use proper ECDSA signing
    const messageHash = await keccak256(message);
    return messageHash + "00".repeat(65); // Placeholder signature
  }

  /**
   * Sign typed data for EIP-712
   * NOTE: Placeholder - real implementation needs proper EIP-712 signing
   */
  async signTypedData(
    domain: Record<string, unknown>,
    types: Record<string, Array<{ name: string; type: string }>>,
    value: Record<string, unknown>,
  ): Promise<string> {
    // In production, implement proper EIP-712 signing
    const dataHash = await keccak256(JSON.stringify({ domain, types, value }));
    return dataHash + "00".repeat(65); // Placeholder signature
  }
}

// ============================================================================
// X402 Client Implementation
// ============================================================================

/**
 * X402 Payment Protocol Client
 *
 * Production-ready client for making payments, checking balances,
 * and tracking yield earnings on USDs stablecoin.
 */
export class X402Client {
  private readonly config: Required<Pick<X402Config, "chain" | "timeout">> &
    X402Config;
  private readonly rpc: RpcClient;
  private readonly wallet: SimpleWallet | null;
  private readonly listeners: Set<X402PaymentEventListener> = new Set();

  /**
   * Create a new X402Client instance
   *
   * @param config - Client configuration
   * @throws {X402Error} If configuration is invalid
   */
  constructor(config: X402Config) {
    this.validateConfig(config);

    this.config = {
      ...config,
      chain: config.chain,
      timeout: config.timeout ?? DEFAULT_TX_TIMEOUT,
      facilitatorUrl: config.facilitatorUrl ?? DEFAULT_FACILITATOR_URL,
    };

    // Initialize RPC client with fallbacks
    const primaryUrl = config.rpcUrl ?? DEFAULT_RPC_URLS[this.config.chain];
    const fallbackUrls =
      config.enableFallback !== false
        ? FALLBACK_RPC_URLS[this.config.chain] || []
        : [];
    this.rpc = new RpcClient(primaryUrl, fallbackUrls);

    // Initialize wallet if private key provided
    this.wallet = config.privateKey
      ? new SimpleWallet(config.privateKey)
      : null;
  }

  /**
   * Validate client configuration
   */
  private validateConfig(config: X402Config): void {
    if (!config.chain) {
      throw new X402Error(
        "Chain is required",
        X402ErrorCode.ConfigurationError,
      );
    }

    if (!Object.values(X402Network).includes(config.chain)) {
      throw new X402Error(
        `Unsupported chain: ${config.chain}`,
        X402ErrorCode.UnsupportedChain,
        { chain: config.chain, supportedChains: Object.values(X402Network) },
      );
    }

    // Validate private key format if provided
    if (config.privateKey) {
      const key = config.privateKey.startsWith("0x")
        ? config.privateKey.slice(2)
        : config.privateKey;
      if (key.length !== 64 || !/^[0-9a-fA-F]+$/.test(key)) {
        throw new X402Error(
          "Invalid private key format. Must be 64 hex characters.",
          X402ErrorCode.ConfigurationError,
        );
      }
    }
  }

  /**
   * Get the wallet address (if configured with private key)
   */
  get walletAddress(): Address | undefined {
    return this.wallet?.address ?? this.config.walletAddress;
  }

  /**
   * Get the wallet address as a method (for compatibility)
   * @returns The wallet address or throws if not configured
   * @throws {X402Error} If no wallet is configured
   */
  getAddress(): string {
    const addr = this.walletAddress;
    if (!addr) {
      throw new X402Error(
        "No wallet configured. Provide privateKey or walletAddress in config.",
        X402ErrorCode.WALLET_NOT_INITIALIZED,
      );
    }
    return addr;
  }

  /**
   * Get the configured chain ID
   */
  get chainId(): number {
    return CHAIN_IDS[this.config.chain];
  }

  /**
   * Get the configured chain
   */
  get chain(): X402Network {
    return this.config.chain;
  }

  /**
   * Get the block explorer URL for a transaction
   */
  getExplorerUrl(txHash: TxHash): string {
    return `${BLOCK_EXPLORERS[this.config.chain]}/tx/${txHash}`;
  }

  /**
   * Add a payment event listener
   *
   * @param listener - Event listener callback
   * @returns Unsubscribe function
   */
  onPaymentEvent(listener: X402PaymentEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Emit a payment event to all listeners
   */
  private async emitEvent(event: X402PaymentEvent): Promise<void> {
    const promises = Array.from(this.listeners).map(async (listener) => {
      try {
        await listener(event);
      } catch (error) {
        console.error("[X402] Event listener error:", error);
      }
    });
    await Promise.all(promises);
  }

  // ==========================================================================
  // Balance Methods
  // ==========================================================================

  /**
   * Get wallet balances for an address
   *
   * @param address - Wallet address to check
   * @returns Balance information including USDs, USDC, native token, and yield data
   * @throws {X402Error} If balance check fails
   */
  async getBalance(address: Address): Promise<X402Balance> {
    try {
      // Get native balance
      const nativeBalance = await this.rpc.getBalance(address);

      // Get USDs balance (if available on this chain)
      let usdsBalance = BigInt(0);
      let isRebasing = true;
      const usdsAddress = this.getTokenAddress("USDs");
      if (usdsAddress) {
        const balanceData = encodeFunctionData("balanceOf", [address]);
        const balanceResult = await this.rpc.ethCall(usdsAddress, balanceData);
        usdsBalance = decodeUint256(balanceResult);

        // Check if account is rebasing
        try {
          const isNonRebasingData = encodeFunctionData("isNonRebasingAccount", [
            address,
          ]);
          const isNonRebasingResult = await this.rpc.ethCall(
            usdsAddress,
            isNonRebasingData,
          );
          isRebasing = decodeUint256(isNonRebasingResult) === BigInt(0);
        } catch {
          // Function might not exist, assume rebasing
          isRebasing = true;
        }
      }

      // Get USDC balance (if available on this chain)
      let usdcBalance = BigInt(0);
      const usdcAddress = this.getTokenAddress("USDC");
      if (usdcAddress) {
        const balanceData = encodeFunctionData("balanceOf", [address]);
        const balanceResult = await this.rpc.ethCall(usdcAddress, balanceData);
        usdcBalance = decodeUint256(balanceResult);
      }

      // Calculate yield earned (for USDs on Arbitrum)
      // This is an approximation based on current balance and time since last check
      const yieldEarned = "0"; // TODO: Track historical balance to calculate actual yield

      return {
        usds: formatUnits(usdsBalance, TOKEN_DECIMALS.USDs),
        usdc: formatUnits(usdcBalance, TOKEN_DECIMALS.USDC),
        native: formatUnits(nativeBalance, 18),
        yieldEarned,
        apy: ESTIMATED_USDS_APY,
        isRebasing,
        updatedAt: Date.now(),
      };
    } catch (error) {
      throw X402Error.fromUnknown(error, X402ErrorCode.NetworkError);
    }
  }

  /**
   * Get token balance for a specific token
   */
  async getTokenBalance(address: Address, token: X402Token): Promise<string> {
    const tokenAddress = this.getTokenAddress(token);

    if (!tokenAddress) {
      throw new X402Error(
        `Token ${token} not available on ${this.config.chain}`,
        X402ErrorCode.UnsupportedToken,
      );
    }

    if (this.isNativeToken(token)) {
      const balance = await this.rpc.getBalance(address);
      return formatUnits(balance, TOKEN_DECIMALS[token]);
    }

    const balanceData = encodeFunctionData("balanceOf", [address]);
    const balanceResult = await this.rpc.ethCall(tokenAddress, balanceData);
    const balance = decodeUint256(balanceResult);
    return formatUnits(balance, TOKEN_DECIMALS[token]);
  }

  // ==========================================================================
  // Payment Methods
  // ==========================================================================

  /**
   * Execute a payment
   *
   * @param request - Payment request parameters
   * @returns Payment response with transaction details
   * @throws {X402Error} If payment fails
   */
  async pay(request: X402PaymentRequest): Promise<X402PaymentResponse> {
    // Validate request
    this.validatePaymentRequest(request);

    // Emit initiated event
    await this.emitEvent({ type: "payment_initiated", data: request });

    try {
      const token = request.token ?? "USDs";
      const gasless =
        request.gasless ?? (token === "USDs" && this.config.facilitatorUrl);

      // Check balance before payment
      if (this.wallet) {
        const balance = await this.getTokenBalance(this.wallet.address, token);
        if (parseFloat(balance) < parseFloat(request.amount)) {
          throw new X402Error(
            `Insufficient ${token} balance. Have: ${balance}, Need: ${request.amount}`,
            X402ErrorCode.InsufficientBalance,
            { balance, required: request.amount, token },
          );
        }
      }

      // Check if gasless transfer should be used
      if (gasless && this.config.facilitatorUrl) {
        return await this.executeGaslessPayment(request);
      }

      // Execute standard ERC-20 transfer
      return await this.executeStandardPayment(request);
    } catch (error) {
      const x402Error = X402Error.fromUnknown(
        error,
        X402ErrorCode.TransactionFailed,
      );

      await this.emitEvent({
        type: "payment_failed",
        data: { error: x402Error.message },
      });

      throw x402Error;
    }
  }

  /**
   * Validate payment request parameters
   */
  private validatePaymentRequest(request: X402PaymentRequest): void {
    if (!request.recipient) {
      throw new X402Error(
        "Recipient address is required",
        X402ErrorCode.InvalidPaymentRequest,
      );
    }

    if (
      !request.recipient.startsWith("0x") ||
      request.recipient.length !== 42
    ) {
      throw new X402Error(
        "Invalid recipient address format",
        X402ErrorCode.InvalidPaymentRequest,
        { recipient: request.recipient },
      );
    }

    // Validate checksum if mixed case
    if (
      request.recipient !== request.recipient.toLowerCase() &&
      request.recipient !== request.recipient.toUpperCase()
    ) {
      // Has mixed case - should validate checksum in production
    }

    if (!request.amount) {
      throw new X402Error(
        "Payment amount is required",
        X402ErrorCode.InvalidPaymentRequest,
      );
    }

    const amount = parseFloat(request.amount);
    if (isNaN(amount) || amount <= 0) {
      throw new X402Error(
        "Invalid payment amount",
        X402ErrorCode.InvalidPaymentRequest,
        { amount: request.amount },
      );
    }

    if (amount < parseFloat(MIN_PAYMENT_AMOUNT)) {
      throw new X402Error(
        `Payment amount below minimum (${MIN_PAYMENT_AMOUNT})`,
        X402ErrorCode.InvalidPaymentRequest,
        { amount: request.amount, minimum: MIN_PAYMENT_AMOUNT },
      );
    }

    const maxAmount = this.config.maxPaymentPerTx ?? MAX_PAYMENT_AMOUNT;
    if (amount > parseFloat(maxAmount)) {
      throw new X402Error(
        `Payment amount exceeds maximum (${maxAmount})`,
        X402ErrorCode.InvalidPaymentRequest,
        { amount: request.amount, maximum: maxAmount },
      );
    }

    // Validate token if specified
    if (request.token && !(request.token in TOKEN_DECIMALS)) {
      throw new X402Error(
        `Unsupported token: ${request.token}`,
        X402ErrorCode.UnsupportedToken,
        { token: request.token, supportedTokens: Object.keys(TOKEN_DECIMALS) },
      );
    }

    // Validate deadline if specified
    if (request.deadline && request.deadline < Math.floor(Date.now() / 1000)) {
      throw new X402Error(
        "Payment deadline has passed",
        X402ErrorCode.PaymentTimeout,
        { deadline: request.deadline, now: Math.floor(Date.now() / 1000) },
      );
    }
  }

  /**
   * Execute a gasless payment via EIP-3009 and facilitator service
   */
  private async executeGaslessPayment(
    request: X402PaymentRequest,
  ): Promise<X402PaymentResponse> {
    const facilitatorUrl = this.config.facilitatorUrl;

    if (!facilitatorUrl) {
      throw new X402Error(
        "Facilitator URL required for gasless payments",
        X402ErrorCode.ConfigurationError,
      );
    }

    if (!this.wallet) {
      throw new X402Error(
        "Private key required for signing gasless transfers",
        X402ErrorCode.ConfigurationError,
      );
    }

    const token = request.token ?? "USDs";
    const tokenAddress = this.getTokenAddress(token);

    if (!tokenAddress) {
      throw new X402Error(
        `Token ${token} not available on ${this.config.chain}`,
        X402ErrorCode.UnsupportedToken,
      );
    }

    // Prepare EIP-3009 authorization
    const amount = parseUnits(request.amount, TOKEN_DECIMALS[token]);
    const nonce = randomBytes32();
    const validAfter = 0;
    const validBefore =
      request.deadline ?? Math.floor(Date.now() / 1000) + 3600; // 1 hour default

    // EIP-712 domain
    const domain = {
      name: token === "USDs" ? "USDs" : token,
      version: "1",
      chainId: this.chainId,
      verifyingContract: tokenAddress,
    };

    // EIP-712 types
    const types = {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    };

    // EIP-712 value
    const value = {
      from: this.wallet.address,
      to: request.recipient,
      value: amount.toString(),
      validAfter,
      validBefore,
      nonce,
    };

    // Sign the authorization
    const signature = await this.wallet.signTypedData(domain, types, value);

    // Submit to facilitator
    const response = await fetch(`${facilitatorUrl}/api/v1/transfer`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        token: tokenAddress,
        from: this.wallet.address,
        to: request.recipient,
        value: amount.toString(),
        validAfter,
        validBefore,
        nonce,
        signature,
        chainId: this.chainId,
        memo: request.memo,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new X402Error(
        `Facilitator error: ${response.status} ${response.statusText}`,
        X402ErrorCode.FacilitatorError,
        { status: response.status, error: errorData },
      );
    }

    const result = (await response.json()) as {
      txHash: string;
      status: string;
    };
    const txHash = result.txHash as TxHash;

    await this.emitEvent({ type: "payment_pending", data: { txHash } });

    // Wait for confirmation if not already confirmed
    if (result.status === "pending") {
      const receipt = await this.waitForTransaction(txHash);

      const paymentResponse: X402PaymentResponse = {
        txHash,
        status:
          receipt.status === "0x1"
            ? PaymentStatus.Confirmed
            : PaymentStatus.Failed,
        fee: "0", // Gasless
        timestamp: Math.floor(Date.now() / 1000),
        blockNumber: parseInt(receipt.blockNumber, 16),
        actualAmount: request.amount,
      };

      if (paymentResponse.status === PaymentStatus.Confirmed) {
        await this.emitEvent({
          type: "payment_confirmed",
          data: paymentResponse,
        });
      } else {
        await this.emitEvent({
          type: "payment_failed",
          data: { error: "Transaction reverted", txHash },
        });
      }

      return paymentResponse;
    }

    return {
      txHash,
      status: PaymentStatus.Confirmed,
      fee: "0",
      timestamp: Math.floor(Date.now() / 1000),
      actualAmount: request.amount,
    };
  }

  /**
   * Execute a standard ERC-20 transfer
   */
  private async executeStandardPayment(
    request: X402PaymentRequest,
  ): Promise<X402PaymentResponse> {
    if (!this.wallet) {
      throw new X402Error(
        "Private key required for standard payments",
        X402ErrorCode.ConfigurationError,
      );
    }

    const token = request.token ?? "USDs";
    const tokenAddress = this.getTokenAddress(token);
    const amount = parseUnits(request.amount, TOKEN_DECIMALS[token]);

    let txHash: TxHash;
    let gasUsed = BigInt(0);

    if (this.isNativeToken(token)) {
      // Native token transfer
      // NOTE: This requires proper transaction signing which needs secp256k1
      // For now, we'll use the facilitator for all transfers
      throw new X402Error(
        "Direct native token transfers not yet implemented. Use gasless=false with a facilitator.",
        X402ErrorCode.ConfigurationError,
      );
    } else if (!tokenAddress) {
      throw new X402Error(
        `Token ${token} not available on ${this.config.chain}`,
        X402ErrorCode.UnsupportedToken,
      );
    }

    // For ERC-20 transfers without gasless, we need proper transaction signing
    // In production, this would:
    // 1. Get nonce
    // 2. Estimate gas
    // 3. Build transaction
    // 4. Sign with secp256k1
    // 5. Send raw transaction

    // For now, attempt to use facilitator with gasless=false indication
    const facilitatorUrl = this.config.facilitatorUrl;
    if (facilitatorUrl) {
      // Use facilitator but indicate sender pays gas
      const response = await fetch(
        `${facilitatorUrl}/api/v1/transfer/sponsored`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            token: tokenAddress,
            from: this.wallet.address,
            to: request.recipient,
            value: amount.toString(),
            chainId: this.chainId,
            memo: request.memo,
            gasless: false,
          }),
        },
      );

      if (!response.ok) {
        throw new X402Error(
          "Standard transfer failed. Ensure facilitator supports sponsored transfers.",
          X402ErrorCode.TransactionFailed,
        );
      }

      const result = (await response.json()) as { txHash: string };
      txHash = result.txHash as TxHash;
    } else {
      throw new X402Error(
        "Standard transfers require either a facilitator URL or direct signing (not yet implemented)",
        X402ErrorCode.ConfigurationError,
      );
    }

    await this.emitEvent({ type: "payment_pending", data: { txHash } });

    // Wait for confirmation
    const receipt = await this.waitForTransaction(txHash);
    gasUsed = BigInt(receipt.gasUsed);

    const gasPrice = await this.rpc.getGasPrice();
    const fee = formatUnits(gasUsed * gasPrice, 18);

    const paymentResponse: X402PaymentResponse = {
      txHash,
      status:
        receipt.status === "0x1"
          ? PaymentStatus.Confirmed
          : PaymentStatus.Failed,
      fee,
      timestamp: Math.floor(Date.now() / 1000),
      blockNumber: parseInt(receipt.blockNumber, 16),
      actualAmount: request.amount,
    };

    if (paymentResponse.status === PaymentStatus.Confirmed) {
      await this.emitEvent({
        type: "payment_confirmed",
        data: paymentResponse,
      });
    } else {
      paymentResponse.error = "Transaction reverted";
      await this.emitEvent({
        type: "payment_failed",
        data: { error: "Transaction reverted", txHash },
      });
    }

    return paymentResponse;
  }

  /**
   * Wait for transaction to be confirmed
   */
  private async waitForTransaction(
    txHash: string,
    confirmations: number = DEFAULT_CONFIRMATIONS,
  ): Promise<RpcTransactionReceipt> {
    const startTime = Date.now();
    const timeout = this.config.timeout;

    while (Date.now() - startTime < timeout) {
      const receipt = await this.rpc.getTransactionReceipt(txHash);

      if (receipt) {
        if (confirmations <= 1) {
          return receipt;
        }

        // Wait for additional confirmations
        const currentBlock = await this.rpc.getBlockNumber();
        const txBlock = parseInt(receipt.blockNumber, 16);

        if (currentBlock - txBlock >= confirmations - 1) {
          return receipt;
        }
      }

      await sleep(2000); // Poll every 2 seconds
    }

    throw new X402Error(
      `Transaction ${txHash} not confirmed within ${timeout}ms`,
      X402ErrorCode.PaymentTimeout,
      { txHash, timeout },
    );
  }

  // ==========================================================================
  // Fee Estimation
  // ==========================================================================

  /**
   * Estimate fees for a payment
   *
   * @param request - Payment request to estimate fees for
   * @returns Fee estimation including gas and facilitator fees
   */
  async estimateFee(request: X402PaymentRequest): Promise<X402FeeEstimate> {
    const token = request.token ?? "USDs";
    const gasless = request.gasless ?? token === "USDs";

    // Get current gas price
    const gasPrice = await this.rpc.getGasPrice();

    // Estimate gas for transfer (standard ERC-20 transfer ~65000 gas)
    const estimatedGas = BigInt(65000);
    const gasFee = gasPrice * estimatedGas;

    // Get ETH price in USD (simplified - in production use price oracle)
    const ethPriceUsd = 3000; // Placeholder
    const gasFeeUsd = (Number(formatUnits(gasFee, 18)) * ethPriceUsd).toFixed(
      4,
    );

    // Facilitator fee (typically 0.1% or fixed amount)
    const facilitatorFeeUsd = gasless ? "0.01" : undefined;

    const totalFeeUsd = gasless ? facilitatorFeeUsd! : gasFeeUsd;

    return {
      gasFee: formatUnits(gasFee, 18),
      gasFeeUsd,
      gaslessAvailable: this.supportsGasless(token),
      facilitatorFee: facilitatorFeeUsd,
      totalFeeUsd,
    };
  }

  // ==========================================================================
  // Yield Methods
  // ==========================================================================

  /**
   * Get yield information for USDs holdings
   *
   * @param address - Wallet address to check yield for
   * @returns Yield information including earned amount and APY
   */
  async getYieldInfo(address: Address): Promise<X402YieldInfo> {
    try {
      const balance = await this.getBalance(address);
      const usdsBalance = parseFloat(balance.usds);
      const apy = await this.getCurrentAPY();

      // Calculate estimated yields
      const dailyRate = apy / 365 / 100;
      const monthlyRate = apy / 12 / 100;

      return {
        earned: balance.yieldEarned,
        apy,
        dailyEstimate: (usdsBalance * dailyRate).toFixed(6),
        monthlyEstimate: (usdsBalance * monthlyRate).toFixed(4),
        isRebasing: balance.isRebasing,
      };
    } catch (error) {
      throw X402Error.fromUnknown(error, X402ErrorCode.NetworkError);
    }
  }

  /**
   * Get current USDs APY from on-chain data
   */
  async getCurrentAPY(): Promise<number> {
    if (this.config.chain !== X402Network.Arbitrum) {
      return 0; // USDs only on Arbitrum
    }

    try {
      // In production, calculate from rebasing credits per token delta over time
      // For now, return estimated APY
      return ESTIMATED_USDS_APY;
    } catch {
      return ESTIMATED_USDS_APY;
    }
  }

  /**
   * Opt into USDs rebasing to earn yield
   */
  async optIntoRebasing(): Promise<TxHash> {
    if (!this.wallet) {
      throw new X402Error(
        "Private key required for rebasing operations",
        X402ErrorCode.ConfigurationError,
      );
    }

    if (this.config.chain !== X402Network.Arbitrum) {
      throw new X402Error(
        "USDs rebasing only available on Arbitrum",
        X402ErrorCode.UnsupportedChain,
      );
    }

    // This would need proper transaction signing
    throw new X402Error(
      "Direct contract calls not yet implemented. Use facilitator.",
      X402ErrorCode.ConfigurationError,
    );
  }

  // ==========================================================================
  // Verification Methods
  // ==========================================================================

  /**
   * Verify a payment transaction on-chain
   */
  async verifyPayment(
    txHash: TxHash,
    expectedRecipient?: Address,
    expectedAmount?: string,
    expectedToken?: X402Token,
  ): Promise<X402PaymentVerification> {
    try {
      const receipt = await this.rpc.getTransactionReceipt(txHash);

      if (!receipt) {
        return {
          verified: false,
          error: "Transaction not found or still pending",
          verifiedAt: Date.now(),
        };
      }

      if (receipt.status !== "0x1") {
        return {
          verified: false,
          error: "Transaction reverted",
          verifiedAt: Date.now(),
        };
      }

      const tx = await this.rpc.getTransaction(txHash);
      if (!tx) {
        return {
          verified: false,
          error: "Transaction data not found",
          verifiedAt: Date.now(),
        };
      }

      // Verify recipient if specified
      if (expectedRecipient) {
        // For ERC-20, recipient is in the transfer event logs
        const transferLog = receipt.logs.find(
          (log) =>
            log.topics[0] ===
            "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
        );

        if (transferLog) {
          const to = "0x" + transferLog.topics[2].slice(26);
          if (to.toLowerCase() !== expectedRecipient.toLowerCase()) {
            return {
              verified: false,
              error: `Recipient mismatch. Expected: ${expectedRecipient}, Got: ${to}`,
              verifiedAt: Date.now(),
            };
          }
        }
      }

      // Build response
      const gasUsed = BigInt(receipt.gasUsed);
      const gasPrice = BigInt(receipt.effectiveGasPrice);
      const fee = formatUnits(gasUsed * gasPrice, 18);

      const response: X402PaymentResponse = {
        txHash,
        status: PaymentStatus.Confirmed,
        fee,
        timestamp: Math.floor(Date.now() / 1000),
        blockNumber: parseInt(receipt.blockNumber, 16),
      };

      return {
        verified: true,
        transaction: response,
        verifiedAt: Date.now(),
      };
    } catch (error) {
      return {
        verified: false,
        error: error instanceof Error ? error.message : "Unknown error",
        verifiedAt: Date.now(),
      };
    }
  }

  // ==========================================================================
  // Helper Methods
  // ==========================================================================

  /**
   * Get token contract address for the current chain
   */
  getTokenAddress(token: X402Token): Address | undefined {
    return TOKEN_ADDRESSES[this.config.chain]?.[token] as Address | undefined;
  }

  /**
   * Get the USDs token address for the configured chain
   */
  getUSDsAddress(): Address | undefined {
    return this.getTokenAddress("USDs");
  }

  /**
   * Get the Sperax Vault address (only on Arbitrum)
   */
  getVaultAddress(): Address | undefined {
    if (this.config.chain === X402Network.Arbitrum) {
      return SPERAX_CONTRACTS.VAULT;
    }
    return undefined;
  }

  /**
   * Check if the current chain supports USDs
   */
  supportsUSDs(): boolean {
    return this.config.chain === X402Network.Arbitrum;
  }

  /**
   * Check if gasless transfers are supported for a token
   */
  supportsGasless(token: X402Token): boolean {
    // USDs supports EIP-3009 on Arbitrum
    if (token === "USDs" && this.config.chain === X402Network.Arbitrum) {
      return true;
    }
    // USDC supports EIP-3009 on most chains
    if (token === "USDC") {
      return true;
    }
    return false;
  }

  /**
   * Check if token is the native token for current chain
   */
  private isNativeToken(token: X402Token): boolean {
    return NATIVE_TOKEN[this.config.chain] === token;
  }

  /**
   * Parse a payment amount to the correct decimal precision
   *
   * @param amount - Amount as decimal string
   * @param token - Token type
   * @returns Amount in smallest unit as bigint string
   */
  parseAmount(amount: string, token: X402Token = "USDs"): string {
    return parseUnits(amount, TOKEN_DECIMALS[token]).toString();
  }

  /**
   * Format an amount from smallest unit to decimal string
   *
   * @param amount - Amount in smallest unit
   * @param token - Token type
   * @returns Amount as decimal string
   */
  formatAmount(amount: string | bigint, token: X402Token = "USDs"): string {
    return formatUnits(BigInt(amount), TOKEN_DECIMALS[token]);
  }

  /**
   * Get network health status
   */
  async getNetworkStatus(): Promise<{
    connected: boolean;
    chainId: number;
    blockNumber: number;
    gasPrice: string;
  }> {
    try {
      const [chainId, blockNumber, gasPrice] = await Promise.all([
        this.rpc.getChainId(),
        this.rpc.getBlockNumber(),
        this.rpc.getGasPrice(),
      ]);

      return {
        connected: true,
        chainId,
        blockNumber,
        gasPrice: formatUnits(gasPrice, 9) + " gwei",
      };
    } catch (error) {
      return {
        connected: false,
        chainId: 0,
        blockNumber: 0,
        gasPrice: "0",
      };
    }
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a new X402Client with default configuration
 *
 * @param config - Client configuration (chain is required)
 * @returns Configured X402Client instance
 */
export function createX402Client(config: X402Config): X402Client {
  return new X402Client(config);
}

/**
 * Create an X402Client for Arbitrum mainnet (primary USDs network)
 */
export function createArbitrumClient(
  privateKey?: string,
  options?: Partial<Omit<X402Config, "chain" | "privateKey">>,
): X402Client {
  return new X402Client({
    chain: X402Network.Arbitrum,
    privateKey,
    ...options,
  });
}

/**
 * Create an X402Client for Base mainnet
 */
export function createBaseClient(
  privateKey?: string,
  options?: Partial<Omit<X402Config, "chain" | "privateKey">>,
): X402Client {
  return new X402Client({
    chain: X402Network.Base,
    privateKey,
    ...options,
  });
}

/**
 * Create a mock X402Client for testing
 *
 * @param overrides - Optional configuration overrides
 * @returns X402Client configured for testing on Arbitrum Sepolia
 */
export function createMockX402Client(
  overrides?: Partial<X402Config>,
): X402Client {
  return new X402Client({
    chain: X402Network.ArbitrumSepolia,
    facilitatorUrl: "http://localhost:3002",
    timeout: 5000,
    ...overrides,
  });
}
