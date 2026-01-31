# Crafting System Audit & Implementation Plan

**Date**: 2026-01-30
**Branch**: `feat/crafting-skill`
**Current Score**: 6/10
**Target Score**: 9/10

---

## Table of Contents

1. [Audit Findings](#audit-findings)
2. [Score Breakdown](#score-breakdown)
3. [Implementation Plan](#implementation-plan)
4. [Phase Schedule](#phase-schedule)

---

## Audit Findings

### F-01: No Movement/Combat Cancellation (Systemic)

**Severity**: Critical
**Category**: Game Patterns, Server Authority
**Files**: `CraftingSystem.ts`, `SmeltingSystem.ts`, `CookingSystem.ts`

`MOVEMENT_STARTED` is defined in `event-types.ts:132` but zero processing systems subscribe to it. `COMBAT_STARTED` is emitted by CombatSystem but no processing system listens. Players can walk across the map or get attacked while crafting continues indefinitely. In OSRS, any movement or combat interrupts skilling.

This is systemic — smelting and cooking have the same gap.

---

### F-02: No CraftingSystem Unit Tests

**Severity**: Critical
**Category**: Testing
**Files**: None exist

Zero tests for the core server-side crafting logic. No coverage for `startCrafting`, `completeCraft`, `scheduleNextCraft`, consumable tracking, level validation, material depletion, or the full crafting loop. The only crafting-related tests are data-layer tests in `ProcessingDataProvider.test.ts`.

---

### F-03: No Integration / E2E Tests

**Severity**: Critical
**Category**: Testing
**Files**: None exist

No Playwright tests for the crafting flow: click tool → click material → panel opens → select recipe → choose quantity → craft completes → XP awarded → inventory updated. The project mandate requires real Hyperscape instances with Playwright.

---

### F-04: Event Payload Type Drift for `inputItemId`

**Severity**: High
**Category**: TypeScript Rigor
**Files**: `event-payloads.ts:642-648`, `CraftingSystem.ts:71`, `event-payloads.ts:1088`

`CraftingInteractPayload` is missing `inputItemId?: string`. Three locations diverge:
- Runtime sends and receives `inputItemId` correctly (JS objects carry extra props)
- EventMap at line 1088 maps `CRAFTING_INTERACT` to the incomplete type
- Subscribe callback at `CraftingSystem.ts:71` types data without `inputItemId`

Any developer relying on TypeScript types will miss the field.

---

### F-05: No Rate Limiting on `onCraftingSourceInteract`

**Severity**: High
**Category**: Security, OWASP
**Files**: `ServerNetwork/index.ts:1663`

`onProcessingCrafting` calls `canProcessRequest()` but `onCraftingSourceInteract` has no rate limiting. Each call triggers a full inventory fetch, recipe filtering, availability computation, and network send. A malicious client spamming this packet causes repeated server-side work.

---

### F-06: Repeated Inventory Scanning (4x per Craft Tick)

**Severity**: High
**Category**: Memory & Allocation, DRY
**Files**: `CraftingSystem.ts:501, :521, :546`

`hasRequiredTools`, `hasRequiredInputs`, and `hasRequiredConsumables` each independently call `this.world.getInventory(playerId)` and rebuild a Map/Set from scratch. During `scheduleNextCraft` (called every craft tick), this means 3 full inventory scans per tick per active crafter. `handleCraftingInteract` adds a 4th.

---

### F-07: "All" Button Hardcodes 28

**Severity**: Medium
**Category**: UI, Game Accuracy
**Files**: `CraftingPanel.tsx:251`, `TanningPanel.tsx:251`

Both panels hardcode `28` for "All" quantity. For multi-input recipes (green dhide chaps = 2 green dragon leather), the true max is `floor(count / amount_per_craft)`. The server stops gracefully when materials run out, but the UX promise of "All" is misleading. Should send a sentinel value and let the server compute the actual max.

---

### F-08: `Date.now()` Collision in Item IDs

**Severity**: Medium
**Category**: Economic Integrity
**Files**: `CraftingSystem.ts:432`

`inv_${playerId}_${Date.now()}` can collide if two crafts complete in the same millisecond (server catch-up after lag). Should use a monotonic counter or combine with a sequence number.

---

### F-09: `getCraftingLevel` Falsy Check on Numeric Value

**Severity**: Medium
**Category**: TypeScript Rigor
**Files**: `CraftingSystem.ts:565`

`if (cachedSkills?.crafting?.level)` is falsy for level 0. While level 0 shouldn't occur, using a falsy check on a number is a latent bug pattern. Should be `!= null`.

---

### F-10: Inconsistent Default Fallbacks in Stats Component

**Severity**: Medium
**Category**: Code Quality
**Files**: `PlayerEntity.ts:489-524`

Some skills have `|| { level: 1, xp: 0 }` fallback guards (`smithing`, `agility`, `crafting`, `magic`) and others don't (`attack`, `strength`, `woodcutting`, etc.). If `playerData.skills` exists but is missing a key, the unguarded skills become `undefined` in the stats component.

---

### F-11: Float XP Values in Manifest → Integer DB Column

**Severity**: Medium
**Category**: Economic Integrity, Persistence
**Files**: `crafting.json`, `schema.ts:226`

Recipe XP values are floats (13.8, 16.3, 67.5). The DB column is `integer("craftingXp")`. Need to verify the SkillsSystem accumulates fractional XP correctly before integer truncation at the DB boundary, or accumulated XP drifts over many crafts.

---

### F-12: Non-Atomic Craft Operations

**Severity**: Medium
**Category**: Economic Integrity
**Files**: `CraftingSystem.ts:413-445`

`completeCraft` emits `INVENTORY_ITEM_REMOVED` for inputs, then `INVENTORY_ITEM_ADDED` for output, then `SKILLS_XP_GAINED` — three separate events. If the server crashes between removal and addition, the player loses materials without gaining the product.

---

### F-13: Consumable Uses Tracked in Ephemeral Memory

**Severity**: Medium
**Category**: Economic Integrity
**Files**: `CraftingSystem.ts:286-289`

Thread consumption uses are tracked in the session's in-memory Map. If the server crashes mid-batch after 3 of 5 uses, the counter is lost. On restart, the thread still exists in inventory but its remaining uses reset. Max exploitation: 4 free crafts per crash (thread has 5 uses).

---

### F-14: No Crafting Audit Logging

**Severity**: Medium
**Category**: Security, Observability
**Files**: `CraftingSystem.ts`

Crafting completions only emit `UI_MESSAGE` and `CRAFTING_COMPLETE` events. No structured audit logging for significant value transfers (items consumed, items created, XP awarded). Cannot detect exploit patterns or RMT farming.

---

### F-15: `formatItemName` Duplicated

**Severity**: Low
**Category**: DRY
**Files**: `CraftingPanel.tsx:81`, `TanningPanel.tsx:33`

Identical function duplicated across two panel components.

---

### F-16: Unused Props and Dead Fields

**Severity**: Low
**Category**: Code Hygiene
**Files**: `CraftingPanel.tsx:108` (`_station`), `CraftingSystem.ts:298` (`startTime`)

`station` prop accepted but unused in CraftingPanel. `startTime` field set on CraftingSession but never read.

---

### F-17: Single-Recipe Shows Full Grid UI

**Severity**: Low
**Category**: UI, Game Accuracy
**Files**: `CraftingPanel.tsx`

When only 1 recipe is returned (chisel + uncut sapphire), the panel renders a full category header + 2-column grid with a single half-width button. OSRS shows a simplified make-x dialog for single items.

---

### F-18: Emoji Icons Hardcoded in Components

**Severity**: Low
**Category**: Manifest-Driven Architecture
**Files**: `CraftingPanel.tsx:38-76`, `TanningPanel.tsx:40-45`

Item icons are hardcoded emoji lookups in each panel. Should be manifest-driven or in a shared utility.

---

### F-19: No JSON Schema Validation for crafting.json

**Severity**: Low
**Category**: Manifest-Driven Architecture
**Files**: `crafting.json`

The manifest is trusted at load time. A typo in a field name (e.g., `"staion"` instead of `"station"`) would silently produce wrong behavior. No build-time schema validation.

---

### F-20: ProcessingDataProvider Singleton Not Injectable

**Severity**: Low
**Category**: SOLID (Dependency Inversion)
**Files**: `CraftingSystem.ts:22`

Direct import of singleton prevents unit testing CraftingSystem in isolation. Project-wide pattern, not crafting-specific.

---

## Score Breakdown

| Section | Current | Target | Gap |
|---|---|---|---|
| Production Quality Code | 7 | 9 | F-08, F-09, F-10 |
| DRY / KISS / YAGNI | 6 | 9 | F-06, F-15, F-16 |
| Testing Coverage | 4 | 9 | F-02, F-03 |
| OWASP / Security | 6.5 | 9 | F-05, F-14 |
| SOLID Principles | 7 | 9 | F-20 |
| Memory & Allocation | 5 | 9 | F-06 |
| TypeScript Rigor | 5.5 | 9 | F-04, F-09 |
| UI Framework | 6.5 | 9 | F-07, F-17 |
| Game Patterns | 5.5 | 9 | F-01 |
| Server Authority | 6 | 9 | F-01, F-05 |
| Economic Integrity | 6 | 9 | F-08, F-11, F-12, F-13 |
| Persistence & DB | 8 | 9 | F-11 |
| Manifest-Driven | 8 | 9 | F-18, F-19 |
| Code Organization | 7 | 9 | F-15 |

---

## Implementation Plan

### Phase 1: Type Safety & Event Contracts

**Goal**: Eliminate all type drift and establish correct event contracts.
**Fixes**: F-04, F-09, F-16

**Changes**:

1. **`event-payloads.ts`** — Add `inputItemId?: string` to `CraftingInteractPayload`:
   ```typescript
   export interface CraftingInteractPayload {
     playerId: string;
     triggerType: "needle" | "chisel" | "furnace";
     stationId?: string;
     inputItemId?: string;  // Specific material for recipe filtering
   }
   ```

2. **`CraftingSystem.ts:71`** — Update subscribe callback type to match payload:
   ```typescript
   this.subscribe(
     EventType.CRAFTING_INTERACT,
     (data: {
       playerId: string;
       triggerType: string;
       stationId?: string;
       inputItemId?: string;
     }) => {
       this.handleCraftingInteract(data);
     },
   );
   ```

3. **`CraftingSystem.ts:565`** — Fix falsy check on numeric level:
   ```typescript
   if (cachedSkills?.crafting?.level != null) {
     return cachedSkills.crafting.level;
   }
   ```

4. **`CraftingSystem.ts:43-46`** — Type `playerSkills` with `Skills` type:
   ```typescript
   private readonly playerSkills = new Map<string, Skills>();
   ```

5. **`CraftingPanel.tsx:108`** — Remove unused `station` prop. Update `CraftingPanelProps` interface. Remove `_station` from destructuring.

6. **`CraftingSystem.ts:298`** — Remove unused `startTime` from `CraftingSession` interface and the assignment.

7. **Add `Skill.CRAFTING`** constant alongside existing `Skill.ATTACK`, etc. in `SkillsSystem.ts`. Use it in `CraftingSystem.ts:443` instead of string literal `"crafting"`.

---

### Phase 2: Security & Rate Limiting

**Goal**: Close rate limiting gaps and add audit logging.
**Fixes**: F-05, F-14

**Changes**:

1. **`ServerNetwork/index.ts:1663`** — Add rate limiting to `onCraftingSourceInteract`:
   ```typescript
   this.handlers["onCraftingSourceInteract"] = (socket, data) => {
     const player = socket.player;
     if (!player) return;

     if (!this.canProcessRequest(player.id)) {
       return;
     }
     // ... rest of handler
   };
   ```

2. **`CraftingSystem.ts`** — Add structured audit logging in `completeCraft`:
   ```typescript
   Logger.audit("CraftingSystem", "craft_complete", {
     playerId,
     recipeId: session.recipeId,
     output: recipe.output,
     inputsConsumed: recipe.inputs,
     xpAwarded: recipe.xp,
     crafted: session.crafted + 1,
     batchTotal: session.quantity,
   });
   ```
   Verify `Logger.audit` exists or use the closest equivalent logging method in the codebase.

---

### Phase 3: Movement & Combat Cancellation

**Goal**: Crafting (and other processing) cancels on movement and combat, matching OSRS behavior.
**Fixes**: F-01

**Changes**:

1. **`CraftingSystem.ts` init()** — Subscribe to movement and combat events:
   ```typescript
   this.subscribe(
     EventType.MOVEMENT_STARTED,
     (data: { entityId: string }) => {
       if (this.activeSessions.has(data.entityId)) {
         this.cancelCrafting(data.entityId);
       }
     },
   );

   this.subscribe(
     EventType.COMBAT_STARTED,
     (data: { playerId: string }) => {
       if (this.activeSessions.has(data.playerId)) {
         this.cancelCrafting(data.playerId);
       }
     },
   );
   ```

2. **Verify `MOVEMENT_STARTED` is emitted** — Check that the movement system actually emits this event when a player starts moving. If not, add the emission at the appropriate point in the movement system.

3. **Apply the same pattern to SmeltingSystem and CookingSystem** — Same movement/combat listeners with their respective `cancelSmelting`/`cancelCooking` methods. This is out-of-scope for the crafting audit but should be done in the same pass since it's the same pattern.

---

### Phase 4: Memory & Performance

**Goal**: Eliminate redundant allocations in hot paths.
**Fixes**: F-06

**Changes**:

1. **`CraftingSystem.ts`** — Extract a single `getInventoryState` method:
   ```typescript
   private getInventoryState(playerId: string): {
     counts: Map<string, number>;
     itemIds: Set<string>;
   } | null {
     const inventory = this.world.getInventory?.(playerId);
     if (!inventory || !Array.isArray(inventory)) return null;

     const counts = new Map<string, number>();
     const itemIds = new Set<string>();
     for (const item of inventory) {
       if (!isLooseInventoryItem(item)) continue;
       itemIds.add(item.itemId);
       const count = counts.get(item.itemId) || 0;
       counts.set(item.itemId, count + getItemQuantity(item));
     }
     return { counts, itemIds };
   }
   ```

2. **Refactor** `hasRequiredTools`, `hasRequiredInputs`, `hasRequiredConsumables` to accept the pre-built state:
   ```typescript
   private hasRequiredTools(state: InventoryState, recipe: CraftingRecipeData): boolean {
     if (recipe.tools.length === 0) return true;
     return recipe.tools.every((tool) => state.itemIds.has(tool));
   }

   private hasRequiredInputs(state: InventoryState, recipe: CraftingRecipeData): boolean {
     return recipe.inputs.every((input) => {
       const count = state.counts.get(input.item) || 0;
       return count >= input.amount;
     });
   }

   private hasRequiredConsumables(state: InventoryState, recipe: CraftingRecipeData): boolean {
     if (recipe.consumables.length === 0) return true;
     return recipe.consumables.every((c) => state.itemIds.has(c.item));
   }
   ```

3. **Refactor `scheduleNextCraft`** to call `getInventoryState` once and pass the result to all three check methods.

4. **`CraftingSystem.ts:602`** — Replace `Array.from(this.activeSessions)` in the update loop:
   ```typescript
   // Collect completed session IDs first, then process
   const completedIds: string[] = [];
   for (const [playerId, session] of this.activeSessions) {
     if (currentTick >= session.completionTick) {
       completedIds.push(playerId);
     }
   }
   for (const playerId of completedIds) {
     this.completeCraft(playerId);
   }
   ```
   This avoids allocating a full Map snapshot every tick. The `completedIds` array can be made a class field and reused via `.length = 0`.

---

### Phase 5: Economic Integrity

**Goal**: Fix item ID collisions, validate XP precision, and make "All" compute correctly.
**Fixes**: F-07, F-08, F-11, F-12

**Changes**:

1. **`CraftingSystem.ts:432`** — Replace `Date.now()` with monotonic counter:
   ```typescript
   private craftCounter = 0;

   // In completeCraft:
   id: `craft_${playerId}_${++this.craftCounter}_${Date.now()}`,
   ```

2. **Verify XP accumulation** — Read `SkillsSystem.addXPInternal` and trace the path from float XP in recipe → `skillData.xp` (runtime number) → `EventBridge` → `savePlayer({ craftingXp: data.newXp })` → DB integer column. If `skillData.xp` accumulates as float (e.g., 13.8 + 13.8 = 27.6) and the DB stores as integer, XP is truncated on every save. Fix by either:
   - Storing XP as float/real in the DB, OR
   - Rounding XP values in the manifest to integers (OSRS uses integers), OR
   - Using `Math.round()` at the DB boundary to prevent drift

3. **"All" button** — Change client panels to send a sentinel value (e.g., `Number.MAX_SAFE_INTEGER` or `-1`) for "All":
   ```typescript
   // CraftingPanel.tsx
   <button onClick={() => handleCraft(selectedRecipe, -1)}>All</button>
   ```
   Update `ServerNetwork/index.ts` handler to recognize `-1` as "max possible":
   ```typescript
   const quantity = payload.quantity === -1
     ? 10000  // Server computes actual max in CraftingSystem
     : Math.floor(Math.max(1, Math.min(payload.quantity, 10000)));
   ```
   In `CraftingSystem.startCrafting`, when quantity is 10000 (or any large number), `scheduleNextCraft` already stops when materials run out, so the server naturally computes the real max.

4. **Document non-atomic craft operations** — Add a code comment in `completeCraft` explaining the trade-off: full atomicity would require a transaction wrapper around event emissions, which the ECS event system doesn't support. The current approach is acceptable because:
   - Item removal and addition are processed synchronously in the same tick
   - Server crash between events would require a crash in the middle of a synchronous function call, which is not possible in single-threaded JS
   - The real risk is process kill (SIGKILL), which is acceptable loss for a single craft action

---

### Phase 6: Consistency & Code Quality

**Goal**: Fix inconsistencies, remove dead code, consolidate utilities.
**Fixes**: F-10, F-15, F-18

**Changes**:

1. **`PlayerEntity.ts:489-524`** — Add consistent fallback guards to ALL skills:
   ```typescript
   const defaultSkill = { level: 1, xp: 0 };
   // ...
   attack: playerData.skills.attack || defaultSkill,
   strength: playerData.skills.strength || defaultSkill,
   defense: playerData.skills.defense || defaultSkill,
   // ... same for all skills
   ```

2. **Extract `formatItemName`** into a shared utility (e.g., `packages/shared/src/utils/game/formatItemName.ts` or add to an existing UI utils file). Import from both `CraftingPanel.tsx` and `TanningPanel.tsx`.

3. **Extract icon utilities** — Move `getItemIcon` and `getHideIcon` into a shared `ItemIcons.ts` utility, or better yet, add an `icon` field to the item manifest so icons are data-driven.

---

### Phase 7: UI Improvements

**Goal**: OSRS-accurate UI behavior for edge cases.
**Fixes**: F-17

**Changes**:

1. **Single-recipe shortcut** — In CraftingPanel, when `availableRecipes.length === 1`, auto-select the recipe and skip straight to the quantity selector:
   ```typescript
   // In CraftingPanel, after useMemo:
   useEffect(() => {
     if (availableRecipes.length === 1) {
       setSelectedRecipe(availableRecipes[0]);
     }
   }, [availableRecipes]);
   ```
   This mirrors OSRS where chisel + uncut gem shows only the quantity prompt.

---

### Phase 8: Testing

**Goal**: Comprehensive test coverage for the crafting system.
**Fixes**: F-02, F-03

**Changes**:

1. **Unit tests** — Create `CraftingSystem.test.ts` covering:
   - `startCrafting` — valid recipe, level check, material check, tool check, consumable check
   - `completeCraft` — materials consumed, output added, XP awarded, session counter incremented
   - `scheduleNextCraft` — continues when materials available, stops when depleted, stops at target quantity
   - Consumable tracking — thread uses decrement, new thread consumed when depleted, stops when no thread
   - `handleCraftingInteract` — filters by station, filters by inputItemId, furnace mould filtering
   - `cancelCrafting` — session cleaned up, completion event emitted
   - Movement cancellation — session cancelled when movement event fires
   - Combat cancellation — session cancelled when combat event fires
   - Concurrent prevention — second craft request rejected while crafting
   - Edge cases — quantity 1, quantity max, recipe not found, player not found

2. **Integration tests** — Create Playwright test covering the full flow:
   - Give player needle + thread + leather → use needle on leather → panel opens → select leather gloves → click "1" → craft completes → inventory has leather gloves → XP increased
   - Give player chisel + uncut sapphire → use chisel on gem → panel shows only sapphire → craft → verify
   - Furnace jewelry flow with mould filtering
   - Movement interrupts crafting mid-batch
   - Verify XP persists after server restart

---

### Phase 9: Manifest Validation (Stretch)

**Goal**: Build-time safety for recipe data.
**Fixes**: F-19

**Changes**:

1. Add a JSON schema for `crafting.json` and validate at build time (or in ProcessingDataProvider.rebuild). Validate:
   - All required fields present (`output`, `category`, `inputs`, `tools`, `consumables`, `level`, `xp`, `ticks`, `station`)
   - `level` in range [1, 99]
   - `xp` > 0
   - `ticks` > 0
   - `station` is one of `"none"` | `"furnace"`
   - `inputs` array non-empty
   - All input item IDs exist in the item manifest

---

## Phase Schedule

| Phase | Scope | Findings Addressed | Score Impact |
|---|---|---|---|
| **Phase 1** | Type safety & event contracts | F-04, F-09, F-16 | TypeScript Rigor 5.5→8, Production Quality 7→8 |
| **Phase 2** | Security & rate limiting | F-05, F-14 | OWASP 6.5→8.5, Server Authority 6→7.5 |
| **Phase 3** | Movement/combat cancellation | F-01 | Game Patterns 5.5→9, Server Authority 7.5→9 |
| **Phase 4** | Memory & performance | F-06 | Memory 5→9, DRY 6→8 |
| **Phase 5** | Economic integrity | F-07, F-08, F-11, F-12 | Economic 6→9, UI 6.5→8 |
| **Phase 6** | Consistency & code quality | F-10, F-15, F-18 | Code Org 7→9, DRY 8→9, Manifest 8→9 |
| **Phase 7** | UI improvements | F-17 | UI 8→9 |
| **Phase 8** | Testing | F-02, F-03 | Testing 4→9 |
| **Phase 9** | Manifest validation (stretch) | F-19 | Manifest 9→9.5 |

**Projected final score after all phases: 9.1/10**

---

## Notes

- F-13 (ephemeral consumable tracking) is documented as an acceptable trade-off in Phase 5. The max exploitation is 4 free crafts per server crash, which is negligible.
- F-20 (singleton not injectable) is a project-wide pattern. Fixing it for crafting alone would be inconsistent. Flag for a future architectural pass across all systems.
- Phase 3 (movement/combat cancellation) should also be applied to SmeltingSystem and CookingSystem in the same pass for consistency. Those changes are not scored in this audit but should be done together.
