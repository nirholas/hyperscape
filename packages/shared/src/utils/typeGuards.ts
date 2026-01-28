/**
 * Type Guards - Runtime type validation with type narrowing
 *
 * Replaces unsafe `as unknown as` casts with validated type checks.
 * Each guard returns a type predicate for TypeScript type narrowing.
 *
 * Benefits:
 * - Runtime Safety: Guards validate at runtime, catching bugs early
 * - Type Safety: TypeScript narrows types after guard passes
 * - Testability: Guards are unit-testable
 * - Reusability: Same guards used across codebase
 *
 * @example
 * ```typescript
 * // Before (unsafe)
 * const terrain = system as unknown as TerrainSystemLike;
 * if (terrain?.isPositionWalkable) { ... }
 *
 * // After (safe)
 * if (isTerrainSystem(system)) {
 *   system.isPositionWalkable(x, z); // TypeScript knows this is safe
 * }
 * ```
 */

// =============================================================================
// SYSTEM TYPE GUARDS
// =============================================================================

/**
 * Terrain system with walkability check
 */
export interface TerrainSystemLike {
  isPositionWalkable: (x: number, z: number) => { walkable: boolean };
}

/**
 * Check if system has terrain walkability check
 *
 * @param system - System to check
 * @returns true if system has isPositionWalkable method
 */
export function isTerrainSystem(system: unknown): system is TerrainSystemLike {
  if (!system || typeof system !== "object") return false;

  const s = system as Record<string, unknown>;
  return typeof s.isPositionWalkable === "function";
}

/**
 * Mob system with mob retrieval
 */
export interface MobSystemLike {
  getMob: (id: string) => unknown;
}

/**
 * Check if system has mob retrieval method
 *
 * @param system - System to check
 * @returns true if system has getMob method
 */
export function isMobSystem(system: unknown): system is MobSystemLike {
  if (!system || typeof system !== "object") return false;

  const s = system as Record<string, unknown>;
  return typeof s.getMob === "function";
}

/**
 * Equipment system with player equipment retrieval
 */
export interface EquipmentSystemLike {
  getPlayerEquipment: (playerId: string) => {
    weapon?: {
      item?: { weaponType?: string; attackType?: string; id?: string };
    };
  };
}

/**
 * Check if system has equipment retrieval method
 *
 * @param system - System to check
 * @returns true if system has getPlayerEquipment method
 */
export function isEquipmentSystem(
  system: unknown,
): system is EquipmentSystemLike {
  if (!system || typeof system !== "object") return false;

  const s = system as Record<string, unknown>;
  return typeof s.getPlayerEquipment === "function";
}

// =============================================================================
// ENTITY TYPE GUARDS - MOB
// =============================================================================

/**
 * Mob with core damage operations
 */
export interface MobLike {
  getHealth: () => number;
  isDead: () => boolean;
  takeDamage: (damage: number, attackerId?: string) => boolean;
  getProperty?: (key: string) => unknown;
}

/**
 * Check if entity has mob damage operations
 *
 * @param entity - Entity to check
 * @returns true if entity has mob-like damage methods
 */
export function isMobLike(entity: unknown): entity is MobLike {
  if (!entity || typeof entity !== "object") return false;

  const e = entity as Record<string, unknown>;
  return (
    typeof e.takeDamage === "function" &&
    typeof e.getHealth === "function" &&
    typeof e.isDead === "function"
  );
}

/**
 * Mob with config for retaliation check
 */
export interface MobWithConfig {
  config?: {
    retaliates?: boolean;
  };
}

/**
 * Check if mob has config with retaliates property
 *
 * @param entity - Entity to check
 * @returns true if entity has config.retaliates defined
 */
export function hasMobConfig(entity: unknown): entity is MobWithConfig {
  if (!entity || typeof entity !== "object") return false;

  const e = entity as Record<string, unknown>;
  if (!e.config || typeof e.config !== "object") return false;

  const config = e.config as Record<string, unknown>;
  return "retaliates" in config;
}

/**
 * Get mob retaliates config safely
 * Returns true if mob should retaliate, defaults to true if not configured
 *
 * @param entity - Entity to check
 * @returns true if mob retaliates (default: true)
 */
export function getMobRetaliates(entity: unknown): boolean {
  if (!hasMobConfig(entity)) return true; // Default to retaliate
  return entity.config?.retaliates ?? true;
}

/**
 * Entity with setServerEmote method (for mobs)
 */
export interface EntityWithServerEmote {
  setServerEmote: (emote: string) => void;
}

/**
 * Check if entity has setServerEmote method
 *
 * @param entity - Entity to check
 * @returns true if entity has setServerEmote method
 */
