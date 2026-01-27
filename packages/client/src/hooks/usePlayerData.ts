/**
 * usePlayerData Hook
 *
 * Shared hook for subscribing to player data events (inventory, equipment, stats).
 * Used by both InterfaceManager and MobileInterfaceManager to eliminate duplication.
 *
 * @packageDocumentation
 */

import { useState, useEffect } from "react";
import { EventType, getItem } from "@hyperscape/shared";
import type { PlayerStats } from "@hyperscape/shared";
import type { ClientWorld, PlayerEquipmentItems } from "../types";
import type { RawEquipmentData, InventorySlotViewItem } from "../game/types";

/**
 * Hook return type for player data
 */
export interface PlayerDataState {
  /** Inventory items */
  inventory: InventorySlotViewItem[];
  /** Player equipment */
  equipment: PlayerEquipmentItems | null;
  /** Player stats (health, prayer, skills) */
  playerStats: PlayerStats | null;
  /** Coin count */
  coins: number;
  /** Setter for inventory */
  setInventory: React.Dispatch<React.SetStateAction<InventorySlotViewItem[]>>;
  /** Setter for equipment */
  setEquipment: React.Dispatch<
    React.SetStateAction<PlayerEquipmentItems | null>
  >;
  /** Setter for player stats */
  setPlayerStats: React.Dispatch<React.SetStateAction<PlayerStats | null>>;
  /** Setter for coins */
  setCoins: React.Dispatch<React.SetStateAction<number>>;
}

/**
 * usePlayerData - Subscribe to player data events
 *
 * Handles:
 * - Inventory updates (INVENTORY_UPDATED)
 * - Equipment updates (UI_EQUIPMENT_UPDATE)
 * - Stats updates (UI_UPDATE, STATS_UPDATE)
 * - Skills updates (SKILLS_UPDATED)
 * - Prayer updates (PRAYER_STATE_SYNC, PRAYER_POINTS_CHANGED)
 * - Initial data loading from network cache
 *
 * @param world - The game world instance
 * @returns Player data state and setters
 */
