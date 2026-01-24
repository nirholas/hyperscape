/**
 * ActionBarPanel - A window-based action bar panel
 *
 * Features:
 * - Configurable slot count (4-9 slots, adjustable via +/- buttons)
 * - Drag items from inventory to action bar
 * - Drag skills/spells/prayers to action bar
 * - Keyboard shortcuts (1-9)
 * - Right-click context menu
 * - Multiple action bars support (up to 5)
 * - Horizontal layout only (1xN where N is slot count)
 */

import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  memo,
  useMemo,
} from "react";
import { createPortal } from "react-dom";
import {
  DndProvider,
  useDraggable,
  useDroppable,
  ComposableDragOverlay,
  useActionBarKeybinds,
  useFeatureEnabled,
  useWindowStore,
  useTheme,
  type DragStartEvent,
  type DragEndEvent,
} from "hs-kit";
import { CONTEXT_MENU_COLORS, EventType } from "@hyperscape/shared";
import type { ClientWorld, InventorySlotItem } from "../../types";

/** Action bar slot content - can be an item, skill, spell, or prayer */
export interface ActionBarSlotContent {
  type: "item" | "skill" | "spell" | "prayer" | "empty";
  id: string;
  itemId?: string;
  skillId?: string;
  spellId?: string;
  prayerId?: string;
  quantity?: number;
  icon?: string;
  label?: string;
}

interface ActionBarPanelProps {
  world: ClientWorld;
  barId?: number; // 0-4 for multiple action bars
  /** Whether edit mode is unlocked (shows +/- controls) */
  isEditMode?: boolean;
  /** Window ID for dynamic minSize updates */
  windowId?: string;
  /** When true, uses parent DndProvider context (for cross-panel drag-drop) */
  useParentDndContext?: boolean;
}

/** Payload for action bar slot update events */
export interface ActionBarSlotUpdatePayload {
  barId: number;
  slotIndex: number;
  slot: ActionBarSlotContent;
}

interface ContextMenuItem {
  id: string;
  label: string;
  styledLabel: Array<{ text: string; color?: string }>;
}

interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  items: ContextMenuItem[];
  targetSlot: ActionBarSlotContent | null;
  targetIndex: number;
}

import { gameUI, parseTokenToNumber } from "../../constants";

// Storage keys
const getStorageKey = (barId: number) => `actionbar-slots-${barId}`;
const getSlotCountKey = (barId: number) => `actionbar-slotcount-${barId}`;

// Action bar configuration from design tokens
const {
  minSlots: MIN_SLOT_COUNT,
  maxSlots: MAX_SLOT_COUNT,
  defaultSlots: DEFAULT_SLOT_COUNT,
  slotSize: SLOT_SIZE_TOKEN,
  slotGap: SLOT_GAP_TOKEN,
  padding: PADDING_TOKEN,
  controlButtonSize: CONTROL_BUTTON_SIZE_TOKEN,
} = gameUI.actionBar;

// Parse token values to numbers for calculations
const SLOT_SIZE = parseTokenToNumber(SLOT_SIZE_TOKEN); // 36
const SLOT_GAP = parseTokenToNumber(SLOT_GAP_TOKEN); // 3
const PADDING = parseTokenToNumber(PADDING_TOKEN); // 4
const CONTROL_BUTTON_SIZE = parseTokenToNumber(CONTROL_BUTTON_SIZE_TOKEN); // 20
const CONTROL_BUTTON_GAP = 4; // Gap between control button and slots

/** Calculate dimensions for horizontal layout (slotCount x 1) with optional control buttons */
function calcHorizontalDimensions(
  slotCount: number,
  includeControls = true,
): { width: number; height: number } {
  // Control buttons appear on left and right sides
  const controlWidth = includeControls
    ? CONTROL_BUTTON_SIZE + CONTROL_BUTTON_GAP
    : 0;
  return {
    width:
      slotCount * SLOT_SIZE +
      (slotCount - 1) * SLOT_GAP +
      PADDING * 2 +
      controlWidth * 2,
    height: SLOT_SIZE + PADDING * 2,
  };
}

// Default dimensions based on default slot count (7)
const defaultDims = calcHorizontalDimensions(DEFAULT_SLOT_COUNT);
const HORIZONTAL_WIDTH = defaultDims.width;
const HORIZONTAL_HEIGHT = defaultDims.height;

// Maximum size: 9-slot horizontal layout
const maxHorizontalDims = calcHorizontalDimensions(MAX_SLOT_COUNT);
const MAX_WIDTH = maxHorizontalDims.width;
const MAX_HEIGHT = maxHorizontalDims.height;

// Minimum size: smallest valid layout (4-slot horizontal)
const minHorizontalDims = calcHorizontalDimensions(MIN_SLOT_COUNT);
// Add buffer for borders (1px each side = 2px) and box-shadow visual expansion
const BORDER_BUFFER = 4;
const MIN_WIDTH = minHorizontalDims.width + BORDER_BUFFER;
const MIN_HEIGHT = minHorizontalDims.height + BORDER_BUFFER;

// Default keyboard shortcuts for up to 9 slots
const DEFAULT_KEYBOARD_SHORTCUTS = [
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
];

