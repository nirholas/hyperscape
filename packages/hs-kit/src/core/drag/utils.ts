import type { Point, Rect } from "../../types";

/**
 * Check if a point is inside a rectangle
 */
export function isPointInRect(point: Point, rect: Rect): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

/**
 * Get the bounding rect of an element
 */
export function getElementRect(element: HTMLElement): Rect {
  const rect = element.getBoundingClientRect();
  return {
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

/**
 * Get pointer position from a pointer event
 */
export function getPointerPosition(
  event: PointerEvent | React.PointerEvent,
): Point {
  return {
    x: event.clientX,
    y: event.clientY,
  };
}

/**
 * Calculate distance between two points
 */
export function distance(a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Clamp a value between min and max
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Get current viewport dimensions
 */
export function getViewportSize(): { width: number; height: number } {
  if (typeof globalThis !== "undefined" && globalThis.innerWidth) {
    return {
      width: globalThis.innerWidth,
      height: globalThis.innerHeight,
    };
  }
  return { width: 1920, height: 1080 }; // Fallback
}

/**
 * Clamp a window position to keep it within viewport boundaries.
 * Ensures at least `minVisible` pixels of the window are visible on screen.
 *
 * @param position - Current position { x, y }
 * @param size - Window size { width, height }
 * @param minVisible - Minimum pixels of window that must remain visible (default 40)
 * @returns Clamped position
 */
export function clampToViewport(
  position: Point,
  size: { width: number; height: number },
  minVisible: number = 40,
): Point {
  const viewport = getViewportSize();

  // Calculate bounds:
  // - Left: allow window to go off-screen, but minVisible pixels must remain
  // - Right: same, window right edge can be at viewport right, but minVisible must be visible
  // - Top: keep title bar visible (at least minVisible)
  // - Bottom: same as left/right

  const minX = -(size.width - minVisible);
  const maxX = viewport.width - minVisible;
  const minY = 0; // Keep title bar on screen
  const maxY = viewport.height - minVisible;

  return {
    x: clamp(position.x, minX, maxX),
    y: clamp(position.y, minY, maxY),
  };
}

/**
 * Clamp window size to fit within viewport while respecting min/max constraints.
 * Also adjusts position if needed to keep window on screen.
 *
 * @param position - Current position
 * @param size - Current size
 * @param minSize - Minimum size constraints
 * @param maxSize - Maximum size constraints (optional)
 * @returns Adjusted position and size
 */
export function clampSizeToViewport(
  position: Point,
  size: { width: number; height: number },
  minSize: { width: number; height: number },
  maxSize?: { width: number; height: number },
): { position: Point; size: { width: number; height: number } } {
  const viewport = getViewportSize();

  // Calculate maximum allowed size based on position
  const maxAllowedWidth = viewport.width - position.x;
  const maxAllowedHeight = viewport.height - position.y;

  // Clamp size
  let newWidth = Math.max(
    minSize.width,
    Math.min(size.width, maxSize?.width ?? Infinity, maxAllowedWidth),
  );
  let newHeight = Math.max(
    minSize.height,
    Math.min(size.height, maxSize?.height ?? Infinity, maxAllowedHeight),
  );

  // Ensure minimum size
  newWidth = Math.max(newWidth, minSize.width);
  newHeight = Math.max(newHeight, minSize.height);

  return {
    position,
    size: { width: newWidth, height: newHeight },
  };
}

/** Drop target registration info */
export interface DropTargetInfo {
  element: HTMLElement;
  rect: Rect;
  accepts: string[];
  data?: Record<string, unknown>;
}

/**
 * Registry for drop targets
 * This allows the drag system to find all registered drop targets
 */
class DropTargetRegistry {
  private targets: Map<string, DropTargetInfo> = new Map();

  /**
   * Register a drop target
   *
   * @example
   * // New API with info object
   * dropTargetRegistry.register('slot-1', {
   *   element: node,
   *   rect: { x: 0, y: 0, width: 40, height: 40 },
   *   accepts: ['item'],
   *   data: { index: 1 },
   * });
   *
   * // Legacy API (backwards compatible)
   * dropTargetRegistry.register('slot-1', element, ['item']);
   */
  register(
    id: string,
    elementOrInfo: HTMLElement | DropTargetInfo,
    acceptedTypes?: string[],
  ): void {
    if (elementOrInfo instanceof HTMLElement) {
      // Legacy API
      const rect = getElementRect(elementOrInfo);
      this.targets.set(id, {
        element: elementOrInfo,
        rect,
        accepts: acceptedTypes || [],
      });
    } else {
      // New API
      this.targets.set(id, elementOrInfo);
    }
  }

  unregister(id: string): void {
    this.targets.delete(id);
  }

  getTargetsAtPoint(point: Point, dragType: string): string[] {
    const result: string[] = [];
    this.targets.forEach((info, id) => {
      if (info.accepts.includes(dragType)) {
        // Always get fresh rect from element for accurate hit testing
        // (cached rect becomes stale when elements move/resize)
        const rect = info.element ? getElementRect(info.element) : info.rect;
        if (rect && isPointInRect(point, rect)) {
          result.push(id);
        }
      }
    });
    return result;
  }

  getTarget(id: string): HTMLElement | undefined {
    return this.targets.get(id)?.element;
  }

  getTargetInfo(id: string): DropTargetInfo | undefined {
    return this.targets.get(id);
  }

  getTargetData(id: string): Record<string, unknown> | undefined {
    return this.targets.get(id)?.data;
  }

  clear(): void {
    this.targets.clear();
  }
}

/** Global drop target registry singleton */
export const dropTargetRegistry = new DropTargetRegistry();
