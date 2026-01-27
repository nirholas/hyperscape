# Duel System Improvements - Research & Proposed Solutions

This document contains detailed research findings and proposed solutions for 10 identified issues in the duel system. All solutions follow the 9.5/10 quality standard established in the codebase.

---

## Issue 1: Post-Duel Victory Screen

### Current State
When a duel ends, players are teleported to the lobby and healed, but there's no UI showing what was won.

### OSRS Reference (Research Findings)
- **Winner sees:** A "Spoils Window" popup with:
  - Opponent's name and combat level
  - List of items/gold won from stakes
  - "Claim" button to receive rewards
  - Audio cue: "You have won the duel"
- **Loser sees:** Chat message "You have lost the duel!" (no fancy UI)
- **Both players:** Teleported to lobby, fully healed, stats restored
- **No time limit:** Window stays until player clicks "Claim"

### Proposed Solution

**Files to Modify/Create:**
1. `packages/client/src/game/panels/DuelPanel/DuelSpoilsScreen.tsx` (NEW)
2. `packages/client/src/game/panels/DuelPanel/DuelPanel.tsx` (MODIFY)
3. `packages/server/src/systems/DuelSystem/DuelCombatResolver.ts` (MODIFY)

**Implementation:**

```typescript
// DuelSpoilsScreen.tsx - New component
interface DuelSpoilsScreenProps {
  isWinner: boolean;
  opponentName: string;
  opponentCombatLevel: number;
  itemsWon: Array<{ itemId: string; quantity: number; value: number }>;
  totalValue: number;
  onClaim: () => void;
}

export function DuelSpoilsScreen({
  isWinner,
  opponentName,
  opponentCombatLevel,
  itemsWon,
  totalValue,
  onClaim,
}: DuelSpoilsScreenProps) {
  // Winner: Full spoils screen with item grid and "Claim" button
  // Loser: Simple "You have lost!" message with "OK" button
}
```

**Server changes:**
- Add `duelSpoils` event with winner/loser items, opponent info
- Emit to both players with role-specific data (winner sees items won, loser sees items lost)

**State Flow:**
1. `FINISHED` state triggers `duelSpoils` event
2. Client shows `DuelSpoilsScreen` based on win/loss
3. Winner clicks "Claim" → client sends acknowledgment
4. Screen closes, player returned to normal state

---

## Issue 2: Combat Rotation Off During Duel

### Current State
When attacking another player, their rotation is "kind of to the side" - not exactly facing the attacker.

### Research Findings

**Rotation Flow:**
1. `CombatRotationManager.rotateTowardsTarget()` calculates angle
2. Uses `Math.atan2(dx, dz)` for XZ plane rotation
3. VRM 1.0+ compensation adds `Math.PI` (180°)
4. Applies quaternion to `entity.rotation`, `entity.base.quaternion`

**Potential Issues Found:**
- `TileInterpolator.setCombatRotation()` only applies when entity is NOT moving (line 1058-1091)
- If player is mid-movement when combat starts, rotation may be ignored
- Rotation slerp speed might cause visible lag

### Proposed Solution

**Files to Modify:**
1. `packages/shared/src/systems/shared/combat/CombatRotationManager.ts`
2. `packages/shared/src/systems/client/TileInterpolator.ts`

**Implementation:**

```typescript
// CombatRotationManager.ts - Add immediate rotation for combat start
rotateTowardsTarget(
  attackerId: string,
  targetId: string,
  attackerType: "player" | "mob",
  targetType: "player" | "mob",
  immediate: boolean = false, // NEW: Skip interpolation for combat start
): void {
  // ... existing angle calculation ...

  if (immediate) {
    // Set both current and target quaternion to same value
    // This prevents slerp delay on combat initiation
    this.applyRotationImmediate(entity, quaternion);
  } else {
    this.applyRotation(entity, quaternion);
  }
}
```

```typescript
// TileInterpolator.ts - Force rotation even during movement for combat
setCombatRotation(entityId: string, quaternion: QuaternionArray): void {
  const state = this.entityStates.get(entityId);
  if (!state) return;

  // CHANGE: Apply combat rotation regardless of movement state
  // Combat facing takes priority over movement facing
  state.inCombatRotation = true;
  state.quaternion.set(...quaternion);
  state.targetQuaternion.set(...quaternion);
}
```

