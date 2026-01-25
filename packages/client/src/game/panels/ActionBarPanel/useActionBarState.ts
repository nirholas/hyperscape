/**
 * ActionBarPanel - State management hook
 */

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  useActionBarKeybinds,
  useFeatureEnabled,
  useWindowStore,
  useEditStore,
} from "@/ui";
import { EventType } from "@hyperscape/shared";
import type { ClientWorld } from "../../../types";
import type { ActionBarSlotContent, ActionBarSlotUpdatePayload } from "./types";
import {
  MIN_SLOT_COUNT,
  MAX_SLOT_COUNT,
  DEFAULT_KEYBOARD_SHORTCUTS,
  BORDER_BUFFER,
  loadSlotCount,
  saveSlotCount,
  loadSlots,
  saveSlots,
  loadLockState,
  saveLockState,
  createEmptySlots,
  calcHorizontalDimensions,
} from "./utils";

// Save slots to server (persistent storage)
function saveSlotsToServer(
  world: ClientWorld,
  barId: number,
  slotCount: number,
  slots: ActionBarSlotContent[],
): void {
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
function loadSlotsFromServer(world: ClientWorld, barId: number): void {
  if (!world?.network) return;
  try {
    world.network.send("actionBarLoad", { barId });
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn("[ActionBar] Failed to load action bar from server:", error);
    }
  }
}

export interface UseActionBarStateOptions {
  world: ClientWorld;
  barId: number;
  isEditMode: boolean;
  windowId?: string;
  useParentDndContext: boolean;
}

export interface UseActionBarStateResult {
  // State
  slotCount: number;
  slots: ActionBarSlotContent[];
  hoveredSlot: number | null;
  activePrayers: Set<string>;
  isLocked: boolean;
  keyboardShortcuts: string[];

  // State setters
  setSlots: React.Dispatch<React.SetStateAction<ActionBarSlotContent[]>>;
  setHoveredSlot: React.Dispatch<React.SetStateAction<number | null>>;

  // Handlers
  handleIncreaseSlots: () => void;
  handleDecreaseSlots: () => void;
  handleToggleLock: () => void;
  handleClearAll: () => void;
  handleUseSlot: (slot: ActionBarSlotContent, index: number) => void;
}

