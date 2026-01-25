/**
 * Trade Panel
 *
 * Main trading interface showing both players' offers side-by-side.
 * Supports drag-and-drop from inventory to trade offer.
 *
 * Layout:
 * - Left side: Local player's offer
 * - Right side: Partner's offer
 * - Bottom: Accept/Cancel buttons
 *
 * Features:
 * - Drag items from inventory to add to trade
 * - Click items in trade to remove
 * - Both players must accept for trade to complete
 * - Acceptance resets if either offer changes
 */

import { useState, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  DndProvider,
  useDraggable,
  useDroppable,
  ComposableDragOverlay,
  pointerWithin,
  useThemeStore,
  type DragStartEvent,
  type DragEndEvent,
  type Theme,
} from "hs-kit";
import {
  getItem,
  type TradeOfferItem,
  type TradeWindowState,
} from "@hyperscape/shared";
import { getItemIcon } from "../utils/item-display";

// ============================================================================
// Constants
// ============================================================================

const TRADE_GRID_COLS = 4;
const TRADE_GRID_ROWS = 7;
const TRADE_SLOTS = TRADE_GRID_COLS * TRADE_GRID_ROWS; // 28 slots

// ============================================================================
// Types
// ============================================================================

interface TradePanelProps {
  state: TradeWindowState;
  inventory: Array<{ slot: number; itemId: string; quantity: number }>;
  onAddItem: (inventorySlot: number, quantity?: number) => void;
  onRemoveItem: (tradeSlot: number) => void;
  onAccept: () => void;
  onCancel: () => void;
}

interface TradeSlotProps {
  item: TradeOfferItem | null;
  slotIndex: number;
  side: "my" | "their";
  onRemove?: () => void;
  isDragging?: boolean;
  theme: Theme;
}