**Additional fix - ensure both combatants rotate:**
- When combat starts, rotate BOTH attacker AND target to face each other
- Currently only attacker rotates on first hit; target should auto-face on retaliate

---

## Issue 3: Death Position Offset

### Current State
When Player A kills Player B, Player A sees Player B move over a tile and die there, not at their actual standing position.

### Research Findings

**Death Position Flow:**
1. `PlayerDeathSystem.handlePlayerDeath()` captures position from entity
2. Position stored as `[x, y, z]` tuple in `entity.data.deathPosition`
3. `PLAYER_SET_DEAD` event broadcasts position to all clients
4. Client receives and applies position to entity

**Potential Issues Found:**
- Death position captured AFTER damage application, entity may have moved
- Network latency between damage and death broadcast
- `TileInterpolator` may have pending movement that completes after death

### Proposed Solution

**Files to Modify:**
1. `packages/shared/src/systems/shared/combat/PlayerDeathSystem.ts`
2. `packages/shared/src/systems/client/ClientNetwork.ts`

**Implementation:**

```typescript
// PlayerDeathSystem.ts - Capture position at damage time, not death time
handlePlayerDeath(
  playerId: string,
  killedBy: string,
  damagePosition?: Position3D, // NEW: Position when lethal damage was dealt
): void {
  // Use damagePosition if provided (captured at damage application time)
  // Otherwise fall back to current entity position
  const deathPosition = damagePosition ?? this.getEntityPosition(playerId);

  // ... rest of death handling ...
}
```

```typescript
// CombatSystem.ts - Pass position when dealing lethal damage
if (targetHealth <= 0) {
  // Capture position NOW, before any async operations
  const deathPosition = { ...target.position };
  this.playerDeathSystem.handlePlayerDeath(
    targetId,
    attackerId,
    deathPosition, // Pass captured position
  );
}
```

```typescript
// ClientNetwork.ts - Cancel pending movement on death
handlePlayerSetDead(data: { playerId: string; deathPosition?: number[] }): void {
  const entity = this.world.entities.get(data.playerId);
  if (!entity) return;

  // Cancel any pending tile movement
  const interpolator = this.world.getSystem("tile-interpolator");
  interpolator?.cancelMovement(data.playerId);

  // Apply death position immediately (no interpolation)
  if (data.deathPosition) {
    entity.position.set(...data.deathPosition);
    entity.node.position.set(...data.deathPosition);
  }
}
```

---

## Issue 4: Ground Clipping Under Arena Buildings

### Current State
Duel arena buildings don't flatten the ground under them, causing terrain to protrude through floors.

### Research Findings

**Station Flattening System:**
- `TerrainSystem.loadFlatZonesFromManifest()` creates flat zones for stations
- `FlatZone` interface: `{ id, centerX, centerZ, width, depth, height, blendRadius }`
- Stations with `flattenGround: true` get automatic terrain flattening
- Smooth blending using smoothstep interpolation at edges

### Proposed Solution

**Files to Modify:**
1. `packages/server/world/assets/manifests/world-areas.json`
2. `packages/shared/src/systems/shared/world/TerrainSystem.ts`

**Implementation:**

```json
// world-areas.json - Add flat zones for duel arena structures
"duel_arena": {
  // ... existing config ...
  "flatZones": [
    {
      "id": "duel_arena_lobby",
      "centerX": 250,
      "centerZ": 295,
      "width": 60,
      "depth": 30,
      "blendRadius": 1.0
    },
    {
      "id": "duel_arena_hospital",
      "centerX": 210,
      "centerZ": 295,
      "width": 20,
      "depth": 15,
      "blendRadius": 0.5
    },
    // Add flat zones for each of 6 arenas
    {
      "id": "duel_arena_1",
      "centerX": 70,
      "centerZ": 92,
      "width": 22,
      "depth": 26,
      "blendRadius": 0.5
    }
    // ... arenas 2-6 ...
  ]
}
```

