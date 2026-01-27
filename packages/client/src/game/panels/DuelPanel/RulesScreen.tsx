/**
 * Duel Rules Screen
 *
 * Screen where both players negotiate duel rules and equipment restrictions.
 * Both players must accept for the duel to proceed to the Stakes screen.
 *
 * OSRS-style features:
 * - 10 rule toggles (combat restrictions)
 * - 11 equipment slot toggles
 * - Accept button that shows opponent's acceptance status
 * - Rules reset when either player modifies
 */

import { useCallback, useMemo, type CSSProperties } from "react";
import { useThemeStore, type Theme } from "@/ui";
import type { DuelRules, EquipmentSlot } from "@hyperscape/shared";

// ============================================================================
// Types
// ============================================================================

interface EquipmentRestrictions {
  head: boolean;
  cape: boolean;
  amulet: boolean;
  weapon: boolean;
  body: boolean;
  shield: boolean;
  legs: boolean;
  gloves: boolean;
  boots: boolean;
  ring: boolean;
  ammo: boolean;
}

interface RulesScreenProps {
  rules: DuelRules;
  equipmentRestrictions: EquipmentRestrictions;
  myAccepted: boolean;
  opponentAccepted: boolean;
  opponentName: string;
  onToggleRule: (rule: keyof DuelRules) => void;
  onToggleEquipment: (slot: EquipmentSlot) => void;
  onAccept: () => void;
  onCancel: () => void;
}

// ============================================================================
// Rule Definitions
// ============================================================================

const RULE_LABELS: Record<
  keyof DuelRules,
  { label: string; description: string }
> = {
  noRanged: { label: "No Ranged", description: "Cannot use ranged attacks" },
  noMelee: { label: "No Melee", description: "Cannot use melee attacks" },
  noMagic: { label: "No Magic", description: "Cannot use magic attacks" },
  noSpecialAttack: {
    label: "No Special Attack",
    description: "Cannot use special attacks",
  },
  noPrayer: { label: "No Prayer", description: "Prayer points drained" },
  noPotions: { label: "No Potions", description: "Cannot drink potions" },
  noFood: { label: "No Food", description: "Cannot eat food" },
  noForfeit: { label: "No Forfeit", description: "Fight to the death" },
  noMovement: { label: "No Movement", description: "Frozen in place" },
  funWeapons: { label: "Fun Weapons", description: "Boxing gloves only" },
};

const EQUIPMENT_LABELS: Record<EquipmentSlot, string> = {
  head: "Head",
  cape: "Cape",
  amulet: "Amulet",
  weapon: "Weapon",
  body: "Body",
  shield: "Shield",
  legs: "Legs",
  gloves: "Gloves",
  boots: "Boots",
  ring: "Ring",
  ammo: "Ammo",
};

// ============================================================================
// Memoized Styles Hook
// ============================================================================

function useRulesScreenStyles(theme: Theme, myAccepted: boolean) {
  return useMemo(() => {
    const containerStyle: CSSProperties = {
      display: "flex",
      flexDirection: "column",
      gap: theme.spacing.md,
      height: "100%",
    };

    const sectionStyle: CSSProperties = {
      background: theme.colors.background.tertiary,
      border: `1px solid ${theme.colors.border.default}`,
      borderRadius: theme.borderRadius.md,
      padding: theme.spacing.md,
    };

    const sectionTitleStyle: CSSProperties = {
      fontSize: theme.typography.fontSize.sm,
      fontWeight: theme.typography.fontWeight.bold,
      color: theme.colors.text.primary,
      marginBottom: theme.spacing.sm,
      borderBottom: `1px solid ${theme.colors.border.default}`,
      paddingBottom: theme.spacing.xs,
    };

    const gridStyle: CSSProperties = {
      display: "grid",
      gridTemplateColumns: "repeat(2, 1fr)",
      gap: theme.spacing.xs,
    };

    const acceptanceStyle: CSSProperties = {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      padding: theme.spacing.sm,
      background: theme.colors.background.secondary,
      borderRadius: theme.borderRadius.sm,
      fontSize: theme.typography.fontSize.sm,
    };

    const buttonContainerStyle: CSSProperties = {
      display: "flex",
      gap: theme.spacing.md,
      marginTop: "auto",
    };

    const baseButtonStyle: CSSProperties = {
      flex: 1,
      padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
      borderRadius: theme.borderRadius.md,
      fontSize: theme.typography.fontSize.sm,
      fontWeight: theme.typography.fontWeight.bold,
      cursor: "pointer",
      transition: "all 0.2s ease",
      textShadow: "0 1px 2px rgba(0,0,0,0.5)",
    };

    const acceptButtonStyle: CSSProperties = {
      ...baseButtonStyle,
      background: myAccepted
        ? `${theme.colors.state.success}88`
        : theme.colors.state.success,
      color: "#fff",
      border: `1px solid ${theme.colors.state.success}`,
      opacity: myAccepted ? 0.7 : 1,
    };

    const cancelButtonStyle: CSSProperties = {
      ...baseButtonStyle,
      background: theme.colors.state.danger,
      color: "#fff",
      border: `1px solid ${theme.colors.state.danger}`,
    };

    return {
      containerStyle,
      sectionStyle,
      sectionTitleStyle,
      gridStyle,
      acceptanceStyle,
      buttonContainerStyle,
      acceptButtonStyle,
      cancelButtonStyle,
    };
  }, [theme, myAccepted]);
}

