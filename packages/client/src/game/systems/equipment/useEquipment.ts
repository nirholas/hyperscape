/**
 * Equipment State Hook
 *
 * Manages full equipment/paper doll state including
 * equip/unequip, stat calculation, and set bonuses.
 *
 * @packageDocumentation
 */

import { useState, useCallback, useMemo } from "react";
import type {
  EquipmentSlotType,
  EquipmentItemData,
  EquipmentState,
  EquipmentSet,
  ItemStats,
} from "./equipmentUtils";
import {
  createEmptyEquipment,
  canEquipInSlot,
  getConflictingSlots,
  findValidSlots,
  meetsRequirements,
  calculateTotalStats,
  calculateSetBonuses,
  calculateAverageItemLevel,
  calculateItemPower,
  getItemsNeedingRepair,
  EQUIPMENT_SLOTS,
} from "./equipmentUtils";

/** Equipment hook configuration */
export interface UseEquipmentConfig {
  /** Initial equipment state */
  initialEquipment?: Partial<EquipmentState>;
  /** Player level for requirement checks */
  playerLevel?: number;
  /** Equipment sets for bonus calculation */
  sets?: EquipmentSet[];
  /** Callback when item is equipped */
  onEquip?: (item: EquipmentItemData, slot: EquipmentSlotType) => void;
  /** Callback when item is unequipped */
  onUnequip?: (item: EquipmentItemData, slot: EquipmentSlotType) => void;
  /** Callback when equipment changes */
  onChange?: (equipment: EquipmentState) => void;
}

/** Equipment hook result */
export interface UseEquipmentResult {
  /** Current equipment state */
  equipment: EquipmentState;
  /** Total stats from all equipment */
  totalStats: ItemStats;
  /** Average item level */
  averageItemLevel: number;
  /** Active set bonuses */
  setBonuses: ReturnType<typeof calculateSetBonuses>;
  /** Items that need repair */
  itemsNeedingRepair: EquipmentItemData[];

  /** Equip an item to a slot */
  equipItem: (
    item: EquipmentItemData,
    slot?: EquipmentSlotType,
  ) => { success: boolean; unequipped: EquipmentItemData[]; error?: string };

  /** Unequip an item from a slot */
  unequipItem: (slot: EquipmentSlotType) => EquipmentItemData | null;

  /** Check if an item can be equipped */
  canEquip: (
    item: EquipmentItemData,
    slot?: EquipmentSlotType,
  ) => { canEquip: boolean; reason?: string };

  /** Find valid slots for an item */
  getValidSlots: (item: EquipmentItemData) => EquipmentSlotType[];

  /** Get item in a specific slot */
  getSlotItem: (slot: EquipmentSlotType) => EquipmentItemData | null;

  /** Swap items between two slots (if compatible) */
  swapSlots: (slotA: EquipmentSlotType, slotB: EquipmentSlotType) => boolean;

  /** Clear all equipment */
  clearAll: () => EquipmentItemData[];

  /** Set full equipment state */
  setEquipment: (equipment: Partial<EquipmentState>) => void;

  /** Calculate power score of equipped gear */
  calculateGearScore: () => number;
}

/**
 * Hook for managing equipment state
 *
 * @example
 * ```tsx
 * function EquipmentScreen() {
 *   const {
 *     equipment,
 *     totalStats,
 *     equipItem,
 *     unequipItem,
 *   } = useEquipment({
 *     playerLevel: 50,
 *     sets: EQUIPMENT_SETS,
 *     onEquip: (item, slot) => console.log(`Equipped ${item.name} to ${slot}`),
 *   });
 *
 *   return (
 *     <EquipmentPanel equipment={equipment} onSlotClick={handleSlotClick} />
 *   );
 * }
 * ```
 */
