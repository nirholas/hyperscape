/**
 * Tile Service
 *
 * Service for managing tiles and spawns in the world editor.
 * Handles CRUD operations for tile contents and area management.
 */

import { logger } from "@/lib/utils";
import type {
  TileCoord,
  Tile,
  TileContents,
  TileSpawn,
  MobSpawnConfig,
  NpcSpawnConfig,
  ResourceSpawnConfig,
  WorldAreaDefinition,
  AreaBounds,
  PlaceableItem,
} from "./tile-types";
import { tileKey, isInBounds, getAreaCategory } from "./tile-types";
import type {
  WorldAreasConfig,
  NpcDefinition,
  ResourceDefinition,
} from "@/lib/game/manifests";

const log = logger.child("TileService");

// ============================================================================
// TILE OPERATIONS
// ============================================================================

/**
 * Get contents of a specific tile
 */
export function getTileContents(
  area: WorldAreaDefinition,
  coord: TileCoord,
): TileContents | null {
  const key = tileKey(coord);
  const tile = area.tiles.get(key);

  if (!tile) {
    // Return empty tile contents if tile doesn't exist but is in bounds
    if (isInBounds(coord, area.bounds)) {
      return {
        coord,
        spawns: [],
        walkable: true,
        safeZone: area.safeZone,
      };
    }
    return null;
  }

  return tile.contents;
}

/**
 * Get a tile or create an empty one if it doesn't exist
 */
export function getOrCreateTile(
  area: WorldAreaDefinition,
  coord: TileCoord,
): Tile {
  const key = tileKey(coord);
  let tile = area.tiles.get(key);

  if (!tile) {
    tile = {
      coord,
      contents: {
        coord,
        spawns: [],
        walkable: true,
        safeZone: area.safeZone,
      },
    };
    area.tiles.set(key, tile);
  }

  return tile;
}

/**
 * Set a spawn on a tile (adds or updates)
 */
export function setTileSpawn(
  area: WorldAreaDefinition,
  coord: TileCoord,
  spawn: TileSpawn,
): WorldAreaDefinition {
  const tile = getOrCreateTile(area, coord);

  // Check if spawn already exists
  const existingIndex = tile.contents.spawns.findIndex(
    (s) => s.id === spawn.id,
  );

  if (existingIndex >= 0) {
    // Update existing spawn
    tile.contents.spawns[existingIndex] = spawn;
  } else {
    // Add new spawn
    tile.contents.spawns.push(spawn);
  }

  // Update spawn counts
  updateSpawnCounts(area);

  log.debug("Set tile spawn", {
    areaId: area.id,
    coord,
    spawnId: spawn.id,
    type: spawn.type,
  });

  return area;
}

/**
 * Remove a spawn from a tile
 */
export function removeTileSpawn(
  area: WorldAreaDefinition,
  coord: TileCoord,
  spawnId: string,
): WorldAreaDefinition {
  const key = tileKey(coord);
  const tile = area.tiles.get(key);

  if (!tile) {
    return area;
  }

  const initialCount = tile.contents.spawns.length;
  tile.contents.spawns = tile.contents.spawns.filter((s) => s.id !== spawnId);

  if (tile.contents.spawns.length < initialCount) {
    // If tile is now empty, we can optionally remove it
    if (tile.contents.spawns.length === 0 && tile.contents.walkable) {
      area.tiles.delete(key);
    }

    // Update spawn counts
    updateSpawnCounts(area);

    log.debug("Removed tile spawn", {
      areaId: area.id,
      coord,
      spawnId,
    });
  }

  return area;
}

/**
 * Get all tiles within a radius of a center tile
 */
export function getTilesInRadius(
  center: TileCoord,
  radius: number,
  bounds?: AreaBounds,
): TileCoord[] {
  const tiles: TileCoord[] = [];
  const radiusSquared = radius * radius;

  for (let dx = -radius; dx <= radius; dx++) {
    for (let dz = -radius; dz <= radius; dz++) {
      // Use circular radius check
      if (dx * dx + dz * dz <= radiusSquared) {
        const coord = { x: center.x + dx, z: center.z + dz };

        // Only include if within bounds (if bounds provided)
        if (!bounds || isInBounds(coord, bounds)) {
          tiles.push(coord);
        }
      }
    }
  }

  return tiles;
}

