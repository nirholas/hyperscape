/**
 * Equipment Panel Component
 *
 * Complete paper doll equipment interface with character silhouette,
 * equipment slots, stats summary, and set bonuses.
 *
 * @packageDocumentation
 */

import React, {
  memo,
  useCallback,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useTheme } from "../stores/themeStore";
import { DndProvider } from "../core/drag";
import type {
  EquipmentSlotType,
  EquipmentItemData,
  EquipmentState,
  EquipmentSet,
} from "../core/equipment";
import {
  EQUIPMENT_SLOTS,
  EQUIPMENT_SLOT_CONFIGS,
  calculateTotalStats,
  calculateSetBonuses,
  calculateAverageItemLevel,
} from "../core/equipment";
import { EquipmentSlot } from "./EquipmentSlot";
import { CharacterModel } from "./CharacterModel";
import { StatsSummary } from "./StatsSummary";
import { ItemComparison } from "./ItemComparison";

/** Equipment panel props */
export interface EquipmentPanelProps {
  /** Current equipment state */
  equipment: EquipmentState;
  /** Player level for requirement validation */
  playerLevel?: number;
  /** Equipment sets for bonus calculation */
  sets?: EquipmentSet[];
  /** Character name to display */
  characterName?: string;
  /** Character level to display */
  characterLevel?: number;
  /** Character silhouette URL */
  silhouetteUrl?: string;
  /** Callback when item is equipped */
  onEquip?: (item: EquipmentItemData, slot: EquipmentSlotType) => void;
  /** Callback when item is unequipped */
  onUnequip?: (item: EquipmentItemData, slot: EquipmentSlotType) => void;
  /** Callback when slot is clicked */
  onSlotClick?: (
    slot: EquipmentSlotType,
    item: EquipmentItemData | null,
  ) => void;
  /** Callback when hovering over a slot (for external tooltip) */
  onSlotHover?: (
    slot: EquipmentSlotType | null,
    item: EquipmentItemData | null,
  ) => void;
  /** Item being compared (from hover/external source) */
  comparisonItem?: EquipmentItemData | null;
  /** Slot to show comparison for */
  comparisonSlot?: EquipmentSlotType | null;
  /** Whether to show stats panel */
  showStats?: boolean;
  /** Whether to show set bonuses */
  showSetBonuses?: boolean;
  /** Whether to show gear score */
  showGearScore?: boolean;
  /** Whether character model is rotatable */
  rotatable?: boolean;
  /** Layout orientation */
  layout?: "horizontal" | "vertical";
  /** Panel width */
  width?: number;
  /** Slot size */
  slotSize?: number;
  /** Custom slot empty icons */
  slotEmptyIcons?: Partial<Record<EquipmentSlotType, ReactNode>>;
  /** Custom class name */
  className?: string;
  /** Custom style */
  style?: CSSProperties;
  /** Children (rendered inside panel) */
  children?: ReactNode;
}

/**
 * Equipment Panel Component
 *
 * @example
 * ```tsx
 * function CharacterScreen() {
 *   const { equipment, equipItem, unequipItem } = useEquipment({
 *     playerLevel: 50,
 *     sets: EQUIPMENT_SETS,
 *   });
 *
 *   return (
 *     <EquipmentPanel
 *       equipment={equipment}
 *       characterName="Hero"
 *       characterLevel={50}
 *       onEquip={(item, slot) => equipItem(item, slot)}
 *       onUnequip={(item, slot) => unequipItem(slot)}
 *       showStats
 *       showSetBonuses
 *       showGearScore
 *     />
 *   );
 * }
 * ```
 */
