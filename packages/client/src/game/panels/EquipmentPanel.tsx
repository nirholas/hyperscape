import React, { useState, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  useDroppable,
  useDragStore,
  calculateCursorTooltipPosition,
  TOOLTIP_SIZE_ESTIMATES,
  useThemeStore,
  useMobileLayout,
} from "@/ui";
import { MOBILE_EQUIPMENT } from "../../constants";
import { useContextMenuState } from "../../hooks";
import {
  EquipmentSlotName,
  EventType,
  getItem,
  uuid,
  CONTEXT_MENU_COLORS,
} from "@hyperscape/shared";
import type { PlayerEquipmentItems, Item, ClientWorld } from "../../types";

interface EquipmentPanelProps {
  equipment: PlayerEquipmentItems | null;
  world?: ClientWorld;
  onItemDrop?: (item: Item, slot: keyof typeof EquipmentSlotName) => void;
}

interface EquipmentSlot {
  key: string;
  label: string;
  icon: React.ReactNode;
  item: Item | null;
}

// ============================================================================
// SVG Icons for Equipment Slots (Clean monochrome design)
// ============================================================================

/** Helmet/Head slot icon */
function HelmetIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M12 2C7 2 4 6 4 10v4c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-4c0-4-3-8-8-8z" />
      <path d="M4 12h16" />
      <path d="M8 16v2M16 16v2" />
    </svg>
  );
}

/** Weapon slot icon (crossed swords) */
function WeaponIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M14.5 17.5L3 6V3h3l11.5 11.5" />
      <path d="M13 19l6-6" />
      <path d="M16 16l4 4" />
      <path d="M19 21l2-2" />
      <path d="M9.5 6.5L21 18V21h-3L6.5 9.5" />
    </svg>
  );
}

/** Body/Chest armor slot icon */
function BodyIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M6 4l-2 2v12l2 2h12l2-2V6l-2-2" />
      <path d="M6 4h12" />
      <path d="M9 4v3c0 1.7 1.3 3 3 3s3-1.3 3-3V4" />
      <path d="M4 8h2M18 8h2" />
    </svg>
  );
}

/** Shield slot icon */
function ShieldIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

/** Legs slot icon */
function LegsIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M6 4h12v4l-1 12H7L6 8V4z" />
      <path d="M12 4v16" />
      <path d="M6 8h12" />
    </svg>
  );
}

/** Arrows/Ammo slot icon */
function ArrowsIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {/* Arrow shaft */}
      <path d="M5 19L19 5" />
      {/* Arrow head */}
      <path d="M15 5h4v4" />
      {/* Arrow fletching */}
      <path d="M5 19l3-1M5 19l1-3" />
      {/* Second arrow (stacked) */}
      <path d="M8 16L18 6" strokeOpacity="0.5" />
    </svg>
  );
}

// ============================================================================
// Utility Button Icons
// ============================================================================

/** Stats icon (bar chart) */
function StatsIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M18 20V10M12 20V4M6 20v-6" />
    </svg>
  );
}

/** Death/Skull icon */
function DeathIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <circle cx="12" cy="10" r="7" />
      <circle cx="9" cy="9" r="1.5" fill="currentColor" />
      <circle cx="15" cy="9" r="1.5" fill="currentColor" />
      <path d="M8 17v4M12 17v4M16 17v4" />
      <path d="M9 14c.8.7 1.9 1 3 1s2.2-.3 3-1" />
    </svg>
  );
}

// ============================================================================
// Utility Button Component
// ============================================================================

interface UtilityButtonProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

function UtilityButton({
  icon,
  label,
  onClick,
  disabled,
}: UtilityButtonProps & { compact?: boolean }) {
  const theme = useThemeStore((s) => s.theme);

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-center justify-center rounded transition-all duration-150 hover:scale-105 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed px-3 py-2"
      title={label}
      style={{
        background: `${theme.colors.background.tertiary}80`,
        border: `1px solid ${theme.colors.border.default}60`,
      }}
    >
      <div className="w-5 h-5" style={{ color: theme.colors.accent.primary }}>
        {icon}
      </div>
    </button>
  );
}

