"use client";

/**
 * PieceGenerationModal - Modal for generating building pieces via Meshy
 *
 * Features:
 * - Select piece type and style
 * - Material presets for different looks
 * - Polycount control for performance tuning
 * - Custom prompt option
 * - Generation progress indicator
 * - Automatic save to piece library
 */

import { useState, useEffect } from "react";
import {
  X,
  Loader2,
  Sparkles,
  Check,
  AlertCircle,
  Square,
  DoorOpen,
  AppWindow,
  Home,
  Layers,
  ChevronDown,
  ChevronUp,
  Info,
} from "lucide-react";
import { cn, logger } from "@/lib/utils";
import { SpectacularButton } from "@/components/ui/spectacular-button";
import { Slider } from "@/components/ui/slider";
import type { BuildingPiece, BuildingPieceType } from "@/types/structures";
import { PIECE_TYPE_CONFIG } from "@/types/structures";

const log = logger.child("PieceGenerationModal");

// =============================================================================
// TYPES
// =============================================================================

interface PieceGenerationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onGenerated: (piece: BuildingPiece) => void;
  initialType?: BuildingPieceType;
}

type GenerationStatus = "idle" | "generating" | "success" | "error";

// Building-specific material preset
interface BuildingMaterialPreset {
  id: string;
  displayName: string;
  category: "stone" | "wood" | "roof" | "floor";
  color: string;
  stylePrompt: string;
  description: string;
  /** Which piece types this material works best with */
  suitableFor: BuildingPieceType[];
}

// =============================================================================
// CONSTANTS
// =============================================================================

const _PIECE_TYPES: BuildingPieceType[] = [
  "wall",
  "door",
  "window",
  "roof",
  "floor",
];

const TAB_ICONS: Record<BuildingPieceType, typeof Square> = {
  wall: Square,
  door: DoorOpen,
  window: AppWindow,
  roof: Home,
  floor: Layers,
};

const STYLE_OPTIONS: Record<BuildingPieceType, string[]> = {
  wall: ["Stone", "Brick", "Wood Plank", "Cobblestone", "Marble"],
  door: ["Wooden", "Iron Reinforced", "Double Wooden", "Ornate Carved"],
  window: [
    "Arched Stone",
    "Square Wooden",
    "Circular Stained Glass",
    "Iron Barred",
  ],
  roof: ["Clay Tile", "Thatch Straw", "Slate Stone", "Wooden Shingle"],
  floor: ["Stone Tile", "Wood Plank", "Marble", "Cobblestone"],
};

// Descriptions for each piece type to help users understand what they're generating
const PIECE_DESCRIPTIONS: Record<BuildingPieceType, string> = {
  wall: "Solid wall segment - a rectangular slab for building walls",
  door: "Wall section with door opening - replaces a wall segment",
  window: "Wall section with window opening - replaces a wall segment",
  roof: "Flat roof tile only - place on top of walls (no walls included)",
  floor: "Flat floor tile only - place on ground (no walls included)",
};

// Polycount presets for building pieces
const POLYCOUNT_PRESETS: Record<
  BuildingPieceType,
  { min: number; max: number; default: number }
> = {
  wall: { min: 200, max: 1500, default: 500 },
  door: { min: 400, max: 2000, default: 800 },
  window: { min: 200, max: 1200, default: 400 },
  roof: { min: 300, max: 1500, default: 600 },
  floor: { min: 100, max: 800, default: 200 },
};