```typescript
// TerrainSystem.ts - Load flat zones from world areas (not just stations)
private loadFlatZonesFromManifest(): void {
  // Existing station loading...

  // NEW: Load flat zones from world area definitions
  for (const [areaId, area] of Object.entries(ALL_WORLD_AREAS)) {
    if (area.flatZones) {
      for (const zoneConfig of area.flatZones) {
        const zone: FlatZone = {
          id: zoneConfig.id,
          centerX: zoneConfig.centerX,
          centerZ: zoneConfig.centerZ,
          width: zoneConfig.width,
          depth: zoneConfig.depth,
          height: this.getProceduralHeightWithBoost(
            zoneConfig.centerX,
            zoneConfig.centerZ,
          ),
          blendRadius: zoneConfig.blendRadius ?? 0.5,
        };
        this.registerFlatZone(zone);
      }
    }
  }
}
```

---

## Issue 5: Arena Walls Not Blocking Movement

### Current State
Players can walk through walls in the duel arena.

### Research Findings

**Current Wall System:**
- `DuelArenaVisualsSystem` creates visual walls using Three.js geometry
- Walls are purely visual - no collision shapes
- Collision uses `CollisionMatrix` for tile-based walkability
- Arena bounds enforced via `canMove()` check in DuelSystem

### Proposed Solution

**Files to Modify/Create:**
1. `packages/shared/src/systems/client/DuelArenaVisualsSystem.ts`
2. `packages/server/world/assets/manifests/duel-arenas.json`
3. `packages/shared/src/systems/shared/movement/CollisionMatrix.ts`

**Implementation:**

**Option A: Tile-Based Collision (Recommended - matches OSRS)**

```typescript
// CollisionMatrix.ts - Register arena walls as blocked tiles
registerArenaWalls(arenaId: number, bounds: ArenaBounds): void {
  const { min, max } = bounds;

  // Block all tiles on arena perimeter
  // North wall (z = minZ)
  for (let x = min.x; x <= max.x; x++) {
    this.setFlags(x, min.z, CollisionMask.BLOCKS_WALK);
  }
  // South wall (z = maxZ)
  for (let x = min.x; x <= max.x; x++) {
    this.setFlags(x, max.z, CollisionMask.BLOCKS_WALK);
  }
  // West wall (x = minX)
  for (let z = min.z; z <= max.z; z++) {
    this.setFlags(min.x, z, CollisionMask.BLOCKS_WALK);
  }
  // East wall (x = maxX)
  for (let z = min.z; z <= max.z; z++) {
    this.setFlags(max.x, z, CollisionMask.BLOCKS_WALK);
  }
}
```

**Option B: PhysX Collision (for 3D accuracy)**

```typescript
// DuelArenaVisualsSystem.ts - Add PhysX colliders to walls
private createWallWithCollision(
  x: number, z: number,
  width: number, depth: number,
  material: THREE.Material,
  terrainY: number,
): void {
  // Create visual mesh (existing)
  const mesh = this.createWall(x, z, width, depth, material, terrainY);

  // Create PhysX collider
  const collider = new Collider();
  collider._type = "box";
  collider._width = width;
  collider._height = WALL_HEIGHT;
  collider._depth = depth;
  collider._layer = "environment";
  collider.position.set(x, terrainY + WALL_HEIGHT / 2, z);

  this.world.add(collider);
}
```

---

## Issue 6: Player Legs Through Ground

### Current State
Player legs clip through the ground in certain areas.

### Research Findings

**Height Management:**
- `TerrainSystem.getHeightAt(x, z)` returns ground height
- `PlayerLocal` snaps Y to terrain with 0.01 tolerance
- Snap happens every frame in update loop
- Camera validates player height (0-10 units above terrain allowed)

**Potential Issues:**
- Terrain LOD or chunk boundaries may have height discontinuities
- VRM avatar model offset might be incorrect
- Interpolation between positions may not query terrain properly

### Proposed Solution

**Files to Modify:**
1. `packages/shared/src/entities/player/PlayerLocal.ts`
2. `packages/shared/src/systems/client/TileInterpolator.ts`

**Implementation:**

```typescript
// PlayerLocal.ts - More aggressive ground clamping
private groundToTerrain(): void {
  const terrain = this.world.getSystem<TerrainSystem>("terrain");
  if (!terrain) return;

  const terrainHeight = terrain.getHeightAt(this.position.x, this.position.z);
  if (!Number.isFinite(terrainHeight)) return;

  // CHANGE: Snap immediately if below terrain (no tolerance for clipping)
  if (this.position.y < terrainHeight) {
    this.position.y = terrainHeight;
  }
  // Allow small tolerance for being above (jumping, stairs)
  else if (this.position.y > terrainHeight + 0.5) {
    // Only snap down if significantly above and not jumping
    if (!this.isJumping) {
      this.position.y = terrainHeight;
    }
  }
}
```

