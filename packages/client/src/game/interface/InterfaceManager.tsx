/**
 * Interface Manager
 *
 * Main UI management component that replaces the legacy Sidebar.
 * Provides a modern, customizable interface with:
 * - Draggable, resizable windows with tabs
 * - Edit mode for interface customization
 * - Layout presets
 * - Modal panels (Bank, Store, Dialogue, etc.)
 * - Minimap with radial menu or NavigationRibbon
 *
 * @packageDocumentation
 */

import React, { useEffect, useState, useCallback, useMemo } from "react";
import { EventType, getItem } from "@hyperscape/shared";
import { getItemIcon } from "@/utils";
import {
  DndContext as DndKitContext,
  DragOverlay as DndKitDragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent as DndKitDragEndEvent,
  type DragStartEvent as DndKitDragStartEvent,
} from "@dnd-kit/core";
import {
  DndProvider,
  useWindowManager,
  useEditMode,
  useEditModeKeyboard,
  usePresetStore,
  useWindowStore,
  useTabDrag,
  useDragStore,
  usePresetHotkeys,
  useFeatureEnabled,
  initializeAccessibility,
  useMobileLayout,
  type WindowConfig,
  type DragEndEvent,
  // Styled components
  Window,
  TabBar,
  EditModeOverlay,
  DragOverlay,
} from "@/ui";
import { HintProvider } from "@/ui";
import { usePlayerData, useModalPanels } from "@/hooks";

// Local modules
import { MobileInterfaceManager } from "./MobileInterfaceManager";
import {
  createPanelRenderer,
  MODAL_PANEL_IDS,
  MENUBAR_DIMENSIONS,
} from "./PanelRegistry";
import {
  useWorldMapHotkey,
  useUIUpdateEvents,
  useOpenPaneEvent,
  useInterfaceUIState,
} from "./useInterfaceEvents";
import { InterfaceModalsRenderer } from "./InterfaceModals";
import {
  WindowContent,
  DraggableContentWrapper,
  ActionBarWrapper,
  MenuBarWrapper,
  MinimapWrapper,
} from "./InterfacePanels";
import {
  type InterfaceManagerProps,
  getPanelIcon,
  snapToGrid,
  MAX_ACTION_BARS,
} from "./types";
import {
  createDefaultWindows,
  getResponsivePanelSizing,
} from "./DefaultLayoutFactory";
import { useViewportResize } from "./useViewportResize";

// getResponsivePanelSizing and createDefaultWindows are now imported from DefaultLayoutFactory

/**
 * Main interface manager component
 *
 * Routes to MobileInterfaceManager on mobile/touch tablet devices,
 * otherwise renders the full desktop UI with draggable windows.
 */
export function InterfaceManager({
  world,
  children,
  enabled = true,
}: InterfaceManagerProps): React.ReactElement {
  // Check if we should use mobile UI (mobile devices or touch tablets)
  const { shouldUseMobileUI } = useMobileLayout();

  // Route to appropriate interface based on device type
  if (shouldUseMobileUI) {
    return (
      <MobileInterfaceManager world={world} enabled={enabled}>
        {children}
      </MobileInterfaceManager>
    );
  }

  return (
    <DesktopInterfaceManager world={world} enabled={enabled}>
      {children}
    </DesktopInterfaceManager>
  );
}

/**
 * Desktop interface manager component
 *
 * Full desktop UI with draggable windows, edit mode, etc.
 */
