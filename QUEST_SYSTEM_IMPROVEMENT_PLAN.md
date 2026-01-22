# Quest System Improvement Plan

**Goal:** Achieve 9/10+ production readiness rating across all audit categories.

**Current Rating:** 6.5/10
**Target Rating:** 9/10+

---

## Executive Summary

The quest system has a solid foundation with server-authoritative design, good TypeScript typing, and comprehensive test coverage. However, it needs improvements in memory hygiene, security hardening, and architectural separation to meet AAA production standards.

---

## Current Scores → Target Scores

| Category | Current | Target | Gap |
|----------|---------|--------|-----|
| Production Quality Code | 7/10 | 9/10 | +2 |
| Best Practices | 7.5/10 | 9/10 | +1.5 |
| OWASP Security | 6/10 | 9/10 | +3 |
| Game Studio Audit | 6.5/10 | 9/10 | +2.5 |
| Memory & Allocation Hygiene | 5/10 | 9/10 | +4 |
| SOLID Principles | 7/10 | 9/10 | +2 |

---

## Phase 1: Critical Security & Memory Fixes (Priority: HIGH)

### 1.1 Add Rate Limiting to Quest Handlers

**File:** `packages/server/src/systems/ServerNetwork/handlers/quest.ts`

**Problem:** No rate limiting - clients can spam quest list/detail requests.

**Existing Infrastructure:** The codebase already has `SlidingWindowRateLimiter.ts` with a well-designed rate limiter pattern. We should extend this rather than create something new.

**Solution:**

**Step 1:** Add quest rate limiter singletons to `SlidingWindowRateLimiter.ts`:
```typescript
// Add to packages/server/src/systems/ServerNetwork/services/SlidingWindowRateLimiter.ts

let questListLimiter: RateLimiter | null = null;
let questDetailLimiter: RateLimiter | null = null;
let questAcceptLimiter: RateLimiter | null = null;

/**
 * Get the quest list rate limiter (5/sec)
 * Limits quest list fetches to prevent UI spam
 */
export function getQuestListRateLimiter(): RateLimiter {
  if (!questListLimiter) {
    questListLimiter = createRateLimiter({
      maxPerSecond: 5,
      name: "quest-list",
    });
  }
  return questListLimiter;
}

/**
 * Get the quest detail rate limiter (10/sec)
 * Limits quest detail fetches
 */
export function getQuestDetailRateLimiter(): RateLimiter {
  if (!questDetailLimiter) {
    questDetailLimiter = createRateLimiter({
      maxPerSecond: 10,
      name: "quest-detail",
    });
  }
  return questDetailLimiter;
}

/**
 * Get the quest accept rate limiter (3/sec)
 * Limits quest accept requests
 */
export function getQuestAcceptRateLimiter(): RateLimiter {
  if (!questAcceptLimiter) {
    questAcceptLimiter = createRateLimiter({
      maxPerSecond: 3,
      name: "quest-accept",
    });
  }
  return questAcceptLimiter;
}

// Update destroyAllRateLimiters() to include these
```

**Step 2:** Apply rate limiters in handlers:
```typescript
// In packages/server/src/systems/ServerNetwork/handlers/quest.ts
import { getQuestListRateLimiter, getQuestDetailRateLimiter, getQuestAcceptRateLimiter } from "../services/SlidingWindowRateLimiter";

export function handleGetQuestList(socket, _data, world) {
  const playerId = getPlayerId(socket);
  if (!playerId) return;

  if (!getQuestListRateLimiter().check(playerId)) {
    logger.warn(`Rate limit exceeded for ${playerId} on getQuestList`);
    return;
  }
  // ... rest of handler
}
```

**Acceptance Criteria:**
- [ ] Quest rate limiter singletons added to `SlidingWindowRateLimiter.ts`
- [ ] Applied to `handleGetQuestList` (max 5 req/sec)
- [ ] Applied to `handleGetQuestDetail` (max 10 req/sec)
- [ ] Applied to `handleQuestAccept` (max 3 req/sec)
- [ ] Updated `destroyAllRateLimiters()` to cleanup quest limiters
- [ ] Unit tests for quest rate limiters

---

### 1.2 Add Input Validation to Handlers

**File:** `packages/server/src/systems/ServerNetwork/handlers/quest.ts`

**Problem:** `questId` not validated with existing `isValidQuestId()` function.

