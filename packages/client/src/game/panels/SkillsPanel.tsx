/**
 * Skills Panel
 * Hyperscape-themed skills interface (Prayer is now in separate PrayerPanel)
 * Uses project theme colors (gold #f2d08a, brown borders)
 * Supports drag-drop to action bar
 */

import React, { useState, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  calculateCursorTooltipPosition,
  useThemeStore,
  useMobileLayout,
  useDraggable,
} from "hs-kit";
import { zIndex, MOBILE_SKILLS } from "../../constants";
import { useTooltipSize } from "../../hooks";
import type { PlayerStats, Skills } from "../../types";

interface SkillsPanelProps {
  stats: PlayerStats | null;
}

interface Skill {
  key: string;
  label: string;
  icon: string;
  level: number;
  xp: number;
}

function calculateXPForLevel(level: number): number {
  let total = 0;
  for (let i = 1; i < level; i++) {
    total += Math.floor(i + 300 * Math.pow(2, i / 7));
  }
  return Math.floor(total / 4);
}

/** Calculate combat level from skill stats */
function calculateCombatLevel(stats: Partial<Skills>): number {
  const attack = stats.attack?.level ?? 1;
  const strength = stats.strength?.level ?? 1;
  const defense = stats.defense?.level ?? 1;
  const constitution = stats.constitution?.level ?? 10;
  return Math.floor(
    0.25 * (defense + constitution) + 0.325 * (attack + strength),
  );
}

/** Draggable skill card component for action bar drag-drop */
function DraggableSkillCard({
  skill,
  isHovered,
  isMobile,
  onMouseEnter,
  onMouseMove,
  onMouseLeave,
}: {
  skill: Skill;
  isHovered: boolean;
  isMobile: boolean;
  onMouseEnter: (e: React.MouseEvent) => void;
  onMouseMove: (e: React.MouseEvent) => void;
  onMouseLeave: () => void;
}) {
  const theme = useThemeStore((s) => s.theme);

  // Make skill draggable for action bar
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `skill-${skill.key}`,
    data: {
      skill: {
        id: skill.key,
        name: skill.label,
        icon: skill.icon,
        level: skill.level,
      },
      source: "skill",
    },
  });

  // Memoize card style to prevent recreation on every render
  const cardStyle = useMemo(
    (): React.CSSProperties => ({
      background: isHovered
        ? theme.colors.slot.hover
        : theme.colors.slot.filled,
      border: `1px solid ${isHovered ? theme.colors.border.hover : theme.colors.border.default}`,
      borderRadius: "6px",
      padding: isMobile ? "6px 8px" : "8px 10px",
      minHeight: isMobile ? MOBILE_SKILLS.cardHeight : 44,
      cursor: isDragging ? "grabbing" : "grab",
      transition: "all 0.15s ease",
      display: "flex",
      alignItems: "center",
      flexDirection: "row" as const,
      touchAction: "none",
      opacity: isDragging ? 0.5 : 1,
    }),
    [isHovered, isDragging, theme, isMobile],
  );

  return (
    <div
      ref={setNodeRef}
      className="relative"
      style={cardStyle}
      onMouseEnter={onMouseEnter}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      {...attributes}
      {...listeners}
    >
      {/* Unified layout: Icon + Level inline (same for mobile and desktop) */}
      <div className="flex items-center gap-1.5 w-full">
        <span
          style={{
            fontSize: "15px",
            filter: "drop-shadow(1px 1px 1px rgba(0,0,0,0.5))",
            lineHeight: 1,
          }}
        >
          {skill.icon}
        </span>
        {/* RuneScape-style slanted level display: current↗/↘base */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            position: "relative",
            height: "16px",
          }}
        >
          {/* Current level - shifted up */}
          <span
            style={{
              fontSize: "11px",
              fontWeight: 700,
              color:
                skill.level >= 99
                  ? theme.colors.state.success
                  : theme.colors.text.accent,
              lineHeight: 1,
              position: "relative",
              top: "-3px",
              textShadow: "1px 1px 1px rgba(0,0,0,0.5)",
            }}
          >
            {skill.level}
          </span>
          {/* Slanted separator */}
          <span
            style={{
              fontSize: "10px",
              fontWeight: 400,
              color: theme.colors.text.disabled,
              lineHeight: 1,
              margin: "0 1px",
              transform: "rotate(-20deg)",
              display: "inline-block",
            }}
          >
            /
          </span>
          {/* Base level - shifted down */}
          <span
            style={{
              fontSize: "11px",
              fontWeight: 700,
              color:
                skill.level >= 99
                  ? theme.colors.state.success
                  : theme.colors.text.accent,
              lineHeight: 1,
              position: "relative",
              top: "3px",
              textShadow: "1px 1px 1px rgba(0,0,0,0.5)",
            }}
          >
            {skill.level}
          </span>
        </div>
      </div>
    </div>
  );
}

