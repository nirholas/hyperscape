/**
 * useModalPanels Hook
 *
 * Manages modal panel states for game UI overlays.
 * Extracted from InterfaceManager and MobileInterfaceManager.
 *
 * Modal panels are UI overlays that appear on top of the game:
 * - Bank, Store, Dialogue
 * - Smelting, Smithing (crafting interfaces)
 * - Quest start/complete screens
 * - XP Lamp selection
 * - Loot window
 *
 * @packageDocumentation
 */

import { useState, useEffect, useCallback } from "react";
import { EventType } from "@hyperscape/shared";
import type { InventoryItem } from "@hyperscape/shared";
import type { ClientWorld } from "../types";
import { NetworkEvents } from "../types";

// ============================================================================
// Modal Panel Type Definitions
// ============================================================================

export interface LootWindowData {
  visible: boolean;
  corpseId: string;
  corpseName: string;
  lootItems: InventoryItem[];
}

export interface BankData {
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
}

export interface StoreData {
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
}

export interface DialogueData {
  visible: boolean;
  npcId: string;
  npcName: string;
  text: string;
  responses: Array<{ text: string; nextNodeId: string; effect?: string }>;
  npcEntityId?: string;
}

export interface SmeltingData {
  visible: boolean;
  furnaceId: string;
  availableBars: Array<{
    barItemId: string;
    levelRequired: number;
    primaryOre: string;
    secondaryOre: string | null;
    coalRequired: number;
  }>;
}

export interface SmithingData {
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
}

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

export interface QuestCompleteData {
  visible: boolean;
  questName: string;
  rewards: {
    questPoints: number;
    items: Array<{ itemId: string; quantity: number }>;
    xp: Record<string, number>;
  };
}

export interface XpLampData {
  visible: boolean;
  itemId: string;
  slot: number;
  xpAmount: number;
}

// ============================================================================
// Hook Result Interface
// ============================================================================

export interface ModalPanelsResult {
  // State
  lootWindowData: LootWindowData | null;
  bankData: BankData | null;
  storeData: StoreData | null;
  dialogueData: DialogueData | null;
  smeltingData: SmeltingData | null;
  smithingData: SmithingData | null;
  questStartData: QuestStartData | null;
  questCompleteData: QuestCompleteData | null;
  xpLampData: XpLampData | null;

  // Setters
  setLootWindowData: React.Dispatch<
    React.SetStateAction<LootWindowData | null>
  >;
  setBankData: React.Dispatch<React.SetStateAction<BankData | null>>;
  setStoreData: React.Dispatch<React.SetStateAction<StoreData | null>>;
  setDialogueData: React.Dispatch<React.SetStateAction<DialogueData | null>>;
  setSmeltingData: React.Dispatch<React.SetStateAction<SmeltingData | null>>;
  setSmithingData: React.Dispatch<React.SetStateAction<SmithingData | null>>;
  setQuestStartData: React.Dispatch<
    React.SetStateAction<QuestStartData | null>
  >;
  setQuestCompleteData: React.Dispatch<
    React.SetStateAction<QuestCompleteData | null>
  >;
  setXpLampData: React.Dispatch<React.SetStateAction<XpLampData | null>>;

  // Close handlers
  closeLootWindow: () => void;
  closeBank: () => void;
  closeStore: () => void;
  closeDialogue: () => void;
  closeSmelting: () => void;
  closeSmithing: () => void;
  closeQuestStart: () => void;
  closeQuestComplete: () => void;
  closeXpLamp: () => void;
}

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Hook for managing modal panel states.
 *
 * @param world - The ClientWorld instance
 * @returns Modal panel states, setters, and close handlers
 */
