/**
 * Interface Types
 *
 * Types for UI/UX systems including accessibility and complexity modes.
 *
 * @packageDocumentation
 */

export {
  type AccessibilitySettings,
  type ColorblindMode,
  type FontSizeOption,
  type ColorOverrides,
  COLORBLIND_PALETTES,
  FONT_SIZE_SCALE,
  DEFAULT_ACCESSIBILITY_SETTINGS,
} from "./accessibility";

export {
  type ComplexityMode,
  type ComplexityFeatures,
  type ComplexityModeConfig,
  type ProgressionThresholds,
  COMPLEXITY_MODE_CONFIGS,
  DEFAULT_PROGRESSION_THRESHOLDS,
} from "./complexity";
