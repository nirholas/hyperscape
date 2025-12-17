"use client";

import { useState } from "react";
import {
  Layers,
  Sparkles,
  Download,
  Loader2,
  Image as ImageIcon,
  Check,
  Wand2,
  Grid2X2,
} from "lucide-react";
import { StudioPageLayout } from "@/components/layout/StudioPageLayout";
import { SpectacularButton } from "@/components/ui/spectacular-button";
import { cn } from "@/lib/utils";

type TextureStyle = "realistic" | "stylized" | "painted" | "procedural";
type TextureType =
  | "ground"
  | "wall"
  | "metal"
  | "wood"
  | "fabric"
  | "stone"
  | "organic";
type TextureResolution = "512" | "1024" | "2048";

interface GeneratedTexture {
  id: string;
  url: string;
  prompt: string;
}

export default function TexturesPage() {
  const [prompt, setPrompt] = useState("");
  const [textureStyle, setTextureStyle] = useState<TextureStyle>("stylized");
  const [textureType, setTextureType] = useState<TextureType>("ground");
  const [resolution, setResolution] = useState<TextureResolution>("1024");
  const [seamless, setSeamless] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedTextures, setGeneratedTextures] = useState<
    GeneratedTexture[]
  >([]);
  const [previewTiling, setPreviewTiling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const textureStyles: {
    id: TextureStyle;
    label: string;
    description: string;
  }[] = [
    {
      id: "realistic",
      label: "Realistic",
      description: "Photo-realistic materials",
    },
    {
      id: "stylized",
      label: "Stylized",
      description: "Hand-painted game style",
    },
    { id: "painted", label: "Painted", description: "Artistic brush strokes" },
    {
      id: "procedural",
      label: "Procedural",
      description: "Clean geometric patterns",
    },
  ];

  const textureTypes: { id: TextureType; label: string }[] = [
    { id: "ground", label: "Ground/Terrain" },
    { id: "wall", label: "Wall/Brick" },
    { id: "metal", label: "Metal" },
    { id: "wood", label: "Wood" },
    { id: "fabric", label: "Fabric/Cloth" },
    { id: "stone", label: "Stone/Rock" },
    { id: "organic", label: "Organic/Nature" },
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
          type: "texture",
          prompt,
          options: {
            style: textureStyle,
            textureType,
            resolution,
            seamless,
          },
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Generation failed");
      }

      const data = await response.json();

      if (data.image) {
        setGeneratedTextures((prev) => [
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

  const handleDownload = async (texture: GeneratedTexture) => {
    try {
      const response = await fetch(texture.url);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `texture-${texture.id}.png`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Failed to download:", error);
    }
  };

  return (
    <StudioPageLayout
      title="Texture Generator"
      description="Generate seamless textures for 3D models"
      showVault={false}
    >
      <div className="h-full flex flex-col overflow-hidden">
        {/* Header */}
        <div className="p-6 border-b border-glass-border bg-glass-bg/30">
          <div className="max-w-6xl mx-auto flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold mb-2">Texture Generator</h1>
              <p className="text-muted-foreground">
                Generate seamless textures for 3D models using Vercel AI
                Gateway.
              </p>
            </div>

            {/* Tiling Preview Toggle */}
            <button
              onClick={() => setPreviewTiling(!previewTiling)}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors",
                previewTiling
                  ? "bg-green-500/20 text-green-400 border border-green-500/30"
                  : "bg-glass-bg border border-glass-border text-muted-foreground hover:text-foreground",
              )}
            >
              <Grid2X2 className="w-4 h-4" />
              <span>Tiling Preview</span>
            </button>
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
                    <Wand2 className="w-5 h-5 text-green-400" />
                    Description
                  </h2>
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="Describe your texture... e.g., 'Mossy cobblestone path with grass growing between stones'"
                    rows={3}
                    className="w-full px-4 py-3 bg-glass-bg border border-glass-border rounded-lg text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-green-500/50 resize-none"
                  />
                </div>

                {/* Texture Style */}
                <div className="p-6 rounded-xl border border-glass-border bg-glass-bg/30">
                  <h2 className="text-lg font-semibold mb-4">Texture Style</h2>
                  <div className="grid grid-cols-2 gap-3">
                    {textureStyles.map((style) => (
                      <button
                        key={style.id}
                        onClick={() => setTextureStyle(style.id)}
                        className={cn(
                          "p-3 rounded-lg border text-left transition-all",
                          textureStyle === style.id
                            ? "border-green-500/50 bg-green-500/10"
                            : "border-glass-border hover:border-glass-border/80",
                        )}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-medium text-sm">
                            {style.label}
                          </span>
                          {textureStyle === style.id && (
                            <Check className="w-4 h-4 text-green-400" />
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {style.description}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Texture Type & Resolution */}
                <div className="p-6 rounded-xl border border-glass-border bg-glass-bg/30">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium mb-2">
                        Material Type
                      </label>
                      <select
                        value={textureType}
                        onChange={(e) =>
                          setTextureType(e.target.value as TextureType)
                        }
                        className="w-full px-3 py-2 bg-glass-bg border border-glass-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500/50"
                      >
                        {textureTypes.map((type) => (
                          <option key={type.id} value={type.id}>
                            {type.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2">
                        Resolution
                      </label>
                      <select
                        value={resolution}
                        onChange={(e) =>
                          setResolution(e.target.value as TextureResolution)
                        }
                        className="w-full px-3 py-2 bg-glass-bg border border-glass-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500/50"
                      >
                        <option value="512">512 × 512</option>
                        <option value="1024">1024 × 1024</option>
                        <option value="2048">2048 × 2048</option>
                      </select>
                    </div>
                  </div>

                  {/* Seamless Toggle */}
                  <div className="mt-4 pt-4 border-t border-glass-border">
                    <label className="flex items-center justify-between cursor-pointer">
                      <div>
                        <span className="font-medium text-sm">
                          Seamless Tiling
                        </span>
                        <p className="text-xs text-muted-foreground">
                          Generate tileable texture
                        </p>
                      </div>
                      <button
                        onClick={() => setSeamless(!seamless)}
                        className={cn(
                          "w-12 h-6 rounded-full transition-colors relative",
                          seamless ? "bg-green-500" : "bg-glass-border",
                        )}
                      >
                        <div
                          className={cn(
                            "absolute top-1 w-4 h-4 rounded-full bg-white transition-transform",
                            seamless ? "left-7" : "left-1",
                          )}
                        />
                      </button>
                    </label>
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
                      Generate Texture
                    </>
                  )}
                </SpectacularButton>

                {error && (
                  <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                    {error}
                  </div>
                )}
              </div>

              {/* Right: Generated Textures */}
              <div className="p-6 rounded-xl border border-glass-border bg-glass-bg/30 min-h-[500px]">
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <ImageIcon className="w-5 h-5 text-green-400" />
                  Generated Textures
                </h2>

                {generatedTextures.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-[400px] text-center">
                    <Layers className="w-16 h-16 text-muted-foreground/30 mb-4" />
                    <p className="text-muted-foreground">
                      Your generated textures will appear here
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {generatedTextures.map((texture) => (
                      <div
                        key={texture.id}
                        className="group relative rounded-lg overflow-hidden border border-glass-border"
                      >
                        {/* Texture Preview - normal or tiled */}
                        <div
                          className="w-full aspect-square"
                          style={
                            previewTiling
                              ? {
                                  backgroundImage: `url(${texture.url})`,
                                  backgroundSize: "50%",
                                  backgroundRepeat: "repeat",
                                }
                              : undefined
                          }
                        >
                          {!previewTiling && (
                            <img
                              src={texture.url}
                              alt={texture.prompt}
                              className="w-full h-full object-cover"
                            />
                          )}
                        </div>

                        {/* Overlay */}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                          <div className="absolute bottom-0 left-0 right-0 p-4">
                            <p className="text-xs text-white/80 line-clamp-2 mb-2">
                              {texture.prompt}
                            </p>
                            <button
                              onClick={() => handleDownload(texture)}
                              className="flex items-center gap-2 px-4 py-2 rounded bg-green-500 hover:bg-green-400 text-white text-sm transition-colors"
                            >
                              <Download className="w-4 h-4" />
                              Download
                            </button>
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
