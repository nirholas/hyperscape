/**
 * Panel Registry
 *
 * Maps panel IDs to React components for the InterfaceManager.
 * This provides the default panel rendering for all game UI panels.
 *
 * Panels are designed to be self-contained and fetch their data from
 * the world instance, so the registry mainly handles lazy loading
 * and fallback rendering.
 *
 * @packageDocumentation
 */

import React, {
  Suspense,
  lazy,
  type ReactNode,
  useRef,
  useState,
  useEffect,
  useMemo,
} from "react";
import type {
  ClientWorld,
  InventorySlotItem,
  PlayerEquipmentItems,
} from "../../types";
import type { PlayerStats } from "@hyperscape/shared";
import { Minimap } from "../../game/hud/Minimap";
import { MenuButton, type MenuIconName } from "@/ui";
import { ChatPanel } from "../../game/panels/ChatPanel";
import {
  ActionBarPanel,
  ACTION_BAR_DIMENSIONS,
} from "../../game/panels/ActionBarPanel";
import { PRAYER_PANEL_DIMENSIONS } from "../../game/panels/PrayerPanel";
import {
  PresetPanel,
  AccessibilityPanel,
  useWindowStore,
  useThemeStore,
} from "@/ui";

/** Size dimensions type */
export interface PanelSize {
  width: number;
  height: number;
}

/** Responsive size configuration for different viewport sizes */
export interface ResponsiveSizes {
  /** Size for mobile viewports (<768px) */
  mobile?: PanelSize;
  /** Size for tablet viewports (768px-1024px) */
  tablet?: PanelSize;
  /** Size for desktop viewports (>1024px) - defaults to preferredSize */
  desktop?: PanelSize;
}

/** Mobile drawer types for hybrid panel system */
export type MobileDrawerType = "sheet" | "modal" | "overlay";

/** Mobile drawer height presets */
export type MobileDrawerHeight = "compact" | "half" | "full";

/** Mobile landscape panel position */
export type MobileLandscapePosition = "left" | "right" | "modal";

/** Mobile-specific layout configuration */
export interface MobileLayoutConfig {
  /** How the panel opens on mobile (sheet=bottom drawer, modal=fullscreen, overlay=floating) */
  drawerType: MobileDrawerType;
  /** Default height for drawer (compact=30vh, half=50vh, full=90vh) */
  drawerHeight: MobileDrawerHeight;
  /** Position in landscape mode */
  landscapePosition: MobileLandscapePosition;
  /** Grid columns override for mobile (e.g., 4 for 4-column inventory) */
  gridColumns?: number;
  /** Whether to show in compact/simplified mode on mobile */
  compact?: boolean;
}

/** Panel sizing and behavior configuration */
export interface PanelConfig {
  /** Minimum size the panel can be resized to */
  minSize: PanelSize;
  /** Preferred/default size for this panel (used as base for scaling) */
  preferredSize: PanelSize;
  /** Maximum size (optional) */
  maxSize?: PanelSize;
  /** Whether the panel content should scroll when smaller than content */
  scrollable: boolean;
  /** Whether the panel can be resized at all */
  resizable: boolean;
  /** Responsive sizes for different viewport breakpoints */
  responsive?: ResponsiveSizes;
  /**
   * Scale factor range for smooth viewport scaling
   * minScale: minimum scale factor (e.g., 0.75 = 75% of preferredSize)
   * maxScale: maximum scale factor (e.g., 1.25 = 125% of preferredSize)
   */
  scaleFactor?: {
    min: number;
    max: number;
  };
  /** Aspect ratio to maintain during resize (width/height) */
  aspectRatio?: number;
  /** Mobile-specific layout configuration */
  mobileLayout?: MobileLayoutConfig;
}

/** Base resolution for scale calculations (1080p) */
const BASE_VIEWPORT = { width: 1920, height: 1080 };

/**
 * Calculate a responsive size based on viewport and panel config
 *
 * @param baseSize - The base size to scale from
 * @param viewport - Current viewport dimensions
 * @param scaleFactor - Min/max scale factors
 * @returns Scaled size that fits the viewport
 */
export function calculateResponsiveSize(
  baseSize: PanelSize,
  viewport: PanelSize,
  scaleFactor: { min: number; max: number } = { min: 0.75, max: 1.25 },
): PanelSize {
  // Calculate scale based on viewport relative to base resolution
  const widthScale = viewport.width / BASE_VIEWPORT.width;
  const heightScale = viewport.height / BASE_VIEWPORT.height;

  // Use the smaller scale to maintain proportions, clamped to scale factor range
  const rawScale = Math.min(widthScale, heightScale);
  const scale = Math.max(scaleFactor.min, Math.min(scaleFactor.max, rawScale));

  return {
    width: Math.round(baseSize.width * scale),
    height: Math.round(baseSize.height * scale),
  };
}

/**
 * Get the appropriate panel size for a given device type
 *
 * @param config - Panel configuration
 * @param deviceType - Current device type (mobile, tablet, desktop)
 * @param viewport - Current viewport dimensions (for smooth scaling)
 * @returns The appropriate size for this panel
 */
export function getResponsivePanelSize(
  config: PanelConfig,
  deviceType: "mobile" | "tablet" | "desktop",
  viewport?: PanelSize,
): PanelSize {
  // First check for explicit responsive breakpoint sizes
  if (config.responsive) {
    const breakpointSize = config.responsive[deviceType];
    if (breakpointSize) {
      return breakpointSize;
    }
  }

  // If viewport is provided and scale factor is configured, use smooth scaling
  if (viewport && config.scaleFactor) {
    return calculateResponsiveSize(
      config.preferredSize,
      viewport,
      config.scaleFactor,
    );
  }

  // Default fallback based on device type with preset scale factors
  const deviceScales = {
    mobile: 0.85,
    tablet: 0.95,
    desktop: 1.0,
  };

  const scale = deviceScales[deviceType];
  return {
    width: Math.round(config.preferredSize.width * scale),
    height: Math.round(config.preferredSize.height * scale),
  };
}

// ============================================================================
// MENUBAR DIMENSIONS (defined before PANEL_CONFIG to avoid hoisting issues)
// ============================================================================

// Menu bar configuration constants (similar to ActionBarPanel)
const MENUBAR_MIN_BUTTONS = 4;
const MENUBAR_MAX_BUTTONS = 9; // ALL_MENU_BUTTONS.length - defined inline to avoid circular reference
const MENUBAR_DEFAULT_BUTTONS = 9;

