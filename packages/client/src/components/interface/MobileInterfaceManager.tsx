/**
 * Mobile Interface Manager
 *
 * Dedicated mobile UI for portrait and landscape orientations.
 * Features:
 * - Bottom navigation bar with 5 core buttons
 * - Bottom sheet drawers for panels (hybrid: sheets for compact, modals for complex)
 * - Mobile-optimized status HUD (HP/Prayer orbs, minimap)
 * - Touch action bar with swipe gestures
 * - Safe area handling for notch/home indicator
 *
 * @packageDocumentation
 */

import React, {
  useState,
  useCallback,
  useMemo,
  useEffect,
  type ReactNode,
  type CSSProperties,
} from "react";
import { EventType, getItem } from "@hyperscape/shared";
import type { PlayerStats, InventoryItem, Item } from "@hyperscape/shared";
import { useMobileLayout, useTheme, ModalWindow } from "hs-kit";
import type { ClientWorld, PlayerEquipmentItems } from "../../types";
import { createPanelRenderer, MODAL_PANEL_IDS } from "./PanelRegistry";
import { RadialMinimapMenu } from "../../game/hud/RadialMinimapMenu";
import { CompactStatusHUD } from "./CompactStatusHUD";
import { getMobileUISizes } from "./mobileUISizes";
import { zIndex } from "../../constants";
import { BankPanel } from "../../game/panels/BankPanel";
import { StorePanel } from "../../game/panels/StorePanel";
import { DialoguePanel } from "../../game/panels/DialoguePanel";
import { SmeltingPanel } from "../../game/panels/SmeltingPanel";
import { SmithingPanel } from "../../game/panels/SmithingPanel";
import { LootWindowPanel } from "../../game/panels/LootWindowPanel";
import { QuestStartPanel } from "../../game/panels/QuestStartPanel";
import { QuestCompletePanel } from "../../game/panels/QuestCompletePanel";
import { XpLampPanel } from "../../game/panels/XpLampPanel";
import { ActionPanel } from "../../game/panels/ActionPanel";

// Import Lucide icons
import { X } from "lucide-react";

/** Raw equipment slot format from server network cache */
type RawEquipmentSlot = { item: Item | null; itemId?: string } | null;

/** Raw equipment data structure from server network cache */
type RawEquipmentData = {
  weapon?: RawEquipmentSlot;
  shield?: RawEquipmentSlot;
  helmet?: RawEquipmentSlot;
  body?: RawEquipmentSlot;
  legs?: RawEquipmentSlot;
  boots?: RawEquipmentSlot;
  gloves?: RawEquipmentSlot;
  cape?: RawEquipmentSlot;
  amulet?: RawEquipmentSlot;
  ring?: RawEquipmentSlot;
  arrows?: RawEquipmentSlot;
};

/** Network event names for UI interactions (registered via world.network.on) */
const NetworkEvents = {
  INVENTORY_UPDATE: "inventoryUpdate",
  EQUIPMENT_UPDATE: "equipmentUpdate",
  STATS_UPDATE: "statsUpdate",
  LOOT_WINDOW: "lootWindow",
  BANK_OPEN: "bankOpen",
  BANK_CLOSE: "bankClose",
  STORE_OPEN: "storeOpen",
  STORE_CLOSE: "storeClose",
  DIALOGUE_START: "dialogueStart",
  DIALOGUE_END: "dialogueEnd",
  SMELTING_OPEN: "smeltingOpen",
  SMELTING_CLOSE: "smeltingClose",
  SMITHING_OPEN: "smithingOpen",
  SMITHING_CLOSE: "smithingClose",
  QUEST_START_SCREEN: "questStartScreen",
  QUEST_COMPLETE_SCREEN: "questCompleteScreen",
  XP_LAMP_USE: "xpLampUse",
} as const;

/** Inventory slot view item */
type InventorySlotViewItem = {
  slot: number;
  itemId: string;
  quantity: number;
};

/** Storage key for persisting active panel across mode switches */
const MOBILE_PANEL_STORAGE_KEY = "mobile-active-panel";

/** Props for MobileInterfaceManager */
export interface MobileInterfaceManagerProps {
  /** The game world instance */
  world: ClientWorld;
  /** Children to render (typically game viewport) */
  children?: ReactNode;
  /** Whether the interface is enabled */
  enabled?: boolean;
}

/**
 * Mobile Interface Manager
 *
 * Main mobile UI component with portrait/landscape layouts and
 * touch-optimized controls.
 */
