/**
 * @fileoverview WalletConnect Component
 * @module @hyperscape/client/ui/components/web3/WalletConnect
 *
 * Button component for connecting and managing multi-chain wallets.
 * Shows connected address or "Connect Wallet" button.
 */

import React, { memo, useState, useCallback, useRef, useEffect } from "react";
import { useWallet } from "../../../hooks/useWallet";
import { useBalance } from "../../../hooks/useBalance";
import {
  truncateAddress,
  formatUsd,
  NETWORK_METADATA,
  type NetworkId,
  type ChainType,
} from "@hyperscape/shared";
import { useTheme } from "../../stores/themeStore";

// ============================================================================
// Types
// ============================================================================

export interface WalletConnectProps {
  /** Custom class name */
  className?: string;
  /** Show balance in button */
  showBalance?: boolean;
  /** Compact mode (icon only when connected) */
  compact?: boolean;
  /** Called when wallet is connected */
  onConnect?: () => void;
  /** Called when wallet is disconnected */
  onDisconnect?: () => void;
}

// ============================================================================
// Component
// ============================================================================

/**
 * WalletConnect component for multi-chain wallet management
 *
 * @example
 * ```tsx
 * <WalletConnect
 *   showBalance
 *   onConnect={() => console.log('Connected!')}
 * />
 * ```
 */
