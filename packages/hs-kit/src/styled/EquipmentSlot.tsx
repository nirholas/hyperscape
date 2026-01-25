/**
 * Equipment Slot Component
 *
 * Individual equipment slot with drag-drop support,
 * rarity coloring, and durability indicator.
 *
 * @packageDocumentation
 */

import React, {
  memo,
  useCallback,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useTheme } from "../stores/themeStore";
import { useDraggable, useDroppable, useDndMonitor } from "../core/drag";
import type { DragEndEvent } from "../core/drag";
import {
  type EquipmentSlotType,
  type EquipmentItemData,
  EQUIPMENT_SLOT_CONFIGS,
  RARITY_COLORS,
  getDurabilityStatus,
  getSlotDisplayName,
} from "../core/equipment";

/** Equipment slot props */
export interface EquipmentSlotProps {
  /** Slot type */
  slotType: EquipmentSlotType;
  /** Equipped item (null if empty) */
  item: EquipmentItemData | null;
  /** Size of the slot in pixels */
  size?: number;
  /** Player's level for requirement validation */
  playerLevel?: number;
  /** Whether the slot is selected */
  selected?: boolean;
  /** Whether the slot is disabled */
  disabled?: boolean;
  /** Whether to show durability bar */
  showDurability?: boolean;
  /** Whether to show item level badge */
  showItemLevel?: boolean;
  /** Click handler */
  onClick?: (
    slotType: EquipmentSlotType,
    item: EquipmentItemData | null,
  ) => void;
  /** Right-click handler (usually unequip) */
  onContextMenu?: (
    slotType: EquipmentSlotType,
    item: EquipmentItemData | null,
    e: React.MouseEvent,
  ) => void;
  /** Drop handler */
  onDrop?: (
    slotType: EquipmentSlotType,
    droppedItem: EquipmentItemData,
  ) => void;
  /** Hover handler for comparison tooltip */
  onHover?: (
    slotType: EquipmentSlotType,
    item: EquipmentItemData | null,
  ) => void;
  /** Custom slot icon when empty */
  emptyIcon?: ReactNode;
  /** Custom class name */
  className?: string;
  /** Custom style */
  style?: CSSProperties;
}

/**
 * Equipment Slot Component
 *
 * @example
 * ```tsx
 * <EquipmentSlot
 *   slotType="head"
 *   item={equippedHead}
 *   onDrop={(slot, item) => equipItem(item, slot)}
 *   onContextMenu={(slot) => unequipItem(slot)}
 *   showDurability
 *   showItemLevel
 * />
 * ```
 */