**Solution:**
```typescript
import { isValidQuestId } from "@hyperscape/shared/types/game/quest-types";

export function handleGetQuestDetail(socket, data, world) {
  const { questId } = data;

  // Use existing validator
  if (!isValidQuestId(questId)) {
    logger.warn(`Invalid questId format: ${questId}`);
    return;
  }
  // ... rest of handler
}
```

**Additional security fix - Log injection prevention:**
```typescript
// BEFORE (line 87 in quest.ts): Logs potentially malicious questId
logger.warn(`Quest not found: ${questId}`);

// AFTER: Sanitize before logging to prevent log injection
const safeQuestId = isValidQuestId(questId) ? questId : '[INVALID]';
logger.warn(`Quest not found: ${safeQuestId}`);
```

**Acceptance Criteria:**
- [ ] `isValidQuestId()` used in `handleGetQuestDetail`
- [ ] `isValidQuestId()` used in `handleQuestAccept`
- [ ] Sanitized logging for user-controlled inputs
- [ ] Tests for invalid input rejection
- [ ] Tests for log injection prevention

---

### 1.3 Eliminate Object Allocations in Hot Paths

**File:** `packages/shared/src/systems/shared/progression/QuestSystem.ts`

**Problem:** Object spread `{ ...progress.stageProgress, kills }` creates new object on every kill/gather event.

**Solution:**
```typescript
// Add pre-allocated event payload objects (reusable)
private readonly _progressEventPayload = {
  playerId: '',
  questId: '',
  stage: '',
  progress: {} as StageProgress,
  description: '',
};

private readonly _chatEventPayload = {
  playerId: '',
  message: '',
  type: 'game' as const,
};

// Mutate stageProgress directly instead of spread
private handleNPCDied(data: NPCDiedPayload): void {
  // ...
  // BEFORE: progress.stageProgress = { ...progress.stageProgress, kills };
  // AFTER: Direct mutation (stageProgress is mutable)
  progress.stageProgress.kills = (progress.stageProgress.kills || 0) + 1;

  // Reuse pre-allocated payload
  this._progressEventPayload.playerId = killedBy;
  this._progressEventPayload.questId = questId;
  this._progressEventPayload.stage = progress.currentStage;
  this._progressEventPayload.progress = progress.stageProgress;
  this._progressEventPayload.description = stage.description;

  this.emitTypedEvent(EventType.QUEST_PROGRESSED, this._progressEventPayload);
}
```

**Additional allocation to fix - `getActiveQuests()` (line 400-406):**
```typescript
// BEFORE: Creates new array on every call
public getActiveQuests(playerId: string): QuestProgress[] {
  const state = this.playerStates.get(playerId);
  if (!state) return [];
  return Array.from(state.activeQuests.values());  // NEW array every call
}

// AFTER: Return cached array, update only when quests change
private _activeQuestsCache: Map<string, QuestProgress[]> = new Map();
private _activeQuestsDirty: Set<string> = new Set();

public getActiveQuests(playerId: string): QuestProgress[] {
  const state = this.playerStates.get(playerId);
  if (!state) return this._emptyArray;  // Pre-allocated empty array

  if (this._activeQuestsDirty.has(playerId) || !this._activeQuestsCache.has(playerId)) {
    this._activeQuestsCache.set(playerId, Array.from(state.activeQuests.values()));
    this._activeQuestsDirty.delete(playerId);
  }
  return this._activeQuestsCache.get(playerId)!;
}

// Mark dirty when quest state changes
private markActiveQuestsDirty(playerId: string): void {
  this._activeQuestsDirty.add(playerId);
}
```

**Additional spread patterns to fix:**

```typescript
// handleGatherStage (line 764-767) - SAME ISSUE
progress.stageProgress = {
  ...progress.stageProgress,
  [itemId]: currentCount,  // Creates new object on every item pickup
};

// handleInteractStage (line 833-836) - SAME ISSUE
progress.stageProgress = {
  ...progress.stageProgress,
  [target]: currentCount,  // Creates new object on every cooking/smithing
};

// FIX: Direct property assignment
progress.stageProgress[itemId] = currentCount;
progress.stageProgress[target] = currentCount;
```

**Handler allocations to fix (quest.ts):**
```typescript
// Line 42-48: Creates new array + N objects on every getQuestList
const quests = allDefinitions.map((def) => ({...}));  // NEW array + objects

// Line 111-117: Creates new array on every getQuestDetail
stages: definition.stages.map((stage) => ({...}));  // NEW array + objects

// FIX: Cache these responses per player, invalidate on quest state change
private questListCache: Map<string, { data: QuestListResponse; dirty: boolean }> = new Map();
```

