# Fletching Skill Implementation Plan

## Overview

Fletching is an artisan skill that allows players to craft ranged weapons (bows) and ammunition (arrows). In OSRS, fletching is a knife-based skill — the player uses a knife on logs to cut bow staves and arrow shafts, then strings bows with bowstrings and tips arrows with arrowheads.

This plan covers what to implement for Hyperscape based on what items and systems already exist in the game, following OSRS mechanics as closely as practical.

---

## Current State of the Codebase

### Items That Already Exist

| Category | Items | Notes |
|----------|-------|-------|
| **Logs** | `logs`, `oak_logs`, `willow_logs`, `teak_logs`, `maple_logs`, `mahogany_logs`, `yew_logs`, `magic_logs` | All 8 log tiers present |
| **Finished Bows** | `shortbow`, `oak_shortbow`, `willow_shortbow`, `maple_shortbow` | Shortbows only, up to maple. No longbows. No yew/magic bows |
| **Finished Arrows** | `bronze_arrow`, `iron_arrow`, `steel_arrow`, `mithril_arrow`, `adamant_arrow` | 5 tiers. No rune arrows |
| **Feathers** | `feathers` | Stackable (10,000), already used for fishing. Dual-purpose in OSRS too |
| **Metal Bars** | `bronze_bar` through `rune_bar` | All 6 tiers (used for smithing arrowtips) |
| **Tools** | `needle`, `chisel`, `hammer`, `tinderbox` | **No knife exists** |

### Items That Do NOT Exist (Need to Create)

- Knife (tool)
- Arrow shafts (stackable resource)
- Headless arrows (stackable resource)
- Bowstring (stackable resource)
- Arrowtips (bronze through adamant — stackable resources, one per metal tier)
- Unstrung bows (shortbow_u, longbow_u, etc.)
- Longbows (all tiers)
- Yew shortbow, magic shortbow (higher-tier finished bows)

### Systems That Already Exist

- **CraftingSystem** — Tick-based processing with `knife` as a tool, Make-X quantity selection, movement/combat cancellation, `ProcessingDataProvider` manifest-driven recipes. **Fletching can reuse this entire system** by adding `"knife"` as a tool in the crafting recipes.
- **SmithingSystem** — Anvil-based smithing. Arrowtip recipes would go here.
- **SkillsSystem** — XP granting, level-up events, DB persistence. Just needs `FLETCHING` constant added.
- **InventoryInteractionSystem** — Already handles `needle` and `chisel` tool detection. Adding `knife` follows the same pattern.

### Skills That Exist

15 skills: attack, strength, defense, constitution, ranged, magic, prayer, woodcutting, mining, fishing, firemaking, cooking, smithing, agility, crafting.

**Fletching does not exist yet** — needs to be added to `Skills` interface, `Skill` constant, `PlayerEntity`, DB schema, and `SkillsSystem` skill lists.

---

## OSRS Fletching Mechanics Reference

### How Fletching Works in OSRS

1. **Use knife on logs** → opens Make-X interface showing available items (arrow shafts, shortbow (u), longbow (u))
2. Player selects what to make and quantity
3. Character crafts one item per 3 game ticks (1.8s) for bows, or instant for arrow shafts
4. **Use bowstring on unstrung bow** → strings the bow (2 ticks per bow)
5. **Use feathers on arrow shafts** → makes headless arrows (15 per action, instant)
6. **Use arrowtips on headless arrows** → makes finished arrows (15 per action, instant)

### Arrow Shaft Yields Per Log Type (OSRS-Accurate)

| Log | Fletching Level | Shafts Per Log | XP Per Log |
|-----|-----------------|----------------|------------|
| Logs | 1 | 15 | 5 |
| Oak logs | 15 | 30 | 10 |
| Willow logs | 30 | 45 | 15 |
| Maple logs | 45 | 60 | 20 |
| Yew logs | 60 | 75 | 25 |
| Magic logs | 75 | 90 | 30 |

### Unstrung Bows (Knife + Logs)

| Item | Fletching Level | XP | Log Required |
|------|-----------------|-----|-------------|
| Shortbow (u) | 5 | 5 | Logs |
| Longbow (u) | 10 | 10 | Logs |
| Oak shortbow (u) | 20 | 16.5 | Oak logs |
| Oak longbow (u) | 25 | 25 | Oak logs |
| Willow shortbow (u) | 35 | 33.3 | Willow logs |
| Willow longbow (u) | 40 | 41.5 | Willow logs |
| Maple shortbow (u) | 50 | 50 | Maple logs |
| Maple longbow (u) | 55 | 58.3 | Maple logs |
| Yew shortbow (u) | 65 | 67.5 | Yew logs |
| Yew longbow (u) | 70 | 75 | Yew logs |
| Magic shortbow (u) | 80 | 83.3 | Magic logs |
| Magic longbow (u) | 85 | 91.5 | Magic logs |

### Stringing Bows (Bowstring + Unstrung Bow)

Same XP as cutting. Stringing a shortbow (u) at level 5 gives 5 XP, stringing a magic longbow (u) at 85 gives 91.5 XP. Stringing is 2 ticks per action.

### Finished Arrows (Arrowtips + Headless Arrows)