export const WalletConnect = memo(function WalletConnect({
  className = "",
  showBalance = false,
  compact = false,
  onConnect,
  onDisconnect,
}: WalletConnectProps) {
  const theme = useTheme();
  const { wallet, wallets, isConnecting, connect, disconnect, selectWallet } =
    useWallet();
  const { balance } = useBalance();

  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setIsDropdownOpen(false);
      }
    };

    if (isDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () =>
        document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isDropdownOpen]);

  const handleConnect = useCallback(
    async (network: NetworkId) => {
      const type = NETWORK_METADATA[network].type;
      try {
        await connect(type, network);
        setIsConnectModalOpen(false);
        onConnect?.();
      } catch (err) {
        console.error("Failed to connect:", err);
      }
    },
    [connect, onConnect],
  );

  const handleDisconnect = useCallback(
    (walletId: string) => {
      disconnect(walletId);
      setIsDropdownOpen(false);
      onDisconnect?.();
    },
    [disconnect, onDisconnect],
  );

  const handleWalletSelect = useCallback(
    (walletId: string) => {
      selectWallet(walletId);
      setIsDropdownOpen(false);
    },
    [selectWallet],
  );

  // Network icon component
  const NetworkIcon = ({ network }: { network: NetworkId }) => {
    const iconMap: Record<string, string> = {
      arbitrum: "🔵",
      base: "🔷",
      ethereum: "⟠",
      polygon: "🟣",
      bnb: "🟡",
      solana: "◎",
    };
    const networkKey = network.replace(/-.*$/, ""); // Remove suffix like -sepolia
    return <span className="mr-1">{iconMap[networkKey] || "🔗"}</span>;
  };

  // Styles
  const buttonStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 16px",
    borderRadius: theme.borderRadius.md,
    border: `1px solid ${theme.colors.border.default}`,
    backgroundColor: theme.colors.background.secondary,
    color: theme.colors.text.primary,
    fontSize: theme.typography.fontSize.sm,
    fontWeight: theme.typography.fontWeight.medium,
    cursor: "pointer",
    transition: `all ${theme.transitions.fast}`,
    outline: "none",
  };

  const dropdownStyle: React.CSSProperties = {
    position: "absolute",
    top: "calc(100% + 8px)",
    right: 0,
    minWidth: 280,
    backgroundColor: theme.colors.background.primary,
    border: `1px solid ${theme.colors.border.default}`,
    borderRadius: theme.borderRadius.md,
    boxShadow: theme.shadows.lg,
    zIndex: 1000,
    overflow: "hidden",
  };

  const walletItemStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px 16px",
    borderBottom: `1px solid ${theme.colors.border.default}`,
    cursor: "pointer",
    transition: `background-color ${theme.transitions.fast}`,
  };

  // Not connected - show connect button
  if (!wallet) {
    return (
      <div className={`relative ${className}`} ref={dropdownRef}>
        <button
          style={buttonStyle}
          onClick={() => setIsConnectModalOpen(true)}
          disabled={isConnecting}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor =
              theme.colors.background.tertiary;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor =
              theme.colors.background.secondary;
          }}
        >
          <WalletIcon />
          {isConnecting ? "Connecting..." : "Connect Wallet"}
        </button>

        {/* Connect Modal */}
        {isConnectModalOpen && (
          <ConnectModal
            onClose={() => setIsConnectModalOpen(false)}
            onConnect={handleConnect}
            theme={theme}
          />
        )}
      </div>
    );
  }

  // Connected - show address with dropdown
  const metadata = NETWORK_METADATA[wallet.network];

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      <button
        style={buttonStyle}
        onClick={() => setIsDropdownOpen(!isDropdownOpen)}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor =
            theme.colors.background.tertiary;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor =
            theme.colors.background.secondary;
        }}
      >
        <NetworkIcon network={wallet.network} />
        {!compact && (
          <>
            <span>{truncateAddress(wallet.address)}</span>
            {showBalance && balance && (
              <span style={{ color: theme.colors.text.secondary }}>
                ({formatUsd(balance.totalUsd)})
              </span>
            )}
          </>
        )}
        <ChevronIcon isOpen={isDropdownOpen} />
      </button>

      {/* Dropdown */}
      {isDropdownOpen && (
        <div style={dropdownStyle}>
          {/* Current wallet info */}
          <div
            style={{
              padding: "16px",
              borderBottom: `1px solid ${theme.colors.border.default}`,
              backgroundColor: theme.colors.background.secondary,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 8,
              }}
            >
              <NetworkIcon network={wallet.network} />
              <span
                style={{ fontWeight: theme.typography.fontWeight.semibold }}
              >
                {metadata.name}
              </span>
              {metadata.testnet && (
                <span
                  style={{
                    fontSize: 10,
                    padding: "2px 6px",
                    borderRadius: 4,
                    backgroundColor: theme.colors.state.warning,
                    color: "#000",
                  }}
                >
                  Testnet
                </span>
              )}
            </div>
            <div
              style={{
                fontFamily: "monospace",
                fontSize: theme.typography.fontSize.sm,
                color: theme.colors.text.secondary,
              }}
            >
              {wallet.address}
            </div>
            {balance && (
              <div
                style={{
                  marginTop: 8,
                  fontSize: theme.typography.fontSize.lg,
                  fontWeight: theme.typography.fontWeight.bold,
                }}
              >
                {formatUsd(balance.totalUsd)}
              </div>
            )}
          </div>

          {/* Other wallets */}
          {wallets.length > 1 && (
            <div>
              <div
                style={{
                  padding: "8px 16px",
                  fontSize: theme.typography.fontSize.xs,
                  color: theme.colors.text.muted,
                  textTransform: "uppercase",
                  letterSpacing: 1,
                }}
              >
                Other Wallets
              </div>
              {wallets
                .filter((w) => w.id !== wallet.id)
                .map((w) => (
                  <div
                    key={w.id}
                    style={walletItemStyle}
                    onClick={() => handleWalletSelect(w.id)}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor =
                        theme.colors.background.secondary;
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = "transparent";
                    }}
                  >
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 8 }}
                    >
                      <NetworkIcon network={w.network} />
                      <span>{truncateAddress(w.address)}</span>
                    </div>
                    <span
                      style={{ color: theme.colors.text.muted, fontSize: 12 }}
                    >
                      {NETWORK_METADATA[w.network].name}
                    </span>
                  </div>
                ))}
            </div>
          )}

          {/* Actions */}
          <div
            style={{
              padding: 8,
              borderTop: `1px solid ${theme.colors.border.default}`,
            }}
          >
            <button
              style={{
                width: "100%",
                padding: "10px 16px",
                border: "none",
                borderRadius: theme.borderRadius.sm,
                backgroundColor: "transparent",
                color: theme.colors.text.primary,
                cursor: "pointer",
                textAlign: "left",
                transition: `background-color ${theme.transitions.fast}`,
              }}
              onClick={() => {
                setIsConnectModalOpen(true);
                setIsDropdownOpen(false);
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor =
                  theme.colors.background.secondary;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = "transparent";
              }}
            >
              + Add Wallet
            </button>
            <button
              style={{
                width: "100%",
                padding: "10px 16px",
                border: "none",
                borderRadius: theme.borderRadius.sm,
                backgroundColor: "transparent",
                color: theme.colors.state.danger,
                cursor: "pointer",
                textAlign: "left",
                transition: `background-color ${theme.transitions.fast}`,
              }}
              onClick={() => handleDisconnect(wallet.id)}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor =
                  theme.colors.background.secondary;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = "transparent";
              }}
            >
              Disconnect
            </button>
          </div>
        </div>
      )}

      {/* Connect Modal */}
      {isConnectModalOpen && (
        <ConnectModal
          onClose={() => setIsConnectModalOpen(false)}
          onConnect={handleConnect}
          theme={theme}
        />
      )}
    </div>
  );
});

