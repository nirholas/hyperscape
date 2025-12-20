# Combat System Fixes Implementation Plan

> **Total Estimated Time**: ~4 hours
> **Priority Order**: HIGH → Medium → Low
> **Target**: Reach 10/10 audit rating
> **Created**: Based on deep audit of combat system (9.4/10 → 10/10)

---

## Table of Contents

1. [HIGH: PvP Bug in handleAutoRetaliateEnabled](#1-high-pvp-bug-in-handleautoretaliateenabled)
2. [Medium: Remaining `as` Casts in CombatSystem](#2-medium-remaining-as-casts-in-combatsystem)
3. [Medium: Type Guard in handleAutoRetaliateEnabled](#3-medium-type-guard-in-handleautoretaliateenabled)
4. [Low: XP History Periodic Cleanup](#4-low-xp-history-periodic-cleanup)
5. [Low: EventStore.destroy() Call](#5-low-eventstoredestroyCall)
6. [Low: AIStateContext ISP Split](#6-low-aistatecontext-isp-split)

---

## 1. HIGH: PvP Bug in handleAutoRetaliateEnabled

**File**: `packages/shared/src/systems/shared/combat/CombatSystem.ts`
**Lines**: 710-774
**Time Estimate**: 30 minutes

### Problem

The `handleAutoRetaliateEnabled` method hardcodes `"mob"` as the attacker type:

```typescript
// Line 727 - BUG: Assumes attacker is always a mob
const attackerEntity = this.getEntity(pendingAttacker, "mob");
```

In PvP scenarios, if Player A attacks Player B with auto-retaliate OFF, then Player B toggles auto-retaliate ON, the lookup will fail because Player A is stored in `world.entities.players`, not `world.entities` (mobs).

### Solution

**Use existing `getEntityType()` method (line 1653) to detect attacker type dynamically.**

This is simpler than storing the type and doesn't require schema changes.

```typescript
// CombatSystem.ts - handleAutoRetaliateEnabled method (lines 710-774)
private handleAutoRetaliateEnabled(playerId: string): void {
  const playerEntity = this.world.getPlayer?.(playerId);
  if (!playerEntity) return;

  // Use type guard instead of inline cast (Issue #3 fix included)
  const pendingAttacker = getPendingAttacker(playerEntity);
  if (!pendingAttacker) return;

  // FIX: Use getEntityType() instead of hardcoding "mob"
  // This enables PvP scenarios where attacker could be a player
  const attackerType = this.getEntityType(pendingAttacker);
  const attackerEntity = this.getEntity(pendingAttacker, attackerType);

  if (!attackerEntity || !this.isEntityAlive(attackerEntity, attackerType)) {
    // Attacker gone - clear pending attacker state
    clearPendingAttacker(playerEntity);
    return;
  }

  // Start combat! Player now retaliates
  const attackSpeedTicks = this.getAttackSpeedTicks(
    createEntityID(playerId),
    "player",
  );

  // enterCombat() already detects entity types internally
  this.enterCombat(
    createEntityID(playerId),
    createEntityID(pendingAttacker),
    attackSpeedTicks,
  );

  // Clear pending attacker using type guard
  clearPendingAttacker(playerEntity);

  // Clear server face target
  this.emitTypedEvent(EventType.COMBAT_CLEAR_FACE_TARGET, {
    playerId: playerId,
  });

  // FIX: Use detected attackerType instead of hardcoded "mob"
  this.rotationManager.rotateTowardsTarget(
    playerId,
    pendingAttacker,
    "player",
    attackerType, // Was: "mob"
  );
}
```

**Key changes:**
1. Line 727: `this.getEntityType(pendingAttacker)` instead of hardcoded `"mob"`
2. Line 728: Pass `attackerType` to `getEntity()` and `isEntityAlive()`
3. Line 772: Pass `attackerType` to `rotateTowardsTarget()`
4. Use `getPendingAttacker()` and `clearPendingAttacker()` type guards (combines with Issue #3)

**Imports:** Already present at lines 66-67:
```typescript
import {
  isEntityDead,
  getMobRetaliates,
  getPendingAttacker,  // ✅ Already imported
  clearPendingAttacker, // ✅ Already imported
} from "../../../utils/typeGuards";
```

### Acceptance Criteria

- [ ] Player A attacks Player B (auto-retaliate OFF)
- [ ] Player B toggles auto-retaliate ON
- [ ] Player B immediately starts attacking Player A
- [ ] Both players face each other correctly
- [ ] Combat state is properly established for both

### Test Cases to Add

```typescript
// CombatSystem.test.ts
describe("handleAutoRetaliateEnabled PvP", () => {
  it("should retaliate against player attacker when toggled ON", () => {
    // Setup: Player A attacks Player B (auto-retaliate OFF)
    // Action: Player B toggles auto-retaliate ON
    // Assert: Player B now in combat targeting Player A
  });
});
```

---

## 2. Medium: Remaining `as` Casts in CombatSystem

**File**: `packages/shared/src/systems/shared/combat/CombatSystem.ts`
**Time Estimate**: 1 hour

### Locations

| Line | Current Cast | Solution |
|------|--------------|----------|
| 241-244 | `as PlayerDamageHandler` | Add type guard `isPlayerDamageHandler()` |
| 711-716 | Inline type for playerEntity | Use existing `getPendingAttacker()` type guard |
| 838 | `as MobEntity` | Add type guard `isMobEntity()` |
| 880 | `as MobEntity` | Reuse `isMobEntity()` |

### Implementation

**Add new type guards to `typeGuards.ts`**:

```typescript
// packages/shared/src/utils/typeGuards.ts

import type { PlayerDamageHandler } from "../systems/shared/combat/handlers/PlayerDamageHandler";
import type { MobEntity } from "../entities/npc/MobEntity";

/**
 * Type guard for PlayerDamageHandler
 */
export function isPlayerDamageHandler(
  handler: unknown
): handler is PlayerDamageHandler {
  return (
    handler !== null &&
    typeof handler === "object" &&
    "entityType" in handler &&
    (handler as { entityType: string }).entityType === "player" &&
    "cachePlayerSystem" in handler &&
    typeof (handler as { cachePlayerSystem: unknown }).cachePlayerSystem === "function"
  );
}

/**
 * Type guard for MobEntity
 * Checks for getMobData method which is unique to MobEntity
 */
export function isMobEntity(entity: unknown): entity is MobEntity {
  return (
    entity !== null &&
    typeof entity === "object" &&
    "getMobData" in entity &&
    typeof (entity as { getMobData: unknown }).getMobData === "function"
  );
}
```

**Update CombatSystem.ts**:

```typescript
// Line 241-244: Replace cast with type guard
const playerHandler = this.damageHandlers.get("player");
if (isPlayerDamageHandler(playerHandler)) {
  playerHandler.cachePlayerSystem(this.playerSystem ?? null);
}

// Line 711-716: Use getPendingAttacker type guard
const pendingAttacker = getPendingAttacker(playerEntity);
if (!pendingAttacker) return;

// Line 838: Replace cast with type guard
if (isMobEntity(attacker)) {
  const mobData = attacker.getMobData();
  attackerData = {
    stats: { attack: mobData.attack },
    config: { attackPower: mobData.attackPower },
  };
} else {
  // Handle player...
}

// Line 880: Reuse isMobEntity
if (isMobEntity(target)) {
  const mobData = target.getMobData();
  // ...
}
```

### Acceptance Criteria

- [ ] No `as` casts remain for PlayerDamageHandler or MobEntity
- [ ] All type guards have corresponding tests
- [ ] Build passes with strict TypeScript

---

## 3. Medium: Type Guard in handleAutoRetaliateEnabled

**File**: `packages/shared/src/systems/shared/combat/CombatSystem.ts`
**Lines**: 711-724
**Time Estimate**: 15 minutes

> **Note**: This fix is now **combined with Issue #1**. The solution in Issue #1 already includes using `getPendingAttacker()` and `clearPendingAttacker()`.

### Problem

Direct property access on untyped entity instead of using type guards:

```typescript
// Lines 711-716 - Inline type cast
const playerEntity = this.world.getPlayer?.(playerId) as
  | {
      combat?: { inCombat?: boolean; pendingAttacker?: string | null };
      data?: { c?: boolean; pa?: string | null };
    }
  | undefined;

// Lines 721-724 - Direct property access
const pendingAttacker =
  playerEntity.combat?.pendingAttacker || playerEntity.data?.pa;
```

### Solution (Already in Issue #1)

Use the existing `getPendingAttacker()` and `clearPendingAttacker()` type guards:

```typescript
import { getPendingAttacker, clearPendingAttacker } from "../../../utils/typeGuards";

private handleAutoRetaliateEnabled(playerId: string): void {
  const playerEntity = this.world.getPlayer?.(playerId);
  if (!playerEntity) return;

  // Use type guard instead of direct property access
  const pendingAttacker = getPendingAttacker(playerEntity);
  if (!pendingAttacker) return;

  // ... rest of method ...

  // Use type guard for clearing (replaces lines 730-735 AND 754-759)
  clearPendingAttacker(playerEntity);
}
```

### Acceptance Criteria

- [ ] `getPendingAttacker()` used instead of direct access
- [ ] `clearPendingAttacker()` used instead of direct mutation
- [ ] Inline type cast removed from lines 711-716
- [ ] ⚠️ **This is now part of Issue #1 implementation**

---

## 4. Low: XP History Periodic Cleanup

**File**: `packages/shared/src/systems/shared/combat/CombatAntiCheat.ts`
**Time Estimate**: 30 minutes

### Problem

XP history is only cleaned when new XP is gained. Old player entries accumulate if players disconnect without gaining XP.

### Solution

Add periodic cleanup to `decayScores()` which is already called every minute:

```typescript
// CombatAntiCheat.ts

/**
 * Decay violation scores over time
 * Call this periodically (e.g., every minute)
 */
decayScores(): void {
  const now = Date.now();
  const staleThreshold = 300000; // 5 minutes

  for (const [playerId, state] of this.playerStates) {
    state.score = Math.max(0, state.score - this.config.scoreDecayPerMinute);

    // Clean up players with no recent violations and zero score
    if (state.score === 0 && state.violations.length === 0) {
      this.playerStates.delete(playerId);
      // NEW: Also clean XP history for this player
      this.playerXPHistory.delete(playerId);
    }
  }

  // NEW: Clean stale XP history entries for players not in violation tracking
  for (const [playerId, history] of this.playerXPHistory) {
    if (!this.playerStates.has(playerId)) {
      // Player not tracked for violations - check if XP history is stale
      const latestTick = history.length > 0
        ? Math.max(...history.map(h => h.tick))
        : 0;

      // If no XP recorded in last 100 ticks (~60 seconds), clean up
      // Note: This requires passing currentTick or using timestamp
      if (history.length === 0) {
        this.playerXPHistory.delete(playerId);
      }
    }
  }
}

// Alternative: Add a dedicated cleanup method
cleanupStaleXPHistory(currentTick: number): void {
  const staleThreshold = 200; // ~2 minutes in ticks

  for (const [playerId, history] of this.playerXPHistory) {
    // Filter to recent entries only
    const recent = history.filter(h => h.tick >= currentTick - staleThreshold);

    if (recent.length === 0) {
      this.playerXPHistory.delete(playerId);
    } else if (recent.length !== history.length) {
      this.playerXPHistory.set(playerId, recent);
    }
  }
}
```

### Acceptance Criteria

- [ ] XP history cleaned for disconnected players
- [ ] Memory usage stable over extended play sessions
- [ ] No impact on active players' XP validation

---

## 5. Low: EventStore.destroy() Call

**Files**:
- `packages/shared/src/systems/shared/EventStore.ts` (add method)
- `packages/shared/src/systems/shared/combat/CombatSystem.ts` (call method)

**Time Estimate**: 5 minutes

### Problem

`CombatSystem.destroy()` (lines 2587-2606) calls `eventStore.clear()` but EventStore has no `destroy()` method. For consistency with other services (which all have `destroy()`), EventStore should have one too.

### Solution

**Step 1: Add destroy() to EventStore.ts (after line 347)**

```typescript
// EventStore.ts - Add after clear() method

/**
 * Destroy the event store and release resources
 * Call this when the store is no longer needed
 */
destroy(): void {
  this.clear();
  // Future: Close any open resources, cancel timers, etc.
}
```

**Step 2: Update CombatSystem.destroy() (line 2587)**

```typescript
// CombatSystem.ts - destroy() method

destroy(): void {
  // Clean up modular services
  this.stateService.destroy();
  this.animationManager.destroy();

  // Clean up anti-cheat monitoring (Phase 6)
  this.antiCheat.destroy();

  // Clean up rate limiter (Phase 6.5)
  this.rateLimiter.destroy();

  // Clean up event store (Phase 7) - NEW
  this.eventStore.destroy();

  // Release pooled tiles back to pool
  tilePool.release(this._attackerTile);
  tilePool.release(this._targetTile);

  // Clear all attack cooldowns (tick-based)
  this.nextAttackTicks.clear();

  // Call parent cleanup (handles autoCleanup)
  super.destroy();
}
```

### Acceptance Criteria

- [ ] EventStore has `destroy()` method
- [ ] CombatSystem.destroy() calls `this.eventStore.destroy()`
- [ ] No memory leaks from lingering EventStore references

---

## 6. Low: AIStateContext ISP Split

**File**: `packages/shared/src/entities/managers/AIStateMachine.ts`
**Lines**: 31-90
**Time Estimate**: 2 hours

### Problem

`AIStateContext` interface has 25+ methods covering 8 different concerns:
- Position & Movement (3 methods)
- Targeting (4 methods)
- Combat (4 methods)
- Spawn & Leashing (5 methods)
- Wander (3 methods)
- Movement type (1 method)
- Timing (2 methods)
- State management (2 methods)
- Entity Occupancy (3+ methods)

This violates the Interface Segregation Principle (ISP) - clients are forced to depend on methods they don't use.

### Solution

Split into focused interfaces and compose:

```typescript
// AIStateMachine.ts

// Position & Movement
interface AIPositionContext {
  getPosition(): Position3D;
  moveTowards(target: Position3D, deltaTime: number): void;
  teleportTo(position: Position3D): void;
}

// Targeting
interface AITargetingContext {
  findNearbyPlayer(): { id: string; position: Position3D } | null;
  getPlayer(playerId: string): { id: string; position: Position3D } | null;
  getCurrentTarget(): string | null;
  setTarget(playerId: string | null): void;
}

// Combat
interface AICombatContext {
  canAttack(currentTick: number): boolean;
  performAttack(targetId: string, currentTick: number): void;
  isInCombat(): boolean;
  exitCombat(): void;
  getCombatRange(): number;
}

// Spawn & Leashing
interface AISpawnContext {
  getSpawnPoint(): Position3D;
  getDistanceFromSpawn(): number;
  getWanderRadius(): number;
  getLeashRange(): number;
}

// Wander
interface AIWanderContext {
  getWanderTarget(): Position3D | null;
  setWanderTarget(target: Position3D | null): void;
  generateWanderTarget(): Position3D;
  getMovementType(): "stationary" | "wander" | "patrol";
}

// Timing
interface AITimingContext {
  getCurrentTick(): number;
  getTime(): number;
}

// State Management
interface AIStateManagementContext {
  markNetworkDirty(): void;
  emitEvent(eventType: string, data: unknown): void;
}

// Entity Occupancy
interface AIOccupancyContext {
  getEntityId(): EntityID;
  getEntityOccupancy(): IEntityOccupancy;
  isWalkable(tile: TileCoord): boolean;
}

// Composed interface (backwards compatible)
export interface AIStateContext extends
  AIPositionContext,
  AITargetingContext,
  AICombatContext,
  AISpawnContext,
  AIWanderContext,
  AITimingContext,
  AIStateManagementContext,
  AIOccupancyContext {}
```

### Benefits

- States can depend on only what they need
- Easier to test (mock fewer methods)
- Clearer documentation of responsibilities
- Enables future refactoring

### Implementation Steps

1. Define individual interfaces
2. Compose `AIStateContext` from them (maintains backwards compatibility)
3. Update AI states to use specific interfaces where possible
4. Add tests for interface composition

### Acceptance Criteria

- [ ] 8 focused interfaces defined
- [ ] `AIStateContext` composed from them
- [ ] No breaking changes to existing code
- [ ] Each AI state imports only needed interfaces

---

## Summary

| # | Priority | Issue | Time | Files Modified |
|---|----------|-------|------|----------------|
| 1 | **HIGH** | PvP bug in handleAutoRetaliateEnabled | 30 min | CombatSystem.ts |
| 2 | Medium | 4 remaining `as` casts | 1 hour | CombatSystem.ts, typeGuards.ts |
| 3 | Medium | Type guard in handleAutoRetaliateEnabled | ~~15 min~~ | *(Combined with #1)* |
| 4 | Low | XP history cleanup | 30 min | CombatAntiCheat.ts |
| 5 | Low | EventStore.destroy() | 5 min | EventStore.ts, CombatSystem.ts |
| 6 | Low | AIStateContext ISP | 2 hours | AIStateMachine.ts |

**Total**: ~4 hours (reduced from 4.5 since #3 merged into #1)

---

## Verification

After implementing all fixes, re-run the audit:

```bash
# Build
bun run build

# Run combat tests
bun test packages/shared/src/systems/shared/combat

# Run type guard tests
bun test packages/shared/src/utils/__tests__/typeGuards.test.ts

# Lint
bun run lint
```

Expected result: **10/10 audit rating**
