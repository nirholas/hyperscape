# Cooking & Firemaking Systems Hardening Plan

**Target: 9.0/10 Production Readiness**
**Current: 6.8/10**
**Gap: +2.2 points**

---

## Executive Summary

This document outlines the systematic hardening of the Cooking and Firemaking systems to achieve production-grade quality. The plan is organized into 6 phases with clear success criteria, estimated effort, and verification steps.

### Rating Targets by Category

| Category | Current | Target | Gap |
|----------|---------|--------|-----|
| Production Quality | 6.0 | 9.0 | +3.0 |
| Best Practices | 6.0 | 9.0 | +3.0 |
| OWASP Security | 8.0 | 9.0 | +1.0 |
| Game Studio Audit | 7.0 | 9.0 | +2.0 |
| Memory Hygiene | 5.0 | 9.0 | +4.0 |
| SOLID Principles | 6.5 | 9.0 | +2.5 |

---

## Phase 1: Critical Bug Fixes (P0)

**Effort: 2-3 hours**
**Impact: +1.0 rating points**
**Priority: BLOCKING - Must complete before any deployment**

### 1.1 Fix `extinguishFire()` Crash Bug

**File:** `packages/shared/src/systems/shared/interaction/ProcessingSystem.ts`
**Line:** 798
**Issue:** Non-null assertion on potentially undefined fire causes crash on double-call

**Current Code:**
```typescript
private extinguishFire(fireId: string): void {
  const fire = this.activeFires.get(fireId)!;
  fire.isActive = false;
  // ...
}
```

**Fixed Code:**
```typescript
private extinguishFire(fireId: string): void {
  const fire = this.activeFires.get(fireId);
  if (!fire) {
    // Already extinguished or never existed - safe to ignore
    console.warn(`[ProcessingSystem] Attempted to extinguish non-existent fire: ${fireId}`);
    return;
  }

  if (!fire.isActive) {
    // Already inactive - prevent double cleanup
    return;
  }

  fire.isActive = false;
  // ... rest of cleanup
}
```

**Verification:**
- [ ] Call `extinguishFire()` twice with same fireId - should not crash
- [ ] Call `extinguishFire()` with non-existent fireId - should log warning and return

---

### 1.2 Fix setTimeout Race Condition

**File:** `packages/shared/src/systems/shared/interaction/ProcessingSystem.ts`
**Lines:** 340-346
**Issue:** Player reference captured in closure may be stale when setTimeout fires

**Current Code:**
```typescript
const player = this.world.getPlayer(playerId)!;
// ...
setTimeout(() => {
  this.completeFiremaking(playerId, processingAction, {
    x: player.node.position.x,  // CRASH: player may have disconnected
    y: player.node.position.y,
    z: player.node.position.z,
  });
}, this.FIREMAKING_TIME);
```

**Fixed Code:**
```typescript
setTimeout(() => {
  // Re-fetch player at callback time - they may have disconnected
  const currentPlayer = this.world.getPlayer(playerId);
  if (!currentPlayer?.node?.position) {
    console.log(`[ProcessingSystem] Player ${playerId} disconnected during firemaking - cancelling`);
    this.activeProcessing.delete(playerId);
    return;
  }

  // Verify player is still in activeProcessing (wasn't cancelled)
  if (!this.activeProcessing.has(playerId)) {
    console.log(`[ProcessingSystem] Firemaking was cancelled for ${playerId}`);
    return;
  }

  this.completeFiremaking(playerId, processingAction, {
    x: currentPlayer.node.position.x,
    y: currentPlayer.node.position.y,
    z: currentPlayer.node.position.z,
  });
}, this.FIREMAKING_TIME);
```

**Apply similar pattern to cooking setTimeout at line 537:**
```typescript
setTimeout(() => {
  // Verify player is still in activeProcessing (wasn't cancelled/disconnected)
  if (!this.activeProcessing.has(playerId)) {
    console.log(`[ProcessingSystem] Cooking was cancelled for ${playerId}`);
    return;
  }

  this.completeCooking(playerId, processingAction);
}, this.COOKING_TIME);
```

Note: Cooking setTimeout is less critical than firemaking because `completeCooking()` doesn't access `player.node.position` directly. However, adding the guard prevents processing events for disconnected players.

