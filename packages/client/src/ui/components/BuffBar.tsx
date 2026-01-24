/**
 * Buff Bar Component
 *
 * Displays active buffs and debuffs with timer rings,
 * stacking indicators, and expiry warnings.
 *
 * @packageDocumentation
 */

import React, { useEffect, useState } from "react";
import { useTheme } from "../stores/themeStore";
import { useAccessibilityStore } from "../stores/accessibilityStore";
import { animationDurations } from "./animations";

/** Buff/debuff data */
export interface Buff {
  /** Unique identifier */
  id: string;
  /** Display name */
  name: string;
  /** Icon (emoji or URL) */
  icon: string;
  /** Total duration in seconds */
  duration: number;
  /** Remaining time in seconds */
  remaining: number;
  /** Type determines border color */
  type: "buff" | "debuff";
  /** Stack count (optional) */
  stacks?: number;
  /** Description for tooltip */
  description?: string;
}

/** Props for BuffBar */
export interface BuffBarProps {
  /** Array of active buffs/debuffs */
  buffs: Buff[];
  /** Orientation */
  orientation?: "horizontal" | "vertical";
  /** Size of each buff icon */
  iconSize?: number;
  /** Gap between icons */
  gap?: number;
  /** Show timer text on icons */
  showTimers?: boolean;
  /** Callback when buff is clicked */
  onBuffClick?: (buff: Buff) => void;
  /** Callback when buff expires */
  onBuffExpire?: (buff: Buff) => void;
  /** Custom className */
  className?: string;
  /** Custom style */
  style?: React.CSSProperties;
}

/** Single buff icon with timer ring */
function BuffIcon({
  buff,
  size,
  showTimer,
  onClick,
}: {
  buff: Buff;
  size: number;
  showTimer: boolean;
  onClick?: () => void;
}): React.ReactElement {
  const theme = useTheme();
  const { reducedMotion } = useAccessibilityStore();

  // Calculate progress (0 to 1)
  const progress = buff.remaining / buff.duration;
  const isExpiring = buff.remaining <= 5;

  // SVG circle math
  const strokeWidth = 3;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - progress);

  // Border color based on type
  const borderColor =
    buff.type === "buff"
      ? theme.colors.state.success
      : theme.colors.state.danger;

  return (
    <div
      onClick={onClick}
      title={`${buff.name}${buff.description ? `: ${buff.description}` : ""}`}
      style={{
        position: "relative",
        width: size,
        height: size,
        cursor: onClick ? "pointer" : "default",
        animation:
          isExpiring && !reducedMotion
            ? `buff-expire-pulse ${animationDurations.extended}ms ease-in-out infinite`
            : undefined,
      }}
    >
      {/* Background circle */}
      <svg
        width={size}
        height={size}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          transform: "rotate(-90deg)",
        }}
      >
        {/* Track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill={theme.colors.background.secondary}
          stroke={theme.colors.border.default}
          strokeWidth={strokeWidth}
        />
        {/* Progress ring */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={borderColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          style={{
            transition: reducedMotion
              ? "none"
              : "stroke-dashoffset 0.5s linear",
          }}
        />
      </svg>

      {/* Icon */}
      <div
        style={{
          position: "absolute",
          top: strokeWidth,
          left: strokeWidth,
          width: size - strokeWidth * 2,
          height: size - strokeWidth * 2,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: size * 0.5,
          borderRadius: "50%",
          overflow: "hidden",
          backgroundColor: theme.colors.background.tertiary,
        }}
      >
        {buff.icon.startsWith("http") ? (
          <img
            src={buff.icon}
            alt={buff.name}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          buff.icon
        )}
      </div>

      {/* Timer overlay */}
      {showTimer && (
        <div
          style={{
            position: "absolute",
            bottom: -2,
            left: 0,
            right: 0,
            textAlign: "center",
            fontSize: 9,
            fontWeight: 600,
            color: isExpiring
              ? theme.colors.state.danger
              : theme.colors.text.primary,
            textShadow: "0 0 2px black, 0 0 2px black",
          }}
        >
          {Math.ceil(buff.remaining)}s
        </div>
      )}

      {/* Stack count */}
      {buff.stacks && buff.stacks > 1 && (
        <div
          style={{
            position: "absolute",
            top: -4,
            right: -4,
            minWidth: 14,
            height: 14,
            borderRadius: 7,
            backgroundColor: theme.colors.accent.primary,
            color: theme.colors.background.primary,
            fontSize: 9,
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "0 3px",
          }}
        >
          {buff.stacks}
        </div>
      )}
    </div>
  );
}

/**
 * Buff Bar Component
 *
 * Displays active buffs and debuffs in a row/column with
 * radial timer progress, stack counts, and expiry warnings.
 *
 * @example
 * ```tsx
 * <BuffBar
 *   buffs={[
 *     { id: "1", name: "Speed", icon: "⚡", duration: 30, remaining: 25, type: "buff" },
 *     { id: "2", name: "Poison", icon: "☠️", duration: 60, remaining: 45, type: "debuff" },
 *   ]}
 *   onBuffClick={(buff) => console.log(`Clicked ${buff.name}`)}
 * />
 * ```
 */
export function BuffBar({
  buffs,
  orientation = "horizontal",
  iconSize = 32,
  gap = 4,
  showTimers = true,
  onBuffClick,
  onBuffExpire,
  className,
  style,
}: BuffBarProps): React.ReactElement {
  const theme = useTheme();

  // Track expired buffs
  const [prevIds, setPrevIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const currentIds = new Set(buffs.map((b) => b.id));

    // Find expired buffs
    prevIds.forEach((id) => {
      if (!currentIds.has(id)) {
        const expiredBuff = buffs.find((b) => b.id === id);
        if (expiredBuff && onBuffExpire) {
          onBuffExpire(expiredBuff);
        }
      }
    });

    setPrevIds(currentIds);
  }, [buffs, onBuffExpire, prevIds]);

  // Separate buffs and debuffs
  const buffList = buffs.filter((b) => b.type === "buff");
  const debuffList = buffs.filter((b) => b.type === "debuff");

  return (
    <div
      className={className}
      style={{
        display: "flex",
        flexDirection: orientation === "horizontal" ? "row" : "column",
        gap,
        alignItems: "flex-start",
        ...style,
      }}
    >
      {/* Buffs first */}
      {buffList.map((buff) => (
        <BuffIcon
          key={buff.id}
          buff={buff}
          size={iconSize}
          showTimer={showTimers}
          onClick={onBuffClick ? () => onBuffClick(buff) : undefined}
        />
      ))}

      {/* Separator if both exist */}
      {buffList.length > 0 && debuffList.length > 0 && (
        <div
          style={{
            width: orientation === "horizontal" ? 1 : "100%",
            height: orientation === "horizontal" ? iconSize : 1,
            backgroundColor: theme.colors.border.default,
            margin:
              orientation === "horizontal"
                ? `0 ${gap / 2}px`
                : `${gap / 2}px 0`,
          }}
        />
      )}

      {/* Debuffs second */}
      {debuffList.map((buff) => (
        <BuffIcon
          key={buff.id}
          buff={buff}
          size={iconSize}
          showTimer={showTimers}
          onClick={onBuffClick ? () => onBuffClick(buff) : undefined}
        />
      ))}
    </div>
  );
}

// Add CSS keyframes for buff expiry pulse
if (typeof document !== "undefined") {
  const style = document.createElement("style");
  style.textContent = `
    @keyframes buff-expire-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
  `;
  document.head.appendChild(style);
}
