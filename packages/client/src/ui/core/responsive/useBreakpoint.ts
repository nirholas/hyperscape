/**
 * Responsive Breakpoint Hooks
 *
 * React hooks for responsive design, consuming breakpoints from
 * the client design token system.
 *
 * @packageDocumentation
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { breakpoints, touchTargets } from "../../tokens";

/**
 * Breakpoint names matching the client token system
 */
export type BreakpointName = "xs" | "sm" | "md" | "lg" | "xl" | "2xl" | "3xl";

/**
 * Device type categories based on breakpoint
 */
export type DeviceType = "mobile" | "tablet" | "desktop";

/**
 * Values for responsive design at each breakpoint/device
 */
export interface ResponsiveValues<T> {
  mobile: T;
  tablet?: T;
  desktop: T;
}

/**
 * Hook to get the current breakpoint based on window width
 *
 * @returns Current breakpoint name
 *
 * @example
 * ```tsx
 * function ResponsiveComponent() {
 *   const breakpoint = useBreakpoint();
 *
 *   return (
 *     <div>
 *       Current breakpoint: {breakpoint}
 *       {breakpoint === 'xs' && <MobileLayout />}
 *       {breakpoint === 'xl' && <DesktopLayout />}
 *     </div>
 *   );
 * }
 * ```
 */
export function useBreakpoint(): BreakpointName {
  const getBreakpoint = useCallback((): BreakpointName => {
    if (typeof window === "undefined") return "xl";

    const width = window.innerWidth;

    if (width >= breakpoints["3xl"]) return "3xl";
    if (width >= breakpoints["2xl"]) return "2xl";
    if (width >= breakpoints.xl) return "xl";
    if (width >= breakpoints.lg) return "lg";
    if (width >= breakpoints.md) return "md";
    if (width >= breakpoints.sm) return "sm";
    return "xs";
  }, []);

  const [current, setCurrent] = useState<BreakpointName>(getBreakpoint);

  useEffect(() => {
    const handleResize = () => {
      const newBreakpoint = getBreakpoint();
      setCurrent((prev) => (prev !== newBreakpoint ? newBreakpoint : prev));
    };

    // Initial check
    handleResize();

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [getBreakpoint]);

  return current;
}

/**
 * Hook to get the current device type (mobile, tablet, desktop)
 *
 * @returns Current device type
 *
 * @example
 * ```tsx
 * function ResponsiveComponent() {
 *   const device = useDeviceType();
 *
 *   return (
 *     <div>
 *       {device === 'mobile' && <MobileNav />}
 *       {device === 'desktop' && <DesktopNav />}
 *     </div>
 *   );
 * }
 * ```
 */
export function useDeviceType(): DeviceType {
  const breakpoint = useBreakpoint();

  return useMemo(() => {
    switch (breakpoint) {
      case "xs":
      case "sm":
        return "mobile";
      case "md":
      case "lg":
        return "tablet";
      case "xl":
      case "2xl":
      case "3xl":
        return "desktop";
    }
  }, [breakpoint]);
}

/**
 * Hook to get the appropriate touch target size for the current device
 *
 * @returns Touch target size as CSS string (e.g., "48px")
 *
 * @example
 * ```tsx
 * function Button({ children }) {
 *   const touchTarget = useTouchTarget();
 *
 *   return (
 *     <button style={{ minWidth: touchTarget, minHeight: touchTarget }}>
 *       {children}
 *     </button>
 *   );
 * }
 * ```
 */
export function useTouchTarget(): string {
  const device = useDeviceType();

  return useMemo(() => {
    switch (device) {
      case "mobile":
        return touchTargets.md; // 48px - Google Material minimum
      case "tablet":
        return touchTargets.apple; // 44px - Apple HIG minimum
      case "desktop":
        return touchTargets.sm; // 40px - Desktop can be smaller
    }
  }, [device]);
}

/**
 * Hook to get a responsive value based on the current device type
 *
 * @param values - Object with values for each device type
 * @returns The appropriate value for the current device
 *
 * @example
 * ```tsx
 * function ResponsiveGrid() {
 *   const columns = useResponsiveValue({ mobile: 1, tablet: 2, desktop: 4 });
 *
 *   return (
 *     <div style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}>
 *       {children}
 *     </div>
 *   );
 * }
 * ```
 */
export function useResponsiveValue<T>(values: ResponsiveValues<T>): T {
  const device = useDeviceType();

  return useMemo(() => {
    switch (device) {
      case "mobile":
        return values.mobile;
      case "tablet":
        return values.tablet ?? values.desktop;
      case "desktop":
        return values.desktop;
    }
  }, [device, values.mobile, values.tablet, values.desktop]);
}

/**
 * Hook to check if the current viewport matches a media query
 *
 * @param query - Media query string (e.g., "(min-width: 768px)")
 * @returns Whether the media query matches
 *
 * @example
 * ```tsx
 * function Component() {
 *   const isLargeScreen = useMediaQuery('(min-width: 1024px)');
 *
 *   return isLargeScreen ? <LargeLayout /> : <SmallLayout />;
 * }
 * ```
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;

    const mediaQuery = window.matchMedia(query);

    const handleChange = (event: { matches: boolean }) => {
      setMatches(event.matches);
    };

    // Set initial value
    setMatches(mediaQuery.matches);

    // Listen for changes
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [query]);

  return matches;
}

/**
 * Hook to check if the device prefers reduced motion
 *
 * @returns Whether reduced motion is preferred
 *
 * @example
 * ```tsx
 * function AnimatedComponent() {
 *   const prefersReducedMotion = usePrefersReducedMotion();
 *
 *   return (
 *     <motion.div
 *       animate={{ opacity: 1 }}
 *       transition={{ duration: prefersReducedMotion ? 0 : 0.3 }}
 *     />
 *   );
 * }
 * ```
 */
export function usePrefersReducedMotion(): boolean {
  return useMediaQuery("(prefers-reduced-motion: reduce)");
}

/**
 * Hook to check if the device is touch-enabled
 *
 * @returns Whether the device supports touch
 */
export function useIsTouchDevice(): boolean {
  const [isTouch, setIsTouch] = useState(false);

  useEffect(() => {
    const checkTouch = () => {
      setIsTouch(
        "ontouchstart" in window ||
          navigator.maxTouchPoints > 0 ||
          (navigator as { msMaxTouchPoints?: number }).msMaxTouchPoints! > 0,
      );
    };

    checkTouch();
  }, []);

  return isTouch;
}

// Re-export breakpoint values for convenience
export { breakpoints, touchTargets };
