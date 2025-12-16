"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Play,
  Pause,
  Volume2,
  Download,
  Trash2,
  Mic,
  Music,
  Wand2,
  FolderOpen,
  RefreshCw,
} from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { SpectacularButton } from "@/components/ui/spectacular-button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

interface AudioAsset {
  id: string;
  filename: string;
  type: "voice" | "sfx" | "music";
  url: string;
  size: number;
  createdAt: string;
  metadata?: {
    text?: string;
    voicePreset?: string;
    prompt?: string;
    category?: string;
    npcId?: string;
    dialogueNodeId?: string;
  };
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface AudioItemProps {
  asset: AudioAsset;
  isPlaying: boolean;
  onPlay: () => void;
  onPause: () => void;
  onDownload: () => void;
}

function AudioItem({
  asset,
  isPlaying,
  onPlay,
  onPause,
  onDownload,
}: AudioItemProps) {
  const typeIcons = {
    voice: <Mic className="w-4 h-4" />,
    sfx: <Wand2 className="w-4 h-4" />,
    music: <Music className="w-4 h-4" />,
  };

  const typeColors = {
    voice: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
    sfx: "bg-purple-500/20 text-purple-400 border-purple-500/30",
    music: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  };

  return (
    <div className="flex items-center gap-3 p-3 rounded-lg bg-glass-bg/50 border border-glass-border hover:border-glass-border-hover transition-colors">
      {/* Play/Pause Button */}
      <button
        onClick={isPlaying ? onPause : onPlay}
        className={cn(
          "w-10 h-10 rounded-full flex items-center justify-center transition-colors",
          isPlaying
            ? "bg-cyan-500 text-white"
            : "bg-glass-bg border border-glass-border hover:bg-cyan-500/20",
        )}
      >
        {isPlaying ? (
          <Pause className="w-4 h-4" />
        ) : (
          <Play className="w-4 h-4 ml-0.5" />
        )}
      </button>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm truncate">{asset.filename}</span>
          <Badge
            variant="outline"
            className={cn("text-xs", typeColors[asset.type])}
          >
            {typeIcons[asset.type]}
            <span className="ml-1 capitalize">{asset.type}</span>
          </Badge>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
          <span>{formatFileSize(asset.size)}</span>
          <span>•</span>
          <span>{formatDate(asset.createdAt)}</span>
          {asset.metadata?.category && (
            <>
              <span>•</span>
              <span className="capitalize">{asset.metadata.category}</span>
            </>
          )}
        </div>
        {asset.metadata?.text && (
          <p className="text-xs text-muted-foreground mt-1 truncate">
            &quot;{asset.metadata.text}&quot;
          </p>
        )}
        {asset.metadata?.prompt && (
          <p className="text-xs text-muted-foreground mt-1 truncate italic">
            {asset.metadata.prompt}
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1">
        <button
          onClick={onDownload}
          className="p-2 rounded-lg hover:bg-glass-bg transition-colors"
          title="Download"
        >
          <Download className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

export function AudioAssetsViewer() {
  const [assets, setAssets] = useState<AudioAsset[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"all" | "voice" | "sfx" | "music">(
    "all",
  );
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Fetch assets
  const fetchAssets = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/audio/assets");
      if (res.ok) {
        const data = await res.json();
        setAssets(data);
      }
    } catch (error) {
      console.error("Failed to fetch audio assets:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAssets();
  }, [fetchAssets]);

  // Filter assets by type
  const filteredAssets =
    activeTab === "all" ? assets : assets.filter((a) => a.type === activeTab);

  // Audio playback
  const handlePlay = useCallback((asset: AudioAsset) => {
    if (audioRef.current) {
      audioRef.current.src = asset.url;
      audioRef.current.play();
      setPlayingId(asset.id);
    }
  }, []);

  const handlePause = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      setPlayingId(null);
    }
  }, []);

  const handleDownload = useCallback((asset: AudioAsset) => {
    const a = document.createElement("a");
    a.href = asset.url;
    a.download = asset.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, []);

  // Count by type
  const counts = {
    all: assets.length,
    voice: assets.filter((a) => a.type === "voice").length,
    sfx: assets.filter((a) => a.type === "sfx").length,
    music: assets.filter((a) => a.type === "music").length,
  };

  return (
    <GlassPanel intensity="medium" className="p-4">
      {/* Hidden audio element */}
      <audio
        ref={audioRef}
        onEnded={() => setPlayingId(null)}
        onError={() => setPlayingId(null)}
      />

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <FolderOpen className="w-5 h-5 text-cyan-400" />
          <h3 className="font-semibold">Generated Audio Assets</h3>
          <Badge variant="outline" className="text-xs">
            {assets.length} files
          </Badge>
        </div>
        <SpectacularButton
          variant="ghost"
          size="sm"
          onClick={fetchAssets}
          disabled={isLoading}
        >
          <RefreshCw className={cn("w-4 h-4", isLoading && "animate-spin")} />
        </SpectacularButton>
      </div>

      {/* Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as typeof activeTab)}
        className="w-full"
      >
        <TabsList className="grid w-full grid-cols-4 mb-4">
          <TabsTrigger value="all" className="text-xs">
            All ({counts.all})
          </TabsTrigger>
          <TabsTrigger value="voice" className="text-xs">
            <Mic className="w-3 h-3 mr-1" />
            Voice ({counts.voice})
          </TabsTrigger>
          <TabsTrigger value="sfx" className="text-xs">
            <Wand2 className="w-3 h-3 mr-1" />
            SFX ({counts.sfx})
          </TabsTrigger>
          <TabsTrigger value="music" className="text-xs">
            <Music className="w-3 h-3 mr-1" />
            Music ({counts.music})
          </TabsTrigger>
        </TabsList>

        <TabsContent value={activeTab} className="mt-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : filteredAssets.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Volume2 className="w-12 h-12 mx-auto mb-4 opacity-30" />
              <p className="text-sm">No audio assets generated yet</p>
              <p className="text-xs mt-1">
                Generate voice, SFX, or music using the panels above
              </p>
            </div>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
              {filteredAssets.map((asset) => (
                <AudioItem
                  key={asset.id}
                  asset={asset}
                  isPlaying={playingId === asset.id}
                  onPlay={() => handlePlay(asset)}
                  onPause={handlePause}
                  onDownload={() => handleDownload(asset)}
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </GlassPanel>
  );
}
