"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Palette,
  Sparkles,
  Download,
  Loader2,
  Image as ImageIcon,
  Check,
  Wand2,
} from "lucide-react";
import { StudioPageLayout } from "@/components/layout/StudioPageLayout";
import { SpectacularButton } from "@/components/ui/spectacular-button";
import { cn } from "@/lib/utils";

type ArtStyle = "realistic" | "stylized" | "pixel" | "painterly";
type ViewAngle = "front" | "side" | "isometric" | "three-quarter";
type AssetType =
  | "weapon"
  | "armor"
  | "character"
  | "item"
  | "prop"
  | "environment";

interface GeneratedImage {
  id: string;
  url: string;
  prompt: string;
}

export default function ConceptArtPage() {
  const [prompt, setPrompt] = useState("");
  const [artStyle, setArtStyle] = useState<ArtStyle>("stylized");
  const [viewAngle, setViewAngle] = useState<ViewAngle>("isometric");
  const [assetType, setAssetType] = useState<AssetType>("item");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedImages, setGeneratedImages] = useState<GeneratedImage[]>([]);
  const [error, setError] = useState<string | null>(null);

  const artStyles: { id: ArtStyle; label: string; description: string }[] = [
    {
      id: "realistic",
      label: "Realistic",
      description: "Photorealistic rendering",
    },
    {
      id: "stylized",
      label: "Stylized",
      description: "Game art style (Fortnite/Overwatch)",
    },
    { id: "pixel", label: "Pixel Art", description: "Retro pixel aesthetic" },
    { id: "painterly", label: "Painterly", description: "Hand-painted look" },
  ];

  const viewAngles: { id: ViewAngle; label: string }[] = [
    { id: "front", label: "Front View" },
    { id: "side", label: "Side Profile" },
    { id: "isometric", label: "Isometric 3/4" },
    { id: "three-quarter", label: "Three-Quarter" },
  ];

  const assetTypes: { id: AssetType; label: string }[] = [
    { id: "weapon", label: "Weapon" },
    { id: "armor", label: "Armor" },
    { id: "character", label: "Character" },
    { id: "item", label: "Item" },
    { id: "prop", label: "Prop" },
    { id: "environment", label: "Environment" },
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
          type: "concept-art",
          prompt,
          options: {
            style: artStyle,
            viewAngle,
            assetType,
            background: "simple",
          },
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Generation failed");
      }

      const data = await response.json();

      if (data.image) {
        setGeneratedImages((prev) => [
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

  const handleDownload = async (image: GeneratedImage) => {
    try {
      const response = await fetch(image.url);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `concept-art-${image.id}.png`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Failed to download:", error);
    }
  };

  return (
    <StudioPageLayout
      title="Concept Art Generator"
      description="Generate AI concept art for 3D modeling reference"
      showVault={false}
    >
      <div className="h-full flex flex-col overflow-hidden">
        {/* Header */}
        <div className="p-6 border-b border-glass-border bg-glass-bg/30">
          <div className="max-w-6xl mx-auto">
            <h1 className="text-3xl font-bold mb-2">Concept Art Generator</h1>
            <p className="text-muted-foreground">
              Generate AI concept art for 3D modeling reference using Vercel AI
              Gateway.
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
                    <Wand2 className="w-5 h-5 text-purple-400" />
                    Description
                  </h2>
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="Describe your concept art... e.g., 'A legendary fire sword with a blade made of molten lava, ornate golden hilt with ruby gems'"
                    rows={4}
                    className="w-full px-4 py-3 bg-glass-bg border border-glass-border rounded-lg text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-purple-500/50 resize-none"
                  />
                </div>

                {/* Art Style */}
                <div className="p-6 rounded-xl border border-glass-border bg-glass-bg/30">
                  <h2 className="text-lg font-semibold mb-4">Art Style</h2>
                  <div className="grid grid-cols-2 gap-3">
                    {artStyles.map((style) => (
                      <button
                        key={style.id}
                        onClick={() => setArtStyle(style.id)}
                        className={cn(
                          "p-3 rounded-lg border text-left transition-all",
                          artStyle === style.id
                            ? "border-purple-500/50 bg-purple-500/10"
                            : "border-glass-border hover:border-glass-border/80",
                        )}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-medium text-sm">
                            {style.label}
                          </span>
                          {artStyle === style.id && (
                            <Check className="w-4 h-4 text-purple-400" />
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {style.description}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* View Angle & Asset Type */}
                <div className="p-6 rounded-xl border border-glass-border bg-glass-bg/30">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium mb-2">
                        View Angle
                      </label>
                      <select
                        value={viewAngle}
                        onChange={(e) =>
                          setViewAngle(e.target.value as ViewAngle)
                        }
                        className="w-full px-3 py-2 bg-glass-bg border border-glass-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                      >
                        {viewAngles.map((angle) => (
                          <option key={angle.id} value={angle.id}>
                            {angle.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2">
                        Asset Type
                      </label>
                      <select
                        value={assetType}
                        onChange={(e) =>
                          setAssetType(e.target.value as AssetType)
                        }
                        className="w-full px-3 py-2 bg-glass-bg border border-glass-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                      >
                        {assetTypes.map((type) => (
                          <option key={type.id} value={type.id}>
                            {type.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
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
                      Generate Concept Art
                    </>
                  )}
                </SpectacularButton>

                {error && (
                  <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                    {error}
                  </div>
                )}
              </div>

              {/* Right: Generated Images */}
              <div className="p-6 rounded-xl border border-glass-border bg-glass-bg/30 min-h-[500px]">
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <ImageIcon className="w-5 h-5 text-purple-400" />
                  Generated Images
                </h2>

                {generatedImages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-[400px] text-center">
                    <Palette className="w-16 h-16 text-muted-foreground/30 mb-4" />
                    <p className="text-muted-foreground">
                      Your generated concept art will appear here
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {generatedImages.map((image) => (
                      <div
                        key={image.id}
                        className="group relative rounded-lg overflow-hidden border border-glass-border"
                      >
                        <img
                          src={image.url}
                          alt={image.prompt}
                          className="w-full aspect-video object-contain bg-black/20"
                        />

                        {/* Overlay */}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                          <div className="absolute bottom-0 left-0 right-0 p-4">
                            <p className="text-xs text-white/80 line-clamp-2 mb-2">
                              {image.prompt}
                            </p>
                            <div className="flex gap-2">
                              <button
                                onClick={() => handleDownload(image)}
                                className="flex items-center gap-1 px-3 py-1.5 rounded bg-white/20 hover:bg-white/30 text-white text-xs transition-colors"
                              >
                                <Download className="w-3 h-3" />
                                Download
                              </button>
                              <Link
                                href={`/generate?conceptArt=${encodeURIComponent(image.url)}`}
                                className="flex items-center gap-1 px-3 py-1.5 rounded bg-purple-500/50 hover:bg-purple-500/70 text-white text-xs transition-colors"
                              >
                                <Sparkles className="w-3 h-3" />
                                Use for 3D
                              </Link>
                            </div>
                          </div>
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