export function MobileInterfaceManager({
  world,
  children,
  enabled = true,
}: MobileInterfaceManagerProps): React.ReactElement {
  const theme = useTheme();
  const layout = useMobileLayout();
  const { safeAreaInsets } = layout;

  // Panel state - restore from localStorage on mount for mode transitions
  const [activePanel, setActivePanel] = useState<string | null>(() => {
    if (typeof window !== "undefined") {
      const saved = sessionStorage.getItem(MOBILE_PANEL_STORAGE_KEY);
      // Clear after reading to avoid stale state
      if (saved) {
        sessionStorage.removeItem(MOBILE_PANEL_STORAGE_KEY);
        return saved;
      }
    }
    return null;
  });

  // Chat overlay state (separate from drawer)
  const [chatVisible, setChatVisible] = useState(false);

  // Player state
  const [inventory, setInventory] = useState<InventorySlotViewItem[]>([]);
  const [equipment, setEquipment] = useState<PlayerEquipmentItems | null>(null);
  const [playerStats, setPlayerStats] = useState<PlayerStats | null>(null);
  const [coins, setCoins] = useState<number>(0);

  // Modal panel states
  const [lootWindowData, setLootWindowData] = useState<{
    visible: boolean;
    corpseId: string;
    corpseName: string;
    lootItems: InventoryItem[];
  } | null>(null);

  const [bankData, setBankData] = useState<{
    visible: boolean;
    items: Array<{
      itemId: string;
      quantity: number;
      slot: number;
      tabIndex: number;
    }>;
    tabs: Array<{ tabIndex: number; iconItemId: string | null }>;
    alwaysSetPlaceholder: boolean;
    maxSlots: number;
    bankId: string;
  } | null>(null);

  const [storeData, setStoreData] = useState<{
    visible: boolean;
    storeId: string;
    storeName: string;
    buybackRate: number;
    npcEntityId?: string;
    items: Array<{
      id: string;
      itemId: string;
      name: string;
      price: number;
      stockQuantity: number;
      description?: string;
      category?: string;
    }>;
  } | null>(null);

  const [dialogueData, setDialogueData] = useState<{
    visible: boolean;
    npcId: string;
    npcName: string;
    text: string;
    responses: Array<{ text: string; nextNodeId: string; effect?: string }>;
    npcEntityId?: string;
  } | null>(null);

  const [smeltingData, setSmeltingData] = useState<{
    visible: boolean;
    furnaceId: string;
    availableBars: Array<{
      barItemId: string;
      levelRequired: number;
      primaryOre: string;
      secondaryOre: string | null;
      coalRequired: number;
    }>;
  } | null>(null);

  const [smithingData, setSmithingData] = useState<{
    visible: boolean;
    anvilId: string;
    availableRecipes: Array<{
      itemId: string;
      name: string;
      barType: string;
      barsRequired: number;
      levelRequired: number;
      xp: number;
      category: string;
    }>;
  } | null>(null);

  const [questStartData, setQuestStartData] = useState<{
    visible: boolean;
    questId: string;
    questName: string;
    description: string;
    difficulty: string;
    requirements: {
      quests: string[];
      skills: Record<string, number>;
      items: string[];
    };
    rewards: {
      questPoints: number;
      items: Array<{ itemId: string; quantity: number }>;
      xp: Record<string, number>;
    };
  } | null>(null);

  const [questCompleteData, setQuestCompleteData] = useState<{
    visible: boolean;
    questName: string;
    rewards: {
      questPoints: number;
      items: Array<{ itemId: string; quantity: number }>;
      xp: Record<string, number>;
    };
  } | null>(null);

  const [xpLampData, setXpLampData] = useState<{
    visible: boolean;
    itemId: string;
    slot: number;
    xpAmount: number;
  } | null>(null);

  // Handle radial menu button clicks (by panel id)
  const handleRadialButtonClick = useCallback(
    (panelId: string) => {
      if (panelId === "chat") {
        // Toggle chat overlay
        setChatVisible((prev) => !prev);
        return;
      }

      if (activePanel === panelId) {
        // Close panel if same panel
        setActivePanel(null);
      } else {
        // Open panel
        setActivePanel(panelId);
      }
    },
    [activePanel],
  );

  // Handle panel close
  const handlePanelClose = useCallback(() => {
    setActivePanel(null);
  }, []);

  // Handle inventory item move (reordering via drag-and-drop)
  const handleItemMove = useCallback(
    (fromSlot: number, toSlot: number) => {
      world?.network?.send?.("moveItem", { fromSlot, toSlot });
    },
    [world],
  );

  // Handle menu clicks from panels
  const handleMenuClick = useCallback((panelId: string) => {
    // If it's a modal panel, let the modal system handle it
    if ((MODAL_PANEL_IDS as readonly string[]).includes(panelId)) {
      return;
    }

    // Open the panel
    setActivePanel(panelId);
  }, []);

  // Persist active panel to sessionStorage for mode transition recovery
  // This allows panel state to survive mobile <-> desktop switches
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (activePanel) {
      sessionStorage.setItem(MOBILE_PANEL_STORAGE_KEY, activePanel);
    } else {
      sessionStorage.removeItem(MOBILE_PANEL_STORAGE_KEY);
    }
  }, [activePanel]);

  // Handle viewport size changes - recalculate UI sizes
  const mobileUISizes = useMemo(() => getMobileUISizes(layout), [layout]);

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
        isEditMode: false,
      }),
    [world, inventory, coins, playerStats, equipment, handleMenuClick],
  );

  // Subscribe to game events
  useEffect(() => {
    if (!world) return;

    // Inventory updates
    const handleInventory = (data: unknown) => {
      const invData = data as { items: InventorySlotViewItem[] };
      setInventory(invData.items || []);
      const totalCoins = (invData.items || [])
        .filter((item) => item.itemId === "coins")
        .reduce((sum, item) => sum + item.quantity, 0);
      setCoins(totalCoins);
    };

    // Equipment updates
    const handleEquipment = (data: unknown) => {
      const rawEquipment = data as RawEquipmentData;
      const processedEquipment: PlayerEquipmentItems = {
        weapon: null,
        shield: null,
        helmet: null,
        body: null,
        legs: null,
        boots: null,
        gloves: null,
        cape: null,
        amulet: null,
        ring: null,
        arrows: null,
      };
      for (const [slot, slotData] of Object.entries(rawEquipment)) {
        if (slotData?.item) {
          processedEquipment[slot as keyof PlayerEquipmentItems] =
            slotData.item;
        } else if (slotData?.itemId) {
          processedEquipment[slot as keyof PlayerEquipmentItems] = getItem(
            slotData.itemId,
          );
        }
      }
      setEquipment(processedEquipment);
    };

    // UI_UPDATE is the primary source for player stats (same as CoreUI.tsx)
    const handleUIUpdate = (data: unknown) => {
      const update = data as { component: string; data: unknown };
      if (update.component === "player") {
        setPlayerStats(update.data as PlayerStats);
      }
    };

    // Stats updates (fallback/alternative event)
    const handleStats = (data: unknown) => {
      setPlayerStats(data as PlayerStats);
    };

    // Skills updates
    const handleSkillsUpdate = (data: unknown) => {
      const skillsData = data as {
        playerId: string;
        skills: PlayerStats["skills"];
      };
      const localId = world.entities?.player?.id;
      if (!localId || skillsData.playerId === localId) {
        setPlayerStats((prev) =>
          prev
            ? { ...prev, skills: skillsData.skills }
            : ({ skills: skillsData.skills } as PlayerStats),
        );
      }
    };

    // Prayer state sync (full sync from server - includes active prayers, points, etc.)
    const handlePrayerStateSync = (data: unknown) => {
      const syncData = data as {
        playerId: string;
        points: number;
        maxPoints: number;
        level?: number;
        active?: string[];
      };
      const localId = world.entities?.player?.id;
      if (!localId || syncData.playerId === localId) {
        setPlayerStats((prev) =>
          prev
            ? {
                ...prev,
                prayerPoints: {
                  current: syncData.points,
                  max: syncData.maxPoints,
                },
              }
            : ({
                prayerPoints: {
                  current: syncData.points,
                  max: syncData.maxPoints,
                },
              } as PlayerStats),
        );
      }
    };

    // Prayer points changed (e.g., from altar, prayer drain, potions)
    // Note: payload uses 'points' and 'maxPoints', not 'current' and 'max'
    const handlePrayerPointsChanged = (data: unknown) => {
      const prayerData = data as {
        playerId: string;
        points: number;
        maxPoints: number;
      };
      const localId = world.entities?.player?.id;
      // Only update if it's for the local player or no player ID filter
      if (!localId || prayerData.playerId === localId) {
        setPlayerStats((prev) =>
          prev
            ? {
                ...prev,
                prayerPoints: {
                  current: prayerData.points,
                  max: prayerData.maxPoints,
                },
              }
            : ({
                prayerPoints: {
                  current: prayerData.points,
                  max: prayerData.maxPoints,
                },
              } as PlayerStats),
        );
      }
    };

    // Modal panel events
    const handleLootWindow = (data: unknown) => {
      const d = data as {
        corpseId: string;
        corpseName: string;
        lootItems: InventoryItem[];
      };
      setLootWindowData({ visible: true, ...d });
    };

    const handleBank = (data: unknown) => {
      const d = data as typeof bankData;
      if (d) setBankData({ ...d, visible: true });
    };

    const handleBankClose = () => setBankData(null);

    const handleStore = (data: unknown) => {
      const d = data as typeof storeData;
      if (d) setStoreData({ ...d, visible: true });
    };

    const handleStoreClose = () => setStoreData(null);

    const handleDialogue = (data: unknown) => {
      const d = data as typeof dialogueData;
      if (d) setDialogueData({ ...d, visible: true });
    };

    const handleDialogueClose = () => setDialogueData(null);

    const handleSmelting = (data: unknown) => {
      const d = data as typeof smeltingData;
      if (d) setSmeltingData({ ...d, visible: true });
    };

    const handleSmeltingClose = () => setSmeltingData(null);

    const handleSmithing = (data: unknown) => {
      const d = data as typeof smithingData;
      if (d) setSmithingData({ ...d, visible: true });
    };

    const handleSmithingClose = () => setSmithingData(null);

    const handleQuestStart = (data: unknown) => {
      const d = data as typeof questStartData;
      if (d) setQuestStartData({ ...d, visible: true });
    };

    const handleQuestComplete = (data: unknown) => {
      const d = data as typeof questCompleteData;
      if (d) setQuestCompleteData({ ...d, visible: true });
    };

    const handleXpLamp = (data: unknown) => {
      const d = data as typeof xpLampData;
      if (d) setXpLampData({ ...d, visible: true });
    };

    // Register event listeners using the world event system for core events
    // and network handlers for UI-specific events
    // Core player stats events (matching CoreUI.tsx pattern)
    world.on(EventType.UI_UPDATE, handleUIUpdate, undefined);
    world.on(EventType.SKILLS_UPDATED, handleSkillsUpdate, undefined);

    // Prayer events (matching PrayerPanel.tsx pattern)
    world.on(EventType.PRAYER_STATE_SYNC, handlePrayerStateSync, undefined);
    world.on(
      EventType.PRAYER_POINTS_CHANGED,
      handlePrayerPointsChanged,
      undefined,
    );

    // Inventory and equipment
    world.on(EventType.INVENTORY_UPDATED, handleInventory, undefined);
    world.on(EventType.UI_EQUIPMENT_UPDATE, handleEquipment, undefined);
    world.on(EventType.STATS_UPDATE, handleStats, undefined);
    world.on(EventType.BANK_OPEN, handleBank, undefined);
    world.on(EventType.BANK_CLOSE, handleBankClose, undefined);
    world.on(EventType.STORE_OPEN, handleStore, undefined);
    world.on(EventType.STORE_CLOSE, handleStoreClose, undefined);
    world.on(EventType.DIALOGUE_START, handleDialogue, undefined);
    world.on(EventType.DIALOGUE_END, handleDialogueClose, undefined);
    world.on(EventType.SMELTING_INTERFACE_OPEN, handleSmelting, undefined);
    world.on(EventType.SMITHING_INTERFACE_OPEN, handleSmithing, undefined);
    world.on(EventType.QUEST_START_CONFIRM, handleQuestStart, undefined);
    world.on(EventType.QUEST_COMPLETED, handleQuestComplete, undefined);
    world.on(EventType.XP_LAMP_USE_REQUEST, handleXpLamp, undefined);

    // Register network event listeners for UI events that come directly from server
    if (world.network) {
      world.network.on(NetworkEvents.LOOT_WINDOW, handleLootWindow);
      world.network.on(NetworkEvents.SMELTING_CLOSE, handleSmeltingClose);
      world.network.on(NetworkEvents.SMITHING_CLOSE, handleSmithingClose);
    }

    // Request initial data (matching InterfaceManager pattern)
    const requestInitial = () => {
      const lp = world.entities?.player?.id;
      if (lp) {
        // Get cached inventory
        const cachedInv = world.network?.lastInventoryByPlayerId?.[lp];
        if (cachedInv && Array.isArray(cachedInv.items)) {
          setInventory(cachedInv.items as InventorySlotViewItem[]);
          setCoins(cachedInv.coins || 0);
        }

        // Get cached skills and build initial stats
        const cachedSkills = world.network?.lastSkillsByPlayerId?.[lp];
        if (cachedSkills) {
          const skills = cachedSkills as unknown as PlayerStats["skills"];
          setPlayerStats((prev) =>
            prev ? { ...prev, skills } : ({ skills } as PlayerStats),
          );
        }

        // Get cached equipment
        const cachedEquipment = world.network?.lastEquipmentByPlayerId?.[lp];
        if (cachedEquipment) {
          const rawEq = cachedEquipment as RawEquipmentData;
          const mappedEquipment: PlayerEquipmentItems = {
            weapon: rawEq.weapon?.item ?? null,
            shield: rawEq.shield?.item ?? null,
            helmet: rawEq.helmet?.item ?? null,
            body: rawEq.body?.item ?? null,
            legs: rawEq.legs?.item ?? null,
            boots: rawEq.boots?.item ?? null,
            gloves: rawEq.gloves?.item ?? null,
            cape: rawEq.cape?.item ?? null,
            amulet: rawEq.amulet?.item ?? null,
            ring: rawEq.ring?.item ?? null,
            arrows: rawEq.arrows?.item ?? null,
          };
          setEquipment(mappedEquipment);
        }

        // Get player entity directly for health/prayer (most reliable source)
        const playerEntity = world.entities?.player;
        if (playerEntity) {
          // Try to get health from player entity
          const entityData = playerEntity as unknown as {
            health?: number;
            maxHealth?: number;
            data?: {
              health?: number;
              maxHealth?: number;
              prayerPoints?: number;
              maxPrayerPoints?: number;
            };
          };

          const health = entityData.health ?? entityData.data?.health;
          const maxHealth =
            entityData.maxHealth ?? entityData.data?.maxHealth ?? 10;
          const prayerPoints = entityData.data?.prayerPoints ?? 0;
          const maxPrayerPoints = entityData.data?.maxPrayerPoints ?? 1;

          if (typeof health === "number") {
            setPlayerStats(
              (prev) =>
                ({
                  ...prev,
                  health: { current: health, max: maxHealth },
                  prayerPoints: { current: prayerPoints, max: maxPrayerPoints },
                }) as PlayerStats,
            );
          }
        }

        // Request fresh data from server
        world.emit(EventType.INVENTORY_REQUEST, { playerId: lp });
        return true;
      }
      return false;
    };

    // Try to get initial data immediately, or retry after a short delay
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    if (!requestInitial()) {
      timeoutId = setTimeout(() => requestInitial(), 400);
    }

    return () => {
      if (timeoutId !== null) clearTimeout(timeoutId);
      // Core player stats events
      world.off(EventType.UI_UPDATE, handleUIUpdate, undefined, undefined);
      world.off(
        EventType.SKILLS_UPDATED,
        handleSkillsUpdate,
        undefined,
        undefined,
      );

      // Prayer events
      world.off(
        EventType.PRAYER_STATE_SYNC,
        handlePrayerStateSync,
        undefined,
        undefined,
      );
      world.off(
        EventType.PRAYER_POINTS_CHANGED,
        handlePrayerPointsChanged,
        undefined,
        undefined,
      );

      // Inventory and equipment
      world.off(
        EventType.INVENTORY_UPDATED,
        handleInventory,
        undefined,
        undefined,
      );
      world.off(
        EventType.UI_EQUIPMENT_UPDATE,
        handleEquipment,
        undefined,
        undefined,
      );
      world.off(EventType.STATS_UPDATE, handleStats, undefined, undefined);
      world.off(EventType.BANK_OPEN, handleBank, undefined, undefined);
      world.off(EventType.BANK_CLOSE, handleBankClose, undefined, undefined);
      world.off(EventType.STORE_OPEN, handleStore, undefined, undefined);
      world.off(EventType.STORE_CLOSE, handleStoreClose, undefined, undefined);
      world.off(EventType.DIALOGUE_START, handleDialogue, undefined, undefined);
      world.off(
        EventType.DIALOGUE_END,
        handleDialogueClose,
        undefined,
        undefined,
      );
      world.off(
        EventType.SMELTING_INTERFACE_OPEN,
        handleSmelting,
        undefined,
        undefined,
      );
      world.off(
        EventType.SMITHING_INTERFACE_OPEN,
        handleSmithing,
        undefined,
        undefined,
      );
      world.off(
        EventType.QUEST_START_CONFIRM,
        handleQuestStart,
        undefined,
        undefined,
      );
      world.off(
        EventType.QUEST_COMPLETED,
        handleQuestComplete,
        undefined,
        undefined,
      );
      world.off(
        EventType.XP_LAMP_USE_REQUEST,
        handleXpLamp,
        undefined,
        undefined,
      );

      // Unregister network event listeners
      if (world.network) {
        world.network.off(NetworkEvents.LOOT_WINDOW, handleLootWindow);
        world.network.off(NetworkEvents.SMELTING_CLOSE, handleSmeltingClose);
        world.network.off(NetworkEvents.SMITHING_CLOSE, handleSmithingClose);
      }
    };
  }, [world]);

  // Get panel title for active panel
  const getPanelTitle = useCallback((panelId: string | null): string => {
    if (!panelId) return "";
    const titles: Record<string, string> = {
      inventory: "Inventory",
      equipment: "Equipment",
      combat: "Combat",
      skills: "Skills",
      prayer: "Prayer",
      quests: "Quests",
      settings: "Settings",
      menubar: "Menu",
      chat: "Chat",
    };
    return (
      titles[panelId] || panelId.charAt(0).toUpperCase() + panelId.slice(1)
    );
  }, []);

  // Get panel width based on panel type
  const getPanelWidth = useCallback(
    (panelId: string | null): number => {
      if (!panelId) return 260;
      const widths = mobileUISizes.panel.widths;
      const key = panelId as keyof typeof widths;
      return widths[key] ?? 260;
    },
    [mobileUISizes.panel.widths],
  );

  // Get panel height based on panel type
  const getPanelHeight = useCallback(
    (panelId: string | null): number => {
      if (!panelId) return 50;
      const heights = mobileUISizes.panel.heights;
      const key = panelId as keyof typeof heights;
      return heights[key] ?? 50;
    },
    [mobileUISizes.panel.heights],
  );

  // Render panel content
  const renderPanelContent = useCallback(() => {
    if (!activePanel || !renderPanel) return null;

    const content = renderPanel(activePanel);
    if (!content) return null;

    return (
      <div
        style={{
          padding: theme.spacing.sm,
          height: "100%",
          overflow: "auto",
        }}
      >
        {content}
      </div>
    );
  }, [activePanel, renderPanel, theme.spacing.sm]);

  // Container styles - pointer events none so clicks go through to game
  const containerStyle: CSSProperties = {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    pointerEvents: "none", // Allow clicks through to game canvas
    // Hide entire UI when disabled
    opacity: enabled ? 1 : 0,
    visibility: enabled ? "visible" : "hidden",
  };

  // Get responsive UI sizes (layout already defined above)
  const uiSizes = mobileUISizes;

  // Pointer events based on enabled state
  const uiPointerEvents = enabled ? "auto" : "none";

  // Status HUD styles - adapts for orientation using layout config
  const statusHudStyle: CSSProperties = (() => {
    const pos = uiSizes.statusHud.position;
    if (pos === "left-center") {
      return {
        position: "fixed",
        top: "50%",
        left: safeAreaInsets.left + 8,
        transform: "translateY(-50%)",
        pointerEvents: uiPointerEvents,
        zIndex: zIndex.mobileStatusHud,
      };
    }
    // Default: top-left
    return {
      position: "fixed",
      top: safeAreaInsets.top + 8,
      left: safeAreaInsets.left + 8,
      pointerEvents: uiPointerEvents,
      zIndex: zIndex.mobileStatusHud,
    };
  })();

  // Calculate chat height for action bar positioning
  const chatHeightPx = chatVisible ? uiSizes.chat.height + 40 : 0;

  // Action bar container styles - responsive based on layout mode
  const actionBarStyle: CSSProperties = (() => {
    const pos = uiSizes.actionBar.position;
    const isVertical = uiSizes.actionBar.orientation === "vertical";

    if (pos === "left-side" && isVertical) {
      // Mobile: vertical action bar in bottom-left corner, touching edges
      return {
        position: "fixed",
        left: safeAreaInsets.left,
        bottom: safeAreaInsets.bottom + chatHeightPx,
        display: "flex",
        flexDirection: "column",
        pointerEvents: uiPointerEvents,
        zIndex: zIndex.mobileActionBar,
        transition: "bottom 0.2s ease-out",
      };
    }
    if (pos === "right-side" && isVertical) {
      // Landscape tablet: vertical action bar on right
      return {
        position: "fixed",
        right: safeAreaInsets.right + 8,
        top: "50%",
        transform: "translateY(-50%)",
        display: "flex",
        flexDirection: "column",
        pointerEvents: uiPointerEvents,
        zIndex: zIndex.mobileActionBar,
      };
    }
    // Default: bottom-center horizontal
    return {
      position: "fixed",
      bottom: safeAreaInsets.bottom + 8 + chatHeightPx,
      left: "50%",
      transform: "translateX(-50%)",
      pointerEvents: uiPointerEvents,
      zIndex: zIndex.mobileActionBar,
      transition: "bottom 0.2s ease-out",
    };
  })();

  return (
    <div style={containerStyle}>
      {/* Game viewport (children) - only render wrapper if children exist */}
      {children && (
        <div
          style={{
            flex: 1,
            pointerEvents: "auto", // Game canvas receives clicks
          }}
        >
          {children}
        </div>
      )}

      {/* Compact Status HUD (top-left) */}
      <div style={statusHudStyle}>
        <CompactStatusHUD
          health={playerStats?.health}
          prayerPoints={playerStats?.prayerPoints}
        />
      </div>

      {/* Action Panel - inventory quick-access with vertical orientation on mobile */}
      <div style={actionBarStyle}>
        <ActionPanel
          items={inventory}
          onItemMove={handleItemMove}
          orientation={uiSizes.actionBar.orientation}
        />
      </div>

      {/* Radial Minimap Menu */}
      <RadialMinimapMenu
        world={world}
        onButtonClick={handleRadialButtonClick}
        activePanel={activePanel}
        chatVisible={chatVisible}
      />

      {/* Responsive sliding panel - position based on layout mode */}
      {activePanel !== null && activePanel !== "chat" && (
        <div
          style={(() => {
            const panelPos = uiSizes.panel.position;
            const baseStyles: CSSProperties = {
              position: "fixed",
              width: getPanelWidth(activePanel),
              maxWidth: uiSizes.panel.maxWidth,
              height: `${getPanelHeight(activePanel)}vh`,
              maxHeight: uiSizes.panel.maxHeight,
              backgroundColor: theme.colors.background.overlay,
              borderRadius: 0,
              boxShadow: theme.shadows.lg,
              zIndex: zIndex.mobileDrawer + 10,
              display: "flex",
              flexDirection: "column",
              pointerEvents: "auto",
              backdropFilter: "blur(8px)",
              WebkitBackdropFilter: "blur(8px)",
            };

            if (panelPos.anchor === "left-side") {
              // Landscape: left-side panel
              return {
                ...baseStyles,
                left: 0,
                top: safeAreaInsets.top,
                bottom: 0,
                height: "auto",
                maxHeight: "none",
                borderRight: `1px solid ${theme.colors.border.default}`,
                borderTop: "none",
                borderLeft: "none",
                animation: "slideInFromLeft 0.2s ease-out",
              };
            }
            // Default: bottom-right panel
            return {
              ...baseStyles,
              right: 0,
              bottom: 0,
              borderLeft: `1px solid ${theme.colors.border.default}`,
              borderTop: `1px solid ${theme.colors.border.default}`,
              animation: "slideInFromRight 0.2s ease-out",
            };
          })()}
        >
          {/* Panel Header - compact */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
              borderBottom: `1px solid ${theme.colors.border.default}`,
              flexShrink: 0,
              backgroundColor: theme.colors.background.secondary,
            }}
          >
            <span
              style={{
                color: theme.colors.text.primary,
                fontWeight: 600,
                fontSize: theme.typography.fontSize.sm,
              }}
            >
              {getPanelTitle(activePanel)}
            </span>
            <button
              onClick={handlePanelClose}
              style={{
                width: 24,
                height: 24,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "transparent",
                border: "none",
                color: theme.colors.text.secondary,
                cursor: "pointer",
              }}
              aria-label="Close panel"
            >
              <X size={16} />
            </button>
          </div>

          {/* Panel Content */}
          <div
            style={{
              flex: 1,
              overflow: "auto",
              overscrollBehavior: "contain",
            }}
          >
            {renderPanelContent()}
          </div>
        </div>
      )}

      {/* Chat Panel - responsive positioning based on layout mode */}
      {chatVisible && (
        <div
          style={(() => {
            const chatPos = uiSizes.chat.position;
            const chatW = uiSizes.chat.width;

            if (chatPos === "left-side") {
              // Landscape: left-side panel
              return {
                position: "fixed" as const,
                left: 0,
                top: safeAreaInsets.top,
                bottom: 0,
                width: typeof chatW === "number" ? chatW : "35%",
                backgroundColor: theme.colors.background.overlay,
                borderRight: `1px solid ${theme.colors.border.default}`,
                zIndex: zIndex.mobileDrawer - 10,
                display: "flex",
                flexDirection: "column" as const,
                pointerEvents: "auto" as const,
                animation: "slideInFromLeft 0.15s ease-out",
              };
            }
            // Default: bottom full-width
            return {
              position: "fixed" as const,
              bottom: 0,
              left: 0,
              right: 0,
              height: uiSizes.chat.height + 40,
              backgroundColor: theme.colors.background.overlay,
              borderTop: `1px solid ${theme.colors.border.default}`,
              zIndex: zIndex.mobileDrawer - 10,
              display: "flex",
              flexDirection: "column" as const,
              pointerEvents: "auto" as const,
              animation: "slideInFromBottom 0.15s ease-out",
            };
          })()}
        >
          {/* Chat Header - minimal */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: `4px ${theme.spacing.sm}px`,
              borderBottom: `1px solid ${theme.colors.border.default}`,
              flexShrink: 0,
              backgroundColor: theme.colors.background.secondary,
            }}
          >
            <span
              style={{
                color: theme.colors.text.secondary,
                fontWeight: 500,
                fontSize: "11px",
                textTransform: "uppercase",
                letterSpacing: "0.5px",
              }}
            >
              Chat
            </span>
            <button
              onClick={() => setChatVisible(false)}
              style={{
                width: 20,
                height: 20,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "transparent",
                border: "none",
                color: theme.colors.text.muted,
                cursor: "pointer",
              }}
              aria-label="Close chat"
            >
              <X size={14} />
            </button>
          </div>
          {/* Chat Content - more space for messages */}
          <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
            {renderPanel("chat")}
          </div>
        </div>
      )}

      {/* Modal Panels */}
      {bankData?.visible && (
        <ModalWindow
          visible={true}
          onClose={() => setBankData(null)}
          title="Bank"
          maxWidth="95vw"
          maxHeight="90vh"
        >
          <BankPanel
            world={world}
            items={bankData.items}
            tabs={bankData.tabs}
            inventory={inventory}
            alwaysSetPlaceholder={bankData.alwaysSetPlaceholder}
            maxSlots={bankData.maxSlots}
            coins={coins}
            onClose={() => setBankData(null)}
          />
        </ModalWindow>
      )}

      {storeData?.visible && (
        <ModalWindow
          visible={true}
          onClose={() => setStoreData(null)}
          title={storeData.storeName}
          maxWidth="95vw"
          maxHeight="90vh"
        >
          <StorePanel
            world={world}
            storeId={storeData.storeId}
            storeName={storeData.storeName}
            buybackRate={storeData.buybackRate}
            items={storeData.items}
            inventory={inventory}
            coins={coins}
            npcEntityId={storeData.npcEntityId}
            onClose={() => setStoreData(null)}
          />
        </ModalWindow>
      )}

      {dialogueData?.visible && (
        <ModalWindow
          visible={true}
          onClose={() => setDialogueData(null)}
          title={dialogueData.npcName}
          maxWidth="90vw"
          maxHeight="80vh"
        >
          <DialoguePanel
            visible={true}
            world={world}
            npcId={dialogueData.npcId}
            npcName={dialogueData.npcName}
            text={dialogueData.text}
            responses={dialogueData.responses}
            npcEntityId={dialogueData.npcEntityId}
            onSelectResponse={(index, response) => {
              // Send response to server - the panel handles this internally,
              // but we can also track it here if needed
              console.log(
                `[MobileUI] Dialogue response selected: ${index} - ${response.text}`,
              );
            }}
            onClose={() => setDialogueData(null)}
          />
        </ModalWindow>
      )}

      {smeltingData?.visible && (
        <ModalWindow
          visible={true}
          onClose={() => setSmeltingData(null)}
          title="Smelting"
          maxWidth="90vw"
          maxHeight="80vh"
        >
          <SmeltingPanel
            world={world}
            furnaceId={smeltingData.furnaceId}
            availableBars={smeltingData.availableBars}
            onClose={() => setSmeltingData(null)}
          />
        </ModalWindow>
      )}

      {smithingData?.visible && (
        <ModalWindow
          visible={true}
          onClose={() => setSmithingData(null)}
          title="Smithing"
          maxWidth="90vw"
          maxHeight="80vh"
        >
          <SmithingPanel
            world={world}
            anvilId={smithingData.anvilId}
            availableRecipes={smithingData.availableRecipes}
            onClose={() => setSmithingData(null)}
          />
        </ModalWindow>
      )}

      {lootWindowData?.visible && (
        <ModalWindow
          visible={true}
          onClose={() => setLootWindowData(null)}
          title={`Loot: ${lootWindowData.corpseName}`}
          maxWidth="90vw"
          maxHeight="60vh"
        >
          <LootWindowPanel
            visible={true}
            world={world}
            corpseId={lootWindowData.corpseId}
            corpseName={lootWindowData.corpseName}
            lootItems={lootWindowData.lootItems}
            onClose={() => setLootWindowData(null)}
          />
        </ModalWindow>
      )}

      {questStartData?.visible && (
        <ModalWindow
          visible={true}
          onClose={() => setQuestStartData(null)}
          title="New Quest"
          maxWidth="90vw"
          maxHeight="80vh"
        >
          <QuestStartPanel
            visible={true}
            questId={questStartData.questId}
            questName={questStartData.questName}
            description={questStartData.description}
            difficulty={questStartData.difficulty}
            requirements={questStartData.requirements}
            rewards={questStartData.rewards}
            onAccept={() => {
              if (world.network?.send) {
                world.network.send("questAccept", {
                  questId: questStartData.questId,
                });
              }
              setQuestStartData(null);
            }}
            onDecline={() => setQuestStartData(null)}
          />
        </ModalWindow>
      )}

      {questCompleteData?.visible && (
        <ModalWindow
          visible={true}
          onClose={() => setQuestCompleteData(null)}
          title="Quest Complete!"
          maxWidth="90vw"
          maxHeight="80vh"
        >
          <QuestCompletePanel
            visible={true}
            world={world}
            questName={questCompleteData.questName}
            rewards={questCompleteData.rewards}
            onClose={() => setQuestCompleteData(null)}
          />
        </ModalWindow>
      )}

      {xpLampData?.visible && (
        <ModalWindow
          visible={true}
          onClose={() => setXpLampData(null)}
          title="XP Lamp"
          maxWidth="80vw"
          maxHeight="60vh"
        >
          <XpLampPanel
            visible={true}
            world={world}
            itemId={xpLampData.itemId}
            slot={xpLampData.slot}
            xpAmount={xpLampData.xpAmount}
            stats={playerStats}
            onClose={() => setXpLampData(null)}
          />
        </ModalWindow>
      )}
    </div>
  );
}

export default MobileInterfaceManager;
