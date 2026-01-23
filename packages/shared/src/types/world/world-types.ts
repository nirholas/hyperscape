/**
 * World Types
 * All world-related type definitions including world generation, zones, biomes, areas, and chunks
 */

import THREE from "../../extras/three/three";
import type { Position3D } from "../core/base-types";

// Temporary imports from core.ts - will be updated when those modules are created
import type { MobData } from "../core/core";
import type { InventoryItem } from "../core/core";

// ============== BASIC WORLD STRUCTURES ==============

/**
 * World position - basic position type for world coordinates
 */
export interface WorldPosition {
  x: number;
  y: number;
  z: number;
}

/**
 * Town data structure
 * Represents a safe zone town with services
 */
export interface Town {
  id: string;
  name: string;
  position: { x: number; y: number; z: number };
  safeZoneRadius: number;
  hasBank: boolean;
  hasStore: boolean;
  isRespawnPoint: boolean;
}

// ============== WORLD INITIALIZATION ==============

/**
 * World initialization configuration interface
 * Used to configure terrain, biomes, and structures when creating a new world
 */
export interface WorldInitConfig {
  seed?: number;
  config?: {
    terrain?: Record<
      string,
      {
        enabled?: boolean;
        scale?: number;
        octaves?: number;
        persistence?: number;
        lacunarity?: number;
        amplitude?: number;
        [key: string]: unknown;
      }
    >;
    biomes?: Record<
      string,
      {
        enabled?: boolean;
        temperature?: number;
        humidity?: number;
        elevation?: number;
        resources?: string[];
        [key: string]: unknown;
      }
    >;
    structures?: Record<
      string,
      {
        enabled?: boolean;
        frequency?: number;
        minDistance?: number;
        maxDistance?: number;
        [key: string]: unknown;
      }
    >;
  };
}

// ============== VEGETATION SYSTEM TYPES ==============
// (Defined before BiomeData since BiomeData references these types)

/**
 * Vegetation category type - defines the type of vegetation
 */
export type VegetationCategory =
  | "tree"
  | "bush"
  | "grass"
  | "flower"
  | "fern"
  | "rock"
  | "fallen_tree";

/**
 * Single vegetation asset model definition
 * Each asset represents a GLB model that can be instanced
 */
export interface VegetationAsset {
  /** Unique identifier for this asset */
  id: string;
  /** Path to the GLB model file (relative to assets folder) */
  model: string;
  /** Category of vegetation this asset belongs to */
  category: VegetationCategory;
  /** Base scale of the model (1.0 = original size) */
  baseScale: number;
  /** Random scale variation range [min, max] applied as multiplier */
  scaleVariation: [number, number];
  /** Whether the asset can have random Y-axis rotation */
  randomRotation: boolean;
  /** Probability weight for this asset when selecting from category (higher = more common) */
  weight: number;
  /** Minimum slope this can be placed on (0-1, 0 = flat only) */
  minSlope?: number;
  /** Maximum slope this can be placed on (0-1, 1 = any slope) */
  maxSlope?: number;
  /** Whether to align to terrain normal (tilt with ground) */
  alignToNormal?: boolean;
  /** Y offset to apply after placement (for buried objects, etc.) */
  yOffset?: number;
}

/**
 * Vegetation layer configuration for a biome
 * Each layer defines how a category of vegetation is distributed
 */
export interface VegetationLayer {
  /** Category of vegetation for this layer */
  category: VegetationCategory;
  /** Density of instances per 100x100m tile (approximate) */
  density: number;
  /** Asset IDs to use for this layer (references VegetationAsset.id) */
  assets: string[];
  /** Minimum distance between instances of this category */
  minSpacing: number;
  /** Whether to cluster instances (creates natural groupings) */
  clustering?: boolean;
  /** Cluster size if clustering is enabled */
  clusterSize?: number;
  /** Noise scale for distribution (higher = larger patterns) */
  noiseScale?: number;
  /** Noise threshold (0-1, instances only placed where noise > threshold) */
  noiseThreshold?: number;
  /** Minimum height this layer spawns at */
  minHeight?: number;
  /** Maximum height this layer spawns at */
  maxHeight?: number;
  /** Whether to avoid water areas */
  avoidWater?: boolean;
  /** Whether to avoid steep slopes */
  avoidSteepSlopes?: boolean;
}

/**
 * Complete vegetation configuration for a biome
 * Defines all vegetation layers and their assets for procedural placement
 */
