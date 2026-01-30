# Equipment System Improvement Plan

**Goal:** Raise the equipment system from **6.5/10** to **9/10+** across all audit criteria.

**Current Scores:**

| Section | Current | Target |
|---------|---------|--------|
| Security (OWASP/CWE) | 7 | 9 |
| Architecture (SOLID/GRASP/Clean Code) | 5 | 9 |
| ECS Pattern Adherence | 6 | 9 |
| Database & Persistence | 8 | 9 |
| Client UI | 5 | 9 |
| Testing | 6 | 9 |
| Network Authority | 8 | 9 |
| **Overall** | **6.5** | **9** |

---

## Phase 1: Security & Reliability Hardening (7 -> 9)

### 1.1 Add Trade State Guard to Equip/Unequip Handlers

**File:** `packages/server/src/systems/ServerNetwork/handlers/inventory.ts`

Both `handleEquipItem` (line ~407) and `handleUnequipItem` (line ~587) check for active duels but not active trades. Add an `isPlayerInTrade()` check to both handlers, rejecting the operation with a chat message if the player is mid-trade.

```
// Pseudocode for both handlers:
const tradingSystem = world.getSystem('trading');
if (tradingSystem?.isPlayerInTrade(playerId)) {
  // Send "You can't do that while trading" message
  return;
}
```

**Why this matters:** A player could equip an item they've offered in a trade, causing the trade to fail with a confusing error or creating timing-dependent edge cases.

### 1.2 Add Death State Guard to Equip/Unequip Handlers

**File:** `packages/server/src/systems/ServerNetwork/handlers/inventory.ts`

Neither handler checks if the player is dead. The death system's `clearEquipmentAndReturn()` modifies the `playerEquipment` Map directly without acquiring the inventory transaction lock, creating a potential race window.

Add a dead-player check to both handlers. The death system already tracks death state — query it before proceeding.

### 1.3 Add Validation to EQUIPMENT_FORCE_EQUIP

**File:** `packages/shared/src/systems/shared/character/EquipmentSystem.ts`

The `handleForceEquip` handler (line ~256) calls `this.getItemData(typedData.itemId)!` with a non-null assertion. If the item doesn't exist, this crashes the server.

Fix:
- Add a null check on `getItemData()` result — return early if null.
- Consider whether `EQUIPMENT_FORCE_EQUIP` should be restricted to server-only callers. If it's only used for starting items and admin commands, add an origin check or remove the event subscription if it's dead code.

### 1.4 Add Level Requirement Check to EQUIPMENT_EQUIP

**File:** `packages/shared/src/systems/shared/character/EquipmentSystem.ts`

The `EQUIPMENT_EQUIP` event handler (line ~228) calls `equipItem()` directly, bypassing `meetsLevelRequirements()`. Only `EQUIPMENT_TRY_EQUIP` validates requirements.

Fix: Add `meetsLevelRequirements()` check to the `EQUIPMENT_EQUIP` handler, or route it through `tryEquipItem()` instead.

### 1.5 Fix `playerHasItem` parseInt Dead Code

**File:** `packages/shared/src/systems/shared/character/EquipmentSystem.ts`

The `playerHasItem` method (line ~1490) calls `parseInt(itemIdStr, 10)` on string IDs like `"bronze_sword"`, producing `NaN`. The `|| slot.itemId === itemId` fallback catches it, so this is not a functional bug — but the `parseInt` branch is dead code that is misleading and fragile.

Fix: Remove the `parseInt` comparison. Compare as strings consistently.

### 1.6 Fix `playerSkills` Memory Leak

**File:** `packages/shared/src/systems/shared/character/EquipmentSystem.ts`

**Missed by original audit.** The `playerSkills` Map (line ~138) is populated on `SKILLS_UPDATED` events (line ~226) but is **never cleaned up** when players disconnect. `cleanupPlayerEquipment()` (called on `PLAYER_UNREGISTERED`) only deletes from `playerEquipment`, not `playerSkills`.

