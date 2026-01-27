# Magic & Ranged Combat System Research

This document contains comprehensive research for implementing magic and ranged combat in Hyperscape, based on OSRS mechanics and existing codebase analysis.

---

## Table of Contents

1. [Existing Codebase Analysis](#1-existing-codebase-analysis)
2. [OSRS Magic Mechanics](#2-osrs-magic-mechanics)
3. [OSRS Ranged Mechanics](#3-osrs-ranged-mechanics)
4. [F2P Implementation Plan (Levels 1-40)](#4-f2p-implementation-plan-levels-1-40) ← **Current Focus**
5. [Full Reference Implementation (Post-F2P)](#5-full-reference-implementation-post-f2p)

---

## 1. Existing Codebase Analysis

### 1.1 Implementation Readiness Summary

The codebase has **exceptional groundwork for magic and ranged combat**. The MVP deliberately deferred these systems with clear comments and organized stubs.

#### Ready to Implement (Infrastructure Complete):
- ✅ **Hit Delay System** - 100% complete for both ranged and magic
- ✅ **Projectile Tracking** - 100% complete infrastructure
- ✅ **Attack Range Calculations** - Support structure ready
- ✅ **Equipment Bonuses** - Types and interfaces fully defined
- ✅ **Weapon Types** - All weapon types enumerated (BOW, CROSSBOW, STAFF, WAND)
- ✅ **Skill Constants** - Both ranged and magic skills defined
- ✅ **Animation Emotes** - EMOTE_RANGED and EMOTE_MAGIC defined

#### Needs Implementation (MVP Stubs):
- 🔶 **AttackType Enum** - Needs RANGED and MAGIC values uncommented
- 🔶 **Damage Calculation** - Needs ranged/magic branches in calculateDamage()
- 🔶 **Combat Styles** - Ranged/magic need proper style systems
- 🔶 **Item Definitions** - Ranged weapons and magic items needed
- 🔶 **Combat Events** - COMBAT_RANGED_ATTACK event needs to be added
- 🔶 **Combat Panel UI** - UI needs to support ranged/magic style selection
- 🔶 **Prayer Bonuses** - Magic/ranged multipliers need implementation

#### Missing (Will Need Creation):
- ❌ Rune system (if implementing magic with runes)
- ❌ Spellbook UI/mechanics
- ❌ Ammunition consumption/inventory management
- ❌ Projectile visual rendering
- ❌ Spell casting animations
- ❌ Magic weapon enchantment system

---

### 1.2 Key Files Reference

#### Constants & Configuration

**`/packages/shared/src/constants/CombatConstants.ts`**
```typescript
// Hit delay formulas (OSRS-accurate)
HIT_DELAY: {
  MELEE: 1,
  RANGED_BASE: 1,
  RANGED_DISTANCE_OFFSET: 3,
  RANGED_DISTANCE_DIVISOR: 6,  // Formula: 1 + floor((3 + distance) / 6)
  MAGIC_BASE: 1,
  MAGIC_DISTANCE_OFFSET: 1,
  MAGIC_DISTANCE_DIVISOR: 3,   // Formula: 1 + floor((1 + distance) / 3)
}

// Attack ranges
RANGES: {
  MELEE_RANGE: 1,
  RANGED_RANGE: 10,  // Maximum ranged distance
}

// Animation emotes
EMOTE_RANGED: "ranged"
EMOTE_MAGIC: "magic"

// Combat level calculation
RANGED_MULTIPLIER: 1.5
```

**`/packages/shared/src/constants/WeaponStyleConfig.ts`**
```typescript
// Currently stubs - need full style systems
[WeaponType.BOW]: ["accurate"],      // Should be: accurate, rapid, longrange
[WeaponType.CROSSBOW]: ["accurate"], // Should be: accurate, rapid, longrange
[WeaponType.STAFF]: ["accurate"],    // Should be: accurate, defensive, autocast
[WeaponType.WAND]: ["accurate"],     // Should be: accurate, defensive, autocast
```

#### Types & Enums

**`/packages/shared/src/types/game/item-types.ts`**
```typescript
// AttackType enum (DEFERRED - needs uncommenting)
export enum AttackType {
  MELEE = "melee",
  // RANGED = "ranged",  // Deferred: Re-add when implementing ranged combat
  // MAGIC = "magic",    // Deferred: Re-add when implementing magic combat
}

// WeaponType enum (COMPLETE)
export enum WeaponType {
  NONE = "none",
  SWORD = "sword",
  AXE = "axe",
  // ... melee types ...
  BOW = "bow",        // Ready for ranged
  CROSSBOW = "crossbow",
  STAFF = "staff",    // Ready for magic
  WAND = "wand",
}

// CombatBonuses interface (COMPLETE)
interface CombatBonuses {
  // Attack bonuses
  stab?: number;
  slash?: number;
  crush?: number;
  ranged?: number;      // Ready
  attackMagic?: number; // Ready

  // Defence bonuses
  defenseStab?: number;
  defenseSlash?: number;
  defenseCrush?: number;
  defenseRanged?: number; // Ready
  defenseMagic?: number;  // Ready

  // Strength bonuses
  meleeStrength?: number;
  rangedStrength?: number; // Ready
  magicDamage?: number;    // Ready (percentage)
}
```

#### Hit Delay Calculator

**`/packages/shared/src/utils/game/HitDelayCalculator.ts`**
```typescript
// Ranged hit delay (IMPLEMENTED)
case "ranged":
  delayTicks = HIT_DELAY.RANGED_BASE +
    Math.floor((HIT_DELAY.RANGED_DISTANCE_OFFSET + distance) /
    HIT_DELAY.RANGED_DISTANCE_DIVISOR);
  break;

// Magic hit delay (IMPLEMENTED)
case "magic":
  delayTicks = HIT_DELAY.MAGIC_BASE +
    Math.floor((HIT_DELAY.MAGIC_DISTANCE_OFFSET + distance) /
    HIT_DELAY.MAGIC_DISTANCE_DIVISOR);
  break;

// Projectile system (COMPLETE)
interface ProjectileData {
  id: string;
  sourceId: string;
  targetId: string;
  attackType: AttackType;
  launchTick: number;
  hitTick: number;
  distance: number;
}

function createProjectile(...): ProjectileData  // Ready
function shouldProjectileHit(...): boolean      // Ready
function getProjectileProgress(...): number     // Ready for visual interpolation
```

#### Prayer System

**`/packages/shared/src/types/game/prayer-types.ts`**
```typescript
interface PrayerBonuses {
  attackMultiplier?: number;
  strengthMultiplier?: number;
  defenseMultiplier?: number;
  // Future: rangedMultiplier, magicMultiplier  <-- Noted for expansion
}
```

---

### 1.3 Files to Modify for Implementation

| File | Changes Needed |
|------|----------------|
| `/packages/shared/src/types/game/item-types.ts` | Uncomment RANGED and MAGIC in AttackType enum |
| `/packages/shared/src/utils/game/CombatCalculations.ts` | Add ranged/magic damage calculation branches |
| `/packages/shared/src/systems/shared/combat/CombatSystem.ts` | Extend for non-melee attacks |
| `/packages/shared/src/systems/shared/combat/DamageCalculator.ts` | Add ranged/magic methods |
| `/packages/shared/src/constants/WeaponStyleConfig.ts` | Add full ranged/magic combat styles |
| `/packages/server/world/assets/manifests/items/weapons.json` | Add ranged/magic items |
| `/packages/shared/src/types/events/event-types.ts` | Uncomment COMBAT_RANGED_ATTACK, add COMBAT_MAGIC_ATTACK |
| `/packages/client/src/game/panels/CombatPanel.tsx` | Extend UI for ranged/magic style selection |

---

## 2. OSRS Magic Mechanics

### 2.1 Spellbooks Overview

#### Standard Spellbook
Default spellbook with elemental combat spells (Strike → Bolt → Blast → Wave → Surge).

| Tier | Level Range | Max Hit Range | Rune Cost |
|------|-------------|---------------|-----------|
| Strike | 1-13 | 2-8 | Air + Mind |
| Bolt | 17-35 | 9-12 | Air + Chaos |
| Blast | 41-59 | 13-16 | Air + Death |
| Wave | 62-75 | 17-20 | Air + Blood |
| Surge | 81-95 | 21-24 | Air + Wrath |

**God Spells (Level 60, require staff):**
- Saradomin Strike, Flames of Zamorak, Claws of Guthix
- Base: 20 max hit, with Charge spell: 30 max hit

#### Ancient Magicks
Unlocked after Desert Treasure I. Four elements with special effects:

| Element | Effect |
|---------|--------|
| Smoke | Poison (2-4 damage) |
| Shadow | Reduce Attack (-10% to -15%) |
| Blood | Heal 25% of damage dealt |
| Ice | Freeze (8-32 ticks depending on tier) |

**Tiers:** Rush (single) → Burst (3x3 AoE) → Blitz (single, stronger) → Barrage (3x3 AoE, strongest)

| Spell | Level | Max Hit | AoE |
|-------|-------|---------|-----|
| Ice Rush | 58 | 16 | Single |
| Ice Burst | 70 | 22 | 3x3 |
| Ice Blitz | 82 | 26 | Single |
| Ice Barrage | 94 | 30 | 3x3 |

#### Lunar Spellbook
Primarily utility/support. Combat-relevant spells:
- **Vengeance** (94): Reflect 75% of next hit, 30s cooldown
- **Heal Other** (92): Transfer 75% of your HP to target

#### Arceuus Spellbook
- **Grasp Spells**: Combat + bind chance (10-50%)
- **Demonbane Spells**: +20% accuracy vs demons, up to 30 max hit
- **Thralls**: Summoned companions dealing 1-3 damage

---

### 2.2 Magic Combat Formulas

#### Magic Attack Roll
```
Effective Magic Level = floor(Magic Level * Prayer Modifier) + Stance Bonus + 8
Magic Attack Roll = Effective Magic Level * (Equipment Magic Attack + 64)
```

**Prayer Modifiers:**
| Prayer | Level | Modifier |
|--------|-------|----------|
| Mystic Will | 9 | 1.05 |
| Mystic Lore | 27 | 1.10 |
| Mystic Might | 45 | 1.15 |
| Mystic Vigour | 63 | 1.18 |
| Augury | 77 | 1.25 |

**Stance Bonuses (Powered staves only):**
- Accurate: +3
- Longrange: +1

**Special Modifiers:**
- Void Magic: ×1.45 to effective level
- Slayer Helm (i) on task: ×1.15 to final roll
- Salve Amulet (i) vs undead: ×1.15 to final roll

#### Magic Defence Roll

**For Players:**
```
Effective Defence = floor((0.3 × Defence Level + 0.7 × Magic Level) × Prayer Modifier) + 8
Magic Defence Roll = Effective Defence × (Equipment Magic Defence + 64)
```

**For NPCs:**
```
Magic Defence Roll = (9 + NPC Magic Level) × (NPC Magic Defence + 64)
```
Note: NPC Defence level does NOT affect magic defence.

#### Accuracy Formula
```
If Attack Roll > Defence Roll:
    Accuracy = 1 - (Defence Roll + 2) / (2 × (Attack Roll + 1))

If Attack Roll ≤ Defence Roll:
    Accuracy = Attack Roll / (2 × (Defence Roll + 1))
```

#### Magic Max Hit Formula
```
Base Max Hit = Spell Base Damage

Modifiers (multiplicative, floor after each):
1. Equipment Magic Damage % (Ancestral, Occult, etc.)
2. Void Magic (+2.5%)
3. Salve Amulet (+15-20%)
4. Prayer Bonus (Augury +4%)
5. Slayer Helm (+15% on task)
6. Tome of Fire/Water (+10-50%)
```

---

### 2.3 Casting Mechanics

#### Attack Speeds
| Weapon Type | Speed | Time |
|-------------|-------|------|
| Standard spells | 5 ticks | 3.0s |
| Powered staves (Trident, etc.) | 4 ticks | 2.4s |
| Harmonised Staff | 4 ticks | 2.4s |
| Tumeken's Shadow | 5 ticks | 3.0s |

#### Splash Mechanics
- Splashing = spell hits but deals 0 damage
- Requires ≤-64 magic attack bonus for guaranteed splash
- Still grants base spell XP, no Hitpoints XP
- 20-minute logout timer applies

#### Magic XP
```
Magic XP = Base Spell XP + (2 × Damage Dealt)
Hitpoints XP = 1.33 × Damage Dealt
```

#### Autocast
- Cleared on weapon swap
- Different staves support different spellbooks
- Cannot autocast teleports, curses, enchantments

---

### 2.4 Magic Equipment

#### Damage Bonuses
| Item | Damage Bonus |
|------|--------------|
| Kodai Wand | +15% |
| Staff of the Dead variants | +15% |
| Nightmare Staff variants | +15% |
| Occult Necklace | +5% |
| Tormented Bracelet | +5% |
| Ancestral Robes (full) | +9% (3% per piece) |
| Elite Void Magic | +5% |
| Imbued God Cape | +2% |

#### Powered Staves Max Hit
| Staff | Formula | Example at 99 Magic |
|-------|---------|---------------------|
| Trident of Seas | floor(Magic/3) - 5 | 28 |
| Trident of Swamp | floor(Magic/3) - 2 | 31 |
| Sanguinesti Staff | floor(Magic/3) - 1 | 32 (+ heal 50% on 1/6 hits) |
| Tumeken's Shadow | floor(Magic/3) + 1 | 34 (triples magic bonuses) |

#### Tome Effects
| Tome | Effect |
|------|--------|
| Tome of Fire | +10% damage on fire spells (+50% PvP), infinite fire runes |
| Tome of Water | +10% damage/accuracy on water spells, +20% accuracy on curses |

---

### 2.5 Special Mechanics

#### Freeze Durations
| Spell Tier | Duration | Ticks |
|------------|----------|-------|
| Bind/Rush | 4.8s | 8 |
| Snare/Burst | 9.6s | 16 |
| Entangle/Blitz | 14.4s | 24 |
| Barrage | 19.2s | 32 |

**Freeze Immunity:** 3 ticks (1.8s) after freeze ends in PvP
**Protect from Magic:** Halves freeze duration in PvP

#### Blood Spell Healing
- Base: 25% of damage dealt
- Bloodbark armor: +2% per piece (up to 35%)
- Blood ancient sceptre: Can overheal up to 10% above max HP

#### Vengeance
- Reflects 75% of next melee/ranged hit
- 30-second cooldown
- Takes priority over Ring of Recoil

---

## 3. OSRS Ranged Mechanics

### 3.1 Weapon Categories

#### Bows
| Bow Type | Attack | Speed (Rapid) | Range | Level |
|----------|--------|---------------|-------|-------|
| Shortbow | +8 | 3 ticks | 7 tiles | 1 |
| Magic Shortbow | +69 | 3 ticks | 7 tiles | 50 |
| Magic Shortbow (i) | +75 | 3 ticks | 7 tiles | 50 |
| Crystal Bow | +100 | 4 ticks | 10 tiles | 70 |
| Twisted Bow | +70 | 4 ticks | 10 tiles | 75 |
| Bow of Faerdhinen | +128 | 4 ticks | 10 tiles | 80 |

#### Crossbows
| Crossbow | Attack | Speed (Rapid) | Level |
|----------|--------|---------------|-------|
| Rune Crossbow | +90 | 5 ticks | 61 |
| Dragon Crossbow | +94 | 5 ticks | 64 |
| Armadyl Crossbow | +100 | 5 ticks | 70 |
| Zaryte Crossbow | +110 | 5 ticks | 80 |

#### Thrown Weapons
| Type | Speed (Rapid) | Notes |
|------|---------------|-------|
| Darts | 2 ticks | Fastest, low accuracy |
| Throwing Knives | 2 ticks | Better accuracy than darts |
| Javelins | 6 ticks | For Ballista only |
| Chinchompas | 3 ticks | 3x3 AoE |

#### Special Weapons
| Weapon | Speed | Special Feature |
|--------|-------|-----------------|
| Toxic Blowpipe | 2 ticks (PvM) / 3 ticks (PvP) | Uses darts, venoms |
| Dark Bow | 8 ticks | Fires 2 arrows |
| Ballista | 6 ticks | Uses javelins, high max hit |

---

### 3.2 Ranged Combat Formulas

#### Effective Ranged Level
```
Effective Ranged = floor((Ranged Level + Boost) × Prayer Bonus) + Style Bonus + 8

If Void: Effective Ranged = floor(Effective Ranged × 1.1)
```

**Style Bonuses:**
- Accurate: +3
- Rapid: +0
- Longrange: +0 (but +3 to Defence)

#### Attack Roll
```
Attack Roll = floor(Effective Ranged × (Equipment Ranged Attack + 64) × Gear Bonus)
```

**Gear Bonuses:**
- Slayer Helm (i) on task: ×1.15
- Salve Amulet (ei) vs undead: ×1.20
- Craw's Bow in Wilderness: ×1.5

#### Defence Roll
```
Defence Roll = (Target Defence + 9) × (Target Ranged Defence + 64)
```

#### Max Hit Formula
```
Base Max Hit = floor(0.5 + Effective Ranged × (Ranged Strength + 64) / 640)
Final Max Hit = floor(Base Max Hit × Gear Bonus × Special Bonus)
```

---

### 3.3 Ammunition

#### Arrows
| Arrow | Ranged Strength | Required Bow |
|-------|-----------------|--------------|
| Bronze | +7 | Any |
| Iron | +10 | Any |
| Steel | +16 | Oak+ |
| Mithril | +22 | Willow+ |
| Adamant | +31 | Maple+ |
| Rune | +49 | Yew+ |
| Amethyst | +55 | Magic+ |
| Dragon | +60 | Dark Bow/MSB |

#### Bolts
| Bolt | Ranged Strength | Required Crossbow |
|------|-----------------|-------------------|
| Bronze | +10 | Any |
| Iron | +46 | Iron+ |
| Steel | +64 | Steel+ |
| Mithril | +82 | Mithril+ |
| Adamant | +100 | Adamant+ |
| Runite | +115 | Rune+ |
| Dragon | +122 | Dragon+ |

#### Ammunition Consumption
- Base: 20% chance arrow/bolt is lost per shot
- **Ava's Attractor**: ~60% retrieval
- **Ava's Accumulator**: 72% retrieval
- **Ava's Assembler**: 80% retrieval, no drops

---

### 3.4 Attack Speeds

| Weapon Category | Base | Rapid | Time (Rapid) |
|-----------------|------|-------|--------------|
| Darts/Knives | 3 | 2 | 1.2s |
| Blowpipe (PvM) | 3 | 2 | 1.2s |
| Blowpipe (PvP) | 4 | 3 | 1.8s |
| Shortbows | 4 | 3 | 1.8s |
| Chinchompas | 4 | 3 | 1.8s |
| Composite/Crystal | 5 | 4 | 2.4s |
| Crossbows | 6 | 5 | 3.0s |
| Ballista | 7 | 6 | 3.6s |
| Dark Bow | 9 | 8 | 4.8s |

---

### 3.5 Combat Styles

| Style | Speed | Accuracy | Range | XP Split |
|-------|-------|----------|-------|----------|
| Accurate | Base | +3 invisible | Normal | 4 Ranged, 1.33 HP |
| Rapid | -1 tick | Normal | Normal | 4 Ranged, 1.33 HP |
| Longrange | Base | Normal | +2 tiles | 2 Ranged, 2 Def, 1.33 HP |

---

### 3.6 Ranged Prayers

| Prayer | Level | Attack | Strength | Defence |
|--------|-------|--------|----------|---------|
| Sharp Eye | 8 | +5% | +5% | - |
| Hawk Eye | 26 | +10% | +10% | - |
| Eagle Eye | 44 | +15% | +15% | - |
| Rigour | 74 | +20% | +23% | +25% |

---

### 3.7 Enchanted Bolt Effects

| Bolt | Proc Rate | Effect |
|------|-----------|--------|
| Opal (e) | 5% | +10% ranged level as bonus damage |
| Jade (e) | 6% | Knockdown/immobilize 5s |
| Pearl (e) | 6% | Water damage, bonus vs fiery creatures |
| Emerald (e) | 54% | Apply poison (5 damage) |
| Ruby (e) | 6% PvM / 11% PvP | 20% of target's HP (max 100), costs 10% player HP |
| Diamond (e) | 10% PvM / 5% PvP | Ignore defence, +15% max hit |
| Dragonstone (e) | 6% | +20% ranged level as bonus damage |
| Onyx (e) | 11% PvM / 10% PvP | +20% damage, heal 25% of damage |

**Kandarin Hard Diary:** +10% to all bolt proc rates

---

### 3.8 Special Mechanics

#### Chinchompa AoE
- 3x3 area around primary target
- Single accuracy roll applies to all targets
- Primary hit = all secondary hit; Primary miss = all miss
- Up to 11 targets in PvM, 9 in PvP
- Max hit excludes Salve/Avarice for secondary targets

#### Toxic Blowpipe
- Uses scales (2 per 3 shots average) + darts
- 50% chance to venom
- Special: +100% accuracy, +50% damage, heal 50% of damage (50% spec)
- Nerfed speed in PvP (3 ticks vs 2 ticks)

#### Twisted Bow Scaling
- Damage/accuracy scales with target's Magic level
- Accuracy cap: 140%
- Damage cap: 250%
- Best against high-Magic monsters

---

## 4. F2P Implementation Plan (Levels 1-40)

### Scope Definition

**Target**: Basic OSRS-style ranged and magic combat for levels 1-40
**Goal**: Functional ranged/magic combat with standard bows and combat spells

#### What's IN Scope
- **Ranged Weapons**: Standard bows only (Shortbow, Oak shortbow, Willow shortbow, Maple shortbow)
- **Ammunition**: Standard arrows only (Bronze, Iron, Steel, Mithril, Adamant)
- **Magic Weapons**: Staff, Magic staff, Elemental staves (air/water/earth/fire)
- **Spells**: Combat spells ONLY from Standard Spellbook:
  - Strike tier: Wind Strike (1), Water Strike (5), Earth Strike (9), Fire Strike (13)
  - Bolt tier: Wind Bolt (17), Water Bolt (23), Earth Bolt (29), Fire Bolt (35)
- **Runes**: Air, Water, Earth, Fire, Mind, Chaos (only what combat spells need)
- **Prayers**: Sharp Eye (8), Hawk Eye (26), Mystic Will (9), Mystic Lore (27)
- **Combat Styles**: Accurate/Rapid/Longrange (ranged), Accurate/Longrange/Autocast (magic)

#### What's OUT of Scope (Later Implementation)
- Crossbows and bolts (all types)
- Thrown weapons (darts, knives, javelins)
- Enchanted bolts, special attacks, Ava's devices
- Utility spells (teleports, alchemy, enchantments, etc.)
- Blast/Wave/Surge spells, Ancient Magicks, Lunar spells
- Eagle Eye (44), Rigour (74), Mystic Might (45), Augury (77)
- Powered staves, special weapons (Blowpipe, Crystal bow, etc.)
- Chinchompas, Ballista, Dark bow

---

### Phase 1: Database & Type Foundation

#### 1.1 Database Migration
**File**: `packages/server/src/database/schema.ts`

Add columns to `characters` table:
```sql
magicLevel integer DEFAULT 1
magicXp integer DEFAULT 0
selectedSpell text DEFAULT NULL  -- autocast spell ID
```

**Files to update**:
- `packages/server/src/database/schema.ts` - Add columns
- `packages/server/src/shared/types/database.types.ts` - Update PlayerRow interface
- `packages/server/src/database/repositories/PlayerRepository.ts` - Update save/load

#### 1.2 Type System Updates
**File**: `packages/shared/src/types/game/item-types.ts`

```typescript
// Uncomment in AttackType enum
export enum AttackType {
  MELEE = "melee",
  RANGED = "ranged",  // Uncomment
  MAGIC = "magic",    // Uncomment
}

// Add type guard
export function isValidAttackType(value: string): value is AttackType
```

#### 1.3 Combat Style Types
**File**: `packages/shared/src/types/game/combat-types.ts`

Add:
```typescript
export type RangedCombatStyle = "accurate" | "rapid" | "longrange";
export type MagicCombatStyle = "accurate" | "longrange" | "autocast";

export interface RangedStyleBonus {
  readonly attackBonus: number;      // +3 for accurate, 0 for rapid/longrange
  readonly speedModifier: number;    // -1 for rapid
  readonly rangeModifier: number;    // +2 for longrange
  readonly xpSplit: "ranged" | "ranged_defence";
}

export interface MagicStyleBonus {
  readonly attackBonus: number;
  readonly speedModifier: number;
  readonly rangeModifier: number;
  readonly xpSplit: "magic" | "magic_defence";
}

// Pre-allocated frozen objects for hot path
export const RANGED_STYLE_BONUSES: Record<RangedCombatStyle, RangedStyleBonus>
export const MAGIC_STYLE_BONUSES: Record<MagicCombatStyle, MagicStyleBonus>
```

#### 1.4 Event Types
**File**: `packages/shared/src/types/events/event-types.ts`

Uncomment/add:
```typescript
COMBAT_RANGED_ATTACK = "combat:ranged_attack",
COMBAT_MAGIC_ATTACK = "combat:magic_attack",
COMBAT_PROJECTILE_LAUNCHED = "combat:projectile_launched",
COMBAT_PROJECTILE_HIT = "combat:projectile_hit",
COMBAT_SPELL_CAST = "combat:spell_cast",
COMBAT_AMMO_CONSUMED = "combat:ammo_consumed",
COMBAT_RUNE_CONSUMED = "combat:rune_consumed",
```

#### 1.5 Prayer Bonus Types
**File**: `packages/shared/src/types/game/prayer-types.ts`

Extend `PrayerBonuses`:
```typescript
export interface PrayerCombatBonuses {
  // Existing melee
  attackMultiplier?: number;
  strengthMultiplier?: number;
  defenseMultiplier?: number;

  // Add ranged
  rangedAttackMultiplier?: number;
  rangedStrengthMultiplier?: number;

  // Add magic
  magicAttackMultiplier?: number;
  magicDefenseMultiplier?: number;
}
```

---

### Phase 2: Manifest Data Files

#### 2.1 Ammunition Manifest (Arrows Only)
**File**: `packages/server/world/assets/manifests/ammunition.json`

```json
{
  "arrows": [
    {
      "id": "bronze_arrow",
      "name": "Bronze arrow",
      "rangedStrength": 7,
      "requiredBowTier": 1
    },
    {
      "id": "iron_arrow",
      "name": "Iron arrow",
      "rangedStrength": 10,
      "requiredBowTier": 1
    },
    {
      "id": "steel_arrow",
      "name": "Steel arrow",
      "rangedStrength": 16,
      "requiredBowTier": 5
    },
    {
      "id": "mithril_arrow",
      "name": "Mithril arrow",
      "rangedStrength": 22,
      "requiredBowTier": 20
    },
    {
      "id": "adamant_arrow",
      "name": "Adamant arrow",
      "rangedStrength": 31,
      "requiredBowTier": 30
    }
  ]
}
```

#### 2.2 Runes Manifest (Combat Spell Runes Only)
**File**: `packages/server/world/assets/manifests/runes.json`

```json
{
  "_comment": "Only runes needed for Strike and Bolt combat spells",
  "runes": [
    { "id": "air_rune", "name": "Air rune", "element": "air", "stackable": true },
    { "id": "water_rune", "name": "Water rune", "element": "water", "stackable": true },
    { "id": "earth_rune", "name": "Earth rune", "element": "earth", "stackable": true },
    { "id": "fire_rune", "name": "Fire rune", "element": "fire", "stackable": true },
    { "id": "mind_rune", "name": "Mind rune", "element": null, "stackable": true },
    { "id": "chaos_rune", "name": "Chaos rune", "element": null, "stackable": true }
  ],
  "elementalStaves": [
    { "id": "staff_of_air", "providesInfinite": ["air_rune"] },
    { "id": "staff_of_water", "providesInfinite": ["water_rune"] },
    { "id": "staff_of_earth", "providesInfinite": ["earth_rune"] },
    { "id": "staff_of_fire", "providesInfinite": ["fire_rune"] }
  ]
}
```

#### 2.3 Combat Spells Manifest (Strike + Bolt Only)
**File**: `packages/server/world/assets/manifests/combat-spells.json`

```json
{
  "standard": {
    "strike": [
      {
        "id": "wind_strike",
        "name": "Wind Strike",
        "level": 1,
        "baseMaxHit": 2,
        "baseXp": 5.5,
        "element": "air",
        "attackSpeed": 5,
        "runes": [
          { "runeId": "air_rune", "quantity": 1 },
          { "runeId": "mind_rune", "quantity": 1 }
        ]
      },
      {
        "id": "water_strike",
        "name": "Water Strike",
        "level": 5,
        "baseMaxHit": 4,
        "baseXp": 7.5,
        "element": "water",
        "attackSpeed": 5,
        "runes": [
          { "runeId": "air_rune", "quantity": 1 },
          { "runeId": "water_rune", "quantity": 1 },
          { "runeId": "mind_rune", "quantity": 1 }
        ]
      },
      {
        "id": "earth_strike",
        "name": "Earth Strike",
        "level": 9,
        "baseMaxHit": 6,
        "baseXp": 9.5,
        "element": "earth",
        "attackSpeed": 5,
        "runes": [
          { "runeId": "air_rune", "quantity": 1 },
          { "runeId": "earth_rune", "quantity": 2 },
          { "runeId": "mind_rune", "quantity": 1 }
        ]
      },
      {
        "id": "fire_strike",
        "name": "Fire Strike",
        "level": 13,
        "baseMaxHit": 8,
        "baseXp": 11.5,
        "element": "fire",
        "attackSpeed": 5,
        "runes": [
          { "runeId": "air_rune", "quantity": 2 },
          { "runeId": "fire_rune", "quantity": 3 },
          { "runeId": "mind_rune", "quantity": 1 }
        ]
      }
    ],
    "bolt": [
      {
        "id": "wind_bolt",
        "name": "Wind Bolt",
        "level": 17,
        "baseMaxHit": 9,
        "baseXp": 13.5,
        "element": "air",
        "attackSpeed": 5,
        "runes": [
          { "runeId": "air_rune", "quantity": 2 },
          { "runeId": "chaos_rune", "quantity": 1 }
        ]
      },
      {
        "id": "water_bolt",
        "name": "Water Bolt",
        "level": 23,
        "baseMaxHit": 10,
        "baseXp": 16.5,
        "element": "water",
        "attackSpeed": 5,
        "runes": [
          { "runeId": "air_rune", "quantity": 2 },
          { "runeId": "water_rune", "quantity": 2 },
          { "runeId": "chaos_rune", "quantity": 1 }
        ]
      },
      {
        "id": "earth_bolt",
        "name": "Earth Bolt",
        "level": 29,
        "baseMaxHit": 11,
        "baseXp": 19.5,
        "element": "earth",
        "attackSpeed": 5,
        "runes": [
          { "runeId": "air_rune", "quantity": 2 },
          { "runeId": "earth_rune", "quantity": 3 },
          { "runeId": "chaos_rune", "quantity": 1 }
        ]
      },
      {
        "id": "fire_bolt",
        "name": "Fire Bolt",
        "level": 35,
        "baseMaxHit": 12,
        "baseXp": 22.5,
        "element": "fire",
        "attackSpeed": 5,
        "runes": [
          { "runeId": "air_rune", "quantity": 3 },
          { "runeId": "fire_rune", "quantity": 4 },
          { "runeId": "chaos_rune", "quantity": 1 }
        ]
      }
    ]
  }
}
```

#### 2.4 Weapons Manifest Updates (Bows + Staves Only)
**File**: `packages/server/world/assets/manifests/items/weapons.json`

Add standard bows and magic staves:
```json
// === STANDARD BOWS (no crossbows) ===
{
  "id": "shortbow",
  "name": "Shortbow",
  "type": "weapon",
  "equipSlot": "weapon",
  "weaponType": "bow",
  "attackType": "ranged",
  "attackSpeed": 4,
  "attackRange": 7,
  "bonuses": { "attackRanged": 8 },
  "requirements": { "level": 1, "skills": { "ranged": 1 } }
},
{
  "id": "oak_shortbow",
  "name": "Oak shortbow",
  "attackSpeed": 4,
  "attackRange": 7,
  "bonuses": { "attackRanged": 14 },
  "requirements": { "level": 5, "skills": { "ranged": 5 } }
},
{
  "id": "willow_shortbow",
  "name": "Willow shortbow",
  "attackSpeed": 4,
  "attackRange": 7,
  "bonuses": { "attackRanged": 20 },
  "requirements": { "level": 20, "skills": { "ranged": 20 } }
},
{
  "id": "maple_shortbow",
  "name": "Maple shortbow",
  "attackSpeed": 4,
  "attackRange": 7,
  "bonuses": { "attackRanged": 29 },
  "requirements": { "level": 30, "skills": { "ranged": 30 } }
},

// === MAGIC STAVES ===
{
  "id": "staff",
  "name": "Staff",
  "weaponType": "staff",
  "attackType": "magic",
  "attackSpeed": 5,
  "attackRange": 10,
  "bonuses": { "attackMagic": 4 }
},
{
  "id": "magic_staff",
  "name": "Magic staff",
  "bonuses": { "attackMagic": 10 },
  "requirements": { "level": 1, "skills": { "magic": 1 } }
},

// === ELEMENTAL STAVES (provide infinite runes) ===
{
  "id": "staff_of_air",
  "name": "Staff of air",
  "bonuses": { "attackMagic": 10 },
  "providesInfiniteRunes": ["air_rune"]
},
{
  "id": "staff_of_water",
  "name": "Staff of water",
  "providesInfiniteRunes": ["water_rune"]
},
{
  "id": "staff_of_earth",
  "name": "Staff of earth",
  "providesInfiniteRunes": ["earth_rune"]
},
{
  "id": "staff_of_fire",
  "name": "Staff of fire",
  "providesInfiniteRunes": ["fire_rune"]
}
```

#### 2.5 Prayers Manifest Updates
**File**: `packages/server/world/assets/manifests/prayers.json`

Add ranged/magic prayers (F2P level only):
```json
{
  "id": "sharp_eye",
  "name": "Sharp Eye",
  "description": "Increases your Ranged by 5%",
  "level": 8,
  "category": "ranged",
  "drainEffect": 1,
  "bonuses": {
    "rangedAttackMultiplier": 1.05,
    "rangedStrengthMultiplier": 1.05
  },
  "conflicts": ["hawk_eye"]
},
{
  "id": "hawk_eye",
  "name": "Hawk Eye",
  "description": "Increases your Ranged by 10%",
  "level": 26,
  "category": "ranged",
  "drainEffect": 6,
  "bonuses": {
    "rangedAttackMultiplier": 1.10,
    "rangedStrengthMultiplier": 1.10
  },
  "conflicts": ["sharp_eye"]
},
{
  "id": "mystic_will",
  "name": "Mystic Will",
  "description": "Increases your Magic attack and defence by 5%",
  "level": 9,
  "category": "magic",
  "drainEffect": 1,
  "bonuses": {
    "magicAttackMultiplier": 1.05,
    "magicDefenseMultiplier": 1.05
  },
  "conflicts": ["mystic_lore"]
},
{
  "id": "mystic_lore",
  "name": "Mystic Lore",
  "description": "Increases your Magic attack and defence by 10%",
  "level": 27,
  "category": "magic",
  "drainEffect": 6,
  "bonuses": {
    "magicAttackMultiplier": 1.10,
    "magicDefenseMultiplier": 1.10
  },
  "conflicts": ["mystic_will"]
}
```

---

### Phase 3: Server Combat Systems

#### 3.1 RangedDamageCalculator
**File**: `packages/shared/src/systems/shared/combat/RangedDamageCalculator.ts`

```typescript
/**
 * OSRS-accurate ranged damage formulas
 *
 * Effective Level = floor(rangedLevel * prayerBonus) + styleBonus + 8
 * Attack Roll = effectiveLevel * (equipmentBonus + 64)
 * Defense Roll = (defenseLevel + 9) * (rangedDefenseBonus + 64)
 *
 * Hit Chance:
 *   if attackRoll > defenseRoll: 1 - (defenseRoll + 2) / (2 * (attackRoll + 1))
 *   else: attackRoll / (2 * (defenseRoll + 1))
 *
 * Max Hit = floor(0.5 + effectiveStr * (strengthBonus + 64) / 640)
 */

export interface RangedDamageParams {
  rangedLevel: number;
  rangedAttackBonus: number;
  rangedStrengthBonus: number;  // From ammo
  style: RangedCombatStyle;
  targetDefenseLevel: number;
  targetRangedDefenseBonus: number;
  prayerBonuses?: PrayerCombatBonuses;
}

export interface RangedDamageResult {
  damage: number;
  maxHit: number;
  didHit: boolean;
  hitChance: number;
}

export function calculateRangedDamage(params: RangedDamageParams, rng: SeededRandom): RangedDamageResult
```

#### 3.2 MagicDamageCalculator
**File**: `packages/shared/src/systems/shared/combat/MagicDamageCalculator.ts`

```typescript
/**
 * OSRS-accurate magic damage formulas
 *
 * Key difference: Magic defense = 0.7 * magicLevel + 0.3 * defenseLevel (players)
 * NPCs use only magic level for defense
 *
 * Effective Level = floor(magicLevel * prayerBonus) + styleBonus + 8
 * Attack Roll = effectiveLevel * (magicAttackBonus + 64)
 * Defense Roll (player) = floor(0.7 * magicLevel + 0.3 * defenseLevel + 9) * (magicDefenseBonus + 64)
 * Defense Roll (NPC) = (magicLevel + 9) * (magicDefenseBonus + 64)
 *
 * Max Hit = spell base damage (from manifest)
 */

export interface MagicDamageParams {
  magicLevel: number;
  magicAttackBonus: number;
  style: MagicCombatStyle;
  spellBaseMaxHit: number;
  targetType: "player" | "npc";
  targetMagicLevel: number;
  targetDefenseLevel: number;
  targetMagicDefenseBonus: number;
  prayerBonuses?: PrayerCombatBonuses;
}

export interface MagicDamageResult {
  damage: number;
  maxHit: number;
  didHit: boolean;
  hitChance: number;
  splashed: boolean;  // Hit but 0 damage
}

export function calculateMagicDamage(params: MagicDamageParams, rng: SeededRandom): MagicDamageResult
```

#### 3.3 AmmunitionService (Arrows Only)
**File**: `packages/shared/src/systems/shared/combat/AmmunitionService.ts`

```typescript
/**
 * Handles arrow consumption for standard bows
 * Scope: Arrows only (no bolts, no thrown weapons)
 * No Ava's device = 100% consumption rate (1 arrow per shot)
 */

export class AmmunitionService {
  validateArrows(bow: Item, arrowSlot: EquipmentSlot | null): { valid: boolean; error?: string }
  consumeArrow(playerId: string, world: World): { success: boolean; rangedStrengthBonus: number; remainingQuantity: number }
  hasArrows(playerId: string, world: World): boolean
  getArrowStrengthBonus(playerId: string, world: World): number
}
```

#### 3.4 RuneService
**File**: `packages/shared/src/systems/shared/combat/RuneService.ts`

```typescript
/**
 * Handles rune validation and consumption for spellcasting
 */

export interface RuneRequirement {
  runeId: string;
  quantity: number;
}

export class RuneService {
  hasRequiredRunes(playerId: string, requirements: RuneRequirement[], world: World): { valid: boolean; missing?: RuneRequirement[] }
  consumeRunes(playerId: string, requirements: RuneRequirement[], world: World): { success: boolean; error?: string }
  getInfiniteRunesFromStaff(playerId: string, world: World): string[]
}
```

#### 3.5 SpellService
**File**: `packages/shared/src/systems/shared/combat/SpellService.ts`

```typescript
/**
 * Manages spell data and validation
 */

export interface Spell {
  id: string;
  name: string;
  level: number;
  baseMaxHit: number;
  baseXp: number;
  element: string;
  attackSpeed: number;
  runes: RuneRequirement[];
}

export class SpellService {
  getSpell(spellId: string): Spell | undefined
  getAvailableSpells(magicLevel: number): Spell[]
  canCastSpell(playerId: string, spellId: string, world: World): { valid: boolean; error?: string; errorCode?: string }
}
```

#### 3.6 ProjectileService
**File**: `packages/shared/src/systems/shared/combat/ProjectileService.ts`

```typescript
/**
 * Manages projectile creation and hit timing
 * Uses existing HitDelayCalculator formulas
 */

export interface Projectile {
  id: string;
  sourceId: string;
  targetId: string;
  attackType: AttackType;
  launchTick: number;
  hitTick: number;
  distance: number;
  damage: number;  // Pre-calculated, applied on hit
}

export class ProjectileService {
  private activeProjectiles: Map<string, Projectile> = new Map();
  createProjectile(params: { sourceId: string; targetId: string; attackType: AttackType; distance: number; damage: number; currentTick: number }): Projectile
  processTick(currentTick: number): Projectile[]
  cancelProjectilesForTarget(targetId: string): void
}
```

---

### Phase 4: CombatSystem Integration

#### 4.1 Update CombatSystem
**File**: `packages/shared/src/systems/shared/combat/CombatSystem.ts`

Add methods:
```typescript
validateRangedAttack(attackerId: string, targetId: string, currentTick: number): ValidationResult
validateMagicAttack(attackerId: string, targetId: string, spellId: string, currentTick: number): ValidationResult
executeRangedAttack(validation: ValidationResult, currentTick: number): void
executeMagicAttack(validation: ValidationResult, spellId: string, currentTick: number): void

// Route attacks by weapon type
private routeAttack(attackerId: string, targetId: string, currentTick: number): void {
  const weapon = this.getEquippedWeapon(attackerId);
  const attackType = weapon?.attackType ?? AttackType.MELEE;

  switch (attackType) {
    case AttackType.MELEE:
      this.handleMeleeAttack({ attackerId, targetId, currentTick });
      break;
    case AttackType.RANGED:
      this.handleRangedAttack({ attackerId, targetId, currentTick });
      break;
    case AttackType.MAGIC:
      this.handleMagicAttack({ attackerId, targetId, currentTick });
      break;
  }
}
```

#### 4.2 Update WeaponStyleConfig
**File**: `packages/shared/src/constants/WeaponStyleConfig.ts`

```typescript
[WeaponType.BOW]: ["accurate", "rapid", "longrange"],
[WeaponType.STAFF]: ["accurate", "longrange"],  // autocast handled separately
[WeaponType.WAND]: ["accurate", "longrange"],
[WeaponType.CROSSBOW]: ["accurate"],  // Future: add when crossbows implemented
```

---

### Phase 5: Network Handlers

#### 5.1 Server Network Handlers
**File**: `packages/server/src/systems/ServerNetwork/index.ts`

Add handlers:
```typescript
socket.on("onRangedAttack", (data) => handleRangedAttack(socket, data, world));
socket.on("onMagicAttack", (data) => handleMagicAttack(socket, data, world));
socket.on("onSetAutocast", (data) => handleSetAutocast(socket, data, world));
socket.on("onClearAutocast", (data) => handleClearAutocast(socket, data, world));
```

#### 5.2 Combat Handlers
**File**: `packages/server/src/systems/ServerNetwork/handlers/combat.ts`

```typescript
export async function handleRangedAttack(socket, data: { targetId: string }, world): Promise<void>
export async function handleMagicAttack(socket, data: { targetId: string; spellId: string }, world): Promise<void>
export async function handleSetAutocast(socket, data: { spellId: string | null }, world): Promise<void>
```

#### 5.3 Packet Definitions

```typescript
// === CLIENT → SERVER ===
interface RangedAttackPacket { type: "onRangedAttack"; targetId: string }
interface MagicAttackPacket { type: "onMagicAttack"; targetId: string; spellId: string }
interface SetAutocastPacket { type: "onSetAutocast"; spellId: string | null }

// === SERVER → CLIENT ===
interface ProjectileLaunchedPacket {
  type: "projectileLaunched";
  projectileId: string;
  sourceId: string;
  targetId: string;
  projectileType: "arrow" | "spell";
  spellId?: string;
  startPosition: Position3D;
  endPosition: Position3D;
  duration: number;
}
interface ProjectileHitPacket { type: "projectileHit"; projectileId: string; targetId: string; damage: number }
interface ArrowConsumedPacket { type: "arrowConsumed"; playerId: string; arrowId: string; remainingQuantity: number }
interface RunesConsumedPacket { type: "runesConsumed"; playerId: string; consumed: { runeId: string; quantity: number }[] }
interface AutocastSetPacket { type: "autocastSet"; playerId: string; spellId: string | null }
```

---

### Phase 6: Client Systems

#### 6.1 ProjectileRenderer (Sprite-Based MVP)
**File**: `packages/shared/src/systems/client/ProjectileRenderer.ts`

```typescript
/**
 * ProjectileRenderer - Renders arrows and spell projectiles
 *
 * MVP Implementation: THREE.Sprite based (similar to DamageSplatSystem)
 * Future Enhancement: Add particle trails using existing Particles.ts
 */

interface ActiveProjectile {
  sprite: THREE.Sprite;
  startPos: THREE.Vector3;
  endPos: THREE.Vector3;
  startTime: number;
  duration: number;
  type: "arrow" | "spell";
  spellId?: string;
}

export class ProjectileRenderer extends System {
  // Pre-created textures (avoid per-projectile allocation)
  private arrowTexture: THREE.Texture | null = null;
  private spellTextures: Map<string, THREE.Texture> = new Map();

  // Arrow: Arc trajectory, rotate to face direction
  // Spell: Straight line, colored by element, additive blending
}
```

#### 6.2 Update CombatPanel
**File**: `packages/client/src/game/panels/CombatPanel.tsx`

```typescript
const RANGED_STYLES = [
  { id: "accurate", name: "Accurate", description: "+3 Ranged, Ranged XP" },
  { id: "rapid", name: "Rapid", description: "Faster attack, Ranged XP" },
  { id: "longrange", name: "Longrange", description: "+2 Range, Ranged + Def XP" },
];

const MAGIC_STYLES = [
  { id: "accurate", name: "Accurate", description: "+3 Magic, Magic XP" },
  { id: "longrange", name: "Longrange", description: "+2 Range, Magic + Def XP" },
];
```

---

### Phase 7: Projectile Visual System

#### 7.1 Existing Infrastructure
The codebase already has:
- `packages/shared/src/systems/shared/presentation/Particles.ts` - Full GPU particle system
- `packages/shared/src/systems/client/DamageSplatSystem.ts` - THREE.Sprite pattern

#### 7.2 Visual Effect Options

**Option A: Simple Sprites (Recommended for F2P MVP)**
- Matches OSRS visual style (simple, not flashy)
- Uses existing DamageSplatSystem pattern
- Arrow: Brown elongated sprite, arc trajectory, rotates to face direction
- Spell: Colored circular sprite with glow

**Option B: Sprites + Particle Trails (Enhanced)**
- Main projectile: THREE.Sprite
- Trail: Particle emitter using existing Particles.ts
- Fire: Orange sparks, Water: Blue droplets, Earth: Brown dust, Wind: White wisps

**Option C: WebGPU Compute Particles (Future)**
- For large-scale effects (boss spells, mass combat, barrage spells)
- Defer to future enhancement

#### 7.3 Spell Visual Configuration
**File**: `packages/shared/src/data/spell-visuals.ts`

```typescript
export const SPELL_VISUALS: Record<string, SpellVisualConfig> = {
  wind_strike: { color: 0xcccccc, size: 0.15, glowIntensity: 0.2 },
  water_strike: { color: 0x3b82f6, size: 0.15, glowIntensity: 0.3 },
  earth_strike: { color: 0x8b4513, size: 0.15, glowIntensity: 0.1 },
  fire_strike: { color: 0xff4500, size: 0.15, glowIntensity: 0.5 },
  wind_bolt: { color: 0xcccccc, size: 0.22, glowIntensity: 0.3 },
  water_bolt: { color: 0x3b82f6, size: 0.22, glowIntensity: 0.4 },
  earth_bolt: { color: 0x8b4513, size: 0.22, glowIntensity: 0.2 },
  fire_bolt: { color: 0xff4500, size: 0.22, glowIntensity: 0.6 },
};

export const ARROW_VISUAL = {
  color: 0x8b4513,
  length: 0.4,
  width: 0.08,
  rotateToDirection: true,
};
```

---

### Phase 8: Testing

#### Unit Tests
- [ ] RangedDamageCalculator: effective level formula
- [ ] RangedDamageCalculator: attack roll formula
- [ ] RangedDamageCalculator: max hit formula
- [ ] RangedDamageCalculator: hit chance formula
- [ ] MagicDamageCalculator: player defense = 0.7 * magic + 0.3 * defense
- [ ] MagicDamageCalculator: NPC defense uses only magic level
- [ ] AmmunitionService: validateArrows rejects if no arrows equipped
- [ ] AmmunitionService: consumeArrow decrements quantity
- [ ] RuneService: hasRequiredRunes accounts for elemental staff
- [ ] RuneService: consumeRunes removes correct quantities
- [ ] SpellService: canCastSpell rejects if magic level too low
- [ ] ProjectileService: hit delay formulas

#### Integration Tests
- [ ] Equip shortbow + arrows, attack mob, verify damage and consumption
- [ ] Equip staff, cast Fire Strike, verify rune consumption
- [ ] Equip staff of fire, cast Fire Strike, verify only mind runes consumed
- [ ] Run out of arrows → attack stops
- [ ] Run out of runes → spell fails
- [ ] Rapid style → attacks faster
- [ ] Longrange style → +2 range

#### E2E Tests (Playwright)
- [ ] Full ranged combat flow
- [ ] Full magic combat flow
- [ ] Autocast flow
- [ ] Combat panel style selection

---

### Implementation Order

| Step | Task | Dependencies |
|------|------|--------------|
| 1 | Database migration | None |
| 2 | Type system updates | None |
| 3 | Manifest files | None |
| 4 | Weapon/prayer manifest updates | Step 3 |
| 5 | RangedDamageCalculator | Step 2 |
| 6 | MagicDamageCalculator | Step 2 |
| 7 | AmmunitionService | Step 3 |
| 8 | RuneService | Step 3 |
| 9 | SpellService | Step 3 |
| 10 | ProjectileService | Step 2 |
| 11 | CombatSystem integration | Steps 5-10 |
| 12 | Network handlers | Step 11 |
| 13 | ProjectileRenderer (client) | Step 12 |
| 14 | UI updates | Step 12 |
| 15 | Animation/effects | Step 13 |
| 16 | Testing | All |

---

### Files Summary

#### New Files to Create (11)
- `packages/server/world/assets/manifests/ammunition.json`
- `packages/server/world/assets/manifests/runes.json`
- `packages/server/world/assets/manifests/combat-spells.json`
- `packages/shared/src/systems/shared/combat/RangedDamageCalculator.ts`
- `packages/shared/src/systems/shared/combat/MagicDamageCalculator.ts`
- `packages/shared/src/systems/shared/combat/AmmunitionService.ts`
- `packages/shared/src/systems/shared/combat/RuneService.ts`
- `packages/shared/src/systems/shared/combat/SpellService.ts`
- `packages/shared/src/systems/shared/combat/ProjectileService.ts`
- `packages/client/src/game/systems/ProjectileRenderer.ts`
- `packages/shared/src/data/spell-visuals.ts`

#### Files to Modify (15)
- `packages/server/src/database/schema.ts`
- `packages/server/src/shared/types/database.types.ts`
- `packages/shared/src/types/game/item-types.ts`
- `packages/shared/src/types/game/combat-types.ts`
- `packages/shared/src/types/events/event-types.ts`
- `packages/shared/src/types/game/prayer-types.ts`
- `packages/shared/src/constants/WeaponStyleConfig.ts`
- `packages/shared/src/utils/game/CombatCalculations.ts`
- `packages/shared/src/systems/shared/combat/CombatSystem.ts`
- `packages/shared/src/systems/shared/combat/CombatAnimationManager.ts`
- `packages/server/src/systems/ServerNetwork/index.ts`
- `packages/server/src/systems/ServerNetwork/handlers/combat.ts`
- `packages/server/world/assets/manifests/prayers.json`
- `packages/server/world/assets/manifests/items/weapons.json`
- `packages/client/src/game/panels/CombatPanel.tsx`

---

## 5. Full Reference Implementation (Post-F2P)

The sections below contain the original comprehensive research for future implementation beyond F2P scope (crossbows, bolts, enchanted ammunition, advanced spells, etc.).

---

### 5.1 Combat Style Types (Full Version)
**File:** `/packages/shared/src/types/game/combat-types.ts`

```typescript
/**
 * Ranged combat styles with OSRS-accurate bonuses
 */
export type RangedCombatStyle = "accurate" | "rapid" | "longrange";

/**
 * Magic combat styles
 */
export type MagicCombatStyle = "accurate" | "longrange" | "autocast";

/**
 * Style bonus configuration - pre-allocated, frozen objects
 */
export interface RangedStyleBonus {
  readonly attackBonus: number;      // Invisible ranged level bonus
  readonly speedModifier: number;    // -1 for rapid
  readonly rangeModifier: number;    // +2 for longrange
  readonly xpSplit: "ranged" | "ranged_defence";
}

export interface MagicStyleBonus {
  readonly attackBonus: number;
  readonly speedModifier: number;
  readonly rangeModifier: number;
  readonly xpSplit: "magic" | "magic_defence";
}

/**
 * Pre-allocated frozen style bonuses (no allocations in hot path)
 */
export const RANGED_STYLE_BONUSES: Readonly<Record<RangedCombatStyle, Readonly<RangedStyleBonus>>> = Object.freeze({
  accurate: Object.freeze({ attackBonus: 3, speedModifier: 0, rangeModifier: 0, xpSplit: "ranged" }),
  rapid: Object.freeze({ attackBonus: 0, speedModifier: -1, rangeModifier: 0, xpSplit: "ranged" }),
  longrange: Object.freeze({ attackBonus: 0, speedModifier: 0, rangeModifier: 2, xpSplit: "ranged_defence" }),
});

export const MAGIC_STYLE_BONUSES: Readonly<Record<MagicCombatStyle, Readonly<MagicStyleBonus>>> = Object.freeze({
  accurate: Object.freeze({ attackBonus: 3, speedModifier: 0, rangeModifier: 0, xpSplit: "magic" }),
  longrange: Object.freeze({ attackBonus: 1, speedModifier: 0, rangeModifier: 2, xpSplit: "magic_defence" }),
  autocast: Object.freeze({ attackBonus: 0, speedModifier: 0, rangeModifier: 0, xpSplit: "magic" }),
});
```

#### 1.3 Add Combat Events
**File:** `/packages/shared/src/types/events/event-types.ts`

```typescript
// Combat events
COMBAT_RANGED_ATTACK = "combat:ranged_attack",
COMBAT_MAGIC_ATTACK = "combat:magic_attack",
COMBAT_PROJECTILE_LAUNCHED = "combat:projectile_launched",
COMBAT_PROJECTILE_HIT = "combat:projectile_hit",
COMBAT_SPELL_CAST = "combat:spell_cast",
COMBAT_AMMO_CONSUMED = "combat:ammo_consumed",
COMBAT_RUNE_CONSUMED = "combat:rune_consumed",
```

#### 1.4 Update Prayer Bonuses Interface
**File:** `/packages/shared/src/types/game/prayer-types.ts`

```typescript
/**
 * Complete prayer bonus interface for all combat styles
 */
export interface PrayerCombatBonuses {
  // Melee bonuses
  readonly attackMultiplier?: number;
  readonly strengthMultiplier?: number;
  readonly defenseMultiplier?: number;

  // Ranged bonuses
  readonly rangedAttackMultiplier?: number;
  readonly rangedStrengthMultiplier?: number;

  // Magic bonuses
  readonly magicAttackMultiplier?: number;
  readonly magicDamageMultiplier?: number;
  readonly magicDefenseMultiplier?: number;
}
```

---

### Phase 2: Damage Calculation System

**Goal:** OSRS-accurate damage formulas with proper separation of concerns.

#### 2.1 Create RangedDamageCalculator
**File:** `/packages/shared/src/systems/shared/combat/RangedDamageCalculator.ts`

```typescript
/**
 * RangedDamageCalculator - OSRS-accurate ranged damage formulas
 *
 * Single Responsibility: Only handles ranged damage calculations
 * Pure functions: No side effects, deterministic output
 *
 * @see https://oldschool.runescape.wiki/w/Damage_per_second/Ranged
 */

import { SeededRandom, getGameRng } from "../../../utils/SeededRandom";
import { RANGED_STYLE_BONUSES, RangedCombatStyle } from "../../../types/game/combat-types";
import type { PrayerCombatBonuses } from "../../../types/game/prayer-types";

// Pre-allocated result object for hot path (reused, not created per call)
const _damageResult: RangedDamageResult = {
  damage: 0,
  maxHit: 0,
  didHit: false,
  hitChance: 0,
  ammoCost: 0,
  specialProc: null,
};

export interface RangedDamageResult {
  damage: number;
  maxHit: number;
  didHit: boolean;
  hitChance: number;
  ammoCost: number;
  specialProc: BoltSpecialEffect | null;
}

export interface RangedAttackParams {
  // Attacker stats
  rangedLevel: number;
  rangedAttackBonus: number;
  rangedStrengthBonus: number;
  style: RangedCombatStyle;

  // Target stats
  targetDefenseLevel: number;
  targetRangedDefenseBonus: number;

  // Optional modifiers
  prayerBonuses?: PrayerCombatBonuses;
  voidBonus?: number;         // 1.0, 1.1, or 1.125
  slayerBonus?: number;       // 1.0 or 1.15
  salveBonus?: number;        // 1.0, 1.167, or 1.2
  specialBonus?: number;      // Special attack multiplier

  // Bolt spec (optional)
  boltType?: EnchantedBoltType;
  kandarinDiary?: boolean;
}

/**
 * Calculate effective ranged level (used for both attack roll and max hit)
 * Formula: floor((level + boost) * prayer) + style + 8
 */
function calculateEffectiveRangedLevel(
  rangedLevel: number,
  style: RangedCombatStyle,
  prayerMultiplier: number,
  voidMultiplier: number,
): number {
  const styleBonus = RANGED_STYLE_BONUSES[style];
  const boosted = Math.floor(rangedLevel * prayerMultiplier);
  const withStyle = boosted + styleBonus.attackBonus + 8;
  return Math.floor(withStyle * voidMultiplier);
}

/**
 * Calculate ranged attack roll
 * Formula: effectiveLevel * (equipmentBonus + 64) * gearBonuses
 */
function calculateAttackRoll(
  effectiveLevel: number,
  equipmentBonus: number,
  slayerBonus: number,
  salveBonus: number,
): number {
  const baseRoll = effectiveLevel * (equipmentBonus + 64);
  // Slayer and Salve don't stack - use highest
  const gearBonus = Math.max(slayerBonus, salveBonus);
  return Math.floor(baseRoll * gearBonus);
}

/**
 * Calculate ranged defense roll
 * Formula: (defenseLevel + 9) * (defenseBonus + 64)
 */
function calculateDefenseRoll(
  defenseLevel: number,
  defenseBonus: number,
): number {
  return (defenseLevel + 9) * (defenseBonus + 64);
}

/**
 * Calculate hit chance using OSRS formula
 */
function calculateHitChance(attackRoll: number, defenseRoll: number): number {
  if (attackRoll > defenseRoll) {
    return 1 - (defenseRoll + 2) / (2 * (attackRoll + 1));
  }
  return attackRoll / (2 * (defenseRoll + 1));
}

/**
 * Calculate ranged max hit
 * Formula: floor(0.5 + effectiveStr * (strBonus + 64) / 640) * modifiers
 */
function calculateMaxHit(
  effectiveStrength: number,
  strengthBonus: number,
  slayerBonus: number,
  salveBonus: number,
  specialBonus: number,
): number {
  const baseHit = Math.floor(0.5 + effectiveStrength * (strengthBonus + 64) / 640);
  const gearBonus = Math.max(slayerBonus, salveBonus);
  return Math.floor(Math.floor(baseHit * gearBonus) * specialBonus);
}

/**
 * Main ranged damage calculation - reuses pre-allocated result object
 */
export function calculateRangedDamage(
  params: RangedAttackParams,
  rng?: SeededRandom,
): RangedDamageResult {
  const random = rng ?? getGameRng();

  // Extract prayer bonuses with defaults
  const prayerAttack = params.prayerBonuses?.rangedAttackMultiplier ?? 1.0;
  const prayerStrength = params.prayerBonuses?.rangedStrengthMultiplier ?? 1.0;
  const voidBonus = params.voidBonus ?? 1.0;
  const slayerBonus = params.slayerBonus ?? 1.0;
  const salveBonus = params.salveBonus ?? 1.0;
  const specialBonus = params.specialBonus ?? 1.0;

  // Calculate effective levels
  const effectiveAttack = calculateEffectiveRangedLevel(
    params.rangedLevel, params.style, prayerAttack, voidBonus
  );
  const effectiveStrength = calculateEffectiveRangedLevel(
    params.rangedLevel, params.style, prayerStrength, voidBonus
  );

  // Calculate rolls
  const attackRoll = calculateAttackRoll(
    effectiveAttack, params.rangedAttackBonus, slayerBonus, salveBonus
  );
  const defenseRoll = calculateDefenseRoll(
    params.targetDefenseLevel, params.targetRangedDefenseBonus
  );

  // Calculate hit chance and max hit
  const hitChance = calculateHitChance(attackRoll, defenseRoll);
  const maxHit = calculateMaxHit(
    effectiveStrength, params.rangedStrengthBonus, slayerBonus, salveBonus, specialBonus
  );

  // Roll for hit
  const didHit = random.random() < hitChance;

  // Roll damage if hit
  let damage = 0;
  if (didHit) {
    damage = random.range(0, maxHit);
  }

  // Check bolt special effect (rolls independently of accuracy)
  let specialProc: BoltSpecialEffect | null = null;
  if (params.boltType) {
    specialProc = rollBoltSpecial(params.boltType, params.kandarinDiary ?? false, random);
    if (specialProc) {
      // Apply bolt special damage/effects
      damage = applyBoltSpecial(damage, maxHit, specialProc, params);
    }
  }

  // Reuse pre-allocated result object
  _damageResult.damage = damage;
  _damageResult.maxHit = maxHit;
  _damageResult.didHit = didHit || specialProc !== null;
  _damageResult.hitChance = hitChance;
  _damageResult.ammoCost = 1;
  _damageResult.specialProc = specialProc;

  return _damageResult;
}
```

#### 2.2 Create MagicDamageCalculator
**File:** `/packages/shared/src/systems/shared/combat/MagicDamageCalculator.ts`

```typescript
/**
 * MagicDamageCalculator - OSRS-accurate magic damage formulas
 *
 * Key differences from ranged:
 * - Magic defense = 0.7 * Magic + 0.3 * Defense (for players)
 * - NPCs use only Magic level for defense
 * - Max hit comes from spell, not equipment (except powered staves)
 * - Magic damage % is applied multiplicatively
 *
 * @see https://oldschool.runescape.wiki/w/Damage_per_second/Magic
 */

export interface MagicDamageResult {
  damage: number;
  maxHit: number;
  didHit: boolean;
  hitChance: number;
  runeCost: RuneCost[];
  splashed: boolean;
  specialEffect: SpellEffect | null;
}

export interface MagicAttackParams {
  // Attacker stats
  magicLevel: number;
  magicAttackBonus: number;
  magicDamagePercent: number;  // Equipment magic damage %
  style: MagicCombatStyle;

  // Spell info
  spellId: string;
  spellBaseMaxHit: number;
  spellType: SpellType;

  // Target stats (player or NPC)
  targetType: "player" | "npc";
  targetMagicLevel: number;
  targetDefenseLevel: number;    // Only used for players
  targetMagicDefenseBonus: number;

  // Optional modifiers
  prayerBonuses?: PrayerCombatBonuses;
  voidBonus?: number;
  slayerBonus?: number;
  salveBonus?: number;
  tomeBonus?: number;           // Tome of Fire/Water
  chaosGauntlets?: boolean;     // +3 to bolt spells
  chargeActive?: boolean;       // +10 to god spells
}

/**
 * Calculate magic defense roll
 * Players: floor(0.7 * magic + 0.3 * defense) * (bonus + 64)
 * NPCs: (magic + 9) * (bonus + 64)
 */
function calculateMagicDefenseRoll(
  targetType: "player" | "npc",
  magicLevel: number,
  defenseLevel: number,
  defenseBonus: number,
  defenderPrayerBonus: number = 1.0,
): number {
  if (targetType === "npc") {
    // NPCs: only magic level matters
    return (magicLevel + 9) * (defenseBonus + 64);
  }

  // Players: 70% magic, 30% defense
  const effectiveLevel = Math.floor(
    (0.7 * magicLevel + 0.3 * defenseLevel) * defenderPrayerBonus
  ) + 9;
  return effectiveLevel * (defenseBonus + 64);
}

/**
 * Calculate magic max hit with all modifiers
 * Order matters - floor after each step
 */
function calculateMagicMaxHit(
  baseMaxHit: number,
  magicDamagePercent: number,
  voidBonus: number,
  slayerBonus: number,
  salveBonus: number,
  tomeBonus: number,
  prayerDamageBonus: number,
  chaosGauntletsBonus: number,
  chargeBonus: number,
): number {
  let maxHit = baseMaxHit;

  // Add flat bonuses first
  maxHit += chaosGauntletsBonus;  // +3 for bolt spells
  maxHit += chargeBonus;          // +10 for charged god spells

  // Apply multiplicative bonuses in order (floor after each)
  maxHit = Math.floor(maxHit * (1 + magicDamagePercent / 100));
  maxHit = Math.floor(maxHit * voidBonus);
  maxHit = Math.floor(maxHit * Math.max(slayerBonus, salveBonus));
  maxHit = Math.floor(maxHit * (1 + prayerDamageBonus));
  maxHit = Math.floor(maxHit * tomeBonus);

  return maxHit;
}
```

---

### Phase 3: Ammunition & Rune Systems

**Goal:** Manifest-driven consumable management with proper inventory integration.

#### 3.1 Ammunition Manifest Schema
**File:** `/packages/server/world/assets/manifests/ammunition.json`

```json
{
  "$schema": "./ammunition.schema.json",
  "arrows": [
    {
      "id": "bronze_arrow",
      "name": "Bronze arrow",
      "rangedStrength": 7,
      "requiredBowLevel": 1,
      "stackable": true,
      "maxStack": 2147483647
    },
    {
      "id": "iron_arrow",
      "name": "Iron arrow",
      "rangedStrength": 10,
      "requiredBowLevel": 1
    },
    {
      "id": "rune_arrow",
      "name": "Rune arrow",
      "rangedStrength": 49,
      "requiredBowLevel": 40
    },
    {
      "id": "dragon_arrow",
      "name": "Dragon arrow",
      "rangedStrength": 60,
      "requiredBowLevel": 60
    }
  ],
  "bolts": [
    {
      "id": "bronze_bolts",
      "name": "Bronze bolts",
      "rangedStrength": 10,
      "requiredCrossbowLevel": 1
    },
    {
      "id": "ruby_bolts_e",
      "name": "Ruby bolts (e)",
      "rangedStrength": 103,
      "requiredCrossbowLevel": 46,
      "enchanted": true,
      "specialEffect": {
        "name": "Blood Forfeit",
        "procRatePvM": 0.06,
        "procRatePvP": 0.11,
        "effect": "blood_forfeit",
        "damagePercent": 20,
        "damageCap": 100,
        "selfDamagePercent": 10
      }
    },
    {
      "id": "diamond_bolts_e",
      "name": "Diamond bolts (e)",
      "rangedStrength": 105,
      "requiredCrossbowLevel": 46,
      "enchanted": true,
      "specialEffect": {
        "name": "Armour Piercing",
        "procRatePvM": 0.10,
        "procRatePvP": 0.05,
        "effect": "armour_piercing",
        "bonusDamagePercent": 15,
        "ignoresDefense": true
      }
    }
  ]
}
```

#### 3.2 Rune Manifest Schema
**File:** `/packages/server/world/assets/manifests/runes.json`

```json
{
  "$schema": "./runes.schema.json",
  "runes": [
    { "id": "air_rune", "name": "Air rune", "element": "air" },
    { "id": "water_rune", "name": "Water rune", "element": "water" },
    { "id": "earth_rune", "name": "Earth rune", "element": "earth" },
    { "id": "fire_rune", "name": "Fire rune", "element": "fire" },
    { "id": "mind_rune", "name": "Mind rune", "element": null },
    { "id": "chaos_rune", "name": "Chaos rune", "element": null },
    { "id": "death_rune", "name": "Death rune", "element": null },
    { "id": "blood_rune", "name": "Blood rune", "element": null },
    { "id": "wrath_rune", "name": "Wrath rune", "element": null }
  ],
  "staves": [
    {
      "id": "staff_of_air",
      "providesInfinite": ["air_rune"]
    },
    {
      "id": "smoke_battlestaff",
      "providesInfinite": ["air_rune", "fire_rune"],
      "damageBonus": 0.10
    },
    {
      "id": "kodai_wand",
      "providesInfinite": ["water_rune"],
      "damageBonus": 0.15
    }
  ]
}
```

#### 3.3 Spellbook Manifest Schema
**File:** `/packages/server/world/assets/manifests/spells.json`

```json
{
  "$schema": "./spells.schema.json",
  "spellbooks": {
    "standard": {
      "id": "standard",
      "name": "Standard Spellbook",
      "spells": [
        {
          "id": "wind_strike",
          "name": "Wind Strike",
          "level": 1,
          "baseMaxHit": 2,
          "baseXp": 5.5,
          "element": "air",
          "attackSpeed": 5,
          "runes": [
            { "runeId": "air_rune", "quantity": 1 },
            { "runeId": "mind_rune", "quantity": 1 }
          ],
          "autocastable": true
        },
        {
          "id": "fire_surge",
          "name": "Fire Surge",
          "level": 95,
          "baseMaxHit": 24,
          "baseXp": 50.5,
          "element": "fire",
          "attackSpeed": 5,
          "runes": [
            { "runeId": "air_rune", "quantity": 7 },
            { "runeId": "fire_rune", "quantity": 10 },
            { "runeId": "wrath_rune", "quantity": 1 }
          ],
          "autocastable": true
        }
      ]
    },
    "ancient": {
      "id": "ancient",
      "name": "Ancient Magicks",
      "spells": [
        {
          "id": "ice_barrage",
          "name": "Ice Barrage",
          "level": 94,
          "baseMaxHit": 30,
          "baseXp": 52,
          "element": "water",
          "attackSpeed": 5,
          "runes": [
            { "runeId": "water_rune", "quantity": 6 },
            { "runeId": "blood_rune", "quantity": 2 },
            { "runeId": "death_rune", "quantity": 4 }
          ],
          "effect": {
            "type": "freeze",
            "durationTicks": 32
          },
          "aoe": {
            "type": "3x3",
            "maxTargets": 9
          },
          "autocastable": true
        }
      ]
    }
  }
}
```

#### 3.4 AmmunitionService
**File:** `/packages/shared/src/systems/shared/combat/AmmunitionService.ts`

```typescript
/**
 * AmmunitionService - Handles arrow/bolt consumption and retrieval
 *
 * OSRS Mechanics:
 * - Base 20% loss rate per shot
 * - Ava's devices provide retrieval bonuses
 * - Metal torso blocks Ava's effect
 *
 * Design:
 * - Pure service class (Pure Fabrication pattern)
 * - Server-authoritative consumption
 * - No allocations in hot path
 */

export interface AmmunitionConsumptionResult {
  readonly consumed: number;
  readonly retrieved: number;
  readonly remaining: number;
}

// Pre-allocated result object
const _consumptionResult: AmmunitionConsumptionResult = {
  consumed: 0,
  retrieved: 0,
  remaining: 0,
};

export class AmmunitionService {
  private static readonly BASE_LOSS_RATE = 0.20;

  private static readonly RETRIEVAL_RATES: Record<string, number> = {
    none: 0,
    avas_attractor: 0.60,
    avas_accumulator: 0.72,
    avas_assembler: 0.80,
  };

  /**
   * Calculate ammunition consumption for a shot
   * Returns pre-allocated result object (no allocations)
   */
  calculateConsumption(
    currentAmmo: number,
    avasDevice: string | null,
    wearingMetalTorso: boolean,
    rng: SeededRandom,
  ): AmmunitionConsumptionResult {
    // Metal torso blocks Ava's effect
    const retrievalRate = wearingMetalTorso
      ? 0
      : AmmunitionService.RETRIEVAL_RATES[avasDevice ?? "none"] ?? 0;

    // Roll for retrieval
    const retrieved = rng.random() < retrievalRate ? 1 : 0;
    const consumed = retrieved ? 0 : 1;

    // Reuse pre-allocated object
    (_consumptionResult as { consumed: number }).consumed = consumed;
    (_consumptionResult as { retrieved: number }).retrieved = retrieved;
    (_consumptionResult as { remaining: number }).remaining = Math.max(0, currentAmmo - consumed);

    return _consumptionResult;
  }
}
```

---

### Phase 4: Prayer System Extension

**Goal:** Add ranged/magic prayers to manifest with proper bonus calculations.

#### 4.1 Add Prayers to Manifest
**File:** `/packages/server/world/assets/manifests/prayers.json` (additions)

```json
{
  "prayers": [
    // ... existing melee prayers ...

    // Ranged prayers
    {
      "id": "sharp_eye",
      "name": "Sharp Eye",
      "description": "Increases your Ranged by 5%",
      "icon": "prayer_sharp_eye",
      "level": 8,
      "category": "ranged",
      "drainEffect": 1,
      "bonuses": {
        "rangedAttackMultiplier": 1.05,
        "rangedStrengthMultiplier": 1.05
      },
      "conflicts": ["hawk_eye", "eagle_eye", "rigour"]
    },
    {
      "id": "hawk_eye",
      "name": "Hawk Eye",
      "description": "Increases your Ranged by 10%",
      "icon": "prayer_hawk_eye",
      "level": 26,
      "category": "ranged",
      "drainEffect": 6,
      "bonuses": {
        "rangedAttackMultiplier": 1.10,
        "rangedStrengthMultiplier": 1.10
      },
      "conflicts": ["sharp_eye", "eagle_eye", "rigour"]
    },
    {
      "id": "eagle_eye",
      "name": "Eagle Eye",
      "description": "Increases your Ranged by 15%",
      "icon": "prayer_eagle_eye",
      "level": 44,
      "category": "ranged",
      "drainEffect": 12,
      "bonuses": {
        "rangedAttackMultiplier": 1.15,
        "rangedStrengthMultiplier": 1.15
      },
      "conflicts": ["sharp_eye", "hawk_eye", "rigour"]
    },
    {
      "id": "rigour",
      "name": "Rigour",
      "description": "Increases your Ranged attack by 20%, Ranged strength by 23%, and Defence by 25%",
      "icon": "prayer_rigour",
      "level": 74,
      "category": "ranged",
      "drainEffect": 24,
      "requirements": {
        "defence": 70,
        "unlockItem": "dexterous_prayer_scroll"
      },
      "bonuses": {
        "rangedAttackMultiplier": 1.20,
        "rangedStrengthMultiplier": 1.23,
        "defenseMultiplier": 1.25
      },
      "conflicts": ["sharp_eye", "hawk_eye", "eagle_eye"]
    },

    // Magic prayers
    {
      "id": "mystic_will",
      "name": "Mystic Will",
      "description": "Increases your Magic by 5%",
      "icon": "prayer_mystic_will",
      "level": 9,
      "category": "magic",
      "drainEffect": 1,
      "bonuses": {
        "magicAttackMultiplier": 1.05,
        "magicDefenseMultiplier": 1.05
      },
      "conflicts": ["mystic_lore", "mystic_might", "augury"]
    },
    {
      "id": "mystic_lore",
      "name": "Mystic Lore",
      "description": "Increases your Magic attack by 10% and Magic damage by 1%",
      "icon": "prayer_mystic_lore",
      "level": 27,
      "category": "magic",
      "drainEffect": 6,
      "bonuses": {
        "magicAttackMultiplier": 1.10,
        "magicDamageMultiplier": 1.01,
        "magicDefenseMultiplier": 1.10
      },
      "conflicts": ["mystic_will", "mystic_might", "augury"]
    },
    {
      "id": "mystic_might",
      "name": "Mystic Might",
      "description": "Increases your Magic attack by 15% and Magic damage by 2%",
      "icon": "prayer_mystic_might",
      "level": 45,
      "category": "magic",
      "drainEffect": 12,
      "bonuses": {
        "magicAttackMultiplier": 1.15,
        "magicDamageMultiplier": 1.02,
        "magicDefenseMultiplier": 1.15
      },
      "conflicts": ["mystic_will", "mystic_lore", "augury"]
    },
    {
      "id": "augury",
      "name": "Augury",
      "description": "Increases your Magic attack by 25%, Magic damage by 4%, and Defence by 25%",
      "icon": "prayer_augury",
      "level": 77,
      "category": "magic",
      "drainEffect": 24,
      "requirements": {
        "defence": 70,
        "unlockItem": "arcane_prayer_scroll"
      },
      "bonuses": {
        "magicAttackMultiplier": 1.25,
        "magicDamageMultiplier": 1.04,
        "defenseMultiplier": 1.25
      },
      "conflicts": ["mystic_will", "mystic_lore", "mystic_might"]
    }
  ]
}
```

---

### Phase 5: Combat System Integration

**Goal:** Integrate ranged/magic into existing CombatSystem with proper separation.

#### 5.1 Create CombatAttackHandler Interface
**File:** `/packages/shared/src/systems/shared/combat/handlers/ICombatAttackHandler.ts`

```typescript
/**
 * Interface for combat attack handlers
 * Implements Interface Segregation and Dependency Inversion principles
 */
export interface ICombatAttackHandler {
  readonly attackType: AttackType;

  /**
   * Validate if attack can be performed
   */
  canAttack(attacker: Entity, target: Entity, world: World): CombatValidationResult;

  /**
   * Calculate damage for attack
   */
  calculateDamage(params: AttackCalculationParams): DamageResult;

  /**
   * Execute attack (server-side)
   */
  executeAttack(attacker: Entity, target: Entity, world: World): AttackExecutionResult;

  /**
   * Get attack speed in ticks
   */
  getAttackSpeed(attacker: Entity): number;

  /**
   * Get attack range in tiles
   */
  getAttackRange(attacker: Entity): number;
}

export interface CombatValidationResult {
  valid: boolean;
  error?: string;
  errorCode?: CombatErrorCode;
}

export interface AttackExecutionResult {
  success: boolean;
  damage: number;
  projectileData?: ProjectileData;
  consumables?: ConsumableUsage[];
  specialEffect?: SpecialEffect;
}
```

#### 5.2 Create RangedAttackHandler
**File:** `/packages/shared/src/systems/shared/combat/handlers/RangedAttackHandler.ts`

```typescript
/**
 * RangedAttackHandler - Handles all ranged combat attacks
 *
 * Responsibilities:
 * - Range validation
 * - Ammunition validation and consumption
 * - Damage calculation delegation
 * - Projectile creation
 */
export class RangedAttackHandler implements ICombatAttackHandler {
  readonly attackType = AttackType.RANGED;

  private readonly damageCalculator: RangedDamageCalculator;
  private readonly ammunitionService: AmmunitionService;
  private readonly projectileService: ProjectileService;

  constructor(
    damageCalculator: RangedDamageCalculator,
    ammunitionService: AmmunitionService,
    projectileService: ProjectileService,
  ) {
    this.damageCalculator = damageCalculator;
    this.ammunitionService = ammunitionService;
    this.projectileService = projectileService;
  }

  canAttack(attacker: Entity, target: Entity, world: World): CombatValidationResult {
    // Check if attacker has ranged weapon equipped
    const weapon = this.getEquippedWeapon(attacker);
    if (!weapon || !this.isRangedWeapon(weapon)) {
      return { valid: false, error: "No ranged weapon equipped", errorCode: CombatErrorCode.NO_WEAPON };
    }

    // Check ammunition
    const ammo = this.getEquippedAmmunition(attacker);
    if (!ammo && this.weaponRequiresAmmo(weapon)) {
      return { valid: false, error: "No ammunition", errorCode: CombatErrorCode.NO_AMMO };
    }

    // Check ammo compatibility
    if (ammo && !this.isAmmoCompatible(weapon, ammo)) {
      return { valid: false, error: "Incompatible ammunition", errorCode: CombatErrorCode.INCOMPATIBLE_AMMO };
    }

    // Check range
    const distance = this.calculateDistance(attacker, target);
    const maxRange = this.getAttackRange(attacker);
    if (distance > maxRange) {
      return { valid: false, error: "Target out of range", errorCode: CombatErrorCode.OUT_OF_RANGE };
    }

    return { valid: true };
  }

  executeAttack(attacker: Entity, target: Entity, world: World): AttackExecutionResult {
    const rng = getGameRng();

    // Get equipment and stats
    const weapon = this.getEquippedWeapon(attacker)!;
    const ammo = this.getEquippedAmmunition(attacker);
    const stats = this.getAttackerStats(attacker);
    const targetStats = this.getTargetStats(target);

    // Calculate damage
    const damageResult = this.damageCalculator.calculate({
      rangedLevel: stats.rangedLevel,
      rangedAttackBonus: stats.rangedAttackBonus,
      rangedStrengthBonus: stats.rangedStrengthBonus + (ammo?.rangedStrength ?? 0),
      style: stats.combatStyle as RangedCombatStyle,
      targetDefenseLevel: targetStats.defenseLevel,
      targetRangedDefenseBonus: targetStats.rangedDefenseBonus,
      prayerBonuses: stats.prayerBonuses,
      boltType: ammo?.enchanted ? ammo.id as EnchantedBoltType : undefined,
    }, rng);

    // Consume ammunition
    const ammoResult = this.ammunitionService.calculateConsumption(
      ammo?.quantity ?? 0,
      stats.avasDevice,
      stats.wearingMetalTorso,
      rng,
    );

    // Create projectile for visual
    const distance = this.calculateDistance(attacker, target);
    const projectile = this.projectileService.createRangedProjectile(
      attacker.id,
      target.id,
      weapon.projectileType ?? "arrow",
      distance,
    );

    return {
      success: true,
      damage: damageResult.damage,
      projectileData: projectile,
      consumables: [{
        type: "ammunition",
        itemId: ammo?.id ?? "",
        quantity: ammoResult.consumed,
      }],
      specialEffect: damageResult.specialProc ? {
        type: "bolt_proc",
        effect: damageResult.specialProc,
      } : undefined,
    };
  }

  getAttackSpeed(attacker: Entity): number {
    const weapon = this.getEquippedWeapon(attacker);
    const baseSpeed = weapon?.attackSpeed ?? 4;
    const style = this.getCombatStyle(attacker) as RangedCombatStyle;
    const styleBonus = RANGED_STYLE_BONUSES[style];
    return baseSpeed + styleBonus.speedModifier;
  }

  getAttackRange(attacker: Entity): number {
    const weapon = this.getEquippedWeapon(attacker);
    const baseRange = weapon?.attackRange ?? 7;
    const style = this.getCombatStyle(attacker) as RangedCombatStyle;
    const styleBonus = RANGED_STYLE_BONUSES[style];
    return baseRange + styleBonus.rangeModifier;
  }
}
```

---

### Phase 6: Projectile System

**Goal:** Visual projectile rendering with proper hit delay synchronization.

#### 6.1 ProjectileService
**File:** `/packages/shared/src/systems/shared/combat/ProjectileService.ts`

```typescript
/**
 * ProjectileService - Manages projectile creation and tracking
 *
 * Uses object pooling for projectile data to avoid allocations
 */
export class ProjectileService {
  private readonly projectilePool: ObjectPool<ProjectileData>;
  private readonly activeProjectiles: Map<string, ProjectileData> = new Map();

  constructor() {
    // Pre-allocate pool of 32 projectiles (typical max concurrent)
    this.projectilePool = new ObjectPool(
      () => this.createEmptyProjectile(),
      (p) => this.resetProjectile(p),
      32,
    );
  }

  createRangedProjectile(
    sourceId: string,
    targetId: string,
    projectileType: ProjectileType,
    distance: number,
  ): ProjectileData {
    const projectile = this.projectilePool.acquire();
    const currentTick = getGameTick();

    // Calculate hit delay using HitDelayCalculator
    const hitDelayTicks = calculateRangedHitDelay(distance);

    projectile.id = uuid();
    projectile.sourceId = sourceId;
    projectile.targetId = targetId;
    projectile.type = projectileType;
    projectile.launchTick = currentTick;
    projectile.hitTick = currentTick + hitDelayTicks;
    projectile.distance = distance;
    projectile.state = "flying";

    this.activeProjectiles.set(projectile.id, projectile);

    return projectile;
  }

  createMagicProjectile(
    sourceId: string,
    targetId: string,
    spellId: string,
    distance: number,
  ): ProjectileData {
    const projectile = this.projectilePool.acquire();
    const currentTick = getGameTick();

    // Magic uses different hit delay formula
    const hitDelayTicks = calculateMagicHitDelay(distance);

    projectile.id = uuid();
    projectile.sourceId = sourceId;
    projectile.targetId = targetId;
    projectile.type = "spell";
    projectile.spellId = spellId;
    projectile.launchTick = currentTick;
    projectile.hitTick = currentTick + hitDelayTicks;
    projectile.distance = distance;
    projectile.state = "flying";

    this.activeProjectiles.set(projectile.id, projectile);

    return projectile;
  }

  /**
   * Process tick - check for projectiles that should hit
   */
  processTick(currentTick: number): ProjectileHitEvent[] {
    const hits: ProjectileHitEvent[] = [];

    for (const [id, projectile] of this.activeProjectiles) {
      if (currentTick >= projectile.hitTick && projectile.state === "flying") {
        projectile.state = "hit";
        hits.push({
          projectileId: id,
          sourceId: projectile.sourceId,
          targetId: projectile.targetId,
          damage: projectile.pendingDamage,
        });
      }

      // Clean up completed projectiles
      if (projectile.state === "hit") {
        this.activeProjectiles.delete(id);
        this.projectilePool.release(projectile);
      }
    }

    return hits;
  }

  /**
   * Get projectile visual progress (0-1) for client interpolation
   */
  getProjectileProgress(projectileId: string, currentTick: number): number {
    const projectile = this.activeProjectiles.get(projectileId);
    if (!projectile) return 1;

    const totalTicks = projectile.hitTick - projectile.launchTick;
    const elapsedTicks = currentTick - projectile.launchTick;
    return Math.min(1, Math.max(0, elapsedTicks / totalTicks));
  }
}
```

---

### Phase 7: Combat UI Extensions

**Goal:** Update CombatPanel to support ranged/magic styles.

#### 7.1 Combat Style Selector
**File:** `/packages/client/src/game/panels/CombatPanel/CombatStyleSelector.tsx`

```typescript
/**
 * CombatStyleSelector - Renders combat style options based on weapon type
 *
 * Follows:
 * - Single Responsibility: Only handles style selection UI
 * - No re-renders during gameplay (uses refs for mutable state)
 */

interface CombatStyleSelectorProps {
  weaponType: WeaponType;
  attackType: AttackType;
  currentStyle: string;
  onStyleChange: (style: string) => void;
}

const RANGED_STYLES = [
  { id: "accurate", label: "Accurate", icon: "style_accurate", description: "+3 Ranged levels" },
  { id: "rapid", label: "Rapid", icon: "style_rapid", description: "Attack 1 tick faster" },
  { id: "longrange", label: "Longrange", icon: "style_longrange", description: "+2 Attack range" },
];

const MAGIC_STYLES = [
  { id: "accurate", label: "Accurate", icon: "style_accurate", description: "+3 Magic levels" },
  { id: "longrange", label: "Longrange", icon: "style_longrange", description: "+2 Attack range" },
];

export const CombatStyleSelector: React.FC<CombatStyleSelectorProps> = ({
  weaponType,
  attackType,
  currentStyle,
  onStyleChange,
}) => {
  const styles = useMemo(() => {
    switch (attackType) {
      case AttackType.RANGED:
        return RANGED_STYLES;
      case AttackType.MAGIC:
        return MAGIC_STYLES;
      case AttackType.MELEE:
      default:
        return getMeleeStyles(weaponType);
    }
  }, [attackType, weaponType]);

  return (
    <div className="combat-style-selector">
      {styles.map((style) => (
        <button
          key={style.id}
          className={`style-button ${currentStyle === style.id ? "active" : ""}`}
          onClick={() => onStyleChange(style.id)}
          title={style.description}
        >
          <img src={`/icons/${style.icon}.png`} alt={style.label} />
          <span>{style.label}</span>
        </button>
      ))}
    </div>
  );
};
```

---

### Phase 8: Testing Strategy

**Goal:** Comprehensive test coverage for all combat mechanics.

#### 8.1 Unit Tests
**Files:** `/packages/shared/src/systems/shared/combat/__tests__/`

```typescript
// RangedDamageCalculator.test.ts
describe("RangedDamageCalculator", () => {
  describe("calculateEffectiveRangedLevel", () => {
    it("should apply prayer bonus correctly", () => {
      // Eagle Eye: 1.15x
      const result = calculateEffectiveRangedLevel(99, "accurate", 1.15, 1.0);
      // floor(99 * 1.15) + 3 + 8 = 113 + 3 + 8 = 124
      expect(result).toBe(124);
    });

    it("should apply void bonus correctly", () => {
      // Elite void: 1.1x
      const result = calculateEffectiveRangedLevel(99, "accurate", 1.0, 1.1);
      // floor((99 + 3 + 8) * 1.1) = floor(121)
      expect(result).toBe(121);
    });
  });

  describe("calculateMaxHit", () => {
    it("should match OSRS wiki examples", () => {
      // Example: 99 ranged, dragon arrows (+60), rigour
      // Effective str: floor(99 * 1.23) + 8 = 129
      // Max hit: floor(0.5 + 129 * (60 + 64) / 640) = floor(25.5) = 25
      const result = calculateMaxHit(129, 60, 1.0, 1.0, 1.0);
      expect(result).toBe(25);
    });
  });

  describe("bolt special effects", () => {
    it("should calculate ruby bolt blood forfeit correctly", () => {
      // 20% of target HP, capped at 100
      const result = calculateBloodForfeit(500); // Target has 500 HP
      expect(result).toBe(100); // Capped

      const result2 = calculateBloodForfeit(200);
      expect(result2).toBe(40); // 20% of 200
    });
  });
});

// MagicDamageCalculator.test.ts
describe("MagicDamageCalculator", () => {
  describe("calculateMagicDefenseRoll", () => {
    it("should use 70/30 split for players", () => {
      // Player: 70 magic, 50 defense, +30 magic def bonus
      // Effective: floor(0.7 * 70 + 0.3 * 50) + 9 = 49 + 15 + 9 = 73
      // Roll: 73 * (30 + 64) = 6862
      const result = calculateMagicDefenseRoll("player", 70, 50, 30);
      expect(result).toBe(6862);
    });

    it("should use only magic for NPCs", () => {
      // NPC: 200 magic, defense level ignored, +50 bonus
      // Roll: (200 + 9) * (50 + 64) = 209 * 114 = 23826
      const result = calculateMagicDefenseRoll("npc", 200, 100, 50);
      expect(result).toBe(23826);
    });
  });
});
```

#### 8.2 Integration Tests
**File:** `/packages/server/tests/combat/ranged-combat.test.ts`

```typescript
describe("Ranged Combat Integration", () => {
  it("should consume ammunition on attack", async () => {
    const { world, player, target } = await setupCombatScenario();

    // Equip bow and arrows
    await equipItem(player, "magic_shortbow");
    await equipItem(player, "rune_arrow", 100);

    // Attack
    await performRangedAttack(player, target);

    // Verify ammunition consumed
    const arrows = getEquippedItem(player, "arrows");
    expect(arrows.quantity).toBeLessThan(100);
  });

  it("should respect attack range", async () => {
    const { world, player, target } = await setupCombatScenario();

    // Move target out of range
    await moveEntity(target, { x: 20, z: 0 }); // > 10 tiles

    // Attack should fail
    const result = await performRangedAttack(player, target);
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe(CombatErrorCode.OUT_OF_RANGE);
  });
});
```

---

### Phase 9: Security & Anti-Cheat

**Goal:** Server-authoritative validation for all combat actions.

#### 9.1 Combat Validation
**File:** `/packages/server/src/systems/combat/CombatValidator.ts`

```typescript
/**
 * CombatValidator - Server-side validation for all combat actions
 *
 * Security:
 * - All calculations server-side
 * - Rate limiting per player
 * - Sequence validation
 * - Input sanitization
 */
export class CombatValidator {
  private readonly rateLimiter: CombatRateLimiter;

  /**
   * Validate ranged attack request
   */
  validateRangedAttack(
    attackerId: string,
    targetId: string,
    world: World,
  ): ValidationResult {
    // Rate limit check
    if (!this.rateLimiter.canAttack(attackerId)) {
      return { valid: false, error: "Rate limited", code: "RATE_LIMITED" };
    }

    // Entity validation
    const attacker = world.entities.players?.get(attackerId);
    const target = world.entities.get(targetId);

    if (!attacker || !target) {
      return { valid: false, error: "Invalid entities", code: "INVALID_ENTITY" };
    }

    // Dead check
    if (isEntityDead(attacker) || isEntityDead(target)) {
      return { valid: false, error: "Dead entity", code: "ENTITY_DEAD" };
    }

    // Equipment validation (server checks, not trusting client)
    const weapon = this.getServerEquippedWeapon(attacker);
    if (!weapon || !this.isRangedWeapon(weapon)) {
      return { valid: false, error: "No ranged weapon", code: "NO_WEAPON" };
    }

    // Ammunition validation
    const ammo = this.getServerEquippedAmmo(attacker);
    if (!ammo && this.requiresAmmo(weapon)) {
      return { valid: false, error: "No ammunition", code: "NO_AMMO" };
    }

    // Range validation (server calculates, not trusting client distance)
    const distance = this.calculateServerDistance(attacker, target);
    const maxRange = this.calculateMaxRange(weapon, attacker);
    if (distance > maxRange) {
      return { valid: false, error: "Out of range", code: "OUT_OF_RANGE" };
    }

    // Cooldown validation
    if (this.isOnCooldown(attackerId)) {
      return { valid: false, error: "On cooldown", code: "ON_COOLDOWN" };
    }

    return { valid: true };
  }
}
```

---

### Implementation Checklist

#### Phase 1: Core Infrastructure
- [ ] Uncomment AttackType.RANGED and AttackType.MAGIC
- [ ] Add RangedCombatStyle and MagicCombatStyle types
- [ ] Add pre-allocated style bonus objects
- [ ] Add combat events for ranged/magic
- [ ] Update PrayerCombatBonuses interface

#### Phase 2: Damage Calculators
- [ ] Create RangedDamageCalculator with OSRS formulas
- [ ] Create MagicDamageCalculator with OSRS formulas
- [ ] Add pre-allocated result objects (no hot path allocations)
- [ ] Unit tests for all formulas

#### Phase 3: Ammunition & Runes
- [ ] Create ammunition.json manifest
- [ ] Create runes.json manifest
- [ ] Create spells.json manifest
- [ ] Create AmmunitionService
- [ ] Create RuneService
- [ ] Create SpellService

#### Phase 4: Prayer Extensions
- [ ] Add ranged prayers to prayers.json
- [ ] Add magic prayers to prayers.json
- [ ] Update PrayerSystem to handle new bonus types

#### Phase 5: Combat Handler Integration
- [ ] Create ICombatAttackHandler interface
- [ ] Create RangedAttackHandler
- [ ] Create MagicAttackHandler
- [ ] Update CombatSystem to route by AttackType

#### Phase 6: Projectile System
- [ ] Create ProjectileService with object pooling
- [ ] Implement hit delay synchronization
- [ ] Client-side projectile interpolation

#### Phase 7: UI Extensions
- [ ] Create CombatStyleSelector component
- [ ] Update CombatPanel for ranged/magic
- [ ] Add spellbook UI (if implementing full magic)
- [ ] Add autocast selection UI

#### Phase 8: Testing
- [ ] Unit tests for damage calculators
- [ ] Unit tests for ammunition/rune consumption
- [ ] Integration tests for full combat flow
- [ ] E2E tests with Playwright

#### Phase 9: Security
- [ ] Server-side validation for all attacks
- [ ] Rate limiting
- [ ] Anti-cheat logging

---

## Sources

- [OSRS Wiki: Magic Damage](https://oldschool.runescape.wiki/w/Magic_damage)
- [OSRS Wiki: Maximum Magic Hit](https://oldschool.runescape.wiki/w/Maximum_magic_hit)
- [OSRS Wiki: Damage Per Second/Magic](https://oldschool.runescape.wiki/w/Damage_per_second/Magic)
- [OSRS Wiki: Damage Per Second/Ranged](https://oldschool.runescape.wiki/w/Damage_per_second/Ranged)
- [OSRS Wiki: Maximum Ranged Hit](https://oldschool.runescape.wiki/w/Maximum_ranged_hit)
- [OSRS Wiki: Attack Speed](https://oldschool.runescape.wiki/w/Attack_speed)
- [OSRS Wiki: Enchanted Bolts](https://oldschool.runescape.wiki/w/Enchanted_bolts)
- [OSRS Wiki: Accuracy](https://oldschool.runescape.wiki/w/Accuracy)
- [OSRS Wiki: Ruby Bolts (e)](https://oldschool.runescape.wiki/w/Ruby_bolts_(e))
- [OSRS Wiki: Diamond Bolts (e)](https://oldschool.runescape.wiki/w/Diamond_bolts_(e))
- [OSRS Wiki: Toxic Blowpipe](https://oldschool.runescape.wiki/w/Toxic_blowpipe)
- [OldSchool.tools: Magic Max Hit Calculator](https://oldschool.tools/calculators/magic-max-hit)
- [OldSchool.tools: Ranged Max Hit Calculator](https://oldschool.tools/calculators/ranged-max-hit)
