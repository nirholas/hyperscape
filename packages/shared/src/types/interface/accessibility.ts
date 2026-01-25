/**
 * Accessibility Settings Types
 *
 * Defines types for accessibility features including colorblind modes,
 * high contrast, reduced motion, font sizing, and keyboard navigation.
 *
 * @packageDocumentation
 */

/** Colorblind mode options */
export type ColorblindMode =
  | "none"
  | "protanopia"
  | "deuteranopia"
  | "tritanopia";

/** Font size options */
export type FontSizeOption = "small" | "medium" | "large" | "xlarge";

/** Complete accessibility settings interface */
export interface AccessibilitySettings {
  /** Colorblind mode for color adjustments */
  colorblindMode: ColorblindMode;
  /** Enable high contrast mode for better visibility */
  highContrast: boolean;
  /** Reduce animations for motion sensitivity */
  reducedMotion: boolean;
  /** Font size preference */
  fontSize: FontSizeOption;
  /** Enable full keyboard navigation support */
  keyboardNavigation: boolean;
}

/** Color overrides for colorblind modes */
export interface ColorOverrides {
  health?: string;
  danger?: string;
  success?: string;
  mana?: string;
  info?: string;
  primary?: string;
  link?: string;
  energy?: string;
}

/**
 * Colorblind-safe color palettes
 *
 * Each mode replaces problematic color combinations with
 * distinguishable alternatives:
 * - Protanopia: Red-blind - replace red/green with blue/orange
 * - Deuteranopia: Green-blind - replace green with yellow/blue
 * - Tritanopia: Blue-blind - replace blue with green/yellow
 */
export const COLORBLIND_PALETTES: Record<ColorblindMode, ColorOverrides> = {
  none: {},
  protanopia: {
    health: "#42A5F5",
    danger: "#FFA726",
    success: "#42A5F5",
    energy: "#2196F3",
  },
  deuteranopia: {
    health: "#42A5F5",
    success: "#FFD54F",
    danger: "#FFA726",
    energy: "#42A5F5",
  },
  tritanopia: {
    mana: "#66BB6A",
    info: "#FFD54F",
    primary: "#26A69A",
    link: "#26A69A",
  },
};

/** Font size scale multipliers */
export const FONT_SIZE_SCALE: Record<FontSizeOption, number> = {
  small: 0.875,
  medium: 1.0,
  large: 1.125,
  xlarge: 1.25,
};

/** Default accessibility settings */
export const DEFAULT_ACCESSIBILITY_SETTINGS: AccessibilitySettings = {
  colorblindMode: "none",
  highContrast: false,
  reducedMotion: false,
  fontSize: "medium",
  keyboardNavigation: false,
};
