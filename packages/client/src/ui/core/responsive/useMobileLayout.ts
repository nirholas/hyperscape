/**
 * Mobile Layout Hook
 *
 * Unified hook for mobile UI detection combining device type,
 * orientation, touch capability, and safe area insets.
 *
 * @packageDocumentation
 */

import { useMemo, useState, useEffect } from "react";
import { useDeviceType, useIsTouchDevice } from "./useBreakpoint";
import { useOrientation, type Orientation } from "./useOrientation";

/**
 * Safe area insets for notch/home indicator handling
 */
export interface SafeAreaInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * Result from useMobileLayout hook
 */
export interface MobileLayoutResult {
  /** Device is mobile-sized (< 768px width) */
  isMobile: boolean;
  /** Device is tablet-sized (768px - 1024px width) */
  isTablet: boolean;
  /** Device is desktop-sized (>= 1024px width) */
  isDesktop: boolean;
  /** Current orientation */
  orientation: Orientation;
  /** Device is in portrait mode */
  isPortrait: boolean;
  /** Device is in landscape mode */
  isLandscape: boolean;
  /** Should use mobile UI (mobile or touch tablet) */
  shouldUseMobileUI: boolean;
  /** Recommended touch target size in pixels */
  touchTargetSize: number;
  /** Safe area insets for notch/home indicator */
  safeAreaInsets: SafeAreaInsets;
  /** Viewport dimensions */
  viewport: { width: number; height: number };
}

/**
 * Get CSS environment safe area insets
 * These are set by the browser for devices with notches/home indicators
 */
function getSafeAreaInsets(): SafeAreaInsets {
  if (typeof window === "undefined") {
    return { top: 0, right: 0, bottom: 0, left: 0 };
  }

  const style = window.getComputedStyle(document.documentElement);

  const parseEnvValue = (value: string): number => {
    // CSS env() values come through as computed pixels
    const parsed = parseFloat(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  };

  return {
    top: parseEnvValue(style.getPropertyValue("--sat") || "0"),
    right: parseEnvValue(style.getPropertyValue("--sar") || "0"),
    bottom: parseEnvValue(style.getPropertyValue("--sab") || "0"),
    left: parseEnvValue(style.getPropertyValue("--sal") || "0"),
  };
}

/**
 * Hook for mobile layout detection and configuration
 *
 * Combines device type, orientation, touch capability, and safe areas
 * into a single unified hook for mobile UI decisions.
 *
 * @returns Mobile layout information and utilities
 *
 * @example
 * ```tsx
 * function InterfaceManager() {
 *   const { shouldUseMobileUI, isPortrait, safeAreaInsets } = useMobileLayout();
 *
 *   if (shouldUseMobileUI) {
 *     return (
 *       <MobileInterfaceManager
 *         isPortrait={isPortrait}
 *         safeAreaInsets={safeAreaInsets}
 *       />
 *     );
 *   }
 *
 *   return <DesktopInterfaceManager />;
 * }
 * ```
 */
export function useMobileLayout(): MobileLayoutResult {
  const device = useDeviceType();
  const orientation = useOrientation();
  const isTouch = useIsTouchDevice();

  // Track viewport dimensions
  const [viewport, setViewport] = useState(() => ({
    width: typeof window !== "undefined" ? window.innerWidth : 1920,
    height: typeof window !== "undefined" ? window.innerHeight : 1080,
  }));

  // Track safe area insets
  const [safeAreaInsets, setSafeAreaInsets] =
    useState<SafeAreaInsets>(getSafeAreaInsets);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let resizeTimeout: ReturnType<typeof setTimeout> | null = null;

    const handleResize = () => {
      if (resizeTimeout) {
        clearTimeout(resizeTimeout);
      }
      resizeTimeout = setTimeout(() => {
        setViewport({
          width: window.innerWidth,
          height: window.innerHeight,
        });
        setSafeAreaInsets(getSafeAreaInsets());
      }, 100);
    };

    window.addEventListener("resize", handleResize);

    // Initial measurement
    handleResize();

    return () => {
      if (resizeTimeout) {
        clearTimeout(resizeTimeout);
      }
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  return useMemo(() => {
    const isMobile = device === "mobile";
    const isTablet = device === "tablet";
    const isDesktop = device === "desktop";
    const isPortrait = orientation === "portrait";
    const isLandscape = orientation === "landscape";

    // Use mobile UI for:
    // - All mobile devices
    // - Touch-enabled tablets (iPad, Android tablets)
    const shouldUseMobileUI = isMobile || (isTablet && isTouch);

    // Touch target sizes based on device
    // Mobile: 48px (Google Material Design minimum)
    // Tablet: 44px (Apple HIG minimum)
    // Desktop: 40px (can be smaller with precise input)
    const touchTargetSize = isMobile ? 48 : isTablet ? 44 : 40;

    return {
      isMobile,
      isTablet,
      isDesktop,
      orientation,
      isPortrait,
      isLandscape,
      shouldUseMobileUI,
      touchTargetSize,
      safeAreaInsets,
      viewport,
    };
  }, [device, orientation, isTouch, safeAreaInsets, viewport]);
}

/**
 * Simplified hook that just returns whether to use mobile UI
 *
 * @returns true if mobile UI should be used
 */
export function useShouldUseMobileUI(): boolean {
  const { shouldUseMobileUI } = useMobileLayout();
  return shouldUseMobileUI;
}