export const EquipmentSlot = memo(function EquipmentSlot({
  slotType,
  item,
  size,
  selected = false,
  disabled = false,
  playerLevel,
  showDurability = true,
  showItemLevel = true,
  onClick,
  onContextMenu,
  onDrop,
  onHover,
  emptyIcon,
  className,
  style,
}: EquipmentSlotProps): React.ReactElement {
  const theme = useTheme();
  const slotSize = size ?? theme.slot.size + 8; // Equipment slots slightly larger
  const slotConfig = EQUIPMENT_SLOT_CONFIGS[slotType];
  const displayName = getSlotDisplayName(slotType);

  // Check if player meets level requirement
  const meetsLevelRequirement =
    !item?.requiredLevel ||
    (playerLevel !== undefined && playerLevel >= item.requiredLevel);
  const levelRequirementWarning =
    item?.requiredLevel && !meetsLevelRequirement
      ? `Requires level ${item.requiredLevel}`
      : undefined;

  const slotId = `equip-${slotType}`;
  const dropTargetId = `drop-${slotId}`;

  // Drag handling (for equipped items)
  const {
    attributes: dragAttributes,
    listeners: dragListeners,
    setNodeRef: setDragRef,
    isDragging,
  } = useDraggable({
    id: slotId,
    data: { item, slotType, type: "equipment" },
    disabled: disabled || !item,
  });

  // Drop handling
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: dropTargetId,
    data: { slotType, type: "equipment-slot" },
    disabled,
  });

  // Listen for drag end events
  const onDropRef = React.useRef(onDrop);
  onDropRef.current = onDrop;

  useDndMonitor({
    onDragEnd: useCallback(
      (event: DragEndEvent) => {
        if (event.over?.id === dropTargetId && onDropRef.current) {
          const droppedData = event.active.data as {
            item?: EquipmentItemData;
            type?: string;
          };
          if (droppedData?.item) {
            onDropRef.current(slotType, droppedData.item);
          }
        }
      },
      [dropTargetId, slotType],
    ),
  });

  // Combine refs
  const setNodeRef = useCallback(
    (node: HTMLElement | null) => {
      setDragRef(node);
      setDropRef(node);
    },
    [setDragRef, setDropRef],
  );

  // Event handlers
  const handleClick = useCallback(() => {
    if (!disabled && onClick) {
      onClick(slotType, item);
    }
  }, [disabled, onClick, slotType, item]);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      if (!disabled && onContextMenu) {
        onContextMenu(slotType, item, e);
      }
    },
    [disabled, onContextMenu, slotType, item],
  );

  const handleMouseEnter = useCallback(() => {
    if (onHover) {
      onHover(slotType, item);
    }
  }, [onHover, slotType, item]);

  const handleMouseLeave = useCallback(() => {
    if (onHover) {
      onHover(slotType, null);
    }
  }, [onHover, slotType]);

  // Get durability status
  const durability = item ? getDurabilityStatus(item) : null;
  const rarityColor = item ? RARITY_COLORS[item.rarity] : null;

  // Determine slot state
  const getState = () => {
    if (disabled) return "disabled";
    if (selected) return "selected";
    if (isOver) return "hover";
    if (item) return "filled";
    return "empty";
  };

  const state = getState();

  // Container styles
  const containerStyle: CSSProperties = {
    width: slotSize,
    height: slotSize,
    position: "relative",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor:
      theme.colors.slot[
        state === "hover" ? "hover" : state === "filled" ? "filled" : "empty"
      ],
    border: `2px solid ${rarityColor || theme.colors.border.default}`,
    borderRadius: theme.borderRadius.md,
    cursor: disabled ? "not-allowed" : item ? "grab" : "default",
    opacity: isDragging ? 0.4 : disabled ? 0.5 : 1,
    transition: theme.transitions.fast,
    // Drop indicator
    ...(isOver
      ? {
          borderColor: theme.colors.accent.primary,
          boxShadow: `inset 0 0 8px ${theme.colors.accent.primary}40, 0 0 8px ${theme.colors.accent.primary}40`,
        }
      : {}),
    // Rarity glow
    ...(rarityColor && !isOver
      ? {
          boxShadow: `inset 0 0 4px ${rarityColor}30`,
        }
      : {}),
    ...style,
  };

  // Icon container style
  const iconContainerStyle: CSSProperties = {
    width: slotSize - 8,
    height: slotSize - 8,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: (slotSize - 8) * 0.75,
    userSelect: "none",
  };

  // Empty slot label style
  const emptyLabelStyle: CSSProperties = {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.text.muted,
    textAlign: "center",
    lineHeight: 1.2,
    padding: 2,
    userSelect: "none",
  };

  // Item level badge style
  const itemLevelStyle: CSSProperties = {
    position: "absolute",
    top: 2,
    right: 2,
    fontSize: 9,
    fontWeight: theme.typography.fontWeight.bold,
    color: theme.colors.text.primary,
    backgroundColor: `${theme.colors.background.primary}cc`,
    padding: "1px 3px",
    borderRadius: 2,
    lineHeight: 1,
  };

  // Durability bar style
  const durabilityBarContainerStyle: CSSProperties = {
    position: "absolute",
    bottom: 2,
    left: 2,
    right: 2,
    height: 3,
    backgroundColor: `${theme.colors.background.primary}80`,
    borderRadius: 1,
    overflow: "hidden",
  };

  const durabilityBarStyle: CSSProperties = {
    width: `${durability?.percent || 0}%`,
    height: "100%",
    backgroundColor: durability?.color || theme.colors.state.success,
    transition: theme.transitions.normal,
  };

  return (
    <div
      ref={setNodeRef}
      className={className}
      style={containerStyle}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      title={item?.name || displayName}
      {...dragAttributes}
      {...dragListeners}
    >
      {/* Item icon or empty state */}
      {item ? (
        <div style={iconContainerStyle}>
          {typeof item.icon === "string" ? (
            item.icon.startsWith("http") || item.icon.startsWith("/") ? (
              <img
                src={item.icon}
                alt={item.name}
                style={{
                  width: slotSize - 8,
                  height: slotSize - 8,
                  objectFit: "contain",
                }}
                draggable={false}
              />
            ) : (
              <span>{item.icon}</span>
            )
          ) : (
            item.icon
          )}
        </div>
      ) : (
        <div style={emptyLabelStyle}>
          {emptyIcon || slotConfig?.label.split(" ")[0] || displayName}
        </div>
      )}

      {/* Item level badge */}
      {item && showItemLevel && (
        <span style={itemLevelStyle}>{item.itemLevel}</span>
      )}

      {/* Durability bar */}
      {item && showDurability && durability && durability.percent < 100 && (
        <div style={durabilityBarContainerStyle}>
          <div style={durabilityBarStyle} />
        </div>
      )}

      {/* Level requirement warning */}
      {levelRequirementWarning && (
        <div
          style={{
            position: "absolute",
            top: -4,
            left: -4,
            width: 16,
            height: 16,
            borderRadius: "50%",
            backgroundColor: theme.colors.state.danger,
            color: "#ffffff",
            fontSize: 10,
            fontWeight: theme.typography.fontWeight.bold,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: `1px solid ${theme.colors.background.primary}`,
            boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
          }}
          title={levelRequirementWarning}
        >
          !
        </div>
      )}
    </div>
  );
});

export default EquipmentSlot;
