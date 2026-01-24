/**
 * Boss Timer Component
 *
 * Displays boss encounter information including:
 * - Current phase indicator
 * - Time to next mechanic
 * - Attack cycle visualization
 * - Customizable alerts
 *
 * @packageDocumentation
 */

import React, { useEffect, useRef } from "react";
import { useTheme } from "../stores/themeStore";
import { useAccessibilityStore } from "../stores/accessibilityStore";

/** Boss attack/mechanic in the cycle */
export interface BossAttack {
  /** Unique identifier */
  id: string;
  /** Attack name */
  name: string;
  /** Icon (emoji or URL) */
  icon: string;
  /** Time until this attack (seconds) */
  timeUntil: number;
  /** Warning message */
  warning?: string;
  /** Color for highlight */
  color?: string;
}

/** Boss phase information */
export interface BossPhase {
  /** Phase number (1-indexed) */
  number: number;
  /** Phase name */
  name: string;
  /** Health percentage range (e.g., "75%-50%") */
  healthRange?: string;
  /** Special mechanics in this phase */
  mechanics?: string[];
}

/** Props for BossTimer */
export interface BossTimerProps {
  /** Boss name */
  bossName: string;
  /** Current phase */
  currentPhase: BossPhase;
  /** Total phases */
  totalPhases: number;
  /** Upcoming attacks in order */
  attackCycle: BossAttack[];
  /** Time until next major mechanic */
  timeToMechanic?: number;
  /** Whether boss is currently attackable */
  isVulnerable?: boolean;
  /** Compact mode for HUD */
  compact?: boolean;
  /** Callback when attack is about to happen */
  onAttackWarning?: (attack: BossAttack) => void;
  /** Custom className */
  className?: string;
  /** Custom style */
  style?: React.CSSProperties;
}

/**
 * Boss Timer Component
 *
 * Displays real-time boss encounter information for high-level
 * PvM content. Shows phase, attack cycle, and timing information.
 *
 * @example
 * ```tsx
 * <BossTimer
 *   bossName="Nex"
 *   currentPhase={{ number: 2, name: "Shadow", healthRange: "75%-50%" }}
 *   totalPhases={4}
 *   attackCycle={[
 *     { id: "1", name: "Shadow Smash", icon: "💀", timeUntil: 5 },
 *     { id: "2", name: "Shadow Trap", icon: "🕸️", timeUntil: 12 },
 *   ]}
 *   compact={true}
 * />
 * ```
 */
