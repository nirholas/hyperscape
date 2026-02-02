/**
 * Dock Presets
 *
 * Pre-configured dock recipes for common use cases.
 */

import type { DockRecipe, PartialDockRecipe } from "./types";
import { DockStyle } from "./types";
import { WoodType } from "../types";

// ============================================================================
// DEFAULT PARAMETERS
// ============================================================================

/**
 * Default dock parameters - a simple weathered pier
 */
export const DEFAULT_DOCK_PARAMS: DockRecipe = {
  label: "Simple Pier",
  style: DockStyle.Pier,
  woodType: WoodType.Weathered,
  lengthRange: [6, 10],
  widthRange: [2.5, 3.5],
  plankWidth: 0.25,
  plankGap: 0.02,
  postSpacing: 2.5,
  postRadius: 0.12,
  deckHeight: 0.4,
  hasRailing: false,
  railingHeight: 0.9,
  railingPostSpacing: 1.5,
  hasMooring: false,
};

// ============================================================================
// PRESET DEFINITIONS
// ============================================================================

/**
 * Small fishing dock - minimal, rustic
 */
export const FISHING_DOCK: PartialDockRecipe = {
  label: "Fishing Dock",
  style: DockStyle.Pier,
  woodType: WoodType.Weathered,
  lengthRange: [5, 7],
  widthRange: [2, 2.5],
  plankWidth: 0.22,
  plankGap: 0.025,
  postSpacing: 2.0,
  postRadius: 0.1,
  deckHeight: 0.35,
  hasRailing: false,
  hasMooring: true,
};

/**
 * Village dock - medium sized with railing
 */
export const VILLAGE_DOCK: PartialDockRecipe = {
  label: "Village Dock",
  style: DockStyle.Pier,
  woodType: WoodType.Fresh,
  lengthRange: [8, 12],
  widthRange: [3, 4],
  plankWidth: 0.28,
  plankGap: 0.015,
  postSpacing: 2.5,
  postRadius: 0.14,
  deckHeight: 0.45,
  hasRailing: true,
  railingHeight: 0.85,
  railingPostSpacing: 1.2,
  hasMooring: true,
};

/**
 * T-shaped dock for boat mooring
 */
export const BOAT_DOCK: PartialDockRecipe = {
  label: "Boat Dock",
  style: DockStyle.TShaped,
  woodType: WoodType.Fresh,
  lengthRange: [10, 14],
  widthRange: [2.5, 3],
  plankWidth: 0.26,
  plankGap: 0.018,
  postSpacing: 2.2,
  postRadius: 0.15,
  deckHeight: 0.5,
  hasRailing: true,
  railingHeight: 0.9,
  railingPostSpacing: 1.4,
  hasMooring: true,
  tSectionWidthRange: [6, 8],
};

/**
 * L-shaped dock with corner
 */
export const CORNER_DOCK: PartialDockRecipe = {
  label: "Corner Dock",
  style: DockStyle.LShaped,
  woodType: WoodType.Weathered,
  lengthRange: [7, 10],
  widthRange: [2.5, 3],
  plankWidth: 0.24,
  plankGap: 0.02,
  postSpacing: 2.3,
  postRadius: 0.13,
  deckHeight: 0.42,
  hasRailing: true,
  railingHeight: 0.85,
  railingPostSpacing: 1.3,
  hasMooring: false,
  lSectionLengthRange: [4, 6],
};

/**
 * Mossy old dock - abandoned look
 */
export const OLD_DOCK: PartialDockRecipe = {
  label: "Old Dock",
  style: DockStyle.Pier,
  woodType: WoodType.Mossy,
  lengthRange: [6, 9],
  widthRange: [2.2, 2.8],
  plankWidth: 0.23,
  plankGap: 0.03, // Larger gaps from wear
  postSpacing: 2.0,
  postRadius: 0.11,
  deckHeight: 0.32,
  hasRailing: false,
  hasMooring: false,
};

/**
 * Dark stained dock - formal/harbor style
 */
export const HARBOR_DOCK: PartialDockRecipe = {
  label: "Harbor Dock",
  style: DockStyle.TShaped,
  woodType: WoodType.Dark,
  lengthRange: [12, 16],
  widthRange: [3.5, 4.5],
  plankWidth: 0.3,
  plankGap: 0.012,
  postSpacing: 2.8,
  postRadius: 0.18,
  deckHeight: 0.55,
  hasRailing: true,
  railingHeight: 1.0,
  railingPostSpacing: 1.5,
  hasMooring: true,
  tSectionWidthRange: [8, 10],
};

// ============================================================================
// PRESET REGISTRY
// ============================================================================

/**
 * All available dock presets
 */
export const DOCK_PRESETS: Record<string, PartialDockRecipe> = {
  fishing: FISHING_DOCK,
  village: VILLAGE_DOCK,
  boat: BOAT_DOCK,
  corner: CORNER_DOCK,
  old: OLD_DOCK,
  harbor: HARBOR_DOCK,
};

/**
 * Get a preset by name
 */
export function getDockPreset(name: string): PartialDockRecipe | null {
  return DOCK_PRESETS[name.toLowerCase()] ?? null;
}

/**
 * Get all preset names
 */
export function getDockPresetNames(): string[] {
  return Object.keys(DOCK_PRESETS);
}

/**
 * Merge partial params into full params
 */
export function mergeDockParams(
  base: DockRecipe,
  override: PartialDockRecipe,
): DockRecipe {
  return {
    ...base,
    ...override,
    // Ensure ranges are properly merged
    lengthRange: override.lengthRange ?? base.lengthRange,
    widthRange: override.widthRange ?? base.widthRange,
    tSectionWidthRange: override.tSectionWidthRange ?? base.tSectionWidthRange,
    lSectionLengthRange:
      override.lSectionLengthRange ?? base.lSectionLengthRange,
  };
}
