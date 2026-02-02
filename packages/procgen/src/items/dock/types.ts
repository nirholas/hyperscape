/**
 * Dock Generation Types
 */

import type * as THREE from "three";
import type {
  WorldPosition,
  Direction2D,
  ItemRecipeBase,
  GeneratedItemBase,
  ItemCollisionData,
  ItemStats,
} from "../types";

/** Dock style variations */
export const DockStyle = {
  /** Simple straight pier extending into water */
  Pier: "pier",
  /** T-shaped dock with perpendicular end section */
  TShaped: "t-shaped",
  /** L-shaped dock with corner turn */
  LShaped: "l-shaped",
} as const;

export type DockStyleValue = (typeof DockStyle)[keyof typeof DockStyle];

/**
 * Configuration for dock generation
 */
export interface DockRecipe extends ItemRecipeBase {
  /** Dock style */
  style: DockStyleValue;
  /** How far the dock extends into water [min, max] in meters */
  lengthRange: [number, number];
  /** Width of the dock [min, max] in meters */
  widthRange: [number, number];
  /** Individual plank width in meters */
  plankWidth: number;
  /** Gap between planks in meters */
  plankGap: number;
  /** Support post spacing in meters */
  postSpacing: number;
  /** Support post radius in meters */
  postRadius: number;
  /** Height of deck above water level in meters */
  deckHeight: number;
  /** Whether to add railing */
  hasRailing: boolean;
  /** Railing height if enabled */
  railingHeight: number;
  /** Railing post spacing */
  railingPostSpacing: number;
  /** Whether to add mooring posts */
  hasMooring: boolean;
  /** For T-shaped: width of the end section [min, max] */
  tSectionWidthRange?: [number, number];
  /** For L-shaped: length of the perpendicular section [min, max] */
  lSectionLengthRange?: [number, number];
}

/**
 * Partial recipe for presets/overrides
 */
export type PartialDockRecipe = Partial<DockRecipe>;

/** Individual plank data */
export interface PlankData {
  /** Position relative to dock origin */
  position: { x: number; y: number; z: number };
  /** Rotation in radians (Y-axis) */
  rotation: number;
  /** Dimensions */
  width: number;
  length: number;
  thickness: number;
  /** Weathering factor (0-1) for variation */
  weathering: number;
}

/** Support post data */
export interface PostData {
  /** Position relative to dock origin */
  position: { x: number; y: number; z: number };
  /** Post radius */
  radius: number;
  /** Post height (from water floor to deck) */
  height: number;
  /** How much is submerged */
  submergedHeight: number;
}

/** Railing section data */
export interface RailingData {
  /** Start position relative to dock origin */
  start: { x: number; y: number; z: number };
  /** End position relative to dock origin */
  end: { x: number; y: number; z: number };
  /** Post positions along this railing section */
  posts: Array<{ x: number; y: number; z: number }>;
  /** Height of the railing */
  height: number;
}

/** Mooring post data */
export interface MooringData {
  /** Position relative to dock origin */
  position: { x: number; y: number; z: number };
  /** Radius of mooring post */
  radius: number;
  /** Height above deck */
  height: number;
}

/** Complete layout of a generated dock */
export interface DockLayout {
  /** World position (shoreline anchor point) */
  position: WorldPosition;
  /** Direction the dock extends into water (normalized) */
  direction: Direction2D;
  /** Rotation angle in radians (Y-axis) */
  rotation: number;
  /** Total length of the dock */
  length: number;
  /** Width of the main section */
  width: number;
  /** Deck height above water */
  deckHeight: number;
  /** All plank data */
  planks: PlankData[];
  /** All support post data */
  posts: PostData[];
  /** Railing data (if enabled) */
  railings: RailingData[];
  /** Mooring posts (if enabled) */
  moorings: MooringData[];
  /** For T-shaped docks */
  tSection?: {
    width: number;
    planks: PlankData[];
    posts: PostData[];
    railings: RailingData[];
  };
  /** For L-shaped docks */
  lSection?: {
    length: number;
    direction: Direction2D;
    planks: PlankData[];
    posts: PostData[];
    railings: RailingData[];
  };
}

/** Result of dock generation */
export interface GeneratedDock extends GeneratedItemBase {
  /** The generated dock layout */
  layout: DockLayout;
  /** Recipe used for generation */
  recipe: DockRecipe;
  /** Collision data for pathfinding */
  collision: ItemCollisionData;
  /** Generation statistics */
  stats: ItemStats;
  /** Separate geometry arrays for different parts */
  geometryArrays: DockGeometryArrays;
}

/** Separate geometry arrays for different material groups */
export interface DockGeometryArrays {
  /** Plank geometries (main deck surface) */
  planks: THREE.BufferGeometry[];
  /** Support post geometries */
  posts: THREE.BufferGeometry[];
  /** Railing post geometries */
  railingPosts: THREE.BufferGeometry[];
  /** Railing rail geometries */
  railingRails: THREE.BufferGeometry[];
  /** Mooring post geometries */
  moorings: THREE.BufferGeometry[];
}

/** Options for dock generation */
export interface DockGenerationOptions {
  /** Random seed (string or number) */
  seed?: string | number;
  /** Override any dock parameters */
  params?: PartialDockRecipe;
  /** Water level (Y coordinate) */
  waterLevel?: number;
  /** Water floor depth (for post calculation) */
  waterFloorDepth?: number;
}