/**
 * Get all tiles with spawns in an area
 */
export function getTilesWithSpawns(area: WorldAreaDefinition): Tile[] {
  return Array.from(area.tiles.values()).filter(
    (tile) => tile.contents.spawns.length > 0,
  );
}

/**
 * Update the spawn counts for an area
 */
function updateSpawnCounts(area: WorldAreaDefinition): void {
  let mobs = 0;
  let npcs = 0;
  let resources = 0;

  for (const tile of area.tiles.values()) {
    for (const spawn of tile.contents.spawns) {
      switch (spawn.type) {
        case "mob":
          mobs++;
          break;
        case "npc":
          npcs++;
          break;
        case "resource":
          resources++;
          break;
      }
    }
  }

  area.spawnCounts = { mobs, npcs, resources };
}

// ============================================================================
// SPAWN VALIDATION
// ============================================================================

/**
 * Validation result for a spawn
 */
export interface SpawnValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate a mob spawn configuration
 */
export function validateMobSpawn(
  spawn: MobSpawnConfig,
  availableMobs: NpcDefinition[],
): SpawnValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check mob exists
  const mobDef = availableMobs.find((m) => m.id === spawn.entityId);
  if (!mobDef) {
    errors.push(`Mob "${spawn.entityId}" not found in npcs.json`);
  } else if (mobDef.category !== "mob") {
    warnings.push(
      `"${spawn.entityId}" is not a mob (category: ${mobDef.category})`,
    );
  }

  // Validate spawn radius
  if (spawn.spawnRadius < 0) {
    errors.push("Spawn radius cannot be negative");
  } else if (spawn.spawnRadius > 20) {
    warnings.push("Large spawn radius (>20) may cause performance issues");
  }

  // Validate max count
  if (spawn.maxCount < 1) {
    errors.push("Max count must be at least 1");
  } else if (spawn.maxCount > 10) {
    warnings.push("High mob count (>10) may cause crowding");
  }

  // Validate respawn time
  if (spawn.respawnTicks !== undefined && spawn.respawnTicks < 0) {
    errors.push("Respawn time cannot be negative");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate an NPC spawn configuration
 */
export function validateNpcSpawn(
  spawn: NpcSpawnConfig,
  availableNpcs: NpcDefinition[],
): SpawnValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check NPC exists
  const npcDef = availableNpcs.find((n) => n.id === spawn.entityId);
  if (!npcDef) {
    errors.push(`NPC "${spawn.entityId}" not found in npcs.json`);
  }

  // Check store exists if shopkeeper
  if (spawn.npcType === "shop" && !spawn.storeId) {
    warnings.push("Shopkeeper NPC has no store assigned");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate a resource spawn configuration
 */
export function validateResourceSpawn(
  spawn: ResourceSpawnConfig,
  availableResources: ResourceDefinition[],
): SpawnValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check resource exists
  const resourceDef = availableResources.find((r) => r.id === spawn.entityId);
  if (!resourceDef) {
    errors.push(`Resource "${spawn.entityId}" not found in resources.json`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate any spawn configuration
 */
export function validateSpawn(
  spawn: TileSpawn,
  availableMobs: NpcDefinition[],
  availableNpcs: NpcDefinition[],
  availableResources: ResourceDefinition[],
): SpawnValidation {
  switch (spawn.type) {
    case "mob":
      return validateMobSpawn(spawn, availableMobs);
    case "npc":
      return validateNpcSpawn(spawn, availableNpcs);
    case "resource":
      return validateResourceSpawn(spawn, availableResources);
  }
}

// ============================================================================
// AREA OPERATIONS
// ============================================================================

/**
 * Create an empty area
 */
export function createEmptyArea(
  id: string,
  name: string,
  bounds: AreaBounds,
  difficultyLevel: 0 | 1 | 2 | 3 = 0,
): WorldAreaDefinition {
  return {
    id,
    name,
    description: "",
    difficultyLevel,
    bounds,
    biomeType: difficultyLevel === 0 ? "starter_town" : "wilderness",
    safeZone: difficultyLevel === 0,
    tiles: new Map(),
    spawnCounts: { mobs: 0, npcs: 0, resources: 0 },
  };
}

/**
 * Resize area bounds
 */
export function resizeAreaBounds(
  area: WorldAreaDefinition,
  newBounds: AreaBounds,
): WorldAreaDefinition {
  // Remove tiles outside new bounds
  const keysToRemove: string[] = [];

  for (const [key, tile] of area.tiles) {
    if (!isInBounds(tile.coord, newBounds)) {
      keysToRemove.push(key);
    }
  }

  for (const key of keysToRemove) {
    area.tiles.delete(key);
  }

  area.bounds = newBounds;
  updateSpawnCounts(area);

  log.info("Resized area bounds", {
    areaId: area.id,
    oldTileCount: area.tiles.size + keysToRemove.length,
    newTileCount: area.tiles.size,
    removedTiles: keysToRemove.length,
  });

  return area;
}

/**
 * Check if two areas overlap
 */
export function areasOverlap(a: AreaBounds, b: AreaBounds): boolean {
  return !(
    a.maxX <= b.minX ||
    b.maxX <= a.minX ||
    a.maxZ <= b.minZ ||
    b.maxZ <= a.minZ
  );
}

/**
 * Validate area bounds don't overlap with existing areas
 */
export function validateAreaBounds(
  bounds: AreaBounds,
  existingAreas: WorldAreaDefinition[],
  excludeAreaId?: string,
): { valid: boolean; overlappingAreas: string[] } {
  const overlapping: string[] = [];

  for (const area of existingAreas) {
    if (area.id === excludeAreaId) continue;
    if (areasOverlap(bounds, area.bounds)) {
      overlapping.push(area.id);
    }
  }

  return {
    valid: overlapping.length === 0,
    overlappingAreas: overlapping,
  };
}

// ============================================================================
// CONVERSION FUNCTIONS
// ============================================================================

/**
 * Convert world-areas.json format to editor format
 */
export function convertWorldAreasToEditor(
  config: WorldAreasConfig,
): WorldAreaDefinition[] {
  const areas: WorldAreaDefinition[] = [];

  const categoryConfigs = [
    { category: "starterTowns" as const, data: config.starterTowns },
    { category: "level1Areas" as const, data: config.level1Areas },
    { category: "level2Areas" as const, data: config.level2Areas },
    { category: "level3Areas" as const, data: config.level3Areas },
  ];

  for (const { data } of categoryConfigs) {
    if (!data) continue;

    for (const rawArea of Object.values(data)) {
      const tiles = new Map<string, Tile>();
      let mobCount = 0;
      let npcCount = 0;
      let resourceCount = 0;

      // Convert NPCs to spawns
      if (rawArea.npcs) {
        for (const npc of rawArea.npcs) {
          const coord = {
            x: Math.floor(npc.position.x),
            z: Math.floor(npc.position.z),
          };
          const tile = tiles.get(tileKey(coord)) || {
            coord,
            contents: {
              coord,
              spawns: [],
              walkable: true,
              safeZone: rawArea.safeZone,
            },
          };

          const spawn: NpcSpawnConfig = {
            id: `npc_${npc.id}_${coord.x}_${coord.z}`,
            type: "npc",
            entityId: npc.id,
            name: npc.id,
            position: npc.position,
            npcType: npc.type,
            ...(npc.storeId ? { storeId: npc.storeId } : {}),
          };

          tile.contents.spawns.push(spawn);
          tiles.set(tileKey(coord), tile);
          npcCount++;
        }
      }

      // Convert resources to spawns
      if (rawArea.resources) {
        for (const resource of rawArea.resources) {
          const coord = {
            x: Math.floor(resource.position.x),
            z: Math.floor(resource.position.z),
          };
          const tile = tiles.get(tileKey(coord)) || {
            coord,
            contents: {
              coord,
              spawns: [],
              walkable: true,
              safeZone: rawArea.safeZone,
            },
          };

          const spawn: ResourceSpawnConfig = {
            id: `resource_${resource.resourceId}_${coord.x}_${coord.z}`,
            type: "resource",
            entityId: resource.resourceId,
            name: resource.resourceId,
            position: resource.position,
            resourceType: resource.type,
          };

          tile.contents.spawns.push(spawn);
          tiles.set(tileKey(coord), tile);
          resourceCount++;
        }
      }

      // Convert mob spawns to spawns
      if (rawArea.mobSpawns) {
        for (const mob of rawArea.mobSpawns) {
          const coord = {
            x: Math.floor(mob.position.x),
            z: Math.floor(mob.position.z),
          };
          const tile = tiles.get(tileKey(coord)) || {
            coord,
            contents: {
              coord,
              spawns: [],
              walkable: true,
              safeZone: rawArea.safeZone,
            },
          };

          const spawn: MobSpawnConfig = {
            id: `mob_${mob.mobId}_${coord.x}_${coord.z}`,
            type: "mob",
            entityId: mob.mobId,
            name: mob.mobId,
            position: mob.position,
            spawnRadius: mob.spawnRadius,
            maxCount: mob.maxCount,
          };

          tile.contents.spawns.push(spawn);
          tiles.set(tileKey(coord), tile);
          mobCount++;
        }
      }

      // Convert terrain tiles (lakes, roads, etc.)
      if (rawArea.terrain && rawArea.terrain.length > 0) {
        log.debug("Processing terrain tiles", {
          areaId: rawArea.id,
          terrainCount: rawArea.terrain.length,
          firstTerrain: rawArea.terrain[0],
        });

        for (const terrainTile of rawArea.terrain) {
          const coord = { x: terrainTile.x, z: terrainTile.z };
          const key = tileKey(coord);
          const tile = tiles.get(key) || {
            coord,
            contents: {
              coord,
              spawns: [],
              walkable:
                terrainTile.walkable ??
                (terrainTile.type !== "water" && terrainTile.type !== "lake"),
              safeZone: rawArea.safeZone,
            },
          };

          tile.contents.terrain = terrainTile.type;
          tile.contents.walkable =
            terrainTile.walkable ??
            (terrainTile.type !== "water" && terrainTile.type !== "lake");
          tiles.set(key, tile);
        }
      }

      log.info("Converted area to editor format", {
        areaId: rawArea.id,
        tileCount: tiles.size,
        mobCount,
        npcCount,
        resourceCount,
        terrainTiles: rawArea.terrain?.length || 0,
        bounds: rawArea.bounds,
      });

      areas.push({
        id: rawArea.id,
        name: rawArea.name,
        description: rawArea.description,
        difficultyLevel: rawArea.difficultyLevel as 0 | 1 | 2 | 3,
        bounds: rawArea.bounds,
        biomeType: rawArea.biomeType,
        safeZone: rawArea.safeZone,
        tiles,
        spawnCounts: {
          mobs: mobCount,
          npcs: npcCount,
          resources: resourceCount,
        },
      });
    }
  }

  log.info("Converted world areas to editor format", {
    totalAreas: areas.length,
    areasWithTiles: areas.filter((a) => a.tiles.size > 0).length,
  });

  return areas;
}

/**
 * Convert editor format back to world-areas.json format
 */
export function convertEditorToWorldAreas(
  areas: WorldAreaDefinition[],
): WorldAreasConfig {
  const config: WorldAreasConfig = {
    starterTowns: {},
    level1Areas: {},
    level2Areas: {},
    level3Areas: {},
  };

  for (const area of areas) {
    const category = getAreaCategory(area.difficultyLevel);
    const npcs: Array<{
      id: string;
      type: string;
      storeId?: string;
      position: { x: number; y: number; z: number };
    }> = [];
    const resources: Array<{
      type: string;
      resourceId: string;
      position: { x: number; y: number; z: number };
    }> = [];
    const mobSpawns: Array<{
      mobId: string;
      position: { x: number; y: number; z: number };
      spawnRadius: number;
      maxCount: number;
    }> = [];

    // Terrain tiles array
    const terrain: Array<{
      x: number;
      z: number;
      type: string;
      walkable?: boolean;
    }> = [];

    // Convert tiles back to spawn arrays and terrain
    for (const tile of area.tiles.values()) {
      // Convert spawns
      for (const spawn of tile.contents.spawns) {
        switch (spawn.type) {
          case "npc": {
            const npcSpawn = spawn as NpcSpawnConfig;
            npcs.push({
              id: npcSpawn.entityId,
              type: npcSpawn.npcType,
              ...(npcSpawn.storeId ? { storeId: npcSpawn.storeId } : {}),
              position: npcSpawn.position,
            });
            break;
          }
          case "resource": {
            const resourceSpawn = spawn as ResourceSpawnConfig;
            resources.push({
              type: resourceSpawn.resourceType,
              resourceId: resourceSpawn.entityId,
              position: resourceSpawn.position,
            });
            break;
          }
          case "mob": {
            const mobSpawn = spawn as MobSpawnConfig;
            mobSpawns.push({
              mobId: mobSpawn.entityId,
              position: mobSpawn.position,
              spawnRadius: mobSpawn.spawnRadius,
              maxCount: mobSpawn.maxCount,
            });
            break;
          }
        }
      }

      // Convert terrain
      if (tile.contents.terrain) {
        terrain.push({
          x: tile.coord.x,
          z: tile.coord.z,
          type: tile.contents.terrain,
          walkable: tile.contents.walkable,
        });
      }
    }

    config[category][area.id] = {
      id: area.id,
      name: area.name,
      description: area.description,
      difficultyLevel: area.difficultyLevel,
      bounds: area.bounds,
      biomeType: area.biomeType,
      safeZone: area.safeZone,
      npcs,
      resources,
      mobSpawns,
      ...(terrain.length > 0 ? { terrain } : {}),
    };
  }

  return config;
}

// ============================================================================
// SPAWN CREATION HELPERS
// ============================================================================

/**
 * Create a new spawn ID
 */
function generateSpawnId(
  type: string,
  entityId: string,
  coord: TileCoord,
): string {
  const timestamp = Date.now().toString(36).slice(-4);
  return `${type}_${entityId}_${coord.x}_${coord.z}_${timestamp}`;
}

/**
 * Create a mob spawn from a placeable item
 */
export function createMobSpawn(
  item: PlaceableItem,
  coord: TileCoord,
): MobSpawnConfig {
  const defaults = item.defaults as MobSpawnConfig | undefined;
  const respawnTicks = defaults?.respawnTicks;

  return {
    id: generateSpawnId("mob", item.entityId, coord),
    type: "mob",
    entityId: item.entityId,
    name: item.name,
    position: { x: coord.x + 0.5, y: 0, z: coord.z + 0.5 },
    spawnRadius: defaults?.spawnRadius ?? 3,
    maxCount: defaults?.maxCount ?? 1,
    ...(respawnTicks !== undefined ? { respawnTicks } : {}),
  };
}

/**
 * Create an NPC spawn from a placeable item
 */
export function createNpcSpawn(
  item: PlaceableItem,
  coord: TileCoord,
): NpcSpawnConfig {
  const defaults = item.defaults as NpcSpawnConfig | undefined;
  const storeId = defaults?.storeId;

  return {
    id: generateSpawnId("npc", item.entityId, coord),
    type: "npc",
    entityId: item.entityId,
    name: item.name,
    position: { x: coord.x + 0.5, y: 0, z: coord.z + 0.5 },
    npcType: defaults?.npcType ?? "neutral",
    ...(storeId ? { storeId } : {}),
  };
}

/**
 * Create a resource spawn from a placeable item
 */
export function createResourceSpawn(
  item: PlaceableItem,
  coord: TileCoord,
): ResourceSpawnConfig {
  return {
    id: generateSpawnId("resource", item.entityId, coord),
    type: "resource",
    entityId: item.entityId,
    name: item.name,
    position: { x: coord.x + 0.5, y: 0, z: coord.z + 0.5 },
    resourceType:
      (item.defaults as ResourceSpawnConfig)?.resourceType ?? "generic",
  };
}

/**
 * Create a spawn from a placeable item based on its type
 */
export function createSpawnFromItem(
  item: PlaceableItem,
  coord: TileCoord,
): TileSpawn {
  switch (item.type) {
    case "mob":
      return createMobSpawn(item, coord);
    case "npc":
      return createNpcSpawn(item, coord);
    case "resource":
      return createResourceSpawn(item, coord);
  }
}

// ============================================================================
// ADDITIONAL TILE OPERATIONS
// ============================================================================

/**
 * Get tile at a specific world position
 * Uses floor to convert world coordinates to tile coordinates
 */
export function getTileAtPosition(
  area: WorldAreaDefinition,
  x: number,
  z: number,
): Tile | null {
  const coord = { x: Math.floor(x), z: Math.floor(z) };

  if (!isInBounds(coord, area.bounds)) {
    return null;
  }

  const key = tileKey(coord);
  const existingTile = area.tiles.get(key);

  if (existingTile) {
    return existingTile;
  }

  // Return an empty virtual tile (not stored in map)
  return {
    coord,
    contents: {
      coord,
      spawns: [],
      walkable: true,
      safeZone: area.safeZone,
    },
  };
}

/**
 * Set multiple spawns on a tile at once (batch update)
 * Replaces all existing spawns on the tile
 */
export function setTileSpawns(
  area: WorldAreaDefinition,
  coord: TileCoord,
  spawns: TileSpawn[],
): WorldAreaDefinition {
  const tile = getOrCreateTile(area, coord);

  // Replace all spawns
  tile.contents.spawns = [...spawns];

  // If no spawns and tile is walkable, optionally remove it
  if (spawns.length === 0 && tile.contents.walkable && !tile.contents.terrain) {
    area.tiles.delete(tileKey(coord));
  }

  // Update spawn counts
  updateSpawnCounts(area);

  log.debug("Set tile spawns (batch)", {
    areaId: area.id,
    coord,
    spawnCount: spawns.length,
  });

  return area;
}

/**
 * Clear all spawns from a tile
 */
export function clearTile(
  area: WorldAreaDefinition,
  coord: TileCoord,
): WorldAreaDefinition {
  const key = tileKey(coord);
  const tile = area.tiles.get(key);

  if (!tile) {
    return area;
  }

  const hadSpawns = tile.contents.spawns.length > 0;
  tile.contents.spawns = [];

  // If tile has no special properties, remove it entirely
  if (tile.contents.walkable && !tile.contents.terrain) {
    area.tiles.delete(key);
  }

  if (hadSpawns) {
    updateSpawnCounts(area);
    log.debug("Cleared tile", { areaId: area.id, coord });
  }

  return area;
}

/**
 * Move a spawn from one tile to another (for drag operations)
 */
export function moveTileSpawn(
  area: WorldAreaDefinition,
  spawnId: string,
  fromCoord: TileCoord,
  toCoord: TileCoord,
): WorldAreaDefinition {
  const fromKey = tileKey(fromCoord);
  const fromTile = area.tiles.get(fromKey);

  if (!fromTile) {
    log.warn("Cannot move spawn: source tile not found", {
      fromCoord,
      spawnId,
    });
    return area;
  }

  // Find the spawn
  const spawnIndex = fromTile.contents.spawns.findIndex(
    (s) => s.id === spawnId,
  );
  if (spawnIndex === -1) {
    log.warn("Cannot move spawn: spawn not found", { fromCoord, spawnId });
    return area;
  }

  // Get the spawn before removing (we know it exists from index check)
  const spawn = fromTile.contents.spawns[spawnIndex]!;

  // Remove from source tile
  fromTile.contents.spawns.splice(spawnIndex, 1);

  // Update spawn position to center of new tile
  const updatedSpawn: TileSpawn = {
    ...spawn,
    position: { x: toCoord.x + 0.5, y: spawn.position.y, z: toCoord.z + 0.5 },
  } as TileSpawn;

  // Add to destination tile
  const toTile = getOrCreateTile(area, toCoord);
  toTile.contents.spawns.push(updatedSpawn);

  // Clean up empty source tile
  if (fromTile.contents.spawns.length === 0 && fromTile.contents.walkable) {
    area.tiles.delete(fromKey);
  }

  log.debug("Moved tile spawn", {
    areaId: area.id,
    spawnId,
    from: fromCoord,
    to: toCoord,
  });

  return area;
}

/**
 * Update a spawn's properties in place
 */
export function updateSpawn(
  area: WorldAreaDefinition,
  coord: TileCoord,
  spawnId: string,
  updates: Partial<TileSpawn>,
): WorldAreaDefinition {
  const key = tileKey(coord);
  const tile = area.tiles.get(key);

  if (!tile) {
    return area;
  }

  const spawnIndex = tile.contents.spawns.findIndex((s) => s.id === spawnId);
  if (spawnIndex === -1) {
    return area;
  }

  // Merge updates into spawn (preserving type-specific properties)
  const currentSpawn = tile.contents.spawns[spawnIndex];
  tile.contents.spawns[spawnIndex] = {
    ...currentSpawn,
    ...updates,
  } as TileSpawn;

  log.debug("Updated spawn", { areaId: area.id, coord, spawnId, updates });

  return area;
}

/**
 * Set tile properties (walkable, safeZone, terrain)
 */
export function setTileProperties(
  area: WorldAreaDefinition,
  coord: TileCoord,
  properties: {
    walkable?: boolean;
    safeZone?: boolean;
    terrain?: string;
  },
): WorldAreaDefinition {
  const tile = getOrCreateTile(area, coord);

  if (properties.walkable !== undefined) {
    tile.contents.walkable = properties.walkable;
  }
  if (properties.safeZone !== undefined) {
    tile.contents.safeZone = properties.safeZone;
  }
  if (properties.terrain !== undefined) {
    tile.contents.terrain = properties.terrain;
  }

  log.debug("Set tile properties", { areaId: area.id, coord, properties });

  return area;
}

/**
 * Get all spawns of a specific type in an area
 */
export function getSpawnsByType(
  area: WorldAreaDefinition,
  type: "mob" | "npc" | "resource",
): Array<{ coord: TileCoord; spawn: TileSpawn }> {
  const results: Array<{ coord: TileCoord; spawn: TileSpawn }> = [];

  for (const tile of area.tiles.values()) {
    for (const spawn of tile.contents.spawns) {
      if (spawn.type === type) {
        results.push({ coord: tile.coord, spawn });
      }
    }
  }

  return results;
}

/**
 * Find spawn by ID across all tiles
 */
export function findSpawnById(
  area: WorldAreaDefinition,
  spawnId: string,
): { coord: TileCoord; spawn: TileSpawn } | null {
  for (const tile of area.tiles.values()) {
    const spawn = tile.contents.spawns.find((s) => s.id === spawnId);
    if (spawn) {
      return { coord: tile.coord, spawn };
    }
  }
  return null;
}

/**
 * Duplicate a spawn (creates a new spawn with unique ID)
 */
export function duplicateSpawn(
  area: WorldAreaDefinition,
  sourceCoord: TileCoord,
  spawnId: string,
  targetCoord: TileCoord,
): { area: WorldAreaDefinition; newSpawnId: string } | null {
  const sourceTile = area.tiles.get(tileKey(sourceCoord));
  if (!sourceTile) {
    return null;
  }

  const sourceSpawn = sourceTile.contents.spawns.find((s) => s.id === spawnId);
  if (!sourceSpawn) {
    return null;
  }

  // Create new spawn with unique ID
  const timestamp = Date.now().toString(36).slice(-4);
  const newSpawnId = `${sourceSpawn.type}_${sourceSpawn.entityId}_${targetCoord.x}_${targetCoord.z}_${timestamp}`;

  const newSpawn: TileSpawn = {
    ...sourceSpawn,
    id: newSpawnId,
    position: {
      x: targetCoord.x + 0.5,
      y: sourceSpawn.position.y,
      z: targetCoord.z + 0.5,
    },
  };

  setTileSpawn(area, targetCoord, newSpawn);

  log.debug("Duplicated spawn", {
    areaId: area.id,
    from: sourceCoord,
    to: targetCoord,
    originalId: spawnId,
    newId: newSpawnId,
  });

  return { area, newSpawnId };
}