**Acceptance Criteria:**
- [ ] Pre-allocated payload objects for all event emissions in QuestSystem
- [ ] Direct mutation of `stageProgress` instead of spread in ALL three handlers
- [ ] No `new` keyword in `handleNPCDied`, `handleGatherStage`, `handleInteractStage`
- [ ] `getActiveQuests()` returns cached array, not new allocation
- [ ] Quest list response cached per player (invalidated on quest state change)
- [ ] Quest detail response uses cached stage data
- [ ] Memory profile shows no GC pressure during combat/skilling

---

### 1.4 Cache Stage Lookups

**File:** `packages/shared/src/systems/shared/progression/QuestSystem.ts`

**Problem:** Multiple `.find()` calls in hot paths:
- Line 667-669: `definition.stages.find(s => s.id === progress.currentStage)` in `handleNPCDied`
- Line 757-759: `definition.stages.find(s => s.type === "gather" && s.target === itemId)` in `handleGatherStage`
- Line 774-776: `definition.stages.find(s => s.id === progress.currentStage)` in `handleGatherStage` (duplicate!)
- Line 826-828: `definition.stages.find(s => s.type === "interact" && s.target === target)` in `handleInteractStage`
- Line 843-845: `definition.stages.find(s => s.id === progress.currentStage)` in `handleInteractStage` (duplicate!)
- Line 885-886: `definition.stages.findIndex(s => s.id === progress.currentStage)` in `advanceToNextStage`

**Solution:**
```typescript
// Add multiple caches for different lookup patterns
private stageByIdCache: Map<string, Map<string, QuestStage>> = new Map();       // questId -> stageId -> stage
private stageIndexCache: Map<string, Map<string, number>> = new Map();          // questId -> stageId -> index
private gatherStageCache: Map<string, Map<string, QuestStage>> = new Map();     // questId -> itemId -> stage
private interactStageCache: Map<string, Map<string, QuestStage>> = new Map();   // questId -> target -> stage

private buildStageCaches(questId: string, definition: QuestDefinition): void {
  const byId = new Map<string, QuestStage>();
  const byIndex = new Map<string, number>();
  const byGatherTarget = new Map<string, QuestStage>();
  const byInteractTarget = new Map<string, QuestStage>();

  definition.stages.forEach((stage, index) => {
    byId.set(stage.id, stage);
    byIndex.set(stage.id, index);

    if (stage.type === "gather" && stage.target) {
      byGatherTarget.set(stage.target, stage);
    }
    if (stage.type === "interact" && stage.target) {
      byInteractTarget.set(stage.target, stage);
    }
  });

  this.stageByIdCache.set(questId, byId);
  this.stageIndexCache.set(questId, byIndex);
  this.gatherStageCache.set(questId, byGatherTarget);
  this.interactStageCache.set(questId, byInteractTarget);
}

// O(1) lookups
private getStageById(questId: string, stageId: string): QuestStage | undefined {
  return this.stageByIdCache.get(questId)?.get(stageId);
}

private getGatherStage(questId: string, itemId: string): QuestStage | undefined {
  return this.gatherStageCache.get(questId)?.get(itemId);
}

private getInteractStage(questId: string, target: string): QuestStage | undefined {
  return this.interactStageCache.get(questId)?.get(target);
}
```

**Acceptance Criteria:**
- [ ] Stage-by-ID cache built during manifest loading
- [ ] Gather-stage-by-target cache built during manifest loading
- [ ] Interact-stage-by-target cache built during manifest loading
- [ ] O(1) stage lookups via all caches
- [ ] No `.find()` or `.findIndex()` calls in hot paths
- [ ] Cache invalidation on manifest reload (if applicable)

---

### 1.5 Reduce Log Verbosity in Hot Paths

**File:** `packages/shared/src/systems/shared/progression/QuestSystem.ts`

**Problem:** Excessive `logger.info()` calls in hot paths cause string allocations and I/O:
- Lines 651-695: 8 `logger.info()` calls in `handleNPCDied` (called on EVERY kill)
- Line 769-771: `logger.info()` in `handleGatherStage` (called on EVERY item pickup)
- Line 838-840: `logger.info()` in `handleInteractStage` (called on EVERY cooking/smithing)

**Solution:**
```typescript
// BEFORE: Info logging on every event
this.logger.info(`[QuestSystem] Player ${killedBy} killed ${mobType}...`);

// AFTER: Debug logging (only shown when DEBUG=true)
this.logger.debug(`Player ${killedBy} killed ${mobType}...`);

// For critical progress updates, use info but only at milestones
if (kills === 1 || kills === Math.floor(stage.count / 2) || kills >= stage.count) {
  this.logger.info(`Quest ${questId} progress: ${kills}/${stage.count}`);
}
```