// Special panel IDs that open modals instead of windows
export const MODAL_PANEL_IDS = ["map", "stats", "death"] as const;
export type ModalPanelId = (typeof MODAL_PANEL_IDS)[number];
const MENUBAR_BUTTON_SIZE = 30; // Size of each button (matches MenuButton compact size)
const MENUBAR_BUTTON_GAP = 3; // Gap between buttons
const MENUBAR_PADDING = 6; // Padding around buttons
const MENUBAR_CONTROL_SIZE = 20; // Size of +/- control buttons
const MENUBAR_CONTROL_GAP = 4; // Gap between controls and buttons

// Grid layout configuration (2 columns x N rows)
const MENUBAR_GRID_COLUMNS = 2;

/**
 * Calculate menubar dimensions for horizontal layout (1 row x N columns)
 * Based on visible controls (like ActionBarPanel)
 */
function calcMenubarHorizontalDimensions(
  buttonCount: number,
  options: { isEditMode?: boolean } = {},
): {
  width: number;
  height: number;
} {
  const { isEditMode = false } = options;

  // Buttons grid width: buttons + gaps + padding
  const buttonsWidth =
    buttonCount * MENUBAR_BUTTON_SIZE +
    (buttonCount - 1) * MENUBAR_BUTTON_GAP +
    MENUBAR_PADDING * 2;

  // Left side: - button only in edit mode
  const leftWidth = isEditMode ? MENUBAR_CONTROL_SIZE + MENUBAR_CONTROL_GAP : 0;

  // Right side: + button only in edit mode
  const rightWidth = isEditMode
    ? MENUBAR_CONTROL_GAP + MENUBAR_CONTROL_SIZE
    : 0;

  return {
    width: leftWidth + buttonsWidth + rightWidth,
    height: MENUBAR_BUTTON_SIZE + MENUBAR_PADDING * 2,
  };
}

/**
 * Calculate menubar dimensions for grid layout (2 columns x N rows)
 * Based on visible controls (like ActionBarPanel)
 */
function calcMenubarGridDimensions(
  buttonCount: number,
  options: { isEditMode?: boolean } = {},
): {
  width: number;
  height: number;
  rows: number;
} {
  const { isEditMode = false } = options;
  const rows = Math.ceil(buttonCount / MENUBAR_GRID_COLUMNS);

  // Top/bottom controls only in edit mode
  const controlHeight = isEditMode
    ? MENUBAR_CONTROL_SIZE + MENUBAR_CONTROL_GAP
    : 0;

  return {
    width:
      MENUBAR_GRID_COLUMNS * MENUBAR_BUTTON_SIZE +
      (MENUBAR_GRID_COLUMNS - 1) * MENUBAR_BUTTON_GAP +
      MENUBAR_PADDING * 2,
    height:
      rows * MENUBAR_BUTTON_SIZE +
      (rows - 1) * MENUBAR_BUTTON_GAP +
      MENUBAR_PADDING * 2 +
      controlHeight * 2,
    rows,
  };
}

// Buffer for borders (1px each side) and box-shadow visual expansion
const MENUBAR_BORDER_BUFFER = 4;

// Pre-calculate grid dimensions for min size (allows resizing to grid layout)
const gridDims = calcMenubarGridDimensions(MENUBAR_MAX_BUTTONS, {
  isEditMode: false,
});

/** Exported menubar dimensions for panel config (supports both layouts) */
export const MENUBAR_DIMENSIONS = {
  minButtons: MENUBAR_MIN_BUTTONS,
  maxButtons: MENUBAR_MAX_BUTTONS,
  defaultButtons: MENUBAR_DEFAULT_BUTTONS,
  buttonSize: MENUBAR_BUTTON_SIZE,
  buttonGap: MENUBAR_BUTTON_GAP,
  padding: MENUBAR_PADDING,
  controlSize: MENUBAR_CONTROL_SIZE,
  controlGap: MENUBAR_CONTROL_GAP,
  gridColumns: MENUBAR_GRID_COLUMNS,
  // Default horizontal layout (9 buttons) - normal mode (no edit controls)
  ...calcMenubarHorizontalDimensions(MENUBAR_DEFAULT_BUTTONS, {
    isEditMode: false,
  }),
  // Minimum size: grid layout (2 columns) - allows collapsing to vertical
  minWidth: gridDims.width + MENUBAR_BORDER_BUFFER,
  minHeight:
    calcMenubarHorizontalDimensions(MENUBAR_MIN_BUTTONS, { isEditMode: false })
      .height + MENUBAR_BORDER_BUFFER,
  // Maximum size (9-button horizontal layout in edit mode)
  maxWidth:
    calcMenubarHorizontalDimensions(MENUBAR_MAX_BUTTONS, { isEditMode: true })
      .width + MENUBAR_BORDER_BUFFER,
  maxHeight: gridDims.height + MENUBAR_BORDER_BUFFER,
};

// ============================================================================
// PANEL CONFIGURATION REGISTRY
// ============================================================================

/**
 * Panel configuration registry
 * Defines sizing constraints and behavior for each panel type
 *
 * Each panel has:
 * - Base sizes (min, preferred, max)
 * - Scale factor range for smooth viewport scaling (default: 0.8-1.2)
 * - Optional responsive breakpoint sizes for mobile/tablet/desktop
 * - Aspect ratio for panels that need to maintain proportions
 */