| Arrow | Fletching Level | XP Per Arrow | Made Per Action |
|-------|-----------------|--------------|-----------------|
| Bronze arrow | 1 | 1.3 | 15 |
| Iron arrow | 15 | 2.5 | 15 |
| Steel arrow | 30 | 5 | 15 |
| Mithril arrow | 45 | 7.5 | 15 |
| Adamant arrow | 60 | 10 | 15 |

### Headless Arrows (Arrow Shafts + Feathers)

- Level 1, 1 XP per arrow, 15 per action

---

## Scope Decision: What to Include

### Include (Phase 1 — Core Fletching)

These cover the core fletching loop and connect to existing game systems:

1. **Arrow shafts** — Knife + logs → arrow shafts (all log tiers)
2. **Headless arrows** — Arrow shafts + feathers → headless arrows
3. **Finished arrows** — Arrowtips + headless arrows → finished arrows (bronze through adamant)
4. **Unstrung bows** — Knife + logs → shortbow (u), longbow (u) for each wood tier
5. **Strung bows** — Bowstring + unstrung bow → finished bow
6. **Arrowtips via smithing** — Add arrowtip recipes to smithing.json (smith bar → arrowtips)

### Exclude (Future Work)

These don't connect to existing game items/systems and would add significant item bloat:

- **Crossbow stocks, limbs, and assembled crossbows** — No crossbow weapon type exists in the game yet. Teak and mahogany logs are used exclusively for crossbow stocks in OSRS, so despite those logs existing in the game, they get no fletching recipes.
- **Bolts** — No crossbow to fire them from
- **Darts** — No dart weapon type or throwing mechanic
- **Javelins** — No javelin weapon type
- **Shields** — Fletching shields is niche even in OSRS

---

## New Items Required

### Tools

```
knife — Tool for fletching. Used on logs to make bows/shafts. Not consumed.
```

### Stackable Resources

```
arrow_shaft        — Stackable (10,000). Made from logs with a knife.
headless_arrow     — Stackable (10,000). Arrow shaft + feather.
bowstring           — Stackable (10,000). Obtained from spinning flax or purchased from shops.
                     (No flax/spinning wheel in game yet — see "Bowstring Source" section below)
```

### Arrowtips (Stackable, Made via Smithing)

```
bronze_arrowtips   — 15 per bar. Smithing level 5, 12.5 XP per bar.
iron_arrowtips     — 15 per bar. Smithing level 20, 25 XP per bar.
steel_arrowtips    — 15 per bar. Smithing level 35, 37.5 XP per bar.
mithril_arrowtips  — 15 per bar. Smithing level 55, 50 XP per bar.
adamant_arrowtips  — 15 per bar. Smithing level 75, 62.5 XP per bar.
```

### Unstrung Bows (Non-Stackable)

```
shortbow_u           — Fletching 5
longbow_u            — Fletching 10
oak_shortbow_u       — Fletching 20
oak_longbow_u        — Fletching 25
willow_shortbow_u    — Fletching 35
willow_longbow_u     — Fletching 40
maple_shortbow_u     — Fletching 50
maple_longbow_u      — Fletching 55
yew_shortbow_u       — Fletching 65
yew_longbow_u        — Fletching 70
magic_shortbow_u     — Fletching 80
magic_longbow_u      — Fletching 85
```

### Finished Bows (Longbows + Missing Higher-Tier Shortbows)

The game already has shortbow through maple_shortbow. Need to add:

```
longbow              — Ranged level 1, attackRanged: 8, range 9
oak_longbow          — Ranged level 5, attackRanged: 14, range 9
willow_longbow       — Ranged level 20, attackRanged: 20, range 9
maple_longbow        — Ranged level 30, attackRanged: 29, range 9
yew_shortbow         — Ranged level 40, attackRanged: 47, range 7
yew_longbow          — Ranged level 40, attackRanged: 47, range 9
magic_shortbow       — Ranged level 50, attackRanged: 69, range 7
magic_longbow        — Ranged level 50, attackRanged: 69, range 9
```

Longbows differ from shortbows: **slower attack speed (6 vs 4 ticks) but longer range (9 vs 7 tiles)**. This matches OSRS where shortbows are faster but longbows reach farther.

### Rune Arrows

```
rune_arrowtips     — 15 per bar. Smithing level 90, 75 XP per bar.
rune_arrow         — Ranged level 40, rangedStrength: 49
```

**Total new items: ~30** (1 tool + 3 resources + 6 arrowtip types + 12 unstrung bows + 8 finished bows/arrows)

---

## Bowstring Source

In OSRS, bowstrings come from spinning flax on a spinning wheel (Crafting skill, level 10, 15 Crafting XP). The game currently has no flax, spinning wheel, or spinning mechanic.

**Recommended approach:** Add bowstrings as a **shop-purchasable item** and/or a **monster drop** for now. This unblocks the entire fletching skill without requiring a spinning wheel system. A spinning wheel can be added later as part of a broader Crafting expansion (also needed for wool → ball of wool, etc.).

Alternatively, the tanner NPC could also sell bowstrings (thematic — the tanner deals in hides and fibers).

---

## Recipe Manifest Design

Fletching will use the **existing CraftingSystem** with `"knife"` as the tool. All recipes go in a new `recipes/fletching.json` manifest file (not in crafting.json — separate manifest for separate skill, following how smithing.json is separate from smelting.json).

