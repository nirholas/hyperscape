/**
 * Solana Wallet Provider
 * Wraps the application with Solana wallet context for Mobile Wallet Adapter (MWA) support
 * on Solana Saga and other Android devices with wallet apps.
 */

import React, { useMemo } from "react";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { clusterApiUrl } from "@solana/web3.js";

// Import wallet adapter styles
import "@solana/wallet-adapter-react-ui/styles.css";

interface SolanaWalletProviderProps {
  children: React.ReactNode;
}

/**
 * Get the Solana RPC endpoint
 * Uses environment variable if set, otherwise falls back to public devnet
 */
function getRpcEndpoint(): string {
  // Check for custom RPC endpoint in environment
  const customRpc = import.meta.env.PUBLIC_SOLANA_RPC_URL;
  if (customRpc && customRpc.length > 0) {
    return customRpc;
  }

  // Default to mainnet-beta for production use with Saga
  // The Saga dApp Store requires mainnet
  const network = import.meta.env.PUBLIC_SOLANA_NETWORK || "mainnet-beta";
  return clusterApiUrl(network as "mainnet-beta" | "devnet" | "testnet");
}

/**
 * Solana Wallet Provider Component
 *
 * This provider sets up:
 * 1. Connection to Solana RPC
 * 2. Wallet adapter with auto-detection for MWA and Wallet Standard wallets
 * 3. Wallet modal UI for wallet selection
 *
 * On Solana Saga phones, this will automatically detect:
 * - Seed Vault (built-in hardware wallet)
 * - Phantom, Solflare, and other installed wallet apps
 * - Any Wallet Standard compatible wallet
 *
 * The wallets array is intentionally empty - this enables auto-detection
 * of all installed wallets via Wallet Standard protocol. This is the
 * recommended approach from Anza/Solana Labs.
 */
export function SolanaWalletProvider({ children }: SolanaWalletProviderProps) {
  const endpoint = useMemo(() => getRpcEndpoint(), []);

  // Empty array enables Wallet Standard auto-detection
  // This is the recommended approach for MWA compatibility
  // See: https://github.com/anza-xyz/wallet-adapter
  const wallets = useMemo(() => [], []);

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider
        wallets={wallets}
        autoConnect={true}
        localStorageKey="hyperscape-solana-wallet"
      >
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

/**
 * Hook to check if running on Android (for MWA detection)
 */
export function useIsAndroid(): boolean {
  return useMemo(() => {
    if (typeof window === "undefined") return false;
    return /Android/i.test(navigator.userAgent);
  }, []);
}

/**
 * Hook to check if running on Solana Saga specifically
 */
export function useIsSolanaSaga(): boolean {
  return useMemo(() => {
    if (typeof window === "undefined") return false;
    const userAgent = navigator.userAgent.toLowerCase();
    // Saga has a specific device identifier
    return userAgent.includes("saga") || userAgent.includes("solana mobile");
  }, []);
}
