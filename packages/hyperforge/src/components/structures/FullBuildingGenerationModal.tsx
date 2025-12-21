"use client";

/**
 * FullBuildingGenerationModal - Generate complete buildings via Meshy
 *
 * These are non-enterable, solid buildings that can be placed in towns.
 * Unlike modular buildings, these are generated as a single complete mesh.
 */

import { useState } from "react";
import {
  X,
  Sparkles,
  Loader2,
  Building2,
  Castle,
  Home,
  Store,
  Church,
  Warehouse,
} from "lucide-react";
import { cn, logger } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import { Label } from "@/components/ui/label";
import { NeonInput } from "@/components/ui/neon-input";
import { Slider } from "@/components/ui/slider";
import type { StructureDefinition } from "@/types/structures";

const log = logger.child("FullBuildingGenerationModal");

// =============================================================================
// TYPES
// =============================================================================

interface FullBuildingGenerationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onGenerated: (building: StructureDefinition) => void;
}

type BuildingStyle =
  | "medieval"
  | "fantasy"
  | "rustic"
  | "stone"
  | "wooden"
  | "castle";

interface BuildingTypePreset {
  id: string;
  name: string;
  icon: typeof Building2;
  prompt: string;
  style: BuildingStyle;
}

// =============================================================================
// PRESETS
// =============================================================================

const BUILDING_TYPES: BuildingTypePreset[] = [
  {
    id: "house",
    name: "House",
    icon: Home,
    prompt:
      "medieval cottage house with thatched roof, wooden beams, stone foundation",
    style: "medieval",
  },
  {
    id: "shop",
    name: "Shop",
    icon: Store,
    prompt:
      "medieval market shop with wooden storefront, hanging sign, shingled roof",
    style: "medieval",
  },
  {
    id: "tavern",
    name: "Tavern",
    icon: Building2,
    prompt:
      "medieval tavern inn with large chimney, multiple floors, wooden balcony",
    style: "medieval",
  },
  {
    id: "church",
    name: "Temple",
    icon: Church,
    prompt:
      "fantasy stone temple with tall spire, stained glass, ornate entrance",
    style: "fantasy",
  },
  {
    id: "warehouse",
    name: "Warehouse",
    icon: Warehouse,
    prompt:
      "medieval storage warehouse with large doors, stone walls, flat roof",
    style: "rustic",
  },
  {
    id: "castle",
    name: "Tower",
    icon: Castle,
    prompt:
      "fantasy wizard tower with pointed roof, stone walls, magical crystals",
    style: "fantasy",
  },
];

const STYLE_MODIFIERS: Record<BuildingStyle, string> = {
  medieval: "medieval european style, realistic textures, weathered materials",
  fantasy: "high fantasy style, magical elements, vibrant colors",
  rustic: "rustic countryside style, worn textures, natural materials",
  stone: "heavy stone construction, fortress-like, solid and imposing",
  wooden: "timber frame construction, wooden planks, cozy appearance",
  castle: "castle architecture, battlements, towers, defensive features",
};

const POLYCOUNT_RANGE = { min: 5000, max: 30000, default: 15000 };

// =============================================================================
// COMPONENT
// =============================================================================