### Fletching Manifest Structure

The fletching manifest needs a new structure because it has a unique mechanic: **one log type can produce multiple different items** (arrow shafts, shortbow (u), or longbow (u)). The knife + log interaction should open a panel showing all three options.

```json
{
  "recipes": [
    {
      "output": "arrow_shaft",
      "outputQuantity": 15,
      "category": "arrow_shafts",
      "inputs": [{ "item": "logs", "amount": 1 }],
      "tools": ["knife"],
      "level": 1,
      "xp": 5,
      "ticks": 3,
      "skill": "fletching"
    },
    {
      "output": "shortbow_u",
      "outputQuantity": 1,
      "category": "shortbows",
      "inputs": [{ "item": "logs", "amount": 1 }],
      "tools": ["knife"],
      "level": 5,
      "xp": 5,
      "ticks": 3,
      "skill": "fletching"
    },
    {
      "output": "longbow_u",
      "outputQuantity": 1,
      "category": "longbows",
      "inputs": [{ "item": "logs", "amount": 1 }],
      "tools": ["knife"],
      "level": 10,
      "xp": 10,
      "ticks": 3,
      "skill": "fletching"
    }
  ]
}
```

### Key Difference from Crafting Recipes

1. **`outputQuantity`** — Arrow shafts produce 15 per log, not 1. The existing CraftingSystem always produces 1 output item. This field is new.
2. **`skill`** — Fletching recipes grant fletching XP, not crafting XP. The CraftingSystem currently hardcodes `Skill.CRAFTING`. This needs to become configurable per recipe.
3. **Stringing recipes** use bowstring as an input (not a tool), and the unstrung bow as the other input. No tool required — just `bowstring + shortbow_u → shortbow`.
4. **Arrow assembly** — `headless_arrow + bronze_arrowtips → bronze_arrow`. Also no tool. These are "instant" in OSRS (no tick delay), but for simplicity we can use `ticks: 1`.

---

## System Changes Required

### 1. Add Fletching Skill to the Game

**Files to modify:**

| File | Change |
|------|--------|
| `packages/shared/src/types/entities/entity-types.ts` | Add `fletching: SkillData` to `Skills` interface |
| `packages/shared/src/systems/shared/character/SkillsSystem.ts` | Add `FLETCHING: "fletching"` to `Skill` constant. Add to all 3 skill list arrays |
| `packages/shared/src/entities/player/PlayerEntity.ts` | Add `fletching: playerData.skills.fletching \|\| defaultSkill` to skills init |
| `packages/server/src/database/schema.ts` | Add `fletchingLevel` and `fletchingXp` integer columns |
| `packages/server/src/database/migrations/0030_add_fletching_skill.sql` | Migration: `ALTER TABLE characters ADD COLUMN "fletchingLevel" integer DEFAULT 1; ALTER TABLE characters ADD COLUMN "fletchingXp" integer DEFAULT 0;` |
| `packages/server/src/systems/ServerNetwork/event-bridge.ts` | Add `fletching` to the skill name → DB column mapping (if not already generic) |

### 2. Add Knife Tool Item

**File:** `packages/server/world/assets/manifests/items/tools.json`

```json
{
  "id": "knife",
  "name": "Knife",
  "type": "tool",
  "value": 10,
  "weight": 0.1,
  "description": "A small knife for fletching bows and cutting arrow shafts",
  "examine": "A handy little knife. Used in fletching.",
  "tradeable": true,
  "rarity": "common",
  "modelPath": null,
  "iconPath": "asset://icons/knife.png",
  "inventoryActions": ["Use", "Drop", "Examine"]
}
```

### 3. Add All New Items to Manifests

**Files to modify:**

| Manifest File | Items to Add |
|---------------|-------------|
| `items/resources.json` | `arrow_shaft`, `headless_arrow`, `bowstring`, `bronze_arrowtips`, `iron_arrowtips`, `steel_arrowtips`, `mithril_arrowtips`, `adamant_arrowtips`, `rune_arrowtips` |
| `items/weapons.json` | 12 unstrung bows, `yew_shortbow`, `yew_longbow`, `magic_shortbow`, `magic_longbow`, `longbow`, `oak_longbow`, `willow_longbow`, `maple_longbow` |
| `items/ammunition.json` | `rune_arrow` |

### 4. Add Arrowtip Smithing Recipes

**File:** `packages/server/world/assets/manifests/recipes/smithing.json`

Add arrowtip recipes (OSRS-accurate). Each bar produces 15 arrowtips:

| Output | Bar | Level | XP | Category |
|--------|-----|-------|----|----------|
| `bronze_arrowtips` | `bronze_bar` | 5 | 12.5 | arrowtips |
| `iron_arrowtips` | `iron_bar` | 20 | 25 | arrowtips |
| `steel_arrowtips` | `steel_bar` | 35 | 37.5 | arrowtips |
| `mithril_arrowtips` | `mithril_bar` | 55 | 50 | arrowtips |
| `adamant_arrowtips` | `adamant_bar` | 75 | 62.5 | arrowtips |
| `rune_arrowtips` | `rune_bar` | 90 | 75 | arrowtips |

