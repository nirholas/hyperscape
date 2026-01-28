/**
 * Auto-Collapse Hook
 *
 * Provides auto-collapse behavior for panels and windows.
 * Panels collapse after a timeout when mouse leaves.
 *
 * @packageDocumentation
 */

import { useState, useCallback, useRef, useEffect } from "react";

/** Auto-collapse configuration */
export interface AutoCollapseConfig {
  /** Delay before collapsing (ms) */
  collapseDelay?: number;
  /** Whether auto-collapse is enabled */
  enabled?: boolean;
  /** Callback when collapsed */
  onCollapse?: () => void;
  /** Callback when expanded */
  onExpand?: () => void;
}

/** Default configuration */
const DEFAULT_CONFIG: Required<AutoCollapseConfig> = {
  collapseDelay: 3000,
  enabled: true,
  onCollapse: () => {},
  onExpand: () => {},
};

/** Return value from useAutoCollapse */
export interface AutoCollapseResult {
  /** Whether currently collapsed */
  isCollapsed: boolean;
  /** Manually expand */
  expand: () => void;
  /** Manually collapse */
  collapse: () => void;
  /** Toggle collapsed state */
  toggle: () => void;
  /** Props to spread on the collapsible element */
  containerProps: {
    onMouseEnter: () => void;
    onMouseLeave: () => void;
    onFocus: () => void;
    onBlur: () => void;
  };
  /** Cancel any pending collapse */
  cancelPendingCollapse: () => void;
  /** Whether a collapse is pending */
  isPending: boolean;
}

/**
 * Hook for auto-collapse behavior
 *
 * @example
 * ```tsx
 * function CollapsiblePanel() {
 *   const {
 *     isCollapsed,
 *     containerProps,
 *     expand,
 *   } = useAutoCollapse({
 *     collapseDelay: 2000,
 *     onCollapse: () => console.log('Collapsed'),
 *   });
 *
 *   return (
 *     <div
 *       {...containerProps}
 *       style={{
 *         height: isCollapsed ? '40px' : '200px',
 *         overflow: 'hidden',
 *         transition: 'height 200ms ease-out',
 *       }}
 *     >
 *       <div className="header">Panel Header</div>
 *       {!isCollapsed && (
 *         <div className="content">Panel Content</div>
 *       )}
 *     </div>
 *   );
 * }
 * ```
 */
export function useAutoCollapse(
  config: AutoCollapseConfig = {},
): AutoCollapseResult {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };

  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isHoveredRef = useRef(false);
  const isFocusedRef = useRef(false);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const cancelPendingCollapse = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setIsPending(false);
  }, []);

  const startCollapseTimer = useCallback(() => {
    if (!mergedConfig.enabled) return;

    cancelPendingCollapse();

    setIsPending(true);
    timeoutRef.current = setTimeout(() => {
      // Only collapse if still not hovered/focused
      if (!isHoveredRef.current && !isFocusedRef.current) {
        setIsCollapsed(true);
        mergedConfig.onCollapse();
      }
      setIsPending(false);
    }, mergedConfig.collapseDelay);
  }, [mergedConfig, cancelPendingCollapse]);

  const expand = useCallback(() => {
    cancelPendingCollapse();
    setIsCollapsed(false);
    mergedConfig.onExpand();
  }, [cancelPendingCollapse, mergedConfig]);

  const collapse = useCallback(() => {
    cancelPendingCollapse();
    setIsCollapsed(true);
    mergedConfig.onCollapse();
  }, [cancelPendingCollapse, mergedConfig]);

  const toggle = useCallback(() => {
    if (isCollapsed) {
      expand();
    } else {
      collapse();
    }
  }, [isCollapsed, expand, collapse]);

  const onMouseEnter = useCallback(() => {
    isHoveredRef.current = true;
    cancelPendingCollapse();
    if (isCollapsed) {
      expand();
    }
  }, [isCollapsed, expand, cancelPendingCollapse]);

  const onMouseLeave = useCallback(() => {
    isHoveredRef.current = false;
    if (!isFocusedRef.current) {
      startCollapseTimer();
    }
  }, [startCollapseTimer]);

  const onFocus = useCallback(() => {
    isFocusedRef.current = true;
    cancelPendingCollapse();
    if (isCollapsed) {
      expand();
    }
  }, [isCollapsed, expand, cancelPendingCollapse]);

  const onBlur = useCallback(() => {
    isFocusedRef.current = false;
    if (!isHoveredRef.current) {
      startCollapseTimer();
    }
  }, [startCollapseTimer]);

  return {
    isCollapsed,
    expand,
    collapse,
    toggle,
    containerProps: {
      onMouseEnter,
      onMouseLeave,
      onFocus,
      onBlur,
    },
    cancelPendingCollapse,
    isPending,
  };
}

/**
 * Hook for ribbon-specific auto-collapse
 *
 * The ribbon has special behavior:
 * - Collapses to just icons when idle
 * - Expands on hover to show full panel
 * - Stays expanded while any panel is open
 */
export function useRibbonAutoCollapse(config: AutoCollapseConfig = {}) {
  const [hasOpenPanel, setHasOpenPanel] = useState(false);

  const autoCollapse = useAutoCollapse({
    ...config,
    enabled: config.enabled !== false && !hasOpenPanel,
  });

  const markPanelOpen = useCallback(() => {
    setHasOpenPanel(true);
    autoCollapse.expand();
  }, [autoCollapse]);

  const markPanelClosed = useCallback(() => {
    setHasOpenPanel(false);
  }, []);

  return {
    ...autoCollapse,
    hasOpenPanel,
    markPanelOpen,
    markPanelClosed,
  };
}
