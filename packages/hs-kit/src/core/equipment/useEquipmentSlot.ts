/**
 * Equipment Slot Hook
 *
 * Individual slot state management with drag-drop,
 * validation, and comparison support.
 *
 * @packageDocumentation
 */

import { useState, useCallback, useMemo } from "react";
import { useDndMonitor } from "../drag/EnhancedDragContext";
import type {
  DragStartEvent,
  DragOverEvent,
} from "../drag/EnhancedDragContext";
import type { EquipmentSlotType, EquipmentItemData } from "./equipmentUtils";
import {
  canEquipInSlot,
  compareItemStats,
  getDurabilityStatus,
  getSlotDisplayName,
  RARITY_COLORS,
  EQUIPMENT_SLOT_CONFIGS,
} from "./equipmentUtils";

/** Slot hook configuration */
export interface UseEquipmentSlotConfig {
  /** Slot type */
  slotType: EquipmentSlotType;
  /** Currently equipped item */
  equippedItem: EquipmentItemData | null;
  /** Player level for validation */
  playerLevel?: number;
  /** Whether slot is disabled */
  disabled?: boolean;
  /** Callback when item is equipped via drag */
  onEquip?: (item: EquipmentItemData) => void;
  /** Callback when item is unequipped (right-click) */
  onUnequip?: () => void;
  /** Callback when slot is clicked */
  onClick?: () => void;
}

/** Slot hook result */
export interface UseEquipmentSlotResult {
  /** Slot display name */
  displayName: string;
  /** Currently equipped item */
  item: EquipmentItemData | null;
  /** Whether slot is empty */
  isEmpty: boolean;
  /** Whether slot is disabled */
  isDisabled: boolean;
  /** Whether a valid item is being dragged over */
  isValidDropTarget: boolean;
  /** Whether any item is being dragged over */
  isDragOver: boolean;
  /** Item being compared (hovering) */
  comparingItem: EquipmentItemData | null;
  /** Stat comparison between equipped and comparing items */
  comparison: ReturnType<typeof compareItemStats> | null;
  /** Durability status of equipped item */
  durability: ReturnType<typeof getDurabilityStatus> | null;
  /** Rarity color of equipped item */
  rarityColor: string | null;
  /** Handle drop event */
  handleDrop: (item: EquipmentItemData) => boolean;
  /** Handle right-click to unequip */
  handleContextMenu: (e: React.MouseEvent) => void;
  /** Handle click */
  handleClick: () => void;
  /** Set item being compared (for hover tooltips) */
  setComparingItem: (item: EquipmentItemData | null) => void;
  /** Check if a specific item can be equipped here */
  canAcceptItem: (item: EquipmentItemData) => boolean;
  /** Slot configuration */
  slotConfig: (typeof EQUIPMENT_SLOT_CONFIGS)[EquipmentSlotType];
}

/**
 * Hook for managing individual equipment slot state
 *
 * @example
 * ```tsx
 * function HeadSlot({ equippedItem, onEquip, onUnequip }) {
 *   const {
 *     displayName,
 *     item,
 *     isValidDropTarget,
 *     handleDrop,
 *     handleContextMenu,
 *     comparison,
 *   } = useEquipmentSlot({
 *     slotType: 'head',
 *     equippedItem,
 *     onEquip,
 *     onUnequip,
 *   });
 *
 *   return (
 *     <div
 *       className={`slot ${isValidDropTarget ? 'highlight' : ''}`}
 *       onContextMenu={handleContextMenu}
 *     >
 *       {item ? <ItemIcon item={item} /> : <EmptySlot label={displayName} />}
 *     </div>
 *   );
 * }
 * ```
 */
