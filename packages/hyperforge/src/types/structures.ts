/**
 * Structure Types - Building and Structure Studio types
 *
 * Types for modular building construction, piece management,
 * and structure baking for the World Editor.
 */

import type { Position3D } from "./core";

// =============================================================================
// BUILDING PIECE TYPES
// =============================================================================

/**
 * Types of modular building pieces
 */
export type BuildingPieceType = "wall" | "door" | "window" | "roof" | "floor";

/**
 * A snap point defines where pieces can connect to each other
 */
export interface SnapPoint {
  id: string;
  position: Position3D;
  direction: Position3D; // Normal direction for alignment
  compatibleTypes: BuildingPieceType[];
}

/**
 * Dimensions of a building piece in meters
 */
export interface PieceDimensions {
  width: number;
  height: number;
  depth: number;
}

/**
 * A building piece that can be placed in the structure editor
 */
export interface BuildingPiece {
  id: string;
  name: string;
  type: BuildingPieceType;
  modelUrl: string; // GLB from Meshy/CDN
  thumbnailUrl: string;
  dimensions: PieceDimensions;
  snapPoints: SnapPoint[];
  // Generation metadata
  generatedAt?: string;
  meshyTaskId?: string;
  prompt?: string;
}

// =============================================================================
// STRUCTURE DEFINITION TYPES
// =============================================================================

/**
 * Transform for a placed piece in 3D space
 */
export interface PieceTransform {
  position: Position3D;
  rotation: Position3D; // Euler angles in degrees
  scale: Position3D;
}

/**
 * A piece that has been placed in a structure
 */
export interface PlacedPiece {
  id: string; // Unique instance ID
  pieceId: string; // Reference to BuildingPiece.id
  transform: PieceTransform;
}

/**
 * Bounds of a structure in meters
 */
export interface StructureBounds {
  width: number;
  height: number;
  depth: number;
  // Optional origin offset
  originOffset?: Position3D;
}

/**
 * A complete structure definition (before baking)
 */
export interface StructureDefinition {
  id: string;
  name: string;
  description: string;
  pieces: PlacedPiece[];
  bounds: StructureBounds;
  // Metadata
  createdAt: string;
  updatedAt: string;
  thumbnailUrl?: string;
  // After baking
  bakedModelUrl?: string;
  bakedAt?: string;
  // Flags
  enterable: boolean; // Can players enter this structure?
}

// =============================================================================
// EDITOR STATE TYPES
// =============================================================================

/**
 * Grid snap configuration for the editor
 */
export interface GridSnapConfig {
  enabled: boolean;
  size: number; // Snap size in meters (0.5, 1, 2, etc.)
  rotationSnap: number; // Degrees (15, 45, 90)
  showGrid: boolean;
  gridHeight: number; // Y position of grid plane
}

/**
 * Transform mode for the editor
 */
export type TransformMode = "translate" | "rotate" | "scale";

/**
 * Editor tool mode
 */
export type StructureEditorTool = "select" | "place" | "delete" | "pan";

/**
 * State of the structure editor
 */
export interface StructureEditorState {
  // Current structure being edited
  structure: StructureDefinition | null;
  // Selection state
  selectedPieceId: string | null;
  hoveredPieceId: string | null;
  // Tool state
  tool: StructureEditorTool;
  transformMode: TransformMode;
  // Piece being placed (dragged from palette)
  placingPiece: BuildingPiece | null;
  // Grid configuration
  gridConfig: GridSnapConfig;
  // Undo/redo
  historyIndex: number;
  history: StructureDefinition[];
}

// =============================================================================
// BAKING TYPES
// =============================================================================

/**
 * Status of a baking operation
 */
export type BakeStatus = "pending" | "processing" | "complete" | "error";

/**
 * Result of baking a structure
 */
export interface BakeResult {
  status: BakeStatus;
  modelUrl?: string;
  thumbnailUrl?: string;
  error?: string;
  // Stats
  originalPieceCount?: number;
  mergedMeshCount?: number;
  fileSizeBytes?: number;
}

/**
 * Request to bake a structure
 */
export interface BakeRequest {
  structureId: string;
  structure: StructureDefinition;
  options?: {
    generateThumbnail?: boolean;
    optimizeMeshes?: boolean;
    mergeByMaterial?: boolean;
  };
}

// =============================================================================
// PIECE LIBRARY TYPES
// =============================================================================

/**
 * Category filter for the piece palette
 */
export interface PieceCategory {
  type: BuildingPieceType;
  label: string;
  icon: string; // Lucide icon name
  pieces: BuildingPiece[];
}

/**
 * The complete piece library
 */
export interface PieceLibrary {
  pieces: BuildingPiece[];
  categories: PieceCategory[];
  lastUpdated: string;
}

// =============================================================================
// TOWN TYPES
// =============================================================================

/**
 * A building placed in a town layout
 */
export interface PlacedBuilding {
  id: string; // Unique instance ID
  structureId: string; // Reference to baked StructureDefinition.id
  name: string; // Display name for this instance
  position: Position3D;
  rotation: number; // Y-axis rotation in degrees
  scale: number; // Uniform scale, defaults to 1
}

/**
 * A town is a collection of buildings arranged together
 */
export interface TownDefinition {
  id: string;
  name: string;
  description: string;
  buildings: PlacedBuilding[];
  // Bounds of the town area
  bounds: {
    width: number;
    depth: number;
  };
  // Metadata
  createdAt: string;
  updatedAt: string;
  thumbnailUrl?: string;
  // Optional center point for spawning
  centerOffset?: Position3D;
}

// =============================================================================
// WORLD INTEGRATION TYPES
// =============================================================================

/**
 * A structure placed in the game world (for tile system)
 */
export interface StructureSpawnConfig {
  type: "structure";
  structureId: string;
  position: Position3D;
  rotation: number; // Y-axis rotation in degrees
  scale?: number; // Uniform scale, defaults to 1
}

/**
 * A town placed in the game world
 */
export interface TownSpawnConfig {
  type: "town";
  townId: string;
  position: Position3D;
  rotation: number; // Y-axis rotation in degrees
  scale?: number; // Uniform scale for entire town
}

// =============================================================================
// DEFAULT VALUES
// =============================================================================

/**
 * Default grid snap configuration
 */
export const DEFAULT_GRID_CONFIG: GridSnapConfig = {
  enabled: true,
  size: 1,
  rotationSnap: 45,
  showGrid: true,
  gridHeight: 0,
};

/**
 * Default piece dimensions (1m cube)
 */
export const DEFAULT_PIECE_DIMENSIONS: PieceDimensions = {
  width: 1,
  height: 1,
  depth: 1,
};

/**
 * Default transform (identity)
 */
export const DEFAULT_TRANSFORM: PieceTransform = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
};

/**
 * Piece type display labels and icons
 */
export const PIECE_TYPE_CONFIG: Record<
  BuildingPieceType,
  { label: string; icon: string }
> = {
  wall: { label: "Walls", icon: "Square" },
  door: { label: "Doors", icon: "DoorOpen" },
  window: { label: "Windows", icon: "AppWindow" },
  roof: { label: "Roofs", icon: "Home" },
  floor: { label: "Floors", icon: "Layers" },
};