// Building-specific material presets
const BUILDING_MATERIALS: BuildingMaterialPreset[] = [
  // Stone materials
  {
    id: "rough-stone",
    displayName: "Rough Stone",
    category: "stone",
    color: "#6B6B6B",
    stylePrompt:
      "rough hewn stone texture, gray natural stone, medieval masonry, unpolished",
    description: "Natural rough-cut stone blocks",
    suitableFor: ["wall", "door", "window", "floor"],
  },
  {
    id: "cobblestone",
    displayName: "Cobblestone",
    category: "stone",
    color: "#4A4A4A",
    stylePrompt:
      "cobblestone texture, rounded river stones, mortar gaps, medieval path",
    description: "Rounded stones set in mortar",
    suitableFor: ["wall", "floor"],
  },
  {
    id: "brick",
    displayName: "Red Brick",
    category: "stone",
    color: "#8B4513",
    stylePrompt:
      "red brick texture, clay bricks with mortar lines, weathered masonry",
    description: "Traditional red clay bricks",
    suitableFor: ["wall", "door", "window"],
  },
  {
    id: "sandstone",
    displayName: "Sandstone",
    category: "stone",
    color: "#D2B48C",
    stylePrompt:
      "sandstone texture, warm beige stone, desert architecture, carved blocks",
    description: "Warm desert sandstone",
    suitableFor: ["wall", "door", "window", "floor"],
  },
  {
    id: "marble",
    displayName: "White Marble",
    category: "stone",
    color: "#F0F0F0",
    stylePrompt:
      "white marble texture, polished stone with gray veins, elegant architecture",
    description: "Elegant polished marble",
    suitableFor: ["wall", "floor", "window"],
  },
  // Wood materials
  {
    id: "oak-wood",
    displayName: "Oak Wood",
    category: "wood",
    color: "#8B4513",
    stylePrompt:
      "oak wood texture, brown timber planks, visible wood grain, rustic",
    description: "Sturdy oak timber planks",
    suitableFor: ["wall", "door", "window", "floor"],
  },
  {
    id: "dark-wood",
    displayName: "Dark Wood",
    category: "wood",
    color: "#3D2314",
    stylePrompt:
      "dark stained wood texture, mahogany planks, rich brown finish",
    description: "Rich dark stained wood",
    suitableFor: ["wall", "door", "floor"],
  },
  {
    id: "weathered-wood",
    displayName: "Weathered Wood",
    category: "wood",
    color: "#808080",
    stylePrompt:
      "weathered gray wood texture, old timber, silvered planks, aged",
    description: "Old weathered gray timber",
    suitableFor: ["wall", "door", "window", "floor"],
  },
  // Roof materials
  {
    id: "clay-tiles",
    displayName: "Clay Tiles",
    category: "roof",
    color: "#B35A1F",
    stylePrompt:
      "terracotta clay roof tiles, overlapping curved tiles, Mediterranean style",
    description: "Traditional terracotta roof tiles",
    suitableFor: ["roof"],
  },
  {
    id: "thatch",
    displayName: "Thatch",
    category: "roof",
    color: "#C4A35A",
    stylePrompt:
      "thatch straw roof texture, bundled dry straw, medieval cottage style",
    description: "Traditional straw thatch",
    suitableFor: ["roof"],
  },
  {
    id: "slate",
    displayName: "Slate",
    category: "roof",
    color: "#2F4F4F",
    stylePrompt:
      "slate roof tiles, dark gray flat stone tiles, overlapping pattern",
    description: "Dark gray slate tiles",
    suitableFor: ["roof"],
  },
  {
    id: "wood-shingles",
    displayName: "Wood Shingles",
    category: "roof",
    color: "#654321",
    stylePrompt:
      "wooden roof shingles, cedar shake tiles, overlapping wood pieces",
    description: "Cedar wood shingles",
    suitableFor: ["roof"],
  },
  // Floor materials
  {
    id: "flagstone",
    displayName: "Flagstone",
    category: "floor",
    color: "#696969",
    stylePrompt:
      "flagstone floor texture, large flat stones, irregular shapes, castle floor",
    description: "Large flat stone slabs",
    suitableFor: ["floor"],
  },
  {
    id: "wood-planks",
    displayName: "Wood Planks",
    category: "floor",
    color: "#A0522D",
    stylePrompt: "wooden floor planks, parallel timber boards, rustic flooring",
    description: "Wooden floor boards",
    suitableFor: ["floor"],
  },
];

// =============================================================================
// COMPONENT
// =============================================================================

