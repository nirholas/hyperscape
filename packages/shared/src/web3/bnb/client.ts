/**
 * BNB Chain (BSC) Client
 *
 * A production-ready client for interacting with BNB Chain (BSC) for token operations.
 * Supports both read-only operations and write operations (with private key).
 *
 * Uses pure HTTP JSON-RPC for all blockchain interactions - no external dependencies.
 *
 * @module web3/bnb/client
 * @author Hyperscape
 * @license MIT
 */

import {
  BNBConfig,
  BNBBalance,
  BNBError,
  BNBErrorCode,
  GasEstimate,
  TokenBalance,
  TokenInfo,
  TransferRequest,
  TransferResult,
  TransactionReceipt,
  WaitForTransactionOptions,
} from "./types.js";
import { BSC_MAINNET, BSC_TESTNET, DEFAULT_CONFIG } from "./constants.js";

// ==================== Utility Functions ====================

/**
 * Utility function to sleep for a specified duration
 * @param ms - Duration in milliseconds
 */
const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Convert a value to Wei (smallest unit)
 * @param value - Value in Ether/BNB units
 * @param decimals - Number of decimals (default: 18)
 * @returns Value in Wei as bigint
 */
export function toWei(value: string, decimals: number = 18): bigint {
  const [integer = "0", fraction = ""] = value.split(".");
  const paddedFraction = fraction.padEnd(decimals, "0").slice(0, decimals);
  const combined = integer + paddedFraction;
  return BigInt(combined.replace(/^0+/, "") || "0");
}

/**
 * Convert a value from Wei to human-readable units
 * @param value - Value in Wei (bigint or string)
 * @param decimals - Number of decimals (default: 18)
 * @returns Value in human-readable units
 */
export function fromWei(value: bigint | string, decimals: number = 18): string {
  const bigintValue = typeof value === "string" ? BigInt(value) : value;
  const str = bigintValue.toString().padStart(decimals + 1, "0");
  const intPart = str.slice(0, -decimals) || "0";
  const fracPart = str.slice(-decimals).replace(/0+$/, "");
  return fracPart ? `${intPart}.${fracPart}` : intPart;
}

/**
 * Validate Ethereum/BNB address format
 * @param address - Address to validate
 * @returns True if valid
 */
export function isValidAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

/**
 * Encode a bigint to hex with 0x prefix
 */
function toHex(value: bigint | number): string {
  const hex = BigInt(value).toString(16);
  return "0x" + hex;
}

/**
 * Decode hex string to bigint
 */
function fromHex(value: string): bigint {
  if (!value || value === "0x") return 0n;
  return BigInt(value);
}

/**
 * Pad a hex value to 32 bytes (64 hex chars)
 */
function padTo32Bytes(value: string): string {
  const stripped = value.startsWith("0x") ? value.slice(2) : value;
  return stripped.toLowerCase().padStart(64, "0");
}

/**
 * Precomputed function selectors (first 4 bytes of keccak256 hash)
 */
const FUNCTION_SELECTORS: Record<string, string> = {
  // ERC-20 standard functions
  "balanceOf(address)": "70a08231",
  "transfer(address,uint256)": "a9059cbb",
  "approve(address,uint256)": "095ea7b3",
  "allowance(address,address)": "dd62ed3e",
  "name()": "06fdde03",
  "symbol()": "95d89b41",
  "decimals()": "313ce567",
  "totalSupply()": "18160ddd",
};

/**
 * Get function selector for a function signature
 */
function getFunctionSelector(signature: string): string {
  const selector = FUNCTION_SELECTORS[signature];
  if (!selector) {
    throw new BNBError(
      `Unknown function signature: ${signature}`,
      BNBErrorCode.INVALID_CONFIG,
    );
  }
  return selector;
}

/**
 * Encode ERC-20 function call data
 */
