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
  CRAFTING_CLOSE: "craftingClose",
  TANNING_CLOSE: "tanningClose",
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

/** Crafting recipe structure */
export interface CraftingRecipeData {
  output: string;
  name: string;
  category: string;
  inputs: Array<{ item: string; amount: number }>;
  tools: string[];
  level: number;
  xp: number;
  meetsLevel: boolean;
  hasInputs: boolean;
}

/** Crafting data structure */
export interface CraftingData {
  visible: boolean;
  availableRecipes: CraftingRecipeData[];
  station: string;
}

/** Tanning recipe structure */
export interface TanningRecipeData {
  input: string;
  output: string;
  cost: number;
  name: string;
  hasHide: boolean;
  hideCount: number;
}

/** Tanning data structure */
export interface TanningData {
  visible: boolean;
  availableRecipes: TanningRecipeData[];
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

/** Duel panel data structure */
export interface DuelData {
  visible: boolean;
  duelId: string;
  opponentId: string;
  opponentName: string;
  isChallenger: boolean;
  screenState: "RULES" | "STAKES" | "CONFIRMING";
  rules: {
    noRanged: boolean;
    noMelee: boolean;
    noMagic: boolean;
    noSpecialAttack: boolean;
    noPrayer: boolean;
    noPotions: boolean;
    noFood: boolean;
    noForfeit: boolean;
    noMovement: boolean;
    funWeapons: boolean;
  };
  equipmentRestrictions: {
    head: boolean;
    cape: boolean;
    amulet: boolean;
    weapon: boolean;
    body: boolean;
    shield: boolean;
    legs: boolean;
    gloves: boolean;
    boots: boolean;
    ring: boolean;
    ammo: boolean;
  };
  myAccepted: boolean;
  opponentAccepted: boolean;
  myStakes: Array<{
    inventorySlot: number;
    itemId: string;
    quantity: number;
    value: number;
  }>;
  opponentStakes: Array<{
    inventorySlot: number;
    itemId: string;
    quantity: number;
    value: number;
  }>;
  opponentModifiedStakes: boolean;
}

/** Duel result data structure (shown after duel completes) */
export interface DuelResultData {
  visible: boolean;
  won: boolean;
  opponentName: string;
  itemsReceived: Array<{
    itemId: string;
    quantity: number;
    value: number;
  }>;
  itemsLost: Array<{
    itemId: string;
    quantity: number;
    value: number;
  }>;
  totalValueWon: number;
  totalValueLost: number;
  forfeit: boolean;
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
  craftingData: CraftingData | null;
  tanningData: TanningData | null;
  lootWindowData: LootWindowData | null;
  questStartData: QuestStartData | null;
  questCompleteData: QuestCompleteData | null;
  xpLampData: XpLampData | null;
  duelData: DuelData | null;
  duelResultData: DuelResultData | null;

  // Setters
  setBankData: React.Dispatch<React.SetStateAction<BankData | null>>;
  setStoreData: React.Dispatch<React.SetStateAction<StoreData | null>>;
  setDialogueData: React.Dispatch<React.SetStateAction<DialogueData | null>>;
  setSmeltingData: React.Dispatch<React.SetStateAction<SmeltingData | null>>;
  setSmithingData: React.Dispatch<React.SetStateAction<SmithingData | null>>;
  setCraftingData: React.Dispatch<React.SetStateAction<CraftingData | null>>;
  setTanningData: React.Dispatch<React.SetStateAction<TanningData | null>>;
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
  setDuelData: React.Dispatch<React.SetStateAction<DuelData | null>>;
  setDuelResultData: React.Dispatch<
    React.SetStateAction<DuelResultData | null>
  >;

  // Close handlers
  closeBank: () => void;
  closeStore: () => void;
  closeDialogue: () => void;
  closeSmelting: () => void;
  closeSmithing: () => void;
  closeCrafting: () => void;
  closeTanning: () => void;
  closeLootWindow: () => void;
  closeQuestStart: () => void;
  closeQuestComplete: () => void;
  closeXpLamp: () => void;
  closeDuel: () => void;
  closeDuelResult: () => void;
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
  const [craftingData, setCraftingData] = useState<CraftingData | null>(null);
  const [tanningData, setTanningData] = useState<TanningData | null>(null);
  const [lootWindowData, setLootWindowData] = useState<LootWindowData | null>(
    null,
  );
  const [questStartData, setQuestStartData] = useState<QuestStartData | null>(
    null,
  );
  const [questCompleteData, setQuestCompleteData] =
    useState<QuestCompleteData | null>(null);
  const [xpLampData, setXpLampData] = useState<XpLampData | null>(null);
  const [duelData, setDuelData] = useState<DuelData | null>(null);
  const [duelResultData, setDuelResultData] = useState<DuelResultData | null>(
    null,
  );