**Note:** Smithing already produces 1 output per recipe. Arrowtips produce 15 per bar in OSRS. This means the SmithingSystem also needs an `outputQuantity` field, or arrowtip "amount" is baked into the item definition (1 arrowtip item = 15 tips, used to make 15 arrows). The simpler approach: **treat arrowtips as stackable items where 1 bar → 15 individual arrowtip items added to inventory.** This requires smithing to support multi-output too.

### 5. Create Fletching Recipe Manifest

**New file:** `packages/server/world/assets/manifests/recipes/fletching.json`

Contains all fletching recipes organized by category:
- `arrow_shafts` — knife + logs → arrow shafts (6 recipes, one per log tier)
- `headless_arrows` — arrow shafts + feathers → headless arrows (1 recipe)
- `shortbows` — knife + logs → shortbow (u) (6 recipes)
- `longbows` — knife + logs → longbow (u) (6 recipes)
- `stringing` — bowstring + unstrung bow → finished bow (12 recipes)
- `arrows` — arrowtips + headless arrows → finished arrows (5-6 recipes)

**Total: ~37 recipes**

### 6. Extend ProcessingDataProvider for Fletching

**File:** `packages/shared/src/data/ProcessingDataProvider.ts`

Add:
- `FletchingRecipeManifest` interface (with `outputQuantity` and `skill` fields)
- `FletchingManifest` interface
- `fletchingManifest` property
- `buildFletchingDataFromManifest()` method (with validation matching crafting)
- Lookup maps: `fletchingRecipeMap`, `fletchingRecipesByCategory`, `fletchingInputsByTool`
- Accessor methods: `getFletchingRecipe()`, `getFletchingRecipesByStation()`, `getFletchingInputsForTool()`, `isFletchingInput()`

### 7. Create FletchingSystem

**File:** `packages/shared/src/systems/shared/interaction/FletchingSystem.ts`

**Extends `SystemBase` directly** (like CraftingSystem and SmeltingSystem), NOT `ProcessingSystemBase` (which is fire-specific — cooking/firemaking).

Key differences from CraftingSystem:
- Uses `Skill.FLETCHING` for XP grants
- Supports `outputQuantity` for multi-output recipes (arrow shafts → 15 per log, arrows → 15 per action)
- No consumable tracking needed (fletching has no thread-like consumables)
- Must check for cross-system session conflicts (see "Concurrent Session Prevention" below)

Follows the established pattern: SmithingSystem, SmeltingSystem, CookingSystem are all separate systems despite similar session/tick structures. This avoids regression risk on the existing CraftingSystem.

**Required internals (matching crafting audit standards):**
- `FletchingSession` interface with `playerId`, `recipeId`, `quantity`, `crafted`, `completionTick`, `outputQuantity`
- `activeSessions: Map<string, FletchingSession>`
- `lastProcessedTick` guard to prevent duplicate processing
- `fletchCounter` monotonic counter for collision-free item IDs
- `completedPlayerIds: string[]` reusable array (avoid per-tick allocation)
- `getInventoryState()` → single inventory scan per tick passed to all checks
- Movement cancellation via `MOVEMENT_CLICK_TO_MOVE` subscription
- Combat cancellation via `COMBAT_STARTED` subscription
- Structured audit logging on completion via `Logger`

### 8. Add Knife to InventoryInteractionSystem

**File:** `packages/shared/src/systems/shared/interaction/InventoryInteractionSystem.ts`

In `handleTargetSelected()`, add knife detection alongside needle/chisel:

```
- If sourceItemId is "knife" or target is a fletching input → triggerType = "knife"
- Send "fletchingSourceInteract" packet with { triggerType: "knife", inputItemId }
```

### 9. Add Server Network Handler

**File:** `packages/server/src/systems/ServerNetwork/index.ts`

Add `onFletchingSourceInteract` handler:
- Rate limit with `canProcessRequest()`
- Validate `inputItemId`
- Emit `EventType.FLETCHING_INTERACT`

### 10. Create FletchingPanel UI

**File:** `packages/client/src/game/panels/FletchingPanel.tsx`

Nearly identical to CraftingPanel. Shows:
- When knife + log: "Arrow shafts (15)", "Shortbow (u)", "Longbow (u)" grouped by what the specific log can make
- When bowstring + unstrung bow: auto-selects the single stringing recipe → quantity prompt
- When arrowtips + headless arrows: auto-selects → quantity prompt

### 11. Add Event Types

**File:** `packages/shared/src/types/events/event-types.ts`

```
FLETCHING_INTERACT
FLETCHING_INTERFACE_OPEN
FLETCHING_START
FLETCHING_COMPLETE
FLETCHING_CANCEL
```

### 12. Wire Up InterfaceModals

**File:** `packages/client/src/game/interface/InterfaceModals.tsx`

Add FletchingPanel rendering when `FLETCHING_INTERFACE_OPEN` event fires, matching how CraftingPanel is wired up.

---

## Complete Recipe Tables

### Arrow Shaft Recipes (Knife + Logs)

