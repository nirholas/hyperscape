import type { Point, Rect } from "../../types";

/**
 * Get the current UI scale from the CSS variable set on the scaled container
 * This is used to adjust mouse coordinates when the UI is scaled via CSS transform
 */
export function getUIScale(): number {
  if (typeof document === "undefined") return 1;

  // Try to read from CSS custom property set on the scaled container
  const scaledContainer = document.querySelector("[data-ui-scale]");
  if (scaledContainer) {
    const scale = scaledContainer.getAttribute("data-ui-scale");
    if (scale) {
      const parsed = parseFloat(scale);
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
  }

  return 1;
}

/**
 * Convert screen-space coordinates to scaled UI space
 * When UI is scaled up (e.g., 1.5x), mouse movements need to be scaled down
 * to match the visual movement of elements
 */
export function screenToScaledSpace(point: Point): Point {
  const scale = getUIScale();
  return {
    x: point.x / scale,
    y: point.y / scale,
  };
}

/**
 * Convert a delta value from screen space to scaled UI space
 */
export function scaleScreenDelta(
  dx: number,
  dy: number,
): { dx: number; dy: number } {
  const scale = getUIScale();
  return {
    dx: dx / scale,
    dy: dy / scale,
  };
}

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
 * Get pointer position from a pointer event, adjusted for UI scale
 * When the UI is scaled via CSS transform, we need to convert screen coordinates
 * to the scaled coordinate space for accurate drag positioning
 */
export function getPointerPosition(
  event: PointerEvent | React.PointerEvent,
): Point {
  const scale = getUIScale();
  return {
    x: event.clientX / scale,
    y: event.clientY / scale,
  };
}

/**
 * Get raw pointer position without UI scale adjustment
 * Use this when you need screen-space coordinates
 */
export function getRawPointerPosition(
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
 * Get current viewport dimensions in scaled UI space
 * When the UI is scaled via CSS transform, the effective viewport is larger/smaller
 * than the actual screen (e.g., at 1.5x scale, 1920px screen = 1280px scaled viewport)
 */
export function getViewportSize(): { width: number; height: number } {
  if (typeof globalThis !== "undefined" && globalThis.innerWidth) {
    const scale = getUIScale();
    return {
      width: globalThis.innerWidth / scale,
      height: globalThis.innerHeight / scale,
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

  updateRect(id: string, rect: Rect): void {
    const info = this.targets.get(id);
    if (info) {
      info.rect = rect;
    }
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