On a long-running production server, this leaks memory indefinitely as players join and leave.

Fix: Add `this.playerSkills.delete(playerId)` to `cleanupPlayerEquipment()`.

### 1.7 Add Error Handling for DB Save Failures After Equip/Unequip

**File:** `packages/shared/src/systems/shared/character/EquipmentSystem.ts`

**Missed by original audit.** After a successful in-memory equip, `saveEquipmentToDatabase()` is called (line ~1110 in `equipItem()`, line ~1227 in `unequipItem()`). If the save throws, the in-memory state diverges from the DB with no rollback. On next login, equipment reverts to the stale DB state.

Fix: Wrap save calls in try-catch. On failure, log the error but also consider a retry queue or at minimum ensure the next auto-save (5s) will catch up. The current auto-save already provides a partial safety net, but the error should be logged at WARN level so it's visible.

---

## Phase 2: Architecture Cleanup (5 -> 9)

### 2.1 Replace Hardcoded Slot Arrays with EQUIPMENT_SLOT_NAMES

**File:** `packages/shared/src/systems/shared/character/EquipmentSystem.ts`

The constant `EQUIPMENT_SLOT_NAMES` in `EquipmentConstants.ts` is the single source of truth, but 5 locations hardcode their own slot arrays:

| Location | Method | Current Pattern |
|----------|--------|-----------------|
| ~line 600 | `saveEquipmentToDatabase()` | Array of `{ key, slot }` objects |
| ~line 1304 | `recalculateStats()` | Direct property access array `[equipment.weapon, ...]` |
| ~line 1474 | `playerHasItem()` | Direct property access array |
| ~line 1620 | `isItemEquipped()` | Direct property access array |
| ~line 1955 | `getAllEquippedItems()` | Plain string array `["weapon", "shield", ...]` |

Note: Loop-based iterations (loading, clearing, emitting) already use `EQUIPMENT_SLOT_NAMES` correctly. The issue is in utility methods that build inline arrays.

Replace all 5 with iteration over `EQUIPMENT_SLOT_NAMES`, using bracket access: `equipment[slotName as keyof PlayerEquipment]`. This eliminates the need to update these locations when adding new slots.

### 2.2 Extract a `createEmptyTotalStats()` Factory

**File:** `packages/shared/src/systems/shared/character/EquipmentSystem.ts`

The identical 17-field `totalStats` zero-value object is constructed in **4 places** (not 3 as originally reported):
- `initializePlayerEquipment()` (line ~366)
- `clearEquipmentImmediate()` (line ~676)
- `clearEquipmentAndReturn()` (line ~784)
- `recalculateStats()` (line ~1280)

Extract to a shared factory function:
```typescript
function createEmptyTotalStats(): PlayerEquipment['totalStats'] {
  return { attackStab: 0, attackSlash: 0, /* ...all 17 fields */ };
}
```

### 2.3 Extract a `sendEquipmentUpdated()` Helper

**File:** `packages/shared/src/systems/shared/character/EquipmentSystem.ts`

The "send equipment updated to client" block appears exactly **7 times**:
1. `loadEquipmentFromDatabase()` — after loading (line ~444)
2. `loadEquipmentFromDatabase()` — new player (line ~467)
3. `equipItem()` — after equip (line ~1101)
4. `unequipItem()` — after unequip (line ~1218)
5. `equipItemDirect()` — bank equip (line ~1848)
6. `unequipItemDirect()` — bank unequip (line ~1927)
7. `consumeArrow()` — after arrow consumed (line ~2041)

Extract to a single `sendEquipmentUpdated(playerId: string)` method.

### 2.4 Extract an `emitEquipmentChangedForAllSlots()` Helper

**File:** `packages/shared/src/systems/shared/character/EquipmentSystem.ts`