// ============================================================================
// Sub-components
// ============================================================================

const WalletIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  >
    <rect x="2" y="6" width="20" height="14" rx="2" />
    <path d="M2 10h20" />
    <circle cx="16" cy="14" r="2" />
  </svg>
);

const ChevronIcon = ({ isOpen }: { isOpen: boolean }) => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    style={{
      transition: "transform 0.2s",
      transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
    }}
  >
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

interface ConnectModalProps {
  onClose: () => void;
  onConnect: (network: NetworkId) => void;
  theme: ReturnType<typeof useTheme>;
}

const ConnectModal = memo(function ConnectModal({
  onClose,
  onConnect,
  theme,
}: ConnectModalProps) {
  const networks: { id: NetworkId; label: string; icon: string }[] = [
    { id: "arbitrum", label: "Arbitrum (USDs)", icon: "🔵" },
    { id: "base", label: "Base", icon: "🔷" },
    { id: "bnb", label: "BNB Chain", icon: "🟡" },
    { id: "solana-mainnet", label: "Solana", icon: "◎" },
    { id: "solana-devnet", label: "Solana Devnet", icon: "◎" },
    { id: "arbitrum-sepolia", label: "Arbitrum Sepolia", icon: "🔵" },
  ];

  return (
    <>
      {/* Backdrop */}
      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: "rgba(0, 0, 0, 0.5)",
          zIndex: 9999,
        }}
        onClick={onClose}
      />

      {/* Modal */}
      <div
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: 360,
          backgroundColor: theme.colors.background.primary,
          border: `1px solid ${theme.colors.border.default}`,
          borderRadius: theme.borderRadius.lg,
          boxShadow: theme.shadows.xl,
          zIndex: 10000,
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 20px",
            borderBottom: `1px solid ${theme.colors.border.default}`,
          }}
        >
          <h3
            style={{
              margin: 0,
              fontSize: theme.typography.fontSize.lg,
              fontWeight: theme.typography.fontWeight.semibold,
            }}
          >
            Connect Wallet
          </h3>
          <button
            onClick={onClose}
            style={{
              border: "none",
              background: "none",
              cursor: "pointer",
              padding: 4,
              color: theme.colors.text.secondary,
            }}
          >
            ✕
          </button>
        </div>

        {/* Network list */}
        <div style={{ padding: "8px 0" }}>
          {networks.map((network) => (
            <button
              key={network.id}
              onClick={() => onConnect(network.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                width: "100%",
                padding: "14px 20px",
                border: "none",
                backgroundColor: "transparent",
                color: theme.colors.text.primary,
                cursor: "pointer",
                textAlign: "left",
                fontSize: theme.typography.fontSize.base,
                transition: `background-color ${theme.transitions.fast}`,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor =
                  theme.colors.background.secondary;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = "transparent";
              }}
            >
              <span style={{ fontSize: 20 }}>{network.icon}</span>
              <span>{network.label}</span>
              {NETWORK_METADATA[network.id].testnet && (
                <span
                  style={{
                    fontSize: 10,
                    padding: "2px 6px",
                    borderRadius: 4,
                    backgroundColor: theme.colors.state.warning,
                    color: "#000",
                    marginLeft: "auto",
                  }}
                >
                  Testnet
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "12px 20px",
            borderTop: `1px solid ${theme.colors.border.default}`,
            fontSize: theme.typography.fontSize.xs,
            color: theme.colors.text.muted,
            textAlign: "center",
          }}
        >
          By connecting, you agree to the Terms of Service
        </div>
      </div>
    </>
  );
});

export default WalletConnect;
