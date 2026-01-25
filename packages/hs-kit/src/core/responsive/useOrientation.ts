/**
 * Orientation Detection Hook
 *
 * Detects device orientation (portrait/landscape) using both
 * screen.orientation API and window dimensions as fallback.
 *
 * @packageDocumentation
 */

import { useState, useEffect, useCallback } from "react";

/**
 * Orientation type - portrait or landscape
 */
export type Orientation = "portrait" | "landscape";

/**
 * Hook to detect current device orientation
 *
 * Uses screen.orientation API when available (more reliable on mobile),
 * with window dimension comparison as fallback.
 *
 * @returns Current orientation ("portrait" or "landscape")
 *
 * @example
 * ```tsx
 * function ResponsiveLayout() {
 *   const orientation = useOrientation();
 *
 *   return orientation === 'portrait'
 *     ? <PortraitLayout />
 *     : <LandscapeLayout />;
 * }
 * ```
 */
export function useOrientation(): Orientation {
  const getOrientation = useCallback((): Orientation => {
    if (typeof window === "undefined") return "landscape";

    // Use screen.orientation API if available (more reliable)
    if (screen.orientation) {
      const type = screen.orientation.type;
      return type.startsWith("portrait") ? "portrait" : "landscape";
    }

    // Fallback to window dimensions
    return window.innerHeight > window.innerWidth ? "portrait" : "landscape";
  }, []);

  const [orientation, setOrientation] = useState<Orientation>(getOrientation);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let resizeTimeout: ReturnType<typeof setTimeout> | null = null;

    const handleChange = () => {
      // Throttle resize events to avoid excessive updates
      if (resizeTimeout) {
        clearTimeout(resizeTimeout);
      }
      resizeTimeout = setTimeout(() => {
        const newOrientation = getOrientation();
        setOrientation((prev) =>
          prev !== newOrientation ? newOrientation : prev,
        );
      }, 100);
    };

    // Use screen.orientation API if available (more reliable on mobile)
    if (screen.orientation) {
      screen.orientation.addEventListener("change", handleChange);
    }

    // Also listen to resize as fallback and for desktop window resizing
    window.addEventListener("resize", handleChange);

    // Initial check
    handleChange();

    return () => {
      if (resizeTimeout) {
        clearTimeout(resizeTimeout);
      }
      screen.orientation?.removeEventListener("change", handleChange);
      window.removeEventListener("resize", handleChange);
    };
  }, [getOrientation]);

  return orientation;
}

/**
 * Hook to check if device is in portrait mode
 *
 * @returns true if portrait, false if landscape
 */
export function useIsPortrait(): boolean {
  return useOrientation() === "portrait";
}

/**
 * Hook to check if device is in landscape mode
 *
 * @returns true if landscape, false if portrait
 */
export function useIsLandscape(): boolean {
  return useOrientation() === "landscape";
}
