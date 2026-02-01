/**
 * Trade Slot Component
 *
 * Individual trade slot displaying an item or empty slot.
 * Shows red flashing exclamation when item was recently removed (anti-scam).
 */

import { getItem } from "@hyperscape/shared";
import { ItemIcon } from "@/ui/components/ItemIcon";
import { formatQuantity } from "../utils";
import type { TradeSlotProps } from "../types";

export function TradeSlot({
  item,
  slotIndex: _slotIndex,
  side,
  onRemove,
  theme,
  isRemoved,
}: TradeSlotProps) {
  const itemData = item ? getItem(item.itemId) : null;
  const quantity = item?.quantity ?? 0;
  const qtyDisplay = quantity > 1 ? formatQuantity(quantity) : null;

  return (
    <div
      className="relative flex items-center justify-center"
      style={{
        width: "36px",
        height: "36px",
        background: isRemoved
          ? "rgba(239, 68, 68, 0.3)"
          : theme.colors.background.tertiary,
        border: isRemoved
          ? "2px solid #ef4444"
          : `1px solid ${theme.colors.border.default}`,
        borderRadius: "4px",
        cursor: item && side === "my" ? "pointer" : "default",
        transition: "background 0.15s, border-color 0.15s",
        animation: isRemoved ? "pulse 0.5s ease-in-out infinite" : "none",
      }}
      onClick={() => {
        if (item && side === "my" && onRemove) {
          onRemove();
        }
      }}
      title={itemData?.name || ""}
    >
      {/* Red flashing exclamation for removed items */}
      {isRemoved && !item && (
        <span
          style={{
            fontSize: "24px",
            color: "#ef4444",
            fontWeight: "bold",
            textShadow: "0 0 8px rgba(239, 68, 68, 0.8)",
          }}
        >
          !
        </span>
      )}
      {/* Render item icon */}
      {item && (
        <ItemIcon
          itemId={item.itemId}
          size={32}
          style={{ filter: "drop-shadow(0 2px 2px rgba(0, 0, 0, 0.6))" }}
        />
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
