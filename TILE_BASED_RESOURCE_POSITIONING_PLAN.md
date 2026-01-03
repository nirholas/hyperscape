# Tile-Based Resource Positioning Plan

## Problem Statement

Currently, resources are placed at arbitrary world coordinates without regard to the tile grid. This causes issues:

1. **Face direction is inconsistent** - Player calculates angle to resource center, but that center isn't aligned to a tile
2. **Interaction positions are unpredictable** - No clear "stand here to interact" tiles
3. **Multi-tile resources aren't supported** - Large trees should occupy 2×2 tiles with players gathering from any adjacent tile

## OSRS Reference

From [OSRS Wiki - Pathfinding](https://oldschool.runescape.wiki/w/Pathfinding):
> "Larger monsters, such as the King Black Dragon, occupy multiple squares. For these larger monsters, their location is defined by the **south-westernmost square** they occupy."

Key behaviors:
- All interactable objects are tile-aligned
- Multi-tile objects have an anchor tile (SW corner)
- Players stand on adjacent tiles and face inward toward the object
- Face direction snaps to 8 cardinal/ordinal directions

---

## Design Goals

1. **Zero Config for Common Cases** - Normal 1×1 resources "just work"
2. **Intuitive Override** - Simple `footprint` field for special cases
3. **Auto-Snap Positions** - Manifest positions don't need to be tile-perfect
4. **Correct Face Direction** - Players face the resource tile center(s)
5. **Proper Interaction Tiles** - Clear adjacent tiles for standing

---

## Implementation Plan

### Phase A: Manifest Schema Update

**File:** `packages/server/world/assets/manifests/resources.json`

Add optional `footprint` field to resource definitions:

```json
{
  "id": "tree_normal",
  "name": "Tree",
  "scale": 3.0,
  "footprint": "standard",  // NEW - optional, defaults to "standard"
  ...
}
```

**Footprint Types:**

| Footprint | Tile Size | Anchor | Use Case |
|-----------|-----------|--------|----------|
| `"standard"` | 1×1 | Center | Normal trees, rocks, fishing spots |
| `"large"` | 2×2 | SW tile | Ancient trees, large ore veins |
| `"massive"` | 3×3 | SW tile | World trees, raid objects |

**Type Definition:**

```typescript
// packages/shared/src/types/world/resource-types.ts
export type ResourceFootprint = "standard" | "large" | "massive";

export const FOOTPRINT_SIZES: Record<ResourceFootprint, { x: number; z: number }> = {
  standard: { x: 1, z: 1 },
  large: { x: 2, z: 2 },
  massive: { x: 3, z: 3 },
};
```

---

### Phase B: Auto-Snap Resource Positions

**File:** `packages/shared/src/systems/shared/entities/ResourceSystem.ts`

When spawning resources, snap positions to tile centers:

```typescript
/**
 * Snap a world position to the center of its tile
 * Position (15.3, y, -10.7) → (15.5, y, -10.5)
 */
function snapToTileCenter(position: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  return {
    x: Math.floor(position.x) + 0.5,
    y: position.y,  // Y unchanged (terrain height)
    z: Math.floor(position.z) + 0.5,
  };
}
```

**Spawn Logic Changes:**

```typescript
// In handleTerrainResourcesLoaded or similar:
const snappedPosition = snapToTileCenter(spawnPoint.position);

const resourceConfig = {
  id: resource.id,
  position: snappedPosition,  // Use snapped position
  footprint: resource.footprint || "standard",  // Store footprint
  anchorTile: worldToTile(snappedPosition.x, snappedPosition.z),  // Store anchor tile
  ...
};
```

---

### Phase C: Store Footprint on Resource Entity

**File:** `packages/shared/src/types/world/resource-types.ts` (or similar)

Extend resource entity to include tile information:

```typescript
interface ResourceEntity {
  // Existing fields...

  // NEW: Tile-based positioning
  footprint: ResourceFootprint;
  anchorTile: TileCoord;  // SW corner for multi-tile
  occupiedTiles: TileCoord[];  // All tiles this resource occupies
}
```

**Helper to Calculate Occupied Tiles:**

```typescript
function getOccupiedTiles(anchorTile: TileCoord, footprint: ResourceFootprint): TileCoord[] {
  const size = FOOTPRINT_SIZES[footprint];
  const tiles: TileCoord[] = [];

  for (let dx = 0; dx < size.x; dx++) {
    for (let dz = 0; dz < size.z; dz++) {
      tiles.push({
        x: anchorTile.x + dx,
        z: anchorTile.z + dz,
      });
    }
  }

  return tiles;
}
```

---

### Phase D: Update Face Direction Logic

**File:** `packages/server/src/systems/ServerNetwork/FaceDirectionManager.ts`

When facing a resource, calculate the correct target point:

```typescript
/**
 * Get the face target position for a resource
 * - 1×1: Face the tile center
 * - 2×2+: Face the center of the occupied area
 */
function getResourceFaceTarget(resource: ResourceEntity): { x: number; z: number } {
  const size = FOOTPRINT_SIZES[resource.footprint];

  // Center of the resource's tile area
  return {
    x: resource.anchorTile.x + (size.x / 2),
    z: resource.anchorTile.z + (size.z / 2),
  };
}
```

**Alternative: Face Nearest Edge**

For more OSRS-accurate behavior, face the nearest occupied tile instead of center:

```typescript
function getNearestResourceTile(
  playerTile: TileCoord,
  resource: ResourceEntity
): TileCoord {
  let nearest = resource.occupiedTiles[0];
  let minDist = Infinity;

  for (const tile of resource.occupiedTiles) {
    const dist = Math.abs(tile.x - playerTile.x) + Math.abs(tile.z - playerTile.z);
    if (dist < minDist) {
      minDist = dist;
      nearest = tile;
    }
  }

  return nearest;
}
```

---

### Phase E: Update ResourceSystem Face Target

**File:** `packages/shared/src/systems/shared/entities/ResourceSystem.ts`

Modify `rotatePlayerToFaceResource` to use tile-based positioning:

```typescript
private rotatePlayerToFaceResource(
  playerId: string,
  resource: ResourceEntity,  // Changed: pass whole resource, not just position
): void {
  const faceManager = (this.world as {
    faceDirectionManager?: {
      setFaceTarget: (playerId: string, x: number, z: number) => void;
    };
  }).faceDirectionManager;

  if (faceManager) {
    // Calculate face target based on resource footprint
    const size = FOOTPRINT_SIZES[resource.footprint || "standard"];
    const anchorTile = worldToTile(resource.position.x, resource.position.z);

    // Face the center of the resource's tile area
    const targetX = (anchorTile.x + size.x / 2) * TILE_SIZE;
    const targetZ = (anchorTile.z + size.z / 2) * TILE_SIZE;

    faceManager.setFaceTarget(playerId, targetX, targetZ);
  }
}
```

---

### Phase F: Interaction Adjacent Tile Finding

**File:** `packages/shared/src/systems/shared/movement/TileSystem.ts` (or new file)

Add helper to find valid interaction tiles:

```typescript
/**
 * Get all tiles adjacent to a resource (valid standing positions)
 * For a 2×2 resource, this returns the 12 tiles surrounding it
 */
function getAdjacentInteractionTiles(
  anchorTile: TileCoord,
  footprint: ResourceFootprint
): TileCoord[] {
  const size = FOOTPRINT_SIZES[footprint];
  const adjacent: TileCoord[] = [];

  // North edge
  for (let dx = 0; dx < size.x; dx++) {
    adjacent.push({ x: anchorTile.x + dx, z: anchorTile.z + size.z });
  }

  // South edge
  for (let dx = 0; dx < size.x; dx++) {
    adjacent.push({ x: anchorTile.x + dx, z: anchorTile.z - 1 });
  }

  // East edge
  for (let dz = 0; dz < size.z; dz++) {
    adjacent.push({ x: anchorTile.x + size.x, z: anchorTile.z + dz });
  }

  // West edge
  for (let dz = 0; dz < size.z; dz++) {
    adjacent.push({ x: anchorTile.x - 1, z: anchorTile.z + dz });
  }

  // Corner tiles (diagonal interaction)
  adjacent.push({ x: anchorTile.x - 1, z: anchorTile.z - 1 });  // SW
  adjacent.push({ x: anchorTile.x + size.x, z: anchorTile.z - 1 });  // SE
  adjacent.push({ x: anchorTile.x - 1, z: anchorTile.z + size.z });  // NW
  adjacent.push({ x: anchorTile.x + size.x, z: anchorTile.z + size.z });  // NE

  return adjacent;
}

/**
 * Find the best adjacent tile for a player to stand on
 * Returns the walkable tile nearest to player's current position
 */
function findBestInteractionTile(
  playerTile: TileCoord,
  resource: ResourceEntity,
  isWalkable: (tile: TileCoord) => boolean
): TileCoord | null {
  const adjacent = getAdjacentInteractionTiles(resource.anchorTile, resource.footprint);

  let best: TileCoord | null = null;
  let bestDist = Infinity;

  for (const tile of adjacent) {
    if (!isWalkable(tile)) continue;

    const dist = Math.abs(tile.x - playerTile.x) + Math.abs(tile.z - playerTile.z);
    if (dist < bestDist) {
      bestDist = dist;
      best = tile;
    }
  }

  return best;
}
```

---

## File Changes Summary

| File | Changes |
|------|---------|
| `resources.json` | Add optional `footprint` field |
| `resource-types.ts` | Add `ResourceFootprint` type and `FOOTPRINT_SIZES` |
| `ResourceSystem.ts` | Auto-snap positions, store footprint, update face target logic |
| `TileSystem.ts` | Add `snapToTileCenter`, `getAdjacentInteractionTiles`, `findBestInteractionTile` |
| `FaceDirectionManager.ts` | Update to handle multi-tile resources (optional enhancement) |

---

## Testing Plan

1. **Basic 1×1 Resource**
   - Place tree at `(15, 0, -10)` (not tile-centered)
   - Verify it spawns at `(15.5, y, -9.5)` (tile center)
   - Click tree, verify player walks to adjacent tile
   - Verify player faces the tree (cardinal direction)

2. **Multi-tile 2×2 Resource**
   - Add `"footprint": "large"` to a test tree
   - Verify it occupies 4 tiles
   - Click from different angles, verify player walks to nearest adjacent tile
   - Verify face direction points toward resource center

3. **Edge Cases**
   - Resource at negative coordinates
   - Resource at fractional positions (0.1, 0.9, etc.)
   - Player already standing on adjacent tile

---

## Implementation Order

1. **Phase A**: Add types and constants (15 min)
2. **Phase B**: Auto-snap spawn positions (15 min)
3. **Phase C**: Store footprint on resource entity (15 min)
4. **Phase D-E**: Update face direction logic (20 min)
5. **Phase F**: Adjacent tile finding (20 min)
6. **Testing**: Verify with gameplay testing (15 min)

**Total Estimated Time: ~1.5 hours**

---

## Future Enhancements

1. **Collision Blocking**: Multi-tile resources should block pathfinding through their tiles
2. **Visual Debug**: Show tile grid overlay in dev mode
3. **Editor Tool**: Click-to-place resources with tile snapping in a world editor
