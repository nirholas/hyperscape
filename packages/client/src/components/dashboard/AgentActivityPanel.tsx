import { GAME_API_URL } from "@/lib/api-config";
import React, { useState, useEffect, useRef } from "react";
import { Agent } from "../../screens/DashboardScreen";
import {
  ChevronDown,
  ChevronUp,
  Activity,
  Swords,
  TreePine,
  Fish,
  Flame,
  Pickaxe,
  Coins,
  Package,
  Target,
  Skull,
  Heart,
  MapPin,
} from "lucide-react";

interface ActivityEvent {
  id: string;
  type: "combat" | "skill" | "item" | "goal" | "death" | "movement";
  description: string;
  xpGained?: number;
  timestamp: number;
  details?: {
    skillName?: string;
    itemName?: string;
    targetName?: string;
    goldAmount?: number;
  };
}

interface SessionStats {
  kills: number;
  deaths: number;
  totalXpGained: number;
  goldEarned: number;
  resourcesGathered: Record<string, number>;
}

interface AgentActivityPanelProps {
  agent: Agent;
  isViewportActive: boolean;
}

export const AgentActivityPanel: React.FC<AgentActivityPanelProps> = ({
  agent,
  isViewportActive,
}) => {
  const [activities, setActivities] = useState<ActivityEvent[]>([]);
  const [sessionStats, setSessionStats] = useState<SessionStats>({
    kills: 0,
    deaths: 0,
    totalXpGained: 0,
    goldEarned: 0,
    resourcesGathered: {},
  });
  const [expanded, setExpanded] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const activityIdCounter = useRef(0);

  // Listen for activity events via WebSocket or polling
  useEffect(() => {
    if (agent.status !== "active") {
      setActivities([]);
      setSessionStats({
        kills: 0,
        deaths: 0,
        totalXpGained: 0,
        goldEarned: 0,
        resourcesGathered: {},
      });
      return;
    }

    // Poll every 10 seconds to avoid rate limiting (reduced from 3s)
    // In a full implementation, this would use WebSocket events from the game server.
    const interval = setInterval(fetchActivity, 10000);
    return () => clearInterval(interval);
  }, [agent.id, agent.status]);

  const fetchActivity = async () => {
    try {
      // Try to fetch activity from the server
      const response = await fetch(
        `${GAME_API_URL}/api/agents/${agent.id}/activity`,
      );

      if (response.ok) {
        const data = await response.json();
        if (data.recentActions) {
          // Map server actions to our format
          const newActivities = data.recentActions.map(
            (action: {
              type: string;
              description: string;
              xpGained?: number;
              timestamp: number;
            }) => ({
              id: `server-${action.timestamp}`,
              type: action.type,
              description: action.description,
              xpGained: action.xpGained,
              timestamp: action.timestamp,
            }),
          );
          setActivities(newActivities);
        }
        if (data.sessionStats) {
          setSessionStats(data.sessionStats);
        }
        setError(null);
      }
    } catch (err) {
      // Activity endpoint might not exist yet - that's okay
      // We'll track local activities instead
    }
  };

  // Add a local activity event (can be called from parent components)
  const addActivity = (
    type: ActivityEvent["type"],
    description: string,
    xpGained?: number,
    details?: ActivityEvent["details"],
  ) => {
    const newActivity: ActivityEvent = {
      id: `local-${++activityIdCounter.current}`,
      type,
      description,
      xpGained,
      timestamp: Date.now(),
      details,
    };

    setActivities((prev) => [newActivity, ...prev].slice(0, 15));

    // Update session stats
    if (xpGained) {
      setSessionStats((prev) => ({
        ...prev,
        totalXpGained: prev.totalXpGained + xpGained,
      }));
    }
    if (type === "combat" && description.toLowerCase().includes("killed")) {
      setSessionStats((prev) => ({
        ...prev,
        kills: prev.kills + 1,
      }));
    }
    if (type === "death") {
      setSessionStats((prev) => ({
        ...prev,
        deaths: prev.deaths + 1,
      }));
    }
    if (details?.goldAmount) {
      setSessionStats((prev) => ({
        ...prev,
        goldEarned: prev.goldEarned + (details.goldAmount || 0),
      }));
    }
  };

  // Expose addActivity via ref for parent components
  // This would be used when we integrate with WebSocket events
  (
    window as unknown as { addAgentActivity?: typeof addActivity }
  ).addAgentActivity = addActivity;

  // Don't show if agent is inactive
  if (agent.status !== "active") {
    return null;
  }

  // Get icon for activity type
  const getActivityIcon = (activity: ActivityEvent) => {
    switch (activity.type) {
      case "combat":
        if (activity.description.toLowerCase().includes("killed")) {
          return <Swords size={10} className="text-red-400" />;
        }
        return <Swords size={10} className="text-orange-400" />;
      case "skill":
        if (activity.details?.skillName) {
          const skill = activity.details.skillName.toLowerCase();
          if (skill.includes("woodcut"))
            return <TreePine size={10} className="text-green-400" />;
          if (skill.includes("fish"))
            return <Fish size={10} className="text-blue-400" />;
          if (skill.includes("fire"))
            return <Flame size={10} className="text-orange-400" />;
          if (skill.includes("mining"))
            return <Pickaxe size={10} className="text-gray-400" />;
        }
        return <Activity size={10} className="text-green-400" />;
      case "item":
        if (activity.details?.goldAmount) {
          return <Coins size={10} className="text-yellow-400" />;
        }
        return <Package size={10} className="text-purple-400" />;
      case "goal":
        return <Target size={10} className="text-[#f2d08a]" />;
      case "death":
        return <Skull size={10} className="text-red-500" />;
      case "movement":
        return <MapPin size={10} className="text-blue-400" />;
      default:
        return <Activity size={10} className="text-[#f2d08a]/60" />;
    }
  };

  // Format timestamp as relative time
  const formatTime = (timestamp: number) => {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
  };

  const totalResources = Object.values(sessionStats.resourcesGathered).reduce(
    (a, b) => a + b,
    0,
  );

  return (
    <div className="border-t border-[#8b4513]/30 bg-[#0b0a15]/80">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-2 hover:bg-[#f2d08a]/5 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Activity size={14} className="text-[#f2d08a]/60" />
          <span className="text-xs font-bold text-[#f2d08a]/80 uppercase tracking-wider">
            Activity
          </span>
          {activities.length > 0 && (
            <span className="text-[10px] text-[#f2d08a]/50">
              {activities.length} events
            </span>
          )}
        </div>
        {expanded ? (
          <ChevronUp size={14} className="text-[#f2d08a]/40" />
        ) : (
          <ChevronDown size={14} className="text-[#f2d08a]/40" />
        )}
      </button>

      {/* Activity Content */}
      {expanded && (
        <div className="px-2 pb-2">
          {/* Session Stats Summary */}
          <div className="grid grid-cols-4 gap-1 mb-2">
            <div className="flex flex-col items-center p-1.5 rounded bg-red-500/10 border border-red-500/20">
              <Swords size={12} className="text-red-400 mb-0.5" />
              <span className="text-[10px] font-bold text-red-400">
                {sessionStats.kills}
              </span>
              <span className="text-[7px] text-red-400/60">Kills</span>
            </div>
            <div className="flex flex-col items-center p-1.5 rounded bg-gray-500/10 border border-gray-500/20">
              <Skull size={12} className="text-gray-400 mb-0.5" />
              <span className="text-[10px] font-bold text-gray-400">
                {sessionStats.deaths}
              </span>
              <span className="text-[7px] text-gray-400/60">Deaths</span>
            </div>
            <div className="flex flex-col items-center p-1.5 rounded bg-yellow-500/10 border border-yellow-500/20">
              <Coins size={12} className="text-yellow-400 mb-0.5" />
              <span className="text-[10px] font-bold text-yellow-400">
                {sessionStats.goldEarned}
              </span>
              <span className="text-[7px] text-yellow-400/60">Gold</span>
            </div>
            <div className="flex flex-col items-center p-1.5 rounded bg-green-500/10 border border-green-500/20">
              <Package size={12} className="text-green-400 mb-0.5" />
              <span className="text-[10px] font-bold text-green-400">
                {totalResources}
              </span>
              <span className="text-[7px] text-green-400/60">Items</span>
            </div>
          </div>

          {/* Recent Activity Feed */}
          <div className="text-[8px] text-[#f2d08a]/50 uppercase tracking-wider mb-1 font-medium">
            Recent Activity
          </div>

          {activities.length === 0 ? (
            <div className="text-center py-3 text-[9px] text-[#f2d08a]/40">
              No activity recorded yet
              <div className="text-[8px] opacity-60 mt-0.5">
                Events will appear as the agent plays
              </div>
            </div>
          ) : (
            <div className="space-y-0.5 max-h-32 overflow-y-auto">
              {activities.slice(0, 10).map((activity) => (
                <div
                  key={activity.id}
                  className="flex items-center gap-2 p-1 rounded bg-black/20 hover:bg-black/30 transition-colors"
                >
                  {getActivityIcon(activity)}
                  <span className="flex-1 text-[9px] text-[#e8ebf4]/70 truncate">
                    {activity.description}
                  </span>
                  {activity.xpGained && activity.xpGained > 0 && (
                    <span className="text-[8px] text-green-400/80">
                      +{activity.xpGained} XP
                    </span>
                  )}
                  <span className="text-[8px] text-[#f2d08a]/30">
                    {formatTime(activity.timestamp)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Live indicator */}
          {isViewportActive && (
            <div className="flex items-center justify-center gap-1 mt-2 pt-1 border-t border-[#8b4513]/20">
              <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              <span className="text-[9px] text-green-500/80">Live Feed</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