export function hasServerEmote(
  entity: unknown,
): entity is EntityWithServerEmote {
  if (!entity || typeof entity !== "object") return false;

  const e = entity as Record<string, unknown>;
  return typeof e.setServerEmote === "function";
}

/**
 * Entity with health property for damage checks
 */
export interface EntityWithHealth {
  health: number;
}

/**
 * Check if entity has health property
 *
 * @param entity - Entity to check
 * @returns true if entity has numeric health property
 */
export function hasHealth(entity: unknown): entity is EntityWithHealth {
  if (!entity || typeof entity !== "object") return false;

  const e = entity as Record<string, unknown>;
  return typeof e.health === "number";
}

/**
 * Check if entity is dead (health <= 0)
 *
 * @param entity - Entity to check
 * @returns true if entity has health and it's <= 0
 */
export function isEntityDead(entity: unknown): boolean {
  if (!hasHealth(entity)) return false;
  return entity.health <= 0;
}

/**
 * Entity with pending attacker for auto-retaliate
 */
export interface EntityWithPendingAttacker {
  combat?: { pendingAttacker?: string | null };
  data?: { pa?: string | null };
}

/**
 * Check if entity has pending attacker properties
 *
 * @param entity - Entity to check
 * @returns true if entity has combat or data with pending attacker
 */
export function hasPendingAttacker(
  entity: unknown,
): entity is EntityWithPendingAttacker {
  if (!entity || typeof entity !== "object") return false;

  const e = entity as Record<string, unknown>;
  // Has combat.pendingAttacker or data.pa
  if (e.combat && typeof e.combat === "object") return true;
  if (e.data && typeof e.data === "object") return true;
  return false;
}

/**
 * Get pending attacker ID from entity
 *
 * @param entity - Entity to check
 * @returns Pending attacker ID or null
 */
export function getPendingAttacker(entity: unknown): string | null {
  if (!hasPendingAttacker(entity)) return null;
  return entity.combat?.pendingAttacker || entity.data?.pa || null;
}

/**
 * Clear pending attacker from entity
 *
 * @param entity - Entity to clear
 */
export function clearPendingAttacker(entity: unknown): void {
  if (!hasPendingAttacker(entity)) return;
  if (entity.combat) {
    entity.combat.pendingAttacker = null;
  }
  if (entity.data) {
    entity.data.pa = null;
  }
}

// =============================================================================
// ENTITY TYPE GUARDS - PLAYER
// =============================================================================

/**
 * Player entity with health properties
 */
export interface PlayerEntityLike {
  health?: number;
  name?: string;
  alive?: boolean;
  data?: {
    isLoading?: boolean;
  };
}

/**
 * Check if entity is a player-like entity
 *
 * @param entity - Entity to check
 * @returns true if entity has player properties
 */
export function isPlayerLike(entity: unknown): entity is PlayerEntityLike {
  if (!entity || typeof entity !== "object") return false;

  // Players are distinguished by having optional health property
  // This is a loose check - players don't require all properties
  return true; // All entities could be player-like, so we just verify it's an object
}

/**
 * Entity with network dirty marking
 */
export interface EntityWithNetworkDirty {
  markNetworkDirty: () => void;
}

/**
 * Check if entity has network dirty marking method
 *
 * @param entity - Entity to check
 * @returns true if entity has markNetworkDirty method
 */
export function hasNetworkDirty(
  entity: unknown,
): entity is EntityWithNetworkDirty {
  if (!entity || typeof entity !== "object") return false;

  const e = entity as Record<string, unknown>;
  return typeof e.markNetworkDirty === "function";
}

// =============================================================================
// AI STATE MACHINE TYPE GUARDS
// =============================================================================

/**
 * Entity with AI damage handler
 */
export interface EntityWithAIDamageHandler {
  aiStateMachine: {
    onReceiveDamage: (attackerId: string, damage: number) => void;
  };
}

/**
 * Check if entity has AI state machine with damage handler
 *
 * @param entity - Entity to check
 * @returns true if entity has aiStateMachine.onReceiveDamage
 */
export function hasAIDamageHandler(
  entity: unknown,
): entity is EntityWithAIDamageHandler {
  if (!entity || typeof entity !== "object") return false;

  const e = entity as Record<string, unknown>;
  if (!e.aiStateMachine || typeof e.aiStateMachine !== "object") return false;

  const ai = e.aiStateMachine as Record<string, unknown>;
  return typeof ai.onReceiveDamage === "function";
}

// =============================================================================
// COMBAT STATE MANAGER TYPE GUARDS
// =============================================================================

/**
 * Entity with player combat state manager
 */
