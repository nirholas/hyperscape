/**
 * ViewportScaler - Design resolution based UI scaling
 *
 * Wraps UI content and applies CSS transform scaling to fit the viewport.
 * All child content is authored in 1920x1080 design space and automatically
 * scaled to match the actual viewport size.
 *
 * @packageDocumentation
 */

import React, { useEffect, useState, useRef, type ReactNode } from "react";

/** Design resolution - all UI is authored at this size */
export const DESIGN_WIDTH = 1920;
export const DESIGN_HEIGHT = 1080;

interface ViewportScalerProps {
  children: ReactNode;
  /** Optional class name for the container */
  className?: string;
  /** If true, caps scale at 1.0 to prevent UI from getting too large on big screens */
  maxScale?: number;
  /** Minimum scale to prevent UI from getting too small */
  minScale?: number;
}

/**
 * Calculate the scale factor to fit design resolution into viewport
 *
 * @param viewportWidth - Actual viewport width
 * @param viewportHeight - Actual viewport height
 * @param maxScale - Maximum scale factor (default: no limit)
 * @param minScale - Minimum scale factor (default: 0.5)
 */
function calculateScaleFactor(
  viewportWidth: number,
  viewportHeight: number,
  maxScale = Infinity,
  minScale = 0.5,
): number {
  const scaleX = viewportWidth / DESIGN_WIDTH;
  const scaleY = viewportHeight / DESIGN_HEIGHT;

  // Use the smaller scale to ensure content fits in both dimensions
  let scale = Math.min(scaleX, scaleY);

  // Apply min/max constraints
  scale = Math.max(minScale, Math.min(maxScale, scale));

  return scale;
}

/**
 * Scales all UI content from design resolution (1920x1080) to viewport
 *
 * Usage:
 * ```tsx
 * <ViewportScaler>
 *   <YourUIContent />
 * </ViewportScaler>
 * ```
 *
 * All child content positions and sizes should be authored for 1920x1080.
 * The scaler will transform everything proportionally to fit the viewport.
 */
export function ViewportScaler({
  children,
  className = "",
  maxScale = 1.5,
  minScale = 0.5,
}: ViewportScalerProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState<number>(1);

  useEffect(() => {
    const updateScale = () => {
      const newScale = calculateScaleFactor(
        window.innerWidth,
        window.innerHeight,
        maxScale,
        minScale,
      );
      setScale(newScale);
    };

    // Initial calculation
    updateScale();

    // Update on resize
    window.addEventListener("resize", updateScale);
    return () => window.removeEventListener("resize", updateScale);
  }, [maxScale, minScale]);

  // Calculate the offset to center the scaled content when viewport has different aspect ratio
  const scaledWidth = DESIGN_WIDTH * scale;
  const scaledHeight = DESIGN_HEIGHT * scale;
  const offsetX = Math.max(0, (window.innerWidth - scaledWidth) / 2);
  const offsetY = Math.max(0, (window.innerHeight - scaledHeight) / 2);

  return (
    <div
      ref={containerRef}
      data-ui-scale={scale}
      className={`viewport-scaler ${className}`}
      style={{
        position: "fixed",
        top: offsetY,
        left: offsetX,
        width: DESIGN_WIDTH,
        height: DESIGN_HEIGHT,
        transform: `scale(${scale})`,
        transformOrigin: "top left",
        // Prevent content from overflowing
        overflow: "hidden",
        // Ensure this sits above the game canvas but below modals
        zIndex: 100,
        // Enable pointer events on this container
        pointerEvents: "none",
      }}
    >
      {/* Inner container that captures pointer events */}
      <div
        style={{
          width: "100%",
          height: "100%",
          pointerEvents: "auto",
        }}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Hook to get the current UI scale factor
 * Useful for components that need to know the current scale
 */
export function useViewportScale(): number {
  const [scale, setScale] = useState<number>(1);

  useEffect(() => {
    const updateScale = () => {
      const container = document.querySelector("[data-ui-scale]");
      if (container) {
        const scaleAttr = container.getAttribute("data-ui-scale");
        if (scaleAttr) {
          const parsed = parseFloat(scaleAttr);
          if (!isNaN(parsed) && parsed > 0) {
            setScale(parsed);
          }
        }
      }
    };

    updateScale();
    window.addEventListener("resize", updateScale);
    return () => window.removeEventListener("resize", updateScale);
  }, []);

  return scale;
}

/**
 * Get the design resolution dimensions
 * Use this instead of window.innerWidth/Height for positioning UI elements
 */
export function getDesignResolution(): { width: number; height: number } {
  return { width: DESIGN_WIDTH, height: DESIGN_HEIGHT };
}