export interface BiomeVegetationConfig {
  /** Whether vegetation is enabled for this biome */
  enabled: boolean;
  /** All vegetation layers for this biome */
  layers: VegetationLayer[];
}

// ============== BIOME TYPES ==============

/**
 * Biome data - defines characteristics of a biome type
 */
export interface BiomeData {
  id: string;
  name: string;
  description: string;
  difficultyLevel: 0 | 1 | 2 | 3; // 0 = safe zones, 1-3 = mob levels
  terrain:
    | "forest"
    | "wastes"
    | "plains"
    | "frozen"
    | "corrupted"
    | "lake"
    | "mountain"
    | "mountains"
    | "desert"
    | "swamp";
  resources: string[]; // Available resource types
  mobs: string[]; // Mob types that spawn here
  fogIntensity: number; // 0-1 for visual atmosphere
  ambientSound: string;
  colorScheme: {
    primary: string;
    secondary: string;
    fog: string;
  };
  color: number; // Hex color for terrain rendering
  heightRange: [number, number]; // Min and max height multipliers
  terrainMultiplier: number; // Terrain height multiplier
  waterLevel: number; // Water level threshold
  maxSlope: number; // Maximum walkable slope
  mobTypes: string[]; // Mob types that spawn here
  difficulty: number; // Difficulty level (0-3)
  baseHeight: number; // Base terrain height
  heightVariation: number; // Height variation factor
  resourceDensity: number; // Resource spawn density
  resourceTypes: string[]; // Types of resources that can spawn
  /** Vegetation configuration for procedural placement (optional) */
  vegetation?: BiomeVegetationConfig;
}

/**
 * Biome resource - resource spawn location in a biome
 */
export interface BiomeResource {
  type: "tree" | "fishing_spot" | "mine" | "herb_patch";
  position: WorldPosition;
  resourceId: string;
  respawnTime: number;
  level: number; // Required level to harvest
}

// ============== NPC AND MOB LOCATIONS ==============

/**
 * NPC location - where NPCs spawn in the world
 * Only id, type, and position are required - all other data comes from npcs.json manifest
 */
export interface NPCLocation {
  id: string; // Must match ID in npcs.json
  type: "bank" | "general_store" | "skill_trainer" | "quest_giver";
  position: WorldPosition;
  // The following are optional - data should come from npcs.json manifest
  name?: string;
  services?: string[];
  modelPath?: string;
  description?: string;
  storeId?: string; // Links NPC to store in stores.json (for general_store type)
}

/**
 * Mob spawn point - where mobs spawn in the world
 */
export interface MobSpawnPoint {
  mobId: string;
  position: WorldPosition;
  spawnRadius: number;
  maxCount: number;
  respawnTime: number;
}

/**
 * Station placement in a world area
 * Position only - full data comes from stations.json manifest
 */
export interface StationLocation {
  /** Unique instance ID for this station */
  id: string;
  /** Station type - must match type in stations.json (anvil, furnace, range, bank, altar) */
  type: "bank" | "furnace" | "anvil" | "altar" | "range";
  /** World position (Y will be grounded to terrain) */
  position: WorldPosition;
  /** Optional rotation in degrees (Y-axis only, default: 0) */
  rotation?: number;
  /** Optional: override bankId for bank stations (default: "spawn_bank") */
  bankId?: string;
}

// ============== WORLD AREAS ==============

/**
 * World area - a region of the world with specific characteristics
 */
export interface WorldArea {
  id: string;
  name: string;
  description: string;
  difficultyLevel: 0 | 1 | 2 | 3; // 0 = safe zone, 1-3 = combat zones
  bounds: {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
  };
  biomeType: string;
  safeZone: boolean;
  /** PvP enabled - players can attack each other in this zone */
  pvpEnabled?: boolean;
  npcs: NPCLocation[];
  resources: BiomeResource[];
  mobSpawns: MobSpawnPoint[];
  /**
   * Dynamic fishing spot configuration.
   * When enabled, fishing spots are spawned at detected shore positions
   * instead of using static coordinates from resources array.
   */
  fishing?: {
    /** Enable dynamic fishing spot spawning for this area */
    enabled: boolean;
    /** Number of fishing spots to spawn in this area */
    spotCount: number;
    /** Resource IDs to spawn (e.g., "fishing_spot_net", "fishing_spot_bait") */
    spotTypes: string[];
  };
  /** Station placements for this area (furnaces, anvils, banks, altars, ranges) */
  stations?: StationLocation[];
}

