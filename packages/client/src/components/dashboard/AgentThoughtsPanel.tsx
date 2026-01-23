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
} from "lucide-react";

// Configuration constants
const THOUGHTS_POLL_INTERVAL_MS = 3000; // Poll every 3 seconds for live updates
const MAX_THOUGHTS_DISPLAYED = 20; // Maximum thoughts to show in panel

/**
 * Thought type from the server
 */
interface AgentThought {
  id: string;
  type: "situation" | "evaluation" | "thinking" | "decision";
  content: string;
  timestamp: number;
}

interface AgentThoughtsPanelProps {
  agent: Agent;
  isViewportActive: boolean;
}

/**
 * Get icon for thought type
 */
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

/**
 * Get background color for thought type
 */
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

/**
 * Format timestamp relative to now
 */
const formatTimeAgo = (timestamp: number): string => {
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ago`;
  } else if (minutes > 0) {
    return `${minutes}m ago`;
  } else if (seconds > 10) {
    return `${seconds}s ago`;
  } else {
    return "just now";
  }
};

/**
 * Simple markdown-like rendering for thought content
 * Handles **bold**, headings, and line breaks
 */
const renderThoughtContent = (content: string): React.ReactNode => {
  const lines = content.split("\n");

  return lines.map((line, idx) => {
    // Skip empty lines at the start
    if (idx === 0 && !line.trim()) return null;

    // Handle headings (skip emoji-only headings like "🧠")
    if (line.startsWith("**") && line.endsWith("**") && line.includes(" ")) {
      const text = line.slice(2, -2);
      return (
        <div key={idx} className="font-bold text-[#f2d08a] mb-1">
          {text}
        </div>
      );
    }

    // Handle bold text inline
    const parts: React.ReactNode[] = [];
    let lastIdx = 0;
    const boldRegex = /\*\*(.+?)\*\*/g;
    let match;

    while ((match = boldRegex.exec(line)) !== null) {
      // Add text before the bold
      if (match.index > lastIdx) {
        parts.push(line.slice(lastIdx, match.index));
      }
      // Add bold text
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

    // Add remaining text
    if (lastIdx < line.length) {
      parts.push(line.slice(lastIdx));
    }

    // Return the line
    if (parts.length === 0) {
      return <div key={idx} className="h-1" />;
    }

    return (
      <div key={idx} className="text-[9px] text-[#e8ebf4]/80 leading-relaxed">
        {parts}
      </div>
    );
  });
};

export const AgentThoughtsPanel: React.FC<AgentThoughtsPanelProps> = ({
  agent,
  isViewportActive,
}) => {
  const [thoughts, setThoughts] = useState<AgentThought[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastTimestampRef = useRef<number>(0);

  // Poll for thought updates when viewport is active
  useEffect(() => {
    if (agent.status !== "active") {
      setThoughts([]);
      return;
    }

    // Fetch immediately
    fetchThoughts();

    // Poll at configured interval
    const interval = setInterval(fetchThoughts, THOUGHTS_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [agent.id, agent.status]);

  // Auto-scroll to bottom when new thoughts arrive
  useEffect(() => {
    if (autoScroll && scrollRef.current && thoughts.length > 0) {
      scrollRef.current.scrollTop = 0; // Scroll to top since newest is first
    }
  }, [thoughts, autoScroll]);

  const fetchThoughts = async () => {
    try {
      // Use since parameter for incremental updates
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
        // Update last timestamp for incremental fetches
        lastTimestampRef.current = data.thoughts[0].timestamp;

        // Merge new thoughts (avoid duplicates)
        setThoughts((prev) => {
          const existingIds = new Set(prev.map((t) => t.id));
          const newThoughts = data.thoughts.filter(
            (t: AgentThought) => !existingIds.has(t.id),
          );

          // If incremental update, prepend new thoughts
          if (sinceParam && newThoughts.length > 0) {
            return [...newThoughts, ...prev].slice(0, MAX_THOUGHTS_DISPLAYED);
          }

          // Otherwise replace all
          return data.thoughts.slice(0, MAX_THOUGHTS_DISPLAYED);
        });
      }

      setError(null);
    } catch (err) {
      console.error("[AgentThoughtsPanel] Error fetching thoughts:", err);
      // Don't show error on fetch failure - just keep last known state
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
      console.error("[AgentThoughtsPanel] Error clearing thoughts:", err);
      setError("Failed to clear");
    }
  };

  // Don't show if agent is inactive
  if (agent.status !== "active") {
    return null;
  }

  return (
    <div className="border-t border-[#8b4513]/30 bg-[#0b0a15]/80">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-2 hover:bg-[#f2d08a]/5 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Brain size={14} className="text-purple-400/60" />
          <span className="text-xs font-bold text-[#f2d08a]/80 uppercase tracking-wider">
            Agent Thoughts
          </span>
          {thoughts.length > 0 && (
            <span className="text-[10px] text-[#f2d08a]/50">
              ({thoughts.length})
            </span>
          )}
          {isViewportActive && thoughts.length > 0 && (
            <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
          )}
        </div>
        {expanded ? (
          <ChevronUp size={14} className="text-[#f2d08a]/40" />
        ) : (
          <ChevronDown size={14} className="text-[#f2d08a]/40" />
        )}
      </button>

      {/* Thoughts Display */}
      {expanded && (
        <div className="px-2 pb-2">
          {loading && thoughts.length === 0 ? (
            <div className="flex items-center justify-center py-3">
              <div className="animate-spin rounded-full h-4 w-4 border-t border-b border-[#f2d08a]/60" />
            </div>
          ) : error ? (
            <div className="text-center py-2 text-[10px] text-red-400/70">
              {error}
            </div>
          ) : thoughts.length === 0 ? (
            <div className="text-center py-3 text-[10px] text-[#f2d08a]/50">
              <Brain size={20} className="mx-auto mb-1 opacity-30" />
              No thoughts yet
              <div className="text-[9px] opacity-60 mt-1">
                The agent's decision process will appear here
              </div>
            </div>
          ) : (
            <>
              {/* Controls */}
              <div className="flex items-center justify-between mb-2">
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
                <label className="flex items-center gap-1 text-[9px] text-[#f2d08a]/50">
                  <input
                    type="checkbox"
                    checked={autoScroll}
                    onChange={(e) => setAutoScroll(e.target.checked)}
                    className="w-3 h-3 accent-[#f2d08a]"
                  />
                  Auto-scroll
                </label>
              </div>

              {/* Thoughts List */}
              <div
                ref={scrollRef}
                className="space-y-2 max-h-64 overflow-y-auto pr-1"
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

              {/* Live indicator */}
              {isViewportActive && (
                <div className="flex items-center justify-center gap-1 mt-2 pt-2 border-t border-[#8b4513]/20">
                  <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                  <span className="text-[9px] text-green-500/80">
                    Live Tracking
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};