export function useEquipment(
  config: UseEquipmentConfig = {},
): UseEquipmentResult {
  const {
    initialEquipment,
    playerLevel = 1,
    sets = [],
    onEquip,
    onUnequip,
    onChange,
  } = config;

  const [equipment, setEquipmentState] = useState<EquipmentState>(() => ({
    ...createEmptyEquipment(),
    ...initialEquipment,
  }));

  // Calculate derived state
  const totalStats = useMemo(() => calculateTotalStats(equipment), [equipment]);

  const averageItemLevel = useMemo(
    () => calculateAverageItemLevel(equipment),
    [equipment],
  );

  const setBonuses = useMemo(
    () => calculateSetBonuses(equipment, sets),
    [equipment, sets],
  );

  const itemsNeedingRepair = useMemo(
    () => getItemsNeedingRepair(equipment),
    [equipment],
  );

  // Update equipment state with callbacks
  const updateEquipment = useCallback(
    (newEquipment: EquipmentState) => {
      setEquipmentState(newEquipment);
      onChange?.(newEquipment);
    },
    [onChange],
  );

  // Check if item can be equipped
  const canEquip = useCallback(
    (
      item: EquipmentItemData,
      slot?: EquipmentSlotType,
    ): { canEquip: boolean; reason?: string } => {
      // Check player level requirements
      const reqCheck = meetsRequirements(item, playerLevel);
      if (!reqCheck.canEquip) {
        return reqCheck;
      }

      // Find valid slots
      const validSlots = findValidSlots(item);
      if (validSlots.length === 0) {
        return {
          canEquip: false,
          reason: "No valid equipment slot for this item",
        };
      }

      // If specific slot requested, validate it
      if (slot) {
        if (!canEquipInSlot(item, slot)) {
          return { canEquip: false, reason: `Cannot equip to ${slot} slot` };
        }
      }

      return { canEquip: true };
    },
    [playerLevel],
  );

  // Get valid slots for an item
  const getValidSlots = useCallback(
    (item: EquipmentItemData): EquipmentSlotType[] => {
      return findValidSlots(item);
    },
    [],
  );

  // Equip an item
  const equipItem = useCallback(
    (
      item: EquipmentItemData,
      slot?: EquipmentSlotType,
    ): {
      success: boolean;
      unequipped: EquipmentItemData[];
      error?: string;
    } => {
      // Validate
      const validation = canEquip(item, slot);
      if (!validation.canEquip) {
        return { success: false, unequipped: [], error: validation.reason };
      }

      // Determine target slot
      const validSlots = findValidSlots(item);
      const targetSlot =
        slot && validSlots.includes(slot) ? slot : validSlots[0];

      if (!targetSlot) {
        return { success: false, unequipped: [], error: "No valid slot" };
      }

      // Calculate what needs to be unequipped
      const unequipped: EquipmentItemData[] = [];
      const newEquipment = { ...equipment };

      // Check for conflicting slots
      const conflicts = getConflictingSlots(targetSlot, equipment);
      for (const conflictSlot of conflicts) {
        const conflictItem = newEquipment[conflictSlot];
        if (conflictItem) {
          unequipped.push(conflictItem);
          newEquipment[conflictSlot] = null;
          onUnequip?.(conflictItem, conflictSlot);
        }
      }

      // Unequip existing item in target slot
      const existingItem = newEquipment[targetSlot];
      if (existingItem) {
        unequipped.push(existingItem);
        onUnequip?.(existingItem, targetSlot);
      }

      // Equip new item
      newEquipment[targetSlot] = item;
      updateEquipment(newEquipment);
      onEquip?.(item, targetSlot);

      return { success: true, unequipped };
    },
    [equipment, canEquip, updateEquipment, onEquip, onUnequip],
  );

  // Unequip an item
  const unequipItem = useCallback(
    (slot: EquipmentSlotType): EquipmentItemData | null => {
      const item = equipment[slot];
      if (!item) return null;

      const newEquipment = { ...equipment };
      newEquipment[slot] = null;
      updateEquipment(newEquipment);
      onUnequip?.(item, slot);

      return item;
    },
    [equipment, updateEquipment, onUnequip],
  );

  // Get item in slot
  const getSlotItem = useCallback(
    (slot: EquipmentSlotType): EquipmentItemData | null => {
      return equipment[slot];
    },
    [equipment],
  );

  // Swap slots
  const swapSlots = useCallback(
    (slotA: EquipmentSlotType, slotB: EquipmentSlotType): boolean => {
      const itemA = equipment[slotA];
      const itemB = equipment[slotB];

      // Check if swap is valid
      if (itemA && !canEquipInSlot(itemA, slotB)) return false;
      if (itemB && !canEquipInSlot(itemB, slotA)) return false;

      const newEquipment = { ...equipment };
      newEquipment[slotA] = itemB;
      newEquipment[slotB] = itemA;
      updateEquipment(newEquipment);

      return true;
    },
    [equipment, updateEquipment],
  );

  // Clear all equipment
  const clearAll = useCallback((): EquipmentItemData[] => {
    const unequipped: EquipmentItemData[] = [];

    for (const slot of EQUIPMENT_SLOTS) {
      const item = equipment[slot];
      if (item) {
        unequipped.push(item);
        onUnequip?.(item, slot);
      }
    }

    updateEquipment(createEmptyEquipment());
    return unequipped;
  }, [equipment, updateEquipment, onUnequip]);

  // Set full equipment state
  const setEquipment = useCallback(
    (newEquipment: Partial<EquipmentState>) => {
      updateEquipment({
        ...createEmptyEquipment(),
        ...newEquipment,
      });
    },
    [updateEquipment],
  );

  // Calculate gear score
  const calculateGearScore = useCallback((): number => {
    let totalScore = 0;

    for (const slot of EQUIPMENT_SLOTS) {
      const item = equipment[slot];
      if (item) {
        totalScore += calculateItemPower(item);
      }
    }

    // Add set bonus contribution
    for (const bonus of setBonuses) {
      if (bonus.activeBonus) {
        const bonusStats = Object.values(bonus.activeBonus.stats);
        totalScore += bonusStats.reduce((sum, val) => sum + val, 0);
      }
    }

    return totalScore;
  }, [equipment, setBonuses]);

  return {
    equipment,
    totalStats,
    averageItemLevel,
    setBonuses,
    itemsNeedingRepair,
    equipItem,
    unequipItem,
    canEquip,
    getValidSlots,
    getSlotItem,
    swapSlots,
    clearAll,
    setEquipment,
    calculateGearScore,
  };
}