/**
 * Get checkbox style based on checked state (called per item, but simple object)
 */
function getCheckboxStyle(theme: Theme, checked: boolean): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: theme.spacing.xs,
    padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
    background: checked
      ? `${theme.colors.accent.primary}33`
      : theme.colors.background.secondary,
    border: `1px solid ${checked ? theme.colors.accent.primary : theme.colors.border.default}`,
    borderRadius: theme.borderRadius.sm,
    cursor: "pointer",
    fontSize: theme.typography.fontSize.xs,
    color: checked ? theme.colors.accent.primary : theme.colors.text.secondary,
    transition: "all 0.15s ease",
  };
}

/**
 * Get status dot style based on accepted state
 */
function getStatusDotStyle(theme: Theme, accepted: boolean): CSSProperties {
  return {
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: accepted
      ? theme.colors.state.success
      : theme.colors.state.danger,
    marginRight: theme.spacing.xs,
    display: "inline-block",
  };
}

// ============================================================================
// Component
// ============================================================================

export function RulesScreen({
  rules,
  equipmentRestrictions,
  myAccepted,
  opponentAccepted,
  opponentName,
  onToggleRule,
  onToggleEquipment,
  onAccept,
  onCancel,
}: RulesScreenProps) {
  const theme = useThemeStore((s) => s.theme);

  // Memoized styles - only recalculated when theme or myAccepted changes
  const styles = useRulesScreenStyles(theme, myAccepted);

  const handleRuleToggle = useCallback(
    (rule: keyof DuelRules) => {
      onToggleRule(rule);
    },
    [onToggleRule],
  );

  const handleEquipmentToggle = useCallback(
    (slot: EquipmentSlot) => {
      onToggleEquipment(slot);
    },
    [onToggleEquipment],
  );

  return (
    <div style={styles.containerStyle}>
      {/* Combat Rules */}
      <div style={styles.sectionStyle}>
        <div style={styles.sectionTitleStyle}>Combat Rules</div>
        <div style={styles.gridStyle}>
          {(Object.keys(RULE_LABELS) as Array<keyof DuelRules>).map((rule) => (
            <div
              key={rule}
              style={getCheckboxStyle(theme, rules[rule])}
              onClick={() => handleRuleToggle(rule)}
              title={RULE_LABELS[rule].description}
            >
              <input
                type="checkbox"
                checked={rules[rule]}
                onChange={() => {}}
                style={{ cursor: "pointer" }}
              />
              <span>{RULE_LABELS[rule].label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Equipment Restrictions */}
      <div style={styles.sectionStyle}>
        <div style={styles.sectionTitleStyle}>Disabled Equipment</div>
        <div style={styles.gridStyle}>
          {(Object.keys(EQUIPMENT_LABELS) as EquipmentSlot[]).map((slot) => (
            <div
              key={slot}
              style={getCheckboxStyle(theme, equipmentRestrictions[slot])}
              onClick={() => handleEquipmentToggle(slot)}
            >
              <input
                type="checkbox"
                checked={equipmentRestrictions[slot]}
                onChange={() => {}}
                style={{ cursor: "pointer" }}
              />
              <span>No {EQUIPMENT_LABELS[slot]}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Acceptance Status */}
      <div style={styles.sectionStyle}>
        <div style={styles.acceptanceStyle}>
          <span>
            <span style={getStatusDotStyle(theme, myAccepted)} />
            You: {myAccepted ? "Accepted" : "Not accepted"}
          </span>
          <span>
            <span style={getStatusDotStyle(theme, opponentAccepted)} />
            {opponentName}: {opponentAccepted ? "Accepted" : "Not accepted"}
          </span>
        </div>
      </div>

      {/* Buttons */}
      <div style={styles.buttonContainerStyle}>
        <button
          onClick={onAccept}
          style={styles.acceptButtonStyle}
          disabled={myAccepted}
        >
          {myAccepted ? "Waiting..." : "Accept Rules"}
        </button>
        <button onClick={onCancel} style={styles.cancelButtonStyle}>
          Cancel
        </button>
      </div>
    </div>
  );
}