export function useModalPanels(
  world: ClientWorld | undefined,
): ModalPanelsResult {
  // State declarations
  const [lootWindowData, setLootWindowData] = useState<LootWindowData | null>(
    null,
  );
  const [bankData, setBankData] = useState<BankData | null>(null);
  const [storeData, setStoreData] = useState<StoreData | null>(null);
  const [dialogueData, setDialogueData] = useState<DialogueData | null>(null);
  const [smeltingData, setSmeltingData] = useState<SmeltingData | null>(null);
  const [smithingData, setSmithingData] = useState<SmithingData | null>(null);
  const [questStartData, setQuestStartData] = useState<QuestStartData | null>(
    null,
  );
  const [questCompleteData, setQuestCompleteData] =
    useState<QuestCompleteData | null>(null);
  const [xpLampData, setXpLampData] = useState<XpLampData | null>(null);

  // Close handlers
  const closeLootWindow = useCallback(() => setLootWindowData(null), []);
  const closeBank = useCallback(() => setBankData(null), []);
  const closeStore = useCallback(() => setStoreData(null), []);
  const closeDialogue = useCallback(() => setDialogueData(null), []);
  const closeSmelting = useCallback(() => setSmeltingData(null), []);
  const closeSmithing = useCallback(() => setSmithingData(null), []);
  const closeQuestStart = useCallback(() => setQuestStartData(null), []);
  const closeQuestComplete = useCallback(() => setQuestCompleteData(null), []);
  const closeXpLamp = useCallback(() => setXpLampData(null), []);

  useEffect(() => {
    if (!world) return;

    // Event handlers
    const handleLootWindow = (data: unknown) => {
      const d = data as Omit<LootWindowData, "visible">;
      setLootWindowData({ visible: true, ...d });
    };

    const handleBank = (data: unknown) => {
      const d = data as Omit<BankData, "visible">;
      if (d) setBankData({ ...d, visible: true });
    };

    const handleStore = (data: unknown) => {
      const d = data as Omit<StoreData, "visible">;
      if (d) setStoreData({ ...d, visible: true });
    };

    const handleDialogue = (data: unknown) => {
      const d = data as Omit<DialogueData, "visible">;
      if (d) setDialogueData({ ...d, visible: true });
    };

    const handleSmelting = (data: unknown) => {
      const d = data as Omit<SmeltingData, "visible">;
      if (d) setSmeltingData({ ...d, visible: true });
    };

    const handleSmithing = (data: unknown) => {
      const d = data as Omit<SmithingData, "visible">;
      if (d) setSmithingData({ ...d, visible: true });
    };

    const handleQuestStart = (data: unknown) => {
      const d = data as Omit<QuestStartData, "visible">;
      if (d) setQuestStartData({ ...d, visible: true });
    };

    const handleQuestComplete = (data: unknown) => {
      const d = data as Omit<QuestCompleteData, "visible">;
      if (d) setQuestCompleteData({ ...d, visible: true });
    };

    const handleXpLamp = (data: unknown) => {
      const d = data as Omit<XpLampData, "visible">;
      if (d) setXpLampData({ ...d, visible: true });
    };

    // Subscribe to world events
    world.on(EventType.BANK_OPEN, handleBank, undefined);
    world.on(EventType.BANK_CLOSE, closeBank, undefined);
    world.on(EventType.STORE_OPEN, handleStore, undefined);
    world.on(EventType.STORE_CLOSE, closeStore, undefined);
    world.on(EventType.DIALOGUE_START, handleDialogue, undefined);
    world.on(EventType.DIALOGUE_END, closeDialogue, undefined);
    world.on(EventType.SMELTING_INTERFACE_OPEN, handleSmelting, undefined);
    world.on(EventType.SMITHING_INTERFACE_OPEN, handleSmithing, undefined);
    world.on(EventType.QUEST_START_CONFIRM, handleQuestStart, undefined);
    world.on(EventType.QUEST_COMPLETED, handleQuestComplete, undefined);
    world.on(EventType.XP_LAMP_USE_REQUEST, handleXpLamp, undefined);

    // Also subscribe to network events for loot window
    const network = world.network;
    if (network) {
      network.on(NetworkEvents.LOOT_WINDOW, handleLootWindow);
      network.on(NetworkEvents.SMELTING_CLOSE, closeSmelting);
      network.on(NetworkEvents.SMITHING_CLOSE, closeSmithing);
    }

    return () => {
      world.off(EventType.BANK_OPEN, handleBank, undefined, undefined);
      world.off(EventType.BANK_CLOSE, closeBank, undefined, undefined);
      world.off(EventType.STORE_OPEN, handleStore, undefined, undefined);
      world.off(EventType.STORE_CLOSE, closeStore, undefined, undefined);
      world.off(EventType.DIALOGUE_START, handleDialogue, undefined, undefined);
      world.off(EventType.DIALOGUE_END, closeDialogue, undefined, undefined);
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

      if (network) {
        network.off(NetworkEvents.LOOT_WINDOW, handleLootWindow);
        network.off(NetworkEvents.SMELTING_CLOSE, closeSmelting);
        network.off(NetworkEvents.SMITHING_CLOSE, closeSmithing);
      }
    };
  }, [
    world,
    closeBank,
    closeStore,
    closeDialogue,
    closeSmelting,
    closeSmithing,
  ]);

  return {
    // State
    lootWindowData,
    bankData,
    storeData,
    dialogueData,
    smeltingData,
    smithingData,
    questStartData,
    questCompleteData,
    xpLampData,
    // Setters
    setLootWindowData,
    setBankData,
    setStoreData,
    setDialogueData,
    setSmeltingData,
    setSmithingData,
    setQuestStartData,
    setQuestCompleteData,
    setXpLampData,
    // Close handlers
    closeLootWindow,
    closeBank,
    closeStore,
    closeDialogue,
    closeSmelting,
    closeSmithing,
    closeQuestStart,
    closeQuestComplete,
    closeXpLamp,
  };
}
