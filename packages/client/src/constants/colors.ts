/**
 * Color System - Hyperscape UI Theme
 *
 * RuneScape-inspired color palette with modern glass morphism.
 * All colors meet WCAG 2.1 AA contrast requirements.
 *
 * @see /development-docs/UI_UX_DESIGN_SYSTEM.md
 */

/**
 * Core Color Palette - Dark Theme
 * Matches hyperscapeTheme from hs-kit for consistency
 */
export const COLORS = {
  // ===========================================
  // BRAND / ACCENT COLORS
  // ===========================================

  /** Primary accent - Rich classic gold */
  ACCENT: "#d4a84b",
  /** Lighter accent variant - Bright gold highlight */
  ACCENT_LIGHT: "#ffd866",
  /** Darker accent variant */
  ACCENT_DARK: "#c49530",
  /** Chat-specific accent */
  CHAT_ACCENT: "#e8c55a",

  // ===========================================
  // BACKGROUND COLORS (Dark Theme)
  // ===========================================

  /** Primary panel background - Dark with slight warmth */
  BG_PRIMARY: "#121214",
  /** Secondary/darker background - Slightly lighter */
  BG_SECONDARY: "#1a1a1e",
  /** Tertiary/accent background - Elevated surface */
  BG_TERTIARY: "#242428",
  /** Solid dark background */
  BG_SOLID: "#121214",
  /** Elevated surface */
  BG_ELEVATED: "#242428",
  /** Overlay/inset background */
  BG_OVERLAY: "rgba(0, 0, 0, 0.75)",

  // ===========================================
  // BORDER COLORS
  // ===========================================

  /** Primary border - Subtle brown border */
  BORDER_PRIMARY: "#2d2820",
  /** Secondary/subtle border */
  BORDER_SECONDARY: "#2d2820",
  /** Accent border (gold) */
  BORDER_ACCENT: "#4a3f30",
  /** Focus ring color - Bright gold */
  BORDER_FOCUS: "#e8c55a",

  // ===========================================
  // TEXT COLORS
  // ===========================================

  /** Primary text - Warm white */
  TEXT_PRIMARY: "#f5f0e8",
  /** Secondary text - Muted gold */
  TEXT_SECONDARY: "#c4b896",
  /** Muted text - Subtle brown */
  TEXT_MUTED: "#7d7460",
  /** Disabled text */
  TEXT_DISABLED: "#454545",
  /** Inverted text (for light backgrounds) */
  TEXT_INVERTED: "#0a0a0c",

  // ===========================================
  // SEMANTIC / STATUS COLORS
  // ===========================================

  /** Success state - Modern green */
  SUCCESS: "#4ade80",
  /** Success dark variant */
  SUCCESS_DARK: "#22c55e",
  /** Error state - Soft red */
  ERROR: "#f87171",
  /** Error dark variant */
  ERROR_DARK: "#dc2626",
  /** Warning state - Bright amber */
  WARNING: "#fbbf24",
  /** Warning dark variant */
  WARNING_DARK: "#f59e0b",
  /** Info state - Soft blue */
  INFO: "#60a5fa",
  /** Info dark variant */
  INFO_DARK: "#3b82f6",

  // ===========================================
  // INTERACTIVE STATES
  // ===========================================

  /** Hover overlay */
  HOVER: "#2a2a30",
  /** Active/pressed overlay */
  ACTIVE: "#3d3830",
  /** Disabled overlay */
  DISABLED: "#0e0e0e",
  /** Selection highlight */
  SELECTION: "#3d3830",
} as const;

/**
 * Gradient Definitions - Dark Theme
 */
export const GRADIENTS = {
  /** Panel background gradient - Dark theme */
  PANEL: "linear-gradient(135deg, #121214 0%, #1a1a1e 50%, #121214 100%)",

  /** Header gradient - Dark theme */
  HEADER: "linear-gradient(180deg, #242428 0%, #1a1a1e 100%)",

  /** Button gradient - Gold accent */
  BUTTON: "linear-gradient(135deg, #d4a84b 0%, #c49530 100%)",

  /** Button hover gradient */
  BUTTON_HOVER: "linear-gradient(135deg, #e8be5a 0%, #d4a84b 100%)",

  /** Decorative divider - Gold */
  DIVIDER:
    "linear-gradient(90deg, transparent, #d4a84b40 14%, #ffd86699 50%, #d4a84b40 86%, transparent)",

  /** Success gradient */
  SUCCESS: "linear-gradient(180deg, #4ade80 0%, #22c55e 100%)",

  /** Error gradient */
  ERROR: "linear-gradient(180deg, #f87171 0%, #dc2626 100%)",

  /** Gold shimmer (for rare items) */
  GOLD_SHIMMER:
    "linear-gradient(135deg, #d4a84b 0%, #ffd866 50%, #d4a84b 100%)",

  /** Purple shimmer (for epic items) */
  PURPLE_SHIMMER:
    "linear-gradient(135deg, #a855f7 0%, #c084fc 50%, #a855f7 100%)",
} as const;

// Type exports
export type ColorKey = keyof typeof COLORS;
export type GradientKey = keyof typeof GRADIENTS;
