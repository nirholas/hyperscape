/**
 * Duel Stakes Screen
 *
 * Screen where both players stake items for the duel.
 * Similar to trade panel but for duel stakes.
 *
 * OSRS-style features:
 * - Left-click inventory item: stake 1
 * - Right-click: context menu for quantity options
 * - Both players must accept for duel to proceed
 * - Anti-scam: resets acceptance when stakes change
 */

import { useState, useCallback, useMemo, type CSSProperties } from "react";
import { useThemeStore, type Theme } from "@/ui";
import { getItem } from "@hyperscape/shared";

// ============================================================================
// Types
// ============================================================================

interface StakedItem {
  inventorySlot: number;
  itemId: string;
  quantity: number;
  value: number;
}

interface InventoryItem {
  slot: number;
  itemId: string;
  quantity: number;
}

interface StakesScreenProps {
  myStakes: StakedItem[];
  opponentStakes: StakedItem[];
  inventory: InventoryItem[];
  myAccepted: boolean;
  opponentAccepted: boolean;
  opponentName: string;
  /** Shows warning when opponent modifies their stakes */
  opponentModifiedStakes?: boolean;
  onAddStake: (inventorySlot: number, quantity: number) => void;
  onRemoveStake: (stakeIndex: number) => void;
  onAccept: () => void;
  onCancel: () => void;
}

// ============================================================================
// Constants
// ============================================================================

const STAKE_GRID_COLS = 4;
const STAKE_GRID_ROWS = 7;
const STAKE_SLOTS = STAKE_GRID_COLS * STAKE_GRID_ROWS;
const INVENTORY_COLS = 4;
const INVENTORY_ROWS = 7;

// ============================================================================
// Helper Functions
// ============================================================================

function formatQuantity(quantity: number): string {
  if (quantity >= 10_000_000) {
    return `${Math.floor(quantity / 1_000_000)}M`;
  } else if (quantity >= 100_000) {
    return `${Math.floor(quantity / 1_000)}K`;
  }
  return quantity.toString();
}

