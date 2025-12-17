"use client";

import { useState, useRef, useEffect } from "react";
import { StudioPageLayout } from "@/components/layout/StudioPageLayout";
import { SpectacularButton } from "@/components/ui/spectacular-button";
import { Slider } from "@/components/ui/slider";
import {
  Volume2,
  Play,
  Pause,
  Download,
  Loader2,
  Sparkles,
  AlertCircle,
  Clock,
  AudioWaveform,
  Sword,
  Coins,
  Wind,
} from "lucide-react";
import { logger } from "@/lib/utils";

const log = logger.child("SFXPage");

interface SFXPreset {
  id: string;
  name: string;
  prompt: string;
  category: string;
}

interface GeneratedSFX {
  id: string;
  name: string;
  prompt: string;
  category: string;
  audioUrl: string;
  duration: number;
  generatedAt: string;
}

const categoryIcons: Record<string, React.ReactNode> = {
  combat: <Sword className="w-4 h-4" />,
  item: <Coins className="w-4 h-4" />,
  environment: <Wind className="w-4 h-4" />,
  ui: <AudioWaveform className="w-4 h-4" />,
  custom: <Sparkles className="w-4 h-4" />,
};

export default function SoundEffectsPage() {
  const [sfxPresets, setSfxPresets] = useState<SFXPreset[]>([]);
  const [selectedPreset, setSelectedPreset] = useState<string>("");
  const [customPrompt, setCustomPrompt] = useState("");
  const [duration, setDuration] = useState(2);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(80);
  const [currentAudio, setCurrentAudio] = useState<string | null>(null);
  const [generatedSFX, setGeneratedSFX] = useState<GeneratedSFX[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<string>("all");

  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Load SFX presets
  useEffect(() => {
    async function loadPresets() {
      try {
        const res = await fetch("/api/audio/sfx/generate");
        if (res.ok) {
          const data = await res.json();
          setSfxPresets(data.presets || []);
        }
      } catch (err) {
        log.error({ error: err }, "Failed to load SFX presets");
      }
    }
    loadPresets();
  }, []);

  const filteredPresets =
    activeCategory === "all"
      ? sfxPresets
      : sfxPresets.filter((p) => p.category === activeCategory);

  const categories = ["all", ...new Set(sfxPresets.map((p) => p.category))];

  async function handleGenerate() {
    const prompt = customPrompt.trim() || undefined;
    const presetId = prompt ? undefined : selectedPreset;

    if (!prompt && !presetId) {
      setError("Please select a preset or enter a custom description");
      return;
    }

    setIsGenerating(true);
    setError(null);

    try {
      const res = await fetch("/api/audio/sfx/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          presetId,
          durationSeconds: duration,
          promptInfluence: 0.7,
          saveToAsset: true,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to generate SFX");
      }

      const data = await res.json();
      setCurrentAudio(data.audio);

      // Add to history
      setGeneratedSFX((prev) => [
        {
          id: data.asset.id,
          name: data.asset.name,
          prompt: data.asset.prompt,
          category: data.asset.category,
          audioUrl: data.audio,
          duration: data.asset.duration,
          generatedAt: new Date().toISOString(),
        },
        ...prev.slice(0, 19), // Keep last 20
      ]);

      // Auto-play
      if (audioRef.current) {
        audioRef.current.src = data.audio;
        audioRef.current.play();
        setIsPlaying(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setIsGenerating(false);
    }
  }

  function handlePlayPause() {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  }

  function playSFX(sfx: GeneratedSFX) {
    setCurrentAudio(sfx.audioUrl);
    if (audioRef.current) {
      audioRef.current.src = sfx.audioUrl;
      audioRef.current.play();
      setIsPlaying(true);
    }
  }

  function handleDownload() {
    if (!currentAudio) return;
    const link = document.createElement("a");
    link.href = currentAudio;
    link.download = `sfx_${Date.now()}.mp3`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume / 100;
    }
  }, [volume]);

  return (
    <StudioPageLayout
      title="Sound Effects"
      description="Generate game SFX with AI"
      showVault={false}
    >
      <audio ref={audioRef} onEnded={() => setIsPlaying(false)} />

      <div className="h-full flex">
        <div className="flex-1 p-6 overflow-auto">
          <div className="max-w-5xl mx-auto">
            {/* Header */}
            <div className="mb-8">
              <h1 className="text-3xl font-bold mb-2 flex items-center gap-3">
                <Volume2 className="w-8 h-8 text-purple-400" />
                Sound Effects Generator
              </h1>
              <p className="text-muted-foreground">
                Create game sound effects from text descriptions using
                ElevenLabs AI.
              </p>
            </div>

            {/* Error */}
            {error && (
              <div className="mb-6 p-4 rounded-lg bg-red-500/10 border border-red-500/30 flex items-center gap-3 text-red-400">
                <AlertCircle className="w-5 h-5 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Preset Grid */}
              <div className="lg:col-span-2 p-6 rounded-xl border border-glass-border bg-glass-bg/30 backdrop-blur-sm">
                {/* Category Filter */}
                <div className="flex gap-2 mb-4 flex-wrap">
                  {categories.map((cat) => (
                    <button
                      key={cat}
                      onClick={() => setActiveCategory(cat)}
                      className={`
                        px-3 py-1.5 rounded-full text-xs font-medium transition-all flex items-center gap-1.5
                        ${
                          activeCategory === cat
                            ? "bg-purple-500/20 text-purple-400 border border-purple-500/30"
                            : "bg-glass-bg text-muted-foreground hover:text-foreground"
                        }
                      `}
                    >
                      {cat !== "all" && categoryIcons[cat]}
                      {cat.charAt(0).toUpperCase() + cat.slice(1)}
                    </button>
                  ))}
                </div>

                {/* Presets Grid */}
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 max-h-[400px] overflow-y-auto">
                  {filteredPresets.map((preset) => (
                    <button
                      key={preset.id}
                      onClick={() => {
                        setSelectedPreset(preset.id);
                        setCustomPrompt("");
                      }}
                      className={`
                        p-3 rounded-lg text-left transition-all
                        ${
                          selectedPreset === preset.id && !customPrompt
                            ? "bg-purple-500/20 border-2 border-purple-500/50"
                            : "bg-glass-bg/50 border border-glass-border hover:bg-glass-bg"
                        }
                      `}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        {categoryIcons[preset.category]}
                        <span className="font-medium text-sm">
                          {preset.name}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground line-clamp-2">
                        {preset.prompt}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Generation Panel */}
              <div className="space-y-6">
                <div className="p-6 rounded-xl border border-glass-border bg-glass-bg/30 backdrop-blur-sm space-y-4">
                  <div className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                    Custom SFX
                  </div>
                  <textarea
                    value={customPrompt}
                    onChange={(e) => {
                      setCustomPrompt(e.target.value);
                      if (e.target.value) setSelectedPreset("");
                    }}
                    placeholder="Describe the sound effect... e.g., 'Heavy metallic door slamming shut with echo'"
                    className="w-full h-24 px-3 py-2 bg-glass-bg border border-glass-border rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                  />

                  {/* Duration */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Duration</span>
                      <span className="font-mono text-xs">{duration}s</span>
                    </div>
                    <Slider
                      value={[duration]}
                      onValueChange={([v]) => setDuration(v)}
                      min={0.5}
                      max={10}
                      step={0.5}
                    />
                  </div>

                  <SpectacularButton
                    className="w-full"
                    onClick={handleGenerate}
                    disabled={
                      (!selectedPreset && !customPrompt.trim()) || isGenerating
                    }
                  >
                    {isGenerating ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Generating...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4 mr-2" />
                        Generate SFX
                      </>
                    )}
                  </SpectacularButton>
                </div>

                {/* Playback Controls */}
                {currentAudio && (
                  <div className="p-4 rounded-xl border border-glass-border bg-glass-bg/30 backdrop-blur-sm space-y-4">
                    <div className="flex items-center gap-3">
                      <SpectacularButton
                        size="sm"
                        variant="outline"
                        onClick={handlePlayPause}
                      >
                        {isPlaying ? (
                          <Pause className="w-4 h-4" />
                        ) : (
                          <Play className="w-4 h-4" />
                        )}
                      </SpectacularButton>
                      <div className="flex-1 h-1 bg-glass-bg rounded-full overflow-hidden">
                        <div className="h-full w-full bg-purple-400 rounded-full" />
                      </div>
                      <SpectacularButton
                        size="sm"
                        variant="outline"
                        onClick={handleDownload}
                      >
                        <Download className="w-4 h-4" />
                      </SpectacularButton>
                    </div>
                    <div className="flex items-center gap-3">
                      <Volume2 className="w-4 h-4 text-muted-foreground" />
                      <Slider
                        value={[volume]}
                        onValueChange={([v]) => setVolume(v)}
                        min={0}
                        max={100}
                        className="flex-1"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Generated History */}
            {generatedSFX.length > 0 && (
              <div className="mt-8 space-y-4">
                <div className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                  Generated Sound Effects
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
                  {generatedSFX.map((sfx) => (
                    <div
                      key={sfx.id}
                      className="p-3 rounded-lg border border-glass-border bg-glass-bg/30 hover:bg-glass-bg/50 transition-all cursor-pointer"
                      onClick={() => playSFX(sfx)}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        {categoryIcons[sfx.category]}
                        <span className="text-sm font-medium truncate">
                          {sfx.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Clock className="w-3 h-3" />
                        {sfx.duration.toFixed(1)}s
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </StudioPageLayout>
  );
}
