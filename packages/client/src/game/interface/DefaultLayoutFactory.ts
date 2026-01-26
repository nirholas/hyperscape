/**
 * DefaultLayoutFactory - Creates default window layout configurations
 *
 * Extracted from InterfaceManager to reduce file size and improve testability.
 *
 * Default Layout:
 * - Left side: Skills/Prayer (middle), Chat (bottom)
 * - Right side: Minimap (top), Inventory/Equipment (bottom), Menu bar (bottom)
 * - Bottom center: Action bar
 *
 * @packageDocumentation
 */

import type { WindowConfig } from "@/ui";
import {
  getPanelConfig,
  getDeviceType,
  getResponsivePanelSize,
  MENUBAR_DIMENSIONS,
} from "./PanelRegistry";
import { clampPosition, TAB_BAR_HEIGHT } from "./types";

/** Panel size with optional max size */
export interface PanelSize {
  width: number;
  height: number;
}

/** Viewport dimensions */
export interface Viewport {
  width: number;
  height: number;
}

/**
 * Get responsive panel size based on current viewport
 *
 * @param panelId - The panel ID to get size for
 * @param viewport - Current viewport dimensions
 * @returns Panel size and minSize
 */
export function getResponsivePanelSizing(panelId: string, viewport: Viewport) {
  const config = getPanelConfig(panelId);
  const deviceType = getDeviceType(viewport.width);
  const size = getResponsivePanelSize(config, deviceType, viewport);

  return {
    size: { width: size.width, height: size.height },
    minSize: {
      width: config.minSize.width || size.width,
      height: config.minSize.height || size.height,
    },
    maxSize: config.maxSize
      ? {
          width: config.maxSize.width,
          height: config.maxSize.height || size.height,
        }
      : undefined,
  };
}

/**
 * Creates the default window layout configuration
 *
 * Positions windows in the standard layout:
 * - Skills/Prayer panel: left side, above chat
 * - Chat panel: bottom left corner
 * - Minimap: top right corner
 * - Inventory/Equipment: bottom right, above menu bar
 * - Menu bar: bottom right corner
 * - Action bar: bottom center
 *
 * @returns Array of WindowConfig for the default layout
 */
export function createDefaultWindows(): WindowConfig[] {
  const viewport =
    typeof window !== "undefined"
      ? { width: window.innerWidth, height: window.innerHeight }
      : { width: 1920, height: 1080 };

  const minimapSizing = getResponsivePanelSizing("minimap", viewport);
  const inventorySizing = getResponsivePanelSizing("inventory", viewport);
  const chatSizing = getResponsivePanelSizing("chat", viewport);
  const actionbarSizing = getResponsivePanelSizing("actionbar", viewport);
  const skillsSizing = getResponsivePanelSizing("skills", viewport);

  // Menu bar dimensions (width/height already include padding)
  // Add border buffer to match actual window size
  const menuBarWidth = MENUBAR_DIMENSIONS.width + 4; // 4 = MENUBAR_BORDER_BUFFER
  const menuBarHeight = MENUBAR_DIMENSIONS.height + 4;

  // Calculate X positions - each panel is flush with right edge
  const menuBarX = Math.max(0, viewport.width - menuBarWidth);
  const inventoryX = Math.max(0, viewport.width - inventorySizing.size.width);
  const minimapX = Math.max(0, viewport.width - minimapSizing.size.width);

  // Calculate bottom positions - menu bar is flush with bottom right
  const menuBarY = Math.max(0, viewport.height - menuBarHeight);

  // Inventory sits directly above menu bar (touching)
  const inventoryTotalHeight = inventorySizing.size.height + TAB_BAR_HEIGHT;
  const inventoryY = Math.max(0, menuBarY - inventoryTotalHeight);

  // Chat is flush with bottom left
  const chatY = Math.max(0, viewport.height - chatSizing.size.height);

  // Skills/Prayer tabbed panel positioned directly above chat (touching)
  const skillsPrayerTotalHeight = skillsSizing.size.height + TAB_BAR_HEIGHT;
  const skillsPrayerY = Math.max(0, chatY - skillsPrayerTotalHeight);

  return [
    // === LEFT SIDE ===
    // Skills/Prayer tabbed panel - above chat
    createSkillsPrayerWindow(
      skillsPrayerY,
      skillsSizing,
      skillsPrayerTotalHeight,
      viewport,
    ),
    // Chat panel - bottom left
    createChatWindow(chatY, chatSizing, viewport),

    // === RIGHT SIDE ===
    // Menu bar - bottom right
    createMenuBarWindow(
      menuBarX,
      menuBarY,
      menuBarWidth,
      menuBarHeight,
      viewport,
    ),
    // Inventory - above menu bar
    createInventoryWindow(
      inventoryX,
      inventoryY,
      inventorySizing,
      inventoryTotalHeight,
      viewport,
    ),
    // Minimap - top right
    createMinimapWindow(minimapX, minimapSizing, viewport),

    // === BOTTOM CENTER ===
    // Action bar - bottom center
    createActionBarWindow(actionbarSizing, viewport),
  ];
}

