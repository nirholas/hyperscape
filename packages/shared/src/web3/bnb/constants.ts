/**
 * BNB Chain (BSC) Constants
 *
 * Network configuration, common token addresses, and other constants
 * for BNB Chain mainnet and testnet.
 *
 * @module web3/bnb/constants
 * @author Hyperscape
 * @license MIT
 */

/**
 * BNB Chain Mainnet configuration
 */
export const BSC_MAINNET = {
  /** Chain ID */
  chainId: 56,
  /** Network name */
  name: "BNB Smart Chain Mainnet",
  /** Short name */
  shortName: "bsc",
  /** Native currency symbol */
  nativeCurrency: {
    name: "BNB",
    symbol: "BNB",
    decimals: 18,
  },
  /** Primary RPC URL */
  rpcUrl: "https://bsc-dataseed.binance.org/",
  /** Alternative RPC URLs for fallback */
  rpcUrls: [
    "https://bsc-dataseed.binance.org/",
    "https://bsc-dataseed1.binance.org/",
    "https://bsc-dataseed2.binance.org/",
    "https://bsc-dataseed3.binance.org/",
    "https://bsc-dataseed4.binance.org/",
    "https://bsc-dataseed1.defibit.io/",
    "https://bsc-dataseed2.defibit.io/",
    "https://bsc-dataseed1.ninicoin.io/",
    "https://bsc-dataseed2.ninicoin.io/",
  ],
  /** Block explorer URL */
  explorerUrl: "https://bscscan.com",
  /** Block explorer API URL */
  explorerApiUrl: "https://api.bscscan.com/api",
  /** Average block time in seconds */
  blockTime: 3,
} as const;

/**
 * BNB Chain Testnet configuration
 */
export const BSC_TESTNET = {
  /** Chain ID */
  chainId: 97,
  /** Network name */
  name: "BNB Smart Chain Testnet",
  /** Short name */
  shortName: "bsc-testnet",
  /** Native currency symbol */
  nativeCurrency: {
    name: "tBNB",
    symbol: "tBNB",
    decimals: 18,
  },
  /** Primary RPC URL */
  rpcUrl: "https://data-seed-prebsc-1-s1.binance.org:8545/",
  /** Alternative RPC URLs for fallback */
  rpcUrls: [
    "https://data-seed-prebsc-1-s1.binance.org:8545/",
    "https://data-seed-prebsc-2-s1.binance.org:8545/",
    "https://data-seed-prebsc-1-s2.binance.org:8545/",
    "https://data-seed-prebsc-2-s2.binance.org:8545/",
    "https://data-seed-prebsc-1-s3.binance.org:8545/",
    "https://data-seed-prebsc-2-s3.binance.org:8545/",
  ],
  /** Block explorer URL */
  explorerUrl: "https://testnet.bscscan.com",
  /** Block explorer API URL */
  explorerApiUrl: "https://api-testnet.bscscan.com/api",
  /** Average block time in seconds */
  blockTime: 3,
} as const;

/**
 * opBNB Mainnet configuration
 */
export const OPBNB_MAINNET = {
  /** Chain ID */
  chainId: 204,
  /** Network name */
  name: "opBNB Mainnet",
  /** Short name */
  shortName: "opbnb",
  /** Native currency symbol */
  nativeCurrency: {
    name: "BNB",
    symbol: "BNB",
    decimals: 18,
  },
  /** Primary RPC URL */
  rpcUrl: "https://opbnb-mainnet-rpc.bnbchain.org",
  /** Alternative RPC URLs for fallback */
  rpcUrls: [
    "https://opbnb-mainnet-rpc.bnbchain.org",
    "https://opbnb-mainnet.nodereal.io/v1/64a9df0874fb4a93b9d0a3849de012d3",
  ],
  /** Block explorer URL */
  explorerUrl: "https://opbnbscan.com",
  /** Block explorer API URL */
  explorerApiUrl: "https://api-opbnb.bscscan.com/api",
  /** Average block time in seconds */
  blockTime: 1,
} as const;