interface DraggableInventoryItemProps {
  item: { slot: number; itemId: string; quantity: number };
  index: number;
  theme: Theme;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Format quantity for OSRS-style display
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

// ============================================================================
// Sub-Components
// ============================================================================

/**
 * Individual trade slot displaying an item or empty slot
 */
function TradeSlot({
  item,
  slotIndex,
  side,
  onRemove,
  isDragging,
  theme,
}: TradeSlotProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: `trade-${side}-${slotIndex}`,
    disabled: side === "their", // Can't drop into partner's offer
  });

  const itemData = item ? getItem(item.itemId) : null;
  const iconUrl = item ? getItemIcon(item.itemId) : null;
  const quantity = item?.quantity ?? 0;
  const qtyDisplay = quantity > 1 ? formatQuantity(quantity) : null;

  return (
    <div
      ref={setNodeRef}
      className="relative flex items-center justify-center"
      style={{
        width: "36px",
        height: "36px",
        background: isOver
          ? `${theme.colors.state.success}30`
          : theme.colors.background.tertiary,
        border: isOver
          ? `1px solid ${theme.colors.state.success}CC`
          : `1px solid ${theme.colors.border.default}`,
        borderRadius: "4px",
        opacity: isDragging ? 0.5 : 1,
        cursor: item && side === "my" ? "pointer" : "default",
        transition: "background 0.15s, border-color 0.15s",
      }}
      onClick={() => {
        if (item && side === "my" && onRemove) {
          onRemove();
        }
      }}
      title={itemData?.name || ""}
    >
      {iconUrl && (
        <img
          src={iconUrl}
          alt={itemData?.name || "Item"}
          style={{
            width: "32px",
            height: "32px",
            objectFit: "contain",
            imageRendering: "pixelated",
          }}
          draggable={false}
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

/**
 * Draggable inventory item for the trade panel
 */
function DraggableInventoryItem({
  item,
  index: _index,
  theme,
}: DraggableInventoryItemProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `inventory-${item.slot}`,
    data: { type: "inventory", slot: item.slot, itemId: item.itemId },
  });

  const itemData = getItem(item.itemId);
  const iconUrl = getItemIcon(item.itemId);
  const qtyDisplay = item.quantity > 1 ? formatQuantity(item.quantity) : null;

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className="relative flex items-center justify-center"
      style={{
        width: "36px",
        height: "36px",
        background: theme.colors.background.tertiary,
        border: `1px solid ${theme.colors.border.default}`,
        borderRadius: "4px",
        opacity: isDragging ? 0.5 : 1,
        cursor: "grab",
        touchAction: "none",
      }}
      title={itemData?.name || ""}
    >
      {iconUrl && (
        <img
          src={iconUrl}
          alt={itemData?.name || "Item"}
          style={{
            width: "32px",
            height: "32px",
            objectFit: "contain",
            imageRendering: "pixelated",
          }}
          draggable={false}
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

/**
 * Inventory mini-panel for selecting items to trade
 */
function InventoryMiniPanel({
  items,
  offeredSlots,
  theme,
}: {
  items: Array<{ slot: number; itemId: string; quantity: number }>;
  offeredSlots: Set<number>;
  theme: Theme;
}) {
  // Filter out items already offered
  const availableItems = items.filter((item) => !offeredSlots.has(item.slot));

  return (
    <div className="mt-3">
      <h4
        className="text-xs font-bold mb-2"
        style={{ color: theme.colors.text.secondary }}
      >
        Your Inventory (drag to trade)
      </h4>
      <div
        className="grid gap-1 p-2 rounded"
        style={{
          gridTemplateColumns: "repeat(7, 36px)",
          background: theme.colors.background.tertiary,
          border: `1px solid ${theme.colors.border.default}`,
          maxHeight: "120px",
          overflowY: "auto",
        }}
      >
        {availableItems.map((item) => (
          <DraggableInventoryItem
            key={item.slot}
            item={item}
            index={item.slot}
            theme={theme}
          />
        ))}
        {availableItems.length === 0 && (
          <p
            className="col-span-7 text-center text-xs py-2"
            style={{ color: theme.colors.text.muted }}
          >
            No items to trade
          </p>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function TradePanel({
  state,
  inventory,
  onAddItem,
  onRemoveItem,
  onAccept,
  onCancel,
}: TradePanelProps) {
  const theme = useThemeStore((s) => s.theme);
  const [draggedItem, setDraggedItem] = useState<{
    slot: number;
    itemId: string;
  } | null>(null);

  // Get set of inventory slots already offered
  const offeredSlots = useMemo(() => {
    return new Set(state.myOffer.map((item) => item.inventorySlot));
  }, [state.myOffer]);

  // Handle drag start
  const handleDragStart = useCallback((event: DragStartEvent) => {
    const { active } = event;
    // Custom data is in active.data.data (DragItem wraps our data)
    const customData = active.data.data as
      | {
          type: string;
          slot: number;
          itemId: string;
        }
      | undefined;
    if (customData?.type === "inventory") {
      setDraggedItem({ slot: customData.slot, itemId: customData.itemId });
    }
  }, []);

  // Handle drag end
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      setDraggedItem(null);

      if (!over) return;

      // Custom data is in active.data.data (DragItem wraps our data)
      const customData = active.data.data as
        | {
            type: string;
            slot: number;
            itemId: string;
          }
        | undefined;

      // Dropping inventory item onto trade area
      if (customData?.type === "inventory") {
        const overId = over.id as string;
        if (overId.startsWith("trade-my-") || overId === "trade-my-drop-zone") {
          onAddItem(customData.slot);
        }
      }
    },
    [onAddItem],
  );

  if (!state.isOpen || !state.partner) return null;

  // Convert offers to slot-indexed arrays for rendering
  const myOfferBySlot = new Map<number, TradeOfferItem>();
  for (const item of state.myOffer) {
    myOfferBySlot.set(item.tradeSlot, item);
  }

  const theirOfferBySlot = new Map<number, TradeOfferItem>();
  for (const item of state.theirOffer) {
    theirOfferBySlot.set(item.tradeSlot, item);
  }

  // Get dragged item data for overlay
  const _draggedItemData = draggedItem ? getItem(draggedItem.itemId) : null;
  const draggedItemIcon = draggedItem ? getItemIcon(draggedItem.itemId) : null;

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center"
      style={{ background: theme.colors.background.overlay }}
    >
      <DndProvider
        collisionDetection={pointerWithin}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div
          className="rounded-lg shadow-xl"
          style={{
            background: `linear-gradient(135deg, ${theme.colors.background.secondary} 0%, ${theme.colors.background.primary} 100%)`,
            border: `2px solid ${theme.colors.border.decorative}`,
            width: "480px",
          }}
        >
          {/* Header */}
          <div
            className="px-4 py-3 rounded-t-lg flex items-center justify-between"
            style={{
              background: theme.colors.background.tertiary,
              borderBottom: `1px solid ${theme.colors.border.decorative}`,
            }}
          >
            <h2
              className="text-lg font-bold"
              style={{ color: theme.colors.text.accent }}
            >
              Trading with{" "}
              <span style={{ color: theme.colors.text.primary }}>
                {state.partner.name}
              </span>
            </h2>
            <button
              onClick={onCancel}
              className="text-xl font-bold px-2 rounded transition-colors"
              style={{ color: theme.colors.text.muted }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = theme.colors.text.primary;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = theme.colors.text.muted;
              }}
            >
              ×
            </button>
          </div>

          {/* Trade areas */}
          <div className="p-4">
            <div className="flex gap-4">
              {/* My offer */}
              <div className="flex-1">
                <div className="flex items-center justify-between mb-2">
                  <h3
                    className="text-sm font-bold"
                    style={{ color: theme.colors.text.accent }}
                  >
                    Your Offer
                  </h3>
                  {state.myAccepted && (
                    <span
                      className="text-xs px-2 py-0.5 rounded"
                      style={{
                        background: `${theme.colors.state.success}30`,
                        color: theme.colors.state.success,
                        border: `1px solid ${theme.colors.state.success}50`,
                      }}
                    >
                      Accepted
                    </span>
                  )}
                </div>
                <TradeDropZone id="trade-my-drop-zone" theme={theme}>
                  <div
                    className="grid gap-1 p-2 rounded"
                    style={{
                      gridTemplateColumns: `repeat(${TRADE_GRID_COLS}, 36px)`,
                      background: theme.colors.background.tertiary,
                      border: `1px solid ${theme.colors.border.default}`,
                    }}
                  >
                    {Array.from({ length: TRADE_SLOTS }).map((_, i) => (
                      <TradeSlot
                        key={i}
                        item={myOfferBySlot.get(i) || null}
                        slotIndex={i}
                        side="my"
                        onRemove={() => onRemoveItem(i)}
                        theme={theme}
                      />
                    ))}
                  </div>
                </TradeDropZone>
              </div>

              {/* Divider */}
              <div
                className="w-px"
                style={{ background: theme.colors.border.default }}
              />

              {/* Their offer */}
              <div className="flex-1">
                <div className="flex items-center justify-between mb-2">
                  <h3
                    className="text-sm font-bold"
                    style={{ color: theme.colors.text.accent }}
                  >
                    {state.partner.name}'s Offer
                  </h3>
                  {state.theirAccepted && (
                    <span
                      className="text-xs px-2 py-0.5 rounded"
                      style={{
                        background: `${theme.colors.state.success}30`,
                        color: theme.colors.state.success,
                        border: `1px solid ${theme.colors.state.success}50`,
                      }}
                    >
                      Accepted
                    </span>
                  )}
                </div>
                <div
                  className="grid gap-1 p-2 rounded"
                  style={{
                    gridTemplateColumns: `repeat(${TRADE_GRID_COLS}, 36px)`,
                    background: theme.colors.background.tertiary,
                    border: `1px solid ${theme.colors.border.default}`,
                  }}
                >
                  {Array.from({ length: TRADE_SLOTS }).map((_, i) => (
                    <TradeSlot
                      key={i}
                      item={theirOfferBySlot.get(i) || null}
                      slotIndex={i}
                      side="their"
                      theme={theme}
                    />
                  ))}
                </div>
              </div>
            </div>

            {/* Inventory mini-panel */}
            <InventoryMiniPanel
              items={inventory}
              offeredSlots={offeredSlots}
              theme={theme}
            />

            {/* Action buttons */}
            <div className="flex gap-3 mt-4">
              <button
                onClick={onAccept}
                disabled={state.myAccepted}
                className="flex-1 py-2.5 rounded text-sm font-bold transition-all"
                style={{
                  background: state.myAccepted
                    ? theme.colors.background.tertiary
                    : `linear-gradient(135deg, ${theme.colors.state.success}CC 0%, ${theme.colors.state.success}AA 100%)`,
                  color: theme.colors.text.primary,
                  border: state.myAccepted
                    ? `1px solid ${theme.colors.border.default}`
                    : `1px solid ${theme.colors.state.success}`,
                  textShadow: "0 1px 2px rgba(0,0,0,0.5)",
                  opacity: state.myAccepted ? 0.7 : 1,
                  cursor: state.myAccepted ? "default" : "pointer",
                }}
                onMouseEnter={(e) => {
                  if (!state.myAccepted) {
                    e.currentTarget.style.background = `linear-gradient(135deg, ${theme.colors.state.success} 0%, ${theme.colors.state.success}CC 100%)`;
                  }
                }}
                onMouseLeave={(e) => {
                  if (!state.myAccepted) {
                    e.currentTarget.style.background = `linear-gradient(135deg, ${theme.colors.state.success}CC 0%, ${theme.colors.state.success}AA 100%)`;
                  }
                }}
              >
                {state.myAccepted ? "Waiting for partner..." : "Accept Trade"}
              </button>
              <button
                onClick={onCancel}
                className="flex-1 py-2.5 rounded text-sm font-bold transition-all"
                style={{
                  background: `linear-gradient(135deg, ${theme.colors.state.danger}CC 0%, ${theme.colors.state.danger}AA 100%)`,
                  color: theme.colors.text.primary,
                  border: `1px solid ${theme.colors.state.danger}`,
                  textShadow: "0 1px 2px rgba(0,0,0,0.5)",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = `linear-gradient(135deg, ${theme.colors.state.danger} 0%, ${theme.colors.state.danger}CC 100%)`;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = `linear-gradient(135deg, ${theme.colors.state.danger}CC 0%, ${theme.colors.state.danger}AA 100%)`;
                }}
              >
                Cancel
              </button>
            </div>

            {/* Status message */}
            {state.myAccepted && state.theirAccepted && (
              <p
                className="text-center text-sm mt-3"
                style={{ color: theme.colors.state.success }}
              >
                Both players accepted - completing trade...
              </p>
            )}
          </div>

          {/* Drag overlay */}
          <ComposableDragOverlay>
            {draggedItemIcon && (
              <div
                style={{
                  width: "36px",
                  height: "36px",
                  background: theme.colors.background.primary,
                  border: `1px solid ${theme.colors.border.decorative}`,
                  borderRadius: "4px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <img
                  src={draggedItemIcon}
                  alt=""
                  style={{
                    width: "32px",
                    height: "32px",
                    objectFit: "contain",
                    imageRendering: "pixelated",
                  }}
                />
              </div>
            )}
          </ComposableDragOverlay>
        </div>
      </DndProvider>
    </div>,
    document.body,
  );
}

/**
 * Drop zone wrapper for trade area
 */
function TradeDropZone({
  id,
  children,
  theme,
}: {
  id: string;
  children: React.ReactNode;
  theme: Theme;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div
      ref={setNodeRef}
      style={{
        borderRadius: "4px",
        transition: "box-shadow 0.15s",
        boxShadow: isOver ? `0 0 8px ${theme.colors.state.success}80` : "none",
      }}
    >
      {children}
    </div>
  );
}
