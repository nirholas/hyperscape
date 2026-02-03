/**
 * BNB Chain (BSC) Module
 *
 * Provides BNB Chain (BSC) support for Hyperscape on-chain operations.
 * Includes token operations like balance checks, transfers, and approvals.
 *
 * @module web3/bnb
 * @author Hyperscape
 * @license MIT
 *
 * @example
 * ```typescript
 * import {
 *   BNBClient,
 *   BSC_MAINNET,
 *   BSC_TESTNET,
 *   BSC_MAINNET_TOKENS,
 * } from '@hyperscape/shared/web3/bnb';
 *
 * // Create a read-only client for mainnet
 * const client = BNBClient.mainnet();
 *
 * // Get BNB balance
 * const balance = await client.getBalance('0x...');
 * console.log(`BNB Balance: ${balance.bnb}`);
 *
 * // Get token info
 * const tokenInfo = await client.getTokenInfo(BSC_MAINNET_TOKENS.USDT);
 * console.log(`Token: ${tokenInfo.name} (${tokenInfo.symbol})`);
 *
 * // Get token balance
 * const usdtBalance = await client.getTokenBalance('0x...', BSC_MAINNET_TOKENS.USDT);
 * console.log(`USDT Balance: ${usdtBalance}`);
 *
 * // Estimate gas for a transfer
 * const gasEstimate = await client.estimateGas({
 *   to: '0x...',
 *   amount: '1.0',
 * });
 * console.log(`Estimated cost: ${gasEstimate.estimatedCost} BNB`);
 * ```
 *
 * @example
 * ```typescript
 * // Create a client with write capabilities
 * const writeClient = new BNBClient({
 *   rpcUrl: BSC_MAINNET.rpcUrl,
 *   chainId: BSC_MAINNET.chainId,
 *   privateKey: process.env.PRIVATE_KEY,
 * });
 *
 * // Transfer BNB (requires ethers.js or viem for signing)
 * const result = await writeClient.transfer({
 *   to: '0x...',
 *   amount: '0.1',
 * });
 * ```
 */

// Export types
export type {
  BNBConfig,
  BNBBalance,
  BNBClientEvents,
  ApprovalRequest,
  GasEstimate,
  TokenBalance,
  TokenInfo,
  TransactionLog,
  TransactionReceipt,
  TransactionStatus,
  TransferRequest,
  TransferResult,
  WaitForTransactionOptions,
} from "./types.js";

// Export error class and enum (these are values, not just types)
export { BNBError, BNBErrorCode } from "./types.js";

// Export constants
export {
  // Network configurations
  BSC_MAINNET,
  BSC_TESTNET,
  OPBNB_MAINNET,
  OPBNB_TESTNET,
  CHAIN_CONFIG,
  NETWORK_NAME_TO_CHAIN_ID,

  // Token addresses
  BSC_MAINNET_TOKENS,
  BSC_TESTNET_TOKENS,

  // DEX routers
  BSC_DEX_ROUTERS,

  // ABI
  ERC20_ABI,

  // Default configuration
  DEFAULT_CONFIG,

  // Utility functions
  getNetworkConfig,
  getChainIdFromName,
  getExplorerTxUrl,
  getExplorerAddressUrl,
  getExplorerTokenUrl,
} from "./constants.js";

// Export client
export { BNBClient, toWei, fromWei, isValidAddress } from "./client.js";
