import React, { useEffect, useState, useId } from "react";
import { useThemeStore } from "@/ui";
import type { ClientWorld } from "../types";

interface MinimapStaminaOrbProps {
  world: ClientWorld;
  size?: number;
}

/**
 * Running figure icon - clean SVG matching medieval fantasy aesthetic
 */
function RunIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      style={{ filter: "drop-shadow(0 1px 2px rgba(0, 0, 0, 0.8))" }}
    >
      {/* Head */}
      <circle cx="14" cy="4" r="2.5" fill={color} />
      {/* Body - running pose */}
      <path
        d="M11 8.5L8 11.5L10 13.5M11 8.5L15 10L18 8M11 8.5L13 14L11 19M13 14L16 17L18 21"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

/**
 * Walking figure icon - calmer pose
 */
function WalkIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      style={{ filter: "drop-shadow(0 1px 2px rgba(0, 0, 0, 0.8))" }}
    >
      {/* Head */}
      <circle cx="12" cy="4" r="2.5" fill={color} />
      {/* Body - walking pose */}
      <path
        d="M12 8L12 14M12 14L9 20M12 14L15 20M10 10L14 10"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

/**
 * Stamina Orb - A circular orb showing stamina percentage with fill animation.
 * Click to toggle between run and walk modes.
 */
export function MinimapStaminaOrb({
  world,
  size = 44,
}: MinimapStaminaOrbProps) {
  const theme = useThemeStore((s) => s.theme);
  const [runMode, setRunMode] = useState<boolean>(true);
  const [stamina, setStamina] = useState<number>(100);
  const [isHovered, setIsHovered] = useState(false);
  const uniqueId = useId();

  useEffect(() => {
    const update = () => {
      const player = world.entities?.player;
      if (player) {
        setRunMode(player.runMode ?? true);
        setStamina(player.stamina ?? 100);
      }
    };
    const id = setInterval(update, 200);
    update();
    return () => clearInterval(id);
  }, [world]);

  const toggleRunMode = () => {
    const player = world.entities?.player;
    if (player) {
      const newRunMode = !runMode;
      player.runMode = newRunMode;
      setRunMode(newRunMode);
      world.network?.send?.("moveRequest", { runMode: newRunMode });
    }
  };

  const staminaPercent = Math.max(0, Math.min(100, stamina));

  // Refined color palette using theme colors
  // Running: Warm amber/gold (matches brand accent)
  // Walking: Cooler bronze (more muted)
  const fillColorStart = runMode
    ? theme.colors.accent.primary
    : theme.colors.accent.active;
  const fillColorMid = runMode
    ? theme.colors.accent.hover
    : theme.colors.border.active;
  const fillColorEnd = runMode
    ? theme.colors.border.hover
    : theme.colors.border.default;
  const borderColor = runMode
    ? `${theme.colors.accent.primary}80`
    : `${theme.colors.border.decorative}80`;
  const glowColor = runMode
    ? `${theme.colors.accent.primary}40`
    : `${theme.colors.border.decorative}26`;
  const iconColor = theme.colors.background.primary;

  // Gradient IDs need to be unique per instance
  const gradientId = `staminaGradient-${uniqueId}`;
  const clipId = `circleClip-${uniqueId}`;

  // SVG handles everything - no CSS border needed
  const center = size / 2;
  const borderWidth = 2;
  const fillRadius = center; // Fill goes edge to edge
  const borderRadius = center - borderWidth / 2; // Border stroke centered on edge

  return (
    <div
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleRunMode();
      }}
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className="cursor-pointer relative"
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        boxShadow: `
          0 2px 8px rgba(0, 0, 0, 0.5),
          0 0 12px ${glowColor}
        `,
        overflow: "hidden",
        transform: isHovered ? "scale(1.05)" : "scale(1)",
        transition: "transform 0.15s ease, box-shadow 0.15s ease",
      }}
      title={runMode ? "Running (click to walk)" : "Walking (click to run)"}
    >
      {/* SVG handles all rendering for pixel-perfect alignment */}
      <svg
        width={size}
        height={size}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          pointerEvents: "none",
        }}
        viewBox={`0 0 ${size} ${size}`}
      >
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="100%" x2="0%" y2="0%">
            <stop offset="0%" stopColor={fillColorEnd} />
            <stop offset="50%" stopColor={fillColorMid} />
            <stop offset="100%" stopColor={fillColorStart} />
          </linearGradient>
          <clipPath id={clipId}>
            <circle cx={center} cy={center} r={fillRadius} />
          </clipPath>
        </defs>

        {/* Fill rectangle clipped to circle, height based on stamina */}
        <g clipPath={`url(#${clipId})`}>
          <rect
            x={0}
            y={size * (1 - staminaPercent / 100)}
            width={size}
            height={size * (staminaPercent / 100)}
            fill={`url(#${gradientId})`}
            style={{ transition: "y 0.3s ease-out, height 0.3s ease-out" }}
          />
        </g>

        {/* Border ring drawn in SVG for perfect alignment */}
        <circle
          cx={center}
          cy={center}
          r={borderRadius}
          fill="none"
          stroke={borderColor}
          strokeWidth={borderWidth}
        />

        {/* Subtle glass highlight at top */}
        <ellipse
          cx={center}
          cy={center * 0.5}
          rx={fillRadius * 0.45}
          ry={fillRadius * 0.2}
          fill="rgba(255, 255, 255, 0.06)"
        />
      </svg>

      {/* Icon and percentage text */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          pointerEvents: "none",
          zIndex: 1,
          gap: 1,
        }}
      >
        {/* Icon */}
        <div style={{ marginTop: -1 }}>
          {runMode ? (
            <RunIcon size={size * 0.42} color={iconColor} />
          ) : (
            <WalkIcon size={size * 0.42} color={iconColor} />
          )}
        </div>

        {/* Percentage */}
        <span
          style={{
            fontSize: size * 0.22,
            fontWeight: 700,
            fontFamily:
              "'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif",
            color: iconColor,
            textShadow: `0 0 4px ${fillColorStart}`,
            marginTop: -3,
            letterSpacing: "-0.02em",
          }}
        >
          {Math.round(staminaPercent)}%
        </span>
      </div>
    </div>
  );
}

// Keep old export for backwards compatibility
export const MinimapStaminaBar = MinimapStaminaOrb;
