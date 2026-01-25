import { GAME_API_URL } from "@/lib/api-config";
import React, { useState, useEffect } from "react";
import type { Agent } from "./types";
import { Swords, Activity, Target, Coins, Clock } from "lucide-react";

interface SummaryData {
  online: boolean;
  uptimeMs: number;
  combatLevel: number;
  totalLevel: number;
  currentGoal: string | null;
  goalProgress: number;
  sessionXp: number;
  coins: number;
}

interface AgentSummaryCardProps {
  agent: Agent;
  isViewportActive: boolean;
}

// Format time duration
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h`;
  } else if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m`;
  } else {
    return `${seconds}s`;
  }
}

// Format XP with commas
function formatXp(xp: number): string {
  if (xp >= 1000000) {
    return `${(xp / 1000000).toFixed(1)}M`;
  } else if (xp >= 1000) {
    return `${(xp / 1000).toFixed(1)}K`;
  }
  return xp.toLocaleString();
}

// Calculate combat level from skills
function calculateCombatLevel(
  skills: Record<string, { level: number }> | null,
): number {
  if (!skills) return 3;
  const defense = skills.defense?.level || 1;
  const constitution = skills.constitution?.level || 10;
  const attack = skills.attack?.level || 1;
  const strength = skills.strength?.level || 1;
  const base = 0.25 * (defense + constitution);
  const melee = 0.325 * (attack + strength);
  return Math.floor(base + melee);
}

// Calculate total level
function calculateTotalLevel(
  skills: Record<string, { level: number }> | null,
): number {
  if (!skills) return 8;
  const skillKeys = [
    "attack",
    "strength",
    "defense",
    "constitution",
    "woodcutting",
    "fishing",
    "firemaking",
    "cooking",
  ];
  return skillKeys.reduce((sum, key) => sum + (skills[key]?.level || 1), 0);
}