// ============== ZONE SPAWN POINTS ==============

/**
 * Player spawn point data
 */
export interface PlayerSpawnPointData {
  isMainSpawn: boolean;
}

/**
 * Resource spawn point data
 */
export interface ResourceSpawnPointData {
  type: string; // Can be 'bank', 'general_store', 'tree', 'trees', 'fishing_spot', 'mine', etc.
  name: string;
  resourceId: string;
  respawnTime: number;
}

/**
 * Mob spawn point data
 */
export interface MobSpawnPointData {
  type: string; // Can be mob type like 'goblin', 'bandit', etc.
  mobId: string;
  spawnRadius: number;
  maxCount: number;
  respawnTime: number;
}

/**
 * Zone spawn point data - union type for all spawn point types
 */
export type ZoneSpawnPointData =
  | PlayerSpawnPointData
  | ResourceSpawnPointData
  | MobSpawnPointData;

/**
 * Zone spawn point - a spawn point in a zone
 */
export interface ZoneSpawnPoint {
  type: "player" | "mob" | "resource";
  position: Position3D;
  data: PlayerSpawnPointData | ResourceSpawnPointData | MobSpawnPointData;
}

// ============== ZONE DATA ==============

/**
 * Zone data - a defined area in the world with spawn points
 */
export interface ZoneData {
  id: string;
  name: string;
  biome: string;
  bounds: {
    x: number;
    z: number;
    width: number;
    height: number;
  };
  difficultyLevel: 0 | 1 | 2 | 3;
  isTown: boolean;
  hasBank: boolean;
  hasGeneralStore: boolean;
  spawnPoints: ZoneSpawnPoint[];
}

// ============== WORLD CONTENT ENTITIES ==============

/**
 * NPC entity - runtime instance of an NPC in the world
 */
export interface NPCEntity {
  id: string;
  npc: NPCLocation;
  mesh: THREE.Object3D;
  area: WorldArea;
}

/**
 * Resource entity - runtime instance of a resource in the world
 */
export interface ResourceEntity {
  id: string;
  resource: BiomeResource;
  mesh?: THREE.Object3D;
  instanceId?: number;
  meshType?: string;
  area: WorldArea;
  respawnTime: number;
  isActive: boolean;
}

/**
 * Mob entity - runtime instance of a mob in the world
 */
export interface MobEntity {
  id: string;
  mobData: MobData;
  mesh?: THREE.Object3D;
  instanceId?: number;
  meshType?: string;
  area: WorldArea;
  spawnPoint: MobSpawnPoint;
  currentHealth: number;
  lastRespawn: number;
  isAlive: boolean;
  homePosition: { x: number; y: number; z: number };
}

// ============== RESOURCE TYPES ==============

/**
 * Resource node data interface for world systems
 */
export interface ResourceNodeData {
  type: "tree" | "fishing_spot" | "ore_vein";
  position: Position3D;
  resourceType: string;
  id: string;
}

/**
 * Type for THREE.Mesh with properly typed userData for resources
 */
export interface ResourceMesh extends THREE.Mesh {
  userData: {
    entityId: string;
    type: "mob" | "npc" | "resource" | "item" | "player" | "static";
    name: string;
    interactable: boolean;
    mobData: {
      id: string;
      name: string;
      type: string;
      level: number;
      health: number;
      maxHealth: number;
    } | null;
    entityType: string;
    resourceType: string;
  };
}

// ============== WORLD CHUNKS ==============

/**
 * World chunk - a section of the world with runtime state
 */
export interface WorldChunk {
  id: string;
  chunkX: number;
  chunkZ: number;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  area: WorldArea;

  // Runtime state
  npcs: NPCEntity[];
  resources: ResourceEntity[];
  mobs: MobEntity[];
  terrainMesh?: THREE.Object3D;
  isLoaded: boolean;

  // Persistent state
  data: Record<string, unknown>;
  lastActivity: Date;
  playerCount: number;
  needsReset: boolean;

  // Chunk properties
  biome: string;
  heightData: number[];
  resourceStates: Record<string, boolean>;
  mobSpawnStates: Record<string, MobSpawnPoint>;
  playerModifications: Record<string, unknown>;
  chunkSeed: number;
  lastActiveTime: Date;
}

// ============== SPECIAL LOCATIONS ==============

/**
 * Death location data - where a player died and their items dropped
 */
