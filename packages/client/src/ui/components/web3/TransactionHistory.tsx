/**
 * @fileoverview TransactionHistory Component
 * @module @hyperscape/client/ui/components/web3/TransactionHistory
 *
 * Component displaying a list of recent transactions with status indicators.
 */

import React, { memo, useMemo } from "react";
import { usePayment } from "../../../hooks/usePayment";
import {
  truncateAddress,
  formatTokenAmount,
  type UnifiedTransaction,
  type TransactionStatus,
} from "@hyperscape/shared";
import { useTheme } from "../../stores/themeStore";

// ============================================================================
// Types
// ============================================================================

export interface TransactionHistoryProps {
  /** Custom class name */
  className?: string;
  /** Maximum number of transactions to show */
  limit?: number;
  /** Show empty state message */
  showEmptyState?: boolean;
  /** Custom transactions (instead of using hook) */
  transactions?: UnifiedTransaction[];
  /** Called when clear history is clicked */
  onClearHistory?: () => void;
}

// ============================================================================
// Component
// ============================================================================

/**
 * TransactionHistory component for displaying recent transactions
 *
 * @example
 * ```tsx
 * <TransactionHistory
 *   limit={10}
 *   showEmptyState
 *   onClearHistory={() => console.log('Cleared')}
 * />
 * ```
 */
export const TransactionHistory = memo(function TransactionHistory({
  className = "",
  limit = 10,
  showEmptyState = true,
  transactions: customTransactions,
  onClearHistory,
}: TransactionHistoryProps) {
  const theme = useTheme();
  const { transactionHistory, clearHistory } = usePayment();

  const transactions = useMemo(() => {
    const txs = customTransactions || transactionHistory;
    return txs.slice(0, limit);
  }, [customTransactions, transactionHistory, limit]);

  const handleClearHistory = () => {
    clearHistory();
    onClearHistory?.();
  };

  // Empty state
  if (transactions.length === 0) {
    if (!showEmptyState) return null;

    return (
      <div
        className={className}
        style={{
          padding: 24,
          textAlign: "center",
          color: theme.colors.text.secondary,
          backgroundColor: theme.colors.background.secondary,
          borderRadius: theme.borderRadius.md,
          border: `1px solid ${theme.colors.border.default}`,
        }}
      >
        <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
        <div style={{ fontSize: theme.typography.fontSize.sm }}>
          No transactions yet
        </div>
      </div>
    );
  }

  // Container styles
  const containerStyle: React.CSSProperties = {
    backgroundColor: theme.colors.background.secondary,
    borderRadius: theme.borderRadius.md,
    border: `1px solid ${theme.colors.border.default}`,
    overflow: "hidden",
  };

  const headerStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px 16px",
    borderBottom: `1px solid ${theme.colors.border.default}`,
    backgroundColor: theme.colors.background.tertiary,
  };

  return (
    <div className={className} style={containerStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <span
          style={{
            fontWeight: theme.typography.fontWeight.semibold,
            fontSize: theme.typography.fontSize.sm,
          }}
        >
          Recent Transactions
        </span>
        <button
          onClick={handleClearHistory}
          style={{
            padding: "4px 8px",
            border: "none",
            borderRadius: theme.borderRadius.sm,
            backgroundColor: "transparent",
            color: theme.colors.text.muted,
            fontSize: theme.typography.fontSize.xs,
            cursor: "pointer",
            transition: `color ${theme.transitions.fast}`,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = theme.colors.text.primary;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = theme.colors.text.muted;
          }}
        >
          Clear
        </button>
      </div>

      {/* Transaction list */}
      <div style={{ maxHeight: 400, overflowY: "auto" }}>
        {transactions.map((tx, index) => (
          <TransactionItem
            key={tx.id}
            transaction={tx}
            theme={theme}
            isLast={index === transactions.length - 1}
          />
        ))}
      </div>
    </div>
  );
});

// ============================================================================
// Sub-components
// ============================================================================

interface TransactionItemProps {
  transaction: UnifiedTransaction;
  theme: ReturnType<typeof useTheme>;
  isLast: boolean;
}

