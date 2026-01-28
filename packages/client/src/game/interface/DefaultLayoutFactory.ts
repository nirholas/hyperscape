/**
 * DefaultLayoutFactory - Creates default window layout configurations
 *
 * Extracted from InterfaceManager to reduce file size and improve testability.
 *
 * Default Layout (flush, no overlaps, touching edges):
 * - Right column: Minimap (top, large) → [gap] → Combat → Skills/Prayer → Inventory → Menubar (bottom)
 * - Left column: Quests (above chat) → Chat/Friends/Settings (bottom-left)
 * - Bottom center: Action bar
 *
 * The bottom stack (combat, skills, inventory, menubar) is attached together.
 * There is a gap between the minimap and the combat panel.
 * All panels in the right column share a consistent width.
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
import { TAB_BAR_HEIGHT } from "./types";

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
 * Design resolution used as reference for proportional scaling.
 * Layout positions and sizes are calculated relative to this resolution.
 */
export const DESIGN_RESOLUTION: Viewport = { width: 1920, height: 1080 };

// Right column width is now derived from panel minSize (skillsConfig.minSize.width)
// for consistent alignment across all right column panels.

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
 * Layout structure (flush, no overlaps):
 * - Right column top: Minimap (large, fills available space)
 * - Gap between minimap and bottom stack
 * - Right column bottom stack (attached): Combat → Skills/Prayer → Inventory → Menubar (at bottom edge)
 * - Left column: Quests (above chat) → Chat/Friends/Settings (bottom-left)
 * - Bottom center: Action bar
 *
 * All right column panels share consistent width.
 * The bottom stack panels touch each other, with the menubar flush to screen bottom.
 *
 * @returns Array of WindowConfig for the default layout
 */