export const AgentSummaryCard: React.FC<AgentSummaryCardProps> = ({
  agent,
  isViewportActive,
}) => {
  const [summary, setSummary] = useState<SummaryData>({
    online: false,
    uptimeMs: 0,
    combatLevel: 3,
    totalLevel: 8,
    currentGoal: null,
    goalProgress: 0,
    sessionXp: 0,
    coins: 0,
  });
  const [characterId, setCharacterId] = useState<string | null>(null);
  const [sessionStartTime] = useState<number>(Date.now());

  // Fetch character ID once
  useEffect(() => {
    if (agent.status !== "active") {
      setCharacterId(null);
      return;
    }

    const fetchCharacterId = async () => {
      try {
        const response = await fetch(
          `${GAME_API_URL}/api/agents/mapping/${agent.id}`,
        );
        if (response.ok) {
          const data = await response.json();
          setCharacterId(data.characterId || null);
        }
      } catch {
        // Silently fail
      }
    };

    fetchCharacterId();
  }, [agent.id, agent.status]);

  // Poll for summary data
  useEffect(() => {
    if (agent.status !== "active") {
      setSummary((prev) => ({ ...prev, online: false }));
      return;
    }

    const fetchSummary = async () => {
      try {
        // Fetch goal data
        const goalResponse = await fetch(
          `${GAME_API_URL}/api/agents/${agent.id}/goal`,
        );
        let goalData: {
          goal?: { description?: string; progressPercent?: number };
        } | null = null;
        if (goalResponse.ok) {
          goalData = await goalResponse.json();
        }

        // Fetch skills if we have characterId
        let skills: Record<string, { level: number; xp: number }> | null = null;
        if (characterId) {
          const skillsResponse = await fetch(
            `${GAME_API_URL}/api/characters/${characterId}/skills`,
          );
          if (skillsResponse.ok) {
            const skillsData = await skillsResponse.json();
            skills = skillsData.skills || skillsData;
          }

          // Fetch position to check online status
          const posResponse = await fetch(
            `${GAME_API_URL}/api/characters/${characterId}/position`,
          );
          if (posResponse.ok) {
            const posData = await posResponse.json();
            setSummary((prev) => ({
              ...prev,
              online: posData.online !== false,
              uptimeMs: Date.now() - sessionStartTime,
              combatLevel: calculateCombatLevel(skills),
              totalLevel: calculateTotalLevel(skills),
              currentGoal: goalData?.goal?.description || null,
              goalProgress: goalData?.goal?.progressPercent || 0,
            }));
            return;
          }
        }

        // Update with whatever data we have
        setSummary((prev) => ({
          ...prev,
          online: agent.status === "active",
          uptimeMs: Date.now() - sessionStartTime,
          combatLevel: calculateCombatLevel(skills),
          totalLevel: calculateTotalLevel(skills),
          currentGoal: goalData?.goal?.description || null,
          goalProgress: goalData?.goal?.progressPercent || 0,
        }));
      } catch {
        // Silently fail - keep last known state
      }
    };

    fetchSummary();
    // Poll every 10 seconds to avoid rate limiting (reduced from 2s)
    const interval = setInterval(fetchSummary, 10000);
    return () => clearInterval(interval);
  }, [agent.id, agent.status, characterId, sessionStartTime]);

  // Don't show if agent is inactive
  if (agent.status !== "active") {
    return (
      <div className="mx-2 mt-2 p-3 rounded-lg bg-gradient-to-br from-[#1a1005] to-[#0b0a15] border border-[#8b4513]/30">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-gray-500" />
          <span className="text-xs text-[#f2d08a]/50">Agent Offline</span>
        </div>
        <div className="mt-2 text-[10px] text-[#f2d08a]/30">
          Start the agent to view stats
        </div>
      </div>
    );
  }

  return (
    <div className="mx-2 mt-2 p-3 rounded-lg bg-gradient-to-br from-[#1a1005] to-[#0b0a15] border border-[#8b4513]/40 shadow-lg">
      {/* Status Row */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div
            className={`w-2 h-2 rounded-full ${summary.online ? "bg-green-500 animate-pulse" : "bg-gray-500"}`}
          />
          <span className="text-xs font-medium text-[#f2d08a]">
            {summary.online ? "Online" : "Offline"}
          </span>
          {summary.online && (
            <span className="text-[10px] text-[#f2d08a]/50 flex items-center gap-1">
              <Clock size={10} />
              {formatDuration(summary.uptimeMs)}
            </span>
          )}
        </div>
        {isViewportActive && (
          <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-green-500/10 border border-green-500/30">
            <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            <span className="text-[8px] text-green-400">LIVE</span>
          </div>
        )}
      </div>

      {/* Level Stats */}
      <div className="flex items-center gap-3 mb-2 py-1.5 px-2 rounded bg-black/30 border border-[#f2d08a]/10">
        <div className="flex items-center gap-1.5">
          <Swords size={12} className="text-red-400" />
          <span className="text-[10px] text-[#f2d08a]/60">Combat</span>
          <span className="text-sm font-bold text-[#f2d08a]">
            {summary.combatLevel}
          </span>
        </div>
        <div className="w-px h-4 bg-[#8b4513]/30" />
        <div className="flex items-center gap-1.5">
          <Activity size={12} className="text-blue-400" />
          <span className="text-[10px] text-[#f2d08a]/60">Total</span>
          <span className="text-sm font-bold text-[#f2d08a]">
            {summary.totalLevel}
          </span>
        </div>
      </div>

      {/* Current Goal */}
      {summary.currentGoal && (
        <div className="mb-2 py-1.5 px-2 rounded bg-black/30 border border-[#f2d08a]/10">
          <div className="flex items-center gap-1.5 mb-1">
            <Target size={10} className="text-[#f2d08a]/60" />
            <span className="text-[9px] text-[#f2d08a]/50 uppercase tracking-wider">
              Goal
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-[#e8ebf4]/80 truncate flex-1 mr-2">
              {summary.currentGoal}
            </span>
            <span className="text-[10px] font-bold text-[#f2d08a]">
              {summary.goalProgress}%
            </span>
          </div>
          {/* Mini progress bar */}
          <div className="mt-1 h-1 bg-black/50 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-[#f2d08a] to-[#8b4513] transition-all duration-500"
              style={{ width: `${Math.min(summary.goalProgress, 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Session Stats Row */}
      <div className="flex items-center justify-between text-[9px]">
        <div className="flex items-center gap-1 text-[#f2d08a]/50">
          <Activity size={10} />
          <span>Session: {formatDuration(summary.uptimeMs)}</span>
        </div>
        {summary.coins > 0 && (
          <div className="flex items-center gap-1 text-yellow-500/70">
            <Coins size={10} />
            <span>{formatXp(summary.coins)}</span>
          </div>
        )}
      </div>
    </div>
  );
};
