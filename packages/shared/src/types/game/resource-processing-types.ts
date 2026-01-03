/**
 * Resource and Processing Types
 * All resource gathering, skilling, fires, and processing action type definitions
 */

import THREE from "../../extras/three/three";
import type { Position3D } from "../core/base-types";

// ============== RESOURCE TYPES ==============

/**
 * Resource footprint - how many tiles a resource occupies
 * Used for OSRS-accurate tile-based positioning and interaction
 *
 * - standard: 1×1 tile (normal trees, rocks, fishing spots)
 * - large: 2×2 tiles (ancient trees, large ore veins)
 * - massive: 3×3 tiles (world trees, raid objects)
 *
 * Multi-tile resources use the SW (south-west) tile as their anchor,
 * matching OSRS behavior for large objects.
 *
 * @see https://oldschool.runescape.wiki/w/Pathfinding
 */
export type ResourceFootprint = "standard" | "large" | "massive";

/**
 * Tile dimensions for each footprint type
 * Used to calculate occupied tiles and interaction positions
 */
export const FOOTPRINT_SIZES: Record<
  ResourceFootprint,
  { x: number; z: number }
> = {
  standard: { x: 1, z: 1 },
  large: { x: 2, z: 2 },
  massive: { x: 3, z: 3 },
};

/**
 * Resource - a gatherable resource in the world
 */
export interface Resource {
  id: string;
  type: "tree" | "fishing_spot" | "ore" | "herb_patch" | "mine";
  name: string;
  position: Position3D;
  skillRequired: string;
  levelRequired: number;
  toolRequired: string; // Tool item ID
  respawnTime: number; // Milliseconds
  isAvailable: boolean;
  lastDepleted: number;
  drops: ResourceDrop[];
  /** Tile footprint - defaults to "standard" (1×1) if not specified */
  footprint?: ResourceFootprint;
}

/**
 * Resource drop - what a resource can drop when gathered
 */
export interface ResourceDrop {
  itemId: string;
  itemName: string;
  quantity: number;
  chance: number; // 0-1
  xpAmount: number;
  stackable: boolean;
}

// ============== FIRE TYPES ==============

/**
 * Fire - a fire created by the firemaking skill
 */
export interface Fire {
  id: string;
  position: Position3D;
  playerId: string; // Who lit the fire
  createdAt: number;
  duration: number; // How long fire lasts in milliseconds
  isActive: boolean;
  mesh?: THREE.Object3D;
}

// ============== PROCESSING TYPES ==============

/**
 * Processing action - firemaking and cooking actions
 */
export interface ProcessingAction {
  playerId: string;
  actionType: "firemaking" | "cooking";
  primaryItem: { id: number; slot: number }; // Item being used (tinderbox/raw fish)
  targetItem?: { id: number; slot: number }; // Target item (logs/fire)
  targetFire?: string; // Fire ID for cooking
  startTime: number;
  duration: number;
  xpReward: number;
  skillRequired: string;
}

// ============== DEATH AND RESPAWN TYPES ==============

/**
 * Death data - information about a player's death
 */
export interface DeathData {
  playerId: string;
  deathLocation: Position3D;
  killedBy: string;
  deathTime: number;
  respawnTime: number;
  itemsDropped?: string[];
}
