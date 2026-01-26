/**
 * useModalPanels Hook
 *
 * Shared hook for subscribing to modal panel events (bank, store, dialogue, etc.).
 * Used by both InterfaceManager and MobileInterfaceManager to eliminate duplication.
 *
 * @packageDocumentation
 */

import { useState, useEffect, useCallback } from "react";
import { EventType } from "@hyperscape/shared";
import type { InventoryItem } from "@hyperscape/shared";
import type { ClientWorld } from "../types";

/** Network event names for UI interactions */
const NetworkEvents = {
  LOOT_WINDOW: "lootWindow",
  SMELTING_CLOSE: "smeltingClose",
  SMITHING_CLOSE: "smithingClose",
} as const;

/** Bank item structure */
export interface BankItem {
  itemId: string;
  quantity: number;
  slot: number;
  tabIndex: number;
}

/** Bank tab structure */
export interface BankTab {
  tabIndex: number;
  iconItemId: string | null;
  items?: unknown[];
}

/** Bank data structure */
export interface BankData {
  visible: boolean;
  bankId: string;
  items: BankItem[];
  tabs: BankTab[];
  alwaysSetPlaceholder?: boolean;
  maxSlots: number;
}

/** Store item structure */
export interface StoreItem {
  id: string;
  itemId: string;
  name: string;
  price: number;
  stockQuantity: number;
  description?: string;
  category?: string;
}

/** Store data structure */
export interface StoreData {
  visible: boolean;
  storeId: string;
  storeName: string;
  buybackRate: number;
  items: StoreItem[];
  npcEntityId?: string;
}

/** Dialogue response structure */
export interface DialogueResponse {
  text: string;
  nextNodeId: string;
  effect?: string;
}

/** Dialogue data structure */
export interface DialogueData {
  visible: boolean;
  npcId: string;
  npcName: string;
  text: string;
  responses: DialogueResponse[];
  npcEntityId?: string;
}

/** Smelting bar structure */
export interface SmeltingBar {
  barItemId: string;
  levelRequired: number;
  primaryOre: string;
  secondaryOre: string | null;
  coalRequired: number;
}

/** Smelting data structure */
export interface SmeltingData {
  visible: boolean;
  furnaceId: string;
  availableBars: SmeltingBar[];
}

/** Smithing recipe structure */
export interface SmithingRecipe {
  itemId: string;
  name: string;
  barType: string;
  barsRequired: number;
  levelRequired: number;
  xp: number;
  category: string;
}

/** Smithing data structure */
export interface SmithingData {
  visible: boolean;
  anvilId: string;
  availableRecipes: SmithingRecipe[];
}

/** Loot window data structure */
export interface LootWindowData {
  visible: boolean;
  corpseId: string;
  corpseName: string;
  lootItems: InventoryItem[];
}

/** Quest start data structure */
export interface QuestStartData {
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
}

/** Quest complete data structure */
export interface QuestCompleteData {
  visible: boolean;
  questName: string;
  rewards: {
    questPoints: number;
    items: Array<{ itemId: string; quantity: number }>;
    xp: Record<string, number>;
  };
}

/** XP lamp data structure */
export interface XpLampData {
  visible: boolean;
  itemId: string;
  slot: number;
  xpAmount: number;
}

/**
 * Hook return type for modal panels
 */
export interface ModalPanelsState {
  // Panel data
  bankData: BankData | null;
  storeData: StoreData | null;
  dialogueData: DialogueData | null;
  smeltingData: SmeltingData | null;
  smithingData: SmithingData | null;
  lootWindowData: LootWindowData | null;
  questStartData: QuestStartData | null;
  questCompleteData: QuestCompleteData | null;
  xpLampData: XpLampData | null;

  // Setters
  setBankData: React.Dispatch<React.SetStateAction<BankData | null>>;
  setStoreData: React.Dispatch<React.SetStateAction<StoreData | null>>;
  setDialogueData: React.Dispatch<React.SetStateAction<DialogueData | null>>;
  setSmeltingData: React.Dispatch<React.SetStateAction<SmeltingData | null>>;
  setSmithingData: React.Dispatch<React.SetStateAction<SmithingData | null>>;
  setLootWindowData: React.Dispatch<
    React.SetStateAction<LootWindowData | null>
  >;
  setQuestStartData: React.Dispatch<
    React.SetStateAction<QuestStartData | null>
  >;
  setQuestCompleteData: React.Dispatch<
    React.SetStateAction<QuestCompleteData | null>
  >;
  setXpLampData: React.Dispatch<React.SetStateAction<XpLampData | null>>;

