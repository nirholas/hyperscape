# Plan: Static Tile Collision for Resources & Stations

## Problem Statement

Currently, players and NPCs can walk through resources (trees, rocks, fishing spots) and stations (furnace, anvil, bank). This breaks:
1. **Kiting mechanics** - Players can't use obstacles to create safe spots
2. **World immersion** - Entities clip through solid objects
3. **OSRS accuracy** - In RuneScape, all world objects block movement tiles

---

## Critical Analysis: Is the Original Plan AAA Quality?

**No.** The original plan had several architectural issues that wouldn't scale for a production game.

### Issues with Original Plan

| Issue | Original Approach | Problem |
|-------|-------------------|---------|
| **Two separate systems** | `EntityOccupancyMap` + `StaticCollisionMap` | Fragmented logic, double lookups |
| **String key allocation** | `"x,z"` strings in Map | GC pressure in hot paths |
| **No bitmask flags** | Boolean `walkable` only | Can't handle directional walls |
| **Flat storage** | Single global Map | Doesn't scale to large worlds |
| **No zone organization** | Random access pattern | Poor cache locality |
| **Client sync not addressed** | Server-only | Movement prediction fails |

### How OSRS Actually Does It

Based on research from [RuneDocs](https://runedocs.github.io/docs/functionality/map/), [OSRS-docs](https://osrs-docs.com/docs/mechanics/entity-collision/), and [Rune-Server](https://rune-server.org/threads/collision-flags-map-rendering.620525/):

1. **Bitmask flags per tile (int32):**
   ```
   WALL_NORTH:     0x000002
   WALL_EAST:      0x000008
   WALL_SOUTH:     0x000020
   WALL_WEST:      0x000080
   BLOCKED:        0x200000  (full tile block - trees, rocks)
   OCCUPIED:       0x000100  (entity on tile - players, NPCs)
   BLOCK_RANGED_*: 0x400000+ (blocks projectiles)
   ```

2. **Zone-based storage (8x8 tiles):**
   - Each zone = 64 int32 values = 256 bytes
   - `Zone[altitude][zoneX][zoneZ]`
   - Efficient for instancing, serialization, and spatial queries

3. **Unified system:**
   - Single collision matrix handles everything
   - Objects add flags on spawn, remove on despawn
   - Entities add `OCCUPIED` when moving

---

## AAA Approach: Unified Collision Matrix

### Core Design Principles

1. **Single source of truth** - One collision system, not two
2. **Bitmask flags** - Combine multiple collision types efficiently
3. **Zone-based storage** - Cache-friendly, scalable
4. **Zero allocation in hot paths** - Array indexing, not string keys
5. **Server-client sync** - Zones synced for movement prediction

---

## Implementation Plan (Revised)

### Phase 1: Define Collision Flags

**New File:** `packages/shared/src/systems/shared/movement/CollisionFlags.ts`

```typescript
/**
 * OSRS-accurate collision flags (bitmask)
 *
 * Each tile has an int32 bitmask combining these flags.
 * Bitwise operations allow efficient queries:
 *   if (flags & CollisionFlag.BLOCKED) { /* can't walk */ }
 *
 * @see https://osrs-docs.com/docs/mechanics/entity-collision/
 */
export const CollisionFlag = {
  // Directional wall flags (blocks movement FROM that direction)
  WALL_NORTH:       0x00000002,
  WALL_EAST:        0x00000008,
  WALL_SOUTH:       0x00000020,
  WALL_WEST:        0x00000080,
  WALL_NORTH_WEST:  0x00000001,
  WALL_NORTH_EAST:  0x00000004,
  WALL_SOUTH_EAST:  0x00000010,
  WALL_SOUTH_WEST:  0x00000040,

  // Full tile blocking (trees, rocks, furnaces, etc.)
  BLOCKED:          0x00200000,

  // Entity occupancy (players, NPCs)
  OCCUPIED_PLAYER:  0x00000100,
  OCCUPIED_NPC:     0x00000200,

  // Line of sight blocking (for ranged combat)
  BLOCK_LOS:        0x00400000,

  // Water (special movement rules)
  WATER:            0x00800000,

  // Decoration (doesn't block but marks tile)
  DECORATION:       0x00040000,
} as const;

// Combined masks for common queries
export const CollisionMask = {
  /** Any blocking for ground movement */
  BLOCKS_WALK: CollisionFlag.BLOCKED | CollisionFlag.WATER,

  /** Any entity occupying tile */
  OCCUPIED: CollisionFlag.OCCUPIED_PLAYER | CollisionFlag.OCCUPIED_NPC,

  /** Blocks ranged attacks */
  BLOCKS_RANGED: CollisionFlag.BLOCK_LOS | CollisionFlag.BLOCKED,

  /** All walls combined */
  WALLS: CollisionFlag.WALL_NORTH | CollisionFlag.WALL_EAST |
         CollisionFlag.WALL_SOUTH | CollisionFlag.WALL_WEST |
         CollisionFlag.WALL_NORTH_WEST | CollisionFlag.WALL_NORTH_EAST |
         CollisionFlag.WALL_SOUTH_EAST | CollisionFlag.WALL_SOUTH_WEST,
} as const;

export type CollisionFlagValue = typeof CollisionFlag[keyof typeof CollisionFlag];
```

---

### Phase 2: Create Zone-Based Collision Matrix

**New File:** `packages/shared/src/systems/shared/movement/CollisionMatrix.ts`

```typescript
/**
 * CollisionMatrix - Zone-based collision storage
 *
 * Stores collision flags per tile in zone-sized chunks (8x8).
 * Uses Int32Array for efficient memory and bitwise operations.
 *
 * Architecture:
 * - World divided into zones (8x8 tiles each)
 * - Each zone = Int32Array[64] = 256 bytes
 * - Zone lookup: O(1) via coordinate math
 * - Tile lookup within zone: O(1) via array index
 *
 * Memory footprint:
 * - 1000x1000 tile world = 125x125 zones = 15,625 zones
 * - 15,625 zones × 256 bytes = ~4MB
 *
 * @see CollisionFlags for flag definitions
 */

export const ZONE_SIZE = 8; // 8x8 tiles per zone

export interface ICollisionMatrix {
  /** Get flags for a tile */
  getFlags(tileX: number, tileZ: number): number;

  /** Set flags for a tile (replaces) */
  setFlags(tileX: number, tileZ: number, flags: number): void;

  /** Add flags to a tile (bitwise OR) */
  addFlags(tileX: number, tileZ: number, flags: number): void;

  /** Remove flags from a tile (bitwise AND NOT) */
  removeFlags(tileX: number, tileZ: number, flags: number): void;

  /** Check if tile has specific flags */
  hasFlags(tileX: number, tileZ: number, flags: number): boolean;

  /** Check if movement is blocked in direction */
  isBlocked(
    fromX: number, fromZ: number,
    toX: number, toZ: number
  ): boolean;

  /** Clear all collision data */
  clear(): void;

  /** Get raw zone data (for networking) */
  getZoneData(zoneX: number, zoneZ: number): Int32Array | null;

  /** Set raw zone data (from network) */
  setZoneData(zoneX: number, zoneZ: number, data: Int32Array): void;
}
```

**Implementation highlights:**
- Lazy zone allocation (only create zones that have objects)
- `Map<string, Int32Array>` with zone keys `"zoneX,zoneZ"`
- Pre-computed zone/tile indices to avoid division in hot paths
- Directional blocking checks wall flags in BOTH source and dest tiles

---

### Phase 3: Merge EntityOccupancyMap into CollisionMatrix

**Modify:** `packages/shared/src/systems/shared/movement/EntityOccupancyMap.ts`

Instead of a separate system, entities now use `CollisionMatrix`:

```typescript
// OLD: Separate map
this._occupiedTiles.set(key, entry);

// NEW: Add flags to CollisionMatrix
const flag = entityType === "player"
  ? CollisionFlag.OCCUPIED_PLAYER
  : CollisionFlag.OCCUPIED_NPC;
this.collisionMatrix.addFlags(tile.x, tile.z, flag);
```

**Keep `EntityOccupancyMap` as a facade** that:
- Tracks which tiles each entity occupies (for vacate/move)
- Delegates collision queries to `CollisionMatrix`
- Handles `ignoresCollision` for bosses

---

### Phase 4: Static Object Registration

**New interface for collidable objects:**

```typescript
export interface ICollidable {
  /** Unique object ID */
  readonly id: string;

  /** Collision flags this object adds */
  readonly collisionFlags: number;

  /** Tiles this object occupies */
  getOccupiedTiles(): TileCoord[];
}
```

**Update `ResourceEntity`:**

```typescript
// In ResourceEntity
get collisionFlags(): number {
  return CollisionFlag.BLOCKED; // Trees, rocks fully block
}

getOccupiedTiles(): TileCoord[] {
  const anchor = worldToTile(this.position.x, this.position.z);
  const size = FOOTPRINT_SIZES[this.config.footprint || "standard"];
  const tiles: TileCoord[] = [];
  for (let dx = 0; dx < size.x; dx++) {
    for (let dz = 0; dz < size.z; dz++) {
      tiles.push({ x: anchor.x + dx, z: anchor.z + dz });
    }
  }
  return tiles;
}

// In init()
for (const tile of this.getOccupiedTiles()) {
  this.world.collision.addFlags(tile.x, tile.z, this.collisionFlags);
}

// In destroy()
for (const tile of this.getOccupiedTiles()) {
  this.world.collision.removeFlags(tile.x, tile.z, this.collisionFlags);
}
```

---

### Phase 5: Update Pathfinding

**Simplify `isWalkable` callback:**

```typescript
// OLD: Check multiple systems
isWalkable: (tile) => {
  if (this.world.staticCollision?.isBlocked(tile)) return false;
  const terrain = this.world.getSystem("terrain");
  // ... terrain checks
  return true;
}

// NEW: Single collision check
isWalkable: (tile) => {
  const flags = this.world.collision.getFlags(tile.x, tile.z);
  return (flags & CollisionMask.BLOCKS_WALK) === 0;
}
```

**Directional movement check:**

```typescript
canMove(fromX: number, fromZ: number, toX: number, toZ: number): boolean {
  return !this.world.collision.isBlocked(fromX, fromZ, toX, toZ);
}
```

---

### Phase 6: Terrain Integration

**Terrain already marks water/slopes.** Integrate with collision:

```typescript
// In TerrainSystem.generateTile()
if (height < WATER_THRESHOLD) {
  this.world.collision.addFlags(tileX, tileZ, CollisionFlag.WATER);
}

if (slope > MAX_WALKABLE_SLOPE) {
  this.world.collision.addFlags(tileX, tileZ, CollisionFlag.BLOCKED);
}
```

---

### Phase 7: Client-Server Sync

**Server:** Authoritative collision state
**Client:** Receives zone collision data for movement prediction

```typescript
// On player entering new area, send relevant zones
network.sendTo(playerId, "zoneCollision", {
  zoneX, zoneZ,
  data: Array.from(collision.getZoneData(zoneX, zoneZ))
});

// Client applies zone data
world.collision.setZoneData(zoneX, zoneZ, new Int32Array(data));
```

---

## Revised File Changes

| File | Change | Priority |
|------|--------|----------|
| `CollisionFlags.ts` | **NEW** - Flag definitions | P0 |
| `CollisionMatrix.ts` | **NEW** - Zone-based storage | P0 |
| `World.ts` | Add `collision: ICollisionMatrix` | P0 |
| `createServerWorld.ts` | Initialize CollisionMatrix | P0 |
| `createClientWorld.ts` | Initialize CollisionMatrix | P0 |
| `EntityOccupancyMap.ts` | Delegate to CollisionMatrix | P1 |
| `ResourceEntity.ts` | Register collision on spawn | P1 |
| `FurnaceEntity.ts` | Register collision on spawn | P1 |
| `AnvilEntity.ts` | Register collision on spawn | P1 |
| `BankEntity.ts` | Register collision on spawn | P1 |
| `MobEntity.ts` | Use unified `isBlocked()` | P1 |
| `TerrainSystem.ts` | Mark water/slopes in matrix | P2 |
| `ClientNetwork.ts` | Receive zone collision data | P2 |
| `ServerNetwork.ts` | Send zone collision on area change | P2 |

---

## Performance Comparison

| Metric | Original Plan | AAA Approach |
|--------|---------------|--------------|
| Lookup | O(1) Map + string alloc | O(1) array index, zero alloc |
| Memory per tile | ~50 bytes (Map entry) | 4 bytes (int32) |
| 1000 objects | ~50KB | ~4KB |
| Cache locality | Poor (random Map) | Excellent (contiguous zones) |
| Directional walls | Not supported | Native bitmask |
| Client sync | Not addressed | Zone-based packets |

---

## Migration Path

**Phase 1: Add CollisionMatrix alongside existing systems**
- Create new files, don't modify existing yet
- Both systems run in parallel for testing

**Phase 2: Migrate EntityOccupancyMap**
- Change internal storage to use CollisionMatrix
- Keep public API unchanged for compatibility

**Phase 3: Add static object registration**
- Resources and stations register on spawn
- Verify safespotting works

**Phase 4: Remove redundant terrain checks**
- Terrain marks tiles in CollisionMatrix
- Simplify `isWalkable` callbacks

**Phase 5: Add client sync**
- Send zone data on area transitions
- Client uses local collision for prediction

---

## Testing Strategy

### Unit Tests

1. **CollisionMatrix tests**
   - Zone creation/lookup
   - Flag add/remove/query
   - Directional wall blocking
   - Memory limits

2. **Integration tests**
   - Resource spawns → tile blocked
   - Resource destroys → tile unblocked
   - Entity moves → flags update atomically
   - Pathfinding respects all flags

### Performance Tests

1. **Pathfinding benchmark**
   - 1000 simultaneous pathfind queries
   - No regression from current performance

2. **Memory benchmark**
   - 10,000 static objects
   - Memory stays under 10MB for collision

### Gameplay Tests

1. **Safespotting**
   - Mob stuck behind tree ✓
   - Player can attack from behind rock ✓

2. **Movement blocking**
   - Can't walk through furnace ✓
   - Can interact from adjacent tile ✓

---

## Success Criteria

- [ ] Single unified collision system
- [ ] Bitmask flags for all collision types
- [ ] Zone-based storage with O(1) lookup
- [ ] Zero allocation in `isBlocked()` hot path
- [ ] Directional wall support
- [ ] Resources/stations block movement
- [ ] Safespotting works correctly
- [ ] Client-server collision sync
- [ ] No performance regression
- [ ] Memory under 10MB for collision data

---

## Addendum: Gap Resolutions

### Gap 1: Negative Tile Coordinates

**Problem:** Bit shift (`tileX >> 3`) gives incorrect results for negative numbers in JavaScript.

**Solution:** Use `Math.floor()` for zone calculation:

```typescript
// WRONG: Bit shift breaks for negatives
const zoneX = tileX >> 3;  // -9 >> 3 = -2 (wrong in JS)

// CORRECT: Math.floor works for all integers
const zoneX = Math.floor(tileX / ZONE_SIZE);  // Math.floor(-9 / 8) = -2 ✓

// For tile index within zone, use modulo with correction for negatives
const localX = ((tileX % ZONE_SIZE) + ZONE_SIZE) % ZONE_SIZE;
```

**Implementation in CollisionMatrix:**

```typescript
private getZoneKey(tileX: number, tileZ: number): string {
  const zoneX = Math.floor(tileX / ZONE_SIZE);
  const zoneZ = Math.floor(tileZ / ZONE_SIZE);
  return `${zoneX},${zoneZ}`;
}

private getTileIndex(tileX: number, tileZ: number): number {
  // Correct modulo for negative numbers
  const localX = ((tileX % ZONE_SIZE) + ZONE_SIZE) % ZONE_SIZE;
  const localZ = ((tileZ % ZONE_SIZE) + ZONE_SIZE) % ZONE_SIZE;
  return localX + (localZ * ZONE_SIZE);
}
```

---

### Gap 2: Depleted Resource Collision

**Decision:** Keep collision when resource is depleted (OSRS-accurate).

**Rationale:**
- In OSRS, tree stumps still block movement
- Players cannot walk through a recently-chopped tree
- Stumps remain solid until the tree fully respawns
- This enables consistent safespotting behavior

**Implementation:**

```typescript
// In ResourceEntity - NO collision changes on deplete/respawn
public deplete(): void {
  this.config.depleted = true;
  // Visual changes only - collision remains
  this.swapToStump();
  // DO NOT call: this.world.collision.removeFlags(...)
}

public respawn(): void {
  this.config.depleted = false;
  // Visual changes only - collision was never removed
  this.swapToFullModel();
}

// Collision only removed in destroy()
public destroy(): void {
  for (const tile of this.getOccupiedTiles()) {
    this.world.collision.removeFlags(tile.x, tile.z, this.collisionFlags);
  }
  super.destroy();
}
```

---

### Gap 3: Boss ignoresCollision Mapping

**Problem:** Bosses (Godwars generals, Dagannoth Kings, etc.) don't block player/NPC movement but still occupy tiles for other purposes.

**Solution:** Two-layer approach:

1. **CollisionMatrix:** Only stores blocking collision
   - Bosses with `ignoresCollision: true` → Don't add `OCCUPIED_NPC` flag
   - Other entities check CollisionMatrix and pass through

2. **EntityOccupancyMap (facade):** Tracks all entity positions
   - Still tracks boss tiles for spawn validation
   - Still tracks for "who is on this tile?" queries
   - Delegates blocking checks to CollisionMatrix

**Implementation:**

```typescript
// EntityOccupancyMap.occupy() - updated
occupy(
  entityId: EntityID,
  tiles: readonly TileCoord[],
  tileCount: number,
  entityType: OccupantType,
  ignoresCollision: boolean,
): void {
  // Always track in our internal map (for vacate/move/queries)
  this._entityTiles.set(entityId, tileKeys);
  this._entityMetadata.set(entityId, { entityType, ignoresCollision });

  // Only add to CollisionMatrix if entity blocks movement
  if (!ignoresCollision) {
    const flag = entityType === "player"
      ? CollisionFlag.OCCUPIED_PLAYER
      : CollisionFlag.OCCUPIED_NPC;

    for (let i = 0; i < tileCount; i++) {
      this.collisionMatrix.addFlags(tiles[i].x, tiles[i].z, flag);
    }
  }
}

// isBlocked() - delegates to CollisionMatrix
isBlocked(tile: TileCoord, excludeEntityId?: EntityID): boolean {
  // For exclude logic, we still need our internal tracking
  if (excludeEntityId) {
    const entry = this.getOccupant(tile);
    if (entry && entry.entityId === excludeEntityId) return false;
  }

  return this.collisionMatrix.hasFlags(
    tile.x, tile.z,
    CollisionMask.OCCUPIED
  );
}
```

---

### Gap 4: Atomic Multi-tile Entity Moves

**Problem:** A 3x3 boss moving requires clearing 9 old tiles and setting 9 new tiles. Race conditions could allow entities to briefly occupy the "gap."

**Solution:** Single atomic `move()` operation that:
1. Calculates old and new tile sets
2. Removes flags from tiles no longer occupied
3. Adds flags to newly occupied tiles
4. Updates internal tracking

**Implementation:**

```typescript
// EntityOccupancyMap.move() - atomic operation
move(
  entityId: EntityID,
  newTiles: readonly TileCoord[],
  tileCount: number,
): void {
  const metadata = this._entityMetadata.get(entityId);
  if (!metadata) return;

  const oldTileKeys = this._entityTiles.get(entityId);
  if (!oldTileKeys) return;

  // Build new tile key set
  const newTileKeys = new Set<string>();
  for (let i = 0; i < tileCount; i++) {
    newTileKeys.add(`${newTiles[i].x},${newTiles[i].z}`);
  }

  // Only modify CollisionMatrix if entity blocks movement
  if (!metadata.ignoresCollision) {
    const flag = metadata.entityType === "player"
      ? CollisionFlag.OCCUPIED_PLAYER
      : CollisionFlag.OCCUPIED_NPC;

    // Remove flags from tiles we're leaving (not in new set)
    for (const oldKey of oldTileKeys) {
      if (!newTileKeys.has(oldKey)) {
        const [x, z] = oldKey.split(",").map(Number);
        this.collisionMatrix.removeFlags(x, z, flag);
      }
    }

    // Add flags to tiles we're entering (not in old set)
    for (let i = 0; i < tileCount; i++) {
      const key = `${newTiles[i].x},${newTiles[i].z}`;
      if (!oldTileKeys.has(key)) {
        this.collisionMatrix.addFlags(newTiles[i].x, newTiles[i].z, flag);
      }
    }
  }

  // Update internal tracking
  this._entityTiles.set(entityId, newTileKeys);
}
```

**Key optimization:** Only modify tiles that changed (the "delta"), not all tiles. For a 3x3 boss moving 1 tile:
- Old: 9 tiles, New: 9 tiles
- Overlap: 6 tiles (unchanged)
- Delta: 3 tiles removed, 3 tiles added

---

## Updated Success Criteria

- [ ] Single unified collision system
- [ ] Bitmask flags for all collision types
- [ ] Zone-based storage with O(1) lookup
- [ ] Zero allocation in `isBlocked()` hot path
- [ ] Directional wall support
- [ ] Resources/stations block movement
- [ ] **Depleted resources still block (stumps)**
- [ ] **Negative tile coordinates work correctly**
- [ ] **Bosses with ignoresCollision don't block**
- [ ] **Atomic multi-tile entity moves**
- [ ] Safespotting works correctly
- [ ] Client-server collision sync
- [ ] No performance regression
- [ ] Memory under 10MB for collision data

---

## References

- [OSRS Wiki - Pathfinding](https://oldschool.runescape.wiki/w/Pathfinding)
- [OSRS Wiki - Safespot](https://oldschool.runescape.wiki/w/Safespot)
- [osrs-docs - Entity Collision](https://osrs-docs.com/docs/mechanics/entity-collision/)
- [RuneDocs - Game Map](https://runedocs.github.io/docs/functionality/map/)
- [MDN - Tilemaps](https://developer.mozilla.org/en-US/docs/Games/Techniques/Tilemaps)
