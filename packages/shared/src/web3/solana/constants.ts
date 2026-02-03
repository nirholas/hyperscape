/**
 * @fileoverview Constants for Solana blockchain operations in Hyperscape.
 * Includes network endpoints, conversion factors, and Base58 utilities.
 * @module web3/solana/constants
 */

import type { SolanaCluster } from "./types";

/**
 * Solana mainnet-beta RPC endpoint.
 * @warning Use with caution - real funds at risk.
 */
export const MAINNET_RPC_URL = "https://api.mainnet-beta.solana.com";

/**
 * Solana devnet RPC endpoint.
 * Devnet is for development and testing - tokens have no real value.
 */
export const DEVNET_RPC_URL = "https://api.devnet.solana.com";

/**
 * Solana testnet RPC endpoint.
 * Testnet is for validator testing - tokens have no real value.
 */
export const TESTNET_RPC_URL = "https://api.testnet.solana.com";

/**
 * Local Solana test validator RPC endpoint.
 */
export const LOCALNET_RPC_URL = "http://localhost:8899";

/**
 * Map of cluster names to RPC URLs.
 */
export const CLUSTER_RPC_URLS: Record<SolanaCluster, string> = {
  "mainnet-beta": MAINNET_RPC_URL,
  devnet: DEVNET_RPC_URL,
  testnet: TESTNET_RPC_URL,
  localnet: LOCALNET_RPC_URL,
};

/**
 * Number of lamports in 1 SOL.
 * 1 SOL = 1,000,000,000 lamports (10^9).
 */
export const LAMPORTS_PER_SOL = 1_000_000_000n;

/**
 * Number of lamports in 1 SOL as a regular number.
 * Use LAMPORTS_PER_SOL (BigInt) for precise calculations.
 */
export const LAMPORTS_PER_SOL_NUMBER = 1_000_000_000;

/**
 * The Base58 alphabet used by Solana (and Bitcoin).
 * Excludes visually ambiguous characters: 0 (zero), O (uppercase o),
 * I (uppercase i), l (lowercase L).
 */
export const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/**
 * Set of valid Base58 characters for O(1) lookup.
 */
export const BASE58_CHARS = new Set(BASE58_ALPHABET);

/**
 * Length of a Solana public key in bytes.
 */
export const PUBLIC_KEY_LENGTH = 32;

/**
 * Length of a Solana secret key in bytes (seed + public key).
 */
export const SECRET_KEY_LENGTH = 64;

/**
 * Length of an Ed25519 seed in bytes.
 */
export const SEED_LENGTH = 32;

/**
 * Expected length of a Base58-encoded Solana address.
 * Addresses are typically 32-44 characters depending on the leading zeros.
 */
export const ADDRESS_MIN_LENGTH = 32;
export const ADDRESS_MAX_LENGTH = 44;

/**
 * Maximum lamports that can be requested in a single devnet airdrop.
 * Currently 2 SOL = 2,000,000,000 lamports.
 */
export const MAX_AIRDROP_LAMPORTS = 2_000_000_000n;

/**
 * Default transaction confirmation timeout in milliseconds.
 */
export const DEFAULT_CONFIRM_TIMEOUT_MS = 60_000;

/**
 * Default RPC request timeout in milliseconds.
 */
export const DEFAULT_RPC_TIMEOUT_MS = 30_000;

/**
 * Maximum recommended vanity pattern length.
 * Longer patterns take exponentially longer to find.
 *
 * Approximate attempts needed:
 * - 1 char: ~58 attempts
 * - 2 chars: ~3,364 attempts
 * - 3 chars: ~195,112 attempts
 * - 4 chars: ~11,316,496 attempts
 * - 5 chars: ~656,356,768 attempts
 * - 6 chars: ~38,068,692,544 attempts
 */
export const MAX_VANITY_PATTERN_LENGTH = 6;

/**
 * Progress callback interval for vanity generation (every N attempts).
 */
export const VANITY_PROGRESS_INTERVAL = 1_000;

/**
 * Characters that are commonly confused with valid Base58 characters.
 * These characters are NOT valid in Base58.
 */
export const CONFUSED_CHARACTERS: Record<string, string> = {
  "0": "zero - excluded from Base58 (looks like O)",
  O: "uppercase O - excluded from Base58 (looks like 0)",
  I: "uppercase I - excluded from Base58 (looks like l or 1)",
  l: "lowercase L - excluded from Base58 (looks like I or 1)",
};

/**
 * Secure file permissions for wallet files (owner read/write only).
 * Equivalent to `chmod 600`.
 */
export const SECURE_FILE_MODE = 0o600;

/**
 * Gets the RPC URL for a given cluster.
 *
 * @param cluster - The Solana cluster identifier
 * @returns The RPC URL for the cluster
 */
export function getClusterUrl(cluster: SolanaCluster): string {
  return CLUSTER_RPC_URLS[cluster];
}

/**
 * Determines if a cluster is a mainnet cluster (real funds at risk).
 *
 * @param cluster - The cluster to check
 * @returns True if the cluster uses real funds
 */
export function isMainnetCluster(cluster: SolanaCluster): boolean {
  return cluster === "mainnet-beta";
}

/**
 * Determines if a cluster supports airdrops.
 *
 * @param cluster - The cluster to check
 * @returns True if the cluster supports airdrops
 */