**Acceptance Criteria:**
- [ ] All hot-path logging changed from `info` to `debug`
- [ ] Milestone logging (first kill, 50%, complete) kept at `info` level
- [ ] No string concatenation in production logging (use structured logging)

---

## Phase 2: Security Hardening (Priority: HIGH)

### 2.1 Add Audit Logging

**File:** `packages/server/src/database/repositories/QuestRepository.ts`

**Problem:** No audit trail for quest completions - can't detect exploits.

**Solution:**
```typescript
// New table: quest_audit_log
// Fields: id, playerId, questId, action, timestamp, metadata

async completeQuestWithPoints(
  playerId: string,
  questId: string,
  questPoints: number,
): Promise<void> {
  await this.db.transaction(async (tx) => {
    // Existing completion logic...

    // Add audit log entry
    await tx.insert(schema.questAuditLog).values({
      playerId,
      questId,
      action: 'completed',
      questPointsAwarded: questPoints,
      timestamp: Date.now(),
    });
  });
}
```

**Acceptance Criteria:**
- [ ] `quest_audit_log` table created via migration
- [ ] Audit entry on quest start
- [ ] Audit entry on quest completion
- [ ] Audit entry on quest progress milestones (25%, 50%, 75%, 100%)
- [ ] Admin query endpoint for audit logs

---

### 2.2 Kill Event Validation

**Files to modify:**
- `packages/shared/src/types/events/event-payloads.ts` (NPCDiedPayload interface)
- `packages/shared/src/systems/shared/combat/CombatSystem.ts` (generate tokens)
- `packages/shared/src/systems/shared/progression/QuestSystem.ts` (validate tokens)

**Problem:** NPC_DIED events not validated - could be spoofed by compromised component.

**Current NPCDiedPayload (line 91-98 in event-payloads.ts):**
```typescript
export interface NPCDiedPayload {
  mobId: string;
  mobType: string;
  level: number;
  killedBy: string;
  position: { x: number; y: number; z: number };
  loot?: InventoryItem[];
}
```

**Solution:**

**Step 1:** Extend `NPCDiedPayload` interface:
```typescript
// In event-payloads.ts
export interface NPCDiedPayload {
  mobId: string;
  mobType: string;
  level: number;
  killedBy: string;
  position: { x: number; y: number; z: number };
  loot?: InventoryItem[];
  // NEW: Anti-spoof fields
  timestamp: number;      // When the kill occurred
  killToken: string;      // HMAC signature for validation
}
```

**Step 2:** Generate kill token in CombatSystem:
```typescript
// In CombatSystem.ts - where NPC_DIED is emitted
import { createHmac } from 'crypto';

private generateKillToken(mobId: string, killedBy: string, timestamp: number): string {
  const secret = process.env.KILL_TOKEN_SECRET || 'hyperscape-kill-secret';
  const data = `${mobId}:${killedBy}:${timestamp}`;
  return createHmac('sha256', secret).update(data).digest('hex').substring(0, 16);
}

// When emitting NPC_DIED:
const timestamp = Date.now();
this.emitTypedEvent(EventType.NPC_DIED, {
  mobId,
  mobType,
  level,
  killedBy,
  position,
  loot,
  timestamp,
  killToken: this.generateKillToken(mobId, killedBy, timestamp),
});
```

**Step 3:** Validate in QuestSystem:
```typescript
// In QuestSystem.ts
private validateKillToken(mobId: string, killedBy: string, timestamp: number, token: string): boolean {
  const secret = process.env.KILL_TOKEN_SECRET || 'hyperscape-kill-secret';
  const data = `${mobId}:${killedBy}:${timestamp}`;
  const expected = createHmac('sha256', secret).update(data).digest('hex').substring(0, 16);
  return token === expected;
}

private handleNPCDied(data: NPCDiedPayload): void {
  const { killedBy, mobType, mobId, timestamp, killToken } = data;

  // Validate kill token
  if (!this.validateKillToken(mobId, killedBy, timestamp, killToken)) {
    this.logger.warn(`Invalid kill token for ${killedBy} killing ${mobId}`);
    return;
  }

  // Validate timestamp (within 5 seconds)
  if (Math.abs(Date.now() - timestamp) > 5000) {
    this.logger.warn(`Stale kill event for ${killedBy}`);
    return;
  }

  // ... rest of handler
}
```