| Output | Input | Qty Out | Level | XP | Ticks |
|--------|-------|---------|-------|----|-------|
| arrow_shaft (×15) | logs (×1) | 15 | 1 | 5 | 3 |
| arrow_shaft (×30) | oak_logs (×1) | 30 | 15 | 10 | 3 |
| arrow_shaft (×45) | willow_logs (×1) | 45 | 30 | 15 | 3 |
| arrow_shaft (×60) | maple_logs (×1) | 60 | 45 | 20 | 3 |
| arrow_shaft (×75) | yew_logs (×1) | 75 | 60 | 25 | 3 |
| arrow_shaft (×90) | magic_logs (×1) | 90 | 75 | 30 | 3 |

### Headless Arrow Recipe

| Output | Inputs | Qty Out | Level | XP | Ticks |
|--------|--------|---------|-------|----|-------|
| headless_arrow (×15) | arrow_shaft (×15) + feathers (×15) | 15 | 1 | 15 | 1 |

### Unstrung Bow Recipes (Knife + Logs)

| Output | Input | Level | XP | Ticks |
|--------|-------|-------|----|-------|
| shortbow_u | logs (×1) | 5 | 5 | 3 |
| longbow_u | logs (×1) | 10 | 10 | 3 |
| oak_shortbow_u | oak_logs (×1) | 20 | 16.5 | 3 |
| oak_longbow_u | oak_logs (×1) | 25 | 25 | 3 |
| willow_shortbow_u | willow_logs (×1) | 35 | 33.3 | 3 |
| willow_longbow_u | willow_logs (×1) | 40 | 41.5 | 3 |
| maple_shortbow_u | maple_logs (×1) | 50 | 50 | 3 |
| maple_longbow_u | maple_logs (×1) | 55 | 58.3 | 3 |
| yew_shortbow_u | yew_logs (×1) | 65 | 67.5 | 3 |
| yew_longbow_u | yew_logs (×1) | 70 | 75 | 3 |
| magic_shortbow_u | magic_logs (×1) | 80 | 83.3 | 3 |
| magic_longbow_u | magic_logs (×1) | 85 | 91.5 | 3 |

### Bow Stringing Recipes (Bowstring + Unstrung Bow)

| Output | Inputs | Level | XP | Ticks |
|--------|--------|-------|----|-------|
| shortbow | bowstring (×1) + shortbow_u (×1) | 5 | 5 | 2 |
| longbow | bowstring (×1) + longbow_u (×1) | 10 | 10 | 2 |
| oak_shortbow | bowstring (×1) + oak_shortbow_u (×1) | 20 | 16.5 | 2 |
| oak_longbow | bowstring (×1) + oak_longbow_u (×1) | 25 | 25 | 2 |
| willow_shortbow | bowstring (×1) + willow_shortbow_u (×1) | 35 | 33.3 | 2 |
| willow_longbow | bowstring (×1) + willow_longbow_u (×1) | 40 | 41.5 | 2 |
| maple_shortbow | bowstring (×1) + maple_shortbow_u (×1) | 50 | 50 | 2 |
| maple_longbow | bowstring (×1) + maple_longbow_u (×1) | 55 | 58.3 | 2 |
| yew_shortbow | bowstring (×1) + yew_shortbow_u (×1) | 65 | 67.5 | 2 |
| yew_longbow | bowstring (×1) + yew_longbow_u (×1) | 70 | 75 | 2 |
| magic_shortbow | bowstring (×1) + magic_shortbow_u (×1) | 80 | 83.3 | 2 |
| magic_longbow | bowstring (×1) + magic_longbow_u (×1) | 85 | 91.5 | 2 |

### Arrow Tipping Recipes (Arrowtips + Headless Arrows)

| Output | Inputs | Qty Out | Level | XP/arrow | Ticks |
|--------|--------|---------|-------|----------|-------|
| bronze_arrow (×15) | bronze_arrowtips (×15) + headless_arrow (×15) | 15 | 1 | 1.3 | 1 |
| iron_arrow (×15) | iron_arrowtips (×15) + headless_arrow (×15) | 15 | 15 | 2.5 | 1 |
| steel_arrow (×15) | steel_arrowtips (×15) + headless_arrow (×15) | 15 | 30 | 5 | 1 |
| mithril_arrow (×15) | mithril_arrowtips (×15) + headless_arrow (×15) | 15 | 45 | 7.5 | 1 |
| adamant_arrow (×15) | adamant_arrowtips (×15) + headless_arrow (×15) | 15 | 60 | 10 | 1 |
| rune_arrow (×15) | rune_arrowtips (×15) + headless_arrow (×15) | 15 | 75 | 12.5 | 1 |

### Arrowtip Smithing Recipes (Added to smithing.json)

| Output | Bar | Qty Out | Smithing Level | Smithing XP | Ticks |
|--------|-----|---------|----------------|-------------|-------|
| bronze_arrowtips (×15) | bronze_bar (×1) | 15 | 5 | 12.5 | 4 |
| iron_arrowtips (×15) | iron_bar (×1) | 15 | 20 | 25 | 4 |
| steel_arrowtips (×15) | steel_bar (×1) | 15 | 35 | 37.5 | 4 |
| mithril_arrowtips (×15) | mithril_bar (×1) | 15 | 55 | 50 | 4 |
| adamant_arrowtips (×15) | adamant_bar (×1) | 15 | 75 | 62.5 | 4 |
| rune_arrowtips (×15) | rune_bar (×1) | 15 | 90 | 75 | 4 |

---

## Implementation Phases

