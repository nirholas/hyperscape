/**
 * @fileoverview Unified Wallet Hook for Multi-Chain Support
 * @module @hyperscape/client/hooks/useWallet
 *
 * Provides React state management for multi-chain wallet operations.
 * Integrates with WalletManager from shared package for EVM and Solana support.
 */

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import {
  WalletManager,
  type UnifiedWallet,
  type ChainType,
  type NetworkId,
  type WalletEvent,
  NETWORK_METADATA,
} from "@hyperscape/shared";

// ============================================================================
// Singleton Wallet Manager
// ============================================================================

let globalWalletManager: WalletManager | null = null;

/**
 * Get or create the global WalletManager instance
 */
function getWalletManager(): WalletManager {
  if (!globalWalletManager) {
    globalWalletManager = new WalletManager({
      autoConnect: true,
      preferredNetworks: ["arbitrum", "solana-mainnet", "bnb"],
      enableTestnets: true,
      balanceRefreshInterval: 30000,
    });
  }
  return globalWalletManager;
}

// ============================================================================
// Hook Return Type
// ============================================================================

export interface UseWalletResult {
  /** Currently selected wallet (if walletId provided) or first wallet */
  wallet: UnifiedWallet | null;
  /** All connected wallets */
  wallets: UnifiedWallet[];
  /** Whether a connection is in progress */
  isConnecting: boolean;
  /** Error state */
  error: Error | null;
  /** Connect/add a new wallet */
  connect: (
    type: ChainType,
    network: NetworkId,
    privateKey?: string,
    label?: string,
  ) => Promise<UnifiedWallet>;
  /** Generate a new wallet */
  generate: (
    network: NetworkId,
    label?: string,
  ) => Promise<{ wallet: UnifiedWallet; privateKey: string }>;
  /** Disconnect/remove a wallet */
  disconnect: (walletId: string) => void;
  /** Switch to a different network (for the selected wallet) */
  switchNetwork: (network: NetworkId) => Promise<void>;
  /** Select a wallet as the current wallet */
  selectWallet: (walletId: string) => void;
  /** Update wallet label */
  updateLabel: (walletId: string, label: string) => void;
  /** Get wallet by ID */
  getWallet: (walletId: string) => UnifiedWallet | undefined;
  /** Clear all wallets */
  clearAll: () => void;
  /** The wallet manager instance */
  manager: WalletManager;
}

// ============================================================================
// useWallet Hook
// ============================================================================

/**
 * Hook for managing multi-chain wallets
 *
 * @param walletId - Optional specific wallet ID to focus on
 * @returns Wallet state and operations
 *
 * @example
 * ```tsx
 * function WalletPanel() {
 *   const { wallet, wallets, connect, disconnect, isConnecting } = useWallet();
 *
 *   const handleConnect = async () => {
 *     await connect('evm', 'arbitrum');
 *   };
 *
 *   return (
 *     <div>
 *       {wallet ? (
 *         <div>
 *           Connected: {wallet.address}
 *           <button onClick={() => disconnect(wallet.id)}>Disconnect</button>
 *         </div>
 *       ) : (
 *         <button onClick={handleConnect} disabled={isConnecting}>
 *           {isConnecting ? 'Connecting...' : 'Connect Wallet'}
 *         </button>
 *       )}
 *     </div>
 *   );
 * }
 * ```
 */
