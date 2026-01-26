# Duel Arena Research & Implementation Plan

## Part 1: OSRS Duel Arena Mechanics (Web Research)

### Challenge System
- Right-click player → "Challenge" option
- Challenge request appears in chat (similar to trade requests)
- Accept/decline within ~30 seconds before timeout
- Both players must be in Duel Arena area to challenge

### Three-Screen Flow
1. **Rules Screen**: Toggle 11 duel rules
2. **Stakes Screen**: Add items/gold to stake
3. **Confirmation Screen**: Final review, both must accept twice

### Duel Rules (11 Options)
| Rule | Effect |
|------|--------|
| No Ranged | Cannot use ranged attacks |
| No Melee | Cannot use melee attacks |
| No Magic | Cannot use magic attacks |
| No Special Attacks | Special attack disabled |
| No Prayer | Prayer disabled, points drained |
| No Drinks (Potions) | Cannot drink potions |
| No Food | Cannot eat food |
| No Forfeit | Cannot forfeit mid-duel |
| No Movement | Players frozen in place |
| ~~Obstacles~~ | ~~Arena has obstacles~~ (NOT IMPLEMENTING) |
| Fun Weapons | Use fun weapons only |

### Equipment Restrictions
- Can toggle each equipment slot on/off
- If slot disabled, item is unequipped before duel
- Banned items list (certain overpowered items)

### Arena Types
- 6 identical flat arenas (no obstacles)
- First-available assignment
- Players teleported to arena spawn points

### Staking Mechanics
- Add items/gold similar to trading
- Value displayed for both sides
- Tax on stakes (historically added to combat RWT)
- Stake limits existed at various points

### Combat Mechanics
- 3-2-1-FIGHT countdown before combat starts
- PID (Player ID) determines who attacks first (alternates fairly)
- Death = lose stakes, winner receives all stakes
- Loser keeps all their non-staked items

### Anti-Scam Features
- Second confirmation screen
- "Other player modified their stake" warning
- Clear value display for both sides
- Both must accept on BOTH screens

### Additional Features
- Scoreboard tracking wins/losses
- Hospital area for losers
- Spectator viewing (walk to viewing platforms and watch)
- Nurse NPC to restore stats

### Forfeit System (Detailed)

**How to forfeit:**
- Physical **trapdoors** on east and west sides of each arena
- Player walks to trapdoor and clicks it
- NOT a UI button - actual world interaction
- Confirmation dialog: "Are you sure you want to forfeit? You will lose all staked items."

**Forfeit consequences:**
- Duel ends immediately
- Forfeiting player loses
- All stakes transferred to opponent
- Forfeiter's name NOT recorded on scoreboard (doesn't count as "official" loss)
- Both players teleported out of arena

**No Forfeit rule:**
- Trapdoors become non-functional (grayed out / different appearance)
- Click message: "You cannot forfeit - this duel is to the death!"
- Must fight until one player dies

