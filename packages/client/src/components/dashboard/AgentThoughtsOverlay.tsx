import { GAME_API_URL } from "@/lib/api-config";
import React, { useState, useEffect, useRef } from "react";
import { Agent } from "../../screens/DashboardScreen";
import {
  ChevronDown,
  ChevronUp,
  Brain,
  Lightbulb,
  Target,
  Check,
  Trash2,
  RefreshCw,
  X,
  Maximize2,
  Minimize2,
} from "lucide-react";

// Configuration constants
const THOUGHTS_POLL_INTERVAL_MS = 3000;
const MAX_THOUGHTS_DISPLAYED = 20;

interface AgentThought {
  id: string;
  type: "situation" | "evaluation" | "thinking" | "decision";
  content: string;
  timestamp: number;
}

interface AgentThoughtsOverlayProps {
  agent: Agent;
}

const getThoughtIcon = (type: AgentThought["type"], size = 12) => {
  switch (type) {
    case "situation":
      return <Brain size={size} className="text-blue-400" />;
    case "evaluation":
      return <Target size={size} className="text-yellow-400" />;
    case "thinking":
      return <Lightbulb size={size} className="text-purple-400" />;
    case "decision":
      return <Check size={size} className="text-green-400" />;
    default:
      return <Brain size={size} className="text-[#f2d08a]" />;
  }
};

const getThoughtBgColor = (type: AgentThought["type"]) => {
  switch (type) {
    case "situation":
      return "bg-blue-500/10 border-blue-500/30";
    case "evaluation":
      return "bg-yellow-500/10 border-yellow-500/30";
    case "thinking":
      return "bg-purple-500/10 border-purple-500/30";
    case "decision":
      return "bg-green-500/10 border-green-500/30";
    default:
      return "bg-[#f2d08a]/10 border-[#f2d08a]/30";
  }
};

const formatTimeAgo = (timestamp: number): string => {
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  if (seconds > 10) return `${seconds}s ago`;
  return "just now";
};

const renderThoughtContent = (content: string): React.ReactNode => {
  const lines = content.split("\n");

  return lines.map((line, idx) => {
    if (idx === 0 && !line.trim()) return null;

    if (line.startsWith("**") && line.endsWith("**") && line.includes(" ")) {
      const text = line.slice(2, -2);
      return (
        <div key={idx} className="font-bold text-[#f2d08a] mb-1">
          {text}
        </div>
      );
    }

    const parts: React.ReactNode[] = [];
    let lastIdx = 0;
    const boldRegex = /\*\*(.+?)\*\*/g;
    let match;

    while ((match = boldRegex.exec(line)) !== null) {
      if (match.index > lastIdx) {
        parts.push(line.slice(lastIdx, match.index));
      }
      parts.push(
        <span
          key={`bold-${idx}-${match.index}`}
          className="font-bold text-[#f2d08a]"
        >
          {match[1]}
        </span>,
      );
      lastIdx = match.index + match[0].length;
    }

    if (lastIdx < line.length) {
      parts.push(line.slice(lastIdx));
    }

    if (parts.length === 0) {
      return <div key={idx} className="h-1" />;
    }

    return (
      <div key={idx} className="text-[10px] text-[#e8ebf4]/80 leading-relaxed">
        {parts}
      </div>
    );
  });
};

