# Resource Gathering System Improvements

**Goal:** Achieve 9/10 production quality rating

**Current Rating:** 8.5/10 (after Phase 1-4 + fishing fixes)

---

## Current Ratings Breakdown

| Criteria | Current | Target | Gap | Notes |
|----------|---------|--------|-----|-------|
| Production Quality | 8.5 | 9.0 | -0.5 | Improved (error handling, debug flags, types) |
| Best Practices | 8.5 | 9.0 | -0.5 | Improved (type safety, interfaces) |
| OWASP Security | 8.0 | 9.0 | -1.0 | Unchanged |
| Memory Hygiene | 8.5 | 9.0 | -0.5 | **Improved** (3 hot path allocations fixed) |
| SOLID Principles | 6.0 | 8.5 | -2.5 | Improved (interfaces, method extraction) |
| OSRS Likeness | 9.0 | 9.0 | 0 | Unchanged |

---

## CRITICAL: Memory Allocation in Hot Paths

**Severity: HIGH** - These allocations happen every 600ms tick and cause GC pressure.

### Hot Path Allocations Found (VERIFIED)

| File | Line | Issue | Fix |
|------|------|-------|-----|
| `ResourceSystem.ts` | 2117 | `const completedSessions: PlayerID[] = []` | Pre-allocate reusable array |
| `ResourceSystem.ts` | 1888 | `const respawnedResources: ResourceID[] = []` | Pre-allocate reusable array |
| `ResourceSystem.ts` | 1961 | `const spotsToMove: ResourceID[] = []` | Pre-allocate reusable array |
| `ResourceSystem.ts` | 275 | `{ x: 0, y: 0, z: 0 }` fallback object | Pre-allocate static fallback |

**Note:** Line 2020 `.filter()` is NOT a hot path issue - only called when fishing spots move (~3 min).

### Required Fix Pattern

```typescript
// BEFORE (allocates every tick)
private processGatheringTick(tickNumber: number): void {
  const completedSessions: PlayerID[] = [];  // ❌ NEW ARRAY EVERY TICK
  // ...
}

// AFTER (zero allocation)
private readonly _completedSessionsBuffer: PlayerID[] = [];  // ✅ Pre-allocated

private processGatheringTick(tickNumber: number): void {
  const completedSessions = this._completedSessionsBuffer;
  completedSessions.length = 0;  // ✅ Clear without allocation
  // ...
}
```

---

## CRITICAL: Missing Error Handling

**Severity: HIGH** - Unhandled errors could break entire tick processing.

### PendingGatherManager.processTick() - No try/catch
**File:** `packages/server/src/systems/ServerNetwork/PendingGatherManager.ts`

```typescript
// BEFORE
processTick(currentTick: number): void {
  for (const [playerId, pending] of this.pendingGathers) {
    // If any error occurs here, entire tick processing breaks
    const player = this.world.getPlayer?.(playerId);
    // ...
  }
}

// AFTER
processTick(currentTick: number): void {
  for (const [playerId, pending] of this.pendingGathers) {
    try {
      // Process each player independently
      this.processPlayerGather(playerId, pending, currentTick);
    } catch (error) {
      console.error(`[PendingGather] Error processing ${playerId}:`, error);
      this.pendingGathers.delete(playerId);  // Fail-safe cleanup
    }
  }
}
```

---

## CRITICAL: Incomplete Test Coverage

**Severity: HIGH** - Unit tests exist but critical flows are NOT tested.

### Existing Tests (packages/shared/src/systems/shared/entities/__tests__/ResourceSystem.test.ts)

- [x] `rollDrop` - Drop probability distribution
- [x] `isValidResourceId` - Security validation
- [x] `getToolCategory` - Tool extraction
- [x] `computeSuccessRate` - OSRS-style success rate
- [x] `computeCycleTicks` - Cycle time calculation
- [x] `TOOL_TIERS` - Tool tier validation

### Missing Critical Flow Tests

- [ ] `startGathering` - Full validation flow
- [ ] `processGatheringTick` - Tick processing with movement cancellation
- [ ] `rollFishDrop` - OSRS priority rolling
- [ ] `PendingGatherManager.test.ts` - Movement-to-gather flow
- [ ] Disconnect cleanup verification
- [ ] Inventory full handling
- [ ] Bait/feather consumption

### Required Test Coverage

```typescript
// Example: ResourceSystem.test.ts
describe('ResourceSystem', () => {
  describe('startGathering', () => {
    it('should reject if player lacks required level', () => {});
    it('should reject if player lacks required tool', () => {});
    it('should reject if player lacks bait/feathers', () => {});
    it('should create gathering session with cached data', () => {});
  });

  describe('processGatheringTick', () => {
    it('should cancel on player movement', () => {});
    it('should stop when inventory full', () => {});
    it('should consume bait on successful catch', () => {});
  });

  describe('rollFishDrop', () => {
    it('should use priority rolling (high-level first)', () => {});
    it('should skip fish above player level', () => {});
    it('should fallback to lowest-level fish', () => {});
  });
});
```

