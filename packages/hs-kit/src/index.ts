/**
 * hs-kit - Hyperscape Interface Toolkit
 *
 * A standalone, reusable package for building customizable game UIs
 * with draggable windows, tabs, presets, and edit mode.
 *
 * @packageDocumentation
 */

// Core types and branded type utilities
export * from "./types";
export type { WindowId, TabId, PresetId, Brand } from "./types";
export { createWindowId, createTabId, createPresetId } from "./types";

// Stores
export * from "./stores";

// Theme - Token bridge and utilities
export {
  createThemeFromTokens,
  bridgedThemes,
  parseTokenToNumber,
  baseColors,
  hyperscapeColors,
  breakpointValues,
  touchTargetValues,
  getMinTouchTarget,
  animationDurations,
  animationEasings,
} from "./theme";

// Core hooks - Drag system
export { useDrag } from "./core/drag/useDrag";
export { useDrop } from "./core/drag/useDrop";
export { useKeyboardDrag } from "./core/drag/useKeyboardDrag";
export { DragContext, DragProvider } from "./core/drag/DragContext";

// @dnd-kit compatible hooks (drop-in replacement)
export { useDraggable } from "./core/drag/useDraggable";
export { useDroppable } from "./core/drag/useDroppable";
export {
  DndProvider,
  useDndContext,
  useDndMonitor,
  type DragStartEvent,
  type DragMoveEvent,
  type DragOverEvent,
  type DragEndEvent,
  type DragCancelEvent,
} from "./core/drag/EnhancedDragContext";
export {
  ComposableDragOverlay,
  snapCenterToCursor,
} from "./core/drag/ComposableDragOverlay";

// Drag - Sensors
export {
  DEFAULT_POINTER_ACTIVATION,
  DEFAULT_KEYBOARD_OPTIONS,
  checkActivationConstraint,
} from "./core/drag/sensors";

// Drag - Collision Detection
export {
  closestCenter,
  closestCorners,
  rectIntersection,
  pointerWithin,
} from "./core/drag/collisionDetection";

// Drag - Modifiers
export {
  restrictToWindow,
  restrictToHorizontalAxis,
  restrictToVerticalAxis,
  createSnapToGridModifier,
  composeModifiers,
  createModifierContext,
  // Window-specific modifiers (dnd-kit style)
  getViewportSize,
  restrictToWindowEdges,
  restrictToWindowEdgesFully,
  snapToGridModifier,
  composeWindowModifiers,
  type WindowPositionModifier,
  type WindowPositionModifierArgs,
} from "./core/drag/modifiers";

// Drag - Auto-scroll
export { useAutoScroll } from "./core/drag/autoScroll";

// Drag - Accessibility
export {
  announce,
  getDraggableAriaAttributes,
  getDroppableAriaAttributes,
  useAccessibilityAnnouncements,
  SCREEN_READER_INSTRUCTIONS,
} from "./core/drag/accessibility";

// Core hooks - Sortable system (@dnd-kit compatible)
export {
  useSortable,
  type UseSortableConfig,
  type UseSortableReturn,
} from "./core/sortable/useSortable";
export {
  SortableContext,
  useSortableContextValue,
  useMaybeSortableContext,
  type SortableContextProps,
  type SortableContextValue,
} from "./core/sortable/SortableContext";
export {
  verticalListSorting,
  horizontalListSorting,
  rectSorting,
  calculateSortableTransform,
  SORTABLE_TRANSITION,
  type SortableItemInfo,
  type SortingResult,
  type SortingStrategy,
} from "./core/sortable/sortingStrategies";
export { arrayMove, arraySwap } from "./core/sortable";

// Core hooks - Window system
export { useWindow } from "./core/window/useWindow";
export { useWindowManager } from "./core/window/useWindowManager";
export { useResize } from "./core/window/useResize";
export { useSnap } from "./core/window/useSnap";
export {
  useAutoCollapse,
  useRibbonAutoCollapse,
} from "./core/window/useAutoCollapse";