/** Export dimensions for window configuration */
export const ACTION_BAR_DIMENSIONS = {
  // Minimum size (4-slot horizontal)
  minWidth: MIN_WIDTH,
  minHeight: MIN_HEIGHT,
  // Maximum size (9-slot horizontal)
  maxWidth: MAX_WIDTH,
  maxHeight: MAX_HEIGHT,
  // Default to horizontal layout (all 7 in a row)
  defaultWidth: HORIZONTAL_WIDTH,
  defaultHeight: HORIZONTAL_HEIGHT,
  // Slot count configuration
  minSlotCount: MIN_SLOT_COUNT,
  maxSlotCount: MAX_SLOT_COUNT,
  defaultSlotCount: DEFAULT_SLOT_COUNT,
  slotSize: SLOT_SIZE,
  slotGap: SLOT_GAP,
  padding: PADDING,
  controlButtonSize: CONTROL_BUTTON_SIZE,
};

// Load slot count from localStorage
function loadSlotCount(barId: number): number {
  if (typeof window === "undefined") return DEFAULT_SLOT_COUNT;
  try {
    const saved = localStorage.getItem(getSlotCountKey(barId));
    if (saved) {
      const count = parseInt(saved, 10);
      if (count >= MIN_SLOT_COUNT && count <= MAX_SLOT_COUNT) {
        return count;
      }
    }
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn(
        "[ActionBar] Failed to load slot count from localStorage:",
        error,
      );
    }
  }
  return DEFAULT_SLOT_COUNT;
}

// Save slot count to localStorage
function saveSlotCount(barId: number, count: number) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(getSlotCountKey(barId), String(count));
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn(
        "[ActionBar] Failed to save slot count to localStorage:",
        error,
      );
    }
  }
}

// Load slots from localStorage
function loadSlots(barId: number, slotCount: number): ActionBarSlotContent[] {
  if (typeof window === "undefined") return createEmptySlots(slotCount);
  try {
    const saved = localStorage.getItem(getStorageKey(barId));
    if (saved) {
      const parsed = JSON.parse(saved) as ActionBarSlotContent[];
      // Ensure we have exactly slotCount slots
      while (parsed.length < slotCount) {
        parsed.push({ type: "empty", id: `empty-${parsed.length}` });
      }
      return parsed.slice(0, slotCount);
    }
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn(
        "[ActionBar] Failed to load slots from localStorage:",
        error,
      );
    }
  }
  return createEmptySlots(slotCount);
}

// Save slots to localStorage (local cache)
function saveSlots(barId: number, slots: ActionBarSlotContent[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(getStorageKey(barId), JSON.stringify(slots));
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn("[ActionBar] Failed to save slots to localStorage:", error);
    }
  }
}

// Save slots to server (persistent storage)
function saveSlotsToServer(
  world: ClientWorld,
  barId: number,
  slotCount: number,
  slots: ActionBarSlotContent[],
) {
  if (!world?.network) return;
  try {
    world.network.send("actionBarSave", {
      barId,
      slotCount,
      slots,
    });
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn("[ActionBar] Failed to save action bar to server:", error);
    }
  }
}

// Load slots from server
function loadSlotsFromServer(world: ClientWorld, barId: number) {
  if (!world?.network) return;
  try {
    world.network.send("actionBarLoad", { barId });
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn("[ActionBar] Failed to load action bar from server:", error);
    }
  }
}

// Create empty slots array
function createEmptySlots(slotCount: number): ActionBarSlotContent[] {
  return Array.from({ length: slotCount }, (_, i) => ({
    type: "empty" as const,
    id: `empty-${i}`,
  }));
}

// Get icon for an action bar slot
function getSlotIcon(slot: ActionBarSlotContent): string {
  if (slot.icon) return slot.icon;
  if (slot.type === "empty") return "";

  if (slot.type === "item" && slot.itemId) {
    // Use the same icon logic as before
    const itemId = slot.itemId.toLowerCase();
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
    return slot.itemId.substring(0, 2).toUpperCase();
  }

  if (slot.type === "skill" && slot.skillId) {
    // Skill-specific fallback icons
    const skillId = slot.skillId.toLowerCase();
    if (skillId === "attack") return "⚔️";
    if (skillId === "strength") return "💪";
    if (skillId === "defense" || skillId === "defence") return "🛡️";
    if (skillId === "constitution" || skillId === "hitpoints") return "❤️";
    if (skillId === "ranged") return "🏹";
    if (skillId === "magic") return "✨";
    if (skillId === "prayer") return "🙏";
    if (skillId === "woodcutting") return "🪓";
    if (skillId === "mining") return "⛏️";
    if (skillId === "fishing") return "🐟";
    if (skillId === "firemaking") return "🔥";
    if (skillId === "cooking") return "🍖";
    if (skillId === "smithing") return "🔨";
    if (skillId === "agility") return "🏃";
    return "📊";
  }
  if (slot.type === "spell") return "✨";
  if (slot.type === "prayer") return slot.icon || "✨";
  return "?";
}

