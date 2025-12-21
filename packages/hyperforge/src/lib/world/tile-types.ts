/**
 * Tile-Based World Editor Types
 *
 * Types for the tile-based world editing system in HyperForge.
 * Each tile represents a 1x1 unit in world space.
 */

import type { Position3D } from "@/types/core";

// ============================================================================
// TILE COORDINATES
// ============================================================================

/**
 * 2D tile coordinates (x, z in world space)
 * Y is always calculated based on terrain or set to 0
 */
export interface TileCoord {
  x: number;
  z: number;
}

/**
 * Convert world position to tile coordinates
 */
export function worldToTile(pos: Position3D): TileCoord {
  return {
    x: Math.floor(pos.x),
    z: Math.floor(pos.z),
  };
}

/**
 * Convert tile coordinates to world position (center of tile)
 */
export function tileToWorld(coord: TileCoord, y = 0): Position3D {
  return {
    x: coord.x + 0.5,
    y,
    z: coord.z + 0.5,
  };
}

/**
 * Get a unique key for a tile coordinate
 */
export function tileKey(coord: TileCoord): string {
  return `${coord.x},${coord.z}`;
}

/**
 * Parse a tile key back to coordinates
 */
export function parseTileKey(key: string): TileCoord {
  const [x, z] = key.split(",").map(Number);
  return { x, z };
}

// ============================================================================
// SPAWN CONFIGURATION
// ============================================================================

/**
 * Base spawn configuration for entities placed on tiles
 */
export interface SpawnConfig {
  /** Unique identifier for this spawn */
  id: string;
  /** Type of spawn: mob, npc, resource, or structure */
  type: "mob" | "npc" | "resource" | "structure";
  /** Reference to the entity definition (mobId, npcId, resourceId, or structureId) */
  entityId: string;
  /** Display name (resolved from definition) */
  name: string;
  /** Position within the tile (default center) */
  position: Position3D;
}

/**
 * Mob spawn configuration with radius and count
 */
export interface MobSpawnConfig extends SpawnConfig {
  type: "mob";
  /** Roam radius in tiles (0 = stays on spawn tile) */
  spawnRadius: number;
  /** Maximum number of mobs to spawn */
  maxCount: number;
  /** Respawn time in game ticks (optional) */
  respawnTicks?: number;
}

/**
 * NPC spawn configuration with optional store link
 */
export interface NpcSpawnConfig extends SpawnConfig {
  type: "npc";
  /** NPC role type (bank, shop, quest, etc.) */
  npcType: string;
  /** Store ID if this is a shopkeeper */
  storeId?: string;
}

/**
 * Resource spawn configuration
 */
export interface ResourceSpawnConfig extends SpawnConfig {
  type: "resource";
  /** Resource type (tree, rock, fishing_spot, etc.) */
  resourceType: string;
}

/**
 * Structure spawn configuration for placing buildings
 */
export interface StructureSpawnConfig {
  /** Unique identifier for this spawn */
  id: string;
  /** Type is always "structure" */
  type: "structure";
  /** Reference to the structure definition ID */
  structureId: string;
  /** Display name */
  name: string;
  /** Position of the structure (anchor point) */
  position: Position3D;
  /** Y-axis rotation in degrees */
  rotation: number;
  /** Uniform scale (defaults to 1) */
  scale?: number;
  /** Whether players can enter this structure */
  enterable?: boolean;
}

/**
 * Union type for all spawn configurations
 */
export type TileSpawn =
  | MobSpawnConfig
  | NpcSpawnConfig
  | ResourceSpawnConfig
  | StructureSpawnConfig;

// ============================================================================
// TILE CONTENTS
// ============================================================================

/**
 * Contents of a single tile
 */
export interface TileContents {
  /** Tile coordinates */
  coord: TileCoord;
  /** All spawns on this tile */
  spawns: TileSpawn[];
  /** Whether this tile is walkable */
  walkable: boolean;
  /** Optional terrain type */
  terrain?: string;
  /** Whether this tile is part of a safe zone */
  safeZone?: boolean;
}

/**
 * A single tile with its position and contents
 */
export interface Tile {
  /** Tile coordinates */
  coord: TileCoord;
  /** Contents of this tile */
  contents: TileContents;
  /** Whether this tile is selected in the editor */
  selected?: boolean;
  /** Whether this tile is highlighted (e.g., in roam radius) */
  highlighted?: boolean;
  /** Highlight color for visualization */
  highlightColor?: string;
}

// ============================================================================
// AREA BOUNDS
// ============================================================================

/**
 * Rectangular bounds defining an area
 */
export interface AreaBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/**
 * Calculate the width of an area
 */
export function boundsWidth(bounds: AreaBounds): number {
  return bounds.maxX - bounds.minX;
}

/**
 * Calculate the depth (z-dimension) of an area
 */
