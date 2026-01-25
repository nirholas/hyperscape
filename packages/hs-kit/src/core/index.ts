/**
 * Core headless primitives for hs-kit
 * @packageDocumentation
 */

// Drag system
export * from "./drag";

// Sortable system
export * from "./sortable";

// Window system
export * from "./window";

// Tab system
export * from "./tabs";

// Edit mode
export * from "./edit";

// Presets
export * from "./presets";

// Notifications
export * from "./notifications";

// Virtual scrolling
export * from "./virtual";

// Chat system
export * from "./chat";

// Currency system
export * from "./currency";

// Settings system
export * from "./settings";

// Equipment system
export * from "./equipment";

// Quest system
export * from "./quest";

// Map system
export * from "./map";

// Skill tree system
export * from "./skilltree";

// Dialog system
export * from "./dialog";

// Responsive utilities
export * from "./responsive";

// Complexity/progression
export * from "./complexity";

// Tooltip utilities (positioning and progressive disclosure)
export {
  useProgressiveTooltip,
  type TooltipTier,
  type ProgressiveTooltipState,
  type ProgressiveTooltipActions,
  type ProgressiveTooltipResult,
  type ProgressiveTooltipOptions,
} from "./tooltip/useProgressiveTooltip";

export {
  calculateTooltipPosition,
  calculateCursorTooltipPosition,
  TOOLTIP_SIZE_ESTIMATES,
  type TooltipPlacement,
  type TooltipPositionOptions,
  type TooltipPositionResult,
} from "./tooltip/useTooltipPosition";

// React 19 utilities
export * from "./react19";
