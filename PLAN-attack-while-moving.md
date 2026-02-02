# Plan: OSRS-Accurate Attack While Moving (#735)

## Goal

Implement OSRS-accurate "attack while moving" behavior: clicking a mob/player while already moving immediately redirects the player toward the target. Once in range, attacks fire automatically on cooldown while the player continues following. No stopping required.

---

## OSRS Reference Behavior

**Per-tick loop when attacking a target:**

1. Player clicks target once → enters **follow + attack** mode
2. Each 600ms tick:
   - Path toward target recalculates (target may have moved)
   - Player moves 1 tile (walk) or 2 tiles (run) toward target
   - If in range AND attack cooldown ready → attack fires
   - Movement **pauses on the attack tick** (brief, automatic)
   - Following resumes next tick
3. Loop continues until: target dies, player clicks elsewhere, combat timeout (17 ticks)

**Style-specific ranges:**
- **Melee**: Range 1 (cardinal only). Must catch the target. Freezes are critical.
- **Ranged**: Range 3-10 depending on weapon. Can land hits while still closing distance.
- **Magic**: Range 10. Largest range, fewest ticks spent chasing. Manual cast is 1 tick faster than autocast after repositioning.

**Key principle**: Movement and combat are independent checks within the same tick. Move first, then check range + cooldown. The player never needs to re-click.

---

## Current Architecture (What We Have)

### Systems involved:
| System | File | Role |
|--------|------|------|
| ActionQueue | `server/ServerNetwork/action-queue.ts` | Queues inputs, processes on tick at INPUT priority (0) |
| TileMovementManager | `server/ServerNetwork/tile-movement.ts` | BFS pathfinding, tick-based movement at MOVEMENT priority (1) |
| PendingAttackManager | `server/ServerNetwork/PendingAttackManager.ts` | Walk-to-and-attack tracking at MOVEMENT priority (1) |
| CombatSystem | `shared/systems/shared/combat/CombatSystem.ts` | Attack execution, cooldowns, auto-attack loop at COMBAT priority (2) |
| TickSystem | `server/systems/TickSystem.ts` | 600ms tick scheduler, priority-ordered callbacks |

### Current tick order:
```
Priority 0 (INPUT):   world.currentTick update → duelSystem → actionQueue.processTick()
Priority 1 (MOVEMENT): tileMovement.onTick() → mobTileMovement.onTick() → pendingAttack.processTick()
Priority 2 (COMBAT):   (CombatSystem processes via GameTickProcessor or event-driven)
```

### Current flow when clicking a mob:

1. Client sends `attackMob` packet
2. Server `onAttackMob` handler:
   - Cancels existing combat (`COMBAT_STOP_ATTACK`)
   - Cancels existing pending attacks
   - Checks range → if in range, queues combat via ActionQueue; if not, queues pending attack
3. `PendingAttackManager.queuePendingAttack()` → calls `movePlayerToward()` to start pathing
4. Each tick: `pendingAttack.processTick()` checks range, emits `COMBAT_ATTACK_REQUEST` when in range
5. `CombatSystem` enters combat, auto-attacks on cooldown, emits `COMBAT_FOLLOW_TARGET` if target moves out of range

### Current flow when clicking ground:

1. Client sends `moveRequest` packet
2. `onMoveRequest` handler: cancels pending attacks/follows, queues movement via ActionQueue
3. `actionQueue.processTick()` executes on next tick → calls `handleMoveRequest()` → BFS path → movement starts

---

## Root Cause of Bug #735

**Primary: Action Queue Race Condition**

When a player clicks ground then quickly clicks a mob (within the same 600ms tick window):

1. Ground click → `onMoveRequest` → `actionQueue.queueMovement()` stores pending MOVEMENT
2. Mob click → `onAttackMob` → cancels combat + pending attacks, calls `movePlayerToward()` (overwrites path toward mob)
3. **BUT `onAttackMob` does NOT clear the ActionQueue's pending MOVEMENT**
4. Next tick: `actionQueue.processTick()` runs at INPUT priority (0), **before** MOVEMENT priority (1)
5. Stale ground-click movement executes → `handleMoveRequest()` overwrites path back to ground tile AND emits `PENDING_ATTACK_CANCEL`
6. **Result**: Player walks to ground, attack is canceled

**Secondary: No movement cancellation on attack click**

