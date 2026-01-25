/**
 * Auto-scroll functionality
 *
 * Automatically scrolls containers when drag approaches edges.
 */

import { useEffect, useRef } from "react";
import type { Point, Rect } from "../../types";
import { useDragStore } from "../../stores/dragStore";

/** Auto-scroll configuration */
export interface AutoScrollConfig {
  /** Threshold distance from edge to start scrolling (px) */
  threshold?: number;
  /** Maximum scroll speed (px per frame) */
  maxSpeed?: number;
  /** Acceleration curve (1 = linear, 2 = quadratic, etc.) */
  acceleration?: number;
  /** Whether to scroll the window */
  scrollWindow?: boolean;
}

/** Default auto-scroll configuration */
export const DEFAULT_AUTO_SCROLL_CONFIG: Required<AutoScrollConfig> = {
  threshold: 50,
  maxSpeed: 15,
  acceleration: 2,
  scrollWindow: true,
};

/**
 * Calculate scroll direction and speed based on pointer position
 */
function calculateScrollVector(
  pointerPosition: Point,
  containerRect: Rect,
  config: Required<AutoScrollConfig>,
): Point {
  const { threshold, maxSpeed, acceleration } = config;

  let x = 0;
  let y = 0;

  // Check horizontal edges
  const distanceFromLeft = pointerPosition.x - containerRect.x;
  const distanceFromRight =
    containerRect.x + containerRect.width - pointerPosition.x;

  if (distanceFromLeft < threshold && distanceFromLeft > 0) {
    const ratio = 1 - distanceFromLeft / threshold;
    x = -maxSpeed * Math.pow(ratio, acceleration);
  } else if (distanceFromRight < threshold && distanceFromRight > 0) {
    const ratio = 1 - distanceFromRight / threshold;
    x = maxSpeed * Math.pow(ratio, acceleration);
  }

  // Check vertical edges
  const distanceFromTop = pointerPosition.y - containerRect.y;
  const distanceFromBottom =
    containerRect.y + containerRect.height - pointerPosition.y;

  if (distanceFromTop < threshold && distanceFromTop > 0) {
    const ratio = 1 - distanceFromTop / threshold;
    y = -maxSpeed * Math.pow(ratio, acceleration);
  } else if (distanceFromBottom < threshold && distanceFromBottom > 0) {
    const ratio = 1 - distanceFromBottom / threshold;
    y = maxSpeed * Math.pow(ratio, acceleration);
  }

  return { x, y };
}

/**
 * Hook for auto-scroll functionality during drag operations
 */
export function useAutoScroll(config: Partial<AutoScrollConfig> = {}): void {
  const mergedConfig: Required<AutoScrollConfig> = {
    ...DEFAULT_AUTO_SCROLL_CONFIG,
    ...config,
  };

  const isDragging = useDragStore((s) => s.isDragging);
  const current = useDragStore((s) => s.current);
  const currentRef = useRef(current);
  const animationFrameRef = useRef<number | null>(null);

  // Keep current position updated
  useEffect(() => {
    currentRef.current = current;
  }, [current]);

  useEffect(() => {
    if (!isDragging) {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      return;
    }

    const scroll = () => {
      if (!isDragging) return;

      const position = currentRef.current;

      if (mergedConfig.scrollWindow) {
        const windowRect: Rect = {
          x: 0,
          y: 0,
          width: window.innerWidth,
          height: window.innerHeight,
        };
        const scrollVector = calculateScrollVector(
          position,
          windowRect,
          mergedConfig,
        );

        if (scrollVector.x !== 0 || scrollVector.y !== 0) {
          window.scrollBy(scrollVector.x, scrollVector.y);
        }
      }

      animationFrameRef.current = requestAnimationFrame(scroll);
    };

    animationFrameRef.current = requestAnimationFrame(scroll);

    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [isDragging, mergedConfig]);
}
