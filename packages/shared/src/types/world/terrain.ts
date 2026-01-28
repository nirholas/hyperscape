/**
 * Terrain and resource-related type definitions
 *
 * These interfaces define terrain generation, resource spawning, and world tile management.
 * Common terrain types have been moved to core.ts to avoid duplication.
 */

import THREE from "../../extras/three/three";
import type { Position3D } from "../core/core";
import type { PMeshHandle } from "../../extras/three/geometryToPxMesh";
import type { ActorHandle } from "../systems/physics";

// Terrain resource interfaces
export interface TerrainResourceSpawnPoint {
  position: Position3D;
  type: "tree" | "rock" | "ore" | "herb" | "fish" | "gem" | "rare_ore";
  subType:
    | "willow"
    | "oak"
    | "yew"
    | "coal"
    | "iron"
    | "mithril"
    | "adamant"
    | "runite"
    | "copper"
    | "tin";
}

export interface TerrainTileData {
  tileId: string;
  position: { x: number; z: number };
  biome:
    | "forest"
    | "plains"
    | "desert"
    | "mountains"
    | "swamp"
    | "tundra"
    | "jungle";
  tileX: number;
  tileZ: number;
  resources: TerrainResource[];
}

export interface TerrainResource {
  position: Position3D;
  type: "tree" | "rock" | "ore" | "herb" | "fish" | "gem" | "rare_ore";
  id: string;
}

// Terrain system interfaces
export interface TerrainTile {
  key: string;
  x: number;
  z: number;
  mesh: THREE.Mesh;
  collision: PMeshHandle | null;
  biome:
    | "forest"
    | "plains"
    | "desert"
    | "mountains"
    | "swamp"
    | "tundra"
    | "jungle";
  resources: ResourceNode[];
  roads: RoadSegment[];
  waterMeshes: THREE.Mesh[];
  generated: boolean;
  heightData: number[];
  lastActiveTime: Date;
  playerCount: number;
  needsSave: boolean;
  chunkSeed: number;
  heightMap: Float32Array;
  collider: ActorHandle | null;
  lastUpdate: number;
}

export interface ResourceNode {
  id: string;
  type: "tree" | "rock" | "ore" | "herb" | "fish" | "gem" | "rare_ore";
  position: Position3D | THREE.Vector3;
  mesh?: THREE.Mesh | null; // For non-instanced meshes
  instanceId?: number | null;
  meshType?: string;
  health: number;
  maxHealth: number;
  respawnTime: number;
  harvestable: boolean;
  requiredLevel: number;
}

export interface RoadSegment {
  start: THREE.Vector2 | { x: number; z: number };
  end: THREE.Vector2 | { x: number; z: number };
  width: number;
  mesh: THREE.Mesh | null;
  material: "stone" | "dirt" | "cobblestone";
  condition: number; // 0-100
}

// BiomeData moved to core.ts to avoid duplication

// ResourceNodeData and ResourceMesh moved to core.ts to avoid duplication

// ============================================================================
// TERRAIN FLATTENING
// ============================================================================

/**
 * Defines a rectangular area where terrain should be flattened.
 * Used for stations and other world objects that need level ground.
 */
export interface FlatZone {
  /** Unique identifier (e.g., "station_furnace_lumbridge_1") */
  id: string;
  /** Center X position in world coordinates (meters) */
  centerX: number;
  /** Center Z position in world coordinates (meters) */
  centerZ: number;
  /** Width in meters (X axis) */
  width: number;
  /** Depth in meters (Z axis) */
  depth: number;
  /** Target height for the flat area (meters) */
  height: number;
  /** Blend radius for smooth transition to procedural terrain (meters) */
  blendRadius: number;
}

/**
 * Spatial index key for flat zone lookup.
 * Format: "tileX_tileZ" where tiles are terrain tiles (100m each).
 */
export type FlatZoneKey = `${number}_${number}`;