function encodeERC20Call(
  functionName: string,
  args: (string | bigint)[] = [],
): string {
  let selector: string;
  let data = "";

  switch (functionName) {
    case "balanceOf":
      selector = getFunctionSelector("balanceOf(address)");
      data = selector + padTo32Bytes(args[0] as string);
      break;
    case "transfer":
      selector = getFunctionSelector("transfer(address,uint256)");
      data =
        selector +
        padTo32Bytes(args[0] as string) +
        padTo32Bytes(BigInt(args[1]).toString(16));
      break;
    case "approve":
      selector = getFunctionSelector("approve(address,uint256)");
      data =
        selector +
        padTo32Bytes(args[0] as string) +
        padTo32Bytes(BigInt(args[1]).toString(16));
      break;
    case "allowance":
      selector = getFunctionSelector("allowance(address,address)");
      data =
        selector +
        padTo32Bytes(args[0] as string) +
        padTo32Bytes(args[1] as string);
      break;
    case "name":
      selector = getFunctionSelector("name()");
      data = selector;
      break;
    case "symbol":
      selector = getFunctionSelector("symbol()");
      data = selector;
      break;
    case "decimals":
      selector = getFunctionSelector("decimals()");
      data = selector;
      break;
    case "totalSupply":
      selector = getFunctionSelector("totalSupply()");
      data = selector;
      break;
    default:
      throw new BNBError(
        `Unknown ERC-20 function: ${functionName}`,
        BNBErrorCode.INVALID_CONFIG,
      );
  }

  return "0x" + data;
}

/**
 * Decode a string from ABI-encoded response (dynamic string type)
 */
function decodeString(data: string): string {
  const hex = data.startsWith("0x") ? data.slice(2) : data;
  if (hex.length < 128) return "";

  // Skip offset (32 bytes) and get length (32 bytes)
  const lengthHex = hex.slice(64, 128);
  const length = parseInt(lengthHex, 16);

  // Get the actual string data
  const strHex = hex.slice(128, 128 + length * 2);

  // Convert hex to string
  let str = "";
  for (let i = 0; i < strHex.length; i += 2) {
    const charCode = parseInt(strHex.slice(i, i + 2), 16);
    if (charCode === 0) break;
    str += String.fromCharCode(charCode);
  }
  return str;
}

/**
 * Decode a uint256 from ABI-encoded response
 */
function decodeUint256(data: string): bigint {
  const hex = data.startsWith("0x") ? data.slice(2) : data;
  if (!hex || hex === "0") return 0n;
  return BigInt("0x" + hex);
}

// ==================== RPC Client ====================

/**
 * Raw transaction receipt from RPC
 */
interface RpcTransactionReceipt {
  transactionHash: string;
  blockNumber: string;
  blockHash: string;
  transactionIndex: string;
  gasUsed: string;
  effectiveGasPrice?: string;
  status: string;
  from: string;
  to: string | null;
  contractAddress: string | null;
  logs: Array<{
    logIndex: string;
    address: string;
    topics: string[];
    data: string;
  }>;
}

/**
 * JSON-RPC client for BNB Chain
 */
class RpcClient {
  private requestId = 0;

  constructor(
    private rpcUrl: string,
    private timeout: number,
    private retryAttempts: number,
    private retryDelay: number,
  ) {}

