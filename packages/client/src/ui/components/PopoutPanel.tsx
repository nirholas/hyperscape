/**
 * Popout Panel Component
 *
 * Mobile-optimized panel with three modes:
 * - Hidden: Icon only
 * - Mini: Compact stats display
 * - Full: Complete interface
 *
 * Swipe from edge to expand, tap to cycle modes.
 *
 * @packageDocumentation
 */

import React, { useRef, useCallback, type ReactNode } from "react";
import { useTheme } from "../stores/themeStore";
import { useAccessibilityStore } from "../stores/accessibilityStore";

/** Panel mode */
export type PopoutMode = "hidden" | "mini" | "full";

/** Panel position */
export type PopoutPosition = "left" | "right" | "top" | "bottom";

/** Props for PopoutPanel */
export interface PopoutPanelProps {
  /** Current mode */
  mode: PopoutMode;
  /** Callback when mode changes */
  onModeChange: (mode: PopoutMode) => void;
  /** Panel position (edge of screen) */
  position: PopoutPosition;
  /** Panel title/label */
  title: string;
  /** Icon for hidden mode */
  icon: string;
  /** Content for mini mode */
  miniContent: ReactNode;
  /** Content for full mode */
  fullContent: ReactNode;
  /** Width when full (for left/right positions) */
  fullWidth?: number;
  /** Height when full (for top/bottom positions) */
  fullHeight?: number;
  /** Mini size */
  miniSize?: number;
  /** Custom className */
  className?: string;
  /** Custom style */
  style?: React.CSSProperties;
}

/**
 * Popout Panel Component
 *
 * Three-mode panel that can be hidden, show minimal info, or fully expanded.
 * Designed for mobile interfaces where screen real estate is limited.
 *
 * @example
 * ```tsx
 * const [mode, setMode] = useState<PopoutMode>('mini');
 *
 * <PopoutPanel
 *   mode={mode}
 *   onModeChange={setMode}
 *   position="right"
 *   title="Health"
 *   icon="❤️"
 *   miniContent={<span>100/100</span>}
 *   fullContent={<HealthPanel />}
 * />
 * ```
 */
