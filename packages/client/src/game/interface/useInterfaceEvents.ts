/**
 * useInterfaceEvents Hook
 *
 * Handles additional UI events not covered by usePlayerData and useModalPanels.
 * This includes:
 * - UI_UPDATE routing for bank/store/dialogue/smelting/smithing (legacy event path)
 * - UI_OPEN_PANE for programmatic panel opening
 * - World map hotkey (M key)
 *
 * @packageDocumentation
 */

import { useEffect, useCallback, useState } from "react";
import { EventType } from "@hyperscape/shared";
import type { PlayerStats } from "@hyperscape/shared";
import type { ClientWorld, PlayerEquipmentItems } from "../../types";
import type { ModalPanelsState, PlayerDataState } from "@/hooks";

/**
 * useWorldMapHotkey - Handle M key to toggle world map
 *
 * @param onToggle - Callback when world map should be toggled
 */
export function useWorldMapHotkey(onToggle: () => void): void {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in an input field
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      // M key toggles world map
      if (e.key === "m" || e.key === "M") {
        e.preventDefault();
        onToggle();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onToggle]);
}

/**
 * useUIUpdateEvents - Handle legacy UI_UPDATE event routing
 *
 * The UI_UPDATE event is used by the server to push updates for various components.
 * This hook routes those updates to the appropriate state setters.
 *
 * @param world - The game world instance
 * @param playerDataSetters - Setters from usePlayerData
 * @param modalPanelSetters - Setters from useModalPanels
 */