```typescript
// TileInterpolator.ts - Query terrain during interpolation
private interpolatePosition(state: EntityState, t: number): void {
  // Existing XZ interpolation...

  // NEW: Always ground Y to terrain after interpolation
  const terrain = this.world.getSystem<TerrainSystem>("terrain");
  if (terrain) {
    const terrainHeight = terrain.getHeightAt(state.position.x, state.position.z);
    if (Number.isFinite(terrainHeight)) {
      state.position.y = terrainHeight;
    }
  }
}
```

---

## Issue 7: Forfeit Option with Interactable Object

### Current State
Forfeit only available via button in DuelHUD. No world interactable for forfeit.

### OSRS Reference
- OSRS had trapdoors in arena corners for forfeit
- Players walk to trapdoor and interact to forfeit

### Proposed Solution

**Files to Create/Modify:**
1. `packages/server/world/assets/manifests/duel-arenas.json` (MODIFY)
2. `packages/shared/src/entities/world/ForfeitPillarEntity.ts` (NEW)
3. `packages/shared/src/systems/client/interaction/handlers/ForfeitPillarInteractionHandler.ts` (NEW)
4. `packages/server/src/systems/ServerNetwork/handlers/duel/combat.ts` (MODIFY)

**Implementation:**

```json
// duel-arenas.json - Add forfeit pillars to each arena
{
  "arenas": [
    {
      "arenaId": 1,
      "forfeitPillars": [
        { "x": 203, "y": 0, "z": 206 },
        { "x": 203, "y": 0, "z": 214 },
        { "x": 217, "y": 0, "z": 206 },
        { "x": 217, "y": 0, "z": 214 }
      ]
    }
  ]
}
```

```typescript
// ForfeitPillarEntity.ts - Red pillar entity for forfeit
export class ForfeitPillarEntity extends Entity {
  constructor(world: World, position: Position3D, arenaId: number) {
    super(world);
    this.type = "forfeit_pillar";
    this.position = position;
    this.arenaId = arenaId;

    // Visual: Red cube/pillar
    const geometry = new THREE.BoxGeometry(0.5, 1.5, 0.5);
    const material = new THREE.MeshStandardMaterial({
      color: 0xff0000,
      emissive: 0x330000,
    });
    this.mesh = new THREE.Mesh(geometry, material);
  }
}
```

```typescript
// ForfeitPillarInteractionHandler.ts
export class ForfeitPillarInteractionHandler implements InteractionHandler {
  onRightClick(target: RaycastTarget): ContextMenuItem[] {
    // Check if player is in active duel with noForfeit = false
    const duelState = this.getDuelState();
    if (!duelState || duelState.rules.noForfeit) {
      return []; // No options if forfeit disabled
    }

    return [{
      label: "Forfeit",
      action: () => this.handleForfeit(),
      color: "#ff4444",
    }];
  }

  private handleForfeit(): void {
    // Send forfeit request to server
    this.network.send("duelForfeit", { duelId: this.duelState.duelId });
  }
}
```

---

## Issue 8: Walk to Player Before Challenge

### Current State
Duel challenge can be sent from 15 tiles away. Should walk to player first like trading.

### Research Findings (Trade System)

**Trade Walk Flow:**
1. Click player → check distance (1 tile for trade)
2. If not in range → `PendingTradeManager.queuePendingTrade()`
3. Server calls `movePlayerToward()` with target position
4. Every tick, re-check distance and re-path if target moved
5. When in range → execute trade request callback

### Proposed Solution

**Files to Create/Modify:**
1. `packages/server/src/systems/ServerNetwork/PendingDuelManager.ts` (NEW - similar to PendingTradeManager)
2. `packages/server/src/systems/ServerNetwork/handlers/duel/challenge.ts` (MODIFY)
3. `packages/server/src/systems/DuelSystem/PendingDuelManager.ts` (MODIFY existing)