The loop emitting `PLAYER_EQUIPMENT_CHANGED` for each slot appears **5 times** (not 4 as originally reported):
1. `loadEquipmentFromDatabase()` — equipment found (line ~451)
2. `loadEquipmentFromDatabase()` — no equipment (line ~474)
3. `loadEquipmentFromPayload()` (line ~536)
4. `emitEmptyEquipmentEvents()` (line ~556)
5. `clearEquipmentImmediate()` (line ~652)

Extract to a helper that takes `playerId` and the equipment object.

### 2.5 Unify `clearEquipmentImmediate` and `clearEquipmentAndReturn`

**File:** `packages/shared/src/systems/shared/character/EquipmentSystem.ts`

These two methods (~lines 643–717 and 734–825) are ~80% identical. Refactor into a single `clearEquipment(playerId, options?: { returnItems?: boolean, transaction?: unknown })` method. The `returnItems` flag controls whether items are collected before clearing.

### 2.6 Remove Food Consumption from EquipmentSystem

**File:** `packages/shared/src/systems/shared/character/EquipmentSystem.ts`

The `handleItemRightClick` method (line ~831) handles food consumption for non-equippable items (lines ~853-858 emit `INVENTORY_CONSUME_ITEM`). This is a separation of concerns violation — food consumption should be handled by InventorySystem or a dedicated ItemActionSystem.

Move the food consumption branch to the appropriate system, and have `handleItemRightClick` only handle equippable items (returning/ignoring non-equippable ones).

### 2.7 Redesign PlayerEquipment Interface

**File:** `packages/shared/src/types/entities/player-types.ts`

The `PlayerEquipment` interface (lines ~511-544) mixes slot data with metadata (`playerId`, `totalStats`), forcing `as` casts throughout `EquipmentSystem.ts`. Code must manually exclude `playerId` and `totalStats` with identity comparisons when iterating. Restructure to separate concerns:

```typescript
interface PlayerEquipment {
  playerId: string;
  slots: Record<EquipmentSlotName, EquipmentSlot | null>;
  totalStats: EquipmentTotalStats;
}
```

This eliminates the need to exclude `playerId` and `totalStats` when iterating slots, and removes most `as` casts. This is a larger refactor that touches every consumer of `PlayerEquipment`.

Note: Three overlapping equipment interfaces exist (`Equipment` in item-types.ts, `PlayerEquipment` in player-types.ts, `PlayerEquipmentItems` in player-types.ts). Consider consolidating `Equipment` into `PlayerEquipment` or removing it if unused.

### 2.8 Unify itemId Type to `string | null`

**Files:** `packages/shared/src/types/game/item-types.ts`, `EquipmentSystem.ts`

`EquipmentSlot.itemId` is typed `string | number | null` (line ~334 of item-types.ts) but item IDs are always strings. All writes from DB are strings, and all reads defensively call `.toString()`. Change to `string | null` and remove all `.toString()` calls and `parseInt` workarounds. Also fix `isItemEquipped` and `canEquipItem` to accept `string` instead of `number`.

### 2.9 Consolidate Equipment Slot Type Systems

**Files:** `packages/client/src/game/systems/equipment/equipmentUtils.ts`

Two incompatible systems exist:
- `EquipmentSlotName` (shared, OSRS-style: `"helmet"`, `"body"`, `"weapon"`)
- `EquipSlotType` (client, WoW-style: `"head"`, `"chest"`, `"mainHand"`)

The WoW-style types are only used by dead code. Remove them entirely as part of Phase 4 dead code cleanup.

### 2.10 Use Consistent Logging

**File:** `packages/shared/src/systems/shared/character/EquipmentSystem.ts`

3 `console.warn` calls found (lines ~173, ~577, ~586) alongside 9+ `Logger.systemError` calls. Replace all `console.warn` with `Logger.systemWarn` or `Logger.systemError` for consistency.

---

