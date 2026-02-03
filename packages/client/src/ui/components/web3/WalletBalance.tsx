/**
 * @fileoverview WalletBalance Component
 * @module @hyperscape/client/ui/components/web3/WalletBalance
 *
 * Card component displaying wallet balance with native token and tokens.
 */

import React, { memo, useCallback } from "react";
import { useBalance } from "../../../hooks/useBalance";
import { useWallet } from "../../../hooks/useWallet";
import {
  truncateAddress,
  formatUsd,
  formatTokenAmount,
  getExplorerAddressUrl,
  NETWORK_METADATA,
} from "@hyperscape/shared";
import { useTheme } from "../../stores/themeStore";

// ============================================================================
// Types
// ============================================================================

export interface WalletBalanceProps {
  /** Specific wallet ID (uses current wallet if not provided) */
  walletId?: string;
  /** Custom class name */
  className?: string;
  /** Compact mode (smaller display) */
  compact?: boolean;
  /** Show individual token balances */
  showTokens?: boolean;
  /** Show yield info if available */
  showYield?: boolean;
  /** Show refresh button */
  showRefresh?: boolean;
  /** Called when refresh is clicked */
  onRefresh?: () => void;
}

// ============================================================================
// Component
// ============================================================================

/**
 * WalletBalance component for displaying wallet balances
 *
 * @example
 * ```tsx
 * <WalletBalance
 *   showTokens
 *   showYield
 *   showRefresh
 * />
 * ```
 */
