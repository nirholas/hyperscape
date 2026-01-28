/**
 * DndKit Overlay
 *
 * Renders the drag overlay for @dnd-kit item dragging.
 * Shows visual feedback during item, prayer, and skill drags.
 *
 * @packageDocumentation
 */

import React from "react";
import { DragOverlay as DndKitDragOverlay } from "@dnd-kit/core";
import { getItem } from "@hyperscape/shared";
import { getItemIcon } from "@/utils";
import type { DndKitActiveItem } from "./DragDropCoordinator";

/** Inventory item for overlay rendering */
interface InventoryItem {
  itemId: string;
  quantity: number;
}

/** Props for DndKitDragOverlayRenderer */
interface DndKitDragOverlayRendererProps {
  /** Currently active drag item */
  activeItem: DndKitActiveItem | null;
  /** Inventory items for looking up item data */
  inventory: InventoryItem[];
}

/**
 * Renders the drag overlay for @dnd-kit drag operations
 */
export function DndKitDragOverlayRenderer({
  activeItem,
  inventory,
}: DndKitDragOverlayRendererProps): React.ReactElement {
  return (
    <DndKitDragOverlay dropAnimation={null}>
      {activeItem && (
        <DragOverlayContent activeItem={activeItem} inventory={inventory} />
      )}
    </DndKitDragOverlay>
  );
}

/** Props for DragOverlayContent */
interface DragOverlayContentProps {
  activeItem: DndKitActiveItem;
  inventory: InventoryItem[];
}

/**
 * Renders the content inside the drag overlay based on item type
 */
function DragOverlayContent({
  activeItem,
  inventory,
}: DragOverlayContentProps): React.ReactElement {
  const { id, data } = activeItem;
  const slotSize = 36;

  let icon: React.ReactNode = "📦";
  let label = "";

  if (id.startsWith("inventory-")) {
    const index = parseInt(id.replace("inventory-", ""), 10);
    const item =
      inventory[index] || (data?.item as { itemId: string } | undefined);
    if (item) {
      const itemData = getItem(item.itemId);
      icon = getItemIcon(item.itemId);
      label = itemData?.name || item.itemId;
    }
  } else if (id.startsWith("prayer-")) {
    const prayerData = data?.prayer as
      | { icon?: string; name?: string }
      | undefined;
    icon = prayerData?.icon || "🙏";
    label = prayerData?.name || "";
  } else if (id.startsWith("skill-")) {
    const skillData = data?.skill as
      | { icon?: string; name?: string }
      | undefined;
    icon = skillData?.icon || "📊";
    label = skillData?.name || "";
  }

  return (
    <div
      style={{
        width: slotSize,
        height: slotSize,
        background: "linear-gradient(180deg, #4a4a4a 0%, #2a2a2a 100%)",
        border: "2px solid #d4a853",
        borderRadius: 4,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow:
          "0 4px 12px rgba(0, 0, 0, 0.4), 0 0 8px rgba(212, 168, 83, 0.3)",
        pointerEvents: "none",
        fontSize: 18,
        position: "relative",
      }}
      title={label}
    >
      {icon}
    </div>
  );
}