**Implementation:**

```typescript
// PendingDuelChallengeManager.ts - Queue walk-to-player for duel challenges
export class PendingDuelChallengeManager {
  private pendingChallenges: Map<string, PendingChallenge> = new Map();

  /** Challenge range - must be adjacent like trade (1 tile) */
  private static readonly CHALLENGE_RANGE = 1;

  queuePendingChallenge(
    challengerId: string,
    targetId: string,
    onInRange: () => void,
  ): void {
    // Cancel any existing pending challenge
    this.cancelPendingChallenge(challengerId);

    const targetPos = this.getTargetPosition(targetId);
    if (!targetPos) return;

    // Check if already in range
    if (this.isInRange(challengerId, targetId)) {
      onInRange();
      return;
    }

    // Queue pending challenge
    this.pendingChallenges.set(challengerId, {
      challengerId,
      targetId,
      onInRange,
    });

    // Start walking toward target
    this.tileMovementManager.movePlayerToward(
      challengerId,
      targetPos,
      true, // running
      PendingDuelChallengeManager.CHALLENGE_RANGE,
    );
  }

  processTick(): void {
    for (const [challengerId, pending] of this.pendingChallenges) {
      // Re-check range every tick
      if (this.isInRange(challengerId, pending.targetId)) {
        pending.onInRange();
        this.pendingChallenges.delete(challengerId);
        continue;
      }

      // Re-path if target moved
      const targetPos = this.getTargetPosition(pending.targetId);
      if (targetPos && this.hasTargetMoved(pending, targetPos)) {
        this.tileMovementManager.movePlayerToward(
          challengerId,
          targetPos,
          true,
          PendingDuelChallengeManager.CHALLENGE_RANGE,
        );
      }
    }
  }
}
```

```typescript
// challenge.ts - Use walk-to-player before sending challenge
export function handleDuelChallenge(
  socket: ServerSocket,
  data: { targetPlayerId: string },
  world: World,
): void {
  // ... existing validation (zone checks, etc.) ...

  const sendChallenge = () => {
    // Existing challenge creation logic
    const result = duelSystem.createChallenge(
      playerId,
      playerName,
      targetPlayerId,
      targetName,
    );
    // ... send response ...
  };

  // Check if already in challenge range (1 tile)
  if (arePlayersInChallengeRange(world, playerId, targetPlayerId, 1)) {
    sendChallenge();
    return;
  }

  // Queue walk-to-player
  const pendingManager = getPendingDuelChallengeManager(world);
  pendingManager.queuePendingChallenge(playerId, targetPlayerId, sendChallenge);

  // Notify challenger they're walking to target
  sendToSocket(socket, "showToast", {
    type: "info",
    message: `Walking to ${targetName}...`,
  });
}
```

---

## Issue 9: Challenge Requests Outside Duel Arena

### Current State
Zone checks exist but may not be enforced consistently.

### Research Findings

**Existing Checks:**
- `isInDuelArenaZone()` checks player position against `ALL_WORLD_AREAS["duel_arena"].bounds`
- `handleDuelChallenge` validates both players in zone (lines 95-128)
- Bounds: minX: 50, maxX: 150, minZ: 50, maxZ: 150

### Proposed Solution

The checks are implemented but may have edge cases. Ensure:

**Files to Modify:**
1. `packages/server/src/systems/ServerNetwork/handlers/duel/challenge.ts`
2. `packages/shared/src/systems/client/interaction/handlers/PlayerInteractionHandler.ts`

**Implementation:**

```typescript
// challenge.ts - Add explicit early validation
export function handleDuelChallenge(
  socket: ServerSocket,
  data: { targetPlayerId: string },
  world: World,
): void {
  const playerId = getPlayerId(socket);
  if (!playerId) {
    sendDuelError(socket, "Not authenticated", "NOT_AUTHENTICATED");
    return;
  }

  // FIRST CHECK: Zone validation before any other processing
  if (!isInDuelArenaZone(world, playerId)) {
    sendDuelError(
      socket,
      "You must be in the Duel Arena to challenge players.",
      "NOT_IN_DUEL_ARENA",
    );
    return;
  }

  // ... rest of validation ...
}
```