export function FullBuildingGenerationModal({
  isOpen,
  onClose,
  onGenerated,
}: FullBuildingGenerationModalProps) {
  const { toast } = useToast();
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState("");

  // Form state
  const [selectedType, setSelectedType] = useState<string>("house");
  const [customName, setCustomName] = useState("");
  const [customPrompt, setCustomPrompt] = useState("");
  const [selectedStyle, setSelectedStyle] = useState<BuildingStyle>("medieval");
  const [targetPolycount, setTargetPolycount] = useState(
    POLYCOUNT_RANGE.default,
  );

  const selectedPreset = BUILDING_TYPES.find((t) => t.id === selectedType);

  const handleGenerate = async () => {
    setIsGenerating(true);
    setProgress("Starting generation...");

    try {
      // Build the prompt
      const basePrompt =
        customPrompt || selectedPreset?.prompt || "medieval building";
      const styleModifier = STYLE_MODIFIERS[selectedStyle];
      const fullPrompt = `${basePrompt}, ${styleModifier}, complete building exterior, no interior, solid structure, game asset, low poly stylized`;

      log.info("Generating full building", {
        type: selectedType,
        style: selectedStyle,
        polycount: targetPolycount,
      });

      setProgress("Generating 3D model with Meshy...");

      const response = await fetch("/api/structures/buildings/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: customName || selectedPreset?.name || "Building",
          prompt: fullPrompt,
          buildingType: selectedType,
          style: selectedStyle,
          targetPolycount,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Generation failed");
      }

      const result = await response.json();

      if (result.building) {
        setProgress("Complete!");
        onGenerated(result.building);
        toast({
          title: "Building Generated",
          description: `"${result.building.name}" is ready for town placement`,
        });
        onClose();

        // Reset form
        setCustomName("");
        setCustomPrompt("");
      }
    } catch (error) {
      log.error("Generation failed", { error });
      toast({
        title: "Generation Failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
      setProgress("");
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-lg mx-4 bg-glass-bg border border-glass-border rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-glass-border bg-purple-500/5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-500/20 flex items-center justify-center">
              <Building2 className="w-5 h-5 text-purple-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Generate Full Building</h2>
              <p className="text-xs text-muted-foreground">
                Create a complete building for town placement
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
          {/* Building Type Selection */}
          <div className="space-y-3">
            <Label className="text-sm">Building Type</Label>
            <div className="grid grid-cols-3 gap-2">
              {BUILDING_TYPES.map((type) => {
                const Icon = type.icon;
                return (
                  <button
                    key={type.id}
                    onClick={() => {
                      setSelectedType(type.id);
                      setSelectedStyle(type.style);
                    }}
                    className={cn(
                      "flex flex-col items-center gap-2 p-3 rounded-lg border-2 transition-all",
                      selectedType === type.id
                        ? "bg-purple-500/20 border-purple-500/50 text-purple-400"
                        : "bg-glass-bg border-glass-border hover:bg-white/5",
                    )}
                  >
                    <Icon className="w-6 h-6" />
                    <span className="text-xs font-medium">{type.name}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Style Selection */}
          <div className="space-y-3">
            <Label className="text-sm">Style</Label>
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(STYLE_MODIFIERS) as BuildingStyle[]).map(
                (style) => (
                  <button
                    key={style}
                    onClick={() => setSelectedStyle(style)}
                    className={cn(
                      "px-3 py-2 rounded-lg border text-xs font-medium capitalize transition-all",
                      selectedStyle === style
                        ? "bg-amber-500/20 border-amber-500/50 text-amber-400"
                        : "bg-glass-bg border-glass-border hover:bg-white/5",
                    )}
                  >
                    {style}
                  </button>
                ),
              )}
            </div>
          </div>

          {/* Custom Name */}
          <div className="space-y-2">
            <Label className="text-sm">Building Name (optional)</Label>
            <NeonInput
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              placeholder={selectedPreset?.name || "Building"}
              className="h-10"
            />
          </div>

          {/* Custom Prompt */}
          <div className="space-y-2">
            <Label className="text-sm">Custom Description (optional)</Label>
            <textarea
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              placeholder={selectedPreset?.prompt}
              rows={2}
              className="w-full px-3 py-2 bg-glass-bg/50 border border-glass-border rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-purple-500/50 placeholder:text-muted-foreground"
            />
          </div>

          {/* Polycount Slider */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm">Target Polycount</Label>
              <span className="text-sm font-mono text-purple-400">
                {targetPolycount.toLocaleString()}
              </span>
            </div>
            <Slider
              value={[targetPolycount]}
              onValueChange={([v]) => setTargetPolycount(v)}
              min={POLYCOUNT_RANGE.min}
              max={POLYCOUNT_RANGE.max}
              step={1000}
            />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>Low Detail</span>
              <span>High Detail</span>
            </div>
          </div>

          {/* Info Box */}
          <div className="p-3 rounded-lg bg-purple-500/10 border border-purple-500/20">
            <p className="text-xs text-purple-300">
              💡 Full buildings are solid, non-enterable structures. They're
              perfect for background buildings, landmarks, and town scenery.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-glass-border bg-glass-bg/50">
          <button
            onClick={onClose}
            disabled={isGenerating}
            className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:text-white hover:bg-white/10 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleGenerate}
            disabled={isGenerating}
            className={cn(
              "flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-medium transition-all",
              "bg-gradient-to-r from-purple-500 to-pink-600 text-white",
              "hover:from-purple-400 hover:to-pink-500",
              isGenerating && "opacity-50 cursor-not-allowed",
            )}
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {progress || "Generating..."}
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                Generate Building
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
