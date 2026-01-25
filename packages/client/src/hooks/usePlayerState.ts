/**
 * usePlayerState Hook
 *
 * Manages player inventory, equipment, stats, and coins.
 * Extracted from InterfaceManager and MobileInterfaceManager to eliminate duplication.
 *
 * Handles:
 * - Initial data loading from network cache
 * - Event subscriptions for real-time updates
 * - Equipment processing from raw server format
 *
 * @packageDocumentation
 */

import { useState, useEffect, useCallback } from "react";
import { EventType } from "@hyperscape/shared";
import type { PlayerStats, PlayerEquipmentItems } from "@hyperscape/shared";
import type {
  ClientWorld,
  RawEquipmentData,
  InventorySlotViewItem,
} from "../types";
import { processRawEquipment } from "../utils";

/**
 * Result from usePlayerState hook
 */
export interface PlayerStateResult {
  /** Current inventory items */
  inventory: InventorySlotViewItem[];
  /** Current equipped items */
  equipment: PlayerEquipmentItems | null;
  /** Current player stats (health, skills, etc.) */
  playerStats: PlayerStats | null;
  /** Current coin count */
  coins: number;
  /** Update inventory (for optimistic updates) */
  setInventory: React.Dispatch<React.SetStateAction<InventorySlotViewItem[]>>;
  /** Update equipment */
  setEquipment: React.Dispatch<
    React.SetStateAction<PlayerEquipmentItems | null>
  >;
  /** Update player stats */
  setPlayerStats: React.Dispatch<React.SetStateAction<PlayerStats | null>>;
  /** Update coins */
  setCoins: React.Dispatch<React.SetStateAction<number>>;
}

/**
 * Hook for managing player state (inventory, equipment, stats, coins).
 *
 * @param world - The ClientWorld instance
 * @returns Player state and setters
 *
 * @example
 * ```tsx
 * const { inventory, equipment, playerStats, coins } = usePlayerState(world);
 * ```
 */
export function usePlayerState(
  world: ClientWorld | undefined,
): PlayerStateResult {
  const [inventory, setInventory] = useState<InventorySlotViewItem[]>([]);
  const [equipment, setEquipment] = useState<PlayerEquipmentItems | null>(null);
  const [playerStats, setPlayerStats] = useState<PlayerStats | null>(null);
  const [coins, setCoins] = useState<number>(0);

  // Handle inventory updates
  const handleInventory = useCallback((data: unknown) => {
    const invData = data as { items: InventorySlotViewItem[] };
    setInventory(invData.items || []);
    const totalCoins = (invData.items || [])
      .filter((item) => item.itemId === "coins")
      .reduce((sum, item) => sum + item.quantity, 0);
    setCoins(totalCoins);
  }, []);

  // Handle equipment updates
  const handleEquipment = useCallback((data: unknown) => {
    const rawEquipment = data as RawEquipmentData;
    setEquipment(processRawEquipment(rawEquipment));
  }, []);

  // Handle stats updates
  const handleStats = useCallback((data: unknown) => {
    setPlayerStats(data as PlayerStats);
  }, []);

  // Handle UI_UPDATE for player stats (primary source)
  const handleUIUpdate = useCallback((data: unknown) => {
    const update = data as { component: string; data: unknown };
    if (update.component === "player") {
      setPlayerStats(update.data as PlayerStats);
    }
  }, []);

  // Handle skills updates
  const handleSkillsUpdate = useCallback(
    (data: unknown) => {
      const skillsData = data as {
        playerId: string;
        skills: PlayerStats["skills"];
      };
      const localId = world?.entities?.player?.id;
      if (!localId || skillsData.playerId === localId) {
        setPlayerStats((prev) =>
          prev ? { ...prev, skills: skillsData.skills } : null,
        );
      }
    },
    [world?.entities?.player?.id],
  );

  useEffect(() => {
    if (!world) return;

    // Subscribe to events
    world.on(EventType.INVENTORY_UPDATED, handleInventory, undefined);
    world.on(EventType.UI_EQUIPMENT_UPDATE, handleEquipment, undefined);
    world.on(EventType.STATS_UPDATE, handleStats, undefined);
    world.on(EventType.UI_UPDATE, handleUIUpdate, undefined);
    world.on(EventType.SKILLS_UPDATED, handleSkillsUpdate, undefined);

    // Load initial data from cache
    const requestInitial = (): boolean => {
      const lp = world.entities?.player?.id;
      if (lp && world.network) {
        // Get cached inventory
        const cachedInv = world.network.lastInventoryByPlayerId?.[lp] as
          | { items?: InventorySlotViewItem[]; coins?: number }
          | undefined;
        if (cachedInv && Array.isArray(cachedInv.items)) {
          setInventory(cachedInv.items);
          setCoins(cachedInv.coins || 0);
        }

        // Get cached skills
        const cachedSkills = world.network.lastSkillsByPlayerId?.[lp];
        if (cachedSkills) {
          const skills = cachedSkills as unknown as PlayerStats["skills"];
          setPlayerStats((prev) =>
            prev ? { ...prev, skills } : ({ skills } as PlayerStats),
          );
        }

        // Get cached equipment
        const cachedEquipment = world.network.lastEquipmentByPlayerId?.[lp];
        if (cachedEquipment) {
          const rawEq = cachedEquipment as RawEquipmentData;
          setEquipment(processRawEquipment(rawEq));
        }

        // Get player entity for health/prayer
        const playerEntity = world.entities?.player;
        if (playerEntity) {
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
      if (timeoutId) clearTimeout(timeoutId);
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
      world.off(EventType.UI_UPDATE, handleUIUpdate, undefined, undefined);
      world.off(
        EventType.SKILLS_UPDATED,
        handleSkillsUpdate,
        undefined,
        undefined,
      );
    };
  }, [
    world,
    handleInventory,
    handleEquipment,
    handleStats,
    handleUIUpdate,
    handleSkillsUpdate,
  ]);

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
