/**
 * Duel Countdown Overlay
 *
 * Full-screen overlay that displays the 3-2-1-FIGHT countdown
 * when a duel is about to begin.
 *
 * Features:
 * - Large centered countdown number
 * - Animated scale/fade transitions
 * - "FIGHT!" display on 0
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
// Component
// ============================================================================

export function DuelCountdown({ state }: DuelCountdownProps) {
  const theme = useThemeStore((s) => s.theme);
  const [animating, setAnimating] = useState(false);
  const [displayValue, setDisplayValue] = useState<string>("");

  // Trigger animation when count changes
  useEffect(() => {
    if (!state.visible) return;

    // Determine display text
    const text = state.count === 0 ? "FIGHT!" : state.count.toString();
    setDisplayValue(text);

    // Trigger scale animation
    setAnimating(true);
    const timer = setTimeout(() => setAnimating(false), 300);

    return () => clearTimeout(timer);
  }, [state.count, state.visible]);

  if (!state.visible) return null;

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
    background: "rgba(0, 0, 0, 0.6)",
    zIndex: 10000,
    pointerEvents: "none",
  };

  const countdownStyle: CSSProperties = {
    fontSize: state.count === 0 ? "120px" : "180px",
    fontWeight: theme.typography.fontWeight.bold,
    color: state.count === 0 ? theme.colors.state.success : "#fff",
    textShadow: `
      0 0 20px ${state.count === 0 ? theme.colors.state.success : "rgba(255,255,255,0.8)"},
      0 0 40px ${state.count === 0 ? theme.colors.state.success : "rgba(255,255,255,0.5)"},
      0 4px 8px rgba(0,0,0,0.5)
    `,
    transform: animating ? "scale(1.3)" : "scale(1)",
    opacity: animating ? 0.8 : 1,
    transition: "transform 0.15s ease-out, opacity 0.15s ease-out",
    userSelect: "none",
  };

  const subtitleStyle: CSSProperties = {
    fontSize: theme.typography.fontSize.lg,
    color: theme.colors.text.secondary,
    marginTop: theme.spacing.md,
    textShadow: "0 2px 4px rgba(0,0,0,0.5)",
    userSelect: "none",
  };

  const arenaTextStyle: CSSProperties = {
    position: "absolute",
    top: theme.spacing.xl,
    left: "50%",
    transform: "translateX(-50%)",
    fontSize: theme.typography.fontSize.md,
    color: theme.colors.text.primary,
    textShadow: "0 2px 4px rgba(0,0,0,0.5)",
    userSelect: "none",
  };

  return (
    <div style={overlayStyle}>
      <div style={arenaTextStyle}>Duel Arena</div>

      <div style={countdownStyle}>{displayValue}</div>

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
