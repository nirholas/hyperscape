/**
 * Type Guards
 *
 * Runtime type validation functions for common data structures.
 * Use these to safely narrow unknown types in event handlers and API responses.
 *
 * @packageDocumentation
 */

import type { InventorySlotViewItem } from "../game/types";

// ============================================================================
// Inventory Event Guards
// ============================================================================

/**
 * Type guard for inventory update events
 */
export interface InventoryUpdateEvent {
  items: InventorySlotViewItem[];
  coins?: number;
}

export function isInventoryUpdateEvent(
  data: unknown,
): data is InventoryUpdateEvent {
  if (typeof data !== "object" || data === null) return false;
  const obj = data as Record<string, unknown>;
  return "items" in obj && Array.isArray(obj.items);
}

/**
 * Type guard for coin update events
 */
export interface CoinUpdateEvent {
  coins: number;
}

export function isCoinUpdateEvent(data: unknown): data is CoinUpdateEvent {
  if (typeof data !== "object" || data === null) return false;
  const obj = data as Record<string, unknown>;
  return "coins" in obj && typeof obj.coins === "number";
}

// ============================================================================
// UI Update Event Guards
// ============================================================================

/**
 * Type guard for UI update events
 */
export interface UIUpdateEvent {
  component: string;
  data: unknown;
}

export function isUIUpdateEvent(data: unknown): data is UIUpdateEvent {
  if (typeof data !== "object" || data === null) return false;
  const obj = data as Record<string, unknown>;
  return (
    "component" in obj && typeof obj.component === "string" && "data" in obj
  );
}

// ============================================================================
// Skills Event Guards
// ============================================================================

/**
 * Type guard for skills update events
 */
export interface SkillsUpdateEvent {
  playerId: string;
  skills: Record<string, { level: number; xp: number }>;
}

export function isSkillsUpdateEvent(data: unknown): data is SkillsUpdateEvent {
  if (typeof data !== "object" || data === null) return false;
  const obj = data as Record<string, unknown>;
  return (
    "playerId" in obj &&
    typeof obj.playerId === "string" &&
    "skills" in obj &&
    typeof obj.skills === "object"
  );
}

// ============================================================================
// Equipment Event Guards
// ============================================================================

/**
 * Type guard for equipment update events
 */
export interface EquipmentUpdateEvent {
  playerId?: string;
  equipment: Record<string, unknown>;
}

export function isEquipmentUpdateEvent(
  data: unknown,
): data is EquipmentUpdateEvent {
  if (typeof data !== "object" || data === null) return false;
  const obj = data as Record<string, unknown>;
  return "equipment" in obj && typeof obj.equipment === "object";
}

// ============================================================================
// Loading Event Guards
// ============================================================================

/**
 * Type guard for loading progress events
 */
export interface LoadingProgressEvent {
  progress: number;
  stage?: string;
  message?: string;
}

export function isLoadingProgressEvent(
  data: unknown,
): data is LoadingProgressEvent {
  if (typeof data !== "object" || data === null) return false;
  const obj = data as Record<string, unknown>;
  return "progress" in obj && typeof obj.progress === "number";
}

// ============================================================================
// Death Screen Event Guards
// ============================================================================

/**
 * Type guard for death screen events
 */
export interface DeathScreenEvent {
  message: string;
  killedBy: string;
  respawnTime?: number;
}

export function isDeathScreenEvent(data: unknown): data is DeathScreenEvent {
  if (typeof data !== "object" || data === null) return false;
  const obj = data as Record<string, unknown>;
  return (
    "message" in obj &&
    typeof obj.message === "string" &&
    "killedBy" in obj &&
    typeof obj.killedBy === "string"
  );
}

// ============================================================================
// Generic Object Guards
// ============================================================================

/**
 * Check if a value is a non-null object
 */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Check if a value has a specific string property
 */
export function hasStringProperty<K extends string>(
  value: unknown,
  key: K,
): value is Record<K, string> {
  return isObject(value) && key in value && typeof value[key] === "string";
}

/**
 * Check if a value has a specific number property
 */
export function hasNumberProperty<K extends string>(
  value: unknown,
  key: K,
): value is Record<K, number> {
  return isObject(value) && key in value && typeof value[key] === "number";
}

/**
 * Check if a value has a specific array property
 */
export function hasArrayProperty<K extends string>(
  value: unknown,
  key: K,
): value is Record<K, unknown[]> {
  return isObject(value) && key in value && Array.isArray(value[key]);
}

// ============================================================================
// Prayer Event Guards
// ============================================================================

/**
 * Type guard for prayer state sync events
 */