**Verification:**
- [ ] Start firemaking, disconnect player during 3s timer - should not crash
- [ ] Start firemaking, cancel via movement during timer - should not complete
- [ ] Start cooking, disconnect player during 2s timer - should not emit events for non-existent player

---

### 1.3 Handle fishSlot=-1 Case

**File:** `packages/shared/src/systems/shared/interaction/ProcessingSystem.ts`
**Lines:** 458-494
**Issue:** PendingCookManager can send fishSlot=-1, but ProcessingSystem doesn't handle it

**Current Code:**
```typescript
private startCooking(data: {
  playerId: string;
  fishSlot: number;
  fireId: string;
}): void {
  const { playerId, fishSlot, fireId } = data;
  // ... validation ...
  this.startCookingProcess(playerId, fishSlot, fireId, true);  // fishSlot could be -1!
}
```

**Fixed Code:**
```typescript
private startCooking(data: {
  playerId: string;
  fishSlot: number;
  fireId: string;
}): void {
  let { playerId, fishSlot, fireId } = data;

  // Handle fishSlot=-1: find first raw_shrimp slot
  if (fishSlot === -1) {
    fishSlot = this.findRawShrimpSlot(playerId);
    if (fishSlot === -1) {
      this.emitTypedEvent(EventType.UI_MESSAGE, {
        playerId,
        message: "You have nothing to cook.",
        type: "error",
      });
      return;
    }
  }

  // ... rest of validation ...
  this.startCookingProcess(playerId, fishSlot, fireId, true);
}
```

**Verification:**
- [ ] Click fire without selecting specific fish - should find and cook first raw_shrimp
- [ ] Click fire with no raw_shrimp in inventory - should show "nothing to cook" message

---

### 1.4 Fix THREE.js Memory Leaks

**File:** `packages/shared/src/systems/shared/interaction/ProcessingSystem.ts`
**Lines:** 803-805
**Issue:** Geometry and material not disposed when fire is removed

**Current Code:**
```typescript
if (fire.mesh && this.world.isClient) {
  this.world.stage.scene.remove(fire.mesh);
}
```

**Fixed Code:**
```typescript
if (fire.mesh && this.world.isClient) {
  this.world.stage.scene.remove(fire.mesh);

  // Dispose THREE.js resources to prevent GPU memory leak
  const mesh = fire.mesh as THREE.Mesh;
  if (mesh.geometry) {
    mesh.geometry.dispose();
  }
  if (mesh.material) {
    if (Array.isArray(mesh.material)) {
      mesh.material.forEach(mat => mat.dispose());
    } else {
      mesh.material.dispose();
    }
  }

  // Clear reference for GC
  fire.mesh = undefined;
}
```

**Also update `createFireVisual()` to store references for cleanup:**
```typescript
// Store references for proper disposal
fire.mesh = fireMesh as THREE.Object3D;
(fire as { geometry?: THREE.BufferGeometry }).geometry = fireGeometry;
(fire as { material?: THREE.Material }).material = fireMaterial;
```

**Verification:**
- [ ] Create and extinguish 100 fires in a loop - memory should not grow
- [ ] Use Chrome DevTools Memory tab to verify no detached THREE.js objects

---

## Phase 2: Memory & Performance Hardening

**Effort: 3-4 hours**
**Impact: +0.5 rating points**

### 2.1 Fix requestAnimationFrame Leak

**File:** `packages/shared/src/systems/shared/interaction/ProcessingSystem.ts`
**Lines:** 774-781

**Current Code:**
```typescript
const animate = () => {
  if (fire.isActive) {
    fireMaterial.opacity = 0.6 + Math.sin(Date.now() * 0.01) * 0.2;
    requestAnimationFrame(animate);
  }
};
animate();
```

**Fixed Code:**
```typescript
// Store animation frame ID for cancellation
let animationFrameId: number | null = null;

const animate = () => {
  if (fire.isActive && fire.mesh) {
    fireMaterial.opacity = 0.6 + Math.sin(Date.now() * 0.01) * 0.2;
    animationFrameId = requestAnimationFrame(animate);
  } else {
    // Animation stopped - null out references
    animationFrameId = null;
  }
};
animate();

// Store cancel function on fire object for cleanup
(fire as { cancelAnimation?: () => void }).cancelAnimation = () => {
  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
};
```

**Update `extinguishFire()` to call cancel:**
```typescript
// Cancel animation before removing mesh
const fireWithAnimation = fire as { cancelAnimation?: () => void };
fireWithAnimation.cancelAnimation?.();
```