export function useActionBarState({
  world,
  barId,
  isEditMode,
  windowId,
  useParentDndContext,
}: UseActionBarStateOptions): UseActionBarStateResult {
  const updateWindow = useWindowStore((s) => s.updateWindow);
  const gridSize = useEditStore((s) => s.gridSize);

  // Slot count state (persisted to localStorage)
  const [slotCount, setSlotCount] = useState<number>(() =>
    loadSlotCount(barId),
  );
  const [slots, setSlots] = useState<ActionBarSlotContent[]>(() =>
    loadSlots(barId, loadSlotCount(barId)),
  );
  const [hoveredSlot, setHoveredSlot] = useState<number | null>(null);
  const [activePrayers, setActivePrayers] = useState<Set<string>>(new Set());
  const [isLocked, setIsLocked] = useState<boolean>(() => loadLockState(barId));

  // Track if we've loaded from server
  const serverLoadedRef = useRef(false);

  // Helper to snap to grid
  const snapToGrid = useCallback(
    (value: number) => Math.ceil(value / gridSize) * gridSize,
    [gridSize],
  );

  // Update window size when slot count changes
  useEffect(() => {
    if (!windowId) return;

    const dims = calcHorizontalDimensions(slotCount, { isEditMode, isLocked });
    const width = snapToGrid(dims.width + BORDER_BUFFER);
    const height = snapToGrid(dims.height + BORDER_BUFFER);

    updateWindow(windowId, {
      minSize: { width, height },
      maxSize: { width, height },
      size: { width, height },
    });
  }, [windowId, slotCount, isEditMode, isLocked, updateWindow, snapToGrid]);

  // Handle slot count changes
  const handleIncreaseSlots = useCallback(() => {
    if (slotCount < MAX_SLOT_COUNT) {
      const newCount = slotCount + 1;
      setSlotCount(newCount);
      saveSlotCount(barId, newCount);
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
      setSlots((prev) => prev.slice(0, newCount));
    }
  }, [slotCount, barId]);

  // Toggle lock state
  const handleToggleLock = useCallback(() => {
    setIsLocked((prev) => {
      const newValue = !prev;
      saveLockState(barId, newValue);
      return newValue;
    });
  }, [barId]);

  // Clear all slots
  const handleClearAll = useCallback(() => {
    setSlots(createEmptySlots(slotCount));
  }, [slotCount]);

  // Listen for prayer state changes
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

  // Get keybinds from keybindStore
  const customKeybindsEnabled = useFeatureEnabled("customKeybinds");
  const storeKeybinds = useActionBarKeybinds();

  const keyboardShortcuts = useMemo(() => {
    if (!customKeybindsEnabled) {
      return DEFAULT_KEYBOARD_SHORTCUTS;
    }
    return DEFAULT_KEYBOARD_SHORTCUTS.map((defaultKey, index) => {
      return storeKeybinds[index] || defaultKey;
    });
  }, [customKeybindsEnabled, storeKeybinds]);

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

      if (data.barId !== barId) return;

      if (Array.isArray(data.slots) && data.slots.length > 0) {
        serverLoadedRef.current = true;
        if (
          data.slotCount >= MIN_SLOT_COUNT &&
          data.slotCount <= MAX_SLOT_COUNT
        ) {
          setSlotCount(data.slotCount);
          saveSlotCount(barId, data.slotCount);
        }
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
      if (data.barId !== barId) return;

      setSlots((prev) => {
        const newSlots = [...prev];
        newSlots[data.slotIndex] = data.slot;
        return newSlots;
      });
    };

    const handleSlotSwap = (payload: unknown) => {
      const data = payload as {
        barId: number;
        fromIndex: number;
        toIndex: number;
      };
      if (data.barId !== barId) return;

      setSlots((prev) => {
        const newSlots = [...prev];
        [newSlots[data.fromIndex], newSlots[data.toIndex]] = [
          newSlots[data.toIndex],
          newSlots[data.fromIndex],
        ];
        return newSlots;
      });
    };

    world.on(EventType.ACTION_BAR_SLOT_UPDATE, handleSlotUpdate);
    world.on(EventType.ACTION_BAR_SLOT_SWAP, handleSlotSwap);
    return () => {
      world.off(EventType.ACTION_BAR_SLOT_UPDATE, handleSlotUpdate);
      world.off(EventType.ACTION_BAR_SLOT_SWAP, handleSlotSwap);
    };
  }, [world, barId, useParentDndContext]);

  // Persist slots to localStorage and server
  useEffect(() => {
    saveSlots(barId, slots);
    if (serverLoadedRef.current) {
      saveSlotsToServer(world, barId, slotCount, slots);
    }
  }, [world, barId, slots, slotCount]);

  // Handle using a slot (left click or keyboard shortcut)
  const handleUseSlot = useCallback(
    (slot: ActionBarSlotContent, _index: number) => {
      if (slot.type === "empty") return;

      if (slot.type === "item" && slot.itemId) {
        const player = world.getPlayer();
        if (!player) return;

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

        world.network?.send?.("useItem", {
          itemId: slot.itemId,
          slot: invItem.slot,
        });
      } else if (slot.type === "skill" && slot.skillId) {
        console.debug(
          "[ActionBar] Skill clicked:",
          slot.skillId,
          "- opens skill panel",
        );
      } else if (slot.type === "spell" && slot.spellId) {
        const network = world.network;
        if (network && "castSpell" in network) {
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
  }, [slots, keyboardShortcuts, handleUseSlot]);

  return {
    slotCount,
    slots,
    hoveredSlot,
    activePrayers,
    isLocked,
    keyboardShortcuts,
    setSlots,
    setHoveredSlot,
    handleIncreaseSlots,
    handleDecreaseSlots,
    handleToggleLock,
    handleClearAll,
    handleUseSlot,
  };
}
