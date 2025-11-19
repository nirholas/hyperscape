/**
 * PlayerStatsPanel Component
 *
 * Displays player health, combat stats, and skill levels for a Hyperscape agent.
 * Shows RuneScape-style stats with progress bars and level indicators.
 */

import React from "react";
import type { UUID } from "@elizaos/core";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { usePlayerStats } from "../../hooks/hyperscape/useHyperscapeAgent.js";
import type { PlayerStats, SkillXP } from "../../types/hyperscape/index.js";
import {
  Heart,
  Sword,
  Shield,
  Target,
  Zap,
  Axe,
  Fish,
  Flame,
  ChefHat,
  TrendingUp,
} from "lucide-react";

interface PlayerStatsPanelProps {
  agentId: UUID | string;
}

const SKILL_ICONS: Record<keyof PlayerStats, React.ReactNode> = {
  attack: <Sword className="w-4 h-4" />,
  strength: <Zap className="w-4 h-4" />,
  defense: <Shield className="w-4 h-4" />,
  constitution: <Heart className="w-4 h-4" />,
  ranged: <Target className="w-4 h-4" />,
  woodcutting: <Axe className="w-4 h-4" />,
  fishing: <Fish className="w-4 h-4" />,
  firemaking: <Flame className="w-4 h-4" />,
  cooking: <ChefHat className="w-4 h-4" />,
};

const SKILL_NAMES: Record<keyof PlayerStats, string> = {
  attack: "Attack",
  strength: "Strength",
  defense: "Defense",
  constitution: "Constitution",
  ranged: "Ranged",
  woodcutting: "Woodcutting",
  fishing: "Fishing",
  firemaking: "Firemaking",
  cooking: "Cooking",
};

const SKILL_CATEGORIES = {
  combat: [
    "attack",
    "strength",
    "defense",
    "constitution",
    "ranged",
  ] as (keyof PlayerStats)[],
  gathering: ["woodcutting", "fishing"] as (keyof PlayerStats)[],
  processing: ["firemaking", "cooking"] as (keyof PlayerStats)[],
};

export function PlayerStatsPanel({ agentId }: PlayerStatsPanelProps) {
  const {
    data: statsData,
    isLoading,
    error,
  } = usePlayerStats(agentId as UUID | undefined);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Player Stats</CardTitle>
          <CardDescription>Loading player statistics...</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[...Array(9)].map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-2 w-full" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Player Stats</CardTitle>
          <CardDescription className="text-destructive">
            Failed to load stats
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {error instanceof Error ? error.message : "Unknown error"}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!statsData) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Player Stats</CardTitle>
          <CardDescription>No stats data available</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const { skills, totalLevel } = statsData;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5" />
              Player Stats
            </CardTitle>
            <CardDescription>RuneScape-style skill progression</CardDescription>
          </div>
          <Badge variant="secondary" className="text-lg px-4 py-2">
            Total: {totalLevel}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {/* Combat Skills */}
          <div>
            <h3 className="text-sm font-semibold mb-3 text-muted-foreground">
              Combat Skills
            </h3>
            <div className="space-y-3">
              {SKILL_CATEGORIES.combat.map((skillKey) => {
                const skill = skills.find((s) => s.skill === skillKey);
                if (!skill) return null;
                return (
                  <SkillRow key={skillKey} skillKey={skillKey} skill={skill} />
                );
              })}
            </div>
          </div>

          {/* Gathering Skills */}
          <div>
            <h3 className="text-sm font-semibold mb-3 text-muted-foreground">
              Gathering Skills
            </h3>
            <div className="space-y-3">
              {SKILL_CATEGORIES.gathering.map((skillKey) => {
                const skill = skills.find((s) => s.skill === skillKey);
                if (!skill) return null;
                return (
                  <SkillRow key={skillKey} skillKey={skillKey} skill={skill} />
                );
              })}
            </div>
          </div>

          {/* Processing Skills */}
          <div>
            <h3 className="text-sm font-semibold mb-3 text-muted-foreground">
              Processing Skills
            </h3>
            <div className="space-y-3">
              {SKILL_CATEGORIES.processing.map((skillKey) => {
                const skill = skills.find((s) => s.skill === skillKey);
                if (!skill) return null;
                return (
                  <SkillRow key={skillKey} skillKey={skillKey} skill={skill} />
                );
              })}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

interface SkillRowProps {
  skillKey: keyof PlayerStats;
  skill: SkillXP;
}

function SkillRow({ skillKey, skill }: SkillRowProps & { key?: React.Key }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex-shrink-0">{SKILL_ICONS[skillKey]}</div>
          <span className="text-sm font-medium">{SKILL_NAMES[skillKey]}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">
            {skill.currentXP.toLocaleString()} /{" "}
            {skill.nextLevelXP.toLocaleString()} XP
          </span>
          <Badge variant="outline" className="w-12 text-center">
            {skill.level}
          </Badge>
        </div>
      </div>
      <div className="relative">
        <Progress value={skill.percentage} className="h-2" />
        <span className="absolute right-2 top-0 text-xs text-muted-foreground">
          {skill.percentage.toFixed(1)}%
        </span>
      </div>
    </div>
  );
}
