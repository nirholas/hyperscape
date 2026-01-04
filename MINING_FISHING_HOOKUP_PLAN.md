# Mining & Fishing Hookup Plan

**Goal:** Make mining and fishing fully playable in the game by connecting existing systems and adding missing manifest data.

**Status:** The core systems are FULLY IMPLEMENTED. Only manifest data and world spawns are missing.

---

## Current State Analysis

### What's Already Working

| Component | Mining | Fishing | Notes |
|-----------|--------|---------|-------|
| ResourceSystem | ✅ | ✅ | Full OSRS-accurate mechanics |
| GatheringConstants | ✅ | ✅ | Success rates defined |
| Resource Definitions | ✅ ore_copper, ore_tin | ✅ fishing_spot_normal, fishing_spot_fly | In resources.json |
| Tool Definitions | ✅ bronze_pickaxe | ✅ fishing_rod | In tools.json |
| Skill Unlocks | ✅ | ✅ | In skill-unlocks.ts |
| 3D Models | ✅ ore-copper, ore-tin, rocks | ⚠️ No fishing spot model (null) | Models exist |
| Item Definitions | ❌ Missing ores | ❌ Missing fish | Need to add |
| World Spawns | ❌ None | ❌ None | Need to add |

### 3D Models Available

```
packages/server/world/assets/models/
├── ore-copper/copper.glb          # Copper ore rock
├── ore-tin/tin.glb                # Tin ore rock
├── rocks/med_rock_v2.glb          # Depleted rock
├── pickaxe-bronze/                # Bronze pickaxe
├── pickaxe-steel/                 # Steel pickaxe
├── pickaxe-mithril/               # Mithril pickaxe
├── fishing-rod-base/              # Base fishing rod
└── fishing-rod-standard/          # Standard fishing rod
```

---

## Phase 1: Add Missing Items (CRITICAL)

**Priority:** HIGH - Without items, gathering drops fail completely

**Why This Is Critical:**
The InventorySystem validates every item against items.json via `getItem(itemId)`. When gathering succeeds and ResourceSystem emits `INVENTORY_ITEM_ADDED` with `itemId: "copper_ore"`, the InventorySystem will:

```typescript
const itemData = getItem(itemId);
if (!itemData) {
  Logger.systemError("InventorySystem", `Item not found: ${itemId}`);
  return false;  // Item NOT added to inventory!
}
```

**Result:** Players mine rocks, see success message, but get NOTHING in their inventory because the item lookup fails.

### 1.1 Add Ore Items

Add to `packages/server/world/assets/manifests/items.json`:

```json
{
  "id": "copper_ore",
  "name": "Copper Ore",
  "type": "resource",
  "stackable": false,
  "maxStackSize": 100,
  "value": 5,
  "weight": 2,
  "description": "Copper ore that can be smelted into a bronze bar",
  "examine": "Ore containing copper. Can be combined with tin to make bronze.",
  "tradeable": true,
  "rarity": "common",
  "modelPath": null,
  "iconPath": "asset://icons/ore-copper.png"
},
{
  "id": "tin_ore",
  "name": "Tin Ore",
  "type": "resource",
  "stackable": false,
  "maxStackSize": 100,
  "value": 5,
  "weight": 2,
  "description": "Tin ore that can be smelted into a bronze bar",
  "examine": "Ore containing tin. Can be combined with copper to make bronze.",
  "tradeable": true,
  "rarity": "common",
  "modelPath": null,
  "iconPath": "asset://icons/ore-tin.png"
}
```

### 1.2 Add Fish Items

Add to `packages/server/world/assets/manifests/items.json`:

