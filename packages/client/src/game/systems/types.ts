/**
 * Shared types for game systems
 * @packageDocumentation
 */

// ============================================================================
// Geometry Types
// ============================================================================

/** 2D point coordinates */
export interface Point {
  x: number;
  y: number;
}

/** 2D size dimensions */
export interface Size {
  width: number;
  height: number;
}

/** Rectangle combining position and size */
export interface Rect extends Point, Size {}

// ============================================================================
// Item Types
// ============================================================================

/** Basic item data structure */
export interface ItemData {
  /** Unique item identifier */
  id: string;
  /** Display name */
  name: string;
  /** Item type/category */
  type: string;
  /** Stack quantity (1 for non-stackable) */
  quantity?: number;
  /** Item icon URL or identifier */
  icon?: string;
  /** Item description */
  description?: string;
}
