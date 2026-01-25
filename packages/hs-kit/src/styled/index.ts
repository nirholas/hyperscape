/**
 * hs-kit Styled Components
 *
 * Pre-built, styled components with Hyperscape aesthetic.
 * These are optional - you can use the headless core hooks
 * with your own styling solution.
 *
 * @packageDocumentation
 */

// Window system
export { Window } from "./Window";
export {
  WindowErrorBoundary,
  type WindowErrorBoundaryProps,
} from "./WindowErrorBoundary";
export { TabBar } from "./TabBar";
export { Tab } from "./Tab";
export { TabContextMenu } from "./TabContextMenu";
export { DragOverlay } from "./DragOverlay";
export { EditModeOverlay } from "./EditModeOverlay";
export { AlignmentGuides } from "./AlignmentGuides";
export { TransparencySlider } from "./TransparencySlider";
export { PresetPanel } from "./PresetPanel";

// Interface Manager
export {
  InterfaceManager,
  InterfaceProvider,
  type InterfaceManagerProps,
} from "./InterfaceManager";

// Modal Window
export { ModalWindow, type ModalWindowProps } from "./ModalWindow";

// Achievement Popup
export {
  AchievementPopup,
  type AchievementPopupProps,
  type AchievementVariant,
  type CelebrationEffectType,
} from "./AchievementPopup";

// Fireworks Effect
export { FireworksEffect, type FireworksEffectProps } from "./FireworksEffect";

// Accessibility Panel
export {
  AccessibilityPanel,
  type AccessibilityPanelProps,
} from "./AccessibilityPanel";

// Complexity Panel
export { ComplexityPanel, type ComplexityPanelProps } from "./ComplexityPanel";

// Upgrade Prompt
export { UpgradePrompt, type UpgradePromptProps } from "./UpgradePrompt";

// Locked Feature
export { LockedFeature, type LockedFeatureProps } from "./LockedFeature";

// Combat HUD components
export { BuffBar, type BuffBarProps, type Buff } from "./BuffBar";

export {
  BossTimer,
  type BossTimerProps,
  type BossAttack,
  type BossPhase,
} from "./BossTimer";

// Edit Mode Toolbar
export { EditModeToolbar, type EditModeToolbarProps } from "./EditModeToolbar";

// Tiered Tooltips
export {
  TieredTooltip,
  type TieredTooltipProps,
  type TooltipItemData,
} from "./TieredTooltip";

// Mobile Components
export { TouchActionBar, type TouchActionBarProps } from "./TouchActionBar";

export {
  PopoutPanel,
  type PopoutPanelProps,
  type PopoutMode,
  type PopoutPosition,
} from "./PopoutPanel";

export {
  MobileDrawer,
  useDrawerState,
  type MobileDrawerProps,
  type DrawerState,
  type DrawerHeightConfig,
} from "./MobileDrawer";

// Item Slot and Grid
export {
  ItemSlot,
  ItemGrid,
  type ItemSlotProps,
  type ItemGridProps,
  type ItemData,
} from "./ItemSlot";

// Virtual Scrolling
export {
  VirtualList,
  type VirtualListProps,
  type VirtualListRef,
  type VirtualListRenderItem,
} from "./VirtualList";

export {
  VirtualGrid,
  VirtualItemGrid,
  type VirtualGridProps,
  type VirtualGridRef,
  type VirtualGridRenderCell,
  type VirtualItemGridProps,
} from "./VirtualGrid";

// Status Bars
export {
  StatusBar,
  StatusOrb,
  StatusBarsGroup,
  type StatusBarProps,
  type StatusOrbProps,
  type StatusBarsGroupProps,
  type StatusType,
} from "./StatusBar";

// Action Bars
export {
  ActionBar,
  createActionBar,
  createPanelActions,
  useActionBarKeybindsForBar,
  DEFAULT_ACTION_BAR_KEYBINDS,
  type ActionBarProps,
  type ActionBarState,
  type ActionSlot,
  type Action,
  type ActionType,
  type PanelActionDef,
} from "./ActionBar";

// Minimap
export {
  Minimap,
  createMinimapState,
  type MinimapProps,
  type MinimapState,
  type MinimapIcon,
} from "./Minimap";

// Ribbon
export {
  Ribbon,
  createRibbonCategory,
  DEFAULT_CATEGORIES,
  type RibbonProps,
  type RibbonCategory,
} from "./Ribbon";

// Theme system - primary exports
export {
  themes,
  baseTheme,
  hyperscapeTheme,
  getThemedGlassmorphismStyle,
  getThemedWindowShadow,
  getSlotStyle,
  getStatusBarGradient,
  getDecorativeBorderStyle,
  type Theme,
  type ThemeName,
} from "./themes";

// Legacy theme exports for backwards compatibility
export { theme, getGlassmorphismStyle, getWindowShadow } from "./theme";

// Legacy aliases
export { baseTheme as darkTheme, baseTheme as lightTheme } from "./themes";