```json
{
  "id": "raw_shrimp",
  "name": "Raw Shrimp",
  "type": "resource",
  "stackable": false,
  "maxStackSize": 100,
  "value": 5,
  "weight": 0.2,
  "description": "A small, raw shrimp",
  "examine": "I should cook this before eating it.",
  "tradeable": true,
  "rarity": "common",
  "modelPath": null,
  "iconPath": "asset://icons/raw-shrimp.png"
},
{
  "id": "raw_anchovies",
  "name": "Raw Anchovies",
  "type": "resource",
  "stackable": false,
  "maxStackSize": 100,
  "value": 10,
  "weight": 0.2,
  "description": "A small, raw anchovy",
  "examine": "I should cook this before eating it.",
  "tradeable": true,
  "rarity": "common",
  "modelPath": null,
  "iconPath": "asset://icons/raw-anchovies.png"
},
{
  "id": "raw_trout",
  "name": "Raw Trout",
  "type": "resource",
  "stackable": false,
  "maxStackSize": 100,
  "value": 20,
  "weight": 0.3,
  "description": "A raw trout",
  "examine": "I should cook this before eating it.",
  "tradeable": true,
  "rarity": "common",
  "modelPath": null,
  "iconPath": "asset://icons/raw-trout.png"
},
{
  "id": "raw_salmon",
  "name": "Raw Salmon",
  "type": "resource",
  "stackable": false,
  "maxStackSize": 100,
  "value": 30,
  "weight": 0.3,
  "description": "A raw salmon",
  "examine": "I should cook this before eating it.",
  "tradeable": true,
  "rarity": "common",
  "modelPath": null,
  "iconPath": "asset://icons/raw-salmon.png"
}
```

### 1.3 Add Fly Fishing Rod (for level 20 spots)

Add to `packages/server/world/assets/manifests/items.json`:

```json
{
  "id": "fly_fishing_rod",
  "name": "Fly Fishing Rod",
  "type": "tool",
  "value": 100,
  "weight": 1,
  "description": "A fly fishing rod for catching trout and salmon",
  "examine": "A specialized rod for fly fishing in rivers.",
  "tradeable": true,
  "rarity": "common",
  "modelPath": "asset://models/fishing-rod-standard/fishing-rod-standard.glb",
  "iconPath": "asset://models/fishing-rod-standard/concept-art.png",
  "requirements": {
    "level": 20,
    "skills": {
      "fishing": 20
    }
  }
}
```

And add to `packages/server/world/assets/manifests/tools.json`:

```json
{
  "itemId": "fly_fishing_rod",
  "skill": "fishing",
  "tier": "fly",
  "levelRequired": 20,
  "priority": 2
}
```

**Note on Tool Priority:**
- Priority 1 = checked first (basic tools)
- Priority 2+ = checked later (advanced tools)
- `getBestTool()` returns the first tool found in priority order
- For fishing, this means fishing_rod (priority 1) is selected over fly_fishing_rod (priority 2) if player has both

**Known Limitation:**
The tool category check is loose - `fly_fishing_rod` matches the "fishing" category and could technically be used at regular spots if the player has the level. For strict OSRS accuracy, we'd need spot-specific tool matching (future enhancement).

### Testing Phase 1

- [ ] Build succeeds with no item lookup errors
- [ ] Items appear in store/spawn commands
- [ ] Items have correct properties (stackable: false, etc.)

---

## Phase 2: Add World Spawns

**Priority:** HIGH - Players need somewhere to mine and fish

