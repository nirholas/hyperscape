/**
 * Interface Manager
 *
 * Main UI management component that provides a modern, customizable interface with:
 * - Draggable, resizable windows with tabs
 * - Edit mode for interface customization
 * - Layout presets
 * - Modal panels (Bank, Store, Dialogue, etc.)
 * - Minimap with radial menu or NavigationRibbon
 *
 * This is the orchestration layer - heavy logic is delegated to:
 * - DragDropCoordinator: All drag-drop handling
 * - WindowRenderer: Window rendering logic
 * - EditModeUI: Edit mode overlay and indicators
 * - DndKitOverlay: @dnd-kit drag overlay
 *
 * @packageDocumentation
 */

import React, {
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
} from "react";
import { DndContext as DndKitContext } from "@dnd-kit/core";
import {
  DndProvider,
  useWindowManager,
  useEditMode,
  useEditModeKeyboard,
  usePresetStore,
  useWindowStore,
  usePresetHotkeys,
  useFeatureEnabled,
  initializeAccessibility,
  useMobileLayout,
  type WindowConfig,
  type WindowState,
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
import { type InterfaceManagerProps, getPanelIcon, snapToGrid } from "./types";
import {
  createDefaultWindows,
  getResponsivePanelSizing,
} from "./DefaultLayoutFactory";
import { useViewportResize } from "./useViewportResize";

// Extracted modules
import { useDragDropCoordinator } from "./DragDropCoordinator";
import { WindowRenderer } from "./WindowRenderer";
import { EditModeOverlayManager, HoldToEditIndicator } from "./EditModeUI";
import { DndKitDragOverlayRenderer } from "./DndKitOverlay";

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
  const { shouldUseMobileUI } = useMobileLayout();

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
 */
function DesktopInterfaceManager({
  world,
  children,
  enabled = true,
}: InterfaceManagerProps): React.ReactElement {
  // Initialize edit mode keyboard handling
  useEditModeKeyboard();

  // Window management hooks
  const { windows, createWindow } = useWindowManager();
  const { isUnlocked, isHolding, holdProgress } = useEditMode();
  const { loadFromStorage } = usePresetStore();
  const windowStoreUpdate = useWindowStore((s) => s.updateWindow);
  const normalizeZIndices = useWindowStore((s) => s.normalizeZIndices);

  // Normalize z-indices when edit mode is locked to prevent shadow overlap
  const prevUnlockedRef = useRef(isUnlocked);
  useEffect(() => {
    // When transitioning from unlocked to locked, normalize all z-indices
    if (prevUnlockedRef.current && !isUnlocked) {
      normalizeZIndices();
    }
    prevUnlockedRef.current = isUnlocked;
  }, [isUnlocked, normalizeZIndices]);

  // Viewport resize handling
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
    craftingData,
    tanningData,
    lootWindowData,
    questStartData,
    questCompleteData,
    xpLampData,
    duelData,
    duelResultData,
    setBankData,
    setStoreData,
    setDialogueData,
    setSmeltingData,
    setSmithingData,
    setCraftingData,
    setTanningData,
    setLootWindowData,
    setQuestStartData,
    setQuestCompleteData,
    setXpLampData,
    setDuelData,
    setDuelResultData,
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

  // UI_UPDATE event routing
  useUIUpdateEvents(
    world,
    { setPlayerStats, setEquipment },
    {
      setBankData,
      setStoreData,
      setDialogueData,
      setSmeltingData,
      setSmithingData,
      setCraftingData,
      setTanningData,
    },
  );

  // Feature gating based on complexity mode
  const presetHotkeysEnabled = useFeatureEnabled("presetHotkeys");
  const multipleActionBarsEnabled = useFeatureEnabled("multipleActionBars");
  const editModeEnabled = useFeatureEnabled("editMode") && !isMobile;
  const windowCombiningEnabled =
    useFeatureEnabled("windowCombining") && !isMobile;

  // F1-F4 preset hotkeys
  usePresetHotkeys({ enabled: presetHotkeysEnabled, saveModifier: "shift" });

  // Initialize accessibility settings
  useEffect(() => {
    initializeAccessibility();
  }, []);

  // Hydration and initialization state
  const initializedRef = React.useRef(false);
  const [isHydrated, setIsHydrated] = useState(false);
  const prevWindowsCountRef = React.useRef<number>(-1);

  // Wait for window store to hydrate
  useEffect(() => {
    setTimeout(() => setIsHydrated(true), 50);
  }, []);

  // Detect reset and recreate defaults
  useEffect(() => {
    if (!enabled || !isHydrated) return;

    const prevCount = prevWindowsCountRef.current;
    const currentCount = windows.length;
    prevWindowsCountRef.current = currentCount;

    if (prevCount > 0 && currentCount === 0) {
      const freshDefaults = createDefaultWindows();
      freshDefaults.forEach((config) => createWindow(config));

      // Dispatch resize event after a brief delay to trigger re-measurement
      // This fixes issues where panels don't render correctly after layout reset
      requestAnimationFrame(() => {
        window.dispatchEvent(new Event("resize"));
      });
    }
  }, [windows.length, enabled, isHydrated, createWindow]);

  // Initialize default windows on mount
  useEffect(() => {
    if (!isHydrated || !enabled || initializedRef.current) return;
    initializedRef.current = true;

    const storeState = useWindowStore.getState();
    const currentWindows = Array.from(storeState.windows.values());

    if (currentWindows.length === 0) {
      const freshDefaults = createDefaultWindows();
      freshDefaults.forEach((config) => createWindow(config));
      prevWindowsCountRef.current = freshDefaults.length;
    } else {
      prevWindowsCountRef.current = currentWindows.length;
      ensureMenubarWindow(currentWindows, createWindow);
      migrateWindows(currentWindows, storeState);
    }

    loadFromStorage();
  }, [enabled, createWindow, loadFromStorage, isHydrated]);

  // Handle menu button click
  const handleMenuClick = useCallback(
    (panelId: string) => {
      if ((MODAL_PANEL_IDS as readonly string[]).includes(panelId)) {
        handleModalOpen(
          panelId,
          setWorldMapOpen,
          setStatsModalOpen,
          setDeathModalOpen,
        );
        return;
      }

      const existingWindow = windows.find((w) =>
        w.tabs.some((t) => t.content === panelId),
      );

      if (existingWindow) {
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
        createPanelWindow(panelId, windows, createWindow);
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

  // Listen for UI_OPEN_PANE events
  useOpenPaneEvent(world, handleMenuClick);

  // Create panel renderer
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

  // Drag-drop coordination (delegated to hook)
  const {
    handleDragEnd,
    handleDndKitDragStart,
    handleDndKitDragEnd,
    dndKitSensors,
    dndKitActiveItem,
  } = useDragDropCoordinator({ world, inventory });

  if (!enabled) {
    return <>{children}</>;
  }

  if (!isHydrated) {
    return (
      <>
        {children}
        <div
          className="fixed inset-0 pointer-events-none z-50"
          style={{ background: "transparent" }}
          aria-hidden="true"
        />
      </>
    );
  }

  return (
    <HintProvider>
      <DndProvider onDragEnd={handleDragEnd}>
        {children}

        {/* Edit mode overlay */}
        {isUnlocked && editModeEnabled && (
          <EditModeOverlayManager
            windows={windows}
            multipleActionBarsEnabled={multipleActionBarsEnabled}
            createWindow={createWindow}
          />
        )}

        {/* Drag overlay for tab dragging */}
        <DragOverlay />

        {/* @dnd-kit context for cross-panel item dragging */}
        <DndKitContext
          sensors={dndKitSensors}
          onDragStart={handleDndKitDragStart}
          onDragEnd={handleDndKitDragEnd}
        >
          {/* Windows */}
          <WindowRenderer
            windows={windows}
            world={world}
            isUnlocked={isUnlocked}
            editModeEnabled={editModeEnabled}
            windowCombiningEnabled={windowCombiningEnabled}
            renderPanel={renderPanel}
          />

          {/* @dnd-kit drag overlay */}
          <DndKitDragOverlayRenderer
            activeItem={dndKitActiveItem}
            inventory={inventory}
          />
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
          craftingData={craftingData}
          tanningData={tanningData}
          questStartData={questStartData}
          questCompleteData={questCompleteData}
          xpLampData={xpLampData}
          duelData={duelData}
          duelResultData={duelResultData}
          worldMapOpen={worldMapOpen}
          statsModalOpen={statsModalOpen}
          deathModalOpen={deathModalOpen}
          setLootWindowData={setLootWindowData}
          setBankData={setBankData}
          setStoreData={setStoreData}
          setDialogueData={setDialogueData}
          setSmeltingData={setSmeltingData}
          setSmithingData={setSmithingData}
          setCraftingData={setCraftingData}
          setTanningData={setTanningData}
          setQuestStartData={setQuestStartData}
          setQuestCompleteData={setQuestCompleteData}
          setXpLampData={setXpLampData}
          setDuelData={setDuelData}
          setDuelResultData={setDuelResultData}
          setWorldMapOpen={setWorldMapOpen}
          setStatsModalOpen={setStatsModalOpen}
          setDeathModalOpen={setDeathModalOpen}
        />

        {/* Hold-to-edit lock indicator */}
        <HoldToEditIndicator
          isHolding={isHolding}
          holdProgress={holdProgress}
          isUnlocked={isUnlocked}
          editModeEnabled={editModeEnabled}
        />
      </DndProvider>
    </HintProvider>
  );
}

// Helper functions

function handleModalOpen(
  panelId: string,
  setWorldMapOpen: (open: boolean) => void,
  setStatsModalOpen: (open: boolean) => void,
  setDeathModalOpen: (open: boolean) => void,
): void {
  if (panelId === "map") setWorldMapOpen(true);
  else if (panelId === "stats") setStatsModalOpen(true);
  else if (panelId === "death") setDeathModalOpen(true);
}

function createPanelWindow(
  panelId: string,
  windows: WindowConfig[],
  createWindow: (config: WindowConfig) => WindowConfig | null,
): void {
  const viewport =
    typeof window !== "undefined"
      ? { width: window.innerWidth, height: window.innerHeight }
      : { width: 1920, height: 1080 };

  const panelSizing = getResponsivePanelSizing(panelId, viewport);
  const offset = snapToGrid(windows.length * 30);

  createWindow({
    id: `panel-${panelId}-${Date.now()}`,
    position: {
      x: snapToGrid(
        Math.max(20, viewport.width - panelSizing.size.width - 20 - offset),
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
  });
}

function ensureMenubarWindow(
  currentWindows: WindowConfig[],
  createWindow: (config: WindowConfig) => WindowConfig | null,
): void {
  const menubarWindow = currentWindows.find((w) => w.id === "menubar-window");
  if (!menubarWindow) {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
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
}

function migrateWindows(
  currentWindows: WindowState[],
  storeState: ReturnType<typeof useWindowStore.getState>,
): void {
  for (const win of currentWindows) {
    // Remove maxSize from windows that should have unlimited resizing
    const shouldRemoveMaxSize =
      win.id === "minimap-window" ||
      win.id.startsWith("panel-chat-") ||
      win.id.startsWith("panel-minimap-") ||
      win.id.startsWith("panel-menubar-") ||
      win.id === "menubar-window";

    if (shouldRemoveMaxSize && win.maxSize !== undefined) {
      storeState.updateWindow(win.id, { maxSize: undefined });
    }

    // Remove orphaned store/bank windows
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
      storeState.destroyWindow(win.id);
    }
  }
}

export default InterfaceManager;
