/**
 * Skills Panel
 * Classic RuneScape-style skills interface with Prayer/Buffs system
 */

import React, { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { COLORS } from "../../constants";
import type { ClientWorld, PlayerStats } from "../../types";
import { EventType, type SkillUnlock } from "@hyperscape/shared";
import { SkillGuidePanel } from "./SkillGuidePanel";
import { GAME_API_URL } from "../../lib/api-config";

interface SkillsPanelProps {
  world: ClientWorld;
  stats: PlayerStats | null;
}

interface Skill {
  key: string;
  label: string;
  icon: string;
  level: number;
  xp: number;
}

interface Prayer {
  id: string;
  name: string;
  icon: string;
  level: number;
  description: string;
  drainRate: number;
  active: boolean;
  category: "offensive" | "defensive" | "utility";
}

type TabType = "skills" | "prayer";

function calculateXPForLevel(level: number): number {
  // RuneScape-style XP formula
  let total = 0;
  for (let i = 1; i < level; i++) {
    total += Math.floor(i + 300 * Math.pow(2, i / 7));
  }
  return Math.floor(total / 4);
}

function SkillBox({
  skill,
  onHover,
  onLeave,
  onClick,
}: {
  skill: Skill;
  onHover: (skill: Skill, e: React.MouseEvent) => void;
  onLeave: () => void;
  onClick: (skill: Skill) => void;
}) {
  return (
    <button
      className="relative group flex flex-col items-center p-0.5"
      onMouseEnter={(e) => onHover(skill, e)}
      onMouseMove={(e) => onHover(skill, e)}
      onMouseLeave={onLeave}
      onClick={() => onClick(skill)}
      style={{
        background:
          "linear-gradient(to bottom, rgba(45, 35, 25, 0.95) 0%, rgba(30, 25, 20, 0.95) 100%)",
        border: "1px solid #5c4a3a",
        borderRadius: "3px",
        boxShadow:
          "inset 1px 1px 0 rgba(80, 65, 50, 0.8), inset -1px -1px 0 rgba(20, 15, 10, 0.9), 0 1px 3px rgba(0, 0, 0, 0.8)",
        cursor: "pointer",
        width: "100%",
        minHeight: "40px",
      }}
    >
      {/* Icon - Top */}
      <div className="flex-1 flex items-center justify-center w-full">
        <div
          className="text-base"
          style={{ filter: "drop-shadow(1px 1px 1px rgba(0, 0, 0, 0.8))" }}
        >
          {skill.icon}
        </div>
      </div>

      {/* Skill Name and Level - Bottom */}
      <div className="flex items-center justify-between w-full mt-0.5">
        <span className="font-medium text-[8px]" style={{ color: "#c9b386" }}>
          {skill.label}
        </span>
        <span
          className="font-bold text-[9px]"
          style={{
            color: skill.level >= 99 ? "#ffcc00" : "#ffff00",
            textShadow:
              "1px 1px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000",
          }}
        >
          {skill.level}
        </span>
      </div>

      {/* 99 Badge */}
      {skill.level >= 99 && (
        <div
          className="absolute top-0.5 right-0.5 text-[8px]"
          style={{ filter: "drop-shadow(0 1px 2px rgba(0, 0, 0, 1))" }}
        >
          ⭐
        </div>
      )}

      {/* Hover Effect */}
      <div
        className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-100 pointer-events-none"
        style={{
          background: "rgba(255, 255, 200, 0.1)",
          borderRadius: "3px",
        }}
      />
    </button>
  );
}

function PrayerCard({
  prayer,
  onToggle,
  playerLevel,
}: {
  prayer: Prayer;
  onToggle: (id: string) => void;
  playerLevel: number;
}) {
  const [showTooltip, setShowTooltip] = useState(false);
  const isLocked = prayer.level > playerLevel;

  return (
    <button
      className="relative border rounded transition-all duration-200 group p-0.5"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
      onClick={() => !isLocked && onToggle(prayer.id)}
      disabled={isLocked}
      style={{
        background: isLocked
          ? "linear-gradient(135deg, rgba(30, 30, 40, 0.95) 0%, rgba(20, 20, 30, 0.92) 100%)"
          : prayer.active
            ? "linear-gradient(135deg, rgba(34, 197, 94, 0.2) 0%, rgba(34, 197, 94, 0.1) 100%)"
            : "linear-gradient(135deg, rgba(20, 20, 30, 0.95) 0%, rgba(25, 20, 35, 0.92) 100%)",
        borderColor: isLocked
          ? "rgba(100, 100, 100, 0.35)"
          : prayer.active
            ? "rgba(34, 197, 94, 0.6)"
            : "rgba(242, 208, 138, 0.35)",
        boxShadow: prayer.active
          ? "0 0 4px rgba(34, 197, 94, 0.3), 0 1px 2px rgba(0, 0, 0, 0.5)"
          : "0 1px 2px rgba(0, 0, 0, 0.5)",
        cursor: isLocked ? "not-allowed" : "pointer",
        opacity: isLocked ? 0.6 : 1,
      }}
    >
      <div className="flex items-center justify-between gap-0.5">
        {/* Icon - Left */}
        <div
          className="flex items-center justify-center rounded text-xs w-5 h-5 sm:text-sm sm:w-6 sm:h-6 flex-shrink-0"
          style={{
            background: prayer.active
              ? "rgba(34, 197, 94, 0.15)"
              : "rgba(0, 0, 0, 0.3)",
            borderWidth: "1px",
            borderStyle: "solid",
            borderColor: prayer.active
              ? "rgba(34, 197, 94, 0.4)"
              : "rgba(242, 208, 138, 0.2)",
          }}
        >
          {prayer.icon}
        </div>

        {/* Name - Middle */}
        <div className="flex-1 min-w-0 px-0.5">
          <div
            className="font-semibold text-[10px] leading-tight truncate"
            style={{ color: prayer.active ? "#22c55e" : COLORS.ACCENT }}
          >
            {prayer.name}
          </div>
        </div>

        {/* Level - Right */}
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <div
            className="text-[10px] font-semibold"
            style={{ color: "rgba(242, 208, 138, 0.8)" }}
          >
            {prayer.level}
          </div>
          {/* Active Indicator */}
          {prayer.active && (
            <div
              className="rounded-full w-1 h-1"
              style={{
                background: "#22c55e",
                boxShadow: "0 0 4px rgba(34, 197, 94, 0.6)",
              }}
            />
          )}
        </div>
      </div>

      {/* Tooltip */}
      {showTooltip && (
        <div
          className="absolute z-[200] border rounded pointer-events-none p-1.5"
          style={{
            bottom: "110%",
            left: "50%",
            transform: "translateX(-50%)",
            background:
              "linear-gradient(135deg, rgba(20, 20, 30, 0.98) 0%, rgba(25, 20, 35, 0.96) 100%)",
            borderColor: "rgba(242, 208, 138, 0.5)",
            boxShadow: "0 4px 12px rgba(0, 0, 0, 0.8)",
            minWidth: "140px",
            whiteSpace: "normal",
          }}
        >
          <div
            className="font-semibold mb-0.5 text-[10px]"
            style={{ color: COLORS.ACCENT }}
          >
            {prayer.name}
          </div>
          <div
            className="mb-0.5 text-[9px]"
            style={{
              color: "rgba(242, 208, 138, 0.8)",
              lineHeight: "1.3",
            }}
          >
            {prayer.description}
          </div>
          <div
            className="text-[9px]"
            style={{ color: "rgba(242, 208, 138, 0.7)" }}
          >
            Drain rate: {prayer.drainRate}/min
          </div>
          {isLocked && (
            <div
              className="text-[9px] mt-0.5 font-semibold"
              style={{ color: "#ef4444" }}
            >
              🔒 Requires level {prayer.level}
            </div>
          )}

          {/* Tooltip arrow */}
          <div
            className="absolute"
            style={{
              top: "100%",
              left: "50%",
              transform: "translateX(-50%)",
              width: 0,
              height: 0,
              borderLeft: "6px solid transparent",
              borderRight: "6px solid transparent",
              borderTop: "6px solid rgba(242, 208, 138, 0.5)",
            }}
          />
        </div>
      )}

      {/* Hover Glow */}
      <div
        className="absolute inset-0 rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none"
        style={{
          background: prayer.active
            ? "radial-gradient(circle at center, rgba(34, 197, 94, 0.1) 0%, transparent 70%)"
            : "radial-gradient(circle at center, rgba(242, 208, 138, 0.05) 0%, transparent 70%)",
        }}
      />
    </button>
  );
}

export function SkillsPanel({ world, stats }: SkillsPanelProps) {
  const [activeTab, setActiveTab] = useState<TabType>("skills");
  const [hoveredSkill, setHoveredSkill] = useState<Skill | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  // Skill Guide Panel state
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const [skillUnlocks, setSkillUnlocks] = useState<
    Record<string, SkillUnlock[]>
  >({});
  const [isLoadingUnlocks, setIsLoadingUnlocks] = useState(true);

  // Fetch skill unlocks data from server
  useEffect(() => {
    const fetchSkillUnlocks = async () => {
      try {
        const response = await fetch(`${GAME_API_URL}/api/data/skill-unlocks`);
        if (response.ok) {
          const data = await response.json();
          setSkillUnlocks(data);
        }
      } catch (error) {
        console.warn("[SkillsPanel] Failed to fetch skill unlocks:", error);
      } finally {
        setIsLoadingUnlocks(false);
      }
    };
    fetchSkillUnlocks();
  }, []);

  // Skill Guide Panel handlers
  const handleSkillClick = useCallback((skill: Skill) => {
    setSelectedSkill(skill);
    setIsGuideOpen(true);
  }, []);

  const handleGuideClose = useCallback(() => {
    setIsGuideOpen(false);
    setSelectedSkill(null);
  }, []);

  // Prayer state from server
  const [prayerPoints, setPrayerPoints] = useState(1);
  const [prayerMaxPoints, setPrayerMaxPoints] = useState(1);
  const [activePrayers, setActivePrayers] = useState<Set<string>>(new Set());

  // Get local player ID
  const localPlayer = world?.getPlayer?.();
  const playerId = localPlayer?.id;

  // Listen for prayer state updates from server
  useEffect(() => {
    if (!world) return;

    const handlePrayerStateSync = (data: unknown) => {
      const prayerData = data as {
        playerId: string;
        points: number;
        maxPoints: number;
        active: string[];
      };
      // Only handle our own player's state
      if (prayerData.playerId !== playerId) return;

      setPrayerPoints(prayerData.points);
      setPrayerMaxPoints(prayerData.maxPoints);
      setActivePrayers(new Set(prayerData.active));
    };

    const handlePrayerToggled = (data: unknown) => {
      const toggleData = data as {
        playerId: string;
        prayerId: string;
        active: boolean;
        points: number;
      };
      // Only handle our own player's state
      if (toggleData.playerId !== playerId) return;

      setPrayerPoints(toggleData.points);
      setActivePrayers((prev) => {
        const next = new Set(prev);
        if (toggleData.active) {
          next.add(toggleData.prayerId);
        } else {
          next.delete(toggleData.prayerId);
        }
        return next;
      });
    };

    const handlePrayerPointsChanged = (data: unknown) => {
      const pointsData = data as {
        playerId: string;
        points: number;
        maxPoints: number;
      };
      // Only handle our own player's state
      if (pointsData.playerId !== playerId) return;

      setPrayerPoints(pointsData.points);
      setPrayerMaxPoints(pointsData.maxPoints);
    };

    world.on(EventType.PRAYER_STATE_SYNC, handlePrayerStateSync);
    world.on(EventType.PRAYER_TOGGLED, handlePrayerToggled);
    world.on(EventType.PRAYER_POINTS_CHANGED, handlePrayerPointsChanged);

    // Initialize from cached state if available
    const network = world.network as {
      lastPrayerStateByPlayerId?: Record<
        string,
        { points: number; maxPoints: number; active: string[] }
      >;
    };
    if (playerId && network?.lastPrayerStateByPlayerId?.[playerId]) {
      const cached = network.lastPrayerStateByPlayerId[playerId];
      setPrayerPoints(cached.points);
      setPrayerMaxPoints(cached.maxPoints);
      setActivePrayers(new Set(cached.active));
    }

    return () => {
      world.off(EventType.PRAYER_STATE_SYNC, handlePrayerStateSync);
      world.off(EventType.PRAYER_TOGGLED, handlePrayerToggled);
      world.off(EventType.PRAYER_POINTS_CHANGED, handlePrayerPointsChanged);
    };
  }, [world, playerId]);

  const s = stats?.skills || ({} as NonNullable<PlayerStats["skills"]>);

  const skills: Skill[] = [
    {
      key: "attack",
      label: "Attack",
      icon: "⚔️",
      level: s?.attack?.level || 1,
      xp: s?.attack?.xp || 0,
    },
    {
      key: "constitution",
      label: "Constitution",
      icon: "❤️",
      level: Math.max(10, s?.constitution?.level || 10),
      xp: s?.constitution?.xp || 0,
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
      label: "Defense",
      icon: "🛡️",
      level: s?.defense?.level || 1,
      xp: s?.defense?.xp || 0,
    },
    // Ranged skill hidden for melee-only MVP
    {
      key: "woodcutting",
      label: "Woodcutting",
      icon: "🪓",
      level: s?.woodcutting?.level || 1,
      xp: s?.woodcutting?.xp || 0,
    },
    {
      key: "mining",
      label: "Mining",
      icon: "⛏️",
      level: s?.mining?.level || 1,
      xp: s?.mining?.xp || 0,
    },
    {
      key: "fishing",
      label: "Fishing",
      icon: "🎣",
      level: s?.fishing?.level || 1,
      xp: s?.fishing?.xp || 0,
    },
    {
      key: "firemaking",
      label: "Firemaking",
      icon: "🔥",
      level: s?.firemaking?.level || 1,
      xp: s?.firemaking?.xp || 0,
    },
    {
      key: "cooking",
      label: "Cooking",
      icon: "🍳",
      level: s?.cooking?.level || 1,
      xp: s?.cooking?.xp || 0,
    },
    {
      key: "smithing",
      label: "Smithing",
      icon: "🔨",
      level: s?.smithing?.level || 1,
      xp: s?.smithing?.xp || 0,
    },
    {
      key: "agility",
      label: "Agility",
      icon: "🏃",
      level: s?.agility?.level || 1,
      xp: s?.agility?.xp || 0,
    },
    {
      key: "prayer",
      label: "Prayer",
      icon: "🙏",
      level: s?.prayer?.level || 1,
      xp: s?.prayer?.xp || 0,
    },
  ];

  // Prayer definitions (matches server manifest prayers.json)
  // Server is authoritative - client just displays UI
  const prayerLevel = s?.prayer?.level || 1;
  const prayers: Prayer[] = React.useMemo(() => {
    return [
      // Defensive Prayers
      {
        id: "thick_skin",
        name: "Thick Skin",
        icon: "🛡️",
        level: 1,
        description: "Increases Defense by 5%",
        drainRate: 3,
        active: activePrayers.has("thick_skin"),
        category: "defensive" as const,
      },
      {
        id: "rock_skin",
        name: "Rock Skin",
        icon: "🪨",
        level: 10,
        description: "Increases Defense by 10%",
        drainRate: 6,
        active: activePrayers.has("rock_skin"),
        category: "defensive" as const,
      },
      // Offensive Prayers
      {
        id: "burst_of_strength",
        name: "Burst of Strength",
        icon: "💪",
        level: 4,
        description: "Increases Strength by 5%",
        drainRate: 3,
        active: activePrayers.has("burst_of_strength"),
        category: "offensive" as const,
      },
      {
        id: "clarity_of_thought",
        name: "Clarity of Thought",
        icon: "🧠",
        level: 7,
        description: "Increases Attack by 5%",
        drainRate: 3,
        active: activePrayers.has("clarity_of_thought"),
        category: "offensive" as const,
      },
      {
        id: "superhuman_strength",
        name: "Superhuman Strength",
        icon: "⚡",
        level: 13,
        description: "Increases Strength by 10%",
        drainRate: 6,
        active: activePrayers.has("superhuman_strength"),
        category: "offensive" as const,
      },
    ];
  }, [activePrayers]);

  const totalLevel = skills.reduce((sum, skill) => sum + skill.level, 0);
  const totalXP = skills.reduce((sum, skill) => sum + skill.xp, 0);

  const handleMouseMove = (e: React.MouseEvent) => {
    setMousePos({ x: e.clientX, y: e.clientY });
  };

  // Send prayer toggle request to server
  const togglePrayer = useCallback(
    (id: string) => {
      if (!world?.network?.send) {
        console.warn("[SkillsPanel] Cannot toggle prayer - no network");
        return;
      }

      // Check level requirement
      const prayer = prayers.find((p) => p.id === id);
      if (prayer && prayer.level > prayerLevel) {
        // Show requirement message (could emit a toast event)
        console.log(`Requires prayer level ${prayer.level}`);
        return;
      }

      // Send to server - server handles validation and state
      world.network.send("prayerToggle", {
        prayerId: id,
        timestamp: Date.now(),
      });
    },
    [world, prayers, prayerLevel],
  );

  // Filter prayers by category and sort by level
  const sortByLevel = (a: Prayer, b: Prayer) => a.level - b.level;
  const offensivePrayers = prayers
    .filter((p) => p.category === "offensive")
    .sort(sortByLevel);
  const defensivePrayers = prayers
    .filter((p) => p.category === "defensive")
    .sort(sortByLevel);
  const utilityPrayers = prayers
    .filter((p) => p.category === "utility")
    .sort(sortByLevel);

  return (
    <div className="flex flex-col h-full overflow-hidden gap-1">
      {/* Tabs */}
      <div className="flex gap-1">
        <button
          onClick={() => setActiveTab("skills")}
          className="flex-1 border rounded transition-all duration-200 py-1 px-2 text-[10px]"
          style={{
            background:
              activeTab === "skills"
                ? "linear-gradient(135deg, rgba(242, 208, 138, 0.2) 0%, rgba(242, 208, 138, 0.1) 100%)"
                : "linear-gradient(135deg, rgba(20, 20, 30, 0.95) 0%, rgba(25, 20, 35, 0.92) 100%)",
            borderColor:
              activeTab === "skills"
                ? "rgba(242, 208, 138, 0.6)"
                : "rgba(242, 208, 138, 0.35)",
            boxShadow:
              activeTab === "skills"
                ? "0 0 8px rgba(242, 208, 138, 0.2), 0 1px 3px rgba(0, 0, 0, 0.5)"
                : "0 1px 3px rgba(0, 0, 0, 0.5)",
            color:
              activeTab === "skills"
                ? COLORS.ACCENT
                : "rgba(242, 208, 138, 0.7)",
            fontWeight: activeTab === "skills" ? "bold" : "medium",
          }}
        >
          📊 Skills
        </button>
        <button
          onClick={() => setActiveTab("prayer")}
          className="flex-1 border rounded transition-all duration-200 py-1 px-2 text-[10px]"
          style={{
            background:
              activeTab === "prayer"
                ? "linear-gradient(135deg, rgba(242, 208, 138, 0.2) 0%, rgba(242, 208, 138, 0.1) 100%)"
                : "linear-gradient(135deg, rgba(20, 20, 30, 0.95) 0%, rgba(25, 20, 35, 0.92) 100%)",
            borderColor:
              activeTab === "prayer"
                ? "rgba(242, 208, 138, 0.6)"
                : "rgba(242, 208, 138, 0.35)",
            boxShadow:
              activeTab === "prayer"
                ? "0 0 8px rgba(242, 208, 138, 0.2), 0 1px 3px rgba(0, 0, 0, 0.5)"
                : "0 1px 3px rgba(0, 0, 0, 0.5)",
            color:
              activeTab === "prayer"
                ? COLORS.ACCENT
                : "rgba(242, 208, 138, 0.7)",
            fontWeight: activeTab === "prayer" ? "bold" : "medium",
          }}
        >
          🙏 Prayer
        </button>
      </div>

      {/* Content */}
      <div
        className="flex-1 overflow-y-auto noscrollbar"
        onMouseMove={handleMouseMove}
      >
        {activeTab === "skills" ? (
          <div className="flex flex-col gap-1.5">
            {/* Skills Grid - 3x3 */}
            <div className="grid grid-cols-3 gap-1">
              {skills.map((skill) => (
                <SkillBox
                  key={skill.key}
                  skill={skill}
                  onHover={(s, e) => {
                    setHoveredSkill(s);
                    setMousePos({ x: e.clientX, y: e.clientY });
                  }}
                  onLeave={() => setHoveredSkill(null)}
                  onClick={handleSkillClick}
                />
              ))}
            </div>

            {/* Stats List */}
            <div className="flex flex-col gap-0.5">
              {/* Total Level */}
              <div className="flex items-center justify-between">
                <span
                  className="font-medium text-[10px]"
                  style={{ color: "#c9b386" }}
                >
                  Total level:
                </span>
                <span
                  className="font-bold text-xs"
                  style={{
                    color: "#ffff00",
                    textShadow:
                      "1px 1px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000",
                  }}
                >
                  {totalLevel}
                </span>
              </div>

              {/* Combat Level */}
              <div className="flex items-center justify-between">
                <span
                  className="font-medium text-[10px]"
                  style={{ color: "#c9b386" }}
                >
                  Combat:
                </span>
                <span
                  className="font-bold text-xs"
                  style={{
                    color: "#00ff00",
                    textShadow:
                      "1px 1px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000",
                  }}
                >
                  {(() => {
                    // OSRS Combat Level Formula (simplified - no Prayer/Magic yet)
                    const base =
                      0.25 *
                      ((s.defense?.level || 1) + (s.constitution?.level || 10));
                    // Melee-only MVP: Combat level based on melee stats only
                    const melee =
                      0.325 *
                      ((s.attack?.level || 1) + (s.strength?.level || 1));
                    return Math.floor(base + melee);
                  })()}
                </span>
              </div>

              {/* Total XP */}
              <div className="flex items-center justify-between">
                <span
                  className="font-medium text-[10px]"
                  style={{ color: "#c9b386" }}
                >
                  Total XP:
                </span>
                <span
                  className="font-bold text-[10px]"
                  style={{
                    color: "#ffffff",
                    textShadow: "1px 1px 0 #000",
                  }}
                >
                  {Math.floor(totalXP).toLocaleString()}
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {/* Prayer Points Bar */}
            <div
              className="border rounded p-1.5"
              style={{
                background:
                  "linear-gradient(135deg, rgba(20, 20, 30, 0.95) 0%, rgba(25, 20, 35, 0.92) 100%)",
                borderColor: "rgba(242, 208, 138, 0.35)",
              }}
            >
              <div className="flex items-center justify-between mb-1">
                <span
                  className="font-semibold text-[10px]"
                  style={{ color: COLORS.ACCENT }}
                >
                  🙏 Prayer Points
                </span>
                <span
                  className="font-bold text-[10px]"
                  style={{ color: prayerPoints > 0 ? "#22c55e" : "#ef4444" }}
                >
                  {Math.floor(prayerPoints)} / {prayerMaxPoints}
                </span>
              </div>
              <div
                className="rounded overflow-hidden h-2"
                style={{ background: "rgba(0, 0, 0, 0.5)" }}
              >
                <div
                  className="h-full transition-all duration-300"
                  style={{
                    width: `${Math.min(100, (prayerPoints / prayerMaxPoints) * 100)}%`,
                    background:
                      prayerPoints > prayerMaxPoints * 0.25
                        ? "linear-gradient(90deg, rgba(34, 197, 94, 0.9) 0%, rgba(34, 197, 94, 0.7) 100%)"
                        : "linear-gradient(90deg, rgba(239, 68, 68, 0.9) 0%, rgba(239, 68, 68, 0.7) 100%)",
                    boxShadow:
                      prayerPoints > prayerMaxPoints * 0.25
                        ? "0 0 6px rgba(34, 197, 94, 0.4)"
                        : "0 0 6px rgba(239, 68, 68, 0.4)",
                  }}
                />
              </div>
            </div>

            {/* Offensive Prayers */}
            <div>
              <div
                className="font-semibold mb-1 text-[10px]"
                style={{ color: COLORS.ACCENT }}
              >
                ⚔️ Offensive
              </div>
              <div className="grid grid-cols-2 gap-1">
                {offensivePrayers.map((prayer) => (
                  <PrayerCard
                    key={prayer.id}
                    prayer={prayer}
                    onToggle={togglePrayer}
                    playerLevel={prayerLevel}
                  />
                ))}
              </div>
            </div>

            {/* Defensive Prayers */}
            <div>
              <div
                className="font-semibold mb-1 text-[10px]"
                style={{ color: COLORS.ACCENT }}
              >
                🛡️ Defensive
              </div>
              <div className="grid grid-cols-2 gap-1">
                {defensivePrayers.map((prayer) => (
                  <PrayerCard
                    key={prayer.id}
                    prayer={prayer}
                    onToggle={togglePrayer}
                    playerLevel={prayerLevel}
                  />
                ))}
              </div>
            </div>

            {/* Utility Prayers */}
            {utilityPrayers.length > 0 && (
              <div>
                <div
                  className="font-semibold mb-1 text-[10px]"
                  style={{ color: COLORS.ACCENT }}
                >
                  🌟 Utility
                </div>
                <div className="grid grid-cols-2 gap-1">
                  {utilityPrayers.map((prayer) => (
                    <PrayerCard
                      key={prayer.id}
                      prayer={prayer}
                      onToggle={togglePrayer}
                      playerLevel={prayerLevel}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Tooltip for Skills Tab - rendered via portal to avoid transform issues */}
      {activeTab === "skills" &&
        hoveredSkill &&
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

            const tooltipWidth = 200;
            const tooltipHeight = 100;
            const padding = 12;

            let left = mousePos.x + padding;
            if (left + tooltipWidth > window.innerWidth - 8) {
              left = mousePos.x - tooltipWidth - padding;
            }
            if (left < 8) left = 8;

            let top = mousePos.y + padding;
            if (top + tooltipHeight > window.innerHeight - 8) {
              top = mousePos.y - tooltipHeight - padding;
            }
            if (top < 8) top = 8;

            return (
              <div
                className="fixed border rounded pointer-events-none z-[10000] p-2"
                style={{
                  left,
                  top,
                  minWidth: tooltipWidth,
                  background:
                    "linear-gradient(135deg, rgba(20, 20, 30, 0.98) 0%, rgba(15, 15, 25, 0.95) 100%)",
                  borderColor: "rgba(242, 208, 138, 0.5)",
                  boxShadow: "0 4px 16px rgba(0, 0, 0, 0.9)",
                }}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1">
                    <span className="text-base">{hoveredSkill.icon}</span>
                    <span
                      className="font-semibold text-[10px]"
                      style={{ color: COLORS.ACCENT }}
                    >
                      {hoveredSkill.label}
                    </span>
                  </div>
                  <span
                    className="font-bold text-[10px]"
                    style={{
                      color:
                        hoveredSkill.level >= 99 ? "#fbbf24" : COLORS.ACCENT,
                    }}
                  >
                    {hoveredSkill.level}
                  </span>
                </div>

                {hoveredSkill.key !== "total" ? (
                  <>
                    <div
                      className="mb-0.5 text-[9px]"
                      style={{ color: "rgba(242, 208, 138, 0.8)" }}
                    >
                      XP: {Math.floor(hoveredSkill.xp).toLocaleString()}
                    </div>
                    <div
                      className="mb-1 text-[9px]"
                      style={{ color: "rgba(242, 208, 138, 0.8)" }}
                    >
                      Next level: {xpRemaining.toLocaleString()} XP
                    </div>

                    <div
                      className="rounded overflow-hidden h-1.5"
                      style={{ background: "rgba(0, 0, 0, 0.5)" }}
                    >
                      <div
                        className="h-full transition-all duration-300"
                        style={{
                          width: `${progress}%`,
                          background:
                            hoveredSkill.level >= 99
                              ? "linear-gradient(90deg, rgba(251, 191, 36, 0.9) 0%, rgba(251, 191, 36, 0.7) 100%)"
                              : "linear-gradient(90deg, rgba(34, 197, 94, 0.9) 0%, rgba(34, 197, 94, 0.7) 100%)",
                          boxShadow:
                            hoveredSkill.level >= 99
                              ? "0 0 6px rgba(251, 191, 36, 0.5)"
                              : "0 0 6px rgba(34, 197, 94, 0.4)",
                        }}
                      />
                    </div>
                  </>
                ) : (
                  <div
                    className="text-[9px]"
                    style={{ color: "rgba(242, 208, 138, 0.8)" }}
                  >
                    Total XP: {Math.floor(totalXP).toLocaleString()}
                  </div>
                )}
              </div>
            );
          })(),
          document.body,
        )}

      {/* Skill Guide Panel */}
      {selectedSkill && (
        <SkillGuidePanel
          visible={isGuideOpen}
          skillLabel={selectedSkill.label}
          skillIcon={selectedSkill.icon}
          playerLevel={selectedSkill.level}
          unlocks={skillUnlocks[selectedSkill.key] || []}
          isLoading={isLoadingUnlocks}
          onClose={handleGuideClose}
        />
      )}
    </div>
  );
}
