/**
 * Solana Wallet Hook
 * Provides Solana wallet functionality for the Hyperscape client
 * Supports Mobile Wallet Adapter (MWA) on Saga and other Android devices
 */

import { useCallback, useMemo } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import type { Transaction } from "@solana/web3.js";

/**
 * Sign-In With Solana (SIWS) message structure
 */
interface SIWSMessage {
  domain: string;
  publicKey: string;
  statement: string;
  nonce: string;
  issuedAt: string;
  expirationTime?: string;
  chainId?: string;
}

/**
 * Format a SIWS message for signing
 */
function formatSIWSMessage(message: SIWSMessage): string {
  const lines = [
    `${message.domain} wants you to sign in with your Solana account:`,
    message.publicKey,
    "",
    message.statement,
    "",
    `Nonce: ${message.nonce}`,
    `Issued At: ${message.issuedAt}`,
  ];

  if (message.expirationTime) {
    lines.push(`Expiration Time: ${message.expirationTime}`);
  }

  if (message.chainId) {
    lines.push(`Chain ID: ${message.chainId}`);
  }

  return lines.join("\n");
}

/**
 * Generate a random nonce for SIWS
 */
function generateNonce(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Hook for Solana wallet functionality
 * Wraps @solana/wallet-adapter-react with additional utilities
 */
export function useSolanaWallet() {
  const {
    publicKey,
    connected,
    connecting,
    disconnect,
    signMessage,
    signTransaction,
    signAllTransactions,
    wallet,
    wallets,
    select,
  } = useWallet();

  const { connection } = useConnection();

  /**
   * Get the wallet address as a string
   */
  const address = useMemo(() => {
    return publicKey?.toBase58() ?? null;
  }, [publicKey]);

  /**
   * Check if this is a Mobile Wallet Adapter wallet
   */
  const isMWA = useMemo(() => {
    if (!wallet) return false;
    // MWA wallets have specific adapter names
    const mwaAdapters = ["Mobile Wallet Adapter", "Saga Wallet", "Seed Vault"];
    return mwaAdapters.some((name) =>
      wallet.adapter.name.toLowerCase().includes(name.toLowerCase()),
    );
  }, [wallet]);

  /**
   * Sign a message with the wallet (for SIWS)
   */
  const signMessageAsync = useCallback(
    async (message: string): Promise<Uint8Array | null> => {
      if (!signMessage) {
        console.warn(
          "[useSolanaWallet] Wallet does not support signing messages",
        );
        return null;
      }

      const encoder = new TextEncoder();
      const messageBytes = encoder.encode(message);
      return signMessage(messageBytes);
    },
    [signMessage],
  );

  /**
   * Create and sign a Sign-In With Solana (SIWS) message
   * This is used to verify wallet ownership for authentication
   */
  const signInWithSolana = useCallback(
    async (options?: {
      statement?: string;
      domain?: string;
      expirationMinutes?: number;
    }): Promise<{
      message: string;
      signature: Uint8Array;
      publicKey: string;
    } | null> => {
      if (!publicKey || !signMessage) {
        console.warn(
          "[useSolanaWallet] Wallet not connected or doesn't support signing",
        );
        return null;
      }

      const domain = options?.domain ?? window.location.host;
      const statement = options?.statement ?? "Sign in to Hyperscape";
      const nonce = generateNonce();
      const issuedAt = new Date().toISOString();

      const expirationTime = options?.expirationMinutes
        ? new Date(
            Date.now() + options.expirationMinutes * 60 * 1000,
          ).toISOString()
        : undefined;

      const siwsMessage: SIWSMessage = {
        domain,
        publicKey: publicKey.toBase58(),
        statement,
        nonce,
        issuedAt,
        expirationTime,
        chainId: "solana:mainnet",
      };

      const formattedMessage = formatSIWSMessage(siwsMessage);

      try {
        const signature = await signMessageAsync(formattedMessage);
        if (!signature) {
          return null;
        }

        return {
          message: formattedMessage,
          signature,
          publicKey: publicKey.toBase58(),
        };
      } catch (error) {
        console.error("[useSolanaWallet] SIWS signing failed:", error);
        return null;
      }
    },
    [publicKey, signMessage, signMessageAsync],
  );

  /**
   * Get SOL balance
   */
  const getBalance = useCallback(async (): Promise<number | null> => {
    if (!publicKey) return null;

    try {
      const balance = await connection.getBalance(publicKey);
      // Convert lamports to SOL
      return balance / 1e9;
    } catch (error) {
      console.error("[useSolanaWallet] Failed to get balance:", error);
      return null;
    }
  }, [publicKey, connection]);

  /**
   * Send a signed transaction
   */
  const sendTransaction = useCallback(
    async (transaction: Transaction): Promise<string | null> => {
      if (!publicKey || !signTransaction) {
        console.warn("[useSolanaWallet] Wallet not connected");
        return null;
      }

      try {
        // Get latest blockhash
        const { blockhash } = await connection.getLatestBlockhash();
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = publicKey;

        // Sign the transaction
        const signed = await signTransaction(transaction);

        // Send the signed transaction
        const signature = await connection.sendRawTransaction(
          signed.serialize(),
        );

        // Confirm the transaction
        await connection.confirmTransaction(signature);

        return signature;
      } catch (error) {
        console.error("[useSolanaWallet] Transaction failed:", error);
        return null;
      }
    },
    [publicKey, signTransaction, connection],
  );

  return {
    // Wallet state
    publicKey,
    address,
    connected,
    connecting,
    wallet,
    wallets,
    isMWA,

    // Actions
    disconnect,
    select,
    signMessage: signMessageAsync,
    signTransaction,
    signAllTransactions,
    signInWithSolana,
    getBalance,
    sendTransaction,

    // Connection
    connection,
  };
}

/**
 * Check if running on Android (where MWA is available)
 */
export function isAndroid(): boolean {
  if (typeof window === "undefined") return false;
  return /Android/i.test(navigator.userAgent);
}

/**
 * Check if running on Solana Saga phone
 */
export function isSolanaSaga(): boolean {
  if (typeof window === "undefined") return false;
  const userAgent = navigator.userAgent.toLowerCase();
  return userAgent.includes("saga") || userAgent.includes("solana mobile");
}
