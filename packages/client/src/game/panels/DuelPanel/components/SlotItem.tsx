/**
 * SlotItem — Shared slot renderer for stake grids and inventory
 *
 * Renders a single item slot with:
 * - Item name (truncated to 8 chars)
 * - Quantity badge for stackable items
 * - Click/right-click handlers
 * - Visual staked indicator
 */

import type { CSSProperties } from "react";
import type { Theme } from "@/ui";
import { formatQuantity } from "../utils";

// ============================================================================
// Types
// ============================================================================

interface SlotItemProps {
  theme: Theme;
  hasItem: boolean;
  displayName?: string;
  quantity?: number;
  isStaked?: boolean;
  title?: string;
  quantityStyle: CSSProperties;
  onClick?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}

// ============================================================================
// Helpers
// ============================================================================

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

// ============================================================================
// Component
// ============================================================================

export function SlotItem({
  theme,
  hasItem,
  displayName,
  quantity,
  isStaked,
  title,
  quantityStyle,
  onClick,
  onContextMenu,
}: SlotItemProps) {
  if (!hasItem) {
    return <div style={getSlotStyle(theme, false)} />;
  }

  return (
    <div
      style={getSlotStyle(theme, true, isStaked)}
      onClick={onClick}
      onContextMenu={onContextMenu}
      title={title}
    >
      <span
        style={{ fontSize: "10px", textAlign: "center", overflow: "hidden" }}
      >
        {displayName?.substring(0, 8)}
      </span>
      {quantity !== undefined && quantity > 1 && (
        <span style={quantityStyle}>{formatQuantity(quantity)}</span>
      )}
    </div>
  );
}
