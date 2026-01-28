/**
 * Mobile Drawer Component
 *
 * Bottom sheet drawer for mobile UI with swipe gestures.
 * Features:
 * - Three states: collapsed (hidden), half (50vh), full (90vh)
 * - Drag handle for swipe gestures (swipe down to close)
 * - Spring animations (CSS transforms for GPU acceleration)
 * - Backdrop with tap-to-close
 * - Safe area inset handling for home indicator
 * - Content scrolling with overscroll-behavior
 *
 * @packageDocumentation
 */

import React, {
  useState,
  useRef,
  useCallback,
  useEffect,
  useMemo,
  memo,
  type ReactNode,
  type CSSProperties,
} from "react";
import { useTheme } from "../stores/themeStore";
import { usePrefersReducedMotion } from "../core/responsive";

/** Drawer state/height */
export type DrawerState = "collapsed" | "compact" | "half" | "full";

/** Drawer height configuration */
export interface DrawerHeightConfig {
  compact: number; // vh
  half: number; // vh
  full: number; // vh
}

/** Default height configuration */
const DEFAULT_HEIGHTS: DrawerHeightConfig = {
  compact: 30,
  half: 50,
  full: 90,
};

/** Props for MobileDrawer */
export interface MobileDrawerProps {
  /** Whether the drawer is open */
  isOpen: boolean;
  /** Called when drawer should close */
  onClose: () => void;
  /** Called when drawer state changes */
  onStateChange?: (state: DrawerState) => void;
  /** Initial/current drawer state */
  state?: DrawerState;
  /** Drawer content */
  children: ReactNode;
  /** Title for the drawer header */
  title?: string;
  /** Show backdrop when open (default: true) */
  showBackdrop?: boolean;
  /** Close on backdrop tap (default: true) */
  closeOnBackdropTap?: boolean;
  /** Allow swipe to dismiss (default: true) */
  swipeToDismiss?: boolean;
  /** Allow swipe to expand (default: true) */
  swipeToExpand?: boolean;
  /** Height configuration */
  heights?: Partial<DrawerHeightConfig>;
  /** Safe area bottom inset (for home indicator) */
  safeAreaBottom?: number;
  /** Custom z-index (default: 9000) */
  zIndex?: number;
  /** Custom className */
  className?: string;
  /** Custom style */
  style?: CSSProperties;
  /** Header right action */
  headerAction?: ReactNode;
}

/** Swipe detection threshold in pixels */
const SWIPE_THRESHOLD = 50;

/** Velocity threshold for fling gestures (px/ms) */
const VELOCITY_THRESHOLD = 0.5;

/**
 * Mobile Drawer - Bottom sheet component
 *
 * @example
 * ```tsx
 * <MobileDrawer
 *   isOpen={isInventoryOpen}
 *   onClose={() => setInventoryOpen(false)}
 *   title="Inventory"
 *   state="half"
 * >
 *   <InventoryPanel />
 * </MobileDrawer>
 * ```
 */