---

### 2.2 Eliminate Hot Path Allocations

**File:** `packages/shared/src/systems/shared/interaction/ProcessingSystem.ts`
**Lines:** 297-299

**Current Code:**
```typescript
const playerFires = Array.from(this.activeFires.values()).filter(
  (fire) => fire.playerId === playerId && fire.isActive,
);
```

**Fixed Code:**
```typescript
// Pre-allocated counter to avoid array allocation
private countPlayerFires(playerId: string): number {
  let count = 0;
  for (const fire of this.activeFires.values()) {
    if (fire.playerId === playerId && fire.isActive) {
      count++;
    }
  }
  return count;
}

// Usage:
if (this.countPlayerFires(playerId) >= this.MAX_FIRES_PER_PLAYER) {
  // ...
}
```

---

### 2.3 Pool ProcessingAction Objects

**File:** `packages/shared/src/systems/shared/interaction/ProcessingSystem.ts`

**Add object pool:**
```typescript
// Pre-allocated ProcessingAction pool (max concurrent actions = max players)
private readonly actionPool: ProcessingAction[] = [];
private readonly MAX_POOL_SIZE = 100;

private acquireAction(): ProcessingAction {
  if (this.actionPool.length > 0) {
    return this.actionPool.pop()!;
  }
  return {
    playerId: "",
    actionType: "firemaking",
    primaryItem: { id: "", slot: 0 },
    startTime: 0,
    duration: 0,
    xpReward: 0,
    skillRequired: "",
  };
}

private releaseAction(action: ProcessingAction): void {
  if (this.actionPool.length < this.MAX_POOL_SIZE) {
    // Reset to defaults
    action.playerId = "";
    action.targetItem = undefined;
    action.targetFire = undefined;
    this.actionPool.push(action);
  }
}
```

**Update all places where ProcessingAction is created/deleted to use pool.**

---

## Phase 3: Type Safety & Code Quality

**Effort: 4-5 hours**
**Impact: +0.4 rating points**

### 3.1 Add Typed Event Payloads

**File:** `packages/shared/src/types/events/event-payloads.ts`

**Add interfaces:**
```typescript
// Processing Events
export interface ProcessingFiremakingRequestPayload {
  playerId: string;
  logsId: string;
  logsSlot: number;
  tinderboxSlot: number;
}

export interface ProcessingCookingRequestPayload {
  playerId: string;
  fishSlot: number;
  fireId: string;
}

export interface PlayerSetEmotePayload {
  playerId: string;
  emote: string;
}

export interface FiremakingMoveRequestPayload {
  playerId: string;
  position: { x: number; y: number; z: number };
}

export interface FireCreatedPayload {
  fireId: string;
  playerId: string;
  position: { x: number; y: number; z: number };
}

export interface FireExtinguishedPayload {
  fireId: string;
}

export interface CookingCompletedPayload {
  playerId: string;
  result: "cooked" | "burnt";
  itemCreated: string;
  xpGained: number;
}
```

**Update EventPayloads type:**
```typescript
export type EventPayloads = {
  // ... existing ...
  [EventType.PROCESSING_FIREMAKING_REQUEST]: ProcessingFiremakingRequestPayload;
  [EventType.PROCESSING_COOKING_REQUEST]: ProcessingCookingRequestPayload;
  [EventType.PLAYER_SET_EMOTE]: PlayerSetEmotePayload;
  [EventType.FIREMAKING_MOVE_REQUEST]: FiremakingMoveRequestPayload;
  [EventType.FIRE_CREATED]: FireCreatedPayload;
  [EventType.FIRE_EXTINGUISHED]: FireExtinguishedPayload;
  [EventType.COOKING_COMPLETED]: CookingCompletedPayload;
};
```

---

### 3.2 Fix ProcessingAction Type

**File:** `packages/shared/src/types/game/resource-processing-types.ts`

**Current:**
```typescript
primaryItem: { id: string | number; slot: number };
```

**Fixed:**
```typescript
primaryItem: { id: string; slot: number };
```

**Update all usages to use string IDs only.**

---

### 3.3 Extract DRY Helper Methods

**File:** `packages/shared/src/systems/shared/interaction/ProcessingSystem.ts`

