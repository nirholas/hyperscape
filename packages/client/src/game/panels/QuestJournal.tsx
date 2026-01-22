/**
 * QuestJournal - OSRS-style quest tracking interface
 *
 * Features:
 * - Quest list with color-coded status (red/yellow/green)
 * - Total quest points display
 * - Quest detail view with strikethrough for completed steps
 * - Dynamic progress counters
 */

import React, { useState, useEffect } from "react";
import { EventType } from "@hyperscape/shared";
import type { ClientWorld } from "../../types";

interface QuestJournalProps {
  world: ClientWorld;
  visible: boolean;
  onClose: () => void;
}

interface QuestListItem {
  id: string;
  name: string;
  status: "not_started" | "in_progress" | "ready_to_complete" | "completed";
  difficulty: string;
  questPoints: number;
}

interface QuestDetail {
  id: string;
  name: string;
  description: string;
  status: "not_started" | "in_progress" | "ready_to_complete" | "completed";
  difficulty: string;
  questPoints: number;
  currentStage: string;
  stageProgress: Record<string, number>;
  stages: Array<{
    id: string;
    description: string;
    type: string;
    target?: string;
    count?: number;
  }>;
}

// Status colors matching OSRS
const STATUS_COLORS = {
  not_started: "#ff4444", // Red
  in_progress: "#ffff00", // Yellow
  ready_to_complete: "#ffff00", // Yellow (same as in_progress visually)
  completed: "#00ff00", // Green
};