/**
 * opBNB Testnet configuration
 */
export const OPBNB_TESTNET = {
  /** Chain ID */
  chainId: 5611,
  /** Network name */
  name: "opBNB Testnet",
  /** Short name */
  shortName: "opbnb-testnet",
  /** Native currency symbol */
  nativeCurrency: {
    name: "tBNB",
    symbol: "tBNB",
    decimals: 18,
  },
  /** Primary RPC URL */
  rpcUrl: "https://opbnb-testnet-rpc.bnbchain.org",
  /** Alternative RPC URLs for fallback */
  rpcUrls: ["https://opbnb-testnet-rpc.bnbchain.org"],
  /** Block explorer URL */
  explorerUrl: "https://testnet.opbnbscan.com",
  /** Block explorer API URL */
  explorerApiUrl: "https://api-opbnb-testnet.bscscan.com/api",
  /** Average block time in seconds */
  blockTime: 1,
} as const;

/**
 * Chain ID to network configuration mapping
 */
export const CHAIN_CONFIG = {
  56: BSC_MAINNET,
  97: BSC_TESTNET,
  204: OPBNB_MAINNET,
  5611: OPBNB_TESTNET,
} as const;

/**
 * Network name to chain ID mapping
 */
export const NETWORK_NAME_TO_CHAIN_ID: Record<string, number> = {
  bsc: 56,
  "bsc-mainnet": 56,
  binance: 56,
  bnb: 56,
  "bsc-testnet": 97,
  "binance-testnet": 97,
  "bnb-testnet": 97,
  opbnb: 204,
  "opbnb-mainnet": 204,
  "opbnb-testnet": 5611,
};

/**
 * Common token addresses on BSC Mainnet
 */
export const BSC_MAINNET_TOKENS = {
  /** Wrapped BNB */
  WBNB: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
  /** Binance USD (BUSD) */
  BUSD: "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56",
  /** Tether USD (USDT) */
  USDT: "0x55d398326f99059fF775485246999027B3197955",
  /** USD Coin (USDC) */
  USDC: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
  /** Dai Stablecoin */
  DAI: "0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3",
  /** PancakeSwap Token */
  CAKE: "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82",
  /** Ethereum (bridged) */
  ETH: "0x2170Ed0880ac9A755fd29B2688956BD959F933F8",
  /** Bitcoin (bridged) */
  BTCB: "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c",
  /** XRP (bridged) */
  XRP: "0x1D2F0da169ceB9fC7B3144628dB156f3F6c60dBE",
  /** Cardano (bridged) */
  ADA: "0x3EE2200Efb3400fAbB9AacF31297cBdD1d435D47",
  /** Dogecoin (bridged) */
  DOGE: "0xbA2aE424d960c26247Dd6c32edC70B295c744C43",
  /** Polkadot (bridged) */
  DOT: "0x7083609fCE4d1d8Dc0C979AAb8c869Ea2C873402",
  /** Chainlink */
  LINK: "0xF8A0BF9cF54Bb92F17374d9e9A321E6a111a51bD",
  /** Uniswap (bridged) */
  UNI: "0xBf5140A22578168FD562DCcF235E5D43A02ce9B1",
  /** TrueUSD */
  TUSD: "0x14016E85a25aeb13065688cAFB43044C2ef86784",
  /** First Digital USD */
  FDUSD: "0xc5f0f7b66764F6ec8C8Dff7BA683102295E16409",
} as const;

/**
 * Common token addresses on BSC Testnet
 */
export const BSC_TESTNET_TOKENS = {
  /** Wrapped BNB */
  WBNB: "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd",
  /** Test BUSD */
  BUSD: "0xeD24FC36d5Ee211Ea25A80239Fb8C4Cfd80f12Ee",
  /** Test USDT */
  USDT: "0x337610d27c682E347C9cD60BD4b3b107C9d34dDd",
  /** Test DAI */
  DAI: "0xEC5dCb5Dbf4B114C9d0F65BcCAb49EC54F6A0867",
} as const;