## Phase 3: ECS Decomposition (6 -> 9)

### 3.1 Remove Dead Visual Update Loop

**File:** `packages/shared/src/systems/shared/character/EquipmentSystem.ts`

The `update()` method calls `updateEquipmentPositions()` every frame, which iterates all players and all 11 attachment points. Since `createEquipmentVisual` is a no-op (explicitly commented "DISABLED: Box geometry equipment visuals are debug/test artifacts"), no equipment ever has `visualMesh`, so the entire loop does nothing. This wastes CPU cycles and allocates arrays via `Object.entries()` every frame.

Remove the entire `update()` body, or replace with an early return. Also remove:
- `updateEquipmentPositions()` (~line 2119)
- `updatePlayerEquipmentVisuals()` (~line 2142)
- `attachEquipmentToPlayer()` (~line 2165)
- `hasEquipmentSupport()` (~line 2105)
- `getEquipmentColor()` (~line 2091) — never called by any code
- `createEquipmentVisual()` (~line 2059) — no-op, called from equip paths but does nothing
- `removeEquipmentVisual()` (~line 2073)
- `attachmentPoints` constant (~line 110)

This removes ~150 lines of dead code that executes every frame.

### 3.2 Remove Dead `equipStartingItems` Method

**File:** `packages/shared/src/systems/shared/character/EquipmentSystem.ts`

`equipStartingItems()` (line ~392) is defined but never called anywhere in the codebase. The comment at line ~388 says starting items are equipped in `loadEquipmentFromDatabase`, but that method actually starts new players with empty equipment (line ~461). Remove the dead method.

### 3.3 Split EquipmentSystem Into Focused Systems (Optional — High Effort)

If further decomposition is desired, `EquipmentSystem.ts` could be split into:
- **EquipmentSystem** — Core equip/unequip logic, slot management, level requirements
- **EquipmentStatsSystem** — Stats recalculation, totalStats management, combat stat events
- **EquipmentPersistenceSystem** — DB save/load, auto-save, graceful shutdown
- **EquipmentWeightSystem** — Weight calculation and stamina events

This is a larger refactor. The system works as a monolith, but at 2280 lines it violates single-responsibility. This step is optional for reaching 9/10 if all other improvements are made.

---

## Phase 4: Client UI Cleanup (5 -> 9)

### 4.1 Delete All Dead Equipment Files

Remove the following files/directories which are not imported by any active code:

```
packages/client/src/game/components/equipment/   (entire directory — no active imports)
  - EquipmentPanel.tsx
  - EquipmentSlot.tsx
  - CharacterModel.tsx    (if exists)
  - StatsSummary.tsx      (if exists)
  - ItemComparison.tsx    (if exists)
  - index.ts

packages/client/src/game/systems/equipment/      (entire directory — no active imports)
  - useEquipment.ts
  - useEquipmentSlot.ts
  - equipmentUtils.ts
  - index.ts
```

**Do NOT delete** `packages/client/src/game/types/equipment.ts` — it exports `RawEquipmentData` and `RawEquipmentSlot` types that are actively imported by `usePlayerData.ts`.

Also remove the WoW-style `EquipSlotType` type system that only these dead files use. Verify each file is truly unused with a codebase-wide import search before deletion.

### 4.2 Centralize Equipment State Processing

**Files:** `packages/client/src/hooks/usePlayerData.ts`, `packages/client/src/utils/equipment.ts`

Equipment raw data is processed in 3 separate places:
1. `usePlayerData.handleEquipment` (inline, line ~134) — **drops quantity for stackable items**
2. `processRawEquipment` utility (line ~41) — handles quantity correctly
3. `usePlayerData` cached equipment path (line ~304) — **also drops quantity**

Fix: Make both inline paths use the `processRawEquipment` utility function, which correctly preserves quantity. This fixes the **arrow quantity display bug** where arrows show as quantity 1.