function formatGoldValue(value: number): string {
  if (value >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(1)}B`;
  } else if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  } else if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }
  return value.toString();
}

function calculateTotalValue(stakes: StakedItem[]): number {
  return stakes.reduce((sum, item) => sum + item.value, 0);
}

// ============================================================================
// Memoized Styles Hook
// ============================================================================

function useStakesScreenStyles(theme: Theme, myAccepted: boolean) {
  return useMemo(() => {
    const containerStyle: CSSProperties = {
      display: "flex",
      gap: theme.spacing.md,
      height: "100%",
    };

    const panelStyle: CSSProperties = {
      flex: 1,
      minWidth: 0,
      background: theme.colors.background.tertiary,
      border: `1px solid ${theme.colors.border.default}`,
      borderRadius: theme.borderRadius.md,
      padding: theme.spacing.sm,
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
    };

    const headerStyle: CSSProperties = {
      fontSize: theme.typography.fontSize.sm,
      fontWeight: theme.typography.fontWeight.bold,
      color: theme.colors.text.primary,
      marginBottom: theme.spacing.xs,
      textAlign: "center",
      borderBottom: `1px solid ${theme.colors.border.default}`,
      paddingBottom: theme.spacing.xs,
    };

    const gridStyle: CSSProperties = {
      display: "grid",
      gridTemplateColumns: `repeat(${STAKE_GRID_COLS}, 1fr)`,
      gap: 2,
      flex: 1,
      overflow: "hidden",
    };

    const quantityStyle: CSSProperties = {
      position: "absolute",
      bottom: 2,
      right: 2,
      fontSize: "10px",
      color: theme.colors.text.secondary,
      textShadow: "0 0 2px black",
    };

    const valueStyle: CSSProperties = {
      textAlign: "center",
      fontSize: theme.typography.fontSize.sm,
      color: theme.colors.accent.gold || "#ffd700",
      marginTop: theme.spacing.xs,
      fontWeight: theme.typography.fontWeight.bold,
    };

    const acceptanceStyle: CSSProperties = {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      padding: theme.spacing.sm,
      background: theme.colors.background.secondary,
      borderRadius: theme.borderRadius.sm,
      fontSize: theme.typography.fontSize.sm,
      marginTop: theme.spacing.sm,
    };

    const buttonContainerStyle: CSSProperties = {
      display: "flex",
      gap: theme.spacing.md,
      marginTop: theme.spacing.sm,
    };

    const baseButtonStyle: CSSProperties = {
      flex: 1,
      padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
      borderRadius: theme.borderRadius.md,
      fontSize: theme.typography.fontSize.sm,
      fontWeight: theme.typography.fontWeight.bold,
      cursor: "pointer",
      transition: "all 0.2s ease",
    };

    const acceptButtonStyle: CSSProperties = {
      ...baseButtonStyle,
      background: myAccepted
        ? `${theme.colors.state.success}88`
        : theme.colors.state.success,
      color: "#fff",
      border: `1px solid ${theme.colors.state.success}`,
      opacity: myAccepted ? 0.7 : 1,
    };

    const cancelButtonStyle: CSSProperties = {
      ...baseButtonStyle,
      background: theme.colors.state.danger,
      color: "#fff",
      border: `1px solid ${theme.colors.state.danger}`,
    };

    const warningBannerStyle: CSSProperties = {
      background: `${theme.colors.state.warning}33`,
      border: `1px solid ${theme.colors.state.warning}`,
      borderRadius: theme.borderRadius.md,
      padding: theme.spacing.sm,
      marginBottom: theme.spacing.sm,
      textAlign: "center",
      fontSize: theme.typography.fontSize.sm,
      color: theme.colors.state.warning,
      fontWeight: theme.typography.fontWeight.bold,
    };

    const inventoryPanelStyle: CSSProperties = {
      ...panelStyle,
      width: 160,
      minWidth: 160,
      maxWidth: 160,
      overflow: "hidden",
    };

    const inventoryGridStyle: CSSProperties = {
      display: "grid",
      gridTemplateColumns: `repeat(${INVENTORY_COLS}, 1fr)`,
      gap: 2,
      flex: 1,
      overflow: "hidden",
    };

    const contextMenuStyle: CSSProperties = {
      background: theme.colors.background.secondary,
      border: `1px solid ${theme.colors.border.default}`,
      borderRadius: theme.borderRadius.md,
      padding: theme.spacing.xs,
      zIndex: 10001,
      boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
    };

    const contextMenuItemStyle: CSSProperties = {
      padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
      cursor: "pointer",
      fontSize: theme.typography.fontSize.sm,
      color: theme.colors.text.primary,
    };

    return {
      containerStyle,
      panelStyle,
      headerStyle,
      gridStyle,
      quantityStyle,
      valueStyle,
      acceptanceStyle,
      buttonContainerStyle,
      acceptButtonStyle,
      cancelButtonStyle,
      warningBannerStyle,
      inventoryPanelStyle,
      inventoryGridStyle,
      contextMenuStyle,
      contextMenuItemStyle,
    };
  }, [theme, myAccepted]);
}

/**
 * Get slot style based on item and staked state (called per item)
 */
function getSlotStyle(
  theme: Theme,
  hasItem: boolean,
  isStaked?: boolean,
): CSSProperties {
  return {
    aspectRatio: "1",
    minWidth: 0,
    minHeight: 0,
    background: hasItem
      ? theme.colors.background.secondary
      : theme.colors.background.primary,
    border: `1px solid ${isStaked ? theme.colors.accent.primary : theme.colors.border.default}`,
    borderRadius: theme.borderRadius.sm,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    cursor: hasItem ? "pointer" : "default",
    position: "relative",
    fontSize: theme.typography.fontSize.xs,
    padding: 2,
    overflow: "hidden",
  };
}

/**
 * Get status dot style based on accepted state
 */
function getStatusDotStyle(theme: Theme, accepted: boolean): CSSProperties {
  return {
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: accepted
      ? theme.colors.state.success
      : theme.colors.state.danger,
    marginRight: theme.spacing.xs,
    display: "inline-block",
  };
}

// ============================================================================
// Component
// ============================================================================

export function StakesScreen({
  myStakes,
  opponentStakes,
  inventory,
  myAccepted,
  opponentAccepted,
  opponentName,
  opponentModifiedStakes,
  onAddStake,
  onRemoveStake,
  onAccept,
  onCancel,
}: StakesScreenProps) {
  const theme = useThemeStore((s) => s.theme);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    item: InventoryItem;
  } | null>(null);

  // Memoized styles - only recalculated when theme or myAccepted changes
  const styles = useStakesScreenStyles(theme, myAccepted);

  // Calculate total values
  const myTotalValue = useMemo(() => calculateTotalValue(myStakes), [myStakes]);
  const opponentTotalValue = useMemo(
    () => calculateTotalValue(opponentStakes),
    [opponentStakes],
  );

  // Check for significant value imbalance (anti-scam)
  const valueImbalanceWarning = useMemo(() => {
    if (myTotalValue === 0 && opponentTotalValue === 0) return null;
    const difference = myTotalValue - opponentTotalValue;
    const percentDiff =
      Math.abs(difference) / Math.max(myTotalValue, opponentTotalValue, 1);
    // Warn if difference is > 50% and > 10k gp
    if (percentDiff > 0.5 && Math.abs(difference) > 10000) {
      if (difference > 0) {
        return `You are risking ${formatGoldValue(difference)} gp more than ${opponentName}!`;
      }
    }
    return null;
  }, [myTotalValue, opponentTotalValue, opponentName]);

  // Get staked inventory slots
  const stakedSlots = useMemo(
    () => new Set(myStakes.map((s) => s.inventorySlot)),
    [myStakes],
  );

  // Handle inventory left-click (stake 1)
  const handleInventoryClick = useCallback(
    (item: InventoryItem) => {
      if (!stakedSlots.has(item.slot)) {
        onAddStake(item.slot, 1);
      }
    },
    [onAddStake, stakedSlots],
  );

  // Handle inventory right-click (show menu)
  const handleInventoryRightClick = useCallback(
    (e: React.MouseEvent, item: InventoryItem) => {
      e.preventDefault();
      if (!stakedSlots.has(item.slot)) {
        setContextMenu({ x: e.clientX, y: e.clientY, item });
      }
    },
    [stakedSlots],
  );

  // Handle stake removal
  const handleRemoveStake = useCallback(
    (index: number) => {
      onRemoveStake(index);
    },
    [onRemoveStake],
  );

  // Close context menu
  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  // Handle context menu option
  const handleContextOption = useCallback(
    (quantity: number | "all") => {
      if (!contextMenu) return;
      const item = contextMenu.item;
      const qty =
        quantity === "all" ? item.quantity : Math.min(quantity, item.quantity);
      onAddStake(item.slot, qty);
      closeContextMenu();
    },
    [contextMenu, onAddStake, closeContextMenu],
  );

  // Render stake item
  const renderStakeItem = (
    item: StakedItem | undefined,
    index: number,
    isMine: boolean,
  ) => {
    if (!item) {
      return <div key={index} style={getSlotStyle(theme, false)} />;
    }

    const itemData = getItem(item.itemId);
    const displayName = itemData?.name || item.itemId;

    return (
      <div
        key={index}
        style={getSlotStyle(theme, true)}
        onClick={
          isMine ? () => handleRemoveStake(myStakes.indexOf(item)) : undefined
        }
        title={`${displayName}${isMine ? " (click to remove)" : ""}`}
      >
        <span
          style={{ fontSize: "10px", textAlign: "center", overflow: "hidden" }}
        >
          {displayName.substring(0, 8)}
        </span>
        {item.quantity > 1 && (
          <span style={styles.quantityStyle}>
            {formatQuantity(item.quantity)}
          </span>
        )}
      </div>
    );
  };

  // Render inventory item
  const renderInventoryItem = (
    item: InventoryItem | undefined,
    slotIndex: number,
  ) => {
    if (!item) {
      return <div key={slotIndex} style={getSlotStyle(theme, false)} />;
    }

    const isStaked = stakedSlots.has(item.slot);
    const itemData = getItem(item.itemId);
    const displayName = itemData?.name || item.itemId;

    return (
      <div
        key={slotIndex}
        style={getSlotStyle(theme, true, isStaked)}
        onClick={() => !isStaked && handleInventoryClick(item)}
        onContextMenu={(e) => handleInventoryRightClick(e, item)}
        title={isStaked ? `${displayName} (staked)` : displayName}
      >
        <span
          style={{ fontSize: "10px", textAlign: "center", overflow: "hidden" }}
        >
          {displayName.substring(0, 8)}
        </span>
        {item.quantity > 1 && (
          <span style={styles.quantityStyle}>
            {formatQuantity(item.quantity)}
          </span>
        )}
      </div>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Anti-scam warning banners */}
      {opponentModifiedStakes && (
        <div style={styles.warningBannerStyle}>
          Warning: {opponentName} has modified their stakes!
        </div>
      )}
      {valueImbalanceWarning && (
        <div style={styles.warningBannerStyle}>{valueImbalanceWarning}</div>
      )}

      <div style={styles.containerStyle}>
        {/* My Stakes */}
        <div style={styles.panelStyle}>
          <div style={styles.headerStyle}>Your Stakes</div>
          <div style={styles.gridStyle}>
            {Array.from({ length: STAKE_SLOTS }).map((_, i) =>
              renderStakeItem(myStakes[i], i, true),
            )}
          </div>
          <div style={styles.valueStyle}>
            Value: {formatGoldValue(myTotalValue)} gp
          </div>
        </div>

        {/* Opponent Stakes */}
        <div style={styles.panelStyle}>
          <div style={styles.headerStyle}>{opponentName}'s Stakes</div>
          <div style={styles.gridStyle}>
            {Array.from({ length: STAKE_SLOTS }).map((_, i) =>
              renderStakeItem(opponentStakes[i], i, false),
            )}
          </div>
          <div style={styles.valueStyle}>
            Value: {formatGoldValue(opponentTotalValue)} gp
          </div>
        </div>

        {/* Inventory */}
        <div style={styles.inventoryPanelStyle}>
          <div style={styles.headerStyle}>Inventory</div>
          <div style={styles.inventoryGridStyle}>
            {Array.from({ length: INVENTORY_COLS * INVENTORY_ROWS }).map(
              (_, i) => {
                const item = inventory.find((inv) => inv.slot === i);
                return renderInventoryItem(item, i);
              },
            )}
          </div>
        </div>
      </div>

      {/* Acceptance Status */}
      <div style={styles.acceptanceStyle}>
        <span>
          <span style={getStatusDotStyle(theme, myAccepted)} />
          You: {myAccepted ? "Accepted" : "Not accepted"}
        </span>
        <span>
          <span style={getStatusDotStyle(theme, opponentAccepted)} />
          {opponentName}: {opponentAccepted ? "Accepted" : "Not accepted"}
        </span>
      </div>

      {/* Buttons */}
      <div style={styles.buttonContainerStyle}>
        <button
          onClick={onAccept}
          style={styles.acceptButtonStyle}
          disabled={myAccepted}
        >
          {myAccepted ? "Waiting..." : "Accept Stakes"}
        </button>
        <button onClick={onCancel} style={styles.cancelButtonStyle}>
          Cancel
        </button>
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          style={{
            position: "fixed",
            left: contextMenu.x,
            top: contextMenu.y,
            ...styles.contextMenuStyle,
          }}
          onMouseLeave={closeContextMenu}
        >
          {[1, 5, 10, "all"].map((qty) => (
            <div
              key={qty}
              onClick={() => handleContextOption(qty as number | "all")}
              style={styles.contextMenuItemStyle}
              onMouseEnter={(e) =>
                (e.currentTarget.style.background =
                  theme.colors.background.tertiary)
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.background = "transparent")
              }
            >
              Stake {qty === "all" ? "All" : qty}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
