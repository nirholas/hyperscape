/**
 * Coin Pouch Component
 *
 * Displays the money pouch balance and handles withdrawal interactions.
 * RS3-style: click or press Enter/Space to open withdrawal modal.
 *
 * Accessibility:
 * - role="button" for screen reader identification
 * - tabIndex={0} for keyboard focusability
 * - onKeyDown for Enter/Space activation
 * - aria-label for descriptive announcement
 *
 * @see InventoryPanel - Parent component
 * @see CoinAmountModal - Modal for withdrawal amount selection
 */

import { useCallback } from "react";

// ============================================================================
// Hoisted Styles (prevents object recreation on each render)
// ============================================================================

const COIN_POUCH_STYLES = {
  container: {
    background:
      "linear-gradient(180deg, rgba(45, 40, 35, 0.95) 0%, rgba(30, 25, 22, 0.98) 100%)",
    borderColor: "rgba(120, 100, 60, 0.5)",
    boxShadow:
      "inset 0 1px 0 rgba(150, 130, 80, 0.2), 0 1px 2px rgba(0, 0, 0, 0.3)",
  },
  label: {
    color: "rgba(210, 190, 130, 0.9)",
  },
  balance: {
    color: "#fbbf24",
    textShadow: "0 1px 2px rgba(0, 0, 0, 0.8)",
  },
} as const;

// ============================================================================
// Props Interface
// ============================================================================

interface CoinPouchProps {
  /** Current coin balance in money pouch */
  coins: number;
  /** Callback when user wants to withdraw (opens modal) */
  onWithdrawClick: () => void;
}

// ============================================================================
// Component
// ============================================================================

export function CoinPouch({ coins, onWithdrawClick }: CoinPouchProps) {
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onWithdrawClick();
      }
    },
    [onWithdrawClick],
  );

  return (
    <div
      role="button"
      tabIndex={0}
      className="border rounded flex items-center justify-between py-1 px-2 cursor-pointer hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-yellow-500/50 transition-all"
      style={COIN_POUCH_STYLES.container}
      onClick={onWithdrawClick}
      onKeyDown={handleKeyDown}
      aria-label={`Money pouch: ${coins.toLocaleString()} coins. Press Enter to withdraw.`}
      title="Click to withdraw coins to inventory"
    >
      <div className="flex items-center gap-1.5">
        <span className="text-base">💰</span>
        <span className="font-medium text-xs" style={COIN_POUCH_STYLES.label}>
          Coins
        </span>
      </div>
      <span className="font-bold text-xs" style={COIN_POUCH_STYLES.balance}>
        {coins.toLocaleString()}
      </span>
    </div>
  );
}
