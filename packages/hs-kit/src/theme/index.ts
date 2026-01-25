/**
 * Theme module exports
 *
 * Provides unified access to the token bridge and theme utilities.
 *
 * @packageDocumentation
 */

export {
  // Token bridge
  createThemeFromTokens,
  bridgedThemes,
  parseTokenToNumber,
  // Color palettes
  baseColors,
  hyperscapeColors,
  // Re-exported tokens
  spacing,
  typography,
  borderRadius,
  shadows,
  zIndex,
  animation,
  breakpoints,
  touchTargets,
  // Utilities
  breakpointValues,
  touchTargetValues,
  getMinTouchTarget,
  animationDurations,
  animationEasings,
} from "./tokenBridge";