  /**
   * Make a JSON-RPC call with retry logic
   */
  async call<T>(method: string, params: unknown[] = []): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.retryAttempts; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        const response = await fetch(this.rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: ++this.requestId,
            method,
            params,
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const json = await response.json();

        if (json.error) {
          throw new Error(json.error.message || JSON.stringify(json.error));
        }

        return json.result as T;
      } catch (error) {
        lastError = error as Error;
        if (attempt < this.retryAttempts - 1) {
          await sleep(this.retryDelay * (attempt + 1));
        }
      }
    }

    throw new BNBError(
      `RPC call failed after ${this.retryAttempts} attempts: ${lastError?.message}`,
      BNBErrorCode.RPC_ERROR,
      lastError || undefined,
    );
  }

  async getBalance(address: string): Promise<bigint> {
    const result = await this.call<string>("eth_getBalance", [
      address,
      "latest",
    ]);
    return fromHex(result);
  }

  async getTransactionCount(address: string): Promise<number> {
    const result = await this.call<string>("eth_getTransactionCount", [
      address,
      "latest",
    ]);
    return Number(fromHex(result));
  }

  async getGasPrice(): Promise<bigint> {
    const result = await this.call<string>("eth_gasPrice", []);
    return fromHex(result);
  }

  async getBlockNumber(): Promise<number> {
    const result = await this.call<string>("eth_blockNumber", []);
    return Number(fromHex(result));
  }

  async getChainId(): Promise<number> {
    const result = await this.call<string>("eth_chainId", []);
    return Number(fromHex(result));
  }

  async ethCall(to: string, data: string): Promise<string> {
    return this.call<string>("eth_call", [{ to, data }, "latest"]);
  }

  async estimateGas(params: {
    from?: string;
    to: string;
    value?: string;
    data?: string;
  }): Promise<bigint> {
    const txParams: Record<string, string> = { to: params.to };
    if (params.from) txParams.from = params.from;
    if (params.value) txParams.value = params.value;
    if (params.data) txParams.data = params.data;

    const result = await this.call<string>("eth_estimateGas", [txParams]);
    return fromHex(result);
  }

  async sendRawTransaction(signedTx: string): Promise<string> {
    return this.call<string>("eth_sendRawTransaction", [signedTx]);
  }

  async getTransactionReceipt(
    txHash: string,
  ): Promise<RpcTransactionReceipt | null> {
    return this.call<RpcTransactionReceipt | null>(
      "eth_getTransactionReceipt",
      [txHash],
    );
  }

  async getCode(address: string): Promise<string> {
    return this.call<string>("eth_getCode", [address, "latest"]);
  }
}

// ==================== BNB Chain Client ====================

/**
 * BNB Chain Client for on-chain operations
 *
 * Provides a production-ready interface for interacting with BSC and opBNB networks.
 * Uses pure HTTP JSON-RPC - no external dependencies like viem or ethers.
 *
 * @example
 * ```typescript
 * // Read-only client
 * const client = new BNBClient({
 *   rpcUrl: 'https://bsc-dataseed.binance.org/',
 *   chainId: 56,
 * });
 *
 * // Get balance
 * const balance = await client.getBalance('0x...');
 *
 * // Get token info
 * const tokenInfo = await client.getTokenInfo('0x...');
 * ```
 */
export class BNBClient {
  private readonly config: Required<
    Pick<
      BNBConfig,
      "rpcUrl" | "chainId" | "timeout" | "retryAttempts" | "retryDelay"
    >
  > &
    Pick<BNBConfig, "privateKey">;

  private readonly rpc: RpcClient;
  private readonly walletAddress?: string;

  constructor(config: BNBConfig) {
    if (!config.rpcUrl) {
      throw new BNBError("RPC URL is required", BNBErrorCode.INVALID_CONFIG);
    }
    if (!config.chainId) {
      throw new BNBError("Chain ID is required", BNBErrorCode.INVALID_CONFIG);
    }

    this.config = {
      rpcUrl: config.rpcUrl,
      chainId: config.chainId,
      privateKey: config.privateKey,
      timeout: config.timeout ?? DEFAULT_CONFIG.timeout,
      retryAttempts: config.retryAttempts ?? DEFAULT_CONFIG.retryAttempts,
      retryDelay: config.retryDelay ?? DEFAULT_CONFIG.retryDelay,
    };

    this.rpc = new RpcClient(
      this.config.rpcUrl,
      this.config.timeout,
      this.config.retryAttempts,
      this.config.retryDelay,
    );

    if (config.privateKey) {
      this.walletAddress = config.walletAddress;
    }
  }

  static mainnet(options?: Partial<BNBConfig>): BNBClient {
    return new BNBClient({
      rpcUrl: options?.rpcUrl ?? BSC_MAINNET.rpcUrl,
      chainId: BSC_MAINNET.chainId,
      ...options,
    });
  }

  static testnet(options?: Partial<BNBConfig>): BNBClient {
    return new BNBClient({
      rpcUrl: options?.rpcUrl ?? BSC_TESTNET.rpcUrl,
      chainId: BSC_TESTNET.chainId,
      ...options,
    });
  }