`onAttackMob` doesn't stop the player's current tile movement or clear the ActionQueue. If `movePlayerToward()` fails silently (empty path, already in range edge case), the old ground-click path persists.

---

## Implementation Plan

### Fix 1: Clear ActionQueue on Attack Click (Critical)

**File**: `packages/server/src/systems/ServerNetwork/index.ts`
**Location**: `onAttackMob` handler (~line 2001) and `onAttackPlayer` handler (~line 2058)

**Change**: After canceling combat and pending attacks, also clear the ActionQueue's pending action for this player. This prevents the stale ground-click movement from executing on the next tick.

```
// In onAttackMob handler, after line 2013:
this.actionQueue.cancelActions(playerEntity.id);
```

**Also requires**: Add a method or use existing `cancelActions()` on ActionQueue. The existing `cancelActions()` method clears `pendingAction`, `interactionQueue`, and `combatTarget` — this is exactly what we need.

### Fix 2: Stop Current Movement on Attack Click

**File**: `packages/server/src/systems/ServerNetwork/index.ts`
**Location**: `onAttackMob` handler and `onAttackPlayer` handler

**Change**: Before `movePlayerToward()` is called (via `queuePendingAttack`), explicitly stop the player's current tile movement. This ensures the old ground-click path doesn't interfere even if the pending attack path calculation has edge cases.

The `movePlayerToward()` already overwrites `state.path`, but we should also cancel any follow that might be active:

```
// In onAttackMob handler, add:
this.followManager.stopFollowing(playerEntity.id);
```

This is already done in `onMoveRequest` but is missing from `onAttackMob`.

### Fix 3: Transition from PendingAttack to CombatFollow (Seamless Loop)

**Current problem**: When `PendingAttackManager` detects the player is in range, it emits `COMBAT_ATTACK_REQUEST` and **deletes** the pending attack. Combat then enters via `CombatSystem.enterCombat()`. If the target moves out of range later, `CombatSystem.checkRangeAndFollow()` emits `COMBAT_FOLLOW_TARGET`, which calls `movePlayerToward()`.

**This already works** — but there's a gap: after the pending attack is deleted and before `checkRangeAndFollow` runs on the next tick, there's 1 tick where nothing is managing the follow. During this tick, if the player was still moving toward the mob, `onTick()` may send `tileMovementEnd` (arrival at destination), which sets `tileMovementActive = false` and sends an "idle" emote.

**Fix**: When `PendingAttackManager` emits `COMBAT_ATTACK_REQUEST` and the player is in range, also stop the player's remaining path (they've arrived). This prevents the 1-tick gap where arrival processing sends misleading packets.

**File**: `packages/server/src/systems/ServerNetwork/PendingAttackManager.ts`
**Location**: `processTick()` around line 226-238

```
if (inRange) {
  // Stop player's remaining path - they've arrived at combat position
  this.tileMovementManager.stopPlayer(playerId);

  // Start combat
  this.world.emit(EventType.COMBAT_ATTACK_REQUEST, { ... });
  this.pendingAttacks.delete(playerId);
}
```

### Fix 4: Combat System — Attack While Following (The OSRS Loop)

**Current behavior**: `CombatSystem.processPlayerCombatTick()` calls `checkRangeAndFollow()` every tick. If out of range, it emits `COMBAT_FOLLOW_TARGET`. If in range and cooldown ready, it calls `processAutoAttackOnTick()`.

**The issue**: `processAutoAttackOnTick()` for melee calls `validateAttackRange()` which returns false if the player isn't adjacent — but by this point the player has already moved this tick (MOVEMENT priority runs before COMBAT priority). The range check should pass if the player moved into range this tick.

**Verify**: Read `processAutoAttackOnTick()` and `checkRangeAndFollow()` to confirm they use the entity's **current** position (post-movement), not a stale cached position. If they read `entity.position` directly (which is updated by `onTick()` at MOVEMENT priority), this should already work correctly since COMBAT runs after MOVEMENT.

**Expected result**: No code change needed here — the tick priority ordering (MOVEMENT before COMBAT) means `entity.position` is already updated when combat checks range. **Verify this during implementation.**

### Fix 5: Ranged/Magic — Attack Without Stopping

**Current behavior for ranged/magic**: `checkRangeAndFollow()` checks if in range. If yes, attack fires. If no, emits `COMBAT_FOLLOW_TARGET` which calls `movePlayerToward()`.

