/**
 * @fileoverview Web3 Integration Module
 * @module @hyperscape/shared/web3
 *
 * Web3 and blockchain integrations for Hyperscape.
 * Provides payment protocols, wallet management, and DeFi integrations.
 *
 * ## Available Modules
 *
 * - **x402** - HTTP-402 payment protocol with USDs stablecoin
 *
 * @example
 * ```typescript
 * import { x402 } from '@hyperscape/shared/web3';
 *
 * const client = new x402.X402Client({
 *   chain: x402.X402Network.Arbitrum,
 *   privateKey: process.env.WALLET_KEY,
 * });
 * ```
 */

// X402 Payment Protocol
export * as x402 from "./x402";
export {
  X402Client,
  createX402Client,
  createArbitrumClient,
  createBaseClient,
  createMockX402Client,
} from "./x402";
export {
  X402Network,
  PaymentStatus,
  X402ErrorCode,
  X402Error,
  type X402Config,
  type X402PaymentRequest,
  type X402PaymentResponse,
  type X402Balance,
  type X402YieldInfo,
  type X402FeeEstimate,
  type X402PaymentVerification,
  type Address as Web3Address,
  type TxHash,
} from "./x402";

// BNB Chain Integration
export * as bnb from "./bnb";
export {
  BNBClient,
  BNBError,
  BNBErrorCode,
  BSC_MAINNET,
  BSC_TESTNET,
  OPBNB_MAINNET,
  OPBNB_TESTNET,
  BSC_MAINNET_TOKENS,
  BSC_TESTNET_TOKENS,
  BSC_DEX_ROUTERS,
  CHAIN_CONFIG as BNB_CHAIN_CONFIG,
  DEFAULT_CONFIG as BNB_DEFAULT_CONFIG,
  ERC20_ABI,
  toWei,
  fromWei,
  isValidAddress as isValidBnbAddress,
  getNetworkConfig as getBnbNetworkConfig,
  getExplorerTxUrl as getBnbExplorerTxUrl,
  getExplorerAddressUrl as getBnbExplorerAddressUrl,
  getExplorerTokenUrl as getBnbExplorerTokenUrl,
  type BNBConfig,
  type BNBBalance,
  type TransferRequest as BnbTransferRequest,
  type TransferResult as BnbTransferResult,
  type TokenBalance as BnbTokenBalance,
  type TokenInfo as BnbTokenInfo,
  type GasEstimate as BnbGasEstimate,
} from "./bnb";

// Solana Integration
export * as solana from "./solana";
export {
  SolanaWalletService,
  SPLTokenService,
  MAINNET_RPC_URL as SOLANA_MAINNET_RPC_URL,
  DEVNET_RPC_URL as SOLANA_DEVNET_RPC_URL,
  TESTNET_RPC_URL as SOLANA_TESTNET_RPC_URL,
  LAMPORTS_PER_SOL,
  lamportsToSol,
  solToLamports,
  COMMON_SPL_TOKENS,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  type SolanaWallet,
  type SolanaWalletExport,
  type SolanaConfig,
  type SolanaBalance,
  type SolanaCluster,
} from "./solana";

// Unified Wallet Manager
export { WalletManager, createWalletManager } from "./WalletManager";
export {
  // Chain & Network Types
  type ChainType,
  type NetworkId,
  type NetworkMetadata,
  NETWORK_METADATA,
  NETWORK_CHAIN_TYPE,
  // Unified Wallet Types
  type UnifiedWallet,
  type UnifiedBalance,
  type UnifiedTransaction,
  type TokenBalance,
  type TransactionType,
  type TransactionStatus,
  // Configuration
  type WalletManagerConfig,
  type SendTransactionParams,
  type FeeEstimate,
  DEFAULT_WALLET_MANAGER_CONFIG,
  // Events
  type WalletEvent,
  type WalletEventType,
  type WalletEventListener,
  // Errors
  WalletError,
  WalletErrorCode,
  // Utilities
  isEvmNetwork,
  isSolanaNetwork,
  isTestnet,
  getExplorerTxUrl,
  getExplorerAddressUrl,
  truncateAddress,
  formatUsd,
  formatTokenAmount,
  generateWalletId,
} from "./types";