export function createDefaultWindows(): WindowConfig[] {
  const viewport =
    typeof window !== "undefined"
      ? { width: window.innerWidth, height: window.innerHeight }
      : { width: 1920, height: 1080 };

  // Get panel configs for constraints
  const minimapConfig = getPanelConfig("minimap");
  const questsConfig = getPanelConfig("quests");
  const skillsConfig = getPanelConfig("skills");
  const inventoryConfig = getPanelConfig("inventory");
  const combatConfig = getPanelConfig("combat");

  // Right column width - use panel minSize for consistent alignment
  // All right column panels share the same width (skillsConfig.minSize.width = 235)
  const rightColumnWidth = skillsConfig.minSize.width;
  const rightColumnX = viewport.width - rightColumnWidth;

  // === RIGHT COLUMN HEIGHTS (no quests - moved to left) ===
  // Fixed heights for specific panels (bottom stack: menubar -> inventory -> skills -> combat)
  // Menubar height matches content - single row with tight wrapping (includes border buffer)
  const menubarHeight = MENUBAR_DIMENSIONS.minHeight;
  const inventoryHeight = Math.max(280, Math.round(viewport.height * 0.26)); // ~26% of viewport
  const skillsHeight = Math.max(200, Math.round(viewport.height * 0.185)); // ~18.5% of viewport
  const combatHeight = Math.max(
    combatConfig.minSize.height,
    Math.round(viewport.height * 0.15),
  ); // ~15% of viewport

  // Gap between minimap and combat stack
  const minimapCombatGap = 20;

  // === CALCULATE RIGHT COLUMN Y POSITIONS (bottom-up) ===
  // Menubar at bottom -> Inventory -> Skills -> Combat (all attached)
  // Gap between combat and minimap
  // Minimap fills remaining space at top
  const menubarY = viewport.height - menubarHeight;
  const inventoryY = menubarY - inventoryHeight;
  const skillsY = inventoryY - skillsHeight;
  const combatY = skillsY - combatHeight;
  const minimapY = 0;
  // Minimap fills from top down to the gap above combat
  const minimapHeight = Math.max(
    minimapConfig.minSize.height,
    combatY - minimapCombatGap,
  );

  // === LEFT COLUMN ===
  // Chat at bottom, quests directly above it (attached to chat top)
  const chatWidth = Math.max(280, Math.round(viewport.width * 0.22));
  const questsWidth = Math.round(chatWidth / 2); // Quests is half the width of chat
  const chatHeight = Math.max(200, Math.round(viewport.height * 0.35));
  const questsHeight = questsConfig.minSize.height; // Use minimum height from panel config
  const chatY = viewport.height - chatHeight;
  const questsY = chatY - questsHeight; // Quests directly above chat

  // === BOTTOM CENTER ===
  const actionbarSizing = getResponsivePanelSizing("actionbar", viewport);
  const actionBarY = viewport.height - actionbarSizing.size.height;
  const actionBarX = Math.floor(
    viewport.width / 2 - actionbarSizing.size.width / 2,
  );

  return [
    // === RIGHT COLUMN (top to bottom, flush stacking) ===

    // Minimap - top right, flush with top and right edges
    // Width constraints aligned with other right column panels
    {
      id: "minimap-window",
      position: { x: rightColumnX, y: minimapY },
      size: { width: rightColumnWidth, height: minimapHeight },
      minSize: {
        width: skillsConfig.minSize.width, // Use same min as other panels (235)
        height: minimapConfig.minSize.height,
      },
      // No maxSize for minimap - it can grow to any size
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
    },

    // Combat - above skills, part of bottom stack (gap above to minimap)
    // Width constraints aligned with other right column panels
    {
      id: "combat-window",
      position: { x: rightColumnX, y: combatY },
      size: { width: rightColumnWidth, height: combatHeight },
      minSize: {
        width: skillsConfig.minSize.width, // Use same min as other panels (235)
        height: combatConfig.minSize.height,
      },
      maxSize: skillsConfig.maxSize
        ? {
            width: skillsConfig.maxSize.width, // Use same max as other panels (390)
            height: combatConfig.maxSize?.height || combatHeight,
          }
        : undefined,
      tabs: [
        {
          id: "combat",
          label: "Combat",
          icon: "⚔️",
          content: "combat",
          closeable: true,
        },
      ],
      transparency: 0,
      anchor: "bottom-right",
    },

    // Skills/Prayer - directly below combat, touching
    {
      id: "skills-prayer-window",
      position: { x: rightColumnX, y: skillsY },
      size: { width: rightColumnWidth, height: skillsHeight },
      minSize: {
        width: skillsConfig.minSize.width,
        height: skillsConfig.minSize.height + TAB_BAR_HEIGHT,
      },
      maxSize: skillsConfig.maxSize
        ? {
            width: skillsConfig.maxSize.width,
            height: skillsConfig.maxSize.height + TAB_BAR_HEIGHT,
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
      anchor: "bottom-right",
    },

    // Inventory/Equipment - directly below skills, touching
    {
      id: "inventory-window",
      position: { x: rightColumnX, y: inventoryY },
      size: { width: rightColumnWidth, height: inventoryHeight },
      minSize: {
        width: inventoryConfig.minSize.width,
        height: inventoryConfig.minSize.height + TAB_BAR_HEIGHT,
      },
      maxSize: inventoryConfig.maxSize
        ? {
            width: inventoryConfig.maxSize.width,
            height: inventoryConfig.maxSize.height + TAB_BAR_HEIGHT,
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
    },

    // Menubar - bottom right, flush with bottom and right edges
    // Uses aligned width (235px) to match other right column panels
    {
      id: "menubar-window",
      position: {
        x: viewport.width - MENUBAR_DIMENSIONS.minWidth,
        y: menubarY,
      },
      size: { width: MENUBAR_DIMENSIONS.minWidth, height: menubarHeight },
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
          icon: "☰",
          content: "menubar",
          closeable: false,
        },
      ],
      transparency: 0,
      anchor: "bottom-right",
    },

    // === LEFT COLUMN ===
    // Quests - above chat, attached to top of chat (half width of chat)
    {
      id: "quests-window",
      position: { x: 0, y: questsY },
      size: { width: questsWidth, height: questsHeight },
      minSize: {
        width: questsConfig.minSize.width,
        height: questsConfig.minSize.height,
      },
      maxSize: questsConfig.maxSize,
      tabs: [
        {
          id: "quests",
          label: "Quests",
          icon: "📜",
          content: "quests",
          closeable: true,
        },
      ],
      transparency: 0,
      anchor: "bottom-left",
    },

    // Chat/Friends/Settings - bottom left, flush with bottom and left edges
    {
      id: "chat-window",
      position: { x: 0, y: chatY },
      size: { width: chatWidth, height: chatHeight },
      minSize: { width: 130, height: 150 },
      tabs: [
        {
          id: "chat",
          label: "Chat",
          icon: "💬",
          content: "chat",
          closeable: true,
        },
        {
          id: "friends",
          label: "Friends",
          icon: "👥",
          content: "friends",
          closeable: true,
        },
        {
          id: "settings",
          label: "Settings",
          icon: "⚙️",
          content: "settings",
          closeable: true,
        },
      ],
      transparency: 0,
      anchor: "bottom-left",
    },

    // === BOTTOM CENTER ===
    // Action bar - bottom center
    {
      id: "actionbar-0-window",
      position: { x: actionBarX, y: actionBarY },
      size: actionbarSizing.size,
      minSize: actionbarSizing.minSize,
      maxSize: actionbarSizing.maxSize,
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
    },
  ];
}