export function boundsDepth(bounds: AreaBounds): number {
  return bounds.maxZ - bounds.minZ;
}

/**
 * Calculate the area in tiles
 */
export function boundsArea(bounds: AreaBounds): number {
  return boundsWidth(bounds) * boundsDepth(bounds);
}

/**
 * Check if a tile is within bounds
 */
export function isInBounds(coord: TileCoord, bounds: AreaBounds): boolean {
  return (
    coord.x >= bounds.minX &&
    coord.x < bounds.maxX &&
    coord.z >= bounds.minZ &&
    coord.z < bounds.maxZ
  );
}

/**
 * Get center of bounds
 */
export function boundsCenter(bounds: AreaBounds): TileCoord {
  return {
    x: Math.floor((bounds.minX + bounds.maxX) / 2),
    z: Math.floor((bounds.minZ + bounds.maxZ) / 2),
  };
}

// ============================================================================
// WORLD AREA
// ============================================================================

/**
 * Difficulty level for areas
 */
export type DifficultyLevel = 0 | 1 | 2 | 3;

/**
 * Complete world area definition
 */
export interface WorldAreaDefinition {
  /** Unique area identifier */
  id: string;
  /** Display name */
  name: string;
  /** Area description */
  description: string;
  /** Difficulty level (0 = starter, 1-3 = increasing difficulty) */
  difficultyLevel: DifficultyLevel;
  /** Rectangular bounds of the area */
  bounds: AreaBounds;
  /** Biome type for visual theming */
  biomeType: string;
  /** Whether this is a safe zone (no combat) */
  safeZone: boolean;
  /** All tiles in this area with their contents */
  tiles: Map<string, Tile>;
  /** Summary counts for UI display */
  spawnCounts: {
    mobs: number;
    npcs: number;
    resources: number;
  };
}

/**
 * Area category based on difficulty
 */
export type AreaCategory =
  | "starterTowns"
  | "level1Areas"
  | "level2Areas"
  | "level3Areas";

/**
 * Get the area category for a difficulty level
 */
export function getAreaCategory(level: DifficultyLevel): AreaCategory {
  switch (level) {
    case 0:
      return "starterTowns";
    case 1:
      return "level1Areas";
    case 2:
      return "level2Areas";
    case 3:
      return "level3Areas";
  }
}

// ============================================================================
// EDITOR STATE
// ============================================================================

/**
 * Tools available in the tile editor
 */
export type EditorTool = "select" | "place" | "erase" | "bounds" | "pan";

/**
 * Item being placed (dragged from palette)
 */
export interface PlaceableItem {
  type: "mob" | "npc" | "resource" | "structure";
  entityId: string;
  name: string;
  iconPath?: string;
  modelPath?: string;
  /** Default spawn config for this item */
  defaults?: Partial<TileSpawn>;
}

/**
 * Editor viewport state
 */
export interface ViewportState {
  /** Pan offset in pixels */
  panX: number;
  panZ: number;
  /** Zoom level (1.0 = 100%) */
  zoom: number;
  /** Tile size in pixels at zoom 1.0 */
  tileSize: number;
}

/**
 * Default viewport settings
 */
export const DEFAULT_VIEWPORT: ViewportState = {
  panX: 0,
  panZ: 0,
  zoom: 1.0,
  tileSize: 32,
};

/**
 * Selection state for the editor
 */
export interface SelectionState {
  /** Currently selected tile */
  selectedTile: TileCoord | null;
  /** Currently selected spawn (within selected tile) */
  selectedSpawn: TileSpawn | null;
  /** Multi-selection of tiles */
  selectedTiles: TileCoord[];
  /** Whether we're in multi-select mode */
  multiSelect: boolean;
}

/**
 * Complete editor state
 */
export interface TileEditorState {
  /** Current area being edited */
  currentArea: WorldAreaDefinition | null;
  /** All loaded areas */
  areas: WorldAreaDefinition[];
  /** Current tool */
  tool: EditorTool;
  /** Item being placed */
  placingItem: PlaceableItem | null;
  /** Viewport settings */
  viewport: ViewportState;
  /** Selection state */
  selection: SelectionState;
  /** Whether there are unsaved changes */
  isDirty: boolean;
  /** Whether the editor is loading */
  isLoading: boolean;
}

// ============================================================================
// API REQUEST/RESPONSE TYPES
// ============================================================================

/**
 * Request to update world areas
 */
export interface UpdateWorldAreasRequest {
  areas: WorldAreaDefinition[];
}

/**
 * Response from world areas API
 */
export interface WorldAreasResponse {
  success: boolean;
  starterTowns: Record<string, WorldAreaDefinition>;
  level1Areas: Record<string, WorldAreaDefinition>;
  level2Areas: Record<string, WorldAreaDefinition>;
  level3Areas: Record<string, WorldAreaDefinition>;
}