export interface EntityWithPlayerCombat {
  combatStateManager: {
    onReceiveAttack: (attackerId: string, currentTick: number) => void;
    isAutoRetaliateEnabled: () => boolean;
    getTargetId: () => string | null;
  };
}

/**
 * Check if entity has player combat state manager
 *
 * @param entity - Entity to check
 * @returns true if entity has combatStateManager with required methods
 */
export function hasPlayerCombatManager(
  entity: unknown,
): entity is EntityWithPlayerCombat {
  if (!entity || typeof entity !== "object") return false;

  const e = entity as Record<string, unknown>;
  if (!e.combatStateManager || typeof e.combatStateManager !== "object") {
    return false;
  }

  const csm = e.combatStateManager as Record<string, unknown>;
  return (
    typeof csm.onReceiveAttack === "function" &&
    typeof csm.isAutoRetaliateEnabled === "function" &&
    typeof csm.getTargetId === "function"
  );
}

/**
 * Entity with death state manager
 */
export interface EntityWithDeathState {
  deathStateManager: {
    isDead: () => boolean;
    die: (killerId: string) => void;
  };
}

/**
 * Check if entity has death state manager
 *
 * @param entity - Entity to check
 * @returns true if entity has deathStateManager with required methods
 */
export function hasDeathStateManager(
  entity: unknown,
): entity is EntityWithDeathState {
  if (!entity || typeof entity !== "object") return false;

  const e = entity as Record<string, unknown>;
  if (!e.deathStateManager || typeof e.deathStateManager !== "object") {
    return false;
  }

  const dsm = e.deathStateManager as Record<string, unknown>;
  return typeof dsm.isDead === "function" && typeof dsm.die === "function";
}

// =============================================================================
// GENERIC UTILITY GUARDS
// =============================================================================

/**
 * Check if value is a non-null object
 *
 * @param value - Value to check
 * @returns true if value is a non-null object
 */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Check if object has a specific method
 *
 * @param obj - Object to check
 * @param methodName - Name of method to look for
 * @returns true if object has the method
 */
export function hasMethod(
  obj: unknown,
  methodName: string,
): obj is Record<string, (...args: unknown[]) => unknown> {
  if (!isObject(obj)) return false;
  return typeof obj[methodName] === "function";
}

/**
 * Check if object has a specific property
 *
 * @param obj - Object to check
 * @param propertyName - Name of property to look for
 * @returns true if object has the property
 */
export function hasProperty<K extends string>(
  obj: unknown,
  propertyName: K,
): obj is Record<K, unknown> {
  if (!isObject(obj)) return false;
  return propertyName in obj;
}

// =============================================================================
// DAMAGE HANDLER TYPE GUARDS
// =============================================================================

/**
 * DamageHandler interface for type guard
 */
export interface DamageHandlerLike {
  entityType: "player" | "mob";
  applyDamage: (
    targetId: unknown,
    damage: number,
    attackerId: unknown,
    attackerType: "player" | "mob",
  ) => unknown;
}

/**
 * PlayerDamageHandler interface for type guard
 * Has cachePlayerSystem method unique to player handlers
 */
export interface PlayerDamageHandlerLike extends DamageHandlerLike {
  entityType: "player";
  cachePlayerSystem: (playerSystem: unknown) => void;
}

/**
 * Check if handler is a PlayerDamageHandler
 *
 * @param handler - Handler to check
 * @returns true if handler is PlayerDamageHandler
 */
export function isPlayerDamageHandler(
  handler: unknown,
): handler is PlayerDamageHandlerLike {
  if (!handler || typeof handler !== "object") return false;

  const h = handler as Record<string, unknown>;
  return (
    h.entityType === "player" &&
    typeof h.cachePlayerSystem === "function" &&
    typeof h.applyDamage === "function"
  );
}

// =============================================================================
// MOB ENTITY TYPE GUARDS
// =============================================================================

/**
 * MobEntity interface for type guard
 * Checks for getMobData method which is unique to MobEntity
 */
export interface MobEntityLike {
  getMobData: () => {
    attack?: number;
    attackPower?: number;
    defense?: number;
    level?: number;
    name?: string;
    health?: number;
  };
  // Optional methods that may exist on MobEntity
  isDead?: () => boolean;
  getHealth?: () => number;
  getCombatRange?: () => number;
  isAttackable?: () => boolean;
  onTargetDied?: (targetId: string) => void;
}

/**
 * Check if entity is a MobEntity (has getMobData method)
 *
 * @param entity - Entity to check
 * @returns true if entity is a MobEntity
 */
export function isMobEntity(entity: unknown): entity is MobEntityLike {
  if (!entity || typeof entity !== "object") return false;

  const e = entity as Record<string, unknown>;
  return typeof e.getMobData === "function";
}