### Phase 1: Skill Foundation
- Add `fletching: SkillData` to `Skills` interface in `entity-types.ts`
- Add `FLETCHING: "fletching"` to `Skill` constant in `SkillsSystem.ts`
- Add `Skill.FLETCHING` to all 3 skill list arrays in `SkillsSystem.ts`
- Add `fletching: playerData.skills.fletching || defaultSkill` to `PlayerEntity.ts`
- Create database migration `0030_add_fletching_skill.sql`
- Add fletching to event-bridge.ts DB save mapping
- Build shared + server, verify

### Phase 2: New Items
- Add `knife` to `items/tools.json`
- Add `arrow_shaft`, `headless_arrow`, `bowstring` to `items/resources.json` (all stackable, maxStackSize 10000)
- Add 6 arrowtip items to `items/resources.json` (bronze through rune, all stackable)
- Add 12 unstrung bow items to `items/weapons.json` (type "resource", non-equippable intermediate items)
- Add 8 finished bow items to `items/weapons.json` (4 longbows + yew/magic short+longbows, with correct attackSpeed/attackRange)
- Add `rune_arrow` to `items/ammunition.json`
- Build and verify all items load via `ProcessingDataProvider` initialization log

### Phase 3: Fletching Recipes & Data Provider
- Create `recipes/fletching.json` with all ~37 recipes (arrow shafts, headless, unstrung bows, stringing, arrow tipping)
- Add `FletchingRecipeManifest` interface (with `outputQuantity`, `skill` fields) to `ProcessingDataProvider.ts`
- Add `FletchingManifest` interface
- Implement `buildFletchingDataFromManifest()` with full validation (level 1-99, xp > 0, ticks > 0, outputQuantity >= 1, all item IDs in ITEMS, etc.)
- Add lookup maps: `fletchingRecipeMap`, `fletchingRecipesByCategory`, `fletchingInputsByTool`, `allFletchingInputIds`
- Add accessor methods: `getFletchingRecipe()`, `getFletchingRecipesByStation()`, `getFletchingInputsForTool()`, `isFletchingInput()`, `getFletchingToolForInput()`
- Build and verify

### Phase 4: FletchingSystem & Networking
- Add FLETCHING event types to `event-types.ts` and payloads to `event-payloads.ts`
- Create `FletchingSystem.ts` extending `SystemBase` (like CraftingSystem)
- Implement `FletchingSession` with `outputQuantity` support
- Implement `handleFletchingInteract` — filter recipes by inputItemId (and optional secondaryItemId)
- Implement `startFletching`, `completeFletching`, `scheduleNextFletch`, `cancelFletching`
- Multi-output: loop `outputQuantity` times in `completeFletching` to add items
- Inventory overflow check before adding items
- Monotonic `fletchCounter` for collision-free item IDs
- `getInventoryState()` consolidated inventory scan
- `lastProcessedTick` dedup, `completedPlayerIds` reusable array
- Subscribe to `MOVEMENT_CLICK_TO_MOVE` and `COMBAT_STARTED` for cancellation
- Cross-system concurrent session check (`hasActiveSession()` on crafting/cooking/smithing/smelting)
- Structured audit logging via Logger on completion
- Register system in world initialization
- Build and verify

### Phase 5: Server Network & Interaction Wiring
- Add `onFletchingSourceInteract` handler in `ServerNetwork/index.ts`
  - `canProcessRequest()` rate limiting
  - Validate `inputItemId` (string, max 64 chars)
  - Validate optional `secondaryItemId`
  - Validate `quantity` (finite number, -1 → 10000, otherwise clamp [1, 10000])
  - Emit `EventType.FLETCHING_INTERACT`
- Add knife tool detection in `InventoryInteractionSystem.handleTargetSelected()`
  - Knife + log → `fletchingSourceInteract` with `{ triggerType: "knife", inputItemId }`
- Add item-on-item detection for no-tool recipes:
  - Both items are fletching inputs → find matching recipe(s)
  - `bowstring + shortbow_u` → `fletchingSourceInteract` with `{ triggerType: "item_on_item", inputItemId, secondaryItemId }`
  - `arrowtips + headless_arrow` → same pattern
- Build and verify

### Phase 6: Client UI
- Create `FletchingPanel.tsx` (based on CraftingPanel structure)
  - Category grouping: arrow_shafts, shortbows, longbows, stringing, arrows
  - Display `outputQuantity` in recipe name (e.g., "Arrow shafts (×15)")
  - "All" button sends `-1` quantity
  - Auto-select when single recipe (stringing, tipping cases)
  - Make-X memory in localStorage (`fletching_last_x`)
  - Import `formatItemName` from `@/utils` (no duplication)
- Wire up in `InterfaceModals.tsx` on `FLETCHING_INTERFACE_OPEN` event
- Build client, verify

### Phase 7: Arrowtip Smithing
- Add `outputQuantity` field to `SmithingRecipeManifest` and `SmithingRecipeData` interfaces (default 1)
- Add 6 arrowtip recipes to `smithing.json` (bronze through rune, outputQuantity: 15)
- Update `SmithingSystem.completeSmith()` to loop `outputQuantity` times when adding items
- Update `SmithingPanel.tsx` to display `×15` for arrowtip recipes
- Add "arrowtips" to smithing `CATEGORY_ORDER` display list
- Build and verify

