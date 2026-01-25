/**
 * Compact Status HUD
 *
 * Mobile-optimized HP and Prayer display using themed orbs.
 * Uses the dark theme colors from the theme store.
 *
 * @packageDocumentation
 */

import React, { useMemo, type CSSProperties } from "react";
import { useMobileLayout, useThemeStore } from "hs-kit";
import { getMobileUISizes } from "./mobileUISizes";

interface StatusValue {
  current?: number;
  max?: number;
}

interface CompactStatusHUDProps {
  /** Health points */
  health: StatusValue | null | undefined;
  /** Prayer points */
  prayerPoints: StatusValue | null | undefined;
}

/**
 * Status Orb - Dark themed circular orb
 */
function StatusOrb({
  type,
  value,
  max,
  size,
}: {
  type: "hp" | "prayer";
  value: number;
  max: number;
  size: number;
}) {
  const theme = useThemeStore((s) => s.theme);

  const percent = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;

  // Use theme colors
  const fillColor =
    type === "hp" ? theme.colors.status.hp : theme.colors.status.prayer;
  const bgColor =
    type === "hp"
      ? theme.colors.status.hpBackground
      : theme.colors.status.prayerBackground;

  // Icons
  const icon = type === "hp" ? "♥" : "✦";

  // Outer ring using theme border
  const outerStyle: CSSProperties = {
    width: size,
    height: size,
    borderRadius: "50%",
    background: theme.colors.background.tertiary,
    padding: 2,
    boxShadow: `
      0 2px 6px rgba(0, 0, 0, 0.5),
      inset 0 1px 0 rgba(255, 255, 255, 0.05)
    `,
  };

  // Inner orb with theme background
  const innerStyle: CSSProperties = {
    width: "100%",
    height: "100%",
    borderRadius: "50%",
    position: "relative",
    background: `linear-gradient(180deg, ${theme.colors.background.secondary} 0%, ${bgColor} 100%)`,
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    border: `1px solid ${theme.colors.border.default}`,
    boxShadow: `inset 0 2px 4px rgba(0, 0, 0, 0.4)`,
  };

  // Fill from bottom based on percentage
  const fillStyle: CSSProperties = {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: `${percent}%`,
    background: `linear-gradient(to top, ${fillColor} 0%, ${fillColor}80 100%)`,
    opacity: 0.6,
    transition: "height 0.3s ease-out",
  };

  const iconStyle: CSSProperties = {
    fontSize: size * 0.32,
    color: fillColor,
    textShadow: `0 1px 2px rgba(0, 0, 0, 0.8)`,
    zIndex: 1,
    lineHeight: 1,
  };

  const valueStyle: CSSProperties = {
    fontSize: size * 0.26,
    fontWeight: theme.typography.fontWeight.bold,
    color: theme.colors.text.primary,
    textShadow: "0 1px 2px rgba(0, 0, 0, 0.9)",
    zIndex: 1,
    lineHeight: 1,
    marginTop: 1,
  };

  return (
    <div style={outerStyle}>
      <div style={innerStyle}>
        <div style={fillStyle} />
        <span style={iconStyle}>{icon}</span>
        <span style={valueStyle}>{value}</span>
      </div>
    </div>
  );
}

/**
 * Compact Status HUD Component
 *
 * Displays HP and Prayer as dark themed orbs.
 */
export function CompactStatusHUD({
  health,
  prayerPoints,
}: CompactStatusHUDProps): React.ReactElement {
  const layout = useMobileLayout();
  const sizes = useMemo(() => getMobileUISizes(layout), [layout]);

  // Normalize values with defaults
  const hp = {
    current: typeof health?.current === "number" ? health.current : 10,
    max: typeof health?.max === "number" ? health.max : 10,
  };
  const prayer = {
    current:
      typeof prayerPoints?.current === "number" ? prayerPoints.current : 1,
    max: typeof prayerPoints?.max === "number" ? prayerPoints.max : 1,
  };

  // Orb size based on status HUD config
  const orbSize = sizes.statusHud.orbSize;

  const containerStyle: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    padding: 0,
    backgroundColor: "transparent",
  };

  return (
    <div style={containerStyle}>
      <StatusOrb type="hp" value={hp.current} max={hp.max} size={orbSize} />
      <StatusOrb
        type="prayer"
        value={prayer.current}
        max={prayer.max}
        size={orbSize}
      />
    </div>
  );
}
