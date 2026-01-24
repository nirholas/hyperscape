/**
 * Progressive Tooltip Hook
 *
 * Tracks hover duration and returns the current tooltip tier
 * for tiered tooltip content display.
 *
 * Tiers:
 * - immediate (0ms): Name, keybind
 * - delayed (1s): Stats, requirements
 * - examine (right-click or 3s): Full description
 *
 * @packageDocumentation
 */

import { useState, useCallback, useRef, useEffect } from "react";

/** Tooltip tier levels */
export type TooltipTier = "immediate" | "delayed" | "examine";

/** Progressive tooltip state */
export interface ProgressiveTooltipState {
  /** Current tooltip tier */
  tier: TooltipTier;
  /** Whether tooltip is visible */
  isVisible: boolean;
  /** Time in current hover (ms) */
  hoverDuration: number;
  /** Whether examine mode was triggered (right-click) */
  isExamineMode: boolean;
}

/** Progressive tooltip actions */
export interface ProgressiveTooltipActions {
  /** Start hover tracking */
  onMouseEnter: () => void;
  /** Stop hover tracking */
  onMouseLeave: () => void;
  /** Trigger examine mode (right-click) */
  onExamine: () => void;
  /** Reset to initial state */
  reset: () => void;
}

/** Progressive tooltip result */
export interface ProgressiveTooltipResult
  extends ProgressiveTooltipState,
    ProgressiveTooltipActions {}

/** Options for progressive tooltip */
export interface ProgressiveTooltipOptions {
  /** Delay before showing tooltip at all (ms) */
  showDelay?: number;
  /** Delay before delayed tier (ms) */
  delayedTierDelay?: number;
  /** Delay before examine tier via hover (ms) */
  examineTierDelay?: number;
  /** Whether examine tier requires right-click only */
  examineRequiresClick?: boolean;
}

/**
 * Hook for progressive tooltip tier management
 *
 * Tracks hover duration and returns the appropriate tooltip tier
 * based on how long the user has been hovering.
 *
 * @example
 * ```tsx
 * function ItemWithTooltip({ item }) {
 *   const tooltip = useProgressiveTooltip();
 *
 *   return (
 *     <div
 *       onMouseEnter={tooltip.onMouseEnter}
 *       onMouseLeave={tooltip.onMouseLeave}
 *       onContextMenu={(e) => {
 *         e.preventDefault();
 *         tooltip.onExamine();
 *       }}
 *     >
 *       <ItemIcon item={item} />
 *
 *       {tooltip.isVisible && (
 *         <TieredTooltip tier={tooltip.tier} item={item} />
 *       )}
 *     </div>
 *   );
 * }
 * ```
 */
export function useProgressiveTooltip(
  options: ProgressiveTooltipOptions = {},
): ProgressiveTooltipResult {
  const {
    showDelay = 200,
    delayedTierDelay = 1000,
    examineTierDelay = 3000,
    examineRequiresClick = false,
  } = options;

  const [state, setState] = useState<ProgressiveTooltipState>({
    tier: "immediate",
    isVisible: false,
    hoverDuration: 0,
    isExamineMode: false,
  });

  const hoverStartRef = useRef<number | null>(null);
  const showTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tierTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const examineTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef = useRef<number | null>(null);

  // Clear all timeouts
  const clearTimeouts = useCallback(() => {
    if (showTimeoutRef.current) {
      clearTimeout(showTimeoutRef.current);
      showTimeoutRef.current = null;
    }
    if (tierTimeoutRef.current) {
      clearTimeout(tierTimeoutRef.current);
      tierTimeoutRef.current = null;
    }
    if (examineTimeoutRef.current) {
      clearTimeout(examineTimeoutRef.current);
      examineTimeoutRef.current = null;
    }
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  // Update hover duration
  const updateHoverDuration = useCallback(() => {
    if (hoverStartRef.current) {
      const duration = Date.now() - hoverStartRef.current;
      setState((prev) => ({ ...prev, hoverDuration: duration }));
      rafRef.current = requestAnimationFrame(updateHoverDuration);
    }
  }, []);

  // Start hover tracking
  const onMouseEnter = useCallback(() => {
    hoverStartRef.current = Date.now();

    // Show tooltip after initial delay
    showTimeoutRef.current = setTimeout(() => {
      setState((prev) => ({ ...prev, isVisible: true, tier: "immediate" }));

      // Start tracking hover duration
      rafRef.current = requestAnimationFrame(updateHoverDuration);

      // Upgrade to delayed tier
      tierTimeoutRef.current = setTimeout(() => {
        setState((prev) => ({ ...prev, tier: "delayed" }));
      }, delayedTierDelay - showDelay);

      // Upgrade to examine tier (if not click-only)
      if (!examineRequiresClick) {
        examineTimeoutRef.current = setTimeout(() => {
          setState((prev) => ({ ...prev, tier: "examine" }));
        }, examineTierDelay - showDelay);
      }
    }, showDelay);
  }, [
    showDelay,
    delayedTierDelay,
    examineTierDelay,
    examineRequiresClick,
    updateHoverDuration,
  ]);

  // Stop hover tracking
  const onMouseLeave = useCallback(() => {
    clearTimeouts();
    hoverStartRef.current = null;

    setState({
      tier: "immediate",
      isVisible: false,
      hoverDuration: 0,
      isExamineMode: false,
    });
  }, [clearTimeouts]);

  // Trigger examine mode
  const onExamine = useCallback(() => {
    setState((prev) => ({
      ...prev,
      tier: "examine",
      isVisible: true,
      isExamineMode: true,
    }));
  }, []);

  // Reset to initial state
  const reset = useCallback(() => {
    clearTimeouts();
    hoverStartRef.current = null;

    setState({
      tier: "immediate",
      isVisible: false,
      hoverDuration: 0,
      isExamineMode: false,
    });
  }, [clearTimeouts]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearTimeouts();
    };
  }, [clearTimeouts]);

  return {
    ...state,
    onMouseEnter,
    onMouseLeave,
    onExamine,
    reset,
  };
}
