# Player Interaction & Combat Level Display Plan

> Created: 2025-12-26
> Updated: 2025-12-26 (Wilderness/PvP mechanics added)
> Status: Ready for implementation
> Effort: 5-6 hours total

---

## OSRS Reference

From [Choose Option - OSRS Wiki](https://oldschool.runescape.wiki/w/Choose_Option) and [Combat Level - OSRS Wiki](https://oldschool.runescape.wiki/w/Combat_level):

### Right-Click Player Menu (Exact Order)
```
Attack PlayerName (level-XX)     ← Only in PvP zones (Wilderness)
Trade with PlayerName
Follow PlayerName
Report PlayerName
Walk here
Examine
Cancel
```

### Name & Level Format
- Player name: **White** text
- Level format: `(level-XX)` in parentheses after name
- Level color: **Color-coded based on relative difference**

### Combat Level Color Coding
| Level Difference | Color | Hex |
|-----------------|-------|-----|
| 10+ below you | Bright Green | `#00ff00` |
| 5-9 below | Yellow-Green | gradient |
| Equal (±0) | Yellow | `#ffff00` |
| 5-9 above | Orange | gradient |
| 10+ above you | Red | `#ff0000` |

---

## OSRS Wilderness Mechanics

From [Wilderness - OSRS Wiki](https://oldschool.runescape.wiki/w/Wilderness) and [Player killing - OSRS Wiki](https://oldschool.runescape.wiki/w/Player_killing):

### Core Mechanics
- **Wilderness Levels**: Start at 1 near the ditch, increase to 56 in the far north
- **Combat Level Range**: In level N wilderness, you can attack players within ±N levels of you
  - Example: Level 100 player in level 24 wilderness can attack levels 76-124
- **PvP Only in Wilderness**: Attack option disabled in safe zones

### Death in Wilderness (vs Safe Zones)
| Aspect | Safe Zone | Wilderness |
|--------|-----------|------------|
| Items | Gravestone (15 min) | Drop immediately |
| Protection | Items protected | Killer gets all unprotected |
| Loot Timer | N/A | 57 seconds for killer only |

### Visual Indicators
- Wilderness level shown in corner of screen
- Skull appears when attacking first (lose all items on death)
- Crossed swords icon in multi-combat zones

### Our Implementation (Simplified for MVP)
For MVP, we implement:
- **Binary PvP zones**: Areas with `pvpEnabled: true` allow Attack
- **No wilderness levels**: Skip level-based range restrictions
- **Combat level display**: Always show, but Attack only enabled in PvP zones

Future enhancements (post-MVP):
- Wilderness level system with combat range restrictions
- Skull mechanic for aggressors
- Multi-combat zone support

---

## Problem Summary

### Issue 1: Right-Click on Players Does Nothing
**Root cause:** `EntityContextMenu.tsx` has hardcoded type unions missing `"player"`

### Issue 2: Combat Level Not Displayed
**Root cause:** `Nametags.ts` only renders name, no level

### Issue 3: Wrong Menu Order (if it worked)
**Current:** Follow → Trade → Walk here → Examine
**OSRS:** Attack → Trade → Follow → Report → Walk here → Examine

---

## Implementation Plan

### Phase 1: Fix Right-Click Bug (30 min)

**File:** `packages/client/src/game/hud/EntityContextMenu.tsx`

Add `"player"` to the type unions:

```typescript
// Line 17-25 - Add "player"
type:
  | "item"
  | "resource"
  | "mob"
  | "corpse"
  | "npc"
  | "bank"
  | "store"
  | "headstone"
  | "player";  // ← ADD THIS

// Line 49-56 - Same fix
```

**Better approach:** Import shared type to prevent drift:
```typescript
import type { InteractableEntityType } from "@hyperscape/shared";
// Then use InteractableEntityType instead of hardcoded union
```

---

### Phase 2: Fix Menu Order & Add Options (1.5 hours)

**File:** `packages/shared/src/systems/client/interaction/handlers/PlayerInteractionHandler.ts`

#### Step 2.1: Add Zone Detection Import

```typescript
import { ZoneDetectionSystem } from "../../../shared/death/ZoneDetectionSystem";
```

#### Step 2.2: Update getContextMenuActions

```typescript
getContextMenuActions(target: RaycastTarget): ContextMenuAction[] {
  const actions: ContextMenuAction[] = [];
  const targetLevel = this.getPlayerCombatLevel(target.entityId);
  const inPvPZone = this.isInPvPZone();

  // 1. Attack (only in PvP zones) - Priority 0
  // OSRS: Attack option shows but is greyed out in safe zones
  actions.push({
    id: "attack",
    label: `Attack ${target.name} (level-${targetLevel})`,
    icon: "⚔️",
    enabled: inPvPZone,
    priority: 0,
    handler: () => this.attackPlayer(target),
  });

  // 2. Trade with - Priority 1
  actions.push({
    id: "trade",
    label: `Trade with ${target.name}`,
    icon: "🤝",
    enabled: false, // Disabled until trading implemented
    priority: 1,
    handler: () => this.showExamineMessage("Trading is not yet available."),
  });

  // 3. Follow - Priority 2
  actions.push({
    id: "follow",
    label: `Follow ${target.name}`,
    icon: "👣",
    enabled: true,
    priority: 2,
    handler: () => this.followPlayer(target),
  });

  // 4. Report - Priority 3
  actions.push({
    id: "report",
    label: `Report ${target.name}`,
    icon: "🚩",
    enabled: true,
    priority: 3,
    handler: () => this.showExamineMessage("Report system coming soon."),
  });

  // 5. Walk here - Priority 99
  actions.push(this.createWalkHereAction(target));

  // 6. Examine - Priority 100
  actions.push(this.createExamineAction(target, `${target.name}, a fellow adventurer.`));

  return actions.sort((a, b) => a.priority - b.priority);
}
```

#### Step 2.3: Add Zone Detection Method

```typescript
/**
 * Check if the LOCAL player is currently in a PvP-enabled zone.
 * Uses ZoneDetectionSystem for zone lookups.
 */
private isInPvPZone(): boolean {
  // Get local player position
  const localPlayer = this.world.getLocalPlayer?.();
  if (!localPlayer) return false;

  const position = localPlayer.getPosition();
  if (!position) return false;

  // Use ZoneDetectionSystem
  const zoneSystem = this.world.getSystem<ZoneDetectionSystem>("zone-detection");
  if (!zoneSystem) {
    // Fallback: no zone system = safe (conservative)
    return false;
  }

  return zoneSystem.isPvPEnabled({ x: position.x, z: position.z });
}
```

#### Step 2.4: Add Attack Player Method

```typescript
/**
 * Send attack request to server.
 * Server validates zone and executes combat.
 */
private attackPlayer(target: RaycastTarget): void {
  // Double-check zone (server will also validate)
  if (!this.isInPvPZone()) {
    this.showExamineMessage("You can't attack players here.");
    return;
  }

  this.send(MESSAGE_TYPES.ATTACK_PLAYER, {
    targetPlayerId: target.entityId,
  });

  this.addChatMessage(`Attacking ${target.name}...`);
}
```

#### Step 2.5: Add Combat Level Lookup

```typescript
/**
 * Get target player's combat level.
 * Falls back to 3 (OSRS minimum) if unknown.
 */
private getPlayerCombatLevel(playerId: string): number {
  // Try to get from player entity
  const playerEntity = this.world.getEntityById(playerId);
  if (playerEntity && typeof (playerEntity as any).combatLevel === "number") {
    return (playerEntity as any).combatLevel;
  }

  // Fallback: OSRS minimum level
  return 3;
}
```

#### Step 2.6: Add MESSAGE_TYPES Constant

**File:** `packages/shared/src/systems/client/interaction/constants.ts`

```typescript
export const MESSAGE_TYPES = {
  // ... existing types ...
  ATTACK_PLAYER: "attack_player",
  FOLLOW_PLAYER: "follow_player",
} as const;
```

---

### Phase 3: Add Combat Level to Nametag (1.5 hours)

**File:** `packages/shared/src/systems/client/Nametags.ts`

#### Step 3.1: Update NametagEntry interface
```typescript
interface NametagEntry {
  idx: number;
  name: string;
  level: number | null;  // null = don't show (NPCs handled separately)
  matrix: THREE.Matrix4;
}
```

#### Step 3.2: Update add() method signature
```typescript
add({ name, level }: { name: string; level?: number | null }): NametagHandle | null
```

#### Step 3.3: Extend NametagHandle
```typescript
export interface NametagHandle {
  idx: number;
  name: string;
  level: number | null;
  matrix: THREE.Matrix4;
  move: (newMatrix: THREE.Matrix4) => void;
  setName: (name: string) => void;
  setLevel: (level: number | null) => void;  // ← ADD
  destroy: () => void;
}
```

#### Step 3.4: Update draw() to include level
```typescript
private draw(entry: NametagEntry) {
  // ... existing setup ...

  // Format: "PlayerName (level-XX)" or just "PlayerName"
  let displayText = entry.name;
  if (entry.level !== null && entry.level > 0) {
    displayText = `${entry.name} (level-${entry.level})`;
  }

  const text = this.fitText(displayText, NAMETAG_WIDTH);

  // Draw with outline
  this.ctx.strokeText(text, x + NAMETAG_WIDTH / 2, y + NAMETAG_HEIGHT / 2);
  this.ctx.fillText(text, x + NAMETAG_WIDTH / 2, y + NAMETAG_HEIGHT / 2);

  this.texture.needsUpdate = true;
}
```

---

### Phase 4: Wire Combat Level to Players (1 hour)

**File:** `packages/shared/src/entities/player/PlayerEntity.ts` (or equivalent)

#### Step 4.1: Calculate level on spawn
```typescript
import { calculateCombatLevel, normalizeCombatSkills } from "../../utils/game/CombatLevelCalculator";

// In player initialization:
const combatLevel = calculateCombatLevel(normalizeCombatSkills({
  attack: skills.attack,
  strength: skills.strength,
  defense: skills.defense,
  constitution: skills.constitution,
  ranged: skills.ranged || 1,
  magic: skills.magic || 1,
  prayer: skills.prayer || 1,
}));

this.nametagHandle = nametags.add({
  name: this.displayName,
  level: combatLevel,
});
```

#### Step 4.2: Update on skill change
```typescript
// Listen for skill level changes
this.world.on(EventType.PLAYER_LEVEL_CHANGED, (data) => {
  if (data.playerId === this.id) {
    const newLevel = this.recalculateCombatLevel();
    this.nametagHandle?.setLevel(newLevel);
  }
});
```

---

### Phase 5: Combat Level Color Coding (Optional, 30 min)

**File:** `packages/shared/src/systems/client/Nametags.ts`

For full OSRS accuracy, the level should be color-coded. This requires:

1. Store local player's combat level
2. Compare to target's level
3. Apply color gradient

```typescript
private getLevelColor(targetLevel: number, myLevel: number): string {
  const diff = targetLevel - myLevel;

  if (diff <= -10) return "#00ff00";  // Bright green (much weaker)
  if (diff >= 10) return "#ff0000";   // Red (much stronger)
  if (diff === 0) return "#ffff00";   // Yellow (equal)

  // Gradient for ±1-9
  if (diff < 0) {
    // Weaker: yellow-green gradient
    const t = Math.abs(diff) / 10;
    return this.lerpColor("#ffff00", "#00ff00", t);
  } else {
    // Stronger: orange-red gradient
    const t = diff / 10;
    return this.lerpColor("#ffff00", "#ff0000", t);
  }
}
```

**Note:** This is complex because we need to re-render nametags when the LOCAL player's level changes (affects all other player colors).

**Recommendation:** Defer Phase 5 to a future iteration. White level text is acceptable for MVP.

---

### Phase 6: Create Test Wilderness Area (1 hour)

Create a small PvP-enabled area near spawn for testing player combat.

#### Step 6.1: Add `pvpEnabled` to WorldArea Interface

**File:** `packages/shared/src/types/world/world-types.ts`

```typescript
export interface WorldArea {
  id: string;
  name: string;
  description: string;
  difficultyLevel: 0 | 1 | 2 | 3;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  biomeType: string;
  safeZone: boolean;
  pvpEnabled?: boolean;  // ← ADD THIS
  npcs: NPCLocation[];
  resources: BiomeResource[];
  mobSpawns: MobSpawnPoint[];
}
```

#### Step 6.2: Add Wilderness Test Area to Manifest

**File:** `packages/server/world/assets/manifests/world-areas.json`

Add to `level1Areas`:

```json
{
  "starterTowns": { ... },
  "level1Areas": {
    "wilderness_test": {
      "id": "wilderness_test",
      "name": "The Wastes",
      "description": "A dangerous zone where players can attack each other. Enter at your own risk.",
      "difficultyLevel": 1,
      "bounds": {
        "minX": 25,
        "maxX": 45,
        "minZ": -10,
        "maxZ": 10
      },
      "biomeType": "wastes",
      "safeZone": false,
      "pvpEnabled": true,
      "npcs": [],
      "resources": [],
      "mobSpawns": []
    }
  },
  ...
}
```

**Zone Layout:**
```
                    N (+Z)
                     │
    ┌────────────────┼────────────────┐
    │                │                │
    │   CENTRAL      │   WILDERNESS   │
    │   HAVEN        │   TEST         │
    │  (safe zone)   │  (PvP enabled) │
    │   -20 to 20    │   25 to 45     │
    │                │                │
W ──┼────────────────┼────────────────┼── E (+X)
    │                │                │
    │   Spawn (0,0)  │   Dark ground  │
    │                │                │
    └────────────────┼────────────────┘
                     │
                    S (-Z)
```

**Location rationale:**
- Just east of Central Haven (5 tile gap prevents overlap)
- Close enough to walk to quickly for testing (~25 tiles from spawn)
- Small area (20x20) to keep testing focused

#### Step 6.3: Add Visual Indicator (Dark Ground)

**File:** `packages/shared/src/systems/client/TerrainRenderer.ts` (or similar)

Add special ground coloring for PvP zones:

```typescript
// In terrain generation or shader:
const zoneProps = zoneDetection.getZoneProperties(position);
if (zoneProps.isPvPEnabled) {
  // Dark grey/red tint for dangerous areas
  groundColor = new THREE.Color(0x2a2020); // Dark reddish-grey
}
```

**Alternative (simpler):** Place dark grey ground plane mesh at wilderness bounds:

```typescript
// In world initialization:
const wildernessGround = new THREE.Mesh(
  new THREE.PlaneGeometry(20, 20),
  new THREE.MeshStandardMaterial({
    color: 0x333333,  // Dark grey
    roughness: 0.9,
  })
);
wildernessGround.rotation.x = -Math.PI / 2;
wildernessGround.position.set(35, 0.01, 0);  // Center of wilderness zone
scene.add(wildernessGround);
```

#### Step 6.4: Add Warning When Entering

**File:** `packages/shared/src/systems/client/ZoneTransitionSystem.ts` (new or existing)

```typescript
// On zone change:
if (newZone.isPvPEnabled && !oldZone.isPvPEnabled) {
  this.showWarning("⚠️ Entering Wilderness - PvP is enabled!");
}

if (!newZone.isPvPEnabled && oldZone.isPvPEnabled) {
  this.showMessage("You have left the Wilderness.");
}
```

---

## Testing Checklist

### Phase 1 - Right-Click Fix ✅
- [x] Right-click another player → context menu appears (DONE)

### Phase 2 - Menu Order & Attack
- [ ] Options appear in correct OSRS order (Attack first)
- [ ] Attack shows target's combat level: `Attack PlayerName (level-3)`
- [ ] Attack is **disabled** (greyed out) in Central Haven
- [ ] Attack is **enabled** in Wilderness Test zone
- [ ] Follow works - local player follows target
- [ ] Report shows placeholder message

### Phase 3 - Nametag Level
- [ ] Player nametag shows: `PlayerName (level-3)`
- [ ] Format matches OSRS: `(level-XX)` with hyphen

### Phase 4 - Level Updates
- [ ] Fresh character shows `(level-3)`
- [ ] Level updates when skills change
- [ ] Other players' nametags show their correct levels

### Phase 5 - Color Coding (Optional)
- [ ] Level text colored based on relative difference

### Phase 6 - Wilderness Test Area
- [ ] Walking east from spawn reaches wilderness in ~25 tiles
- [ ] Ground visually darker in wilderness zone
- [ ] Warning message when entering
- [ ] Attack option becomes enabled in wilderness
- [ ] Death in wilderness drops items (no gravestone)

---

## Files to Modify

| Phase | File | Change |
|-------|------|--------|
| 1 | `EntityContextMenu.tsx` | Add "player" to type unions ✅ |
| 2 | `PlayerInteractionHandler.ts` | Fix order, add Attack with zone check |
| 2 | `constants.ts` | Add MESSAGE_TYPES for attack/report |
| 3 | `Nametags.ts` | Add level to interface, draw() |
| 4 | `PlayerEntity.ts` | Wire combat level calculation |
| 5 | `Nametags.ts` | Color coding (optional) |
| 6 | `world-types.ts` | Add `pvpEnabled` to WorldArea |
| 6 | `world-areas.json` | Add wilderness_test area |
| 6 | `TerrainRenderer.ts` | Dark ground for PvP zones |
| 6 | `ZoneTransitionSystem.ts` | Warning messages |

---

## Current vs OSRS Comparison

| Element | Current | OSRS | Status |
|---------|---------|------|--------|
| Right-click menu | ~~Broken~~ Works | Works | ✅ Fixed in Phase 1 |
| Menu order | Follow first | Attack first | ❌ Fix in Phase 2 |
| Attack option | Missing | Present (PvP only) | ❌ Fix in Phase 2 |
| Zone detection | Exists | Wilderness levels | ✅ Have isPvPEnabled() |
| Report option | Missing | Present | ❌ Fix in Phase 2 |
| Level on nametag | Missing | `(level-XX)` | ❌ Fix in Phase 3 |
| Level color | N/A | Color-coded | ⏸️ Optional Phase 5 |
| Test PvP area | None | Wilderness | ❌ Fix in Phase 6 |

---

## Sources

- [Choose Option - OSRS Wiki](https://oldschool.runescape.wiki/w/Choose_Option)
- [Combat Level - OSRS Wiki](https://oldschool.runescape.wiki/w/Combat_level)
- [Wilderness - OSRS Wiki](https://oldschool.runescape.wiki/w/Wilderness)
- [Player killing - OSRS Wiki](https://oldschool.runescape.wiki/w/Player_killing)
- [Rune-Server Forum - Menu Order](https://rune-server.org/threads/how-to-rearrange-right-click-menus.284024/)
