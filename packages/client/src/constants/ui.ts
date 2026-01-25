/**
 * UI Configuration
 *
 * Runtime UI configuration values.
 * For design tokens (spacing, typography, etc.), see tokens.ts
 *
 * @see /development-docs/UI_UX_DESIGN_SYSTEM.md
 */

import { zIndex, breakpoints, typography, animation } from "./tokens";

/**
 * UI Configuration Constants
 *
 * These are runtime configuration values, not design tokens.
 * Design tokens are in tokens.ts for consistency.
 */
export const UI = {
  /**
   * Z-Index layers (re-exported from tokens for backwards compatibility)
   * @deprecated Import from tokens.ts directly: `import { zIndex } from './tokens'`
   */
  Z_INDEX: {
    BACKDROP: zIndex.modalBackdrop,
    /**
     * Chat collapsed z-index: 35
     * Intentionally hardcoded between zIndex.raised (10) and zIndex.dropdown (100).
     * This value is not in the shared zIndex tokens because it's specific to the
     * collapsed chat button UI state - it needs to be above raised game elements
     * but below the expanded chat panel (zIndex.chat = 600) and other overlays.
     * The value 35 provides sufficient headroom above raised (10) while staying
     * well below sidebar (300) to avoid stacking context issues.
     */
    CHAT_COLLAPSED: 35,
    CHAT_EXPANDED: zIndex.chat,
    MODAL: zIndex.modal,
    TOOLTIP: zIndex.tooltip,
  },

  /**
   * Fonts (re-exported from tokens for backwards compatibility)
   * @deprecated Import from tokens.ts directly: `import { typography } from './tokens'`
   */
  FONTS: {
    HEADER: typography.fontFamily.display,
    CHAT: typography.fontFamily.body,
    BODY: typography.fontFamily.body,
  },

  /**
   * Breakpoints (re-exported from tokens for backwards compatibility)
   * @deprecated Import from tokens.ts directly: `import { breakpoints } from './tokens'`
   */
  BREAKPOINTS: {
    MOBILE: breakpoints.lg,
    TABLET: breakpoints.xl,
    DESKTOP: breakpoints["2xl"],
  },

  /**
   * Safe area insets for mobile devices
   */
  SAFE_AREAS: {
    TOP: "env(safe-area-inset-top)",
    RIGHT: "env(safe-area-inset-right)",
    BOTTOM: "env(safe-area-inset-bottom)",
    LEFT: "env(safe-area-inset-left)",
  },

  /**
   * Transition presets - uses central animation duration tokens
   */
  TRANSITIONS: {
    FAST: `all ${animation.duration.fast} ${animation.easing.easeOut}`,
    BASE: `all ${animation.duration.base} ${animation.easing.easeInOut}`,
    SLOW: `all ${animation.duration.slow} ${animation.easing.easeInOut}`,
  },
} as const;
