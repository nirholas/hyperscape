/**
 * @fileoverview X402 Payment Protocol Constants
 * @module @hyperscape/shared/web3/x402/constants
 *
 * Contract addresses, network configurations, and other constants
 * for the X402 payment protocol integration.
 */

import type { Address } from "./types";
import { X402Network, X402Token } from "./types";

/**
 * Sperax Protocol Contract Addresses on Arbitrum
 * @see https://docs.sperax.io/contracts
 */
export const SPERAX_CONTRACTS = {
  /** USDs Token - Auto-yield stablecoin */
  USDS_TOKEN: "0xD74f5255D557944cf7Dd0E45FF521520002D5748" as Address,
  /** Sperax Vault - Collateral management */
  VAULT: "0x8EC1877698ACF262Fe8Ad8a295ad94D6ea258988" as Address,
  /** SPA Governance Token */
  SPA_TOKEN: "0x5575552988A3A80504bBaeB1311674fCFd40aD4B" as Address,
  /** veSPA Staking Contract */
  VE_SPA: "0x2e2071180682Ce6C247B1eF93d382D509F5F6a17" as Address,
  /** Farm Controller */
  FARM_CONTROLLER: "0x72Ce2bBa4cf3CFa5C6D7CD2a23252c5Ce1E8fd21" as Address,
} as const;

/**
 * Default X402 Facilitator Service URL
 * The facilitator handles gasless transactions via EIP-3009
 */
export const DEFAULT_FACILITATOR_URL = "https://x402-facilitator.hyperscape.ai";

/**
 * Testnet Facilitator URL
 */
export const TESTNET_FACILITATOR_URL =
  "https://x402-facilitator-testnet.hyperscape.ai";

/**
 * Default RPC URLs for supported networks
 */
export const DEFAULT_RPC_URLS: Record<X402Network, string> = {
  [X402Network.Arbitrum]: "https://arb1.arbitrum.io/rpc",
  [X402Network.ArbitrumSepolia]: "https://sepolia-rollup.arbitrum.io/rpc",
  [X402Network.Base]: "https://mainnet.base.org",
  [X402Network.Ethereum]: "https://eth.llamarpc.com",
  [X402Network.Polygon]: "https://polygon-rpc.com",
  [X402Network.Optimism]: "https://mainnet.optimism.io",
  [X402Network.BSC]: "https://bsc-dataseed.binance.org",
};

/**
 * Fallback RPC URLs for redundancy
 */
export const FALLBACK_RPC_URLS: Record<X402Network, string[]> = {
  [X402Network.Arbitrum]: [
    "https://arbitrum.llamarpc.com",
    "https://rpc.ankr.com/arbitrum",
    "https://1rpc.io/arb",
  ],
  [X402Network.ArbitrumSepolia]: [
    "https://arbitrum-sepolia.blockpi.network/v1/rpc/public",
  ],
  [X402Network.Base]: ["https://base.llamarpc.com", "https://1rpc.io/base"],
  [X402Network.Ethereum]: ["https://rpc.ankr.com/eth", "https://1rpc.io/eth"],
  [X402Network.Polygon]: [
    "https://polygon.llamarpc.com",
    "https://1rpc.io/matic",
  ],
  [X402Network.Optimism]: [
    "https://optimism.llamarpc.com",
    "https://1rpc.io/op",
  ],
  [X402Network.BSC]: [
    "https://bsc-dataseed1.binance.org",
    "https://bsc-dataseed2.binance.org",
  ],
};

/**
 * ERC-20 Token Addresses per Network
 */
export const TOKEN_ADDRESSES: Record<
  X402Network,
  Partial<Record<X402Token, Address>>
> = {
  [X402Network.Arbitrum]: {
    USDs: "0xD74f5255D557944cf7Dd0E45FF521520002D5748",
    USDC: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", // Native USDC
    USDT: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
    DAI: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1",
    ETH: "0x0000000000000000000000000000000000000000", // Native
  },
  [X402Network.ArbitrumSepolia]: {
    USDC: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d", // Testnet USDC
    ETH: "0x0000000000000000000000000000000000000000",
  },
  [X402Network.Base]: {
    USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    USDT: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2",
    DAI: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb",
    ETH: "0x0000000000000000000000000000000000000000",
  },
  [X402Network.Ethereum]: {
    USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    DAI: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
    ETH: "0x0000000000000000000000000000000000000000",
  },
  [X402Network.Polygon]: {
    USDC: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", // Native USDC
    USDT: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
    DAI: "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063",
    MATIC: "0x0000000000000000000000000000000000000000",
  },
  [X402Network.Optimism]: {
    USDC: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", // Native USDC
    USDT: "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58",
    DAI: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1",
    ETH: "0x0000000000000000000000000000000000000000",
  },
  [X402Network.BSC]: {
    USDC: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
    USDT: "0x55d398326f99059fF775485246999027B3197955",
    DAI: "0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3",
    BNB: "0x0000000000000000000000000000000000000000",
  },
};

