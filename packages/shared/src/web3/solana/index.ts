/**
 * @fileoverview Solana wallet and blockchain integration for Hyperscape.
 *
 * This module provides wallet generation, management, and Solana RPC operations
 * for Hyperscape's blockchain-based game asset system.
 *
 * @example
 * ```typescript
 * import {
 *   SolanaWalletService,
 *   SPLTokenService,
 *   DEVNET_RPC_URL,
 *   lamportsToSol,
 *   solToLamports,
 * } from '@hyperscape/shared/web3/solana';
 *
 * // Generate a new wallet
 * const wallet = SolanaWalletService.generate();
 * const address = SolanaWalletService.toBase58(wallet.publicKey);
 *
 * // Connect to devnet and check balance
 * const service = new SolanaWalletService({ rpcUrl: DEVNET_RPC_URL });
 * const balance = await service.getBalance(address);
 * console.log(`Balance: ${balance.sol} SOL`);
 *
 * // Check SPL token balances
 * const spl = new SPLTokenService({ rpcUrl: DEVNET_RPC_URL });
 * const tokens = await spl.getAllTokenBalances(address);
 *
 * // Request an airdrop (devnet only)
 * const airdrop = await service.requestAirdrop(address, solToLamports(1).toString());
 *
 * // Clean up sensitive data
 * SolanaWalletService.zeroize(wallet);
 * ```
 *
 * @module web3/solana
 */

// Export main service classes
export { SolanaWalletService } from "./wallet";
export { SPLTokenService } from "./spl";

// Export all types
export type {
  SolanaWallet,
  SolanaWalletExport,
  SolanaConfig,
  SolanaBalance,
  TransferRequest,
  TransferResult,
  VanityOptions,
  VanityResult,
  VanityProgress,
  AirdropResult,
  BlockhashInfo,
  AddressValidation,
  SolanaCommitment,
  SolanaCluster,
  WalletSaveOptions,
  SolanaRpcError,
  // SPL Token types
  SPLTokenInfo,
  SPLTokenBalance,
  SPLTransferRequest,
  SPLMintRequest,
  SPLBurnRequest,
  TokenAccountInfo,
} from "./types";

// Export constants
export {
  // RPC URLs
  MAINNET_RPC_URL,
  DEVNET_RPC_URL,
  TESTNET_RPC_URL,
  LOCALNET_RPC_URL,
  CLUSTER_RPC_URLS,

  // Conversion constants
  LAMPORTS_PER_SOL,
  LAMPORTS_PER_SOL_NUMBER,

  // Key lengths
  PUBLIC_KEY_LENGTH,
  SECRET_KEY_LENGTH,
  SEED_LENGTH,
  ADDRESS_MIN_LENGTH,
  ADDRESS_MAX_LENGTH,

  // Base58
  BASE58_ALPHABET,
  BASE58_CHARS,

  // Airdrop limits
  MAX_AIRDROP_LAMPORTS,

  // Timeouts
  DEFAULT_CONFIRM_TIMEOUT_MS,
  DEFAULT_RPC_TIMEOUT_MS,

  // Vanity generation
  MAX_VANITY_PATTERN_LENGTH,
  VANITY_PROGRESS_INTERVAL,

  // Security
  SECURE_FILE_MODE,
  CONFUSED_CHARACTERS,

  // SPL Token constants
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  SYSTEM_PROGRAM_ID,
  RENT_SYSVAR_ID,
  COMMON_SPL_TOKENS,
  SPL_TOKEN_DECIMALS,
  DEVNET_TOKENS,

  // Utility functions
  getClusterUrl,
  isMainnetCluster,
  supportsAirdrop,
  lamportsToSol,
  solToLamports,
  estimateVanityAttempts,
} from "./constants";
