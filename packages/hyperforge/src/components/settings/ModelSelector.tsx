"use client";

import { useEffect } from "react";
import { RotateCcw, ChevronDown, Sparkles, Loader2 } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { cn } from "@/lib/utils";
import {
  useModelPreferencesStore,
  TASK_TYPE_INFO,
  DEFAULT_PREFERENCES,
  getModelsForTask,
  type TaskType,
} from "@/stores/model-preferences-store";

/**
 * Single model selector for a task type
 */
function TaskModelSelector({ taskKey }: { taskKey: TaskType }) {
  const { preferences, availableModels, setPreference, resetPreference } =
    useModelPreferencesStore();

  const taskInfo = TASK_TYPE_INFO.find((t) => t.key === taskKey);
  if (!taskInfo) return null;

  const currentModel = preferences[taskKey];
  const defaultModel = DEFAULT_PREFERENCES[taskKey];
  const isDefault = currentModel === defaultModel;

  const models = getModelsForTask(availableModels, taskKey);

  // Find current model info
  const currentModelInfo = models.find((m) => m.id === currentModel);

  // Provider color mapping
  const providerColors: Record<string, string> = {
    openai: "text-green-400",
    anthropic: "text-orange-400",
    google: "text-blue-400",
    xai: "text-purple-400",
    meta: "text-cyan-400",
  };

  return (
    <div className="border-b border-glass-border/50 last:border-b-0 py-4 px-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h4 className="font-medium text-sm text-foreground">
              {taskInfo.label}
            </h4>
            {!isDefault && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-400">
                Custom
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {taskInfo.description}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Model Selector */}
          <div className="relative">
            <select
              value={currentModel}
              onChange={(e) => setPreference(taskKey, e.target.value)}
              className={cn(
                "appearance-none bg-glass-bg border border-glass-border rounded-lg",
                "pl-3 pr-8 py-2 text-sm min-w-[240px]",
                "focus:outline-none focus:ring-1 focus:ring-cyan-500/50",
                "cursor-pointer",
              )}
            >
              {models.length > 0 ? (
                models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.id}
                  </option>
                ))
              ) : (
                <option value={currentModel}>{currentModel}</option>
              )}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          </div>

          {/* Reset Button */}
          <button
            onClick={() => resetPreference(taskKey)}
            disabled={isDefault}
            className={cn(
              "p-2 rounded-lg transition-colors",
              isDefault
                ? "text-muted-foreground/30 cursor-not-allowed"
                : "text-muted-foreground hover:text-foreground hover:bg-glass-bg",
            )}
            title={isDefault ? "Using default" : "Reset to default"}
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Model Info */}
      {currentModelInfo && (
        <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
          <span
            className={cn(
              "font-medium",
              providerColors[currentModelInfo.provider] || "text-foreground",
            )}
          >
            {currentModelInfo.provider}
          </span>
          {currentModelInfo.contextLength && (
            <span>
              Context: {(currentModelInfo.contextLength / 1000).toFixed(0)}K
            </span>
          )}
          {currentModelInfo.costPer1kInput !== undefined && (
            <span>${currentModelInfo.costPer1kInput.toFixed(4)}/1K input</span>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Model Configuration Panel
 * Shows all task types with model selectors
 */
export function ModelConfigurationPanel() {
  const {
    availableModels,
    isLoading,
    isSyncing,
    lastSynced,
    error,
    fetchAvailableModels,
    syncToSupabase,
    resetAllPreferences,
  } = useModelPreferencesStore();

  // Fetch models on mount
  useEffect(() => {
    if (!availableModels) {
      fetchAvailableModels();
    }
  }, [availableModels, fetchAvailableModels]);

  const formatLastSynced = () => {
    if (!lastSynced) return "Never";
    const date = new Date(lastSynced);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins} min ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24)
      return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
    return date.toLocaleDateString();
  };

  return (
    <GlassPanel className="overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-glass-border">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">
              AI Model Configuration
            </h3>
            <p className="text-xs text-muted-foreground">
              Select preferred models for each task type
            </p>
          </div>
        </div>

        {/* Model count */}
        {availableModels && (
          <div className="text-xs text-muted-foreground">
            {availableModels.all.length} models available
          </div>
        )}
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="p-8 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
          <span className="ml-2 text-sm text-muted-foreground">
            Loading available models...
          </span>
        </div>
      )}

      {/* Error State */}
      {error && !isLoading && (
        <div className="p-4 bg-red-500/10 border-b border-red-500/20">
          <p className="text-sm text-red-400">{error}</p>
          <button
            onClick={() => fetchAvailableModels()}
            className="mt-2 text-xs text-red-300 hover:text-red-200 underline"
          >
            Retry
          </button>
        </div>
      )}

      {/* Task Selectors */}
      {!isLoading && (
        <div>
          {TASK_TYPE_INFO.map((task) => (
            <TaskModelSelector key={task.key} taskKey={task.key} />
          ))}
        </div>
      )}

      {/* Footer Actions */}
      <div className="p-4 border-t border-glass-border bg-glass-bg/30 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => syncToSupabase()}
            disabled={isSyncing}
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm",
              "bg-gradient-to-r from-cyan-500 to-blue-600 text-white",
              "hover:from-cyan-400 hover:to-blue-500",
              "disabled:opacity-50 disabled:cursor-not-allowed",
              "transition-all duration-200",
            )}
          >
            {isSyncing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4" />
            )}
            Sync to Cloud
          </button>

          <button
            onClick={() => resetAllPreferences()}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Reset All to Defaults
          </button>
        </div>

        <div className="text-xs text-muted-foreground">
          Last synced: {formatLastSynced()}
        </div>
      </div>
    </GlassPanel>
  );
}
