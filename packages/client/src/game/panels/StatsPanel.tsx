/**
 * Stats Panel - Complete Character Statistics Display
 *
 * Displays ALL game skills in a compact, organized layout:
 * - Combat Skills: Attack, Strength, Defense, Constitution, Ranged, Magic, Prayer
 * - Gathering Skills: Woodcutting, Mining, Fishing
 * - Production Skills: Cooking, Smithing, Firemaking
 *
 * Design inspired by OSRS equipment stats and RuneLite hover tooltips.
 * Uses design tokens from COLORS constant for consistency.
 */

import React, { useMemo, useState } from "react";
import { useThemeStore } from "hs-kit";
import type { PlayerEquipmentItems, PlayerStats } from "../../types";
import { skillColors } from "../../constants";

// ============================================================================
// COMPACT SVG ICONS - 12px for skill grid
// ============================================================================

const Icons = {
  // Combat Skills
  attack: (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
    >
      <path d="M14.5 17.5L3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4" />
    </svg>
  ),
  strength: (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
    >
      <path d="M6 4v6a6 6 0 0 0 12 0V4M4 2h4M16 2h4M12 16v6M8 22h8" />
    </svg>
  ),
  defense: (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  ),
  constitution: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  ),
  ranged: (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
    >
      <path d="M5 12h14M12 5l7 7-7 7" />
    </svg>
  ),
  magic: (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
    >
      <path d="M12 2L9 9l-7 3 7 3 3 7 3-7 7-3-7-3-3-7z" />
    </svg>
  ),
  prayer: (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
    >
      <path d="M12 2v8M12 22v-8M4.93 4.93l5.66 5.66M19.07 19.07l-5.66-5.66M2 12h8M22 12h-8M4.93 19.07l5.66-5.66M19.07 4.93l-5.66 5.66" />
    </svg>
  ),
  // Gathering Skills
  woodcutting: (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
    >
      <path d="M14 12l-4-4 8-8 4 4-8 8zM6 18l-4 4 4 4 4-4-4-4z" />
    </svg>
  ),
  mining: (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
    >
      <path d="M14.5 3L3 14.5l6.5 6.5L21 9.5 14.5 3zM5 16l-2 6 6-2" />
    </svg>
  ),
  fishing: (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
    >
      <path d="M6.5 12c.94-3.46 4.94-6 8.5-6 2.89 0 5.18 1.44 6 3.57M8.5 4c.5 1.5 1.5 2.5 3 3M6 12s2 3 6 3 6-3 6-3M12 18v3" />
    </svg>
  ),
  // Production Skills
  cooking: (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
    >
      <path d="M12 21a9 9 0 0 0 9-9H3a9 9 0 0 0 9 9zM3 12V3h18v9" />
    </svg>
  ),
  smithing: (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
    >
      <path d="M3 21h18M3 3v18M21 3v18M9 9h6M9 15h6" />
    </svg>
  ),
  firemaking: (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
    >
      <path d="M12 22c-4.97 0-9-4.03-9-9 0-4.03 4.03-9 9-12 0 5.52 9 5.52 9 12 0 4.97-4.03 9-9 9z" />
    </svg>
  ),
  // Misc
  weight: (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
    >
      <circle cx="12" cy="5" r="3" />
      <path d="M6.5 8a2 2 0 0 0-1.9 1.46L2.1 18.5A2 2 0 0 0 4 21h16a2 2 0 0 0 1.9-2.54L19.4 9.5A2 2 0 0 0 17.5 8Z" />
    </svg>
  ),
};

// ============================================================================
// SKILL CELL - Compact skill display for 4-column grid
// ============================================================================

interface SkillCellProps {
  icon: React.ReactNode;
  label: string;
  level: number;
  color: string;
  isMaxed?: boolean;
}

