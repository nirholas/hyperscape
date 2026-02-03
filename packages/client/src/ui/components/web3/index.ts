/**
 * @fileoverview Web3 Components Barrel Export
 * @module @hyperscape/client/ui/components/web3
 *
 * React components for multi-chain wallet management and Web3 interactions.
 */

// Wallet connection
export { WalletConnect, type WalletConnectProps } from "./WalletConnect";

// Balance display
export { WalletBalance, type WalletBalanceProps } from "./WalletBalance";

// Payment modal
export { PaymentModal, type PaymentModalProps } from "./PaymentModal";

// Transaction history
export {
  TransactionHistory,
  type TransactionHistoryProps,
} from "./TransactionHistory";

// Network selector
export { NetworkSelector, type NetworkSelectorProps } from "./NetworkSelector";