// Core hooks - Tab system
export { useTabs } from "./core/tabs/useTabs";
export { useTabDrag } from "./core/tabs/useTabDrag";
export { useTabContextMenu } from "./core/tabs/useTabContextMenu";
export { useTabOverflow } from "./core/tabs/useTabOverflow";

// Core hooks - Edit mode
export { useEditMode } from "./core/edit/useEditMode";
export { useGrid } from "./core/edit/useGrid";
export { useAlignmentGuides } from "./core/edit/useAlignmentGuides";
export {
  useAdvancedEditOptions,
  CONTEXTUAL_PANELS,
} from "./core/edit/useAdvancedEditOptions";
export {
  useCollisionVisualization,
  checkCollision,
  type OutlineColor,
  type CollisionVisualizationResult,
  type CollisionVisualizationOptions,
} from "./core/edit/useCollisionVisualization";

// Core hooks - Presets
export { usePresets } from "./core/presets/usePresets";
export { usePresetHotkeys } from "./core/presets/usePresetHotkeys";
export { useLayoutValidation } from "./core/presets/useLayoutValidation";
export { useLayoutSharing } from "./core/presets/useLayoutSharing";
export { useCloudSync } from "./core/presets/useCloudSync";

// Core hooks - Notifications
export {
  useBadge,
  useBadges,
  useBadgeStore,
  BADGE_COLORS,
} from "./core/notifications/useBadges";

// Core utilities - Tooltip positioning
export {
  calculateTooltipPosition,
  calculateCursorTooltipPosition,
  TOOLTIP_SIZE_ESTIMATES,
  type TooltipPlacement,
  type TooltipPositionOptions,
  type TooltipPositionResult,
} from "./core/tooltip/useTooltipPosition";

// Core utilities - Progressive tooltips
export {
  useProgressiveTooltip,
  type TooltipTier,
  type ProgressiveTooltipState,
  type ProgressiveTooltipActions,
  type ProgressiveTooltipResult,
  type ProgressiveTooltipOptions,
} from "./core/tooltip/useProgressiveTooltip";

// Core hooks - Responsive
export {
  useBreakpoint,
  useDeviceType,
  useTouchTarget,
  useResponsiveValue,
  useMediaQuery,
  usePrefersReducedMotion,
  useIsTouchDevice,
  type BreakpointName,
  type DeviceType,
  type ResponsiveValues,
  // Orientation detection
  useOrientation,
  useIsPortrait,
  useIsLandscape,
  type Orientation,
  // Mobile layout utilities
  useMobileLayout,
  useShouldUseMobileUI,
  type SafeAreaInsets,
  type MobileLayoutResult,
} from "./core/responsive";

// Core hooks - Complexity
export {
  useProgressionTracker,
  type ProgressionTrackerOptions,
  type ProgressionTrackerResult,
} from "./core/complexity";

// Core hooks - Virtual scrolling
export {
  useVirtualList,
  useVirtualGrid,
  type UseVirtualListOptions,
  type UseVirtualListResult,
  type VirtualItem,
  type VirtualRange,
  type ItemMeasurement,
  type ScrollToOptions,
  type UseVirtualGridOptions,
  type UseVirtualGridResult,
  type VirtualCell,
  type VirtualGridRange,
  type GridScrollToOptions,
} from "./core/virtual";

// Core hooks - Chat system
export {
  useChatState,
  useChatInput,
  useChatFilters,
  type ChatMessage,
  type ChatMessageType,
  type UserRole,
  type UseChatStateOptions,
  type UseChatStateResult,
  type SlashCommand,
  type CommandContext,
  type CommandResult,
  type UseChatInputOptions,
  type UseChatInputResult,
  type ChannelConfig,
  type UseChatFiltersOptions,
  type UseChatFiltersResult,
  CHANNEL_PRESETS,
} from "./core/chat";

