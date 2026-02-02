/**
 * DefaultLayoutFactory - Creates default window layout configurations
 *
 * Extracted from InterfaceManager to reduce file size and improve testability.
 *
 * Default Layout (flush, no overlaps, touching edges):
 * - Right column: Minimap (top) → [gap] → Combat/Skills/Prayer → Inventory → Menubar (bottom)
 * - Left column: Quests (above chat) → Chat/Friends/Settings (bottom-left)
 * - Bottom center: Action bar
 *
 * The bottom stack (skills, inventory, menubar) is attached together.
 * There is a gap between the minimap and the skills panel.
 * Combat is now a tab in the skills/prayer window (first tab).
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
 * - Right column top: Minimap (compact, preferred size)
 * - Gap between minimap and bottom stack
 * - Right column bottom stack (attached): Combat/Skills/Prayer → Inventory → Menubar (at bottom edge)
 * - Left column: Quests (above chat) → Chat/Friends/Settings (bottom-left)
 * - Bottom center: Action bar
 *
 * Combat is now the first tab in the skills/prayer window for a more compact layout.
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
  const chatConfig = getPanelConfig("chat");

  // Right column width - use panel minSize for consistent alignment
  // All right column panels share the same width (skillsConfig.minSize.width = 235)
  const rightColumnWidth = skillsConfig.minSize.width;
  const rightColumnX = viewport.width - rightColumnWidth;

  // === RIGHT COLUMN HEIGHTS (no quests - moved to left) ===
  // Fixed heights for specific panels (bottom stack: menubar -> inventory -> skills/combat/prayer)
  // Combat is now a tab in the skills window, not a separate panel
  // Scale proportionally based on viewport, using minSize as floor
  // Target: compact layout that scales down for smaller screens
  // Menubar - uses preferred height for comfortable 5x2 grid layout
  const menubarHeight = MENUBAR_DIMENSIONS.height;

  // Calculate scale factor based on viewport height relative to design resolution
  // Use a tighter scale range (0.7-1.0) to keep panels compact
  const heightScale = Math.min(1.0, Math.max(0.7, viewport.height / 1080));

  // Scale panel heights, but never go below minSize
  const inventoryHeight = Math.max(
    inventoryConfig.minSize.height,
    Math.round(inventoryConfig.minSize.height * heightScale),
  );
  // Skills panel is taller now since combat is merged in as a tab
  // Use the larger of skills or combat minSize for the combined panel
  const combinedSkillsMinHeight = Math.max(
    skillsConfig.minSize.height,
    combatConfig.minSize.height,
  );
  const skillsHeight = Math.max(
    combinedSkillsMinHeight,
    Math.round(combinedSkillsMinHeight * heightScale),
  );

  // Verify total height fits in viewport, otherwise use available space proportionally
  // Note: combat is no longer a separate panel
  const totalRightColumnHeight =
    menubarHeight + inventoryHeight + skillsHeight + 20; // 20px gap for minimap
  const maxRightColumnHeight = viewport.height - 80; // Leave 80px for minimap minimum

  // If panels don't fit, scale them down proportionally
  const fitScale =
    totalRightColumnHeight > maxRightColumnHeight
      ? maxRightColumnHeight / totalRightColumnHeight
      : 1;

  const finalInventoryHeight = Math.max(
    inventoryConfig.minSize.height * 0.7,
    Math.round(inventoryHeight * fitScale),
  );
  const finalSkillsHeight = Math.max(
    combinedSkillsMinHeight * 0.7,
    Math.round(skillsHeight * fitScale),
  );

  // Gap between minimap and skills stack
  const minimapSkillsGap = 20;

  // === CALCULATE RIGHT COLUMN Y POSITIONS (bottom-up) ===
  // Menubar at bottom -> Inventory -> Skills/Combat/Prayer (all attached)
  // Gap between skills and minimap
  // Minimap fills remaining space at top
  // Menubar: position so bottom edge touches viewport bottom
  const menubarWindowHeight = menubarHeight;
  const menubarY = viewport.height - menubarWindowHeight;
  const inventoryY = menubarY - finalInventoryHeight;
  const skillsY = inventoryY - finalSkillsHeight;
  const minimapY = 0;
  // Minimap has a reasonable default size, not filling all remaining space
  // Use preferred size from config, capped to available space
  const availableMinimapHeight = skillsY - minimapSkillsGap;
  const minimapHeight = Math.min(
    minimapConfig.preferredSize.height, // Cap at preferred size (300px)
    Math.max(minimapConfig.minSize.height, availableMinimapHeight),
  );

  // === LEFT COLUMN ===
  // Chat at bottom, quests directly above it (attached to chat top)
  // Scale based on viewport for responsive sizing
  const widthScale = Math.min(1.0, Math.max(0.7, viewport.width / 1920));
  const chatWidth = Math.max(380, Math.round(500 * widthScale)); // Wide chat panel
  const questsWidth = Math.round(chatWidth * 0.5); // Half of chat width
  const chatHeight = Math.max(300, Math.round(380 * heightScale)); // Larger chat height for better visibility
  const questsHeight = Math.max(
    questsConfig.minSize.height * 0.7,
    Math.round(questsConfig.minSize.height * heightScale),
  );
  const chatY = viewport.height - chatHeight;
  const questsY = chatY - questsHeight; // Quests directly above chat

  // === BOTTOM CENTER ===
  const actionbarSizing = getResponsivePanelSizing("actionbar", viewport);
  // Position flush at bottom of viewport
  const actionBarY = viewport.height - actionbarSizing.size.height;
  const actionBarX = Math.floor(
    viewport.width / 2 - actionbarSizing.size.width / 2,
  );

  return [
    // === RIGHT COLUMN (top to bottom, flush stacking) ===

    // Minimap - top right, flush with top and right edges
    // Wider than other right column panels for better visibility
    {
      id: "minimap-window",
      position: {
        x: viewport.width - minimapConfig.preferredSize.width,
        y: minimapY,
      },
      size: {
        width: minimapConfig.preferredSize.width,
        height: minimapHeight,
      },
      minSize: {
        width: minimapConfig.minSize.width,
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

    // Combat/Skills/Prayer - combined panel with combat as first tab
    // Gap above to minimap
    {
      id: "skills-prayer-window",
      position: { x: rightColumnX, y: skillsY },
      size: { width: rightColumnWidth, height: finalSkillsHeight },
      minSize: {
        width: skillsConfig.minSize.width,
        height: combinedSkillsMinHeight + TAB_BAR_HEIGHT,
      },
      maxSize: skillsConfig.maxSize
        ? {
            width: skillsConfig.maxSize.width,
            height: skillsConfig.maxSize.height + TAB_BAR_HEIGHT,
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
      size: { width: rightColumnWidth, height: finalInventoryHeight },
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
    // Uses same width as other right column panels for alignment
    // Fluid 5x2 grid layout where buttons scale with container
    {
      id: "menubar-window",
      position: {
        x: rightColumnX,
        y: menubarY,
      },
      size: { width: rightColumnWidth, height: menubarWindowHeight },
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
      minSize: chatConfig.minSize,
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
    // Action bar - bottom center, flush with bottom of viewport
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