export const PANEL_CONFIG: Record<string, PanelConfig> = {
  // Inventory - fixed grid layout (4x7), panel handles own overflow
  inventory: {
    minSize: { width: 260, height: 340 },
    preferredSize: { width: 320, height: 420 },
    maxSize: { width: 420, height: 550 },
    scrollable: false,
    resizable: true,
    scaleFactor: { min: 0.85, max: 1.15 },
    responsive: {
      mobile: { width: 260, height: 360 },
      tablet: { width: 290, height: 390 },
      desktop: { width: 320, height: 420 },
    },
    mobileLayout: {
      drawerType: "sheet",
      drawerHeight: "half",
      landscapePosition: "right",
      gridColumns: 4,
    },
  },
  // Equipment - fixed layout, needs specific dimensions for slot arrangement
  equipment: {
    minSize: { width: 210, height: 290 },
    preferredSize: { width: 260, height: 360 },
    maxSize: { width: 390, height: 550 },
    scrollable: false,
    resizable: true,
    scaleFactor: { min: 0.85, max: 1.15 },
    responsive: {
      mobile: { width: 215, height: 310 },
      tablet: { width: 235, height: 340 },
      desktop: { width: 260, height: 360 },
    },
    mobileLayout: {
      drawerType: "sheet",
      drawerHeight: "half",
      landscapePosition: "right",
      compact: true,
    },
  },
  // Stats - full skills display with combat, gathering, production sections
  stats: {
    // Minimum size ensures all content visible without cutoff
    minSize: { width: 255, height: 345 },
    preferredSize: { width: 275, height: 370 },
    // Max size allows modest expansion without oversizing
    maxSize: { width: 325, height: 440 },
    scrollable: false, // Content fits within bounds
    resizable: true,
    // Tight scale limits for readability
    scaleFactor: { min: 0.92, max: 1.1 },
    responsive: {
      mobile: { width: 255, height: 345 },
      tablet: { width: 265, height: 365 },
      desktop: { width: 275, height: 370 },
    },
    mobileLayout: {
      drawerType: "modal",
      drawerHeight: "full",
      landscapePosition: "modal",
    },
  },
  // Skills - 3x4 grid of skill icons with total/combat level footer
  // Mobile size matches Prayer panel for consistent tab switching
  skills: {
    minSize: { width: 235, height: 310 },
    preferredSize: { width: 325, height: 400 },
    maxSize: { width: 390, height: 470 },
    scrollable: false,
    resizable: true,
    scaleFactor: { min: 0.85, max: 1.15 },
    responsive: {
      mobile: {
        width: PRAYER_PANEL_DIMENSIONS.layouts.fourCol.width,
        height: PRAYER_PANEL_DIMENSIONS.layouts.fourCol.height,
      },
      tablet: { width: 305, height: 385 },
      desktop: { width: 325, height: 400 },
    },
    mobileLayout: {
      drawerType: "sheet",
      drawerHeight: "half",
      landscapePosition: "right",
      gridColumns: 4,
    },
  },
  // Prayer - grid of prayer icons with adaptive layout
  prayer: {
    minSize: {
      width: PRAYER_PANEL_DIMENSIONS.minWidth,
      height: PRAYER_PANEL_DIMENSIONS.minHeight,
    },
    preferredSize: {
      width: PRAYER_PANEL_DIMENSIONS.defaultWidth,
      height: PRAYER_PANEL_DIMENSIONS.defaultHeight,
    },
    maxSize: {
      width: PRAYER_PANEL_DIMENSIONS.maxWidth,
      height: PRAYER_PANEL_DIMENSIONS.maxHeight,
    },
    scrollable: false,
    resizable: true,
    scaleFactor: { min: 0.8, max: 1.2 },
    responsive: {
      mobile: {
        width: PRAYER_PANEL_DIMENSIONS.layouts.threeCol.width,
        height: PRAYER_PANEL_DIMENSIONS.layouts.threeCol.height,
      },
      tablet: {
        width: PRAYER_PANEL_DIMENSIONS.layouts.fourCol.width,
        height: PRAYER_PANEL_DIMENSIONS.layouts.fourCol.height,
      },
      desktop: {
        width: PRAYER_PANEL_DIMENSIONS.defaultWidth,
        height: PRAYER_PANEL_DIMENSIONS.defaultHeight,
      },
    },
    mobileLayout: {
      drawerType: "sheet",
      drawerHeight: "half",
      landscapePosition: "right",
      gridColumns: 4,
    },
  },
  // Combat - combat stats and style selector
  combat: {
    minSize: { width: 235, height: 235 },
    preferredSize: { width: 310, height: 360 },
    maxSize: { width: 420, height: 470 },
    scrollable: false,
    resizable: true,
    scaleFactor: { min: 0.8, max: 1.2 },
    responsive: {
      mobile: { width: 260, height: 310 },
      tablet: { width: 285, height: 340 },
      desktop: { width: 310, height: 360 },
    },
    mobileLayout: {
      drawerType: "sheet",
      drawerHeight: "compact",
      landscapePosition: "left",
      compact: true,
    },
  },
  // Settings - toggles and sliders, panel handles own scrolling
  settings: {
    minSize: { width: 290, height: 340 },
    preferredSize: { width: 360, height: 470 },
    maxSize: { width: 500, height: 620 },
    scrollable: false,
    resizable: true,
    scaleFactor: { min: 0.8, max: 1.15 },
    responsive: {
      mobile: { width: 310, height: 390 },
      tablet: { width: 340, height: 430 },
      desktop: { width: 360, height: 470 },
    },
    mobileLayout: {
      drawerType: "modal",
      drawerHeight: "full",
      landscapePosition: "modal",
    },
  },
  // Minimap - no max size for flexible resizing, no aspect ratio for independent width/height
  minimap: {
    minSize: { width: 235, height: 235 },
    preferredSize: { width: 550, height: 550 },
    // No maxSize - allow unlimited resizing in edit mode
    // No aspectRatio - allow independent width/height resizing
    scrollable: false,
    resizable: true,
    scaleFactor: { min: 0.6, max: 1.2 },
    responsive: {
      mobile: { width: 260, height: 260 },
      tablet: { width: 420, height: 420 },
      desktop: { width: 550, height: 550 },
    },
    mobileLayout: {
      drawerType: "overlay",
      drawerHeight: "compact",
      landscapePosition: "left",
      compact: true,
    },
  },
  // Chat - needs width for messages, panel handles own scrolling
  chat: {
    minSize: { width: 130, height: 195 },
    preferredSize: { width: 520, height: 585 },
    // No maxSize - allow unlimited resizing in edit mode (like minimap)
    scrollable: false,
    resizable: true,
    // No scaleFactor - use preferredSize directly without scaling limits
    responsive: {
      mobile: { width: 260, height: 390 },
      tablet: { width: 260, height: 495 },
      desktop: { width: 520, height: 585 },
    },
    mobileLayout: {
      drawerType: "overlay",
      drawerHeight: "compact",
      landscapePosition: "left",
    },
  },
  // Presets - layout management, panel handles own layout
  presets: {
    minSize: { width: 235, height: 235 },
    preferredSize: { width: 340, height: 390 },
    maxSize: { width: 440, height: 520 },
    scrollable: false,
    resizable: true,
    scaleFactor: { min: 0.8, max: 1.15 },
    responsive: {
      mobile: { width: 285, height: 340 },
      tablet: { width: 310, height: 365 },
      desktop: { width: 340, height: 390 },
    },
    mobileLayout: {
      drawerType: "modal",
      drawerHeight: "full",
      landscapePosition: "modal",
    },
  },
  // Accessibility settings panel
  accessibility: {
    minSize: { width: 290, height: 390 },
    preferredSize: { width: 360, height: 520 },
    maxSize: { width: 470, height: 680 },
    scrollable: false,
    resizable: true,
    scaleFactor: { min: 0.85, max: 1.15 },
    responsive: {
      mobile: { width: 325, height: 470 },
      tablet: { width: 345, height: 495 },
      desktop: { width: 360, height: 520 },
    },
    mobileLayout: {
      drawerType: "modal",
      drawerHeight: "full",
      landscapePosition: "modal",
    },
  },
  // Action bar - configurable layout with +/- controls
  // Supports layouts: 7x1 (default horizontal), 9x1, 3x3, 2x4, 4x2, 1x7, 1x9
  // Uses actual calculated dimensions from ActionBarPanel to prevent resizing larger than content
  actionbar: {
    // Minimum: Allow compact layouts
    minSize: {
      width: ACTION_BAR_DIMENSIONS.minWidth,
      height: ACTION_BAR_DIMENSIONS.minHeight,
    },
    // Default: 7-slot horizontal (7x1) with controls
    preferredSize: {
      width: ACTION_BAR_DIMENSIONS.defaultWidth,
      height: ACTION_BAR_DIMENSIONS.defaultHeight,
    },
    // Maximum: 9-slot horizontal layout (horizontal-only layout system)
    maxSize: {
      width: ACTION_BAR_DIMENSIONS.maxWidth,
      height: ACTION_BAR_DIMENSIONS.maxHeight,
    },
    scrollable: false,
    resizable: true,
    scaleFactor: { min: 0.85, max: 1.2 },
    responsive: {
      mobile: { width: 280, height: ACTION_BAR_DIMENSIONS.defaultHeight },
      tablet: { width: 320, height: ACTION_BAR_DIMENSIONS.defaultHeight },
      desktop: {
        width: ACTION_BAR_DIMENSIONS.defaultWidth,
        height: ACTION_BAR_DIMENSIONS.defaultHeight,
      },
    },
  },
  // Menu bar - responsive grid of panel buttons
  // Buttons scale to fit container, supports various grid layouts (1-5 rows)
  menubar: {
    // Minimum: compact grid with small buttons (reduced for flexibility)
    minSize: { width: 70, height: 36 },
    // Default: horizontal row of 9 buttons with slight padding for grab area
    preferredSize: { width: 340, height: 58 },
    // Maximum: large buttons in horizontal layout
    maxSize: { width: 520, height: 300 },
    scrollable: false,
    resizable: true,
    scaleFactor: { min: 0.7, max: 1.4 },
    responsive: {
      mobile: { width: 180, height: 100 },
      tablet: { width: 300, height: 58 },
      desktop: { width: 340, height: 58 },
    },
  },
  // Bank - large grid, panel handles own scrolling
  bank: {
    minSize: { width: 365, height: 365 },
    preferredSize: { width: 520, height: 520 },
    maxSize: { width: 780, height: 780 },
    scrollable: false,
    resizable: true,
    scaleFactor: { min: 0.75, max: 1.25 },
    responsive: {
      mobile: { width: 420, height: 440 },
      tablet: { width: 470, height: 480 },
      desktop: { width: 520, height: 520 },
    },
    mobileLayout: {
      drawerType: "modal",
      drawerHeight: "full",
      landscapePosition: "modal",
    },
  },
  // Store - item list, panel handles own layout
  store: {
    minSize: { width: 340, height: 365 },
    preferredSize: { width: 420, height: 520 },
    maxSize: { width: 585, height: 715 },
    scrollable: false,
    resizable: true,
    scaleFactor: { min: 0.8, max: 1.2 },
    responsive: {
      mobile: { width: 365, height: 440 },
      tablet: { width: 390, height: 480 },
      desktop: { width: 420, height: 520 },
    },
    mobileLayout: {
      drawerType: "modal",
      drawerHeight: "full",
      landscapePosition: "modal",
    },
  },
  // Quests - quest list, panel handles own layout
  quests: {
    minSize: { width: 260, height: 300 },
    preferredSize: { width: 365, height: 455 },
    maxSize: { width: 495, height: 610 },
    scrollable: false,
    resizable: true,
    scaleFactor: { min: 0.8, max: 1.2 },
    responsive: {
      mobile: { width: 310, height: 390 },
      tablet: { width: 340, height: 420 },
      desktop: { width: 365, height: 455 },
    },
  },
  // Quest Detail - separate window for quest details
  "quest-detail": {
    minSize: { width: 420, height: 520 },
    preferredSize: { width: 520, height: 650 },
    maxSize: { width: 650, height: 910 },
    scrollable: true,
    resizable: true,
    scaleFactor: { min: 0.85, max: 1.15 },
    responsive: {
      mobile: { width: 390, height: 520 },
      tablet: { width: 455, height: 585 },
      desktop: { width: 520, height: 650 },
    },
    mobileLayout: {
      drawerType: "modal",
      drawerHeight: "full",
      landscapePosition: "modal",
    },
  },
  // Friends - player list, panel handles own layout
  friends: {
    minSize: { width: 235, height: 235 },
    preferredSize: { width: 310, height: 390 },
    maxSize: { width: 420, height: 520 },
    scrollable: false,
    resizable: true,
    scaleFactor: { min: 0.8, max: 1.2 },
    responsive: {
      mobile: { width: 260, height: 340 },
      tablet: { width: 285, height: 365 },
      desktop: { width: 310, height: 390 },
    },
    mobileLayout: {
      drawerType: "sheet",
      drawerHeight: "half",
      landscapePosition: "right",
    },
  },
  // Map - world map view
  map: {
    minSize: { width: 365, height: 300 },
    preferredSize: { width: 585, height: 455 },
    maxSize: { width: 845, height: 650 },
    scrollable: false,
    resizable: true,
    scaleFactor: { min: 0.75, max: 1.3 },
    aspectRatio: 1.286, // ~16:12.5 aspect for map
    responsive: {
      mobile: { width: 455, height: 365 },
      tablet: { width: 520, height: 410 },
      desktop: { width: 585, height: 455 },
    },
    mobileLayout: {
      drawerType: "modal",
      drawerHeight: "full",
      landscapePosition: "modal",
    },
  },
};