// Core hooks - Currency system
export {
  // Types
  type CurrencyType,
  type CurrencyDefinition,
  type FormatOptions,
  type FormattedCurrency,
  type ChangeIndicator,
  type CurrencyTransaction,
  type CurrencyBalance,
  type UseCurrencyOptions,
  type UseCurrencyResult,
  type UseCurrenciesResult,
  // Constants
  DEFAULT_CURRENCIES,
  // Utilities
  formatCurrency,
  compactNumber,
  addThousandsSeparator,
  parseCurrency,
  convertCurrency,
  validateAmount,
  calculateBreakdown,
  toTotalCopper,
  formatBreakdown,
  getChangeIndicator,
  getChangeColor,
  formatChange,
  // Hooks
  useCurrencyStore,
  useCurrency,
  useCurrencies,
} from "./core/currency";

// Core hooks - Settings system
export {
  // Main hooks
  useSettings,
  type UseSettingsResult,
  type UseSettingsOptions,
  type SettingsProfile,
  type SettingsPersistence,
  // Category hooks
  useSettingsCategory,
  useSettingCategories,
  useActiveCategoryTab,
  type UseSettingsCategoryResult,
  type UseSettingsCategoryOptions,
  // Schema types
  type SettingControlType,
  type SettingDefinitionBase,
  type SliderSettingDefinition,
  type ToggleSettingDefinition,
  type SelectSettingDefinition,
  type KeybindSettingDefinition,
  type ColorSettingDefinition,
  type NumberSettingDefinition,
  type SettingDefinition,
  type SettingCategory,
  type CategoryDefinition,
  // Schema constants
  SETTING_CATEGORIES,
  GRAPHICS_SETTINGS,
  AUDIO_SETTINGS,
  CONTROLS_SETTINGS,
  INTERFACE_SETTINGS,
  GAMEPLAY_SETTINGS,
  ACCESSIBILITY_SETTINGS,
  ALL_SETTINGS,
  // Schema utilities
  getSettingsByCategory,
  getSettingById,
  getDefaultValues,
  getCategoryDefaults,
  searchSettings,
  validateSettingValue,
} from "./core/settings";

// Core hooks - Equipment system
export {
  // Main hooks
  useEquipment,
  useEquipmentSlot,
  type UseEquipmentConfig,
  type UseEquipmentResult,
  type UseEquipmentSlotConfig,
  type UseEquipmentSlotResult,
  // Slot utilities
  getSlotHighlightState,
  getSlotBorderColor,
  type SlotHighlightState,
  // Types
  type EquipmentSlotType,
  type EquipmentSlotConfig,
  type ItemRarity,
  type StatType,
  type ItemStats,
  type EquipmentItemData,
  type EquipmentSet,
  type EquipmentState,
  // Constants
  EQUIPMENT_SLOT_CONFIGS,
  EQUIPMENT_SLOTS,
  RARITY_COLORS,
  RARITY_NAMES,
  RARITY_ORDER,
  // Validation
  canEquipInSlot,
  getConflictingSlots,
  findValidSlots,
  meetsRequirements,
  // Stat calculation
  calculateTotalStats,
  calculateSetBonuses,
  compareItemStats,
  calculateItemPower,
  calculateAverageItemLevel,
  // Durability
  getDurabilityStatus,
  getItemsNeedingRepair,
  // Utilities
  createEmptyEquipment,
  formatStatName,
  formatStatValue,
  getSlotDisplayName,
} from "./core/equipment";

// Core hooks - Quest system
export {
  // Main hooks
  useQuestLog,
  useQuestTracker,
  type UseQuestLogOptions,
  type UseQuestLogResult,
  type UseQuestTrackerOptions,
  type UseQuestTrackerResult,
  type TrackedQuest,
  // Types
  type Quest,
  type QuestState,
  type QuestCategory,
  type QuestObjective,
  type QuestReward,
  type ObjectiveType,
  type RewardType,
  type QuestSortOption,
  type SortDirection,
  type QuestFilterOptions,
  type CategoryConfig,
  type StateConfig,
  type ObjectiveTypeConfig,
  // Utilities
  calculateQuestProgress,
  isObjectiveComplete,
  areAllObjectivesComplete,
  sortQuests,
  filterQuests,
  groupQuestsByCategory,
  groupQuestsByState,
  getQuestChain,
  formatTimeRemaining,
  getNextChainQuest,
  arePrerequisitesMet,
  getRewardSummary,
  // Constants
  CATEGORY_CONFIG,
  STATE_CONFIG,
  OBJECTIVE_TYPE_CONFIG,
} from "./core/quest";

