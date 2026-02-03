/**
 * @fileoverview NetworkSelector Component
 * @module @hyperscape/client/ui/components/web3/NetworkSelector
 *
 * Dropdown component for selecting and switching blockchain networks.
 */

import React, { memo, useState, useCallback, useRef, useEffect } from "react";
import { useWallet } from "../../../hooks/useWallet";
import { NETWORK_METADATA, type NetworkId } from "@hyperscape/shared";
import { useTheme } from "../../stores/themeStore";

// ============================================================================
// Types
// ============================================================================

export interface NetworkSelectorProps {
  /** Custom class name */
  className?: string;
  /** Show testnet networks */
  showTestnets?: boolean;
  /** Called when network is selected */
  onNetworkSelect?: (network: NetworkId) => void;
  /** Filter to specific networks */
  networks?: NetworkId[];
  /** Disabled state */
  disabled?: boolean;
}

// ============================================================================
// Default Networks
// ============================================================================

const DEFAULT_NETWORKS: NetworkId[] = [
  "arbitrum",
  "base",
  "ethereum",
  "polygon",
  "optimism",
  "bnb",
  "solana-mainnet",
];

const TESTNET_NETWORKS: NetworkId[] = [
  "arbitrum-sepolia",
  "bnb-testnet",
  "solana-devnet",
  "solana-testnet",
];

// ============================================================================
// Component
// ============================================================================

/**
 * NetworkSelector component for selecting blockchain networks
 *
 * @example
 * ```tsx
 * <NetworkSelector
 *   showTestnets
 *   onNetworkSelect={(network) => console.log('Selected:', network)}
 * />
 * ```
 */
