/**
 * Equipment System
 *
 * Core hooks and utilities for RPG-style equipment/paper doll systems.
 *
 * @packageDocumentation
 */

// Main equipment hook
export {
  useEquipment,
  type UseEquipmentConfig,
  type UseEquipmentResult,
} from "./useEquipment";

// Individual slot hook
export {
  useEquipmentSlot,
  getSlotHighlightState,
  getSlotBorderColor,
  type UseEquipmentSlotConfig,
  type UseEquipmentSlotResult,
  type SlotHighlightState,
} from "./useEquipmentSlot";

// Utilities and types
export {
  // Types
  type EquipmentSlotType,
  type EquipmentSlotConfig,
  type ItemRarity,
  type StatType,
  type ItemStats,
  type EquipmentItemData,
  type EquipmentSet,
  type EquipmentState,

  // Slot configuration
  EQUIPMENT_SLOT_CONFIGS,
  EQUIPMENT_SLOTS,

  // Rarity configuration
  RARITY_COLORS,
  RARITY_NAMES,
  RARITY_ORDER,

  // Validation functions
  canEquipInSlot,
  getConflictingSlots,
  findValidSlots,
  meetsRequirements,

  // Stat calculation
  calculateTotalStats,
  calculateSetBonuses,
  compareItemStats,
  calculateItemPower,
  calculateAverageItemLevel,

  // Durability
  getDurabilityStatus,
  getItemsNeedingRepair,

  // Utilities
  createEmptyEquipment,
  formatStatName,
  formatStatValue,
  getSlotDisplayName,
} from "./equipmentUtils";