**Note:** This is a cross-cutting change affecting the event payload interface. All systems that emit or consume `NPC_DIED` must be updated.

**Acceptance Criteria:**
- [ ] `NPCDiedPayload` interface extended with `timestamp` and `killToken`
- [ ] CombatSystem generates kill tokens using HMAC
- [ ] QuestSystem validates kill tokens
- [ ] Stale events (>5 seconds) rejected
- [ ] All consumers of NPC_DIED updated to handle new fields
- [ ] Environment variable `KILL_TOKEN_SECRET` documented
- [ ] Tests for token generation and validation

---

## Phase 3: Architectural Improvements (Priority: MEDIUM)

### 3.1 Split QuestSystem into Focused Classes

**Current:** 1,092 lines in single file handling everything.

**Target Architecture:**
```
packages/shared/src/systems/shared/progression/
├── QuestSystem.ts              (orchestrator, ~200 lines)
├── QuestStateManager.ts        (player state, ~250 lines)
├── QuestProgressTracker.ts     (kill/gather/interact, ~300 lines)
├── QuestRewardHandler.ts       (items, XP, points, ~150 lines)
└── QuestManifestLoader.ts      (manifest loading/validation, ~150 lines)
```

**QuestSystem.ts (Orchestrator):**
```typescript
export class QuestSystem extends SystemBase {
  private stateManager: QuestStateManager;
  private progressTracker: QuestProgressTracker;
  private rewardHandler: QuestRewardHandler;
  private manifestLoader: QuestManifestLoader;

  async init(): Promise<void> {
    await this.manifestLoader.load();
    this.progressTracker.setDefinitions(this.manifestLoader.getDefinitions());
    // Wire up event subscriptions...
  }

  // Public API delegates to appropriate handler
  public getQuestStatus(playerId: string, questId: string): QuestStatus {
    return this.stateManager.getStatus(playerId, questId);
  }
}
```

**DRY Violation to Fix:**
`handleGatherStage` (lines 744-804) and `handleInteractStage` (lines 813-874) are nearly identical. Should be consolidated:

```typescript
// Extract common logic into shared method
private handleProgressStage(
  playerId: string,
  stageType: "gather" | "interact",
  targetKey: string,
  count: number,
): void {
  const state = this.playerStates.get(playerId);
  if (!state) return;

  for (const [questId, progress] of state.activeQuests) {
    const definition = this.questDefinitions.get(questId);
    if (!definition) continue;

    // Use cached lookup instead of .find()
    const relevantStage = stageType === "gather"
      ? this.getGatherStage(questId, targetKey)
      : this.getInteractStage(questId, targetKey);
    if (!relevantStage) continue;

    // Track progress (direct mutation, no spread)
    progress.stageProgress[targetKey] = (progress.stageProgress[targetKey] || 0) + count;

    // Check completion and advance...
    // (rest of shared logic)
  }
}

// Callers become one-liners
private handleGatherStage(playerId: string, itemId: string, quantity: number): void {
  this.handleProgressStage(playerId, "gather", itemId, quantity);
}

private handleInteractStage(playerId: string, target: string, count: number): void {
  this.handleProgressStage(playerId, "interact", target, count);
}
```

**Acceptance Criteria:**
- [ ] `QuestStateManager` handles player state Map operations
- [ ] `QuestProgressTracker` handles all progress event handlers
- [ ] `QuestRewardHandler` handles item/XP grants
- [ ] `QuestManifestLoader` handles file loading and validation
- [ ] QuestSystem orchestrates and exposes public API
- [ ] `handleGatherStage` and `handleInteractStage` consolidated (DRY)
- [ ] All existing tests pass without modification
- [ ] Each class <300 lines

---

### 3.2 Create Quest Query Interface

**Problem:** `QuestSystem` exposes 10+ methods; callers don't need all of them.

**Solution:**
```typescript
// packages/shared/src/types/game/quest-interfaces.ts

export interface IQuestQuery {
  getQuestStatus(playerId: string, questId: string): QuestStatus;
  getQuestDefinition(questId: string): QuestDefinition | undefined;
  getAllQuestDefinitions(): QuestDefinition[];
  getQuestPoints(playerId: string): number;
  hasCompletedQuest(playerId: string, questId: string): boolean;
}

export interface IQuestProgress {
  getActiveQuests(playerId: string): QuestProgress[];
}

export interface IQuestActions {
  requestQuestStart(playerId: string, questId: string): boolean;
  startQuest(playerId: string, questId: string): Promise<boolean>;
  completeQuest(playerId: string, questId: string): Promise<boolean>;
}

// QuestSystem implements all three
export class QuestSystem implements IQuestQuery, IQuestProgress, IQuestActions {
  // ...
}
```