/**
 * Native token symbol per network
 */
export const NATIVE_TOKEN: Record<X402Network, X402Token> = {
  [X402Network.Arbitrum]: "ETH",
  [X402Network.ArbitrumSepolia]: "ETH",
  [X402Network.Base]: "ETH",
  [X402Network.Ethereum]: "ETH",
  [X402Network.Polygon]: "MATIC",
  [X402Network.Optimism]: "ETH",
  [X402Network.BSC]: "BNB",
};

/**
 * Block explorer URLs for transaction links
 */
export const BLOCK_EXPLORERS: Record<X402Network, string> = {
  [X402Network.Arbitrum]: "https://arbiscan.io",
  [X402Network.ArbitrumSepolia]: "https://sepolia.arbiscan.io",
  [X402Network.Base]: "https://basescan.org",
  [X402Network.Ethereum]: "https://etherscan.io",
  [X402Network.Polygon]: "https://polygonscan.com",
  [X402Network.Optimism]: "https://optimistic.etherscan.io",
  [X402Network.BSC]: "https://bscscan.com",
};

/**
 * Default transaction timeout in milliseconds
 */
export const DEFAULT_TX_TIMEOUT = 60_000;

/**
 * Default gas limit multiplier for safety margin
 */
export const GAS_LIMIT_MULTIPLIER = 1.2;

/**
 * Default number of confirmations to wait for
 */
export const DEFAULT_CONFIRMATIONS = 1;

/**
 * Maximum number of retries for failed RPC calls
 */
export const MAX_RPC_RETRIES = 3;

/**
 * Delay between RPC retries in milliseconds
 */
export const RPC_RETRY_DELAY = 1000;

/**
 * ERC-20 Transfer event signature
 */
export const TRANSFER_EVENT_SIGNATURE =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

/**
 * Minimal ERC-20 ABI for token operations
 */
export const ERC20_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "decimals",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    name: "symbol",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    name: "Transfer",
    type: "event",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false },
    ],
  },
] as const;

/**
 * USDs-specific ABI extensions for rebasing functionality
 */
export const USDS_ABI = [
  ...ERC20_ABI,
  {
    name: "rebasingCreditsPerToken",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "nonRebasingSupply",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "rebaseOptIn",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    name: "rebaseOptOut",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    name: "isNonRebasingAccount",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

/**
 * EIP-3009 ABI for gasless transfers (transferWithAuthorization)
 */
export const EIP3009_ABI = [
  {
    name: "transferWithAuthorization",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
      { name: "v", type: "uint8" },
      { name: "r", type: "bytes32" },
      { name: "s", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    name: "authorizationState",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "authorizer", type: "address" },
      { name: "nonce", type: "bytes32" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "DOMAIN_SEPARATOR",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bytes32" }],
  },
] as const;

/**
 * Sperax Vault ABI for yield information
 */
export const SPERAX_VAULT_ABI = [
  {
    name: "getCollateralValue",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "getAllCollaterals",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address[]" }],
  },
  {
    name: "getCollateralInfo",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "_collateral", type: "address" }],
    outputs: [
      { name: "isActive", type: "bool" },
      { name: "mintFee", type: "uint256" },
      { name: "redeemFee", type: "uint256" },
      { name: "balance", type: "uint256" },
    ],
  },
] as const;

/**
 * HTTP 402 header names
 */
export const HTTP402_HEADERS = {
  /** Standard WWW-Authenticate header */
  WWW_AUTHENTICATE: "www-authenticate",
  /** X402-specific payment address header */
  X402_ADDRESS: "x-402-address",
  /** X402-specific amount header */
  X402_AMOUNT: "x-402-amount",
  /** X402-specific token header */
  X402_TOKEN: "x-402-token",
  /** X402-specific chain header */
  X402_CHAIN: "x-402-chain",
  /** X402-specific deadline header */
  X402_DEADLINE: "x-402-deadline",
} as const;

/**
 * Current estimated APY for USDs on Arbitrum
 * This should be fetched dynamically in production
 */
export const ESTIMATED_USDS_APY = 8.5;

/**
 * Minimum payment amount in USD
 */
export const MIN_PAYMENT_AMOUNT = "0.001";

/**
 * Maximum payment amount per transaction in USD (safety limit)
 */
export const MAX_PAYMENT_AMOUNT = "10000";
