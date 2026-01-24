/**
 * Interface Manager
 *
 * Main UI management component that replaces the legacy Sidebar.
 * Provides a modern, customizable interface with:
 * - Draggable, resizable windows with tabs
 * - Edit mode for interface customization
 * - Layout presets
 * - Modal panels (Bank, Store, Dialogue, etc.)
 * - Minimap with radial menu or NavigationRibbon
 *
 * @packageDocumentation
 */

import React, {
  useEffect,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import { EventType, getItem } from "@hyperscape/shared";
import type { PlayerStats } from "@hyperscape/shared";
import {
  DndProvider,
  useWindowManager,
  useEditMode,
  usePresetStore,
  useWindowStore,
  useTabDrag,
  useDragStore,
  useDrop,
  usePresetHotkeys,
  useFeatureEnabled,
  initializeAccessibility,
  useMobileLayout,
  useThemeStore,
  type WindowConfig,
  type DragEndEvent,
  type WindowState,
  // Styled components - import from main package to share store instances
  Window,
  TabBar,
  EditModeOverlay,
  DragOverlay,
  ModalWindow,
} from "hs-kit";
import { MobileInterfaceManager } from "./MobileInterfaceManager";
import type { ClientWorld, PlayerEquipmentItems } from "../../types";
import type { InventoryItem, Item } from "@hyperscape/shared";

/** Raw equipment slot format from server network cache */
type RawEquipmentSlot = { item: Item | null; itemId?: string } | null;

/** Raw equipment data structure from server network cache */
type RawEquipmentData = {
  weapon?: RawEquipmentSlot;
  shield?: RawEquipmentSlot;
  helmet?: RawEquipmentSlot;
  body?: RawEquipmentSlot;
  legs?: RawEquipmentSlot;
  boots?: RawEquipmentSlot;
  gloves?: RawEquipmentSlot;
  cape?: RawEquipmentSlot;
  amulet?: RawEquipmentSlot;
  ring?: RawEquipmentSlot;
  arrows?: RawEquipmentSlot;
};
import { HintProvider } from "../Hint";
import {
  createPanelRenderer,
  getPanelConfig,
  getDeviceType,
  getResponsivePanelSize,
  MENUBAR_DIMENSIONS,
  MODAL_PANEL_IDS,
  type PanelSize,
} from "./PanelRegistry";
import { BankPanel } from "../../game/panels/BankPanel";
import { StorePanel } from "../../game/panels/StorePanel";
import { DialoguePanel } from "../../game/panels/DialoguePanel";
import { SmeltingPanel } from "../../game/panels/SmeltingPanel";
import { SmithingPanel } from "../../game/panels/SmithingPanel";
import { StatsPanel } from "../../game/panels/StatsPanel";
import { LootWindowPanel } from "../../game/panels/LootWindowPanel";
import { Minimap } from "../../game/hud/Minimap";
import { QuestStartPanel } from "../../game/panels/QuestStartPanel";
import { QuestCompletePanel } from "../../game/panels/QuestCompletePanel";
import { XpLampPanel } from "../../game/panels/XpLampPanel";

/** Inventory slot view item (simplified) */
type InventorySlotViewItem = {
  slot: number;
  itemId: string;
  quantity: number;
};

/** Panel ID to icon mapping for tab display */
const PANEL_ICONS: Record<string, string> = {
  minimap: "🗺️",
  inventory: "🎒",
  equipment: "🎽",
  stats: "📊",
  skills: "⭐",
  prayer: "✨",
  combat: "🗡️",
  settings: "⚙️",
  bank: "🏦",
  quests: "📜",
  map: "🗺️",
  chat: "💬",
  friends: "👥",
  presets: "📐",
  dashboard: "📈",
  action: "⚡",
  "actionbar-0": "⚡",
  "actionbar-1": "⚡",
  "actionbar-2": "⚡",
  "actionbar-3": "⚡",
  "actionbar-4": "⚡",
};

/** Get icon for a panel ID */
function getPanelIcon(panelId: string): string {
  return PANEL_ICONS[panelId] || "📋";
}

/**
 * Get responsive panel size based on current viewport
 *
 * @param panelId - The panel ID to get size for
 * @param viewport - Current viewport dimensions
 * @returns Panel size and minSize
 */
function getResponsivePanelSizing(panelId: string, viewport: PanelSize) {
  const config = getPanelConfig(panelId);
  const deviceType = getDeviceType(viewport.width);
  const size = getResponsivePanelSize(config, deviceType, viewport);

  return {
    size,
    minSize: config.minSize,
    maxSize: config.maxSize,
  };
}

/**
 * Clamp a position to ensure the window stays within viewport bounds.
 */
function clampPosition(
  x: number,
  y: number,
  width: number,
  height: number,
  viewport: { width: number; height: number },
): { x: number; y: number } {
  const minVisiblePx = 50;
  return {
    x: Math.max(0, Math.min(x, viewport.width - Math.min(width, minVisiblePx))),
    y: Math.max(
      0,
      Math.min(y, viewport.height - Math.min(height, minVisiblePx)),
    ),
  };
}

// TabBar height (from hs-kit TabBar minHeight: 28)
const TAB_BAR_HEIGHT = 28;

/**
 * Create default windows configuration based on current viewport
 * This ensures windows are properly sized for the device
 *
 * Default Layout:
 * - Left side: Settings (below HP bar), Skills/Prayer (middle), Chat (bottom)
 * - Right side: Minimap (top), Stats panel (middle), Inventory (bottom)
 * - Bottom: Action bar (center), Menu bar (right)
 */
function createDefaultWindows(): WindowConfig[] {
  const viewport =
    typeof window !== "undefined"
      ? { width: window.innerWidth, height: window.innerHeight }
      : { width: 1920, height: 1080 };

  const minimapSizing = getResponsivePanelSizing("minimap", viewport);
  const inventorySizing = getResponsivePanelSizing("inventory", viewport);
  const chatSizing = getResponsivePanelSizing("chat", viewport);
  const actionbarSizing = getResponsivePanelSizing("actionbar", viewport);
  const skillsSizing = getResponsivePanelSizing("skills", viewport);

  // Menu bar dimensions (width/height already include padding from calcMenubarHorizontalDimensions)
  // Add border buffer to match actual window size
  const menuBarWidth = MENUBAR_DIMENSIONS.width + 4; // 4 = MENUBAR_BORDER_BUFFER
  const menuBarHeight = MENUBAR_DIMENSIONS.height + 4;

  // Calculate X positions - each panel is flush with right edge (clamped to stay on screen)
  const menuBarX = Math.max(0, viewport.width - menuBarWidth);
  const inventoryX = Math.max(0, viewport.width - inventorySizing.size.width);
  const minimapX = Math.max(0, viewport.width - minimapSizing.size.width);

  // Calculate bottom positions - menu bar is flush with bottom right
  const menuBarY = Math.max(0, viewport.height - menuBarHeight);

  // Inventory sits directly above menu bar (touching) - clamp to stay on screen
  // Inventory window has multiple tabs, so add TabBar height to total window height
  const inventoryTotalHeight = inventorySizing.size.height + TAB_BAR_HEIGHT;
  const inventoryY = Math.max(0, menuBarY - inventoryTotalHeight);

  // Chat is flush with bottom left - clamp to stay on screen
  const chatY = Math.max(0, viewport.height - chatSizing.size.height);

  // Skills/Prayer tabbed panel positioned directly above chat (touching) - clamp to stay on screen
  // Skills/Prayer window has multiple tabs, so add TabBar height to total window height
  const skillsPrayerTotalHeight = skillsSizing.size.height + TAB_BAR_HEIGHT;
  const skillsPrayerY = Math.max(0, chatY - skillsPrayerTotalHeight);

  return [
    // === LEFT SIDE ===
    // Skills/Prayer tabbed panel - above chat
    // Window size includes TabBar height for multi-tab windows
    {
      id: "skills-prayer-window",
      position: clampPosition(
        0,
        skillsPrayerY,
        skillsSizing.size.width,
        skillsPrayerTotalHeight,
        viewport,
      ),
      size: {
        width: skillsSizing.size.width,
        height: skillsPrayerTotalHeight, // Include TabBar height in window size
      },
      minSize: {
        width: skillsSizing.minSize.width,
        height: skillsSizing.minSize.height + TAB_BAR_HEIGHT,
      },
      maxSize: skillsSizing.maxSize
        ? {
            width: skillsSizing.maxSize.width,
            height: skillsSizing.maxSize.height + TAB_BAR_HEIGHT,
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
    },
    // Chat panel - fully at bottom left (touching edges)
    {
      id: "chat-window",
      position: clampPosition(
        0,
        chatY,
        chatSizing.size.width,
        chatSizing.size.height,
        viewport,
      ),
      size: chatSizing.size,
      minSize: chatSizing.minSize,
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
    },

    // === RIGHT SIDE (from bottom up, all touching and flush with right edge) ===
    // Menu bar - fully at bottom right (flush with edges)
    {
      id: "menubar-window",
      position: clampPosition(
        menuBarX,
        menuBarY,
        menuBarWidth,
        menuBarHeight,
        viewport,
      ),
      size: {
        width: menuBarWidth,
        height: menuBarHeight,
      },
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
    },
    // Inventory - directly above menu bar (touching, flush with right edge)
    // Window size includes TabBar height for multi-tab windows
    {
      id: "inventory-window",
      position: clampPosition(
        inventoryX,
        inventoryY,
        inventorySizing.size.width,
        inventoryTotalHeight,
        viewport,
      ),
      size: {
        width: inventorySizing.size.width,
        height: inventoryTotalHeight, // Include TabBar height in window size
      },
      minSize: {
        width: inventorySizing.minSize.width,
        height: inventorySizing.minSize.height + TAB_BAR_HEIGHT,
      },
      maxSize: inventorySizing.maxSize
        ? {
            width: inventorySizing.maxSize.width,
            height: inventorySizing.maxSize.height + TAB_BAR_HEIGHT,
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
    },
    // Minimap - top right (touching top and right edges)
    {
      id: "minimap-window",
      position: clampPosition(
        minimapX,
        0,
        minimapSizing.size.width,
        minimapSizing.size.height,
        viewport,
      ),
      size: minimapSizing.size,
      minSize: minimapSizing.minSize,
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
    },

    // === BOTTOM CENTER ===
    // Action bar - bottom center (touching bottom edge)
    {
      id: "actionbar-0-window",
      position: clampPosition(
        Math.floor(viewport.width / 2 - actionbarSizing.size.width / 2),
        Math.max(0, viewport.height - actionbarSizing.size.height),
        actionbarSizing.size.width,
        actionbarSizing.size.height,
        viewport,
      ),
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
    },
  ];
}

/**
 * FullscreenWorldMap - RuneScape-style fullscreen world map overlay
 *
 * Features:
 * - Takes up entire screen with dark backdrop
 * - ESC key closes it (handled via useEffect)
 * - M key also toggles it
 * - Close button in top-right corner
 * - Player position display
 * - Zoom controls and legend
 */
function FullscreenWorldMap({
  world,
  onClose,
}: {
  world: ClientWorld;
  onClose: () => void;
}): React.ReactElement {
  const theme = useThemeStore((s) => s.theme);

  // Get player position for header display
  const player = world?.getPlayer?.();
  const playerPos = player?.position || { x: 0, y: 0, z: 0 };

  // Calculate map dimensions based on viewport
  const [mapDimensions, setMapDimensions] = React.useState({
    width: Math.min(window.innerWidth - 80, 1400),
    height: Math.min(window.innerHeight - 120, 900),
  });

  // Handle ESC key to close
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Update map dimensions on window resize
  React.useEffect(() => {
    const handleResize = () => {
      setMapDimensions({
        width: Math.min(window.innerWidth - 80, 1400),
        height: Math.min(window.innerHeight - 120, 900),
      });
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      data-modal="true"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 10000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(0, 0, 0, 0.85)",
        pointerEvents: "auto",
        animation: "worldMapFadeIn 0.2s ease-out",
      }}
      onMouseDown={(e) => {
        (e.nativeEvent as PointerEvent & { isCoreUI?: boolean }).isCoreUI =
          true;
      }}
      onPointerDown={(e) => {
        (e.nativeEvent as PointerEvent & { isCoreUI?: boolean }).isCoreUI =
          true;
      }}
      onClick={(e) => {
        // Close when clicking backdrop (not the map)
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      {/* Animation keyframes */}
      <style>
        {`
          @keyframes worldMapFadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
          }
          @keyframes worldMapSlideIn {
            from { opacity: 0; transform: scale(0.95); }
            to { opacity: 1; transform: scale(1); }
          }
        `}
      </style>

      {/* Map Container */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          background: `linear-gradient(135deg, ${theme.colors.background.primary}fa 0%, ${theme.colors.background.secondary}fa 100%)`,
          border: `2px solid ${theme.colors.border.decorative}`,
          borderRadius: theme.borderRadius.lg,
          boxShadow: "0 20px 60px rgba(0, 0, 0, 0.8)",
          overflow: "hidden",
          animation: "worldMapSlideIn 0.2s ease-out",
          maxWidth: "calc(100vw - 40px)",
          maxHeight: "calc(100vh - 40px)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: "12px 20px",
            background: theme.colors.background.secondary,
            borderBottom: `1px solid ${theme.colors.border.default}`,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <span
              style={{
                color: theme.colors.text.primary,
                fontSize: theme.typography.fontSize.lg,
                fontWeight: theme.typography.fontWeight.semibold,
              }}
            >
              🗺️ World Map
            </span>
            <span
              style={{
                color: theme.colors.text.secondary,
                fontSize: theme.typography.fontSize.sm,
              }}
            >
              World of Hyperia
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
            <span
              style={{
                color: theme.colors.accent.primary,
                fontSize: theme.typography.fontSize.sm,
                fontFamily: theme.typography.fontFamily.mono,
              }}
            >
              📍 ({Math.round(playerPos.x)}, {Math.round(playerPos.z)})
            </span>

            {/* Close button */}
            <button
              onClick={onClose}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 32,
                height: 32,
                borderRadius: theme.borderRadius.md,
                border: `1px solid ${theme.colors.border.default}`,
                backgroundColor: theme.colors.background.tertiary,
                color: theme.colors.text.secondary,
                cursor: "pointer",
                fontSize: 18,
                transition: "all 0.15s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor =
                  theme.colors.state.danger;
                e.currentTarget.style.color = theme.colors.text.primary;
                e.currentTarget.style.borderColor = theme.colors.state.danger;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor =
                  theme.colors.background.tertiary;
                e.currentTarget.style.color = theme.colors.text.secondary;
                e.currentTarget.style.borderColor = theme.colors.border.default;
              }}
              aria-label="Close map (ESC)"
              title="Close (ESC)"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Map area - using Minimap with full size */}
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            background: theme.colors.background.primary,
          }}
        >
          <Minimap
            world={world}
            width={mapDimensions.width}
            height={mapDimensions.height}
            zoom={60}
            embedded={true}
            resizable={false}
            isVisible={true}
          />
        </div>

        {/* Footer with legend and controls hint */}
        <div
          style={{
            padding: "10px 20px",
            background: theme.colors.background.secondary,
            borderTop: `1px solid ${theme.colors.border.default}`,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          {/* Legend */}
          <div
            style={{
              display: "flex",
              gap: 20,
              fontSize: theme.typography.fontSize.xs,
              color: theme.colors.text.secondary,
            }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span
                style={{
                  width: 10,
                  height: 10,
                  background: "#00ff00",
                  borderRadius: "50%",
                  border: "1px solid white",
                }}
              />
              You
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span
                style={{
                  width: 10,
                  height: 10,
                  background: "#ff4444",
                  borderRadius: "50%",
                  border: "1px solid white",
                }}
              />
              Enemies
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span
                style={{
                  width: 10,
                  height: 10,
                  background: "#22cc55",
                  borderRadius: "50%",
                  border: "1px solid white",
                }}
              />
              Resources
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span
                style={{
                  width: 10,
                  height: 10,
                  background: "#3b82f6",
                  borderRadius: "50%",
                  border: "1px solid white",
                }}
              />
              NPCs
            </span>
          </div>

          {/* Controls hint */}
          <div
            style={{
              display: "flex",
              gap: 16,
              fontSize: theme.typography.fontSize.xs,
              color: theme.colors.text.muted,
            }}
          >
            <span>🖱️ Drag to pan</span>
            <span>🔍 Scroll to zoom</span>
            <span>📍 Click to move</span>
            <span
              style={{
                padding: "2px 8px",
                background: theme.colors.background.tertiary,
                borderRadius: theme.borderRadius.sm,
                color: theme.colors.text.secondary,
              }}
            >
              ESC or M to close
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Items Kept on Death Panel - Shows which items will be kept/lost on death */
function ItemsKeptOnDeathPanel({
  world,
  equipment,
  onClose: _onClose,
}: {
  world: ClientWorld;
  equipment: PlayerEquipmentItems | null;
  onClose: () => void;
}): React.ReactElement {
  // Get inventory items from network cache
  const playerId = world?.entities?.player?.id;
  const cachedInventory = playerId
    ? world?.network?.lastInventoryByPlayerId?.[playerId]
    : null;
  const inventoryItems = cachedInventory?.items || [];

  // Calculate most valuable items (3 kept on death by default)
  const allItems: Array<{ name: string; value: number; source: string }> = [];

  // Add inventory items
  inventoryItems.forEach(
    (item: { itemId: string; quantity: number; slot: number }) => {
      const itemData = getItem(item.itemId);
      if (itemData) {
        allItems.push({
          name: itemData.name,
          value: (itemData.value || 0) * (item.quantity || 1),
          source: "Inventory",
        });
      }
    },
  );

  // Add equipment items
  if (equipment) {
    const slots = [
      "helmet",
      "body",
      "legs",
      "weapon",
      "shield",
      "boots",
      "gloves",
      "cape",
      "amulet",
      "ring",
    ] as const;
    slots.forEach((slot) => {
      const item = equipment[slot];
      if (item) {
        const itemData = getItem(item.id);
        allItems.push({
          name: item.name || itemData?.name || slot,
          value: itemData?.value || 0,
          source: "Equipment",
        });
      }
    });
  }

  // Sort by value descending
  allItems.sort((a, b) => b.value - a.value);

  // First 3 are kept, rest are lost
  const keptItems = allItems.slice(0, 3);
  const lostItems = allItems.slice(3);

  return (
    <div
      data-modal="true"
      style={{
        padding: "16px",
        display: "flex",
        flexDirection: "column",
        gap: "16px",
        color: "rgba(242, 208, 138, 0.9)",
        fontSize: 13,
      }}
    >
      {/* Info header */}
      <div
        style={{
          background: "rgba(0, 0, 0, 0.3)",
          borderRadius: 6,
          padding: "12px",
          border: "1px solid rgba(139, 69, 19, 0.4)",
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 4 }}>
          Standard Death Mechanics
        </div>
        <div style={{ fontSize: 11, opacity: 0.8, lineHeight: 1.4 }}>
          On death, you will keep your <strong>3 most valuable</strong> items.
          All other items will remain on your gravestone for 15 minutes.
        </div>
      </div>

      {/* Items kept section */}
      <div>
        <div
          style={{
            color: "#22c55e",
            fontWeight: 600,
            marginBottom: 8,
            fontSize: 12,
            textTransform: "uppercase",
            letterSpacing: 0.5,
          }}
        >
          Items Kept ({keptItems.length})
        </div>
        {keptItems.length === 0 ? (
          <div style={{ opacity: 0.5, fontSize: 12 }}>No items to keep</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {keptItems.map((item, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "6px 10px",
                  background: "rgba(34, 197, 94, 0.1)",
                  borderRadius: 4,
                  border: "1px solid rgba(34, 197, 94, 0.3)",
                }}
              >
                <span>{item.name}</span>
                <span style={{ fontSize: 11, opacity: 0.7 }}>
                  {item.value.toLocaleString()} gp
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Items lost section */}
      <div>
        <div
          style={{
            color: "#ef4444",
            fontWeight: 600,
            marginBottom: 8,
            fontSize: 12,
            textTransform: "uppercase",
            letterSpacing: 0.5,
          }}
        >
          Items Lost ({lostItems.length})
        </div>
        {lostItems.length === 0 ? (
          <div style={{ opacity: 0.5, fontSize: 12 }}>
            No items will be lost
          </div>
        ) : (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 4,
              maxHeight: 200,
              overflowY: "auto",
            }}
          >
            {lostItems.map((item, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "6px 10px",
                  background: "rgba(239, 68, 68, 0.1)",
                  borderRadius: 4,
                  border: "1px solid rgba(239, 68, 68, 0.3)",
                }}
              >
                <span>{item.name}</span>
                <span style={{ fontSize: 11, opacity: 0.7 }}>
                  {item.value.toLocaleString()} gp
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Total value footer */}
      <div
        style={{
          borderTop: "1px solid rgba(139, 69, 19, 0.4)",
          paddingTop: 12,
          display: "flex",
          justifyContent: "space-between",
          fontSize: 12,
        }}
      >
        <span style={{ opacity: 0.7 }}>Total Risked Value:</span>
        <span style={{ color: "#ef4444", fontWeight: 600 }}>
          {lostItems
            .reduce((sum, item) => sum + item.value, 0)
            .toLocaleString()}{" "}
          gp
        </span>
      </div>
    </div>
  );
}

/** Max number of action bars allowed */
const MAX_ACTION_BARS = 5;

/** InterfaceManager Props */
export interface InterfaceManagerProps {
  /** The game world instance */
  world: ClientWorld;
  /** Children to render (typically game viewport) */
  children?: ReactNode;
  /** Whether the interface is enabled */
  enabled?: boolean;
}

/**
 * Main interface manager component
 *
 * Routes to MobileInterfaceManager on mobile/touch tablet devices,
 * otherwise renders the full desktop UI with draggable windows.
 *
 * This is a thin wrapper that just handles the mobile/desktop routing.
 * The actual UI logic is in DesktopInterfaceManager or MobileInterfaceManager.
 */
export function InterfaceManager({
  world,
  children,
  enabled = true,
}: InterfaceManagerProps): React.ReactElement {
  // Check if we should use mobile UI (mobile devices or touch tablets)
  const { shouldUseMobileUI } = useMobileLayout();

  // Route to appropriate interface based on device type
  // This wrapper exists to avoid the React hooks violation that would occur
  // if we had an early return in DesktopInterfaceManager before its hooks
  if (shouldUseMobileUI) {
    return (
      <MobileInterfaceManager world={world} enabled={enabled}>
        {children}
      </MobileInterfaceManager>
    );
  }

  return (
    <DesktopInterfaceManager world={world} enabled={enabled}>
      {children}
    </DesktopInterfaceManager>
  );
}

/**
 * Desktop interface manager component
 *
 * Full desktop UI with draggable windows, edit mode, etc.
 */
function DesktopInterfaceManager({
  world,
  children,
  enabled = true,
}: InterfaceManagerProps): React.ReactElement {
  // Desktop UI implementation...
  // Use the window manager hook which properly handles Map reactivity
  const { windows, createWindow } = useWindowManager();
  const { isUnlocked, isHolding, holdProgress } = useEditMode();
  const { loadFromStorage } = usePresetStore();
  const windowStoreUpdate = useWindowStore((s) => s.updateWindow);
  const destroyWindowFromStore = useWindowStore((s) => s.destroyWindow);

  // UI state - detect mobile viewport (legacy, kept for feature gating)
  const [isMobile, setIsMobile] = useState<boolean>(false);

  // Track previous viewport size for responsive repositioning
  const prevViewportRef = React.useRef<{ width: number; height: number }>({
    width: typeof window !== "undefined" ? window.innerWidth : 1920,
    height: typeof window !== "undefined" ? window.innerHeight : 1080,
  });

  useEffect(() => {
    let resizeTimeout: ReturnType<typeof setTimeout> | null = null;

    const handleResize = () => {
      const newWidth = window.innerWidth;
      const newHeight = window.innerHeight;
      const prevWidth = prevViewportRef.current.width;
      const prevHeight = prevViewportRef.current.height;

      setIsMobile(newWidth < 768);

      // Debounce the window repositioning
      if (resizeTimeout) clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        // Skip if viewport hasn't actually changed
        if (newWidth === prevWidth && newHeight === prevHeight) return;

        // Get all windows and reposition them based on viewport change
        const allWindows = useWindowStore.getState().getAllWindows();
        const minVisible = 50;

        allWindows.forEach((win) => {
          let newX = win.position.x;
          let newY = win.position.y;
          let needsUpdate = false;

          // Check if window was aligned to right edge (within 20px of old right edge)
          const wasRightAligned =
            win.position.x + win.size.width >= prevWidth - 20;
          // Check if window was aligned to bottom edge (within 20px of old bottom edge)
          const wasBottomAligned =
            win.position.y + win.size.height >= prevHeight - 20;

          if (wasRightAligned) {
            // Keep window aligned to right edge
            newX = newWidth - win.size.width;
            needsUpdate = true;
          }

          if (wasBottomAligned) {
            // Keep window aligned to bottom edge
            newY = newHeight - win.size.height;
            needsUpdate = true;
          }

          // Clamp to viewport bounds (ensure at least minVisible pixels visible)
          const clampedX = Math.max(
            minVisible - win.size.width,
            Math.min(newX, newWidth - minVisible),
          );
          const clampedY = Math.max(0, Math.min(newY, newHeight - minVisible));

          if (clampedX !== newX || clampedY !== newY) {
            newX = clampedX;
            newY = clampedY;
            needsUpdate = true;
          }

          if (needsUpdate) {
            windowStoreUpdate(win.id, {
              position: { x: newX, y: newY },
            });
          }
        });

        // Update previous viewport ref
        prevViewportRef.current = { width: newWidth, height: newHeight };
      }, 100); // 100ms debounce
    };

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      if (resizeTimeout) clearTimeout(resizeTimeout);
    };
  }, [windowStoreUpdate]);

  // Feature gating based on complexity mode
  const presetHotkeysEnabled = useFeatureEnabled("presetHotkeys");
  const multipleActionBarsEnabled = useFeatureEnabled("multipleActionBars");
  // Edit mode requires mouse precision - disable on mobile
  const editModeEnabled = useFeatureEnabled("editMode") && !isMobile;
  // Window combining requires drag precision - disable on mobile
  const windowCombiningEnabled =
    useFeatureEnabled("windowCombining") && !isMobile;

  // F1-F4 preset hotkeys (Shift+F1-F4 to save) - only in standard+ mode
  usePresetHotkeys({ enabled: presetHotkeysEnabled, saveModifier: "shift" });

  // Initialize accessibility settings on mount
  useEffect(() => {
    initializeAccessibility();
  }, []);

  // Player state
  const [inventory, setInventory] = useState<InventorySlotViewItem[]>([]);
  const [equipment, setEquipment] = useState<PlayerEquipmentItems | null>(null);
  const [playerStats, setPlayerStats] = useState<PlayerStats | null>(null);
  const [coins, setCoins] = useState<number>(0);

  // Modal panel state
  const [lootWindowData, setLootWindowData] = useState<{
    visible: boolean;
    corpseId: string;
    corpseName: string;
    lootItems: InventoryItem[];
  } | null>(null);

  const [bankData, setBankData] = useState<{
    visible: boolean;
    items: Array<{
      itemId: string;
      quantity: number;
      slot: number;
      tabIndex: number;
    }>;
    tabs: Array<{ tabIndex: number; iconItemId: string | null }>;
    alwaysSetPlaceholder: boolean;
    maxSlots: number;
    bankId: string;
  } | null>(null);

  const [storeData, setStoreData] = useState<{
    visible: boolean;
    storeId: string;
    storeName: string;
    buybackRate: number;
    npcEntityId?: string;
    items: Array<{
      id: string;
      itemId: string;
      name: string;
      price: number;
      stockQuantity: number;
      description?: string;
      category?: string;
    }>;
  } | null>(null);

  const [dialogueData, setDialogueData] = useState<{
    visible: boolean;
    npcId: string;
    npcName: string;
    text: string;
    responses: Array<{ text: string; nextNodeId: string; effect?: string }>;
    npcEntityId?: string;
  } | null>(null);

  const [smeltingData, setSmeltingData] = useState<{
    visible: boolean;
    furnaceId: string;
    availableBars: Array<{
      barItemId: string;
      levelRequired: number;
      primaryOre: string;
      secondaryOre: string | null;
      coalRequired: number;
    }>;
  } | null>(null);

  const [smithingData, setSmithingData] = useState<{
    visible: boolean;
    anvilId: string;
    availableRecipes: Array<{
      itemId: string;
      name: string;
      barType: string;
      barsRequired: number;
      levelRequired: number;
      xp: number;
      category: string;
    }>;
  } | null>(null);

  // World map modal state
  const [worldMapOpen, setWorldMapOpen] = useState(false);

  // Stats modal state
  const [statsModalOpen, setStatsModalOpen] = useState(false);

  // Death (Items Kept on Death) modal state
  const [deathModalOpen, setDeathModalOpen] = useState(false);

  // Quest screens state
  const [questStartData, setQuestStartData] = useState<{
    visible: boolean;
    questId: string;
    questName: string;
    description: string;
    difficulty: string;
    requirements: {
      quests: string[];
      skills: Record<string, number>;
      items: string[];
    };
    rewards: {
      questPoints: number;
      items: Array<{ itemId: string; quantity: number }>;
      xp: Record<string, number>;
    };
  } | null>(null);

  const [questCompleteData, setQuestCompleteData] = useState<{
    visible: boolean;
    questName: string;
    rewards: {
      questPoints: number;
      items: Array<{ itemId: string; quantity: number }>;
      xp: Record<string, number>;
    };
  } | null>(null);

  // XP Lamp modal state
  const [xpLampData, setXpLampData] = useState<{
    visible: boolean;
    itemId: string;
    slot: number;
    xpAmount: number;
  } | null>(null);

  // World map hotkey listener (M key)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in an input field
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      // M key toggles world map
      if (e.key === "m" || e.key === "M") {
        e.preventDefault();
        setWorldMapOpen((prev) => !prev);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Hold-to-edit state comes from useEditMode hook in hs-kit
  // hs-kit handles the L key hold logic and exposes isHolding/holdProgress for visual feedback

  // Track if we've initialized windows
  const initializedRef = React.useRef(false);
  const [isHydrated, setIsHydrated] = useState(false);
  // Track previous windows count to detect reset
  const prevWindowsCountRef = React.useRef<number>(-1);

  // Wait for window store to hydrate from localStorage
  useEffect(() => {
    // Check if persist has already rehydrated
    const checkHydration = () => {
      // Give the persist middleware time to hydrate
      // This is a short delay to ensure localStorage data is loaded
      setTimeout(() => {
        setIsHydrated(true);
      }, 50);
    };
    checkHydration();
  }, []);

  // Detect when windows are reset to empty and recreate defaults
  // This handles the "Default Layout" button in EditModeOverlay
  useEffect(() => {
    if (!enabled || !isHydrated) return;

    const prevCount = prevWindowsCountRef.current;
    const currentCount = windows.length;

    // Update ref for next comparison
    prevWindowsCountRef.current = currentCount;

    // If we had windows before and now have 0, it's a reset - recreate defaults
    if (prevCount > 0 && currentCount === 0) {
      console.log(
        "[InterfaceManager] Detected reset (windows went from",
        prevCount,
        "to 0), recreating defaults...",
      );
      // Create fresh default windows with current viewport dimensions
      const freshDefaults = createDefaultWindows();
      freshDefaults.forEach((config) => {
        createWindow(config);
      });
      console.log(
        "[InterfaceManager] Recreated",
        freshDefaults.length,
        "default windows after reset",
      );
    }
  }, [windows.length, enabled, isHydrated, createWindow]);

  // Initialize default windows on mount (after hydration)
  // This runs once and creates windows if needed
  useEffect(() => {
    if (!isHydrated) {
      console.log("[InterfaceManager] Waiting for hydration...");
      return;
    }

    console.log(
      "[InterfaceManager] Init effect running - enabled:",
      enabled,
      "initialized:",
      initializedRef.current,
      "windows:",
      windows.length,
    );

    if (!enabled) {
      console.log("[InterfaceManager] Not enabled, skipping");
      return;
    }
    if (initializedRef.current) {
      console.log("[InterfaceManager] Already initialized, skipping");
      return;
    }
    initializedRef.current = true;

    // Access current windows directly from store to get latest hydrated data
    const storeState = useWindowStore.getState();
    const currentWindows = Array.from(storeState.windows.values());

    // Check current window state (now includes persisted windows from localStorage)
    if (currentWindows.length === 0) {
      // No windows exist (neither from persistence nor previously created) - create defaults
      console.log(
        "[InterfaceManager] No persisted windows found, creating defaults...",
      );
      // Create fresh defaults with current viewport dimensions
      const freshDefaults = createDefaultWindows();
      freshDefaults.forEach((config) => {
        const newWindow = createWindow(config);
        console.log(
          "[InterfaceManager] Created window:",
          newWindow?.id,
          "visible:",
          newWindow?.visible,
        );
      });
      // Initialize prev count ref to current count
      prevWindowsCountRef.current = freshDefaults.length;
      console.log(
        "[InterfaceManager] After creation - store has",
        useWindowStore.getState().windows.size,
        "windows",
      );
    } else {
      // Windows exist (likely from localStorage persistence)
      console.log(
        "[InterfaceManager] Found",
        currentWindows.length,
        "persisted windows:",
        currentWindows.map((w) => w.id),
      );
      // Initialize prev count ref so reset detection works
      prevWindowsCountRef.current = currentWindows.length;

      // Ensure menubar-window exists (may have been removed in older versions)
      const menubarWindow = currentWindows.find(
        (w) => w.id === "menubar-window",
      );
      if (!menubarWindow) {
        console.log("[InterfaceManager] Creating missing menubar-window");
        const viewport = {
          width: window.innerWidth,
          height: window.innerHeight,
        };
        createWindow({
          id: "menubar-window",
          position: {
            x: Math.floor(viewport.width / 2 - MENUBAR_DIMENSIONS.width / 2),
            y: 10,
          },
          size: {
            width: MENUBAR_DIMENSIONS.width + MENUBAR_DIMENSIONS.padding * 2,
            height: MENUBAR_DIMENSIONS.height + MENUBAR_DIMENSIONS.padding * 2,
          },
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
        });
      }

      // Safety net migration: Remove maxSize from windows that should have unlimited resizing
      // (The windowStore's versioned migration system handles this, but this is a fallback)
      for (const win of currentWindows) {
        const shouldRemoveMaxSize =
          win.id === "minimap-window" ||
          win.id.startsWith("panel-chat-") ||
          win.id.startsWith("panel-minimap-") ||
          win.id.startsWith("panel-menubar-") ||
          win.id === "menubar-window";

        // Ensure unlimited panels have no maxSize (safety net for edge cases)
        if (shouldRemoveMaxSize && win.maxSize !== undefined) {
          console.log(
            `[InterfaceManager] Safety net: Removing maxSize from ${win.id}`,
          );
          storeState.updateWindow(win.id, { maxSize: undefined });
        }

        // Migration: Remove orphaned store/bank windows (they're rendered as modals now)
        const winIdLower = win.id.toLowerCase();
        const isOrphanedStoreOrBank =
          winIdLower.includes("store") ||
          winIdLower.includes("bank") ||
          winIdLower.includes("trade") ||
          winIdLower.includes("central") ||
          winIdLower.includes("general") ||
          win.tabs.some((tab) => {
            const content =
              typeof tab.content === "string" ? tab.content.toLowerCase() : "";
            const label = tab.label?.toLowerCase() || "";
            return (
              content.includes("store") ||
              content.includes("bank") ||
              content.includes("trade") ||
              content.includes("central") ||
              content.includes("general") ||
              label.includes("store") ||
              label.includes("bank") ||
              label.includes("trade") ||
              label.includes("central") ||
              label.includes("general")
            );
          });

        if (isOrphanedStoreOrBank) {
          console.log(
            `[InterfaceManager] Removing orphaned store/bank window: ${win.id}`,
            { tabs: win.tabs.map((t) => ({ id: t.id, label: t.label })) },
          );
          storeState.destroyWindow(win.id);
        }
      }

      // Note: We intentionally do NOT recreate "missing" default windows here.
      // If a user has closed a window or customized their layout, we respect that.
      // Default windows are only created when there are NO persisted windows at all.
    }

    // Load presets from storage (only once on init)
    loadFromStorage();
  }, [enabled, createWindow, loadFromStorage, isHydrated]);

  // Event handlers
  useEffect(() => {
    if (!world) return;

    const onUIUpdate = (raw: unknown) => {
      const update = raw as { component: string; data: unknown };

      if (update.component === "player") {
        setPlayerStats(update.data as PlayerStats);
      }

      if (update.component === "equipment") {
        interface EquipmentSlot {
          item?: unknown;
        }
        interface EquipmentUpdateData {
          equipment: Record<string, EquipmentSlot | null | undefined>;
        }
        const data = update.data as EquipmentUpdateData;
        const rawEq = data.equipment;
        const mappedEquipment: PlayerEquipmentItems = {
          weapon:
            (rawEq.weapon?.item as PlayerEquipmentItems["weapon"]) || null,
          shield:
            (rawEq.shield?.item as PlayerEquipmentItems["shield"]) || null,
          helmet:
            (rawEq.helmet?.item as PlayerEquipmentItems["helmet"]) || null,
          body: (rawEq.body?.item as PlayerEquipmentItems["body"]) || null,
          legs: (rawEq.legs?.item as PlayerEquipmentItems["legs"]) || null,
          boots: (rawEq.boots?.item as PlayerEquipmentItems["boots"]) || null,
          gloves:
            (rawEq.gloves?.item as PlayerEquipmentItems["gloves"]) || null,
          cape: (rawEq.cape?.item as PlayerEquipmentItems["cape"]) || null,
          amulet:
            (rawEq.amulet?.item as PlayerEquipmentItems["amulet"]) || null,
          ring: (rawEq.ring?.item as PlayerEquipmentItems["ring"]) || null,
          arrows:
            (rawEq.arrows?.item as PlayerEquipmentItems["arrows"]) || null,
        };
        setEquipment(mappedEquipment);
      }

      // Bank updates
      if (update.component === "bank") {
        const data = update.data as {
          items?: Array<{
            itemId: string;
            quantity: number;
            slot: number;
            tabIndex?: number;
          }>;
          tabs?: Array<{ tabIndex: number; iconItemId: string | null }>;
          alwaysSetPlaceholder?: boolean;
          maxSlots?: number;
          bankId?: string;
          isOpen?: boolean;
        };
        if (data.isOpen === false) {
          setBankData(null);
        } else if (data.isOpen || data.items !== undefined) {
          const itemsWithTabIndex = (data.items || []).map((item) => ({
            ...item,
            tabIndex: item.tabIndex ?? 0,
          }));
          setBankData((prev) => ({
            visible: true,
            items:
              data.items !== undefined ? itemsWithTabIndex : prev?.items || [],
            tabs: data.tabs !== undefined ? data.tabs : prev?.tabs || [],
            alwaysSetPlaceholder:
              data.alwaysSetPlaceholder ?? prev?.alwaysSetPlaceholder ?? false,
            maxSlots: data.maxSlots ?? prev?.maxSlots ?? 480,
            bankId: data.bankId ?? prev?.bankId ?? "spawn_bank",
          }));
        }
      }

      // Store updates
      if (update.component === "store") {
        const data = update.data as {
          storeId: string;
          storeName: string;
          buybackRate: number;
          npcEntityId?: string;
          items: Array<{
            id: string;
            itemId: string;
            name: string;
            price: number;
            stockQuantity: number;
            description?: string;
            category?: string;
          }>;
          isOpen?: boolean;
        };
        if (data.isOpen) {
          setStoreData({
            visible: true,
            storeId: data.storeId,
            storeName: data.storeName,
            buybackRate: data.buybackRate || 0.5,
            npcEntityId: data.npcEntityId,
            items: data.items || [],
          });
        } else {
          setStoreData(null);
        }
      }

      // Dialogue updates
      if (update.component === "dialogue") {
        const data = update.data as {
          npcId: string;
          npcName: string;
          text: string;
          responses: Array<{
            text: string;
            nextNodeId: string;
            effect?: string;
          }>;
          npcEntityId?: string;
        };
        setDialogueData((prev) => ({
          visible: true,
          npcId: data.npcId,
          npcName: data.npcName || prev?.npcName || "NPC",
          text: data.text,
          responses: data.responses || [],
          npcEntityId: data.npcEntityId || prev?.npcEntityId,
        }));
      }

      if (update.component === "dialogueEnd") {
        setDialogueData(null);
      }

      // Smelting updates
      if (update.component === "smelting") {
        const data = update.data as {
          isOpen: boolean;
          furnaceId?: string;
          availableBars?: Array<{
            barItemId: string;
            levelRequired: number;
            primaryOre: string;
            secondaryOre: string | null;
            coalRequired: number;
          }>;
        };
        if (data.isOpen && data.furnaceId && data.availableBars) {
          setSmeltingData({
            visible: true,
            furnaceId: data.furnaceId,
            availableBars: data.availableBars,
          });
        } else {
          setSmeltingData(null);
        }
      }

      // Smithing updates
      if (update.component === "smithing") {
        const data = update.data as {
          isOpen: boolean;
          anvilId?: string;
          availableRecipes?: Array<{
            itemId: string;
            name: string;
            barType: string;
            barsRequired: number;
            levelRequired: number;
            xp: number;
            category: string;
          }>;
        };
        if (data.isOpen && data.anvilId && data.availableRecipes) {
          setSmithingData({
            visible: true,
            anvilId: data.anvilId,
            availableRecipes: data.availableRecipes,
          });
        } else {
          setSmithingData(null);
        }
      }
    };

    const onInventory = (raw: unknown) => {
      const data = raw as {
        items: InventorySlotViewItem[];
        playerId: string;
        coins: number;
      };
      setInventory(data.items);
      setCoins(data.coins);
    };

    const onCoins = (raw: unknown) => {
      const data = raw as { playerId: string; coins: number };
      const localId = world.entities?.player?.id;
      if (!localId || data.playerId === localId) {
        setCoins(data.coins);
      }
    };

    const onSkillsUpdate = (raw: unknown) => {
      const data = raw as { playerId: string; skills: PlayerStats["skills"] };
      const localId = world.entities?.player?.id;
      if (!localId || data.playerId === localId) {
        setPlayerStats((prev) =>
          prev
            ? { ...prev, skills: data.skills }
            : ({ skills: data.skills } as PlayerStats),
        );
      }
    };

    const onCorpseClick = (raw: unknown) => {
      const data = raw as {
        corpseId: string;
        playerId: string;
        lootItems?: Array<{ itemId: string; quantity: number }>;
        position: { x: number; y: number; z: number };
      };
      setLootWindowData({
        visible: true,
        corpseId: data.corpseId,
        corpseName: "Gravestone",
        lootItems:
          data.lootItems?.map((item, index) => ({
            id: `${data.corpseId}-${index}`,
            slot: index,
            itemId: item.itemId,
            quantity: item.quantity,
            metadata: null,
          })) || [],
      });
    };

    // Quest start confirmation handler
    const onQuestStartConfirm = (raw: unknown) => {
      const data = raw as {
        questId: string;
        questName: string;
        description: string;
        difficulty: string;
        requirements: {
          quests: string[];
          skills: Record<string, number>;
          items: string[];
        };
        rewards: {
          questPoints: number;
          items: Array<{ itemId: string; quantity: number }>;
          xp: Record<string, number>;
        };
      };
      setQuestStartData({
        visible: true,
        questId: data.questId,
        questName: data.questName,
        description: data.description,
        difficulty: data.difficulty,
        requirements: data.requirements || {
          quests: [],
          skills: {},
          items: [],
        },
        rewards: data.rewards || { questPoints: 0, items: [], xp: {} },
      });
    };

    // Quest completed handler
    const onQuestCompleted = (raw: unknown) => {
      const data = raw as {
        playerId: string;
        questId: string;
        questName: string;
        rewards: {
          questPoints: number;
          items: Array<{ itemId: string; quantity: number }>;
          xp: Record<string, number>;
        };
      };
      const localId = world.entities?.player?.id;
      if (!localId || data.playerId === localId) {
        setQuestCompleteData({
          visible: true,
          questName: data.questName,
          rewards: data.rewards || { questPoints: 0, items: [], xp: {} },
        });
      }
    };

    // XP Lamp use request handler
    const onXpLampUseRequest = (raw: unknown) => {
      const data = raw as {
        playerId: string;
        itemId: string;
        slot: number;
        xpAmount: number;
      };
      const localId = world.entities?.player?.id;
      if (!localId || data.playerId === localId) {
        setXpLampData({
          visible: true,
          itemId: data.itemId,
          slot: data.slot,
          xpAmount: data.xpAmount,
        });
      }
    };

    world.on(EventType.UI_UPDATE, onUIUpdate);
    world.on(EventType.INVENTORY_UPDATED, onInventory);
    world.on(EventType.INVENTORY_UPDATE_COINS, onCoins);
    world.on(EventType.SKILLS_UPDATED, onSkillsUpdate);
    world.on(EventType.CORPSE_CLICK, onCorpseClick);
    world.on(EventType.QUEST_START_CONFIRM, onQuestStartConfirm);
    world.on(EventType.QUEST_COMPLETED, onQuestCompleted);
    world.on(EventType.XP_LAMP_USE_REQUEST, onXpLampUseRequest);

    // Request initial data
    const requestInitial = () => {
      const lp = world.entities?.player?.id;
      if (lp) {
        const cached = world.network?.lastInventoryByPlayerId?.[lp];
        if (cached && Array.isArray(cached.items)) {
          setInventory(cached.items);
          setCoins(cached.coins);
        }
        const cachedSkills = world.network?.lastSkillsByPlayerId?.[lp];
        if (cachedSkills) {
          const skills = cachedSkills as unknown as PlayerStats["skills"];
          setPlayerStats((prev) =>
            prev ? { ...prev, skills } : ({ skills } as PlayerStats),
          );
        }
        const cachedEquipment = world.network?.lastEquipmentByPlayerId?.[lp];
        if (cachedEquipment) {
          const rawEq = cachedEquipment as RawEquipmentData;
          const mappedEquipment: PlayerEquipmentItems = {
            weapon: rawEq.weapon?.item ?? null,
            shield: rawEq.shield?.item ?? null,
            helmet: rawEq.helmet?.item ?? null,
            body: rawEq.body?.item ?? null,
            legs: rawEq.legs?.item ?? null,
            boots: rawEq.boots?.item ?? null,
            gloves: rawEq.gloves?.item ?? null,
            cape: rawEq.cape?.item ?? null,
            amulet: rawEq.amulet?.item ?? null,
            ring: rawEq.ring?.item ?? null,
            arrows: rawEq.arrows?.item ?? null,
          };
          setEquipment(mappedEquipment);
        }
        world.emit(EventType.INVENTORY_REQUEST, { playerId: lp });
        return true;
      }
      return false;
    };

    let timeoutId: number | null = null;
    if (!requestInitial()) {
      timeoutId = window.setTimeout(() => requestInitial(), 400);
    }

    return () => {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      world.off(EventType.UI_UPDATE, onUIUpdate);
      world.off(EventType.INVENTORY_UPDATED, onInventory);
      world.off(EventType.INVENTORY_UPDATE_COINS, onCoins);
      world.off(EventType.SKILLS_UPDATED, onSkillsUpdate);
      world.off(EventType.CORPSE_CLICK, onCorpseClick);
      world.off(EventType.QUEST_START_CONFIRM, onQuestStartConfirm);
      world.off(EventType.QUEST_COMPLETED, onQuestCompleted);
      world.off(EventType.XP_LAMP_USE_REQUEST, onXpLampUseRequest);
    };
  }, [world]);

  // Handle menu button click - focus existing tab or create new window
  const handleMenuClick = useCallback(
    (panelId: string) => {
      // Check if this panel opens a modal instead of a window
      if ((MODAL_PANEL_IDS as readonly string[]).includes(panelId)) {
        if (panelId === "map") {
          setWorldMapOpen(true);
        } else if (panelId === "stats") {
          setStatsModalOpen(true);
        } else if (panelId === "death") {
          setDeathModalOpen(true);
        }
        return;
      }

      // Find window with this panel
      const existingWindow = windows.find((w) =>
        w.tabs.some((t) => t.content === panelId),
      );

      if (existingWindow) {
        // Focus the tab and ensure window is visible
        const tabIndex = existingWindow.tabs.findIndex(
          (t) => t.content === panelId,
        );
        if (tabIndex >= 0) {
          windowStoreUpdate(existingWindow.id, {
            activeTabIndex: tabIndex,
            visible: true,
          });
        }
      } else {
        // Panel doesn't exist - create a new window for it
        // Use responsive sizing based on current viewport
        const viewport =
          typeof window !== "undefined"
            ? { width: window.innerWidth, height: window.innerHeight }
            : { width: 1920, height: 1080 };
        const panelSizing = getResponsivePanelSizing(panelId, viewport);

        // Position new windows with slight offset to avoid stacking
        const offset = windows.length * 30;
        const newWindowConfig: WindowConfig = {
          id: `panel-${panelId}-${Date.now()}`,
          position: {
            x: Math.max(
              20,
              viewport.width - panelSizing.size.width - 20 - offset,
            ),
            y: Math.max(20, 100 + offset),
          },
          size: panelSizing.size,
          minSize: panelSizing.minSize,
          maxSize: panelSizing.maxSize,
          tabs: [
            {
              id: panelId,
              label: panelId.charAt(0).toUpperCase() + panelId.slice(1),
              icon: getPanelIcon(panelId),
              content: panelId,
              closeable: true,
            },
          ],
          transparency: 0,
        };
        createWindow(newWindowConfig);
      }
    },
    [windows, windowStoreUpdate, createWindow],
  );

  // Listen for UI_OPEN_PANE events to open panels programmatically
  useEffect(() => {
    if (!world) return;

    const onOpenPane = (payload: unknown) => {
      const data = payload as { pane: string };
      if (data?.pane) {
        handleMenuClick(data.pane);
      }
    };

    world.on(EventType.UI_OPEN_PANE, onOpenPane);
    return () => {
      world.off(EventType.UI_OPEN_PANE, onOpenPane);
    };
  }, [world, handleMenuClick]);

  // Create panel renderer with current state
  const renderPanel = useMemo(
    () =>
      createPanelRenderer({
        world,
        inventoryItems: inventory as never[],
        coins,
        stats: playerStats,
        equipment,
        onPanelClick: handleMenuClick,
        isEditMode: isUnlocked && editModeEnabled,
      }),
    [
      world,
      inventory,
      coins,
      playerStats,
      equipment,
      handleMenuClick,
      isUnlocked,
      editModeEnabled,
    ],
  );

  // Menu bar is now a window panel - see DEFAULT_WINDOWS and MenuBarPanel in PanelRegistry

  // Tab drag handler - create new window when tab dropped outside
  const { splitTab } = useTabDrag();

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      const activeId = active.id as string;
      const overId = over?.id as string | undefined;

      // Debug: Log all drag end events
      console.log("[InterfaceManager] Drag end:", {
        activeId,
        overId,
        activeDataType: typeof active.data,
        hasCustomData: !!active.data?.data,
      });

      // Handle inventory → equipment drops
      if (
        activeId.startsWith("inventory-") &&
        overId?.startsWith("equipment-")
      ) {
        const inventoryIndex = parseInt(activeId.replace("inventory-", ""), 10);
        const equipmentSlot = overId.replace("equipment-", "");
        const item = inventory[inventoryIndex];

        if (item && world) {
          const localPlayer = world.getPlayer();
          if (localPlayer) {
            // Get item data to check if it can be equipped in this slot
            const itemData = getItem(item.itemId);

            // Client-side validation for better UX (server will also validate)
            if (itemData) {
              const itemEquipSlot = itemData.equipSlot;

              // Map 2h weapons to weapon slot
              const normalizedItemSlot =
                itemEquipSlot === "2h" ? "weapon" : itemEquipSlot;

              // Check if item can be equipped in this slot
              // Allow if: exact match, or if item has no equipSlot (server will reject if invalid)
              if (normalizedItemSlot && normalizedItemSlot !== equipmentSlot) {
                console.log(
                  "[InterfaceManager] ❌ Item cannot be equipped in this slot:",
                  {
                    itemId: item.itemId,
                    itemSlot: normalizedItemSlot,
                    targetSlot: equipmentSlot,
                  },
                );
                // Show feedback to user
                world.emit(EventType.UI_MESSAGE, {
                  message: `Cannot equip ${itemData.name || item.itemId} in ${equipmentSlot} slot`,
                  type: "error",
                });
                return;
              }
            }

            console.log(
              "[InterfaceManager] 📦→🎽 Inventory to Equipment drop:",
              {
                itemId: item.itemId,
                inventorySlot: inventoryIndex,
                equipmentSlot,
              },
            );
            // Send equip request to server
            world.network?.send("equipItem", {
              playerId: localPlayer.id,
              itemId: item.itemId,
              inventorySlot: inventoryIndex,
            });
          }
        }
        return;
      }

      // Handle inventory → inventory drops (reordering within inventory)
      if (
        activeId.startsWith("inventory-") &&
        (overId?.startsWith("inventory-drop-") ||
          overId?.startsWith("inventory-"))
      ) {
        const fromSlot = parseInt(activeId.replace("inventory-", ""), 10);
        const toSlot = overId.startsWith("inventory-drop-")
          ? parseInt(overId.replace("inventory-drop-", ""), 10)
          : parseInt(overId.replace("inventory-", ""), 10);

        // Don't swap with self
        if (fromSlot === toSlot) return;

        if (world) {
          console.log("[InterfaceManager] 🎒→🎒 Inventory move:", {
            fromSlot,
            toSlot,
          });
          // Send move request to server
          world.network?.send?.("moveItem", { fromSlot, toSlot });
        }
        return;
      }

      // Handle drops to action bar (skills, prayers, items)
      if (overId?.startsWith("actionbar-drop-")) {
        const slotIndex = parseInt(overId.replace("actionbar-drop-", ""), 10);
        // hs-kit: custom data is in active.data.data (DragItem wraps our data)
        const activeData = active.data.data as
          | {
              skill?: { id: string; name: string; icon: string; level: number };
              prayer?: {
                id: string;
                name: string;
                icon: string;
                level: number;
              };
              // Inventory item data has different structure
              item?: { slot: number; itemId: string; quantity: number };
              index?: number;
              source?: string;
            }
          | undefined;

        // Debug logging to help diagnose drop issues
        console.log("[InterfaceManager] ActionBar drop detected:", {
          overId,
          slotIndex,
          activeId,
          activeData,
          hasSkill: !!activeData?.skill,
          hasPrayer: !!activeData?.prayer,
          hasItem: !!activeData?.item,
          source: activeData?.source,
        });

        // Determine which bar this drop is for (default to bar 0)
        // The drop ID format is "actionbar-drop-{slotIndex}" for bar 0
        // For other bars it would be "actionbar-{barId}-drop-{slotIndex}"
        const barId = 0; // TODO: Parse barId from overId if multiple bars supported

        if (activeData?.source === "skill" && activeData.skill && world) {
          // Skill → ActionBar drop
          console.log("[InterfaceManager] 📊→⚡ Skill to ActionBar:", {
            skill: activeData.skill.name,
            slotIndex,
          });
          world.emit(EventType.ACTION_BAR_SLOT_UPDATE, {
            barId,
            slotIndex,
            slot: {
              type: "skill",
              id: `skill-${activeData.skill.id}-${Date.now()}`,
              skillId: activeData.skill.id,
              icon: activeData.skill.icon,
              label: activeData.skill.name,
            },
          });
          return;
        }

        if (activeData?.source === "prayer" && activeData.prayer && world) {
          // Prayer → ActionBar drop
          console.log("[InterfaceManager] ✨→⚡ Prayer to ActionBar:", {
            prayer: activeData.prayer.name,
            slotIndex,
          });
          world.emit(EventType.ACTION_BAR_SLOT_UPDATE, {
            barId,
            slotIndex,
            slot: {
              type: "prayer",
              id: `prayer-${activeData.prayer.id}-${Date.now()}`,
              prayerId: activeData.prayer.id,
              icon: activeData.prayer.icon,
              label: activeData.prayer.name,
            },
          });
          return;
        }

        // Inventory items: detected by activeId starting with "inventory-"
        // Data structure is { item: { slot, itemId, quantity }, index }
        if (activeId.startsWith("inventory-") && activeData?.item && world) {
          // Inventory Item → ActionBar drop
          console.log("[InterfaceManager] 🎒→⚡ Item to ActionBar:", {
            itemId: activeData.item.itemId,
            slotIndex,
          });
          world.emit(EventType.ACTION_BAR_SLOT_UPDATE, {
            barId,
            slotIndex,
            slot: {
              type: "item",
              id: `item-${activeData.item.itemId}-${Date.now()}`,
              itemId: activeData.item.itemId,
              quantity: activeData.item.quantity,
              label: activeData.item.itemId,
            },
          });
          return;
        }

        // Log unhandled action bar drops for debugging
        console.log("[InterfaceManager] ⚠️ Unhandled ActionBar drop:", {
          activeId,
          overId,
          activeData,
        });
      }

      // Only handle tab drags for the remaining logic
      if (active.data.type !== "tab") return;

      // Get source window ID from the drag item
      const sourceWindowId = active.data.sourceId;

      // Debug logging
      console.log("[InterfaceManager] Tab drag end:", {
        tabId: active.id,
        sourceWindowId,
        over: over?.id,
        hasOver: Boolean(over),
      });

      // If dropped on a DIFFERENT window's tab bar, the TabBar's useDrop handles it
      if (over) {
        const targetWindowId = overId?.replace("tabbar-", "");
        // If dropped on a different window, TabBar handles it
        if (targetWindowId && targetWindowId !== sourceWindowId) {
          console.log(
            "[InterfaceManager] Tab dropped on different window, TabBar handles it",
          );
          return;
        }
        // If dropped on same window's tab bar, that's just reordering - do nothing
        console.log("[InterfaceManager] Tab dropped on same window, ignoring");
        return;
      }

      // Tab was dropped outside of any window - create new window
      const tabId = active.id;

      // Get the current pointer position from the drag store
      const dragState = useDragStore.getState();
      const currentPos = dragState.current;

      console.log(
        "[InterfaceManager] Tab dropped outside windows, creating new window at:",
        currentPos,
      );

      // Use the current pointer position, offset slightly so window appears under cursor
      const dropPosition = {
        x: Math.max(20, Math.min(window.innerWidth - 200, currentPos.x - 100)),
        y: Math.max(20, Math.min(window.innerHeight - 200, currentPos.y - 20)),
      };

      splitTab(tabId, dropPosition);
    },
    [splitTab, inventory, world],
  );

  if (!enabled) {
    return <>{children}</>;
  }

  // Show minimal loading state during hydration to prevent UI flash
  if (!isHydrated) {
    return (
      <>
        {children}
        {/* Minimal hydration loading indicator - transparent fade */}
        <div
          className="fixed inset-0 pointer-events-none z-50"
          style={{
            background: "transparent",
          }}
          aria-hidden="true"
        />
      </>
    );
  }

  return (
    <HintProvider>
      <DndProvider onDragEnd={handleDragEnd}>
        {/* Game content (viewport, etc.) */}
        {children}

        {/* Minimap is a window panel - see DEFAULT_WINDOWS */}
        {/* MenuBar panel with Lucide React icons provides panel shortcuts - see menubar-window */}

        {/* Edit mode overlay - only in advanced mode */}
        {isUnlocked && editModeEnabled && <EditModeOverlay />}

        {/* Drag overlay for ghost during drag */}
        <DragOverlay />

        {/* Windows container - positioned for absolute windows */}
        {/* In normal mode: z-300 (below minimap at z-998) */}
        {/* In edit mode: z-600 (above minimap at z-200 so windows can be dragged) */}
        <div
          className="fixed inset-0 pointer-events-none"
          style={{ zIndex: isUnlocked && editModeEnabled ? 600 : 300 }}
        >
          {(() => {
            const visibleWindows = windows.filter((w) => w.visible);

            return visibleWindows.map((windowState) => {
              // Action bar windows don't have tabs - render content directly with drag handle
              const isActionBar = windowState.id.startsWith("actionbar-");
              // Minimap window has no tab bar - just the content
              const isMinimap = windowState.id === "minimap-window";
              // Only show TabBar for multi-tab windows
              const hasMultipleTabs = windowState.tabs.length > 1;
              const showTabBar = !isActionBar && !isMinimap && hasMultipleTabs;
              // Single-tab windows need draggable content wrapper in edit mode
              const needsDraggableWrapper =
                !isActionBar && !isMinimap && !hasMultipleTabs;

              return (
                <div key={windowState.id} style={{ pointerEvents: "auto" }}>
                  <Window
                    windowId={windowState.id}
                    windowState={windowState}
                    isUnlocked={isUnlocked && editModeEnabled}
                    windowCombiningEnabled={windowCombiningEnabled}
                  >
                    {isActionBar ? (
                      <ActionBarWrapper
                        activeTabIndex={windowState.activeTabIndex}
                        tabs={windowState.tabs}
                        renderPanel={renderPanel}
                        windowId={windowState.id}
                      />
                    ) : isMinimap ? (
                      // Minimap gets its own wrapper that passes drag props for the border drag handles
                      <MinimapWrapper
                        world={world}
                        isUnlocked={isUnlocked && editModeEnabled}
                      />
                    ) : showTabBar ? (
                      <TabBar windowId={windowState.id} />
                    ) : null}
                    {!isActionBar && !isMinimap && needsDraggableWrapper ? (
                      <DraggableContentWrapper
                        windowId={windowState.id}
                        activeTabIndex={windowState.activeTabIndex}
                        tabs={windowState.tabs}
                        renderPanel={renderPanel}
                        isUnlocked={isUnlocked && editModeEnabled}
                      />
                    ) : !isActionBar && !isMinimap ? (
                      <WindowContent
                        activeTabIndex={windowState.activeTabIndex}
                        tabs={windowState.tabs}
                        renderPanel={renderPanel}
                        windowId={windowState.id}
                      />
                    ) : null}
                  </Window>
                </div>
              );
            });
          })()}
        </div>

        {/* Modal Panels */}
        {lootWindowData && (
          <LootWindowPanel
            visible={lootWindowData.visible}
            corpseId={lootWindowData.corpseId}
            corpseName={lootWindowData.corpseName}
            lootItems={lootWindowData.lootItems}
            onClose={() => setLootWindowData(null)}
            world={world}
          />
        )}

        {bankData?.visible && (
          <ModalWindow
            visible={true}
            onClose={() => {
              setBankData(null);
              world?.network?.send?.("bank_close", {});
            }}
            title="Bank"
            width={900}
            maxWidth="95vw"
          >
            <BankPanel
              items={bankData.items}
              tabs={bankData.tabs}
              alwaysSetPlaceholder={bankData.alwaysSetPlaceholder}
              maxSlots={bankData.maxSlots}
              world={world}
              inventory={inventory}
              equipment={equipment}
              coins={coins}
              onClose={() => {
                setBankData(null);
                world?.network?.send?.("bank_close", {});
              }}
            />
          </ModalWindow>
        )}

        {storeData?.visible && (
          <ModalWindow
            visible={true}
            onClose={() => {
              setStoreData(null);
              world?.network?.send?.("store_close", {
                storeId: storeData.storeId,
              });
            }}
            title={storeData.storeName}
            width={800}
          >
            <StorePanel
              storeId={storeData.storeId}
              storeName={storeData.storeName}
              buybackRate={storeData.buybackRate}
              items={storeData.items}
              world={world}
              inventory={inventory}
              coins={coins}
              npcEntityId={storeData.npcEntityId}
              onClose={() => {
                setStoreData(null);
                world?.network?.send?.("store_close", {
                  storeId: storeData.storeId,
                });
              }}
            />
          </ModalWindow>
        )}

        {dialogueData?.visible && (
          <ModalWindow
            visible={true}
            onClose={() => setDialogueData(null)}
            title={dialogueData.npcName}
            width={500}
            closeOnBackdropClick={false}
          >
            <DialoguePanel
              visible={dialogueData.visible}
              npcName={dialogueData.npcName}
              npcId={dialogueData.npcId}
              text={dialogueData.text}
              responses={dialogueData.responses}
              npcEntityId={dialogueData.npcEntityId}
              world={world}
              onSelectResponse={(_index, response) => {
                if (!response.nextNodeId) {
                  setDialogueData(null);
                }
              }}
              onClose={() => {
                setDialogueData(null);
                world?.network?.send?.("dialogue_end", {
                  npcId: dialogueData.npcId,
                });
              }}
            />
          </ModalWindow>
        )}

        {smeltingData?.visible && (
          <ModalWindow
            visible={true}
            onClose={() => setSmeltingData(null)}
            title="Smelting"
            width={600}
          >
            <SmeltingPanel
              furnaceId={smeltingData.furnaceId}
              availableBars={smeltingData.availableBars}
              world={world}
              onClose={() => setSmeltingData(null)}
            />
          </ModalWindow>
        )}

        {smithingData?.visible && (
          <ModalWindow
            visible={true}
            onClose={() => setSmithingData(null)}
            title="Smithing"
            width={700}
          >
            <SmithingPanel
              anvilId={smithingData.anvilId}
              availableRecipes={smithingData.availableRecipes}
              world={world}
              onClose={() => setSmithingData(null)}
            />
          </ModalWindow>
        )}

        {/* World Map - Fullscreen Overlay (RuneScape-style) */}
        {worldMapOpen && (
          <FullscreenWorldMap
            world={world}
            onClose={() => setWorldMapOpen(false)}
          />
        )}

        {/* Stats Modal */}
        {statsModalOpen && (
          <ModalWindow
            visible={true}
            onClose={() => setStatsModalOpen(false)}
            title="Character Stats"
            width={520}
            maxWidth="95vw"
          >
            <StatsPanel
              stats={playerStats}
              equipment={equipment}
              showSilhouette={true}
            />
          </ModalWindow>
        )}

        {/* Items Kept on Death Modal */}
        {deathModalOpen && (
          <ModalWindow
            visible={true}
            onClose={() => setDeathModalOpen(false)}
            title="Items Kept on Death"
            width={400}
            maxWidth="95vw"
          >
            <ItemsKeptOnDeathPanel
              world={world}
              equipment={equipment}
              onClose={() => setDeathModalOpen(false)}
            />
          </ModalWindow>
        )}

        {/* Quest Start Panel */}
        {questStartData?.visible && (
          <QuestStartPanel
            visible={true}
            questId={questStartData.questId}
            questName={questStartData.questName}
            description={questStartData.description}
            difficulty={questStartData.difficulty}
            requirements={questStartData.requirements}
            rewards={questStartData.rewards}
            onAccept={() => {
              const localPlayer = world.getPlayer?.();
              if (localPlayer) {
                world.emit(EventType.QUEST_START_ACCEPTED, {
                  playerId: localPlayer.id,
                  questId: questStartData.questId,
                });
              }
              setQuestStartData(null);
            }}
            onDecline={() => {
              const localPlayer = world.getPlayer?.();
              if (localPlayer) {
                world.emit(EventType.QUEST_START_DECLINED, {
                  playerId: localPlayer.id,
                  questId: questStartData.questId,
                });
              }
              setQuestStartData(null);
            }}
          />
        )}

        {/* Quest Complete Panel */}
        {questCompleteData?.visible && (
          <QuestCompletePanel
            visible={true}
            questName={questCompleteData.questName}
            rewards={questCompleteData.rewards}
            world={world}
            onClose={() => setQuestCompleteData(null)}
          />
        )}

        {/* XP Lamp Panel */}
        {xpLampData?.visible && (
          <XpLampPanel
            visible={true}
            world={world}
            stats={playerStats}
            xpAmount={xpLampData.xpAmount}
            itemId={xpLampData.itemId}
            slot={xpLampData.slot}
            onClose={() => setXpLampData(null)}
          />
        )}

        {/* Hold-to-edit lock indicator - always shows when holding L */}
        <div
          className="fixed inset-0 flex items-center justify-center pointer-events-none z-[9999]"
          style={{
            backgroundColor: isHolding ? "rgba(0, 0, 0, 0.4)" : "transparent",
            opacity: isHolding ? 1 : 0,
            transition:
              "opacity 0.15s ease-out, background-color 0.15s ease-out",
            visibility: isHolding ? "visible" : "hidden",
          }}
        >
          <div
            className="relative flex items-center justify-center"
            style={{
              width: 140,
              height: 140,
              transform: isHolding ? "scale(1)" : "scale(0.8)",
              transition: "transform 0.15s ease-out",
            }}
          >
            {/* Background glow */}
            <div
              style={{
                position: "absolute",
                width: 100,
                height: 100,
                borderRadius: "50%",
                background: !editModeEnabled
                  ? "radial-gradient(circle, rgba(107, 114, 128, 0.2) 0%, transparent 70%)"
                  : isUnlocked
                    ? "radial-gradient(circle, rgba(239, 68, 68, 0.2) 0%, transparent 70%)"
                    : "radial-gradient(circle, rgba(34, 197, 94, 0.2) 0%, transparent 70%)",
              }}
            />
            {/* Progress ring */}
            <svg
              width="140"
              height="140"
              viewBox="0 0 140 140"
              style={{ position: "absolute" }}
            >
              {/* Track circle */}
              <circle
                cx="70"
                cy="70"
                r="58"
                fill="none"
                stroke="rgba(255, 255, 255, 0.15)"
                strokeWidth="8"
              />
              {/* Progress circle - no CSS transition, purely RAF-driven */}
              <circle
                cx="70"
                cy="70"
                r="58"
                fill="none"
                stroke={
                  !editModeEnabled
                    ? "#6b7280"
                    : isUnlocked
                      ? "#ef4444"
                      : "#22c55e"
                }
                strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray={2 * Math.PI * 58}
                strokeDashoffset={2 * Math.PI * 58 * (1 - holdProgress / 100)}
                transform="rotate(-90 70 70)"
                style={{
                  filter: `drop-shadow(0 0 6px ${!editModeEnabled ? "rgba(107, 114, 128, 0.6)" : isUnlocked ? "rgba(239, 68, 68, 0.6)" : "rgba(34, 197, 94, 0.6)"})`,
                }}
              />
            </svg>
            {/* Lock icon container */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                color: "#fff",
              }}
            >
              {/* SVG lock icon instead of emoji for smooth rendering */}
              <svg
                width="36"
                height="36"
                viewBox="0 0 24 24"
                fill="none"
                stroke={isUnlocked ? "#fbbf24" : "#fbbf24"}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{
                  filter: "drop-shadow(0 2px 4px rgba(0, 0, 0, 0.3))",
                }}
              >
                {isUnlocked ? (
                  <>
                    {/* Unlocked padlock */}
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 9.9-1" />
                  </>
                ) : (
                  <>
                    {/* Locked padlock */}
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </>
                )}
              </svg>
              <span
                style={{
                  fontSize: 12,
                  marginTop: 8,
                  opacity: 0.9,
                  fontWeight: 500,
                  textShadow: "0 1px 2px rgba(0, 0, 0, 0.5)",
                  letterSpacing: "0.5px",
                }}
              >
                {!editModeEnabled
                  ? "Edit Mode (Advanced)"
                  : isUnlocked
                    ? "Locking..."
                    : "Unlocking..."}
              </span>
            </div>
          </div>
        </div>

        {/* Edit mode controls (shows when unlocked) - only in advanced mode */}
        {isUnlocked && !isHolding && editModeEnabled && (
          <div className="fixed bottom-4 right-4 z-[1000] flex flex-col items-end gap-2">
            {/* Action Bar controls - only if multiple action bars enabled (standard+) */}
            {multipleActionBarsEnabled &&
              (() => {
                // Count existing action bar windows
                const actionBarCount = windows.filter(
                  (w) =>
                    w.id.startsWith("actionbar-") && w.id.endsWith("-window"),
                ).length;
                const canAddMore = actionBarCount < MAX_ACTION_BARS;
                const canRemove = actionBarCount > 1;

                return (
                  <div className="flex gap-2">
                    {canAddMore && (
                      <button
                        className="pointer-events-auto"
                        onClick={() => {
                          // Find next available action bar ID
                          const existingIds = new Set(
                            windows
                              .filter((w) => w.id.startsWith("actionbar-"))
                              .map((w) => w.id),
                          );
                          let nextId = 0;
                          while (
                            existingIds.has(`actionbar-${nextId}-window`) &&
                            nextId < MAX_ACTION_BARS
                          ) {
                            nextId++;
                          }
                          if (nextId < MAX_ACTION_BARS) {
                            // Use responsive sizing for action bars
                            const viewport =
                              typeof window !== "undefined"
                                ? {
                                    width: window.innerWidth,
                                    height: window.innerHeight,
                                  }
                                : { width: 1920, height: 1080 };
                            const actionbarSizing = getResponsivePanelSizing(
                              "actionbar",
                              viewport,
                            );

                            createWindow({
                              id: `actionbar-${nextId}-window`,
                              position: {
                                x: 100 + nextId * 50,
                                y:
                                  viewport.height -
                                  actionbarSizing.size.height -
                                  10 -
                                  nextId * 60,
                              },
                              size: actionbarSizing.size,
                              minSize: actionbarSizing.minSize,
                              maxSize: actionbarSizing.maxSize,
                              tabs: [
                                {
                                  id: `actionbar-${nextId}`,
                                  label: `Action Bar ${nextId + 1}`,
                                  content: `actionbar-${nextId}`,
                                  closeable: false,
                                  icon: "⚡",
                                },
                              ],
                              transparency: 0,
                            });
                          }
                        }}
                        style={{
                          padding: "6px 12px",
                          backgroundColor: "rgba(59, 130, 246, 0.9)",
                          color: "#fff",
                          borderRadius: 6,
                          fontSize: 11,
                          fontWeight: 600,
                          border: "none",
                          cursor: "pointer",
                        }}
                      >
                        + Add ({actionBarCount}/{MAX_ACTION_BARS})
                      </button>
                    )}
                    {canRemove && (
                      <button
                        className="pointer-events-auto"
                        onClick={() => {
                          // Find the last action bar (highest ID) and remove it
                          const actionBars = windows
                            .filter(
                              (w) =>
                                w.id.startsWith("actionbar-") &&
                                w.id.endsWith("-window"),
                            )
                            .sort((a, b) => {
                              // Extract number from actionbar-N-window
                              const aNum = parseInt(
                                a.id
                                  .replace("actionbar-", "")
                                  .replace("-window", ""),
                                10,
                              );
                              const bNum = parseInt(
                                b.id
                                  .replace("actionbar-", "")
                                  .replace("-window", ""),
                                10,
                              );
                              return bNum - aNum;
                            });
                          if (actionBars.length > 1) {
                            // Remove the last one (highest numbered)
                            destroyWindowFromStore(actionBars[0].id);
                          }
                        }}
                        style={{
                          padding: "6px 12px",
                          backgroundColor: "rgba(239, 68, 68, 0.9)",
                          color: "#fff",
                          borderRadius: 6,
                          fontSize: 11,
                          fontWeight: 600,
                          border: "none",
                          cursor: "pointer",
                        }}
                      >
                        − Remove ({actionBarCount}/{MAX_ACTION_BARS})
                      </button>
                    )}
                  </div>
                );
              })()}

            {/* Edit mode indicator */}
            <div
              className="pointer-events-none"
              style={{
                padding: "6px 12px",
                backgroundColor: "rgba(255, 153, 0, 0.9)",
                color: "#fff",
                borderRadius: 6,
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              🔓 Edit Mode (Hold L to lock)
            </div>
          </div>
        )}
      </DndProvider>
    </HintProvider>
  );
}

/** Window content renderer */
interface WindowContentProps {
  activeTabIndex: number;
  tabs: WindowState["tabs"];
  renderPanel: (
    panelId: string,
    world?: ClientWorld,
    windowId?: string,
  ) => ReactNode;
  windowId?: string;
}

function WindowContent({
  activeTabIndex,
  tabs,
  renderPanel,
  windowId,
}: WindowContentProps): React.ReactElement | null {
  const activeTab = tabs[activeTabIndex];
  if (!activeTab) return null;

  // If content is a string (panel ID), use the renderPanel function
  if (typeof activeTab.content === "string") {
    const panelContent = renderPanel(activeTab.content, undefined, windowId);

    // Action bars have no padding
    const isActionBar = activeTab.content.startsWith("actionbar-");

    // Container fills available space, panels handle their own scrolling
    // No overflow: auto here - that creates nested scroll containers
    return (
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          overflow: "hidden",
          padding: isActionBar ? 0 : 4,
        }}
      >
        {panelContent}
      </div>
    );
  }

  // Otherwise render the content directly
  return <>{activeTab.content}</>;
}

/** Draggable content wrapper for single-tab windows (no TabBar) */
interface DraggableContentWrapperProps extends WindowContentProps {
  windowId: string;
  dragHandleProps?: {
    onPointerDown: (e: React.PointerEvent) => void;
    style: React.CSSProperties;
  };
  isUnlocked?: boolean;
}

function DraggableContentWrapper({
  windowId,
  activeTabIndex,
  tabs,
  renderPanel,
  dragHandleProps,
  isUnlocked,
}: DraggableContentWrapperProps): React.ReactElement | null {
  const activeTab = tabs[activeTabIndex];
  const { mergeWindow, isTabDragging, draggingSourceWindowId } = useTabDrag();
  const destroyWindow = useWindowStore((s) => s.destroyWindow);

  // Check if a window is being dragged (for window-to-window merge)
  const isDragging = useDragStore((s) => s.isDragging);
  const dragItem = useDragStore((s) => s.item);
  const isWindowDragging = isDragging && dragItem?.type === "window";
  const draggingWindowId = isWindowDragging ? dragItem?.id : null;

  // Drop zone for merging windows - accepts tabs AND windows from other windows
  const { isOver, dropProps } = useDrop({
    id: `merge-zone-${windowId}`,
    accepts: ["tab", "window"],
    onDrop: (item) => {
      if (item.type === "tab") {
        // Merge the source window into this window (tab drag)
        if (item.sourceId && item.sourceId !== windowId) {
          mergeWindow(item.sourceId, windowId);
        }
      } else if (item.type === "window") {
        // Merge the dragged window into this window (window drag)
        if (item.id && item.id !== windowId) {
          mergeWindow(item.id, windowId);
        }
      }
    },
  });

  // Show merge zone when dragging a tab or window from another window
  const isDraggingFromOther =
    (isTabDragging && draggingSourceWindowId !== windowId) ||
    (isWindowDragging && draggingWindowId !== windowId);
  const showMergeZone = isUnlocked && isDraggingFromOther;

  if (!activeTab) return null;

  // Get panel content
  const panelContent =
    typeof activeTab.content === "string"
      ? renderPanel(activeTab.content, undefined, windowId)
      : activeTab.content;

  // Container fills available space, draggable in edit mode
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        overflow: "hidden",
        position: "relative",
      }}
    >
      {/* Merge zone - always rendered for drop detection, visible when dragging */}
      <div
        {...dropProps}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: showMergeZone ? 32 : 0,
          background: isOver
            ? "linear-gradient(180deg, rgba(100, 200, 255, 0.4) 0%, rgba(100, 200, 255, 0.1) 100%)"
            : showMergeZone
              ? "linear-gradient(180deg, rgba(100, 200, 255, 0.2) 0%, transparent 100%)"
              : "transparent",
          borderBottom: showMergeZone
            ? isOver
              ? "2px solid rgba(100, 200, 255, 0.8)"
              : "1px dashed rgba(100, 200, 255, 0.4)"
            : "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 10,
          transition: "all 0.15s ease",
          pointerEvents: showMergeZone ? "auto" : "none",
          overflow: "hidden",
        }}
      >
        {showMergeZone && (
          <span
            style={{
              fontSize: 11,
              color: isOver
                ? "rgba(255, 255, 255, 0.9)"
                : "rgba(255, 255, 255, 0.6)",
              textTransform: "uppercase",
              letterSpacing: 1,
              fontWeight: 500,
            }}
          >
            {isOver ? "Release to combine" : "Drop to combine"}
          </span>
        )}
      </div>

      {/* Close button - only in edit mode for single-tab windows */}
      {isUnlocked && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            destroyWindow(windowId);
          }}
          onPointerDown={(e) => e.stopPropagation()}
          style={{
            position: "absolute",
            top: 4,
            right: 4,
            width: 20,
            height: 20,
            background: "rgba(255, 100, 100, 0.2)",
            border: "1px solid rgba(255, 100, 100, 0.4)",
            borderRadius: 3,
            color: "rgba(255, 100, 100, 0.8)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 12,
            fontWeight: "bold",
            zIndex: 20,
            transition: "all 0.15s ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(255, 100, 100, 0.4)";
            e.currentTarget.style.color = "rgba(255, 255, 255, 0.9)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "rgba(255, 100, 100, 0.2)";
            e.currentTarget.style.color = "rgba(255, 100, 100, 0.8)";
          }}
          title="Close panel"
        >
          ×
        </button>
      )}

      {/* Actual content */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          padding: 4,
          cursor: isUnlocked ? "move" : "default",
          touchAction: isUnlocked ? "none" : "auto",
        }}
        onPointerDown={isUnlocked ? dragHandleProps?.onPointerDown : undefined}
      >
        {panelContent}
      </div>
    </div>
  );
}