**Add helpers:**
```typescript
/**
 * Reset player emote to idle.
 * Used when completing/cancelling firemaking or cooking.
 */
private resetPlayerEmote(playerId: string): void {
  this.emitTypedEvent(EventType.PLAYER_SET_EMOTE, {
    playerId,
    emote: "idle",
  });
}

/**
 * Set player emote to squat for processing actions.
 */
private setProcessingEmote(playerId: string): void {
  this.emitTypedEvent(EventType.PLAYER_SET_EMOTE, {
    playerId,
    emote: "squat",
  });
}
```

**Replace all 4 inline emote resets with `this.resetPlayerEmote(playerId)`.**

---

## Phase 4: Architecture & SOLID Compliance

**Effort: 6-8 hours**
**Impact: +0.3 rating points**

### 4.1 Split ProcessingSystem (SRP)

**Current:** Single 982-line file handling firemaking AND cooking
**Target:** Separate systems with shared base

**New Structure:**
```
packages/shared/src/systems/shared/interaction/
├── ProcessingSystemBase.ts      # Shared functionality, fire management
├── FiremakingSystem.ts          # Firemaking-specific logic
├── CookingSystem.ts             # Cooking-specific logic
└── FireVisualManager.ts         # THREE.js fire visuals (client-only)
```

**ProcessingSystemBase.ts:**
```typescript
export abstract class ProcessingSystemBase extends SystemBase {
  protected activeFires = new Map<string, Fire>();
  protected activeProcessing = new Map<string, ProcessingAction>();
  protected fireCleanupTimers = new Map<string, NodeJS.Timeout>();

  // Shared fire management
  protected createFire(playerId: string, position: Position3D): Fire { ... }
  protected extinguishFire(fireId: string): void { ... }
  protected getActiveFires(): Map<string, Fire> { ... }

  // Abstract methods for subclasses
  protected abstract getProcessingTime(): number;
  protected abstract getXPReward(): number;
}
```

**FiremakingSystem.ts:**
```typescript
export class FiremakingSystem extends ProcessingSystemBase {
  private readonly FIREMAKING_TIME = 3000;
  private readonly XP_REWARD = 40;

  protected getProcessingTime(): number { return this.FIREMAKING_TIME; }
  protected getXPReward(): number { return this.XP_REWARD; }

  // Firemaking-specific: movement after lighting
  private findFiremakingMoveTarget(...) { ... }
  private movePlayerAfterFiremaking(...) { ... }
}
```

**CookingSystem.ts:**
```typescript
export class CookingSystem extends ProcessingSystemBase {
  private readonly COOKING_TIME = 2000;

  // Cooking-specific: burn chance, auto-cooking
  private getBurnChance(level: number): number { ... }
  private tryAutoCookNext(...) { ... }
}
```

---

### 4.2 Dependency Injection (DIP)

**Current:** Direct system lookups via string names
```typescript
const processingSystem = this.world.getSystem("processing") as { ... };
```

**Target:** Inject dependencies via constructor

**PendingCookManager.ts:**
```typescript
interface FireRegistry {
  getActiveFires(): Map<string, Fire>;
}

export class PendingCookManager {
  constructor(
    private world: World,
    private tileMovementManager: TileMovementManager,
    private fireRegistry: FireRegistry,  // Injected, not looked up
  ) {}

  queuePendingCook(...): void {
    const fires = this.fireRegistry.getActiveFires();
    // No more unsafe type casts!
  }
}
```

---

### 4.3 Data-Driven Food Configuration

**Current:** Hardcoded in ProcessingSystem.ts
```typescript
private readonly SHRIMP_COOKING = {
  requiredLevel: 1,
  stopBurnLevel: 34,
  maxBurnChance: 0.5,
};
```

**Target:** JSON configuration file

**File:** `packages/shared/src/data/cooking-config.json`
```json
{
  "cookableItems": {
    "raw_shrimp": {
      "result": "shrimp",
      "burntResult": "burnt_shrimp",
      "requiredLevel": 1,
      "stopBurnLevel": 34,
      "maxBurnChance": 0.5,
      "xpReward": 30,
      "cookingTime": 2000
    },
    "raw_anchovies": {
      "result": "anchovies",
      "burntResult": "burnt_fish",
      "requiredLevel": 1,
      "stopBurnLevel": 34,
      "maxBurnChance": 0.45,
      "xpReward": 30,
      "cookingTime": 2000
    }
  }
}
```