export const NetworkSelector = memo(function NetworkSelector({
  className = "",
  showTestnets = false,
  onNetworkSelect,
  networks: customNetworks,
  disabled = false,
}: NetworkSelectorProps) {
  const theme = useTheme();
  const { wallet, connect } = useWallet();

  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Available networks
  const availableNetworks = customNetworks || [
    ...DEFAULT_NETWORKS,
    ...(showTestnets ? TESTNET_NETWORKS : []),
  ];

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () =>
        document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  // Handle network selection
  const handleNetworkSelect = useCallback(
    async (networkId: NetworkId) => {
      setIsOpen(false);

      const metadata = NETWORK_METADATA[networkId];

      // If we have a wallet on this network, just notify
      // Otherwise, prompt to connect
      try {
        await connect(metadata.type, networkId);
        onNetworkSelect?.(networkId);
      } catch (error) {
        console.error("Failed to switch network:", error);
      }
    },
    [connect, onNetworkSelect],
  );

  // Current network
  const currentNetwork = wallet ? NETWORK_METADATA[wallet.network] : null;

  // Button styles
  const buttonStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 12px",
    borderRadius: theme.borderRadius.md,
    border: `1px solid ${theme.colors.border.default}`,
    backgroundColor: theme.colors.background.secondary,
    color: theme.colors.text.primary,
    fontSize: theme.typography.fontSize.sm,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    transition: `all ${theme.transitions.fast}`,
    minWidth: 140,
  };

  const dropdownStyle: React.CSSProperties = {
    position: "absolute",
    top: "calc(100% + 4px)",
    left: 0,
    right: 0,
    minWidth: 200,
    maxHeight: 320,
    overflowY: "auto",
    backgroundColor: theme.colors.background.primary,
    border: `1px solid ${theme.colors.border.default}`,
    borderRadius: theme.borderRadius.md,
    boxShadow: theme.shadows.lg,
    zIndex: 1000,
  };

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      {/* Trigger button */}
      <button
        style={buttonStyle}
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        onMouseEnter={(e) => {
          if (!disabled) {
            e.currentTarget.style.backgroundColor =
              theme.colors.background.tertiary;
          }
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor =
            theme.colors.background.secondary;
        }}
      >
        {currentNetwork ? (
          <>
            <NetworkIcon network={wallet!.network} />
            <span style={{ flex: 1, textAlign: "left" }}>
              {currentNetwork.name}
            </span>
            {currentNetwork.testnet && (
              <span
                style={{
                  fontSize: 9,
                  padding: "1px 4px",
                  borderRadius: 3,
                  backgroundColor: theme.colors.state.warning,
                  color: "#000",
                }}
              >
                Test
              </span>
            )}
          </>
        ) : (
          <>
            <span style={{ fontSize: 14 }}>🌐</span>
            <span style={{ flex: 1, textAlign: "left" }}>Select Network</span>
          </>
        )}
        <ChevronIcon isOpen={isOpen} />
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div style={dropdownStyle}>
          {/* Mainnet networks */}
          <div>
            <div
              style={{
                padding: "8px 12px",
                fontSize: theme.typography.fontSize.xs,
                color: theme.colors.text.muted,
                textTransform: "uppercase",
                letterSpacing: 0.5,
                borderBottom: `1px solid ${theme.colors.border.default}`,
              }}
            >
              Networks
            </div>
            {availableNetworks
              .filter((id) => !NETWORK_METADATA[id].testnet)
              .map((networkId) => (
                <NetworkOption
                  key={networkId}
                  networkId={networkId}
                  isSelected={wallet?.network === networkId}
                  onClick={() => handleNetworkSelect(networkId)}
                  theme={theme}
                />
              ))}
          </div>

          {/* Testnet networks */}
          {showTestnets && (
            <div>
              <div
                style={{
                  padding: "8px 12px",
                  fontSize: theme.typography.fontSize.xs,
                  color: theme.colors.text.muted,
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                  borderBottom: `1px solid ${theme.colors.border.default}`,
                  borderTop: `1px solid ${theme.colors.border.default}`,
                  marginTop: 4,
                }}
              >
                Testnets
              </div>
              {availableNetworks
                .filter((id) => NETWORK_METADATA[id].testnet)
                .map((networkId) => (
                  <NetworkOption
                    key={networkId}
                    networkId={networkId}
                    isSelected={wallet?.network === networkId}
                    onClick={() => handleNetworkSelect(networkId)}
                    theme={theme}
                  />
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

// ============================================================================
// Sub-components
// ============================================================================

interface NetworkOptionProps {
  networkId: NetworkId;
  isSelected: boolean;
  onClick: () => void;
  theme: ReturnType<typeof useTheme>;
}

const NetworkOption = memo(function NetworkOption({
  networkId,
  isSelected,
  onClick,
  theme,
}: NetworkOptionProps) {
  const metadata = NETWORK_METADATA[networkId];

  const optionStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    cursor: "pointer",
    backgroundColor: isSelected
      ? theme.colors.background.secondary
      : "transparent",
    transition: `background-color ${theme.transitions.fast}`,
  };

  return (
    <div
      style={optionStyle}
      onClick={onClick}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor =
          theme.colors.background.secondary;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = isSelected
          ? theme.colors.background.secondary
          : "transparent";
      }}
    >
      <NetworkIcon network={networkId} />
      <span style={{ flex: 1 }}>{metadata.name}</span>
      {isSelected && (
        <span style={{ color: theme.colors.state.success, fontSize: 14 }}>
          ✓
        </span>
      )}
    </div>
  );
});

const NetworkIcon = ({ network }: { network: NetworkId }) => {
  const iconMap: Record<string, string> = {
    arbitrum: "🔵",
    "arbitrum-sepolia": "🔵",
    base: "🔷",
    ethereum: "⟠",
    polygon: "🟣",
    optimism: "🔴",
    bnb: "🟡",
    "bnb-testnet": "🟡",
    "solana-mainnet": "◎",
    "solana-devnet": "◎",
    "solana-testnet": "◎",
  };
  return <span style={{ fontSize: 16 }}>{iconMap[network] || "🔗"}</span>;
};

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

export default NetworkSelector;
