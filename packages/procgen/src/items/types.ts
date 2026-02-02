/**
 * Shared Types for Procedural Items
 *
 * Common interfaces used across all procedural item generators
 * (docks, bridges, wells, fences, etc.)
 */

import type * as THREE from "three";

// ============================================================================
// COMMON TYPES
// ============================================================================

/**
 * 3D position in world space
 */
export interface WorldPosition {
  x: number;
  y: number;
  z: number;
}

/**
 * 2D direction (normalized)
 */
export interface Direction2D {
  x: number;
  z: number;
}

/**
 * Wood material variants for procedural items
 */
export const WoodType = {
  Weathered: "weathered", // Gray, sun-bleached, cracked
  Fresh: "fresh", // Light tan, newly cut
  Dark: "dark", // Dark stained or aged
  Mossy: "mossy", // Green-tinged, damp
} as const;

export type WoodTypeValue = (typeof WoodType)[keyof typeof WoodType];

/**
 * Base interface for all procedural item recipes
 */
export interface ItemRecipeBase {
  /** Human-readable label for this item type */
  label: string;
  /** Wood material type for the item */
  woodType: WoodTypeValue;
}

/**
 * Base interface for all generated items
 */
export interface GeneratedItemBase {
  /** The generated Three.js mesh or group */
  mesh: THREE.Mesh | THREE.Group;
  /** World position of the item */
  position: WorldPosition;
}

/**
 * Collision data for walkable items
 */
export interface ItemCollisionData {
  /** Walkable tile coordinates (world tile coords) */
  walkableTiles: Array<{ x: number; z: number }>;
  /** Edge tiles with blocked directions (prevent falling off) */
  blockedEdges: Array<{
    tileX: number;
    tileZ: number;
    direction: "north" | "south" | "east" | "west";
  }>;
}

/**
 * Statistics about generated item
 */
export interface ItemStats {
  /** Total vertex count */
  vertices: number;
  /** Total triangle count */
  triangles: number;
  /** Generation time in milliseconds */
  generationTime: number;
}

// ============================================================================
// SHORELINE DETECTION
// ============================================================================

/**
 * A point on the shoreline with position and direction data
 */
export interface ShorelinePoint {
  /** World position on the shoreline */
  position: WorldPosition;
  /** Direction pointing away from water (into land) */
  landwardNormal: Direction2D;
  /** Direction pointing into water */
  waterwardNormal: Direction2D;
  /** Terrain height at this point */
  height: number;
  /** Slope of the terrain (0 = flat, 1 = vertical) */
  slope: number;
  /** Distance from water body center */
  distanceFromCenter: number;
}

/**
 * Water body definition for placement algorithms
 */
export interface WaterBody {
  /** Unique identifier */
  id: string;
  /** Type of water body */
  type: "pond" | "lake" | "ocean";
  /** Center position */
  center: { x: number; z: number };
  /** Approximate radius */
  radius: number;
}