### Phase 8: Testing
- Create `FletchingSystem.test.ts` following `CraftingSystem.test.ts` patterns
- **20+ unit tests** covering:
  - `handleFletchingInteract`: recipe filtering by inputItemId, item-on-item filtering, invalid player
  - `startFletching`: level check, material check, tool check, concurrent session rejection
  - `completeFletching`: input removal, output addition (single and multi-output), XP grant, next scheduling, material exhaustion
  - Cancellation: movement, combat (attacker + target), disconnect
  - Edge cases: inventory overflow, "All" sentinel, monotonic counter uniqueness
- Run full test suite, verify no regressions

---

## Resolved Design Decisions

### 1. Bowstring Source
**Decision:** Shop-purchasable item and monster drop table entry. The tanner NPC sells bowstrings (thematic — deals in hides and fibers). No flax/spinning wheel needed for now. Spinning wheel can be added later as a Crafting expansion.

### 2. Longbow Attack Speed
**Decision:** Longbows use `attackSpeed: 6` (3.6s), shortbows use `attackSpeed: 4` (2.4s). Longbows get `attackRange: 9`, shortbows get `attackRange: 7`. These values go directly in the weapon manifest entries. No system changes needed — the combat system already reads `attackSpeed` and `attackRange` from item data.

### 3. Item-on-Item Interactions (No Tool)

Stringing bows (`bowstring + shortbow_u`) and tipping arrows (`arrowtips + headless_arrow`) don't involve a tool — both items are consumed as inputs.

**Solution:** Extend `InventoryInteractionSystem.handleTargetSelected()` to check `ProcessingDataProvider` for fletching recipes where both the source and target items appear as inputs (no tool match needed). Concrete logic:

```
In handleTargetSelected(), after existing tool checks (needle, chisel, knife):

1. Check if ProcessingDataProvider.isFletchingInput(sourceItemId) AND
   ProcessingDataProvider.isFletchingInput(targetId)
2. If both are fletching inputs, find recipes where BOTH items appear in the inputs array
3. If exactly one recipe matches → auto-select, send fletchingSourceInteract with { inputItemId: sourceItemId, secondaryItemId: targetId }
4. If multiple recipes match → send both IDs, let FletchingPanel show options
```

This is a new interaction pattern but only adds a few lines to the existing item-on-item handler. The `fletchingSourceInteract` packet gains an optional `secondaryItemId` field for these cases.

### 4. Multi-Output in SmithingSystem (Arrowtips)

**Decision:** Add `outputQuantity` field to `SmithingRecipeManifest` and `SmithingRecipeData`. Default to 1 if absent (backward compatible). The `completeSmith` method loops `outputQuantity` times to add items to inventory, or for stackable items, adds a single stack of that quantity.

This is a ~5 line change to `SmithingSystem.completeSmith()`:
```typescript
const qty = recipe.outputQuantity || 1;
for (let i = 0; i < qty; i++) {
  // emit INVENTORY_ITEM_ADDED for each unit (stackable items auto-stack)
}
```

### 5. Teak and Mahogany Logs
**Decision:** Not used for fletching. In OSRS, teak and mahogany are only used for crossbow stocks (out of scope). The game has these logs for future use, but no fletching recipes reference them.

---

## Security & Input Validation

### Server Network Handler Validation

The `onFletchingSourceInteract` handler must validate all fields from the client packet:

```
- triggerType: must be string, one of "knife" | "item_on_item"
- inputItemId: must be string, max 64 chars, must pass ProcessingDataProvider.isFletchingInput()
- secondaryItemId (optional): must be string if present, max 64 chars
- recipeId: must be string, max 64 chars, must exist in ProcessingDataProvider
- quantity: must be finite number; -1 = "All" (server maps to 10000, natural material exhaustion stops it); otherwise clamped to Math.floor(Math.max(1, Math.min(quantity, 10000)))
```

### Rate Limiting

Apply `canProcessRequest(playerId)` to the `onFletchingSourceInteract` handler, matching the crafting pattern. This prevents packet spam from modified clients.

### Server Authority

- Client sends recipe selection and quantity as a **request** — server validates level, materials, tools
- Server computes `outputQuantity` from recipe data — client cannot influence how many items per action
- All inventory mutations (remove inputs, add outputs, grant XP) happen server-side
- Client FletchingPanel is purely visual — it reads `meetsLevel` and `hasInputs` flags from server response

---

## Economic Integrity

### Unique Item IDs
Monotonic `fletchCounter` on FletchingSystem, combined with `Date.now()`:
```
fletch_${playerId}_${++this.fletchCounter}_${Date.now()}
```
Prevents ID collisions if two fletches complete in the same millisecond.

### XP Rounding at DB Boundary
Float XP values (16.5, 33.3, 58.3, 83.3, 91.5) accumulate correctly in memory. The existing `event-bridge.ts` already applies `Math.round()` at the DB write boundary (added in crafting Phase 5). No additional work needed — fletching XP flows through the same `SKILLS_XP_GAINED` → `event-bridge.ts` path.

### "All" Button Sentinel
Client sends `-1` for "All" quantity. Server maps to `10000`. `scheduleNextFletch` naturally stops when materials run out. Same pattern as crafting and tanning.