export function SkillsPanel({ stats }: SkillsPanelProps) {
  const theme = useThemeStore((s) => s.theme);
  const { shouldUseMobileUI } = useMobileLayout();
  const [hoveredSkill, setHoveredSkill] = useState<Skill | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const skillTooltipRef = useRef<HTMLDivElement>(null);

  const skillTooltipSize = useTooltipSize(hoveredSkill, skillTooltipRef, {
    width: 180,
    height: 90,
  });

  const s: Partial<Skills> = stats?.skills ?? {};

  // Build skills array from stats
  const skills: Skill[] = [
    {
      key: "attack",
      label: "Attack",
      icon: "⚔️",
      level: s?.attack?.level || 1,
      xp: s?.attack?.xp || 0,
    },
    {
      key: "strength",
      label: "Strength",
      icon: "💪",
      level: s?.strength?.level || 1,
      xp: s?.strength?.xp || 0,
    },
    {
      key: "defense",
      label: "Defence",
      icon: "🛡️",
      level: s?.defense?.level || 1,
      xp: s?.defense?.xp || 0,
    },
    {
      key: "constitution",
      label: "Constitution",
      icon: "❤️",
      level: s?.constitution?.level || 10,
      xp: s?.constitution?.xp || 0,
    },
    {
      key: "ranged",
      label: "Ranged",
      icon: "🏹",
      level: s?.ranged?.level || 1,
      xp: s?.ranged?.xp || 0,
    },
    {
      key: "magic",
      label: "Magic",
      icon: "✨",
      level: s?.magic?.level || 1,
      xp: s?.magic?.xp || 0,
    },
    {
      key: "fishing",
      label: "Fishing",
      icon: "🐟",
      level: s?.fishing?.level || 1,
      xp: s?.fishing?.xp || 0,
    },
    {
      key: "cooking",
      label: "Cooking",
      icon: "🍖",
      level: s?.cooking?.level || 1,
      xp: s?.cooking?.xp || 0,
    },
    {
      key: "woodcutting",
      label: "Woodcutting",
      icon: "🪓",
      level: s?.woodcutting?.level || 1,
      xp: s?.woodcutting?.xp || 0,
    },
    {
      key: "firemaking",
      label: "Firemaking",
      icon: "🔥",
      level: s?.firemaking?.level || 1,
      xp: s?.firemaking?.xp || 0,
    },
    {
      key: "mining",
      label: "Mining",
      icon: "⛏️",
      level: s?.mining?.level || 1,
      xp: s?.mining?.xp || 0,
    },
    {
      key: "smithing",
      label: "Smithing",
      icon: "🔨",
      level: s?.smithing?.level || 1,
      xp: s?.smithing?.xp || 0,
    },
  ];

  const totalLevel = skills.reduce((sum, skill) => sum + skill.level, 0);
  const combatLevel = calculateCombatLevel(s);

  return (
    <div
      className="flex flex-col h-full overflow-hidden"
      style={{ padding: "6px" }}
    >
      {/* Content */}
      <div
        className="flex flex-col flex-1 overflow-hidden"
        style={{
          background: theme.colors.background.secondary,
          border: `1px solid ${theme.colors.border.default}80`,
          borderRadius: "6px",
          padding: "8px",
        }}
      >
        {/* Skills Grid - Mobile: 2 columns with names, Desktop: 3 columns compact */}
        <div
          className="grid flex-1"
          style={{
            gridTemplateColumns: shouldUseMobileUI
              ? `repeat(${MOBILE_SKILLS.columns}, 1fr)`
              : "repeat(3, 1fr)",
            gap: shouldUseMobileUI ? `${MOBILE_SKILLS.gap}px` : "6px",
          }}
        >
          {skills.map((skill) => (
            <DraggableSkillCard
              key={skill.key}
              skill={skill}
              isHovered={hoveredSkill?.key === skill.key}
              isMobile={shouldUseMobileUI}
              onMouseEnter={(e) => {
                setHoveredSkill(skill);
                setMousePos({ x: e.clientX, y: e.clientY });
              }}
              onMouseMove={(e) => setMousePos({ x: e.clientX, y: e.clientY })}
              onMouseLeave={() => {
                setHoveredSkill(null);
              }}
            />
          ))}
        </div>

        {/* Total Level & Combat Level */}
        <div
          className="flex justify-between mt-2"
          style={{
            background: theme.colors.slot.filled,
            border: `1px solid ${theme.colors.border.default}80`,
            borderRadius: "4px",
            padding: "8px 10px",
            flexShrink: 0,
          }}
        >
          <div className="text-center flex-1">
            <div
              style={{
                fontSize: "9px",
                color: theme.colors.text.muted,
                textTransform: "uppercase",
                letterSpacing: "0.5px",
                marginBottom: "2px",
              }}
            >
              Total Level
            </div>
            <span
              style={{
                fontSize: "16px",
                fontWeight: 700,
                color: theme.colors.text.accent,
              }}
            >
              {totalLevel}
            </span>
          </div>
          <div
            style={{
              width: "1px",
              background: `${theme.colors.border.default}66`,
              margin: "0 6px",
            }}
          />
          <div className="text-center flex-1">
            <div
              style={{
                fontSize: "9px",
                color: theme.colors.text.muted,
                textTransform: "uppercase",
                letterSpacing: "0.5px",
                marginBottom: "2px",
              }}
            >
              Combat Level
            </div>
            <span
              style={{
                fontSize: "16px",
                fontWeight: 700,
                color: theme.colors.state.danger,
              }}
            >
              {combatLevel}
            </span>
          </div>
        </div>
      </div>

      {/* Skill Tooltip */}
      {hoveredSkill &&
        createPortal(
          (() => {
            const currentLevelXP = calculateXPForLevel(hoveredSkill.level);
            const nextLevelXP = calculateXPForLevel(hoveredSkill.level + 1);
            const xpRemaining = nextLevelXP - hoveredSkill.xp;
            const xpIntoLevel = hoveredSkill.xp - currentLevelXP;
            const xpForThisLevel = nextLevelXP - currentLevelXP;
            const progress = Math.min(
              100,
              Math.max(0, (xpIntoLevel / xpForThisLevel) * 100),
            );

            const tooltipSize = {
              width: skillTooltipSize.width || 180,
              height: skillTooltipSize.height || 90,
            };
            const { left, top } = calculateCursorTooltipPosition(
              mousePos,
              tooltipSize,
            );

            return (
              <div
                ref={skillTooltipRef}
                className="fixed pointer-events-none"
                style={{
                  left,
                  top,
                  zIndex: zIndex.tooltip,
                  background: theme.colors.background.glass,
                  border: `1px solid ${theme.colors.border.default}99`,
                  borderRadius: "4px",
                  padding: "8px 10px",
                  minWidth: "160px",
                  boxShadow: theme.shadows.md,
                }}
              >
                {/* Header */}
                <div className="flex items-center gap-2 mb-2">
                  <span style={{ fontSize: "16px" }}>{hoveredSkill.icon}</span>
                  <span
                    style={{
                      fontSize: "13px",
                      fontWeight: 700,
                      color: theme.colors.text.accent,
                    }}
                  >
                    {hoveredSkill.label}
                  </span>
                  <span
                    style={{
                      marginLeft: "auto",
                      fontSize: "12px",
                      fontWeight: 700,
                      color:
                        hoveredSkill.level >= 99
                          ? theme.colors.state.success
                          : theme.colors.text.accent,
                    }}
                  >
                    Lvl {hoveredSkill.level}
                  </span>
                </div>

                {/* XP Info */}
                <div
                  className="text-xs mb-1"
                  style={{ color: theme.colors.text.secondary }}
                >
                  XP: {hoveredSkill.xp.toLocaleString()}
                </div>
                <div
                  className="text-xs mb-2"
                  style={{ color: theme.colors.text.muted }}
                >
                  {hoveredSkill.level >= 99
                    ? "Max level reached!"
                    : `${xpRemaining.toLocaleString()} XP to level ${hoveredSkill.level + 1}`}
                </div>

                {/* Progress bar */}
                {hoveredSkill.level < 99 && (
                  <div
                    style={{
                      height: "4px",
                      background: theme.colors.background.overlay,
                      borderRadius: "2px",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        width: `${progress}%`,
                        background: `linear-gradient(90deg, ${theme.colors.accent.secondary}99, ${theme.colors.accent.secondary})`,
                        borderRadius: "2px",
                      }}
                    />
                  </div>
                )}
              </div>
            );
          })(),
          document.body,
        )}
    </div>
  );
}
