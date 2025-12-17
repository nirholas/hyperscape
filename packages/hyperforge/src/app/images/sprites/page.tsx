"use client";

import { useState } from "react";
import {
  Grid3X3,
  Sparkles,
  Download,
  Loader2,
  Check,
  Wand2,
  Image as ImageIcon,
} from "lucide-react";
import { StudioPageLayout } from "@/components/layout/StudioPageLayout";
import { SpectacularButton } from "@/components/ui/spectacular-button";
import { cn, logger } from "@/lib/utils";

const log = logger.child("SpritesPage");

type SpriteStyle = "pixel-16" | "pixel-32" | "pixel-64" | "hand-drawn" | "flat";
type SpriteType = "character" | "item" | "tile" | "ui" | "effect";

interface GeneratedSprite {
  id: string;
  url: string;
  prompt: string;
}

export default function SpritesPage() {
  const [prompt, setPrompt] = useState("");
  const [spriteStyle, setSpriteStyle] = useState<SpriteStyle>("pixel-32");
  const [spriteType, setSpriteType] = useState<SpriteType>("item");
  const [transparent, setTransparent] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedSprites, setGeneratedSprites] = useState<GeneratedSprite[]>(
    [],
  );
  const [error, setError] = useState<string | null>(null);

  const spriteStyles: {
    id: SpriteStyle;
    label: string;
    description: string;
  }[] = [
    {
      id: "pixel-16",
      label: "16×16 Pixel",
      description: "Classic retro style",
    },
    {
      id: "pixel-32",
      label: "32×32 Pixel",
      description: "Standard game sprites",
    },
    {
      id: "pixel-64",
      label: "64×64 Pixel",
      description: "High-detail pixel art",
    },
    { id: "hand-drawn", label: "Hand-Drawn", description: "Illustrated style" },
    { id: "flat", label: "Flat Vector", description: "Clean minimal look" },
  ];

  const spriteTypes: { id: SpriteType; label: string; examples: string }[] = [
    { id: "character", label: "Character", examples: "Player, NPC, enemy" },
    { id: "item", label: "Item", examples: "Weapon, potion, key" },
    { id: "tile", label: "Tile", examples: "Ground, wall, decoration" },
    { id: "ui", label: "UI Element", examples: "Button, icon, frame" },
    { id: "effect", label: "Effect", examples: "Explosion, sparkle, smoke" },
  ];

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      setError("Please enter a description");
      return;
    }

    setIsGenerating(true);
    setError(null);

    try {
      const response = await fetch("/api/images/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "sprite",
          prompt,
          options: {
            style: spriteStyle,
            spriteType,
            transparent,
          },
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Generation failed");
      }

      const data = await response.json();

      if (data.image) {
        setGeneratedSprites((prev) => [
          {
            id: data.image.id || Date.now().toString(),
            url: data.image.url,
            prompt,
          },
          ...prev,
        ]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDownload = async (sprite: GeneratedSprite) => {
    try {
      const response = await fetch(sprite.url);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `sprite-${sprite.id}.png`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      log.error("Failed to download:", error);
    }
  };

  return (
    <StudioPageLayout
      title="Sprite Generator"
      description="Generate 2D game sprites and pixel art"
      showVault={false}
    >
      <div className="h-full flex flex-col overflow-hidden">
        {/* Header */}
        <div className="p-6 border-b border-glass-border bg-glass-bg/30">
          <div className="max-w-6xl mx-auto">
            <h1 className="text-3xl font-bold mb-2">Sprite Generator</h1>
            <p className="text-muted-foreground">
              Generate 2D game sprites and pixel art using Vercel AI Gateway.
            </p>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-6xl mx-auto">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Left: Generator Form */}
              <div className="space-y-6">
                {/* Prompt Input */}
                <div className="p-6 rounded-xl border border-glass-border bg-glass-bg/30">
                  <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <Wand2 className="w-5 h-5 text-cyan-400" />
                    Description
                  </h2>
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="Describe your sprite... e.g., 'A glowing health potion in a red glass bottle with a cork stopper'"
                    rows={3}
                    className="w-full px-4 py-3 bg-glass-bg border border-glass-border rounded-lg text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-cyan-500/50 resize-none"
                  />
                </div>

                {/* Sprite Style */}
                <div className="p-6 rounded-xl border border-glass-border bg-glass-bg/30">
                  <h2 className="text-lg font-semibold mb-4">Sprite Style</h2>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {spriteStyles.map((style) => (
                      <button
                        key={style.id}
                        onClick={() => setSpriteStyle(style.id)}
                        className={cn(
                          "p-3 rounded-lg border text-left transition-all",
                          spriteStyle === style.id
                            ? "border-cyan-500/50 bg-cyan-500/10"
                            : "border-glass-border hover:border-glass-border/80",
                        )}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-medium text-sm">
                            {style.label}
                          </span>
                          {spriteStyle === style.id && (
                            <Check className="w-4 h-4 text-cyan-400" />
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {style.description}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Sprite Type */}
                <div className="p-6 rounded-xl border border-glass-border bg-glass-bg/30">
                  <h2 className="text-lg font-semibold mb-4">Sprite Type</h2>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {spriteTypes.map((type) => (
                      <button
                        key={type.id}
                        onClick={() => setSpriteType(type.id)}
                        className={cn(
                          "p-3 rounded-lg border text-left transition-all",
                          spriteType === type.id
                            ? "border-cyan-500/50 bg-cyan-500/10"
                            : "border-glass-border hover:border-glass-border/80",
                        )}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-medium text-sm">
                            {type.label}
                          </span>
                          {spriteType === type.id && (
                            <Check className="w-4 h-4 text-cyan-400" />
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {type.examples}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Options */}
                <div className="p-6 rounded-xl border border-glass-border bg-glass-bg/30">
                  <label className="flex items-center justify-between cursor-pointer">
                    <div>
                      <span className="font-medium text-sm">
                        Transparent Background
                      </span>
                      <p className="text-xs text-muted-foreground">
                        Remove background for game use
                      </p>
                    </div>
                    <button
                      onClick={() => setTransparent(!transparent)}
                      className={cn(
                        "w-12 h-6 rounded-full transition-colors relative",
                        transparent ? "bg-cyan-500" : "bg-glass-border",
                      )}
                    >
                      <div
                        className={cn(
                          "absolute top-1 w-4 h-4 rounded-full bg-white transition-transform",
                          transparent ? "left-7" : "left-1",
                        )}
                      />
                    </button>
                  </label>
                </div>

                {/* Generate Button */}
                <SpectacularButton
                  onClick={handleGenerate}
                  disabled={isGenerating || !prompt.trim()}
                  className="w-full h-14"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-5 h-5 mr-2" />
                      Generate Sprite
                    </>
                  )}
                </SpectacularButton>

                {error && (
                  <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                    {error}
                  </div>
                )}
              </div>

              {/* Right: Generated Sprites */}
              <div className="p-6 rounded-xl border border-glass-border bg-glass-bg/30 min-h-[500px]">
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <ImageIcon className="w-5 h-5 text-cyan-400" />
                  Generated Sprites
                </h2>

                {generatedSprites.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-[400px] text-center">
                    <Grid3X3 className="w-16 h-16 text-muted-foreground/30 mb-4" />
                    <p className="text-muted-foreground">
                      Your generated sprites will appear here
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-4">
                    {generatedSprites.map((sprite) => (
                      <div
                        key={sprite.id}
                        className="group relative rounded-lg overflow-hidden border border-glass-border"
                        style={{
                          background: "url('/checkerboard.svg') repeat",
                        }}
                      >
                        <img
                          src={sprite.url}
                          alt={sprite.prompt}
                          className="w-full aspect-square object-contain"
                          style={{
                            imageRendering: spriteStyle.startsWith("pixel")
                              ? "pixelated"
                              : "auto",
                          }}
                        />

                        {/* Overlay */}
                        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <button
                            onClick={() => handleDownload(sprite)}
                            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-white text-sm transition-colors"
                          >
                            <Download className="w-4 h-4" />
                            Download
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </StudioPageLayout>
  );
}
