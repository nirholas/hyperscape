/**
 * Token Bridge - Unifies client tokens with hs-kit themes
 *
 * This module bridges the design tokens from @hyperscape/client to hs-kit's
 * Theme interface, ensuring a single source of truth for design values.
 *
 * The client package's tokens.ts is authoritative for:
 * - Spacing values
 * - Typography (fonts, sizes, weights, line heights)
 * - Animation timing
 * - Breakpoints
 * - Touch targets
 *
 * The hs-kit themes.ts remains authoritative for:
 * - Color palettes (theme-variant specific)
 * - Glassmorphism settings
 * - Panel/slot configurations
 *
 * @packageDocumentation
 */

import {
  spacing,
  typography,
  borderRadius,
  shadows,
  zIndex,
  animation,
  breakpoints,
  touchTargets,
  parseTokenToNumber,
} from "@hyperscape/client/src/constants/tokens";
import type { Theme } from "../styled/themes";

// Re-export parseTokenToNumber for convenience
export { parseTokenToNumber };

// Re-export tokens for direct access
export {
  spacing,
  typography,
  borderRadius,
  shadows,
  zIndex,
  animation,
  breakpoints,
  touchTargets,
};

/**
 * Color palettes for base theme
 * Kept in hs-kit as colors are theme-variant specific
 */
export const baseColors: Theme["colors"] = {
  background: {
    primary: "#1a1a1a",
    secondary: "#252525",
    tertiary: "#303030",
    overlay: "rgba(0, 0, 0, 0.6)",
    glass: "rgba(26, 26, 26, 0.85)",
  },
  text: {
    primary: "#ffffff",
    secondary: "#b0b0b0",
    muted: "#707070",
    disabled: "#505050",
    link: "#4a9eff",
    accent: "#4a9eff",
  },
  border: {
    default: "#404040",
    hover: "#505050",
    active: "#606060",
    focus: "#4a9eff",
    decorative: "#404040",
  },
  accent: {
    primary: "#4a9eff",
    secondary: "#3b82f6",
    hover: "#5eaaff",
    active: "#3090ee",
  },
  state: {
    success: "#22c55e",
    warning: "#f59e0b",
    danger: "#ef4444",
    info: "#3b82f6",
  },
  status: {
    hp: "#ef4444",
    hpBackground: "#450a0a",
    prayer: "#3b82f6",
    prayerBackground: "#1e3a5f",
    adrenaline: "#f59e0b",
    adrenalineBackground: "#451a03",
    energy: "#22c55e",
    energyBackground: "#14532d",
  },
  slot: {
    empty: "#1a1a1a",
    filled: "#252525",
    hover: "#353535",
    selected: "#404040",
    disabled: "#151515",
  },
};

/**
 * Color palettes for hyperscape theme
 * RS3-inspired dark theme with gold/bronze accents
 */
export const hyperscapeColors: Theme["colors"] = {
  background: {
    primary: "#0d0d0d",
    secondary: "#1a1a1a",
    tertiary: "#252525",
    overlay: "rgba(0, 0, 0, 0.75)",
    glass: "rgba(13, 13, 13, 0.9)",
  },
  text: {
    primary: "#f0e6d3",
    secondary: "#b8a88a",
    muted: "#7a6f5c",
    disabled: "#4a4a4a",
    link: "#d4a84b",
    accent: "#f2d08a",
  },
  border: {
    default: "#3d3224",
    hover: "#5a4a32",
    active: "#7a6a42",
    focus: "#c9a54a",
    decorative: "#8b5a2b",
  },
  accent: {
    primary: "#c9a54a", // Rich classic gold
    secondary: "#f2d08a", // Light gold (matches tokens)
    hover: "#d4b85a",
    active: "#b08930",
  },
  state: {
    success: "#5cb85c",
    warning: "#f0ad4e",
    danger: "#d9534f",
    info: "#5bc0de",
  },
  status: {
    hp: "#c82828",
    hpBackground: "#2d0a0a",
    prayer: "#2e6da4",
    prayerBackground: "#0d1f2d",
    adrenaline: "#c9a54a", // Gold
    adrenalineBackground: "#2d2200",
    energy: "#5cb85c",
    energyBackground: "#0d2d0d",
  },
  slot: {
    empty: "#0d0d0d",
    filled: "#1a1612",
    hover: "#2a241c",
    selected: "#3d3224",
    disabled: "#0a0a0a",
  },
};

/**
 * Creates a Theme object from client tokens with specified color variant
 *
 * @param variant - Theme variant ('base' or 'hyperscape')
 * @returns Complete Theme object with values sourced from client tokens
 *
 * @example
 * ```typescript
 * const theme = createThemeFromTokens('hyperscape');
 * // theme.spacing.md === 16 (from client tokens)
 * // theme.colors === hyperscapeColors (variant-specific)
 * ```
 */