  // ==================== Read Operations ====================

  async getBalance(
    address: string,
    tokenAddresses: string[] = [],
  ): Promise<BNBBalance> {
    if (!isValidAddress(address)) {
      throw new BNBError(
        "Invalid address format",
        BNBErrorCode.INVALID_ADDRESS,
      );
    }

    try {
      const bnbWei = await this.rpc.getBalance(address);
      const bnb = fromWei(bnbWei, 18);

      const tokens = new Map<string, TokenBalance>();

      if (tokenAddresses.length > 0) {
        const tokenPromises = tokenAddresses.map(async (tokenAddress) => {
          try {
            const balance = await this.getTokenBalance(address, tokenAddress);
            const info = await this.getTokenInfo(tokenAddress);

            return {
              address: tokenAddress.toLowerCase(),
              data: {
                address: tokenAddress,
                symbol: info.symbol,
                decimals: info.decimals,
                balance,
                balanceRaw: toWei(balance, info.decimals).toString(),
              } as TokenBalance,
            };
          } catch {
            return null;
          }
        });

        const results = await Promise.all(tokenPromises);
        for (const result of results) {
          if (result) {
            tokens.set(result.address, result.data);
          }
        }
      }

      return {
        bnb,
        bnbWei: bnbWei.toString(),
        tokens,
      };
    } catch (error) {
      if (error instanceof BNBError) throw error;
      throw new BNBError(
        `Failed to get balance: ${(error as Error).message}`,
        BNBErrorCode.RPC_ERROR,
        error as Error,
      );
    }
  }

  async getTokenBalance(
    address: string,
    tokenAddress: string,
  ): Promise<string> {
    if (!isValidAddress(address)) {
      throw new BNBError(
        "Invalid address format",
        BNBErrorCode.INVALID_ADDRESS,
      );
    }
    if (!isValidAddress(tokenAddress)) {
      throw new BNBError(
        "Invalid token address format",
        BNBErrorCode.INVALID_ADDRESS,
      );
    }

    try {
      const decimals = await this.getTokenDecimals(tokenAddress);
      const data = encodeERC20Call("balanceOf", [address]);
      const result = await this.rpc.ethCall(tokenAddress, data);

      const balance = decodeUint256(result);
      return fromWei(balance, decimals);
    } catch (error) {
      if (error instanceof BNBError) throw error;
      throw new BNBError(
        `Failed to get token balance: ${(error as Error).message}`,
        BNBErrorCode.RPC_ERROR,
        error as Error,
      );
    }
  }

  async getTokenDecimals(tokenAddress: string): Promise<number> {
    const data = encodeERC20Call("decimals");
    const result = await this.rpc.ethCall(tokenAddress, data);
    return Number(decodeUint256(result));
  }

  async getTokenInfo(tokenAddress: string): Promise<TokenInfo> {
    if (!isValidAddress(tokenAddress)) {
      throw new BNBError(
        "Invalid token address format",
        BNBErrorCode.INVALID_ADDRESS,
      );
    }

    try {
      const [nameResult, symbolResult, decimalsResult, totalSupplyResult] =
        await Promise.all([
          this.rpc.ethCall(tokenAddress, encodeERC20Call("name")),
          this.rpc.ethCall(tokenAddress, encodeERC20Call("symbol")),
          this.rpc.ethCall(tokenAddress, encodeERC20Call("decimals")),
          this.rpc.ethCall(tokenAddress, encodeERC20Call("totalSupply")),
        ]);

      const name = decodeString(nameResult);
      const symbol = decodeString(symbolResult);
      const decimals = Number(decodeUint256(decimalsResult));
      const totalSupply = fromWei(decodeUint256(totalSupplyResult), decimals);

      return {
        address: tokenAddress,
        name,
        symbol,
        decimals,
        totalSupply,
      };
    } catch (error) {
      if (error instanceof BNBError) throw error;
      throw new BNBError(
        `Failed to get token info: ${(error as Error).message}`,
        BNBErrorCode.CONTRACT_NOT_FOUND,
        error as Error,
      );
    }
  }

