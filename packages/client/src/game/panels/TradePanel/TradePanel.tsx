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

/**
 * Format gold value for wealth indicator display (OSRS-style)
 */
function formatGoldValue(value: number): string {
  if (value < 1000) {
    return value.toLocaleString();
  } else if (value < 1000000) {
    const k = Math.floor(value / 1000);
    const remainder = Math.floor((value % 1000) / 100);
    return remainder > 0 ? `${k}.${remainder}K` : `${k}K`;
  } else if (value < 1000000000) {
    const m = Math.floor(value / 1000000);
    const remainder = Math.floor((value % 1000000) / 100000);
    return remainder > 0 ? `${m}.${remainder}M` : `${m}M`;
  } else {
    const b = Math.floor(value / 1000000000);
    return `${b}B`;
  }
}

/**
 * Get color for wealth difference indicator
 * Green = gaining value, Red = losing value, White = neutral
 */
function getWealthDifferenceColor(myValue: number, theirValue: number): string {
  const diff = theirValue - myValue;
  if (diff > 0) return "#22c55e"; // Green - gaining
  if (diff < 0) return "#ef4444"; // Red - losing
  return "#ffffff"; // White - equal
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
  const itemIcon = item ? getItemIcon(item.itemId) : null;
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
      {/* Render emoji icon as text, not as image src */}
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
  const itemIcon = getItemIcon(item.itemId);
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
      {/* Render emoji icon as text, not as image src */}
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

/**
 * Inventory mini-panel for selecting items to trade
 * OSRS style: displayed to the right of trade offers, 4x7 grid matching inventory
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

  // Create a map for quick lookup
  const itemsBySlot = new Map<
    number,
    { slot: number; itemId: string; quantity: number }
  >();
  availableItems.forEach((item) => itemsBySlot.set(item.slot, item));

  return (
    <div className="flex flex-col">
      <h4
        className="text-xs font-bold mb-2"
        style={{ color: theme.colors.text.secondary }}
      >
        Your Inventory
      </h4>
      <div
        className="grid gap-1 p-2 rounded"
        style={{
          // OSRS style: 4 columns x 7 rows = 28 slots
          gridTemplateColumns: `repeat(${TRADE_GRID_COLS}, 36px)`,
          background: theme.colors.background.tertiary,
          border: `1px solid ${theme.colors.border.default}`,
        }}
      >
        {/* Render all 28 slots, showing items in their actual positions */}
        {Array.from({ length: TRADE_SLOTS }).map((_, slotIndex) => {
          const item = itemsBySlot.get(slotIndex);
          if (item) {
            return (
              <DraggableInventoryItem
                key={slotIndex}
                item={item}
                index={item.slot}
                theme={theme}
              />
            );
          }
          // Empty slot
          return (
            <div
              key={slotIndex}
              className="relative flex items-center justify-center"
              style={{
                width: "36px",
                height: "36px",
                background: theme.colors.background.primary,
                border: `1px solid ${theme.colors.border.default}`,
                borderRadius: "4px",
                opacity: 0.5,
              }}
            />
          );
        })}
      </div>
      <p
        className="text-xs mt-2 text-center"
        style={{ color: theme.colors.text.muted }}
      >
        Drag items to trade
      </p>
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
            // OSRS layout: wider to fit inventory on right side
            width: state.screen === "offer" ? "680px" : "480px",
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
              {state.screen === "confirm" ? (
                <>
                  <span style={{ color: theme.colors.state.warning }}>
                    Confirm Trade
                  </span>
                  {" with "}
                  <span style={{ color: theme.colors.text.primary }}>
                    {state.partner.name}
                  </span>
                </>
              ) : (
                <>
                  Trading with{" "}
                  <span style={{ color: theme.colors.text.primary }}>
                    {state.partner.name}
                  </span>
                </>
              )}
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

          {/* Trade areas - OSRS layout: offers on left, inventory on right */}
          <div className="p-4">
            <div className="flex gap-4">
              {/* Left section: Trade offers */}
              <div className="flex-1">
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
                            onRemove={
                              state.screen === "offer"
                                ? () => onRemoveItem(i)
                                : undefined
                            }
                            theme={theme}
                          />
                        ))}
                      </div>
                    </TradeDropZone>
                    {/* Wealth indicator for my offer */}
                    <div
                      className="mt-2 px-2 py-1 rounded text-xs text-center"
                      style={{
                        background: theme.colors.background.tertiary,
                        border: `1px solid ${theme.colors.border.default}`,
                        color: theme.colors.text.secondary,
                      }}
                    >
                      Value:{" "}
                      <span style={{ color: "#ffd700", fontWeight: "bold" }}>
                        {formatGoldValue(state.myOfferValue)} gp
                      </span>
                    </div>
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
                    {/* Wealth indicator for their offer */}
                    <div
                      className="mt-2 px-2 py-1 rounded text-xs text-center"
                      style={{
                        background: theme.colors.background.tertiary,
                        border: `1px solid ${theme.colors.border.default}`,
                        color: theme.colors.text.secondary,
                      }}
                    >
                      Value:{" "}
                      <span style={{ color: "#ffd700", fontWeight: "bold" }}>
                        {formatGoldValue(state.theirOfferValue)} gp
                      </span>
                    </div>
                  </div>
                </div>

                {/* Wealth transfer summary - below offers */}
                {(state.myOfferValue > 0 || state.theirOfferValue > 0) && (
                  <div
                    className="mt-3 px-3 py-2 rounded text-sm text-center"
                    style={{
                      background: theme.colors.background.tertiary,
                      border: `1px solid ${theme.colors.border.decorative}`,
                    }}
                  >
                    <span style={{ color: theme.colors.text.secondary }}>
                      Wealth transfer:{" "}
                    </span>
                    <span
                      style={{
                        color: getWealthDifferenceColor(
                          state.myOfferValue,
                          state.theirOfferValue,
                        ),
                        fontWeight: "bold",
                      }}
                    >
                      {state.theirOfferValue >= state.myOfferValue ? "+" : ""}
                      {formatGoldValue(
                        state.theirOfferValue - state.myOfferValue,
                      )}{" "}
                      gp
                    </span>
                    {Math.abs(state.theirOfferValue - state.myOfferValue) >
                      Math.max(state.myOfferValue, state.theirOfferValue) *
                        0.5 &&
                      state.myOfferValue > 0 && (
                        <span
                          className="ml-2"
                          style={{ color: theme.colors.state.warning }}
                        >
                          ⚠️
                        </span>
                      )}
                  </div>
                )}
              </div>

              {/* Right section: Inventory (OSRS style - only on offer screen) */}
              {state.screen === "offer" && (
                <>
                  {/* Divider between offers and inventory */}
                  <div
                    className="w-px"
                    style={{ background: theme.colors.border.default }}
                  />
                  <InventoryMiniPanel
                    items={inventory}
                    offeredSlots={offeredSlots}
                    theme={theme}
                  />
                </>
              )}
            </div>

            {/* Confirmation screen message */}
            {state.screen === "confirm" && (
              <div
                className="mt-3 px-3 py-2 rounded text-sm text-center"
                style={{
                  background: `${theme.colors.state.warning}20`,
                  border: `1px solid ${theme.colors.state.warning}50`,
                  color: theme.colors.state.warning,
                }}
              >
                ⚠️ Please review the trade carefully before accepting
              </div>
            )}

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
                {state.myAccepted
                  ? "Waiting for partner..."
                  : state.screen === "confirm"
                    ? "Confirm Trade"
                    : "Accept Trade"}
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
                {/* Render emoji icon as text, not as image src */}
                <span
                  style={{
                    fontSize: "20px",
                    color: "#f2d08a",
                    filter: "drop-shadow(0 2px 2px rgba(0, 0, 0, 0.6))",
                  }}
                >
                  {draggedItemIcon}
                </span>
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