**Acceptance Criteria:**
- [ ] Interfaces defined in `quest-interfaces.ts`
- [ ] `QuestSystem` implements all interfaces
- [ ] Handlers use `IQuestQuery` type instead of full `QuestSystem`
- [ ] Documentation updated

---

## Phase 4: Production Polish (Priority: MEDIUM)

### 4.1 Remove TODOs and Complete Implementation

**File:** `packages/shared/src/systems/shared/progression/QuestSystem.ts:966-969`

**Problem:**
```typescript
// TODO: Check skill requirements
// TODO: Check item requirements
```

**Solution:**
```typescript
private checkRequirements(playerId: string, definition: QuestDefinition): boolean {
  const state = this.playerStates.get(playerId);
  if (!state) return false;

  // Check prerequisite quests
  for (const prereqQuestId of definition.requirements.quests) {
    if (!state.completedQuests.has(prereqQuestId)) {
      return false;
    }
  }

  // Check skill requirements
  // Note: Use getSkillLevel() method (verified in SystemLoader.ts:598)
  const skillsSystem = this.world.getSystem("skills") as {
    getSkillLevel?: (playerId: string, skill: string) => number;
  } | undefined;

  if (skillsSystem?.getSkillLevel) {
    for (const [skill, requiredLevel] of Object.entries(definition.requirements.skills)) {
      const playerLevel = skillsSystem.getSkillLevel(playerId, skill);
      if (playerLevel < requiredLevel) {
        return false;
      }
    }
  }

  // Check item requirements
  // Note: hasItem(playerId, itemId, quantity=1) - defaults to 1 (verified in InventorySystem.ts:1521)
  // requirements.items is string[] (item IDs), not {itemId, quantity}[]
  const inventorySystem = this.world.getSystem("inventory") as {
    hasItem?: (playerId: string, itemId: string, quantity?: number) => boolean;
  } | undefined;

  if (inventorySystem?.hasItem) {
    for (const itemId of definition.requirements.items) {
      if (!inventorySystem.hasItem(playerId, itemId)) {
        return false;
      }
    }
  }

  return true;
}
```

**Acceptance Criteria:**
- [ ] Skill requirement checking implemented using `getSkillLevel()`
- [ ] Item requirement checking implemented using `hasItem()`
- [ ] TODOs removed from lines 966-969
- [ ] Tests for skill requirement checking
- [ ] Tests for item requirement checking
- [ ] Error messages when requirements not met

---

### 4.2 Dynamic Item Names from Manifest

**File:** `packages/client/src/game/panels/QuestCompleteScreen.tsx`

**Problem:** Hardcoded `ITEM_NAMES` map.

**Solution:**
```typescript
// Use item manifest passed from server or loaded from shared
interface QuestCompleteScreenProps {
  // ... existing props
  itemManifest: Record<string, { name: string }>;
}

// In render:
{rewards.items.map((item, index) => (
  <div key={index}>
    {item.quantity > 1 ? `${item.quantity}x ` : ""}
    {itemManifest[item.itemId]?.name || item.itemId}
  </div>
))}
```

**Acceptance Criteria:**
- [ ] Item manifest loaded on client
- [ ] `QuestCompleteScreen` uses manifest for names
- [ ] `QuestStartScreen` uses manifest for item names
- [ ] Fallback to itemId if not in manifest

---

### 4.3 Quest Versioning System

**Problem:** No way to handle quest definition changes for players mid-quest.

**Solution:**
```typescript
// Add version to quest definitions
interface QuestDefinition {
  id: string;
  version: number;  // Add this
  // ...
}

// Store version with progress
interface QuestProgress {
  questId: string;
  questVersion: number;  // Add this
  // ...
}

// On load, check version compatibility
private async loadPlayerQuestState(playerId: string): Promise<void> {
  // ...
  for (const row of questRows) {
    const definition = this.questDefinitions.get(row.questId);
    if (definition && row.questVersion !== definition.version) {
      this.handleQuestVersionMismatch(playerId, row, definition);
    }
  }
}
```

**Acceptance Criteria:**
- [ ] Version field added to quest definitions
- [ ] Version stored with quest progress
- [ ] Migration handler for version mismatches
- [ ] Admin notification for players affected by version changes

