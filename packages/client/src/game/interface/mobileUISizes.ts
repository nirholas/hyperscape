/**
 * Responsive UI Sizing Utility
 *
 * Comprehensive responsive layout system for all device types and orientations:
 * - Desktop (>= 1024px)
 * - Tablet portrait/landscape (768-1024px)
 * - Mobile portrait/landscape (< 768px)
 *
 * All layouts are fluid and scale based on viewport dimensions.
 * Uses min/max bounds to ensure usability across all screen sizes.
 *
 * @packageDocumentation
 */

import type { MobileLayoutResult } from "@/ui";
import {
  MOBILE_TOUCH_TARGET,
  MOBILE_SLOT_SIZE,
} from "../../constants/mobileStyles";

/** Device layout mode for determining UI configuration */
export type LayoutMode =
  | "desktop"
  | "tablet-landscape"
  | "tablet-portrait"
  | "mobile-landscape"
  | "mobile-portrait";

/**
 * Panel width configuration - width in pixels per panel type
 */
export interface PanelWidthConfig {
  inventory: number;
  equipment: number;
  combat: number;
  skills: number;
  prayer: number;
  settings: number;
  chat: number;
  menubar: number;
  quests: number;
  friends: number;
  stats: number;
}

/**
 * Panel height configuration - percentage of viewport height
 */
export interface PanelHeightConfig {
  inventory: number;
  equipment: number;
  combat: number;
  skills: number;
  prayer: number;
  settings: number;
  chat: number;
  menubar: number;
  quests: number;
  friends: number;
  stats: number;
}

/**
 * Panel position configuration for different layouts
 */
export interface PanelPosition {
  /** Anchor point: 'bottom-right' | 'right-center' | 'left-side' */
  anchor: "bottom-right" | "right-center" | "left-side";
  /** Use fixed width or percentage of viewport */
  usePercentWidth: boolean;
  /** Percentage of viewport width (if usePercentWidth) */
  widthPercent: number;
  /** Slide direction: 'from-right' | 'from-bottom' | 'from-left' */
  slideFrom: "from-right" | "from-bottom" | "from-left";
}

/**
 * Comprehensive UI size configuration
 */
export interface MobileUISizes {
  /** Current layout mode */
  layoutMode: LayoutMode;
  /** Minimap sizing */
  minimap: {
    diameter: number;
    ringWidth: number;
    buttonSize: number;
    buttonGap: number;
    /** Position: 'bottom-right' for portrait, 'top-right' for landscape */
    position: "bottom-right" | "top-right" | "bottom-left";
  };
  /** Status HUD sizing */
  statusHud: {
    height: number;
    orbSize: number;
    barHeight: number;
    barWidth: number;
    /** Position: 'top-left' for portrait, 'left-center' for landscape */
    position: "top-left" | "left-center" | "top-center";
  };
  /** Action bar sizing */
  actionBar: {
    slotSize: number;
    gap: number;
    slots: number;
    /** Orientation: 'horizontal' or 'vertical' */
    orientation: "horizontal" | "vertical";
    /** Position: 'bottom-center' for portrait, 'right-side' for landscape */
    position: "bottom-center" | "right-side" | "left-side";
  };
  /** Radial menu positioning */
  radial: {
    buttonOffset: number;
    arcStart: number;
    arcEnd: number;
    /** Arc direction adjusts for landscape */
    arcDirection: "clockwise" | "counter-clockwise";
  };
  /** Panel sizing and positioning */
  panel: {
    widths: PanelWidthConfig;
    heights: PanelHeightConfig;
    maxWidth: number;
    maxHeight: number;
    bottomOffset: number;
    rightOffset: number;
    position: PanelPosition;
  };
  /** Chat sizing */
  chat: {
    height: number;
    maxHeight: number;
    /** Chat position: 'bottom-full' for portrait, 'left-side' for landscape */
    position: "bottom-full" | "left-side" | "bottom-right";
    width: number | "full";
  };
}

/**
 * Determine the layout mode based on device and orientation
 */
function getLayoutMode(layout: MobileLayoutResult): LayoutMode {
  const { isMobile, isTablet, isLandscape } = layout;

  if (isMobile) {
    return isLandscape ? "mobile-landscape" : "mobile-portrait";
  }
  if (isTablet) {
    return isLandscape ? "tablet-landscape" : "tablet-portrait";
  }
  return "desktop";
}

/**
 * Calculate responsive UI sizes based on viewport and device
 * Handles all device types and orientations with fluid scaling
 */