const SkillCell = ({ icon, label, level, color, isMaxed }: SkillCellProps) => {
  const theme = useThemeStore((s) => s.theme);
  const [hovered, setHovered] = useState(false);

  return (
    <div
      className="flex items-center gap-1 py-1 px-1.5 rounded transition-colors"
      style={{
        background: hovered ? theme.colors.slot.hover : "transparent",
        cursor: "default",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={`${label}: Level ${level}`}
    >
      <span style={{ color, display: "flex", flexShrink: 0 }}>{icon}</span>
      <span
        style={{
          fontSize: theme.typography.fontSize.xs,
          fontWeight: theme.typography.fontWeight.semibold,
          color: isMaxed
            ? theme.colors.state.success
            : theme.colors.accent.primary,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {level}
      </span>
    </div>
  );
};

// ============================================================================
// SECTION HEADER - Category label
// ============================================================================

interface SectionHeaderProps {
  label: string;
}

const SectionHeader = ({ label }: SectionHeaderProps) => {
  const theme = useThemeStore((s) => s.theme);
  return (
    <div
      style={{
        fontSize: theme.typography.fontSize.xs,
        fontWeight: theme.typography.fontWeight.semibold,
        color: theme.colors.text.muted,
        textTransform: "uppercase",
        letterSpacing: "0.5px",
        marginBottom: "2px",
        paddingLeft: "2px",
      }}
    >
      {label}
    </div>
  );
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

interface StatsPanelProps {
  stats?: PlayerStats | null;
  equipment?: PlayerEquipmentItems | null;
  /** Show character silhouette viewer on the right (for modal view) */
  showSilhouette?: boolean;
}

// Character silhouette for stats modal view
function CharacterSilhouette({ color }: { color: string }) {
  return (
    <svg
      viewBox="0 0 80 120"
      fill={color}
      style={{ width: "100%", height: "100%" }}
    >
      {/* Head */}
      <circle cx="40" cy="14" r="10" />
      {/* Neck */}
      <rect x="36" y="24" width="8" height="6" rx="1" />
      {/* Torso */}
      <path d="M22 30 L58 30 L54 70 L26 70 Z" />
      {/* Arms */}
      <rect x="10" y="32" width="12" height="32" rx="4" />
      <rect x="58" y="32" width="12" height="32" rx="4" />
      {/* Legs */}
      <rect x="27" y="70" width="11" height="38" rx="3" />
      <rect x="42" y="70" width="11" height="38" rx="3" />
    </svg>
  );
}

export function StatsPanel({
  stats,
  equipment,
  showSilhouette = false,
}: StatsPanelProps) {
  const theme = useThemeStore((s) => s.theme);
  const skills = stats?.skills;

  // Combat level calculation (OSRS formula)
  const combatLevel = useMemo(() => {
    if (!skills) return 1;
    const base =
      0.25 *
      ((skills.defense?.level || 1) + (skills.constitution?.level || 10));
    const melee =
      0.325 * ((skills.attack?.level || 1) + (skills.strength?.level || 1));
    return Math.floor(base + melee);
  }, [skills]);

  // Total level calculation
  const totalLevel = useMemo(() => {
    if (!skills) return 12; // Default total for all skills at level 1
    return (
      (skills.attack?.level || 1) +
      (skills.strength?.level || 1) +
      (skills.defense?.level || 1) +
      (skills.constitution?.level || 10) +
      (skills.ranged?.level || 1) +
      (skills.magic?.level || 1) +
      (skills.prayer?.level || 1) +
      (skills.woodcutting?.level || 1) +
      (skills.mining?.level || 1) +
      (skills.fishing?.level || 1) +
      (skills.cooking?.level || 1) +
      (skills.smithing?.level || 1) +
      (skills.firemaking?.level || 1)
    );
  }, [skills]);

  // Health data
  const health = {
    current: stats?.health?.current ?? 10,
    max: stats?.health?.max ?? 10,
  };
  const healthPercent = Math.round((health.current / health.max) * 100);
  const healthColor =
    healthPercent > 60
      ? theme.colors.state.success
      : healthPercent > 30
        ? theme.colors.state.warning
        : theme.colors.state.danger;

  // Prayer points (from stats or default)
  const prayerPoints = stats?.prayerPoints ?? { current: 1, max: 1 };
  const prayerPercent = Math.round(
    (prayerPoints.current / prayerPoints.max) * 100,
  );

  // Equipment weight calculation
  const totalWeight = useMemo(() => {
    if (!equipment) return 0;
    const slots = [
      equipment.helmet,
      equipment.body,
      equipment.legs,
      equipment.weapon,
      equipment.shield,
      equipment.boots,
      equipment.gloves,
      equipment.cape,
      equipment.amulet,
      equipment.ring,
    ];
    return slots.reduce(
      (sum, item) => sum + (item?.weight || 0) * (item?.quantity || 1),
      0,
    );
  }, [equipment]);

  // Main stats content (can be wrapped with silhouette if needed)
  const statsContent = (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        padding: showSilhouette ? "0" : "6px",
        height: "100%",
        overflow: "hidden",
      }}
    >
      {/* Header Card - Level, Combat, Health, Prayer */}
      <div
        style={{
          padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
          background: theme.colors.background.tertiary,
          borderRadius: `${theme.borderRadius.md}px`,
          border: `1px solid ${theme.colors.border.default}`,
        }}
      >
        {/* Level & Combat Row */}
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-2">
            <span
              style={{
                fontSize: theme.typography.fontSize.xs,
                color: theme.colors.text.muted,
              }}
            >
              Total{" "}
              <span
                style={{
                  color: theme.colors.accent.primary,
                  fontWeight: theme.typography.fontWeight.bold,
                  fontSize: theme.typography.fontSize.sm,
                }}
              >
                {totalLevel}
              </span>
            </span>
            <span
              style={{
                width: "1px",
                height: "10px",
                background: theme.colors.border.default,
              }}
            />
            <span
              style={{
                fontSize: theme.typography.fontSize.xs,
                color: theme.colors.text.muted,
              }}
            >
              CB{" "}
              <span
                style={{
                  color: theme.colors.state.danger,
                  fontWeight: theme.typography.fontWeight.bold,
                  fontSize: theme.typography.fontSize.sm,
                }}
              >
                {combatLevel}
              </span>
            </span>
          </div>
          {/* Weight */}
          <div className="flex items-center gap-1">
            <span style={{ color: theme.colors.text.muted, display: "flex" }}>
              {Icons.weight}
            </span>
            <span
              style={{
                fontSize: theme.typography.fontSize.xs,
                color:
                  totalWeight > 30
                    ? theme.colors.state.danger
                    : theme.colors.text.muted,
                fontWeight: theme.typography.fontWeight.medium,
              }}
            >
              {totalWeight.toFixed(1)}kg
            </span>
          </div>
        </div>

        {/* Health Bar */}
        <div className="flex items-center gap-1.5 mb-1">
          <span style={{ color: theme.colors.state.danger, display: "flex" }}>
            {Icons.constitution}
          </span>
          <div className="flex-1">
            <div
              style={{
                height: "5px",
                background: theme.colors.background.overlay,
                borderRadius: `${theme.borderRadius.sm}px`,
                overflow: "hidden",
                border: `1px solid ${theme.colors.border.default}`,
              }}
            >
              <div
                style={{
                  width: `${healthPercent}%`,
                  height: "100%",
                  background: healthColor,
                  borderRadius: "1px",
                  transition: theme.transitions.normal,
                }}
              />
            </div>
          </div>
          <span
            style={{
              fontSize: theme.typography.fontSize.xs,
              color: healthColor,
              fontWeight: theme.typography.fontWeight.semibold,
              minWidth: "38px",
              textAlign: "right",
            }}
          >
            {health.current}/{health.max}
          </span>
        </div>

        {/* Prayer Bar */}
        <div className="flex items-center gap-1.5">
          <span style={{ color: theme.colors.state.info, display: "flex" }}>
            {Icons.prayer}
          </span>
          <div className="flex-1">
            <div
              style={{
                height: "5px",
                background: theme.colors.background.overlay,
                borderRadius: `${theme.borderRadius.sm}px`,
                overflow: "hidden",
                border: `1px solid ${theme.colors.border.default}`,
              }}
            >
              <div
                style={{
                  width: `${prayerPercent}%`,
                  height: "100%",
                  background: theme.colors.state.info,
                  borderRadius: "1px",
                  transition: theme.transitions.normal,
                }}
              />
            </div>
          </div>
          <span
            style={{
              fontSize: theme.typography.fontSize.xs,
              color: theme.colors.state.info,
              fontWeight: theme.typography.fontWeight.semibold,
              minWidth: "38px",
              textAlign: "right",
            }}
          >
            {prayerPoints.current}/{prayerPoints.max}
          </span>
        </div>
      </div>

      {/* Skills Grid */}
      <div
        className="flex-1 overflow-y-auto noscrollbar"
        style={{
          background: theme.colors.background.tertiary,
          borderRadius: `${theme.borderRadius.md}px`,
          border: `1px solid ${theme.colors.border.default}`,
          padding: `${theme.spacing.xs}px ${theme.spacing.xs}px`,
        }}
      >
        {/* Combat Skills */}
        <SectionHeader label="Combat" />
        <div className="grid grid-cols-4 gap-x-1">
          <SkillCell
            icon={Icons.attack}
            label="Attack"
            level={skills?.attack?.level || 1}
            color={theme.colors.state.danger}
            isMaxed={(skills?.attack?.level || 1) >= 99}
          />
          <SkillCell
            icon={Icons.strength}
            label="Strength"
            level={skills?.strength?.level || 1}
            color={theme.colors.state.warning}
            isMaxed={(skills?.strength?.level || 1) >= 99}
          />
          <SkillCell
            icon={Icons.defense}
            label="Defense"
            level={skills?.defense?.level || 1}
            color={theme.colors.state.info}
            isMaxed={(skills?.defense?.level || 1) >= 99}
          />
          <SkillCell
            icon={Icons.constitution}
            label="Constitution"
            level={skills?.constitution?.level || 10}
            color={theme.colors.state.danger}
            isMaxed={(skills?.constitution?.level || 10) >= 99}
          />
          <SkillCell
            icon={Icons.ranged}
            label="Ranged"
            level={skills?.ranged?.level || 1}
            color={skillColors.ranged}
            isMaxed={(skills?.ranged?.level || 1) >= 99}
          />
          <SkillCell
            icon={Icons.magic}
            label="Magic"
            level={skills?.magic?.level || 1}
            color={theme.colors.status.prayer}
            isMaxed={(skills?.magic?.level || 1) >= 99}
          />
          <SkillCell
            icon={Icons.prayer}
            label="Prayer"
            level={skills?.prayer?.level || 1}
            color={theme.colors.status.prayer}
            isMaxed={(skills?.prayer?.level || 1) >= 99}
          />
        </div>

        {/* Divider */}
        <div
          style={{
            background: `linear-gradient(90deg, transparent, ${theme.colors.border.default} 50%, transparent)`,
            height: "1px",
            margin: `${theme.spacing.xs}px 0`,
          }}
        />

        {/* Gathering Skills */}
        <SectionHeader label="Gathering" />
        <div className="grid grid-cols-4 gap-x-1">
          <SkillCell
            icon={Icons.woodcutting}
            label="Woodcutting"
            level={skills?.woodcutting?.level || 1}
            color={skillColors.woodcutting}
            isMaxed={(skills?.woodcutting?.level || 1) >= 99}
          />
          <SkillCell
            icon={Icons.mining}
            label="Mining"
            level={skills?.mining?.level || 1}
            color={skillColors.mining}
            isMaxed={(skills?.mining?.level || 1) >= 99}
          />
          <SkillCell
            icon={Icons.fishing}
            label="Fishing"
            level={skills?.fishing?.level || 1}
            color={skillColors.fishing}
            isMaxed={(skills?.fishing?.level || 1) >= 99}
          />
        </div>

        {/* Divider */}
        <div
          style={{
            background: `linear-gradient(90deg, transparent, ${theme.colors.border.default} 50%, transparent)`,
            height: "1px",
            margin: `${theme.spacing.xs}px 0`,
          }}
        />

        {/* Production Skills */}
        <SectionHeader label="Production" />
        <div className="grid grid-cols-4 gap-x-1">
          <SkillCell
            icon={Icons.cooking}
            label="Cooking"
            level={skills?.cooking?.level || 1}
            color={skillColors.cooking}
            isMaxed={(skills?.cooking?.level || 1) >= 99}
          />
          <SkillCell
            icon={Icons.smithing}
            label="Smithing"
            level={skills?.smithing?.level || 1}
            color={theme.colors.text.muted}
            isMaxed={(skills?.smithing?.level || 1) >= 99}
          />
          <SkillCell
            icon={Icons.firemaking}
            label="Firemaking"
            level={skills?.firemaking?.level || 1}
            color={skillColors.firemaking}
            isMaxed={(skills?.firemaking?.level || 1) >= 99}
          />
        </div>
      </div>
    </div>
  );

  // If showSilhouette is true, wrap in a horizontal layout with silhouette
  if (showSilhouette) {
    return (
      <div
        style={{
          display: "flex",
          gap: "12px",
          padding: "6px",
          height: "100%",
        }}
      >
        {/* Stats section */}
        <div style={{ flex: "1 1 auto", minWidth: 0 }}>{statsContent}</div>

        {/* Silhouette viewer */}
        <div
          style={{
            flex: "0 0 140px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            background: theme.colors.background.tertiary,
            borderRadius: `${theme.borderRadius.md}px`,
            border: `1px solid ${theme.colors.border.default}`,
            padding: "12px",
          }}
        >
          <div
            style={{
              width: "100%",
              height: "auto",
              maxHeight: 200,
              opacity: 0.6,
            }}
          >
            <CharacterSilhouette color={theme.colors.accent.primary} />
          </div>
          <div
            style={{
              marginTop: 8,
              fontSize: theme.typography.fontSize.xs,
              color: theme.colors.accent.primary,
              textAlign: "center",
              fontWeight: theme.typography.fontWeight.medium,
              opacity: 0.8,
            }}
          >
            Character
          </div>
        </div>
      </div>
    );
  }

  return statsContent;
}