---

## Phase 1: Dead Code Removal (Quick Wins) ✅ COMPLETED

### 1.1 Remove unused `setArrivalRotation` infrastructure ✅
**File:** `packages/server/src/systems/ServerNetwork/tile-movement.ts`

- [x] Remove `arrivalRotations` Map (line 67-68)
- [x] Remove `setArrivalRotation()` method (lines 795-800)
- [x] Remove `clearArrivalRotation()` method (lines 805-807)
- [x] Remove arrivalRotation handling in `processPlayerTick()` (lines 557-558, 710-711)
- [x] Remove cleanup in `cleanup()` method (line 760)

**Reason:** Rotation is now handled by `FaceDirectionManager`. This code is never called.

### ~~1.2 Remove legacy `handleResourceGather` handler~~ - KEEP THIS

**Status:** NOT DEAD CODE - Used by ElizaOS AI agents

**File:** `packages/plugin-hyperscape/src/services/HyperscapeService.ts` line 2002
```typescript
this.sendCommand("resourceGather", {
  resourceId: command.resourceEntityId,
  playerPosition,
});
```

AI agents use `resourceGather` for server-authoritative gathering. DO NOT REMOVE.

---

## Phase 2: Memory Hygiene (Critical) ✅ COMPLETED

### 2.1 Pre-allocate tick processing buffers ✅
**File:** `packages/shared/src/systems/shared/entities/ResourceSystem.ts`

Added private reusable buffers at class level:
```typescript
// ===== PERFORMANCE: Pre-allocated buffers for zero-allocation hot paths =====
private readonly _completedSessionsBuffer: PlayerID[] = [];
private readonly _respawnedResourcesBuffer: ResourceID[] = [];
private readonly _spotsToMoveBuffer: ResourceID[] = [];
private readonly _fallbackPosition = { x: 0, y: 0, z: 0 };
```

Updated methods to use buffers:
- [x] `processGatheringTick()` - use `_completedSessionsBuffer`
- [x] `processRespawns()` - use `_respawnedResourcesBuffer`
- [x] `processFishingSpotMovement()` - use `_spotsToMoveBuffer`
- [~] Event handler fallback position - **SKIPPED** (stored by reference in session, not a hot path)

### ~~2.2 Replace `.filter()` with for-loop in hot path~~ - NOT NEEDED

**Status:** Line 2020 `.filter()` is in `relocateFishingSpot()` which only runs when spots move (~3 min).
This is NOT a hot path allocation. Low priority optimization only.

---

## Phase 3: Code Quality Improvements ✅ COMPLETED

### 3.1 Add debug flag to FaceDirectionManager ✅
**File:** `packages/server/src/systems/ServerNetwork/FaceDirectionManager.ts`

- [x] Add `static DEBUG = false;` flag at class level
- [x] Wrap all `console.log` statements with `if (FaceDirectionManager.DEBUG)`
- [x] Kept `console.warn` for actual bugs (missing rotation target, missing markNetworkDirty)

### 3.2 Add error handling to PendingGatherManager ✅
**File:** `packages/server/src/systems/ServerNetwork/PendingGatherManager.ts`

- [x] Extract loop body to `processPlayerPendingGather()` method
- [x] Wrap call in try/catch with error logging
- [x] Clean up failed entries on error to prevent infinite loops

### 3.3 Fix redundant `resetGatheringEmote` calls
**File:** `packages/shared/src/systems/shared/entities/ResourceSystem.ts`

- [~] **DEFERRED** - Needs verification that cleanup loop covers all edge cases

**Reason:** Lower priority, needs careful testing to ensure no edge cases missed.

---

## Phase 4: Type Safety ✅ COMPLETED

### 4.1 Eliminate `as unknown as` type escape hatches ✅

**Fixed type casts:**
| File | Fix Applied |
|------|-------------|
| `ResourceSystem.ts` | Created `PlayerWithEmote` interface, used clean cast |
| `ResourceSystem.ts` | Created `ResourceEntityMethods` interface for respawn/deplete |
| `ResourceSystem.ts` | Updated `stopGathering` to accept `PlayerID`, removed 4 casts |
| `FaceDirectionManager.ts` | Changed `as unknown as FaceableEntity` to `as FaceableEntity` |

**Interfaces added to ResourceSystem.ts:**
```typescript
interface PlayerWithEmote {
  emote?: string;
  data?: { e?: string };
  markNetworkDirty?: () => void;
}

interface ResourceEntityMethods {
  respawn?: () => void;
  deplete?: () => void;
}
```

### 4.2 Create proper interfaces for cross-manager access
- [~] **DEFERRED** - PendingGatherManager casts work fine with current approach