### Audit Logging
On each completed fletch, log via `Logger`:
```typescript
Logger.info("fletching_complete", {
  playerId, recipeId, outputId, outputQuantity, xpGranted
});
```

### Inventory Overflow Protection
Before adding `outputQuantity` items to inventory, check available inventory space:
- For stackable items (arrow shafts, arrows, headless arrows, arrowtips): check if existing stack + outputQuantity ≤ maxStackSize, or if a new slot is available
- For non-stackable items (unstrung bows): check for a free inventory slot
- If insufficient space: cancel the current action, send chat message "Not enough inventory space", stop the session

### Non-Atomic Trade-Off
Input removal, output addition, and XP grant happen synchronously in the same tick (single-threaded JS). A crash between events would require SIGKILL mid-function execution. This is the same acceptable trade-off documented in CraftingSystem.

---

## Memory & Performance

### InventoryState Consolidation
Single `getInventoryState(playerId)` call per tick builds both `counts: Map<string, number>` and `itemIds: Set<string>`. Pass this to all check methods (`hasRequiredInputs`, `hasRequiredTools`). Avoids 3-4 redundant inventory scans per tick — same pattern as CraftingSystem Phase 4.

### Reusable Arrays
`completedPlayerIds: string[]` instance array, cleared and reused each tick instead of allocating `Array.from(activeSessions)`. Prevents GC pressure on tick-rate code.

### Tick Deduplication
`lastProcessedTick` guard at top of `update()` prevents duplicate processing if system ticks faster than game ticks.

### No Allocations in Hot Paths
- Recipe lookups use pre-built Maps from `ProcessingDataProvider` (built once at init)
- No `filter()`, `map()`, or spread operators in the tick loop
- String concatenation for item IDs uses template literals (single allocation)

---

## Concurrent Session Prevention

A player must not be simultaneously fletching + crafting + cooking + smithing + smelting. The current systems don't cross-check each other.

**Solution:** Before starting a fletching session, check `world.getSystem('crafting')`, `world.getSystem('smithing')`, etc. for active sessions with the same `playerId`. If any exist, reject with chat message "You're already busy."

This is a lightweight check — just `activeSessions.has(playerId)` on each system. Each processing system should expose a `hasActiveSession(playerId: string): boolean` method.

Alternatively, use a shared `activeProcessingPlayers: Set<string>` on the world or a coordination system. But the per-system check is simpler and doesn't require a new abstraction.

---

## Manifest Validation

`buildFletchingDataFromManifest()` must validate every recipe before loading, matching the crafting manifest validation pattern (Phase 9):

- `output`: non-empty string, exists in ITEMS manifest
- `category`: non-empty string
- `level`: finite number in [1, 99]
- `xp`: finite number > 0
- `ticks`: finite number > 0
- `outputQuantity`: finite number >= 1 (default 1 if absent)
- `inputs`: non-empty array; each entry has valid `item` string existing in ITEMS, `amount` >= 1
- `tools`: array; each tool ID exists in ITEMS (can be empty for no-tool recipes like stringing)
- `skill`: must be `"fletching"`

Invalid recipes are skipped. All errors collected and logged as a single `console.warn` at the end.

---

## Testing Plan

### Unit Tests (FletchingSystem.test.ts)

Following the CraftingSystem.test.ts pattern (19 tests), target **20+ tests** covering:

**handleFletchingInteract (4 tests):**
- Emits FLETCHING_INTERFACE_OPEN with filtered recipes for knife + logs
- Filters recipes by inputItemId (knife + oak_logs shows only oak recipes)
- Filters recipes for item-on-item (bowstring + shortbow_u shows only that stringing recipe)
- Rejects if player entity not found

**startFletching (5 tests):**
- Starts session with correct completionTick
- Rejects if level too low
- Rejects if missing materials
- Rejects if missing tool (knife)
- Rejects if already in a fletching/crafting/processing session (concurrent prevention)

**completeFletching (4 tests):**
- Removes inputs, adds correct output, grants XP
- Multi-output: arrow shafts produce correct quantity (15/30/45/etc.)
- Schedules next action if quantity remaining
- Stops when materials exhausted

**Cancellation (4 tests):**
- Cancels on MOVEMENT_CLICK_TO_MOVE
- Cancels on COMBAT_STARTED (attacker)
- Cancels on COMBAT_STARTED (target)
- Cancels on player disconnect

**Edge cases (3+ tests):**
- Inventory overflow stops session with message
- "All" quantity (-1 → 10000) works correctly
- Unique item IDs use monotonic counter

---

## Sources

- [OSRS Wiki — Fletching](https://oldschool.runescape.wiki/w/Fletching)
- [OSRS Wiki — Fletching Training](https://oldschool.runescape.wiki/w/Fletching_training)
- [OSRS Wiki — Arrow Shaft](https://oldschool.runescape.wiki/w/Arrow_shaft)
- [OSRS Wiki — Bow String](https://oldschool.runescape.wiki/w/Bow_string)
- [VirtGold OSRS Fletching Guide](https://virtgold.com/blog/osrs-1-99-fletching-guide/)
- [OSRSGuide.com Fletching Guide](https://www.osrsguide.com/osrs-fletching-guide/)