// Animation library
export {
  animations,
  animationDurations,
  animationEasings,
  getTransition,
  getKeyframesCSS,
  applyAnimation,
} from "./animations";

// Chat Components
export { ChatBox, type ChatBoxProps, type ChatBoxRef } from "./ChatBox";
export { ChatMessage, type ChatMessageProps } from "./ChatMessage";
export { ChatInput, type ChatInputProps } from "./ChatInput";
export { ChatTabs, type ChatTabsProps } from "./ChatTabs";

// Currency Components
export { CurrencyIcon, type CurrencyIconProps } from "./CurrencyIcon";
export { CurrencyTooltip, type CurrencyTooltipProps } from "./CurrencyTooltip";
export {
  CurrencyDisplay,
  CurrencyGroup,
  type CurrencyDisplayProps,
  type CurrencyDisplayMode,
  type CurrencyGroupProps,
} from "./CurrencyDisplay";
export {
  CurrencyInput,
  DEFAULT_QUICK_AMOUNTS,
  type CurrencyInputProps,
  type QuickAmountPreset,
} from "./CurrencyInput";
export {
  CurrencyExchange,
  type CurrencyExchangeProps,
  type ExchangeRate,
} from "./CurrencyExchange";

// Settings Components
export { SettingsPanel, type SettingsPanelProps } from "./SettingsPanel";
export {
  SettingsCategory,
  type SettingsCategoryProps,
} from "./SettingsCategory";
export { SettingsControl, type SettingsControlProps } from "./SettingsControl";

// Settings Controls
export {
  SliderControl,
  type SliderControlProps,
} from "./controls/SliderControl";
export {
  ToggleControl,
  type ToggleControlProps,
} from "./controls/ToggleControl";
export {
  SelectControl,
  type SelectControlProps,
} from "./controls/SelectControl";
export {
  KeybindControl,
  KeybindClearButton,
  type KeybindControlProps,
} from "./controls/KeybindControl";
export { ColorControl, type ColorControlProps } from "./controls/ColorControl";

// Equipment Components
export {
  EquipmentPanel,
  EquipmentBar,
  type EquipmentPanelProps,
  type EquipmentBarProps,
} from "./EquipmentPanel";
export { EquipmentSlot, type EquipmentSlotProps } from "./EquipmentSlot";
export { CharacterModel, type CharacterModelProps } from "./CharacterModel";
export { StatsSummary, type StatsSummaryProps } from "./StatsSummary";
export {
  ItemComparison,
  StatDiffIndicator,
  type ItemComparisonProps,
  type StatDiffIndicatorProps,
} from "./ItemComparison";

// Quest Components
export { QuestLog, type QuestLogProps } from "./QuestLog";
export { QuestEntry, type QuestEntryProps } from "./QuestEntry";
export { QuestObjective, type QuestObjectiveProps } from "./QuestObjective";
export { QuestTracker, type QuestTrackerProps } from "./QuestTracker";
export {
  QuestRewards,
  QuestRewardsSummary,
  type QuestRewardsProps,
  type QuestRewardsSummaryProps,
} from "./QuestRewards";

// World Map Components
export {
  WorldMap,
  type WorldMapProps,
  type FogOfWar,
  type FogState,
} from "./WorldMap";
export { MapMarker, PlayerMarker, type MapMarkerProps } from "./MapMarker";
export {
  MapTooltip,
  type MapTooltipProps,
  type MapTooltipPlacement,
} from "./MapTooltip";
export {
  MapLegend,
  DEFAULT_LEGEND_ITEMS,
  type MapLegendProps,
  type LegendItem,
} from "./MapLegend";
export { MapControls, type MapControlsProps } from "./MapControls";

// Skill Tree Components
export {
  SkillTree,
  SkillTreeZoomControls,
  type SkillTreeProps,
  type SkillTreeZoomControlsProps,
} from "./SkillTree";
export { SkillNode, type SkillNodeProps } from "./SkillNode";
export {
  SkillConnection,
  SkillConnectionGroup,
  type SkillConnectionProps,
  type SkillConnectionGroupProps,
} from "./SkillConnection";
export {
  SkillTooltip,
  SkillTooltipCompact,
  type SkillTooltipProps,
  type SkillTooltipCompactProps,
  type SkillEffect,
} from "./SkillTooltip";

// Dialog System Components
export { DialogBox, type DialogBoxProps } from "./DialogBox";
export {
  DialogPortrait,
  PortraitFrame,
  type DialogPortraitProps,
  type PortraitSource,
  type PortraitFrameProps,
} from "./DialogPortrait";
export {
  DialogText,
  StyledDialogText,
  useTypewriter,
  type DialogTextProps,
  type UseTypewriterResult,
  type StyledTextProps,
} from "./DialogText";
export {
  DialogChoices,
  ChoiceButton,
  QuickReply,
  type DialogChoicesProps,
  type ChoiceButtonProps,
  type QuickReplyProps,
} from "./DialogChoices";
export {
  DialogHistory,
  CompactHistory,
  type DialogHistoryProps,
  type CompactHistoryProps,
} from "./DialogHistory";