export function usePlayerData(world: ClientWorld | null): PlayerDataState {
  const [inventory, setInventory] = useState<InventorySlotViewItem[]>([]);
  const [equipment, setEquipment] = useState<PlayerEquipmentItems | null>(null);
  const [playerStats, setPlayerStats] = useState<PlayerStats | null>(null);
  const [coins, setCoins] = useState(0);

  // Extract playerId to add to dependency array - prevents stale closures
  const playerId = world?.entities?.player?.id;

  useEffect(() => {
    if (!world) return;

    // Inventory updates
    const handleInventory = (data: unknown) => {
      const invData = data as {
        playerId: string;
        items: InventorySlotViewItem[];
        coins: number;
      };
      // Only update if this inventory belongs to the local player (prevents cross-tab updates)
      if (playerId && invData.playerId && invData.playerId !== playerId) {
        return;
      }
      setInventory(invData.items || []);
      if (typeof invData.coins === "number") {
        setCoins(invData.coins);
      } else {
        // Calculate coins from inventory items
        const totalCoins = (invData.items || [])
          .filter((item) => item.itemId === "coins")
          .reduce((sum, item) => sum + item.quantity, 0);
        setCoins(totalCoins);
      }
    };

    // Coin updates
    const handleCoins = (data: unknown) => {
      const coinData = data as { playerId: string; coins: number };
      if (!playerId || coinData.playerId === playerId) {
        setCoins(coinData.coins);
      }
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

    // UI_UPDATE is the primary source for player stats
    // Merge with existing state to preserve prayer data (prayer is managed separately by PrayerSystem)
    const handleUIUpdate = (data: unknown) => {
      const update = data as { component: string; data: unknown };
      if (update.component === "player") {
        const newData = update.data as PlayerStats;
        setPlayerStats((prev) =>
          prev
            ? {
                ...newData,
                // Preserve existing prayer data if new data doesn't include it
                prayerPoints: newData.prayerPoints || prev.prayerPoints,
              }
            : newData,
        );
      }
    };

    // Stats updates (fallback/alternative event)
    // Merge with existing state to preserve prayer data
    const handleStats = (data: unknown) => {
      const newData = data as PlayerStats;
      setPlayerStats((prev) =>
        prev
          ? {
              ...newData,
              // Preserve existing prayer data if new data doesn't include it
              prayerPoints: newData.prayerPoints || prev.prayerPoints,
            }
          : newData,
      );
    };

    // Skills updates
    const handleSkillsUpdate = (data: unknown) => {
      const skillsData = data as {
        playerId: string;
        skills: PlayerStats["skills"];
      };
      if (!playerId || skillsData.playerId === playerId) {
        setPlayerStats((prev) =>
          prev
            ? { ...prev, skills: skillsData.skills }
            : ({ skills: skillsData.skills } as PlayerStats),
        );
      }
    };

    // Prayer state sync (full sync from server)
    const handlePrayerStateSync = (data: unknown) => {
      const syncData = data as {
        playerId: string;
        points: number;
        maxPoints: number;
        level?: number;
        active?: string[];
      };
      if (!playerId || syncData.playerId === playerId) {
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

    // Prayer points changed (from potions, altars, drain, etc.)
    const handlePrayerPointsChanged = (data: unknown) => {
      const prayerData = data as {
        playerId: string;
        points: number;
        maxPoints: number;
      };
      if (!playerId || prayerData.playerId === playerId) {
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

    // Register event listeners
    world.on(EventType.UI_UPDATE, handleUIUpdate, undefined);
    world.on(EventType.INVENTORY_UPDATED, handleInventory, undefined);
    world.on(EventType.INVENTORY_UPDATE_COINS, handleCoins, undefined);
    world.on(EventType.UI_EQUIPMENT_UPDATE, handleEquipment, undefined);
    world.on(EventType.STATS_UPDATE, handleStats, undefined);
    world.on(EventType.SKILLS_UPDATED, handleSkillsUpdate, undefined);
    world.on(EventType.PRAYER_STATE_SYNC, handlePrayerStateSync, undefined);
    world.on(
      EventType.PRAYER_POINTS_CHANGED,
      handlePrayerPointsChanged,
      undefined,
    );

    // Request initial data from cache - uses extracted playerId from deps
    const requestInitial = () => {
      if (!playerId) return false;

      // Get cached inventory
      const cachedInv = world.network?.lastInventoryByPlayerId?.[playerId];
      if (cachedInv && Array.isArray(cachedInv.items)) {
        setInventory(cachedInv.items as InventorySlotViewItem[]);
        setCoins(cachedInv.coins || 0);
      }

      // Get cached skills
      // Note: lastSkillsByPlayerId is typed as Record<string, { level: number; xp: number }>
      // but at runtime contains Skills data. The intermediate unknown is required because
      // TypeScript sees them as incompatible even though they're structurally similar.
      const cachedSkills = world.network?.lastSkillsByPlayerId?.[playerId];
      if (cachedSkills) {
        // Runtime: cachedSkills has skill-specific keys (attack, strength, etc.)
        const skills = cachedSkills as unknown as PlayerStats["skills"];
        setPlayerStats((prev) =>
          prev ? { ...prev, skills } : ({ skills } as PlayerStats),
        );
      }

      // Get cached equipment
      const cachedEquipment =
        world.network?.lastEquipmentByPlayerId?.[playerId];
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

      // Get cached prayer state
      const cachedPrayer = world.network?.lastPrayerStateByPlayerId?.[playerId];
      if (cachedPrayer) {
        setPlayerStats((prev) =>
          prev
            ? {
                ...prev,
                prayerPoints: {
                  current: cachedPrayer.points,
                  max: cachedPrayer.maxPoints,
                },
              }
            : ({
                prayerPoints: {
                  current: cachedPrayer.points,
                  max: cachedPrayer.maxPoints,
                },
              } as PlayerStats),
        );
      }

      // Get player entity for health/prayer
      // Entity has health/data properties at runtime that aren't fully exposed in the base type.
      // The intermediate unknown is required because Entity.maxHealth is protected.
      const playerEntity = world.entities?.player;
      if (playerEntity) {
        interface PlayerEntityData {
          health?: number;
          maxHealth?: number;
          data?: {
            health?: number;
            maxHealth?: number;
            prayerPoints?: number;
            maxPrayerPoints?: number;
          };
        }
        const entityData = playerEntity as unknown as PlayerEntityData;

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
      world.emit(EventType.INVENTORY_REQUEST, { playerId });
      return true;
    };

    // Try to get initial data immediately, or retry after a short delay
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    if (!requestInitial()) {
      timeoutId = setTimeout(() => requestInitial(), 400);
    }

    return () => {
      if (timeoutId !== null) clearTimeout(timeoutId);
      world.off(EventType.UI_UPDATE, handleUIUpdate, undefined, undefined);
      world.off(
        EventType.INVENTORY_UPDATED,
        handleInventory,
        undefined,
        undefined,
      );
      world.off(
        EventType.INVENTORY_UPDATE_COINS,
        handleCoins,
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
      world.off(
        EventType.SKILLS_UPDATED,
        handleSkillsUpdate,
        undefined,
        undefined,
      );
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
    };
  }, [world, playerId]);

  return {
    inventory,
    equipment,
    playerStats,
    coins,
    setInventory,
    setEquipment,
    setPlayerStats,
    setCoins,
  };
}
