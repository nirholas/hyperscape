"use client";

import { useState } from "react";
import {
  Scroll,
  Wand2,
  Loader2,
  Save,
  Target,
  Gift,
  AlertCircle,
  Plus,
  Trash2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { SpectacularButton } from "@/components/ui/spectacular-button";
import { NeonInput } from "@/components/ui/neon-input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import type {
  Quest,
  QuestObjective,
  QuestReward,
  GeneratedQuestContent,
} from "@/types/game/content-types";

interface QuestGeneratorProps {
  onContentGenerated?: (content: GeneratedQuestContent) => void;
}

const difficultyColors: Record<string, string> = {
  easy: "text-green-400 bg-green-500/10",
  medium: "text-yellow-400 bg-yellow-500/10",
  hard: "text-orange-400 bg-orange-500/10",
  legendary: "text-purple-400 bg-purple-500/10",
};

const objectiveTypeIcons: Record<string, string> = {
  kill: "⚔️",
  collect: "📦",
  deliver: "📬",
  talk: "💬",
  explore: "🗺️",
  craft: "🔨",
  skill: "📊",
  interact: "👆",
};

export function QuestGenerator({ onContentGenerated }: QuestGeneratorProps) {
  const { toast } = useToast();
  const [isGenerating, setIsGenerating] = useState(false);

  // Form state
  const [questName, setQuestName] = useState("");
  const [category, setCategory] = useState<"main" | "side" | "daily" | "event">(
    "side",
  );
  const [difficulty, setDifficulty] = useState<
    "easy" | "medium" | "hard" | "legendary"
  >("medium");
  const [targetLevel, setTargetLevel] = useState("10");
  const [theme, setTheme] = useState("");
  const [objectives, setObjectives] = useState("");
  const [lore, setLore] = useState("");

  // Quest giver
  const [startNpcId, setStartNpcId] = useState("");
  const [startNpcName, setStartNpcName] = useState("");

  // Generated content
  const [generatedContent, setGeneratedContent] =
    useState<GeneratedQuestContent | null>(null);
  const [expandedSections, setExpandedSections] = useState<
    Record<string, boolean>
  >({
    objectives: true,
    rewards: true,
    requirements: false,
  });

  const categoryOptions = [
    { value: "main", label: "Main Quest" },
    { value: "side", label: "Side Quest" },
    { value: "daily", label: "Daily Quest" },
    { value: "event", label: "Event Quest" },
  ];

  const difficultyOptions = [
    { value: "easy", label: "Easy (Lv 1-10)" },
    { value: "medium", label: "Medium (Lv 10-30)" },
    { value: "hard", label: "Hard (Lv 30-60)" },
    { value: "legendary", label: "Legendary (Lv 60+)" },
  ];

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  const handleGenerate = async () => {
    setIsGenerating(true);

    try {
      const response = await fetch("/api/content/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "quest",
          name: questName || undefined,
          category,
          difficulty,
          targetLevel: parseInt(targetLevel) || 10,
          theme: theme || undefined,
          objectives: objectives || undefined,
          lore: lore || undefined,
          startNpc:
            startNpcId && startNpcName
              ? { id: startNpcId, name: startNpcName }
              : undefined,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Generation failed");
      }

      const result = await response.json();
      setGeneratedContent(result.content);

      toast({
        variant: "success",
        title: "Quest Generated",
        description: `Created "${result.content.quest.name}" with ${result.content.quest.objectives.length} objectives`,
      });

      onContentGenerated?.(result.content);
    } catch (error) {
      console.error("Generation failed:", error);
      toast({
        variant: "destructive",
        title: "Generation Failed",
        description:
          error instanceof Error ? error.message : "Failed to generate quest",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleExportManifest = async () => {
    if (!generatedContent) return;

    try {
      // For now, just copy to clipboard
      const manifestEntry = {
        ...generatedContent.quest,
        generatedAt: generatedContent.generatedAt,
      };

      await navigator.clipboard.writeText(
        JSON.stringify(manifestEntry, null, 2),
      );

      toast({
        variant: "success",
        title: "Copied to Clipboard",
        description: "Quest manifest copied. Add to quests.json",
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Export Failed",
        description:
          error instanceof Error ? error.message : "Failed to export",
      });
    }
  };

  return (
    <div className="h-full overflow-y-auto themed-scrollbar p-4 space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-2">Quest Generator</h2>
        <p className="text-sm text-muted-foreground">
          Generate complete quests with objectives, rewards, and dialogue
          triggers.
        </p>
      </div>

      {/* Basic Info */}
      <GlassPanel className="p-4 space-y-4">
        <h3 className="font-semibold flex items-center gap-2">
          <Scroll className="w-4 h-4" />
          Quest Details
        </h3>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Quest Name (optional)</Label>
            <NeonInput
              value={questName}
              onChange={(e) => setQuestName(e.target.value)}
              placeholder="Leave empty to auto-generate"
            />
          </div>
          <div className="space-y-2">
            <Label>Category</Label>
            <Select
              value={category}
              onChange={(v) => setCategory(v as typeof category)}
              options={categoryOptions}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Difficulty</Label>
            <Select
              value={difficulty}
              onChange={(v) => setDifficulty(v as typeof difficulty)}
              options={difficultyOptions}
            />
          </div>
          <div className="space-y-2">
            <Label>Recommended Level</Label>
            <NeonInput
              type="number"
              value={targetLevel}
              onChange={(e) => setTargetLevel(e.target.value)}
              placeholder="10"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label>Theme/Setting</Label>
          <NeonInput
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
            placeholder="e.g., goblin invasion, treasure hunt, rescue mission"
          />
        </div>
      </GlassPanel>

      {/* Quest Giver */}
      <GlassPanel className="p-4 space-y-4">
        <h3 className="font-semibold">Quest Giver (Optional)</h3>
        <p className="text-xs text-muted-foreground">
          Link to an existing NPC or leave empty to auto-generate
        </p>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>NPC ID</Label>
            <NeonInput
              value={startNpcId}
              onChange={(e) => setStartNpcId(e.target.value)}
              placeholder="e.g., guard_captain"
            />
          </div>
          <div className="space-y-2">
            <Label>NPC Name</Label>
            <NeonInput
              value={startNpcName}
              onChange={(e) => setStartNpcName(e.target.value)}
              placeholder="e.g., Captain Marcus"
            />
          </div>
        </div>
      </GlassPanel>

      {/* Objectives Hint */}
      <GlassPanel className="p-4 space-y-4">
        <h3 className="font-semibold">Objectives (Optional)</h3>
        <p className="text-xs text-muted-foreground">
          Describe what players should do. AI will expand into detailed
          objectives.
        </p>

        <textarea
          value={objectives}
          onChange={(e) => setObjectives(e.target.value)}
          className="w-full h-20 p-2 bg-glass-bg border border-glass-border rounded text-sm resize-none"
          placeholder="e.g., Kill goblins, collect their ears, return to the guard captain for a reward"
        />
      </GlassPanel>

      {/* World Lore */}
      <GlassPanel className="p-4 space-y-4">
        <h3 className="font-semibold">World Lore (Optional)</h3>
        <textarea
          value={lore}
          onChange={(e) => setLore(e.target.value)}
          className="w-full h-20 p-2 bg-glass-bg border border-glass-border rounded text-sm resize-none"
          placeholder="Add context about the game world to make the quest more immersive..."
        />
      </GlassPanel>

      {/* Generate Button */}
      <SpectacularButton
        className="w-full"
        size="lg"
        onClick={handleGenerate}
        disabled={isGenerating}
      >
        {isGenerating ? (
          <>
            <Loader2 className="w-5 h-5 mr-2 animate-spin" />
            Generating Quest...
          </>
        ) : (
          <>
            <Wand2 className="w-5 h-5 mr-2" />
            Generate Quest
          </>
        )}
      </SpectacularButton>

      {/* Generated Content */}
      {generatedContent && (
        <GlassPanel className="p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-lg">
                {generatedContent.quest.name}
              </h3>
              <div className="flex items-center gap-2 mt-1">
                <Badge
                  className={cn(
                    "text-xs",
                    difficultyColors[generatedContent.quest.difficulty],
                  )}
                >
                  {generatedContent.quest.difficulty}
                </Badge>
                <Badge variant="outline" className="text-xs">
                  {generatedContent.quest.category}
                </Badge>
                <Badge variant="outline" className="text-xs">
                  Lv. {generatedContent.quest.recommendedLevel}
                </Badge>
              </div>
            </div>
            <SpectacularButton size="sm" onClick={handleExportManifest}>
              <Save className="w-4 h-4 mr-2" />
              Export
            </SpectacularButton>
          </div>

          <p className="text-sm text-muted-foreground">
            {generatedContent.quest.description}
          </p>

          {generatedContent.quest.lore && (
            <div className="p-3 bg-glass-bg/50 rounded text-sm italic text-muted-foreground">
              {generatedContent.quest.lore}
            </div>
          )}

          {/* Objectives Section */}
          <div className="border-t border-glass-border pt-4">
            <button
              onClick={() => toggleSection("objectives")}
              className="w-full flex items-center justify-between py-1"
            >
              <span className="font-semibold flex items-center gap-2">
                <Target className="w-4 h-4" />
                Objectives ({generatedContent.quest.objectives.length})
              </span>
              {expandedSections.objectives ? (
                <ChevronUp className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
            </button>

            {expandedSections.objectives && (
              <div className="space-y-2 mt-3">
                {generatedContent.quest.objectives.map((obj, i) => (
                  <div
                    key={obj.id}
                    className="flex items-start gap-3 p-2 rounded bg-glass-bg/50"
                  >
                    <span className="text-lg">
                      {objectiveTypeIcons[obj.type] || "📋"}
                    </span>
                    <div className="flex-1">
                      <p className="text-sm font-medium">{obj.description}</p>
                      <p className="text-xs text-muted-foreground">
                        {obj.targetName} × {obj.quantity}
                        {obj.optional && " (Optional)"}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Rewards Section */}
          <div className="border-t border-glass-border pt-4">
            <button
              onClick={() => toggleSection("rewards")}
              className="w-full flex items-center justify-between py-1"
            >
              <span className="font-semibold flex items-center gap-2">
                <Gift className="w-4 h-4" />
                Rewards ({generatedContent.quest.rewards.length})
              </span>
              {expandedSections.rewards ? (
                <ChevronUp className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
            </button>

            {expandedSections.rewards && (
              <div className="space-y-2 mt-3">
                {generatedContent.quest.rewards.map((reward, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between p-2 rounded bg-glass-bg/50 text-sm"
                  >
                    <span>{reward.name}</span>
                    <Badge variant="outline">
                      {reward.type === "gold" && "🪙"}
                      {reward.type === "xp" && "⭐"}
                      {reward.type === "item" && "📦"}
                      {reward.type === "skill_xp" && "📊"}{" "}
                      {reward.quantity.toLocaleString()}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Requirements Section */}
          {generatedContent.quest.requirements &&
            generatedContent.quest.requirements.length > 0 && (
              <div className="border-t border-glass-border pt-4">
                <button
                  onClick={() => toggleSection("requirements")}
                  className="w-full flex items-center justify-between py-1"
                >
                  <span className="font-semibold flex items-center gap-2">
                    <AlertCircle className="w-4 h-4" />
                    Requirements ({generatedContent.quest.requirements.length})
                  </span>
                  {expandedSections.requirements ? (
                    <ChevronUp className="w-4 h-4" />
                  ) : (
                    <ChevronDown className="w-4 h-4" />
                  )}
                </button>

                {expandedSections.requirements && (
                  <div className="space-y-2 mt-3">
                    {generatedContent.quest.requirements.map((req, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between p-2 rounded bg-glass-bg/50 text-sm"
                      >
                        <span>{req.name}</span>
                        {req.value && (
                          <Badge variant="outline">Lv. {req.value}</Badge>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

          {/* Quest Giver Info */}
          <div className="border-t border-glass-border pt-4 flex justify-between text-sm">
            <span className="text-muted-foreground">Quest Giver</span>
            <span>
              {generatedContent.quest.startNpcName} (
              {generatedContent.quest.startNpcId})
            </span>
          </div>
        </GlassPanel>
      )}
    </div>
  );
}