**CookingSystem.ts:**
```typescript
import cookingConfig from "../../../data/cooking-config.json";

private getCookableConfig(itemId: string): CookableItemConfig | null {
  return cookingConfig.cookableItems[itemId] ?? null;
}
```

---

## Phase 5: Security Hardening

**Effort: 2-3 hours**
**Impact: +0.2 rating points**

### 5.1 Add Rate Limiting

**File:** `packages/server/src/systems/ServerNetwork/index.ts`

```typescript
// Rate limiter for processing requests
private readonly processingRateLimiter = new Map<string, number>();
private readonly PROCESSING_COOLDOWN_MS = 500; // Min 500ms between requests

private canProcessRequest(playerId: string): boolean {
  const now = Date.now();
  const lastRequest = this.processingRateLimiter.get(playerId) ?? 0;

  if (now - lastRequest < this.PROCESSING_COOLDOWN_MS) {
    console.warn(`[ServerNetwork] Rate limited processing request from ${playerId}`);
    return false;
  }

  this.processingRateLimiter.set(playerId, now);
  return true;
}
```

**Apply to `onFiremakingRequest` and `onCookingRequest` handlers.**

---

### 5.2 Validate Inventory Slot Bounds

**File:** `packages/shared/src/systems/shared/interaction/ProcessingSystem.ts`

```typescript
private isValidInventorySlot(playerId: string, slot: number): boolean {
  if (slot < 0 || slot >= 28) { // OSRS inventory is 28 slots
    console.warn(`[ProcessingSystem] Invalid slot ${slot} for player ${playerId}`);
    return false;
  }
  return true;
}
```

**Add validation in `startFiremaking()` and `startCooking()`.**

---

### 5.3 Remove Non-Null Assertions Throughout

**File:** `packages/shared/src/systems/shared/interaction/ProcessingSystem.ts`

**Locations requiring null guards:**

| Line | Current | Issue |
|------|---------|-------|
| 358-359 | `action.targetItem!.id` | Firemaking logs access |
| 381 | `action.targetItem!.id` | Firemaking logs ID |
| 388, 397 | `action.targetItem!.slot` | Firemaking logs slot |
| 547 | `action.targetFire!` | Cooking fire lookup |
| 566 | `action.targetFire!` | Auto-cook fire ID |

**Fix Pattern for Firemaking (lines 358-397):**
```typescript
if (!action.targetItem) {
  console.error(`[ProcessingSystem] Firemaking action missing targetItem for ${playerId}`);
  this.activeProcessing.delete(playerId);
  return;
}
const logsId = action.targetItem.id;
const logsSlot = action.targetItem.slot;
```

**Fix Pattern for Cooking (lines 547, 566):**
```typescript
if (!action.targetFire) {
  console.error(`[ProcessingSystem] Cooking action missing targetFire for ${playerId}`);
  return;
}
const fire = this.activeFires.get(action.targetFire);
// ...
this.tryAutoCookNext(playerId, action.targetFire);
```

This is defensive programming - while these values should always be present for their respective action types, explicit null checks prevent silent failures and make the code self-documenting.

---

## Phase 6: Testing

**Effort: 4-6 hours**
**Impact: +0.3 rating points**

### 6.1 Unit Tests

**File:** `packages/shared/src/systems/shared/interaction/__tests__/ProcessingSystem.test.ts`

```typescript
describe("ProcessingSystem", () => {
  describe("getBurnChance", () => {
    it("should return 50% at level 1", () => {
      expect(system.getBurnChance(1)).toBe(0.5);
    });

    it("should return 0% at level 34+", () => {
      expect(system.getBurnChance(34)).toBe(0);
      expect(system.getBurnChance(99)).toBe(0);
    });

    it("should interpolate linearly between levels", () => {
      // Level 17 is halfway: (34-17)/(34-1) * 0.5 = 0.257
      expect(system.getBurnChance(17)).toBeCloseTo(0.257, 2);
    });
  });

  describe("fire limits", () => {
    it("should allow max 3 fires per player", () => { ... });
    it("should reject 4th fire with error message", () => { ... });
  });

  describe("fishSlot handling", () => {
    it("should find first raw_shrimp when fishSlot=-1", () => { ... });
    it("should show error when no raw food and fishSlot=-1", () => { ... });
  });
});
```

### 6.2 Integration Tests

