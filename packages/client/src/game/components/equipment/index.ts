/**
 * Equipment Components
 *
 * Complete equipment UI components including paper doll display,
 * equipment slots, stats summary, and item comparison.
 *
 * @packageDocumentation
 */

export { EquipmentPanel, EquipmentBar } from "./EquipmentPanel";
export type { EquipmentPanelProps, EquipmentBarProps } from "./EquipmentPanel";

export { EquipmentSlot } from "./EquipmentSlot";
export type { EquipmentSlotProps } from "./EquipmentSlot";

export { CharacterModel } from "./CharacterModel";
export type { CharacterModelProps } from "./CharacterModel";

export { StatsSummary } from "./StatsSummary";
export type { StatsSummaryProps } from "./StatsSummary";

export { ItemComparison, StatDiffIndicator } from "./ItemComparison";
export type {
  ItemComparisonProps,
  StatDiffIndicatorProps,
} from "./ItemComparison";
