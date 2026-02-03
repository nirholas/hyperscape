/**
 * @fileoverview Payment Hook for Multi-Chain Transactions
 * @module @hyperscape/client/hooks/usePayment
 *
 * Provides React state management for sending payments across chains.
 * Supports fee estimation, transaction tracking, and error handling.
 */

import { useState, useCallback, useRef } from "react";
import {
  type UnifiedTransaction,
  type FeeEstimate,
  type SendTransactionParams,
  type WalletEvent,
} from "@hyperscape/shared";
import { useWallet } from "./useWallet";

// ============================================================================
// Hook Return Type
// ============================================================================

export interface UsePaymentResult {
  /** Send a payment */
  send: (
    params: Omit<SendTransactionParams, "walletId"> & { walletId?: string },
  ) => Promise<UnifiedTransaction>;
  /** Estimate transaction fee */
  estimateFee: (
    params: Omit<SendTransactionParams, "walletId"> & { walletId?: string },
  ) => Promise<FeeEstimate>;
  /** Whether a transaction is pending */
  isPending: boolean;
  /** Last completed transaction */
  lastTransaction: UnifiedTransaction | null;
  /** Transaction history for current session */
  transactionHistory: UnifiedTransaction[];
  /** Error state */
  error: Error | null;
  /** Clear error state */
  clearError: () => void;
  /** Clear transaction history */
  clearHistory: () => void;
}

// ============================================================================
// usePayment Hook
// ============================================================================

/**
 * Hook for sending payments and managing transactions
 *
 * @returns Payment state and operations
 *
 * @example
 * ```tsx
 * function PaymentButton() {
 *   const { send, isPending, lastTransaction, error } = usePayment();
 *
 *   const handleSend = async () => {
 *     try {
 *       const tx = await send({
 *         to: '0x...',
 *         amount: '10',
 *         token: 'USDs',
 *       });
 *       console.log('Transaction sent:', tx.txHash);
 *     } catch (err) {
 *       console.error('Payment failed:', err);
 *     }
 *   };
 *
 *   return (
 *     <div>
 *       <button onClick={handleSend} disabled={isPending}>
 *         {isPending ? 'Sending...' : 'Send Payment'}
 *       </button>
 *       {error && <div className="text-red-500">{error.message}</div>}
 *       {lastTransaction && (
 *         <a href={lastTransaction.explorerUrl} target="_blank">
 *           View transaction
 *         </a>
 *       )}
 *     </div>
 *   );
 * }
 * ```
 */
export function usePayment(): UsePaymentResult {
  const { wallet, manager } = useWallet();

  const [isPending, setIsPending] = useState(false);
  const [lastTransaction, setLastTransaction] =
    useState<UnifiedTransaction | null>(null);
  const [transactionHistory, setTransactionHistory] = useState<
    UnifiedTransaction[]
  >([]);
  const [error, setError] = useState<Error | null>(null);

  const pendingTxRef = useRef<string | null>(null);

  // Send payment
  const send = useCallback(
    async (
      params: Omit<SendTransactionParams, "walletId"> & { walletId?: string },
    ): Promise<UnifiedTransaction> => {
      const walletId = params.walletId || wallet?.id;

      if (!walletId) {
        const err = new Error("No wallet connected");
        setError(err);
        throw err;
      }

      setIsPending(true);
      setError(null);

      try {
        const fullParams: SendTransactionParams = {
          ...params,
          walletId,
        };

        const tx = await manager.send(fullParams);

        setLastTransaction(tx);
        setTransactionHistory((prev) => [tx, ...prev]);
        pendingTxRef.current = null;

        return tx;
      } catch (err) {
        const error = err instanceof Error ? err : new Error("Payment failed");
        setError(error);
        pendingTxRef.current = null;
        throw error;
      } finally {
        setIsPending(false);
      }
    },
    [wallet?.id, manager],
  );

  // Estimate fee
  const estimateFee = useCallback(
    async (
      params: Omit<SendTransactionParams, "walletId"> & { walletId?: string },
    ): Promise<FeeEstimate> => {
      const walletId = params.walletId || wallet?.id;

      if (!walletId) {
        throw new Error("No wallet connected");
      }

      const fullParams: SendTransactionParams = {
        ...params,
        walletId,
      };

      return manager.estimateFee(fullParams);
    },
    [wallet?.id, manager],
  );

  // Clear error
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Clear history
  const clearHistory = useCallback(() => {
    setTransactionHistory([]);
    setLastTransaction(null);
  }, []);

  return {
    send,
    estimateFee,
    isPending,
    lastTransaction,
    transactionHistory,
    error,
    clearError,
    clearHistory,
  };
}

export default usePayment;
