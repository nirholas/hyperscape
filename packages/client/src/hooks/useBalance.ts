/**
 * @fileoverview Balance Hook for Multi-Chain Wallet Balances
 * @module @hyperscape/client/hooks/useBalance
 *
 * Provides React state management for fetching and caching wallet balances.
 * Supports auto-refresh and manual refresh functionality.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { type UnifiedBalance, type WalletEvent } from "@hyperscape/shared";
import { useWallet } from "./useWallet";

// ============================================================================
// Hook Return Type
// ============================================================================

export interface UseBalanceResult {
  /** Current balance data */
  balance: UnifiedBalance | null;
  /** Whether balance is currently loading */
  isLoading: boolean;
  /** Error state */
  error: Error | null;
  /** Manually refresh balance */
  refresh: () => Promise<void>;
  /** Last refresh timestamp */
  lastUpdated: number | null;
}

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_REFRESH_INTERVAL = 30000; // 30 seconds

// ============================================================================
// useBalance Hook
// ============================================================================

/**
 * Hook for fetching and managing wallet balance
 *
 * @param walletId - Optional wallet ID (uses current wallet if not provided)
 * @param options - Configuration options
 * @returns Balance state and operations
 *
 * @example
 * ```tsx
 * function BalanceDisplay() {
 *   const { balance, isLoading, error, refresh } = useBalance();
 *
 *   if (isLoading) return <div>Loading...</div>;
 *   if (error) return <div>Error: {error.message}</div>;
 *   if (!balance) return <div>No wallet connected</div>;
 *
 *   return (
 *     <div>
 *       <div>Native: {balance.native.balance} {balance.native.symbol}</div>
 *       <div>Total USD: ${balance.totalUsd}</div>
 *       <button onClick={refresh}>Refresh</button>
 *     </div>
 *   );
 * }
 * ```
 */
export function useBalance(
  walletId?: string,
  options?: {
    /** Disable auto-refresh */
    disableAutoRefresh?: boolean;
    /** Custom refresh interval in ms */
    refreshInterval?: number;
  },
): UseBalanceResult {
  const { wallet, manager } = useWallet(walletId);

  const [balance, setBalance] = useState<UnifiedBalance | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  const isMountedRef = useRef(true);
  const refreshIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );

  // Fetch balance
  const fetchBalance = useCallback(
    async (forceRefresh = false) => {
      if (!wallet) {
        setBalance(null);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const newBalance = await manager.getBalance(wallet.id, forceRefresh);
        if (isMountedRef.current) {
          setBalance(newBalance);
          setLastUpdated(Date.now());
        }
      } catch (err) {
        if (isMountedRef.current) {
          const error =
            err instanceof Error ? err : new Error("Failed to fetch balance");
          setError(error);
        }
      } finally {
        if (isMountedRef.current) {
          setIsLoading(false);
        }
      }
    },
    [wallet, manager],
  );

  // Manual refresh
  const refresh = useCallback(async () => {
    await fetchBalance(true);
  }, [fetchBalance]);

  // Initial fetch and subscription
  useEffect(() => {
    isMountedRef.current = true;

    // Fetch initial balance
    fetchBalance();

    // Subscribe to balance updates
    const handleEvent = (event: WalletEvent) => {
      if (
        event.type === "balance_updated" &&
        event.wallet?.id === wallet?.id &&
        event.balance
      ) {
        setBalance(event.balance);
        setLastUpdated(Date.now());
      }
    };

    const unsubscribe = manager.subscribe(handleEvent);

    return () => {
      isMountedRef.current = false;
      unsubscribe();
    };
  }, [wallet?.id, manager, fetchBalance]);

  // Auto-refresh setup
  useEffect(() => {
    if (options?.disableAutoRefresh || !wallet) {
      return;
    }

    const interval = options?.refreshInterval ?? DEFAULT_REFRESH_INTERVAL;

    refreshIntervalRef.current = setInterval(() => {
      fetchBalance();
    }, interval);

    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }
    };
  }, [
    wallet,
    options?.disableAutoRefresh,
    options?.refreshInterval,
    fetchBalance,
  ]);

  return {
    balance,
    isLoading,
    error,
    refresh,
    lastUpdated,
  };
}

export default useBalance;