export function supportsAirdrop(cluster: SolanaCluster): boolean {
  return (
    cluster === "devnet" || cluster === "testnet" || cluster === "localnet"
  );
}

/**
 * Converts lamports to SOL.
 *
 * @param lamports - Amount in lamports (as bigint or string)
 * @returns Amount in SOL as a decimal string
 */
export function lamportsToSol(lamports: bigint | string): string {
  const lamportsBigInt =
    typeof lamports === "string" ? BigInt(lamports) : lamports;
  const sol = lamportsBigInt / LAMPORTS_PER_SOL;
  const remainder = lamportsBigInt % LAMPORTS_PER_SOL;

  if (remainder === 0n) {
    return sol.toString();
  }

  // Format with decimal places
  const remainderStr = remainder.toString().padStart(9, "0");
  // Remove trailing zeros
  const trimmed = remainderStr.replace(/0+$/, "");
  return `${sol}.${trimmed}`;
}

/**
 * Converts SOL to lamports.
 *
 * @param sol - Amount in SOL (as number or string)
 * @returns Amount in lamports as a bigint
 * @throws Error if the SOL amount is invalid
 */
export function solToLamports(sol: number | string): bigint {
  const solStr = typeof sol === "number" ? sol.toString() : sol;

  // Handle decimal values
  const parts = solStr.split(".");

  if (parts.length > 2) {
    throw new Error(`Invalid SOL amount: ${solStr}`);
  }

  const wholePart = parts[0] ?? "0";
  const fractionalPart = (parts[1] ?? "").padEnd(9, "0").slice(0, 9);

  const wholelamports = BigInt(wholePart) * LAMPORTS_PER_SOL;
  const fractionalLamports = BigInt(fractionalPart);

  return wholelamports + fractionalLamports;
}

/**
 * Estimates the number of attempts needed to find a vanity address.
 *
 * @param prefix - Optional prefix pattern
 * @param suffix - Optional suffix pattern
 * @param ignoreCase - Whether matching is case-insensitive
 * @returns Estimated number of attempts
 */
export function estimateVanityAttempts(
  prefix?: string,
  suffix?: string,
  ignoreCase?: boolean,
): number {
  const prefixLen = prefix?.length ?? 0;
  const suffixLen = suffix?.length ?? 0;
  const totalLen = prefixLen + suffixLen;

  if (totalLen === 0) {
    return 1; // Any address matches
  }

  // Base58 has 58 characters
  // Case-insensitive matching effectively reduces to ~33 unique characters
  // (since there are 22 letters that have both cases + 9 digits)
  const alphabetSize = ignoreCase ? 33 : 58;

  // Expected attempts = alphabet_size ^ pattern_length
  return Math.pow(alphabetSize, totalLen);
}

// ============================================================================
// SPL Token Constants
// ============================================================================

/**
 * SPL Token Program ID.
 */
export const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

/**
 * Associated Token Account Program ID.
 */
export const ASSOCIATED_TOKEN_PROGRAM_ID =
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";

/**
 * System Program ID.
 */
export const SYSTEM_PROGRAM_ID = "11111111111111111111111111111111";

/**
 * Rent Sysvar ID.
 */
export const RENT_SYSVAR_ID = "SysvarRent111111111111111111111111111111111";

/**
 * Common SPL token mint addresses.
 * These are well-known tokens on Solana mainnet-beta.
 */
export const COMMON_SPL_TOKENS: Record<string, string> = {
  // Stablecoins
  USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  USDT: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  DAI: "EjmyN6qEC1Tf1JxiG1ae7UTJhUxSwk1TCCb39G3ANxsV",
  BUSD: "5RpUwQ8wtdPCZHhu6MERp2RGrpobsbZ6MH5dDHkUjs2",
  UST: "9vMJfxuKxXBoEa7rM12mYLMwTacLMLDJqHozw96WQL8i",

  // Wrapped tokens
  WETH: "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs",
  WBTC: "3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh",
  WBNB: "9gP2kCy3wA1ctvYWQk75guqXuHfrEomqydHLtcTCqiLa",

  // DeFi tokens
  SOL: "So11111111111111111111111111111111111111112", // Wrapped SOL
  RAY: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R",
  SRM: "SRMuApVNdxXokk5GT7XD5cUUgXMBCoAz2LHeuAoKWRt",
  MNGO: "MangoCzJ36AjZyKwVj3VnYU4GTonjfVEnJmvvWaxLac",
  ORCA: "orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE",

  // Meme/Community tokens
  BONK: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
  WIF: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm",
} as const;

/**
 * SPL token decimals for common tokens.
 */
export const SPL_TOKEN_DECIMALS: Record<string, number> = {
  USDC: 6,
  USDT: 6,
  DAI: 8,
  BUSD: 8,
  WETH: 8,
  WBTC: 8,
  RAY: 6,
  SRM: 6,
  BONK: 5,
} as const;

/**
 * Devnet token faucet addresses.
 * These are test tokens on devnet for development.
 */
export const DEVNET_TOKENS: Record<string, string> = {
  USDC: "Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr",
  USDT: "BQcdHdAQW1hczDbBi9hiegXAR7A98Q9jx3X3iBBBDiq4",
} as const;
