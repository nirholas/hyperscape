/**
 * Tooltip Utilities
 *
 * Hooks for tooltip positioning and progressive disclosure.
 *
 * @packageDocumentation
 */

export {
  useProgressiveTooltip,
  type TooltipTier,
  type ProgressiveTooltipState,
  type ProgressiveTooltipActions,
  type ProgressiveTooltipResult,
  type ProgressiveTooltipOptions,
} from "./useProgressiveTooltip";

export {
  calculateTooltipPosition,
  calculateCursorTooltipPosition,
  TOOLTIP_SIZE_ESTIMATES,
  type TooltipPlacement,
  type TooltipPositionOptions,
  type TooltipPositionResult,
} from "./useTooltipPosition";