export const AgentThoughtsOverlay: React.FC<AgentThoughtsOverlayProps> = ({
  agent,
}) => {
  const [thoughts, setThoughts] = useState<AgentThought[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [minimized, setMinimized] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastTimestampRef = useRef<number>(0);

  useEffect(() => {
    if (agent.status !== "active") {
      setThoughts([]);
      return;
    }

    fetchThoughts();
    const interval = setInterval(fetchThoughts, THOUGHTS_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [agent.id, agent.status]);

  useEffect(() => {
    if (scrollRef.current && thoughts.length > 0) {
      scrollRef.current.scrollTop = 0;
    }
  }, [thoughts]);

  const fetchThoughts = async () => {
    try {
      const sinceParam =
        lastTimestampRef.current > 0
          ? `&since=${lastTimestampRef.current}`
          : "";
      const response = await fetch(
        `${GAME_API_URL}/api/agents/${agent.id}/thoughts?limit=${MAX_THOUGHTS_DISPLAYED}${sinceParam}`,
      );

      if (!response.ok) {
        if (response.status === 503) {
          setError("Service not ready");
          return;
        }
        throw new Error(`Failed: ${response.status}`);
      }

      const data = await response.json();

      if (data.thoughts && data.thoughts.length > 0) {
        lastTimestampRef.current = data.thoughts[0].timestamp;

        setThoughts((prev) => {
          const existingIds = new Set(prev.map((t) => t.id));
          const newThoughts = data.thoughts.filter(
            (t: AgentThought) => !existingIds.has(t.id),
          );

          if (sinceParam && newThoughts.length > 0) {
            return [...newThoughts, ...prev].slice(0, MAX_THOUGHTS_DISPLAYED);
          }

          return data.thoughts.slice(0, MAX_THOUGHTS_DISPLAYED);
        });
      }

      setError(null);
    } catch (err) {
      console.error("[AgentThoughtsOverlay] Error fetching thoughts:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleClearThoughts = async () => {
    try {
      const response = await fetch(
        `${GAME_API_URL}/api/agents/${agent.id}/thoughts`,
        { method: "DELETE" },
      );

      if (!response.ok) {
        throw new Error("Failed to clear thoughts");
      }

      setThoughts([]);
      lastTimestampRef.current = 0;
    } catch (err) {
      console.error("[AgentThoughtsOverlay] Error clearing thoughts:", err);
      setError("Failed to clear");
    }
  };

  // Don't show if agent is inactive
  if (agent.status !== "active") {
    return null;
  }

  // Minimized state - just show a small button
  if (minimized) {
    return (
      <button
        onClick={() => setMinimized(false)}
        className="bg-black/70 backdrop-blur-md border border-purple-500/30 rounded-lg p-2 flex items-center gap-2 hover:bg-black/80 hover:border-purple-500/50 transition-all shadow-lg"
      >
        <Brain size={16} className="text-purple-400" />
        <span className="text-xs font-bold text-[#f2d08a]">Thoughts</span>
        {thoughts.length > 0 && (
          <span className="text-[10px] bg-purple-500/20 text-purple-300 px-1.5 py-0.5 rounded">
            {thoughts.length}
          </span>
        )}
        <Maximize2 size={12} className="text-[#f2d08a]/40" />
      </button>
    );
  }

  return (
    <div className="bg-black/80 backdrop-blur-md border border-[#8b4513]/50 rounded-lg shadow-2xl w-80 max-h-96 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-2 border-b border-[#8b4513]/30 bg-black/40">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 hover:bg-[#f2d08a]/5 rounded px-1 py-0.5 transition-colors"
        >
          <Brain size={14} className="text-purple-400" />
          <span className="text-xs font-bold text-[#f2d08a] uppercase tracking-wider">
            Agent Thoughts
          </span>
          {thoughts.length > 0 && (
            <span className="text-[10px] text-[#f2d08a]/50">
              ({thoughts.length})
            </span>
          )}
          {thoughts.length > 0 && (
            <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
          )}
          {expanded ? (
            <ChevronUp size={12} className="text-[#f2d08a]/40" />
          ) : (
            <ChevronDown size={12} className="text-[#f2d08a]/40" />
          )}
        </button>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setMinimized(true)}
            className="p-1 rounded hover:bg-[#f2d08a]/10 transition-colors"
            title="Minimize"
          >
            <Minimize2
              size={12}
              className="text-[#f2d08a]/40 hover:text-[#f2d08a]/80"
            />
          </button>
        </div>
      </div>

      {/* Content */}
      {expanded && (
        <div className="flex-1 overflow-hidden flex flex-col">
          {loading && thoughts.length === 0 ? (
            <div className="flex items-center justify-center py-4">
              <div className="animate-spin rounded-full h-4 w-4 border-t border-b border-[#f2d08a]/60" />
            </div>
          ) : error ? (
            <div className="text-center py-3 text-[10px] text-red-400/70">
              {error}
            </div>
          ) : thoughts.length === 0 ? (
            <div className="text-center py-4 text-[10px] text-[#f2d08a]/50">
              <Brain size={20} className="mx-auto mb-1 opacity-30" />
              No thoughts yet
              <div className="text-[9px] opacity-60 mt-1">
                Agent's decisions will appear here
              </div>
            </div>
          ) : (
            <>
              {/* Controls */}
              <div className="flex items-center justify-between px-2 py-1 border-b border-[#8b4513]/20">
                <div className="flex items-center gap-2">
                  <button
                    onClick={fetchThoughts}
                    className="p-1 rounded hover:bg-[#f2d08a]/10 transition-colors"
                    title="Refresh"
                  >
                    <RefreshCw
                      size={12}
                      className={`text-[#f2d08a]/40 hover:text-[#f2d08a]/80 ${loading ? "animate-spin" : ""}`}
                    />
                  </button>
                  <button
                    onClick={handleClearThoughts}
                    className="p-1 rounded hover:bg-red-500/10 transition-colors"
                    title="Clear thoughts"
                  >
                    <Trash2
                      size={12}
                      className="text-red-400/40 hover:text-red-400/80"
                    />
                  </button>
                </div>
                <span className="text-[9px] text-green-500/80 flex items-center gap-1">
                  <div className="w-1 h-1 rounded-full bg-green-500 animate-pulse" />
                  Live
                </span>
              </div>

              {/* Thoughts List */}
              <div
                ref={scrollRef}
                className="flex-1 overflow-y-auto p-2 space-y-2"
                style={{ scrollbarWidth: "thin" }}
              >
                {thoughts.map((thought) => (
                  <div
                    key={thought.id}
                    className={`p-2 rounded border ${getThoughtBgColor(thought.type)} transition-all duration-300`}
                  >
                    {/* Header */}
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1.5">
                        {getThoughtIcon(thought.type)}
                        <span className="text-[9px] font-bold uppercase text-[#e8ebf4]/70">
                          {thought.type}
                        </span>
                      </div>
                      <span className="text-[8px] text-[#f2d08a]/40">
                        {formatTimeAgo(thought.timestamp)}
                      </span>
                    </div>

                    {/* Content */}
                    <div className="pl-4">
                      {renderThoughtContent(thought.content)}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};