**File:** `packages/server/src/systems/ServerNetwork/__tests__/cooking-integration.test.ts`

```typescript
describe("Cooking Integration", () => {
  it("should walk to fire before cooking", async () => {
    // Player at (0,0), fire at (5,5)
    // Send cookingSourceInteract
    // Verify PendingCookManager queues walk
    // Advance ticks until player arrives
    // Verify PROCESSING_COOKING_REQUEST emitted
  });

  it("should play squat emote during cooking", async () => {
    // Start cooking
    // Verify PLAYER_SET_EMOTE with "squat" broadcast
    // Complete cooking
    // Verify PLAYER_SET_EMOTE with "idle" broadcast
  });

  it("should handle player disconnect during cooking", async () => {
    // Start cooking
    // Disconnect player
    // Verify no crash, cleanup occurs
  });
});
```

---

## Success Criteria Checklist

### Phase 1 Complete When:
- [ ] `extinguishFire()` handles missing/inactive fires gracefully
- [ ] setTimeout callbacks validate player still exists
- [ ] fishSlot=-1 finds first raw_shrimp automatically
- [ ] Fire meshes properly disposed (verified via memory profiling)

### Phase 2 Complete When:
- [ ] requestAnimationFrame properly cancelled on fire extinguish
- [ ] No Array.from() or filter() in hot paths
- [ ] ProcessingAction objects pooled and reused

### Phase 3 Complete When:
- [ ] All 7 processing events have typed payloads
- [ ] No inline `as { ... }` type casts for events
- [ ] ProcessingAction.id is string-only

### Phase 4 Complete When:
- [ ] ProcessingSystem split into 3+ focused classes
- [ ] PendingCookManager uses injected FireRegistry
- [ ] Food configs loaded from JSON

### Phase 5 Complete When:
- [ ] Rate limiting prevents >2 requests/second per player
- [ ] Inventory slot bounds validated (0-27)
- [ ] All non-null assertions (`!.`) replaced with explicit null checks

### Phase 6 Complete When:
- [ ] >80% code coverage on ProcessingSystem
- [ ] Integration tests pass for walk-to-cook flow
- [ ] Disconnect-during-action tests pass

---

## Estimated Timeline

| Phase | Effort | Dependencies |
|-------|--------|--------------|
| Phase 1: Critical Fixes | 2-3 hours | None |
| Phase 2: Memory Hardening | 3-4 hours | Phase 1 |
| Phase 3: Type Safety | 4-5 hours | Phase 1 |
| Phase 4: Architecture | 6-8 hours | Phases 1-3 |
| Phase 5: Security | 2-3 hours | Phase 1 |
| Phase 6: Testing | 4-6 hours | Phases 1-4 |

**Total: 21-29 hours**

**Recommended Approach:**
1. Complete Phase 1 immediately (blocking issues)
2. Run Phases 2, 3, 5 in parallel (independent)
3. Phase 4 after 2 & 3 complete (needs stable foundation)
4. Phase 6 throughout (write tests as you fix)

---

## Post-Hardening Rating Projection

| Category | Current | After Phase 1 | After All Phases |
|----------|---------|---------------|------------------|
| Production Quality | 6.0 | 7.5 | 9.0 |
| Best Practices | 6.0 | 7.0 | 9.0 |
| OWASP Security | 8.0 | 8.5 | 9.0 |
| Game Studio Audit | 7.0 | 8.0 | 9.0 |
| Memory Hygiene | 5.0 | 7.0 | 9.0 |
| SOLID Principles | 6.5 | 7.0 | 9.0 |
| **Overall** | **6.8** | **7.5** | **9.0** |

---

## Appendix: File Change Summary

| File | Changes |
|------|---------|
| `ProcessingSystem.ts` | Null guards, setTimeout fixes, dispose calls, helper extraction, non-null assertion removal |
| `PendingCookManager.ts` | Dependency injection |
| `event-payloads.ts` | 7 new typed interfaces |
| `resource-processing-types.ts` | Fix union type |
| `ServerNetwork/index.ts` | Rate limiting |
| `cooking-config.json` | New file |
| `FiremakingSystem.ts` | New file (split) |
| `CookingSystem.ts` | New file (split) |
| `FireVisualManager.ts` | New file (split) |
| `ProcessingSystem.test.ts` | New file |
| `cooking-integration.test.ts` | New file |