/** Get panel config with fallback defaults */
export function getPanelConfig(panelId: string): PanelConfig {
  return (
    PANEL_CONFIG[panelId] || {
      minSize: { width: 235, height: 180 },
      preferredSize: { width: 325, height: 260 },
      maxSize: { width: 455, height: 390 },
      scrollable: false,
      resizable: true,
      scaleFactor: { min: 0.8, max: 1.2 },
      responsive: {
        mobile: { width: 275, height: 220 },
        tablet: { width: 300, height: 240 },
        desktop: { width: 325, height: 260 },
      },
    }
  );
}

/**
 * Get the current device type based on viewport width
 *
 * @param viewportWidth - Current viewport width in pixels
 * @returns Device type string
 */
export function getDeviceType(
  viewportWidth: number,
): "mobile" | "tablet" | "desktop" {
  if (viewportWidth < 768) return "mobile";
  if (viewportWidth < 1024) return "tablet";
  return "desktop";
}

/**
 * Get responsive panel size based on current viewport
 * Combines breakpoint-based sizing with smooth scaling
 *
 * @param panelId - The panel ID to get size for
 * @param viewport - Current viewport dimensions
 * @returns Calculated size for this panel
 */
export function getPanelSizeForViewport(
  panelId: string,
  viewport: PanelSize,
): PanelSize {
  const config = getPanelConfig(panelId);
  const deviceType = getDeviceType(viewport.width);

  return getResponsivePanelSize(config, deviceType, viewport);
}

