/**
 * Trade Panel - OSRS Style
 *
 * Main trading interface showing both players' offers side-by-side.
 * Uses OSRS-style click-based item management with right-click context menus.
 *
 * Layout:
 * - Left side: Local player's offer
 * - Center: Partner's offer
 * - Right side: Inventory (on offer screen)
 * - Bottom: Accept/Cancel buttons
 *
 * Features:
 * - Left-click inventory item: add 1 to trade
 * - Right-click inventory item: context menu (Offer, Offer-5, Offer-10, Offer-X, Offer-All, Value, Examine)
 * - Click items in trade offer to remove
 * - Red flashing exclamation when items removed (anti-scam)
 * - Both players must accept for trade to complete
 * - Two-screen confirmation flow
 */

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useThemeStore, type Theme } from "hs-kit";
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
  theme: Theme;
  isRemoved?: boolean; // For red flashing exclamation
}

interface InventoryItemProps {
  item: { slot: number; itemId: string; quantity: number };
  theme: Theme;
  onLeftClick: () => void;
  onRightClick: (e: React.MouseEvent) => void;
}

interface ContextMenuData {
  x: number;
  y: number;
  item: { slot: number; itemId: string; quantity: number };
}

interface QuantityPromptData {
  item: { slot: number; itemId: string; quantity: number };
}

type ContextMenuState = ContextMenuData | null;
type QuantityPromptState = QuantityPromptData | null;