---

## Phase 5: Observability & Analytics (Priority: LOW)

### 5.1 Quest Analytics Events

**Solution:**
```typescript
// Emit analytics events for product insights
this.emitTypedEvent(EventType.ANALYTICS_QUEST, {
  playerId,
  questId,
  event: 'started' | 'stage_completed' | 'abandoned' | 'completed',
  timeInQuest: Date.now() - progress.startedAt,
  attempts: progress.attempts,
  metadata: {
    currentStage: progress.currentStage,
    deathCount: progress.deathCount,
  },
});
```

**Acceptance Criteria:**
- [ ] Analytics event on quest start
- [ ] Analytics event on stage completion
- [ ] Analytics event on quest completion (with duration)
- [ ] Analytics event on quest abandonment
- [ ] Dashboard or export for analytics data

---

## Risks & Dependencies

### Phase 2.2 Risk: Cross-Cutting Change
Kill event validation requires modifying `NPCDiedPayload` interface, which is consumed by:
- CombatSystem (emitter)
- QuestSystem (consumer)
- LootSystem (consumer, if exists)
- Analytics/logging systems

**Mitigation:** Make `timestamp` and `killToken` optional during transition:
```typescript
export interface NPCDiedPayload {
  // ... existing fields
  timestamp?: number;   // Optional during rollout
  killToken?: string;   // Optional during rollout
}
```

### Phase 3.1 Risk: Test Breakage
Splitting QuestSystem may break integration tests that access private members:
```typescript
// Current test setup (lines 298-303 in quest.integration.test.ts)
// @ts-expect-error - accessing private for testing
questSystem.questDefinitions = new Map(Object.entries(mockQuestDefinitions));
// @ts-expect-error - accessing private for testing
questSystem.manifestLoaded = true;
```

**Mitigation:** Add test-only methods or use dependency injection pattern.

### Phase 4.3 Risk: Migration Complexity
Quest versioning requires handling edge cases:
- Player is mid-quest when version changes
- Quest stages are reordered/removed
- Kill count requirements change

**Mitigation:** Define clear version migration strategies:
1. **Reset progress** - Player restarts quest (simple, may frustrate players)
2. **Best effort mapping** - Map old stage to closest new stage
3. **Grandfather clause** - Let old progress complete under old rules

---

## Testing Requirements

Each phase must include:
- [ ] Unit tests for new functionality
- [ ] Integration tests updated
- [ ] Memory profiling for Phase 1 changes
- [ ] Load testing for rate limiters
- [ ] All existing tests pass

---

## Implementation Order

**Priority 1: Quick Wins (Low Risk, High Impact)**
1. **Phase 1.1** - Rate limiting (uses existing infrastructure)
2. **Phase 1.2** - Input validation (simple addition)
3. **Phase 4.1** - Complete TODOs (straightforward implementation)

**Priority 2: Performance (Medium Risk, High Impact)**
4. **Phase 1.3** - Memory fixes (biggest impact on game feel)
5. **Phase 1.4** - Stage caching (performance)
6. **Phase 1.5** - Reduce log verbosity (quick win)

**Priority 3: Security (Higher Risk, Important)**
7. **Phase 2.1** - Audit logging (additive, low risk)
8. **Phase 2.2** - Kill validation (cross-cutting change, requires careful rollout)

**Priority 4: Architecture (Higher Risk, Long-term Value)**
9. **Phase 3.1** - Split QuestSystem (may break tests, needs careful refactoring)
10. **Phase 3.2** - Interfaces (clean architecture)

**Priority 5: Polish & Live Ops**
11. **Phase 4.2** - Dynamic item names (UI polish)
12. **Phase 4.3** - Quest versioning (live ops readiness)
13. **Phase 5.1** - Analytics (product insights)

---

## Estimated Effort

| Phase | Effort | Impact | Risk |
|-------|--------|--------|------|
| Phase 1.1-1.2 (Rate Limit + Validation) | 0.5 day | High | Low |
| Phase 1.3-1.5 (Memory + Cache + Logging) | 1.5-2 days | High | Medium |
| Phase 2.1 (Audit Logging) | 0.5 day | Medium | Low |
| Phase 2.2 (Kill Validation) | 1-2 days | High | **High** |
| Phase 3 (Architecture + DRY) | 2-3 days | Medium | **High** |
| Phase 4 (Polish) | 1-2 days | Medium | Low |
| Phase 5 (Analytics) | 1 day | Low | Low |

