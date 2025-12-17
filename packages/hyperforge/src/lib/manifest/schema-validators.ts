/**
 * Manifest Schema Validators
 * Validates assets against game manifest schemas before export
 */

import type { AssetCategory } from "@/types/categories";
import type { Item } from "@/types/game/item-types";
import type { NPCDataInput } from "@/types/game/npc-types";
import type { ResourceManifest } from "../cdn/types";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate item for items.json manifest
 */
export function validateItem(item: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const itemData = item as Item;

  // Required fields
  if (!itemData.id) errors.push("Missing required field: id");
  if (!itemData.name) errors.push("Missing required field: name");
  if (!itemData.type) errors.push("Missing required field: type");
  if (!itemData.description) errors.push("Missing required field: description");
  if (!itemData.examine) errors.push("Missing required field: examine");
  if (itemData.tradeable === undefined)
    errors.push("Missing required field: tradeable");
  if (!itemData.rarity) errors.push("Missing required field: rarity");

  // ID format validation
  if (itemData.id && !/^[a-z0-9_]+$/.test(itemData.id)) {
    errors.push("ID must be lowercase with underscores only");
  }

  // Weapon-specific validation
  if (itemData.type === "weapon") {
    if (!itemData.weaponType) errors.push("Weapon missing weaponType");
    if (!itemData.attackType) errors.push("Weapon missing attackType");
    if (!itemData.attackSpeed) errors.push("Weapon missing attackSpeed");
  }

  // Warnings
  if (!itemData.modelPath) {
    warnings.push("No modelPath specified - asset won't render in game");
  }
  if (itemData.weaponType && !itemData.equippedModelPath) {
    warnings.push(
      "Weapon missing equippedModelPath - may not display correctly when equipped",
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate NPC for npcs.json manifest
 */
export function validateNPC(npc: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const npcData = npc as NPCDataInput;

  // Required fields
  if (!npcData.id) errors.push("Missing required field: id");
  if (!npcData.name) errors.push("Missing required field: name");
  if (!npcData.description) errors.push("Missing required field: description");
  if (!npcData.category) errors.push("Missing required field: category");

  // Category validation
  const validCategories = ["mob", "boss", "neutral", "quest"];
  if (npcData.category && !validCategories.includes(npcData.category)) {
    errors.push(`Invalid category: ${npcData.category}`);
  }

  // ID format validation
  if (npcData.id && !/^[a-z0-9_]+$/.test(npcData.id)) {
    errors.push("ID must be lowercase with underscores only");
  }

  // Warnings
  if (!npcData.modelPath) {
    warnings.push("No modelPath specified - NPC won't render in game");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate resource for resources.json manifest
 */
export function validateResource(resource: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const resourceData = resource as ResourceManifest;

  // Required fields
  if (!resourceData.id) errors.push("Missing required field: id");
  if (!resourceData.name) errors.push("Missing required field: name");
  if (!resourceData.type) errors.push("Missing required field: type");
  if (!resourceData.harvestSkill)
    errors.push("Missing required field: harvestSkill");
  if (resourceData.levelRequired === undefined)
    errors.push("Missing required field: levelRequired");

  // ID format validation
  if (resourceData.id && !/^[a-z0-9_]+$/.test(resourceData.id)) {
    errors.push("ID must be lowercase with underscores only");
  }

  // Warnings
  if (!resourceData.modelPath) {
    warnings.push("No modelPath specified - resource won't render in game");
  }
  if (!resourceData.depletedModelPath) {
    warnings.push("No depletedModelPath - resource won't show depleted state");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate asset by category
 */
export function validateAssetForExport(
  category: AssetCategory,
  asset: unknown,
): ValidationResult {
  switch (category) {
    case "weapon":
    case "prop":
    case "building":
      return validateItem(asset);
    case "npc":
    case "character":
      return validateNPC(asset);
    case "resource":
    case "environment":
      return validateResource(asset);
    default:
      return {
        valid: false,
        errors: [`Unknown category: ${category}`],
        warnings: [],
      };
  }
}