interface RemovedItemIndicator {
  slot: number;
  side: "my" | "their";
  timestamp: number;
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

/**
 * Parse quantity input with K/M notation
 * Examples: "10k" -> 10000, "1.5m" -> 1500000, "500" -> 500
 */
function parseQuantityInput(input: string): number {
  const normalized = input.toLowerCase().trim();
  const match = normalized.match(/^(\d+\.?\d*)(k|m)?$/);
  if (!match) return 0;

  let value = parseFloat(match[1]);
  if (match[2] === "k") value *= 1000;
  if (match[2] === "m") value *= 1000000;
  return Math.floor(value);
}

// ============================================================================
// Sub-Components
// ============================================================================

/**
 * Individual trade slot displaying an item or empty slot
 * Shows red flashing exclamation when item was recently removed (anti-scam)
 */
function TradeSlot({
  item,
  slotIndex,
  side,
  onRemove,
  theme,
  isRemoved,
}: TradeSlotProps) {
  const itemData = item ? getItem(item.itemId) : null;
  const itemIcon = item ? getItemIcon(item.itemId) : null;
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

/**
 * Clickable inventory item for OSRS-style trade panel
 * Left-click: add 1 to trade
 * Right-click: show context menu
 */
function InventoryItem({
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
        background: theme.colors.background.tertiary,
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

/**
 * OSRS-style context menu for trade inventory items
 */
function TradeContextMenu({
  x,
  y,
  item,
  theme,
  onOffer,
  onClose,
}: {
  x: number;
  y: number;
  item: { slot: number; itemId: string; quantity: number };
  theme: Theme;
  onOffer: (quantity: number | "x" | "all" | "value" | "examine") => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const itemData = getItem(item.itemId);
  const itemName = itemData?.name || item.itemId;

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  // Adjust position to stay within viewport
  const adjustedX = Math.min(x, window.innerWidth - 160);
  const adjustedY = Math.min(y, window.innerHeight - 280);

  const menuOptions = [
    { label: `Offer ${itemName}`, action: () => onOffer(1) },
    { label: "Offer-5", action: () => onOffer(5) },
    { label: "Offer-10", action: () => onOffer(10) },
    { label: "Offer-X", action: () => onOffer("x") },
    { label: "Offer-All", action: () => onOffer("all") },
    { label: "Value", action: () => onOffer("value") },
    { label: "Examine", action: () => onOffer("examine") },
  ];

  return createPortal(
    <div
      ref={menuRef}
      style={{
        position: "fixed",
        left: adjustedX,
        top: adjustedY,
        zIndex: 99999,
        background: "rgba(0, 0, 0, 0.95)",
        border: "1px solid rgba(100, 80, 60, 0.8)",
        borderRadius: "2px",
        padding: "2px 0",
        minWidth: "150px",
        boxShadow: "2px 2px 8px rgba(0, 0, 0, 0.5)",
      }}
    >
      {/* Header with item name */}
      <div
        style={{
          padding: "4px 8px",
          color: "#ff9900",
          fontWeight: "bold",
          fontSize: "12px",
          borderBottom: "1px solid rgba(100, 80, 60, 0.5)",
        }}
      >
        {itemName}
      </div>
      {menuOptions.map((option, i) => (
        <div
          key={i}
          onClick={() => {
            option.action();
            onClose();
          }}
          style={{
            padding: "4px 8px",
            color: i === 0 ? "#ffff00" : "#ffffff",
            fontSize: "12px",
            cursor: "pointer",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(255, 255, 255, 0.1)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
          }}
        >
          {option.label}
        </div>
      ))}
    </div>,
    document.body,
  );
}

/**
 * Quantity prompt modal for Offer-X
 */
function QuantityPrompt({
  item,
  theme,
  onConfirm,
  onCancel,
}: {
  item: { slot: number; itemId: string; quantity: number };
  theme: Theme;
  onConfirm: (quantity: number) => void;
  onCancel: () => void;
}) {
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const itemData = getItem(item.itemId);
  const itemName = itemData?.name || item.itemId;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = () => {
    const qty = parseQuantityInput(inputValue);
    if (qty > 0) {
      const finalQty = Math.min(qty, item.quantity);
      onConfirm(finalQty);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ zIndex: 100000, background: "rgba(0, 0, 0, 0.5)" }}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: theme.colors.background.secondary,
          border: `2px solid ${theme.colors.border.decorative}`,
          borderRadius: "8px",
          padding: "16px",
          minWidth: "280px",
        }}
      >
        <h3
          style={{
            color: theme.colors.text.accent,
            fontWeight: "bold",
            marginBottom: "12px",
            fontSize: "14px",
          }}
        >
          How many would you like to offer?
        </h3>
        <p
          style={{
            color: theme.colors.text.secondary,
            fontSize: "12px",
            marginBottom: "8px",
          }}
        >
          {itemName} (max: {item.quantity.toLocaleString()})
        </p>
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSubmit();
            if (e.key === "Escape") onCancel();
          }}
          placeholder="e.g. 10, 1k, 1.5m"
          style={{
            width: "100%",
            padding: "8px",
            background: theme.colors.background.primary,
            border: `1px solid ${theme.colors.border.default}`,
            borderRadius: "4px",
            color: theme.colors.text.primary,
            fontSize: "14px",
            marginBottom: "12px",
          }}
        />
        <div className="flex gap-2">
          <button
            onClick={handleSubmit}
            style={{
              flex: 1,
              padding: "8px",
              background: theme.colors.state.success,
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              fontWeight: "bold",
            }}
          >
            Confirm
          </button>
          <button
            onClick={onCancel}
            style={{
              flex: 1,
              padding: "8px",
              background: theme.colors.state.danger,
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              fontWeight: "bold",
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Inventory mini-panel for selecting items to trade
 * OSRS style: displayed to the right of trade offers, 4x7 grid matching inventory
 * Left-click: add 1 item, Right-click: context menu
 */
function InventoryMiniPanel({
  items,
  offeredSlots,
  theme,
  onItemLeftClick,
  onItemRightClick,
}: {
  items: Array<{ slot: number; itemId: string; quantity: number }>;
  offeredSlots: Set<number>;
  theme: Theme;
  onItemLeftClick: (item: {
    slot: number;
    itemId: string;
    quantity: number;
  }) => void;
  onItemRightClick: (
    e: React.MouseEvent,
    item: { slot: number; itemId: string; quantity: number },
  ) => void;
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
              <InventoryItem
                key={slotIndex}
                item={item}
                theme={theme}
                onLeftClick={() => onItemLeftClick(item)}
                onRightClick={(e) => onItemRightClick(e, item)}
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
        Left-click: Offer 1 | Right-click: Options
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

  // Context menu state
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);

  // Quantity prompt state
  const [quantityPrompt, setQuantityPrompt] =
    useState<QuantityPromptState>(null);

  // Track removed items for red flashing exclamation (anti-scam feature)
  const [removedItems, setRemovedItems] = useState<RemovedItemIndicator[]>([]);

  // Track previous offers to detect removals
  const prevMyOfferRef = useRef<TradeOfferItem[]>([]);
  const prevTheirOfferRef = useRef<TradeOfferItem[]>([]);

  // Get set of inventory slots already offered
  const offeredSlots = useMemo(() => {
    return new Set(state.myOffer.map((item) => item.inventorySlot));
  }, [state.myOffer]);

  // Detect removed items and show red exclamation
  useEffect(() => {
    const prevMyOffer = prevMyOfferRef.current;
    const prevTheirOffer = prevTheirOfferRef.current;

    // Check for removed items in my offer
    for (const prevItem of prevMyOffer) {
      const stillExists = state.myOffer.some(
        (item) => item.tradeSlot === prevItem.tradeSlot,
      );
      if (!stillExists) {
        setRemovedItems((prev) => [
          ...prev,
          { slot: prevItem.tradeSlot, side: "my", timestamp: Date.now() },
        ]);
      }
    }

    // Check for removed items in their offer
    for (const prevItem of prevTheirOffer) {
      const stillExists = state.theirOffer.some(
        (item) => item.tradeSlot === prevItem.tradeSlot,
      );
      if (!stillExists) {
        setRemovedItems((prev) => [
          ...prev,
          { slot: prevItem.tradeSlot, side: "their", timestamp: Date.now() },
        ]);
      }
    }

    // Update refs
    prevMyOfferRef.current = [...state.myOffer];
    prevTheirOfferRef.current = [...state.theirOffer];
  }, [state.myOffer, state.theirOffer]);

  // Clear removed item indicators after 5 seconds
  useEffect(() => {
    if (removedItems.length === 0) return;

    const timer = setInterval(() => {
      const now = Date.now();
      setRemovedItems((prev) =>
        prev.filter((item) => now - item.timestamp < 5000),
      );
    }, 500);

    return () => clearInterval(timer);
  }, [removedItems.length]);

  // Handle left-click on inventory item (add 1)
  const handleInventoryLeftClick = useCallback(
    (item: { slot: number; itemId: string; quantity: number }) => {
      onAddItem(item.slot, 1);
    },
    [onAddItem],
  );

  // Handle right-click on inventory item (show context menu)
  const handleInventoryRightClick = useCallback(
    (
      e: React.MouseEvent,
      item: { slot: number; itemId: string; quantity: number },
    ) => {
      setContextMenu({ x: e.clientX, y: e.clientY, item });
    },
    [],
  );

  // Handle context menu option selection
  const handleContextMenuOffer = useCallback(
    (quantity: number | "x" | "all" | "value" | "examine") => {
      if (!contextMenu) return;
      const item = contextMenu.item;

      if (quantity === "x") {
        // Show quantity prompt
        setQuantityPrompt({ item });
      } else if (quantity === "all") {
        onAddItem(item.slot, item.quantity);
      } else if (quantity === "value") {
        // Show item value (could emit to chat or show tooltip)
        const itemData = getItem(item.itemId);
        const value = itemData?.value || 0;
        console.log(
          `${itemData?.name || item.itemId}: ${value.toLocaleString()} gp`,
        );
      } else if (quantity === "examine") {
        // Show item examine text
        const itemData = getItem(item.itemId);
        console.log(
          itemData?.examine || `It's a ${itemData?.name || item.itemId}.`,
        );
      } else {
        // Numeric quantity
        const qty = Math.min(quantity, item.quantity);
        onAddItem(item.slot, qty);
      }
    },
    [contextMenu, onAddItem],
  );

  // Handle quantity prompt confirm
  const handleQuantityConfirm = useCallback(
    (quantity: number) => {
      if (!quantityPrompt) return;
      onAddItem(quantityPrompt.item.slot, quantity);
      setQuantityPrompt(null);
    },
    [quantityPrompt, onAddItem],
  );

  // Check if there are recent removals (for accept warning)
  const hasRecentRemovals = removedItems.length > 0;

  // Handle accept with warning if items were removed
  const handleAcceptWithWarning = useCallback(() => {
    if (hasRecentRemovals) {
      // Could show a confirmation dialog here
      // For now, just proceed with the accept
      console.warn("Trade modified - items were removed!");
    }
    onAccept();
  }, [hasRecentRemovals, onAccept]);

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

  // Get removed slots for red exclamation display
  const myRemovedSlots = new Set(
    removedItems.filter((r) => r.side === "my").map((r) => r.slot),
  );
  const theirRemovedSlots = new Set(
    removedItems.filter((r) => r.side === "their").map((r) => r.slot),
  );

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center"
      style={{ background: theme.colors.background.overlay }}
    >
      {/* CSS Animation for pulse effect */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>

      {/* Context Menu */}
      {contextMenu && (
        <TradeContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          item={contextMenu.item}
          theme={theme}
          onOffer={handleContextMenuOffer}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* Quantity Prompt */}
      {quantityPrompt && (
        <QuantityPrompt
          item={quantityPrompt.item}
          theme={theme}
          onConfirm={handleQuantityConfirm}
          onCancel={() => setQuantityPrompt(null)}
        />
      )}

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
                        isRemoved={myRemovedSlots.has(i)}
                      />
                    ))}
                  </div>
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
                        isRemoved={theirRemovedSlots.has(i)}
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

              {/* Trade status bar - OSRS style: free slots + wealth transfer */}
              <div
                className="mt-3 px-3 py-2 rounded text-sm flex items-center justify-between"
                style={{
                  background: theme.colors.background.tertiary,
                  border: `1px solid ${theme.colors.border.decorative}`,
                }}
              >
                {/* Partner free slots indicator (OSRS-style) */}
                <span style={{ color: theme.colors.text.secondary }}>
                  Partner's free slots:{" "}
                  <span
                    style={{
                      color:
                        state.partnerFreeSlots > 0
                          ? theme.colors.state.success
                          : theme.colors.state.danger,
                      fontWeight: "bold",
                    }}
                  >
                    {state.partnerFreeSlots}
                  </span>
                </span>

                {/* Wealth transfer indicator */}
                {(state.myOfferValue > 0 || state.theirOfferValue > 0) && (
                  <span>
                    <span style={{ color: theme.colors.text.secondary }}>
                      Wealth:{" "}
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
                          className="ml-1"
                          style={{ color: theme.colors.state.warning }}
                        >
                          ⚠️
                        </span>
                      )}
                  </span>
                )}
              </div>
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
                  onItemLeftClick={handleInventoryLeftClick}
                  onItemRightClick={handleInventoryRightClick}
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

          {/* Warning if items were removed */}
          {hasRecentRemovals && (
            <div
              className="mt-3 px-3 py-2 rounded text-sm text-center"
              style={{
                background: "rgba(239, 68, 68, 0.2)",
                border: "1px solid rgba(239, 68, 68, 0.5)",
                color: "#ef4444",
              }}
            >
              ⚠️ Items have been removed from the trade!
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-3 mt-4">
            <button
              onClick={handleAcceptWithWarning}
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
      </div>
    </div>,
    document.body,
  );
}