/**
 * Common DEX router addresses on BSC
 */
export const BSC_DEX_ROUTERS = {
  /** PancakeSwap V2 Router */
  PANCAKESWAP_V2: "0x10ED43C718714eb63d5aA57B78B54704E256024E",
  /** PancakeSwap V3 Router */
  PANCAKESWAP_V3: "0x13f4EA83D0bd40E75C8222255bc855a974568Dd4",
  /** Biswap Router */
  BISWAP: "0x3a6d8cA21D1CF76F653A67577FA0D27453350dD8",
  /** ApeSwap Router */
  APESWAP: "0xcF0feBd3f17CEf5b47b0cD257aCf6025c5BFf3b7",
} as const;

/**
 * Standard ERC-20 ABI for token operations
 */
export const ERC20_ABI = [
  // Read functions
  {
    inputs: [],
    name: "name",
    outputs: [{ type: "string" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "symbol",
    outputs: [{ type: "string" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "decimals",
    outputs: [{ type: "uint8" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "totalSupply",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    name: "allowance",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  // Write functions
  {
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "transfer",
    outputs: [{ type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "approve",
    outputs: [{ type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "transferFrom",
    outputs: [{ type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  // Events
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "from", type: "address" },
      { indexed: true, name: "to", type: "address" },
      { indexed: false, name: "value", type: "uint256" },
    ],
    name: "Transfer",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "owner", type: "address" },
      { indexed: true, name: "spender", type: "address" },
      { indexed: false, name: "value", type: "uint256" },
    ],
    name: "Approval",
    type: "event",
  },
] as const;

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG = {
  /** Default timeout for RPC requests (ms) */
  timeout: 30000,
  /** Default number of retry attempts */
  retryAttempts: 3,
  /** Default delay between retries (ms) */
  retryDelay: 1000,
  /** Default gas limit for native transfers */
  gasLimitNative: "21000",
  /** Default gas limit for token transfers */
  gasLimitToken: "100000",
  /** Default gas limit for token approvals */
  gasLimitApproval: "50000",
  /** Maximum uint256 value for unlimited approval */
  maxUint256:
    "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
} as const;

/**
 * Get network configuration by chain ID
 * @param chainId - The chain ID
 * @returns Network configuration or undefined
 */
export function getNetworkConfig(chainId: number) {
  return CHAIN_CONFIG[chainId as keyof typeof CHAIN_CONFIG];
}

/**
 * Get chain ID from network name
 * @param networkName - The network name (e.g., 'bsc', 'bsc-testnet')
 * @returns Chain ID or undefined
 */
export function getChainIdFromName(networkName: string): number | undefined {
  return NETWORK_NAME_TO_CHAIN_ID[networkName.toLowerCase()];
}

/**
 * Get block explorer URL for a transaction
 * @param chainId - The chain ID
 * @param txHash - The transaction hash
 * @returns Block explorer URL
 */
export function getExplorerTxUrl(chainId: number, txHash: string): string {
  const config = getNetworkConfig(chainId);
  if (!config) {
    return `https://bscscan.com/tx/${txHash}`;
  }
  return `${config.explorerUrl}/tx/${txHash}`;
}

/**
 * Get block explorer URL for an address
 * @param chainId - The chain ID
 * @param address - The address
 * @returns Block explorer URL
 */
export function getExplorerAddressUrl(
  chainId: number,
  address: string,
): string {
  const config = getNetworkConfig(chainId);
  if (!config) {
    return `https://bscscan.com/address/${address}`;
  }
  return `${config.explorerUrl}/address/${address}`;
}

/**
 * Get block explorer URL for a token
 * @param chainId - The chain ID
 * @param tokenAddress - The token contract address
 * @returns Block explorer URL
 */
export function getExplorerTokenUrl(
  chainId: number,
  tokenAddress: string,
): string {
  const config = getNetworkConfig(chainId);
  if (!config) {
    return `https://bscscan.com/token/${tokenAddress}`;
  }
  return `${config.explorerUrl}/token/${tokenAddress}`;
}