export function PieceGenerationModal({
  isOpen,
  onClose,
  onGenerated,
  initialType = "wall",
}: PieceGenerationModalProps) {
  const [pieceType, setPieceType] = useState<BuildingPieceType>(initialType);
  const [style, setStyle] = useState(STYLE_OPTIONS[initialType][0]);
  const [customPrompt, setCustomPrompt] = useState("");
  const [customName, setCustomName] = useState("");
  const [status, setStatus] = useState<GenerationStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [generatedPiece, setGeneratedPiece] = useState<BuildingPiece | null>(
    null,
  );

  // Material and polycount state
  const [selectedMaterial, setSelectedMaterial] = useState<string | null>(null);
  const [targetPolycount, setTargetPolycount] = useState(
    POLYCOUNT_PRESETS[initialType].default,
  );
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Filter materials suitable for the current piece type
  const availableMaterials = BUILDING_MATERIALS.filter((m) =>
    m.suitableFor.includes(pieceType),
  );

  // Sync pieceType with initialType when it changes (from tab selection)
  useEffect(() => {
    setPieceType(initialType);
    setStyle(STYLE_OPTIONS[initialType][0]);
    setSelectedMaterial(null);
    setTargetPolycount(POLYCOUNT_PRESETS[initialType].default);
  }, [initialType]);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setStatus("idle");
      setError(null);
      setGeneratedPiece(null);
      setCustomPrompt("");
      setCustomName("");
      setSelectedMaterial(null);
      setTargetPolycount(POLYCOUNT_PRESETS[pieceType].default);
    }
  }, [isOpen, pieceType]);

  const handleGenerate = async () => {
    setStatus("generating");
    setError(null);

    // Create abort controller with 5 minute timeout (generation takes 2-4 mins)
    const controller = new globalThis.AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5 * 60 * 1000);

    // Get material preset if selected
    const materialPreset = selectedMaterial
      ? BUILDING_MATERIALS.find((m) => m.id === selectedMaterial)
      : null;

    try {
      const res = await fetch("/api/structures/pieces/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: pieceType,
          style: style.toLowerCase(),
          prompt: customPrompt || undefined,
          name: customName || undefined,
          targetPolycount,
          materialPresetId: selectedMaterial || undefined,
          materialPrompt: materialPreset?.stylePrompt || undefined,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Generation failed");
      }

      const data = await res.json();
      setGeneratedPiece(data.piece);
      setStatus("success");
      onGenerated(data.piece);

      log.info("Piece generated successfully", { pieceId: data.piece.id });
    } catch (err) {
      clearTimeout(timeoutId);

      let message = "Unknown error";
      if (err instanceof Error) {
        if (err.name === "AbortError") {
          message = "Generation timed out. Please try again.";
        } else {
          message = err.message;
        }
      }

      setError(message);
      setStatus("error");
      log.error("Generation failed", { error: message });
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={status === "generating" ? undefined : onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-md mx-4 bg-glass-bg border border-glass-border rounded-xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-glass-border">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-cyan-400" />
            <h2 className="text-lg font-semibold">
              Generate {PIECE_TYPE_CONFIG[pieceType].label.slice(0, -1)}
            </h2>
          </div>
          {status !== "generating" && (
            <button
              onClick={onClose}
              className="p-1 rounded hover:bg-white/10 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {status === "generating" ? (
            <div className="py-12 text-center">
              <Loader2 className="w-12 h-12 mx-auto mb-4 animate-spin text-cyan-400" />
              <h3 className="text-lg font-medium mb-2">Generating Piece...</h3>
              <p className="text-sm text-muted-foreground">
                This may take 1-2 minutes. Please wait.
              </p>
              <div className="mt-4 text-xs text-muted-foreground space-y-1">
                <div>• Creating 3D mesh...</div>
                <div>• Applying textures...</div>
                <div>• Saving to library...</div>
              </div>
            </div>
          ) : status === "success" ? (
            <div className="py-8 text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-500/20 flex items-center justify-center">
                <Check className="w-8 h-8 text-green-400" />
              </div>
              <h3 className="text-lg font-medium mb-2">Piece Generated!</h3>
              <p className="text-sm text-muted-foreground mb-4">
                {generatedPiece?.name} has been added to your library.
              </p>
              {generatedPiece?.thumbnailUrl && (
                <img
                  src={generatedPiece.thumbnailUrl}
                  alt={generatedPiece.name}
                  className="w-24 h-24 mx-auto rounded-lg object-cover mb-4"
                />
              )}
              <SpectacularButton onClick={onClose} className="w-full">
                Done
              </SpectacularButton>
            </div>
          ) : status === "error" ? (
            <div className="py-8 text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-500/20 flex items-center justify-center">
                <AlertCircle className="w-8 h-8 text-red-400" />
              </div>
              <h3 className="text-lg font-medium mb-2">Generation Failed</h3>
              <p className="text-sm text-red-400 mb-4">{error}</p>
              <div className="flex gap-2">
                <SpectacularButton
                  variant="outline"
                  onClick={onClose}
                  className="flex-1"
                >
                  Cancel
                </SpectacularButton>
                <SpectacularButton
                  onClick={() => setStatus("idle")}
                  className="flex-1"
                >
                  Try Again
                </SpectacularButton>
              </div>
            </div>
          ) : (
            <>
              {/* Piece Type Info (read-only, type comes from tab) */}
              <div className="flex items-center gap-3 p-3 rounded-lg bg-cyan-500/10 border border-cyan-500/20">
                {(() => {
                  const Icon = TAB_ICONS[pieceType];
                  return <Icon className="w-6 h-6 text-cyan-400" />;
                })()}
                <div className="flex-1">
                  <div className="text-sm font-medium text-cyan-400">
                    {PIECE_TYPE_CONFIG[pieceType].label.slice(0, -1)}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {PIECE_DESCRIPTIONS[pieceType]}
                  </p>
                </div>
              </div>

              {/* Style Selector */}
              <div>
                <label className="text-sm text-muted-foreground mb-2 block">
                  Style
                </label>
                <div className="flex flex-wrap gap-2">
                  {STYLE_OPTIONS[pieceType].map((s) => (
                    <button
                      key={s}
                      onClick={() => setStyle(s)}
                      className={cn(
                        "px-3 py-1.5 rounded-full text-sm transition-colors",
                        style === s
                          ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"
                          : "bg-glass-bg border border-glass-border hover:bg-white/5",
                      )}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              {/* Material Presets */}
              {availableMaterials.length > 0 && (
                <div>
                  <label className="text-sm text-muted-foreground mb-2 block">
                    Material
                  </label>
                  <div className="grid grid-cols-4 gap-2">
                    {/* None option */}
                    <button
                      onClick={() => setSelectedMaterial(null)}
                      className={cn(
                        "flex flex-col items-center gap-1 p-2 rounded-lg transition-colors",
                        selectedMaterial === null
                          ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"
                          : "bg-glass-bg border border-glass-border hover:bg-white/5",
                      )}
                    >
                      <div className="w-5 h-5 rounded-full border-2 border-dashed border-white/30" />
                      <span className="text-[10px]">Default</span>
                    </button>
                    {availableMaterials.map((material) => (
                      <button
                        key={material.id}
                        onClick={() => setSelectedMaterial(material.id)}
                        className={cn(
                          "flex flex-col items-center gap-1 p-2 rounded-lg transition-colors",
                          selectedMaterial === material.id
                            ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"
                            : "bg-glass-bg border border-glass-border hover:bg-white/5",
                        )}
                        title={material.description}
                      >
                        <div
                          className="w-5 h-5 rounded-full border-2 border-white/20"
                          style={{ backgroundColor: material.color }}
                        />
                        <span className="text-[10px] truncate w-full text-center">
                          {material.displayName}
                        </span>
                      </button>
                    ))}
                  </div>
                  {selectedMaterial && (
                    <p className="mt-1.5 text-[11px] text-cyan-400/80">
                      {
                        BUILDING_MATERIALS.find(
                          (m) => m.id === selectedMaterial,
                        )?.description
                      }
                    </p>
                  )}
                </div>
              )}

              {/* Polycount Slider */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm text-muted-foreground">
                    Target Polycount
                  </label>
                  <span className="text-sm font-mono text-cyan-400">
                    {targetPolycount.toLocaleString()}
                  </span>
                </div>
                <Slider
                  value={[targetPolycount]}
                  onValueChange={([v]) => setTargetPolycount(v)}
                  min={POLYCOUNT_PRESETS[pieceType].min}
                  max={POLYCOUNT_PRESETS[pieceType].max}
                  step={50}
                />
                <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                  <span>{POLYCOUNT_PRESETS[pieceType].min} (Low)</span>
                  <span>{POLYCOUNT_PRESETS[pieceType].max} (High)</span>
                </div>
              </div>

              {/* Advanced Options Toggle */}
              <button
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center justify-between w-full py-2 text-sm text-muted-foreground hover:text-white transition-colors"
              >
                <span>Advanced Options</span>
                {showAdvanced ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
              </button>

              {showAdvanced && (
                <div className="space-y-4 pt-2 border-t border-glass-border">
                  {/* Custom Name (optional) */}
                  <div>
                    <label className="text-sm text-muted-foreground mb-2 block">
                      Custom Name (optional)
                    </label>
                    <input
                      type="text"
                      value={customName}
                      onChange={(e) => setCustomName(e.target.value)}
                      placeholder={`${style} ${PIECE_TYPE_CONFIG[pieceType].label.slice(0, -1)}`}
                      className="w-full px-3 py-2 bg-glass-bg border border-glass-border rounded-lg text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
                    />
                  </div>

                  {/* Custom Prompt (optional) */}
                  <div>
                    <label className="text-sm text-muted-foreground mb-2 block">
                      Custom Prompt (optional)
                    </label>
                    <textarea
                      value={customPrompt}
                      onChange={(e) => setCustomPrompt(e.target.value)}
                      placeholder="Leave empty for default prompt, or describe your piece..."
                      rows={2}
                      className="w-full px-3 py-2 bg-glass-bg border border-glass-border rounded-lg text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-cyan-500/50 resize-none"
                    />
                  </div>

                  {/* Info Box */}
                  <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
                    <div className="flex gap-2">
                      <Info className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
                      <div className="text-xs text-blue-300/80">
                        <p className="font-medium text-blue-300">Tips</p>
                        <ul className="mt-1 space-y-0.5 list-disc list-inside">
                          <li>Lower polycount = faster loading</li>
                          <li>Material presets add consistent texturing</li>
                          <li>Custom prompts override default descriptions</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Generate Button */}
              <SpectacularButton onClick={handleGenerate} className="w-full">
                <Sparkles className="w-4 h-4 mr-2" />
                Generate {style}{" "}
                {PIECE_TYPE_CONFIG[pieceType].label.slice(0, -1)}
              </SpectacularButton>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
