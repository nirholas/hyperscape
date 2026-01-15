/**
 * Inventory Panel
 * Modern MMORPG-style inventory interface with drag-and-drop functionality
 */

import { useEffect, useState, useRef, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { COLORS } from "../../constants";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  useDraggable,
  useDroppable,
  MouseSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  pointerWithin,
  type Modifier,
} from "@dnd-kit/core";
import {
  EventType,
  getItem,
  uuid,
  type Item,
  // OSRS-accurate item helpers (extracted to shared)
  isFood,
  isPotion,
  isBone,
  usesWield,
  usesWear,
  isNotedItem,
  getPrimaryAction,
  CONTEXT_MENU_COLORS,
  type PrimaryActionType,
} from "@hyperscape/shared";
import { dispatchInventoryAction } from "../systems/InventoryActionDispatcher";
import type { ClientWorld, InventorySlotItem } from "../../types";

/**
 * Maximum inventory slots (OSRS-style: 28 slots)
 * Matches INPUT_LIMITS.MAX_INVENTORY_SLOTS from shared constants
 */
const MAX_SLOTS = 28;

type InventorySlotViewItem = Pick<
  InventorySlotItem,
  "slot" | "itemId" | "quantity"
>;

interface InventoryPanelProps {
  items: InventorySlotViewItem[];
  coins: number;
  world?: ClientWorld;
  onItemMove?: (fromIndex: number, toIndex: number) => void;
  onItemUse?: (item: InventorySlotViewItem, index: number) => void;
  onItemEquip?: (item: InventorySlotViewItem) => void;
}

interface DraggableItemProps {
  item: InventorySlotViewItem | null;
  index: number;
  onShiftClick?: (item: InventorySlotViewItem, index: number) => void;
  onPrimaryAction?: (
    item: InventorySlotViewItem,
    index: number,
    actionType: PrimaryActionType,
  ) => void;
  targetingState?: TargetingState;
  onTargetClick?: (item: InventorySlotViewItem, index: number) => void;
  onInvalidTargetClick?: () => void;
  onTargetHover?: (
    item: InventorySlotViewItem,
    position: { x: number; y: number },
  ) => void;
  onTargetHoverEnd?: () => void;
  // RS3-style hover tooltip (separate from targeting mode)
  onItemHoverStart?: (
    item: InventorySlotViewItem,
    position: { x: number; y: number },
  ) => void;
  onItemHoverMove?: (position: { x: number; y: number }) => void;
  onItemHoverEnd?: () => void;
  // Callback when context menu opens (to suppress hover tooltips)
  onContextMenuOpen?: () => void;
}

// OSRS-style: 4 columns × 7 rows = 28 slots, all visible (no pagination)

/**
 * Format quantity for OSRS-style display
 * - Under 100K: show exact number
 * - 100K-9.99M: green "123K" format
 * - 10M+: green "12M" format
 */
function formatQuantity(qty: number): { text: string; color: string } {
  if (qty < 100000) {
    return { text: qty.toLocaleString(), color: "rgba(255, 255, 255, 0.95)" };
  } else if (qty < 10000000) {
    const k = Math.floor(qty / 1000);
    return { text: `${k}K`, color: "rgba(0, 255, 128, 0.95)" };
  } else {
    const m = Math.floor(qty / 1000000);
    return { text: `${m}M`, color: "rgba(0, 255, 128, 0.95)" };
  }
}

/**
 * Custom modifier to center the DragOverlay on the cursor.
 * Without this, the overlay appears offset from where user is dragging.
 */
const snapCenterToCursor: Modifier = ({
  activatorEvent,
  draggingNodeRect,
  transform,
}) => {
  if (draggingNodeRect && activatorEvent && "clientX" in activatorEvent) {
    const event = activatorEvent as PointerEvent;
    // Calculate offset from where user clicked to center of the element
    const offsetX =
      event.clientX - draggingNodeRect.left - draggingNodeRect.width / 2;
    const offsetY =
      event.clientY - draggingNodeRect.top - draggingNodeRect.height / 2;

    return {
      ...transform,
      x: transform.x + offsetX,
      y: transform.y + offsetY,
    };
  }
  return transform;
};

