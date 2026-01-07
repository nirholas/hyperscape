# Smithing System Completion Plan

## Executive Summary

The Smithing skill implementation is **partially complete**. The core systems (SmeltingSystem, SmithingSystem) exist and emit events, but several critical pieces are missing that prevent the feature from working end-to-end.

## Current State

### What's Working
- `SmeltingSystem.ts` - Server-side smelting logic with XP calculations
- `SmithingSystem.ts` - Server-side smithing logic with XP calculations
- `SmeltingSourceInteractionHandler.ts` - Client handler for furnace clicks
- `SmithingSourceInteractionHandler.ts` - Client handler for anvil clicks
- `FurnaceEntity.ts` / `AnvilEntity.ts` - World objects with blue box visuals
- Packet registration for `smeltingSourceInteract` / `smithingSourceInteract`
- Server network handlers in `ServerNetwork/index.ts`
- ProcessingDataProvider has smelting/smithing recipe lookups
- Ore spawns in world (copper, tin, iron, coal, mithril)

### What's Broken/Missing

The systems emit events but **nothing receives them on the client**, and the **smithing skill doesn't exist** in the type system.

---

## Gap Analysis

### 1. Smithing Skill Not Defined in Type System

**Files affected:**
- `packages/shared/src/types/entities/entity-types.ts` - `Skills` interface missing `smithing`
- `packages/shared/src/components/StatsComponent.ts` - No `smithing` property (lines 21-32)

**Impact:** Systems grant XP to a skill that doesn't exist, causing silent failures.

### 2. Smithing Skill Not in Database Schema

**File:** `packages/server/src/database/migrations/0000_numerous_korvac.sql`

**Missing columns:**
- `smithingLevel`
- `smithingXp`

**Impact:** Skill progress cannot persist across sessions.

### 3. Smithing Skill Not Initialized for Players

**Files affected:**
- `packages/shared/src/entities/player/PlayerEntity.ts` (lines 110-124) - Default skills missing smithing
- `packages/shared/src/systems/shared/character/SkillsSystem.ts` - No SMITHING constant, not in skill arrays

**Impact:** Players have no smithing skill data.

### 4. Smithing Skill Not in UI Skills Panel

**File:** `packages/client/src/game/panels/SkillsPanel.tsx` (lines 275-340)

**Issue:** Hardcoded list of 9 skills, smithing not included.

**Impact:** Players cannot see their smithing level/XP.

### 5. No Smelting/Smithing Interface Panels

**Missing components:**
- `SmeltingPanel.tsx` - UI to show available bars when furnace clicked
- `SmithingPanel.tsx` - UI to show available items when anvil clicked

**Events emitted but not handled:**
- `SMELTING_INTERFACE_OPEN` - Emitted at SmeltingSystem.ts:147
- `SMITHING_INTERFACE_OPEN` - Emitted at SmithingSystem.ts:161

**Impact:** Clicking furnace/anvil does nothing visible.

### 6. Mining Skill XP for Ores Not Tested

**Note:** The ore spawns exist, but need to verify mining XP grants correctly for iron/coal/mithril (higher level ores).

---

## Implementation Plan

### Phase 1: Add Smithing Skill to Type System

**Priority: Critical (blocks everything else)**

1. **Update Skills interface** (`entity-types.ts`)
   - Add `smithing: SkillData` to Skills interface

2. **Update StatsComponent** (`StatsComponent.ts`)
   - Add `smithing: SkillData` property
   - Add to constructor initialization
   - Add to `serialize()` method
   - Add to `deserialize()` method

3. **Update SkillsSystem** (`SkillsSystem.ts`)
   - Add `SMITHING` constant
   - Add to `GATHERING_SKILLS` or create `ARTISAN_SKILLS` array
   - Add to `getTotalLevel()` skill list
   - Add to `getTotalXP()` skill list

4. **Update PlayerEntity** (`PlayerEntity.ts`)
   - Add `smithing: { level: 1, xp: 0 }` to default skills

### Phase 2: Database Migration

**Priority: Critical (blocks persistence)**