// Helper functions for creating individual windows

function createSkillsPrayerWindow(
  y: number,
  sizing: ReturnType<typeof getResponsivePanelSizing>,
  totalHeight: number,
  viewport: Viewport,
): WindowConfig {
  return {
    id: "skills-prayer-window",
    position: clampPosition(0, y, sizing.size.width, totalHeight, viewport),
    size: { width: sizing.size.width, height: totalHeight },
    minSize: {
      width: sizing.minSize.width,
      height: sizing.minSize.height + TAB_BAR_HEIGHT,
    },
    maxSize: sizing.maxSize
      ? {
          width: sizing.maxSize.width,
          height: sizing.maxSize.height + TAB_BAR_HEIGHT,
        }
      : undefined,
    tabs: [
      {
        id: "skills",
        label: "Skills",
        icon: "⭐",
        content: "skills",
        closeable: true,
      },
      {
        id: "prayer",
        label: "Prayer",
        icon: "✨",
        content: "prayer",
        closeable: true,
      },
    ],
    transparency: 0,
    anchor: "bottom-left",
  };
}

function createChatWindow(
  y: number,
  sizing: ReturnType<typeof getResponsivePanelSizing>,
  viewport: Viewport,
): WindowConfig {
  return {
    id: "chat-window",
    position: clampPosition(
      0,
      y,
      sizing.size.width,
      sizing.size.height,
      viewport,
    ),
    size: sizing.size,
    minSize: sizing.minSize,
    tabs: [
      {
        id: "chat",
        label: "Chat",
        icon: "💬",
        content: "chat",
        closeable: true,
      },
    ],
    transparency: 0,
    anchor: "bottom-left",
  };
}

function createMenuBarWindow(
  x: number,
  y: number,
  width: number,
  height: number,
  viewport: Viewport,
): WindowConfig {
  return {
    id: "menubar-window",
    position: clampPosition(x, y, width, height, viewport),
    size: { width, height },
    minSize: {
      width: MENUBAR_DIMENSIONS.minWidth,
      height: MENUBAR_DIMENSIONS.minHeight,
    },
    maxSize: {
      width: MENUBAR_DIMENSIONS.maxWidth,
      height: MENUBAR_DIMENSIONS.maxHeight,
    },
    tabs: [
      {
        id: "menubar",
        label: "Menu",
        icon: "📋",
        content: "menubar",
        closeable: false,
      },
    ],
    transparency: 0,
    anchor: "bottom-right",
  };
}

function createInventoryWindow(
  x: number,
  y: number,
  sizing: ReturnType<typeof getResponsivePanelSizing>,
  totalHeight: number,
  viewport: Viewport,
): WindowConfig {
  return {
    id: "inventory-window",
    position: clampPosition(x, y, sizing.size.width, totalHeight, viewport),
    size: { width: sizing.size.width, height: totalHeight },
    minSize: {
      width: sizing.minSize.width,
      height: sizing.minSize.height + TAB_BAR_HEIGHT,
    },
    maxSize: sizing.maxSize
      ? {
          width: sizing.maxSize.width,
          height: sizing.maxSize.height + TAB_BAR_HEIGHT,
        }
      : undefined,
    tabs: [
      {
        id: "inventory",
        label: "Inventory",
        icon: "🎒",
        content: "inventory",
        closeable: true,
      },
      {
        id: "equipment",
        label: "Equipment",
        icon: "🎽",
        content: "equipment",
        closeable: true,
      },
    ],
    transparency: 0,
    anchor: "bottom-right",
  };
}

function createMinimapWindow(
  x: number,
  sizing: ReturnType<typeof getResponsivePanelSizing>,
  viewport: Viewport,
): WindowConfig {
  return {
    id: "minimap-window",
    position: clampPosition(
      x,
      0,
      sizing.size.width,
      sizing.size.height,
      viewport,
    ),
    size: sizing.size,
    minSize: sizing.minSize,
    tabs: [
      {
        id: "minimap",
        label: "Minimap",
        icon: "🗺️",
        content: "minimap",
        closeable: false,
      },
    ],
    transparency: 0,
    anchor: "top-right",
  };
}

function createActionBarWindow(
  sizing: ReturnType<typeof getResponsivePanelSizing>,
  viewport: Viewport,
): WindowConfig {
  return {
    id: "actionbar-0-window",
    position: clampPosition(
      Math.floor(viewport.width / 2 - sizing.size.width / 2),
      Math.max(0, viewport.height - sizing.size.height),
      sizing.size.width,
      sizing.size.height,
      viewport,
    ),
    size: sizing.size,
    minSize: sizing.minSize,
    maxSize: sizing.maxSize,
    tabs: [
      {
        id: "actionbar-0",
        label: "Action Bar",
        icon: "⚡",
        content: "actionbar-0",
        closeable: false,
      },
    ],
    transparency: 0,
    anchor: "bottom-center",
  };
}