Also note: `isEquipmentUpdateEvent` type guard exists in `packages/client/src/types/guards.ts` but is never used — `handleEquipment` uses the generic `isObject()` check instead. Consider using the type guard for stronger validation.

### 4.3 Remove Unused `onItemDrop` Prop

**File:** `packages/client/src/game/panels/EquipmentPanel.tsx`

The `onItemDrop` prop is destructured as `_onItemDrop` (line ~924) and never used. Remove from the interface and the component signature.

### 4.4 Extract Unequip Logic Into a Shared Function

**File:** `packages/client/src/game/panels/EquipmentPanel.tsx`

Click-to-unequip (line ~1038) and context-menu unequip (line ~1093) both call `world.network.send("unequipItem", ...)` with the same payload. Extract to a `handleUnequip(slotKey: string)` function.

### 4.5 Deduplicate Mobile/Desktop Grid Rendering

**File:** `packages/client/src/game/panels/EquipmentPanel.tsx`

`renderSlotCell` and `renderDesktopSlotCell` (line ~1141) are nearly identical. Merge into a single `renderSlotCell(slotName, isMobile)` function. The paperdoll layout (Cape/Head/Amulet, Weapon/Body/Shield, Ring/Legs/Gloves, Boots/empty/Ammo) is the same for both — only styling differs.

### 4.6 Extract SVG Icons to a Shared Module

**File:** `packages/client/src/game/panels/EquipmentPanel.tsx`

The 11 SVG icon components (lines ~40-253, 213 lines) should be extracted to a dedicated file:
```
packages/client/src/game/panels/equipment/EquipmentIcons.tsx
```

### 4.7 Convert `renderEquipmentHoverTooltip` to a React Component

**File:** `packages/client/src/game/panels/EquipmentPanel.tsx`

The 330-line `renderEquipmentHoverTooltip` function (line ~355) is not a React component — it can't use hooks, React can't reconcile it efficiently, and the portal re-creates every render. Convert to:
```
packages/client/src/game/panels/equipment/EquipmentTooltip.tsx
```

This also enables memoizing the item content separately from the mouse position, reducing re-renders.

### 4.8 Add React.memo to EquipmentPanel

**File:** `packages/client/src/game/panels/EquipmentPanel.tsx`

Wrap the export with `React.memo` to prevent unnecessary re-renders when parent components update for unrelated reasons.

### 4.9 Deduplicate Rarity Colors

**Files:** `packages/client/src/game/panels/EquipmentPanel.tsx` (line ~368), `packages/client/src/game/systems/equipment/equipmentUtils.ts` (line ~270)

Rarity colors are defined identically in two places. After deleting the dead files in 4.1, only the EquipmentPanel copy will remain. Consider extracting to a shared constant in `packages/client/src/constants/` if other panels also need rarity colors.

### 4.10 Add ARIA Labels to Equipment Slots

**File:** `packages/client/src/game/panels/EquipmentPanel.tsx`

The `DroppableEquipmentSlot` `<button>` elements lack `aria-label`. Add labels like `aria-label={slot.item ? \`${slot.item.name} equipped in ${slot.label} slot\` : \`Empty ${slot.label} slot\`}`.

---

## Phase 5: Database & Persistence (8 -> 9)

### 5.1 Parallelize Auto-Save

**File:** `packages/shared/src/systems/shared/character/EquipmentSystem.ts`

`performAutoSave()` (line ~2217) iterates all players sequentially with `await` in a `for...of` loop. With 100 players, this means 100 sequential DB writes. Note: `destroyAsync()` already uses `Promise.allSettled()` for parallel saves — `performAutoSave` should match.

Fix: Use `Promise.allSettled()` to save all players in parallel:
```typescript
async performAutoSave() {
  const savePromises = Array.from(this.playerEquipment.keys()).map(
    playerId => this.saveEquipmentToDatabase(playerId).catch(err =>
      Logger.systemError(`Auto-save failed for ${playerId}:`, err)
    )
  );
  await Promise.allSettled(savePromises);
}
```