export function getMobileUISizes(layout: MobileLayoutResult): MobileUISizes {
  const { viewport, isLandscape, isMobile, isTablet } = layout;
  const layoutMode = getLayoutMode(layout);

  // Base dimension: use appropriate dimension for scaling
  // Portrait: use width, Landscape: use height (smaller dimension)
  const baseDimension = Math.min(viewport.width, viewport.height);
  // Large dimension available for future layout calculations
  const _largeDimension = Math.max(viewport.width, viewport.height);

  // Scale factors based on device type
  const scaleFactor = isMobile ? 1.0 : isTablet ? 1.1 : 1.2;

  // === MINIMAP SIZING ===
  // Compact minimap sizing for mobile
  // Landscape: smaller to save vertical space
  // Portrait: moderate size
  const minimapScale = isLandscape ? 0.28 : 0.32;
  const minimapMin = isLandscape ? 90 : 100;
  const minimapMax = isLandscape ? 120 : 140;
  const minimapDiameter = Math.round(
    Math.min(
      minimapMax,
      Math.max(minimapMin, baseDimension * minimapScale * scaleFactor),
    ),
  );

  // Minimap position: landscape moves to top-right, portrait bottom-right
  const minimapPosition: "bottom-right" | "top-right" | "bottom-left" =
    isLandscape && isMobile ? "top-right" : "bottom-right";

  // === TOUCH TARGETS ===
  const touchTarget = isMobile
    ? MOBILE_TOUCH_TARGET
    : isTablet
      ? Math.round(MOBILE_TOUCH_TARGET * 1.08)
      : Math.round(MOBILE_TOUCH_TARGET * 1.16);

  // Radial button size - compact for mobile
  const radialScale = isLandscape ? 0.52 : 0.58;
  const radialButtonSize = isMobile
    ? Math.round(MOBILE_SLOT_SIZE * radialScale)
    : isTablet
      ? Math.round(MOBILE_SLOT_SIZE * (radialScale + 0.06))
      : Math.round(MOBILE_SLOT_SIZE * (radialScale + 0.12));

  const ringWidth = Math.round(minimapDiameter * 0.06);

  // === STATUS HUD ===
  // Landscape: compact horizontal layout
  // Portrait: vertical stacked
  const orbSize = Math.round(touchTarget * (isLandscape ? 0.8 : 0.9));
  const barHeight = Math.round(orbSize * 0.15);
  const statusPosition: "top-left" | "left-center" | "top-center" =
    isLandscape && isMobile ? "left-center" : "top-left";

  // === ACTION BAR ===
  // Mobile: always vertical on left side
  // Tablet/Desktop: horizontal at bottom
  const actionBarOrientation: "horizontal" | "vertical" = isMobile
    ? "vertical"
    : "horizontal";
  const actionBarPosition: "bottom-center" | "right-side" | "left-side" =
    isMobile ? "left-side" : "bottom-center";
  const actionBarSlots = isLandscape ? 6 : 5;

  // === PANEL SIZING ===
  // Landscape: panels on left side, taller and narrower
  // Portrait: panels on bottom-right, wider and shorter
  let panelBaseWidth: number;
  let panelCompactWidth: number;
  let panelWideWidth: number;
  let panelCompactHeight: number;
  let panelMediumHeight: number;
  let panelTallHeight: number;

  // Panel-specific widths for mobile
  let panelEquipmentWidth: number;
  let panelInventoryWidth: number;

  if (isLandscape) {
    // Landscape: narrower panels, use more height
    panelBaseWidth = isMobile ? 200 : isTablet ? 240 : 280;
    panelCompactWidth = isMobile ? 180 : isTablet ? 210 : 250;
    panelWideWidth = isMobile ? 220 : isTablet ? 260 : 300;
    panelEquipmentWidth = isMobile ? 190 : isTablet ? 220 : 260;
    panelInventoryWidth = isMobile ? 175 : isTablet ? 210 : 250;
    // Heights are larger percentages in landscape
    panelCompactHeight = isMobile ? 55 : isTablet ? 58 : 62;
    panelMediumHeight = isMobile ? 65 : isTablet ? 68 : 72;
    panelTallHeight = isMobile ? 75 : isTablet ? 78 : 82;
  } else {
    // Portrait: standard sizing
    panelBaseWidth = isMobile ? 220 : isTablet ? 260 : 300;
    panelCompactWidth = isMobile ? 190 : isTablet ? 220 : 260;
    panelWideWidth = isMobile ? 250 : isTablet ? 290 : 330;
    panelEquipmentWidth = isMobile ? 200 : isTablet ? 240 : 280;
    panelInventoryWidth = isMobile ? 185 : isTablet ? 230 : 270;
    panelCompactHeight = isMobile ? 38 : isTablet ? 42 : 48;
    panelMediumHeight = isMobile ? 45 : isTablet ? 50 : 55;
    panelTallHeight = isMobile ? 52 : isTablet ? 58 : 62;
  }

  // Panel position configuration
  const panelPosition: PanelPosition =
    isLandscape && isMobile
      ? {
          anchor: "left-side",
          usePercentWidth: false,
          widthPercent: 35,
          slideFrom: "from-left",
        }
      : {
          anchor: "bottom-right",
          usePercentWidth: false,
          widthPercent: 0,
          slideFrom: "from-right",
        };

  // === RADIAL MENU ===
  // Landscape: arc wraps around top of minimap
  // Portrait: arc wraps around left/bottom of minimap
  // Tighter arc to keep 9 buttons closer together
  const radialArcStart = isLandscape ? 200 : 215;
  const radialArcEnd = isLandscape ? 60 : 45;
  const arcDirection: "clockwise" | "counter-clockwise" = isLandscape
    ? "counter-clockwise"
    : "clockwise";

  // === CHAT SIZING ===
  // Landscape: left side panel
  // Portrait: bottom full-width bar
  const chatHeight = isMobile
    ? isLandscape
      ? 100
      : 140
    : isTablet
      ? isLandscape
        ? 120
        : 160
      : 180;
  const chatPosition: "bottom-full" | "left-side" | "bottom-right" =
    isLandscape && isMobile ? "left-side" : "bottom-full";
  const chatWidth: number | "full" =
    isLandscape && isMobile ? Math.round(viewport.width * 0.35) : "full";

  return {
    layoutMode,
    minimap: {
      diameter: minimapDiameter,
      ringWidth: Math.max(4, Math.min(10, ringWidth)),
      buttonSize: radialButtonSize,
      buttonGap: Math.round(radialButtonSize * 0.06), // Tighter gap between buttons
      position: minimapPosition,
    },
    statusHud: {
      height: orbSize + barHeight + 12,
      orbSize,
      barHeight,
      barWidth: Math.round(orbSize * 2.5),
      position: statusPosition,
    },
    actionBar: {
      slotSize: touchTarget,
      gap: isMobile ? 0 : Math.round(touchTarget * 0.1), // No gap on mobile - slots touch
      slots: actionBarSlots,
      orientation: actionBarOrientation,
      position: actionBarPosition,
    },
    radial: {
      buttonOffset: 0, // Buttons touch minimap edge
      arcStart: radialArcStart,
      arcEnd: radialArcEnd,
      arcDirection,
    },
    panel: {
      widths: {
        inventory: panelInventoryWidth,
        equipment: panelEquipmentWidth,
        combat: panelCompactWidth,
        skills: panelWideWidth,
        prayer: panelBaseWidth,
        settings: panelBaseWidth,
        chat: panelWideWidth,
        menubar: panelCompactWidth,
        quests: panelWideWidth,
        friends: panelBaseWidth,
        stats: panelWideWidth,
      },
      heights: {
        inventory: panelCompactHeight,
        equipment: panelCompactHeight,
        combat: panelCompactHeight,
        skills: panelMediumHeight,
        prayer: panelMediumHeight,
        settings: panelMediumHeight,
        chat: panelMediumHeight,
        menubar: panelCompactHeight,
        quests: panelTallHeight,
        friends: panelCompactHeight,
        stats: panelTallHeight,
      },
      maxWidth: isLandscape
        ? Math.min(viewport.width * 0.4, 320)
        : Math.min(viewport.width * 0.85, 400),
      maxHeight: isLandscape ? viewport.height * 0.85 : viewport.height * 0.7,
      bottomOffset: 0,
      rightOffset: 0,
      position: panelPosition,
    },
    chat: {
      height: chatHeight,
      maxHeight: isLandscape
        ? viewport.height * 0.9
        : Math.min(viewport.height * 0.35, 200),
      position: chatPosition,
      width: chatWidth,
    },
  };
}

/**
 * Layout mode examples:
 *
 * mobile-portrait (iPhone 14: 390x844):
 *   - Minimap: bottom-right, 148px
 *   - Action bar: left-side, vertical, 5 slots (tight gap)
 *   - Panels: bottom-right, slide from right
 *   - Chat: bottom full-width bar
 *
 * mobile-landscape (iPhone 14: 844x390):
 *   - Minimap: top-right, 125px (smaller)
 *   - Action bar: left-side, vertical, 6 slots (tight gap)
 *   - Panels: left-side, slide from left, taller
 *   - Chat: left-side panel
 *
 * tablet-portrait (iPad: 768x1024):
 *   - Minimap: bottom-right, 180px
 *   - Action bar: bottom-center, horizontal, 5 slots
 *   - Panels: bottom-right, larger
 *   - Chat: bottom full-width
 *
 * tablet-landscape (iPad: 1024x768):
 *   - Minimap: bottom-right, 160px
 *   - Action bar: bottom-center, horizontal, 6 slots
 *   - Panels: bottom-right, slide from right
 *   - Chat: bottom full-width
 *
 * desktop (1920x1080):
 *   - Uses desktop UI (InterfaceManager, not MobileInterfaceManager)
 */