/** Action bar wrapper that makes the entire content area draggable */
interface ActionBarWrapperProps extends WindowContentProps {
  dragHandleProps?: {
    onPointerDown: (e: React.PointerEvent) => void;
    style: React.CSSProperties;
  };
  isUnlocked?: boolean;
}

function ActionBarWrapper({
  activeTabIndex,
  tabs,
  renderPanel,
  dragHandleProps,
  isUnlocked,
  windowId,
}: ActionBarWrapperProps): React.ReactElement | null {
  const activeTab = tabs[activeTabIndex];
  if (!activeTab) return null;

  const panelContent =
    typeof activeTab.content === "string"
      ? renderPanel(activeTab.content, undefined, windowId)
      : activeTab.content;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "flex-start",
        cursor: isUnlocked ? "move" : "default",
        touchAction: isUnlocked ? "none" : "auto",
        overflow: "hidden",
      }}
      onPointerDown={isUnlocked ? dragHandleProps?.onPointerDown : undefined}
    >
      {panelContent}
    </div>
  );
}

/** Minimap wrapper that passes drag props to the Minimap component for edit mode dragging */
interface MinimapWrapperProps {
  world: ClientWorld;
  dragHandleProps?: {
    onPointerDown: (e: React.PointerEvent) => void;
    style: React.CSSProperties;
  };
  isUnlocked?: boolean;
}

function MinimapWrapper({
  world,
  dragHandleProps,
  isUnlocked,
}: MinimapWrapperProps): React.ReactElement {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = React.useState<{
    width: number;
    height: number;
  }>({ width: 200, height: 200 });

  React.useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        const width = Math.floor(rect.width);
        const height = Math.floor(rect.height);
        if (width > 10 && height > 10) {
          setDimensions((prev) => {
            if (prev.width !== width || prev.height !== height) {
              return { width, height };
            }
            return prev;
          });
        }
      }
    };

    updateDimensions();
    const observer = new ResizeObserver(updateDimensions);
    if (containerRef.current) {
      observer.observe(containerRef.current);
    }
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 0,
        minHeight: 0,
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
        embedded={true}
        dragHandleProps={dragHandleProps}
        isUnlocked={isUnlocked}
      />
    </div>
  );
}

export default InterfaceManager;