export function BossTimer({
  bossName,
  currentPhase,
  totalPhases,
  attackCycle,
  timeToMechanic,
  isVulnerable = true,
  compact = false,
  onAttackWarning,
  className,
  style,
}: BossTimerProps): React.ReactElement {
  const theme = useTheme();
  const { reducedMotion } = useAccessibilityStore();

  // Next attack
  const nextAttack = attackCycle[0];
  const isImminent = nextAttack && nextAttack.timeUntil <= 3;

  // Track which attacks we've already warned about to avoid duplicate warnings
  const warnedAttacksRef = useRef<Set<string>>(new Set());

  // Call onAttackWarning when an attack becomes imminent (within 3 seconds)
  useEffect(() => {
    if (!onAttackWarning || !nextAttack) return;

    // Only warn once per attack instance
    if (isImminent && !warnedAttacksRef.current.has(nextAttack.id)) {
      warnedAttacksRef.current.add(nextAttack.id);
      onAttackWarning(nextAttack);
    }

    // Clear warnings for attacks that are no longer in the cycle
    const currentAttackIds = new Set(attackCycle.map((a) => a.id));
    warnedAttacksRef.current.forEach((id) => {
      if (!currentAttackIds.has(id)) {
        warnedAttacksRef.current.delete(id);
      }
    });
  }, [nextAttack, isImminent, onAttackWarning, attackCycle]);

  // Phase progress
  const phaseProgress = (currentPhase.number / totalPhases) * 100;

  if (compact) {
    return (
      <div
        className={className}
        style={{
          display: "flex",
          alignItems: "center",
          gap: theme.spacing.sm,
          padding: theme.spacing.xs,
          backgroundColor: theme.colors.background.glass,
          borderRadius: theme.borderRadius.md,
          border: `1px solid ${theme.colors.border.default}`,
          ...style,
        }}
      >
        {/* Phase indicator */}
        <div
          style={{
            fontSize: theme.typography.fontSize.xs,
            color: theme.colors.text.secondary,
          }}
        >
          P{currentPhase.number}/{totalPhases}
        </div>

        {/* Divider */}
        <div
          style={{
            width: 1,
            height: 16,
            backgroundColor: theme.colors.border.default,
          }}
        />

        {/* Next attack */}
        {nextAttack && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              animation:
                isImminent && !reducedMotion
                  ? "boss-attack-warning 0.5s ease-in-out infinite"
                  : undefined,
            }}
          >
            <span style={{ fontSize: 14 }}>{nextAttack.icon}</span>
            <span
              style={{
                fontSize: theme.typography.fontSize.sm,
                fontWeight: theme.typography.fontWeight.semibold,
                color: isImminent
                  ? theme.colors.state.danger
                  : theme.colors.text.primary,
              }}
            >
              {nextAttack.timeUntil}s
            </span>
          </div>
        )}

        {/* Vulnerability indicator */}
        {!isVulnerable && (
          <div
            style={{
              fontSize: 12,
              color: theme.colors.state.warning,
            }}
          >
            🛡️
          </div>
        )}
      </div>
    );
  }

  // Full version
  return (
    <div
      className={className}
      style={{
        padding: theme.spacing.sm,
        backgroundColor: theme.colors.background.glass,
        borderRadius: theme.borderRadius.lg,
        border: `1px solid ${theme.colors.border.decorative}`,
        minWidth: 200,
        ...style,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: theme.spacing.sm,
        }}
      >
        <span
          style={{
            fontSize: theme.typography.fontSize.sm,
            fontWeight: theme.typography.fontWeight.semibold,
            color: theme.colors.text.primary,
          }}
        >
          {bossName}
        </span>
        {!isVulnerable && (
          <span
            style={{
              fontSize: theme.typography.fontSize.xs,
              color: theme.colors.state.warning,
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            🛡️ Immune
          </span>
        )}
      </div>

      {/* Phase bar */}
      <div style={{ marginBottom: theme.spacing.sm }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginBottom: 4,
          }}
        >
          <span
            style={{
              fontSize: theme.typography.fontSize.xs,
              color: theme.colors.text.secondary,
            }}
          >
            {currentPhase.name}
          </span>
          <span
            style={{
              fontSize: theme.typography.fontSize.xs,
              color: theme.colors.text.muted,
            }}
          >
            Phase {currentPhase.number}/{totalPhases}
          </span>
        </div>
        <div
          style={{
            height: 4,
            backgroundColor: theme.colors.background.tertiary,
            borderRadius: 2,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${phaseProgress}%`,
              height: "100%",
              backgroundColor: theme.colors.accent.primary,
              transition: reducedMotion ? "none" : "width 0.3s ease",
            }}
          />
        </div>
        {currentPhase.healthRange && (
          <div
            style={{
              fontSize: theme.typography.fontSize.xs,
              color: theme.colors.text.muted,
              marginTop: 2,
            }}
          >
            HP: {currentPhase.healthRange}
          </div>
        )}
      </div>

      {/* Attack cycle */}
      <div>
        <div
          style={{
            fontSize: theme.typography.fontSize.xs,
            color: theme.colors.text.secondary,
            marginBottom: 4,
            textTransform: "uppercase",
            letterSpacing: "0.5px",
          }}
        >
          Attacks
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          {attackCycle.slice(0, 3).map((attack, index) => {
            const isNext = index === 0;
            const isUrgent = isNext && attack.timeUntil <= 3;

            return (
              <div
                key={attack.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: theme.spacing.xs,
                  padding: 4,
                  backgroundColor: isNext
                    ? isUrgent
                      ? "rgba(239, 68, 68, 0.2)"
                      : "rgba(255, 153, 0, 0.1)"
                    : "transparent",
                  borderRadius: theme.borderRadius.sm,
                  border: isNext
                    ? `1px solid ${isUrgent ? theme.colors.state.danger : theme.colors.accent.primary}`
                    : "1px solid transparent",
                  animation:
                    isUrgent && !reducedMotion
                      ? "boss-attack-warning 0.5s ease-in-out infinite"
                      : undefined,
                }}
              >
                <span style={{ fontSize: 14 }}>{attack.icon}</span>
                <span
                  style={{
                    flex: 1,
                    fontSize: theme.typography.fontSize.xs,
                    color: isNext
                      ? theme.colors.text.primary
                      : theme.colors.text.secondary,
                  }}
                >
                  {attack.name}
                </span>
                <span
                  style={{
                    fontSize: theme.typography.fontSize.xs,
                    fontWeight: isNext
                      ? theme.typography.fontWeight.semibold
                      : theme.typography.fontWeight.normal,
                    color: isUrgent
                      ? theme.colors.state.danger
                      : isNext
                        ? theme.colors.accent.primary
                        : theme.colors.text.muted,
                  }}
                >
                  {attack.timeUntil}s
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Time to mechanic if different from attack cycle */}
      {timeToMechanic !== undefined && (
        <div
          style={{
            marginTop: theme.spacing.sm,
            paddingTop: theme.spacing.sm,
            borderTop: `1px solid ${theme.colors.border.default}`,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span
            style={{
              fontSize: theme.typography.fontSize.xs,
              color: theme.colors.text.secondary,
            }}
          >
            Special Mechanic
          </span>
          <span
            style={{
              fontSize: theme.typography.fontSize.sm,
              fontWeight: theme.typography.fontWeight.semibold,
              color:
                timeToMechanic <= 5
                  ? theme.colors.state.danger
                  : theme.colors.text.primary,
            }}
          >
            {timeToMechanic}s
          </span>
        </div>
      )}
    </div>
  );
}

// Add CSS keyframes for attack warning
if (typeof document !== "undefined") {
  const style = document.createElement("style");
  style.textContent = `
    @keyframes boss-attack-warning {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.6; }
    }
  `;
  document.head.appendChild(style);
}
