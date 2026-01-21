/**
 * SkillSelectModal - Modal for selecting a skill to apply XP to (e.g., XP Lamp)
 *
 * Features:
 * - Displays all trainable skills in a grid
 * - Shows current level for each skill
 * - Allows player to select which skill receives XP
 * - OSRS-style appearance
 */

import React from "react";
import type { ClientWorld, PlayerStats } from "../../types";
import { EventType } from "@hyperscape/shared";

interface SkillSelectModalProps {
  visible: boolean;
  world: ClientWorld;
  stats: PlayerStats | null;
  xpAmount: number;
  itemId: string;
  slot: number;
  onClose: () => void;
}

interface SkillInfo {
  id: string;
  label: string;
  icon: string;
}

// All trainable skills with their display info
const SKILLS: SkillInfo[] = [
  { id: "attack", label: "Attack", icon: "⚔️" },
  { id: "strength", label: "Strength", icon: "💪" },
  { id: "defense", label: "Defense", icon: "🛡️" },
  { id: "constitution", label: "Constitution", icon: "❤️" },
  { id: "ranged", label: "Ranged", icon: "🏹" },
  { id: "prayer", label: "Prayer", icon: "🙏" },
  { id: "mining", label: "Mining", icon: "⛏️" },
  { id: "smithing", label: "Smithing", icon: "🔨" },
  { id: "fishing", label: "Fishing", icon: "🎣" },
  { id: "cooking", label: "Cooking", icon: "🍳" },
  { id: "firemaking", label: "Firemaking", icon: "🔥" },
  { id: "woodcutting", label: "Woodcutting", icon: "🪓" },
  { id: "agility", label: "Agility", icon: "🏃" },
];

export function SkillSelectModal({
  visible,
  world,
  stats,
  xpAmount,
  itemId,
  slot,
  onClose,
}: SkillSelectModalProps) {
  if (!visible) return null;

  const handleSkillSelect = (skillId: string) => {
    const localPlayer = world.getPlayer();
    if (!localPlayer) return;

    // Send skill selection to server
    if (world.network?.send) {
      world.network.send("xpLampUse", {
        itemId,
        slot,
        skillId,
        xpAmount,
      });
    }

    // Also emit local event for any listeners
    world.emit(EventType.XP_LAMP_SKILL_SELECTED, {
      playerId: localPlayer.id,
      itemId,
      slot,
      skillId,
      xpAmount,
    });

    onClose();
  };

  const getSkillLevel = (skillId: string): number => {
    if (!stats?.skills) return 1;
    const skillData = stats.skills[skillId as keyof typeof stats.skills];
    return skillData?.level ?? 1;
  };

  return (
    <div
      className="fixed inset-0 z-[10001] flex items-center justify-center pointer-events-auto"
      style={{ backgroundColor: "rgba(0, 0, 0, 0.7)" }}
      onClick={onClose}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div
        className="relative"
        style={{
          width: "24rem",
          maxWidth: "90vw",
          background: "rgba(11, 10, 21, 0.98)",
          border: "2px solid #c9a227",
          borderRadius: "0.5rem",
          padding: "1.5rem",
          backdropFilter: "blur(10px)",
          boxShadow: "0 8px 32px rgba(0, 0, 0, 0.5)",
        }}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex justify-between items-center mb-4 pb-2"
          style={{ borderBottom: "1px solid #c9a227" }}
        >
          <h3 className="m-0 text-lg font-bold" style={{ color: "#c9a227" }}>
            Choose a Skill
          </h3>
          <button
            onClick={onClose}
            className="bg-transparent border-none text-gray-400 hover:text-white cursor-pointer text-xl leading-none"
            title="Close"
          >
            ×
          </button>
        </div>

        {/* XP Amount Info */}
        <div
          className="text-center mb-4 py-2"
          style={{
            color: "#4ade80",
            backgroundColor: "rgba(74, 222, 128, 0.1)",
            borderRadius: "4px",
          }}
        >
          Grant <strong>{xpAmount.toLocaleString()} XP</strong> to:
        </div>

        {/* Skills Grid */}
        <div
          className="grid gap-2"
          style={{
            gridTemplateColumns: "repeat(3, 1fr)",
          }}
        >
          {SKILLS.map((skill) => {
            const level = getSkillLevel(skill.id);
            return (
              <button
                key={skill.id}
                onClick={() => handleSkillSelect(skill.id)}
                className="flex flex-col items-center p-2 transition-all duration-150"
                style={{
                  background:
                    "linear-gradient(to bottom, rgba(45, 35, 25, 0.95) 0%, rgba(30, 25, 20, 0.95) 100%)",
                  border: "1px solid #5c4a3a",
                  borderRadius: "4px",
                  cursor: "pointer",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "#c9a227";
                  e.currentTarget.style.transform = "scale(1.02)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "#5c4a3a";
                  e.currentTarget.style.transform = "scale(1)";
                }}
              >
                <span className="text-xl mb-1">{skill.icon}</span>
                <span
                  className="text-xs font-medium"
                  style={{ color: "#c9b386" }}
                >
                  {skill.label}
                </span>
                <span
                  className="text-xs font-bold"
                  style={{
                    color: level >= 99 ? "#ffcc00" : "#ffff00",
                  }}
                >
                  Lv. {level}
                </span>
              </button>
            );
          })}
        </div>

        {/* Cancel Button */}
        <div className="mt-4 flex justify-center">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm transition-colors"
            style={{
              background: "rgba(100, 100, 100, 0.3)",
              border: "1px solid #666",
              borderRadius: "4px",
              color: "#ccc",
              cursor: "pointer",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(100, 100, 100, 0.5)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(100, 100, 100, 0.3)";
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