/**
 * Apply aspect ratio constraint to a size
 *
 * @param size - Size to constrain
 * @param aspectRatio - Target aspect ratio (width/height)
 * @param priority - Which dimension to preserve ('width' | 'height')
 * @returns Size constrained to aspect ratio
 */
export function constrainToAspectRatio(
  size: PanelSize,
  aspectRatio: number,
  priority: "width" | "height" = "width",
): PanelSize {
  if (priority === "width") {
    return {
      width: size.width,
      height: Math.round(size.width / aspectRatio),
    };
  }
  return {
    width: Math.round(size.height * aspectRatio),
    height: size.height,
  };
}

/**
 * Scrollable panel wrapper - only adds scroll behavior when panel config specifies it.
 * Most panels handle their own internal scrolling, so this is primarily for
 * panels that don't have built-in scroll handling.
 *
 * Note: Returns children directly if scrollable=false to avoid adding wrapper layers
 */
function ScrollablePanelWrapper({
  children,
  scrollable,
}: {
  children: React.ReactNode;
  scrollable: boolean;
}): React.ReactElement {
  // Don't wrap if not scrollable - return children directly wrapped in fragment
  if (!scrollable) {
    return <>{children}</>;
  }

  // Only add scroll container for panels that need it
  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        overflow: "auto",
        scrollbarWidth: "thin",
        scrollbarColor: "rgba(139, 119, 87, 0.5) transparent",
      }}
    >
      {children}
    </div>
  );
}

/** Minimap panel that sizes to its container */
function MinimapPanel({ world }: { world: ClientWorld }): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState<{
    width: number;
    height: number;
  }>({ width: 200, height: 200 });

  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        const width = Math.floor(rect.width);
        const height = Math.floor(rect.height);
        if (width > 10 && height > 10) {
          setDimensions((prev) => {
            // Only update if dimensions actually changed
            if (prev.width !== width || prev.height !== height) {
              return { width, height };
            }
            return prev;
          });
        }
      }
    };

    // Initial measurement
    updateDimensions();

    // Use ResizeObserver for responsive updates
    const observer = new ResizeObserver(() => {
      updateDimensions();
    });
    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      style={{
        position: "absolute",
        // Leave small margin for Window resize handles
        inset: 2,
        overflow: "hidden",
      }}
    >
      <Minimap
        key={`minimap-${dimensions.width}-${dimensions.height}`}
        world={world}
        width={dimensions.width}
        height={dimensions.height}
        zoom={50}
        isVisible={true}
        resizable={false}
        embedded={false}
      />
    </div>
  );
}

/** All available menu bar buttons */
const ALL_MENU_BUTTONS: Array<{
  panelId: string;
  iconName: MenuIconName;
  label: string;
}> = [
  { panelId: "inventory", iconName: "inventory", label: "Inventory" },
  { panelId: "equipment", iconName: "equipment", label: "Equipment" },
  { panelId: "skills", iconName: "skills", label: "Skills" },
  { panelId: "prayer", iconName: "prayer", label: "Prayer" },
  { panelId: "combat", iconName: "combat", label: "Combat" },
  { panelId: "quests", iconName: "quests", label: "Quests" },
  { panelId: "friends", iconName: "friends", label: "Friends" },
  { panelId: "map", iconName: "map", label: "World Map" },
  { panelId: "settings", iconName: "settings", label: "Settings" },
];

// Menubar sizing constraints
const MENUBAR_MIN_BUTTON_SIZE = 20; // Minimum button size in pixels (reduced for compact layouts)
const MENUBAR_MAX_BUTTON_SIZE = 32; // Maximum button size in pixels (reduced for cleaner 1-row style)

/**
 * Calculate optimal grid layout and button size based on container dimensions.
 *
 * Algorithm: Find the layout with fewest rows where buttons fit at minimum size.
 * This ensures we always prefer horizontal layouts when possible, and only add
 * rows when the width is too narrow for fewer rows.
 */
function calculateMenuBarLayout(
  containerWidth: number,
  containerHeight: number,
  buttonCount: number,
): {
  cols: number;
  rows: number;
  buttonSize: number;
  gap: number;
  padding: number;
} {
  const padding = MENUBAR_PADDING;
  const gap = MENUBAR_BUTTON_GAP;

  // Available space after padding
  const availableWidth = containerWidth - padding * 2 - MENUBAR_BORDER_BUFFER;
  const availableHeight = containerHeight - padding * 2 - MENUBAR_BORDER_BUFFER;

  // Try layouts from fewest rows to most - pick first that fits at min button size
  for (let rows = 1; rows <= 5; rows++) {
    const cols = Math.ceil(buttonCount / rows);

    // Calculate max button size that fits in each dimension
    const maxWidthButtonSize = (availableWidth - (cols - 1) * gap) / cols;
    const maxHeightButtonSize = (availableHeight - (rows - 1) * gap) / rows;

    // Use the smaller constraint
    const buttonSize = Math.min(maxWidthButtonSize, maxHeightButtonSize);

    // If buttons fit at minimum size, use this layout (fewest rows that fits)
    if (buttonSize >= MENUBAR_MIN_BUTTON_SIZE) {
      // Clamp to max button size for cleaner appearance
      const clampedSize = Math.min(
        Math.floor(buttonSize),
        MENUBAR_MAX_BUTTON_SIZE,
      );
      return {
        cols,
        rows,
        buttonSize: clampedSize,
        gap,
        padding,
      };
    }
  }

  // Fallback: use max rows (3x3 grid) with minimum button size
  const fallbackRows = Math.ceil(Math.sqrt(buttonCount));
  const fallbackCols = Math.ceil(buttonCount / fallbackRows);
  return {
    cols: fallbackCols,
    rows: fallbackRows,
    buttonSize: MENUBAR_MIN_BUTTON_SIZE,
    gap,
    padding,
  };
}

/**
 * Calculate the content dimensions for a given button layout
 * Uses a fixed "canonical" button size for consistent snap points
 */
function calculateMenuBarContentSize(
  cols: number,
  rows: number,
  gap: number,
  padding: number,
  buttonSize: number = 30, // Default canonical button size
): { width: number; height: number } {
  return {
    width:
      cols * buttonSize +
      (cols - 1) * gap +
      padding * 2 +
      MENUBAR_BORDER_BUFFER,
    height:
      rows * buttonSize +
      (rows - 1) * gap +
      padding * 2 +
      MENUBAR_BORDER_BUFFER,
  };
}