export function QuestJournal({ world, visible, onClose }: QuestJournalProps) {
  const [quests, setQuests] = useState<QuestListItem[]>([]);
  const [selectedQuest, setSelectedQuest] = useState<QuestDetail | null>(null);
  const [selectedQuestId, setSelectedQuestId] = useState<string | null>(null);
  const [questPoints, setQuestPoints] = useState(0);
  const [loading, setLoading] = useState(true);

  // Fetch quest data on mount and when visible
  useEffect(() => {
    if (!visible) return;

    const fetchQuestData = () => {
      // Request quest list from server
      if (world.network?.send) {
        world.network.send("getQuestList", {});
      }
    };

    const fetchQuestDetail = (questId: string) => {
      if (world.network?.send) {
        world.network.send("getQuestDetail", { questId });
      }
    };

    // Always fetch fresh data when panel opens
    fetchQuestData();
    // If a quest was previously selected, refresh its detail too
    if (selectedQuestId) {
      fetchQuestDetail(selectedQuestId);
    }

    // Listen for quest list updates via network packets
    const onQuestListUpdate = (data: unknown) => {
      const payload = data as {
        quests: QuestListItem[];
        questPoints: number;
      };
      setQuests(payload.quests || []);
      setQuestPoints(payload.questPoints || 0);
      setLoading(false);
    };

    // Listen for quest detail updates via network packets
    const onQuestDetailUpdate = (data: unknown) => {
      const payload = data as QuestDetail;
      setSelectedQuest(payload);
      setSelectedQuestId(payload.id);
    };

    // Register network packet handlers
    world.network?.on("questList", onQuestListUpdate);
    world.network?.on("questDetail", onQuestDetailUpdate);

    // Also listen for quest events to refresh
    const onQuestEvent = () => {
      fetchQuestData();
    };

    // Listen for quest progress to update the detail view
    const onQuestProgressed = (data: unknown) => {
      const payload = data as {
        questId: string;
        progress: Record<string, number>;
      };
      // Refresh list
      fetchQuestData();
      // Refresh the quest detail that progressed
      if (payload.questId) {
        fetchQuestDetail(payload.questId);
      }
    };

    world.on(EventType.QUEST_STARTED, onQuestEvent);
    world.on(EventType.QUEST_PROGRESSED, onQuestProgressed);
    world.on(EventType.QUEST_COMPLETED, onQuestEvent);

    return () => {
      world.network?.off("questList", onQuestListUpdate);
      world.network?.off("questDetail", onQuestDetailUpdate);
      world.off(EventType.QUEST_STARTED, onQuestEvent);
      world.off(EventType.QUEST_PROGRESSED, onQuestProgressed);
      world.off(EventType.QUEST_COMPLETED, onQuestEvent);
    };
  }, [visible, world, selectedQuestId]);

  const handleSelectQuest = (questId: string) => {
    // Request quest details from server
    if (world.network?.send) {
      world.network.send("getQuestDetail", { questId });
    }
  };

  const handleBackToList = () => {
    setSelectedQuest(null);
    setSelectedQuestId(null);
  };

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center pointer-events-auto"
      style={{ backgroundColor: "rgba(0, 0, 0, 0.7)" }}
      onClick={onClose}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div
        className="relative"
        style={{
          width: "28rem",
          maxWidth: "90vw",
          maxHeight: "80vh",
          background: "rgba(11, 10, 21, 0.98)",
          border: "2px solid #c9a227",
          borderRadius: "0.5rem",
          padding: "1.5rem",
          backdropFilter: "blur(10px)",
          boxShadow: "0 8px 32px rgba(0, 0, 0, 0.5)",
          display: "flex",
          flexDirection: "column",
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
          <div className="flex items-center gap-3">
            {selectedQuest && (
              <button
                onClick={handleBackToList}
                className="text-gray-400 hover:text-white cursor-pointer"
                title="Back to list"
              >
                ←
              </button>
            )}
            <h3 className="m-0 text-lg font-bold" style={{ color: "#c9a227" }}>
              {selectedQuest ? selectedQuest.name : "Quest Journal"}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="bg-transparent border-none text-gray-400 hover:text-white cursor-pointer text-xl leading-none"
            title="Close"
          >
            ×
          </button>
        </div>

        {/* Quest Points (list view only) */}
        {!selectedQuest && (
          <div
            className="text-center mb-4 py-2"
            style={{
              color: "#c9a227",
              backgroundColor: "rgba(201, 162, 39, 0.1)",
              borderRadius: "4px",
            }}
          >
            Quest Points: <strong>{questPoints}</strong>
          </div>
        )}

        {/* Content Area */}
        <div
          className="flex-1 overflow-y-auto"
          style={{
            scrollbarWidth: "thin",
            scrollbarColor: "#c9a227 rgba(0,0,0,0.3)",
          }}
        >
          {loading ? (
            <div className="text-center py-8" style={{ color: "#888" }}>
              Loading quests...
            </div>
          ) : selectedQuest ? (
            <QuestDetailView quest={selectedQuest} />
          ) : (
            <QuestListView quests={quests} onSelectQuest={handleSelectQuest} />
          )}
        </div>
      </div>
    </div>
  );
}

// Quest List View Component
function QuestListView({
  quests,
  onSelectQuest,
}: {
  quests: QuestListItem[];
  onSelectQuest: (questId: string) => void;
}) {
  if (quests.length === 0) {
    return (
      <div className="text-center py-8" style={{ color: "#888" }}>
        No quests available yet.
      </div>
    );
  }

  // Sort quests: in_progress first, then not_started, then completed
  const sortedQuests = [...quests].sort((a, b) => {
    const order = {
      in_progress: 0,
      ready_to_complete: 0,
      not_started: 1,
      completed: 2,
    };
    return order[a.status] - order[b.status];
  });

  return (
    <div className="space-y-1">
      {sortedQuests.map((quest) => (
        <button
          key={quest.id}
          onClick={() => onSelectQuest(quest.id)}
          className="w-full text-left p-2 transition-colors"
          style={{
            background: "rgba(45, 35, 25, 0.5)",
            border: "1px solid #5c4a3a",
            borderRadius: "4px",
            cursor: "pointer",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = "#c9a227";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = "#5c4a3a";
          }}
        >
          <div className="flex items-center justify-between">
            <span
              className="font-medium"
              style={{ color: STATUS_COLORS[quest.status] }}
            >
              {quest.name}
            </span>
            <span className="text-xs" style={{ color: "#888" }}>
              {quest.difficulty}
            </span>
          </div>
        </button>
      ))}
    </div>
  );
}

// Quest Detail View Component
function QuestDetailView({ quest }: { quest: QuestDetail }) {
  // Determine which stages are completed
  const getStageStatus = (
    stageIndex: number,
  ): "completed" | "current" | "future" => {
    const currentStageIndex = quest.stages.findIndex(
      (s) => s.id === quest.currentStage,
    );

    if (quest.status === "completed") {
      return "completed";
    }

    if (stageIndex < currentStageIndex) {
      return "completed";
    } else if (stageIndex === currentStageIndex) {
      return "current";
    }
    return "future";
  };

  // Get progress text for a specific stage (inline display)
  const getStageProgress = (stage: QuestDetail["stages"][0]): string | null => {
    if (!stage.count) return null;

    if (stage.type === "kill" && stage.target) {
      const kills = quest.stageProgress.kills || 0;
      return `(${kills}/${stage.count})`;
    }

    if (stage.type === "gather" && stage.target) {
      const gathered = quest.stageProgress[stage.target] || 0;
      return `(${gathered}/${stage.count})`;
    }

    if (stage.type === "interact" && stage.target) {
      const interacted = quest.stageProgress[stage.target] || 0;
      return `(${interacted}/${stage.count})`;
    }

    return null;
  };

  return (
    <div className="space-y-4">
      {/* Quest Info */}
      <div
        className="p-3 rounded"
        style={{ backgroundColor: "rgba(45, 35, 25, 0.5)" }}
      >
        <div className="flex justify-between items-center mb-2">
          <span className="text-sm" style={{ color: "#888" }}>
            Difficulty: {quest.difficulty}
          </span>
          <span className="text-sm" style={{ color: "#c9a227" }}>
            {quest.questPoints} Quest Point{quest.questPoints !== 1 ? "s" : ""}
          </span>
        </div>
        <p className="text-sm m-0" style={{ color: "#ccc" }}>
          {quest.description}
        </p>
      </div>

      {/* Quest Status */}
      <div
        className="text-center py-2 rounded"
        style={{
          backgroundColor:
            quest.status === "completed"
              ? "rgba(0, 255, 0, 0.1)"
              : quest.status === "not_started"
                ? "rgba(255, 68, 68, 0.1)"
                : "rgba(255, 255, 0, 0.1)",
          color: STATUS_COLORS[quest.status],
        }}
      >
        {quest.status === "completed"
          ? "Quest Complete!"
          : quest.status === "not_started"
            ? "Not Started"
            : quest.status === "ready_to_complete"
              ? "Ready to Complete"
              : "In Progress"}
      </div>

      {/* Quest Steps with Strikethrough */}
      <div className="space-y-2">
        <h4 className="text-sm font-bold m-0 mb-2" style={{ color: "#c9a227" }}>
          Quest Progress:
        </h4>
        {quest.stages.map((stage, index) => {
          const status = getStageStatus(index);
          const progress = getStageProgress(stage);
          const showProgress =
            progress && status !== "completed" && quest.status !== "completed";

          return (
            <div
              key={stage.id}
              className="text-sm flex justify-between items-center"
              style={{
                color:
                  status === "completed"
                    ? "#666"
                    : status === "current"
                      ? "#fff"
                      : "#444",
                textDecoration:
                  status === "completed" ? "line-through" : "none",
              }}
            >
              <span>• {stage.description}</span>
              {showProgress && (
                <span style={{ color: "#c9a227", marginLeft: "0.5rem" }}>
                  {progress}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
