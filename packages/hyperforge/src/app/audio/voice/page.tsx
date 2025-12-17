"use client";

import { useState, useRef, useEffect } from "react";
import { StudioPageLayout } from "@/components/layout/StudioPageLayout";
import { SpectacularButton } from "@/components/ui/spectacular-button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import {
  Mic,
  Play,
  Pause,
  Download,
  Loader2,
  Volume2,
  Sparkles,
  AlertCircle,
  Clock,
  FileAudio,
} from "lucide-react";
import { logger } from "@/lib/utils";

const log = logger.child("VoicePage");

interface VoicePreset {
  id: string;
  voiceId: string;
  name: string;
  description: string;
}

interface GeneratedVoice {
  id: string;
  text: string;
  voicePreset: string;
  audioUrl: string;
  duration: number;
  generatedAt: string;
}

export default function VoiceGeneratorPage() {
  const [voicePresets, setVoicePresets] = useState<VoicePreset[]>([]);
  const [selectedVoice, setSelectedVoice] = useState<string>("");
  const [textToSpeak, setTextToSpeak] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(80);
  const [currentAudio, setCurrentAudio] = useState<string | null>(null);
  const [generatedVoices, setGeneratedVoices] = useState<GeneratedVoice[]>([]);
  const [error, setError] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Load voice presets
  useEffect(() => {
    async function loadPresets() {
      try {
        const res = await fetch("/api/audio/voices?type=presets");
        if (res.ok) {
          const data = await res.json();
          setVoicePresets(data.voices || []);
          if (data.voices?.length > 0) {
            setSelectedVoice(data.voices[0].id);
          }
        }
      } catch (err) {
        log.error({ error: err }, "Failed to load voice presets");
      }
    }
    loadPresets();
  }, []);

  async function handleGenerate() {
    if (!textToSpeak.trim() || !selectedVoice) return;

    setIsGenerating(true);
    setError(null);

    try {
      const res = await fetch("/api/audio/voice/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: textToSpeak,
          voicePreset: selectedVoice,
          withTimestamps: true,
          saveToAsset: true,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to generate voice");
      }

      const data = await res.json();
      setCurrentAudio(data.audio);

      // Add to history
      setGeneratedVoices((prev) => [
        {
          id: data.asset.id,
          text: textToSpeak,
          voicePreset: selectedVoice,
          audioUrl: data.audio,
          duration: data.asset.duration,
          generatedAt: new Date().toISOString(),
        },
        ...prev.slice(0, 9), // Keep last 10
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

  function playVoice(voice: GeneratedVoice) {
    setCurrentAudio(voice.audioUrl);
    if (audioRef.current) {
      audioRef.current.src = voice.audioUrl;
      audioRef.current.play();
      setIsPlaying(true);
    }
  }

  function handleDownload() {
    if (!currentAudio) return;
    const link = document.createElement("a");
    link.href = currentAudio;
    link.download = `voice_${Date.now()}.mp3`;
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
      title="Voice Generator"
      description="Generate NPC dialogue with AI voices"
      showVault={false}
    >
      <audio ref={audioRef} onEnded={() => setIsPlaying(false)} />

      <div className="h-full flex">
        <div className="flex-1 p-6 overflow-auto">
          <div className="max-w-4xl mx-auto">
            {/* Header */}
            <div className="mb-8">
              <h1 className="text-3xl font-bold mb-2 flex items-center gap-3">
                <Mic className="w-8 h-8 text-cyan-400" />
                Voice Generator
              </h1>
              <p className="text-muted-foreground">
                Convert text to lifelike NPC dialogue using ElevenLabs AI
                voices.
              </p>
            </div>

            {/* Error */}
            {error && (
              <div className="mb-6 p-4 rounded-lg bg-red-500/10 border border-red-500/30 flex items-center gap-3 text-red-400">
                <AlertCircle className="w-5 h-5 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Main Generation Card */}
            <div className="p-6 rounded-xl border border-glass-border bg-glass-bg/30 backdrop-blur-sm mb-8">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Voice Selection */}
                <div className="space-y-4">
                  <div className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                    Select Voice
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {voicePresets.map((voice) => (
                      <button
                        key={voice.id}
                        onClick={() => setSelectedVoice(voice.id)}
                        className={`
                          p-3 rounded-lg text-left transition-all
                          ${
                            selectedVoice === voice.id
                              ? "bg-cyan-500/20 border-2 border-cyan-500/50"
                              : "bg-glass-bg/50 border border-glass-border hover:bg-glass-bg"
                          }
                        `}
                      >
                        <div className="font-medium text-sm">{voice.name}</div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {voice.description}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Text Input */}
                <div className="space-y-4">
                  <div className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                    Dialogue Text
                  </div>
                  <textarea
                    value={textToSpeak}
                    onChange={(e) => setTextToSpeak(e.target.value)}
                    placeholder="Enter the dialogue text... e.g., 'Greetings, traveler! What brings you to our humble village?'"
                    className="w-full h-40 px-4 py-3 bg-glass-bg border border-glass-border rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                  />
                  <div className="flex justify-between items-center text-xs text-muted-foreground">
                    <span>{textToSpeak.length} characters</span>
                    <span>~{Math.ceil(textToSpeak.length / 100)} seconds</span>
                  </div>
                </div>
              </div>

              {/* Generate Button */}
              <div className="mt-6 flex items-center gap-4">
                <SpectacularButton
                  size="lg"
                  onClick={handleGenerate}
                  disabled={
                    !textToSpeak.trim() || !selectedVoice || isGenerating
                  }
                  className="flex-1"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                      Generating Voice...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-5 h-5 mr-2" />
                      Generate Voice
                    </>
                  )}
                </SpectacularButton>

                {currentAudio && (
                  <>
                    <SpectacularButton
                      variant="outline"
                      onClick={handlePlayPause}
                    >
                      {isPlaying ? (
                        <Pause className="w-5 h-5" />
                      ) : (
                        <Play className="w-5 h-5" />
                      )}
                    </SpectacularButton>
                    <SpectacularButton
                      variant="outline"
                      onClick={handleDownload}
                    >
                      <Download className="w-5 h-5" />
                    </SpectacularButton>
                  </>
                )}
              </div>

              {/* Volume Control */}
              {currentAudio && (
                <div className="mt-4 flex items-center gap-3">
                  <Volume2 className="w-4 h-4 text-muted-foreground" />
                  <Slider
                    value={[volume]}
                    onValueChange={([v]) => setVolume(v)}
                    min={0}
                    max={100}
                    className="w-32"
                  />
                  <span className="text-xs text-muted-foreground">
                    {volume}%
                  </span>
                </div>
              )}
            </div>

            {/* Generated History */}
            {generatedVoices.length > 0 && (
              <div className="space-y-4">
                <div className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                  Recent Generations
                </div>
                <div className="space-y-3">
                  {generatedVoices.map((voice) => (
                    <div
                      key={voice.id}
                      className="p-4 rounded-lg border border-glass-border bg-glass-bg/30 flex items-center gap-4 hover:bg-glass-bg/50 transition-all cursor-pointer"
                      onClick={() => playVoice(voice)}
                    >
                      <div className="w-10 h-10 rounded-lg bg-cyan-500/20 flex items-center justify-center">
                        <FileAudio className="w-5 h-5 text-cyan-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm truncate">{voice.text}</div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                          <Badge variant="outline" className="text-xs">
                            {voice.voicePreset}
                          </Badge>
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {voice.duration.toFixed(1)}s
                          </span>
                        </div>
                      </div>
                      <SpectacularButton size="sm" variant="ghost">
                        <Play className="w-4 h-4" />
                      </SpectacularButton>
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