export function createThemeFromTokens(variant: "base" | "hyperscape"): Theme {
  const colors = variant === "hyperscape" ? hyperscapeColors : baseColors;

  return {
    name: variant,
    colors,

    // Spacing from client tokens (converted to numbers)
    spacing: {
      xs: parseTokenToNumber(spacing.xs),
      sm: parseTokenToNumber(spacing.sm),
      md: parseTokenToNumber(spacing.md),
      lg: parseTokenToNumber(spacing.lg),
      xl: parseTokenToNumber(spacing.xl),
      xxl: parseTokenToNumber(spacing["2xl"]),
      grid: 8,
    },

    // Typography from client tokens
    typography: {
      fontFamily: {
        body: typography.fontFamily.body,
        heading: typography.fontFamily.display,
        mono: typography.fontFamily.mono,
      },
      fontSize: {
        xs: typography.fontSize["2xs"],
        sm: typography.fontSize.xs,
        base: typography.fontSize.sm,
        lg: typography.fontSize.base,
        xl: typography.fontSize.xl,
        xxl: typography.fontSize["2xl"],
      },
      fontWeight: {
        normal: parseTokenToNumber(typography.fontWeight.normal),
        medium: parseTokenToNumber(typography.fontWeight.medium),
        semibold: parseTokenToNumber(typography.fontWeight.semibold),
        bold: parseTokenToNumber(typography.fontWeight.bold),
      },
      lineHeight: {
        tight: parseTokenToNumber(typography.lineHeight.tight),
        normal: parseTokenToNumber(typography.lineHeight.normal),
        relaxed: parseTokenToNumber(typography.lineHeight.relaxed),
      },
    },

    // Border radius from client tokens
    borderRadius: {
      none: parseTokenToNumber(borderRadius.none),
      sm: parseTokenToNumber(borderRadius.xs),
      md: parseTokenToNumber(borderRadius.sm),
      lg: parseTokenToNumber(borderRadius.md),
      xl: parseTokenToNumber(borderRadius.lg),
      full: borderRadius.full,
    },

    // Shadows from client tokens
    shadows: {
      none: shadows.none,
      sm: shadows.xs,
      md: shadows.sm,
      lg: shadows.md,
      xl: shadows.lg,
      window: shadows.panel,
      glow: `0 0 20px rgba(${variant === "hyperscape" ? "201, 165, 74" : "74, 158, 255"}, 0.3)`,
    },

    // Z-index from client tokens
    zIndex: {
      base: zIndex.base,
      dropdown: zIndex.dropdown,
      sticky: zIndex.sticky,
      window: zIndex.panel,
      overlay: zIndex.overlay,
      modal: zIndex.modal,
      popover: zIndex.contextMenu,
      tooltip: zIndex.tooltip,
    },

    // Transitions from client animation tokens
    transitions: {
      fast: `${animation.duration.fast} ${animation.easing.easeOut}`,
      normal: `${animation.duration.base} ${animation.easing.easeInOut}`,
      slow: `${animation.duration.slow} ${animation.easing.easeInOut}`,
    },

    // Glassmorphism settings (theme-variant specific)
    glass:
      variant === "hyperscape"
        ? { blur: 16, opacity: 0.9, borderOpacity: 0.4 }
        : { blur: 12, opacity: 0.85, borderOpacity: 0.3 },

    // Panel settings
    panel: {
      headerHeight: variant === "hyperscape" ? 28 : 32,
      borderWidth: 1,
      minWidth: 200,
      minHeight: 150,
    },

    // Slot settings
    slot: {
      size: 36,
      gap: variant === "hyperscape" ? 2 : 4,
      borderRadius: variant === "hyperscape" ? 2 : 4,
      iconSize: 32,
    },

    // Window system configuration
    window: {
      resizeHandleSize: 8,
      resizeCornerSize: 12,
      edgeSnapThreshold: 15,
      guideSnapThreshold: 10,
    },
  };
}

/**
 * Pre-built themes using token bridge
 * These can be used as drop-in replacements for the legacy themes
 */
export const bridgedThemes = {
  base: createThemeFromTokens("base"),
  hyperscape: createThemeFromTokens("hyperscape"),
} as const;

/**
 * Breakpoint utilities
 */
export const breakpointValues = breakpoints;

/**
 * Touch target size utilities
 */
export const touchTargetValues = touchTargets;

/**
 * Get the minimum touch target size for a device type
 */
export function getMinTouchTarget(
  device: "mobile" | "tablet" | "desktop",
): string {
  switch (device) {
    case "mobile":
      return touchTargets.md; // 48px
    case "tablet":
      return touchTargets.apple; // 44px
    case "desktop":
      return touchTargets.sm; // 40px
  }
}

/**
 * Animation utilities re-exported from client tokens
 */
export const animationDurations = animation.duration;
export const animationEasings = animation.easing;