interface DroppableEquipmentSlotProps {
  slot: EquipmentSlot;
  onSlotClick: (slot: EquipmentSlot) => void;
  onHoverStart: (
    slot: EquipmentSlot,
    position: { x: number; y: number },
  ) => void;
  onHoverMove: (position: { x: number; y: number }) => void;
  onHoverEnd: () => void;
  onContextMenuOpen: () => void;
}

interface EquipmentHoverState {
  slot: EquipmentSlot;
  position: { x: number; y: number };
}

/**
 * Render enhanced equipment hover tooltip content
 * Shows item stats, rarity, requirements, and hints
 */
function renderEquipmentHoverTooltip(
  hoverState: EquipmentHoverState,
  theme: ReturnType<typeof useThemeStore.getState>["theme"],
): React.ReactNode {
  const item = hoverState.slot.item;
  if (!item) return null;

  // Get full item data for additional info
  const itemData = getItem(item.id);
  const rarity = itemData?.rarity || "common";
  const equipSlot = itemData?.equipSlot || hoverState.slot.label;

  // Rarity colors (matching RARITY_COLORS)
  const rarityColors: Record<string, string> = {
    common: "#9d9d9d",
    uncommon: "#1eff00",
    rare: "#0070dd",
    epic: "#a335ee",
    legendary: "#ff8000",
    mythic: "#e6cc80",
  };
  const rarityColor = rarityColors[rarity] || theme.colors.accent.primary;

  // Use tooltip positioning with edge detection
  const { left, top } = calculateCursorTooltipPosition(
    { x: hoverState.position.x, y: hoverState.position.y },
    TOOLTIP_SIZE_ESTIMATES.large,
    8,
  );

  const hasBonuses =
    item.bonuses &&
    ((item.bonuses.attack !== undefined && item.bonuses.attack !== 0) ||
      (item.bonuses.defense !== undefined && item.bonuses.defense !== 0) ||
      (item.bonuses.strength !== undefined && item.bonuses.strength !== 0));

  return createPortal(
    <div
      className="pointer-events-none"
      style={{
        position: "fixed",
        left,
        top,
        zIndex: theme.zIndex.tooltip,
        background: `linear-gradient(180deg, ${theme.colors.background.primary} 0%, ${theme.colors.background.secondary} 100%)`,
        border: `1px solid ${theme.colors.border.hover}`,
        borderRadius: `${theme.borderRadius.md}px`,
        padding: "10px 12px",
        boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
        minWidth: "160px",
        maxWidth: "240px",
      }}
    >
      {/* Item name with rarity color */}
      <div
        style={{
          color: rarityColor,
          fontWeight: theme.typography.fontWeight.bold,
          fontSize: theme.typography.fontSize.sm,
          marginBottom: "2px",
        }}
      >
        {item.name}
      </div>

      {/* Item type and rarity */}
      <div
        style={{
          fontSize: "10px",
          color: theme.colors.text.muted,
          marginBottom: hasBonuses ? "8px" : "0",
          textTransform: "capitalize",
        }}
      >
        {equipSlot} • {rarity}
      </div>

      {/* Stat bonuses */}
      {hasBonuses && (
        <div
          style={{
            fontSize: "11px",
            borderTop: `1px solid ${theme.colors.border.default}40`,
            paddingTop: "6px",
            marginBottom: "6px",
          }}
        >
          {item.bonuses!.attack !== undefined && item.bonuses!.attack !== 0 && (
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                color: theme.colors.text.secondary,
                marginBottom: "2px",
              }}
            >
              <span>Attack</span>
              <span style={{ color: theme.colors.state.success }}>
                +{item.bonuses!.attack}
              </span>
            </div>
          )}
          {item.bonuses!.defense !== undefined &&
            item.bonuses!.defense !== 0 && (
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  color: theme.colors.text.secondary,
                  marginBottom: "2px",
                }}
              >
                <span>Defense</span>
                <span style={{ color: theme.colors.state.success }}>
                  +{item.bonuses!.defense}
                </span>
              </div>
            )}
          {item.bonuses!.strength !== undefined &&
            item.bonuses!.strength !== 0 && (
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  color: theme.colors.text.secondary,
                }}
              >
                <span>Strength</span>
                <span style={{ color: theme.colors.state.success }}>
                  +{item.bonuses!.strength}
                </span>
              </div>
            )}
        </div>
      )}

      {/* Level requirement if any */}
      {itemData?.requirements?.level && (
        <div
          style={{
            fontSize: "10px",
            color: theme.colors.text.muted,
            marginBottom: "4px",
          }}
        >
          Requires Level {itemData.requirements.level}
        </div>
      )}

      {/* Click hint */}
      <div
        style={{
          fontSize: "9px",
          color: theme.colors.text.muted,
          marginTop: "6px",
          paddingTop: "6px",
          borderTop: `1px solid ${theme.colors.border.default}30`,
          opacity: 0.7,
        }}
      >
        Click to unequip • Right-click for options
      </div>
    </div>,
    document.body,
  );
}