export const MobileDrawer = memo(function MobileDrawer({
  isOpen,
  onClose,
  onStateChange,
  state = "half",
  children,
  title,
  showBackdrop = true,
  closeOnBackdropTap = true,
  swipeToDismiss = true,
  swipeToExpand = true,
  heights: customHeights,
  safeAreaBottom = 0,
  zIndex = 9000,
  className,
  style,
  headerAction,
}: MobileDrawerProps): React.ReactElement | null {
  const theme = useTheme();
  const prefersReducedMotion = usePrefersReducedMotion();

  // Merge custom heights with defaults
  const heights = useMemo(
    () => ({ ...DEFAULT_HEIGHTS, ...customHeights }),
    [customHeights],
  );

  // Internal state for current drawer position
  const [internalState, setInternalState] = useState<DrawerState>(state);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);

  // Refs for touch handling
  const drawerRef = useRef<HTMLDivElement>(null);
  const touchStartRef = useRef<{ y: number; time: number } | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // Sync internal state with prop
  useEffect(() => {
    if (isOpen && state !== "collapsed") {
      setInternalState(state);
    }
  }, [state, isOpen]);

  // Get height in vh for current state
  const getHeightVh = useCallback(
    (s: DrawerState): number => {
      switch (s) {
        case "collapsed":
          return 0;
        case "compact":
          return heights.compact;
        case "half":
          return heights.half;
        case "full":
          return heights.full;
      }
    },
    [heights],
  );

  // Calculate translateY for current position
  const getTranslateY = useCallback(
    (s: DrawerState, offset: number = 0): number => {
      if (!isOpen || s === "collapsed") {
        return 100; // Off-screen (100vh down)
      }
      const heightVh = getHeightVh(s);
      const baseTranslate = 100 - heightVh;
      // Convert offset from px to vh
      const offsetVh =
        typeof window !== "undefined" ? (offset / window.innerHeight) * 100 : 0;
      return Math.max(0, baseTranslate + offsetVh);
    },
    [isOpen, getHeightVh],
  );

  // Handle touch start
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    touchStartRef.current = { y: touch.clientY, time: Date.now() };
    setIsDragging(true);
  }, []);

  // Handle touch move
  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!touchStartRef.current || !isDragging) return;

      const touch = e.touches[0];
      const deltaY = touch.clientY - touchStartRef.current.y;

      // Only allow dragging down (positive deltaY) or up if swipeToExpand
      if (deltaY > 0 || swipeToExpand) {
        setDragOffset(deltaY);
      }
    },
    [isDragging, swipeToExpand],
  );

  // Handle touch end
  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (!touchStartRef.current) return;

      const touch = e.changedTouches[0];
      const deltaY = touch.clientY - touchStartRef.current.y;
      const deltaTime = Date.now() - touchStartRef.current.time;
      const velocity = deltaY / deltaTime;

      setIsDragging(false);
      setDragOffset(0);
      touchStartRef.current = null;

      // Determine new state based on swipe distance and velocity
      const currentHeightVh = getHeightVh(internalState);
      const dragVh =
        typeof window !== "undefined" ? (deltaY / window.innerHeight) * 100 : 0;

      // Fast fling detection
      if (Math.abs(velocity) > VELOCITY_THRESHOLD) {
        if (velocity > 0) {
          // Fling down
          if (swipeToDismiss) {
            onClose();
            onStateChange?.("collapsed");
          }
        } else if (swipeToExpand) {
          // Fling up - expand to next state
          if (internalState === "compact") {
            setInternalState("half");
            onStateChange?.("half");
          } else if (internalState === "half") {
            setInternalState("full");
            onStateChange?.("full");
          }
        }
        return;
      }

      // Threshold-based snap
      if (deltaY > SWIPE_THRESHOLD) {
        // Dragged down significantly
        if (dragVh > currentHeightVh * 0.3) {
          // Passed 30% threshold - dismiss or reduce
          if (internalState === "full") {
            setInternalState("half");
            onStateChange?.("half");
          } else if (internalState === "half") {
            setInternalState("compact");
            onStateChange?.("compact");
          } else if (swipeToDismiss) {
            onClose();
            onStateChange?.("collapsed");
          }
        }
      } else if (deltaY < -SWIPE_THRESHOLD && swipeToExpand) {
        // Dragged up significantly
        if (internalState === "compact") {
          setInternalState("half");
          onStateChange?.("half");
        } else if (internalState === "half") {
          setInternalState("full");
          onStateChange?.("full");
        }
      }
    },
    [
      internalState,
      swipeToDismiss,
      swipeToExpand,
      getHeightVh,
      onClose,
      onStateChange,
    ],
  );

  // Handle backdrop tap
  const handleBackdropClick = useCallback(() => {
    if (closeOnBackdropTap) {
      onClose();
    }
  }, [closeOnBackdropTap, onClose]);

  // Don't render if fully collapsed and not animating
  if (!isOpen && internalState === "collapsed") {
    return null;
  }

  const translateY = getTranslateY(internalState, isDragging ? dragOffset : 0);
  const transitionDuration = prefersReducedMotion ? "0ms" : "300ms";
  const transitionTiming = "cubic-bezier(0.32, 0.72, 0, 1)"; // iOS spring-like

  // Backdrop styles
  const backdropStyle: CSSProperties = {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    zIndex: zIndex - 1,
    opacity: isOpen ? 1 : 0,
    transition: isDragging ? "none" : `opacity ${transitionDuration} ease`,
    pointerEvents: isOpen ? "auto" : "none",
  };

  // Drawer container styles
  const drawerStyle: CSSProperties = {
    position: "fixed",
    left: 0,
    right: 0,
    bottom: 0,
    height: `${heights.full}vh`,
    transform: `translateY(${translateY}%)`,
    transition: isDragging
      ? "none"
      : `transform ${transitionDuration} ${transitionTiming}`,
    backgroundColor: theme.colors.background.primary,
    borderTopLeftRadius: theme.borderRadius.xl,
    borderTopRightRadius: theme.borderRadius.xl,
    boxShadow: `0 -4px 24px rgba(0, 0, 0, 0.4)`,
    display: "flex",
    flexDirection: "column",
    zIndex,
    willChange: isDragging ? "transform" : "auto",
    paddingBottom: safeAreaBottom,
    ...style,
  };

  // Drag handle styles
  const handleStyle: CSSProperties = {
    width: 36,
    height: 4,
    backgroundColor: theme.colors.border.decorative,
    borderRadius: 2,
    margin: "8px auto",
    opacity: 0.6,
  };

  // Header styles
  const headerStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: `0 ${theme.spacing.md}px ${theme.spacing.sm}px`,
    borderBottom: `1px solid ${theme.colors.border.default}`,
    touchAction: "none",
    userSelect: "none",
    cursor: "grab",
  };

  // Title styles
  const titleStyle: CSSProperties = {
    fontSize: theme.typography.fontSize.lg,
    fontWeight: theme.typography.fontWeight.semibold,
    color: theme.colors.text.primary,
    margin: 0,
  };

  // Content styles
  const contentStyle: CSSProperties = {
    flex: 1,
    overflow: "auto",
    overscrollBehavior: "contain",
    WebkitOverflowScrolling: "touch",
  };

  return (
    <>
      {/* Backdrop */}
      {showBackdrop && (
        <div
          style={backdropStyle}
          onClick={handleBackdropClick}
          aria-hidden="true"
        />
      )}

      {/* Drawer */}
      <div
        ref={drawerRef}
        className={className}
        style={drawerStyle}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? "drawer-title" : undefined}
      >
        {/* Drag handle */}
        <div
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          style={{
            touchAction: "none",
            cursor: "grab",
            paddingTop: 4,
          }}
        >
          <div style={handleStyle} />
        </div>

        {/* Header with title */}
        {title && (
          <div
            style={headerStyle}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
            <h3 id="drawer-title" style={titleStyle}>
              {title}
            </h3>
            {headerAction && <div>{headerAction}</div>}
          </div>
        )}

        {/* Content */}
        <div ref={contentRef} style={contentStyle}>
          {children}
        </div>
      </div>
    </>
  );
});

/**
 * Hook to manage drawer state
 */
export function useDrawerState(initialState: DrawerState = "collapsed") {
  const [state, setState] = useState<DrawerState>(initialState);
  const [isOpen, setIsOpen] = useState(initialState !== "collapsed");

  const open = useCallback((newState: DrawerState = "half") => {
    setState(newState);
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setState("collapsed");
    setIsOpen(false);
  }, []);

  const toggle = useCallback(
    (openState: DrawerState = "half") => {
      if (isOpen) {
        close();
      } else {
        open(openState);
      }
    },
    [isOpen, open, close],
  );

  return {
    state,
    isOpen,
    open,
    close,
    toggle,
    setState,
  };
}

export default MobileDrawer;
