"use client";

import { useState, useEffect, useRef, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { logger } from "@/lib/utils";

const log = logger.child("Retarget");
import * as _THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  RefreshCw,
  Loader2,
  Check,
  Download,
  Play,
  Pause,
  Square,
  Upload,
  AlertTriangle,
  FileCode,
  Bone,
  RotateCcw,
  Search,
  User,
} from "lucide-react";
import type { VRM } from "@pixiv/three-vrm";

import { StudioPageLayout } from "@/components/layout/StudioPageLayout";
import {
  VRMViewer,
  type VRMViewerRef,
  type VRMInfo,
} from "@/components/viewer/VRMViewer";
import {
  convertGLBToVRM,
  type VRMConversionResult,
} from "@/services/vrm/VRMConverter";

interface Asset {
  id: string;
  name: string;
  source: "LOCAL" | "CDN";
  category: string;
  type: string;
  thumbnailUrl?: string;
  modelUrl?: string;
  hasVRM?: boolean;
  vrmPath?: string;
  modelPath?: string;
}

interface Emote {
  id: string;
  name: string;
  path: string;
}

const CDN_URL = process.env.NEXT_PUBLIC_CDN_URL || "http://localhost:8080";

function RetargetContent() {
  const searchParams = useSearchParams();
  const preSelectedAssetId = searchParams.get("asset");
  const viewerRef = useRef<VRMViewerRef>(null);

  // Hydration fix - ensure consistent rendering between server and client
  const [mounted, setMounted] = useState(false);

  // State
  const [avatars, setAvatars] = useState<Asset[]>([]);
  const [emotes, setEmotes] = useState<Emote[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  const [selectedAvatar, setSelectedAvatar] = useState<Asset | null>(null);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [uploadedFileUrl, setUploadedFileUrl] = useState<string | null>(null);

  // VRM Conversion
  const [isConverting, setIsConverting] = useState(false);
  const [vrmConverted, setVrmConverted] = useState(false);
  const [vrmUrl, setVrmUrl] = useState<string | null>(null);
  const [conversionWarnings, setConversionWarnings] = useState<string[]>([]);
  const [vrmInfo, setVrmInfo] = useState<VRMInfo | null>(null);

  // Animation
  const [selectedAnimation, setSelectedAnimation] = useState<string>("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [showBones, setShowBones] = useState(false);

  // Ensure consistent rendering between server and client for icons
  useEffect(() => {
    setMounted(true);
  }, []);

  // Load assets and emotes
  useEffect(() => {
    async function loadData() {
      try {
        const [localRes, cdnRes, emotesRes] = await Promise.all([
          fetch("/api/assets/local").catch(() => null),
          fetch("/api/assets/cdn").catch(() => null),
          fetch("/api/emotes").catch(() => null),
        ]);

        const localAssets: Asset[] = localRes?.ok ? await localRes.json() : [];
        const cdnAssets: Asset[] = cdnRes?.ok ? await cdnRes.json() : [];
        const emotesData: Emote[] = emotesRes?.ok ? await emotesRes.json() : [];

        const all = [...localAssets, ...cdnAssets];

        // Filter for VRM avatars and characters
        const avatarAssets = all.filter(
          (a) =>
            a.hasVRM ||
            a.vrmPath ||
            a.type === "avatar" ||
            a.type === "character" ||
            a.category === "avatar" ||
            (a.category === "npc" && a.modelPath?.endsWith(".vrm")),
        );

        setAvatars(avatarAssets);
        setEmotes(emotesData);

        // Pre-select asset if specified in URL
        if (preSelectedAssetId) {
          const preSelected =
            avatarAssets.find((a) => a.id === preSelectedAssetId) ||
            all.find((a) => a.id === preSelectedAssetId);
          if (preSelected) {
            setSelectedAvatar(preSelected);
            // If it's already a VRM, set it directly
            if (
              preSelected.vrmPath ||
              preSelected.modelPath?.endsWith(".vrm")
            ) {
              const vrmPath = preSelected.vrmPath || preSelected.modelPath;
              if (vrmPath) {
                // Determine the correct URL based on path type
                let vrmUrlToSet: string;
                if (vrmPath.startsWith("/api/")) {
                  // Local API path - use directly
                  vrmUrlToSet = vrmPath;
                } else if (vrmPath.startsWith("asset://")) {
                  // Asset CDN path
                  vrmUrlToSet = vrmPath.replace("asset://", `${CDN_URL}/`);
                } else if (vrmPath.startsWith("http")) {
                  // Full URL
                  vrmUrlToSet = vrmPath;
                } else {
                  // Relative path - prepend CDN
                  vrmUrlToSet = `${CDN_URL}/${vrmPath}`;
                }
                log.info("Pre-selecting VRM:", vrmUrlToSet);
                setVrmUrl(vrmUrlToSet);
                setVrmConverted(true);
              }
            }
          }
        }

        log.info(
          `Loaded ${avatarAssets.length} avatars, ${emotesData.length} emotes`,
        );
      } catch (error) {
        log.error("Failed to load assets:", error);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [preSelectedAssetId]);

  // Handle file upload
  const handleFileUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        // Revoke previous URL
        if (uploadedFileUrl) {
          URL.revokeObjectURL(uploadedFileUrl);
        }

        const url = URL.createObjectURL(file);
        setUploadedFile(file);
        setUploadedFileUrl(url);
        setSelectedAvatar(null);
        setVrmConverted(false);
        setVrmUrl(null);
        setConversionWarnings([]);
      }
    },
    [uploadedFileUrl],
  );

  // Real VRM Conversion using VRMConverter service
  const handleConvertToVRM = async () => {
    if (!selectedAvatar && !uploadedFile) return;

    setIsConverting(true);
    setConversionWarnings([]);

    try {
      let modelUrl: string;

      if (uploadedFileUrl) {
        modelUrl = uploadedFileUrl;
      } else if (selectedAvatar) {
        // Get model URL from asset
        const modelPath = selectedAvatar.modelUrl || selectedAvatar.modelPath;
        if (!modelPath) {
          throw new Error("No model URL found for selected asset");
        }
        // Handle different URL formats
        if (modelPath.startsWith("http")) {
          modelUrl = modelPath;
        } else if (modelPath.startsWith("/")) {
          modelUrl = modelPath; // Local API paths
        } else if (modelPath.startsWith("asset://")) {
          modelUrl = modelPath.replace("asset://", `${CDN_URL}/`);
        } else {
          modelUrl = `${CDN_URL}/${modelPath}`;
        }
      } else {
        throw new Error("No model selected");
      }

      log.info("Loading GLB from:", modelUrl);

      // Load the GLB file
      const loader = new GLTFLoader();
      const gltf = await loader.loadAsync(modelUrl);

      log.info("GLB loaded, starting VRM conversion...");

      // Convert to VRM using real converter
      const result: VRMConversionResult = await convertGLBToVRM(gltf.scene, {
        avatarName:
          selectedAvatar?.name || uploadedFile?.name || "Converted Avatar",
        author: "HyperForge",
        version: "1.0",
        commercialUsage: "personalNonProfit",
      });

      log.info("VRM conversion complete!");
      log.debug(`Bones mapped: ${result.boneMappings.size}`);
      log.debug(`Warnings: ${result.warnings.length}`);

      // Create blob URL for the VRM
      const blob = new Blob([result.vrmData], {
        type: "application/octet-stream",
      });
      const vrmBlobUrl = URL.createObjectURL(blob);

      setVrmUrl(vrmBlobUrl);
      setConversionWarnings(result.warnings);
      setVrmConverted(true);
    } catch (error) {
      log.error("VRM conversion failed:", error);
      setConversionWarnings([`Conversion failed: ${(error as Error).message}`]);
    } finally {
      setIsConverting(false);
    }
  };

  // Handle VRM load from viewer
  const handleVRMLoad = useCallback((vrm: VRM, info: VRMInfo) => {
    log.info("VRM loaded in viewer:", info);
    setVrmInfo(info);
  }, []);

  // Play animation
  const handlePlayAnimation = useCallback(
    async (emote: Emote) => {
      if (!viewerRef.current || !vrmConverted) return;

      const animUrl = emote.path.startsWith("http")
        ? emote.path
        : `${CDN_URL}/${emote.path}`;

      log.info("Playing animation:", animUrl);

      await viewerRef.current.loadAnimation(animUrl);
      setSelectedAnimation(emote.id);
      setIsPlaying(true);
    },
    [vrmConverted],
  );

  // Playback controls
  const handlePause = useCallback(() => {
    viewerRef.current?.pauseAnimation();
    setIsPlaying(false);
  }, []);

  const handleResume = useCallback(() => {
    viewerRef.current?.playAnimation();
    setIsPlaying(true);
  }, []);

  const handleStop = useCallback(() => {
    viewerRef.current?.stopAnimation();
    setSelectedAnimation("");
    setIsPlaying(false);
  }, []);

  // Export VRM
  const handleExport = useCallback(() => {
    if (!vrmUrl) return;

    const a = document.createElement("a");
    a.href = vrmUrl;
    a.download = `${selectedAvatar?.name || uploadedFile?.name || "avatar"}.vrm`;
    a.click();
  }, [vrmUrl, selectedAvatar, uploadedFile]);

  // Reset workflow
  const handleReset = useCallback(() => {
    setVrmConverted(false);
    setVrmUrl(null);
    setConversionWarnings([]);
    setSelectedAnimation("");
    setIsPlaying(false);
    setVrmInfo(null);
  }, []);

  // Select avatar
  const handleSelectAvatar = useCallback(
    (avatar: Asset) => {
      setSelectedAvatar(avatar);
      setUploadedFile(null);
      if (uploadedFileUrl) {
        URL.revokeObjectURL(uploadedFileUrl);
        setUploadedFileUrl(null);
      }

      // If already a VRM (has vrmPath or hasVRM flag), load directly
      if (
        avatar.vrmPath ||
        avatar.hasVRM ||
        avatar.modelPath?.endsWith(".vrm")
      ) {
        const vrmPath = avatar.vrmPath || avatar.modelPath;
        if (vrmPath) {
          // Determine the correct URL based on path type
          let vrmUrlToSet: string;
          if (vrmPath.startsWith("/api/")) {
            // Local API path - use directly
            vrmUrlToSet = vrmPath;
          } else if (vrmPath.startsWith("asset://")) {
            // Asset CDN path
            vrmUrlToSet = vrmPath.replace("asset://", `${CDN_URL}/`);
          } else if (vrmPath.startsWith("http")) {
            // Full URL
            vrmUrlToSet = vrmPath;
          } else {
            // Relative path - prepend CDN
            vrmUrlToSet = `${CDN_URL}/${vrmPath}`;
          }

          log.info("Loading VRM directly:", vrmUrlToSet);
          setVrmUrl(vrmUrlToSet);
          setVrmConverted(true);
          setConversionWarnings([]);
        }
      } else {
        handleReset();
      }
    },
    [uploadedFileUrl, handleReset],
  );

  const modelName = selectedAvatar?.name || uploadedFile?.name || "No model";

  // Show minimal loading state during SSR to avoid hydration mismatch with Lucide icons
  if (!mounted) {
    return (
      <div className="flex h-screen bg-background overflow-hidden">
        <aside className="w-56 border-r border-glass-border bg-glass-bg/30" />
        <main className="flex-1 relative overflow-hidden bg-gradient-to-b from-zinc-900 to-zinc-950 flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-cyan-500" />
        </main>
      </div>
    );
  }

  // Filter avatars by search
  const filteredAvatars = avatars.filter((a) =>
    a.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  // Asset Selection Sidebar
  const assetSidebar = (
    <div className="flex flex-col h-full">
      {/* Search */}
      <div className="p-4 border-b border-glass-border">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search avatars..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-glass-bg border border-glass-border rounded-lg text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* File Upload */}
        <div>
          <label className="text-xs text-muted-foreground mb-2 block px-1">
            Upload GLB/GLTF/VRM
          </label>
          <label className="flex items-center gap-2 px-4 py-3 rounded-lg border border-dashed border-glass-border hover:border-cyan-500/50 cursor-pointer transition-colors">
            <Upload className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground truncate">
              {uploadedFile ? uploadedFile.name : "Choose file..."}
            </span>
            <input
              type="file"
              accept=".glb,.gltf,.vrm"
              onChange={handleFileUpload}
              className="hidden"
            />
          </label>
        </div>

        {/* Divider */}
        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-glass-border" />
          </div>
          <div className="relative flex justify-center text-xs">
            <span className="px-2 bg-background text-muted-foreground">
              or select
            </span>
          </div>
        </div>

        {/* Avatar List */}
        <div>
          <div className="flex items-center gap-2 mb-2 px-1">
            <User className="w-4 h-4 text-cyan-400" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Avatars
            </h3>
          </div>
          <div className="space-y-1">
            {loading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : filteredAvatars.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No avatars found
              </p>
            ) : (
              filteredAvatars.map((avatar) => (
                <button
                  key={avatar.id}
                  onClick={() => handleSelectAvatar(avatar)}
                  disabled={isConverting}
                  className={`w-full p-2 rounded-lg text-left transition-all text-sm ${
                    selectedAvatar?.id === avatar.id
                      ? "bg-cyan-500/20 border border-cyan-500/40"
                      : "bg-glass-bg/30 border border-transparent hover:bg-glass-bg/50"
                  } disabled:opacity-50`}
                >
                  <div className="font-medium truncate">{avatar.name}</div>
                  <div className="text-xs text-muted-foreground flex items-center gap-2">
                    <span>{avatar.source}</span>
                    {avatar.hasVRM && (
                      <span className="text-green-400">VRM</span>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );

  // Tools Sidebar
  const toolsSidebar = (
    <div className="p-4 space-y-4">
      {/* Step 1: Convert to VRM */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <FileCode className="w-4 h-4 text-cyan-400" />
          <h3 className="text-sm font-semibold">VRM Conversion</h3>
        </div>

        {/* Convert Button */}
        {(selectedAvatar || uploadedFile) && !vrmConverted && (
          <button
            onClick={handleConvertToVRM}
            disabled={isConverting}
            className="w-full py-2.5 rounded-lg font-medium transition-all flex items-center justify-center gap-2 text-sm bg-gradient-to-r from-cyan-500 to-blue-600 text-white hover:from-cyan-400 hover:to-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isConverting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Converting...
              </>
            ) : (
              <>
                <FileCode className="w-4 h-4" />
                Convert to VRM
              </>
            )}
          </button>
        )}

        {/* VRM Converted Status */}
        {vrmConverted && (
          <div className="p-3 bg-green-500/10 border border-green-500/30 rounded-lg">
            <div className="flex items-center gap-2 text-green-400 text-xs font-medium mb-2">
              <Check className="w-3 h-3" />
              VRM Ready
            </div>
            {vrmInfo && (
              <ul className="text-xs text-green-300/70 space-y-1">
                <li>• {vrmInfo.boneCount} humanoid bones</li>
                <li>• Height: {vrmInfo.height.toFixed(2)}m</li>
                <li>• VRM {vrmInfo.version}</li>
              </ul>
            )}
          </div>
        )}

        {/* Conversion Warnings */}
        {conversionWarnings.length > 0 && (
          <div className="mt-3 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
            <div className="flex items-center gap-2 text-amber-400 text-xs font-medium mb-2">
              <AlertTriangle className="w-3 h-3" />
              Notes
            </div>
            {conversionWarnings.map((warning, idx) => (
              <p key={idx} className="text-xs text-amber-300/70">
                • {warning}
              </p>
            ))}
          </div>
        )}
      </div>

      {/* Step 2: Test Animations */}
      {vrmConverted && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Play className="w-4 h-4 text-purple-400" />
            <h3 className="text-sm font-semibold">Test Animations</h3>
          </div>

          {/* Emote Grid */}
          <div className="space-y-2 mb-4">
            <label className="text-xs text-muted-foreground">
              {emotes.length} emotes from CDN
            </label>
            <div className="grid grid-cols-3 gap-1 max-h-32 overflow-y-auto">
              {emotes.map((emote) => (
                <button
                  key={emote.id}
                  onClick={() => handlePlayAnimation(emote)}
                  className={`px-2 py-1.5 rounded text-xs transition-all truncate ${
                    selectedAnimation === emote.id
                      ? "bg-purple-500/20 text-purple-400 border border-purple-500/40"
                      : "bg-glass-bg/30 hover:bg-glass-bg/50"
                  }`}
                  title={emote.name}
                >
                  {emote.name}
                </button>
              ))}
            </div>
          </div>

          {/* Playback Controls */}
          <div className="flex gap-2">
            <button
              onClick={isPlaying ? handlePause : handleResume}
              disabled={!selectedAnimation}
              className="flex-1 py-2 rounded-lg bg-glass-bg/30 hover:bg-glass-bg/50 flex items-center justify-center gap-2 disabled:opacity-50 transition-colors text-sm"
            >
              {isPlaying ? (
                <Pause className="w-4 h-4" />
              ) : (
                <Play className="w-4 h-4" />
              )}
              {isPlaying ? "Pause" : "Play"}
            </button>
            <button
              onClick={handleStop}
              disabled={!selectedAnimation}
              className="px-4 py-2 rounded-lg bg-glass-bg/30 hover:bg-glass-bg/50 disabled:opacity-50 transition-colors"
            >
              <Square className="w-4 h-4" />
            </button>
          </div>

          {selectedAnimation && (
            <p className="text-xs text-purple-400 mt-2 text-center">
              Playing: {emotes.find((e) => e.id === selectedAnimation)?.name}
            </p>
          )}
        </div>
      )}

      {/* Visualization */}
      <div>
        <h3 className="text-sm font-semibold mb-3">Visualization</h3>
        <button
          onClick={() => {
            setShowBones(!showBones);
            viewerRef.current?.toggleSkeleton();
          }}
          className={`w-full py-2 rounded-lg border text-sm flex items-center justify-center gap-2 transition-all ${
            showBones
              ? "bg-cyan-500/20 text-cyan-400 border-cyan-500/40"
              : "border-glass-border hover:bg-glass-bg/50"
          }`}
        >
          <Bone className="w-4 h-4" />
          {showBones ? "Hide Bones" : "Show Bones"}
        </button>
      </div>

      {/* Actions */}
      <div className="space-y-2 pt-4 border-t border-glass-border">
        <button
          onClick={handleReset}
          className="w-full py-2 rounded-lg border border-glass-border text-muted-foreground hover:text-foreground hover:bg-glass-bg transition-all flex items-center justify-center gap-2 text-sm"
        >
          <RotateCcw className="w-4 h-4" />
          Reset
        </button>
        <button
          onClick={handleExport}
          disabled={!vrmConverted || !vrmUrl}
          className="w-full py-2 rounded-lg bg-gradient-to-r from-green-500 to-emerald-600 text-white font-medium hover:from-green-400 hover:to-emerald-500 transition-all flex items-center justify-center gap-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Download className="w-4 h-4" />
          Export VRM
        </button>
      </div>
    </div>
  );

  return (
    <StudioPageLayout
      title="Retarget & Animate"
      description="Convert to VRM and test animations"
      assetSidebar={assetSidebar}
      toolsSidebar={toolsSidebar}
    >
      {/* VRM Viewer or Placeholder */}
      {vrmUrl ? (
        <VRMViewer
          ref={viewerRef}
          vrmUrl={vrmUrl}
          onLoad={handleVRMLoad}
          showSkeleton={showBones}
          className="h-full"
        />
      ) : (
        <div className="h-full flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
          <div className="text-center p-8">
            <div className="w-24 h-24 rounded-full bg-gradient-to-br from-cyan-500/20 to-purple-500/20 flex items-center justify-center mx-auto mb-4">
              <RefreshCw className="w-12 h-12 text-white/40" />
            </div>
            <h3 className="text-lg font-semibold mb-2">
              {selectedAvatar || uploadedFile ? modelName : "Select Avatar"}
            </h3>
            <p className="text-sm text-muted-foreground max-w-md">
              {selectedAvatar || uploadedFile
                ? "Click 'Convert to VRM' to load the model"
                : "Upload a GLB/GLTF or select an avatar from the sidebar"}
            </p>
          </div>
        </div>
      )}
    </StudioPageLayout>
  );
}

export default function RetargetAnimatePage() {
  return (
    <Suspense
      fallback={
        <div className="h-screen flex items-center justify-center bg-background">
          <Loader2 className="w-8 h-8 animate-spin text-cyan-500" />
        </div>
      }
    >
      <RetargetContent />
    </Suspense>
  );
}