function DroppableEquipmentSlot({
  slot,
  onSlotClick,
  onHoverStart,
  onHoverMove,
  onHoverEnd,
  onContextMenuOpen,
}: DroppableEquipmentSlotProps) {
  const theme = useThemeStore((s) => s.theme);
  const { shouldUseMobileUI } = useMobileLayout();
  const { isOver, setNodeRef } = useDroppable({
    id: `equipment-${slot.key}`,
    data: { slot: slot.key },
  });

  // Check if the currently dragged item can be equipped in this slot
  const dragItem = useDragStore((state) => state.item);
  const isDragging = useDragStore((state) => state.isDragging);

  // Determine if the dragged item is valid for this slot
  const isValidDrop = useMemo(() => {
    if (!isDragging || !dragItem?.id?.toString().startsWith("inventory-")) {
      return false; // Not dragging an inventory item
    }

    // Get item data from drag context
    const dragData = dragItem.data as { item?: { itemId: string } } | undefined;
    if (!dragData?.item?.itemId) return true; // No data, assume valid (server will validate)

    const itemData = getItem(dragData.item.itemId);
    if (!itemData) return true; // Unknown item, assume valid

    const itemEquipSlot = itemData.equipSlot;
    // Map 2h weapons to weapon slot
    const normalizedSlot = itemEquipSlot === "2h" ? "weapon" : itemEquipSlot;

    // Check if item matches this slot
    return !normalizedSlot || normalizedSlot === slot.key;
  }, [isDragging, dragItem?.id, dragItem?.data, slot.key]);

  // Is there an inventory item being dragged?
  const isDraggingInventoryItem =
    isDragging && dragItem?.id?.toString().startsWith("inventory-");

  const isEmpty = !slot.item;

  return (
    <button
      ref={setNodeRef}
      onClick={() => onSlotClick(slot)}
      onMouseEnter={(e) => {
        if (slot.item) {
          onHoverStart(slot, { x: e.clientX, y: e.clientY });
        }
      }}
      onMouseMove={(e) => {
        if (slot.item) {
          onHoverMove({ x: e.clientX, y: e.clientY });
        }
      }}
      onMouseLeave={() => onHoverEnd()}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();

        // Hide hover tooltip and mark context menu as open
        onHoverEnd();
        onContextMenuOpen();

        if (!slot.item) return;

        // OSRS uses orange for item names in context menus
        const itemName = slot.item.name;

        const items = [
          {
            id: "unequip",
            label: `Remove ${itemName}`,
            styledLabel: [
              { text: "Remove " },
              { text: itemName, color: CONTEXT_MENU_COLORS.ITEM },
            ],
            enabled: true,
          },
          {
            id: "examine",
            label: `Examine ${itemName}`,
            styledLabel: [
              { text: "Examine " },
              { text: itemName, color: CONTEXT_MENU_COLORS.ITEM },
            ],
            enabled: true,
          },
        ];

        const evt = new CustomEvent("contextmenu", {
          detail: {
            target: {
              id: `equipment_slot_${slot.key}`,
              type: "equipment",
              name: itemName,
            },
            mousePosition: { x: e.clientX, y: e.clientY },
            items,
          },
        });
        window.dispatchEvent(evt);
      }}
      className="w-full h-full rounded transition-all duration-150 cursor-pointer group relative"
      style={{
        // Embossed style matching inventory - aligned with theme
        background:
          isOver && isValidDrop
            ? "rgba(242, 208, 138, 0.15)"
            : isOver && !isValidDrop
              ? "rgba(220, 80, 80, 0.15)"
              : isDraggingInventoryItem && isValidDrop
                ? "rgba(242, 208, 138, 0.08)"
                : isEmpty
                  ? "rgba(16, 16, 18, 0.95)"
                  : "rgba(20, 20, 22, 0.95)",
        borderWidth: "1px",
        borderStyle: isOver
          ? "solid"
          : isDraggingInventoryItem && isValidDrop
            ? "dashed"
            : "solid",
        borderColor:
          isOver && isValidDrop
            ? "rgba(100, 180, 100, 0.7)"
            : isOver && !isValidDrop
              ? "rgba(180, 80, 80, 0.7)"
              : isDraggingInventoryItem && isValidDrop
                ? "rgba(180, 160, 100, 0.5)"
                : "rgba(8, 8, 10, 0.6)",
        // Embossed shadows: dark on top-left, subtle light on bottom-right
        boxShadow:
          isOver && isValidDrop
            ? "inset 0 0 8px rgba(100, 180, 100, 0.3)"
            : isOver && !isValidDrop
              ? "inset 0 0 8px rgba(180, 80, 80, 0.3)"
              : isEmpty
                ? "inset 2px 2px 4px rgba(0, 0, 0, 0.5), inset -1px -1px 2px rgba(40, 40, 45, 0.15)"
                : "inset 2px 2px 4px rgba(0, 0, 0, 0.4), inset -1px -1px 2px rgba(50, 50, 55, 0.12)",
      }}
    >
      {/* Slot Label - subtle, positioned at top */}
      <div
        className={`absolute left-0 right-0 text-center ${shouldUseMobileUI ? "top-1" : "top-1.5"}`}
        style={{
          fontSize: shouldUseMobileUI ? "8px" : "10px",
          fontWeight: 600,
          color: "rgba(200, 180, 140, 0.7)",
          textShadow: "0 1px 2px rgba(0, 0, 0, 0.9)",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}
      >
        {slot.label}
      </div>

      {/* Slot Content */}
      <div
        className={`flex flex-col items-center justify-center h-full ${shouldUseMobileUI ? "pt-2.5" : "pt-3"}`}
      >
        {isEmpty ? (
          <div
            className="transition-all duration-150 group-hover:scale-105 group-hover:opacity-40"
            style={{
              width: shouldUseMobileUI ? "20px" : "26px",
              height: shouldUseMobileUI ? "20px" : "26px",
              color: "rgba(180, 160, 120, 0.3)",
            }}
          >
            {slot.icon}
          </div>
        ) : (
          <>
            <div
              className="transition-transform duration-150 group-hover:scale-105"
              style={{
                width: shouldUseMobileUI ? "18px" : "24px",
                height: shouldUseMobileUI ? "18px" : "24px",
                color: "#d4b87a",
                filter: "drop-shadow(0 1px 2px rgba(0, 0, 0, 0.7))",
              }}
            >
              {slot.icon}
            </div>
            <div
              className="text-center px-0.5 mt-0.5"
              style={{
                fontSize: shouldUseMobileUI ? "8px" : "9px",
                color: "rgba(220, 200, 160, 0.9)",
                fontWeight: 500,
                lineHeight: "1.1",
                maxWidth: "100%",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                textShadow: "0 1px 2px rgba(0, 0, 0, 0.8)",
              }}
            >
              {slot.item!.name}
            </div>
            {(slot.item!.quantity ?? 1) > 1 && (
              <div
                className="absolute bottom-0.5 right-1 font-bold"
                style={{
                  fontSize: shouldUseMobileUI ? "8px" : "9px",
                  color: "#d4b87a",
                  textShadow: "0 1px 2px rgba(0, 0, 0, 0.9)",
                }}
              >
                {slot.item!.quantity ?? 1}
              </div>
            )}
          </>
        )}
      </div>

      {/* Hover Glow Effect */}
      {!isEmpty && (
        <div
          className="absolute inset-0 rounded-md opacity-0 group-hover:opacity-100 transition-opacity duration-150 pointer-events-none"
          style={{
            background: `radial-gradient(circle at center, ${theme.colors.accent.primary}15 0%, transparent 70%)`,
          }}
        />
      )}
    </button>
  );
}