  async estimateGas(request: TransferRequest): Promise<GasEstimate> {
    if (!isValidAddress(request.to)) {
      throw new BNBError(
        "Invalid recipient address",
        BNBErrorCode.INVALID_ADDRESS,
      );
    }

    const from =
      this.walletAddress ?? "0x0000000000000000000000000000000000000001";

    try {
      let gasLimit: bigint;

      if (request.token) {
        if (!isValidAddress(request.token)) {
          throw new BNBError(
            "Invalid token address",
            BNBErrorCode.INVALID_ADDRESS,
          );
        }

        const decimals = await this.getTokenDecimals(request.token);
        const amount = toWei(request.amount, decimals);
        const data = encodeERC20Call("transfer", [request.to, amount]);

        gasLimit = await this.rpc.estimateGas({
          from,
          to: request.token,
          data,
        });
      } else {
        const value = toHex(toWei(request.amount, 18));

        gasLimit = await this.rpc.estimateGas({
          from,
          to: request.to,
          value,
        });
      }

      const gasPrice = await this.rpc.getGasPrice();
      const estimatedCostWei = gasLimit * gasPrice;

      return {
        gasLimit: gasLimit.toString(),
        gasPrice: gasPrice.toString(),
        gasPriceGwei: fromWei(gasPrice, 9),
        estimatedCost: fromWei(estimatedCostWei, 18),
        estimatedCostWei: estimatedCostWei.toString(),
      };
    } catch (error) {
      if (error instanceof BNBError) throw error;
      throw new BNBError(
        `Failed to estimate gas: ${(error as Error).message}`,
        BNBErrorCode.RPC_ERROR,
        error as Error,
      );
    }
  }

  async getAllowance(
    token: string,
    owner: string,
    spender: string,
  ): Promise<string> {
    if (!isValidAddress(token)) {
      throw new BNBError("Invalid token address", BNBErrorCode.INVALID_ADDRESS);
    }
    if (!isValidAddress(owner)) {
      throw new BNBError("Invalid owner address", BNBErrorCode.INVALID_ADDRESS);
    }
    if (!isValidAddress(spender)) {
      throw new BNBError(
        "Invalid spender address",
        BNBErrorCode.INVALID_ADDRESS,
      );
    }

    try {
      const decimals = await this.getTokenDecimals(token);
      const data = encodeERC20Call("allowance", [owner, spender]);
      const result = await this.rpc.ethCall(token, data);

      const allowance = decodeUint256(result);
      return fromWei(allowance, decimals);
    } catch (error) {
      if (error instanceof BNBError) throw error;
      throw new BNBError(
        `Failed to get allowance: ${(error as Error).message}`,
        BNBErrorCode.RPC_ERROR,
        error as Error,
      );
    }
  }

  async getTransactionReceipt(
    txHash: string,
  ): Promise<TransactionReceipt | null> {
    try {
      const receipt = await this.rpc.getTransactionReceipt(txHash);
      if (!receipt) return null;

      return this.convertReceipt(receipt);
    } catch {
      return null;
    }
  }

  private convertReceipt(receipt: RpcTransactionReceipt): TransactionReceipt {
    return {
      txHash: receipt.transactionHash,
      blockNumber: Number(fromHex(receipt.blockNumber)),
      blockHash: receipt.blockHash,
      transactionIndex: Number(fromHex(receipt.transactionIndex)),
      gasUsed: fromHex(receipt.gasUsed).toString(),
      effectiveGasPrice: receipt.effectiveGasPrice
        ? fromHex(receipt.effectiveGasPrice).toString()
        : "0",
      status: receipt.status === "0x1" ? 1 : 0,
      from: receipt.from,
      to: receipt.to ?? "",
      contractAddress: receipt.contractAddress ?? undefined,
      logs: receipt.logs.map((log) => ({
        logIndex: Number(fromHex(log.logIndex)),
        address: log.address,
        topics: log.topics,
        data: log.data,
      })),
    };
  }

