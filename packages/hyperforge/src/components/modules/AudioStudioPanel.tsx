"use client";

import { useState, useRef, useEffect } from "react";
import { logger } from "@/lib/utils";

const log = logger.child("AudioStudioPanel");
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SpectacularButton } from "@/components/ui/spectacular-button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Select } from "@/components/ui/select";
import {
  Music,
  Mic,
  Volume2,
  Play,
  Pause,
  Square,
  Download,
  Loader2,
  AudioWaveform,
  Sparkles,
  AlertCircle,
} from "lucide-react";

interface AudioStudioPanelProps {
  selectedAsset?: { id: string; name: string } | null;
  npcId?: string;
  dialogueNodeId?: string;
}

interface VoicePreset {
  id: string;
  voiceId: string;
  name: string;
  description: string;
}

interface SFXPreset {
  id: string;
  name: string;
  prompt: string;
  category: string;
}

interface MusicPreset {
  id: string;
  name: string;
  prompt: string;
  category: string;
}

export function AudioStudioPanel({
  selectedAsset: _selectedAsset,
  npcId,
  dialogueNodeId,
}: AudioStudioPanelProps) {
  // Hydration state
  const [mounted, setMounted] = useState(false);

  // Voice state
  const [voicePresets, setVoicePresets] = useState<VoicePreset[]>([]);
  const [selectedVoice, setSelectedVoice] = useState<string>("");
  const [textToSpeak, setTextToSpeak] = useState("");
  const [isGeneratingVoice, setIsGeneratingVoice] = useState(false);

  // SFX state
  const [sfxPresets, setSfxPresets] = useState<SFXPreset[]>([]);
  const [selectedSFX, setSelectedSFX] = useState<string>("");
  const [customSFXPrompt, setCustomSFXPrompt] = useState("");
  const [sfxDuration, setSfxDuration] = useState(2);
  const [isGeneratingSFX, setIsGeneratingSFX] = useState(false);

  // Music state
  const [musicPresets, setMusicPresets] = useState<MusicPreset[]>([]);
  const [selectedMusic, setSelectedMusic] = useState<string>("");
  const [customMusicPrompt, setCustomMusicPrompt] = useState("");
  const [musicDuration, setMusicDuration] = useState(30);
  const [isInstrumental, setIsInstrumental] = useState(true);
  const [isGeneratingMusic, setIsGeneratingMusic] = useState(false);

  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(80);
  const [currentAudio, setCurrentAudio] = useState<string | null>(null);
  const [generatedAssets, setGeneratedAssets] = useState<
    Array<{ type: string; name: string; url: string }>
  >([]);
  const [error, setError] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Handle hydration
  useEffect(() => {
    setMounted(true);
  }, []);

  // Load presets on mount
  useEffect(() => {
    if (mounted) {
      loadPresets();
    }
  }, [mounted]);

  async function loadPresets() {
    try {
      // Load voice presets
      const voiceRes = await fetch("/api/audio/voices?type=presets");
      if (voiceRes.ok) {
        const data = await voiceRes.json();
        setVoicePresets(data.voices || []);
        if (data.voices?.length > 0) {
          setSelectedVoice(data.voices[0].id);
        }
      }

      // Load SFX presets
      const sfxRes = await fetch("/api/audio/sfx/generate");
      if (sfxRes.ok) {
        const data = await sfxRes.json();
        setSfxPresets(data.presets || []);
      }

      // Load music presets
      const musicRes = await fetch("/api/audio/music/generate");
      if (musicRes.ok) {
        const data = await musicRes.json();
        setMusicPresets(data.presets || []);
      }
    } catch (err) {
      log.error("Failed to load presets", err);
    }
  }

  async function handleGenerateVoice() {
    if (!textToSpeak.trim() || !selectedVoice) return;

    setIsGeneratingVoice(true);
    setError(null);

    try {
      const res = await fetch("/api/audio/voice/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: textToSpeak,
          voicePreset: selectedVoice,
          npcId,
          dialogueNodeId,
          withTimestamps: true,
          saveToAsset: true,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(
          data.message || data.error || "Failed to generate voice",
        );
      }

      const data = await res.json();
      setCurrentAudio(data.audio);
      setGeneratedAssets((prev) => [
        ...prev,
        { type: "voice", name: data.asset.name, url: data.audio },
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
      setIsGeneratingVoice(false);
    }
  }

  async function handleGenerateSFX() {
    const prompt = customSFXPrompt.trim() || undefined;
    const presetId = prompt ? undefined : selectedSFX;

    if (!prompt && !presetId) {
      setError("Please select a preset or enter a custom description");
      return;
    }

    setIsGeneratingSFX(true);
    setError(null);

    try {
      const res = await fetch("/api/audio/sfx/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          presetId,
          durationSeconds: sfxDuration,
          promptInfluence: 0.7,
          saveToAsset: true,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || data.error || "Failed to generate SFX");
      }

      const data = await res.json();
      setCurrentAudio(data.audio);
      setGeneratedAssets((prev) => [
        ...prev,
        { type: "sfx", name: data.asset.name, url: data.audio },
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
      setIsGeneratingSFX(false);
    }
  }

  async function handleGenerateMusic() {
    const prompt = customMusicPrompt.trim() || undefined;
    const presetId = prompt ? undefined : selectedMusic;

    if (!prompt && !presetId) {
      setError("Please select a preset or enter a custom description");
      return;
    }

    setIsGeneratingMusic(true);
    setError(null);

    try {
      const res = await fetch("/api/audio/music/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          presetId,
          durationMs: musicDuration * 1000,
          forceInstrumental: isInstrumental,
          loopable: true,
          saveToAsset: true,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(
          data.message || data.error || "Failed to generate music",
        );
      }

      const data = await res.json();
      setCurrentAudio(data.audio);
      setGeneratedAssets((prev) => [
        ...prev,
        { type: "music", name: data.asset.name, url: data.audio },
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
      setIsGeneratingMusic(false);
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

  function handleStop() {
    if (!audioRef.current) return;
    audioRef.current.pause();
    audioRef.current.currentTime = 0;
    setIsPlaying(false);
  }

  function handleDownload() {
    if (!currentAudio) return;

    const link = document.createElement("a");
    link.href = currentAudio;
    link.download = `hyperforge_audio_${Date.now()}.mp3`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // Update audio volume
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume / 100;
    }
  }, [volume]);

  // Show loading skeleton during SSR to avoid hydration mismatch
  if (!mounted) {
    return (
      <div className="flex flex-col h-full">
        <div className="p-4 border-b border-glass-border">
          <div className="h-6 w-32 bg-glass-bg/50 rounded animate-pulse mb-2" />
          <div className="h-4 w-48 bg-glass-bg/30 rounded animate-pulse" />
        </div>
        <div className="flex-1 p-4">
          <div className="h-10 bg-glass-bg/30 rounded animate-pulse mb-4" />
          <div className="space-y-3">
            <div className="h-20 bg-glass-bg/30 rounded animate-pulse" />
            <div className="h-20 bg-glass-bg/30 rounded animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Hidden audio element */}
      <audio
        ref={audioRef}
        onEnded={() => setIsPlaying(false)}
        onError={() => setError("Audio playback error")}
      />

      <div className="p-4 border-b border-glass-border">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold">Audio Studio</h2>
          <Badge
            variant="outline"
            className="text-xs bg-cyan-500/10 text-cyan-400"
          >
            ElevenLabs
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Generate voice, SFX, and music with AI
        </p>
      </div>

      {/* Error display */}
      {error && (
        <div className="mx-4 mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 flex items-center gap-2 text-sm text-red-400">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        <Tabs defaultValue="voice" className="w-full">
          <div className="p-4 border-b border-glass-border">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="voice">
                <Mic className="w-4 h-4 mr-1" />
                Voice
              </TabsTrigger>
              <TabsTrigger value="sfx">
                <AudioWaveform className="w-4 h-4 mr-1" />
                SFX
              </TabsTrigger>
              <TabsTrigger value="music">
                <Music className="w-4 h-4 mr-1" />
                Music
              </TabsTrigger>
            </TabsList>
          </div>

          {/* Voice Tab */}
          <TabsContent value="voice" className="mt-0 p-4 space-y-4">
            {/* Voice Preset Selection */}
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground uppercase tracking-wider">
                Voice Preset
              </div>
              <div className="grid grid-cols-2 gap-2">
                {voicePresets.map((voice) => (
                  <button
                    key={voice.id}
                    onClick={() => setSelectedVoice(voice.id)}
                    className={`
                      p-2 rounded-lg text-left transition-all
                      ${
                        selectedVoice === voice.id
                          ? "bg-cyan-500/20 border border-cyan-500/30"
                          : "bg-glass-bg/50 border border-glass-border hover:bg-glass-bg"
                      }
                    `}
                  >
                    <div className="text-xs font-medium">{voice.name}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {voice.description}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Text Input */}
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground uppercase tracking-wider">
                Text to Speak
              </div>
              <textarea
                value={textToSpeak}
                onChange={(e) => setTextToSpeak(e.target.value)}
                placeholder="Enter the dialogue text..."
                className="w-full h-24 px-3 py-2 bg-glass-bg border border-glass-border rounded-lg text-sm resize-none focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
              />
            </div>

            {/* Generate Button */}
            <SpectacularButton
              className="w-full"
              onClick={handleGenerateVoice}
              disabled={
                !textToSpeak.trim() || !selectedVoice || isGeneratingVoice
              }
            >
              {isGeneratingVoice ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 mr-2" />
                  Generate Voice
                </>
              )}
            </SpectacularButton>
          </TabsContent>

          {/* SFX Tab */}
          <TabsContent value="sfx" className="mt-0 p-4 space-y-4">
            {/* SFX Preset Selection */}
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground uppercase tracking-wider">
                SFX Preset
              </div>
              <Select
                value={selectedSFX}
                onChange={(value) => setSelectedSFX(value)}
                options={sfxPresets.map((p) => ({
                  value: p.id,
                  label: p.name,
                }))}
                placeholder="Select a preset..."
              />
            </div>

            {/* Custom Prompt */}
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground uppercase tracking-wider">
                Or Custom Description
              </div>
              <input
                type="text"
                value={customSFXPrompt}
                onChange={(e) => setCustomSFXPrompt(e.target.value)}
                placeholder="e.g., 'Heavy footsteps on gravel'"
                className="w-full px-3 py-2 bg-glass-bg border border-glass-border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
              />
            </div>

            {/* Duration */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-xs text-muted-foreground uppercase tracking-wider">
                  Duration
                </span>
                <span className="font-mono text-xs">{sfxDuration}s</span>
              </div>
              <Slider
                value={[sfxDuration]}
                onValueChange={([value]) => setSfxDuration(value)}
                min={0.5}
                max={10}
                step={0.5}
              />
            </div>

            <SpectacularButton
              className="w-full"
              onClick={handleGenerateSFX}
              disabled={
                (!selectedSFX && !customSFXPrompt.trim()) || isGeneratingSFX
              }
            >
              {isGeneratingSFX ? (
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
          </TabsContent>

          {/* Music Tab */}
          <TabsContent value="music" className="mt-0 p-4 space-y-4">
            {/* Music Preset Selection */}
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground uppercase tracking-wider">
                Music Preset
              </div>
              <Select
                value={selectedMusic}
                onChange={(value) => setSelectedMusic(value)}
                options={musicPresets.map((p) => ({
                  value: p.id,
                  label: p.name,
                }))}
                placeholder="Select a preset..."
              />
            </div>

            {/* Custom Prompt */}
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground uppercase tracking-wider">
                Or Custom Description
              </div>
              <textarea
                value={customMusicPrompt}
                onChange={(e) => setCustomMusicPrompt(e.target.value)}
                placeholder="e.g., 'Epic orchestral battle music with driving drums'"
                className="w-full h-20 px-3 py-2 bg-glass-bg border border-glass-border rounded-lg text-sm resize-none focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
              />
            </div>

            {/* Duration */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-xs text-muted-foreground uppercase tracking-wider">
                  Duration
                </span>
                <span className="font-mono text-xs">{musicDuration}s</span>
              </div>
              <Slider
                value={[musicDuration]}
                onValueChange={([value]) => setMusicDuration(value)}
                min={10}
                max={120}
                step={10}
              />
            </div>

            {/* Instrumental Toggle */}
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={isInstrumental}
                onChange={(e) => setIsInstrumental(e.target.checked)}
                className="w-4 h-4 rounded border-glass-border bg-glass-bg accent-cyan-500"
              />
              <span className="text-sm">Instrumental only (no vocals)</span>
            </label>

            <SpectacularButton
              className="w-full"
              onClick={handleGenerateMusic}
              disabled={
                (!selectedMusic && !customMusicPrompt.trim()) ||
                isGeneratingMusic
              }
            >
              {isGeneratingMusic ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Music className="w-4 h-4 mr-2" />
                  Generate Music
                </>
              )}
            </SpectacularButton>
          </TabsContent>
        </Tabs>

        {/* Generated Assets List */}
        {generatedAssets.length > 0 && (
          <div className="p-4 border-t border-glass-border">
            <div className="text-xs text-muted-foreground uppercase tracking-wider mb-2">
              Generated Audio
            </div>
            <div className="space-y-2 max-h-32 overflow-y-auto">
              {generatedAssets.slice(-5).map((asset, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 p-2 rounded bg-glass-bg/50 text-sm cursor-pointer hover:bg-glass-bg"
                  onClick={() => {
                    setCurrentAudio(asset.url);
                    if (audioRef.current) {
                      audioRef.current.src = asset.url;
                      audioRef.current.play();
                      setIsPlaying(true);
                    }
                  }}
                >
                  <Badge variant="outline" className="text-xs">
                    {asset.type}
                  </Badge>
                  <span className="truncate">{asset.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Audio Playback Controls */}
      <div className="p-4 border-t border-glass-border">
        <div className="flex items-center gap-3">
          <SpectacularButton
            size="sm"
            variant="outline"
            onClick={handlePlayPause}
            disabled={!currentAudio}
          >
            {isPlaying ? (
              <Pause className="w-4 h-4" />
            ) : (
              <Play className="w-4 h-4" />
            )}
          </SpectacularButton>
          <SpectacularButton
            size="sm"
            variant="outline"
            onClick={handleStop}
            disabled={!currentAudio}
          >
            <Square className="w-4 h-4" />
          </SpectacularButton>
          <div className="flex-1">
            <div className="h-1 bg-glass-bg rounded-full overflow-hidden">
              <div
                className="h-full bg-cyan-400 rounded-full transition-all"
                style={{ width: currentAudio ? "100%" : "0%" }}
              />
            </div>
          </div>
          <SpectacularButton
            size="sm"
            variant="outline"
            onClick={handleDownload}
            disabled={!currentAudio}
          >
            <Download className="w-4 h-4" />
          </SpectacularButton>
          <div className="flex items-center gap-2">
            <Volume2 className="w-4 h-4 text-muted-foreground" />
            <Slider
              value={[volume]}
              onValueChange={([value]) => setVolume(value)}
              min={0}
              max={100}
              step={1}
              className="w-20"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