1. **Create new migration** (e.g., `0005_add_smithing_skill.sql`)
   ```sql
   ALTER TABLE characters ADD COLUMN smithingLevel INTEGER DEFAULT 1;
   ALTER TABLE characters ADD COLUMN smithingXp REAL DEFAULT 0;
   ```

2. **Update character save/load queries**
   - Ensure smithing level/XP saved on logout
   - Ensure smithing level/XP loaded on login

### Phase 3: Skills Panel UI Update

**Priority: High (player visibility)**

1. **Update SkillsPanel.tsx**
   - Add smithing to the skills grid (now 10 skills - may need layout adjustment)
   - Add smithing icon/color

### Phase 4: Smelting Interface Panel

**Priority: High (core functionality)**

1. **Create SmeltingPanel.tsx**
   - Listen for `SMELTING_INTERFACE_OPEN` event
   - Display available bars from `availableBars` payload
   - Show requirements (ores, coal, level)
   - Allow quantity selection
   - Send `PROCESSING_SMELTING_REQUEST` when player selects bar

2. **Register panel in UI system**
   - Add to panel registry
   - Handle open/close states

### Phase 5: Smithing Interface Panel

**Priority: High (core functionality)**

1. **Create SmithingPanel.tsx**
   - Listen for `SMITHING_INTERFACE_OPEN` event
   - Display available recipes from `availableRecipes` payload
   - Show requirements (bars, level)
   - Allow quantity selection
   - Send `PROCESSING_SMITHING_REQUEST` when player selects item

2. **Register panel in UI system**
   - Add to panel registry
   - Handle open/close states

### Phase 6: Testing & Polish

**Priority: Medium**

1. **End-to-end testing**
   - Mine ore → Smelt at furnace → Smith at anvil
   - Verify XP grants correctly
   - Verify level ups work
   - Verify skill persists across logout/login

2. **OSRS accuracy check**
   - Iron ore 50% success rate
   - Correct XP values
   - Correct level requirements
   - Hammer requirement for smithing (not consumed)

---

## File Reference Summary

| Category | File | Lines | Status |
|----------|------|-------|--------|
| Skills Type | `shared/src/types/entities/entity-types.ts` | Skills interface | Missing smithing |
| Stats Component | `shared/src/components/StatsComponent.ts` | 21-32, 131-156 | Missing smithing |
| Skills System | `shared/src/systems/shared/character/SkillsSystem.ts` | 46-57, 344-380 | Missing smithing |
| Player Entity | `shared/src/entities/player/PlayerEntity.ts` | 110-124 | Missing smithing |
| Database | `server/src/database/migrations/*.sql` | schema | Missing columns |
| Skills Panel | `client/src/game/panels/SkillsPanel.tsx` | 275-340 | Missing smithing |
| Smelting Panel | `client/src/game/panels/SmeltingPanel.tsx` | N/A | **DOES NOT EXIST** |
| Smithing Panel | `client/src/game/panels/SmithingPanel.tsx` | N/A | **DOES NOT EXIST** |

---

## Estimated Effort

| Phase | Description | Complexity |
|-------|-------------|------------|
| Phase 1 | Add smithing to type system | Low |
| Phase 2 | Database migration | Low |
| Phase 3 | Skills panel update | Low |
| Phase 4 | Smelting interface panel | Medium |
| Phase 5 | Smithing interface panel | Medium |
| Phase 6 | Testing & polish | Medium |

---

## Dependencies

```
Phase 1 (Type System)
    ↓
Phase 2 (Database) ←── Can run in parallel with Phase 3
    ↓
Phase 3 (Skills Panel)
    ↓
Phase 4 (Smelting Panel) ←── Can run in parallel with Phase 5
Phase 5 (Smithing Panel)
    ↓
Phase 6 (Testing)
```

---

## Notes

- The smelting/smithing systems are well-designed but emit events that nothing listens to
- Pattern should follow existing panels (BankPanel, InventoryPanel) for consistency
- Consider whether smithing should be grouped with mining in UI (both relate to metal)
- OSRS puts Smithing in the "Artisan" category along with Cooking, Firemaking, Fletching, etc.