**How World Spawns Work:**
The `resourceId` field is what matters - it links to entries in resources.json. The `type` field is just for documentation/clarity (the system doesn't use it).

```javascript
// From ResourceSystem.initializeWorldAreaResources():
const resourceData = getExternalResource(r.resourceId);  // Looks up resources.json
const mappedType = typeMap[resourceData.type];           // Uses manifest type, NOT world-areas type
```

### 2.1 Add Mining Rocks to Central Haven

Add to `central_haven.resources` in `world-areas.json`:

```json
{
  "type": "ore",
  "position": { "x": -15, "y": 0, "z": 10 },
  "resourceId": "ore_copper"
},
{
  "type": "ore",
  "position": { "x": -18, "y": 0, "z": 10 },
  "resourceId": "ore_copper"
},
{
  "type": "ore",
  "position": { "x": -15, "y": 0, "z": 13 },
  "resourceId": "ore_tin"
},
{
  "type": "ore",
  "position": { "x": -18, "y": 0, "z": 13 },
  "resourceId": "ore_tin"
}
```

**Layout Rationale:**
- 4 rocks total (2 copper, 2 tin) - enough for bronze bar crafting
- Located at (-15 to -18, 10-13) - opposite side from trees
- Close together for efficient mining
- Within safe zone bounds (-20 to 20)

### 2.2 Add Fishing Spot to Central Haven

Add to `central_haven.resources` in `world-areas.json`:

```json
{
  "type": "fishing_spot",
  "position": { "x": -10, "y": 0, "z": -15 },
  "resourceId": "fishing_spot_normal"
}
```

**Layout Rationale:**
- 1 normal fishing spot (shrimp/anchovies, level 1)
- Positioned at edge of town (-10, -15) to suggest water area
- Note: Fishing spots have `modelPath: null` - they render as interaction points

**⚠️ Position Verification Required:**
The terrain is procedurally generated. Water appears where terrain height < 5.4m. The fishing spot position (-10, 0, -15) was chosen based on Central Haven bounds, but the exact lake/water edge location depends on the noise-based heightmap. After in-game testing:
1. Verify the fishing spot is at the water's edge (not in deep water or on land)
2. If needed, adjust the position in world-areas.json to be at the shore
3. The terrain can be sampled with `terrainSystem.getHeightAt(x, z)` - water is where height < 5.4

### 2.3 Add Higher-Level Resources to The Wastes

Add to `wilderness_test.resources` in `world-areas.json`:

```json
{
  "type": "fishing_spot",
  "position": { "x": 60, "y": 0, "z": 0 },
  "resourceId": "fishing_spot_fly"
}
```

**Layout Rationale:**
- Fly fishing spot for trout/salmon (level 20)
- In wilderness area - risk/reward for higher XP
- Requires fly_fishing_rod item

### Testing Phase 2

- [ ] Server starts without errors
- [ ] Ore rocks appear at correct positions
- [ ] Fishing spot appears (interaction point visible)
- [ ] Resources are clickable/interactable
- [ ] Network sync works (resources visible to all clients)

---

## Phase 3: Verify Full Gathering Loop

**Priority:** HIGH - End-to-end testing

### 3.1 Mining Test Sequence

1. [ ] Give player `bronze_pickaxe` via `/give bronze_pickaxe`
2. [ ] Walk to ore rock in Central Haven
3. [ ] Click ore rock - verify:
   - [ ] "You swing your pickaxe at the Copper Rock." message
   - [ ] Mining animation plays
   - [ ] Success rolls occur (check server logs with DEBUG_GATHERING=true)
   - [ ] `copper_ore` or `tin_ore` received in inventory
   - [ ] Mining XP awarded (17.5 XP per ore)
   - [ ] Rock depletes (1/8 chance per ore)
   - [ ] Depleted rock shows `rocks/med_rock_v2.glb` model
   - [ ] Rock respawns after 4 ticks (2.4 seconds)
4. [ ] Movement cancels gathering
5. [ ] Level requirement check (already level 1, should pass)

### 3.2 Fishing Test Sequence

1. [ ] Give player `fishing_rod` via `/give fishing_rod`
2. [ ] Walk to fishing spot in Central Haven
3. [ ] Click fishing spot - verify:
   - [ ] "You attempt to catch some fish." message
   - [ ] Fishing animation plays
   - [ ] Success rolls occur every 5 ticks
   - [ ] `raw_shrimp` (70%) or `raw_anchovies` (30%) received
   - [ ] Fishing XP awarded (10 or 15 XP)
   - [ ] Spot does NOT deplete (fishing spots move instead)
   - [ ] After ~3 minutes, spot moves to nearby location
   - [ ] "The fishing spot has moved!" message when spot relocates
4. [ ] Movement cancels gathering
5. [ ] Level requirement check (already level 1, should pass)

### 3.3 Edge Cases

- [ ] Mining without pickaxe shows "You need a pickaxe to mine this rock."
- [ ] Fishing without rod shows "You need a fishing rod to fish here."
- [ ] Full inventory shows "Your inventory is too full to hold any more copper ore."
- [ ] Clicking depleted rock shows "This ore rock is depleted. Please wait for it to respawn."

---

## Phase 4: Verify OSRS Mechanics

**Priority:** MEDIUM - Ensures authentic gameplay feel

### 4.1 Mining Mechanics (OSRS-Accurate)

| Mechanic | OSRS Behavior | Implementation |
|----------|---------------|----------------|
| Roll Frequency | Tool-dependent (bronze = 8 ticks) | `rollTicks` in tools.json |
| Success Rate | Level-only (tool doesn't affect) | `MINING_SUCCESS_RATES` LERP |
| Depletion | 1/8 chance per ore | `MINING_DEPLETE_CHANCE: 0.125` |
| Respawn | Rock-specific (copper/tin = 4 ticks) | `respawnTicks` in resources.json |

**References:**
- [OSRS Mining Wiki](https://oldschool.runescape.wiki/w/Mining)
- [Mining Training Guide](https://oldschool.runescape.wiki/w/Pay-to-play_Mining_training)

### 4.2 Fishing Mechanics (OSRS-Accurate)

| Mechanic | OSRS Behavior | Implementation |
|----------|---------------|----------------|
| Roll Frequency | Fixed 5 ticks | `baseCycleTicks: 5` in resources.json |
| Success Rate | Level-only (equipment doesn't affect) | `FISHING_SUCCESS_RATES` LERP |
| Depletion | Spots don't deplete, they MOVE | `FISHING_SPOT_MOVE` constants |
| Movement Timer | ~3 minutes random | `baseTicks: 300, varianceTicks: 100` |

**References:**
- [OSRS Fishing Wiki](https://oldschool.runescape.wiki/w/Fishing)
- [Fishing Spots Wiki](https://oldschool.runescape.wiki/w/Fishing_spots)

---

## Phase 5: Store Integration (Optional)

**Priority:** LOW - Nice to have for progression

### 5.1 Add Tools to Shop

Update shop manifest to sell:
- Bronze pickaxe (50 coins)
- Fishing rod (30 coins)
- Fly fishing rod (100 coins) - requires level 20

### 5.2 Add Selling of Gathered Items

Players should be able to sell:
- Copper ore / Tin ore (5 coins each)
- Raw shrimp (5 coins)
- Raw anchovies (10 coins)
- Raw trout (20 coins)
- Raw salmon (30 coins)

---

## Phase 6: Future Enhancements

**Priority:** LOW - For later development

### 6.1 Additional Ores (Level Progression)

| Ore | Level | XP | Model Needed |
|-----|-------|-----|--------------|
| Iron ore | 15 | 35 | ore-iron/ |
| Silver ore | 20 | 40 | ore-silver/ |
| Coal | 30 | 50 | ore-coal/ |
| Gold ore | 40 | 65 | ore-gold/ |
| Mithril ore | 55 | 80 | ore-mithril/ |
| Adamantite ore | 70 | 95 | ore-adamant/ |
| Runite ore | 85 | 125 | ore-runite/ |

### 6.2 Additional Fish (Level Progression)

| Fish | Level | XP | Spot Type |
|------|-------|-----|-----------|
| Sardine | 5 | 20 | bait |
| Herring | 10 | 30 | bait |
| Pike | 25 | 60 | bait |
| Tuna | 35 | 80 | harpoon |
| Lobster | 40 | 90 | cage |
| Swordfish | 50 | 100 | harpoon |
| Shark | 76 | 110 | harpoon |

### 6.3 Processing System Integration

- **Smithing:** Smelt copper + tin → bronze bar
- **Cooking:** Cook raw fish on fire → cooked fish (food)

Note: ProcessingSystem.ts already supports cooking fish on fires.

---

## Implementation Checklist

### Phase 1: Items ✅ COMPLETE
- [x] Add copper_ore to items.json
- [x] Add tin_ore to items.json
- [x] Add raw_shrimp to items.json
- [x] Add raw_anchovies to items.json
- [x] Add raw_trout to items.json
- [x] Add raw_salmon to items.json
- [x] Add fly_fishing_rod to items.json
- [x] Add fly_fishing_rod to tools.json
- [x] Build and verify no errors

### Phase 2: World Spawns ✅ COMPLETE
- [x] Add 2 copper rocks to Central Haven
- [x] Add 2 tin rocks to Central Haven
- [x] Add 1 normal fishing spot to Central Haven (⚠️ position needs in-game verification)
- [x] Add 1 fly fishing spot to The Wastes
- [ ] Verify resources spawn on server start

### Phase 3: Testing ✅ CODE VERIFIED
Code flow verified (in-game testing still needed):
- [x] Build succeeds with no TypeScript errors
- [x] DataManager loads world-areas.json → ALL_WORLD_AREAS
- [x] DataManager loads resources.json → EXTERNAL_RESOURCES
- [x] DataManager loads items.json → ITEMS Map
- [x] DataManager loads tools.json → tool data
- [x] ResourceSystem.initializeWorldAreaResources() spawns manifest resources
- [x] ResourceSystem.startGathering() validates tools, levels, adjacency
- [x] ResourceSystem.processGatheringTick() uses LERP success rates
- [x] INVENTORY_ITEM_ADDED event handled by InventorySystem
- [x] InventorySystem.getItem() validates items exist in items.json
- [x] Error messages implemented: no tool, depleted, full inventory, level req

**Remaining for in-game testing:**
- [ ] Mine copper ore successfully
- [ ] Mine tin ore successfully
- [ ] Fish raw shrimp successfully
- [ ] Fish raw anchovies successfully
- [ ] Rock depletion works (1/8 chance)
- [ ] Rock respawn works (tick-based)
- [ ] Fishing spot movement works (~3 min timer)
- [ ] Fishing spot position is at water's edge

### Phase 4: OSRS Mechanics Verification ✅ COMPLETE
Cross-referenced with [OSRS Wiki](https://oldschool.runescape.wiki/) - all major values verified:

**Mining (Verified ✓):**
- [x] Copper/Tin XP: 17.5 (matches OSRS)
- [x] Respawn: 4 ticks = 2.4 seconds (matches OSRS)
- [x] Depletion: 1/8 chance (0.125) (matches OSRS)
- [x] Roll ticks: 8 ticks for bronze pickaxe (matches OSRS)
- [x] Tool affects speed, not success rate (matches OSRS)

**Fishing (Verified & Fixed ✓):**
- [x] Shrimp XP: 10 (matches OSRS)
- [x] Anchovies XP: 40 (**FIXED** - was 15, corrected to 40)
- [x] Trout XP: 50 (matches OSRS)
- [x] Salmon XP: 70 (matches OSRS)
- [x] Roll ticks: 5 ticks fixed (matches OSRS)
- [x] Spots move instead of deplete (matches OSRS)

**Minor Deviations (acceptable for MVP):**
- [ ] Anchovies require level 15 in OSRS (we drop them from level 1)
- [ ] OSRS uses small fishing net for shrimp/anchovies (we use fishing_rod)
- [ ] Salmon requires level 30 in OSRS (we drop from level 20 spot)

**Sources:**
- [Copper ore](https://oldschool.runescape.wiki/w/Copper_ore)
- [Raw shrimps](https://oldschool.runescape.wiki/w/Raw_shrimps)
- [Raw anchovies](https://oldschool.runescape.wiki/w/Raw_anchovies)
- [Raw trout](https://oldschool.runescape.wiki/w/Raw_trout)
- [Raw salmon](https://oldschool.runescape.wiki/w/Raw_salmon)

---

## Quick Reference: File Locations

| File | Purpose |
|------|---------|
| `packages/server/world/assets/manifests/items.json` | Item definitions |
| `packages/server/world/assets/manifests/resources.json` | Resource definitions |
| `packages/server/world/assets/manifests/tools.json` | Tool definitions |
| `packages/server/world/assets/manifests/world-areas.json` | World spawn points |
| `packages/shared/src/constants/GatheringConstants.ts` | OSRS mechanics constants |
| `packages/shared/src/systems/shared/entities/ResourceSystem.ts` | Gathering system |
| `packages/shared/src/data/skill-unlocks.ts` | Skill progression |

---

## Summary

**Mining and fishing systems are FULLY IMPLEMENTED.** The only missing pieces are:

1. **Item definitions** (Phase 1) - Add ores and fish to items.json
2. **World spawns** (Phase 2) - Add rocks and spots to world-areas.json

Once these manifest entries are added, mining and fishing will work immediately with full OSRS-accurate mechanics including:
- Tool-based roll timing (mining)
- Level-based success rates (LERP formula)
- 1/8 rock depletion chance
- Tick-based respawn timers
- Fishing spot movement
- Proper gathering messages
- XP awards
- Inventory integration

**Estimated Implementation Time:** 1-2 hours for Phase 1-3