export const EquipmentPanel = memo(function EquipmentPanel({
  equipment,
  playerLevel = 1,
  sets = [],
  characterName,
  characterLevel,
  silhouetteUrl,
  onEquip,
  onUnequip,
  onSlotClick,
  onSlotHover,
  comparisonItem,
  comparisonSlot,
  showStats = true,
  showSetBonuses = true,
  showGearScore = true,
  rotatable = false,
  layout = "horizontal",
  width,
  slotSize = 44,
  slotEmptyIcons,
  className,
  style,
  children,
}: EquipmentPanelProps): React.ReactElement {
  const theme = useTheme();
  const [hoveredSlot, setHoveredSlot] = useState<EquipmentSlotType | null>(
    null,
  );

  // Calculate derived values
  const totalStats = calculateTotalStats(equipment);
  const setBonuses = calculateSetBonuses(equipment, sets);
  const averageItemLevel = calculateAverageItemLevel(equipment);

  // Calculate gear score
  const gearScore = showGearScore
    ? Object.values(totalStats).reduce((sum, val) => sum + val, 0) +
      averageItemLevel * 10
    : undefined;

  // Handlers
  const handleDrop = useCallback(
    (slot: EquipmentSlotType, item: EquipmentItemData) => {
      onEquip?.(item, slot);
    },
    [onEquip],
  );

  const handleContextMenu = useCallback(
    (slot: EquipmentSlotType, item: EquipmentItemData | null) => {
      if (item) {
        onUnequip?.(item, slot);
      }
    },
    [onUnequip],
  );

  const handleClick = useCallback(
    (slot: EquipmentSlotType, item: EquipmentItemData | null) => {
      onSlotClick?.(slot, item);
    },
    [onSlotClick],
  );

  const handleHover = useCallback(
    (slot: EquipmentSlotType, item: EquipmentItemData | null) => {
      setHoveredSlot(item ? slot : null);
      onSlotHover?.(item ? slot : null, item);
    },
    [onSlotHover],
  );

  // Determine comparison slot
  const activeComparisonSlot = comparisonSlot || hoveredSlot;
  const showComparison = comparisonItem && activeComparisonSlot;

  // Panel dimensions
  const panelWidth = width || (layout === "horizontal" ? 600 : 320);
  const characterModelWidth =
    layout === "horizontal" ? 200 : panelWidth - theme.spacing.md * 2;
  const characterModelHeight = 280;

  // Container styles
  const containerStyle: CSSProperties = {
    display: "flex",
    flexDirection: layout === "horizontal" ? "row" : "column",
    gap: theme.spacing.md,
    padding: theme.spacing.md,
    backgroundColor: theme.colors.background.primary,
    borderRadius: theme.borderRadius.lg,
    border: `1px solid ${theme.colors.border.default}`,
    width: panelWidth,
    ...style,
  };

  // Character section styles
  const characterSectionStyle: CSSProperties = {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: theme.spacing.sm,
  };

  // Slots layout - positioned around character model
  const slotsContainerStyle: CSSProperties = {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    pointerEvents: "none",
  };

  const slotStyle = (row: number, col: number): CSSProperties => {
    // Calculate slot positions relative to character model with gap between slots
    const slotGap = theme.spacing.xs; // Gap between slots for visual separation
    const totalCols = 4;
    const totalRows = 4;

    // Account for gaps in the available space calculation
    const availableWidth =
      characterModelWidth - slotSize - slotGap * (totalCols - 1);
    const availableHeight =
      characterModelHeight - slotSize - slotGap * (totalRows - 1);

    const colWidth = availableWidth / (totalCols - 1) + slotGap;
    const rowHeight = availableHeight / (totalRows - 1) + slotGap;

    return {
      position: "absolute",
      left: col * colWidth,
      top: row * rowHeight,
      pointerEvents: "auto",
    };
  };

  // Side panel styles
  const sidePanelStyle: CSSProperties = {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: theme.spacing.md,
    minWidth: layout === "horizontal" ? 200 : undefined,
  };

  // Filter slots to show (exclude twoHand if using mainHand/offHand)
  const visibleSlots = EQUIPMENT_SLOTS.filter((slot) => {
    if (slot === "twoHand" && (equipment.mainHand || equipment.offHand)) {
      return false;
    }
    if ((slot === "mainHand" || slot === "offHand") && equipment.twoHand) {
      return slot !== "offHand"; // Show mainHand slot even with 2h for the 2h item
    }
    return true;
  });

  // Render equipment slot
  const renderSlot = (slotType: EquipmentSlotType) => {
    const config = EQUIPMENT_SLOT_CONFIGS[slotType];
    const item =
      slotType === "mainHand" && equipment.twoHand
        ? equipment.twoHand
        : equipment[slotType];

    return (
      <div
        key={slotType}
        style={slotStyle(config.position.row, config.position.col)}
      >
        <EquipmentSlot
          slotType={slotType}
          item={item}
          size={slotSize}
          playerLevel={playerLevel}
          onDrop={handleDrop}
          onContextMenu={handleContextMenu}
          onClick={handleClick}
          onHover={handleHover}
          emptyIcon={slotEmptyIcons?.[slotType]}
          showDurability
          showItemLevel
        />
      </div>
    );
  };

  return (
    <DndProvider>
      <div className={className} style={containerStyle}>
        {/* Character section with equipment slots */}
        <div style={characterSectionStyle}>
          <CharacterModel
            width={characterModelWidth}
            height={characterModelHeight}
            characterName={characterName}
            characterLevel={characterLevel}
            silhouetteUrl={silhouetteUrl}
            rotatable={rotatable}
          >
            {/* Equipment slots positioned over character */}
            <div style={slotsContainerStyle}>
              {visibleSlots.map(renderSlot)}
            </div>
          </CharacterModel>
        </div>

        {/* Side panel with stats and comparison */}
        {(showStats || showComparison) && (
          <div style={sidePanelStyle}>
            {/* Item comparison (when hovering with item) */}
            {showComparison && activeComparisonSlot && (
              <ItemComparison
                equippedItem={equipment[activeComparisonSlot]}
                comparisonItem={comparisonItem}
                showPower
                detailed
              />
            )}

            {/* Stats summary */}
            {showStats && !showComparison && (
              <StatsSummary
                stats={totalStats}
                averageItemLevel={averageItemLevel}
                gearScore={gearScore}
                setBonuses={showSetBonuses ? setBonuses : undefined}
                showSetBonuses={showSetBonuses}
              />
            )}
          </div>
        )}

        {/* Custom children */}
        {children}
      </div>
    </DndProvider>
  );
});