  // Close handlers
  const closeBank = useCallback(() => setBankData(null), []);
  const closeStore = useCallback(() => setStoreData(null), []);
  const closeDialogue = useCallback(() => setDialogueData(null), []);
  const closeSmelting = useCallback(() => setSmeltingData(null), []);
  const closeSmithing = useCallback(() => setSmithingData(null), []);
  const closeCrafting = useCallback(() => setCraftingData(null), []);
  const closeTanning = useCallback(() => setTanningData(null), []);
  const closeLootWindow = useCallback(() => setLootWindowData(null), []);
  const closeQuestStart = useCallback(() => setQuestStartData(null), []);
  const closeQuestComplete = useCallback(() => setQuestCompleteData(null), []);
  const closeXpLamp = useCallback(() => setXpLampData(null), []);
  const closeDuel = useCallback(() => setDuelData(null), []);
  const closeDuelResult = useCallback(() => setDuelResultData(null), []);

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

    // Crafting handlers
    const handleCraftingOpen = (data: unknown) => {
      const d = data as CraftingData;
      if (d) setCraftingData({ ...d, visible: true });
    };

    const handleCraftingClose = () => setCraftingData(null);

    // Tanning handlers
    const handleTanningOpen = (data: unknown) => {
      const d = data as TanningData;
      if (d) setTanningData({ ...d, visible: true });
    };

    const handleTanningClose = () => setTanningData(null);

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

    // Default duel rules/equipment for new duels
    const defaultDuelRules = {
      noRanged: false,
      noMelee: false,
      noMagic: false,
      noSpecialAttack: false,
      noPrayer: false,
      noPotions: false,
      noFood: false,
      noForfeit: false,
      noMovement: false,
      funWeapons: false,
    };

    const defaultEquipmentRestrictions = {
      head: false,
      cape: false,
      amulet: false,
      weapon: false,
      body: false,
      shield: false,
      legs: false,
      gloves: false,
      boots: false,
      ring: false,
      ammo: false,
    };