  // Close handlers
  closeBank: () => void;
  closeStore: () => void;
  closeDialogue: () => void;
  closeSmelting: () => void;
  closeSmithing: () => void;
  closeLootWindow: () => void;
  closeQuestStart: () => void;
  closeQuestComplete: () => void;
  closeXpLamp: () => void;
}

// Also export as ModalPanelsResult for backwards compatibility
export type ModalPanelsResult = ModalPanelsState;

/**
 * useModalPanels - Subscribe to modal panel events
 *
 * Handles:
 * - Bank open/close (BANK_OPEN, BANK_CLOSE)
 * - Store open/close (STORE_OPEN, STORE_CLOSE)
 * - Dialogue start/end (DIALOGUE_START, DIALOGUE_END)
 * - Smelting open/close (SMELTING_INTERFACE_OPEN, network smeltingClose)
 * - Smithing open/close (SMITHING_INTERFACE_OPEN, network smithingClose)
 * - Loot window (network lootWindow)
 * - Quest start/complete (QUEST_START_CONFIRM, QUEST_COMPLETED)
 * - XP lamp (XP_LAMP_USE_REQUEST)
 *
 * @param world - The game world instance
 * @returns Modal panel state and setters
 */
export function useModalPanels(world: ClientWorld | null): ModalPanelsState {
  const [bankData, setBankData] = useState<BankData | null>(null);
  const [storeData, setStoreData] = useState<StoreData | null>(null);
  const [dialogueData, setDialogueData] = useState<DialogueData | null>(null);
  const [smeltingData, setSmeltingData] = useState<SmeltingData | null>(null);
  const [smithingData, setSmithingData] = useState<SmithingData | null>(null);
  const [lootWindowData, setLootWindowData] = useState<LootWindowData | null>(
    null,
  );
  const [questStartData, setQuestStartData] = useState<QuestStartData | null>(
    null,
  );
  const [questCompleteData, setQuestCompleteData] =
    useState<QuestCompleteData | null>(null);
  const [xpLampData, setXpLampData] = useState<XpLampData | null>(null);

  // Close handlers
  const closeBank = useCallback(() => setBankData(null), []);
  const closeStore = useCallback(() => setStoreData(null), []);
  const closeDialogue = useCallback(() => setDialogueData(null), []);
  const closeSmelting = useCallback(() => setSmeltingData(null), []);
  const closeSmithing = useCallback(() => setSmithingData(null), []);
  const closeLootWindow = useCallback(() => setLootWindowData(null), []);
  const closeQuestStart = useCallback(() => setQuestStartData(null), []);
  const closeQuestComplete = useCallback(() => setQuestCompleteData(null), []);
  const closeXpLamp = useCallback(() => setXpLampData(null), []);

  useEffect(() => {
    if (!world) return;

    // Bank handlers
    const handleBankOpen = (data: unknown) => {
      const d = data as BankData;
      if (d) setBankData({ ...d, visible: true });
    };

    const handleBankClose = () => setBankData(null);

    // Store handlers
    const handleStoreOpen = (data: unknown) => {
      const d = data as StoreData;
      if (d) setStoreData({ ...d, visible: true });
    };

    const handleStoreClose = () => setStoreData(null);

    // Dialogue handlers
    const handleDialogueStart = (data: unknown) => {
      const d = data as DialogueData;
      if (d) setDialogueData({ ...d, visible: true });
    };

    const handleDialogueEnd = () => setDialogueData(null);

    // Smelting handlers
    const handleSmeltingOpen = (data: unknown) => {
      const d = data as SmeltingData;
      if (d) setSmeltingData({ ...d, visible: true });
    };

    const handleSmeltingClose = () => setSmeltingData(null);

    // Smithing handlers
    const handleSmithingOpen = (data: unknown) => {
      const d = data as SmithingData;
      if (d) setSmithingData({ ...d, visible: true });
    };

    const handleSmithingClose = () => setSmithingData(null);

    // Loot window handler
    const handleLootWindow = (data: unknown) => {
      const d = data as {
        corpseId: string;
        corpseName: string;
        lootItems: InventoryItem[];
      };
      setLootWindowData({ visible: true, ...d });
    };

    // Corpse click handler (alternative loot window trigger)
    const handleCorpseClick = (data: unknown) => {
      const d = data as {
        corpseId: string;
        playerId: string;
        lootItems?: Array<{ itemId: string; quantity: number }>;
        position: { x: number; y: number; z: number };
      };
      setLootWindowData({
        visible: true,
        corpseId: d.corpseId,
        corpseName: "Gravestone",
        lootItems:
          d.lootItems?.map((item, index) => ({
            id: `${d.corpseId}-${index}`,
            slot: index,
            itemId: item.itemId,
            quantity: item.quantity,
            metadata: null,
          })) || [],
      });
    };

    // Quest start handler
    const handleQuestStartConfirm = (data: unknown) => {
      const d = data as {
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
      };
      setQuestStartData({
        visible: true,
        questId: d.questId,
        questName: d.questName,
        description: d.description,
        difficulty: d.difficulty,
        requirements: d.requirements || { quests: [], skills: {}, items: [] },
        rewards: d.rewards || { questPoints: 0, items: [], xp: {} },
      });
    };

    // Quest complete handler
    const handleQuestCompleted = (data: unknown) => {
      const d = data as {
        playerId: string;
        questId: string;
        questName: string;
        rewards: {
          questPoints: number;
          items: Array<{ itemId: string; quantity: number }>;
          xp: Record<string, number>;
        };
      };
      const localId = world.entities?.player?.id;
      if (!localId || d.playerId === localId) {
        setQuestCompleteData({
          visible: true,
          questName: d.questName,
          rewards: d.rewards || { questPoints: 0, items: [], xp: {} },
        });
      }
    };

    // XP lamp handler
    const handleXpLampUseRequest = (data: unknown) => {
      const d = data as {
        playerId: string;
        itemId: string;
        slot: number;
        xpAmount: number;
      };
      const localId = world.entities?.player?.id;
      if (!localId || d.playerId === localId) {
        setXpLampData({
          visible: true,
          itemId: d.itemId,
          slot: d.slot,
          xpAmount: d.xpAmount,
        });
      }
    };

    // Register world event listeners
    world.on(EventType.BANK_OPEN, handleBankOpen, undefined);
    world.on(EventType.BANK_CLOSE, handleBankClose, undefined);
    world.on(EventType.STORE_OPEN, handleStoreOpen, undefined);
    world.on(EventType.STORE_CLOSE, handleStoreClose, undefined);
    world.on(EventType.DIALOGUE_START, handleDialogueStart, undefined);
    world.on(EventType.DIALOGUE_END, handleDialogueEnd, undefined);
    world.on(EventType.SMELTING_INTERFACE_OPEN, handleSmeltingOpen, undefined);
    world.on(EventType.SMITHING_INTERFACE_OPEN, handleSmithingOpen, undefined);
    world.on(EventType.CORPSE_CLICK, handleCorpseClick, undefined);
    world.on(EventType.QUEST_START_CONFIRM, handleQuestStartConfirm, undefined);
    world.on(EventType.QUEST_COMPLETED, handleQuestCompleted, undefined);
    world.on(EventType.XP_LAMP_USE_REQUEST, handleXpLampUseRequest, undefined);

    // Register network event listeners
    if (world.network) {
      world.network.on(NetworkEvents.LOOT_WINDOW, handleLootWindow);
      world.network.on(NetworkEvents.SMELTING_CLOSE, handleSmeltingClose);
      world.network.on(NetworkEvents.SMITHING_CLOSE, handleSmithingClose);
    }

    return () => {
      // Unregister world event listeners
      world.off(EventType.BANK_OPEN, handleBankOpen, undefined, undefined);
      world.off(EventType.BANK_CLOSE, handleBankClose, undefined, undefined);
      world.off(EventType.STORE_OPEN, handleStoreOpen, undefined, undefined);
      world.off(EventType.STORE_CLOSE, handleStoreClose, undefined, undefined);
      world.off(
        EventType.DIALOGUE_START,
        handleDialogueStart,
        undefined,
        undefined,
      );
      world.off(
        EventType.DIALOGUE_END,
        handleDialogueEnd,
        undefined,
        undefined,
      );
      world.off(
        EventType.SMELTING_INTERFACE_OPEN,
        handleSmeltingOpen,
        undefined,
        undefined,
      );
      world.off(
        EventType.SMITHING_INTERFACE_OPEN,
        handleSmithingOpen,
        undefined,
        undefined,
      );
      world.off(
        EventType.CORPSE_CLICK,
        handleCorpseClick,
        undefined,
        undefined,
      );
      world.off(
        EventType.QUEST_START_CONFIRM,
        handleQuestStartConfirm,
        undefined,
        undefined,
      );
      world.off(
        EventType.QUEST_COMPLETED,
        handleQuestCompleted,
        undefined,
        undefined,
      );
      world.off(
        EventType.XP_LAMP_USE_REQUEST,
        handleXpLampUseRequest,
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

  return {
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
    closeBank,
    closeStore,
    closeDialogue,
    closeSmelting,
    closeSmithing,
    closeLootWindow,
    closeQuestStart,
    closeQuestComplete,
    closeXpLamp,
  };
}