export interface DeathLocationData {
  playerId: string;
  deathPosition: { x: number; y: number; z: number };
  timestamp: number;
  items: InventoryItem[]; // Items dropped at death location (headstone)
}

/**
 * Treasure location - treasure chest spawn locations
 */
export interface TreasureLocation {
  id: string;
  position: { x: number; y: number; z: number };
  difficulty: 1 | 2 | 3;
  areaId: string;
  description: string;
  respawnTime: number; // milliseconds
  maxItems: number;
}

// ============== VEGETATION RUNTIME TYPES ==============

/**
 * Runtime vegetation instance data
 * Used by VegetationSystem to track placed instances
 */
export interface VegetationInstance {
  /** Unique instance ID */
  id: string;
  /** Asset ID this instance uses */
  assetId: string;
  /** Category of vegetation */
  category: VegetationCategory;
  /** World position */
  position: { x: number; y: number; z: number };
  /** Rotation (Euler angles in radians) */
  rotation: { x: number; y: number; z: number };
  /** Scale multiplier */
  scale: number;
  /** Tile key this instance belongs to */
  tileKey: string;
  /** Matrix index in the InstancedMesh (runtime only) */
  matrixIndex?: number;
}

/**
 * Vegetation tile data for persistence
 * Stores vegetation state for a terrain tile
 */
export interface VegetationTileData {
  /** Tile key (format: "tileX_tileZ") */
  tileKey: string;
  /** Biome this tile belongs to */
  biome: string;
  /** All vegetation instances in this tile */
  instances: VegetationInstance[];
  /** Timestamp when this tile was generated */
  generatedAt: number;
  /** Seed used for procedural generation */
  seed: number;
}

// ============== PROCEDURAL TOWN TYPES ==============

/**
 * Town size category determines building count and services
 */
export type TownSize = "hamlet" | "village" | "town";

/**
 * Building types available in towns
 */
export type TownBuildingType = "bank" | "store" | "anvil" | "house" | "well";

/**
 * A building placed within a town
 */
export interface TownBuilding {
  /** Unique building ID */
  id: string;
  /** Type of building */
  type: TownBuildingType;
  /** World position of building center */
  position: { x: number; y: number; z: number };
  /** Y-axis rotation in radians */
  rotation: number;
  /** Building footprint size */
  size: { width: number; depth: number };
}

/**
 * Procedurally generated town data
 * Towns are safe zones with buildings and services
 */
export interface ProceduralTown {
  /** Unique town ID */
  id: string;
  /** Town name (generated from seed) */
  name: string;
  /** World position of town center */
  position: { x: number; y: number; z: number };
  /** Town size category */
  size: TownSize;
  /** Safe zone radius in meters */
  safeZoneRadius: number;
  /** Biome the town is located in */
  biome: string;
  /** Buildings placed in this town */
  buildings: TownBuilding[];
  /** Suitability score used for placement (higher = better location) */
  suitabilityScore: number;
  /** Connected road IDs */
  connectedRoads: string[];
}

// ============== PROCEDURAL ROAD TYPES ==============

/**
 * A single point along a road path
 */
export interface RoadPathPoint {
  /** World X coordinate */
  x: number;
  /** World Z coordinate */
  z: number;
  /** Terrain height at this point (computed) */
  y: number;
}

/**
 * Road material type affects visual appearance
 */
export type RoadMaterial = "dirt" | "cobblestone" | "stone";

/**
 * A road connection between two towns
 */
export interface ProceduralRoad {
  /** Unique road ID */
  id: string;
  /** Source town ID */
  fromTownId: string;
  /** Destination town ID */
  toTownId: string;
  /** Path points from source to destination */
  path: RoadPathPoint[];
  /** Road width in meters */
  width: number;
  /** Road material for visual rendering */
  material: RoadMaterial;
  /** Total road length in meters */
  length: number;
}

/**
 * A road segment within a single terrain tile
 * Used for efficient spatial queries during rendering
 */
export interface RoadTileSegment {
  /** Start point within tile (local coordinates) */
  start: { x: number; z: number };
  /** End point within tile (local coordinates) */
  end: { x: number; z: number };
  /** Road width */
  width: number;
  /** Parent road ID */
  roadId: string;
}

/**
 * Complete procedural road network data
 */
export interface RoadNetwork {
  /** All towns in the network */
  towns: ProceduralTown[];
  /** All roads connecting towns */
  roads: ProceduralRoad[];
  /** World seed used for generation */
  seed: number;
  /** Generation timestamp */
  generatedAt: number;
}