function DesktopInterfaceManager({
  world,
  children,
  enabled = true,
}: InterfaceManagerProps): React.ReactElement {
  // Initialize edit mode keyboard handling (ONCE at top level)
  // This handles L key hold-to-toggle and Escape to lock
  useEditModeKeyboard();

  // Window management hooks
  const { windows, createWindow } = useWindowManager();
  const { isUnlocked, isHolding, holdProgress } = useEditMode();
  const { loadFromStorage } = usePresetStore();
  const windowStoreUpdate = useWindowStore((s) => s.updateWindow);

  // Viewport resize handling with proportional scaling (extracted to hook)
  // This hook handles all window repositioning on viewport resize
  const { isMobile } = useViewportResize();

  // Player data from shared hook
  const {
    inventory,
    equipment,
    playerStats,
    coins,
    setPlayerStats,
    setEquipment,
  } = usePlayerData(world);

  // Modal panel data from shared hook
  const {
    bankData,
    storeData,
    dialogueData,
    smeltingData,
    smithingData,
    lootWindowData,
    questStartData,
    questCompleteData,
    xpLampData,
    setBankData,
    setStoreData,
    setDialogueData,
    setSmeltingData,
    setSmithingData,
    setLootWindowData,
    setQuestStartData,
    setQuestCompleteData,
    setXpLampData,
  } = useModalPanels(world);

  // Simple UI state for modals
  const {
    worldMapOpen,
    setWorldMapOpen,
    statsModalOpen,
    setStatsModalOpen,
    deathModalOpen,
    setDeathModalOpen,
    toggleWorldMap,
  } = useInterfaceUIState();

  // World map hotkey (M key)
  useWorldMapHotkey(toggleWorldMap);

  // UI_UPDATE event routing for legacy event path
  useUIUpdateEvents(
    world,
    { setPlayerStats, setEquipment },
    {
      setBankData,
      setStoreData,
      setDialogueData,
      setSmeltingData,
      setSmithingData,
    },
  );

  // Note: Viewport resize handling is now done by useViewportResize hook above
  // which provides proportional scaling for all windows on viewport change

  // Feature gating based on complexity mode
  const presetHotkeysEnabled = useFeatureEnabled("presetHotkeys");
  const multipleActionBarsEnabled = useFeatureEnabled("multipleActionBars");
  // Edit mode requires mouse precision - disable on mobile
  const editModeEnabled = useFeatureEnabled("editMode") && !isMobile;
  // Window combining requires drag precision - disable on mobile
  const windowCombiningEnabled =
    useFeatureEnabled("windowCombining") && !isMobile;

  // F1-F4 preset hotkeys (Shift+F1-F4 to save) - only in standard+ mode
  usePresetHotkeys({ enabled: presetHotkeysEnabled, saveModifier: "shift" });

  // Initialize accessibility settings on mount
  useEffect(() => {
    initializeAccessibility();
  }, []);

  // Track if we've initialized windows
  const initializedRef = React.useRef(false);
  const [isHydrated, setIsHydrated] = useState(false);
  // Track previous windows count to detect reset
  const prevWindowsCountRef = React.useRef<number>(-1);

  // Wait for window store to hydrate from localStorage
  useEffect(() => {
    const checkHydration = () => {
      // Give the persist middleware time to hydrate
      setTimeout(() => {
        setIsHydrated(true);
      }, 50);
    };
    checkHydration();
  }, []);

  // Detect when windows are reset to empty and recreate defaults
  useEffect(() => {
    if (!enabled || !isHydrated) return;

    const prevCount = prevWindowsCountRef.current;
    const currentCount = windows.length;

    // Update ref for next comparison
    prevWindowsCountRef.current = currentCount;

    // If we had windows before and now have 0, it's a reset - recreate defaults
    if (prevCount > 0 && currentCount === 0) {
      console.log(
        "[InterfaceManager] Detected reset (windows went from",
        prevCount,
        "to 0), recreating defaults...",
      );
      const freshDefaults = createDefaultWindows();
      freshDefaults.forEach((config) => {
        createWindow(config);
      });
      console.log(
        "[InterfaceManager] Recreated",
        freshDefaults.length,
        "default windows after reset",
      );
    }
  }, [windows.length, enabled, isHydrated, createWindow]);

  // Initialize default windows on mount (after hydration)
  useEffect(() => {
    if (!isHydrated) {
      console.log("[InterfaceManager] Waiting for hydration...");
      return;
    }

    console.log(
      "[InterfaceManager] Init effect running - enabled:",
      enabled,
      "initialized:",
      initializedRef.current,
      "windows:",
      windows.length,
    );

    if (!enabled) {
      console.log("[InterfaceManager] Not enabled, skipping");
      return;
    }
    if (initializedRef.current) {
      console.log("[InterfaceManager] Already initialized, skipping");
      return;
    }
    initializedRef.current = true;

    // Access current windows directly from store to get latest hydrated data
    const storeState = useWindowStore.getState();
    const currentWindows = Array.from(storeState.windows.values());

    // Check current window state (now includes persisted windows from localStorage)
    if (currentWindows.length === 0) {
      // No windows exist - create defaults
      console.log(
        "[InterfaceManager] No persisted windows found, creating defaults...",
      );
      const freshDefaults = createDefaultWindows();
      freshDefaults.forEach((config) => {
        const newWindow = createWindow(config);
        console.log(
          "[InterfaceManager] Created window:",
          newWindow?.id,
          "visible:",
          newWindow?.visible,
        );
      });
      prevWindowsCountRef.current = freshDefaults.length;
      console.log(
        "[InterfaceManager] After creation - store has",
        useWindowStore.getState().windows.size,
        "windows",
      );
    } else {
      // Windows exist (likely from localStorage persistence)
      console.log(
        "[InterfaceManager] Found",
        currentWindows.length,
        "persisted windows:",
        currentWindows.map((w) => w.id),
      );
      prevWindowsCountRef.current = currentWindows.length;

      // Ensure menubar-window exists (may have been removed in older versions)
      const menubarWindow = currentWindows.find(
        (w) => w.id === "menubar-window",
      );
      if (!menubarWindow) {
        console.log("[InterfaceManager] Creating missing menubar-window");
        const viewport = {
          width: window.innerWidth,
          height: window.innerHeight,
        };
        createWindow({
          id: "menubar-window",
          position: {
            x: snapToGrid(
              Math.floor(viewport.width / 2 - MENUBAR_DIMENSIONS.width / 2),
            ),
            y: snapToGrid(10),
          },
          size: {
            width: MENUBAR_DIMENSIONS.width + MENUBAR_DIMENSIONS.padding * 2,
            height: MENUBAR_DIMENSIONS.height + MENUBAR_DIMENSIONS.padding * 2,
          },
          minSize: {
            width: MENUBAR_DIMENSIONS.minWidth,
            height: MENUBAR_DIMENSIONS.minHeight,
          },
          maxSize: {
            width: MENUBAR_DIMENSIONS.maxWidth,
            height: MENUBAR_DIMENSIONS.maxHeight,
          },
          tabs: [
            {
              id: "menubar",
              label: "Menu",
              icon: "📋",
              content: "menubar",
              closeable: false,
            },
          ],
          transparency: 0,
        });
      }

      // Safety net migration: Remove maxSize from windows that should have unlimited resizing
      for (const win of currentWindows) {
        const shouldRemoveMaxSize =
          win.id === "minimap-window" ||
          win.id.startsWith("panel-chat-") ||
          win.id.startsWith("panel-minimap-") ||
          win.id.startsWith("panel-menubar-") ||
          win.id === "menubar-window";

        if (shouldRemoveMaxSize && win.maxSize !== undefined) {
          console.log(
            `[InterfaceManager] Safety net: Removing maxSize from ${win.id}`,
          );
          storeState.updateWindow(win.id, { maxSize: undefined });
        }

        // Migration: Remove orphaned store/bank windows (they're rendered as modals now)
        const winIdLower = win.id.toLowerCase();
        const isOrphanedStoreOrBank =
          winIdLower.includes("store") ||
          winIdLower.includes("bank") ||
          winIdLower.includes("trade") ||
          winIdLower.includes("central") ||
          winIdLower.includes("general") ||
          win.tabs.some((tab) => {
            const content =
              typeof tab.content === "string" ? tab.content.toLowerCase() : "";
            const label = tab.label?.toLowerCase() || "";
            return (
              content.includes("store") ||
              content.includes("bank") ||
              content.includes("trade") ||
              content.includes("central") ||
              content.includes("general") ||
              label.includes("store") ||
              label.includes("bank") ||
              label.includes("trade") ||
              label.includes("central") ||
              label.includes("general")
            );
          });

        if (isOrphanedStoreOrBank) {
          console.log(
            `[InterfaceManager] Removing orphaned store/bank window: ${win.id}`,
            { tabs: win.tabs.map((t) => ({ id: t.id, label: t.label })) },
          );
          storeState.destroyWindow(win.id);
        }
      }
    }

    // Load presets from storage (only once on init)
    loadFromStorage();
  }, [enabled, createWindow, loadFromStorage, isHydrated]);

  // Handle menu button click - focus existing tab or create new window
  const handleMenuClick = useCallback(
    (panelId: string) => {
      // Check if this panel opens a modal instead of a window
      if ((MODAL_PANEL_IDS as readonly string[]).includes(panelId)) {
        if (panelId === "map") {
          setWorldMapOpen(true);
        } else if (panelId === "stats") {
          setStatsModalOpen(true);
        } else if (panelId === "death") {
          setDeathModalOpen(true);
        }
        return;
      }

      // Find window with this panel
      const existingWindow = windows.find((w) =>
        w.tabs.some((t) => t.content === panelId),
      );

      if (existingWindow) {
        // Focus the tab and ensure window is visible
        const tabIndex = existingWindow.tabs.findIndex(
          (t) => t.content === panelId,
        );
        if (tabIndex >= 0) {
          windowStoreUpdate(existingWindow.id, {
            activeTabIndex: tabIndex,
            visible: true,
          });
        }
      } else {
        // Panel doesn't exist - create a new window for it
        const viewport =
          typeof window !== "undefined"
            ? { width: window.innerWidth, height: window.innerHeight }
            : { width: 1920, height: 1080 };
        const panelSizing = getResponsivePanelSizing(panelId, viewport);

        // Position new windows with slight offset to avoid stacking (snapped to grid)
        const offset = snapToGrid(windows.length * 30);
        const newWindowConfig: WindowConfig = {
          id: `panel-${panelId}-${Date.now()}`,
          position: {
            x: snapToGrid(
              Math.max(
                20,
                viewport.width - panelSizing.size.width - 20 - offset,
              ),
            ),
            y: snapToGrid(Math.max(20, 100 + offset)),
          },
          size: panelSizing.size,
          minSize: panelSizing.minSize,
          maxSize: panelSizing.maxSize,
          tabs: [
            {
              id: panelId,
              label: panelId.charAt(0).toUpperCase() + panelId.slice(1),
              icon: getPanelIcon(panelId),
              content: panelId,
              closeable: true,
            },
          ],
          transparency: 0,
        };
        createWindow(newWindowConfig);
      }
    },
    [
      windows,
      windowStoreUpdate,
      createWindow,
      setWorldMapOpen,
      setStatsModalOpen,
      setDeathModalOpen,
    ],
  );

  // Listen for UI_OPEN_PANE events to open panels programmatically
  useOpenPaneEvent(world, handleMenuClick);

  // Create panel renderer with current state
  const renderPanel = useMemo(
    () =>
      createPanelRenderer({
        world,
        inventoryItems: inventory as never[],
        coins,
        stats: playerStats,
        equipment,
        onPanelClick: handleMenuClick,
        isEditMode: isUnlocked && editModeEnabled,
      }),
    [
      world,
      inventory,
      coins,
      playerStats,
      equipment,
      handleMenuClick,
      isUnlocked,
      editModeEnabled,
    ],
  );

  // Tab drag handler - create new window when tab dropped outside
  const { splitTab } = useTabDrag();

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      const activeId = active.id as string;
      const overId = over?.id as string | undefined;

      // Debug: Log all drag end events
      const activeRawData = active.data as Record<string, unknown> | undefined;
      console.log("[InterfaceManager] Drag end:", {
        activeId,
        overId,
        activeDataType: typeof active.data,
        hasCustomData: !!activeRawData,
      });

      // Handle inventory -> equipment drops
      if (
        activeId.startsWith("inventory-") &&
        overId?.startsWith("equipment-")
      ) {
        const inventoryIndex = parseInt(activeId.replace("inventory-", ""), 10);
        const equipmentSlot = overId.replace("equipment-", "");
        const item = inventory[inventoryIndex];

        if (item && world) {
          const localPlayer = world.getPlayer();
          if (localPlayer) {
            const itemData = getItem(item.itemId);

            if (itemData) {
              const itemEquipSlot = itemData.equipSlot;
              const normalizedItemSlot =
                itemEquipSlot === "2h" ? "weapon" : itemEquipSlot;

              if (normalizedItemSlot && normalizedItemSlot !== equipmentSlot) {
                console.log(
                  "[InterfaceManager] Item cannot be equipped in this slot:",
                  {
                    itemId: item.itemId,
                    itemSlot: normalizedItemSlot,
                    targetSlot: equipmentSlot,
                  },
                );
                world.emit(EventType.UI_MESSAGE, {
                  message: `Cannot equip ${itemData.name || item.itemId} in ${equipmentSlot} slot`,
                  type: "error",
                });
                return;
              }
            }

            console.log("[InterfaceManager] Inventory to Equipment drop:", {
              itemId: item.itemId,
              inventorySlot: inventoryIndex,
              equipmentSlot,
            });
            world.network?.send("equipItem", {
              playerId: localPlayer.id,
              itemId: item.itemId,
              inventorySlot: inventoryIndex,
            });
          }
        }
        return;
      }

      // Handle inventory -> inventory drops (reordering within inventory)
      if (
        activeId.startsWith("inventory-") &&
        (overId?.startsWith("inventory-drop-") ||
          overId?.startsWith("inventory-"))
      ) {
        const fromSlot = parseInt(activeId.replace("inventory-", ""), 10);
        const toSlot = overId.startsWith("inventory-drop-")
          ? parseInt(overId.replace("inventory-drop-", ""), 10)
          : parseInt(overId.replace("inventory-", ""), 10);

        if (fromSlot === toSlot) return;

        if (world) {
          console.log("[InterfaceManager] Inventory move:", {
            fromSlot,
            toSlot,
          });
          world.network?.send?.("moveItem", { fromSlot, toSlot });
        }
        return;
      }

      // Handle drops to action bar (skills, prayers, items)
      if (overId?.startsWith("actionbar-drop-")) {
        const slotIndex = parseInt(overId.replace("actionbar-drop-", ""), 10);
        const activeData = active.data as
          | {
              skill?: { id: string; name: string; icon: string; level: number };
              prayer?: {
                id: string;
                name: string;
                icon: string;
                level: number;
              };
              item?: { slot: number; itemId: string; quantity: number };
              index?: number;
              source?: string;
            }
          | undefined;

        console.log("[InterfaceManager] ActionBar drop detected:", {
          overId,
          slotIndex,
          activeId,
          activeData,
          hasSkill: !!activeData?.skill,
          hasPrayer: !!activeData?.prayer,
          hasItem: !!activeData?.item,
          source: activeData?.source,
        });

        const barId = 0;

        if (activeData?.source === "skill" && activeData.skill && world) {
          console.log("[InterfaceManager] Skill to ActionBar:", {
            skill: activeData.skill.name,
            slotIndex,
          });
          world.emit(EventType.ACTION_BAR_SLOT_UPDATE, {
            barId,
            slotIndex,
            slot: {
              type: "skill",
              id: `skill-${activeData.skill.id}-${Date.now()}`,
              skillId: activeData.skill.id,
              icon: activeData.skill.icon,
              label: activeData.skill.name,
            },
          });
          return;
        }

        if (activeData?.source === "prayer" && activeData.prayer && world) {
          console.log("[InterfaceManager] Prayer to ActionBar:", {
            prayer: activeData.prayer.name,
            slotIndex,
          });
          world.emit(EventType.ACTION_BAR_SLOT_UPDATE, {
            barId,
            slotIndex,
            slot: {
              type: "prayer",
              id: `prayer-${activeData.prayer.id}-${Date.now()}`,
              prayerId: activeData.prayer.id,
              icon: activeData.prayer.icon,
              label: activeData.prayer.name,
            },
          });
          return;
        }

        if (activeId.startsWith("inventory-") && activeData?.item && world) {
          console.log("[InterfaceManager] Item to ActionBar:", {
            itemId: activeData.item.itemId,
            slotIndex,
          });
          world.emit(EventType.ACTION_BAR_SLOT_UPDATE, {
            barId,
            slotIndex,
            slot: {
              type: "item",
              id: `item-${activeData.item.itemId}-${Date.now()}`,
              itemId: activeData.item.itemId,
              quantity: activeData.item.quantity,
              label: activeData.item.itemId,
            },
          });
          return;
        }

        console.log("[InterfaceManager] Unhandled ActionBar drop:", {
          activeId,
          overId,
          activeData,
        });
      }

      // Only handle tab drags for the remaining logic
      const activeItem = active as {
        id: string;
        type?: string;
        sourceId?: string | null;
        data?: unknown;
      };
      if (activeItem.type !== "tab") return;

      const sourceWindowId = activeItem.sourceId;

      console.log("[InterfaceManager] Tab drag end:", {
        tabId: active.id,
        sourceWindowId,
        over: over?.id,
        hasOver: Boolean(over),
      });

      if (over && overId) {
        if (
          overId.startsWith("tabbar-") ||
          overId.startsWith("window-header-drop-")
        ) {
          console.log(
            "[InterfaceManager] Tab dropped on window zone, useDrop handles it",
          );
          return;
        }
      }

      // Tab was dropped outside of any window - create new window
      const tabId = active.id;
      const dragState = useDragStore.getState();
      const currentPos = dragState.current;

      console.log(
        "[InterfaceManager] Tab dropped outside windows, creating new window at:",
        currentPos,
      );

      const dropPosition = {
        x: Math.max(20, Math.min(window.innerWidth - 200, currentPos.x - 100)),
        y: Math.max(20, Math.min(window.innerHeight - 200, currentPos.y - 20)),
      };

      splitTab(tabId, dropPosition);
    },
    [splitTab, inventory, world],
  );

  // State for @dnd-kit item dragging (cross-panel drag-drop)
  const [dndKitActiveItem, setDndKitActiveItem] = useState<{
    id: string;
    data: Record<string, unknown>;
  } | null>(null);

  // Configure dnd-kit sensors with activation constraints
  // PointerSensor: distance-based activation for mouse/trackpad (must move 8px before drag)
  // TouchSensor: delay-based activation for mobile (long-press 250ms to start drag)
  // This enables mobile users to long-hold items/prayers/skills to drag them to action bar
  const dndKitSensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // Must move 8 pixels before drag starts
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 250, // Long-press 250ms to start drag on mobile
        tolerance: 5, // Allow 5px movement during delay without cancelling
      },
    }),
  );

  // @dnd-kit drag start handler for item dragging
  const handleDndKitDragStart = useCallback((event: DndKitDragStartEvent) => {
    const { active } = event;
    setDndKitActiveItem({
      id: String(active.id),
      data: (active.data.current as Record<string, unknown>) || {},
    });
  }, []);

  // @dnd-kit drag end handler for item dragging between panels
  const handleDndKitDragEnd = useCallback(
    (event: DndKitDragEndEvent) => {
      const { active, over } = event;
      setDndKitActiveItem(null);

      const activeId = String(active.id);
      const activeData = active.data.current as
        | Record<string, unknown>
        | undefined;

      console.log("[InterfaceManager] @dnd-kit Drag end:", {
        activeId,
        overId: over?.id,
        activeData,
      });

      // Handle drag-out removal for action bar slots
      if (!over) {
        if (
          activeId.startsWith("actionbar-slot-") &&
          activeData?.source === "actionbar"
        ) {
          const slotIndex = activeData.slotIndex as number | undefined;
          if (slotIndex !== undefined && world) {
            console.log("[InterfaceManager] ActionBar drag-out removal:", {
              slotIndex,
            });
            world.emit(EventType.ACTION_BAR_SLOT_UPDATE, {
              barId: 0,
              slotIndex,
              slot: {
                type: "empty",
                id: `empty-${slotIndex}`,
              },
            });
          }
        }
        return;
      }

      const overId = String(over.id);
      const overData = over.data.current as Record<string, unknown> | undefined;

      // Handle action bar -> rubbish bin drops
      if (
        activeId.startsWith("actionbar-slot-") &&
        (overId === "actionbar-rubbish-bin" ||
          overData?.target === "rubbish-bin")
      ) {
        const slotIndex = activeData?.slotIndex as number | undefined;
        if (slotIndex !== undefined && world) {
          console.log("[InterfaceManager] ActionBar to rubbish bin:", {
            slotIndex,
          });
          world.emit(EventType.ACTION_BAR_SLOT_UPDATE, {
            barId: 0,
            slotIndex,
            slot: {
              type: "empty",
              id: `empty-${slotIndex}`,
            },
          });
        }
        return;
      }

      // Handle action bar -> action bar reordering
      if (
        activeId.startsWith("actionbar-slot-") &&
        overId.startsWith("actionbar-drop-")
      ) {
        const fromIndex = activeData?.slotIndex as number | undefined;
        const slotMatch = overId.match(/actionbar-drop-(\d+)/);
        const toIndex = slotMatch ? parseInt(slotMatch[1], 10) : undefined;

        if (
          fromIndex !== undefined &&
          toIndex !== undefined &&
          fromIndex !== toIndex &&
          world
        ) {
          console.log("[InterfaceManager] ActionBar reorder:", {
            fromIndex,
            toIndex,
          });
          world.emit(EventType.ACTION_BAR_SLOT_SWAP, {
            barId: 0,
            fromIndex,
            toIndex,
          });
        }
        return;
      }

      // Handle inventory -> action bar drops
      if (
        activeId.startsWith("inventory-") &&
        overId.startsWith("actionbar-drop-")
      ) {
        const inventoryIndex = parseInt(activeId.replace("inventory-", ""), 10);
        const slotMatch = overId.match(/actionbar-drop-(\d+)/);
        const slotIndex = slotMatch ? parseInt(slotMatch[1], 10) : undefined;

        const itemFromProps = inventory[inventoryIndex];
        const itemFromDragData = activeData?.item as
          | { itemId: string; quantity: number }
          | undefined;
        const item = itemFromProps || itemFromDragData;

        if (item && slotIndex !== undefined && world) {
          console.log("[InterfaceManager] Inventory to ActionBar drop:", {
            itemId: item.itemId,
            inventoryIndex,
            slotIndex,
          });
          world.emit(EventType.ACTION_BAR_SLOT_UPDATE, {
            barId: 0,
            slotIndex,
            slot: {
              type: "item",
              id: `item-${item.itemId}-${Date.now()}`,
              itemId: item.itemId,
              quantity: item.quantity,
              label: item.itemId,
            },
          });
        }
        return;
      }

      // Handle inventory -> inventory drops (reordering)
      if (
        activeId.startsWith("inventory-") &&
        (overId.startsWith("inventory-drop-") ||
          overId.startsWith("inventory-"))
      ) {
        const fromSlot = parseInt(activeId.replace("inventory-", ""), 10);
        const toSlot = overId.startsWith("inventory-drop-")
          ? parseInt(overId.replace("inventory-drop-", ""), 10)
          : parseInt(overId.replace("inventory-", ""), 10);

        if (fromSlot === toSlot) return;

        if (world) {
          console.log("[InterfaceManager] Inventory move:", {
            fromSlot,
            toSlot,
          });
          world.network?.send?.("moveItem", { fromSlot, toSlot });
        }
        return;
      }

      // Handle prayer -> action bar drops
      if (
        activeId.startsWith("prayer-") &&
        overId.startsWith("actionbar-drop-")
      ) {
        const slotMatch = overId.match(/actionbar-drop-(\d+)/);
        const slotIndex = slotMatch ? parseInt(slotMatch[1], 10) : undefined;
        const prayerData = activeData?.prayer as
          | {
              id: string;
              name: string;
              icon: string;
              level: number;
            }
          | undefined;

        if (prayerData && slotIndex !== undefined && world) {
          console.log("[InterfaceManager] Prayer to ActionBar drop:", {
            prayerId: prayerData.id,
            slotIndex,
          });
          world.emit(EventType.ACTION_BAR_SLOT_UPDATE, {
            barId: 0,
            slotIndex,
            slot: {
              type: "prayer",
              id: `prayer-${prayerData.id}-${Date.now()}`,
              prayerId: prayerData.id,
              icon: prayerData.icon,
              label: prayerData.name,
            },
          });
        }
        return;
      }

      // Handle skill -> action bar drops
      if (
        activeId.startsWith("skill-") &&
        overId.startsWith("actionbar-drop-")
      ) {
        const slotMatch = overId.match(/actionbar-drop-(\d+)/);
        const slotIndex = slotMatch ? parseInt(slotMatch[1], 10) : undefined;
        const skillData = activeData?.skill as
          | {
              id: string;
              name: string;
              icon: string;
              level: number;
            }
          | undefined;

        if (skillData && slotIndex !== undefined && world) {
          console.log("[InterfaceManager] Skill to ActionBar drop:", {
            skillId: skillData.id,
            slotIndex,
          });
          world.emit(EventType.ACTION_BAR_SLOT_UPDATE, {
            barId: 0,
            slotIndex,
            slot: {
              type: "skill",
              id: `skill-${skillData.id}-${Date.now()}`,
              skillId: skillData.id,
              icon: skillData.icon,
              label: skillData.name,
            },
          });
        }
        return;
      }

      // Handle inventory -> equipment drops (with full validation)
      if (
        activeId.startsWith("inventory-") &&
        overId.startsWith("equipment-")
      ) {
        const inventoryIndex = parseInt(activeId.replace("inventory-", ""), 10);
        const equipmentSlot = overId.replace("equipment-", "");
        const item = inventory[inventoryIndex];

        if (item && world) {
          const localPlayer = world.getPlayer();
          if (localPlayer) {
            const itemData = getItem(item.itemId);

            if (itemData) {
              const itemEquipSlot = itemData.equipSlot;
              const normalizedItemSlot =
                itemEquipSlot === "2h" ? "weapon" : itemEquipSlot;

              if (normalizedItemSlot && normalizedItemSlot !== equipmentSlot) {
                console.log(
                  "[InterfaceManager] Item cannot be equipped in this slot:",
                  {
                    itemId: item.itemId,
                    itemSlot: normalizedItemSlot,
                    targetSlot: equipmentSlot,
                  },
                );
                world.emit(EventType.UI_MESSAGE, {
                  message: `Cannot equip ${itemData.name || item.itemId} in ${equipmentSlot} slot`,
                  type: "error",
                });
                return;
              }
            }

            console.log("[InterfaceManager] Inventory to Equipment drop:", {
              itemId: item.itemId,
              inventorySlot: inventoryIndex,
              equipmentSlot,
            });
            world.network?.send("equipItem", {
              playerId: localPlayer.id,
              itemId: item.itemId,
              inventorySlot: inventoryIndex,
              equipmentSlot,
            });
          }
        }
        return;
      }
    },
    [inventory, world],
  );

  if (!enabled) {
    return <>{children}</>;
  }

  // Show minimal loading state during hydration to prevent UI flash
  if (!isHydrated) {
    return (
      <>
        {children}
        <div
          className="fixed inset-0 pointer-events-none z-50"
          style={{
            background: "transparent",
          }}
          aria-hidden="true"
        />
      </>
    );
  }

  return (
    <HintProvider>
      <DndProvider onDragEnd={handleDragEnd}>
        {/* Game content (viewport, etc.) */}
        {children}

        {/* Edit mode overlay - only in advanced mode */}
        {isUnlocked &&
          editModeEnabled &&
          (() => {
            const actionBarCount = windows.filter(
              (w) => w.id.startsWith("actionbar-") && w.id.endsWith("-window"),
            ).length;

            const handleAddActionBar = () => {
              const existingIds = new Set(
                windows
                  .filter((w) => w.id.startsWith("actionbar-"))
                  .map((w) => w.id),
              );
              let nextId = 0;
              while (
                existingIds.has(`actionbar-${nextId}-window`) &&
                nextId < MAX_ACTION_BARS
              ) {
                nextId++;
              }
              if (nextId < MAX_ACTION_BARS) {
                const viewport =
                  typeof window !== "undefined"
                    ? {
                        width: window.innerWidth,
                        height: window.innerHeight,
                      }
                    : { width: 1920, height: 1080 };
                const actionbarSizing = getResponsivePanelSizing(
                  "actionbar",
                  viewport,
                );

                createWindow({
                  id: `actionbar-${nextId}-window`,
                  position: {
                    x: snapToGrid(100 + nextId * 50),
                    y: snapToGrid(
                      viewport.height -
                        actionbarSizing.size.height -
                        10 -
                        nextId * 60,
                    ),
                  },
                  size: actionbarSizing.size,
                  minSize: actionbarSizing.minSize,
                  maxSize: actionbarSizing.maxSize,
                  tabs: [
                    {
                      id: `actionbar-${nextId}`,
                      label: `Action Bar ${nextId + 1}`,
                      content: `actionbar-${nextId}`,
                      closeable: false,
                      icon: "⚡",
                    },
                  ],
                  transparency: 0,
                });
              }
            };

            return (
              <EditModeOverlay
                actionBarCount={actionBarCount}
                maxActionBars={MAX_ACTION_BARS}
                onAddActionBar={
                  multipleActionBarsEnabled ? handleAddActionBar : undefined
                }
              />
            );
          })()}

        {/* Drag overlay for ghost during drag */}
        <DragOverlay />

        {/* @dnd-kit context for cross-panel item dragging */}
        <DndKitContext
          sensors={dndKitSensors}
          onDragStart={handleDndKitDragStart}
          onDragEnd={handleDndKitDragEnd}
        >
          {/* Windows container */}
          <div
            className="fixed inset-0 pointer-events-none"
            style={{ zIndex: isUnlocked && editModeEnabled ? 600 : 300 }}
          >
            {(() => {
              const visibleWindows = windows.filter((w) => w.visible);

              return visibleWindows.map((windowState) => {
                const isActionBar = windowState.id.startsWith("actionbar-");
                const isMenuBar = windowState.id === "menubar-window";
                const isMinimap = windowState.id === "minimap-window";
                const hasMultipleTabs = windowState.tabs.length > 1;
                const showTabBar =
                  !isActionBar && !isMenuBar && !isMinimap && hasMultipleTabs;
                const needsDraggableWrapper =
                  !isActionBar && !isMenuBar && !isMinimap && !hasMultipleTabs;

                return (
                  <div key={windowState.id} style={{ pointerEvents: "auto" }}>
                    <Window
                      windowId={windowState.id}
                      windowState={windowState}
                      isUnlocked={isUnlocked && editModeEnabled}
                      windowCombiningEnabled={windowCombiningEnabled}
                    >
                      {isActionBar ? (
                        <ActionBarWrapper
                          activeTabIndex={windowState.activeTabIndex}
                          tabs={windowState.tabs}
                          renderPanel={renderPanel}
                          windowId={windowState.id}
                        />
                      ) : isMenuBar ? (
                        <MenuBarWrapper
                          activeTabIndex={windowState.activeTabIndex}
                          tabs={windowState.tabs}
                          renderPanel={renderPanel}
                          windowId={windowState.id}
                          isUnlocked={isUnlocked && editModeEnabled}
                        />
                      ) : isMinimap ? (
                        <MinimapWrapper
                          world={world}
                          isUnlocked={isUnlocked && editModeEnabled}
                        />
                      ) : showTabBar ? (
                        <TabBar windowId={windowState.id} />
                      ) : null}
                      {!isActionBar &&
                      !isMenuBar &&
                      !isMinimap &&
                      needsDraggableWrapper ? (
                        <DraggableContentWrapper
                          windowId={windowState.id}
                          activeTabIndex={windowState.activeTabIndex}
                          tabs={windowState.tabs}
                          renderPanel={renderPanel}
                          isUnlocked={isUnlocked && editModeEnabled}
                        />
                      ) : !isActionBar && !isMenuBar && !isMinimap ? (
                        <WindowContent
                          activeTabIndex={windowState.activeTabIndex}
                          tabs={windowState.tabs}
                          renderPanel={renderPanel}
                          windowId={windowState.id}
                          isUnlocked={isUnlocked && editModeEnabled}
                        />
                      ) : null}
                    </Window>
                  </div>
                );
              });
            })()}
          </div>

          {/* @dnd-kit Drag overlay for item dragging visual feedback */}
          <DndKitDragOverlay dropAnimation={null}>
            {dndKitActiveItem &&
              (() => {
                const { id, data } = dndKitActiveItem;
                const slotSize = 36;

                let icon: React.ReactNode = "📦";
                let label = "";

                if (id.startsWith("inventory-")) {
                  const index = parseInt(id.replace("inventory-", ""), 10);
                  const item =
                    inventory[index] ||
                    (data?.item as { itemId: string } | undefined);
                  if (item) {
                    const itemData = getItem(item.itemId);
                    // Use getItemIcon for emoji icons (iconPath is an asset:// URL, not renderable as text)
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
                      background:
                        "linear-gradient(180deg, #4a4a4a 0%, #2a2a2a 100%)",
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
              })()}
          </DndKitDragOverlay>
        </DndKitContext>

        {/* Modal Panels */}
        <InterfaceModalsRenderer
          world={world}
          inventory={inventory}
          equipment={equipment}
          coins={coins}
          playerStats={playerStats}
          lootWindowData={lootWindowData}
          bankData={bankData}
          storeData={storeData}
          dialogueData={dialogueData}
          smeltingData={smeltingData}
          smithingData={smithingData}
          questStartData={questStartData}
          questCompleteData={questCompleteData}
          xpLampData={xpLampData}
          worldMapOpen={worldMapOpen}
          statsModalOpen={statsModalOpen}
          deathModalOpen={deathModalOpen}
          setLootWindowData={setLootWindowData}
          setBankData={setBankData}
          setStoreData={setStoreData}
          setDialogueData={setDialogueData}
          setSmeltingData={setSmeltingData}
          setSmithingData={setSmithingData}
          setQuestStartData={setQuestStartData}
          setQuestCompleteData={setQuestCompleteData}
          setXpLampData={setXpLampData}
          setWorldMapOpen={setWorldMapOpen}
          setStatsModalOpen={setStatsModalOpen}
          setDeathModalOpen={setDeathModalOpen}
        />

        {/* Hold-to-edit lock indicator - always shows when holding L */}
        <div
          className="fixed inset-0 flex items-center justify-center pointer-events-none z-[9999]"
          style={{
            backgroundColor: isHolding ? "rgba(0, 0, 0, 0.4)" : "transparent",
            opacity: isHolding ? 1 : 0,
            transition:
              "opacity 0.15s ease-out, background-color 0.15s ease-out",
            visibility: isHolding ? "visible" : "hidden",
          }}
        >
          <div
            className="relative flex items-center justify-center"
            style={{
              width: 140,
              height: 140,
              transform: isHolding ? "scale(1)" : "scale(0.8)",
              transition: "transform 0.15s ease-out",
            }}
          >
            {/* Background glow */}
            <div
              style={{
                position: "absolute",
                width: 100,
                height: 100,
                borderRadius: "50%",
                background: !editModeEnabled
                  ? "radial-gradient(circle, rgba(107, 114, 128, 0.2) 0%, transparent 70%)"
                  : isUnlocked
                    ? "radial-gradient(circle, rgba(239, 68, 68, 0.2) 0%, transparent 70%)"
                    : "radial-gradient(circle, rgba(34, 197, 94, 0.2) 0%, transparent 70%)",
              }}
            />
            {/* Progress ring */}
            <svg
              width="140"
              height="140"
              viewBox="0 0 140 140"
              style={{ position: "absolute" }}
            >
              {/* Track circle */}
              <circle
                cx="70"
                cy="70"
                r="58"
                fill="none"
                stroke="rgba(255, 255, 255, 0.15)"
                strokeWidth="8"
              />
              {/* Progress circle */}
              <circle
                cx="70"
                cy="70"
                r="58"
                fill="none"
                stroke={
                  !editModeEnabled
                    ? "#6b7280"
                    : isUnlocked
                      ? "#ef4444"
                      : "#22c55e"
                }
                strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray={2 * Math.PI * 58}
                strokeDashoffset={2 * Math.PI * 58 * (1 - holdProgress / 100)}
                transform="rotate(-90 70 70)"
                style={{
                  filter: `drop-shadow(0 0 6px ${!editModeEnabled ? "rgba(107, 114, 128, 0.6)" : isUnlocked ? "rgba(239, 68, 68, 0.6)" : "rgba(34, 197, 94, 0.6)"})`,
                }}
              />
            </svg>
            {/* Lock icon container */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                color: "#fff",
              }}
            >
              {/* SVG lock icon */}
              <svg
                width="36"
                height="36"
                viewBox="0 0 24 24"
                fill="none"
                stroke={isUnlocked ? "#fbbf24" : "#fbbf24"}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{
                  filter: "drop-shadow(0 2px 4px rgba(0, 0, 0, 0.3))",
                }}
              >
                {isUnlocked ? (
                  <>
                    {/* Unlocked padlock */}
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 9.9-1" />
                  </>
                ) : (
                  <>
                    {/* Locked padlock */}
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </>
                )}
              </svg>
              <span
                style={{
                  fontSize: 12,
                  marginTop: 8,
                  opacity: 0.9,
                  fontWeight: 500,
                  textShadow: "0 1px 2px rgba(0, 0, 0, 0.5)",
                  letterSpacing: "0.5px",
                }}
              >
                {!editModeEnabled
                  ? "Edit Mode (Advanced)"
                  : isUnlocked
                    ? "Locking..."
                    : "Unlocking..."}
              </span>
            </div>
          </div>
        </div>
      </DndProvider>
    </HintProvider>
  );
}

export default InterfaceManager;
