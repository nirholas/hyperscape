# Resource Gathering OSRS Accuracy Plan

## Executive Summary

This document outlines fixes to make the resource gathering system OSRS-accurate. The current implementation has several deviations from authentic OSRS behavior that need correction.

**Issues to Address:**
1. **Movement during gathering gives XP** - Player can walk around within range and still receive resources/XP
2. **#336: Trees don't save depletion state** - Re-clicking a depleting tree resets its timer
3. **#335: Player doesn't face resource** - Character should turn to face tree/rock when gathering starts

**OSRS Reference Sources:**
- [OSRS Wiki - Woodcutting](https://oldschool.runescape.wiki/w/Woodcutting)
- [OSRS Wiki - Mining](https://oldschool.runescape.wiki/w/Mining)
- [OSRS Wiki - Forestry](https://oldschool.runescape.wiki/w/Forestry)
- [OSRS Docs - Face Direction](https://osrs-docs.com/docs/packets/outgoing/updating/masks/face-direction/)
- [OSRS Docs - Queues](https://osrs-docs.com/docs/mechanics/queues/)
- [GitHub - OSRS Skilling Guides](https://github.com/data-dependent/osrs-guides/blob/master/skilling.md)

---

## OSRS Queue System: Critical Background

Understanding OSRS's action queue system is essential for accurate implementation.

### Queue Types

| Type | Behavior | Examples |
|------|----------|----------|
| **Weak** | Cancelled by any interaction (clicking ground, items, interfaces) | Most skilling: fletching, cooking, woodcutting, mining, fishing |
| **Normal** | Stalls when interface open, resumes when closed | Some interactions |
| **Strong** | Cannot be cancelled, closes interfaces | Teleports, cutscenes |

### What Cancels Weak Actions (Gathering)

According to [OSRS Docs](https://osrs-docs.com/docs/mechanics/queues/), weak scripts are removed upon:
- **Clicking on a game square** (ground click)
- Interacting with an entity
- Interacting with inventory items
- Equipping/unequipping items
- Opening or closing interfaces
- Dragging items in inventory

**Key Insight:** It's the **click** that cancels, not the movement. When a player clicks ground, the gathering action is immediately cancelled regardless of whether they actually move.

---

## Current Behavior vs OSRS Behavior

### Issue 1: Clicking/Movement During Gathering

| Aspect | Current Behavior | OSRS Behavior |
|--------|------------------|---------------|
| Click ground (even same tile) | XP continues | **Action cancelled immediately** |
| Move within range | XP continues | **Action cancelled on click** |
| Move out of range | Action cancelled | Action cancelled |
| Click inventory item | Unknown | **Action cancelled** |
| Open interface | Unknown | **Action cancelled** |

**Root Cause:** The current code only checks if `calculateDistance(playerPos, resource.position) > 4.0` in `processGatheringTick()`. This allows:
1. Movement within the 4-tile radius
2. Clicking ground without consequence
3. Various other interactions without cancellation

**OSRS Mechanic:** Gathering uses a **weak queue action**. Any interaction (clicking ground, items, interfaces) immediately cancels it. This is explicitly used in [tick manipulation](https://oldschool.runescape.wiki/w/Tick_manipulation) - players click ground on off-ticks to cancel and reset the gathering action for faster XP.

### Issue 2: Tree Depletion State Not Saved (#336)

| Aspect | Current Behavior | OSRS Behavior |
|--------|------------------|---------------|
| When timer starts | On interaction start | **On FIRST LOG received** |
| Re-click tree mid-chop | New session, timer reset | **Timer continues from where it was** |
| Stop chopping | Session ends | **Timer regenerates at 1 tick/tick** |
| Multiple players | Independent sessions | **Shared timer (but no penalty)** |
| Timer at zero | N/A | **Next log depletes tree** |
| Timer at zero, no one chopping | N/A | **Timer regenerates, tree survives** |

**Root Cause:** Depletion uses `depleteChance` roll per-attempt with no persistent timer.

**OSRS Mechanic (Post-Forestry, June 2023):**

From the [OSRS Wiki](https://oldschool.runescape.wiki/w/Forestry) and [RuneLite discussion](https://github.com/runelite/runelite/discussions/16894):

1. **Timer starts on FIRST LOG** - Not when you start chopping, but when you successfully receive the first log
2. **Counts down at 1 tick per tick** - While anyone is chopping
3. **Regenerates at 1 tick per tick** - When no one is chopping (same rate as depletion)
4. **Tree depletes when**: Timer = 0 AND player receives a log
5. **Timer NOT affected by player count** - Multiple players don't speed up depletion
6. **Exception**: Farming-grown trees don't use this system

**Despawn/Respawn Times (from manifest or defaults):**

| Tree Type | Despawn Time | Respawn Time |
|-----------|--------------|--------------|
| Regular Tree | N/A (1/8 chance) | 5-10 seconds |
| Oak | 27 seconds (45 ticks) | 8.4 seconds (14 ticks) |
| Willow | 30 seconds (50 ticks) | 8.4 seconds (14 ticks) |
| Teak | 30 seconds (50 ticks) | 9 seconds (15 ticks) |
| Maple | 60 seconds (100 ticks) | 35.4 seconds (59 ticks) |
| Yew | 114 seconds (190 ticks) | 60 seconds (100 ticks) |
| Magic | 234 seconds (390 ticks) | 119.4 seconds (199 ticks) |
| Redwood | 264 seconds (440 ticks) | 119.4 seconds (199 ticks) |

### Issue 3: Player Doesn't Face Resource (#335)

| Aspect | Current Behavior | OSRS Behavior |
|--------|------------------|---------------|
| Start gathering | No rotation | **Instant rotation to face target** |
| During gathering | Rotation unchanged | Maintains facing |
| Animation | Plays in current direction | **Plays toward resource** |

**OSRS Mechanic:** When interacting with any object, the [Face Direction mask](https://osrs-docs.com/docs/packets/outgoing/updating/masks/face-direction/) updates the player's rotation immediately. The rotation is instant (RuneScape-style), not animated.

---

## Skill-Specific Mechanics

### Woodcutting (Post-Forestry)
- **Depletion**: Timer-based (see table above)
- **Roll frequency**: Every 4 ticks (2.4 seconds)
- **Timer starts**: On first log received
- **Timer regenerates**: When no one is chopping

### Mining
- **Depletion**: Chance-based (NOT timer-based)
  - Most rocks: 1/8 chance per ore
  - Redwood tree sections: 1/11 chance
  - Gem rocks: Never deplete
- **Roll frequency**: Varies by pickaxe (2-8 ticks)
- **Respawn times**: Rock-specific (iron: 5.4s, runite: 12 minutes)

### Fishing
- **Depletion**: Fishing spots don't deplete, they **move** periodically
- **Roll frequency**: Every 5 ticks (3 seconds)
- **Spot movement**: Random timer, spot relocates to nearby tile

---

## Technical Implementation

### Current Code Flow (ResourceSystem.ts)

```
1. Client clicks resource
2. resources.ts handler emits RESOURCE_GATHER event
3. startGathering() called:
   - Rate limit check ✓
   - Resource ID validation ✓
   - Tool check ✓
   - Skill level check ✓
   - Creates session with cached data ✓
   - NO position stored at start ✗
   - NO facing rotation ✗
   - NO input cancellation system ✗

4. processGatheringTick() called every 600ms:
   - Checks distance > 4.0 (allows movement within range) ✗
   - NO click/input detection ✗
   - Rolls depleteChance independently (no shared timer) ✗
```

### Architecture Decision: Click Detection vs Position Check

**Option A: Detect Clicks (True OSRS Behavior)**
- Subscribe to player input events
- Cancel gathering on any click/input
- Pros: Accurate to OSRS
- Cons: Requires input event system integration

**Option B: Detect Position Change (Simplified)**
- Store starting position
- Cancel if player position changes at all
- Pros: Simpler implementation
- Cons: Doesn't cancel on same-tile clicks or interface opens

**IMPLEMENTED:** Both options are now active for maximum OSRS accuracy:
1. **Option A**: Subscribe to `MOVEMENT_CLICK_TO_MOVE` event - cancels gathering immediately when player clicks ground (any tile)
2. **Option B**: Position check fallback - if click event is missed, movement detection still catches it

---

## Implementation Plan

### Phase 1: Click & Movement Cancellation (Critical Bug Fix) ✅ IMPLEMENTED

**Priority:** HIGH - This is actively breaking gameplay

**Status:** ✅ COMPLETE

**Files modified:**
- `packages/shared/src/systems/shared/entities/ResourceSystem.ts`
- `packages/shared/src/constants/GatheringConstants.ts`
- `packages/server/src/systems/ServerNetwork/tile-movement.ts`

**Implementation (Two-Layer Defense):**

1.1. **Click-Based Cancellation (True OSRS Behavior):**
- Server's `TileMovementManager.handleMoveRequest()` emits `MOVEMENT_CLICK_TO_MOVE` event
- Critical: Event is emitted BEFORE any early returns (same-tile check, cancellation, etc.)
- ResourceSystem subscribes to `MOVEMENT_CLICK_TO_MOVE` event in `init()`
- When player clicks ground (any tile, even under themselves), gathering is immediately cancelled
- This matches OSRS weak queue behavior exactly

1.2. **Position-Based Fallback:**
- Added `cachedStartPosition` to session object
- Added `POSITION_EPSILON: 0.01` constant to GatheringConstants
- Check for position changes in `processGatheringTick()`
- If click event is somehow missed, movement detection still catches it

1.3. **Additional Weak Queue Cancellation Events:**
Added `cancelGatheringForPlayer()` helper and subscriptions to:
- `PLAYER_DIED` - Dead players can't gather
- `PLAYER_TELEPORT_REQUEST` - Can't gather from across the map
- `COMBAT_ATTACK_REQUEST` - Attacking is a new action
- `BANK_OPEN` - Opening bank interface
- `STORE_OPEN` - Opening store interface
- `ENTITY_INTERACT_REQUEST` - Clicking another entity (except same resource)
- `ITEM_DROP` - Dropping an item (also prevents inventory deadlocks)

**OSRS Exception (intentionally NOT cancelled):**
- `PLAYER_DAMAGE` - You keep chopping while being hit
- `ITEM_USED` (eating) - You can eat while woodcutting

**Validation:**
- [x] Player standing completely still receives XP
- [x] Player clicking ground (even within range) stops receiving XP
- [x] Player clicking ground under themselves stops receiving XP
- [x] Player walking any direction stops receiving XP immediately
- [x] Player must re-click resource to resume gathering
- [x] Works for woodcutting, mining, and fishing
- [x] Player dying cancels gathering
- [x] Player teleporting cancels gathering
- [x] Player attacking mob/player cancels gathering
- [x] Opening bank/store cancels gathering
- [x] Clicking another entity cancels gathering
- [x] Dropping an item cancels gathering

---

### Phase 2: Face Direction (#335) ✅ IMPLEMENTED

**Priority:** MEDIUM - Visual polish, affects immersion

**Status:** ✅ COMPLETE

**Files modified:**
- `packages/shared/src/systems/shared/entities/ResourceSystem.ts`

**Implementation:**

2.1. Added `rotatePlayerToFaceResource()` method:
- Uses pooled quaternions for memory efficiency (same pattern as CombatRotationManager)
- Sets rotation on entity.rotation (server sync) and entity.base/node.quaternion (client render)
- **Snaps angle to nearest 45° for 8-direction facing (N, NE, E, SE, S, SW, W, NW)**
- Adds PI to angle for VRM 1.0+ models with 180° base rotation
- Calls `markNetworkDirty()` to broadcast rotation change

2.2. Called in `startGathering()` after position computation, before session creation:
```typescript
// OSRS-ACCURACY: Rotate player to face the resource (instant rotation like OSRS)
this.rotatePlayerToFaceResource(data.playerId, resource.position);
```

**Validation:**
- [x] Player rotates to face tree when clicking to chop
- [x] Player rotates to face rock when clicking to mine
- [x] Player rotates to face fishing spot when clicking to fish
- [x] Rotation is instant (not animated)
- [x] Gathering animation plays in correct direction

---

### Phase 3: Global Resource Depletion Timer (#336) ✅ IMPLEMENTED

**Priority:** MEDIUM - Affects gameplay authenticity

**Status:** ✅ COMPLETE

**Files modified:**
- `packages/shared/src/systems/shared/entities/ResourceSystem.ts`
- `packages/shared/src/constants/GatheringConstants.ts`

**Implementation:**

3.1. Add resource timer tracking structure:
```typescript
/**
 * Per-resource depletion timer (Forestry-style)
 * Shared across all players, persists between interactions
 */
private resourceTimers = new Map<ResourceID, {
  currentTicks: number;           // Current timer value (counts down)
  maxTicks: number;               // From manifest despawnTicks
  hasReceivedFirstLog: boolean;   // Timer only starts after first log
  activeGatherers: Set<PlayerID>; // Players currently gathering this resource
  lastUpdateTick: number;         // For regeneration calculation
}>();
```

3.2. Add constants for tree despawn times:
```typescript
// In GatheringConstants.ts
TREE_DESPAWN_TICKS: {
  tree: 0,           // Regular trees use 1/8 chance, not timer
  oak: 45,           // 27 seconds
  willow: 50,        // 30 seconds
  teak: 50,          // 30 seconds
  maple: 100,        // 60 seconds
  yew: 190,          // 114 seconds
  magic: 390,        // 234 seconds
  redwood: 440,      // 264 seconds
} as const,

// Mining uses chance-based, not timer-based
MINING_DEPLETE_CHANCE: 0.125,  // 1/8

// Fishing spots don't deplete
FISHING_SPOT_MOVE_TICKS: 300,  // Average time before spot moves
```

3.3. Initialize timer on first log (NOT first interaction):
```typescript
// In the success branch of processGatheringTick(), after rolling success:
private onGatheringSuccess(
  playerId: PlayerID,
  session: GatheringSession,
  resource: Resource
): void {
  let timer = this.resourceTimers.get(session.resourceId);

  // Initialize timer on FIRST LOG (not first interaction)
  if (!timer) {
    const maxTicks = this.getResourceDespawnTicks(resource);
    if (maxTicks > 0) { // Timer-based resource
      timer = {
        currentTicks: maxTicks,
        maxTicks: maxTicks,
        hasReceivedFirstLog: true,
        activeGatherers: new Set([playerId]),
        lastUpdateTick: this.world.currentTick,
      };
      this.resourceTimers.set(session.resourceId, timer);
    }
  }

  // Check if tree should deplete
  if (timer && timer.currentTicks <= 0) {
    // Timer expired - deplete resource
    this.depleteResource(resource, session.resourceId);
  }

  // ... rest of success handling (item drop, XP) ...
}
```

3.4. Update timers in processGatheringTick():
```typescript
// Process resource timers (depletion and regeneration)
private processResourceTimers(tickNumber: number): void {
  for (const [resourceId, timer] of this.resourceTimers) {
    const ticksDelta = tickNumber - timer.lastUpdateTick;
    timer.lastUpdateTick = tickNumber;

    if (timer.activeGatherers.size > 0) {
      // Being gathered - decrement timer
      timer.currentTicks = Math.max(0, timer.currentTicks - ticksDelta);
    } else if (timer.hasReceivedFirstLog) {
      // Not being gathered but was started - regenerate
      timer.currentTicks = Math.min(
        timer.maxTicks,
        timer.currentTicks + ticksDelta
      );

      // If fully regenerated, can reset the "first log" flag
      if (timer.currentTicks >= timer.maxTicks) {
        // Optional: Could delete timer here to free memory
        // this.resourceTimers.delete(resourceId);
      }
    }
  }
}
```

3.5. Track active gatherers:
```typescript
// When starting gathering:
timer?.activeGatherers.add(playerId);

// When stopping gathering (any reason):
timer?.activeGatherers.delete(playerId);
```

3.6. Handle mining separately (chance-based, not timer):
```typescript
private shouldDepleteResource(resource: Resource): boolean {
  // Mining uses 1/8 chance per ore (not timer)
  if (resource.type === 'ore' || resource.type === 'mine') {
    return Math.random() < GATHERING_CONSTANTS.MINING_DEPLETE_CHANCE;
  }

  // Fishing spots don't deplete (they move, handled elsewhere)
  if (resource.type === 'fishing_spot') {
    return false;
  }

  // Trees use timer system - handled in onGatheringSuccess
  return false;
}
```

**Validation:**
- [x] First log starts tree timer
- [x] Timer counts down while chopping
- [x] Stopping and resuming continues same timer
- [x] Timer regenerates when no one is chopping
- [x] Tree only falls when timer = 0 AND log received
- [x] Multiple players share same timer
- [x] Mining still uses 1/8 chance (not timer)
- [x] Fishing spots don't deplete

---

### Phase 4: Mining-Specific Mechanics ✅ IMPLEMENTED

**Priority:** LOW - Mining works differently than woodcutting

**Status:** ✅ COMPLETE

**Changes:**
- Mining uses 1/8 chance per ore to deplete (no timer) ✅
- Mining gloves can prevent depletion (future enhancement)
- Different rocks have different respawn times ✅

**Implementation:**
- `ResourceSystem.ts` uses `GATHERING_CONSTANTS.MINING_DEPLETE_CHANCE` (0.125 = 1/8) for mining depletion
- Mining bypasses the Forestry timer system and uses chance-based depletion
- Rock-specific respawn times are manifest-driven via `respawnTicks` in `resources.json`
- Updated copper/tin rock respawn to 4 ticks (~2.4s) for OSRS accuracy

---

### Phase 5: Future Enhancements ✅ PARTIALLY IMPLEMENTED

**Priority:** LOW - Nice to have for full OSRS accuracy

**Status:** 5.1, 5.2, 5.3 COMPLETE - 5.4 remains future work

5.1. **Full input cancellation system:** ✅ IMPLEMENTED
- Subscribe to click events ✅
- Cancel gathering on any click (not just movement) ✅
- Cancel on interface open/close ✅ (BANK_OPEN, STORE_OPEN)
- Cancel on inventory interaction ✅ (ITEM_DROP)
- Cancel on equipment changes ✅ (EQUIPMENT_EQUIP, EQUIPMENT_UNEQUIP)

5.2. **Fishing spot movement:** ✅ IMPLEMENTED
- Spots don't deplete, they relocate ✅
- Random timer for movement (300 ± 100 ticks = 2-4 minutes) ✅
- Move to nearby valid tile (1-3 tile radius) ✅
- Cancel gathering and notify player when spot moves ✅

5.3. **"You swing your axe at the tree" message:** ✅ IMPLEMENTED
- Woodcutting: "You swing your axe at the [tree]."
- Mining: "You swing your pickaxe at the [rock]."
- Fishing: "You attempt to catch some fish."

5.4. **Forestry events:** (Future Work)
- Rising roots
- Group bonus
- Event eligibility timer

---

## Constants Summary

```typescript
// GatheringConstants.ts additions
export const GATHERING_CONSTANTS = {
  // ... existing constants ...

  // Position change detection
  POSITION_EPSILON: 0.01,  // Floating point tolerance for position comparison

  // Tree despawn times (ticks) - Forestry system
  TREE_DESPAWN_TICKS: {
    tree: 0,        // Uses 1/8 chance instead
    oak: 45,
    willow: 50,
    teak: 50,
    maple: 100,
    yew: 190,
    magic: 390,
    redwood: 440,
  } as const,

  // Tree respawn times (ticks)
  TREE_RESPAWN_TICKS: {
    tree: 10,       // ~6 seconds
    oak: 14,
    willow: 14,
    teak: 15,
    maple: 59,
    yew: 100,
    magic: 199,
    redwood: 199,
  } as const,

  // Mining depletion (chance-based, not timer)
  MINING_DEPLETE_CHANCE: 0.125,     // 1/8
  MINING_REDWOOD_DEPLETE_CHANCE: 0.091,  // 1/11

  // Timer regeneration
  TIMER_TICKS_PER_TICK: 1,  // 1:1 regen rate

  // Fishing spot movement (OSRS-accurate)
  FISHING_SPOT_MOVE: {
    baseTicks: 300,           // 3 minutes average
    varianceTicks: 100,       // ±1 minute variance
    relocateRadius: 3,        // Max tiles to move
    relocateMinDistance: 1,   // Min tiles from current position
  } as const,
} as const;
```

---

## Testing Checklist

### Phase 1: Position-Based Cancellation
- [ ] Stand completely still → receive logs/ore/fish ✓
- [ ] Click ground (same tile) → gathering should stop (if implementing full input detection)
- [ ] Click ground (different tile) → gathering stops ✓
- [ ] Walk 1 tile any direction → gathering stops immediately ✓
- [ ] Walk back to resource → must re-click to gather ✓
- [ ] Running through resource → never receives XP ✓
- [ ] Tab out and back → gathering continues (no position change) ✓

### Phase 2: Face Direction
- [ ] Click tree from south → player faces north ✓
- [ ] Click tree from east → player faces west ✓
- [ ] Click tree from diagonal → player faces toward tree ✓
- [ ] Click rock → player faces rock ✓
- [ ] Click fishing spot → player faces spot ✓
- [ ] Rotation is instant (not animated) ✓

### Phase 3: Tree Depletion Timer ✅ IMPLEMENTED
- [x] Start chopping → timer NOT started yet
- [x] Receive first log → timer starts
- [x] Chop for 10 seconds, stop → timer pauses
- [x] Wait 10 seconds → timer regenerates 10 seconds worth
- [x] Resume chopping → timer continues from current value
- [x] Player A stops, Player B starts → same timer continues
- [x] Timer reaches 0, get log → tree falls
- [x] Timer at 1, get log → tree stays up
- [x] No one chopping for full duration → timer fully regenerates

### Phase 4: Mining ✅ IMPLEMENTED
- [x] Mine ore → 1/8 chance to deplete rock
- [x] Multiple ores in a row → eventually depletes
- [x] Depleted rock → respawns after rock-specific time (copper/tin: 4 ticks = 2.4s)

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Position epsilon too small | Medium | Low | Start with 0.01, adjust if false positives |
| Position epsilon too large | Low | Medium | Test with intentional micro-movements |
| Timer sync issues multiplayer | Low | Medium | Use server tick as single source of truth |
| Performance: tracking many timers | Low | Low | Lazy init, cleanup on respawn |
| Breaking existing gathering flow | Medium | High | Feature flag for rollback |

---

## Success Criteria

After implementation:
- [x] Zero reports of "getting XP while walking"
- [x] Player visibly faces resource before animation starts
- [x] Trees deplete on timer (matches OSRS Forestry)
- [x] Mining still depletes on chance (1/8)
- [x] Re-clicking tree doesn't reset timer
- [ ] Passes side-by-side OSRS comparison test

---

*Document Version: 2.0*
*Created: January 2026*
*Last Updated: January 2026*
*Based on: OSRS Wiki, OSRS Docs, RuneLite discussions, community research*

## Appendix: OSRS Source References

### Queue System
- [OSRS Docs - Queues](https://osrs-docs.com/docs/mechanics/queues/) - Weak/Normal/Strong queue types
- [GitHub - OSRS Skilling Guides](https://github.com/data-dependent/osrs-guides/blob/master/skilling.md) - Detailed skilling mechanics

### Tree Mechanics
- [OSRS Wiki - Forestry](https://oldschool.runescape.wiki/w/Forestry) - Timer-based depletion
- [RuneLite Discussion #16894](https://github.com/runelite/runelite/discussions/16894) - Timer implementation details
- [OSRS Wiki - Woodcutting](https://oldschool.runescape.wiki/w/Woodcutting) - Roll frequency, tool tiers

### Tick Manipulation (Proves Click Cancellation)
- [OSRS Wiki - Tick Manipulation](https://oldschool.runescape.wiki/w/Tick_manipulation) - 2-tick teaks use ground clicks to cancel

### Mining
- [OSRS Wiki - Mining](https://oldschool.runescape.wiki/w/Mining) - 1/8 depletion chance, pickaxe tiers

### Face Direction
- [OSRS Docs - Face Direction Mask](https://osrs-docs.com/docs/packets/outgoing/updating/masks/face-direction/) - Protocol details
