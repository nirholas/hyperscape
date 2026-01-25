/**
 * Color System - Hyperscape UI Theme
 *
 * RuneScape-inspired color palette with modern glass morphism.
 * All colors meet WCAG 2.1 AA contrast requirements.
 *
 * @see /development-docs/UI_UX_DESIGN_SYSTEM.md
 */

/**
 * Core Color Palette
 */
export const COLORS = {
  // ===========================================
  // BRAND / ACCENT COLORS
  // ===========================================

  /** Primary accent - Gold/tan (RuneScape signature) */
  ACCENT: "#f2d08a",
  /** Lighter accent variant */
  ACCENT_LIGHT: "#f7e4b4",
  /** Darker accent variant */
  ACCENT_DARK: "#c9a654",
  /** Chat-specific accent */
  CHAT_ACCENT: "#f7d98c",

  // ===========================================
  // BACKGROUND COLORS (Dark Theme)
  // ===========================================

  /** Primary panel background */
  BG_PRIMARY: "rgba(20, 15, 10, 0.75)",
  /** Secondary/darker background */
  BG_SECONDARY: "rgba(15, 10, 5, 0.85)",
  /** Tertiary/accent background */
  BG_TERTIARY: "rgba(30, 20, 10, 0.9)",
  /** Solid dark background */
  BG_SOLID: "#0b0a15",
  /** Elevated surface */
  BG_ELEVATED: "rgba(25, 20, 15, 0.9)",
  /** Overlay/inset background */
  BG_OVERLAY: "rgba(0, 0, 0, 0.2)",

  // ===========================================
  // BORDER COLORS
  // ===========================================

  /** Primary border (wood brown) */
  BORDER_PRIMARY: "rgba(139, 69, 19, 0.6)",
  /** Secondary/subtle border */
  BORDER_SECONDARY: "rgba(139, 69, 19, 0.3)",
  /** Accent border (gold) */
  BORDER_ACCENT: "rgba(242, 208, 138, 0.4)",
  /** Focus ring color */
  BORDER_FOCUS: "rgba(242, 208, 138, 0.8)",

  // ===========================================
  // TEXT COLORS
  // ===========================================

  /** Primary text (high contrast) */
  TEXT_PRIMARY: "rgba(232, 235, 244, 0.92)",
  /** Secondary text (medium contrast) */
  TEXT_SECONDARY: "rgba(232, 235, 244, 0.75)",
  /** Muted text (low contrast) */
  TEXT_MUTED: "rgba(205, 212, 230, 0.5)",
  /** Disabled text */
  TEXT_DISABLED: "rgba(205, 212, 230, 0.3)",
  /** Inverted text (for light backgrounds) */
  TEXT_INVERTED: "#1a1a2e",

  // ===========================================
  // SEMANTIC / STATUS COLORS
  // ===========================================

  /** Success state */
  SUCCESS: "#22c55e",
  /** Success dark variant */
  SUCCESS_DARK: "#16a34a",
  /** Error state */
  ERROR: "#ef4444",
  /** Error dark variant */
  ERROR_DARK: "#dc2626",
  /** Warning state */
  WARNING: "#f59e0b",
  /** Warning dark variant */
  WARNING_DARK: "#d97706",
  /** Info state */
  INFO: "#3b82f6",
  /** Info dark variant */
  INFO_DARK: "#2563eb",

  // ===========================================
  // INTERACTIVE STATES
  // ===========================================

  /** Hover overlay */
  HOVER: "rgba(255, 255, 255, 0.1)",
  /** Active/pressed overlay */
  ACTIVE: "rgba(255, 255, 255, 0.15)",
  /** Disabled overlay */
  DISABLED: "rgba(0, 0, 0, 0.4)",
  /** Selection highlight */
  SELECTION: "rgba(242, 208, 138, 0.2)",
} as const;

/**
 * Gradient Definitions
 */
export const GRADIENTS = {
  /** Panel background gradient */
  PANEL:
    "linear-gradient(135deg, rgba(20, 15, 10, 0.75) 0%, rgba(15, 10, 5, 0.85) 50%, rgba(20, 15, 10, 0.75) 100%)",

  /** Header gradient */
  HEADER:
    "linear-gradient(180deg, rgba(30, 20, 10, 0.9) 0%, rgba(20, 15, 10, 0.7) 100%)",

  /** Button gradient (wood theme) */
  BUTTON:
    "linear-gradient(135deg, rgba(139, 69, 19, 0.9) 0%, rgba(101, 50, 15, 0.95) 100%)",

  /** Button hover gradient */
  BUTTON_HOVER:
    "linear-gradient(135deg, rgba(159, 89, 39, 0.95) 0%, rgba(121, 70, 35, 1) 100%)",

  /** Decorative divider */
  DIVIDER:
    "linear-gradient(90deg, rgba(242,208,138,0), rgba(242,208,138,0.4) 14%, rgba(255,215,128,0.95) 50%, rgba(242,208,138,0.4) 86%, rgba(242,208,138,0))",

  /** Success gradient */
  SUCCESS: "linear-gradient(180deg, #22c55e 0%, #16a34a 100%)",

  /** Error gradient */
  ERROR: "linear-gradient(180deg, #ef4444 0%, #dc2626 100%)",

  /** Gold shimmer (for rare items) */
  GOLD_SHIMMER:
    "linear-gradient(135deg, #f59e0b 0%, #fbbf24 50%, #f59e0b 100%)",

  /** Purple shimmer (for epic items) */
  PURPLE_SHIMMER:
    "linear-gradient(135deg, #a855f7 0%, #c084fc 50%, #a855f7 100%)",
} as const;

// Type exports
export type ColorKey = keyof typeof COLORS;
export type GradientKey = keyof typeof GRADIENTS;