export function EquipmentPanel({
  equipment,
  world,
  onItemDrop: _onItemDrop,
}: EquipmentPanelProps) {
  const theme = useThemeStore((s) => s.theme);
  const { shouldUseMobileUI } = useMobileLayout();
  // RS3-style hover tooltip state
  const [hoverState, setHoverState] = useState<EquipmentHoverState | null>(
    null,
  );

  // Track if context menu is open (suppress hover tooltips while open)
  const { isContextMenuOpen, setContextMenuOpen } = useContextMenuState();

  // Equipment slots with SVG icons for paperdoll layout
  const slots: EquipmentSlot[] = [
    {
      key: EquipmentSlotName.HELMET,
      label: "Head",
      icon: <HelmetIcon className="w-full h-full" />,
      item: equipment?.helmet || null,
    },
    {
      key: EquipmentSlotName.BODY,
      label: "Body",
      icon: <BodyIcon className="w-full h-full" />,
      item: equipment?.body || null,
    },
    {
      key: EquipmentSlotName.LEGS,
      label: "Legs",
      icon: <LegsIcon className="w-full h-full" />,
      item: equipment?.legs || null,
    },
    {
      key: EquipmentSlotName.WEAPON,
      label: "Weapon",
      icon: <WeaponIcon className="w-full h-full" />,
      item: equipment?.weapon || null,
    },
    {
      key: EquipmentSlotName.SHIELD,
      label: "Shield",
      icon: <ShieldIcon className="w-full h-full" />,
      item: equipment?.shield || null,
    },
    {
      key: EquipmentSlotName.ARROWS,
      label: "Ammo",
      icon: <ArrowsIcon className="w-full h-full" />,
      item: equipment?.arrows || null,
    },
  ];

  // Calculate total equipment bonuses for stats display
  const totalBonuses = useMemo(() => {
    let attack = 0;
    let defense = 0;
    let strength = 0;

    slots.forEach((slot) => {
      if (slot.item?.bonuses) {
        attack += slot.item.bonuses.attack || 0;
        defense += slot.item.bonuses.defense || 0;
        strength += slot.item.bonuses.strength || 0;
      }
    });

    return { attack, defense, strength };
  }, [equipment]);

  // Utility button handlers
  const handleOpenStats = () => {
    // Open the character stats panel via UI event
    if (world) {
      world.emit(EventType.UI_OPEN_PANE, { pane: "stats" });
    }
  };

  const handleOpenDeath = () => {
    // Open the items kept on death panel via UI event
    if (world) {
      world.emit(EventType.UI_OPEN_PANE, { pane: "death" });
    }
  };

  // RS3-style: Click immediately unequips
  const handleSlotClick = (slot: EquipmentSlot) => {
    if (!slot.item) return;

    const localPlayer = world?.getPlayer();
    if (localPlayer && world?.network?.send) {
      console.log("[EquipmentPanel] 📤 Click-to-unequip:", {
        playerId: localPlayer.id,
        slot: slot.key,
      });
      world.network.send("unequipItem", {
        playerId: localPlayer.id,
        slot: slot.key,
      });
    }
  };

  // Hover handlers for tooltip
  const handleHoverStart = (
    slot: EquipmentSlot,
    position: { x: number; y: number },
  ) => {
    // Don't show hover tooltip if context menu is open
    if (isContextMenuOpen) return;
    setHoverState({ slot, position });
  };

  const handleHoverMove = (position: { x: number; y: number }) => {
    // Don't update hover tooltip if context menu is open
    if (isContextMenuOpen) return;
    setHoverState((prev) => (prev ? { ...prev, position } : null));
  };

  const handleHoverEnd = () => {
    setHoverState(null);
  };

  const handleContextMenuOpen = () => {
    setContextMenuOpen(true);
  };

  useEffect(() => {
    const onCtxSelect = (evt: Event) => {
      const ce = evt as CustomEvent<{
        actionId: string;
        targetId: string;
        position?: { x: number; y: number };
      }>;
      const target = ce.detail?.targetId || "";
      if (!target.startsWith("equipment_slot_")) return;

      const slotKey = target.replace("equipment_slot_", "");
      const slot = slots.find((s) => s.key === slotKey);

      if (!slot || !slot.item) return;

      if (ce.detail.actionId === "unequip") {
        const localPlayer = world?.getPlayer();
        if (localPlayer && world?.network?.send) {
          console.log("[EquipmentPanel] 📤 Sending unequipItem to server:", {
            playerId: localPlayer.id,
            slot: slotKey,
          });
          world.network.send("unequipItem", {
            playerId: localPlayer.id,
            slot: slotKey,
          });
        } else {
          console.error("[EquipmentPanel] ❌ No local player or network.send!");
        }
      }

      if (ce.detail.actionId === "examine") {
        const itemData = getItem(slot.item.id);
        const examineText = itemData?.examine || `It's a ${slot.item.name}.`;
        world?.emit(EventType.UI_TOAST, {
          message: examineText,
          type: "info",
          position: ce.detail.position,
        });
        // Also add to chat (OSRS-style game message)
        if (world?.chat?.add) {
          world.chat.add({
            id: uuid(),
            from: "",
            body: examineText,
            createdAt: new Date().toISOString(),
            timestamp: Date.now(),
          });
        }
      }
    };
    window.addEventListener("contextmenu:select", onCtxSelect as EventListener);
    return () =>
      window.removeEventListener(
        "contextmenu:select",
        onCtxSelect as EventListener,
      );
  }, [equipment, world]);

  // Helper to find slot by key
  const getSlot = (key: string) => slots.find((s) => s.key === key) || null;

  // Mobile layout renders a compact 2-column grid
  // Desktop layout renders the traditional 3x3 paperdoll
  const renderMobileEquipmentGrid = () => (
    <div
      className="grid"
      style={{
        gridTemplateColumns: `repeat(${MOBILE_EQUIPMENT.columns}, 1fr)`,
        gap: `${MOBILE_EQUIPMENT.gap}px`,
        padding: `${MOBILE_EQUIPMENT.padding}px`,
      }}
    >
      {/* Row 1: Weapon / Shield */}
      <div
        style={{
          height: MOBILE_EQUIPMENT.slotHeight,
          containerType: "size",
        }}
      >
        <DroppableEquipmentSlot
          slot={getSlot(EquipmentSlotName.WEAPON)!}
          onSlotClick={handleSlotClick}
          onHoverStart={handleHoverStart}
          onHoverMove={handleHoverMove}
          onHoverEnd={handleHoverEnd}
          onContextMenuOpen={handleContextMenuOpen}
        />
      </div>
      <div
        style={{
          height: MOBILE_EQUIPMENT.slotHeight,
          containerType: "size",
        }}
      >
        <DroppableEquipmentSlot
          slot={getSlot(EquipmentSlotName.SHIELD)!}
          onSlotClick={handleSlotClick}
          onHoverStart={handleHoverStart}
          onHoverMove={handleHoverMove}
          onHoverEnd={handleHoverEnd}
          onContextMenuOpen={handleContextMenuOpen}
        />
      </div>

      {/* Row 2: Head / Body */}
      <div
        style={{
          height: MOBILE_EQUIPMENT.slotHeight,
          containerType: "size",
        }}
      >
        <DroppableEquipmentSlot
          slot={getSlot(EquipmentSlotName.HELMET)!}
          onSlotClick={handleSlotClick}
          onHoverStart={handleHoverStart}
          onHoverMove={handleHoverMove}
          onHoverEnd={handleHoverEnd}
          onContextMenuOpen={handleContextMenuOpen}
        />
      </div>
      <div
        style={{
          height: MOBILE_EQUIPMENT.slotHeight,
          containerType: "size",
        }}
      >
        <DroppableEquipmentSlot
          slot={getSlot(EquipmentSlotName.BODY)!}
          onSlotClick={handleSlotClick}
          onHoverStart={handleHoverStart}
          onHoverMove={handleHoverMove}
          onHoverEnd={handleHoverEnd}
          onContextMenuOpen={handleContextMenuOpen}
        />
      </div>

      {/* Row 3: Legs / Ammo */}
      <div
        style={{
          height: MOBILE_EQUIPMENT.slotHeight,
          containerType: "size",
        }}
      >
        <DroppableEquipmentSlot
          slot={getSlot(EquipmentSlotName.LEGS)!}
          onSlotClick={handleSlotClick}
          onHoverStart={handleHoverStart}
          onHoverMove={handleHoverMove}
          onHoverEnd={handleHoverEnd}
          onContextMenuOpen={handleContextMenuOpen}
        />
      </div>
      <div
        style={{
          height: MOBILE_EQUIPMENT.slotHeight,
          containerType: "size",
        }}
      >
        <DroppableEquipmentSlot
          slot={getSlot(EquipmentSlotName.ARROWS)!}
          onSlotClick={handleSlotClick}
          onHoverStart={handleHoverStart}
          onHoverMove={handleHoverMove}
          onHoverEnd={handleHoverEnd}
          onContextMenuOpen={handleContextMenuOpen}
        />
      </div>
    </div>
  );

  const renderDesktopEquipmentGrid = () => (
    <>
      {/* Paperdoll Grid Layout - 3x3 with ammo in top-right */}
      <div
        className="relative grid h-full"
        style={{
          gridTemplateColumns: "1fr 1.2fr 1fr",
          gridTemplateRows: "1fr 1.2fr 1fr",
          gap: `${theme.spacing.xs}px`,
        }}
      >
        {/* Row 1: empty, Head, Ammo */}
        <div />
        <div className="w-full h-full" style={{ containerType: "size" }}>
          <DroppableEquipmentSlot
            slot={getSlot(EquipmentSlotName.HELMET)!}
            onSlotClick={handleSlotClick}
            onHoverStart={handleHoverStart}
            onHoverMove={handleHoverMove}
            onHoverEnd={handleHoverEnd}
            onContextMenuOpen={handleContextMenuOpen}
          />
        </div>
        <div className="w-full h-full" style={{ containerType: "size" }}>
          <DroppableEquipmentSlot
            slot={getSlot(EquipmentSlotName.ARROWS)!}
            onSlotClick={handleSlotClick}
            onHoverStart={handleHoverStart}
            onHoverMove={handleHoverMove}
            onHoverEnd={handleHoverEnd}
            onContextMenuOpen={handleContextMenuOpen}
          />
        </div>

        {/* Row 2: Weapon, Body, Shield */}
        <div className="w-full h-full" style={{ containerType: "size" }}>
          <DroppableEquipmentSlot
            slot={getSlot(EquipmentSlotName.WEAPON)!}
            onSlotClick={handleSlotClick}
            onHoverStart={handleHoverStart}
            onHoverMove={handleHoverMove}
            onHoverEnd={handleHoverEnd}
            onContextMenuOpen={handleContextMenuOpen}
          />
        </div>
        <div className="w-full h-full" style={{ containerType: "size" }}>
          <DroppableEquipmentSlot
            slot={getSlot(EquipmentSlotName.BODY)!}
            onSlotClick={handleSlotClick}
            onHoverStart={handleHoverStart}
            onHoverMove={handleHoverMove}
            onHoverEnd={handleHoverEnd}
            onContextMenuOpen={handleContextMenuOpen}
          />
        </div>
        <div className="w-full h-full" style={{ containerType: "size" }}>
          <DroppableEquipmentSlot
            slot={getSlot(EquipmentSlotName.SHIELD)!}
            onSlotClick={handleSlotClick}
            onHoverStart={handleHoverStart}
            onHoverMove={handleHoverMove}
            onHoverEnd={handleHoverEnd}
            onContextMenuOpen={handleContextMenuOpen}
          />
        </div>

        {/* Row 3: empty, Legs, empty */}
        <div />
        <div className="w-full h-full" style={{ containerType: "size" }}>
          <DroppableEquipmentSlot
            slot={getSlot(EquipmentSlotName.LEGS)!}
            onSlotClick={handleSlotClick}
            onHoverStart={handleHoverStart}
            onHoverMove={handleHoverMove}
            onHoverEnd={handleHoverEnd}
            onContextMenuOpen={handleContextMenuOpen}
          />
        </div>
        <div />
      </div>
    </>
  );

  return (
    <>
      <div
        className="flex flex-col h-full overflow-hidden"
        style={{
          padding: shouldUseMobileUI ? "6px" : `${theme.spacing.xs}px`,
          gap: shouldUseMobileUI ? "6px" : `${theme.spacing.xs}px`,
        }}
      >
        {/* Equipment Grid Container */}
        <div
          className="flex-1 relative overflow-hidden"
          style={{
            background: theme.colors.background.panelSecondary,
            border: "1px solid rgba(10, 10, 12, 0.6)",
            borderRadius: `${theme.borderRadius.md}px`,
            padding: shouldUseMobileUI ? 0 : `${theme.spacing.sm}px`,
            // Embossed container
            boxShadow:
              "inset 2px 2px 4px rgba(0, 0, 0, 0.4), inset -1px -1px 3px rgba(40, 40, 45, 0.08)",
          }}
        >
          {shouldUseMobileUI
            ? renderMobileEquipmentGrid()
            : renderDesktopEquipmentGrid()}
        </div>

        {/* Bottom section: Utility Buttons */}
        {shouldUseMobileUI ? (
          <div
            className="flex items-center justify-center gap-2 px-3 py-1.5"
            style={{
              background: theme.colors.background.panelSecondary,
              borderRadius: `${theme.borderRadius.sm}px`,
              border: "1px solid rgba(10, 10, 12, 0.6)",
              boxShadow: "inset 1px 1px 3px rgba(0, 0, 0, 0.3)",
            }}
          >
            <UtilityButton
              icon={<StatsIcon className="w-full h-full" />}
              label="Stats"
              onClick={handleOpenStats}
            />
            <UtilityButton
              icon={<DeathIcon className="w-full h-full" />}
              label="Death"
              onClick={handleOpenDeath}
            />
          </div>
        ) : (
          <>
            {/* Equipment Bonuses Summary - Desktop */}
            <div
              className="flex justify-center gap-4 py-1"
              style={{
                background: `linear-gradient(180deg, ${theme.colors.background.tertiary} 0%, ${theme.colors.background.secondary} 100%)`,
                borderRadius: `${theme.borderRadius.md}px`,
                border: `1px solid ${theme.colors.border.default}`,
                fontSize: "11px",
              }}
            >
              <span style={{ color: theme.colors.state.danger }}>
                ⚔️ {totalBonuses.attack}
              </span>
              <span style={{ color: theme.colors.state.success }}>
                🛡️ {totalBonuses.defense}
              </span>
              <span style={{ color: theme.colors.state.warning }}>
                💪 {totalBonuses.strength}
              </span>
            </div>

            {/* Utility Buttons (RS3-style) - Desktop */}
            <div
              className="flex justify-between px-1 py-1.5"
              style={{
                background: `linear-gradient(180deg, ${theme.colors.background.tertiary} 0%, ${theme.colors.background.secondary} 100%)`,
                borderRadius: `${theme.borderRadius.md}px`,
                border: `1px solid ${theme.colors.border.default}`,
              }}
            >
              <UtilityButton
                icon={<StatsIcon className="w-full h-full" />}
                label="Stats"
                onClick={handleOpenStats}
              />
              <UtilityButton
                icon={<DeathIcon className="w-full h-full" />}
                label="Death"
                onClick={handleOpenDeath}
              />
            </div>
          </>
        )}
      </div>

      {/* Enhanced hover tooltip - rendered via portal */}
      {hoverState &&
        hoverState.slot.item &&
        renderEquipmentHoverTooltip(hoverState, theme)}
    </>
  );
}