**The OSRS behavior**: For ranged/magic, the player should keep following AND attacking. They don't stop to attack — they fire on cooldown ticks whenever in range, while still moving toward the target.

**Current code in `movePlayerToward()`** (line 1077-1085):
```typescript
if (attackType === AttackType.RANGED || attackType === AttackType.MAGIC) {
  if (tilesWithinRange(state.currentTile, this._targetTile, attackRange)) {
    return; // Already in position, no movement needed
  }
  // ... find best tile and path to it
}
```

**This is correct** — if already in range, no movement issued. The player stays where they are and attacks. But if the target is moving away (PvP), the player needs to keep following while attacking on cooldown ticks when in range.

**The gap**: `COMBAT_FOLLOW_TARGET` is only emitted when **out of range**. If the player is in range but the target is moving, no follow is emitted — the player stands still and attacks until the target moves out of range, then starts following again.

**OSRS behavior**: The player continuously follows the target (path recalculates every tick), and attacks happen as a side-effect on cooldown ticks when range is satisfied. Following is persistent, not toggle-on/toggle-off based on range.

**Fix**: Change the combat follow model from "follow only when out of range" to "follow always while in combat, attack on cooldown when in range". This requires a new `CombatFollowManager` or modification to existing systems.

**Implementation approach**:

**Option A (Minimal — recommended for this PR):**
In `checkRangeAndFollow()`, always emit `COMBAT_FOLLOW_TARGET` when the target has moved from its last known position, regardless of whether in range. The `movePlayerToward()` already returns early if in range, so this is safe and just ensures the player follows a moving target even while in range.

**Option B (Full OSRS model — future PR):**
Create a persistent `CombatFollowState` that tracks the follow target separately from the attack state. Follow persists across attack ticks. This is the "correct" model but is a larger refactor.

**Recommended**: Option A for this PR.

**File**: `packages/shared/src/systems/shared/combat/CombatSystem.ts`
**Location**: `checkRangeAndFollow()` (~line 2566)

```
// Always re-path toward target if they moved (not just when out of range)
// movePlayerToward() already returns early if already in range
if (targetMoved) {
  this.emitTypedEvent(EventType.COMBAT_FOLLOW_TARGET, { ... });
}

// Then separately check range for attack
if (inRange) {
  // Attack is handled by processAutoAttackOnTick() based on cooldown
}
```

### Summary of Changes

| # | File | Change | Priority |
|---|------|--------|----------|
| 1 | `ServerNetwork/index.ts` | Clear ActionQueue in `onAttackMob` and `onAttackPlayer` | Critical |
| 2 | `ServerNetwork/index.ts` | Stop follow in `onAttackMob` and `onAttackPlayer` | Critical |
| 3 | `ServerNetwork/PendingAttackManager.ts` | Stop player movement when entering combat from pending attack | Medium |
| 4 | `CombatSystem.ts` | Verify range checks use post-movement positions | Verify only |
| 5 | `CombatSystem.ts` | Always emit follow when target moves, not just when out of range | Medium |

---

## Testing Plan

1. **Basic redirect**: Walk somewhere, click mob mid-walk → player should immediately redirect toward mob
2. **Rapid clicking**: Click ground then quickly click mob → player should go to mob, not ground
3. **Melee chase**: Attack a mob that moves → player follows and attacks when adjacent
4. **Ranged/Magic chase**: Attack moving target with bow/staff → attacks fire at range while following
5. **Combat timeout**: Walk away during combat → combat times out after 17 ticks
6. **Target switch**: Attack mob A, then click mob B mid-walk → immediately redirect to B
7. **Ground cancel**: In combat, click ground → combat stops, player walks to ground tile
8. **PvP chase**: Attack player in wilderness, both running → attacks fire on cooldown when in range

---

## Files to Modify

1. `packages/server/src/systems/ServerNetwork/index.ts` — `onAttackMob`, `onAttackPlayer` handlers
2. `packages/server/src/systems/ServerNetwork/PendingAttackManager.ts` — `processTick()`
3. `packages/shared/src/systems/shared/combat/CombatSystem.ts` — `checkRangeAndFollow()`

## Files to Read/Verify (no changes expected)

4. `packages/server/src/systems/ServerNetwork/tile-movement.ts` — Confirm `movePlayerToward()` handles re-pathing correctly
5. `packages/server/src/systems/ServerNetwork/action-queue.ts` — Confirm `cancelActions()` API is sufficient
