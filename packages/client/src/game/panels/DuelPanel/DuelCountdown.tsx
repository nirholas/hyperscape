/**
 * Duel Countdown Overlay
 *
 * Full-screen overlay that displays the 3-2-1-FIGHT countdown
 * when a duel is about to begin.
 *
 * Features:
 * - Large centered countdown number with color-coded stages
 * - Animated scale/fade "punch" transitions
 * - Expanding ring pulse effect
 * - "FIGHT!" display on 0 with green glow
 * - Auto-hides after fight starts
 */

import { useState, useEffect, type CSSProperties } from "react";
import { useThemeStore } from "@/ui";

// ============================================================================
// Types
// ============================================================================

export interface DuelCountdownState {
  visible: boolean;
  count: number; // 3, 2, 1, 0 (0 = FIGHT!)
  opponentName: string;
}

interface DuelCountdownProps {
  state: DuelCountdownState;
}

// ============================================================================
// Animation Phase Type
// ============================================================================

type AnimPhase = "idle" | "punch" | "settle";

// ============================================================================
// Color Config by Count
// ============================================================================

const COUNT_COLORS: Record<number, string> = {
  3: "#ff4444", // Red
  2: "#ff8800", // Orange
  1: "#ffcc00", // Yellow
  0: "#44ff44", // Green (FIGHT!)
};

// ============================================================================
// Component
// ============================================================================

export function DuelCountdown({ state }: DuelCountdownProps) {
  const theme = useThemeStore((s) => s.theme);
  const [animPhase, setAnimPhase] = useState<AnimPhase>("idle");
  const [displayValue, setDisplayValue] = useState<string>("");
  const [ringScale, setRingScale] = useState(0);
  const [ringOpacity, setRingOpacity] = useState(0);

  // Trigger animation when count changes
  useEffect(() => {
    if (!state.visible) return;

    // Determine display text
    const text = state.count === 0 ? "FIGHT!" : state.count.toString();
    setDisplayValue(text);

    // Start punch animation sequence
    setAnimPhase("punch");
    setRingScale(0.5);
    setRingOpacity(0.8);

    // Phase 2: Settle (scale back down)
    const settleTimer = setTimeout(() => {
      setAnimPhase("settle");
    }, 150);

    // Phase 3: Idle
    const idleTimer = setTimeout(() => {
      setAnimPhase("idle");
    }, 400);

    // Ring expansion
    const ringTimer = setTimeout(() => {
      setRingScale(2.5);
      setRingOpacity(0);
    }, 50);

    return () => {
      clearTimeout(settleTimer);
      clearTimeout(idleTimer);
      clearTimeout(ringTimer);
    };
  }, [state.count, state.visible]);

  if (!state.visible) return null;

  const countColor = COUNT_COLORS[state.count] || "#fff";

  // Calculate transform based on animation phase
  const getTransform = (): string => {
    switch (animPhase) {
      case "punch":
        return "scale(1.4)";
      case "settle":
        return "scale(0.95)";
      default:
        return "scale(1)";
    }
  };

  // Styles
  const overlayStyle: CSSProperties = {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(0, 0, 0, 0.7)",
    zIndex: 10000,
    pointerEvents: "none",
  };

  const countdownContainerStyle: CSSProperties = {
    position: "relative",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };

  const countdownStyle: CSSProperties = {
    fontSize: state.count === 0 ? "140px" : "200px",
    fontWeight: theme.typography.fontWeight.bold,
    color: countColor,
    textShadow: `
      0 0 30px ${countColor},
      0 0 60px ${countColor}88,
      0 0 100px ${countColor}44,
      0 6px 12px rgba(0,0,0,0.6)
    `,
    transform: getTransform(),
    transition:
      animPhase === "punch"
        ? "transform 0.15s cubic-bezier(0.175, 0.885, 0.32, 1.275)"
        : "transform 0.25s ease-out",
    userSelect: "none",
    zIndex: 2,
  };

  const ringStyle: CSSProperties = {
    position: "absolute",
    width: "200px",
    height: "200px",
    borderRadius: "50%",
    border: `4px solid ${countColor}`,
    transform: `scale(${ringScale})`,
    opacity: ringOpacity,
    transition: "transform 0.6s ease-out, opacity 0.6s ease-out",
    pointerEvents: "none",
    zIndex: 1,
  };

  const subtitleStyle: CSSProperties = {
    fontSize: theme.typography.fontSize.xl,
    color: theme.colors.text.secondary,
    marginTop: theme.spacing.lg,
    textShadow: "0 2px 8px rgba(0,0,0,0.8)",
    userSelect: "none",
    opacity: animPhase === "idle" ? 1 : 0.5,
    transition: "opacity 0.2s ease-out",
  };

  const arenaTextStyle: CSSProperties = {
    position: "absolute",
    top: theme.spacing.xl,
    left: "50%",
    transform: "translateX(-50%)",
    fontSize: theme.typography.fontSize.lg,
    fontWeight: theme.typography.fontWeight.bold,
    color: theme.colors.text.primary,
    textShadow: "0 2px 8px rgba(0,0,0,0.8)",
    userSelect: "none",
    letterSpacing: "2px",
    textTransform: "uppercase",
  };

  return (
    <div style={overlayStyle}>
      <div style={arenaTextStyle}>Duel Arena</div>

      <div style={countdownContainerStyle}>
        {/* Expanding ring effect */}
        <div style={ringStyle} />

        {/* Main countdown number */}
        <div style={countdownStyle}>{displayValue}</div>
      </div>

      {state.count > 0 && (
        <div style={subtitleStyle}>vs {state.opponentName}</div>
      )}

      {state.count === 0 && <div style={subtitleStyle}>Good luck!</div>}
    </div>
  );
}

// ============================================================================
// Default State Factory
// ============================================================================

export function createDefaultDuelCountdownState(): DuelCountdownState {
  return {
    visible: false,
    count: 3,
    opponentName: "",
  };
}