// Draggable slot component
const DraggableSlot = memo(function DraggableSlot({
  slot,
  slotIndex,
  slotSize,
  shortcut,
  isHovered,
  isActive,
  onHover,
  onLeave,
  onClick,
  onContextMenu,
}: {
  slot: ActionBarSlotContent;
  slotIndex: number;
  slotSize: number;
  shortcut: string;
  isHovered: boolean;
  isActive: boolean;
  onHover: () => void;
  onLeave: () => void;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const theme = useTheme();
  const isEmpty = slot.type === "empty";
  const isPrayer = slot.type === "prayer";

  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    isDragging,
  } = useDraggable({
    id: `actionbar-slot-${slotIndex}`,
    data: { slot, slotIndex, source: "actionbar" },
    disabled: isEmpty,
  });

  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `actionbar-drop-${slotIndex}`,
    data: { slotIndex, target: "actionbar" },
  });

  // Track if drag was started to prevent click when dragging
  const dragStartedRef = useRef(false);
  const pointerStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggeredRef = useRef(false);

  // Clear long-press timer
  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  // Wrap pointer handlers to track drag vs click and long press
  const wrappedListeners = useMemo(() => {
    if (!listeners) return {};

    const originalPointerDown = listeners.onPointerDown;

    return {
      ...listeners,
      onPointerDown: (e: React.PointerEvent) => {
        dragStartedRef.current = false;
        longPressTriggeredRef.current = false;
        pointerStartPosRef.current = { x: e.clientX, y: e.clientY };

        // Start long-press timer for touch devices (500ms)
        if (e.pointerType === "touch" && !isEmpty) {
          clearLongPressTimer();
          longPressTimerRef.current = setTimeout(() => {
            longPressTriggeredRef.current = true;
            // Trigger context menu on long press
            const syntheticEvent = {
              preventDefault: () => {},
              clientX: e.clientX,
              clientY: e.clientY,
            } as React.MouseEvent;
            onContextMenu(syntheticEvent);
          }, 500);
        }

        originalPointerDown?.(e);
      },
      onPointerUp: () => {
        clearLongPressTimer();
      },
      onPointerCancel: () => {
        clearLongPressTimer();
      },
    };
  }, [listeners, isEmpty, onContextMenu, clearLongPressTimer]);

  // Handle click - only fire if drag didn't start and long press didn't trigger
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      // Don't fire click if long-press was triggered
      if (longPressTriggeredRef.current) {
        longPressTriggeredRef.current = false;
        return;
      }

      // Check if pointer moved significantly (drag activation distance is 3px)
      if (pointerStartPosRef.current) {
        const dx = e.clientX - pointerStartPosRef.current.x;
        const dy = e.clientY - pointerStartPosRef.current.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        // If moved more than activation distance, this was a drag, not a click
        if (distance > 3) {
          return;
        }
      }

      // Not a drag, execute the click action
      onClick();
    },
    [onClick],
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearLongPressTimer();
    };
  }, [clearLongPressTimer]);

  // Combine refs
  const combinedRef = (node: HTMLButtonElement | null) => {
    setDragRef(node);
    setDropRef(node);
  };

  const icon = getSlotIcon(slot);

  // Memoize button style to prevent recreation on every render
  const slotStyle = useMemo(
    (): React.CSSProperties => ({
      width: slotSize,
      height: slotSize,
      background: isEmpty
        ? theme.colors.background.primary
        : isPrayer && isActive
          ? `radial-gradient(ellipse at center, ${theme.colors.accent.primary}4D 0%, ${theme.colors.background.secondary} 70%)`
          : isOver
            ? `linear-gradient(180deg, ${theme.colors.accent.secondary}33 0%, ${theme.colors.background.primary} 100%)`
            : isHovered
              ? `linear-gradient(180deg, ${theme.colors.accent.secondary}22 0%, ${theme.colors.background.primary} 100%)`
              : `linear-gradient(180deg, ${theme.colors.background.secondary} 0%, ${theme.colors.background.primary} 100%)`,
      border: isEmpty
        ? `1px solid ${theme.colors.border.default}66`
        : isPrayer && isActive
          ? `1px solid ${theme.colors.accent.primary}B3`
          : isOver
            ? `2px solid ${theme.colors.accent.primary}B3`
            : isHovered
              ? `1px solid ${theme.colors.accent.primary}80`
              : `1px solid ${theme.colors.border.default}`,
      borderRadius: 4,
      cursor: isEmpty ? "default" : isDragging ? "grabbing" : "grab",
      opacity: isDragging ? 0.3 : 1,
      transform: isOver
        ? "scale(1.05)"
        : isDragging
          ? "scale(0.95)"
          : "scale(1)",
      transition:
        "transform 0.15s ease, opacity 0.15s ease, background 0.15s ease, border 0.15s ease",
      touchAction: "none",
      boxShadow:
        isPrayer && isActive
          ? `0 0 12px ${theme.colors.accent.primary}80, inset 0 0 15px ${theme.colors.accent.primary}33`
          : isOver
            ? `0 0 8px ${theme.colors.accent.primary}66`
            : `inset 0 2px 4px rgba(0, 0, 0, 0.4)`,
    }),
    [
      isEmpty,
      isPrayer,
      isActive,
      isOver,
      isHovered,
      isDragging,
      slotSize,
      theme,
    ],
  );

  return (
    <button
      ref={combinedRef}
      onClick={handleClick}
      onContextMenu={onContextMenu}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      className="relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
      title={
        isEmpty
          ? `Empty slot (${shortcut})`
          : `${slot.label || slot.itemId || slot.skillId || "Unknown"} (${shortcut})`
      }
      style={slotStyle}
      {...attributes}
      {...wrappedListeners}
    >
      {/* Icon */}
      {!isEmpty && (
        <div
          className="flex items-center justify-center h-full"
          style={{
            fontSize: 16,
            filter: "drop-shadow(0 1px 2px rgba(0, 0, 0, 0.5))",
          }}
        >
          {icon}
        </div>
      )}

      {/* Quantity Badge */}
      {slot.type === "item" && slot.quantity && slot.quantity > 1 && (
        <div
          className="absolute font-bold"
          style={{
            bottom: 1,
            right: 1,
            background: theme.colors.background.overlay,
            color: theme.colors.text.primary,
            fontSize: 8,
            padding: "0px 2px",
            borderRadius: 2,
            lineHeight: 1.1,
          }}
        >
          {slot.quantity > 999
            ? `${Math.floor(slot.quantity / 1000)}K`
            : slot.quantity}
        </div>
      )}

      {/* Shortcut Key */}
      <div
        className="absolute font-bold"
        style={{
          top: 1,
          left: 2,
          color: isEmpty
            ? `${theme.colors.text.secondary}80`
            : `${theme.colors.text.secondary}A6`,
          fontSize: 7,
          textShadow: "0 1px 1px rgba(0, 0, 0, 0.6)",
        }}
      >
        {shortcut}
      </div>
    </button>
  );
});

