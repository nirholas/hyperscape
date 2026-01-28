import type { Point, Size, Rect } from "../../types";
import { getUIScale } from "./utils";

export type DragModifier = (position: Point, context: ModifierContext) => Point;

export interface ModifierContext {
  origin: Point;
  current: Point;
  dragSize?: Size;
  containerRect?: Rect;
  windowSize: Size;
}

export function restrictToWindow(
  position: Point,
  context: ModifierContext,
): Point {
  const { windowSize, dragSize } = context;
  const w = dragSize?.width ?? 0,
    h = dragSize?.height ?? 0;
  return {
    x: Math.max(0, Math.min(position.x, windowSize.width - w)),
    y: Math.max(0, Math.min(position.y, windowSize.height - h)),
  };
}

export function restrictToHorizontalAxis(
  position: Point,
  context: ModifierContext,
): Point {
  return { x: position.x, y: context.origin.y };
}

export function restrictToVerticalAxis(
  position: Point,
  context: ModifierContext,
): Point {
  return { x: context.origin.x, y: position.y };
}

export function createSnapToGridModifier(gridSize: number): DragModifier {
  return (position: Point): Point => ({
    x: Math.round(position.x / gridSize) * gridSize,
    y: Math.round(position.y / gridSize) * gridSize,
  });
}

export function composeModifiers(...modifiers: DragModifier[]): DragModifier {
  return (position: Point, context: ModifierContext): Point =>
    modifiers.reduce((pos, mod) => mod(pos, context), position);
}

export function createModifierContext(
  origin: Point,
  current: Point,
  opts: { dragSize?: Size; containerRect?: Rect } = {},
): ModifierContext {
  const scale = getUIScale();
  return {
    origin,
    current,
    dragSize: opts.dragSize,
    containerRect: opts.containerRect,
    windowSize: {
      width: typeof window !== "undefined" ? window.innerWidth / scale : 1920,
      height: typeof window !== "undefined" ? window.innerHeight / scale : 1080,
    },
  };
}

// ============================================================================
// Window-specific modifiers (dnd-kit style restrictToWindowEdges pattern)
// ============================================================================

/**
 * Get current viewport dimensions in scaled UI space
 * When the UI is scaled via CSS transform, the effective viewport is larger/smaller
 * than the actual screen (e.g., at 1.5x scale, 1920px screen = 1280px scaled viewport)
 * Uses clientWidth/clientHeight to exclude scrollbars for accurate snapping
 */
export function getViewportSize(): Size {
  if (typeof document !== "undefined" && document.documentElement) {
    const scale = getUIScale();
    // Use clientWidth/clientHeight to get the actual usable viewport (excludes scrollbars)
    return {
      width: document.documentElement.clientWidth / scale,
      height: document.documentElement.clientHeight / scale,
    };
  }
  if (typeof globalThis !== "undefined" && globalThis.innerWidth) {
    const scale = getUIScale();
    return {
      width: globalThis.innerWidth / scale,
      height: globalThis.innerHeight / scale,
    };
  }
  return { width: 1920, height: 1080 }; // Fallback
}

/** Arguments for window position modifiers */
export interface WindowPositionModifierArgs {
  position: Point;
  size: Size;
  originalPosition?: Point;
  delta?: Point;
}

/** Window position modifier function signature */
export type WindowPositionModifier = (
  args: WindowPositionModifierArgs,
) => Point;

/**
 * Restricts position to keep the element within viewport edges.
 * Similar to dnd-kit's restrictToWindowEdges modifier.
 *
 * @param minVisible - Minimum pixels that must remain visible (default: 40)
 * @returns A window position modifier function
 */
export function restrictToWindowEdges(
  minVisible: number = 40,
): WindowPositionModifier {
  return ({ position, size }: WindowPositionModifierArgs): Point => {
    const viewport = getViewportSize();

    // Calculate bounds:
    // - Left: allow element to go off-screen, but minVisible pixels must remain visible
    // - Right: same
    // - Top: keep title bar on screen (never go negative)
    // - Bottom: allow partial off-screen but keep minVisible visible

    const minX = -(size.width - minVisible);
    const maxX = viewport.width - minVisible;
    const minY = 0; // Keep title bar on screen
    const maxY = viewport.height - minVisible;

    return {
      x: Math.min(Math.max(position.x, minX), maxX),
      y: Math.min(Math.max(position.y, minY), maxY),
    };
  };
}

/**
 * Restricts position to keep the element fully within viewport.
 * More restrictive - the entire element stays visible.
 */
export function restrictToWindowEdgesFully(): WindowPositionModifier {
  return ({ position, size }: WindowPositionModifierArgs): Point => {
    const viewport = getViewportSize();

    const minX = 0;
    const maxX = Math.max(0, viewport.width - size.width);
    const minY = 0;
    const maxY = Math.max(0, viewport.height - size.height);

    return {
      x: Math.min(Math.max(position.x, minX), maxX),
      y: Math.min(Math.max(position.y, minY), maxY),
    };
  };
}

/**
 * Snaps position to a grid.
 *
 * @param gridSize - Size of grid cells in pixels
 */
export function snapToGridModifier(gridSize: number): WindowPositionModifier {
  return ({ position }: WindowPositionModifierArgs): Point => {
    if (gridSize <= 0) return position;

    return {
      x: Math.round(position.x / gridSize) * gridSize,
      y: Math.round(position.y / gridSize) * gridSize,
    };
  };
}

/**
 * Composes multiple window position modifiers into a single modifier.
 * Modifiers are applied in order.
 */
export function composeWindowModifiers(
  modifiers: WindowPositionModifier[],
): WindowPositionModifier {
  return (args: WindowPositionModifierArgs): Point => {
    return modifiers.reduce((pos, modifier) => {
      return modifier({ ...args, position: pos });
    }, args.position);
  };
}