export function useWallet(walletId?: string): UseWalletResult {
  const manager = useMemo(() => getWalletManager(), []);

  const [wallets, setWallets] = useState<UnifiedWallet[]>(() =>
    manager.getWallets(),
  );
  const [selectedWalletId, setSelectedWalletId] = useState<string | undefined>(
    walletId,
  );
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Subscribe to wallet events
  useEffect(() => {
    const handleEvent = (event: WalletEvent) => {
      switch (event.type) {
        case "wallet_added":
        case "wallet_removed":
        case "wallet_updated":
          setWallets(manager.getWallets());
          break;
      }
    };

    const unsubscribe = manager.subscribe(handleEvent);
    return () => {
      unsubscribe();
    };
  }, [manager]);

  // Update walletId from prop
  useEffect(() => {
    if (walletId !== undefined) {
      setSelectedWalletId(walletId);
    }
  }, [walletId]);

  // Get current wallet
  const wallet = useMemo(() => {
    if (selectedWalletId) {
      return wallets.find((w) => w.id === selectedWalletId) ?? null;
    }
    return wallets[0] ?? null;
  }, [wallets, selectedWalletId]);

  // Connect/add wallet
  const connect = useCallback(
    async (
      type: ChainType,
      network: NetworkId,
      privateKey?: string,
      label?: string,
    ): Promise<UnifiedWallet> => {
      setIsConnecting(true);
      setError(null);

      try {
        const newWallet = await manager.addWallet(
          type,
          network,
          privateKey,
          label,
        );
        setSelectedWalletId(newWallet.id);
        setWallets(manager.getWallets());
        return newWallet;
      } catch (err) {
        const error =
          err instanceof Error ? err : new Error("Failed to connect wallet");
        setError(error);
        throw error;
      } finally {
        setIsConnecting(false);
      }
    },
    [manager],
  );

  // Generate new wallet
  const generate = useCallback(
    async (
      network: NetworkId,
      label?: string,
    ): Promise<{ wallet: UnifiedWallet; privateKey: string }> => {
      setIsConnecting(true);
      setError(null);

      try {
        const result = await manager.generateWallet(network, label);
        setSelectedWalletId(result.wallet.id);
        setWallets(manager.getWallets());
        return result;
      } catch (err) {
        const error =
          err instanceof Error ? err : new Error("Failed to generate wallet");
        setError(error);
        throw error;
      } finally {
        setIsConnecting(false);
      }
    },
    [manager],
  );

  // Disconnect wallet
  const disconnect = useCallback(
    (id: string) => {
      try {
        manager.removeWallet(id);
        setWallets(manager.getWallets());

        // If we removed the selected wallet, clear selection
        if (selectedWalletId === id) {
          const remaining = manager.getWallets();
          setSelectedWalletId(remaining[0]?.id);
        }
      } catch (err) {
        const error =
          err instanceof Error ? err : new Error("Failed to disconnect wallet");
        setError(error);
      }
    },
    [manager, selectedWalletId],
  );

  // Switch network (creates new wallet on that network)
  const switchNetwork = useCallback(
    async (network: NetworkId): Promise<void> => {
      if (!wallet) {
        throw new Error("No wallet selected");
      }

      const metadata = NETWORK_METADATA[network];
      const type = metadata.type;

      // If wallet has same type, we can potentially reuse keys
      // For now, just inform the user they need a wallet on that network
      const existingOnNetwork = wallets.find((w) => w.network === network);
      if (existingOnNetwork) {
        setSelectedWalletId(existingOnNetwork.id);
      } else {
        throw new Error(
          `No wallet found on ${network}. Please add a wallet first.`,
        );
      }
    },
    [wallet, wallets],
  );

  // Select wallet
  const selectWallet = useCallback((id: string) => {
    setSelectedWalletId(id);
  }, []);

  // Update label
  const updateLabel = useCallback(
    (id: string, label: string) => {
      try {
        manager.updateWalletLabel(id, label);
        setWallets(manager.getWallets());
      } catch (err) {
        const error =
          err instanceof Error
            ? err
            : new Error("Failed to update wallet label");
        setError(error);
      }
    },
    [manager],
  );

  // Get wallet by ID
  const getWallet = useCallback(
    (id: string): UnifiedWallet | undefined => {
      return manager.getWallet(id);
    },
    [manager],
  );

  // Clear all wallets
  const clearAll = useCallback(() => {
    manager.clearAll();
    setWallets([]);
    setSelectedWalletId(undefined);
  }, [manager]);

  return {
    wallet,
    wallets,
    isConnecting,
    error,
    connect,
    generate,
    disconnect,
    switchNetwork,
    selectWallet,
    updateLabel,
    getWallet,
    clearAll,
    manager,
  };
}

export default useWallet;