    // UI_UPDATE handler for duel panel
    const handleUIUpdate = (data: unknown) => {
      const d = data as {
        component: string;
        data: Record<string, unknown>;
      };

      // Duel session started - open panel with default state
      if (d.component === "duel" && d.data?.isOpen) {
        const duelData = d.data as {
          duelId?: string;
          opponent?: { id: string; name: string };
          isChallenger?: boolean;
        };
        setDuelData({
          visible: true,
          duelId: duelData.duelId || "",
          opponentId: duelData.opponent?.id || "",
          opponentName: duelData.opponent?.name || "",
          isChallenger: duelData.isChallenger || false,
          screenState: "RULES",
          rules: { ...defaultDuelRules },
          equipmentRestrictions: { ...defaultEquipmentRestrictions },
          myAccepted: false,
          opponentAccepted: false,
          myStakes: [],
          opponentStakes: [],
          opponentModifiedStakes: false,
        });
      }

      // Duel rules updated
      if (d.component === "duelRulesUpdate") {
        const rulesData = d.data as {
          duelId: string;
          rules: Record<string, boolean>;
          challengerAccepted: boolean;
          targetAccepted: boolean;
          modifiedBy: string;
        };
        setDuelData((prev) => {
          if (!prev || prev.duelId !== rulesData.duelId) return prev;
          const isChallenger = prev.isChallenger;
          return {
            ...prev,
            rules: {
              noRanged: rulesData.rules.noRanged ?? prev.rules.noRanged,
              noMelee: rulesData.rules.noMelee ?? prev.rules.noMelee,
              noMagic: rulesData.rules.noMagic ?? prev.rules.noMagic,
              noSpecialAttack:
                rulesData.rules.noSpecialAttack ?? prev.rules.noSpecialAttack,
              noPrayer: rulesData.rules.noPrayer ?? prev.rules.noPrayer,
              noPotions: rulesData.rules.noPotions ?? prev.rules.noPotions,
              noFood: rulesData.rules.noFood ?? prev.rules.noFood,
              noForfeit: rulesData.rules.noForfeit ?? prev.rules.noForfeit,
              noMovement: rulesData.rules.noMovement ?? prev.rules.noMovement,
              funWeapons: rulesData.rules.funWeapons ?? prev.rules.funWeapons,
            },
            myAccepted: isChallenger
              ? rulesData.challengerAccepted
              : rulesData.targetAccepted,
            opponentAccepted: isChallenger
              ? rulesData.targetAccepted
              : rulesData.challengerAccepted,
          };
        });
      }

      // Duel equipment updated
      if (d.component === "duelEquipmentUpdate") {
        const equipData = d.data as {
          duelId: string;
          equipmentRestrictions: Record<string, boolean>;
          challengerAccepted: boolean;
          targetAccepted: boolean;
          modifiedBy: string;
        };
        setDuelData((prev) => {
          if (!prev || prev.duelId !== equipData.duelId) return prev;
          const isChallenger = prev.isChallenger;
          return {
            ...prev,
            equipmentRestrictions: {
              head:
                equipData.equipmentRestrictions.head ??
                prev.equipmentRestrictions.head,
              cape:
                equipData.equipmentRestrictions.cape ??
                prev.equipmentRestrictions.cape,
              amulet:
                equipData.equipmentRestrictions.amulet ??
                prev.equipmentRestrictions.amulet,
              weapon:
                equipData.equipmentRestrictions.weapon ??
                prev.equipmentRestrictions.weapon,
              body:
                equipData.equipmentRestrictions.body ??
                prev.equipmentRestrictions.body,
              shield:
                equipData.equipmentRestrictions.shield ??
                prev.equipmentRestrictions.shield,
              legs:
                equipData.equipmentRestrictions.legs ??
                prev.equipmentRestrictions.legs,
              gloves:
                equipData.equipmentRestrictions.gloves ??
                prev.equipmentRestrictions.gloves,
              boots:
                equipData.equipmentRestrictions.boots ??
                prev.equipmentRestrictions.boots,
              ring:
                equipData.equipmentRestrictions.ring ??
                prev.equipmentRestrictions.ring,
              ammo:
                equipData.equipmentRestrictions.ammo ??
                prev.equipmentRestrictions.ammo,
            },
            myAccepted: isChallenger
              ? equipData.challengerAccepted
              : equipData.targetAccepted,
            opponentAccepted: isChallenger
              ? equipData.targetAccepted
              : equipData.challengerAccepted,
          };
        });
      }

      // Duel acceptance updated
      if (d.component === "duelAcceptanceUpdate") {
        const acceptData = d.data as {
          duelId: string;
          challengerAccepted: boolean;
          targetAccepted: boolean;
          state: string;
          movedToStakes?: boolean;
        };
        setDuelData((prev) => {
          if (!prev || prev.duelId !== acceptData.duelId) return prev;
          const isChallenger = prev.isChallenger;
          return {
            ...prev,
            myAccepted: isChallenger
              ? acceptData.challengerAccepted
              : acceptData.targetAccepted,
            opponentAccepted: isChallenger
              ? acceptData.targetAccepted
              : acceptData.challengerAccepted,
          };
        });
      }

      // Duel stakes updated
      if (d.component === "duelStakesUpdate") {
        const stakesData = d.data as {
          duelId: string;
          challengerStakes: Array<{
            inventorySlot: number;
            itemId: string;
            quantity: number;
            value: number;
          }>;
          targetStakes: Array<{
            inventorySlot: number;
            itemId: string;
            quantity: number;
            value: number;
          }>;
          challengerAccepted: boolean;
          targetAccepted: boolean;
          modifiedBy: string;
        };
        setDuelData((prev) => {
          if (!prev || prev.duelId !== stakesData.duelId) return prev;
          const isChallenger = prev.isChallenger;
          const localPlayerId = prev.opponentId; // We need local player ID to check modifiedBy
          const opponentModified = stakesData.modifiedBy !== localPlayerId;
          return {
            ...prev,
            myStakes: isChallenger
              ? stakesData.challengerStakes
              : stakesData.targetStakes,
            opponentStakes: isChallenger
              ? stakesData.targetStakes
              : stakesData.challengerStakes,
            myAccepted: isChallenger
              ? stakesData.challengerAccepted
              : stakesData.targetAccepted,
            opponentAccepted: isChallenger
              ? stakesData.targetAccepted
              : stakesData.challengerAccepted,
            opponentModifiedStakes: opponentModified,
          };
        });
      }

      // Duel state changed (e.g., RULES -> STAKES -> CONFIRMING -> COUNTDOWN)
      if (d.component === "duelStateChange") {
        const stateData = d.data as {
          duelId: string;
          state: string;
        };
        setDuelData((prev) => {
          if (!prev || prev.duelId !== stateData.duelId) return prev;
          // Close panel for non-panel states (COUNTDOWN, FIGHTING, etc.)
          // The panel only displays RULES, STAKES, and CONFIRMING screens.
          // When the duel transitions to COUNTDOWN, the panel should close
          // and the countdown overlay takes over.
          const panelStates = new Set(["RULES", "STAKES", "CONFIRMING"]);
          if (!panelStates.has(stateData.state)) {
            return null;
          }
          return {
            ...prev,
            screenState: stateData.state as "RULES" | "STAKES" | "CONFIRMING",
            myAccepted: false,
            opponentAccepted: false,
          };
        });
      }

      // Duel closed/cancelled
      if (d.component === "duelClose" || d.component === "duelCancelled") {
        const closeData = d.data as {
          duelId?: string;
        };
        setDuelData((prev) => {
          if (!prev) return prev;
          // If duelId is specified, only close if it matches
          if (closeData.duelId && prev.duelId !== closeData.duelId) return prev;
          return null;
        });
      }

      // Duel completed - show result modal
      // Server sends pre-computed data for each player directly
      if (d.component === "duelCompleted") {
        const completedData = d.data as {
          duelId: string;
          won: boolean;
          opponentName: string;
          itemsReceived: Array<{
            itemId: string;
            quantity: number;
            value: number;
          }>;
          itemsLost: Array<{
            itemId: string;
            quantity: number;
            value: number;
          }>;
          totalValueWon: number;
          totalValueLost: number;
          forfeit: boolean;
        };

        // Close the duel panel first
        setDuelData(null);

        // Use the server's pre-computed data directly
        // Ensure arrays are never undefined to prevent React render errors
        setDuelResultData({
          visible: true,
          won: completedData.won,
          opponentName: completedData.opponentName || "Unknown",
          itemsReceived: completedData.itemsReceived || [],
          itemsLost: completedData.itemsLost || [],
          totalValueWon: completedData.totalValueWon || 0,
          totalValueLost: completedData.totalValueLost || 0,
          forfeit: completedData.forfeit || false,
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
    world.on(EventType.CRAFTING_INTERFACE_OPEN, handleCraftingOpen, undefined);
    world.on(EventType.TANNING_INTERFACE_OPEN, handleTanningOpen, undefined);
    world.on(EventType.CORPSE_CLICK, handleCorpseClick, undefined);
    world.on(EventType.QUEST_START_CONFIRM, handleQuestStartConfirm, undefined);
    world.on(EventType.QUEST_COMPLETED, handleQuestCompleted, undefined);
    world.on(EventType.XP_LAMP_USE_REQUEST, handleXpLampUseRequest, undefined);
    world.on(EventType.UI_UPDATE, handleUIUpdate, undefined);

    // Register network event listeners
    if (world.network) {
      world.network.on(NetworkEvents.LOOT_WINDOW, handleLootWindow);
      world.network.on(NetworkEvents.SMELTING_CLOSE, handleSmeltingClose);
      world.network.on(NetworkEvents.SMITHING_CLOSE, handleSmithingClose);
      world.network.on(NetworkEvents.CRAFTING_CLOSE, handleCraftingClose);
      world.network.on(NetworkEvents.TANNING_CLOSE, handleTanningClose);
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
        EventType.CRAFTING_INTERFACE_OPEN,
        handleCraftingOpen,
        undefined,
        undefined,
      );
      world.off(
        EventType.TANNING_INTERFACE_OPEN,
        handleTanningOpen,
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
      world.off(EventType.UI_UPDATE, handleUIUpdate, undefined, undefined);

      // Unregister network event listeners
      if (world.network) {
        world.network.off(NetworkEvents.LOOT_WINDOW, handleLootWindow);
        world.network.off(NetworkEvents.SMELTING_CLOSE, handleSmeltingClose);
        world.network.off(NetworkEvents.SMITHING_CLOSE, handleSmithingClose);
        world.network.off(NetworkEvents.CRAFTING_CLOSE, handleCraftingClose);
        world.network.off(NetworkEvents.TANNING_CLOSE, handleTanningClose);
      }
    };
  }, [world]);

  return {
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
    closeBank,
    closeStore,
    closeDialogue,
    closeSmelting,
    closeSmithing,
    closeCrafting,
    closeTanning,
    closeLootWindow,
    closeQuestStart,
    closeQuestComplete,
    closeXpLamp,
    closeDuel,
    closeDuelResult,
  };
}