**Rule restrictions (cannot be combined with No Forfeit):**
- No Forfeit + Fun Weapons = INVALID (fun weapons are casual, no-stakes)
- No Forfeit + No Movement = INVALID (can't reach trapdoor if frozen)

**Trapdoor placement (per arena):**
```
┌─────────────────────────────────┐
│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
│▓                               ▓│
│▓  [TD]                   [TD]  ▓│  ← Trapdoors on east/west
│▓                               ▓│
│▓      ████████████████████     ▓│
│▓      ████████████████████     ▓│
│▓                               ▓│
│▓  [TD]                   [TD]  ▓│  ← Trapdoors on east/west
│▓                               ▓│
│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
└─────────────────────────────────┘
```

---

## Part 2: Hyperscape Codebase Analysis

### 1. Trading System (Highly Reusable)

**Files:**
- `/packages/server/src/systems/TradingSystem/index.ts` (840 lines)
- `/packages/server/src/systems/ServerNetwork/handlers/trade.ts` (1451 lines)
- `/packages/server/src/systems/ServerNetwork/PendingTradeManager.ts` (226 lines)
- `/packages/client/src/game/panels/TradePanel/TradePanel.tsx` (1213 lines)

**Reusable Patterns:**
- **Two-screen flow**: Offer screen → Confirmation screen (maps to rules/stakes → confirmation)
- **PendingTradeManager**: Auto-walks player to target when out of range
- **Acceptance state machine**: Both players must accept, modifications reset acceptance
- **Anti-scam features**: Red exclamation marks when items removed
- **Atomic item swaps**: `executeTradeSwap()` handles inventory locking and rollback
- **Free slots calculation**: Validates both players have space

**Key Code Pattern:**
```typescript
interface TradeSession {
  tradeId: string;
  initiator: TradeParticipant;
  recipient: TradeParticipant;
  state: 'OFFER' | 'CONFIRMING';
}
```

### 2. Combat System (Foundation Ready)

**Files:**
- `/packages/shared/src/systems/shared/combat/CombatSystem.ts`
- `/packages/shared/src/systems/shared/combat/CombatStateService.ts`
- `/packages/shared/src/systems/shared/combat/DamageCalculator.ts`

**Reusable Components:**
- **Tick-based combat**: 17 ticks = 10.2s timeout, matches OSRS
- **Combat state tracking**: `isInCombat()`, `getCombatTarget()`
- **Damage calculation**: Full OSRS-style formulas
- **Death handling**: Needs modification for duel (no items lost)

### 3. Player Interaction System

**Files:**
- `/packages/shared/src/systems/client/PlayerInteractionHandler.ts`
- `/packages/client/src/game/panels/TradePanel/TradeRequestModal.tsx`

**Reusable Patterns:**
- Right-click context menu (add "Challenge" option)
- Request/Response modal pattern
- Distance checking with `chebyshevDistance()`

### 4. Zone Detection System

**Files:**
- `/packages/shared/src/systems/shared/zones/ZoneDetectionSystem.ts`
- `/packages/server/world/assets/manifests/world-areas.json`

**Reusable Patterns:**
- Zone bounds with `pvpEnabled`, `safeZone` flags
- Zone entry/exit events
- PvP zone infrastructure

### 5. UI Panel Patterns

**Files:**
- `/packages/client/src/game/panels/TradePanel/`
- `/packages/client/src/game/panels/BankPanel/`
- `/packages/client/src/game/ui/ModalWindow.tsx`

**Reusable Components:**
- ModalWindow with portal rendering
- Item grid layouts (4-column)
- Two-screen confirmation flow
- OSRS-style theme system

### 6. Inventory & Equipment Systems

**Files:**
- `/packages/shared/src/systems/shared/inventory/InventorySystem.ts`
- `/packages/shared/src/systems/shared/equipment/EquipmentSystem.ts`

**Reusable Patterns:**
- Transaction locks prevent concurrent modifications
- Item value lookup for stake calculation
- Equipment slot system (all OSRS slots)
- Force-unequip logic

---

## Part 3: Arena Pool Architecture (OSRS-Style)

### Key Insight: No Virtual Instancing

OSRS didn't use instancing - it used **physical arenas** in the game world:
- Multiple arena areas built into the map
- Arena reservation system (first-available assignment)
- Spectators can physically walk to viewing platforms
- Limited concurrent duels = number of arenas (typically 6-8)

This is simpler and more social than true instancing.

### Arena Pool System

```
┌─────────────────────────────────────────────────────────────────┐
│                     ARENA POOL MANAGER                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Arena 1: { inUse: true,  duelId: "abc123" }                    │
│  Arena 2: { inUse: false, duelId: null     }                    │
│  Arena 3: { inUse: true,  duelId: "def456" }                    │
│  Arena 4: { inUse: false, duelId: null     }                    │
│  Arena 5: { inUse: false, duelId: null     }                    │
│  Arena 6: { inUse: true,  duelId: "ghi789" }                    │
│                                                                  │
│  reserveArena() → arenaId | null                                │
│  releaseArena(arenaId: number) → void                           │
│  getArenaForDuel(duelId: string) → Arena | null                 │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### World Map Layout

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         DUEL ARENA ZONE                                  │
│                                                                          │
│    ┌─────────┐    ┌─────────┐    ┌─────────┐                            │
│    │ ARENA 1 │    │ ARENA 2 │    │ ARENA 3 │                            │
│    │         │    │         │    │         │                            │
│    │         │    │         │    │         │                            │
│    └────┬────┘    └────┬────┘    └────┬────┘                            │
│         │              │              │                                  │
│    ═════╧══════════════╧══════════════╧═════  ← Viewing Walkway         │
│                                                                          │
│    ┌─────────┐    ┌─────────┐    ┌─────────┐                            │
│    │ ARENA 4 │    │ ARENA 5 │    │ ARENA 6 │                            │
│    │         │    │         │    │         │                            │
│    │         │    │         │    │         │     (All 6 are flat tan)   │
│    └────┬────┘    └────┬────┘    └────┬────┘                            │
│         │              │              │                                  │
│    ═════╧══════════════╧══════════════╧═════  ← Viewing Walkway (lower) │
│                                                                          │
│    ┌────────────────────────────────────────────────────────────┐       │
│    │                       LOBBY AREA                            │       │
│    │                                                             │       │
│    │   [Scoreboard]     [Challenge Area]      [Nurse NPC]       │       │
│    │                                                             │       │
│    │              (Players challenge each other here)            │       │
│    └────────────────────────────────────────────────────────────┘       │
│                                                                          │
│    ┌──────────────┐                                                      │
│    │   HOSPITAL   │  ← Losers respawn here                              │
│    │              │                                                      │
│    └──────────────┘                                                      │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Arena Structure (Each Arena)

```
┌───────────────────────────────────────┐
│            VIEWING PLATFORM           │  ← Elevated, spectators stand here
│  ┌─────────────────────────────────┐  │
│  │                                 │  │
│  │    [Spawn A]       [Spawn B]    │  │  ← Players teleported to spawns
│  │        ●               ●        │  │
│  │                                 │  │
│  │           ARENA FLOOR           │  │  ← Combat happens here
│  │         (flat tan plane)        │  │
│  │                                 │  │
│  └─────────────────────────────────┘  │
│            VIEWING PLATFORM           │
└───────────────────────────────────────┘
     ↑                           ↑
   Gate A                     Gate B
 (entrance)                 (entrance)
```

### Spectator Mechanics

**Physical Spectating (OSRS-style):**
1. Players walk to the Duel Arena zone
2. Climb stairs to viewing walkway (elevated platforms around arenas)
3. Can see into any arena from the walkway
4. No teleportation needed - just physical proximity
5. Can watch multiple arenas by walking along the walkway

**What spectators see:**
- Both duelists fighting in the arena below
- Health bars above both players
- Combat hits/splashes
- Winner celebration when duel ends

**What spectators cannot do:**
- Enter the arena floor (blocked by walls/gates)
- Interact with duelists
- Affect the combat in any way

### Temporary Arena Visuals (No Building Assets)

Since we don't have building/structure models yet, we'll use **procedural geometry** for temporary arena visuals.

**Key simplification:** All 6 arenas are identical flat tan planes. No obstacles, no walls. Movement restriction during duels is enforced by the **DuelSystem** (server-side), not physical barriers.

#### 1. Ground Flattening via TerrainSystem

Use the existing `TerrainSystem.registerFlatZone()` API (same as stations like furnaces/banks):

```typescript
// In DuelArenaWorldBuilder.ts or during world init
const terrainSystem = world.getSystem('terrain') as TerrainSystem;

// Register flat zone for main lobby area
terrainSystem.registerFlatZone({
  id: 'duel_arena_lobby',
  centerX: 1100,
  centerZ: 1250,
  width: 60,    // 60m wide lobby
  depth: 30,    // 30m deep
  height: 5.0,  // Flat at Y=5
  blendRadius: 4.0, // Smooth transition to natural terrain
});

// Register flat zones for each arena (6 identical arenas)
const ARENA_CONFIGS = [
  { id: 1, centerX: 1040, centerZ: 1180 },
  { id: 2, centerX: 1100, centerZ: 1180 },
  { id: 3, centerX: 1160, centerZ: 1180 },
  { id: 4, centerX: 1040, centerZ: 1120 },
  { id: 5, centerX: 1100, centerZ: 1120 },
  { id: 6, centerX: 1160, centerZ: 1120 },
];

for (const arena of ARENA_CONFIGS) {
  terrainSystem.registerFlatZone({
    id: `duel_arena_${arena.id}`,
    centerX: arena.centerX,
    centerZ: arena.centerZ,
    width: 16,      // 16m x 16m arena
    depth: 16,
    height: 5.0,
    blendRadius: 2.0,
  });
}
```

#### 2. Arena Visuals (Floor + Walls)

Create a client-side system that renders arenas with procedural geometry - no models needed:

```typescript
// DuelArenaVisualsSystem.ts (client only)
const ARENA_SIZE = 16;        // 16m x 16m arena
const WALL_HEIGHT = 2.5;      // 2.5m tall walls
const WALL_THICKNESS = 0.5;   // 0.5m thick walls
const FLOOR_Y = 5.0;          // Ground level

const FLOOR_COLOR = 0xc2b280; // Sandy tan
const WALL_COLOR = 0x8b7355;  // Stone brown

export class DuelArenaVisualsSystem extends System {
  private meshes: THREE.Mesh[] = [];

  start() {
    // Shared geometries (reused across all arenas)
    const floorGeo = new THREE.PlaneGeometry(ARENA_SIZE, ARENA_SIZE);
    const wallXGeo = new THREE.BoxGeometry(ARENA_SIZE + WALL_THICKNESS, WALL_HEIGHT, WALL_THICKNESS);
    const wallZGeo = new THREE.BoxGeometry(WALL_THICKNESS, WALL_HEIGHT, ARENA_SIZE + WALL_THICKNESS);

    // Shared materials
    const floorMat = new THREE.MeshStandardMaterial({
      color: FLOOR_COLOR,
      roughness: 0.95,
    });
    const wallMat = new THREE.MeshStandardMaterial({
      color: WALL_COLOR,
      roughness: 0.85,
    });

    for (const arena of ARENA_CONFIGS) {
      const { centerX, centerZ } = arena;
      const wallY = FLOOR_Y + WALL_HEIGHT / 2;
      const halfSize = ARENA_SIZE / 2;

      // Floor (tan plane)
      const floor = new THREE.Mesh(floorGeo, floorMat);
      floor.rotation.x = -Math.PI / 2;
      floor.position.set(centerX, FLOOR_Y + 0.01, centerZ);
      floor.receiveShadow = true;
      this.world.stage.scene.add(floor);
      this.meshes.push(floor);

      // North wall (BoxGeometry along X)
      const northWall = new THREE.Mesh(wallXGeo, wallMat);
      northWall.position.set(centerX, wallY, centerZ - halfSize);
      northWall.castShadow = true;
      northWall.receiveShadow = true;
      this.world.stage.scene.add(northWall);
      this.meshes.push(northWall);

      // South wall
      const southWall = new THREE.Mesh(wallXGeo, wallMat);
      southWall.position.set(centerX, wallY, centerZ + halfSize);
      southWall.castShadow = true;
      southWall.receiveShadow = true;
      this.world.stage.scene.add(southWall);
      this.meshes.push(southWall);

      // East wall (BoxGeometry along Z)
      const eastWall = new THREE.Mesh(wallZGeo, wallMat);
      eastWall.position.set(centerX + halfSize, wallY, centerZ);
      eastWall.castShadow = true;
      eastWall.receiveShadow = true;
      this.world.stage.scene.add(eastWall);
      this.meshes.push(eastWall);

      // West wall
      const westWall = new THREE.Mesh(wallZGeo, wallMat);
      westWall.position.set(centerX - halfSize, wallY, centerZ);
      westWall.castShadow = true;
      westWall.receiveShadow = true;
      this.world.stage.scene.add(westWall);
      this.meshes.push(westWall);
    }
  }

  destroy() {
    for (const mesh of this.meshes) {
      this.world.stage.scene.remove(mesh);
      mesh.geometry.dispose();
    }
    this.meshes = [];
  }
}
```

**Visual Result:**
```
┌─────────────────────────────────┐
│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│  ← North wall (brown BoxGeometry)
│▓                               ▓│
│▓ [TD]                     [TD] ▓│  ← Trapdoors (dark BoxGeometry)
│▓      ████████████████████     ▓│  ← Tan floor (PlaneGeometry)
│▓      ████████████████████     ▓│
│▓      ████████████████████     ▓│
│▓ [TD]                     [TD] ▓│  ← Trapdoors (dark BoxGeometry)
│▓                               ▓│
│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│  ← South wall (brown BoxGeometry)
└─────────────────────────────────┘
  ↑                             ↑
West wall                    East wall
```

#### 3. Trapdoor Entities (Forfeit Points)

Trapdoors are interactable entities placed near the east/west walls:

```typescript
// TrapdoorEntity.ts
const TRAPDOOR_COLOR = 0x4a3728;  // Dark brown (darker than walls)
const TRAPDOOR_SIZE = 1.5;        // 1.5m x 1.5m
const TRAPDOOR_HEIGHT = 0.1;      // Flat on ground

export class TrapdoorEntity extends InteractableEntity {
  private arenaId: number;
  private isEnabled: boolean = true;  // Disabled if noForfeit rule

  constructor(world: World, arenaId: number, position: Position3D) {
    super(world, {
      id: `trapdoor_${arenaId}_${position.x}_${position.z}`,
      name: 'Trapdoor',
      position,
    });
    this.arenaId = arenaId;
  }

  // Visual: dark square on the ground
  createMesh(): THREE.Mesh {
    const geo = new THREE.BoxGeometry(TRAPDOOR_SIZE, TRAPDOOR_HEIGHT, TRAPDOOR_SIZE);
    const mat = new THREE.MeshStandardMaterial({
      color: this.isEnabled ? TRAPDOOR_COLOR : 0x333333, // Gray if disabled
      roughness: 0.7,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(this.position.x, FLOOR_Y + TRAPDOOR_HEIGHT / 2, this.position.z);
    return mesh;
  }

  // Right-click options
  getContextMenuOptions(playerId: string): ContextMenuOption[] {
    const duelSystem = this.world.getSystem('duel') as DuelSystem;
    const session = duelSystem.getPlayerSession(playerId);

    if (!session || session.state !== 'FIGHTING') {
      return []; // No options if not in active duel
    }

    if (session.rules.noForfeit) {
      return [{
        label: 'Forfeit (disabled)',
        disabled: true,
        tooltip: 'No Forfeit rule is active',
      }];
    }

    return [{
      label: 'Forfeit',
      action: () => this.world.emit('duel:forfeit:request', { playerId }),
    }];
  }
}

// Trapdoor positions per arena (4 trapdoors each)
const TRAPDOOR_OFFSETS = [
  { x: -6, z: -4 },  // West-north
  { x: -6, z: 4 },   // West-south
  { x: 6, z: -4 },   // East-north
  { x: 6, z: 4 },    // East-south
];
```

#### 4. Movement Restriction (Server-Side)

Players can't leave the arena during a duel - enforced by DuelSystem:

```typescript
// In MovementSystem integration
if (player.isInDuel) {
  const arena = duelSystem.getPlayerArena(player.id);
  const halfSize = ARENA_SIZE / 2 - 0.5; // Stay inside walls

  // Clamp to arena bounds
  newPos.x = Math.max(arena.centerX - halfSize, Math.min(arena.centerX + halfSize, newPos.x));
  newPos.z = Math.max(arena.centerZ - halfSize, Math.min(arena.centerZ + halfSize, newPos.z));
}
```

#### Summary: Temporary Visual Approach

| Element | Implementation | Future (with assets) |
|---------|---------------|---------------------|
| Ground flattening | `TerrainSystem.registerFlatZone()` | Same |
| Arena floor | Tan `PlaneGeometry` (16m x 16m) | Arena floor texture/model |
| Arena walls | Brown `BoxGeometry` (4 per arena) | Stone wall models |
| Trapdoors | Dark `BoxGeometry` + `TrapdoorEntity` (4 per arena) | Trapdoor model with animation |
| Lobby | Flattened terrain only | Building model |

This approach lets us build and test the full duel system without waiting for art assets.

---

## Part 4: Detailed System Design

### 4.1 Zone Definitions (world-areas.json)

```json
{
  "id": "duel_arena",
  "name": "Duel Arena",
  "bounds": {
    "min": [1000, 0, 1000],
    "max": [1200, 50, 1300]
  },
  "pvpEnabled": false,
  "safeZone": true,
  "subZones": [
    {
      "id": "duel_arena_lobby",
      "name": "Duel Arena Lobby",
      "bounds": { "min": [1000, 0, 1000], "max": [1200, 10, 1100] },
      "canChallenge": true
    },
    {
      "id": "duel_arena_1",
      "name": "Arena 1",
      "bounds": { "min": [1000, 0, 1100], "max": [1060, 10, 1160] },
      "arenaId": 1,
      "arenaType": "flat",
      "spawnPoints": [
        { "x": 1020, "y": 0, "z": 1120 },
        { "x": 1040, "y": 0, "z": 1140 }
      ]
    },
    {
      "id": "duel_arena_viewing_1",
      "name": "Arena 1 Viewing",
      "bounds": { "min": [998, 8, 1098], "max": [1062, 12, 1162] },
      "isViewingPlatform": true,
      "viewsArena": 1
    }
    // ... more arenas and viewing platforms
  ]
}
```

### 4.2 Core Types (duel-types.ts)

```typescript
// ============================================================================
// DUEL RULES
// ============================================================================

export interface DuelRules {
  noRanged: boolean;
  noMelee: boolean;
  noMagic: boolean;
  noSpecialAttack: boolean;
  noPrayer: boolean;
  noPotions: boolean;
  noFood: boolean;
  noForfeit: boolean;
  noMovement: boolean;
  // obstacles: boolean; // NOT IMPLEMENTING - all arenas are flat
  funWeapons: boolean;
}

export const DEFAULT_DUEL_RULES: DuelRules = {
  noRanged: false,
  noMelee: false,
  noMagic: false,
  noSpecialAttack: false,
  noPrayer: false,
  noPotions: false,
  noFood: false,
  noForfeit: false,
  noMovement: false,
  funWeapons: false,
};

// Invalid rule combinations (OSRS restrictions)
export const INVALID_RULE_COMBINATIONS: Array<[keyof DuelRules, keyof DuelRules, string]> = [
  ['noForfeit', 'funWeapons', 'Cannot combine No Forfeit with Fun Weapons'],
  ['noForfeit', 'noMovement', 'Cannot combine No Forfeit with No Movement'],
];

/**
 * Validate rule combination - returns error message if invalid
 */
export function validateRuleCombination(rules: DuelRules): string | null {
  for (const [rule1, rule2, message] of INVALID_RULE_COMBINATIONS) {
    if (rules[rule1] && rules[rule2]) {
      return message;
    }
  }
  return null;
}

// Equipment slots that can be disabled
export type EquipmentSlotRestriction =
  | 'head' | 'cape' | 'amulet' | 'weapon' | 'body'
  | 'shield' | 'legs' | 'gloves' | 'boots' | 'ring' | 'ammo';

export interface EquipmentRestrictions {
  disabledSlots: EquipmentSlotRestriction[];
}

// ============================================================================
// STAKED ITEMS
// ============================================================================

export interface StakedItem {
  inventorySlot: number;  // Original slot in player's inventory
  itemId: string;
  quantity: number;
  value: number;          // Cached value at time of staking
}

// ============================================================================
// DUEL PARTICIPANT
// ============================================================================

export interface DuelParticipant {
  oderId: string;
  playerName: string;
  socketId: string;

  // Stakes
  stakedItems: StakedItem[];
  stakedGold: number;
  totalStakeValue: number;

  // Acceptance state (per screen)
  acceptedRules: boolean;
  acceptedStakes: boolean;
  acceptedFinal: boolean;

  // Combat state (during duel)
  currentHealth?: number;
  maxHealth?: number;
  isDead: boolean;
}

// ============================================================================
// DUEL SESSION
// ============================================================================

export type DuelState =
  | 'RULES'           // Selecting rules
  | 'STAKES'          // Adding stakes
  | 'CONFIRMING'      // Final confirmation screen
  | 'COUNTDOWN'       // 3-2-1-FIGHT
  | 'FIGHTING'        // Combat in progress
  | 'FINISHED';       // Duel complete, resolving

export interface DuelSession {
  duelId: string;
  arenaId: number;

  challenger: DuelParticipant;
  opponent: DuelParticipant;

  rules: DuelRules;
  equipmentRestrictions: EquipmentRestrictions;

  state: DuelState;

  // Timestamps
  createdAt: number;
  countdownStartedAt?: number;
  fightStartedAt?: number;
  finishedAt?: number;

  // Result
  winnerId?: string;
  loserId?: string;
  forfeitedBy?: string;
}

// ============================================================================
// ARENA
// ============================================================================

// All arenas are identical flat planes - no type distinction needed

export interface ArenaSpawnPoint {
  x: number;
  y: number;
  z: number;
}

export interface Arena {
  arenaId: number;
  type: ArenaType;
  inUse: boolean;
  currentDuelId: string | null;
  spawnPoints: [ArenaSpawnPoint, ArenaSpawnPoint];
  bounds: {
    min: { x: number; y: number; z: number };
    max: { x: number; y: number; z: number };
  };
}

// ============================================================================
// PENDING CHALLENGE
// ============================================================================

export interface PendingDuelChallenge {
  challengeId: string;
  challengerId: string;
  challengerName: string;
  challengerSocketId: string;
  targetId: string;
  targetName: string;
  createdAt: number;
  expiresAt: number;  // 30 seconds from creation
}

// ============================================================================
// NETWORK MESSAGES
// ============================================================================

// Client → Server
export interface DuelChallengeMessage {
  targetPlayerId: string;
}

export interface DuelChallengeResponseMessage {
  challengeId: string;
  accept: boolean;
}

export interface DuelToggleRuleMessage {
  duelId: string;
  rule: keyof DuelRules;
  enabled: boolean;
}

export interface DuelToggleEquipmentSlotMessage {
  duelId: string;
  slot: EquipmentSlotRestriction;
  disabled: boolean;
}

export interface DuelAddStakeMessage {
  duelId: string;
  inventorySlot: number;
  quantity: number;
}

export interface DuelRemoveStakeMessage {
  duelId: string;
  stakeIndex: number;
}

export interface DuelAcceptScreenMessage {
  duelId: string;
  screen: 'rules' | 'stakes' | 'final';
}

export interface DuelCancelAcceptMessage {
  duelId: string;
  screen: 'rules' | 'stakes' | 'final';
}

export interface DuelForfeitMessage {
  duelId: string;
}

export interface DuelCancelMessage {
  duelId: string;
}

// Server → Client
export interface DuelChallengeReceivedMessage {
  challengeId: string;
  challengerId: string;
  challengerName: string;
  challengerCombatLevel: number;
}

export interface DuelSessionUpdateMessage {
  duelId: string;
  session: DuelSession;
}

export interface DuelCountdownMessage {
  duelId: string;
  count: number;  // 3, 2, 1, 0 (0 = FIGHT!)
}

export interface DuelEndMessage {
  duelId: string;
  winnerId: string;
  winnerName: string;
  loserId: string;
  loserName: string;
  forfeit: boolean;
  winnerReceives: StakedItem[];
  winnerReceivesGold: number;
}

export interface DuelErrorMessage {
  error: string;
  errorCode: string;
}
```

### 4.3 DuelSystem Class Structure

```typescript
// /packages/server/src/systems/DuelSystem/index.ts

export class DuelSystem extends SystemBase {
  private arenaPool: ArenaPoolManager;
  private pendingChallenges: Map<string, PendingDuelChallenge>;
  private activeDuels: Map<string, DuelSession>;
  private playerToDuel: Map<string, string>;  // playerId → duelId

  constructor(world: World) {
    super(world, {
      name: "duel",
      dependencies: { required: ["combat", "inventory"], optional: [] },
    });

    this.arenaPool = new ArenaPoolManager(this.loadArenaConfig());
    this.pendingChallenges = new Map();
    this.activeDuels = new Map();
    this.playerToDuel = new Map();
  }

  // ─────────────────────────────────────────────────────────────
  // CHALLENGE PHASE
  // ─────────────────────────────────────────────────────────────

  createChallenge(
    challengerId: string,
    challengerName: string,
    challengerSocketId: string,
    targetId: string
  ): { success: boolean; error?: string; challengeId?: string }

  respondToChallenge(
    challengeId: string,
    accept: boolean
  ): { success: boolean; error?: string; duelId?: string }

  // ─────────────────────────────────────────────────────────────
  // RULES & STAKES PHASE
  // ─────────────────────────────────────────────────────────────

  toggleRule(
    duelId: string,
    playerId: string,
    rule: keyof DuelRules,
    enabled: boolean
  ): { success: boolean; error?: string }

  toggleEquipmentSlot(
    duelId: string,
    playerId: string,
    slot: EquipmentSlotRestriction,
    disabled: boolean
  ): { success: boolean; error?: string }

  addStake(
    duelId: string,
    playerId: string,
    inventorySlot: number,
    quantity: number
  ): { success: boolean; error?: string }

  removeStake(
    duelId: string,
    playerId: string,
    stakeIndex: number
  ): { success: boolean; error?: string }

  acceptScreen(
    duelId: string,
    playerId: string,
    screen: 'rules' | 'stakes' | 'final'
  ): { success: boolean; error?: string; advanceToNext?: boolean }

  cancelAccept(
    duelId: string,
    playerId: string,
    screen: 'rules' | 'stakes' | 'final'
  ): { success: boolean; error?: string }

  // ─────────────────────────────────────────────────────────────
  // COMBAT PHASE
  // ─────────────────────────────────────────────────────────────

  startCountdown(duelId: string): void

  startFight(duelId: string): void

  handlePlayerDeath(duelId: string, deadPlayerId: string): void

  handleForfeit(duelId: string, forfeitingPlayerId: string): void

  // ─────────────────────────────────────────────────────────────
  // RESOLUTION PHASE
  // ─────────────────────────────────────────────────────────────

  resolveDuel(duelId: string, winnerId: string, forfeit: boolean): void

  transferStakes(duelId: string): void

  teleportPlayersOut(duelId: string): void

  cleanupDuel(duelId: string): void

  // ─────────────────────────────────────────────────────────────
  // RULE ENFORCEMENT (called by combat system)
  // ─────────────────────────────────────────────────────────────

  isPlayerInDuel(playerId: string): boolean

  getDuelForPlayer(playerId: string): DuelSession | null

  canUseAttackStyle(playerId: string, style: 'melee' | 'ranged' | 'magic'): boolean

  canUseSpecialAttack(playerId: string): boolean

  canUsePrayer(playerId: string): boolean

  canEatFood(playerId: string): boolean

  canDrinkPotion(playerId: string): boolean

  canMove(playerId: string): boolean

  canForfeit(playerId: string): boolean

  // ─────────────────────────────────────────────────────────────
  // QUERIES
  // ─────────────────────────────────────────────────────────────

  getActiveDuel(duelId: string): DuelSession | null

  getPlayerDuel(playerId: string): DuelSession | null

  isArenaAvailable(): boolean

  getArenaStatus(): { total: number; inUse: number; available: number }
}
```

### 4.4 ArenaPoolManager

```typescript
// /packages/server/src/systems/DuelSystem/ArenaPoolManager.ts

export class ArenaPoolManager {
  private arenas: Map<number, Arena>;

  constructor(config: ArenaConfig[]) {
    this.arenas = new Map();
    for (const arena of config) {
      this.arenas.set(arena.arenaId, {
        ...arena,
        inUse: false,
        currentDuelId: null,
      });
    }
  }

  /**
   * Reserve an available arena for a duel
   * @returns Arena ID or null if none available
   */
  reserveArena(): number | null {
    // All arenas are identical - just find first available
    for (const [id, arena] of this.arenas) {
      if (!arena.inUse) {
        return id;
      }
    }
    return null; // All arenas busy
  }

  /**
   * Mark an arena as in use
   */
  claimArena(arenaId: number, duelId: string): boolean {
    const arena = this.arenas.get(arenaId);
    if (!arena || arena.inUse) {
      return false;
    }
    arena.inUse = true;
    arena.currentDuelId = duelId;
    return true;
  }

  /**
   * Release an arena back to the pool
   */
  releaseArena(arenaId: number): void {
    const arena = this.arenas.get(arenaId);
    if (arena) {
      arena.inUse = false;
      arena.currentDuelId = null;
    }
  }

  /**
   * Get arena details
   */
  getArena(arenaId: number): Arena | null {
    return this.arenas.get(arenaId) ?? null;
  }

  /**
   * Get arena for a specific duel
   */
  getArenaForDuel(duelId: string): Arena | null {
    for (const arena of this.arenas.values()) {
      if (arena.currentDuelId === duelId) {
        return arena;
      }
    }
    return null;
  }

  /**
   * Get pool status
   */
  getStatus(): { total: number; inUse: number; available: number } {
    let inUse = 0;
    for (const arena of this.arenas.values()) {
      if (arena.inUse) inUse++;
    }
    return {
      total: this.arenas.size,
      inUse,
      available: this.arenas.size - inUse,
    };
  }
}
```

### 4.5 State Machine Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           DUEL STATE MACHINE                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────┐                                                           │
│  │   PENDING    │  Player A challenges Player B                             │
│  │  CHALLENGE   │  30 second timeout                                        │
│  └──────┬───────┘                                                           │
│         │ Player B accepts                                                   │
│         ▼                                                                    │
│  ┌──────────────┐                                                           │
│  │    RULES     │  Both players toggle rules                                │
│  │    SCREEN    │  Either can modify → resets both acceptances              │
│  │              │  Both accept → advance to STAKES                          │
│  └──────┬───────┘                                                           │
│         │ Both accepted rules                                                │
│         ▼                                                                    │
│  ┌──────────────┐                                                           │
│  │    STAKES    │  Both players add/remove stakes                           │
│  │    SCREEN    │  Either modifies → resets both acceptances                │
│  │              │  Both accept → advance to CONFIRMING                      │
│  └──────┬───────┘                                                           │
│         │ Both accepted stakes                                               │
│         ▼                                                                    │
│  ┌──────────────┐                                                           │
│  │  CONFIRMING  │  Final review - READ ONLY                                 │
│  │    SCREEN    │  Shows final rules + stakes summary                       │
│  │              │  Both accept → reserve arena, teleport, start countdown   │
│  └──────┬───────┘                                                           │
│         │ Both accepted final                                                │
│         ▼                                                                    │
│  ┌──────────────┐                                                           │
│  │  COUNTDOWN   │  3... 2... 1... FIGHT!                                    │
│  │              │  Players frozen, facing each other                        │
│  │              │  Equipment restrictions applied                           │
│  └──────┬───────┘                                                           │
│         │ Countdown reaches 0                                                │
│         ▼                                                                    │
│  ┌──────────────┐                                                           │
│  │   FIGHTING   │  Combat enabled                                           │
│  │              │  Rules enforced (no food, no prayer, etc.)                │
│  │              │  Forfeit available (unless noForfeit rule)                │
│  └──────┬───────┘                                                           │
│         │ Player dies OR forfeits                                            │
│         ▼                                                                    │
│  ┌──────────────┐                                                           │
│  │   FINISHED   │  Winner declared                                          │
│  │              │  Stakes transferred to winner                             │
│  │              │  Loser teleported to hospital                             │
│  │              │  Winner teleported to lobby                               │
│  │              │  Arena released                                           │
│  └──────────────┘                                                           │
│                                                                              │
│  ════════════════════════════════════════════════════════════════════════   │
│  CANCEL CONDITIONS (any state before FIGHTING):                              │
│  - Either player clicks "Cancel" / closes panel                              │
│  - Either player disconnects                                                 │
│  - Either player moves too far from challenge location (RULES/STAKES only)  │
│  → Both players' staked items returned to inventory                          │
│  → Arena released (if reserved)                                              │
│                                                                              │
│  DISCONNECT DURING FIGHTING:                                                 │
│  - Disconnected player auto-forfeits after 30 seconds                       │
│  - OR other player wins immediately if noForfeit rule is active             │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.6 Forfeit Flow (Detailed Sequence)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           FORFEIT SEQUENCE                                   │
│                                                                              │
│  DURING FIGHTING STATE:                                                      │
│                                                                              │
│  1. Player right-clicks Trapdoor entity                                     │
│     └─→ Context menu appears with "Forfeit" option                          │
│         └─→ If noForfeit rule: shows "Forfeit (disabled)" grayed out        │
│                                                                              │
│  2. Player clicks "Forfeit"                                                 │
│     └─→ Confirmation dialog appears:                                        │
│         ┌────────────────────────────────────────────┐                      │
│         │  Forfeit this duel?                        │                      │
│         │                                            │                      │
│         │  You will lose all staked items:           │                      │
│         │  • 10,000 gp                               │                      │
│         │  • Rune scimitar                           │                      │
│         │                                            │                      │
│         │  [Cancel]                    [Forfeit]    │                      │
│         └────────────────────────────────────────────┘                      │
│                                                                              │
│  3. Player confirms forfeit                                                 │
│     └─→ Client sends: { event: 'duel:forfeit', duelId }                     │
│                                                                              │
│  4. Server validates:                                                        │
│     ├─→ Player is in active duel? ✓                                         │
│     ├─→ Duel state is FIGHTING? ✓                                           │
│     └─→ noForfeit rule is NOT active? ✓                                     │
│                                                                              │
│  5. Server resolves duel:                                                   │
│     ├─→ Forfeiter marked as loser                                           │
│     ├─→ Opponent marked as winner                                           │
│     ├─→ forfeitedBy field set (NOT recorded on scoreboard)                  │
│     ├─→ All stakes transferred to winner                                    │
│     └─→ State → FINISHED                                                    │
│                                                                              │
│  6. Server sends to both players:                                           │
│     └─→ { event: 'duel:finished', winnerId, loserId, reason: 'forfeit' }    │
│                                                                              │
│  7. Teleport:                                                               │
│     ├─→ Winner → Lobby spawn point                                          │
│     └─→ Loser (forfeiter) → Hospital spawn point                            │
│                                                                              │
│  8. Arena released back to pool                                             │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘

FORFEIT vs DEATH:
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Forfeit                    Death                      │
│  ─────────────────────────────────────────────────────────────────────────  │
│  Loser keeps items:     Yes                       Yes                       │
│  Stakes transferred:    Yes                       Yes                       │
│  Scoreboard recorded:   NO (forfeit not counted)  Yes                       │
│  Respawn location:      Hospital                  Hospital                  │
│  Winner gets stakes:    Yes                       Yes                       │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.7 Acceptance Reset Logic

```typescript
/**
 * When any modification is made, reset acceptance for both players
 * This prevents the "accept then quickly modify" scam
 */
private resetAcceptance(session: DuelSession, screen: 'rules' | 'stakes'): void {
  if (screen === 'rules') {
    session.challenger.acceptedRules = false;
    session.opponent.acceptedRules = false;
  } else if (screen === 'stakes') {
    session.challenger.acceptedStakes = false;
    session.opponent.acceptedStakes = false;
  }
  // Note: Final screen is read-only, no modifications possible
}

/**
 * Check if both players have accepted current screen
 */
private checkBothAccepted(session: DuelSession, screen: 'rules' | 'stakes' | 'final'): boolean {
  switch (screen) {
    case 'rules':
      return session.challenger.acceptedRules && session.opponent.acceptedRules;
    case 'stakes':
      return session.challenger.acceptedStakes && session.opponent.acceptedStakes;
    case 'final':
      return session.challenger.acceptedFinal && session.opponent.acceptedFinal;
  }
}

/**
 * Advance to next screen if both accepted
 */
private tryAdvanceScreen(session: DuelSession): void {
  if (session.state === 'RULES' && this.checkBothAccepted(session, 'rules')) {
    session.state = 'STAKES';
    this.broadcastSessionUpdate(session);
  } else if (session.state === 'STAKES' && this.checkBothAccepted(session, 'stakes')) {
    session.state = 'CONFIRMING';
    this.broadcastSessionUpdate(session);
  } else if (session.state === 'CONFIRMING' && this.checkBothAccepted(session, 'final')) {
    this.beginDuel(session);
  }
}
```

### 4.7 Rule Enforcement Integration

```typescript
// In CombatSystem - check duel rules before allowing actions

canPlayerAttack(attackerId: string, targetId: string, style: AttackStyle): boolean {
  const duelSystem = this.world.getSystem('duel') as DuelSystem;

  if (duelSystem?.isPlayerInDuel(attackerId)) {
    // Verify target is their duel opponent
    const duel = duelSystem.getDuelForPlayer(attackerId);
    if (!duel) return false;

    const opponentId = duel.challenger.playerId === attackerId
      ? duel.opponent.playerId
      : duel.challenger.playerId;

    if (targetId !== opponentId) {
      return false; // Can only attack duel opponent
    }

    // Check attack style rules
    if (!duelSystem.canUseAttackStyle(attackerId, style)) {
      return false;
    }
  }

  return true; // Normal combat checks
}

// In InventorySystem - check before eating/drinking

canConsumeItem(playerId: string, itemId: string, itemType: ItemType): boolean {
  const duelSystem = this.world.getSystem('duel') as DuelSystem;

  if (duelSystem?.isPlayerInDuel(playerId)) {
    if (itemType === 'food' && !duelSystem.canEatFood(playerId)) {
      return false;
    }
    if (itemType === 'potion' && !duelSystem.canDrinkPotion(playerId)) {
      return false;
    }
  }

  return true;
}

// In PrayerSystem - check before activating

canActivatePrayer(playerId: string): boolean {
  const duelSystem = this.world.getSystem('duel') as DuelSystem;

  if (duelSystem?.isPlayerInDuel(playerId)) {
    if (!duelSystem.canUsePrayer(playerId)) {
      return false;
    }
  }

  return true;
}
```

### 4.8 Death Handling (Duel vs Normal)

```typescript
// In CombatSystem.handleDeath()

handleDeath(deadPlayerId: string, killerId: string): void {
  const duelSystem = this.world.getSystem('duel') as DuelSystem;

  // Check if this death is part of a duel
  if (duelSystem?.isPlayerInDuel(deadPlayerId)) {
    const duel = duelSystem.getDuelForPlayer(deadPlayerId);
    if (duel && duel.state === 'FIGHTING') {
      // Duel death - no item drop, duel system handles resolution
      duelSystem.handlePlayerDeath(duel.duelId, deadPlayerId);
      return; // Skip normal death handling
    }
  }

  // Normal death handling (drop items, respawn at spawn point, etc.)
  this.handleNormalDeath(deadPlayerId, killerId);
}
```

---

## Part 5: UI Components

### 5.1 DuelPanel Structure

```
/packages/client/src/game/panels/DuelPanel/
├── index.ts                      # Barrel exports
├── DuelPanel.tsx                 # Main orchestration component
├── DuelChallengeModal.tsx        # "Player X challenges you" accept/decline
├── DuelResultModal.tsx           # "You won/lost!" result display
├── types.ts                      # Component-specific types
├── constants.ts                  # UI constants
│
├── screens/
│   ├── index.ts
│   ├── RulesScreen.tsx           # Toggle rules (11 checkboxes)
│   ├── StakesScreen.tsx          # Item staking grid (like TradePanel)
│   └── ConfirmScreen.tsx         # Read-only final confirmation
│
├── components/
│   ├── index.ts
│   ├── DuelRuleToggle.tsx        # Individual rule checkbox
│   ├── EquipmentSlotToggle.tsx   # Equipment slot disable checkbox
│   ├── StakeSlot.tsx             # Staked item display
│   ├── StakeGrid.tsx             # Grid of StakeSlots
│   ├── PlayerStakePanel.tsx      # One player's stake area
│   ├── AcceptButton.tsx          # Accept/waiting button
│   ├── ValueDisplay.tsx          # Total stake value
│   └── DuelCountdown.tsx         # 3-2-1-FIGHT overlay
│
└── hooks/
    ├── index.ts
    ├── useDuelSession.ts         # WebSocket subscription to duel updates
    └── useStakeManagement.ts     # Add/remove stake logic
```

### 5.2 Screen Layouts

**Rules Screen:**
```
┌─────────────────────────────────────────────────────────────┐
│                     DUEL OPTIONS                             │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  COMBAT RULES                    EQUIPMENT RESTRICTIONS      │
│  ┌─────────────────────────┐    ┌─────────────────────────┐ │
│  │ [ ] No Ranged           │    │ [ ] Head    [ ] Cape    │ │
│  │ [ ] No Melee            │    │ [ ] Amulet  [ ] Weapon  │ │
│  │ [ ] No Magic            │    │ [ ] Body    [ ] Shield  │ │
│  │ [ ] No Special Attack   │    │ [ ] Legs    [ ] Gloves  │ │
│  │ [ ] No Prayer           │    │ [ ] Boots   [ ] Ring    │ │
│  │ [ ] No Potions          │    │ [ ] Ammo                │ │
│  │ [ ] No Food             │    └─────────────────────────┘ │
│  │ [ ] No Forfeit          │                                │
│  │ [ ] No Movement         │                                │
│  │ [ ] Fun Weapons         │                                │
│  └─────────────────────────┘                                │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│  [  CANCEL  ]                              [  ACCEPT  ]     │
│                                                              │
│  Opponent: Waiting... / Accepted                            │
└─────────────────────────────────────────────────────────────┘
```

**Stakes Screen:**
```
┌─────────────────────────────────────────────────────────────┐
│                        STAKE                                 │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  YOUR OFFER              │  THEIR OFFER                     │
│  ┌─────────────────────┐ │ ┌─────────────────────────────┐  │
│  │ [item] [item] [   ] │ │ │ [item] [   ] [   ] [   ]   │  │
│  │ [   ] [   ] [   ]   │ │ │ [   ] [   ] [   ] [   ]     │  │
│  │ [   ] [   ] [   ]   │ │ │ [   ] [   ] [   ] [   ]     │  │
│  └─────────────────────┘ │ └─────────────────────────────┘  │
│  Value: 15,234 gp        │ Value: 12,500 gp                 │
│                          │                                   │
│  ┌─ YOUR INVENTORY ────────────────────────────────────┐    │
│  │ [item] [item] [item] [item] [item] [item] [item]   │    │
│  │ [item] [item] [item] [   ] [   ] [   ] [   ]       │    │
│  │ [   ] [   ] [   ] [   ] [   ] [   ] [   ]          │    │
│  │ [   ] [   ] [   ] [   ] [   ] [   ] [   ]          │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│  [  CANCEL  ]                              [  ACCEPT  ]     │
│                                                              │
│  Opponent: Waiting... / Accepted                            │
└─────────────────────────────────────────────────────────────┘
```

**Confirm Screen:**
```
┌─────────────────────────────────────────────────────────────┐
│                   CONFIRM DUEL                               │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ⚠️  PLEASE REVIEW CAREFULLY  ⚠️                            │
│                                                              │
│  DUEL RULES IN EFFECT:                                      │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ • No Food                                           │    │
│  │ • No Prayer                                         │    │
│  │ • No Special Attack                                 │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
│  EQUIPMENT DISABLED:                                        │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ • Head slot                                         │    │
│  │ • Shield slot                                       │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
│  IF YOU WIN, YOU RECEIVE:        IF YOU LOSE, THEY GET:    │
│  ┌────────────────────────┐     ┌────────────────────────┐ │
│  │ Dragon scimitar x1     │     │ Rune platebody x1      │ │
│  │ 10,000 gp              │     │ 5,000 gp               │ │
│  │                        │     │                        │ │
│  │ Total: 62,500 gp       │     │ Total: 43,200 gp       │ │
│  └────────────────────────┘     └────────────────────────┘ │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│  [  DECLINE  ]                          [  CONFIRM DUEL  ]  │
│                                                              │
│  Opponent: Waiting... / Confirmed                           │
└─────────────────────────────────────────────────────────────┘
```

---

## Part 6: Implementation Plan

### Phase 1: Foundation (Types & Zone Setup)
**Goal:** Establish data structures and physical arena locations

- [ ] **1.1** Create `/packages/shared/src/types/game/duel-types.ts`
  - All interfaces defined in Section 4.2
  - Export from types barrel

- [ ] **1.2** Add Duel Arena zone to `world-areas.json`
  - Main duel_arena zone
  - 6 sub-zones for individual arenas (all identical flat)
  - Viewing platform zones
  - Lobby zone with `canChallenge: true`
  - Hospital zone

- [ ] **1.3** Create arena manifests
  - `/packages/server/world/assets/manifests/duel-arenas.json`
  - Define spawn points, bounds, type for each arena

- [ ] **1.4** Add "Challenge" to player context menu
  - Only visible when in Duel Arena lobby zone
  - Show combat level of target player

### Phase 2: Challenge System
**Goal:** Player A can challenge Player B, B can accept/decline

- [ ] **2.1** Create `PendingDuelManager` (similar to `PendingTradeManager`)
  - Store pending challenges with 30s timeout
  - Clean up expired challenges

- [ ] **2.2** Implement challenge network handlers
  - `duel:challenge` - Create pending challenge
  - `duel:challenge:respond` - Accept/decline

- [ ] **2.3** Create `DuelChallengeModal` component
  - Shows challenger name and combat level
  - Accept / Decline buttons
  - Auto-dismiss on timeout

- [ ] **2.4** Create basic `DuelSystem` skeleton
  - Registration with world
  - Dependency on combat, inventory systems

### Phase 3: Rules Screen
**Goal:** Both players can toggle rules and accept

- [ ] **3.1** Create `DuelSession` management in `DuelSystem`
  - Create session when challenge accepted
  - Store in `activeDuels` Map
  - Track `playerToDuel` mapping

- [ ] **3.2** Implement rules handlers
  - `duel:toggle:rule` - Toggle a rule
  - `duel:accept:rules` - Accept current rules
  - Reset logic when either player modifies

- [ ] **3.3** Create `RulesScreen` component
  - 11 rule checkboxes
  - Equipment slot toggles
  - Accept button with opponent status

- [ ] **3.4** Create `DuelPanel` shell
  - Screen switching based on session state
  - Cancel button

### Phase 4: Stakes Screen
**Goal:** Both players can stake items/gold

- [ ] **4.1** Implement stakes handlers
  - `duel:add:stake` - Add item from inventory
  - `duel:remove:stake` - Remove staked item
  - `duel:accept:stakes` - Accept current stakes
  - Value calculation and display

- [ ] **4.2** Create `StakesScreen` component (adapt from TradePanel)
  - My stakes grid
  - Their stakes grid
  - Inventory panel
  - Value displays

- [ ] **4.3** Implement stake validation
  - Can't stake equipped items
  - Can't stake untradeable items
  - Quantity limits

- [ ] **4.4** Add anti-scam warnings
  - "Opponent modified stake" message
  - Reset acceptance on modification

### Phase 5: Confirmation Screen
**Goal:** Final read-only review before duel starts

- [ ] **5.1** Implement confirm handlers
  - `duel:accept:final` - Final confirmation
  - Arena reservation on both accept

- [ ] **5.2** Create `ConfirmScreen` component
  - Summary of active rules
  - Summary of disabled equipment
  - "You receive if win" / "They get if you lose"
  - Final accept button

- [ ] **5.3** Implement `ArenaPoolManager`
  - Load arena config
  - Reserve/release logic
  - Assign first available arena

### Phase 6: Teleportation & Countdown
**Goal:** Players teleported to arena, countdown begins

- [ ] **6.1** Implement arena teleportation
  - Get spawn points from arena config
  - Teleport both players
  - Face players toward each other

- [ ] **6.2** Apply equipment restrictions
  - Unequip items in disabled slots
  - Move to inventory (must have space - validated earlier)

- [ ] **6.3** Implement countdown system
  - Server sends countdown messages (3, 2, 1, FIGHT)
  - Players frozen during countdown
  - `DuelCountdown` overlay component

- [ ] **6.4** Enable combat on countdown complete
  - Set session state to FIGHTING
  - Players can now attack

### Phase 7: Duel Combat
**Goal:** Combat with rule enforcement

- [ ] **7.1** Integrate rule checks into CombatSystem
  - Check attack style restrictions
  - Check special attack restriction

- [ ] **7.2** Integrate rule checks into InventorySystem
  - Block food consumption if noFood
  - Block potion consumption if noPotions

- [ ] **7.3** Integrate rule checks into PrayerSystem
  - Block prayer if noPrayer
  - Drain prayer points at duel start if noPrayer

- [ ] **7.4** Implement movement restriction
  - If noMovement, freeze both players in place

- [ ] **7.5** Implement forfeit system (trapdoor-based)
  - Create `TrapdoorEntity` (interactable, positioned at arena edges)
  - 4 trapdoors per arena (2 east, 2 west side)
  - Right-click trapdoor → "Forfeit" option
  - Confirmation dialog: "Forfeit duel? You will lose all staked items."
  - `duel:forfeit` handler validates:
    - Player is in active duel (FIGHTING state)
    - noForfeit rule is NOT active
  - If noForfeit active, show message: "You cannot forfeit - this duel is to the death!"
  - Forfeit triggers duel resolution (forfeiter loses)
  - Forfeiter NOT recorded on scoreboard (forfeit ≠ death)

- [ ] **7.6** Implement rule combination validation
  - Block noForfeit + funWeapons
  - Block noForfeit + noMovement
  - Show error message when invalid combo toggled

### Phase 8: Resolution & Cleanup
**Goal:** Handle duel end, transfer stakes, cleanup

- [ ] **8.1** Implement duel death handling
  - Detect death in duel context
  - Skip normal death (no item drop)
  - Trigger duel resolution

- [ ] **8.2** Implement stake transfer
  - Winner receives all stakes from loser
  - Add to winner's inventory
  - Handle inventory space (validated beforehand)

- [ ] **8.3** Implement post-duel teleportation
  - Loser → Hospital
  - Winner → Lobby

- [ ] **8.4** Implement cleanup
  - Release arena
  - Remove session from active duels
  - Clear player-to-duel mappings

- [ ] **8.5** Create `DuelResultModal`
  - "You won!" / "You lost!"
  - Show what you received/lost
  - Dismiss button

### Phase 9: Edge Cases & Polish
**Goal:** Handle disconnects, errors, polish UI

- [ ] **9.1** Handle disconnect during setup
  - Cancel duel
  - Return staked items to both players
  - Release arena if reserved

- [ ] **9.2** Handle disconnect during combat
  - Start 30 second timer
  - If player doesn't reconnect, auto-forfeit
  - (Or instant loss if noForfeit rule)

- [ ] **9.3** Handle server restart
  - Persist active duels to database?
  - Or cancel all duels on restart (simpler)

- [ ] **9.4** Add duel-specific HUD elements
  - Opponent health bar (larger, prominent)
  - Forfeit button (if allowed)
  - Rule indicators

- [ ] **9.5** Polish animations
  - Teleport effects
  - Countdown numbers
  - Victory/defeat effects

### Phase 10: World Building (Temporary Procedural Approach)
**Goal:** Build the Duel Arena using procedural geometry (no building assets yet)

- [ ] **10.1** Register flat zones in world-areas.json
  - Lobby flat zone (60m x 30m)
  - 6 arena flat zones (20m x 20m each)
  - Hospital flat zone (20m x 15m)
  - Viewing walkway zones (elevated)

- [ ] **10.2** Create `DuelArenaVisualsSystem` (client)
  - Tan `PlaneGeometry` for arena floors (6 identical 16m x 16m planes)
  - Brown `BoxGeometry` for arena walls (4 walls per arena)
  - All geometry created procedurally on init - no models needed

- [ ] **10.3** Register collision tiles
  - Arena floor = walkable
  - Arena walls = blocked (visual BoxGeometry walls)
  - Server-side movement clamping as backup

- [ ] **10.4** Add NPCs
  - Nurse NPC (restore health/prayer)
  - Scoreboard NPC (view rankings)
  - Maybe a tutorial NPC

- [ ] **10.5** Add decorative elements (future)
  - Arena floor textures (currently just tan planes)
  - Spectator stands (currently just flattened terrain)

---

## Part 7: File Structure Summary

```
/packages/shared/src/types/game/
└── duel-types.ts                 # All duel interfaces

/packages/server/src/systems/DuelSystem/
├── index.ts                      # Main DuelSystem class
├── ArenaPoolManager.ts           # Arena reservation
├── PendingDuelManager.ts         # Pending challenges
├── DuelRulesEnforcer.ts          # Rule validation helpers
└── DuelStakeManager.ts           # Stake add/remove/transfer

/packages/server/src/systems/ServerNetwork/handlers/duel/
├── index.ts                      # Barrel exports
├── challenge.ts                  # Challenge handlers
├── rules.ts                      # Rule toggle handlers
├── stakes.ts                     # Stake handlers
├── acceptance.ts                 # Accept screen handlers
└── actions.ts                    # Forfeit, cancel handlers

/packages/server/world/assets/manifests/
└── duel-arenas.json              # Arena configurations

/packages/client/src/game/panels/DuelPanel/
├── index.ts
├── DuelPanel.tsx
├── DuelChallengeModal.tsx
├── DuelResultModal.tsx
├── types.ts
├── constants.ts
├── screens/
│   ├── RulesScreen.tsx
│   ├── StakesScreen.tsx
│   └── ConfirmScreen.tsx
├── components/
│   ├── DuelRuleToggle.tsx
│   ├── EquipmentSlotToggle.tsx
│   ├── StakeSlot.tsx
│   ├── StakeGrid.tsx
│   ├── AcceptButton.tsx
│   ├── ValueDisplay.tsx
│   └── DuelCountdown.tsx
└── hooks/
    ├── useDuelSession.ts
    └── useStakeManagement.ts
```

---

## Part 8: Open Decisions

| Decision | Options | Recommendation |
|----------|---------|----------------|
| Number of arenas | 4, 6, or 8 | 6 (all identical flat) |
| Stake tax | 0%, 1%, or 5% | Start with 0%, add later if needed for gold sink |
| Max stake value | Unlimited or capped | Start unlimited, add cap if RWT becomes issue |
| Forfeit penalty | None or lose 10% extra | None - OSRS doesn't have extra penalty |
| Spectator limit | Unlimited or max per arena | Unlimited - let performance dictate |
| Duel rankings | Track wins/losses? | Yes, simple W/L/Total stored on player |
| Challenge range | Must be in lobby, or anywhere in zone? | Lobby only - cleaner design |
| Reconnect grace | 30 seconds | 30 seconds, or instant loss if noForfeit |

---

## Part 9: Testing Checklist

### Unit Tests
- [ ] ArenaPoolManager reserve/release logic
- [ ] DuelRules validation
- [ ] Stake value calculation
- [ ] Acceptance state machine

### Integration Tests
- [ ] Full challenge → accept → rules → stakes → confirm → fight → win flow
- [ ] Disconnect during each phase
- [ ] Cancel during each phase
- [ ] Rule enforcement (try to eat when noFood, etc.)
- [ ] Stake transfer on win
- [ ] Arena release after duel

### Manual Testing
- [ ] Two players complete a duel
- [ ] Spectator watches from platform
- [ ] All 11 rules work correctly
- [ ] Equipment restrictions work
- [ ] Anti-scam warnings appear
- [ ] Countdown feels good
- [ ] Victory/defeat feels satisfying

---

## Part 10: Production Quality Standards

### 10.1 SOLID Principles Compliance

#### Single Responsibility Principle (SRP)
Break `DuelSystem` into focused services:

```typescript
/packages/server/src/systems/DuelSystem/
├── index.ts                      # DuelSystem orchestrator (thin layer)
├── services/
│   ├── DuelChallengeService.ts   # Challenge creation, timeout, response
│   ├── DuelSessionService.ts     # Session CRUD, state transitions
│   ├── DuelRulesService.ts       # Rule toggle, validation, enforcement
│   ├── DuelStakeService.ts       # Stake add/remove, value calc, transfer
│   ├── DuelCombatService.ts      # Combat rule checks, death handling
│   └── DuelTeleportService.ts    # Arena teleport, spawn positioning
├── ArenaPoolManager.ts           # Arena reservation only
├── PendingDuelManager.ts         # Pending challenges only
└── interfaces/
    ├── IDuelChallengeService.ts
    ├── IDuelSessionService.ts
    ├── IDuelRulesService.ts
    ├── IDuelStakeService.ts
    ├── IDuelCombatService.ts
    └── IDuelTeleportService.ts
```

#### Open/Closed Principle (OCP)
Design for extension without modification:

```typescript
// Rule enforcement via strategy pattern
interface IDuelRuleEnforcer {
  readonly ruleKey: keyof DuelRules;
  shouldBlock(action: DuelAction, session: DuelSession): boolean;
  getBlockMessage(): string;
}

class NoFoodEnforcer implements IDuelRuleEnforcer {
  readonly ruleKey = 'noFood' as const;

  shouldBlock(action: DuelAction, session: DuelSession): boolean {
    return action.type === 'CONSUME' &&
           action.itemType === 'food' &&
           session.rules.noFood;
  }

  getBlockMessage(): string {
    return 'Food is not allowed in this duel.';
  }
}

// Register enforcers - new rules just add new classes
const enforcers: IDuelRuleEnforcer[] = [
  new NoFoodEnforcer(),
  new NoPotionEnforcer(),
  new NoPrayerEnforcer(),
  new NoMovementEnforcer(),
  // ... easy to add more
];
```

#### Liskov Substitution Principle (LSP)
All arena types must be interchangeable:

```typescript
interface IArena {
  readonly arenaId: number;
  readonly type: ArenaType;
  readonly spawnPoints: readonly [ArenaSpawnPoint, ArenaSpawnPoint];
  readonly bounds: Readonly<ArenaBounds>;

  getSpawnPoint(playerIndex: 0 | 1): ArenaSpawnPoint;
  isPositionInBounds(x: number, z: number): boolean;
}

class Arena implements IArena { /* All arenas are identical */ }
```

#### Interface Segregation Principle (ISP)
Split large interfaces into focused ones:

```typescript
// Instead of one giant IDuelSystem interface:

interface IDuelChallengeOperations {
  createChallenge(challenger: ChallengerInfo, targetId: string): DuelResult;
  respondToChallenge(challengeId: string, accept: boolean): DuelResult;
  cancelChallenge(challengeId: string): DuelResult;
}

interface IDuelSessionOperations {
  getSession(duelId: string): DuelSession | null;
  getPlayerSession(playerId: string): DuelSession | null;
  isPlayerInDuel(playerId: string): boolean;
}

interface IDuelRuleOperations {
  toggleRule(duelId: string, playerId: string, rule: keyof DuelRules): DuelResult;
  canUseAttackStyle(playerId: string, style: AttackStyle): boolean;
  canEatFood(playerId: string): boolean;
  canDrinkPotion(playerId: string): boolean;
}

interface IDuelStakeOperations {
  addStake(duelId: string, playerId: string, item: StakeItem): DuelResult;
  removeStake(duelId: string, playerId: string, index: number): DuelResult;
  transferStakes(duelId: string, winnerId: string): DuelResult;
}
```

#### Dependency Inversion Principle (DIP)
Depend on abstractions, inject dependencies:

```typescript
class DuelSystem extends SystemBase {
  constructor(
    world: World,
    private readonly challengeService: IDuelChallengeService,
    private readonly sessionService: IDuelSessionService,
    private readonly rulesService: IDuelRulesService,
    private readonly stakeService: IDuelStakeService,
    private readonly combatService: IDuelCombatService,
    private readonly teleportService: IDuelTeleportService,
    private readonly arenaPool: IArenaPool,
  ) {
    super(world, { name: 'duel', dependencies: { required: [], optional: [] } });
  }

  // Factory for production
  static create(world: World): DuelSystem {
    const arenaPool = new ArenaPoolManager(loadArenaConfig());
    const sessionService = new DuelSessionService();
    // ... wire up dependencies
    return new DuelSystem(world, challengeService, sessionService, ...);
  }

  // Factory for testing
  static createForTest(world: World, mocks: Partial<DuelDependencies>): DuelSystem {
    // Inject mock services for unit testing
  }
}
```

---

### 10.2 Memory & Allocation Hygiene

#### Pre-allocated Reusables
```typescript
// In DuelTeleportService - reuse vectors instead of allocating in hot paths
class DuelTeleportService {
  // Pre-allocated vectors for teleport calculations
  private readonly _spawnPosition = new THREE.Vector3();
  private readonly _lookAtTarget = new THREE.Vector3();
  private readonly _direction = new THREE.Vector3();
  private readonly _quaternion = new THREE.Quaternion();

  teleportToArena(
    player: Player,
    arena: IArena,
    playerIndex: 0 | 1
  ): void {
    const spawn = arena.getSpawnPoint(playerIndex);
    const opponentSpawn = arena.getSpawnPoint(playerIndex === 0 ? 1 : 0);

    // Reuse pre-allocated vectors
    this._spawnPosition.set(spawn.x, spawn.y, spawn.z);
    this._lookAtTarget.set(opponentSpawn.x, opponentSpawn.y, opponentSpawn.z);

    // Calculate facing direction without new allocations
    this._direction.subVectors(this._lookAtTarget, this._spawnPosition).normalize();
    this._quaternion.setFromUnitVectors(FORWARD_VECTOR, this._direction);

    player.teleport(this._spawnPosition, this._quaternion);
  }
}
```

#### Object Pooling for Duel Sessions
```typescript
class DuelSessionPool {
  private readonly pool: DuelSession[] = [];
  private readonly maxPoolSize = 32; // Max concurrent duels * 2

  acquire(duelId: string, challenger: DuelParticipant, opponent: DuelParticipant): DuelSession {
    let session = this.pool.pop();

    if (!session) {
      session = this.createEmptySession();
    }

    // Reset and initialize
    this.resetSession(session, duelId, challenger, opponent);
    return session;
  }

  release(session: DuelSession): void {
    // Clear references to prevent memory leaks
    this.clearSession(session);

    if (this.pool.length < this.maxPoolSize) {
      this.pool.push(session);
    }
    // Otherwise let GC collect it
  }

  private clearSession(session: DuelSession): void {
    session.duelId = '';
    session.challenger = null!;
    session.opponent = null!;
    session.winnerId = undefined;
    session.loserId = undefined;
    // Clear arrays by length = 0 to reuse buffer
    if (session.challenger?.stakedItems) {
      session.challenger.stakedItems.length = 0;
    }
  }
}
```

#### Avoid Allocations in Update Loops
```typescript
// BAD - allocates every frame
update() {
  const activeDuels = Array.from(this.activeDuels.values()); // Allocation!
  for (const duel of activeDuels) {
    if (duel.state === 'COUNTDOWN') {
      const elapsed = Date.now() - duel.countdownStartedAt!; // OK
    }
  }
}

// GOOD - no allocations
update() {
  // Iterate map directly
  for (const duel of this.activeDuels.values()) {
    if (duel.state === 'COUNTDOWN') {
      const elapsed = Date.now() - duel.countdownStartedAt!;
    }
  }
}
```

#### Typed Arrays for Bulk Operations
```typescript
// For countdown timing - use pre-allocated buffer
class CountdownManager {
  // Pre-allocated array for countdown ticks
  private readonly countdownTicks = new Float64Array(32); // Max 32 concurrent duels
  private readonly duelIds: string[] = new Array(32).fill('');
  private activeCount = 0;

  startCountdown(duelId: string, startTime: number): number {
    const index = this.activeCount++;
    this.duelIds[index] = duelId;
    this.countdownTicks[index] = startTime;
    return index;
  }

  update(currentTime: number): void {
    for (let i = 0; i < this.activeCount; i++) {
      const elapsed = currentTime - this.countdownTicks[i];
      // No allocations in this hot path
    }
  }
}
```

---

### 10.3 OWASP Security Standards

#### Input Validation (All Network Messages)
```typescript
// Zod schemas for runtime validation
import { z } from 'zod';

const DuelChallengeSchema = z.object({
  targetPlayerId: z.string().uuid('Invalid player ID format'),
});

const DuelToggleRuleSchema = z.object({
  duelId: z.string().uuid(),
  rule: z.enum([
    'noRanged', 'noMelee', 'noMagic', 'noSpecialAttack',
    'noPrayer', 'noPotions', 'noFood', 'noForfeit',
    'noMovement', 'funWeapons'
  ]),
  enabled: z.boolean(),
});

const DuelAddStakeSchema = z.object({
  duelId: z.string().uuid(),
  inventorySlot: z.number().int().min(0).max(27),
  quantity: z.number().int().min(1).max(2147483647),
});

// Handler with validation
function handleDuelAddStake(socket: Socket, data: unknown): void {
  const parsed = DuelAddStakeSchema.safeParse(data);
  if (!parsed.success) {
    socket.emit('duel:error', {
      error: 'Invalid request',
      errorCode: 'INVALID_INPUT'
    });
    return;
  }

  // Now data is typed and validated
  const { duelId, inventorySlot, quantity } = parsed.data;
  // Proceed with validated data
}
```

#### Rate Limiting
```typescript
class DuelRateLimiter {
  private readonly challengeAttempts = new Map<string, number[]>();
  private readonly stakeModifications = new Map<string, number[]>();

  // Max 3 challenges per 30 seconds
  private readonly CHALLENGE_LIMIT = 3;
  private readonly CHALLENGE_WINDOW_MS = 30000;

  // Max 30 stake modifications per minute (prevent spam clicking)
  private readonly STAKE_LIMIT = 30;
  private readonly STAKE_WINDOW_MS = 60000;

  canChallenge(playerId: string): boolean {
    return this.checkLimit(
      this.challengeAttempts,
      playerId,
      this.CHALLENGE_LIMIT,
      this.CHALLENGE_WINDOW_MS
    );
  }

  canModifyStake(playerId: string): boolean {
    return this.checkLimit(
      this.stakeModifications,
      playerId,
      this.STAKE_LIMIT,
      this.STAKE_WINDOW_MS
    );
  }

  private checkLimit(
    map: Map<string, number[]>,
    playerId: string,
    limit: number,
    windowMs: number
  ): boolean {
    const now = Date.now();
    let attempts = map.get(playerId) || [];

    // Remove old attempts outside window
    attempts = attempts.filter(t => now - t < windowMs);

    if (attempts.length >= limit) {
      return false;
    }

    attempts.push(now);
    map.set(playerId, attempts);
    return true;
  }
}
```

#### Access Control
```typescript
class DuelAccessControl {
  /**
   * Verify player has permission to perform duel action
   */
  canPerformAction(
    playerId: string,
    duelId: string,
    action: DuelActionType
  ): { allowed: boolean; reason?: string } {
    const session = this.sessionService.getSession(duelId);

    // Session must exist
    if (!session) {
      return { allowed: false, reason: 'Duel session not found' };
    }

    // Player must be participant
    const isParticipant =
      session.challenger.playerId === playerId ||
      session.opponent.playerId === playerId;

    if (!isParticipant) {
      return { allowed: false, reason: 'Not a participant in this duel' };
    }

    // State-specific checks
    switch (action) {
      case 'TOGGLE_RULE':
        if (session.state !== 'RULES') {
          return { allowed: false, reason: 'Cannot modify rules in current state' };
        }
        break;

      case 'ADD_STAKE':
      case 'REMOVE_STAKE':
        if (session.state !== 'STAKES') {
          return { allowed: false, reason: 'Cannot modify stakes in current state' };
        }
        break;

      case 'FORFEIT':
        if (session.state !== 'FIGHTING') {
          return { allowed: false, reason: 'Cannot forfeit - duel not in progress' };
        }
        if (session.rules.noForfeit) {
          return { allowed: false, reason: 'Forfeit is disabled for this duel' };
        }
        break;
    }

    return { allowed: true };
  }
}
```

#### Audit Logging
```typescript
interface DuelAuditEvent {
  timestamp: string;
  eventType: DuelAuditEventType;
  duelId: string;
  playerId?: string;
  data: Record<string, unknown>;
}

type DuelAuditEventType =
  | 'CHALLENGE_SENT'
  | 'CHALLENGE_ACCEPTED'
  | 'CHALLENGE_DECLINED'
  | 'DUEL_STARTED'
  | 'STAKE_ADDED'
  | 'STAKE_REMOVED'
  | 'DUEL_COMPLETED'
  | 'DUEL_CANCELLED'
  | 'STAKE_TRANSFERRED'
  | 'SUSPICIOUS_ACTIVITY';

class DuelAuditLogger {
  log(event: DuelAuditEvent): void {
    // Structured logging for aggregation
    console.log('[DUEL_AUDIT]', JSON.stringify(event));

    // Emit for potential database persistence
    this.world.emit('duel:audit', event);
  }

  logStakeTransfer(
    duelId: string,
    winnerId: string,
    loserId: string,
    stakes: TransferredStakes
  ): void {
    this.log({
      timestamp: new Date().toISOString(),
      eventType: 'STAKE_TRANSFERRED',
      duelId,
      data: {
        winnerId,
        loserId,
        winnerReceived: stakes.items.map(i => ({
          itemId: i.itemId,
          quantity: i.quantity,
          value: i.value
        })),
        totalValue: stakes.totalValue,
      }
    });
  }

  logSuspiciousActivity(
    duelId: string,
    playerId: string,
    reason: string,
    details: Record<string, unknown>
  ): void {
    this.log({
      timestamp: new Date().toISOString(),
      eventType: 'SUSPICIOUS_ACTIVITY',
      duelId,
      playerId,
      data: { reason, ...details }
    });
  }
}
```

---

### 10.4 Server Authority & Anti-Cheat

#### All Game Logic Server-Side
```typescript
// NEVER trust client values

// BAD - trusting client
handleDuelDamage(socket, { duelId, damage, targetId }) {
  const duel = this.getDuel(duelId);
  duel.opponent.currentHealth -= damage; // Client sent damage value!
}

// GOOD - server calculates everything
handleDuelAttack(socket, { duelId }) {
  const playerId = this.getPlayerId(socket);
  const duel = this.getDuel(duelId);

  // Server validates attacker is in duel
  if (!this.isParticipant(duel, playerId)) return;

  // Server calculates damage using authoritative stats
  const attacker = this.getPlayer(playerId);
  const defender = this.getOpponent(duel, playerId);

  // Use server-side damage calculation (existing CombatSystem)
  const damage = this.combatSystem.calculateDamage(attacker, defender);

  // Server applies damage
  defender.currentHealth = Math.max(0, defender.currentHealth - damage);

  // Broadcast result to both clients
  this.broadcastDamage(duel, playerId, damage);
}
```

#### Stake Verification
```typescript
class DuelStakeVerifier {
  /**
   * Verify player actually owns the items they're trying to stake
   * Called on EVERY stake operation
   */
  verifyStake(
    playerId: string,
    inventorySlot: number,
    quantity: number
  ): { valid: boolean; error?: string } {
    const inventory = this.inventorySystem.getInventory(playerId);

    // Verify slot exists
    if (inventorySlot < 0 || inventorySlot >= inventory.size) {
      return { valid: false, error: 'Invalid inventory slot' };
    }

    const item = inventory.getItem(inventorySlot);

    // Verify item exists
    if (!item) {
      return { valid: false, error: 'No item in slot' };
    }

    // Verify quantity
    if (item.quantity < quantity) {
      return { valid: false, error: 'Insufficient quantity' };
    }

    // Verify item is tradeable
    const itemDef = getItemDefinition(item.itemId);
    if (!itemDef.tradeable) {
      return { valid: false, error: 'Item is not tradeable' };
    }

    // Verify item is not already staked
    const existingStake = this.getExistingStake(playerId, inventorySlot);
    if (existingStake) {
      return { valid: false, error: 'Item already staked' };
    }

    return { valid: true };
  }

  /**
   * Re-verify all stakes before duel starts
   * Prevents race conditions or inventory changes during setup
   */
  verifyAllStakes(session: DuelSession): { valid: boolean; error?: string } {
    for (const participant of [session.challenger, session.opponent]) {
      for (const stake of participant.stakedItems) {
        const result = this.verifyStake(
          participant.playerId,
          stake.inventorySlot,
          stake.quantity
        );
        if (!result.valid) {
          return {
            valid: false,
            error: `${participant.playerName}'s stake invalid: ${result.error}`
          };
        }
      }
    }
    return { valid: true };
  }
}
```

#### Position Validation
```typescript
/**
 * Ensure players can't teleport-hack out of arena
 */
class DuelPositionValidator {
  private readonly POSITION_CHECK_INTERVAL_MS = 1000;
  private readonly MAX_DISTANCE_FROM_ARENA = 2; // 2 units tolerance

  validatePosition(session: DuelSession): void {
    if (session.state !== 'FIGHTING') return;

    const arena = this.arenaPool.getArena(session.arenaId);
    if (!arena) return;

    for (const participant of [session.challenger, session.opponent]) {
      const player = this.getPlayer(participant.playerId);
      const pos = player.getPosition();

      if (!arena.isPositionInBounds(pos.x, pos.z, this.MAX_DISTANCE_FROM_ARENA)) {
        // Player outside arena bounds - possible hack
        this.auditLogger.logSuspiciousActivity(
          session.duelId,
          participant.playerId,
          'POSITION_OUTSIDE_ARENA',
          { position: { x: pos.x, y: pos.y, z: pos.z }, arenaBounds: arena.bounds }
        );

        // Teleport back to spawn
        const spawnIndex = participant === session.challenger ? 0 : 1;
        const spawn = arena.getSpawnPoint(spawnIndex);
        player.teleport(spawn.x, spawn.y, spawn.z);
      }
    }
  }
}
```

---

### 10.5 Error Handling Patterns

#### Result Type Pattern
```typescript
// Never throw in business logic - return result types
type DuelResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string; errorCode: DuelErrorCode };

type DuelErrorCode =
  | 'PLAYER_NOT_IN_ZONE'
  | 'PLAYER_ALREADY_IN_DUEL'
  | 'TARGET_ALREADY_IN_DUEL'
  | 'NO_ARENA_AVAILABLE'
  | 'INVALID_SESSION_STATE'
  | 'INSUFFICIENT_INVENTORY_SPACE'
  | 'INVALID_STAKE'
  | 'RATE_LIMITED'
  | 'ACCESS_DENIED'
  | 'INTERNAL_ERROR';

// Usage
createChallenge(challengerId: string, targetId: string): DuelResult<{ challengeId: string }> {
  // Validate zone
  if (!this.isInDuelArenaLobby(challengerId)) {
    return {
      success: false,
      error: 'You must be in the Duel Arena lobby to challenge',
      errorCode: 'PLAYER_NOT_IN_ZONE'
    };
  }

  // Validate not already in duel
  if (this.isPlayerInDuel(challengerId)) {
    return {
      success: false,
      error: 'You are already in a duel',
      errorCode: 'PLAYER_ALREADY_IN_DUEL'
    };
  }

  // Rate limit check
  if (!this.rateLimiter.canChallenge(challengerId)) {
    return {
      success: false,
      error: 'Too many challenge attempts. Please wait.',
      errorCode: 'RATE_LIMITED'
    };
  }

  // Success
  const challengeId = this.challengeService.create(challengerId, targetId);
  return { success: true, data: { challengeId } };
}
```

#### Graceful Degradation
```typescript
/**
 * If stake transfer fails partially, roll back
 */
async transferStakes(session: DuelSession): Promise<DuelResult> {
  const winnerId = session.winnerId!;
  const loserId = session.loserId!;

  const transferredItems: TransferRecord[] = [];

  try {
    // Lock both inventories
    await this.inventorySystem.acquireLock(winnerId);
    await this.inventorySystem.acquireLock(loserId);

    // Transfer each stake
    for (const stake of this.getLoserStakes(session)) {
      const result = await this.inventorySystem.transferItem(
        loserId,
        winnerId,
        stake.inventorySlot,
        stake.quantity
      );

      if (!result.success) {
        // Rollback all previous transfers
        await this.rollbackTransfers(transferredItems);
        return {
          success: false,
          error: 'Stake transfer failed - all items returned',
          errorCode: 'INTERNAL_ERROR'
        };
      }

      transferredItems.push({ stake, fromSlot: result.fromSlot, toSlot: result.toSlot });
    }

    // All transfers successful
    this.auditLogger.logStakeTransfer(session.duelId, winnerId, loserId, transferredItems);
    return { success: true, data: undefined };

  } catch (error) {
    // Unexpected error - attempt rollback
    await this.rollbackTransfers(transferredItems);
    this.auditLogger.logSuspiciousActivity(
      session.duelId,
      winnerId,
      'STAKE_TRANSFER_ERROR',
      { error: String(error) }
    );
    return { success: false, error: 'Internal error', errorCode: 'INTERNAL_ERROR' };

  } finally {
    // Always release locks
    this.inventorySystem.releaseLock(winnerId);
    this.inventorySystem.releaseLock(loserId);
  }
}
```

---

### 10.6 Testing Strategy

#### Unit Test Coverage Requirements
```typescript
// ArenaPoolManager.test.ts
describe('ArenaPoolManager', () => {
  describe('reserveArena', () => {
    it('should return first available arena');
    it('should return null when all arenas in use');
    it('should not return already-claimed arenas');
  });

  describe('claimArena', () => {
    it('should mark arena as in use');
    it('should associate duelId with arena');
    it('should fail if arena already claimed');
    it('should fail for invalid arenaId');
  });

  describe('releaseArena', () => {
    it('should mark arena as available');
    it('should clear duelId association');
    it('should be idempotent for unclaimed arenas');
  });
});

// DuelSessionService.test.ts
describe('DuelSessionService', () => {
  describe('state transitions', () => {
    it('should transition RULES -> STAKES when both accept rules');
    it('should reset acceptance when rules modified');
    it('should transition STAKES -> CONFIRMING when both accept stakes');
    it('should reset acceptance when stakes modified');
    it('should transition CONFIRMING -> COUNTDOWN when both accept final');
    it('should not allow backward transitions');
    it('should transition FIGHTING -> FINISHED on death');
    it('should transition FIGHTING -> FINISHED on forfeit');
  });
});

// DuelStakeVerifier.test.ts
describe('DuelStakeVerifier', () => {
  it('should reject stake from invalid slot');
  it('should reject stake of item player does not own');
  it('should reject stake quantity greater than owned');
  it('should reject untradeable items');
  it('should reject already-staked items');
  it('should accept valid stake');
});
```

#### Integration Test Scenarios
```typescript
// duel-flow.integration.test.ts
describe('Duel Arena Full Flow', () => {
  it('complete duel: challenge -> rules -> stakes -> confirm -> fight -> win', async () => {
    // Setup two players in lobby
    const [player1, player2] = await createTestPlayers(2, { zone: 'duel_arena_lobby' });

    // Player 1 challenges Player 2
    const challengeResult = await player1.challenge(player2.id);
    expect(challengeResult.success).toBe(true);

    // Player 2 accepts
    const acceptResult = await player2.acceptChallenge(challengeResult.challengeId);
    expect(acceptResult.success).toBe(true);
    expect(acceptResult.duelId).toBeDefined();

    const duelId = acceptResult.duelId;

    // Both toggle some rules
    await player1.toggleRule(duelId, 'noFood', true);
    await player2.toggleRule(duelId, 'noPrayer', true);

    // Both accept rules
    await player1.acceptScreen(duelId, 'rules');
    await player2.acceptScreen(duelId, 'rules');

    // Verify advanced to STAKES
    const session1 = await player1.getDuelSession(duelId);
    expect(session1.state).toBe('STAKES');

    // Add stakes
    await player1.addStake(duelId, 0, 1); // Slot 0, qty 1
    await player2.addStake(duelId, 5, 100); // Slot 5, qty 100

    // Both accept stakes
    await player1.acceptScreen(duelId, 'stakes');
    await player2.acceptScreen(duelId, 'stakes');

    // Verify advanced to CONFIRMING
    const session2 = await player1.getDuelSession(duelId);
    expect(session2.state).toBe('CONFIRMING');

    // Both confirm
    await player1.acceptScreen(duelId, 'final');
    await player2.acceptScreen(duelId, 'final');

    // Verify teleported to arena
    await waitForState(duelId, 'FIGHTING');
    const player1Pos = await player1.getPosition();
    expect(isInArena(player1Pos)).toBe(true);

    // Simulate combat until one dies
    await simulateCombatUntilDeath(duelId);

    // Verify stakes transferred
    const winner = await getWinner(duelId);
    const loserStakes = await getLoserStakes(duelId);
    for (const stake of loserStakes) {
      expect(await winner.hasItem(stake.itemId, stake.quantity)).toBe(true);
    }

    // Verify arena released
    const arena = await getArenaForDuel(duelId);
    expect(arena).toBeNull();
  });

  it('should handle disconnect during setup - cancel duel and return stakes');
  it('should handle disconnect during combat - auto-forfeit after timeout');
  it('should enforce noFood rule - block eating');
  it('should enforce noMovement rule - freeze players');
  it('should handle race condition - both accept at exact same time');
});
```

---

## Part 11: Implementation Phases (Revised with Quality Gates)

Each phase must pass quality gates before proceeding:

### Phase 1: Foundation
**Quality Gates:**
- [ ] All types defined with no `any` or `unknown`
- [ ] Zod schemas for all network messages
- [ ] Interface definitions for all services
- [ ] Unit tests for type guards and validators

### Phase 2-10: (Same as before, but each phase adds)
**Per-Phase Quality Gates:**
- [ ] 80%+ unit test coverage for new code
- [ ] Integration tests for happy path
- [ ] Rate limiting on all new endpoints
- [ ] Access control checks on all handlers
- [ ] Audit logging for significant events
- [ ] No allocations in any update/tick methods
- [ ] JSDoc on all public methods

### Final Quality Gate (Before Merge)
- [ ] Full OWASP security review checklist
- [ ] Memory profiling - no leaks after 100 duels
- [ ] Load test - 50 concurrent duels stable
- [ ] Penetration test - stake manipulation attempts
- [ ] Code review by second developer

---

## Part 12: Production Readiness Score Estimate

| Category | Current Plan | Target | Notes |
|----------|--------------|--------|-------|
| Production Quality | 9/10 | 9/10 | Strong types, error handling patterns, no `any` |
| Best Practices | 9/10 | 9/10 | DRY via service reuse, comprehensive testing |
| OWASP Security | 9/10 | 9/10 | Input validation, rate limiting, access control, audit logs |
| Game Studio Audit | 9/10 | 9/10 | Full server authority, stake verification, position validation |
| Memory & Allocation | 9/10 | 9/10 | Pre-allocated vectors, object pooling, typed arrays |
| SOLID Principles | 9/10 | 9/10 | SRP services, OCP enforcers, DIP injection |
| **Overall** | **9/10** | **9+/10** | Comprehensive, production-ready architecture |

---

## Part 13: Complete Network Protocol Specification

### 13.1 Socket Event Names (All Packets)

```typescript
// ═══════════════════════════════════════════════════════════════════════════
// CLIENT → SERVER EVENTS
// ═══════════════════════════════════════════════════════════════════════════

const CLIENT_EVENTS = {
  // Challenge Phase
  DUEL_CHALLENGE: 'duel:challenge',                     // Send challenge to player
  DUEL_CHALLENGE_RESPOND: 'duel:challenge:respond',     // Accept/decline challenge
  DUEL_CHALLENGE_CANCEL: 'duel:challenge:cancel',       // Cancel pending challenge

  // Rules Phase
  DUEL_TOGGLE_RULE: 'duel:rule:toggle',                 // Toggle a duel rule
  DUEL_TOGGLE_EQUIPMENT: 'duel:equipment:toggle',       // Toggle equipment slot restriction
  DUEL_ACCEPT_RULES: 'duel:rules:accept',               // Accept current rules
  DUEL_CANCEL_RULES: 'duel:rules:cancel',               // Unaccept rules

  // Stakes Phase
  DUEL_ADD_STAKE: 'duel:stake:add',                     // Add item to stake
  DUEL_REMOVE_STAKE: 'duel:stake:remove',               // Remove item from stake
  DUEL_SET_STAKE_QUANTITY: 'duel:stake:quantity',       // Change stake quantity
  DUEL_ACCEPT_STAKES: 'duel:stakes:accept',             // Accept current stakes
  DUEL_CANCEL_STAKES: 'duel:stakes:cancel',             // Unaccept stakes

  // Confirm Phase
  DUEL_CONFIRM: 'duel:confirm',                         // Final confirmation
  DUEL_CANCEL_CONFIRM: 'duel:confirm:cancel',           // Unconfirm

  // Combat Phase
  DUEL_FORFEIT: 'duel:forfeit',                         // Forfeit the duel

  // General
  DUEL_CANCEL: 'duel:cancel',                           // Cancel duel at any phase
  DUEL_GET_SESSION: 'duel:session:get',                 // Request current session state
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// SERVER → CLIENT EVENTS
// ═══════════════════════════════════════════════════════════════════════════

const SERVER_EVENTS = {
  // Challenge Phase
  DUEL_CHALLENGE_RECEIVED: 'duel:challenge:received',   // You received a challenge
  DUEL_CHALLENGE_SENT: 'duel:challenge:sent',           // Your challenge was sent
  DUEL_CHALLENGE_EXPIRED: 'duel:challenge:expired',     // Challenge timed out
  DUEL_CHALLENGE_DECLINED: 'duel:challenge:declined',   // Challenge was declined
  DUEL_CHALLENGE_CANCELLED: 'duel:challenge:cancelled', // Challenge was cancelled

  // Session Updates
  DUEL_SESSION_CREATED: 'duel:session:created',         // New duel session started
  DUEL_SESSION_UPDATE: 'duel:session:update',           // Session state changed
  DUEL_SESSION_ENDED: 'duel:session:ended',             // Session ended (cancel/complete)

  // Phase Transitions
  DUEL_PHASE_RULES: 'duel:phase:rules',                 // Entered rules phase
  DUEL_PHASE_STAKES: 'duel:phase:stakes',               // Entered stakes phase
  DUEL_PHASE_CONFIRM: 'duel:phase:confirm',             // Entered confirm phase
  DUEL_PHASE_COUNTDOWN: 'duel:phase:countdown',         // Entered countdown
  DUEL_PHASE_FIGHTING: 'duel:phase:fighting',           // Combat started

  // Countdown
  DUEL_COUNTDOWN_TICK: 'duel:countdown:tick',           // Countdown tick (3, 2, 1, FIGHT)

  // Combat
  DUEL_OPPONENT_DAMAGED: 'duel:combat:damage',          // Opponent took damage (for UI)
  DUEL_OPPONENT_HEALTH: 'duel:combat:health',           // Opponent health update

  // Resolution
  DUEL_RESULT: 'duel:result',                           // Duel finished, winner/loser
  DUEL_STAKES_TRANSFERRED: 'duel:stakes:transferred',   // Stakes moved to winner

  // Errors
  DUEL_ERROR: 'duel:error',                             // Error occurred

  // Anti-scam Warnings
  DUEL_STAKE_MODIFIED: 'duel:stake:modified',           // Opponent modified their stake
  DUEL_RULES_MODIFIED: 'duel:rules:modified',           // Rules were modified
} as const;
```

### 13.2 Handler Registration (Server)

```typescript
// /packages/server/src/systems/ServerNetwork/handlers/duel/index.ts

import type { Socket } from 'socket.io';
import type { ServerNetwork } from '../../ServerNetwork';

export function registerDuelHandlers(network: ServerNetwork): void {
  const { io } = network;

  io.on('connection', (socket: Socket) => {
    // Challenge handlers
    socket.on('duel:challenge', (data) => handleDuelChallenge(network, socket, data));
    socket.on('duel:challenge:respond', (data) => handleDuelChallengeRespond(network, socket, data));
    socket.on('duel:challenge:cancel', (data) => handleDuelChallengeCancel(network, socket, data));

    // Rules handlers
    socket.on('duel:rule:toggle', (data) => handleDuelToggleRule(network, socket, data));
    socket.on('duel:equipment:toggle', (data) => handleDuelToggleEquipment(network, socket, data));
    socket.on('duel:rules:accept', (data) => handleDuelAcceptRules(network, socket, data));
    socket.on('duel:rules:cancel', (data) => handleDuelCancelRules(network, socket, data));

    // Stakes handlers
    socket.on('duel:stake:add', (data) => handleDuelAddStake(network, socket, data));
    socket.on('duel:stake:remove', (data) => handleDuelRemoveStake(network, socket, data));
    socket.on('duel:stake:quantity', (data) => handleDuelSetStakeQuantity(network, socket, data));
    socket.on('duel:stakes:accept', (data) => handleDuelAcceptStakes(network, socket, data));
    socket.on('duel:stakes:cancel', (data) => handleDuelCancelStakes(network, socket, data));

    // Confirm handlers
    socket.on('duel:confirm', (data) => handleDuelConfirm(network, socket, data));
    socket.on('duel:confirm:cancel', (data) => handleDuelCancelConfirm(network, socket, data));

    // Combat handlers
    socket.on('duel:forfeit', (data) => handleDuelForfeit(network, socket, data));

    // General handlers
    socket.on('duel:cancel', (data) => handleDuelCancel(network, socket, data));
    socket.on('duel:session:get', (data) => handleDuelGetSession(network, socket, data));

    // Cleanup on disconnect
    socket.on('disconnect', () => handleDuelDisconnect(network, socket));
  });
}
```

### 13.3 Client Event Listener Registration

```typescript
// /packages/client/src/game/panels/DuelPanel/hooks/useDuelSocket.ts

import { useEffect } from 'react';
import { useGameStore } from '@/store/gameStore';
import { useDuelStore } from '@/store/duelStore';

export function useDuelSocket(): void {
  const socket = useGameStore((s) => s.socket);
  const duelActions = useDuelStore((s) => s.actions);

  useEffect(() => {
    if (!socket) return;

    // Challenge events
    socket.on('duel:challenge:received', duelActions.onChallengeReceived);
    socket.on('duel:challenge:sent', duelActions.onChallengeSent);
    socket.on('duel:challenge:expired', duelActions.onChallengeExpired);
    socket.on('duel:challenge:declined', duelActions.onChallengeDeclined);
    socket.on('duel:challenge:cancelled', duelActions.onChallengeCancelled);

    // Session events
    socket.on('duel:session:created', duelActions.onSessionCreated);
    socket.on('duel:session:update', duelActions.onSessionUpdate);
    socket.on('duel:session:ended', duelActions.onSessionEnded);

    // Phase events
    socket.on('duel:phase:rules', duelActions.onPhaseRules);
    socket.on('duel:phase:stakes', duelActions.onPhaseStakes);
    socket.on('duel:phase:confirm', duelActions.onPhaseConfirm);
    socket.on('duel:phase:countdown', duelActions.onPhaseCountdown);
    socket.on('duel:phase:fighting', duelActions.onPhaseFighting);

    // Countdown
    socket.on('duel:countdown:tick', duelActions.onCountdownTick);

    // Combat events
    socket.on('duel:combat:health', duelActions.onOpponentHealth);

    // Resolution
    socket.on('duel:result', duelActions.onDuelResult);
    socket.on('duel:stakes:transferred', duelActions.onStakesTransferred);

    // Errors & warnings
    socket.on('duel:error', duelActions.onDuelError);
    socket.on('duel:stake:modified', duelActions.onStakeModified);
    socket.on('duel:rules:modified', duelActions.onRulesModified);

    return () => {
      socket.off('duel:challenge:received');
      socket.off('duel:challenge:sent');
      socket.off('duel:challenge:expired');
      // ... remove all listeners
    };
  }, [socket, duelActions]);
}
```

---

## Part 14: Client State Management

### 14.1 Duel Zustand Store

```typescript
// /packages/client/src/store/duelStore.ts

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type {
  DuelSession,
  DuelState,
  PendingDuelChallenge,
  StakedItem,
  DuelRules,
} from '@hyperscape/shared';

interface DuelStoreState {
  // Pending challenge (when someone challenges you)
  pendingChallenge: PendingDuelChallenge | null;
  pendingChallengeTimeout: NodeJS.Timeout | null;

  // Outgoing challenge (when you challenge someone)
  outgoingChallenge: { targetId: string; targetName: string } | null;

  // Active duel session
  session: DuelSession | null;
  isInDuel: boolean;

  // UI state
  isPanelOpen: boolean;
  currentScreen: 'rules' | 'stakes' | 'confirm' | 'countdown' | 'fighting' | 'result';
  countdownValue: number; // 3, 2, 1, 0

  // Result state
  result: {
    won: boolean;
    opponentName: string;
    itemsReceived: StakedItem[];
    goldReceived: number;
  } | null;

  // Anti-scam indicators
  opponentModifiedStake: boolean;
  opponentModifiedRules: boolean;

  // Error state
  error: string | null;

  // Actions
  actions: DuelStoreActions;
}

interface DuelStoreActions {
  // Challenge
  onChallengeReceived: (data: PendingDuelChallenge) => void;
  onChallengeSent: (data: { targetId: string; targetName: string }) => void;
  onChallengeExpired: () => void;
  onChallengeDeclined: () => void;
  onChallengeCancelled: () => void;

  // Session
  onSessionCreated: (data: { duelId: string; session: DuelSession }) => void;
  onSessionUpdate: (data: { duelId: string; session: DuelSession }) => void;
  onSessionEnded: (data: { reason: string }) => void;

  // Phase transitions
  onPhaseRules: () => void;
  onPhaseStakes: () => void;
  onPhaseConfirm: () => void;
  onPhaseCountdown: () => void;
  onPhaseFighting: () => void;

  // Countdown
  onCountdownTick: (data: { count: number }) => void;

  // Combat
  onOpponentHealth: (data: { health: number; maxHealth: number }) => void;

  // Result
  onDuelResult: (data: DuelResultData) => void;
  onStakesTransferred: (data: { items: StakedItem[]; gold: number }) => void;

  // Errors & warnings
  onDuelError: (data: { error: string; errorCode: string }) => void;
  onStakeModified: () => void;
  onRulesModified: () => void;

  // UI actions
  openPanel: () => void;
  closePanel: () => void;
  clearError: () => void;
  clearResult: () => void;
  resetStore: () => void;
}

export const useDuelStore = create<DuelStoreState>()(
  immer((set, get) => ({
    // Initial state
    pendingChallenge: null,
    pendingChallengeTimeout: null,
    outgoingChallenge: null,
    session: null,
    isInDuel: false,
    isPanelOpen: false,
    currentScreen: 'rules',
    countdownValue: 0,
    result: null,
    opponentModifiedStake: false,
    opponentModifiedRules: false,
    error: null,

    actions: {
      onChallengeReceived: (data) => {
        set((state) => {
          state.pendingChallenge = data;
          // Auto-clear after timeout
          if (state.pendingChallengeTimeout) {
            clearTimeout(state.pendingChallengeTimeout);
          }
          state.pendingChallengeTimeout = setTimeout(() => {
            set((s) => { s.pendingChallenge = null; });
          }, 30000);
        });
      },

      onSessionCreated: (data) => {
        set((state) => {
          state.session = data.session;
          state.isInDuel = true;
          state.isPanelOpen = true;
          state.currentScreen = 'rules';
          state.pendingChallenge = null;
          state.outgoingChallenge = null;
        });
      },

      onSessionUpdate: (data) => {
        set((state) => {
          state.session = data.session;
          // Update screen based on state
          switch (data.session.state) {
            case 'RULES': state.currentScreen = 'rules'; break;
            case 'STAKES': state.currentScreen = 'stakes'; break;
            case 'CONFIRMING': state.currentScreen = 'confirm'; break;
            case 'COUNTDOWN': state.currentScreen = 'countdown'; break;
            case 'FIGHTING': state.currentScreen = 'fighting'; break;
            case 'FINISHED': state.currentScreen = 'result'; break;
          }
        });
      },

      onCountdownTick: (data) => {
        set((state) => {
          state.countdownValue = data.count;
        });
      },

      onDuelResult: (data) => {
        set((state) => {
          state.result = {
            won: data.won,
            opponentName: data.opponentName,
            itemsReceived: data.itemsReceived || [],
            goldReceived: data.goldReceived || 0,
          };
          state.currentScreen = 'result';
        });
      },

      onStakeModified: () => {
        set((state) => {
          state.opponentModifiedStake = true;
          // Clear after 3 seconds
          setTimeout(() => {
            set((s) => { s.opponentModifiedStake = false; });
          }, 3000);
        });
      },

      resetStore: () => {
        set((state) => {
          state.pendingChallenge = null;
          state.outgoingChallenge = null;
          state.session = null;
          state.isInDuel = false;
          state.isPanelOpen = false;
          state.currentScreen = 'rules';
          state.countdownValue = 0;
          state.result = null;
          state.opponentModifiedStake = false;
          state.opponentModifiedRules = false;
          state.error = null;
        });
      },

      // ... other actions
    },
  }))
);
```

---

## Part 15: Shared Layer Organization

### 15.1 What Goes Where

```
/packages/shared/src/
├── types/
│   └── game/
│       └── duel-types.ts          # ALL duel interfaces (shared between client/server)
│
├── constants/
│   └── duel-constants.ts          # Shared constants
│
├── validation/
│   └── duel-validation.ts         # Shared validation (Zod schemas)
│
└── utils/
    └── duel-utils.ts              # Pure utility functions
```

### 15.2 Shared Constants

```typescript
// /packages/shared/src/constants/duel-constants.ts

// Timing constants
export const DUEL_CHALLENGE_TIMEOUT_MS = 30000;        // 30 seconds
export const DUEL_COUNTDOWN_SECONDS = 3;               // 3, 2, 1, FIGHT
export const DUEL_DISCONNECT_GRACE_PERIOD_MS = 30000;  // 30 seconds to reconnect

// Limits
export const MAX_STAKES_PER_PLAYER = 28;               // Full inventory
export const MAX_CONCURRENT_DUELS = 6;                 // Number of arenas
export const MAX_STAKE_VALUE = 2147483647;             // int32 max

// Rate limits
export const CHALLENGE_RATE_LIMIT = 3;                 // per window
export const CHALLENGE_RATE_WINDOW_MS = 30000;
export const STAKE_MODIFY_RATE_LIMIT = 30;
export const STAKE_MODIFY_RATE_WINDOW_MS = 60000;

// Rule labels (for UI)
export const DUEL_RULE_LABELS: Record<keyof DuelRules, string> = {
  noRanged: 'No Ranged',
  noMelee: 'No Melee',
  noMagic: 'No Magic',
  noSpecialAttack: 'No Special Attack',
  noPrayer: 'No Prayer',
  noPotions: 'No Potions',
  noFood: 'No Food',
  noForfeit: 'No Forfeit',
  noMovement: 'No Movement',
  // obstacles removed - all arenas are flat
  funWeapons: 'Fun Weapons',
};

// Equipment slot labels
export const EQUIPMENT_SLOT_LABELS: Record<EquipmentSlotRestriction, string> = {
  head: 'Head',
  cape: 'Cape',
  amulet: 'Amulet',
  weapon: 'Weapon',
  body: 'Body',
  shield: 'Shield',
  legs: 'Legs',
  gloves: 'Gloves',
  boots: 'Boots',
  ring: 'Ring',
  ammo: 'Ammo',
};
```

### 15.3 Shared Validation (Zod Schemas)

```typescript
// /packages/shared/src/validation/duel-validation.ts

import { z } from 'zod';
import type { DuelRules, EquipmentSlotRestriction } from '../types/game/duel-types';

// UUID validation
const uuidSchema = z.string().uuid();

// Schemas for all network messages
export const DuelChallengeSchema = z.object({
  targetPlayerId: uuidSchema,
});

export const DuelChallengeRespondSchema = z.object({
  challengeId: uuidSchema,
  accept: z.boolean(),
});

export const DuelToggleRuleSchema = z.object({
  duelId: uuidSchema,
  rule: z.enum([
    'noRanged', 'noMelee', 'noMagic', 'noSpecialAttack',
    'noPrayer', 'noPotions', 'noFood', 'noForfeit',
    'noMovement', 'funWeapons',
  ] as const),
  enabled: z.boolean(),
});

export const DuelToggleEquipmentSchema = z.object({
  duelId: uuidSchema,
  slot: z.enum([
    'head', 'cape', 'amulet', 'weapon', 'body',
    'shield', 'legs', 'gloves', 'boots', 'ring', 'ammo',
  ] as const),
  disabled: z.boolean(),
});

export const DuelAddStakeSchema = z.object({
  duelId: uuidSchema,
  inventorySlot: z.number().int().min(0).max(27),
  quantity: z.number().int().min(1).max(2147483647),
});

export const DuelRemoveStakeSchema = z.object({
  duelId: uuidSchema,
  stakeIndex: z.number().int().min(0).max(27),
});

export const DuelAcceptSchema = z.object({
  duelId: uuidSchema,
});

export const DuelForfeitSchema = z.object({
  duelId: uuidSchema,
});

export const DuelCancelSchema = z.object({
  duelId: uuidSchema,
});

// Validation helper
export function validateDuelMessage<T>(
  schema: z.ZodSchema<T>,
  data: unknown
): { success: true; data: T } | { success: false; error: string } {
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error.message };
}
```

---

## Part 16: System Integration Points

### 16.1 Combat System Integration

```typescript
// /packages/shared/src/systems/shared/combat/CombatSystem.ts
// Add these integration points:

class CombatSystem {
  private duelSystem: DuelSystem | null = null;

  start(): void {
    // Get reference to duel system
    this.duelSystem = this.world.getSystem('duel') as DuelSystem | null;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INTEGRATION POINT: Attack validation
  // ═══════════════════════════════════════════════════════════════════════════
  canAttack(attackerId: string, targetId: string, attackStyle: AttackStyle): boolean {
    // Check if attacker is in duel
    if (this.duelSystem?.isPlayerInDuel(attackerId)) {
      const duel = this.duelSystem.getDuelForPlayer(attackerId);
      if (!duel || duel.state !== 'FIGHTING') {
        return false; // Can't attack during setup phases
      }

      // Must target duel opponent
      const opponentId = this.duelSystem.getDuelOpponentId(attackerId);
      if (targetId !== opponentId) {
        return false;
      }

      // Check attack style restrictions
      if (!this.duelSystem.canUseAttackStyle(attackerId, attackStyle)) {
        return false;
      }
    }

    return this.standardCanAttack(attackerId, targetId);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INTEGRATION POINT: Special attack
  // ═══════════════════════════════════════════════════════════════════════════
  canUseSpecialAttack(playerId: string): boolean {
    if (this.duelSystem?.isPlayerInDuel(playerId)) {
      if (!this.duelSystem.canUseSpecialAttack(playerId)) {
        return false;
      }
    }
    return true;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INTEGRATION POINT: Death handling
  // ═══════════════════════════════════════════════════════════════════════════
  handleDeath(deadPlayerId: string, killerId: string): void {
    // Check if death is part of duel
    if (this.duelSystem?.isPlayerInDuel(deadPlayerId)) {
      const duel = this.duelSystem.getDuelForPlayer(deadPlayerId);
      if (duel && duel.state === 'FIGHTING') {
        // Delegate to duel system - no normal death handling
        this.duelSystem.handlePlayerDeath(duel.duelId, deadPlayerId);
        return;
      }
    }

    // Normal death handling
    this.handleNormalDeath(deadPlayerId, killerId);
  }
}
```

### 16.2 Inventory System Integration

```typescript
// /packages/shared/src/systems/shared/inventory/InventorySystem.ts

class InventorySystem {
  private duelSystem: DuelSystem | null = null;

  start(): void {
    this.duelSystem = this.world.getSystem('duel') as DuelSystem | null;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INTEGRATION POINT: Item consumption
  // ═══════════════════════════════════════════════════════════════════════════
  canConsumeItem(playerId: string, itemId: string): boolean {
    if (this.duelSystem?.isPlayerInDuel(playerId)) {
      const itemDef = this.getItemDefinition(itemId);

      if (itemDef.type === 'food' && !this.duelSystem.canEatFood(playerId)) {
        return false;
      }

      if (itemDef.type === 'potion' && !this.duelSystem.canDrinkPotion(playerId)) {
        return false;
      }
    }

    return true;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INTEGRATION POINT: Item staking lock
  // ═══════════════════════════════════════════════════════════════════════════
  isItemLocked(playerId: string, slot: number): boolean {
    if (this.duelSystem?.isPlayerInDuel(playerId)) {
      // Check if this slot is staked
      return this.duelSystem.isSlotStaked(playerId, slot);
    }
    return false;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INTEGRATION POINT: Item transfer restrictions
  // ═══════════════════════════════════════════════════════════════════════════
  canTransferItem(playerId: string, slot: number): boolean {
    // Can't transfer items while in duel setup
    if (this.duelSystem?.isPlayerInDuel(playerId)) {
      const duel = this.duelSystem.getDuelForPlayer(playerId);
      if (duel && ['RULES', 'STAKES', 'CONFIRMING'].includes(duel.state)) {
        return false; // No trading/dropping during duel setup
      }
    }
    return true;
  }
}
```

### 16.3 Movement System Integration

```typescript
// /packages/shared/src/systems/shared/movement/MovementSystem.ts

class MovementSystem {
  private duelSystem: DuelSystem | null = null;

  // ═══════════════════════════════════════════════════════════════════════════
  // INTEGRATION POINT: Movement restriction
  // ═══════════════════════════════════════════════════════════════════════════
  canMove(playerId: string): boolean {
    if (this.duelSystem?.isPlayerInDuel(playerId)) {
      const duel = this.duelSystem.getDuelForPlayer(playerId);

      // Frozen during countdown
      if (duel?.state === 'COUNTDOWN') {
        return false;
      }

      // Frozen if noMovement rule
      if (duel?.state === 'FIGHTING' && !this.duelSystem.canMove(playerId)) {
        return false;
      }
    }

    return true;
  }
}
```

### 16.4 Prayer System Integration

```typescript
// /packages/shared/src/systems/shared/prayer/PrayerSystem.ts

class PrayerSystem {
  private duelSystem: DuelSystem | null = null;

  // ═══════════════════════════════════════════════════════════════════════════
  // INTEGRATION POINT: Prayer activation
  // ═══════════════════════════════════════════════════════════════════════════
  canActivatePrayer(playerId: string): boolean {
    if (this.duelSystem?.isPlayerInDuel(playerId)) {
      if (!this.duelSystem.canUsePrayer(playerId)) {
        return false;
      }
    }
    return true;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INTEGRATION POINT: Drain prayer at duel start (if noPrayer)
  // ═══════════════════════════════════════════════════════════════════════════
  onDuelCountdownStart(playerId: string, duelRules: DuelRules): void {
    if (duelRules.noPrayer) {
      // Drain all prayer points
      this.setPrayerPoints(playerId, 0);
      // Deactivate all prayers
      this.deactivateAllPrayers(playerId);
    }
  }
}
```

### 16.5 Chat System Integration

```typescript
// /packages/server/src/systems/ChatSystem/index.ts

// ═══════════════════════════════════════════════════════════════════════════
// DUEL CHAT MESSAGES
// ═══════════════════════════════════════════════════════════════════════════

const DUEL_MESSAGES = {
  CHALLENGE_SENT: (targetName: string) =>
    `Sending duel challenge to ${targetName}...`,

  CHALLENGE_RECEIVED: (challengerName: string) =>
    `${challengerName} wishes to duel with you.`,

  CHALLENGE_ACCEPTED: (opponentName: string) =>
    `${opponentName} has accepted your challenge!`,

  CHALLENGE_DECLINED: (opponentName: string) =>
    `${opponentName} has declined your challenge.`,

  DUEL_STARTED: (opponentName: string) =>
    `Duel with ${opponentName} has begun!`,

  DUEL_WON: (opponentName: string) =>
    `Congratulations! You have defeated ${opponentName}!`,

  DUEL_LOST: (opponentName: string) =>
    `You have been defeated by ${opponentName}.`,

  STAKES_RECEIVED: (items: string[], gold: number) => {
    const parts = [];
    if (items.length > 0) parts.push(items.join(', '));
    if (gold > 0) parts.push(`${gold.toLocaleString()} gold`);
    return `You received: ${parts.join(' and ')}`;
  },

  NO_ARENA_AVAILABLE:
    'All arenas are currently in use. Please wait.',

  FORFEIT_DISABLED:
    'You cannot forfeit - "No Forfeit" rule is active.',
};

class ChatSystem {
  sendDuelMessage(playerId: string, messageKey: keyof typeof DUEL_MESSAGES, ...args: unknown[]): void {
    const message = DUEL_MESSAGES[messageKey] as (...args: unknown[]) => string;
    this.sendSystemMessage(playerId, message(...args));
  }
}
```

---

## Part 17: Database Persistence

### 17.1 Player Duel Statistics

```typescript
// /packages/server/src/database/models/PlayerDuelStats.ts

interface PlayerDuelStats {
  playerId: string;
  wins: number;
  losses: number;
  totalDuels: number;
  totalStakeWon: number;      // Total gold value won
  totalStakeLost: number;     // Total gold value lost
  winStreak: number;          // Current win streak
  bestWinStreak: number;      // Best ever win streak
  lastDuelAt: Date | null;
}

// SQL Schema
const CREATE_PLAYER_DUEL_STATS = `
  CREATE TABLE IF NOT EXISTS player_duel_stats (
    player_id TEXT PRIMARY KEY,
    wins INTEGER DEFAULT 0,
    losses INTEGER DEFAULT 0,
    total_duels INTEGER DEFAULT 0,
    total_stake_won INTEGER DEFAULT 0,
    total_stake_lost INTEGER DEFAULT 0,
    win_streak INTEGER DEFAULT 0,
    best_win_streak INTEGER DEFAULT 0,
    last_duel_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`;
```

### 17.2 Duel History (For Disputes)

```typescript
// /packages/server/src/database/models/DuelHistory.ts

interface DuelHistoryRecord {
  duelId: string;
  challengerId: string;
  opponentId: string;
  winnerId: string;
  loserId: string;
  forfeit: boolean;

  // Rules snapshot
  rules: DuelRules;
  equipmentRestrictions: EquipmentSlotRestriction[];

  // Stakes snapshot
  challengerStakes: StakedItem[];
  opponentStakes: StakedItem[];
  challengerStakeValue: number;
  opponentStakeValue: number;

  // Arena
  arenaId: number;

  // Timing
  createdAt: Date;
  fightStartedAt: Date;
  finishedAt: Date;
  durationMs: number;
}

// SQL Schema
const CREATE_DUEL_HISTORY = `
  CREATE TABLE IF NOT EXISTS duel_history (
    duel_id TEXT PRIMARY KEY,
    challenger_id TEXT NOT NULL,
    opponent_id TEXT NOT NULL,
    winner_id TEXT NOT NULL,
    loser_id TEXT NOT NULL,
    forfeit BOOLEAN DEFAULT FALSE,
    rules JSON NOT NULL,
    equipment_restrictions JSON NOT NULL,
    challenger_stakes JSON NOT NULL,
    opponent_stakes JSON NOT NULL,
    challenger_stake_value INTEGER NOT NULL,
    opponent_stake_value INTEGER NOT NULL,
    arena_id INTEGER NOT NULL,
    created_at TIMESTAMP NOT NULL,
    fight_started_at TIMESTAMP NOT NULL,
    finished_at TIMESTAMP NOT NULL,
    duration_ms INTEGER NOT NULL,

    FOREIGN KEY (challenger_id) REFERENCES players(id),
    FOREIGN KEY (opponent_id) REFERENCES players(id),
    FOREIGN KEY (winner_id) REFERENCES players(id),
    FOREIGN KEY (loser_id) REFERENCES players(id)
  )
`;
```

---

## Part 18: Reconnection Protocol

### 18.1 Client Reconnection Flow

```typescript
// Client reconnection handling

class DuelReconnectionHandler {
  async handleReconnect(socket: Socket, playerId: string): Promise<void> {
    // Check if player was in a duel
    const duelSession = await this.duelSystem.getPlayerSession(playerId);

    if (!duelSession) {
      return; // Not in a duel
    }

    // Update socket ID
    this.duelSystem.updatePlayerSocket(duelSession.duelId, playerId, socket.id);

    // Send current session state
    socket.emit('duel:session:reconnected', {
      duelId: duelSession.duelId,
      session: duelSession,
    });

    // Handle based on state
    switch (duelSession.state) {
      case 'RULES':
      case 'STAKES':
      case 'CONFIRMING':
        // Just send state, let them continue
        break;

      case 'COUNTDOWN':
        // Resume countdown from current position
        socket.emit('duel:countdown:tick', { count: this.getCurrentCountdown(duelSession) });
        break;

      case 'FIGHTING':
        // Clear disconnect timer if it was running
        this.clearDisconnectTimer(playerId);
        // Send current opponent health
        const opponent = this.getOpponent(duelSession, playerId);
        socket.emit('duel:combat:health', {
          health: opponent.currentHealth,
          maxHealth: opponent.maxHealth,
        });
        break;

      case 'FINISHED':
        // Send result
        socket.emit('duel:result', this.getDuelResult(duelSession, playerId));
        break;
    }
  }
}
```

### 18.2 Disconnect Timer (Server)

```typescript
// Server-side disconnect handling

class DuelDisconnectHandler {
  private disconnectTimers = new Map<string, NodeJS.Timeout>();

  onPlayerDisconnect(playerId: string): void {
    const session = this.duelSystem.getPlayerSession(playerId);
    if (!session) return;

    switch (session.state) {
      case 'RULES':
      case 'STAKES':
      case 'CONFIRMING':
        // Immediate cancel - return stakes
        this.duelSystem.cancelDuel(session.duelId, 'PLAYER_DISCONNECTED', playerId);
        break;

      case 'FIGHTING':
        // Start grace period timer
        const timer = setTimeout(() => {
          // Check if still disconnected
          if (!this.isPlayerConnected(playerId)) {
            // Auto-forfeit (or instant loss if noForfeit)
            if (session.rules.noForfeit) {
              // Instant loss
              this.duelSystem.handlePlayerDeath(session.duelId, playerId);
            } else {
              // Forfeit
              this.duelSystem.handleForfeit(session.duelId, playerId);
            }
          }
          this.disconnectTimers.delete(playerId);
        }, DUEL_DISCONNECT_GRACE_PERIOD_MS);

        this.disconnectTimers.set(playerId, timer);

        // Notify opponent
        const opponentId = this.getOpponentId(session, playerId);
        this.sendToPlayer(opponentId, 'duel:opponent:disconnected', {
          gracePeriodMs: DUEL_DISCONNECT_GRACE_PERIOD_MS,
        });
        break;
    }
  }

  clearDisconnectTimer(playerId: string): void {
    const timer = this.disconnectTimers.get(playerId);
    if (timer) {
      clearTimeout(timer);
      this.disconnectTimers.delete(playerId);
    }
  }
}
```

---

## Part 19: Sound & Visual Effects

### 19.1 Sound Effect Triggers

```typescript
// /packages/client/src/game/panels/DuelPanel/hooks/useDuelSounds.ts

const DUEL_SOUNDS = {
  CHALLENGE_RECEIVED: 'sfx/duel/challenge_received.ogg',
  CHALLENGE_ACCEPTED: 'sfx/duel/challenge_accepted.ogg',
  CHALLENGE_DECLINED: 'sfx/duel/challenge_declined.ogg',
  RULE_TOGGLE: 'sfx/ui/checkbox_click.ogg',
  STAKE_ADD: 'sfx/inventory/item_pickup.ogg',
  STAKE_REMOVE: 'sfx/inventory/item_drop.ogg',
  ACCEPT_CLICK: 'sfx/ui/button_confirm.ogg',
  OPPONENT_ACCEPTED: 'sfx/duel/opponent_ready.ogg',
  COUNTDOWN_TICK: 'sfx/duel/countdown_tick.ogg',
  COUNTDOWN_FIGHT: 'sfx/duel/fight_start.ogg',
  DUEL_WON: 'sfx/duel/victory_fanfare.ogg',
  DUEL_LOST: 'sfx/duel/defeat_sound.ogg',
  OPPONENT_MODIFIED: 'sfx/duel/warning_beep.ogg',
};

export function useDuelSounds(): void {
  const audioSystem = useAudioSystem();
  const duelStore = useDuelStore();

  // Subscribe to duel events and play sounds
  useEffect(() => {
    const unsubscribe = duelStore.subscribe((state, prevState) => {
      // Challenge received
      if (state.pendingChallenge && !prevState.pendingChallenge) {
        audioSystem.play(DUEL_SOUNDS.CHALLENGE_RECEIVED);
      }

      // Countdown ticks
      if (state.countdownValue !== prevState.countdownValue) {
        if (state.countdownValue > 0) {
          audioSystem.play(DUEL_SOUNDS.COUNTDOWN_TICK);
        } else if (state.countdownValue === 0 && prevState.countdownValue > 0) {
          audioSystem.play(DUEL_SOUNDS.COUNTDOWN_FIGHT);
        }
      }

      // Result
      if (state.result && !prevState.result) {
        audioSystem.play(state.result.won ? DUEL_SOUNDS.DUEL_WON : DUEL_SOUNDS.DUEL_LOST);
      }

      // Anti-scam warning
      if (state.opponentModifiedStake && !prevState.opponentModifiedStake) {
        audioSystem.play(DUEL_SOUNDS.OPPONENT_MODIFIED);
      }
    });

    return unsubscribe;
  }, [audioSystem]);
}
```

### 19.2 Visual Effects

```typescript
// VFX to trigger at various points

const DUEL_VFX = {
  // Teleport to arena
  TELEPORT_IN: 'vfx/teleport/duel_arena_enter',

  // Countdown numbers (3D world-space text)
  COUNTDOWN_NUMBER: 'vfx/duel/countdown_number',

  // Fight start flash
  FIGHT_START: 'vfx/duel/fight_flash',

  // Victory celebration
  VICTORY: 'vfx/duel/victory_sparkles',

  // Defeat
  DEFEAT: 'vfx/duel/defeat_smoke',

  // Stake transfer (items flying to winner)
  STAKE_TRANSFER: 'vfx/duel/stake_transfer_beam',
};
```

---

## Part 20: Complete File Manifest

### 20.1 Files to CREATE

```
═══════════════════════════════════════════════════════════════════════════════
SHARED PACKAGE (packages/shared/src/)
═══════════════════════════════════════════════════════════════════════════════

types/game/duel-types.ts                    # All interfaces and types
constants/duel-constants.ts                 # Shared constants
validation/duel-validation.ts               # Zod schemas

entities/world/TrapdoorEntity.ts            # Forfeit trapdoor (interactable)
systems/client/DuelArenaVisualsSystem.ts    # Procedural arena geometry (tan floor planes, brown wall boxes, trapdoors)

═══════════════════════════════════════════════════════════════════════════════
SERVER PACKAGE (packages/server/src/)
═══════════════════════════════════════════════════════════════════════════════

systems/DuelSystem/
├── index.ts                                # Main DuelSystem class
├── ArenaPoolManager.ts                     # Arena reservation
├── PendingDuelManager.ts                   # Pending challenges
├── DuelSessionPool.ts                      # Object pooling
├── DuelRateLimiter.ts                      # Rate limiting
├── DuelAccessControl.ts                    # Access control
├── DuelAuditLogger.ts                      # Audit logging
├── DuelReconnectionHandler.ts              # Reconnection handling
├── DuelDisconnectHandler.ts                # Disconnect handling
├── services/
│   ├── DuelChallengeService.ts
│   ├── DuelSessionService.ts
│   ├── DuelRulesService.ts
│   ├── DuelStakeService.ts
│   ├── DuelCombatService.ts
│   └── DuelTeleportService.ts
├── enforcers/
│   ├── NoFoodEnforcer.ts
│   ├── NoPotionEnforcer.ts
│   ├── NoPrayerEnforcer.ts
│   ├── NoMovementEnforcer.ts
│   ├── NoSpecialAttackEnforcer.ts
│   ├── NoRangedEnforcer.ts
│   ├── NoMeleeEnforcer.ts
│   └── NoMagicEnforcer.ts
└── interfaces/
    ├── IDuelChallengeService.ts
    ├── IDuelSessionService.ts
    ├── IDuelRulesService.ts
    ├── IDuelStakeService.ts
    ├── IDuelCombatService.ts
    ├── IDuelTeleportService.ts
    └── IArenaPool.ts

systems/ServerNetwork/handlers/duel/
├── index.ts                                # Handler registration
├── challenge.ts                            # Challenge handlers
├── rules.ts                                # Rules handlers
├── stakes.ts                               # Stakes handlers
├── acceptance.ts                           # Accept handlers
├── combat.ts                               # Combat handlers
└── helpers.ts                              # Shared helpers

database/models/
├── PlayerDuelStats.ts                      # Player W/L stats
└── DuelHistory.ts                          # Duel history for disputes

database/migrations/
├── 20240126_create_player_duel_stats.ts
└── 20240126_create_duel_history.ts

world/assets/manifests/
└── duel-arenas.json                        # Arena configurations

systems/DuelArenaWorldBuilder.ts            # Registers flat zones for arena terrain

═══════════════════════════════════════════════════════════════════════════════
CLIENT PACKAGE (packages/client/src/)
═══════════════════════════════════════════════════════════════════════════════

store/
└── duelStore.ts                            # Zustand store

game/panels/DuelPanel/
├── index.ts                                # Barrel export
├── DuelPanel.tsx                           # Main panel component
├── DuelChallengeModal.tsx                  # Challenge accept/decline
├── DuelResultModal.tsx                     # Win/lose result
├── types.ts                                # Component types
├── constants.ts                            # UI constants
├── screens/
│   ├── index.ts
│   ├── RulesScreen.tsx
│   ├── StakesScreen.tsx
│   └── ConfirmScreen.tsx
├── components/
│   ├── index.ts
│   ├── DuelRuleToggle.tsx
│   ├── EquipmentSlotToggle.tsx
│   ├── StakeSlot.tsx
│   ├── StakeGrid.tsx
│   ├── PlayerStakePanel.tsx
│   ├── AcceptButton.tsx
│   ├── ValueDisplay.tsx
│   ├── DuelCountdown.tsx
│   ├── OpponentDisconnectedOverlay.tsx
│   └── AntiScamWarning.tsx
└── hooks/
    ├── index.ts
    ├── useDuelSocket.ts                    # Socket event handling
    ├── useDuelSession.ts                   # Session state
    ├── useDuelSounds.ts                    # Sound effects
    └── useStakeManagement.ts               # Stake add/remove

═══════════════════════════════════════════════════════════════════════════════
TEST FILES
═══════════════════════════════════════════════════════════════════════════════

packages/server/src/systems/DuelSystem/__tests__/
├── ArenaPoolManager.test.ts
├── DuelSessionService.test.ts
├── DuelStakeService.test.ts
├── DuelRateLimiter.test.ts
└── duel-flow.integration.test.ts
```

### 20.2 Files to MODIFY

```
═══════════════════════════════════════════════════════════════════════════════
SHARED PACKAGE MODIFICATIONS
═══════════════════════════════════════════════════════════════════════════════

types/index.ts                              # Export duel-types
constants/index.ts                          # Export duel-constants
validation/index.ts                         # Export duel-validation

systems/shared/combat/CombatSystem.ts       # Add duel integration points
systems/shared/inventory/InventorySystem.ts # Add duel integration points
systems/shared/movement/MovementSystem.ts   # Add duel integration points
systems/shared/prayer/PrayerSystem.ts       # Add duel integration points

═══════════════════════════════════════════════════════════════════════════════
SERVER PACKAGE MODIFICATIONS
═══════════════════════════════════════════════════════════════════════════════

systems/ServerNetwork/index.ts              # Import & register duel handlers
systems/ChatSystem/index.ts                 # Add duel chat messages
world/assets/manifests/world-areas.json     # Add Duel Arena zone

═══════════════════════════════════════════════════════════════════════════════
CLIENT PACKAGE MODIFICATIONS
═══════════════════════════════════════════════════════════════════════════════

store/index.ts                              # Export duelStore
game/panels/index.ts                        # Export DuelPanel
game/ui/ContextMenu.tsx                     # Add "Challenge" option
game/App.tsx                                # Mount DuelPanel and modals
```

---

## Part 21: Admin & Debug Tools

### 21.1 Admin Commands

```typescript
// Server-side admin commands

const DUEL_ADMIN_COMMANDS = {
  // Force cancel a duel
  'duel:admin:cancel': (duelId: string) => {
    duelSystem.adminCancelDuel(duelId, 'ADMIN_CANCELLED');
  },

  // Get duel status
  'duel:admin:status': () => {
    return {
      arenaStatus: arenaPool.getStatus(),
      activeDuels: Array.from(duelSystem.getActiveDuels()),
      pendingChallenges: Array.from(duelSystem.getPendingChallenges()),
    };
  },

  // Force release arena
  'duel:admin:release-arena': (arenaId: number) => {
    arenaPool.releaseArena(arenaId);
  },

  // Get player duel state
  'duel:admin:player': (playerId: string) => {
    return {
      isInDuel: duelSystem.isPlayerInDuel(playerId),
      session: duelSystem.getPlayerSession(playerId),
      stats: duelStatsService.getStats(playerId),
    };
  },
};
```

### 21.2 Debug Visualization

```typescript
// Client-side debug overlay (dev mode only)

function DuelDebugOverlay(): JSX.Element | null {
  if (process.env.NODE_ENV !== 'development') return null;

  const session = useDuelStore((s) => s.session);

  return (
    <div className="duel-debug-overlay">
      <h4>Duel Debug</h4>
      <pre>
        State: {session?.state}
        Arena: {session?.arenaId}
        Challenger Accepted: {JSON.stringify({
          rules: session?.challenger.acceptedRules,
          stakes: session?.challenger.acceptedStakes,
          final: session?.challenger.acceptedFinal,
        })}
        Opponent Accepted: {JSON.stringify({
          rules: session?.opponent.acceptedRules,
          stakes: session?.opponent.acceptedStakes,
          final: session?.opponent.acceptedFinal,
        })}
      </pre>
    </div>
  );
}
```

---

## Part 22: Final Checklist

### Pre-Implementation Checklist
- [ ] All types reviewed and finalized
- [ ] Network protocol approved
- [ ] Database schema approved
- [ ] UI mockups approved
- [ ] Sound/VFX assets listed

### Per-Phase Checklist
- [ ] Types defined with no `any`
- [ ] Zod validation on all inputs
- [ ] Rate limiting implemented
- [ ] Access control on all handlers
- [ ] Audit logging for key events
- [ ] Unit tests at 80%+ coverage
- [ ] Integration test for happy path
- [ ] Error handling with result types
- [ ] No allocations in update loops
- [ ] JSDoc on public methods

### Pre-Merge Checklist
- [ ] Full build passes
- [ ] All tests pass
- [ ] Lint passes
- [ ] Security review completed
- [ ] Memory profiling - no leaks
- [ ] Load test passed (50 concurrent duels)
- [ ] Manual QA passed
- [ ] Code review approved
- [ ] Documentation updated
