/**
 * Responsive module exports
 *
 * @packageDocumentation
 */

export {
  useBreakpoint,
  useDeviceType,
  useTouchTarget,
  useResponsiveValue,
  useMediaQuery,
  usePrefersReducedMotion,
  useIsTouchDevice,
  breakpoints,
  touchTargets,
  type BreakpointName,
  type DeviceType,
  type ResponsiveValues,
} from "./useBreakpoint";

export {
  useOrientation,
  useIsPortrait,
  useIsLandscape,
  type Orientation,
} from "./useOrientation";

export {
  useMobileLayout,
  useShouldUseMobileUI,
  type SafeAreaInsets,
  type MobileLayoutResult,
} from "./useMobileLayout";

export {
  ViewportScaler,
  useViewportScale,
  getDesignResolution,
  DESIGN_WIDTH,
  DESIGN_HEIGHT,
} from "./ViewportScaler";