export interface PrayerStateSyncEvent {
  playerId: string;
  points: number;
  maxPoints: number;
  level?: number;
  active?: string[];
}

export function isPrayerStateSyncEvent(
  data: unknown,
): data is PrayerStateSyncEvent {
  if (!isObject(data)) return false;
  return (
    hasStringProperty(data, "playerId") &&
    hasNumberProperty(data, "points") &&
    hasNumberProperty(data, "maxPoints")
  );
}

/**
 * Type guard for prayer points changed events
 */
export interface PrayerPointsChangedEvent {
  playerId: string;
  points: number;
  maxPoints: number;
}

export function isPrayerPointsChangedEvent(
  data: unknown,
): data is PrayerPointsChangedEvent {
  if (!isObject(data)) return false;
  return (
    hasStringProperty(data, "playerId") &&
    hasNumberProperty(data, "points") &&
    hasNumberProperty(data, "maxPoints")
  );
}

/**
 * Type guard for prayer toggled events
 */
export interface PrayerToggledEvent {
  playerId: string;
  prayerId: string;
  active: boolean;
  points?: number;
  maxPoints?: number;
}

export function isPrayerToggledEvent(
  data: unknown,
): data is PrayerToggledEvent {
  if (!isObject(data)) return false;
  return (
    hasStringProperty(data, "playerId") &&
    hasStringProperty(data, "prayerId") &&
    "active" in data &&
    typeof data.active === "boolean"
  );
}

// ============================================================================
// Player Stats Event Guards
// ============================================================================

/**
 * Type guard for player stats data
 */
export interface PlayerStatsData {
  health?: { current: number; max: number };
  prayerPoints?: { current: number; max: number };
  skills?: Record<string, { level: number; xp: number }>;
}

export function isPlayerStatsData(data: unknown): data is PlayerStatsData {
  if (!isObject(data)) return false;
  // PlayerStats has at least one of these fields
  return "health" in data || "prayerPoints" in data || "skills" in data;
}

/**
 * Type guard for coin update events with playerId
 */
export interface CoinUpdateWithPlayerEvent {
  playerId: string;
  coins: number;
}

export function isCoinUpdateWithPlayerEvent(
  data: unknown,
): data is CoinUpdateWithPlayerEvent {
  if (!isObject(data)) return false;
  return (
    hasStringProperty(data, "playerId") && hasNumberProperty(data, "coins")
  );
}

// ============================================================================
// Quest Event Guards
// ============================================================================

/**
 * Type guard for quest list update events
 */
export interface QuestListUpdateEvent {
  quests: Array<{
    id: string;
    name: string;
    status: string;
    difficulty?: string;
  }>;
}

export function isQuestListUpdateEvent(
  data: unknown,
): data is QuestListUpdateEvent {
  if (!isObject(data)) return false;
  return hasArrayProperty(data, "quests");
}

/**
 * Type guard for quest detail update events
 */
export interface QuestDetailUpdateEvent {
  id: string;
  name: string;
  description?: string;
  objectives?: unknown[];
  rewards?: unknown[];
}

export function isQuestDetailUpdateEvent(
  data: unknown,
): data is QuestDetailUpdateEvent {
  if (!isObject(data)) return false;
  return hasStringProperty(data, "id") && hasStringProperty(data, "name");
}

// ============================================================================
// Combat Event Guards
// ============================================================================

/**
 * Type guard for combat stat update events
 */
export interface CombatStatUpdateEvent {
  playerId?: string;
  combatLevel?: number;
  attackStyle?: string;
  attackMode?: string;
}

export function isCombatStatUpdateEvent(
  data: unknown,
): data is CombatStatUpdateEvent {
  if (!isObject(data)) return false;
  return "combatLevel" in data || "attackStyle" in data || "attackMode" in data;
}

/**
 * Type guard for special attack update events
 */
export interface SpecialAttackUpdateEvent {
  playerId?: string;
  specialAttack: number;
  maxSpecialAttack?: number;
}

export function isSpecialAttackUpdateEvent(
  data: unknown,
): data is SpecialAttackUpdateEvent {
  if (!isObject(data)) return false;
  return hasNumberProperty(data, "specialAttack");
}

// ============================================================================
// Action Event Guards
// ============================================================================

/**
 * Type guard for available actions events
 */
export interface AvailableActionsEvent {
  actions: Array<{
    id: string;
    name: string;
    icon?: string;
  }>;
}

export function isAvailableActionsEvent(
  data: unknown,
): data is AvailableActionsEvent {
  if (!isObject(data)) return false;
  return hasArrayProperty(data, "actions");
}