function DraggableInventorySlot({
  item,
  index,
  onShiftClick,
  onPrimaryAction,
  targetingState,
  onTargetClick,
  onInvalidTargetClick,
  onTargetHover,
  onTargetHoverEnd,
  onItemHoverStart,
  onItemHoverMove,
  onItemHoverEnd,
  onContextMenuOpen,
}: DraggableItemProps) {
  // Use both draggable (for picking up) and droppable (for receiving)
  const {
    attributes,
    listeners,
    setNodeRef: setDraggableRef,
    isDragging,
  } = useDraggable({
    id: `inventory-${index}`,
    data: { item, index },
    disabled: !item, // Can't drag empty slots
  });

  const { setNodeRef: setDroppableRef, isOver } = useDroppable({
    id: `inventory-drop-${index}`,
    data: { index },
  });

  // Combine refs for both draggable and droppable on same element
  // eslint-disable-next-line no-undef
  const setNodeRef = (node: HTMLButtonElement | null) => {
    setDraggableRef(node);
    setDroppableRef(node);
  };

  // Slots stay fixed - no transform! Only the DragOverlay moves.
  const isEmpty = !item;

  // OSRS-style targeting mode checks
  const isTargetingActive = targetingState?.active ?? false;

  // Check if THIS slot is the source item (gets white border in OSRS)
  const isSourceItem =
    isTargetingActive && targetingState?.sourceItem?.slot === index;

  // Check if this item is a valid target during targeting mode
  const isValidTarget =
    isTargetingActive &&
    item &&
    !isSourceItem && // Source item is not a valid target
    (targetingState?.validTargetIds.has(item.itemId) ?? false);

  // BANK NOTE SYSTEM: Check if item is a bank note
  // Used for visual styling (parchment background) and context menu filtering
  // Memoized to avoid re-computation on every render
  const itemData = useMemo(() => {
    return item ? getItem(item.itemId) : null;
  }, [item?.itemId]);

  const isItemNoted = useMemo(() => {
    return isNotedItem(itemData);
  }, [itemData]);

  // Get icon for item
  const getItemIcon = (itemId: string) => {
    if (
      itemId.includes("sword") ||
      itemId.includes("dagger") ||
      itemId.includes("scimitar")
    )
      return "⚔️";
    if (itemId.includes("shield") || itemId.includes("defender")) return "🛡️";
    if (
      itemId.includes("helmet") ||
      itemId.includes("helm") ||
      itemId.includes("hat")
    )
      return "⛑️";
    if (itemId.includes("boots") || itemId.includes("boot")) return "👢";
    if (itemId.includes("glove") || itemId.includes("gauntlet")) return "🧤";
    if (itemId.includes("cape") || itemId.includes("cloak")) return "🧥";
    if (itemId.includes("amulet") || itemId.includes("necklace")) return "📿";
    if (itemId.includes("ring")) return "💍";
    if (itemId.includes("arrow") || itemId.includes("bolt")) return "🏹";
    if (
      itemId.includes("fish") ||
      itemId.includes("lobster") ||
      itemId.includes("shark")
    )
      return "🐟";
    if (itemId.includes("log") || itemId.includes("wood")) return "🪵";
    if (itemId.includes("ore") || itemId.includes("bar")) return "⛏️";
    if (itemId.includes("coin")) return "💰";
    if (itemId.includes("potion") || itemId.includes("vial")) return "🧪";
    if (
      itemId.includes("food") ||
      itemId.includes("bread") ||
      itemId.includes("meat")
    )
      return "🍖";
    if (itemId.includes("axe")) return "🪓";
    if (itemId.includes("pickaxe")) return "⛏️";
    return itemId.substring(0, 2).toUpperCase();
  };

  return (
    <button
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className="relative border rounded-sm transition-all duration-100 group aspect-square"
      onClick={(e) => {
        // Handle targeting mode clicks (Use X on Y)
        if (isTargetingActive) {
          e.preventDefault();
          e.stopPropagation();
          if (isValidTarget && item && onTargetClick) {
            console.log("[InventorySlot] 🎯 Target clicked:", {
              itemId: item.itemId,
              slot: index,
            });
            onTargetClick(item, index);
          } else if (item && !isValidTarget && onInvalidTargetClick) {
            // OSRS: Clicking an invalid item shows "Nothing interesting happens."
            // (Empty slots don't trigger this - only actual items)
            console.log("[InventorySlot] ❌ Invalid target clicked:", {
              itemId: item.itemId,
              slot: index,
            });
            onInvalidTargetClick();
          }
          // Clicking empty slot does nothing (OSRS behavior)
          return;
        }

        // Shift-click to drop instantly (OSRS-style)
        if (e.shiftKey && item && onShiftClick) {
          e.preventDefault();
          e.stopPropagation();
          onShiftClick(item, index);
          return;
        }

        // Left-click: execute primary action (OSRS-style)
        // Uses manifest-first approach with heuristic fallback
        // Uses memoized itemData and isItemNoted for efficiency
        if (item && onPrimaryAction) {
          e.preventDefault();
          e.stopPropagation();

          const actionType = getPrimaryAction(itemData, isItemNoted);
          onPrimaryAction(item, index, actionType);
        }
      }}
      onMouseEnter={(e) => {
        // OSRS-style: show "Use X → Y" tooltip when hovering valid target
        if (isValidTarget && item && onTargetHover) {
          onTargetHover(item, { x: e.clientX, y: e.clientY });
        } else if (!isTargetingActive && item && onItemHoverStart) {
          // RS3-style: show item stats tooltip when not in targeting mode
          onItemHoverStart(item, { x: e.clientX, y: e.clientY });
        }
      }}
      onMouseLeave={() => {
        if (onTargetHoverEnd) {
          onTargetHoverEnd();
        }
        if (onItemHoverEnd) {
          onItemHoverEnd();
        }
      }}
      onMouseMove={(e) => {
        // Update tooltip position as mouse moves
        if (isValidTarget && item && onTargetHover) {
          onTargetHover(item, { x: e.clientX, y: e.clientY });
        } else if (!isTargetingActive && item && onItemHoverMove) {
          onItemHoverMove({ x: e.clientX, y: e.clientY });
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();

        // Hide hover tooltip and mark context menu as open
        if (onItemHoverEnd) {
          onItemHoverEnd();
        }
        if (onContextMenuOpen) {
          onContextMenuOpen();
        }

        if (!item) return;

        // Use memoized itemData and isItemNoted for efficiency
        const itemName = itemData?.name || item.itemId;
        const isNoted = isItemNoted;

        // Build menu items - OSRS-accurate: use inventoryActions from manifest if available
        const menuItems: Array<{
          id: string;
          label: string;
          styledLabel: Array<{ text: string; color?: string }>;
          enabled: boolean;
        }> = [];

        // OSRS-accurate: Check manifest's inventoryActions first
        if (
          itemData?.inventoryActions &&
          itemData.inventoryActions.length > 0 &&
          !isNoted
        ) {
          // Use explicit actions from manifest
          for (const action of itemData.inventoryActions) {
            const actionLower = action.toLowerCase();
            menuItems.push({
              id: actionLower,
              label: `${action} ${itemName}`,
              styledLabel: [
                { text: `${action} ` },
                { text: itemName, color: CONTEXT_MENU_COLORS.ITEM },
              ],
              enabled: true,
            });
          }
        } else if (!isNoted) {
          // Fallback to heuristic detection for items without inventoryActions
          if (isFood(itemData)) {
            menuItems.push({
              id: "eat",
              label: `Eat ${itemName}`,
              styledLabel: [
                { text: "Eat " },
                { text: itemName, color: CONTEXT_MENU_COLORS.ITEM },
              ],
              enabled: true,
            });
          } else if (isPotion(itemData)) {
            menuItems.push({
              id: "drink",
              label: `Drink ${itemName}`,
              styledLabel: [
                { text: "Drink " },
                { text: itemName, color: CONTEXT_MENU_COLORS.ITEM },
              ],
              enabled: true,
            });
          } else if (isBone(itemData)) {
            menuItems.push({
              id: "bury",
              label: `Bury ${itemName}`,
              styledLabel: [
                { text: "Bury " },
                { text: itemName, color: CONTEXT_MENU_COLORS.ITEM },
              ],
              enabled: true,
            });
          } else if (usesWield(itemData)) {
            menuItems.push({
              id: "wield",
              label: `Wield ${itemName}`,
              styledLabel: [
                { text: "Wield " },
                { text: itemName, color: CONTEXT_MENU_COLORS.ITEM },
              ],
              enabled: true,
            });
          } else if (usesWear(itemData)) {
            menuItems.push({
              id: "wear",
              label: `Wear ${itemName}`,
              styledLabel: [
                { text: "Wear " },
                { text: itemName, color: CONTEXT_MENU_COLORS.ITEM },
              ],
              enabled: true,
            });
          }

          // Fallback adds Use/Drop/Examine if not in manifest
          menuItems.push({
            id: "use",
            label: `Use ${itemName}`,
            styledLabel: [
              { text: "Use " },
              { text: itemName, color: CONTEXT_MENU_COLORS.ITEM },
            ],
            enabled: true,
          });
          menuItems.push({
            id: "drop",
            label: `Drop ${itemName}`,
            styledLabel: [
              { text: "Drop " },
              { text: itemName, color: CONTEXT_MENU_COLORS.ITEM },
            ],
            enabled: true,
          });
          menuItems.push({
            id: "examine",
            label: `Examine ${itemName}`,
            styledLabel: [
              { text: "Examine " },
              { text: itemName, color: CONTEXT_MENU_COLORS.ITEM },
            ],
            enabled: true,
          });
        } else {
          // Noted items: Use/Drop/Examine only
          menuItems.push({
            id: "use",
            label: `Use ${itemName}`,
            styledLabel: [
              { text: "Use " },
              { text: itemName, color: CONTEXT_MENU_COLORS.ITEM },
            ],
            enabled: true,
          });
          menuItems.push({
            id: "drop",
            label: `Drop ${itemName}`,
            styledLabel: [
              { text: "Drop " },
              { text: itemName, color: CONTEXT_MENU_COLORS.ITEM },
            ],
            enabled: true,
          });
          menuItems.push({
            id: "examine",
            label: `Examine ${itemName}`,
            styledLabel: [
              { text: "Examine " },
              { text: itemName, color: CONTEXT_MENU_COLORS.ITEM },
            ],
            enabled: true,
          });
        }

        // OSRS-style: Cancel is always the last option
        menuItems.push({
          id: "cancel",
          label: "Cancel",
          styledLabel: [{ text: "Cancel" }],
          enabled: true,
        });

        // Dispatch context menu event
        const evt = new CustomEvent("contextmenu", {
          detail: {
            target: {
              id: `inventory_slot_${index}`,
              type: "inventory",
              name: itemName,
            },
            mousePosition: { x: e.clientX, y: e.clientY },
            items: menuItems,
          },
        });
        window.dispatchEvent(evt);
      }}
      style={{
        opacity: isDragging ? 0.3 : 1,
        // OSRS-style targeting:
        // - Source item: WHITE border (the item being used)
        // - Valid targets: normal appearance, cursor indicates validity
        // - Invalid targets: normal appearance, cursor shows not-allowed
        borderColor: isSourceItem
          ? "rgba(255, 255, 255, 0.95)" // OSRS: White border on source item
          : isOver
            ? "rgba(180, 160, 100, 0.9)" // Gold highlight when dragging over
            : isEmpty
              ? "rgba(50, 45, 40, 0.6)"
              : isItemNoted
                ? "rgba(180, 160, 120, 0.7)" // Tan border for notes
                : "rgba(70, 60, 50, 0.7)",
        borderWidth: isSourceItem ? "2px" : "1px",
        borderStyle: "solid",
        background: isOver
          ? "rgba(180, 160, 100, 0.25)" // Gold tint when dragging over
          : isEmpty
            ? "rgba(25, 22, 20, 0.85)" // Very dark for empty
            : isItemNoted
              ? "linear-gradient(135deg, rgba(245, 235, 210, 0.95) 0%, rgba(225, 210, 175, 0.95) 100%)" // Parchment/paper for notes
              : "linear-gradient(180deg, rgba(55, 48, 42, 0.95) 0%, rgba(40, 35, 30, 0.95) 100%)", // Subtle gradient for items
        boxShadow: isSourceItem
          ? "0 0 8px rgba(255, 255, 255, 0.6)" // OSRS: White glow on source item
          : isOver
            ? "inset 0 0 8px rgba(180, 160, 100, 0.4), 0 0 4px rgba(180, 160, 100, 0.3)"
            : isEmpty
              ? "inset 0 1px 2px rgba(0, 0, 0, 0.4)"
              : isItemNoted
                ? "inset 0 1px 0 rgba(255, 255, 255, 0.5), inset 0 -1px 0 rgba(0, 0, 0, 0.1), 1px 1px 2px rgba(0, 0, 0, 0.2)" // Paper shadow
                : "inset 0 1px 0 rgba(80, 70, 55, 0.3), inset 0 -1px 0 rgba(0, 0, 0, 0.2)",
        // OSRS-style cursor changes during targeting mode
        cursor: isTargetingActive
          ? isSourceItem
            ? "default" // Source item - no special cursor
            : isValidTarget
              ? "cell" // Valid target - crosshair-like cursor
              : "not-allowed" // Invalid target - red circle with line
          : isEmpty
            ? "default"
            : isDragging
              ? "grabbing"
              : "grab",
      }}
    >
      {/* Item Icon - Centered */}
      {/* BANK NOTE SYSTEM: Darker icon for noted items (light background) */}
      {!isEmpty && (
        <div
          className="flex items-center justify-center h-full transition-transform duration-150 group-hover:scale-105 text-sm md:text-base"
          style={{
            color: isItemNoted
              ? "rgba(80, 60, 40, 0.95)" // Dark brown for notes (on parchment)
              : "rgba(220, 200, 160, 0.95)", // Light gold for normal items
            filter: isItemNoted
              ? "drop-shadow(0 1px 1px rgba(255, 255, 255, 0.3))"
              : "drop-shadow(0 1px 1px rgba(0, 0, 0, 0.5))",
          }}
        >
          {getItemIcon(item.itemId)}
        </div>
      )}

      {/* Quantity Badge - RS3 style: top-left, yellow for stacks */}
      {/* BANK NOTE SYSTEM: Darker text with light shadow for noted items */}
      {item &&
        item.quantity > 1 &&
        (() => {
          const { text, color } = formatQuantity(item.quantity);
          return (
            <div
              className="absolute top-0 left-0.5 font-bold leading-none"
              style={{
                color: isItemNoted ? "#4a3520" : color, // Dark brown for notes
                fontSize: "clamp(0.5rem, 1.2vw, 0.625rem)",
                textShadow: isItemNoted
                  ? "0 0 2px rgba(255, 255, 255, 0.8), 1px 1px 1px rgba(255, 255, 255, 0.5)"
                  : "1px 1px 1px rgba(0, 0, 0, 0.9), -1px -1px 1px rgba(0, 0, 0, 0.5)",
              }}
            >
              {text}
            </div>
          );
        })()}

      {/* Subtle hover highlight */}
      {!isEmpty && (
        <div
          className="absolute inset-0 rounded-sm opacity-0 group-hover:opacity-100 transition-opacity duration-150 pointer-events-none"
          style={{
            background:
              "linear-gradient(180deg, rgba(180, 160, 120, 0.1) 0%, transparent 50%)",
          }}
        />
      )}
    </button>
  );
}

/**
 * Pending move operation for rollback tracking
 */
interface PendingMove {
  fromSlot: number;
  toSlot: number;
  timestamp: number;
  preMoveSlotsSnapshot: (InventorySlotViewItem | null)[];
}

/**
 * Targeting mode state for "Use X on Y" interactions (firemaking, cooking)
 * OSRS-style: source item gets white border, cursor changes for valid/invalid targets
 */
interface TargetingState {
  active: boolean;
  sourceItem: { id: string; slot: number; name?: string } | null;
  validTargetIds: Set<string>;
  actionType: "firemaking" | "cooking" | "none";
}

/**
 * Hover state for "Use X → Y" tooltip (OSRS-style)
 */
interface TargetHoverState {
  targetName: string;
  position: { x: number; y: number };
}

/**
 * Hover state for RS3-style item tooltip
 */
interface ItemHoverState {
  item: InventorySlotViewItem;
  position: { x: number; y: number };
}

/**
 * Render item hover tooltip content
 * Extracted from IIFE for better readability and testability
 */
function renderItemHoverTooltip(itemHover: ItemHoverState): React.ReactNode {
  const hoveredItemData = getItem(itemHover.item.itemId);
  const itemName = hoveredItemData?.name || itemHover.item.itemId;
  const bonuses = hoveredItemData?.bonuses;
  const hasBonuses =
    bonuses &&
    ((bonuses.attack !== undefined && bonuses.attack !== 0) ||
      (bonuses.defense !== undefined && bonuses.defense !== 0) ||
      (bonuses.strength !== undefined && bonuses.strength !== 0));

  return createPortal(
    <div
      className="pointer-events-none"
      style={{
        position: "fixed",
        left: itemHover.position.x + 16,
        top: itemHover.position.y + 16,
        zIndex: 99999,
        background:
          "linear-gradient(135deg, rgba(20, 20, 30, 0.98) 0%, rgba(30, 25, 40, 0.95) 100%)",
        border: "2px solid rgba(242, 208, 138, 0.5)",
        borderRadius: "4px",
        padding: "8px 12px",
        boxShadow: "0 4px 12px rgba(0, 0, 0, 0.8)",
        minWidth: "120px",
        maxWidth: "220px",
      }}
    >
      {/* Item name */}
      <div
        style={{
          color: "#fbbf24",
          fontWeight: "bold",
          marginBottom: hasBonuses ? "6px" : "0",
          fontSize: "13px",
        }}
      >
        {itemName}
        {itemHover.item.quantity > 1 && (
          <span
            style={{
              color: "rgba(242, 208, 138, 0.7)",
              fontWeight: "normal",
            }}
          >
            {" "}
            x{itemHover.item.quantity.toLocaleString()}
          </span>
        )}
      </div>

      {/* Bonuses (for equipment) */}
      {hasBonuses && (
        <div style={{ fontSize: "11px" }}>
          {bonuses.attack !== undefined && bonuses.attack !== 0 && (
            <div style={{ color: "rgba(242, 208, 138, 0.8)" }}>
              ⚔️ Attack:{" "}
              <span style={{ color: "#22c55e" }}>+{bonuses.attack}</span>
            </div>
          )}
          {bonuses.defense !== undefined && bonuses.defense !== 0 && (
            <div style={{ color: "rgba(242, 208, 138, 0.8)" }}>
              🛡️ Defense:{" "}
              <span style={{ color: "#22c55e" }}>+{bonuses.defense}</span>
            </div>
          )}
          {bonuses.strength !== undefined && bonuses.strength !== 0 && (
            <div style={{ color: "rgba(242, 208, 138, 0.8)" }}>
              💪 Strength:{" "}
              <span style={{ color: "#22c55e" }}>+{bonuses.strength}</span>
            </div>
          )}
        </div>
      )}
    </div>,
    document.body,
  );
}

const initialTargetingState: TargetingState = {
  active: false,
  sourceItem: null,
  validTargetIds: new Set(),
  actionType: "none",
};

export function InventoryPanel({
  items,
  coins,
  world,
  onItemMove,
  onItemUse: _onItemUse,
  onItemEquip: _onItemEquip,
}: InventoryPanelProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dragSlotSize, setDragSlotSize] = useState<number | null>(null);
  const [slotItems, setSlotItems] = useState<(InventorySlotViewItem | null)[]>(
    [],
  );

  // Targeting mode state for "Use X on Y" interactions
  const [targetingState, setTargetingState] = useState<TargetingState>(
    initialTargetingState,
  );

  // OSRS-style hover tooltip state for "Use X → Y"
  const [targetHover, setTargetHover] = useState<TargetHoverState | null>(null);

  // RS3-style hover tooltip state for item stats
  const [itemHover, setItemHover] = useState<ItemHoverState | null>(null);

  // Track if context menu is open (suppress hover tooltips while open)
  const [isContextMenuOpen, setIsContextMenuOpen] = useState(false);

  // Track pending move for rollback detection
  // If server update arrives and doesn't match our optimistic state, we know it was rejected
  const pendingMoveRef = useRef<PendingMove | null>(null);

  // Track if we should skip the next props update (to avoid flickering during optimistic update)
  const skipNextPropsUpdateRef = useRef(false);

  // Ref to access current slotItems in effects without causing re-renders
  // This prevents infinite loops when useEffect both reads and writes slotItems
  const slotItemsRef = useRef<(InventorySlotViewItem | null)[]>([]);
  slotItemsRef.current = slotItems;

  /**
   * Configure drag sensors for both desktop and mobile:
   * - MouseSensor: 5px movement to start drag (instant feel for mouse users)
   * - TouchSensor: 250ms hold to start drag (prevents accidental drags while scrolling)
   * - KeyboardSensor: Accessibility support (Space to pick up, arrows to move, Space to drop)
   */
  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: {
        distance: 5, // 5px movement required to start drag
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 250, // 250ms hold before drag starts
        tolerance: 5, // Allow 5px movement during the delay (for shaky fingers)
      },
    }),
    useSensor(KeyboardSensor),
  );

  useEffect(() => {
    const onCtxSelect = (evt: Event) => {
      const ce = evt as CustomEvent<{
        actionId: string;
        targetId: string;
        position?: { x: number; y: number };
      }>;
      const target = ce.detail?.targetId || "";
      if (!target.startsWith("inventory_slot_")) return;
      const slotIndex = parseInt(target.replace("inventory_slot_", ""), 10);
      if (Number.isNaN(slotIndex)) return;
      const it = slotItems[slotIndex];
      if (!it || !world) return;

      // Dispatch action through centralized handler
      dispatchInventoryAction(ce.detail.actionId, {
        world,
        itemId: it.itemId,
        slot: slotIndex,
        quantity: it.quantity || 1,
      });
    };
    window.addEventListener("contextmenu:select", onCtxSelect as EventListener);
    return () =>
      window.removeEventListener(
        "contextmenu:select",
        onCtxSelect as EventListener,
      );
  }, [slotItems, world]);

  // Listen for context menu close to re-enable hover tooltips
  useEffect(() => {
    const handleContextMenuClose = () => {
      setIsContextMenuOpen(false);
    };

    window.addEventListener("contextmenu:close", handleContextMenuClose);
    window.addEventListener("contextmenu:select", handleContextMenuClose);

    return () => {
      window.removeEventListener("contextmenu:close", handleContextMenuClose);
      window.removeEventListener("contextmenu:select", handleContextMenuClose);
    };
  }, []);

  // Listen for targeting mode events (OSRS-style "Use X on Y")
  useEffect(() => {
    if (!world) return;

    const onTargetingStart = (data: {
      sourceItem: { id: string; slot: number; name?: string };
      validTargetTypes: string[];
      validTargetIds: string[];
      actionType: "firemaking" | "cooking" | "none";
    }) => {
      console.log("[InventoryPanel] 🎯 TARGETING_START received:", {
        sourceItem: data.sourceItem,
        validTargetTypes: data.validTargetTypes,
        validTargetIds: data.validTargetIds,
        actionType: data.actionType,
      });
      const validIds = new Set(data.validTargetIds);
      console.log(
        "[InventoryPanel] 🎯 Valid target IDs:",
        Array.from(validIds),
      );
      setTargetingState({
        active: true,
        sourceItem: data.sourceItem,
        validTargetIds: validIds,
        actionType: data.actionType,
      });
    };

    const onTargetingComplete = () => {
      console.log(
        "[InventoryPanel] ✅ TARGETING_COMPLETE - exiting targeting mode",
      );
      setTargetingState(initialTargetingState);
      setTargetHover(null); // Clear tooltip
    };

    const onTargetingCancel = () => {
      console.log(
        "[InventoryPanel] ❌ TARGETING_CANCEL - exiting targeting mode",
      );
      setTargetingState(initialTargetingState);
      setTargetHover(null); // Clear tooltip
    };

    // Escape key to cancel targeting mode
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && targetingState.active) {
        console.log("[InventoryPanel] ⎋ Escape pressed - cancelling targeting");
        const localPlayer = world.getPlayer();
        if (localPlayer) {
          world.emit(EventType.TARGETING_CANCEL, { playerId: localPlayer.id });
        }
        setTargetingState(initialTargetingState);
      }
    };

    world.on(
      EventType.TARGETING_START,
      onTargetingStart as (...args: unknown[]) => void,
    );
    world.on(
      EventType.TARGETING_COMPLETE,
      onTargetingComplete as (...args: unknown[]) => void,
    );
    world.on(
      EventType.TARGETING_CANCEL,
      onTargetingCancel as (...args: unknown[]) => void,
    );
    window.addEventListener("keydown", onKeyDown);

    return () => {
      world.off(
        EventType.TARGETING_START,
        onTargetingStart as (...args: unknown[]) => void,
      );
      world.off(
        EventType.TARGETING_COMPLETE,
        onTargetingComplete as (...args: unknown[]) => void,
      );
      world.off(
        EventType.TARGETING_CANCEL,
        onTargetingCancel as (...args: unknown[]) => void,
      );
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [world, targetingState.active]);

  useEffect(() => {
    // If we have a pending move and server sent an update, check if move was accepted
    const pending = pendingMoveRef.current;

    // Skip update if we just did an optimistic update (prevents flicker)
    if (skipNextPropsUpdateRef.current) {
      skipNextPropsUpdateRef.current = false;

      // But still clear pending move after a timeout if server hasn't responded
      // This handles cases where server silently accepts (no explicit confirmation)
      if (pending) {
        const timeSinceMove = Date.now() - pending.timestamp;
        if (timeSinceMove > 500) {
          // Server update arrived, assume move was accepted
          pendingMoveRef.current = null;
        }
      }
      return;
    }

    const newSlots: (InventorySlotViewItem | null)[] =
      Array(MAX_SLOTS).fill(null);
    items.forEach((item) => {
      const s = (item as { slot?: number }).slot;
      if (typeof s === "number" && s >= 0 && s < MAX_SLOTS) {
        newSlots[s] = item;
      }
    });

    // If we have a pending move, check if server state matches our optimistic state
    if (pending) {
      const fromItem = newSlots[pending.fromSlot];
      const toItem = newSlots[pending.toSlot];
      // Use ref to access current slotItems without adding to dependencies (avoids infinite loop)
      const currentSlots = slotItemsRef.current;
      const expectedFromItem = currentSlots[pending.toSlot]; // What we moved FROM the toSlot
      const expectedToItem = currentSlots[pending.fromSlot]; // What we moved TO the fromSlot

      // Check if the swap was reflected in server state
      const fromMatches =
        (fromItem === null && expectedFromItem === null) ||
        fromItem?.itemId === expectedFromItem?.itemId;
      const toMatches =
        (toItem === null && expectedToItem === null) ||
        toItem?.itemId === expectedToItem?.itemId;

      if (!fromMatches || !toMatches) {
        // Server state doesn't match - move was rejected, server's state takes precedence
        // The newSlots from server IS the rollback
        if (world?.emit) {
          world.emit(EventType.UI_MESSAGE, {
            message: "Move rejected by server",
            type: "error",
          });
        }
      }

      pendingMoveRef.current = null;
    }

    setSlotItems(newSlots);
  }, [items, world]);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
    // Capture the original slot size so DragOverlay matches exactly
    if (event.active.rect.current.initial) {
      setDragSlotSize(event.active.rect.current.initial.width);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    setDragSlotSize(null);

    if (!over) return;

    // Draggable IDs: "inventory-{index}"
    // Droppable IDs: "inventory-drop-{index}"
    const fromIndex = parseInt((active.id as string).replace("inventory-", ""));
    const overId = over.id as string;
    const toIndex = overId.startsWith("inventory-drop-")
      ? parseInt(overId.replace("inventory-drop-", ""))
      : parseInt(overId.replace("inventory-", ""));

    // Don't swap with self
    if (fromIndex === toIndex) return;

    // Store pre-move state for potential rollback
    pendingMoveRef.current = {
      fromSlot: fromIndex,
      toSlot: toIndex,
      timestamp: Date.now(),
      preMoveSlotsSnapshot: [...slotItems],
    };

    // OSRS-style SWAP: exchange two slots directly (don't shift/insert)
    // Create deep copies of items to avoid mutating props and update .slot property
    const newSlots = [...slotItems];
    const fromItem = newSlots[fromIndex];
    const toItem = newSlots[toIndex];

    // Update .slot property on copies to match new positions
    // This ensures consistency when useEffect rebuilds from items prop
    if (fromItem) {
      newSlots[toIndex] = { ...fromItem, slot: toIndex };
    } else {
      newSlots[toIndex] = null;
    }
    if (toItem) {
      newSlots[fromIndex] = { ...toItem, slot: fromIndex };
    } else {
      newSlots[fromIndex] = null;
    }

    // Mark that we just did optimistic update (skip next props sync to prevent flicker)
    skipNextPropsUpdateRef.current = true;
    setSlotItems(newSlots);

    if (onItemMove) {
      onItemMove(fromIndex, toIndex);
    }

    // Clear pending move after timeout if server doesn't respond
    // This handles the case where move is accepted but server doesn't send explicit update
    // Capture timestamp in closure to handle multiple rapid moves correctly
    const moveTimestamp = pendingMoveRef.current.timestamp;
    setTimeout(() => {
      // Only clear if this specific move is still pending (not a newer move)
      if (pendingMoveRef.current?.timestamp === moveTimestamp) {
        pendingMoveRef.current = null;
      }
    }, 2000);
  };

  // Memoized handlers to prevent unnecessary re-renders of child components
  const handleTargetClick = useCallback(
    (clickedItem: InventorySlotViewItem, slotIndex: number) => {
      // Handle targeting mode click - emit TARGETING_SELECT event
      if (targetingState.active && targetingState.sourceItem) {
        const localPlayer = world?.getPlayer();
        if (localPlayer) {
          console.log("[InventoryPanel] 🎯 Emitting TARGETING_SELECT:", {
            sourceItem: targetingState.sourceItem,
            targetItem: clickedItem.itemId,
            targetSlot: slotIndex,
          });
          // Clear hover tooltip before action
          setTargetHover(null);
          world?.emit(EventType.TARGETING_SELECT, {
            playerId: localPlayer.id,
            sourceItemId: targetingState.sourceItem.id,
            sourceSlot: targetingState.sourceItem.slot,
            targetId: clickedItem.itemId,
            targetType: "inventory_item",
            targetSlot: slotIndex,
          });
        }
      }
    },
    [world, targetingState.active, targetingState.sourceItem],
  );

  const handleTargetHover = useCallback(
    (
      hoveredItem: InventorySlotViewItem,
      position: { x: number; y: number },
    ) => {
      // OSRS-style "Use X → Y" tooltip
      setTargetHover({
        targetName: hoveredItem.itemId,
        position,
      });
    },
    [],
  );

  const handleTargetHoverEnd = useCallback(() => {
    setTargetHover(null);
  }, []);

  // RS3-style item hover handlers for stats tooltip
  const handleItemHoverStart = useCallback(
    (item: InventorySlotViewItem, position: { x: number; y: number }) => {
      // Don't show hover tooltip if context menu is open
      if (isContextMenuOpen) return;
      setItemHover({ item, position });
    },
    [isContextMenuOpen],
  );

  const handleItemHoverMove = useCallback(
    (position: { x: number; y: number }) => {
      // Don't update hover tooltip if context menu is open
      if (isContextMenuOpen) return;
      setItemHover((prev) => (prev ? { ...prev, position } : null));
    },
    [isContextMenuOpen],
  );

  const handleItemHoverEnd = useCallback(() => {
    setItemHover(null);
  }, []);

  const handleContextMenuOpen = useCallback(() => {
    setIsContextMenuOpen(true);
  }, []);

  const handleInvalidTargetClick = useCallback(() => {
    // OSRS: "Nothing interesting happens." when using item on invalid target
    const message = "Nothing interesting happens.";

    // Show in chat (OSRS-style game message)
    if (world?.chat?.add) {
      world.chat.add({
        id: uuid(),
        from: "",
        body: message,
        createdAt: new Date().toISOString(),
        timestamp: Date.now(),
      });
    }

    // Cancel targeting mode
    setTargetingState(initialTargetingState);
    setTargetHover(null);
  }, [world]);

  const handlePrimaryAction = useCallback(
    (
      clickedItem: InventorySlotViewItem,
      slotIndex: number,
      actionType: PrimaryActionType,
    ) => {
      if (!world) return;

      // Dispatch through centralized handler
      dispatchInventoryAction(actionType, {
        world,
        itemId: clickedItem.itemId,
        slot: slotIndex,
        quantity: clickedItem.quantity || 1,
      });
    },
    [world],
  );

  const handleShiftClick = useCallback(
    (clickedItem: InventorySlotViewItem, slotIndex: number) => {
      if (world?.network?.dropItem) {
        world.network.dropItem(
          clickedItem.itemId,
          slotIndex,
          clickedItem.quantity || 1,
        );
      } else if (world?.network?.send) {
        world.network.send("dropItem", {
          itemId: clickedItem.itemId,
          slot: slotIndex,
          quantity: clickedItem.quantity || 1,
        });
      }
    },
    [world],
  );

  const activeItem = activeId
    ? slotItems[parseInt(activeId.split("-")[1])]
    : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex flex-col h-full overflow-hidden gap-1">
        {/* OSRS-style "Use X → Y" tooltip - rendered via portal to avoid transform issues */}
        {targetingState.active &&
          targetHover &&
          targetingState.sourceItem &&
          createPortal(
            <div
              className="pointer-events-none px-2 py-1 text-sm font-medium whitespace-nowrap"
              style={{
                position: "fixed",
                left: targetHover.position.x + 16,
                top: targetHover.position.y + 16,
                zIndex: 99999,
                background: "rgba(0, 0, 0, 0.85)",
                border: "1px solid rgba(180, 160, 100, 0.8)",
                borderRadius: "2px",
                color: "rgba(255, 200, 100, 0.95)",
                textShadow: "1px 1px 0 #000",
                boxShadow: "2px 2px 4px rgba(0, 0, 0, 0.5)",
              }}
            >
              Use{" "}
              {targetingState.sourceItem.name || targetingState.sourceItem.id} →{" "}
              {targetHover.targetName}
            </div>,
            document.body,
          )}

        {/* RS3-style item hover tooltip - rendered via portal */}
        {!targetingState.active &&
          itemHover &&
          renderItemHoverTooltip(itemHover)}

        {/* Inventory Grid - 7 columns × 4 rows with square slots */}
        <div
          className="flex-1 border rounded p-1 overflow-hidden"
          style={{
            background:
              "linear-gradient(180deg, rgba(35, 30, 28, 0.98) 0%, rgba(25, 22, 20, 0.98) 100%)",
            borderColor: "rgba(80, 70, 55, 0.6)",
            boxShadow:
              "inset 0 2px 8px rgba(0, 0, 0, 0.5), 0 1px 2px rgba(0, 0, 0, 0.3)",
          }}
        >
          <div
            className="grid grid-cols-7 gap-[3px] h-full"
            style={{ gridTemplateRows: "repeat(4, 1fr)" }}
          >
            {slotItems.map((item, index) => (
              <DraggableInventorySlot
                key={index}
                item={item}
                index={index}
                targetingState={targetingState}
                onTargetClick={handleTargetClick}
                onTargetHover={handleTargetHover}
                onTargetHoverEnd={handleTargetHoverEnd}
                onInvalidTargetClick={handleInvalidTargetClick}
                onPrimaryAction={handlePrimaryAction}
                onShiftClick={handleShiftClick}
                onItemHoverStart={handleItemHoverStart}
                onItemHoverMove={handleItemHoverMove}
                onItemHoverEnd={handleItemHoverEnd}
                onContextMenuOpen={handleContextMenuOpen}
              />
            ))}
          </div>
        </div>

        {/* RS3-style Coins/Money Pouch */}
        <div
          className="border rounded flex items-center justify-between py-1 px-2"
          style={{
            background:
              "linear-gradient(180deg, rgba(45, 40, 35, 0.95) 0%, rgba(30, 25, 22, 0.98) 100%)",
            borderColor: "rgba(120, 100, 60, 0.5)",
            boxShadow:
              "inset 0 1px 0 rgba(150, 130, 80, 0.2), 0 1px 2px rgba(0, 0, 0, 0.3)",
          }}
        >
          <div className="flex items-center gap-1.5">
            <span className="text-base">💰</span>
            <span
              className="font-medium text-xs"
              style={{ color: "rgba(210, 190, 130, 0.9)" }}
            >
              Coins
            </span>
          </div>
          <span
            className="font-bold text-xs"
            style={{
              color: "#fbbf24",
              textShadow: "0 1px 2px rgba(0, 0, 0, 0.8)",
            }}
          >
            {coins.toLocaleString()}
          </span>
        </div>

        <DragOverlay dropAnimation={null} modifiers={[snapCenterToCursor]}>
          {activeItem
            ? (() => {
                // Get icon for drag overlay
                const getOverlayIcon = (itemId: string) => {
                  if (
                    itemId.includes("sword") ||
                    itemId.includes("dagger") ||
                    itemId.includes("scimitar")
                  )
                    return "⚔️";
                  if (itemId.includes("shield") || itemId.includes("defender"))
                    return "🛡️";
                  if (
                    itemId.includes("helmet") ||
                    itemId.includes("helm") ||
                    itemId.includes("hat")
                  )
                    return "⛑️";
                  if (itemId.includes("boots") || itemId.includes("boot"))
                    return "👢";
                  if (
                    itemId.includes("fish") ||
                    itemId.includes("lobster") ||
                    itemId.includes("shark")
                  )
                    return "🐟";
                  if (itemId.includes("log") || itemId.includes("wood"))
                    return "🪵";
                  if (itemId.includes("ore") || itemId.includes("bar"))
                    return "⛏️";
                  if (itemId.includes("coin")) return "💰";
                  if (itemId.includes("potion") || itemId.includes("vial"))
                    return "🧪";
                  if (itemId.includes("axe")) return "🪓";
                  return itemId.substring(0, 2).toUpperCase();
                };
                const qtyDisplay =
                  activeItem.quantity > 1
                    ? formatQuantity(activeItem.quantity)
                    : null;
                return (
                  <div
                    className="border rounded flex items-center justify-center aspect-square relative"
                    style={{
                      width: dragSlotSize ?? 40, // Use captured slot size, fallback to 40px
                      height: dragSlotSize ?? 40,
                      borderColor: "rgba(242, 208, 138, 0.6)",
                      background:
                        "linear-gradient(135deg, rgba(242, 208, 138, 0.2) 0%, rgba(242, 208, 138, 0.1) 100%)",
                      fontSize: dragSlotSize
                        ? `${dragSlotSize * 0.4}px`
                        : "1rem", // Scale icon with slot
                      color: COLORS.ACCENT,
                      boxShadow: "0 4px 12px rgba(0, 0, 0, 0.5)",
                    }}
                  >
                    {getOverlayIcon(activeItem.itemId)}
                    {qtyDisplay && (
                      <div
                        className="absolute bottom-0.5 right-0.5 font-bold rounded px-0.5 py-0.5 leading-none"
                        style={{
                          background: "rgba(0, 0, 0, 0.8)",
                          color: qtyDisplay.color,
                          fontSize: dragSlotSize
                            ? `${dragSlotSize * 0.18}px`
                            : "0.4rem", // Scale with slot
                          textShadow: "1px 1px 1px rgba(0, 0, 0, 0.8)",
                        }}
                      >
                        {qtyDisplay.text}
                      </div>
                    )}
                  </div>
                );
              })()
            : null}
        </DragOverlay>
      </div>
    </DndContext>
  );
}
