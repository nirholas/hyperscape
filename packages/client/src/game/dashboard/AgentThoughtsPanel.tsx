import { GAME_API_URL } from "@/lib/api-config";
import React, { useState, useEffect, useRef } from "react";
import { Agent } from "../../screens/DashboardScreen";
import { ChevronDown, ChevronUp, Scroll, Clock, RefreshCw } from "lucide-react";

// Configuration constants
const THOUGHTS_POLL_INTERVAL_MS = 3000;
const MAX_THOUGHTS_DISPLAYED = 20;
const FLASH_DURATION_MS = 1500; // How long the "new thought" flash lasts

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

const cleanThoughtContent = (content: string): string => {
  let cleaned = content.replace(/\*\*/g, "");
  cleaned = cleaned.trim().replace(/\n{3,}/g, "\n\n");
  return cleaned;
};

const renderThoughtContent = (content: string): React.ReactNode => {
  const cleaned = cleanThoughtContent(content);
  const lines = cleaned.split("\n");

  return (
    <div className="space-y-1">
      {lines.map((line, idx) => {
        if (!line.trim()) return null;
        return (
          <p key={idx} className="text-[11px] text-[#e8dcc8] leading-relaxed">
            {line}
          </p>
        );
      })}
    </div>
  );
};

export const AgentThoughtsPanel: React.FC<AgentThoughtsPanelProps> = ({
  agent,
  isViewportActive,
}) => {
  const [thoughts, setThoughts] = useState<AgentThought[]>([]);
  const [loading, setLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isNewThought, setIsNewThought] = useState(false);
  const lastTimestampRef = useRef<number>(0);
  const lastThoughtIdRef = useRef<string | null>(null);

  // Poll for thought updates
  useEffect(() => {
    if (agent.status !== "active") {
      setThoughts([]);
      return;
    }

    fetchThoughts();
    const interval = setInterval(fetchThoughts, THOUGHTS_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [agent.id, agent.status]);

  // Flash effect when new thought arrives
  useEffect(() => {
    if (isNewThought) {
      const timer = setTimeout(() => setIsNewThought(false), FLASH_DURATION_MS);
      return () => clearTimeout(timer);
    }
  }, [isNewThought]);

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

        // Check if there's a new thought
        const latestId = data.thoughts[0]?.id;
        if (latestId && latestId !== lastThoughtIdRef.current) {
          lastThoughtIdRef.current = latestId;
          // Only flash if we had a previous thought (not on initial load)
          if (thoughts.length > 0) {
            setIsNewThought(true);
          }
        }

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
      console.error("[AgentThoughtsPanel] Error fetching thoughts:", err);
    } finally {
      setLoading(false);
    }
  };

  // Don't show if agent is inactive
  if (agent.status !== "active") {
    return null;
  }

  // Get latest thought (most recent "thinking" type, or any recent thought)
  const latestThinking =
    thoughts.find((t) => t.type === "thinking") || thoughts[0];
  const olderThoughts = thoughts
    .filter((t) => t.id !== latestThinking?.id)
    .slice(0, 5);

  return (
    <div className="border-t border-[#8b4513]/40">
      {/* Header - RuneScape scroll style */}
      <div className="flex items-center justify-between px-3 py-2 bg-gradient-to-r from-[#2a1f0f] to-[#1a150a]">
        <div className="flex items-center gap-2">
          <div className="relative">
            <Scroll size={16} className="text-[#c9a227]" />
            {isViewportActive && thoughts.length > 0 && (
              <div className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-[#4ade80] animate-pulse" />
            )}
          </div>
          <span className="text-xs font-semibold text-[#f2d08a] tracking-wide">
            Agent's Mind
          </span>
          {isNewThought && (
            <span className="text-[9px] text-[#4ade80] font-medium animate-pulse">
              NEW
            </span>
          )}
        </div>
        <button
          onClick={fetchThoughts}
          className="p-1 rounded hover:bg-[#f2d08a]/10 transition-colors"
          title="Refresh"
        >
          <RefreshCw
            size={12}
            className={`text-[#c9a227]/60 hover:text-[#c9a227] ${loading ? "animate-spin" : ""}`}
          />
        </button>
      </div>

      {/* Main Content */}
      <div className="p-3 bg-[#0f0d08]">
        {loading && thoughts.length === 0 ? (
          <div className="flex items-center justify-center py-4">
            <div className="flex items-center gap-2 text-[#c9a227]/60">
              <Scroll size={14} className="animate-pulse" />
              <span className="text-[11px]">Reading the scrolls...</span>
            </div>
          </div>
        ) : error ? (
          <div className="text-center py-3 text-[11px] text-red-400/70">
            {error}
          </div>
        ) : !latestThinking ? (
          <div className="text-center py-4">
            <Scroll size={24} className="mx-auto mb-2 text-[#c9a227]/30" />
            <p className="text-[11px] text-[#c9a227]/50">
              The mind is quiet...
            </p>
            <p className="text-[10px] text-[#c9a227]/30 mt-1">
              Thoughts will appear here
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Current Thinking - Parchment style */}
            <div className="relative">
              {/* Header */}
              <div className="flex items-center gap-1.5 mb-2">
                <div
                  className={`w-2 h-2 rounded-full ${isNewThought ? "bg-[#4ade80] animate-ping" : "bg-[#c9a227]/60"}`}
                />
                <span className="text-[10px] font-medium text-[#c9a227] uppercase tracking-wider">
                  Current Thought
                </span>
                <span className="text-[9px] text-[#8b7355] ml-auto">
                  {formatTimeAgo(latestThinking.timestamp)}
                </span>
              </div>

              {/* Thought content - Parchment/scroll look */}
              <div
                className={`
                  relative rounded border p-3 transition-all duration-300
                  ${
                    isNewThought
                      ? "bg-[#3d2f1a] border-[#c9a227]/60 shadow-[0_0_12px_rgba(201,162,39,0.3)]"
                      : "bg-[#1f1a10] border-[#8b4513]/40"
                  }
                `}
              >
                {/* Decorative corner */}
                <div className="absolute top-0 left-0 w-3 h-3 border-t-2 border-l-2 border-[#8b4513]/60 rounded-tl" />
                <div className="absolute bottom-0 right-0 w-3 h-3 border-b-2 border-r-2 border-[#8b4513]/60 rounded-br" />

                {/* Content */}
                <div className="px-1">
                  {renderThoughtContent(latestThinking.content)}
                </div>
              </div>
            </div>

            {/* History Section (collapsible) */}
            {olderThoughts.length > 0 && (
              <div className="pt-2 border-t border-[#8b4513]/30">
                <button
                  onClick={() => setShowHistory(!showHistory)}
                  className="flex items-center gap-1.5 text-[10px] text-[#8b7355] hover:text-[#c9a227] transition-colors w-full"
                >
                  <Clock size={10} />
                  <span>Past thoughts ({olderThoughts.length})</span>
                  {showHistory ? (
                    <ChevronUp size={10} className="ml-auto" />
                  ) : (
                    <ChevronDown size={10} className="ml-auto" />
                  )}
                </button>

                {showHistory && (
                  <div
                    className="mt-2 space-y-2 max-h-40 overflow-y-auto pr-1"
                    style={{ scrollbarWidth: "thin" }}
                  >
                    {olderThoughts.map((thought) => (
                      <div
                        key={thought.id}
                        className="bg-[#151208] border border-[#8b4513]/20 rounded p-2"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[9px] text-[#8b7355] uppercase">
                            {thought.type}
                          </span>
                          <span className="text-[8px] text-[#8b7355]/60">
                            {formatTimeAgo(thought.timestamp)}
                          </span>
                        </div>
                        <p className="text-[10px] text-[#c9b896]/70 line-clamp-2">
                          {cleanThoughtContent(thought.content).slice(0, 150)}
                          {thought.content.length > 150 ? "..." : ""}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Live indicator */}
            {isViewportActive && (
              <div className="flex items-center justify-center gap-1.5 pt-2">
                <div className="w-1.5 h-1.5 rounded-full bg-[#4ade80] animate-pulse" />
                <span className="text-[9px] text-[#4ade80]/70">Live</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
