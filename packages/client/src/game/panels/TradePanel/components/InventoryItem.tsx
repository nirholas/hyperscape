/**
 * Inventory Item Component
 *
 * Clickable inventory item for OSRS-style trade panel.
 * Left-click: add 1 to trade
 * Right-click: show context menu
 */

import { getItem } from "@hyperscape/shared";
import { getItemIcon } from "@/utils";
import { formatQuantity } from "../utils";
import type { InventoryItemProps } from "../types";

export function InventoryItem({
  item,
  theme,
  onLeftClick,
  onRightClick,
}: InventoryItemProps) {
  const itemData = getItem(item.itemId);
  const itemIcon = getItemIcon(item.itemId);
  const qtyDisplay = item.quantity > 1 ? formatQuantity(item.quantity) : null;

  return (
    <div
      className="relative flex items-center justify-center hover:brightness-110"
      style={{
        width: "36px",
        height: "36px",
        background: theme.colors.background.panelSecondary,
        border: `1px solid ${theme.colors.border.default}`,
        borderRadius: "4px",
        cursor: "pointer",
        transition: "filter 0.1s",
      }}
      title={`${itemData?.name || item.itemId} (Left-click: Offer 1, Right-click: Options)`}
      onClick={(e) => {
        e.preventDefault();
        onLeftClick();
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onRightClick(e);
      }}
    >
      {/* Render emoji icon as text */}
      {itemIcon && (
        <span
          style={{
            fontSize: "20px",
            color: "#f2d08a",
            filter: "drop-shadow(0 2px 2px rgba(0, 0, 0, 0.6))",
          }}
        >
          {itemIcon}
        </span>
      )}
      {qtyDisplay && (
        <span
          className="absolute bottom-0 right-0.5 text-xs font-bold"
          style={{
            color: qtyDisplay.color,
            textShadow:
              "1px 1px 0 #000, -1px 1px 0 #000, 1px -1px 0 #000, -1px -1px 0 #000",
            fontSize: "10px",
          }}
        >
          {qtyDisplay.text}
        </span>
      )}
    </div>
  );
}