// Core hooks - Map system
export {
  // Main hooks
  useWorldMap,
  useMapMarkers,
  useMapNavigation,
  // Types
  type WorldMapOptions,
  type WorldMapResult,
  type MapMarkersOptions,
  type MapMarkersResult,
  type MapNavigationOptions,
  type MapNavigationResult,
  type WorldCoordinate,
  type MapCoordinate,
  type MapViewport,
  type WorldBounds,
  type MapRegion,
  type MarkerType,
  type MarkerLayer,
  type MapMarker,
  type LayerConfig,
  type NavigationHistoryEntry,
  type MapBookmark,
  // Utilities
  worldToMap,
  mapToWorld,
  screenToMap,
  calculateDistance,
  calculateManhattanDistance,
  calculateBearing,
  formatDistance,
  formatCoordinates,
  isWithinBounds,
  clampToBounds,
  getVisibleBounds,
  isVisibleInViewport,
  findRegionAt,
  clampZoom,
  calculateZoomToFit,
  getBoundsCenter,
  // Constants
  DEFAULT_PIXELS_PER_UNIT,
  MIN_ZOOM,
  MAX_ZOOM,
  DEFAULT_WORLD_BOUNDS,
  DEFAULT_LAYERS,
  DEFAULT_MARKER_ICONS,
  DEFAULT_MARKER_COLORS,
} from "./core/map";

// Core hooks - Skill tree system
export {
  // Main hooks
  useSkillTree,
  useSkillNode,
  // Types
  type SkillNodeId,
  type SkillNodeState,
  type SkillCost,
  type SkillNodeDef,
  type SkillNodeProgress,
  type SkillConnection,
  type SkillTreeDef,
  type SkillTreeLayout,
  type NodePath,
  type SkillFilterOptions,
  type UseSkillTreeOptions,
  type UseSkillTreeResult,
  type UseSkillNodeOptions,
  type UseSkillNodeResult,
  // Utilities
  areDependenciesMet,
  computeNodeState,
  getDependentNodes,
  canRefundNode,
  findPathToNode,
  getConnections,
  filterNodes,
  polarToCartesian,
  calculateRadialLayout,
  calculateConnectionPath,
  getTreeBounds,
  calculateTotalCost,
  canAfford,
  getRefundAmount,
} from "./core/skilltree";

// Core hooks - Dialog system
export {
  // Main hooks
  useDialog,
  useDialogHistory,
  type DialogState,
  type UseDialogOptions,
  type UseDialogResult,
  type DialogHistoryEntry,
  type DialogHistoryEntryType,
  type UseDialogHistoryOptions,
  type UseDialogHistoryResult,
  // Parser types
  type DialogMood,
  type DialogNodeType,
  type DialogActionType,
  type DialogCondition,
  type DialogAction,
  type DialogChoice,
  type DialogNode,
  type DialogNodeBase,
  type DialogTextNode,
  type DialogChoiceNode,
  type DialogBranchNode,
  type DialogActionNode,
  type DialogEndNode,
  type DialogTree,
  type DialogContext,
  type ParsedDialog,
  type DialogTreeRaw,
  type DialogNodeRaw,
  // Parser functions
  parseDialogTree,
  evaluateCondition,
  evaluateConditions,
  interpolateText,
  getNextNode,
  getAvailableChoices,
  createSimpleDialog,
} from "./core/dialog";

// Styled components - exported here to share store instances
export * from "./styled";

// Icons - Pre-configured Lucide icons for game UI
export {
  GameIcons,
  getGameIcon,
  type GameIconName,
  type LucideIcon,
  // Re-export commonly used icons directly
  Package,
  Gem,
  Activity,
  Wand2,
  Sparkles,
  Swords,
  MessageCircle,
  CircleUserRound,
  SlidersHorizontal,
  Radar,
  Globe2,
  Users2,
  ScrollText,
  Zap,
  Landmark,
  LayoutGrid,
  Lock,
  Unlock,
  X,
  Check,
  Plus,
  Minus,
} from "./icons";
