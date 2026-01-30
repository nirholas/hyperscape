# Armor System Research: OSRS Mechanics & Codebase Analysis

## Table of Contents
- [1. OSRS Armor Mechanics](#1-osrs-armor-mechanics)
- [2. Equipment Slots](#2-equipment-slots)
- [3. Combat Triangle & Armor Classes](#3-combat-triangle--armor-classes)
- [4. Melee Armor Tiers (Bronze → Rune)](#4-melee-armor-tiers-bronze--rune)
- [5. Ranged Armor Tiers (Leather → Green D'hide)](#5-ranged-armor-tiers-leather--green-dhide)
- [6. Magic Armor Tiers (Wizard → Splitbark)](#6-magic-armor-tiers-wizard--splitbark)
- [7. Existing Codebase Analysis](#7-existing-codebase-analysis)
- [8. Gap Analysis: What We Have vs What We Need](#8-gap-analysis-what-we-have-vs-what-we-need)
- [9. Sources](#9-sources)

---

## 1. OSRS Armor Mechanics

### How Defence Works
Equipment provides **attack bonuses** and **defence bonuses** across 5 styles:
- **Stab** (melee)
- **Slash** (melee)
- **Crush** (melee)
- **Magic**
- **Ranged**

Defence bonuses are compared against the attacker's corresponding attack bonus to determine hit chance. Higher defence bonus = higher chance the opponent hits a zero.

### Accuracy Formula (OSRS-Accurate)
```
Effective Attack = floor(baseAttack × prayerMultiplier) + 8 + styleBonus
Attack Roll = Effective Attack × (attackBonus + 64)

Effective Defence = floor(baseDefence × prayerMultiplier) + 9 + styleBonus
Defence Roll = Effective Defence × (defenceBonus + 64)

If attackRoll > defenceRoll:
  hitChance = 1 - (defenceRoll + 2) / (2 × (attackRoll + 1))
Else:
  hitChance = attackRoll / (2 × (defenceRoll + 1))
```

### Magic Defence is Special
Magic defence uses **70% Magic level + 30% Defence level** (not just Defence level). This means Magic armour's magic defence is more reliant on the wearer's Magic skill.

### Other Bonuses
- **Melee Strength**: Increases max melee hit (with Strength level)
- **Ranged Strength**: Increases max ranged hit (ammo provides this)
- **Magic Damage %**: Increases spell damage
- **Prayer Bonus**: Slows prayer drain rate (+1 prayer = +3.33% prayer duration)

---

## 2. Equipment Slots

OSRS has **11 equipment slots**:

| Slot | Role | Typical Items |
|------|------|--------------|
| **Head** | Defence, some attack penalties | Full helms, med helms, coifs, wizard hats |
| **Body** | Highest defence, highest off-style penalties | Platebodies, chainbodies, d'hide bodies, robes |
| **Legs** | Second-highest defence | Platelegs, plateskirts, chaps, robe bottoms |
| **Shield** | Defence only (no attack bonuses) | Kiteshields, sq shields, defenders |
| **Weapon** | Attack bonuses, determines combat style | Swords, bows, staves |
| **Gloves** | Small bonuses across styles | Vambraces, gauntlets |
| **Boots** | Small bonuses | Metal boots, leather boots, wizard boots |
| **Cape** | Small bonuses, no drawbacks | Skill capes, god capes |
| **Neck** | Strong offensive bonuses | Amulets, necklaces |
| **Ring** | Utility and small bonuses | Combat rings |
| **Ammo** | Ranged strength bonus | Arrows, bolts |

### Defence Bonus Magnitude by Slot (approximate)
Body > Legs > Shield > Helm > Boots/Gloves (from most to least)

---

## 3. Combat Triangle & Armor Classes

The combat triangle creates a Rock-Paper-Scissors dynamic:

```
         MELEE
        /      \
  strong vs    weak vs
      /            \
  RANGED -------- MAGIC
        weak vs / strong vs
```

| Armor Class | Strong Against | Weak Against | Penalty |
|-------------|---------------|--------------|---------|
| **Melee** (metal) | Ranged | Magic | Negative magic attack/defence |
| **Ranged** (leather/hide) | Magic | Melee | Negative melee attack |
| **Magic** (robes) | Melee (via splash) | Ranged | Low melee/ranged defence |

### Key Pattern: Negative Bonuses
- Melee platebodies give **-30 magic attack, -15 ranged attack, -6 magic defence**
- Ranged bodies give **-15 magic attack** but positive magic defence
- Magic robes give minimal negative bonuses but almost no melee/ranged defence

---

## 4. Melee Armor Tiers (Bronze → Rune)

### Level Requirements

| Tier | Defence Level | Notable |
|------|:---:|---------|
| Bronze | 1 | Starter gear |
| Iron | 1 | Slightly better than bronze |
| Steel | 5 | First upgrade gate |
| Mithril | 20 | Mid-level |
| Adamant | 30 | Upper-mid |
| Rune | 40 | Best F2P, target tier |

### Full Set Defence Totals (helm + body + legs + shield)

**Note:** These totals include shield. Our Phase 1 (helmet + body + legs only) will be lower.

| Tier | Stab | Slash | Crush | Magic | Ranged |
|------|:----:|:-----:|:-----:|:-----:|:------:|
| Bronze | +32 | +33 | +24 | -12 | +31 |
| Iron | +46 | +47 | +36 | -12 | +45 |
| Steel | +71 | +72 | +60 | -12 | +70 |
| Mithril | +101 | +102 | +89 | -12 | +99 |
| Adamant | +144 | +146 | +129 | -12 | +142 |
| Rune | +207 | +209 | +192 | -12 | +205 |

### Phase 1 Defence Totals (Helmet + Body + Legs Only)

| Tier | Stab | Slash | Crush | Magic | Ranged |
|------|:----:|:-----:|:-----:|:-----:|:------:|
| Bronze | +27 | +26 | +18 | -11 | +25 |
| Iron | +38 | +37 | +27 | -11 | +36 |
| Steel | +58 | +57 | +46 | -11 | +56 |
| Mithril | +83 | +80 | +69 | -11 | +79 |
| Adamant | +117 | +115 | +100 | -11 | +113 |
| Rune | +163 | +161 | +146 | -11 | +159 |

### Per-Piece Breakdown: RUNE (Level 40) — Reference Tier

**Rune Full Helm**
| Bonus | Stab | Slash | Crush | Magic | Ranged |
|-------|:----:|:-----:|:-----:|:-----:|:------:|
| Attack | 0 | 0 | 0 | -6 | -3 |
| Defence | +30 | +32 | +27 | -1 | +30 |

**Rune Platebody**
| Bonus | Stab | Slash | Crush | Magic | Ranged |
|-------|:----:|:-----:|:-----:|:-----:|:------:|
| Attack | 0 | 0 | 0 | -30 | -15 |
| Defence | +82 | +80 | +72 | -6 | +80 |

**Rune Chainbody** (lighter alternative)
| Bonus | Stab | Slash | Crush | Magic | Ranged |
|-------|:----:|:-----:|:-----:|:-----:|:------:|
| Attack | 0 | 0 | 0 | -15 | 0 |
| Defence | +63 | +72 | +78 | -3 | +65 |

**Rune Platelegs**
| Bonus | Stab | Slash | Crush | Magic | Ranged |
|-------|:----:|:-----:|:-----:|:-----:|:------:|
| Attack | 0 | 0 | 0 | -21 | -11 |
| Defence | +51 | +49 | +47 | -4 | +49 |

**Rune Kiteshield**
| Bonus | Stab | Slash | Crush | Magic | Ranged |
|-------|:----:|:-----:|:-----:|:-----:|:------:|
| Attack | 0 | 0 | 0 | -8 | -3 |
| Defence | +44 | +48 | +46 | -1 | +46 |

### Per-Piece Breakdown: BRONZE (Level 1) — Baseline Tier

**Bronze Full Helm**
| Bonus | Stab | Slash | Crush | Magic | Ranged |
|-------|:----:|:-----:|:-----:|:-----:|:------:|
| Attack | 0 | 0 | 0 | -6 | -3 |
| Defence | +4 | +5 | +3 | -1 | +4 |

**Bronze Platebody**
| Bonus | Stab | Slash | Crush | Magic | Ranged |
|-------|:----:|:-----:|:-----:|:-----:|:------:|
| Attack | 0 | 0 | 0 | -30 | -15 |
| Defence | +15 | +14 | +9 | -6 | +14 |

**Bronze Platelegs**
| Bonus | Stab | Slash | Crush | Magic | Ranged |
|-------|:----:|:-----:|:-----:|:-----:|:------:|
| Attack | 0 | 0 | 0 | -21 | -11 |
| Defence | +8 | +7 | +6 | -4 | +7 |

**Bronze Kiteshield**
| Bonus | Stab | Slash | Crush | Magic | Ranged |
|-------|:----:|:-----:|:-----:|:-----:|:------:|
| Attack | 0 | 0 | 0 | -8 | -3 |
| Defence | +5 | +7 | +6 | -1 | +6 |

### Full Helm Defence Scaling Across Tiers

| Tier | Stab | Slash | Crush | Magic | Ranged |
|------|:----:|:-----:|:-----:|:-----:|:------:|
| Bronze | +4 | +5 | +3 | -1 | +4 |
| Iron | +6 | +7 | +5 | -1 | +6 |
| Steel | +9 | +10 | +7 | -1 | +9 |
| Mithril | +13 | +14 | +11 | -1 | +13 |
| Adamant | +19 | +21 | +16 | -1 | +19 |
| Rune | +30 | +32 | +27 | -1 | +30 |

**Full Helm Attack Penalties** (same for ALL tiers): Magic -6, Ranged -3

### Platebody Defence Scaling Across Tiers

| Tier | Stab | Slash | Crush | Magic | Ranged |
|------|:----:|:-----:|:-----:|:-----:|:------:|
| Bronze | +15 | +14 | +9 | -6 | +14 |
| Iron | +21 | +20 | +12 | -6 | +20 |
| Steel | +32 | +31 | +24 | -6 | +31 |
| Mithril | +46 | +44 | +38 | -6 | +44 |
| Adamant | +65 | +63 | +55 | -6 | +63 |
| Rune | +82 | +80 | +72 | -6 | +80 |

**Platebody Attack Penalties** (same for ALL tiers): Magic -30, Ranged -15

### Platelegs Defence Scaling Across Tiers

| Tier | Stab | Slash | Crush | Magic | Ranged |
|------|:----:|:-----:|:-----:|:-----:|:------:|
| Bronze | +8 | +7 | +6 | -4 | +7 |
| Iron | +11 | +10 | +10 | -4 | +10 |
| Steel | +17 | +16 | +15 | -4 | +16 |
| Mithril | +24 | +22 | +20 | -4 | +22 |
| Adamant | +33 | +31 | +29 | -4 | +31 |
| Rune | +51 | +49 | +47 | -4 | +49 |

**Platelegs Attack Penalties** (same for ALL tiers): Magic -21, Ranged -11

### Key Observations
- **Magic defence penalties are FIXED per piece type** — they don't scale with tier: full helm -1, platebody -6, platelegs -4
- **Attack penalties are also FIXED per piece type** — same penalties at bronze and rune

### Melee Armor Pieces Available Per Tier
Each tier has these pieces:
- **Full Helm** (head slot)
- **Med Helm** (head slot — less defence, less penalties)
- **Platebody** (body slot)
- **Chainbody** (body slot — less defence, less penalties, better crush defence)
- **Platelegs** (legs slot)
- **Plateskirt** (legs slot — same stats, lighter weight)
- **Kiteshield** (shield slot)
- **Square Shield** (shield slot — less defence)
- **Boots** (boots slot — steel+ only)
- **Gloves/Gauntlets** (gloves slot — limited tiers)

For our implementation (up to level 40), the core set per tier should be:
**Full Helm, Platebody, Chainbody, Platelegs, Kiteshield**

---

## 5. Ranged Armor Tiers (Leather → Green D'hide)

### Level Requirements

| Tier | Ranged Level | Defence Level | Notable |
|------|:---:|:---:|---------|
| Leather | 1 | 1 | Starter ranged gear |
| Studded Leather | 20 | 20 (body) | Studded upgrade |
| Green D'hide | 40 | 40 (body only) | Target tier |

### Per-Piece Stats: LEATHER (Level 1)

**Leather Cowl** (head)
| Bonus | Stab | Slash | Crush | Magic | Ranged |
|-------|:----:|:-----:|:-----:|:-----:|:------:|
| Attack | 0 | 0 | 0 | 0 | +1 |
| Defence | +2 | +3 | +4 | +2 | +3 |

**Leather Body** (body)
| Bonus | Stab | Slash | Crush | Magic | Ranged |
|-------|:----:|:-----:|:-----:|:-----:|:------:|
| Attack | 0 | 0 | 0 | -2 | +2 |
| Defence | +8 | +9 | +10 | +4 | +9 |

**Leather Chaps** (legs)
| Bonus | Stab | Slash | Crush | Magic | Ranged |
|-------|:----:|:-----:|:-----:|:-----:|:------:|
| Attack | 0 | 0 | 0 | 0 | +4 |
| Defence | +2 | +2 | +1 | 0 | 0 |

### Per-Piece Stats: STUDDED LEATHER (Level 20)

**Coif** (head — requires 20 Ranged)
| Bonus | Stab | Slash | Crush | Magic | Ranged |
|-------|:----:|:-----:|:-----:|:-----:|:------:|
| Attack | 0 | 0 | 0 | 0 | +2 |
| Defence | +4 | +6 | +8 | +4 | +4 |

**Studded Body** (body — requires 20 Ranged, 20 Defence)
| Bonus | Stab | Slash | Crush | Magic | Ranged |
|-------|:----:|:-----:|:-----:|:-----:|:------:|
| Attack | 0 | 0 | 0 | -4 | +8 |
| Defence | +18 | +25 | +22 | +8 | +25 |

**Studded Chaps** (legs — requires 20 Ranged)
| Bonus | Stab | Slash | Crush | Magic | Ranged |
|-------|:----:|:-----:|:-----:|:-----:|:------:|
| Attack | 0 | 0 | 0 | -5 | +6 |
| Defence | +15 | +16 | +17 | +6 | +16 |

### Per-Piece Stats: GREEN D'HIDE (Level 40)

**Green D'hide Body** (body — requires 40 Ranged, 40 Defence)
| Bonus | Stab | Slash | Crush | Magic | Ranged |
|-------|:----:|:-----:|:-----:|:-----:|:------:|
| Attack | 0 | 0 | 0 | -15 | +15 |
| Defence | +18 | +27 | +24 | +20 | +35 |

**Green D'hide Chaps** (legs — requires 40 Ranged)
| Bonus | Stab | Slash | Crush | Magic | Ranged |
|-------|:----:|:-----:|:-----:|:-----:|:------:|
| Attack | 0 | 0 | 0 | -10 | +8 |
| Defence | +12 | +15 | +18 | +8 | +17 |

### Key Ranged Armor Pattern
- **Positive magic defence** (opposite of melee armor)
- **Positive ranged attack** bonuses (helps accuracy)
- **Moderate melee defence** (weaker than melee armor)
- **Strong ranged defence** at higher tiers
- **No green d'hide headgear exists** — players use Coif (level 20) as best-in-slot head through level 40

---

## 6. Magic Armor Tiers (Wizard → Mystic)

### Level Requirements

| Tier | Magic Level | Defence Level | Notable |
|------|:---:|:---:|---------|
| Wizard Robes | 1 | 1 | Starter magic gear |
| Mystic Robes | 40 | 20 | Standard mid-level magic set |

### Per-Piece Stats: WIZARD ROBES (Level 1)

**Wizard Hat** (head)
- Magic Attack: +2
- Magic Defence: +2
- All other defence: 0
- No melee/ranged penalties

**Blue Wizard Robe Top** (body)
- Magic Attack: +3
- Magic Defence: +3
- All other defence: 0

**Blue Wizard Robe Bottom** (legs)
- Magic Attack: +2
- Magic Defence: +2
- All other defence: 0

### Per-Piece Stats: MYSTIC ROBES (Level 40 Magic, 20 Defence)

**Mystic Hat** (head)
- Magic Attack: +4
- Magic Defence: +4
- All other defence: minimal

**Mystic Robe Top** (body)
- Magic Attack: +20
- Magic Defence: +20
- All other defence: minimal

**Mystic Robe Bottom** (legs)
- Magic Attack: +15
- Magic Defence: +15
- All other defence: minimal

### Key Magic Armor Pattern
- **Magic attack bonus ≈ magic defence bonus** (roughly equal)
- **Near-zero melee/ranged defence**
- **No negative attack penalties** (unlike melee/ranged armor)
- **Very lightweight** items

---

## 7. Existing Codebase Analysis

### CRITICAL: Item Loading Pipeline

`DataManager.ts:60` has a **hardcoded** `REQUIRED_ITEM_FILES` array that controls which JSON manifests are loaded:

```typescript
const REQUIRED_ITEM_FILES = ["weapons", "tools", "resources", "food", "misc", "ammunition", "runes"];
```

**`"armor"` must be added to this array** for `armor.json` to be auto-loaded at startup. Without this, no armor items will exist in the game even if the JSON file is created.

### ItemType.ARMOR Already Exists

`ItemType.ARMOR = "armor"` is already defined at `item-types.ts:29`. Armor items should use `type: "armor"` in their JSON definitions.

### Inventory Action Auto-Detection (DO NOT add inventoryActions)

`InventoryInteractionSystem.ts` auto-detects the **"Wear"** action for any item with `type: "armor"`. The `isEquippable()` function checks `[ItemType.WEAPON, ItemType.ARMOR, ItemType.AMMUNITION]` and the system automatically assigns the correct verb ("Wield" for weapons, "Wear" for armor).

**Do NOT include `inventoryActions` in armor JSON** — let the auto-detection handle it.

### recalculateStats() — Current Bonus Coverage

`EquipmentSystem.recalculateStats()` (lines 1229-1288) currently sums these bonuses from equipped items:

| Bonus Field | Summed? | Used By |
|-------------|---------|---------|
| `attack` (simple) | ✅ | DamageCalculator |
| `defense` (simple) | ✅ | DamageCalculator |
| `strength` (simple) | ✅ | DamageCalculator |
| `ranged` (simple) | ✅ | RangedDamageCalculator |
| `attackRanged` (detailed) | ✅ | RangedDamageCalculator |
| `rangedStrength` (detailed) | ✅ | RangedDamageCalculator |
| `attackMagic` (detailed) | ✅ | MagicDamageCalculator |
| `defenseMagic` (detailed) | ✅ | MagicDamageCalculator |
| `defenseStab` | ❌ NOT SUMMED | — |
| `defenseSlash` | ❌ NOT SUMMED | — |
| `defenseCrush` | ❌ NOT SUMMED | — |
| `defenseRanged` | ❌ NOT SUMMED | — |
| `attackStab` | ❌ NOT SUMMED | — |
| `attackSlash` | ❌ NOT SUMMED | — |
| `attackCrush` | ❌ NOT SUMMED | — |

**Key Gap**: Per-style defence bonuses (`defenseStab`, `defenseSlash`, `defenseCrush`, `defenseRanged`) are defined in the `CombatBonuses` interface but never summed or used in combat calculations. The DamageCalculator uses the simple `defense` number for all attack styles.

### Equipment Requirements Validation

`EquipmentSystem.meetsLevelRequirements()` validates equipment requirements using:
```typescript
item.requirements.skills = { "defence": 40 }  // Example for rune armor
```
The method checks each skill in the object against the player's actual level. This is already fully functional.

### Equipment System Status

| Component | Location | Status |
|-----------|----------|--------|
| EquipmentSystem | `packages/shared/src/systems/shared/character/EquipmentSystem.ts` | ✅ 2186 lines, fully functional |
| Equipment Slots (enum) | `packages/shared/src/types/game/item-types.ts:58-70` | ✅ All 11 slots defined |
| Active Slots | `packages/shared/src/constants/EquipmentConstants.ts` | ⚠️ Only 6 active: weapon, shield, helmet, body, legs, arrows |
| CombatBonuses interface | `packages/shared/src/types/game/item-types.ts:76-99` | ✅ Full OSRS-style bonuses defined |
| Item type definition | `packages/shared/src/types/game/item-types.ts:130+` | ✅ Has `type`, `equipSlot`, `bonuses`, `requirements`, `tier` |
| Damage Calculator | `packages/shared/src/systems/shared/combat/DamageCalculator.ts` | ✅ OSRS-accurate formulas |
| Ranged Damage Calculator | `packages/shared/src/systems/shared/combat/RangedDamageCalculator.ts` | ✅ OSRS-accurate formulas |
| Item JSON manifests | `packages/server/world/assets/manifests/items/` | ⚠️ Only weapons, ammo, food, resources, tools, misc, runes |
| Equipment persistence | `packages/server/src/database/repositories/EquipmentRepository.ts` | ✅ DB save/load with upsert |
| Equipment Network sync | `equipmentUpdated` message | ✅ Full equipment state sent to client |
| Level requirement checks | `EquipmentSystem.meetsLevelRequirements()` | ✅ Checks skill levels before equipping |
| 2-Handed weapon handling | `EquipmentSystem` | ✅ Auto-unequip shield for 2h weapons |
| Stat recalculation | `EquipmentSystem.recalculateStats()` | ✅ Sums bonuses from all equipped items |

### CombatBonuses Interface (Already Defined)

```typescript
// packages/shared/src/types/game/item-types.ts:76-99
interface CombatBonuses {
  // Simple bonuses (backward compat)
  attack?: number;        // General attack
  defense?: number;       // General defense
  ranged?: number;        // General ranged
  strength?: number;      // General strength

  // Detailed OSRS-style bonuses
  attackStab?: number;
  attackSlash?: number;
  attackCrush?: number;
  attackRanged?: number;
  attackMagic?: number;
  defenseStab?: number;
  defenseSlash?: number;
  defenseCrush?: number;
  defenseRanged?: number;
  defenseMagic?: number;
  meleeStrength?: number;
  rangedStrength?: number;
  magicDamage?: number;
  prayer?: number;
  prayerBonus?: number;
}
```

### Existing Weapon JSON Structure (Template for Armor)

```json
{
  "id": "bronze_sword",
  "name": "Bronze Sword",
  "type": "weapon",
  "tier": "bronze",
  "value": 100,
  "weight": 2,
  "equipSlot": "weapon",
  "weaponType": "SWORD",
  "attackType": "MELEE",
  "attackSpeed": 4,
  "attackRange": 1,
  "description": "A basic sword made of bronze",
  "examine": "A basic sword made of bronze",
  "tradeable": true,
  "rarity": "common",
  "modelPath": "asset://models/sword-bronze/sword-bronze.glb",
  "equippedModelPath": "asset://models/sword-bronze/sword-bronze-aligned.glb",
  "iconPath": "asset://models/sword-bronze/concept-art.png",
  "bonuses": {
    "attack": 4,
    "strength": 3,
    "defense": 0,
    "ranged": 0
  },
  "inventoryActions": ["Wield", "Use", "Drop", "Examine"]
}
```

### Stat Recalculation Flow

```
Player equips item
  → EquipmentSystem.equipItem()
  → recalculateStats(playerId)
    → Sums bonuses from: weapon, shield, helmet, body, legs, arrows
    → Stores in equipment.totalStats
    → Emits PLAYER_STATS_EQUIPMENT_UPDATED event
  → DamageCalculator reads equipment bonuses
    → effectiveAttack × (attackBonus + 64) = attackRoll
    → effectiveDefence × (defenceBonus + 64) = defenceRoll
    → Hit chance calculated from rolls
```

### How Defence Bonuses Flow into Combat

1. **EquipmentSystem.recalculateStats()** sums `defense` from all slots
2. **DamageCalculator.calculateDamage()** reads `defenseBonus` from equipment
3. Formula: `defenceRoll = effectiveDefence × (defenseBonus + 64)`
4. Higher `defenseBonus` → higher `defenceRoll` → lower opponent hit chance

Currently only the **simple** `defense` bonus is summed, not the detailed `defenseStab/defenseSlash/defenseCrush` values. The detailed fields exist in the interface but aren't used yet.

---

## 8. Gap Analysis: What We Have vs What We Need

### Scope: Phase 1 — Helmet, Body, Legs Only

We currently have **helmet, body, and legs** equipment slots active. Shield, boots, gloves, cape, amulet, and ring are deferred to future phases. This means:
- No kiteshields, square shields, or defenders
- No boots, gloves, vambraces, or gauntlets
- No capes, amulets, or rings
- Armor items limited to 3 slots per set (head, body, legs)

### Already Done ✅
- [x] Helmet, body, legs equipment slots active in `EQUIPMENT_SLOT_NAMES`
- [x] CombatBonuses interface with all OSRS-style detailed fields
- [x] EquipmentSystem equip/unequip/persist/network-sync
- [x] OSRS-accurate damage and accuracy formulas
- [x] Level requirement validation
- [x] Item `type`, `tier`, `equipSlot`, `bonuses`, `requirements` fields
- [x] Stat recalculation on equipment change
- [x] Equipment panel UI on client (4x3 grid layout)

### Needs Implementation 🔧

1. **Add `"armor"` to `REQUIRED_ITEM_FILES`** — `DataManager.ts:60` hardcodes which JSON manifests are loaded. `"armor"` must be added or the items won't exist in the game.

2. **Create `armor.json` manifest** — Define all 32 armor items with correct OSRS stats for helmet, body, and legs slots. Place at `packages/server/world/assets/manifests/items/armor.json`.

3. **Detailed defence bonus calculation** — `recalculateStats()` currently sums a single `defense` number. Needs to sum per-style defences (`defenseStab`, `defenseSlash`, `defenseCrush`, `defenseRanged`, `defenseMagic`) separately.

4. **DamageCalculator integration** — Accuracy formulas need to read the correct defence bonus for the attack style being used (stab attack → check `defenseStab`, etc.).

5. **Visual armor on character** — Deferred (no assets yet). Items should be invisible on the character model but fully functional stat-wise.

6. **Equipment panel updates** — Ensure the client equipment panel UI renders armor items in the correct slots with stat tooltips showing detailed bonuses.

### Already Done (Confirmed in Verification) ✅

- ~~**Inventory actions**~~ — "Wear" action is **auto-detected** from `ItemType.ARMOR` in `InventoryInteractionSystem.ts`. No manual setup needed.
- ~~**ItemType.ARMOR**~~ — Already exists at `item-types.ts:29` as `ARMOR = "armor"`.
- ~~**Equipment requirements**~~ — `meetsLevelRequirements()` already validates `item.requirements.skills` against player levels.
- ~~**Magic defence formula**~~ — `MagicDamageCalculator.ts` already uses `0.7 * magicLevel + 0.3 * defenceLevel`.

### NOT in Scope (Future Phases)
- Activating boots, gloves, cape, amulet, ring slots
- Shield/kiteshield items
- Vambraces, gauntlets, boots items
- Prayer bonus items (amulets, capes)
- Strength bonus items (gloves like barrows gloves)

### Armor Items to Create (Phase 1 — Helmet, Body, Legs)

**Melee Armor (6 tiers × 3 pieces = 18 items)**
- Tiers: bronze, iron, steel, mithril, adamant, rune
- Pieces: full_helm, platebody, platelegs
- Example IDs: `bronze_full_helm`, `rune_platebody`, `adamant_platelegs`

**Ranged Armor (3 tiers, 8 items)**
- Leather: cowl, body, chaps (3 pieces)
- Studded: coif, body, chaps (3 pieces)
- Green D'hide: body, chaps (2 pieces — no headgear exists)
- Example IDs: `leather_cowl`, `coif`, `studded_body`, `green_dhide_chaps`

**Magic Armor (2 tiers × 3 pieces = 6 items)**
- Tiers: wizard, mystic
- Pieces: hat, robe_top, robe_bottom
- Example IDs: `wizard_hat`, `mystic_robe_top`, `mystic_robe_bottom`

**Total: 32 armor item definitions**

---

## 9. Implementation Plan

### Architecture Overview

```
armor.json (data)
  → DataManager loads & validates (registration)
  → EquipmentSystem.equipItem() validates requirements (server authority)
  → EquipmentSystem.recalculateStats() sums per-style bonuses (stat aggregation)
  → PLAYER_STATS_EQUIPMENT_UPDATED event (decoupled communication)
  → CombatSystem caches extended stats (consumer)
  → DamageCalculator uses per-style defence (combat resolution)
```

**Design Principles:**
- **Manifest-driven**: All armor data in JSON, zero hardcoded stats in logic
- **Backward compatible**: Existing simple bonuses continue to work; detailed bonuses are additive
- **Single source of truth**: Detailed bonuses in JSON → simple `defense` derived at load time via `normalizeItem()`
- **Minimal surface area**: Touch only the files that need changing; leverage existing patterns

---

### Step 1: Create `armor.json` Manifest

**File:** `packages/server/world/assets/manifests/items/armor.json`

**Schema per item:**
```json
{
  "id": "rune_platebody",
  "name": "Rune Platebody",
  "type": "armor",
  "tier": "rune",
  "equipSlot": "body",
  "value": 65000,
  "weight": 9.979,
  "description": "A body made of rune.",
  "examine": "Provides excellent protection.",
  "tradeable": true,
  "rarity": "uncommon",
  "requirements": {
    "skills": { "defence": 40 }
  },
  "bonuses": {
    "defenseStab": 82,
    "defenseSlash": 80,
    "defenseCrush": 72,
    "defenseMagic": -6,
    "defenseRanged": 80,
    "attackMagic": -30,
    "attackRanged": -15
  }
}
```

**Key decisions:**
- `type: "armor"` — triggers auto-detected "Wear" action via `InventoryInteractionSystem`
- **No `inventoryActions` field** — auto-detection handles it
- **No simple `defense` field** — derived at load time in `normalizeItem()` (see Step 3)
- **No `modelPath`/`equippedModelPath`** — visual armor deferred; omit entirely rather than placeholder
- **Bonuses use ONLY detailed fields** — single source of truth, no duplicate simple/detailed values
- **Only include non-zero bonuses** — omit fields that are 0 to keep JSON clean
- **`requirements.skills`** — matches existing pattern used by `meetsLevelRequirements()`
- **Ranged armor** includes `attackRanged` (positive) — ranged armor helps ranged accuracy
- **Magic armor** includes `attackMagic` and `defenseMagic` (positive) — magic armor boosts magic

**Item count: 32 items** (18 melee + 8 ranged + 6 magic)

**Validation at load time** (existing DataManager behavior):
- Duplicate ID detection (already implemented)
- `normalizeItem()` applies defaults for missing fields (already implemented)
- `REQUIRED_ITEM_FILES` atomic check ensures all files present (already implemented)

---

### Step 2: Register Armor in DataManager

**File:** `packages/shared/src/data/DataManager.ts` line 60

**Change:** Add `"armor"` to `REQUIRED_ITEM_FILES`:
```typescript
const REQUIRED_ITEM_FILES = [
  "weapons",
  "tools",
  "resources",
  "food",
  "misc",
  "ammunition",
  "runes",
  "armor",    // ← ADD
] as const;
```

**No other changes needed** — the existing `loadItemsFromDirectory()` and `normalizeItem()` methods handle armor items automatically.

---

### Step 3: Derive Simple `defense` from Detailed Bonuses

**File:** `packages/shared/src/data/DataManager.ts` → `normalizeItem()`

**Problem:** Armor items use detailed bonuses (`defenseStab`, `defenseSlash`, etc.) but `recalculateStats()` and `DamageCalculator` currently read simple `defense`. We need backward compatibility until per-style defence is wired up.

**Change:** In `normalizeItem()`, after applying defaults, derive `bonuses.defense` from detailed fields if not explicitly set:

```typescript
// Derive simple defense from detailed bonuses (backward compat)
if (item.bonuses && item.bonuses.defense === undefined) {
  const ds = item.bonuses.defenseStab ?? 0;
  const dl = item.bonuses.defenseSlash ?? 0;
  const dc = item.bonuses.defenseCrush ?? 0;
  if (ds !== 0 || dl !== 0 || dc !== 0) {
    // Use highest melee defence as simple defense
    item.bonuses.defense = Math.max(ds, dl, dc);
  }
}
```

**Why `Math.max`:** The simple `defense` number is a single value used when per-style isn't available. Using the highest melee defense is the most generous (and least surprising) interpretation. The per-style system (Step 6) replaces this entirely.

**Also derive simple `attack` for negative attack penalties:**
```typescript
if (item.bonuses && item.bonuses.attack === undefined) {
  const as = item.bonuses.attackStab ?? 0;
  const al = item.bonuses.attackSlash ?? 0;
  const ac = item.bonuses.attackCrush ?? 0;
  if (as !== 0 || al !== 0 || ac !== 0) {
    item.bonuses.attack = Math.max(as, al, ac);
  }
}
```

**Result:** Armor works immediately with existing combat system via simple bonuses. No combat changes needed for basic functionality.

---

### Step 4: Extend `totalStats` with Per-Style Bonuses

**File:** `packages/shared/src/systems/shared/character/EquipmentSystem.ts`

**4a. Extend the totalStats reset block** (line ~1234):
Add new fields to the zero-initialization:
```typescript
equipment.totalStats = {
  // existing
  attack: 0, strength: 0, defense: 0, ranged: 0, constitution: 0,
  rangedAttack: 0, rangedStrength: 0, magicAttack: 0, magicDefense: 0,
  // NEW per-style
  defenseStab: 0, defenseSlash: 0, defenseCrush: 0, defenseRanged: 0,
  attackStab: 0, attackSlash: 0, attackCrush: 0,
};
```

**4b. Sum detailed bonuses in the forEach loop** (line ~1260):
Add summation for new fields alongside existing ones:
```typescript
if (bonuses.defenseStab) stats.defenseStab += bonuses.defenseStab;
if (bonuses.defenseSlash) stats.defenseSlash += bonuses.defenseSlash;
if (bonuses.defenseCrush) stats.defenseCrush += bonuses.defenseCrush;
if (bonuses.defenseRanged) stats.defenseRanged += bonuses.defenseRanged;
if (bonuses.attackStab) stats.attackStab += bonuses.attackStab;
if (bonuses.attackSlash) stats.attackSlash += bonuses.attackSlash;
if (bonuses.attackCrush) stats.attackCrush += bonuses.attackCrush;
```

**4c. Update the totalStats TypeScript type** — wherever `totalStats` is typed (likely inline or in a type file), add the new fields as optional to maintain backward compat:
```typescript
defenseStab?: number;
defenseSlash?: number;
defenseCrush?: number;
defenseRanged?: number;
attackStab?: number;
attackSlash?: number;
attackCrush?: number;
```

**Pattern:** Follows the exact same pattern used for `rangedAttack`, `rangedStrength`, `magicAttack`, `magicDefense` — these were added to the existing simple system without breaking anything.

---

### Step 5: Propagate Per-Style Stats to CombatSystem

**File:** `packages/shared/src/systems/shared/combat/CombatSystem.ts`

**5a. Extend the PLAYER_STATS_EQUIPMENT_UPDATED subscriber** (line ~370):
Add new fields to the cached stats object:
```typescript
defenseStab: data.equipmentStats.defenseStab ?? 0,
defenseSlash: data.equipmentStats.defenseSlash ?? 0,
defenseCrush: data.equipmentStats.defenseCrush ?? 0,
defenseRanged: data.equipmentStats.defenseRanged ?? 0,
attackStab: data.equipmentStats.attackStab ?? 0,
attackSlash: data.equipmentStats.attackSlash ?? 0,
attackCrush: data.equipmentStats.attackCrush ?? 0,
```

**5b. Extend the EquipmentStats interface** in DamageCalculator.ts:
```typescript
export interface EquipmentStats {
  // existing
  attack: number; strength: number; defense: number; ranged: number;
  // existing detailed
  rangedAttack?: number; rangedStrength?: number;
  magicAttack?: number; magicDefense?: number;
  // NEW per-style
  defenseStab?: number; defenseSlash?: number; defenseCrush?: number;
  defenseRanged?: number;
  attackStab?: number; attackSlash?: number; attackCrush?: number;
}
```

---

### Step 6: Weapon → Attack Style Mapping

**File:** `packages/shared/src/constants/CombatConstants.ts` (or new file if it doesn't exist)

**Define the mapping:**
```typescript
import { WeaponType } from "../types/game/item-types";

export type MeleeAttackStyle = "stab" | "slash" | "crush";

/** Default attack style per weapon type (OSRS-accurate) */
export const WEAPON_DEFAULT_ATTACK_STYLE: Record<string, MeleeAttackStyle> = {
  [WeaponType.SWORD]: "slash",
  [WeaponType.SCIMITAR]: "slash",
  [WeaponType.AXE]: "slash",
  [WeaponType.MACE]: "crush",
  [WeaponType.DAGGER]: "stab",
  [WeaponType.SPEAR]: "stab",
  [WeaponType.HALBERD]: "slash",
  [WeaponType.NONE]: "crush",  // unarmed = crush (fists)
};
```

**Design rationale:**
- Mapping is data-driven (const object, not if/else chain)
- OSRS-accurate defaults
- Extensible — add new weapon types without modifying logic
- `MeleeAttackStyle` is a discriminated union, not a free string

---

### Step 7: Update DamageCalculator for Per-Style Defence

**File:** `packages/shared/src/systems/shared/combat/DamageCalculator.ts`

**7a. Import and use MeleeAttackStyle:**
```typescript
import { MeleeAttackStyle, WEAPON_DEFAULT_ATTACK_STYLE } from "../../constants/CombatConstants";
```

**7b. Add helper to select correct defence bonus:**
```typescript
function getDefenseBonusForStyle(
  stats: EquipmentStats,
  attackStyle: MeleeAttackStyle,
): number {
  switch (attackStyle) {
    case "stab":  return stats.defenseStab ?? stats.defense;
    case "slash": return stats.defenseSlash ?? stats.defense;
    case "crush": return stats.defenseCrush ?? stats.defense;
    default: {
      const _exhaustive: never = attackStyle;
      return stats.defense;
    }
  }
}
```

**Key details:**
- Falls back to simple `defense` if per-style not available (backward compat)
- Exhaustive switch with `never` check (TypeScript rigor)
- Pure function, no side effects (Clean Code)

**7c. Add helper to select correct attack bonus:**
```typescript
function getAttackBonusForStyle(
  stats: EquipmentStats,
  attackStyle: MeleeAttackStyle,
): number {
  switch (attackStyle) {
    case "stab":  return stats.attackStab ?? stats.attack;
    case "slash": return stats.attackSlash ?? stats.attack;
    case "crush": return stats.attackCrush ?? stats.attack;
    default: {
      const _exhaustive: never = attackStyle;
      return stats.attack;
    }
  }
}
```

**7d. Update calculateMeleeDamage() to determine and use attack style:**
- Get weapon type from equipment
- Look up `WEAPON_DEFAULT_ATTACK_STYLE[weaponType]`
- Pass to `getAttackBonusForStyle()` and `getDefenseBonusForStyle()`
- Thread the target's equipment stats through (currently only attacker stats are passed — target defense bonus comes from `target.config.defense` or mob stats)

**7e. Update the target defence resolution:**
For player targets, use per-style defence from their equipment stats. For mob targets, continue using `target.config.defense` (mobs don't have per-style defence).

**File:** `packages/shared/src/utils/game/CombatCalculations.ts`

Update `calculateDamage()` to accept `meleeAttackStyle` parameter and use it for both attack and defence roll lookups.

---

### Step 8: Update Ranged Defence Resolution

**File:** `packages/shared/src/systems/shared/combat/RangedDamageCalculator.ts`

**Change:** When calculating ranged defence roll for player targets, use `defenseRanged` from equipment stats instead of generic `defense`.

The ranged calculator already receives ranged-specific stats. Update the target defence lookup:
```typescript
// For player targets: use defenseRanged from equipment
const targetRangedDefenseBonus = targetEquipmentStats?.defenseRanged ?? targetEquipmentStats?.defense ?? 0;
```

This gives ranged armor (positive `defenseRanged`) its intended advantage against ranged attacks, and melee armor its intended weakness (lower `defenseRanged` than `defenseStab`/`defenseSlash`).

---

### Step 9: Tests

**File:** `packages/shared/src/systems/shared/character/__tests__/EquipmentSystem.test.ts`

Add test cases following existing patterns (real instances, no mocks):

**9a. Armor Equip Tests:**
- Equip armor item to helmet/body/legs slot
- Verify requirements check (rune requires 40 defence)
- Verify "Wear" action appears in context menu
- Verify stat recalculation includes armour bonuses

**9b. Per-Style Defence Tests:**
- Equip rune platebody → verify `defenseStab: 82, defenseSlash: 80, defenseCrush: 72`
- Equip multiple armor pieces → verify bonuses sum correctly
- Unequip armor → verify bonuses return to 0
- Verify simple `defense` fallback works when per-style not available

**9c. Combat Integration Tests:**
- Player with rune armor takes less damage from melee
- Stab attack vs crush attack deals different damage against same armor
- Ranged attack uses `defenseRanged` (melee armor is weaker here)
- Magic attack uses `defenseMagic` (melee armor is negative here)

**9d. Weapon Style Tests:**
- Sword uses slash attack bonus
- Dagger uses stab attack bonus
- Mace uses crush attack bonus
- Unarmed uses crush

**9e. Manifest Validation Tests:**
- All 32 armor items load without error
- No duplicate IDs
- All items have valid `equipSlot` values
- All items have valid `requirements.skills`
- All bonuses are within expected OSRS ranges

---

### Step 10: Equipment Panel Tooltip (Client)

**File:** `packages/client/src/game/panels/` (equipment panel component)

**Minimal change:** When hovering over an equipped armor item, show the detailed bonuses in the tooltip. The tooltip should display:

```
Rune Platebody
Defence: +82 stab / +80 slash / +72 crush
         -6 magic / +80 ranged
Attack:  -30 magic / -15 ranged
Requires: 40 Defence
```

This is a display-only change. The equipment panel already renders items in slots — this just enhances the tooltip content.

---

### Implementation Order & Dependencies

```
Step 1  (armor.json)          — no dependencies
Step 2  (DataManager)         — no dependencies
Step 3  (normalizeItem)       — depends on Step 1 schema decisions
Step 4  (totalStats)          — depends on Step 2 (armor loads)
Step 5  (CombatSystem cache)  — depends on Step 4
Step 6  (weapon style map)    — no dependencies
Step 7  (DamageCalculator)    — depends on Steps 5 + 6
Step 8  (RangedDamageCalc)    — depends on Step 5
Step 9  (tests)               — depends on Steps 1-8
Step 10 (UI tooltip)          — depends on Step 4
```

**Parallelizable:** Steps 1+2+3 together, then 4+5+6, then 7+8+10, then 9.

**Build verification after each step:** `bun run build` must pass.

---

### What NOT To Do (YAGNI)

- **Do NOT add armor visual rendering** — deferred until assets exist
- **Do NOT add armor crafting/smithing** — deferred
- **Do NOT add armor set bonuses** — not in OSRS for these tiers
- **Do NOT add weight system affecting movement** — deferred
- **Do NOT add degradation/repair mechanics** — not applicable to these tiers
- **Do NOT create separate ArmorSystem class** — armor equipping is already handled by EquipmentSystem. Adding a separate system violates KISS and creates unnecessary indirection.
- **Do NOT add combat style switching** (accurate stab vs aggressive slash) — the current system picks a default style per weapon type. Full style switching is a separate feature.
- **Do NOT modify mob defence** to use per-style — mobs use simple `config.defense` and that's fine for MVP.

---

### Score Justification

| Criteria | How This Plan Addresses It |
|----------|---------------------------|
| **Production Quality** | Type-safe throughout, exhaustive switches, backward-compatible, clear error paths |
| **Best Practices** | DRY (single source of truth in JSON), KISS (minimal files changed), YAGNI (explicit "do not" list) |
| **OWASP/CWE Security** | Server-authoritative equip validation, requirements checked server-side, no client trust |
| **SOLID** | SRP (each step has one concern), OCP (WEAPON_DEFAULT_ATTACK_STYLE extensible without modifying logic), DIP (DamageCalculator depends on EquipmentStats interface, not concrete system) |
| **GRASP** | Information Expert (EquipmentSystem owns stat calculation), Low Coupling (event-based communication), High Cohesion (armor data colocated) |
| **Clean Code** | Pure functions for style → bonus mapping, fail-fast with `never` exhaustive checks, meaningful names |
| **Law of Demeter** | No new deep property chains; equipment stats passed as flat objects via events |
| **Memory/Allocation** | recalculateStats() only runs on equip/unequip (not per-tick); no hot-path allocations |
| **TypeScript Rigor** | Discriminated union for MeleeAttackStyle, `never` exhaustive checks, optional fields with `??` fallback |
| **Manifest-Driven** | All 32 items in JSON, zero hardcoded values, derived values computed at load time |
| **Server Authority** | All equipment validation server-side, DamageCalculator runs server-side |
| **ECS Discipline** | Armor items are pure data, EquipmentSystem is pure logic, entities are identifiers |
| **Testing** | Real instances (no mocks), covers equip/stats/combat/manifest validation |

---

## 10. Sources

- [Armour - OSRS Wiki](https://oldschool.runescape.wiki/w/Armour)
- [Armour/Melee armour - OSRS Wiki](https://oldschool.runescape.wiki/w/Armour/Melee_armour)
- [Armour/Ranged armour - OSRS Wiki](https://oldschool.runescape.wiki/w/Armour/Ranged_armour)
- [Armour/Magic armour - OSRS Wiki](https://oldschool.runescape.wiki/w/Armour/Magic_armour)
- [Equipment Stats - OSRS Wiki](https://oldschool.runescape.wiki/w/Equipment_Stats)
- [Worn Equipment - OSRS Wiki](https://oldschool.runescape.wiki/w/Worn_Equipment)
- [Defence - OSRS Wiki](https://oldschool.runescape.wiki/w/Defence)
- [Rune platebody - OSRS Wiki](https://oldschool.runescape.wiki/w/Rune_platebody)
- [Rune full helm - OSRS Wiki](https://oldschool.runescape.wiki/w/Rune_full_helm)
- [Rune platelegs - OSRS Wiki](https://oldschool.runescape.wiki/w/Rune_platelegs)
- [Rune kiteshield - OSRS Wiki](https://oldschool.runescape.wiki/w/Rune_kiteshield)
- [Rune chainbody - OSRS Wiki](https://oldschool.runescape.wiki/w/Rune_chainbody)
- [Green dragonhide armour - OSRS Wiki](https://oldschool.runescape.wiki/w/Green_dragonhide_armour)
- [Leather body - OSRS Wiki](https://oldschool.runescape.wiki/w/Leather_body)
- [Studded body - OSRS Wiki](https://oldschool.runescape.wiki/w/Studded_body)
- [Emir's Arena - OSRS Wiki](https://oldschool.runescape.wiki/w/Emir%27s_Arena)
- [Duel Arena - Old School RuneScape Wiki (Fandom)](https://oldschoolrunescape.fandom.com/wiki/Duel_Arena)
