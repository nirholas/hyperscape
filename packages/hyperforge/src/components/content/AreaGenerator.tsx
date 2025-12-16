"use client";

import { useState, useEffect } from "react";
import {
  Map,
  Wand2,
  Loader2,
  Save,
  Users,
  TreeDeciduous,
  Skull,
  Shield,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { SpectacularButton } from "@/components/ui/spectacular-button";
import { NeonInput } from "@/components/ui/neon-input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import type {
  WorldArea,
  GeneratedAreaContent,
} from "@/types/game/content-types";

interface AreaGeneratorProps {
  onContentGenerated?: (content: GeneratedAreaContent) => void;
}

const difficultyColors = [
  "text-green-400 bg-green-500/10", // 0 - Safe
  "text-blue-400 bg-blue-500/10", // 1 - Easy
  "text-cyan-400 bg-cyan-500/10", // 2 - Medium
  "text-yellow-400 bg-yellow-500/10", // 3 - Challenging
  "text-orange-400 bg-orange-500/10", // 4 - Hard
  "text-red-400 bg-red-500/10", // 5 - Deadly
];

export function AreaGenerator({ onContentGenerated }: AreaGeneratorProps) {
  const { toast } = useToast();
  const [isGenerating, setIsGenerating] = useState(false);

  // Form state
  const [areaName, setAreaName] = useState("");
  const [biome, setBiome] = useState("forest");
  const [difficultyLevel, setDifficultyLevel] = useState("1");
  const [size, setSize] = useState<"small" | "medium" | "large">("medium");
  const [safeZone, setSafeZone] = useState(false);
  const [theme, setTheme] = useState("");

  // Content options
  const [includeNpcs, setIncludeNpcs] = useState(true);
  const [includeResources, setIncludeResources] = useState(true);
  const [includeMobs, setIncludeMobs] = useState(true);

  // Generated content
  const [generatedContent, setGeneratedContent] =
    useState<GeneratedAreaContent | null>(null);
  const [expandedSections, setExpandedSections] = useState<
    Record<string, boolean>
  >({
    npcs: true,
    resources: true,
    mobs: true,
  });

  // Auto-disable mobs for safe zones
  useEffect(() => {
    if (safeZone) {
      setIncludeMobs(false);
    }
  }, [safeZone]);

  const biomeOptions = [
    { value: "plains", label: "Plains" },
    { value: "forest", label: "Forest" },
    { value: "mountains", label: "Mountains" },
    { value: "desert", label: "Desert" },
    { value: "swamp", label: "Swamp" },
    { value: "tundra", label: "Tundra" },
    { value: "lakes", label: "Lakes/River" },
    { value: "starter_town", label: "Town/Settlement" },
  ];

  const difficultyOptions = [
    { value: "0", label: "0 - Safe Zone" },
    { value: "1", label: "1 - Easy" },
    { value: "2", label: "2 - Medium" },
    { value: "3", label: "3 - Challenging" },
    { value: "4", label: "4 - Hard" },
    { value: "5", label: "5 - Deadly" },
  ];

  const sizeOptions = [
    { value: "small", label: "Small (20x20)" },
    { value: "medium", label: "Medium (40x40)" },
    { value: "large", label: "Large (80x80)" },
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
          type: "area",
          name: areaName || undefined,
          biome,
          difficultyLevel: parseInt(difficultyLevel),
          size,
          safeZone,
          theme: theme || undefined,
          includeNpcs,
          includeResources,
          includeMobs: includeMobs && !safeZone,
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
        title: "Area Generated",
        description: `Created "${result.content.area.name}"`,
      });

      onContentGenerated?.(result.content);
    } catch (error) {
      console.error("Generation failed:", error);
      toast({
        variant: "destructive",
        title: "Generation Failed",
        description:
          error instanceof Error ? error.message : "Failed to generate area",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleExportManifest = async () => {
    if (!generatedContent) return;

    try {
      const manifestEntry = {
        ...generatedContent.area,
        generatedAt: generatedContent.generatedAt,
      };

      await navigator.clipboard.writeText(
        JSON.stringify(manifestEntry, null, 2),
      );

      toast({
        variant: "success",
        title: "Copied to Clipboard",
        description: "Area manifest copied. Add to world-areas.json",
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
        <h2 className="text-xl font-semibold mb-2">Area Generator</h2>
        <p className="text-sm text-muted-foreground">
          Generate world areas with NPCs, resources, and mob spawns.
        </p>
      </div>

      {/* Basic Info */}
      <GlassPanel className="p-4 space-y-4">
        <h3 className="font-semibold flex items-center gap-2">
          <Map className="w-4 h-4" />
          Area Details
        </h3>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Area Name (optional)</Label>
            <NeonInput
              value={areaName}
              onChange={(e) => setAreaName(e.target.value)}
              placeholder="Leave empty to auto-generate"
            />
          </div>
          <div className="space-y-2">
            <Label>Biome Type</Label>
            <Select
              value={biome}
              onChange={(v) => setBiome(v)}
              options={biomeOptions}
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label>Difficulty</Label>
            <Select
              value={difficultyLevel}
              onChange={(v) => setDifficultyLevel(v)}
              options={difficultyOptions}
            />
          </div>
          <div className="space-y-2">
            <Label>Size</Label>
            <Select
              value={size}
              onChange={(v) => setSize(v as typeof size)}
              options={sizeOptions}
            />
          </div>
          <div className="space-y-2 flex items-end">
            <div className="flex items-center gap-2 pb-2">
              <Checkbox
                id="safeZone"
                checked={safeZone}
                onCheckedChange={(checked) => setSafeZone(checked === true)}
              />
              <Label
                htmlFor="safeZone"
                className="cursor-pointer flex items-center gap-1"
              >
                <Shield className="w-4 h-4 text-green-400" />
                Safe Zone
              </Label>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <Label>Theme/Description</Label>
          <NeonInput
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
            placeholder="e.g., haunted forest, mining outpost, fishing village"
          />
        </div>
      </GlassPanel>

      {/* Content Options */}
      <GlassPanel className="p-4 space-y-4">
        <h3 className="font-semibold">Content to Include</h3>

        <div className="flex flex-wrap gap-4">
          <div className="flex items-center gap-2">
            <Checkbox
              id="includeNpcs"
              checked={includeNpcs}
              onCheckedChange={(checked) => setIncludeNpcs(checked === true)}
            />
            <Label
              htmlFor="includeNpcs"
              className="cursor-pointer flex items-center gap-1"
            >
              <Users className="w-4 h-4" />
              NPCs
            </Label>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="includeResources"
              checked={includeResources}
              onCheckedChange={(checked) =>
                setIncludeResources(checked === true)
              }
            />
            <Label
              htmlFor="includeResources"
              className="cursor-pointer flex items-center gap-1"
            >
              <TreeDeciduous className="w-4 h-4" />
              Resources
            </Label>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="includeMobs"
              checked={includeMobs}
              disabled={safeZone}
              onCheckedChange={(checked) => setIncludeMobs(checked === true)}
            />
            <Label
              htmlFor="includeMobs"
              className={cn(
                "cursor-pointer flex items-center gap-1",
                safeZone && "opacity-50",
              )}
            >
              <Skull className="w-4 h-4" />
              Mob Spawns
            </Label>
          </div>
        </div>

        {safeZone && (
          <p className="text-xs text-muted-foreground">
            Safe zones cannot have mob spawns
          </p>
        )}
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
            Generating Area...
          </>
        ) : (
          <>
            <Wand2 className="w-5 h-5 mr-2" />
            Generate Area
          </>
        )}
      </SpectacularButton>

      {/* Generated Content */}
      {generatedContent && (
        <GlassPanel className="p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-lg">
                {generatedContent.area.name}
              </h3>
              <div className="flex items-center gap-2 mt-1">
                <Badge
                  className={cn(
                    "text-xs",
                    difficultyColors[generatedContent.area.difficultyLevel],
                  )}
                >
                  Difficulty {generatedContent.area.difficultyLevel}
                </Badge>
                <Badge variant="outline" className="text-xs">
                  {generatedContent.area.biomeType}
                </Badge>
                {generatedContent.area.safeZone && (
                  <Badge className="text-xs bg-green-500/10 text-green-400">
                    <Shield className="w-3 h-3 mr-1" />
                    Safe Zone
                  </Badge>
                )}
              </div>
            </div>
            <SpectacularButton size="sm" onClick={handleExportManifest}>
              <Save className="w-4 h-4 mr-2" />
              Export
            </SpectacularButton>
          </div>

          <p className="text-sm text-muted-foreground">
            {generatedContent.area.description}
          </p>

          {/* Bounds Info */}
          <div className="text-xs text-muted-foreground flex gap-4">
            <span>
              Bounds: ({generatedContent.area.bounds.minX},{" "}
              {generatedContent.area.bounds.minZ}) to (
              {generatedContent.area.bounds.maxX},{" "}
              {generatedContent.area.bounds.maxZ})
            </span>
            {generatedContent.area.ambientSound && (
              <span>🔊 {generatedContent.area.ambientSound}</span>
            )}
          </div>

          {/* NPCs Section */}
          {generatedContent.area.npcs.length > 0 && (
            <div className="border-t border-glass-border pt-4">
              <button
                onClick={() => toggleSection("npcs")}
                className="w-full flex items-center justify-between py-1"
              >
                <span className="font-semibold flex items-center gap-2">
                  <Users className="w-4 h-4" />
                  NPCs ({generatedContent.area.npcs.length})
                </span>
                {expandedSections.npcs ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
              </button>

              {expandedSections.npcs && (
                <div className="space-y-2 mt-3">
                  {generatedContent.area.npcs.map((npc, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between p-2 rounded bg-glass-bg/50 text-sm"
                    >
                      <span className="font-medium">{npc.id}</span>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">
                          {npc.type}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          ({npc.position.x}, {npc.position.z})
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Resources Section */}
          {generatedContent.area.resources.length > 0 && (
            <div className="border-t border-glass-border pt-4">
              <button
                onClick={() => toggleSection("resources")}
                className="w-full flex items-center justify-between py-1"
              >
                <span className="font-semibold flex items-center gap-2">
                  <TreeDeciduous className="w-4 h-4" />
                  Resources ({generatedContent.area.resources.length})
                </span>
                {expandedSections.resources ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
              </button>

              {expandedSections.resources && (
                <div className="space-y-2 mt-3">
                  {generatedContent.area.resources.map((res, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between p-2 rounded bg-glass-bg/50 text-sm"
                    >
                      <span>{res.resourceId}</span>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">
                          {res.type}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          ({res.position.x}, {res.position.z})
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Mob Spawns Section */}
          {generatedContent.area.mobSpawns.length > 0 && (
            <div className="border-t border-glass-border pt-4">
              <button
                onClick={() => toggleSection("mobs")}
                className="w-full flex items-center justify-between py-1"
              >
                <span className="font-semibold flex items-center gap-2">
                  <Skull className="w-4 h-4" />
                  Mob Spawns ({generatedContent.area.mobSpawns.length})
                </span>
                {expandedSections.mobs ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
              </button>

              {expandedSections.mobs && (
                <div className="space-y-2 mt-3">
                  {generatedContent.area.mobSpawns.map((mob, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between p-2 rounded bg-glass-bg/50 text-sm"
                    >
                      <span className="font-medium">
                        {mob.mobName || mob.mobId}
                      </span>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">
                          Max: {mob.maxCount}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          Radius: {mob.spawnRadius}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Color Scheme */}
          {generatedContent.area.colorScheme && (
            <div className="border-t border-glass-border pt-4">
              <p className="text-xs text-muted-foreground mb-2">Color Scheme</p>
              <div className="flex gap-2">
                <div
                  className="w-8 h-8 rounded border border-glass-border"
                  style={{
                    backgroundColor: generatedContent.area.colorScheme.primary,
                  }}
                  title="Primary"
                />
                <div
                  className="w-8 h-8 rounded border border-glass-border"
                  style={{
                    backgroundColor:
                      generatedContent.area.colorScheme.secondary,
                  }}
                  title="Secondary"
                />
                <div
                  className="w-8 h-8 rounded border border-glass-border"
                  style={{
                    backgroundColor: generatedContent.area.colorScheme.fog,
                  }}
                  title="Fog"
                />
              </div>
            </div>
          )}
        </GlassPanel>
      )}
    </div>
  );
}