### 5.2 Remove Deprecated Synchronous Wrappers

**File:** `packages/server/src/systems/DatabaseSystem/index.ts`

Remove `getPlayerEquipment` and `savePlayerEquipment` (the sync fire-and-forget wrappers). All callers should use the async versions. Verify no callers remain before removal.

### 5.3 Add equipSlot Manifest Validation

**File:** `packages/shared/src/data/DataManager.ts`

In `validateAllData()`, add a check that all items with an `equipSlot` value use a valid `EquipmentSlotName`. This catches manifest typos at startup rather than at runtime.

### 5.4 Pre-check Inventory Space Before 2H Shield Auto-Unequip

**File:** `packages/shared/src/systems/shared/character/EquipmentSystem.ts`

When equipping a 2H weapon, the shield is auto-unequipped first (line ~970). If inventory is full, the shield return fails. The error handling path exists (lines ~1183-1192) and will restore on failure, but the user gets a confusing error.

Fix: Check `inventorySystem.hasSpace()` *before* attempting the shield unequip, and send a clear "Your inventory is too full" message if there's no room.

---

## Phase 6: Testing (6 -> 9)

### 6.1 Update Test Mocks and Add Tests for All 5 New Equipment Slot Types

**Files:**
- `packages/shared/src/systems/shared/character/__tests__/EquipmentSystem.test.ts`
- `packages/shared/src/systems/shared/character/__tests__/EquipmentPersistence.test.ts`

Both test files' mock `PlayerEquipment` interfaces only include the original 6 slots (weapon, shield, helmet, body, legs, arrows). The `initializePlayer()` mock function doesn't create boots, gloves, cape, amulet, or ring slots.

Fix:
- Update mock `PlayerEquipment` to include all 11 slots
- Update `initializePlayer()` to initialize all 11 slots
- Add test cases for:
  - Equipping boots, gloves, cape, amulet, ring to correct slots
  - Stats recalculation includes bonuses from new slots
  - Unequip returns item to inventory
  - Persist across save/load cycle

### 6.2 Add Trade + Equip Interaction Test

After implementing the trade guard (Phase 1.1), add a test verifying that equip is rejected when a player is in an active trade.

### 6.3 Add Death + Equip Interaction Test

After implementing the death guard (Phase 1.2), add a test verifying that equip is rejected when a player is dead.

### 6.4 Add Arrow Quantity Persistence Test

Test that equipping arrows with quantity > 1, saving, and reloading preserves the correct quantity.

### 6.5 Add Bank Equipment Integration Test

Add tests for:
- `handleBankWithdrawToEquipment` — withdraw from bank directly to equipment slot
- `handleBankDepositEquipment` — deposit from equipment slot directly to bank
- `handleBankDepositAllEquipment` — deposit all worn items to bank
- 2H weapon displacing shield back to bank (not inventory)

### 6.6 Add EquipmentRepository Integration Test

**File:** New test file in `packages/server/tests/integration/`

Test the actual Drizzle ORM queries against a test database:
- `getPlayerEquipmentAsync` returns correct rows
- `savePlayerEquipmentAsync` upsert works (insert + update + delete stale slots)
- Empty save deletes all rows
- Concurrent saves for different players don't interfere

---

## Phase 7: Network Authority Polish (8 -> 9)

### 7.1 Trade/Death Guards (Covered in Phase 1)

The trade and death state guards from Phase 1 also close the network authority gaps.

### 7.2 Add Idempotency Service to Equip/Unequip (Optional)

**File:** `packages/server/src/systems/ServerNetwork/handlers/inventory.ts`

Pickup and drop handlers use `getIdempotencyService()` to prevent duplicate requests. Add the same to equip/unequip for consistency. The natural idempotency from `hasItemAtSlot()` provides protection, but the idempotency service adds defense-in-depth.