/** Menu bar panel that displays all navigation buttons with snap-to-content sizing */
function MenuBarPanel({
  onPanelClick,
  windowId,
}: {
  onPanelClick?: (panelId: string) => void;
  windowId?: string;
}): React.ReactElement {
  const theme = useThemeStore((s) => s.theme);
  const updateWindow = useWindowStore((s) => s.updateWindow);
  const containerRef = useRef<HTMLDivElement>(null);

  // Track container size
  const [containerSize, setContainerSize] = useState({
    width: 300,
    height: 50,
  });

  // Always show all buttons
  const buttonCount = ALL_MENU_BUTTONS.length;

  // Observe container size changes
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateSize = () => {
      const rect = container.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setContainerSize((prev) => {
          if (prev.width !== rect.width || prev.height !== rect.height) {
            return { width: rect.width, height: rect.height };
          }
          return prev;
        });
      }
    };

    // Initial measurement
    updateSize();

    // Use ResizeObserver for responsive updates
    const observer = new ResizeObserver(updateSize);
    observer.observe(container);

    return () => observer.disconnect();
  }, []);

  // Calculate layout based on container size
  const layout = useMemo(
    () =>
      calculateMenuBarLayout(
        containerSize.width,
        containerSize.height,
        buttonCount,
      ),
    [containerSize.width, containerSize.height, buttonCount],
  );

  // Track previous row count to detect layout changes
  const prevRowsRef = useRef<number | null>(null);

  // Calculate global width bounds once (covers all possible layouts)
  const globalMinWidth = useMemo(() => {
    // Minimum: 3x3 grid at minimum button size
    const minCols = Math.ceil(Math.sqrt(buttonCount));
    const minRows = Math.ceil(buttonCount / minCols);
    return calculateMenuBarContentSize(
      minCols,
      minRows,
      MENUBAR_BUTTON_GAP,
      MENUBAR_PADDING,
      MENUBAR_MIN_BUTTON_SIZE,
    ).width;
  }, [buttonCount]);

  const globalMaxWidth = useMemo(() => {
    // Maximum: 1-row at maximum button size
    return calculateMenuBarContentSize(
      buttonCount,
      1,
      MENUBAR_BUTTON_GAP,
      MENUBAR_PADDING,
      MENUBAR_MAX_BUTTON_SIZE,
    ).width;
  }, [buttonCount]);

  const globalMinHeight = useMemo(() => {
    // Minimum: 1-row layout at minimum button size
    return calculateMenuBarContentSize(
      buttonCount,
      1,
      MENUBAR_BUTTON_GAP,
      MENUBAR_PADDING,
      MENUBAR_MIN_BUTTON_SIZE,
    ).height;
  }, [buttonCount]);

  const globalMaxHeight = useMemo(() => {
    // Maximum: max-rows layout (e.g., 3x3 for 9 buttons)
    const maxRows = Math.ceil(Math.sqrt(buttonCount));
    return calculateMenuBarContentSize(
      Math.ceil(buttonCount / maxRows),
      maxRows,
      MENUBAR_BUTTON_GAP,
      MENUBAR_PADDING,
      MENUBAR_MAX_BUTTON_SIZE,
    ).height;
  }, [buttonCount]);

  // Get current window state for position adjustments
  const currentWindow = useWindowStore((s) => s.windows.get(windowId || ""));

  // Update window constraints and snap height when layout rows change
  useEffect(() => {
    if (!windowId) return;

    const currentRows = layout.rows;
    const isInitialMount = prevRowsRef.current === null;
    const rowsChanged = prevRowsRef.current !== currentRows;

    // Calculate exact content dimensions for current layout
    const contentHeight = calculateMenuBarContentSize(
      layout.cols,
      currentRows,
      MENUBAR_BUTTON_GAP,
      MENUBAR_PADDING,
      layout.buttonSize,
    ).height;

    const contentWidth = calculateMenuBarContentSize(
      layout.cols,
      currentRows,
      MENUBAR_BUTTON_GAP,
      MENUBAR_PADDING,
      layout.buttonSize,
    ).width;

    // Allow height to vary between min and max possible layouts
    // This enables resize-triggered layout transitions
    updateWindow(windowId, {
      minSize: { width: globalMinWidth, height: globalMinHeight },
      maxSize: { width: globalMaxWidth, height: globalMaxHeight },
    });

    // On row count change, snap the window size and reposition to keep on screen
    if (isInitialMount || rowsChanged) {
      prevRowsRef.current = currentRows;

      // Get viewport dimensions
      const viewport = {
        width: typeof window !== "undefined" ? window.innerWidth : 1920,
        height: typeof window !== "undefined" ? window.innerHeight : 1080,
      };

      // Calculate new position to keep window on screen
      // If window was at an edge, keep it at that edge with new size
      let newX = currentWindow?.position.x ?? 0;
      let newY = currentWindow?.position.y ?? 0;
      const oldWidth = currentWindow?.size.width ?? contentWidth;
      const oldHeight = currentWindow?.size.height ?? contentHeight;

      // Edge detection threshold
      const edgeThreshold = 15;

      // Check if window was at right edge - keep right edge aligned
      const wasAtRightEdge =
        Math.abs(newX + oldWidth - viewport.width) < edgeThreshold;
      if (wasAtRightEdge) {
        newX = viewport.width - contentWidth;
      }

      // Check if window was at bottom edge - keep bottom edge aligned
      const wasAtBottomEdge =
        Math.abs(newY + oldHeight - viewport.height) < edgeThreshold;
      if (wasAtBottomEdge) {
        newY = viewport.height - contentHeight;
      }

      // Clamp to viewport to ensure window stays on screen
      newX = Math.max(0, Math.min(newX, viewport.width - contentWidth));
      newY = Math.max(0, Math.min(newY, viewport.height - contentHeight));

      updateWindow(windowId, {
        size: { width: contentWidth, height: contentHeight },
        position: { x: newX, y: newY },
      });
    }
  }, [
    windowId,
    layout.rows,
    layout.cols,
    layout.buttonSize,
    globalMinWidth,
    globalMaxWidth,
    globalMinHeight,
    globalMaxHeight,
    updateWindow,
    currentWindow?.position.x,
    currentWindow?.position.y,
    currentWindow?.size.width,
    currentWindow?.size.height,
  ]);

  return (
    <div
      ref={containerRef}
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      {/* Buttons container - fixed grid layout that fills the window */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${layout.cols}, ${layout.buttonSize}px)`,
          gridTemplateRows: `repeat(${layout.rows}, ${layout.buttonSize}px)`,
          padding: layout.padding,
          gap: layout.gap,
          background: `linear-gradient(180deg, ${theme.colors.background.secondary} 0%, ${theme.colors.background.primary} 100%)`,
          border: `1px solid ${theme.colors.border.default}`,
          borderRadius: 4,
          boxShadow: `inset 0 2px 8px rgba(0, 0, 0, 0.5), ${theme.shadows.md}`,
        }}
      >
        {ALL_MENU_BUTTONS.map((button) => (
          <MenuButton
            key={button.panelId}
            iconName={button.iconName}
            label={button.label}
            active={false}
            onClick={() => onPanelClick?.(button.panelId)}
            customSize={layout.buttonSize}
            panelId={button.panelId}
          />
        ))}
      </div>
    </div>
  );
}

// Lazy load panels for better code splitting
const InventoryPanel = lazy(() =>
  import("../../game/panels/InventoryPanel").then((m) => ({
    default: m.InventoryPanel,
  })),
);
const EquipmentPanel = lazy(() =>
  import("../../game/panels/EquipmentPanel").then((m) => ({
    default: m.EquipmentPanel,
  })),
);
const SkillsPanel = lazy(() =>
  import("../../game/panels/SkillsPanel").then((m) => ({
    default: m.SkillsPanel,
  })),
);
const CombatPanel = lazy(() =>
  import("../../game/panels/CombatPanel").then((m) => ({
    default: m.CombatPanel,
  })),
);
const SettingsPanel = lazy(() =>
  import("../../game/panels/SettingsPanel").then((m) => ({
    default: m.SettingsPanel,
  })),
);
const QuestsPanel = lazy(() =>
  import("../../game/panels/QuestsPanel").then((m) => ({
    default: m.QuestsPanel,
  })),
);
const QuestDetailPanel = lazy(() =>
  import("../../game/panels/QuestDetailPanel").then((m) => ({
    default: m.QuestDetailPanel,
  })),
);
const MapPanel = lazy(() =>
  import("../../game/panels/MapPanel").then((m) => ({
    default: m.MapPanel,
  })),
);
const FriendsPanel = lazy(() =>
  import("../../game/panels/FriendsPanel").then((m) => ({
    default: m.FriendsPanel,
  })),
);
const StatsPanel = lazy(() =>
  import("../../game/panels/StatsPanel").then((m) => ({
    default: m.StatsPanel,
  })),
);
const PrayerPanel = lazy(() =>
  import("../../game/panels/PrayerPanel").then((m) => ({
    default: m.PrayerPanel,
  })),
);

/** Panel loading fallback */
function PanelLoadingFallback(): React.ReactElement {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        color: "rgba(255, 255, 255, 0.5)",
        fontSize: 14,
      }}
    >
      Loading...
    </div>
  );
}

/** Placeholder for unimplemented panels */
function PlaceholderPanel({
  panelId,
}: {
  panelId: string;
}): React.ReactElement {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        color: "rgba(255, 255, 255, 0.5)",
        fontSize: 14,
        gap: 8,
      }}
    >
      <span style={{ fontSize: 24 }}>{getPanelIcon(panelId)}</span>
      <span>{formatPanelName(panelId)}</span>
      <span style={{ fontSize: 11, opacity: 0.6 }}>Coming Soon</span>
    </div>
  );
}

/** Get icon for panel ID */
function getPanelIcon(panelId: string): string {
  const icons: Record<string, string> = {
    inventory: "🎒",
    equipment: "🎽",
    stats: "📊",
    skills: "⭐",
    combat: "⚔️",
    settings: "⚙️",
    bank: "🏦",
    quests: "📜",
    "quest-detail": "📋",
    map: "🗺️",
    minimap: "🧭",
    chat: "💬",
    friends: "👥",
    presets: "📐",
    dashboard: "📈",
    action: "⚡",
    accessibility: "♿",
  };
  return icons[panelId] || "📋";
}

/** Format panel ID to display name */
function formatPanelName(panelId: string): string {
  return panelId
    .split(/[-_]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** Panel render context with all necessary data */
export interface PanelRenderContext {
  world: ClientWorld;
  /** Inventory items for InventoryPanel */
  inventoryItems?: InventorySlotItem[];
  /** Coins for InventoryPanel */
  coins?: number;
  /** Player stats for SkillsPanel and CombatPanel */
  stats?: PlayerStats | null;
  /** Player equipment for EquipmentPanel and CombatPanel */
  equipment?: PlayerEquipmentItems | null;
  /** Callback for menu bar panel clicks */
  onPanelClick?: (panelId: string) => void;
  /** Whether edit mode is unlocked (for action bar +/- controls) */
  isEditMode?: boolean;
}

/**
 * Create the default panel renderer
 *
 * This function returns a renderPanel callback that can be passed to InterfaceManager.
 * It handles rendering all registered game panels with proper data.
 *
 * @example
 * ```tsx
 * function GameScreen() {
 *   const world = useWorld();
 *   const { items, coins, stats, equipment } = usePlayerData(world);
 *
 *   const renderPanel = createPanelRenderer({
 *     world,
 *     inventoryItems: items,
 *     coins,
 *     stats,
 *     equipment,
 *   });
 *
 *   return (
 *     <InterfaceManager world={world} renderPanel={renderPanel}>
 *       <GameViewport />
 *     </InterfaceManager>
 *   );
 * }
 * ```
 */
export function createPanelRenderer(
  context: PanelRenderContext,
): (panelId: string, world?: ClientWorld, windowId?: string) => ReactNode {
  const {
    world,
    inventoryItems = [],
    coins = 0,
    stats = null,
    equipment = null,
    onPanelClick,
    isEditMode = false,
  } = context;

  return (
    panelId: string,
    _world?: ClientWorld,
    windowId?: string,
  ): ReactNode => {
    // Don't render if no world
    if (!world) {
      return (
        <div style={{ padding: 16, color: "rgba(255, 255, 255, 0.5)" }}>
          Waiting for world...
        </div>
      );
    }

    // Get panel config for scrollability
    const config = getPanelConfig(panelId);

    switch (panelId) {
      case "inventory":
        return (
          <ScrollablePanelWrapper scrollable={config.scrollable}>
            <Suspense fallback={<PanelLoadingFallback />}>
              <InventoryPanel
                items={inventoryItems}
                coins={coins}
                world={world}
                useParentDndContext={true}
              />
            </Suspense>
          </ScrollablePanelWrapper>
        );

      case "equipment":
        return (
          <ScrollablePanelWrapper scrollable={config.scrollable}>
            <Suspense fallback={<PanelLoadingFallback />}>
              <EquipmentPanel equipment={equipment} world={world} />
            </Suspense>
          </ScrollablePanelWrapper>
        );

      case "stats":
        return (
          <ScrollablePanelWrapper scrollable={config.scrollable}>
            <Suspense fallback={<PanelLoadingFallback />}>
              <StatsPanel stats={stats} equipment={equipment} />
            </Suspense>
          </ScrollablePanelWrapper>
        );

      case "skills":
        return (
          <ScrollablePanelWrapper scrollable={config.scrollable}>
            <Suspense fallback={<PanelLoadingFallback />}>
              <SkillsPanel stats={stats} />
            </Suspense>
          </ScrollablePanelWrapper>
        );

      case "prayer":
        return (
          <ScrollablePanelWrapper scrollable={config.scrollable}>
            <Suspense fallback={<PanelLoadingFallback />}>
              <PrayerPanel stats={stats} world={world} />
            </Suspense>
          </ScrollablePanelWrapper>
        );

      case "combat":
        return (
          <ScrollablePanelWrapper scrollable={config.scrollable}>
            <Suspense fallback={<PanelLoadingFallback />}>
              <CombatPanel world={world} stats={stats} equipment={equipment} />
            </Suspense>
          </ScrollablePanelWrapper>
        );

      case "settings":
        return (
          <ScrollablePanelWrapper scrollable={config.scrollable}>
            <Suspense fallback={<PanelLoadingFallback />}>
              <SettingsPanel world={world} />
            </Suspense>
          </ScrollablePanelWrapper>
        );

      case "minimap":
        // Minimap has its own container handling
        return <MinimapPanel world={world} />;

      case "menubar":
        return <MenuBarPanel onPanelClick={onPanelClick} windowId={windowId} />;

      // Bank is typically opened as a modal/overlay, not a regular panel
      // but we include a placeholder for now
      case "bank":
        return (
          <ScrollablePanelWrapper
            scrollable={getPanelConfig("bank").scrollable}
          >
            <PlaceholderPanel panelId="bank" />
          </ScrollablePanelWrapper>
        );

      case "chat":
        return (
          <ScrollablePanelWrapper scrollable={config.scrollable}>
            <ChatPanel world={world} />
          </ScrollablePanelWrapper>
        );

      // Action bar panels (up to 5)
      // useParentDndContext enables cross-panel drag-drop (skills, prayers, items)
      case "action":
      case "actionbar-0":
        return (
          <ActionBarPanel
            world={world}
            barId={0}
            isEditMode={isEditMode}
            windowId={windowId}
            useParentDndContext={true}
          />
        );
      case "actionbar-1":
        return (
          <ActionBarPanel
            world={world}
            barId={1}
            isEditMode={isEditMode}
            windowId={windowId}
            useParentDndContext={true}
          />
        );
      case "actionbar-2":
        return (
          <ActionBarPanel
            world={world}
            barId={2}
            isEditMode={isEditMode}
            windowId={windowId}
            useParentDndContext={true}
          />
        );
      case "actionbar-3":
        return (
          <ActionBarPanel
            world={world}
            barId={3}
            isEditMode={isEditMode}
            windowId={windowId}
            useParentDndContext={true}
          />
        );
      case "actionbar-4":
        return (
          <ActionBarPanel
            world={world}
            barId={4}
            isEditMode={isEditMode}
            windowId={windowId}
            useParentDndContext={true}
          />
        );

      // Layout presets panel
      case "presets":
        return (
          <ScrollablePanelWrapper scrollable={config.scrollable}>
            <PresetPanel />
          </ScrollablePanelWrapper>
        );

      // Accessibility settings panel
      case "accessibility":
        return (
          <ScrollablePanelWrapper scrollable={config.scrollable}>
            <AccessibilityPanel />
          </ScrollablePanelWrapper>
        );

      // Panels that are planned but not yet implemented
      case "quests":
        return (
          <ScrollablePanelWrapper scrollable={config.scrollable}>
            <Suspense fallback={<PanelLoadingFallback />}>
              <QuestsPanel world={world} />
            </Suspense>
          </ScrollablePanelWrapper>
        );

      case "quest-detail":
        return (
          <ScrollablePanelWrapper scrollable={config.scrollable}>
            <Suspense fallback={<PanelLoadingFallback />}>
              <QuestDetailPanel
                world={world}
                onClose={() => {
                  if (windowId) {
                    useWindowStore.getState().destroyWindow(windowId);
                  }
                }}
              />
            </Suspense>
          </ScrollablePanelWrapper>
        );

      case "map":
        return (
          <ScrollablePanelWrapper scrollable={config.scrollable}>
            <Suspense fallback={<PanelLoadingFallback />}>
              <MapPanel world={world} />
            </Suspense>
          </ScrollablePanelWrapper>
        );

      case "friends":
        return (
          <ScrollablePanelWrapper scrollable={config.scrollable}>
            <Suspense fallback={<PanelLoadingFallback />}>
              <FriendsPanel world={world} />
            </Suspense>
          </ScrollablePanelWrapper>
        );

      default:
        return (
          <div
            style={{
              padding: 16,
              color: "rgba(255, 255, 255, 0.5)",
              fontSize: 13,
            }}
          >
            Unknown panel: {panelId}
          </div>
        );
    }
  };
}

/**
 * Get list of all available panel IDs
 */
export function getAvailablePanels(): Array<{
  id: string;
  label: string;
  icon: string;
  implemented: boolean;
}> {
  return [
    { id: "minimap", label: "Minimap", icon: "🗺️", implemented: true },
    { id: "inventory", label: "Inventory", icon: "🎒", implemented: true },
    { id: "equipment", label: "Equipment", icon: "🎽", implemented: true },
    { id: "stats", label: "Stats", icon: "📊", implemented: true },
    { id: "skills", label: "Skills", icon: "⭐", implemented: true },
    { id: "prayer", label: "Prayer", icon: "✨", implemented: true },
    { id: "combat", label: "Combat", icon: "⚔️", implemented: true },
    { id: "settings", label: "Settings", icon: "⚙️", implemented: true },
    { id: "bank", label: "Bank", icon: "🏦", implemented: true },
    { id: "quests", label: "Quests", icon: "📜", implemented: false },
    { id: "map", label: "World Map", icon: "🗺️", implemented: false },
    { id: "chat", label: "Chat", icon: "💬", implemented: true },
    { id: "action", label: "Action Bar", icon: "⚡", implemented: true },
    { id: "friends", label: "Friends", icon: "👥", implemented: false },
    { id: "presets", label: "Layout Presets", icon: "📐", implemented: true },
    {
      id: "accessibility",
      label: "Accessibility",
      icon: "♿",
      implemented: true,
    },
  ];
}