export function PopoutPanel({
  mode,
  onModeChange,
  position,
  title,
  icon,
  miniContent,
  fullContent,
  fullWidth = 280,
  fullHeight = 300,
  miniSize = 80,
  className,
  style,
}: PopoutPanelProps): React.ReactElement {
  const theme = useTheme();
  const { reducedMotion } = useAccessibilityStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  // Cycle through modes
  const cycleMode = useCallback(() => {
    const modes: PopoutMode[] = ["hidden", "mini", "full"];
    const currentIndex = modes.indexOf(mode);
    const nextIndex = (currentIndex + 1) % modes.length;
    onModeChange(modes[nextIndex]);
  }, [mode, onModeChange]);

  // Handle swipe gestures
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
  }, []);

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (!touchStartRef.current) return;

      const touch = e.changedTouches[0];
      const deltaX = touch.clientX - touchStartRef.current.x;
      const deltaY = touch.clientY - touchStartRef.current.y;

      const threshold = 50;
      const isHorizontal = Math.abs(deltaX) > Math.abs(deltaY);
      const isVertical = !isHorizontal;

      // Determine swipe direction based on position
      let shouldExpand = false;
      let shouldCollapse = false;

      switch (position) {
        case "left":
          if (isHorizontal && deltaX > threshold) shouldExpand = true;
          if (isHorizontal && deltaX < -threshold) shouldCollapse = true;
          break;
        case "right":
          if (isHorizontal && deltaX < -threshold) shouldExpand = true;
          if (isHorizontal && deltaX > threshold) shouldCollapse = true;
          break;
        case "top":
          if (isVertical && deltaY > threshold) shouldExpand = true;
          if (isVertical && deltaY < -threshold) shouldCollapse = true;
          break;
        case "bottom":
          if (isVertical && deltaY < -threshold) shouldExpand = true;
          if (isVertical && deltaY > threshold) shouldCollapse = true;
          break;
      }

      if (shouldExpand) {
        if (mode === "hidden") onModeChange("mini");
        else if (mode === "mini") onModeChange("full");
      } else if (shouldCollapse) {
        if (mode === "full") onModeChange("mini");
        else if (mode === "mini") onModeChange("hidden");
      }

      touchStartRef.current = null;
    },
    [mode, onModeChange, position],
  );

  // Calculate position styles
  const getPositionStyles = (): React.CSSProperties => {
    const base: React.CSSProperties = {
      position: "fixed",
      zIndex: theme.zIndex.window,
    };

    switch (position) {
      case "left":
        return { ...base, left: 0, top: "50%", transform: "translateY(-50%)" };
      case "right":
        return { ...base, right: 0, top: "50%", transform: "translateY(-50%)" };
      case "top":
        return { ...base, top: 0, left: "50%", transform: "translateX(-50%)" };
      case "bottom":
        return {
          ...base,
          bottom: 0,
          left: "50%",
          transform: "translateX(-50%)",
        };
    }
  };

  // Calculate size based on mode
  const getSizeStyles = (): React.CSSProperties => {
    const isHorizontal = position === "left" || position === "right";

    switch (mode) {
      case "hidden":
        return {
          width: 44,
          height: 44,
        };
      case "mini":
        return isHorizontal
          ? { width: miniSize, height: "auto" }
          : { width: "auto", height: miniSize };
      case "full":
        return isHorizontal
          ? { width: fullWidth, height: "auto", maxHeight: "80vh" }
          : { width: "auto", maxWidth: "90vw", height: fullHeight };
    }
  };

  // Get border radius based on position
  const getBorderRadius = (): React.CSSProperties => {
    const radius = theme.borderRadius.lg;
    switch (position) {
      case "left":
        return {
          borderTopRightRadius: radius,
          borderBottomRightRadius: radius,
        };
      case "right":
        return {
          borderTopLeftRadius: radius,
          borderBottomLeftRadius: radius,
        };
      case "top":
        return {
          borderBottomLeftRadius: radius,
          borderBottomRightRadius: radius,
        };
      case "bottom":
        return {
          borderTopLeftRadius: radius,
          borderTopRightRadius: radius,
        };
    }
  };

  return (
    <div
      ref={containerRef}
      className={className}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      style={{
        ...getPositionStyles(),
        ...getSizeStyles(),
        ...getBorderRadius(),
        backgroundColor: theme.colors.background.glass,
        border: `1px solid ${theme.colors.border.decorative}`,
        boxShadow: theme.shadows.lg,
        backdropFilter: `blur(${theme.glass.blur}px)`,
        overflow: "hidden",
        transition: reducedMotion ? "none" : "all 0.3s ease",
        ...style,
      }}
    >
      {/* Hidden mode - just icon */}
      {mode === "hidden" && (
        <div
          onClick={cycleMode}
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            fontSize: 20,
          }}
        >
          {icon}
        </div>
      )}

      {/* Mini mode - compact display */}
      {mode === "mini" && (
        <div
          onClick={cycleMode}
          style={{
            padding: theme.spacing.sm,
            cursor: "pointer",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: theme.spacing.xs,
              marginBottom: theme.spacing.xs,
            }}
          >
            <span style={{ fontSize: 14 }}>{icon}</span>
            <span
              style={{
                fontSize: theme.typography.fontSize.xs,
                color: theme.colors.text.secondary,
                fontWeight: theme.typography.fontWeight.medium,
              }}
            >
              {title}
            </span>
          </div>
          <div
            style={{
              fontSize: theme.typography.fontSize.sm,
              color: theme.colors.text.primary,
            }}
          >
            {miniContent}
          </div>
        </div>
      )}

      {/* Full mode - complete panel */}
      {mode === "full" && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            height: "100%",
          }}
        >
          {/* Header */}
          <div
            onClick={cycleMode}
            style={{
              display: "flex",
              alignItems: "center",
              gap: theme.spacing.xs,
              padding: theme.spacing.sm,
              borderBottom: `1px solid ${theme.colors.border.default}`,
              cursor: "pointer",
            }}
          >
            <span style={{ fontSize: 16 }}>{icon}</span>
            <span
              style={{
                fontSize: theme.typography.fontSize.sm,
                fontWeight: theme.typography.fontWeight.semibold,
                color: theme.colors.text.primary,
              }}
            >
              {title}
            </span>
            <span
              style={{
                marginLeft: "auto",
                fontSize: 12,
                color: theme.colors.text.muted,
              }}
            >
              ✕
            </span>
          </div>

          {/* Content */}
          <div
            style={{
              flex: 1,
              overflow: "auto",
              padding: theme.spacing.sm,
            }}
          >
            {fullContent}
          </div>
        </div>
      )}

      {/* Drag handle indicator */}
      <div
        style={{
          position: "absolute",
          ...(position === "left" && {
            right: 4,
            top: "50%",
            transform: "translateY(-50%)",
            width: 4,
            height: 24,
          }),
          ...(position === "right" && {
            left: 4,
            top: "50%",
            transform: "translateY(-50%)",
            width: 4,
            height: 24,
          }),
          ...(position === "top" && {
            bottom: 4,
            left: "50%",
            transform: "translateX(-50%)",
            width: 24,
            height: 4,
          }),
          ...(position === "bottom" && {
            top: 4,
            left: "50%",
            transform: "translateX(-50%)",
            width: 24,
            height: 4,
          }),
          backgroundColor: theme.colors.border.default,
          borderRadius: 2,
          opacity: mode !== "hidden" ? 0.5 : 0,
          transition: "opacity 0.2s",
        }}
      />
    </div>
  );
}