---

## Implementation Order

The phases are ordered by impact and dependency. Each phase can be implemented and verified independently.

| Order | Phase | Effort | Impact |
|-------|-------|--------|--------|
| 1 | Phase 1.1-1.5: Security guards & validation | Small | High — closes exploitable gaps |
| 2 | Phase 1.6: playerSkills memory leak | Tiny | Critical — production memory leak |
| 3 | Phase 1.7: DB save error handling | Small | High — prevents state divergence |
| 4 | Phase 2.1-2.6: DRY/Helpers | Small | High — reduces maintenance burden |
| 5 | Phase 3.1-3.2: Dead code removal (ECS) | Small | Medium — removes per-frame waste |
| 6 | Phase 4.1-4.3: Client dead code + quantity bug fix | Small | High — fixes arrow bug, removes confusion |
| 7 | Phase 5.1, 5.4: Auto-save + 2H edge case | Small | Medium — scalability + UX |
| 8 | Phase 6.1-6.4: Core tests | Medium | High — validates all changes |
| 9 | Phase 4.4-4.8: Client refactoring | Medium | Medium — cleaner UI code |
| 10 | Phase 2.7-2.9: Type system cleanup | Large | Medium — eliminates `as` casts |
| 11 | Phase 6.5-6.6: Integration tests | Medium | Medium — deeper coverage |
| 12 | Phase 3.3: System decomposition (Optional) | Large | Low — nice-to-have for 10/10 |

---

## Verification Checklist

After completing all phases:

- [ ] `bun run build` passes (shared, client, server)
- [ ] `npm test` passes
- [ ] All 11 equipment slots equip/unequip correctly
- [ ] Equipment persists across logout/login
- [ ] Equipment stats update in combat
- [ ] Equip blocked during active trade
- [ ] Equip blocked while dead
- [ ] Arrows display correct quantity (not "1")
- [ ] Bank <-> Equipment operations work
- [ ] 2H weapon auto-unequips shield (clear error if inventory full)
- [ ] Level requirements enforced on ALL equip paths (including EQUIPMENT_EQUIP)
- [ ] EQUIPMENT_FORCE_EQUIP doesn't crash on invalid item IDs
- [ ] No `playerSkills` memory leak — entries cleaned up on player disconnect
- [ ] DB save failures don't silently corrupt state
- [ ] No dead code files remain in `game/components/equipment/` or `game/systems/equipment/`
- [ ] `game/types/equipment.ts` is preserved (actively used by usePlayerData)
- [ ] No hardcoded slot arrays remain in `EquipmentSystem.ts`
- [ ] Desktop and mobile paperdoll layouts render correctly
- [ ] No `console.warn` calls remain in `EquipmentSystem.ts`

---

## Corrections Log

Issues found during verification that differ from original audit:

| Original Claim | Correction |
|----------------|------------|
| 8+ hardcoded slot arrays | Actually 5 — loop iterations already use EQUIPMENT_SLOT_NAMES |
| totalStats in 3 places | Actually 4 — `initializePlayerEquipment()` was missed |
| PLAYER_EQUIPMENT_CHANGED loop 4 times | Actually 5 — `clearEquipmentImmediate()` was missed |
| `game/types/equipment.ts` is dead code | FALSE — `RawEquipmentData` types actively used by `usePlayerData.ts` |
| `playerHasItem` parseInt is non-functional | LOW severity — `|| slot.itemId === itemId` fallback catches it |
| Send equipment updated 6+ times | Exactly 7 (includes `consumeArrow`) |
| playerSkills memory leak | **MISSED** — never cleaned up on disconnect |
| DB save failure rollback | **MISSED** — no error handling after in-memory equip |
| 2H + full inventory edge case | **MISSED** — should pre-check space before auto-unequip |
| Test mocks only have 6 slots | **MISSED** — new slots completely untested |