### 4.3 Update PendingGatherManager to use interfaces
- [~] **DEFERRED** - Lower priority, current approach is readable

---

## Phase 5: SOLID Principles (Architecture)

### 5.1 Split ResourceSystem into modules
**Current:** Single 3000+ line `ResourceSystem.ts`

**Proposed Structure:**
```
packages/shared/src/systems/shared/entities/
├── ResourceSystem.ts (orchestrator, ~500 lines)
├── gathering/
│   ├── GatheringSessionManager.ts (~400 lines)
│   ├── ToolValidator.ts (~200 lines)
│   ├── DropRoller.ts (~300 lines)
│   └── types.ts
├── skills/
│   ├── WoodcuttingModule.ts (~300 lines)
│   ├── MiningModule.ts (~300 lines)
│   └── FishingModule.ts (~400 lines)
└── spawning/
    ├── ResourceSpawner.ts (~400 lines)
    └── FishingSpotManager.ts (~300 lines)
```

### 5.2 Extract GatheringSessionManager
- [ ] Move `activeGathering` Map and session logic
- [ ] Move `startGathering()`, `stopGathering()`, `cancelGatheringForPlayer()`
- [ ] Move tick processing logic (`processGatheringTick`)

### 5.3 Extract ToolValidator
- [ ] Move `getBestTool()`, `playerHasToolCategory()`, `getToolCategory()`
- [ ] Move tool-related constants and validation

### 5.4 Extract DropRoller
- [ ] Move `rollDrop()`, `rollFishDrop()`, `lerpSuccessRate()`
- [ ] Move drop table processing logic

---

## Phase 6: Security Hardening

### 6.1 Add input validation to all public methods
- [ ] Validate `playerId` format in all handler entry points
- [ ] Add max concurrent sessions per player check
- [ ] Log suspicious patterns (rapid disconnect/reconnect during gather)

### 6.2 Rate limiting improvements
- [ ] Add exponential backoff for repeated violations
- [ ] Add per-resource rate limiting (prevent targeting single resource)

---

## Phase 7: Testing

### 7.1 Unit Tests
- [ ] `ResourceSystem.test.ts` - Core gathering logic
- [ ] `PendingGatherManager.test.ts` - Movement-to-gather flow
- [ ] `DropRoller.test.ts` - Drop calculations
- [ ] `ToolValidator.test.ts` - Tool/level validation

### 7.2 Integration Tests
- [ ] Full fishing flow (click → walk → fish → catch)
- [ ] Disconnect during gathering cleanup
- [ ] Inventory full handling
- [ ] Bait consumption

---

## Implementation Order (Revised)

| Phase | Priority | Effort | Impact | Status |
|-------|----------|--------|--------|--------|
| Phase 1: Dead Code | HIGH | 1-2 hrs | Cleaner codebase | ✅ DONE |
| Phase 2: Memory Hygiene | **CRITICAL** | 2-3 hrs | Fixes GC pressure, 60fps stability | ✅ DONE |
| Phase 3: Code Quality | **CRITICAL** | 1-2 hrs | Error handling, debug flags | ✅ DONE |
| Phase 4: Type Safety | MEDIUM | 2-3 hrs | Reduces future bugs | ✅ DONE |
| Phase 7: Testing | MEDIUM | 4-6 hrs | Confidence in changes | ⏳ NEXT |
| Phase 5: SOLID | LOW | 4-6 hrs | Architecture improvement | Pending |
| Phase 6: Security | LOW | 2-3 hrs | Already reasonably secure | Pending |

---

## Expected Final Ratings

| Criteria | Current | After Critical | After All Phases |
|----------|---------|----------------|------------------|
| Production Quality | 7.5 | 8.5 | 9.0 |
| Best Practices | 6.5 | 7.5 | 9.0 |
| OWASP Security | 8.0 | 8.0 | 9.0 |
| Memory Hygiene | 7.0 | 9.0 | 9.0 |
| SOLID Principles | 5.0 | 5.0 | 8.5 |
| OSRS Likeness | 9.0 | 9.0 | 9.0 |
| **Overall** | **7.0** | **7.8** | **9.0** |

---

## Files Reference

| File | Lines | Issues |
|------|-------|--------|
| `ResourceSystem.ts` | ~3000 | 3 hot path allocations, type casts, needs splitting |
| `PendingGatherManager.ts` | ~560 | Missing error handling, type casts |
| `FaceDirectionManager.ts` | ~450 | Verbose logging without debug flag |
| `tile-movement.ts` | ~850 | Dead code (arrivalRotations infrastructure) |
| `handlers/resources.ts` | ~55 | Used by ElizaOS AI agents - DO NOT DELETE |
| `GatheringConstants.ts` | ~270 | Good, well-documented |
| `ResourceSystem.test.ts` | ~380 | Partial coverage (utility methods only) |