export const WalletBalance = memo(function WalletBalance({
  walletId,
  className = "",
  compact = false,
  showTokens = true,
  showYield = true,
  showRefresh = true,
  onRefresh,
}: WalletBalanceProps) {
  const theme = useTheme();
  const { wallet } = useWallet(walletId);
  const { balance, isLoading, error, refresh, lastUpdated } =
    useBalance(walletId);

  const handleRefresh = useCallback(() => {
    refresh();
    onRefresh?.();
  }, [refresh, onRefresh]);

  // No wallet connected
  if (!wallet) {
    return (
      <div
        className={className}
        style={{
          padding: compact ? 12 : 20,
          backgroundColor: theme.colors.background.secondary,
          borderRadius: theme.borderRadius.md,
          border: `1px solid ${theme.colors.border.default}`,
          textAlign: "center",
          color: theme.colors.text.secondary,
        }}
      >
        No wallet connected
      </div>
    );
  }

  const metadata = NETWORK_METADATA[wallet.network];
  const explorerUrl = getExplorerAddressUrl(wallet.network, wallet.address);

  // Card styles
  const cardStyle: React.CSSProperties = {
    padding: compact ? 12 : 20,
    backgroundColor: theme.colors.background.secondary,
    borderRadius: theme.borderRadius.md,
    border: `1px solid ${theme.colors.border.default}`,
  };

  const headerStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: compact ? 8 : 16,
  };

  const totalStyle: React.CSSProperties = {
    fontSize: compact
      ? theme.typography.fontSize.xl
      : theme.typography.fontSize.xxl,
    fontWeight: theme.typography.fontWeight.bold,
    marginBottom: compact ? 4 : 8,
  };

  return (
    <div className={className} style={cardStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span>{getNetworkIcon(wallet.network)}</span>
          <div>
            <div
              style={{
                fontWeight: theme.typography.fontWeight.medium,
                fontSize: theme.typography.fontSize.sm,
              }}
            >
              {wallet.label || metadata.name}
            </div>
            <a
              href={explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontSize: theme.typography.fontSize.xs,
                color: theme.colors.text.muted,
                fontFamily: "monospace",
                textDecoration: "none",
              }}
            >
              {truncateAddress(wallet.address)}
            </a>
          </div>
        </div>

        {showRefresh && (
          <button
            onClick={handleRefresh}
            disabled={isLoading}
            style={{
              padding: 6,
              border: "none",
              borderRadius: theme.borderRadius.sm,
              backgroundColor: "transparent",
              color: theme.colors.text.secondary,
              cursor: isLoading ? "wait" : "pointer",
              transition: `all ${theme.transitions.fast}`,
            }}
            title="Refresh balance"
          >
            <RefreshIcon spinning={isLoading} />
          </button>
        )}
      </div>

      {/* Error state */}
      {error && (
        <div
          style={{
            padding: 8,
            marginBottom: 12,
            borderRadius: theme.borderRadius.sm,
            backgroundColor: `${theme.colors.state.danger}20`,
            color: theme.colors.state.danger,
            fontSize: theme.typography.fontSize.sm,
          }}
        >
          {error.message}
        </div>
      )}

      {/* Loading state */}
      {isLoading && !balance && (
        <div
          style={{
            textAlign: "center",
            padding: 20,
            color: theme.colors.text.secondary,
          }}
        >
          Loading balance...
        </div>
      )}

      {/* Balance display */}
      {balance && (
        <>
          {/* Total USD value */}
          <div style={totalStyle}>{formatUsd(balance.totalUsd)}</div>

          {/* Native token */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "8px 0",
              borderBottom: `1px solid ${theme.colors.border.default}`,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 18 }}>
                {getTokenIcon(balance.native.symbol)}
              </span>
              <span style={{ fontWeight: theme.typography.fontWeight.medium }}>
                {balance.native.symbol}
              </span>
            </div>
            <div style={{ textAlign: "right" }}>
              <div>{formatTokenAmount(balance.native.balance)}</div>
              <div
                style={{
                  fontSize: theme.typography.fontSize.xs,
                  color: theme.colors.text.muted,
                }}
              >
                {formatUsd(balance.native.usd)}
              </div>
            </div>
          </div>

          {/* Token balances */}
          {showTokens &&
            balance.tokens.map(
              (token: {
                address: string;
                symbol: string;
                balance: string;
                usd: string;
              }) => (
                <div
                  key={token.address}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "8px 0",
                    borderBottom: `1px solid ${theme.colors.border.default}`,
                  }}
                >
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 8 }}
                  >
                    <span style={{ fontSize: 18 }}>
                      {getTokenIcon(token.symbol)}
                    </span>
                    <span
                      style={{ fontWeight: theme.typography.fontWeight.medium }}
                    >
                      {token.symbol}
                    </span>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div>{formatTokenAmount(token.balance)}</div>
                    <div
                      style={{
                        fontSize: theme.typography.fontSize.xs,
                        color: theme.colors.text.muted,
                      }}
                    >
                      {formatUsd(token.usd)}
                    </div>
                  </div>
                </div>
              ),
            )}

          {/* Yield info */}
          {showYield &&
            balance.yieldEarned &&
            parseFloat(balance.yieldEarned) > 0 && (
              <div
                style={{
                  marginTop: 12,
                  padding: 12,
                  borderRadius: theme.borderRadius.sm,
                  backgroundColor: `${theme.colors.state.success}15`,
                  border: `1px solid ${theme.colors.state.success}40`,
                }}
              >
                <div
                  style={{
                    fontSize: theme.typography.fontSize.xs,
                    color: theme.colors.state.success,
                    marginBottom: 4,
                  }}
                >
                  💰 Yield Earned
                </div>
                <div
                  style={{
                    fontSize: theme.typography.fontSize.lg,
                    fontWeight: theme.typography.fontWeight.semibold,
                    color: theme.colors.state.success,
                  }}
                >
                  +{formatUsd(balance.yieldEarned)}
                </div>
              </div>
            )}

          {/* Last updated */}
          {lastUpdated && (
            <div
              style={{
                marginTop: 12,
                fontSize: theme.typography.fontSize.xs,
                color: theme.colors.text.muted,
                textAlign: "right",
              }}
            >
              Updated {formatTimeAgo(lastUpdated)}
            </div>
          )}
        </>
      )}
    </div>
  );
});

// ============================================================================
// Helper functions
// ============================================================================

function getNetworkIcon(network: string): string {
  const iconMap: Record<string, string> = {
    arbitrum: "🔵",
    "arbitrum-sepolia": "🔵",
    base: "🔷",
    ethereum: "⟠",
    polygon: "🟣",
    bnb: "🟡",
    "bnb-testnet": "🟡",
    "solana-mainnet": "◎",
    "solana-devnet": "◎",
    "solana-testnet": "◎",
  };
  return iconMap[network] || "🔗";
}

function getTokenIcon(symbol: string): string {
  const iconMap: Record<string, string> = {
    ETH: "⟠",
    BNB: "🟡",
    SOL: "◎",
    MATIC: "🟣",
    USDs: "💵",
    USDC: "💲",
    USDT: "💵",
    DAI: "🟨",
  };
  return iconMap[symbol] || "🪙";
}

function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);

  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

// ============================================================================
// Sub-components
// ============================================================================

const RefreshIcon = ({ spinning }: { spinning: boolean }) => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    style={{
      animation: spinning ? "spin 1s linear infinite" : "none",
    }}
  >
    <polyline points="23 4 23 10 17 10" />
    <polyline points="1 20 1 14 7 14" />
    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    <style>
      {`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}
    </style>
  </svg>
);

export default WalletBalance;
