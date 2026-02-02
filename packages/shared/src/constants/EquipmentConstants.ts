/**
 * Equipment Constants
 *
 * Shared constants for equipment system.
 * Single source of truth for equipment slot definitions.
 */

import { EquipmentSlotName } from "../types/game/item-types";

/**
 * All equipment slot names.
 * Used for iteration across equipment systems (persistence, stats, UI).
 */
export const EQUIPMENT_SLOT_NAMES = [
  EquipmentSlotName.WEAPON,
  EquipmentSlotName.SHIELD,
  EquipmentSlotName.HELMET,
  EquipmentSlotName.BODY,
  EquipmentSlotName.LEGS,
  EquipmentSlotName.BOOTS,
  EquipmentSlotName.GLOVES,
  EquipmentSlotName.CAPE,
  EquipmentSlotName.AMULET,
  EquipmentSlotName.RING,
  EquipmentSlotName.ARROWS,
] as const;

/**
 * Type for currently implemented equipment slots
 */
export type ImplementedEquipmentSlot = (typeof EQUIPMENT_SLOT_NAMES)[number];

/**
 * Number of currently implemented equipment slots
 */
export const EQUIPMENT_SLOT_COUNT = EQUIPMENT_SLOT_NAMES.length;