export function useEquipmentSlot(
  config: UseEquipmentSlotConfig,
): UseEquipmentSlotResult {
  const {
    slotType,
    equippedItem,
    playerLevel = 1,
    disabled = false,
    onEquip,
    onUnequip,
    onClick,
  } = config;

  const [comparingItem, setComparingItem] = useState<EquipmentItemData | null>(
    null,
  );
  const [isDragOver, setIsDragOver] = useState(false);
  const [isValidDropTarget, setIsValidDropTarget] = useState(false);

  const slotConfig = EQUIPMENT_SLOT_CONFIGS[slotType];
  const displayName = getSlotDisplayName(slotType);

  // Check if an item can be equipped in this slot
  const canAcceptItem = useCallback(
    (item: EquipmentItemData): boolean => {
      if (disabled) return false;
      if (!canEquipInSlot(item, slotType)) return false;

      // Check level requirement
      if (item.requiredLevel && playerLevel < item.requiredLevel) {
        return false;
      }

      return true;
    },
    [slotType, disabled, playerLevel],
  );

  // Monitor drag events
  useDndMonitor({
    onDragStart: useCallback(
      (event: DragStartEvent) => {
        // Check if dragged item could be equipped here
        const dragData = event.active.data as {
          item?: EquipmentItemData;
          type?: string;
        };

        if (dragData?.item && dragData.type === "equipment") {
          const item = dragData.item as EquipmentItemData;
          if (canAcceptItem(item)) {
            setIsValidDropTarget(true);
          }
        }
      },
      [canAcceptItem],
    ),
    onDragEnd: useCallback(() => {
      setIsValidDropTarget(false);
      setIsDragOver(false);
    }, []),
    onDragOver: useCallback(
      (event: DragOverEvent) => {
        if (event.over?.id === `equip-${slotType}`) {
          setIsDragOver(true);
        }
      },
      [slotType],
    ),
    onDragCancel: useCallback(() => {
      setIsValidDropTarget(false);
      setIsDragOver(false);
    }, []),
  });

  // Handle drop
  const handleDrop = useCallback(
    (item: EquipmentItemData): boolean => {
      if (!canAcceptItem(item)) return false;

      onEquip?.(item);
      setIsDragOver(false);
      setIsValidDropTarget(false);
      return true;
    },
    [canAcceptItem, onEquip],
  );

  // Handle right-click to unequip
  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      if (disabled || !equippedItem) return;
      onUnequip?.();
    },
    [disabled, equippedItem, onUnequip],
  );

  // Handle click
  const handleClick = useCallback(() => {
    if (disabled) return;
    onClick?.();
  }, [disabled, onClick]);

  // Calculate comparison when hovering
  const comparison = useMemo(() => {
    if (!comparingItem) return null;
    return compareItemStats(equippedItem, comparingItem);
  }, [equippedItem, comparingItem]);

  // Get durability status
  const durability = useMemo(() => {
    if (!equippedItem) return null;
    return getDurabilityStatus(equippedItem);
  }, [equippedItem]);

  // Get rarity color
  const rarityColor = useMemo(() => {
    if (!equippedItem) return null;
    return RARITY_COLORS[equippedItem.rarity];
  }, [equippedItem]);

  return {
    displayName,
    item: equippedItem,
    isEmpty: !equippedItem,
    isDisabled: disabled,
    isValidDropTarget,
    isDragOver,
    comparingItem,
    comparison,
    durability,
    rarityColor,
    handleDrop,
    handleContextMenu,
    handleClick,
    setComparingItem,
    canAcceptItem,
    slotConfig,
  };
}

/** Slot highlighting state for visual feedback */
export interface SlotHighlightState {
  /** Whether to show valid drop highlight */
  showValidHighlight: boolean;
  /** Whether to show invalid drop indicator */
  showInvalidHighlight: boolean;
  /** Whether slot is currently being hovered */
  isHovered: boolean;
  /** Whether slot is selected */
  isSelected: boolean;
}

/**
 * Calculate slot visual state based on current interactions
 */
export function getSlotHighlightState(
  isValidDropTarget: boolean,
  isDragOver: boolean,
  isSelected: boolean = false,
  isHovered: boolean = false,
): SlotHighlightState {
  return {
    showValidHighlight: isValidDropTarget && isDragOver,
    showInvalidHighlight: !isValidDropTarget && isDragOver,
    isHovered,
    isSelected,
  };
}

/**
 * Get slot border color based on state
 */
export function getSlotBorderColor(
  state: SlotHighlightState,
  rarityColor: string | null,
  theme: { colors: { accent: { primary: string }; state: { danger: string } } },
): string {
  if (state.showValidHighlight) {
    return theme.colors.accent.primary;
  }
  if (state.showInvalidHighlight) {
    return theme.colors.state.danger;
  }
  if (rarityColor) {
    return rarityColor;
  }
  return "transparent";
}