export function useUIUpdateEvents(
  world: ClientWorld | null,
  playerDataSetters: Pick<PlayerDataState, "setPlayerStats" | "setEquipment">,
  modalPanelSetters: Pick<
    ModalPanelsState,
    | "setBankData"
    | "setStoreData"
    | "setDialogueData"
    | "setSmeltingData"
    | "setSmithingData"
    | "setCraftingData"
    | "setTanningData"
  >,
): void {
  const { setPlayerStats, setEquipment } = playerDataSetters;
  const {
    setBankData,
    setStoreData,
    setDialogueData,
    setSmeltingData,
    setSmithingData,
    setCraftingData,
    setTanningData,
  } = modalPanelSetters;

  useEffect(() => {
    if (!world) return;

    const onUIUpdate = (raw: unknown) => {
      const update = raw as { component: string; data: unknown };

      // Player stats update
      if (update.component === "player") {
        setPlayerStats(update.data as PlayerStats);
      }

      // Equipment update via UI_UPDATE
      if (update.component === "equipment") {
        interface EquipmentSlot {
          item?: unknown;
        }
        interface EquipmentUpdateData {
          equipment: Record<string, EquipmentSlot | null | undefined>;
        }
        const data = update.data as EquipmentUpdateData;
        const rawEq = data.equipment;
        const mappedEquipment: PlayerEquipmentItems = {
          weapon:
            (rawEq.weapon?.item as PlayerEquipmentItems["weapon"]) || null,
          shield:
            (rawEq.shield?.item as PlayerEquipmentItems["shield"]) || null,
          helmet:
            (rawEq.helmet?.item as PlayerEquipmentItems["helmet"]) || null,
          body: (rawEq.body?.item as PlayerEquipmentItems["body"]) || null,
          legs: (rawEq.legs?.item as PlayerEquipmentItems["legs"]) || null,
          boots: (rawEq.boots?.item as PlayerEquipmentItems["boots"]) || null,
          gloves:
            (rawEq.gloves?.item as PlayerEquipmentItems["gloves"]) || null,
          cape: (rawEq.cape?.item as PlayerEquipmentItems["cape"]) || null,
          amulet:
            (rawEq.amulet?.item as PlayerEquipmentItems["amulet"]) || null,
          ring: (rawEq.ring?.item as PlayerEquipmentItems["ring"]) || null,
          arrows:
            (rawEq.arrows?.item as PlayerEquipmentItems["arrows"]) || null,
        };
        setEquipment(mappedEquipment);
      }

      // Bank updates via UI_UPDATE (legacy path)
      if (update.component === "bank") {
        const data = update.data as {
          items?: Array<{
            itemId: string;
            quantity: number;
            slot: number;
            tabIndex?: number;
          }>;
          tabs?: Array<{ tabIndex: number; iconItemId: string | null }>;
          alwaysSetPlaceholder?: boolean;
          maxSlots?: number;
          bankId?: string;
          isOpen?: boolean;
        };
        if (data.isOpen === false) {
          setBankData(null);
        } else if (data.isOpen || data.items !== undefined) {
          const itemsWithTabIndex = (data.items || []).map((item) => ({
            ...item,
            tabIndex: item.tabIndex ?? 0,
          }));
          setBankData((prev) => ({
            visible: true,
            items:
              data.items !== undefined ? itemsWithTabIndex : prev?.items || [],
            tabs: data.tabs !== undefined ? data.tabs : prev?.tabs || [],
            alwaysSetPlaceholder:
              data.alwaysSetPlaceholder ?? prev?.alwaysSetPlaceholder ?? false,
            maxSlots: data.maxSlots ?? prev?.maxSlots ?? 480,
            bankId: data.bankId ?? prev?.bankId ?? "spawn_bank",
          }));
        }
      }

      // Store updates via UI_UPDATE (legacy path)
      if (update.component === "store") {
        const data = update.data as {
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
          isOpen?: boolean;
        };
        if (data.isOpen) {
          setStoreData({
            visible: true,
            storeId: data.storeId,
            storeName: data.storeName,
            buybackRate: data.buybackRate || 0.5,
            npcEntityId: data.npcEntityId,
            items: data.items || [],
          });
        } else {
          setStoreData(null);
        }
      }

      // Dialogue updates via UI_UPDATE (legacy path)
      if (update.component === "dialogue") {
        const data = update.data as {
          npcId: string;
          npcName: string;
          text: string;
          responses: Array<{
            text: string;
            nextNodeId: string;
            effect?: string;
          }>;
          npcEntityId?: string;
        };
        setDialogueData((prev) => ({
          visible: true,
          npcId: data.npcId,
          npcName: data.npcName || prev?.npcName || "NPC",
          text: data.text,
          responses: data.responses || [],
          npcEntityId: data.npcEntityId || prev?.npcEntityId,
        }));
      }

      if (update.component === "dialogueEnd") {
        setDialogueData(null);
      }

      // Smelting updates via UI_UPDATE (legacy path)
      if (update.component === "smelting") {
        const data = update.data as {
          isOpen: boolean;
          furnaceId?: string;
          availableBars?: Array<{
            barItemId: string;
            levelRequired: number;
            primaryOre: string;
            secondaryOre: string | null;
            coalRequired: number;
          }>;
        };
        if (data.isOpen && data.furnaceId && data.availableBars) {
          setSmeltingData({
            visible: true,
            furnaceId: data.furnaceId,
            availableBars: data.availableBars,
          });
        } else {
          setSmeltingData(null);
        }
      }

      // Smithing updates via UI_UPDATE (legacy path)
      if (update.component === "smithing") {
        const data = update.data as {
          isOpen: boolean;
          anvilId?: string;
          availableRecipes?: Array<{
            itemId: string;
            name: string;
            barType: string;
            barsRequired: number;
            levelRequired: number;
            xp: number;
            category: string;
          }>;
        };
        if (data.isOpen && data.anvilId && data.availableRecipes) {
          setSmithingData({
            visible: true,
            anvilId: data.anvilId,
            availableRecipes: data.availableRecipes,
          });
        } else {
          setSmithingData(null);
        }
      }

      // Crafting updates via UI_UPDATE
      if (update.component === "crafting") {
        const data = update.data as {
          isOpen: boolean;
          availableRecipes?: Array<{
            output: string;
            name: string;
            category: string;
            inputs: Array<{ item: string; amount: number }>;
            tools: string[];
            level: number;
            xp: number;
            meetsLevel: boolean;
            hasInputs: boolean;
          }>;
          station?: string;
        };
        if (data.isOpen && data.availableRecipes) {
          setCraftingData({
            visible: true,
            availableRecipes: data.availableRecipes,
            station: data.station || "",
          });
        } else {
          setCraftingData(null);
        }
      }

      if (update.component === "craftingClose") {
        setCraftingData(null);
      }

      // Tanning updates via UI_UPDATE
      if (update.component === "tanning") {
        const data = update.data as {
          isOpen: boolean;
          availableRecipes?: Array<{
            input: string;
            output: string;
            cost: number;
            name: string;
            hasHide: boolean;
            hideCount: number;
          }>;
        };
        if (data.isOpen && data.availableRecipes) {
          setTanningData({
            visible: true,
            availableRecipes: data.availableRecipes,
          });
        } else {
          setTanningData(null);
        }
      }

      if (update.component === "tanningClose") {
        setTanningData(null);
      }
    };

    world.on(EventType.UI_UPDATE, onUIUpdate);

    return () => {
      world.off(EventType.UI_UPDATE, onUIUpdate);
    };
  }, [
    world,
    setPlayerStats,
    setEquipment,
    setBankData,
    setStoreData,
    setDialogueData,
    setSmeltingData,
    setSmithingData,
    setCraftingData,
    setTanningData,
  ]);
}

/**
 * useOpenPaneEvent - Handle UI_OPEN_PANE event for programmatic panel opening
 *
 * @param world - The game world instance
 * @param onPanelClick - Callback to handle panel opening
 */
export function useOpenPaneEvent(
  world: ClientWorld | null,
  onPanelClick: (panelId: string) => void,
): void {
  useEffect(() => {
    if (!world) return;

    const onOpenPane = (payload: unknown) => {
      const data = payload as { pane: string };
      if (data?.pane) {
        onPanelClick(data.pane);
      }
    };

    world.on(EventType.UI_OPEN_PANE, onOpenPane);
    return () => {
      world.off(EventType.UI_OPEN_PANE, onOpenPane);
    };
  }, [world, onPanelClick]);
}

/**
 * useInterfaceUIState - Simple UI state for modal toggles
 *
 * @returns UI state and setters
 */
export function useInterfaceUIState() {
  const [worldMapOpen, setWorldMapOpen] = useState(false);
  const [statsModalOpen, setStatsModalOpen] = useState(false);
  const [deathModalOpen, setDeathModalOpen] = useState(false);

  const toggleWorldMap = useCallback(() => {
    setWorldMapOpen((prev) => !prev);
  }, []);

  return {
    worldMapOpen,
    setWorldMapOpen,
    statsModalOpen,
    setStatsModalOpen,
    deathModalOpen,
    setDeathModalOpen,
    toggleWorldMap,
  };
}