```typescript
// PlayerInteractionHandler.ts - Hide "Challenge" option outside duel arena
private getContextMenuOptions(target: PlayerEntity): ContextMenuItem[] {
  const options: ContextMenuItem[] = [];

  // Challenge option - only in Duel Arena
  if (this.isInDuelArenaZone()) {
    options.push({
      label: "Challenge",
      action: () => this.challengePlayer(target),
      color: "#ffaa00",
    });
  }

  // ... other options ...
}
```

---

## Issue 10: Left-Click Attack Not Working in Duel

### Current State
Must right-click and press "Attack" to attack opponent. Left-click does nothing.

### Research Findings

**Current Behavior (OSRS-accurate for normal gameplay):**
- `PlayerInteractionHandler.onLeftClick()` is a no-op (line 33-35)
- All player interactions require right-click context menu
- This is correct for general PvP safety

**Duel Arena Exception:**
- In active duel, left-click SHOULD immediately attack opponent
- OSRS allows left-click attack on your duel opponent only

### Proposed Solution

**Files to Modify:**
1. `packages/shared/src/systems/client/interaction/handlers/PlayerInteractionHandler.ts`

**Implementation:**

```typescript
// PlayerInteractionHandler.ts - Enable left-click attack in active duel
onLeftClick(target: RaycastTarget): void {
  const targetEntity = target.entity as PlayerEntity;
  if (!targetEntity) return;

  // Check if we're in an active duel with this specific player
  const duelState = this.getDuelState();
  if (!duelState || duelState.state !== "FIGHTING") {
    return; // Not in active duel, no left-click action
  }

  // Verify clicked player is our duel opponent
  const opponentId = duelState.challengerId === this.localPlayerId
    ? duelState.targetId
    : duelState.challengerId;

  if (targetEntity.playerId !== opponentId) {
    return; // Clicked someone other than our opponent
  }

  // Left-click attack allowed - initiate combat
  this.attackPlayer(targetEntity);
}

private getDuelState(): DuelState | null {
  // Query duel state from DuelPanel or network state
  const duelPanel = this.world.getSystem("duel-panel");
  return duelPanel?.getState() ?? null;
}

private attackPlayer(target: PlayerEntity): void {
  // Send attack request to server
  this.network.send(MESSAGE_TYPES.ATTACK_PLAYER, {
    targetId: target.playerId,
    timestamp: Date.now(),
  });

  // Show feedback
  this.chat.addSystemMessage(`Attacking ${target.displayName}...`);
}
```

**Additional Enhancement - Visual Feedback:**

```typescript
// Add attack cursor when hovering duel opponent
onHover(target: RaycastTarget): void {
  const targetEntity = target.entity as PlayerEntity;
  const duelState = this.getDuelState();

  if (duelState?.state === "FIGHTING" && this.isMyDuelOpponent(targetEntity)) {
    // Show attack cursor
    document.body.style.cursor = "crosshair";
    // Highlight target with combat outline
    this.highlightSystem?.setHighlight(targetEntity, "combat");
  }
}
```

---

## Implementation Priority

| Issue | Priority | Complexity | Dependencies |
|-------|----------|------------|--------------|
| 10. Left-click attack | **High** | Low | None |
| 1. Victory screen | **High** | Medium | None |
| 8. Walk to challenge | **High** | Medium | Existing PendingTradeManager pattern |
| 3. Death position | **High** | Low | None |
| 2. Combat rotation | Medium | Medium | TileInterpolator |
| 5. Arena walls | Medium | Low | CollisionMatrix |
| 9. Zone validation | Medium | Low | None |
| 7. Forfeit pillars | Low | Medium | Entity system |
| 4. Ground flattening | Low | Low | TerrainSystem |
| 6. Leg clipping | Low | Low | TerrainSystem |

---

## Testing Checklist

- [ ] Victory screen displays correct items and values
- [ ] Winner can claim items, loser sees defeat message
- [ ] Combat rotation faces opponent correctly on first attack
- [ ] Death animation plays at correct position
- [ ] Arena floors are flat (no terrain protrusion)
- [ ] Cannot walk through arena walls
- [ ] Player legs don't clip through ground
- [ ] Forfeit pillars spawn in arena corners
- [ ] Walking to player before challenge works
- [ ] Cannot send challenges outside duel arena
- [ ] Left-click attacks opponent in active duel