**Total:** 8-14 days

**Recommended Approach:**
- Sprint 1: Phases 1.1, 1.2, 4.1, 1.3, 1.4, 1.5 (~3-4 days)
- Sprint 2: Phases 2.1, 2.2 (~2-3 days)
- Sprint 3: Phases 3.1, 3.2, 4.2 (~3-4 days)
- Sprint 4: Phases 4.3, 5.1 (~2 days)

---

## Success Metrics

After implementation:
- [ ] Zero object allocations in hot paths (verified via memory profiler)
- [ ] All quest handlers rate-limited
- [ ] 100% input validation coverage
- [ ] Audit log for all quest state changes
- [ ] QuestSystem split into <300 line files
- [ ] No TODOs in production code
- [ ] All tests passing with >90% coverage
- [ ] Memory-stable under 100 concurrent players doing quests

---

## Verification: Criteria → Phase Mapping

This section ensures every audit criterion is addressed:

### 1. Production Quality Code (7→9)

| Criterion | Phase | Status |
|-----------|-------|--------|
| Readability | 3.1 (split into focused files) | Planned |
| Error handling | Already good (try/catch present) | N/A |
| Performance | 1.3, 1.4, 1.5 (memory, caching, logging) | Planned |
| Documentation | Already good (JSDoc present) | N/A |
| Type safety | Already good (no `any` types) | N/A |
| No TODOs | 4.1 (complete implementation) | Planned |
| No hardcoded data | 4.2 (dynamic item names) | Planned |

### 2. Best Practices (7.5→9)

| Criterion | Phase | Status |
|-----------|-------|--------|
| Code organization | 3.1 (split into focused classes) | Planned |
| DRY | 3.1 (consolidate handleGatherStage/handleInteractStage) | Planned |
| KISS | 1.4, 1.5 (remove complex finds, simplify logging) | Planned |
| Testing coverage | Existing (997 line test file) + new tests per phase | Planned |

### 3. OWASP Security (6→9)

| Criterion | Phase | Status |
|-----------|-------|--------|
| Input validation | 1.2 (isValidQuestId in handlers) | Planned |
| Rate limiting | 1.1 (quest handler rate limits) | Planned |
| Audit logging | 2.1 (quest_audit_log table) | Planned |
| Log injection prevention | 1.2 (sanitize questId before logging) | Planned |
| Authentication | Already handled by socket auth | N/A |
| Access control | Server-authoritative (client can't modify state) | N/A |

### 4. Game Studio Audit (6.5→9)

| Criterion | Phase | Status |
|-----------|-------|--------|
| Server authority | Already present | N/A |
| Anti-cheat | 2.2 (kill token validation) | Planned |
| Scalability | 1.3, 1.4 (reduce allocations, O(1) lookups) | Planned |
| Analytics | 5.1 (quest analytics events) | Planned |
| Live ops | 4.3 (quest versioning) | Planned |
| Admin tools | 2.1 (audit log query endpoint) | Planned |

### 5. Memory & Allocation Hygiene (5→9)

| Criterion | Phase | Status |
|-----------|-------|--------|
| No allocations in hot paths | 1.3 (pre-allocated payloads, direct mutation) | Planned |
| Pre-allocated reusables | 1.3 (_progressEventPayload, _chatEventPayload) | Planned |
| O(1) lookups | 1.4 (stage caches by ID, target, type) | Planned |
| No .find() in loops | 1.4 (cached lookups) | Planned |
| Cached getActiveQuests | 1.3 (_activeQuestsCache) | Planned |
| Cached handler responses | 1.3 (questListCache) | Planned |
| Reduced logging | 1.5 (debug level, milestone only) | Planned |

### 6. SOLID Principles (7→9)

| Criterion | Phase | Status |
|-----------|-------|--------|
| Single Responsibility | 3.1 (split into 5 classes) | Planned |
| Open/Closed | Already good (manifest-driven) | N/A |
| Liskov Substitution | Already good (proper inheritance) | N/A |
| Interface Segregation | 3.2 (IQuestQuery, IQuestProgress, IQuestActions) | Planned |
| Dependency Inversion | 3.1 (inject dependencies into sub-classes) | Planned |

---

## Final Checklist Before Implementation

- [ ] All 6 criteria have phases addressing gaps
- [ ] No criterion left at current score
- [ ] Implementation order prioritizes high-impact items
- [ ] Risk mitigations documented for high-risk phases
- [ ] Test requirements specified for each phase
- [ ] Effort estimates include buffer for unknowns