const TransactionItem = memo(function TransactionItem({
  transaction,
  theme,
  isLast,
}: TransactionItemProps) {
  const statusConfig = getStatusConfig(transaction.status, theme);
  const typeIcon = getTypeIcon(transaction.type);

  const itemStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
    padding: "14px 16px",
    borderBottom: isLast ? "none" : `1px solid ${theme.colors.border.default}`,
    transition: `background-color ${theme.transitions.fast}`,
  };

  return (
    <div
      style={itemStyle}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor =
          theme.colors.background.tertiary;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = "transparent";
      }}
    >
      {/* Icon */}
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: "50%",
          backgroundColor: statusConfig.bgColor,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 16,
          flexShrink: 0,
        }}
      >
        {typeIcon}
      </div>

      {/* Details */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 4,
          }}
        >
          <span style={{ fontWeight: theme.typography.fontWeight.medium }}>
            {getTypeLabel(transaction.type)}
          </span>
          <span
            style={{
              fontWeight: theme.typography.fontWeight.semibold,
              color:
                transaction.type === "receive"
                  ? theme.colors.state.success
                  : theme.colors.text.primary,
            }}
          >
            {transaction.type === "receive" ? "+" : "-"}
            {formatTokenAmount(transaction.amount)} {transaction.token}
          </span>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: theme.typography.fontSize.xs,
          }}
        >
          <span style={{ color: theme.colors.text.muted }}>
            {transaction.type === "receive"
              ? `From ${truncateAddress(transaction.from || "")}`
              : `To ${truncateAddress(transaction.to || "")}`}
          </span>
          <StatusBadge
            status={transaction.status}
            config={statusConfig}
            theme={theme}
          />
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginTop: 6,
            fontSize: theme.typography.fontSize.xs,
            color: theme.colors.text.muted,
          }}
        >
          <span>{formatTimestamp(transaction.timestamp)}</span>
          {transaction.txHash && (
            <a
              href={transaction.explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: theme.colors.accent.primary,
                textDecoration: "none",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              View ↗
            </a>
          )}
        </div>
      </div>
    </div>
  );
});

interface StatusBadgeProps {
  status: TransactionStatus;
  config: ReturnType<typeof getStatusConfig>;
  theme: ReturnType<typeof useTheme>;
}

const StatusBadge = memo(function StatusBadge({
  status,
  config,
  theme,
}: StatusBadgeProps) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 8px",
        borderRadius: 12,
        backgroundColor: config.bgColor,
        color: config.textColor,
        fontSize: theme.typography.fontSize.xs,
        fontWeight: theme.typography.fontWeight.medium,
      }}
    >
      {status === "pending" && (
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            backgroundColor: config.textColor,
            animation: "pulse 1.5s infinite",
          }}
        />
      )}
      {config.label}
      <style>
        {`
          @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
          }
        `}
      </style>
    </span>
  );
});

// ============================================================================
// Helper functions
// ============================================================================

function getStatusConfig(
  status: TransactionStatus,
  theme: ReturnType<typeof useTheme>,
): {
  label: string;
  textColor: string;
  bgColor: string;
} {
  switch (status) {
    case "confirmed":
      return {
        label: "Confirmed",
        textColor: theme.colors.state.success,
        bgColor: `${theme.colors.state.success}20`,
      };
    case "pending":
      return {
        label: "Pending",
        textColor: theme.colors.state.warning,
        bgColor: `${theme.colors.state.warning}20`,
      };
    case "failed":
      return {
        label: "Failed",
        textColor: theme.colors.state.danger,
        bgColor: `${theme.colors.state.danger}20`,
      };
    default:
      return {
        label: status,
        textColor: theme.colors.text.secondary,
        bgColor: theme.colors.background.secondary,
      };
  }
}

function getTypeIcon(type: string): string {
  switch (type) {
    case "send":
      return "↑";
    case "receive":
      return "↓";
    case "swap":
      return "↔";
    case "approve":
      return "✓";
    case "mint":
      return "+";
    case "burn":
      return "🔥";
    case "stake":
      return "🔒";
    case "unstake":
      return "🔓";
    default:
      return "•";
  }
}

function getTypeLabel(type: string): string {
  switch (type) {
    case "send":
      return "Sent";
    case "receive":
      return "Received";
    case "swap":
      return "Swapped";
    case "approve":
      return "Approved";
    case "mint":
      return "Minted";
    case "burn":
      return "Burned";
    case "stake":
      return "Staked";
    case "unstake":
      return "Unstaked";
    default:
      return type.charAt(0).toUpperCase() + type.slice(1);
  }
}

function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default TransactionHistory;