export function ActionBarPanel({
  world,
  barId = 0,
  isEditMode = false,
  windowId,
  useParentDndContext = false,
}: ActionBarPanelProps): React.ReactElement {
  const theme = useTheme();
  const updateWindow = useWindowStore((s) => s.updateWindow);
  // Slot count state (persisted to localStorage)
  const [slotCount, setSlotCount] = useState<number>(() =>
    loadSlotCount(barId),
  );
  const [slots, setSlots] = useState<ActionBarSlotContent[]>(() =>
    loadSlots(barId, loadSlotCount(barId)),
  );
  const [hoveredSlot, setHoveredSlot] = useState<number | null>(null);
  const [draggedSlot, setDraggedSlot] = useState<ActionBarSlotContent | null>(
    null,
  );
  const [activePrayers, setActivePrayers] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    items: [],
    targetSlot: null,
    targetIndex: -1,
  });
  const menuRef = useRef<HTMLDivElement>(null);

  // Update window size, minSize, and maxSize when slot count changes
  // Always include control button space to keep consistent size regardless of edit mode
  useEffect(() => {
    if (!windowId) return;

    // Calculate dimensions for current slot count (horizontal layout only)
    // Always include control space so panel doesn't shift when toggling edit mode
    const dims = calcHorizontalDimensions(slotCount, true);
    const width = dims.width + BORDER_BUFFER;
    const height = dims.height + BORDER_BUFFER;

    // Set min, max, and size to same values - window locks to content size
    updateWindow(windowId, {
      minSize: { width, height },
      maxSize: { width, height },
      size: { width, height },
    });
  }, [windowId, slotCount, updateWindow]);

  // Handle slot count changes
  const handleIncreaseSlots = useCallback(() => {
    if (slotCount < MAX_SLOT_COUNT) {
      const newCount = slotCount + 1;
      setSlotCount(newCount);
      saveSlotCount(barId, newCount);
      // Add an empty slot
      setSlots((prev) => [
        ...prev,
        { type: "empty", id: `empty-${prev.length}` },
      ]);
    }
  }, [slotCount, barId]);

  const handleDecreaseSlots = useCallback(() => {
    if (slotCount > MIN_SLOT_COUNT) {
      const newCount = slotCount - 1;
      setSlotCount(newCount);
      saveSlotCount(barId, newCount);
      // Remove the last slot
      setSlots((prev) => prev.slice(0, newCount));
    }
  }, [slotCount, barId]);

  // Listen for prayer state changes to highlight active prayers
  useEffect(() => {
    if (!world) return;

    const handlePrayerStateSync = (payload: unknown) => {
      const data = payload as { playerId: string; active: string[] };
      const localPlayer = world.getPlayer();
      if (!localPlayer || data.playerId !== localPlayer.id) return;
      setActivePrayers(new Set(data.active));
    };

    const handlePrayerToggled = (payload: unknown) => {
      const data = payload as {
        playerId: string;
        prayerId: string;
        active: boolean;
      };
      const localPlayer = world.getPlayer();
      if (!localPlayer || data.playerId !== localPlayer.id) return;
      setActivePrayers((prev) => {
        const next = new Set(prev);
        if (data.active) {
          next.add(data.prayerId);
        } else {
          next.delete(data.prayerId);
        }
        return next;
      });
    };

    world.on(EventType.PRAYER_STATE_SYNC, handlePrayerStateSync);
    world.on(EventType.PRAYER_TOGGLED, handlePrayerToggled);

    return () => {
      world.off(EventType.PRAYER_STATE_SYNC, handlePrayerStateSync);
      world.off(EventType.PRAYER_TOGGLED, handlePrayerToggled);
    };
  }, [world]);

  // Get keybinds from keybindStore (when customKeybinds feature is enabled)
  const customKeybindsEnabled = useFeatureEnabled("customKeybinds");
  const storeKeybinds = useActionBarKeybinds();

  // Use store keybinds when customKeybinds enabled, otherwise use defaults
  const keyboardShortcuts = useMemo(() => {
    if (!customKeybindsEnabled) {
      return DEFAULT_KEYBOARD_SHORTCUTS;
    }
    // Map store keybinds to our slot count, falling back to defaults
    return DEFAULT_KEYBOARD_SHORTCUTS.map((defaultKey, index) => {
      return storeKeybinds[index] || defaultKey;
    });
  }, [customKeybindsEnabled, storeKeybinds]);

  // Track if we've loaded from server
  const serverLoadedRef = useRef(false);

  // Load from server on mount
  useEffect(() => {
    if (!world) return;
    loadSlotsFromServer(world, barId);
  }, [world, barId]);

  // Handle server response with action bar state
  useEffect(() => {
    if (!world) return;

    const handleActionBarState = (payload: unknown) => {
      const data = payload as {
        barId: number;
        slotCount: number;
        slots: ActionBarSlotContent[];
      };

      // Only handle responses for this bar
      if (data.barId !== barId) return;

      // Only update if we got data from server
      if (Array.isArray(data.slots) && data.slots.length > 0) {
        serverLoadedRef.current = true;
        // Update slot count
        if (
          data.slotCount >= MIN_SLOT_COUNT &&
          data.slotCount <= MAX_SLOT_COUNT
        ) {
          setSlotCount(data.slotCount);
          saveSlotCount(barId, data.slotCount);
        }
        // Update slots
        setSlots(data.slots);
        saveSlots(barId, data.slots);
      }
    };

    world.on("actionBarState", handleActionBarState);
    return () => {
      world.off("actionBarState", handleActionBarState);
    };
  }, [world, barId]);

  // Listen for slot updates from InterfaceManager (cross-panel drag-drop)
  useEffect(() => {
    if (!world || !useParentDndContext) return;

    const handleSlotUpdate = (payload: unknown) => {
      const data = payload as ActionBarSlotUpdatePayload;
      // Only handle updates for this bar
      if (data.barId !== barId) return;

      setSlots((prev) => {
        const newSlots = [...prev];
        newSlots[data.slotIndex] = data.slot;
        return newSlots;
      });
    };

    world.on(EventType.ACTION_BAR_SLOT_UPDATE, handleSlotUpdate);
    return () => {
      world.off(EventType.ACTION_BAR_SLOT_UPDATE, handleSlotUpdate);
    };
  }, [world, barId, useParentDndContext]);

  // Persist slots to localStorage and server
  useEffect(() => {
    saveSlots(barId, slots);
    // Only save to server if we've loaded at least once (avoid overwriting on init)
    if (serverLoadedRef.current) {
      saveSlotsToServer(world, barId, slotCount, slots);
    }
  }, [world, barId, slots, slotCount]);

  // Close context menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu((prev) => ({ ...prev, visible: false }));
      }
    };
    if (contextMenu.visible) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [contextMenu.visible]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      const shortcutIndex = keyboardShortcuts.indexOf(e.key);
      if (shortcutIndex !== -1 && shortcutIndex < slots.length) {
        const slot = slots[shortcutIndex];
        if (slot.type !== "empty") {
          handleUseSlot(slot, shortcutIndex);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [slots, keyboardShortcuts]);

  // Handle using a slot (left click or keyboard shortcut)
  const handleUseSlot = useCallback(
    (slot: ActionBarSlotContent, _index: number) => {
      if (slot.type === "empty") return;

      if (slot.type === "item" && slot.itemId) {
        // Use item - find in inventory and trigger via network
        const player = world.getPlayer();
        if (!player) return;

        // Access the inventory cache to find the item's slot
        const network = world.network as {
          lastInventoryByPlayerId?: Record<
            string,
            { items: Array<{ slot: number; itemId: string; quantity: number }> }
          >;
        };
        const inventory = network?.lastInventoryByPlayerId?.[player.id];
        if (!inventory) {
          console.debug("[ActionBar] No inventory cache available");
          return;
        }

        // Find the item in inventory
        const invItem = inventory.items.find(
          (item) => item.itemId === slot.itemId && item.quantity > 0,
        );
        if (!invItem) {
          console.debug(
            "[ActionBar] Item not found in inventory:",
            slot.itemId,
          );
          return;
        }

        // Send useItem request to server
        world.network?.send?.("useItem", {
          itemId: slot.itemId,
          slot: invItem.slot,
        });
      } else if (slot.type === "skill" && slot.skillId) {
        // Skills in the action bar open the skill panel or show skill info
        // This is similar to RS3 where clicking a skill on action bar shows the skill guide
        console.debug(
          "[ActionBar] Skill clicked:",
          slot.skillId,
          "- opens skill panel",
        );
        // Future: Could emit an event to open the skills panel focused on this skill
        // For now, skills are placed for quick reference (showing level/XP in tooltip)
      } else if (slot.type === "spell" && slot.spellId) {
        // Cast spell - get current target if any for targeted spells
        const network = world.network;
        if (network && "castSpell" in network) {
          // Get current combat target for targeted spells
          const localPlayer = world.getPlayer();
          const targetId =
            (
              localPlayer as { getCombatTarget?: () => string | undefined }
            )?.getCombatTarget?.() ?? undefined;
          (
            network as {
              castSpell: (id: string, targetId?: string) => void;
            }
          ).castSpell(slot.spellId, targetId);
          console.debug(
            "[ActionBar] Spell cast:",
            slot.spellId,
            "target:",
            targetId,
          );
        }
      } else if (slot.type === "prayer" && slot.prayerId) {
        // Toggle prayer - send to server via ClientNetwork
        const network = world.network;
        if (network && "togglePrayer" in network) {
          (network as { togglePrayer: (id: string) => void }).togglePrayer(
            slot.prayerId,
          );
        }
      }
    },
    [world],
  );

  // Handle drag start - track what's being dragged for visual overlay
  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    const dragData = active.data.data as
      | { slot?: ActionBarSlotContent }
      | undefined;
    setDraggedSlot(dragData?.slot || null);
  };

  // Handle drag end - supports reordering and dropping from inventory/prayer panel
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setDraggedSlot(null);

    if (!over) return;

    const activeData = active.data.data as {
      slot?: ActionBarSlotContent;
      slotIndex?: number;
      source?: string;
      item?: InventorySlotItem;
      // Prayer drag data
      prayer?: {
        id: string;
        name: string;
        icon: string;
        level: number;
      };
      // Skill drag data
      skill?: {
        id: string;
        name: string;
        icon: string;
        level: number;
      };
    } | null;
    const overData = over.data as {
      slotIndex?: number;
      target?: string;
    } | null;

    // Check if this is a drop from inventory
    if (activeData?.source === "inventory" && activeData.item) {
      const targetIndex = overData?.slotIndex;
      if (targetIndex !== undefined) {
        // Create new slot content from inventory item
        const newSlot: ActionBarSlotContent = {
          type: "item",
          id: `item-${activeData.item.itemId}-${Date.now()}`,
          itemId: activeData.item.itemId,
          quantity: activeData.item.quantity,
          label: activeData.item.itemId,
        };
        setSlots((prev) => {
          const newSlots = [...prev];
          newSlots[targetIndex] = newSlot;
          return newSlots;
        });
      }
      return;
    }

    // Check if this is a drop from prayer panel
    if (activeData?.source === "prayer" && activeData.prayer) {
      const targetIndex = overData?.slotIndex;
      if (targetIndex !== undefined) {
        // Create new slot content from prayer
        const newSlot: ActionBarSlotContent = {
          type: "prayer",
          id: `prayer-${activeData.prayer.id}-${Date.now()}`,
          prayerId: activeData.prayer.id,
          icon: activeData.prayer.icon,
          label: activeData.prayer.name,
        };
        setSlots((prev) => {
          const newSlots = [...prev];
          newSlots[targetIndex] = newSlot;
          return newSlots;
        });
      }
      return;
    }

    // Check if this is a drop from skill panel
    if (activeData?.source === "skill" && activeData.skill) {
      const targetIndex = overData?.slotIndex;
      if (targetIndex !== undefined) {
        const skillData = activeData.skill as {
          id: string;
          name: string;
          icon: string;
          level: number;
        };
        // Create new slot content from skill
        const newSlot: ActionBarSlotContent = {
          type: "skill",
          id: `skill-${skillData.id}-${Date.now()}`,
          skillId: skillData.id,
          icon: skillData.icon,
          label: skillData.name,
        };
        setSlots((prev) => {
          const newSlots = [...prev];
          newSlots[targetIndex] = newSlot;
          return newSlots;
        });
      }
      return;
    }

    // Reordering within action bar
    if (
      activeData?.source === "actionbar" &&
      overData?.target === "actionbar"
    ) {
      const fromIndex = activeData.slotIndex;
      const toIndex = overData.slotIndex;

      if (
        fromIndex !== undefined &&
        toIndex !== undefined &&
        fromIndex !== toIndex
      ) {
        setSlots((prev) => {
          const newSlots = [...prev];
          // Swap slots
          [newSlots[fromIndex], newSlots[toIndex]] = [
            newSlots[toIndex],
            newSlots[fromIndex],
          ];
          return newSlots;
        });
      }
    }
  };

  // Handle context menu
  const handleContextMenu = useCallback(
    (e: React.MouseEvent, slot: ActionBarSlotContent, index: number) => {
      e.preventDefault();
      e.stopPropagation();

      const menuItems: ContextMenuItem[] = [];

      if (slot.type !== "empty") {
        const name =
          slot.label ||
          slot.itemId ||
          slot.skillId ||
          slot.prayerId ||
          "Unknown";

        // Determine action text and color based on type
        const actionText =
          slot.type === "prayer"
            ? "Activate "
            : slot.type === "skill"
              ? "View "
              : "Use ";
        const slotColor =
          slot.type === "prayer"
            ? "#60a5fa"
            : slot.type === "skill"
              ? "#4ade80" // Green for skills
              : CONTEXT_MENU_COLORS.ITEM;

        menuItems.push({
          id: "use",
          label: `${actionText}${name}`,
          styledLabel: [
            { text: actionText, color: "#fff" },
            { text: name, color: slotColor },
          ],
        });

        // Remove from action bar
        menuItems.push({
          id: "remove",
          label: `Remove ${name}`,
          styledLabel: [
            { text: "Remove ", color: "#fff" },
            { text: name, color: slotColor },
          ],
        });
      }

      // Cancel
      menuItems.push({
        id: "cancel",
        label: "Cancel",
        styledLabel: [{ text: "Cancel", color: "#fff" }],
      });

      setContextMenu({
        visible: true,
        x: e.clientX,
        y: e.clientY,
        items: menuItems,
        targetSlot: slot,
        targetIndex: index,
      });
    },
    [],
  );

  // Handle context menu item click
  const handleMenuItemClick = useCallback(
    (menuItem: ContextMenuItem) => {
      if (menuItem.id === "cancel") {
        setContextMenu((prev) => ({ ...prev, visible: false }));
        return;
      }

      if (menuItem.id === "use" && contextMenu.targetSlot) {
        handleUseSlot(contextMenu.targetSlot, contextMenu.targetIndex);
      } else if (menuItem.id === "remove") {
        // Remove from action bar
        setSlots((prev) => {
          const newSlots = [...prev];
          newSlots[contextMenu.targetIndex] = {
            type: "empty",
            id: `empty-${contextMenu.targetIndex}`,
          };
          return newSlots;
        });
      }

      setContextMenu((prev) => ({ ...prev, visible: false }));
    },
    [contextMenu.targetSlot, contextMenu.targetIndex, handleUseSlot],
  );

  // Horizontal layout only: slotCount columns x 1 row

  // Common button styles for +/- controls
  const getControlButtonStyle = (isDisabled: boolean): React.CSSProperties => ({
    width: CONTROL_BUTTON_SIZE,
    height: CONTROL_BUTTON_SIZE,
    minWidth: CONTROL_BUTTON_SIZE,
    minHeight: CONTROL_BUTTON_SIZE,
    background: isDisabled
      ? theme.colors.background.primary
      : `linear-gradient(180deg, ${theme.colors.background.secondary} 0%, ${theme.colors.background.primary} 100%)`,
    border: isDisabled
      ? `1px solid ${theme.colors.border.default}33`
      : `1px solid ${theme.colors.border.default}`,
    borderRadius: 4,
    color: isDisabled
      ? `${theme.colors.text.secondary}4D`
      : theme.colors.text.secondary,
    fontSize: 14,
    fontWeight: "bold",
    cursor: isDisabled ? "not-allowed" : "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "all 0.15s ease",
    boxShadow: `inset 0 2px 4px rgba(0, 0, 0, 0.4)`,
  });

  // Action bar content (slots + controls)
  const actionBarContent = (
    <>
      {/* Flex container - buttons wrap around the slots container (horizontal only) */}
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: CONTROL_BUTTON_GAP,
        }}
      >
        {/* Decrease slot count button (-) - only rendered in edit mode */}
        {isEditMode && (
          <button
            onClick={handleDecreaseSlots}
            disabled={slotCount <= MIN_SLOT_COUNT}
            title={`Remove slot (${slotCount}/${MAX_SLOT_COUNT})`}
            className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
            style={getControlButtonStyle(slotCount <= MIN_SLOT_COUNT)}
            onMouseEnter={(e) => {
              if (slotCount > MIN_SLOT_COUNT) {
                e.currentTarget.style.background = `linear-gradient(180deg, ${theme.colors.accent.secondary}22 0%, ${theme.colors.background.primary} 100%)`;
                e.currentTarget.style.borderColor = theme.colors.accent.primary;
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background =
                slotCount <= MIN_SLOT_COUNT
                  ? theme.colors.background.primary
                  : `linear-gradient(180deg, ${theme.colors.background.secondary} 0%, ${theme.colors.background.primary} 100%)`;
              e.currentTarget.style.borderColor =
                slotCount <= MIN_SLOT_COUNT
                  ? `${theme.colors.border.default}33`
                  : theme.colors.border.default;
            }}
          >
            −
          </button>
        )}

        {/* Slots container - horizontal grid layout */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${slotCount}, ${SLOT_SIZE}px)`,
            gap: SLOT_GAP,
            padding: PADDING,
            justifyContent: "center",
            background: `linear-gradient(180deg, ${theme.colors.background.secondary} 0%, ${theme.colors.background.primary} 100%)`,
            border: `1px solid ${theme.colors.border.default}`,
            borderRadius: 4,
            boxShadow: `inset 0 2px 8px rgba(0, 0, 0, 0.5), ${theme.shadows.md}`,
          }}
        >
          {slots.map((slot, index) => (
            <DraggableSlot
              key={`${barId}-${index}`}
              slot={slot}
              slotIndex={index}
              slotSize={SLOT_SIZE}
              shortcut={keyboardShortcuts[index] || ""}
              isHovered={hoveredSlot === index}
              isActive={
                slot.type === "prayer" && slot.prayerId
                  ? activePrayers.has(slot.prayerId)
                  : false
              }
              onHover={() => setHoveredSlot(index)}
              onLeave={() => setHoveredSlot(null)}
              onClick={() => handleUseSlot(slot, index)}
              onContextMenu={(e) => handleContextMenu(e, slot, index)}
            />
          ))}
        </div>

        {/* Increase slot count button (+) - only rendered in edit mode */}
        {isEditMode && (
          <button
            onClick={handleIncreaseSlots}
            disabled={slotCount >= MAX_SLOT_COUNT}
            title={`Add slot (${slotCount}/${MAX_SLOT_COUNT})`}
            className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
            style={getControlButtonStyle(slotCount >= MAX_SLOT_COUNT)}
            onMouseEnter={(e) => {
              if (slotCount < MAX_SLOT_COUNT) {
                e.currentTarget.style.background = `linear-gradient(180deg, ${theme.colors.accent.secondary}22 0%, ${theme.colors.background.primary} 100%)`;
                e.currentTarget.style.borderColor = theme.colors.accent.primary;
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background =
                slotCount >= MAX_SLOT_COUNT
                  ? theme.colors.background.primary
                  : `linear-gradient(180deg, ${theme.colors.background.secondary} 0%, ${theme.colors.background.primary} 100%)`;
              e.currentTarget.style.borderColor =
                slotCount >= MAX_SLOT_COUNT
                  ? `${theme.colors.border.default}33`
                  : theme.colors.border.default;
            }}
          >
            +
          </button>
        )}
      </div>

      {/* Drag Overlay for slot dragging (only when using own provider) */}
      {!useParentDndContext && (
        <ComposableDragOverlay adjustToPointer>
          {draggedSlot && (
            <div
              style={{
                width: SLOT_SIZE,
                height: SLOT_SIZE,
                background: `linear-gradient(180deg, ${theme.colors.accent.secondary}4D 0%, ${theme.colors.background.secondary} 100%)`,
                border: `2px solid ${theme.colors.accent.primary}CC`,
                borderRadius: 4,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 16,
                boxShadow: `0 4px 12px rgba(0, 0, 0, 0.4), 0 0 8px ${theme.colors.accent.primary}40`,
                pointerEvents: "none",
              }}
            >
              {getSlotIcon(draggedSlot)}
            </div>
          )}
        </ComposableDragOverlay>
      )}
    </>
  );

  return (
    <>
      {/* Outer container - centers content in panel */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {/* When using parent context, don't wrap with DndProvider */}
        {useParentDndContext ? (
          actionBarContent
        ) : (
          <DndProvider onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
            {actionBarContent}
          </DndProvider>
        )}
      </div>

      {/* Context Menu Portal */}
      {contextMenu.visible &&
        createPortal(
          <ContextMenuPortal
            menuRef={menuRef}
            x={contextMenu.x}
            y={contextMenu.y}
            items={contextMenu.items}
            onItemClick={handleMenuItemClick}
          />,
          document.body,
        )}
    </>
  );
}

/** Context menu portal component */
const ContextMenuPortal = memo(function ContextMenuPortal({
  menuRef,
  x,
  y,
  items,
  onItemClick,
}: {
  menuRef: React.RefObject<HTMLDivElement | null>;
  x: number;
  y: number;
  items: ContextMenuItem[];
  onItemClick: (item: ContextMenuItem) => void;
}) {
  const theme = useTheme();
  const [position, setPosition] = useState(() => ({
    left: Math.max(4, x),
    top: Math.max(4, y - 100),
  }));
  const [isPositioned, setIsPositioned] = useState(false);

  useEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;

    const rect = menu.getBoundingClientRect();
    const padding = 4;
    let finalTop = y - rect.height - padding;
    if (finalTop < padding) finalTop = y + padding;
    const finalLeft = Math.max(
      padding,
      Math.min(x, window.innerWidth - rect.width - padding),
    );

    setPosition({ left: finalLeft, top: finalTop });
    setIsPositioned(true);
  }, [x, y]);

  return (
    <div
      ref={menuRef}
      className="fixed z-[9999]"
      style={{
        left: position.left,
        top: position.top,
        opacity: isPositioned ? 1 : 0,
        visibility: isPositioned ? "visible" : "hidden",
      }}
    >
      <div
        style={{
          background: theme.colors.background.secondary,
          border: `1px solid ${theme.colors.border.default}`,
          borderRadius: 4,
          boxShadow: `inset 0 2px 8px rgba(0, 0, 0, 0.5), ${theme.shadows.md}`,
          overflow: "hidden",
          minWidth: 100,
        }}
      >
        {items.map((menuItem, idx) => (
          <button
            key={menuItem.id}
            onClick={() => onItemClick(menuItem)}
            className="w-full text-left transition-colors duration-75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-400/60"
            style={{
              padding: "4px 8px",
              fontSize: 10,
              background: "transparent",
              border: "none",
              cursor: "pointer",
              borderTop:
                idx > 0 ? `1px solid ${theme.colors.border.default}26` : "none",
              display: "block",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = `${theme.colors.accent.secondary}1F`;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
          >
            {menuItem.styledLabel.map((segment, i) => (
              <span key={i} style={{ color: segment.color || "#fff" }}>
                {segment.text}
              </span>
            ))}
          </button>
        ))}
      </div>
    </div>
  );
});