  async waitForTransaction(
    txHash: string,
    options: WaitForTransactionOptions = {},
  ): Promise<TransactionReceipt> {
    const {
      confirmations = 1,
      timeout = 60000,
      pollingInterval = 1000,
    } = options;

    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const receipt = await this.getTransactionReceipt(txHash);

      if (receipt) {
        const currentBlock = await this.rpc.getBlockNumber();
        const txConfirmations = currentBlock - receipt.blockNumber + 1;

        if (txConfirmations >= confirmations) {
          return receipt;
        }
      }

      await sleep(pollingInterval);
    }

    throw new BNBError(
      `Transaction ${txHash} not confirmed within ${timeout}ms`,
      BNBErrorCode.TIMEOUT_ERROR,
    );
  }

  async getBlockNumber(): Promise<number> {
    return this.rpc.getBlockNumber();
  }

  async getGasPrice(): Promise<string> {
    const gasPrice = await this.rpc.getGasPrice();
    return fromWei(gasPrice, 9);
  }

  async isContract(address: string): Promise<boolean> {
    if (!isValidAddress(address)) {
      throw new BNBError(
        "Invalid address format",
        BNBErrorCode.INVALID_ADDRESS,
      );
    }

    const code = await this.rpc.getCode(address);
    return code !== "0x" && code !== "";
  }

  async getTransactionCount(address?: string): Promise<number> {
    const addr = address ?? this.walletAddress;
    if (!addr) {
      throw new BNBError(
        "Address is required when no wallet is configured",
        BNBErrorCode.INVALID_ADDRESS,
      );
    }

    if (!isValidAddress(addr)) {
      throw new BNBError(
        "Invalid address format",
        BNBErrorCode.INVALID_ADDRESS,
      );
    }

    return this.rpc.getTransactionCount(addr);
  }

  getChainId(): number {
    return this.config.chainId;
  }

  getRpcUrl(): string {
    return this.config.rpcUrl;
  }

  canWrite(): boolean {
    return !!this.config.privateKey && !!this.walletAddress;
  }

  getAddress(): string | undefined {
    return this.walletAddress;
  }

  isValidAddress(address: string): boolean {
    return isValidAddress(address);
  }

  // ==================== Write Operations ====================

  async transfer(_request: TransferRequest): Promise<TransferResult> {
    throw new BNBError(
      "Direct transfers require external signing. Use an RPC provider with signing capability or integrate with a wallet library.",
      BNBErrorCode.PRIVATE_KEY_REQUIRED,
    );
  }

  async transferToken(
    _token: string,
    _request: TransferRequest,
  ): Promise<TransferResult> {
    throw new BNBError(
      "Token transfers require external signing. Use an RPC provider with signing capability or integrate with a wallet library.",
      BNBErrorCode.PRIVATE_KEY_REQUIRED,
    );
  }

  async approve(
    _token: string,
    _spender: string,
    _amount: string,
  ): Promise<TransferResult> {
    throw new BNBError(
      "Token approvals require external signing. Use an RPC provider with signing capability or integrate with a wallet library.",
      BNBErrorCode.PRIVATE_KEY_REQUIRED,
    );
  }
}

// ==================== Factory Functions ====================

export function createBSCMainnetClient(
  options?: Partial<BNBConfig>,
): BNBClient {
  return BNBClient.mainnet(options);
}

export function createBSCTestnetClient(
  options?: Partial<BNBConfig>,
): BNBClient {
  return BNBClient.testnet(options);
}

export function createOpBNBMainnetClient(
  options?: Partial<BNBConfig>,
): BNBClient {
  return new BNBClient({
    rpcUrl: options?.rpcUrl ?? "https://opbnb-mainnet-rpc.bnbchain.org",
    chainId: 204,
    ...options,
  });
}

export function createOpBNBTestnetClient(
  options?: Partial<BNBConfig>,
): BNBClient {
  return new BNBClient({
    rpcUrl: options?.rpcUrl ?? "https://opbnb-testnet-rpc.bnbchain.org",
    chainId: 5611,
    ...options,
  });
}