/**
 * Compact Equipment Bar
 *
 * Horizontal strip of equipment slots for minimal UI.
 */
export interface EquipmentBarProps {
  /** Current equipment state */
  equipment: EquipmentState;
  /** Which slots to show */
  slots?: EquipmentSlotType[];
  /** Slot size */
  slotSize?: number;
  /** Callback when slot is clicked */
  onSlotClick?: (
    slot: EquipmentSlotType,
    item: EquipmentItemData | null,
  ) => void;
  /** Custom class name */
  className?: string;
  /** Custom style */
  style?: CSSProperties;
}

export const EquipmentBar = memo(function EquipmentBar({
  equipment,
  slots = ["mainHand", "offHand", "head", "chest", "legs"],
  slotSize = 36,
  onSlotClick,
  className,
  style,
}: EquipmentBarProps): React.ReactElement {
  const theme = useTheme();

  const containerStyle: CSSProperties = {
    display: "flex",
    gap: theme.spacing.xs,
    padding: theme.spacing.xs,
    backgroundColor: theme.colors.background.secondary,
    borderRadius: theme.borderRadius.md,
    border: `1px solid ${theme.colors.border.default}`,
    ...style,
  };

  return (
    <div className={className} style={containerStyle}>
      {slots.map((slotType) => (
        <EquipmentSlot
          key={slotType}
          slotType={slotType}
          item={equipment[slotType]}
          size={slotSize}
          onClick={onSlotClick}
          showDurability={false}
          showItemLevel={false}
        />
      ))}
    </div>
  );
});

export default EquipmentPanel;
