"use client";

import { useState, useEffect } from "react";
import { logger } from "@/lib/utils";

const log = logger.child("HandRigging");
import {
  Hand,
  User,
  Loader2,
  Check,
  Download,
  Eye,
  EyeOff,
  Zap,
  Settings,
  RotateCcw,
  Search,
} from "lucide-react";
import { StudioPageLayout } from "@/components/layout/StudioPageLayout";
import { StudioViewer } from "@/components/viewer/StudioViewer";

const CDN_URL = process.env.NEXT_PUBLIC_CDN_URL || "http://localhost:8080";

// Loading skeleton to avoid hydration mismatch
function LoadingSkeleton() {
  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <aside className="w-56 border-r border-glass-border bg-glass-bg/30" />
      <main className="flex-1 relative overflow-hidden bg-gradient-to-b from-zinc-900 to-zinc-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-cyan-500" />
      </main>
    </div>
  );
}

interface Asset {
  id: string;
  name: string;
  source: "LOCAL" | "CDN";
  category: string;
  type: string;
  thumbnailUrl?: string;
  modelUrl?: string;
  modelPath?: string; // CDN assets may have modelPath instead of modelUrl
  hasVRM?: boolean;
}

type ProcessingStage =
  | "idle"
  | "loading"
  | "detecting-wrists"
  | "creating-bones"
  | "applying-weights"
  | "complete"
  | "error";

const PROCESSING_STEPS = [
  { id: "loading", label: "Loading Model", description: "Parsing mesh data" },
  {
    id: "detecting-wrists",
    label: "Detecting Wrists",
    description: "Finding hand positions",
  },
  {
    id: "creating-bones",
    label: "Creating Bones",
    description: "Building finger hierarchy",
  },
  {
    id: "applying-weights",
    label: "Applying Weights",
    description: "Skinning vertices",
  },
  { id: "complete", label: "Complete", description: "Ready to export" },
];

export default function HandRiggingPage() {
  // Hydration fix
  const [mounted, setMounted] = useState(false);

  const [avatars, setAvatars] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  const [selectedAvatar, setSelectedAvatar] = useState<Asset | null>(null);
  const [processingStage, setProcessingStage] =
    useState<ProcessingStage>("idle");
  const [showSkeleton, setShowSkeleton] = useState(false);
  const [useSimpleMode, setUseSimpleMode] = useState(true);

  const [leftHandData, setLeftHandData] = useState<{
    fingerCount: number;
    confidence: number;
    bonesAdded: number;
  } | null>(null);

  const [rightHandData, setRightHandData] = useState<{
    fingerCount: number;
    confidence: number;
    bonesAdded: number;
  } | null>(null);

  const [riggedModelData, setRiggedModelData] = useState<string | null>(null);

  // Ensure consistent rendering between server and client
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    async function loadAssets() {
      try {
        const [localRes, cdnRes] = await Promise.all([
          fetch("/api/assets/local").catch(() => null),
          fetch("/api/assets/cdn").catch(() => null),
        ]);

        const localAssets: Asset[] = localRes?.ok ? await localRes.json() : [];
        const cdnAssets: Asset[] = cdnRes?.ok ? await cdnRes.json() : [];
        const all = [...localAssets, ...cdnAssets];

        setAvatars(
          all.filter(
            (a) =>
              a.type === "character" ||
              a.category === "npc" ||
              a.category === "avatar" ||
              a.category === "character",
          ),
        );
      } catch (error) {
        log.error("Failed to load assets:", error);
      } finally {
        setLoading(false);
      }
    }
    loadAssets();
  }, []);

  const handleStartRigging = async () => {
    if (!selectedAvatar) return;

    // Try modelUrl first, then modelPath
    const rawUrl = selectedAvatar.modelUrl || selectedAvatar.modelPath;
    if (!rawUrl) {
      log.error("No model URL for avatar");
      setProcessingStage("error");
      return;
    }

    // Resolve to full URL
    let modelUrl: string;
    if (rawUrl.startsWith("http")) {
      modelUrl = rawUrl;
    } else if (rawUrl.startsWith("/")) {
      modelUrl = rawUrl; // Local API path
    } else if (rawUrl.startsWith("asset://")) {
      modelUrl = rawUrl.replace("asset://", `${CDN_URL}/`);
    } else {
      modelUrl = `${CDN_URL}/${rawUrl}`;
    }

    try {
      // Stage 1: Loading
      setProcessingStage("loading");

      // Fetch the GLB model
      const modelResponse = await fetch(modelUrl);
      if (!modelResponse.ok) throw new Error("Failed to fetch model");
      const glbBuffer = await modelResponse.arrayBuffer();
      const glbBase64 = btoa(String.fromCharCode(...new Uint8Array(glbBuffer)));

      // Stage 2: Detecting wrists (happens inside the service)
      setProcessingStage("detecting-wrists");

      // Call the real hand rigging API
      const response = await fetch("/api/hand-rigging/simple", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          glbData: glbBase64,
          options: {
            palmBoneLength: useSimpleMode ? 300 : 200,
            fingerBoneLength: useSimpleMode ? 400 : 150,
            debugMode: false,
          },
        }),
      });

      // Stage 3: Creating bones (parsing response)
      setProcessingStage("creating-bones");

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Hand rigging failed");
      }

      const result = await response.json();

      // Stage 4: Applying weights (complete)
      setProcessingStage("applying-weights");
      await new Promise((r) => setTimeout(r, 300)); // Brief pause for UI

      // Complete
      setProcessingStage("complete");

      setLeftHandData({
        fingerCount: 5,
        confidence: 0.95,
        bonesAdded: result.leftHandBones?.length || 0,
      });
      setRightHandData({
        fingerCount: 5,
        confidence: 0.94,
        bonesAdded: result.rightHandBones?.length || 0,
      });

      // Store the rigged model for export
      setRiggedModelData(result.riggedGlbData);

      log.info("Hand rigging complete:", result.metadata);
    } catch (error) {
      log.error("Hand rigging failed:", error);
      setProcessingStage("error");
    }
  };

  const handleReset = () => {
    setProcessingStage("idle");
    setLeftHandData(null);
    setRightHandData(null);
    setRiggedModelData(null);
  };

  const handleExport = () => {
    if (!riggedModelData || !selectedAvatar) return;

    // Convert base64 to blob and download
    const binaryString = atob(riggedModelData);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: "model/gltf-binary" });

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${selectedAvatar.name}_hand_rigged.glb`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Show loading skeleton during SSR to avoid hydration mismatch
  if (!mounted) {
    return <LoadingSkeleton />;
  }

  const currentStepIndex = PROCESSING_STEPS.findIndex(
    (s) => s.id === processingStage,
  );
  const filteredAvatars = avatars.filter((a) =>
    a.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const assetSidebar = (
    <div className="flex flex-col h-full">
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

      <div className="flex-1 overflow-y-auto p-3">
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
                onClick={() => {
                  setSelectedAvatar(avatar);
                  handleReset();
                }}
                className={`w-full p-2 rounded-lg text-left transition-all text-sm ${
                  selectedAvatar?.id === avatar.id
                    ? "bg-cyan-500/20 border border-cyan-500/40"
                    : "bg-glass-bg/30 border border-transparent hover:bg-glass-bg/50"
                }`}
              >
                <div className="font-medium truncate">{avatar.name}</div>
                <div className="text-xs text-muted-foreground">
                  {avatar.source}
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );

  const toolsSidebar = (
    <div className="p-4 space-y-4">
      {/* Settings */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Settings className="w-4 h-4 text-blue-400" />
          <h3 className="text-sm font-semibold">Settings</h3>
        </div>
        <label className="flex items-center justify-between p-2 rounded-lg bg-glass-bg/30 cursor-pointer">
          <span className="text-sm">Simple Mode</span>
          <input
            type="checkbox"
            checked={useSimpleMode}
            onChange={(e) => setUseSimpleMode(e.target.checked)}
            className="rounded"
          />
        </label>
        <p className="text-xs text-muted-foreground mt-2">
          {useSimpleMode
            ? "5 bones per hand (palm + 4 fingers)"
            : "15 bones per hand (full articulation)"}
        </p>
      </div>

      {/* Processing */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Zap className="w-4 h-4 text-green-400" />
          <h3 className="text-sm font-semibold">Processing</h3>
        </div>

        <button
          onClick={handleStartRigging}
          disabled={!selectedAvatar || processingStage !== "idle"}
          className={`w-full py-2 rounded-lg font-medium transition-all flex items-center justify-center gap-2 text-sm ${
            processingStage === "complete"
              ? "bg-green-500/20 text-green-400 border border-green-500/40"
              : "bg-gradient-to-r from-orange-500 to-red-600 text-white hover:from-orange-400 hover:to-red-500"
          } disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          {processingStage === "idle" ? (
            <>
              <Hand className="w-4 h-4" />
              Add Hand Bones
            </>
          ) : processingStage === "complete" ? (
            <>
              <Check className="w-4 h-4" />
              Complete
            </>
          ) : (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Processing...
            </>
          )}
        </button>
      </div>

      {/* Progress */}
      {processingStage !== "idle" && (
        <div className="space-y-2">
          {PROCESSING_STEPS.map((step, i) => {
            const isActive = step.id === processingStage;
            const isComplete = currentStepIndex > i;

            return (
              <div
                key={step.id}
                className={`p-2 rounded-lg text-sm transition-all ${
                  isActive
                    ? "bg-cyan-500/20 border border-cyan-500/40"
                    : isComplete
                      ? "bg-glass-bg/30 text-muted-foreground"
                      : "bg-glass-bg/10 text-muted-foreground/50"
                }`}
              >
                <div className="flex items-center gap-2">
                  {isComplete ? (
                    <Check className="w-3 h-3 text-green-400" />
                  ) : isActive ? (
                    <Loader2 className="w-3 h-3 animate-spin text-cyan-400" />
                  ) : (
                    <div className="w-3 h-3 rounded-full border border-current" />
                  )}
                  <span className="font-medium">{step.label}</span>
                </div>
                <p className="text-xs mt-1 ml-5">{step.description}</p>
              </div>
            );
          })}
        </div>
      )}

      {/* Results */}
      {leftHandData && rightHandData && (
        <div>
          <h3 className="text-sm font-semibold mb-3">Results</h3>
          <div className="grid grid-cols-2 gap-2">
            <div className="p-2 rounded-lg bg-glass-bg/30 text-center">
              <div className="text-xs text-muted-foreground">Left Hand</div>
              <div className="text-lg font-bold text-cyan-400">
                {leftHandData.bonesAdded}
              </div>
              <div className="text-xs text-muted-foreground">bones</div>
            </div>
            <div className="p-2 rounded-lg bg-glass-bg/30 text-center">
              <div className="text-xs text-muted-foreground">Right Hand</div>
              <div className="text-lg font-bold text-orange-400">
                {rightHandData.bonesAdded}
              </div>
              <div className="text-xs text-muted-foreground">bones</div>
            </div>
          </div>
        </div>
      )}

      {/* Visualization */}
      <div>
        <h3 className="text-sm font-semibold mb-3">Visualization</h3>
        <button
          onClick={() => setShowSkeleton(!showSkeleton)}
          className="w-full py-2 rounded-lg border border-glass-border text-sm flex items-center justify-center gap-2 hover:bg-glass-bg transition-all"
        >
          {showSkeleton ? (
            <EyeOff className="w-4 h-4" />
          ) : (
            <Eye className="w-4 h-4" />
          )}
          {showSkeleton ? "Hide Skeleton" : "Show Skeleton"}
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
          disabled={processingStage !== "complete" || !riggedModelData}
          className="w-full py-2 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-medium hover:from-cyan-400 hover:to-blue-500 transition-all flex items-center justify-center gap-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Download className="w-4 h-4" />
          Export Rigged Model
        </button>
      </div>
    </div>
  );

  // Get model URL for viewer
  // Handle different URL formats:
  // - http/https URLs: use as-is
  // - /api/... paths: use as-is (local API)
  // - asset://... : replace with CDN URL
  // - relative paths: prepend CDN URL
  const resolveModelUrl = (asset: Asset | null): string | null => {
    if (!asset) return null;
    // Try modelUrl first, then modelPath
    const url = asset.modelUrl || asset.modelPath;
    if (!url) return null;
    if (url.startsWith("http")) return url;
    if (url.startsWith("/")) return url; // Local API paths start with /
    if (url.startsWith("asset://"))
      return url.replace("asset://", `${CDN_URL}/`);
    return `${CDN_URL}/${url}`;
  };

  const avatarModelUrl = resolveModelUrl(selectedAvatar);

  return (
    <StudioPageLayout
      title="Hand Rigging"
      description="Add finger bones for hand animation"
      assetSidebar={assetSidebar}
      toolsSidebar={toolsSidebar}
    >
      {/* 3D Viewport with StudioViewer */}
      <StudioViewer
        modelUrl={avatarModelUrl}
        showSkeleton={showSkeleton}
        placeholder={
          <div className="text-center p-8">
            <div className="w-24 h-24 rounded-full bg-glass-bg flex items-center justify-center mx-auto mb-4">
              <Hand className="w-12 h-12 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold text-muted-foreground">
              Select Avatar
            </h3>
            <p className="text-sm text-muted-foreground mt-2">
              Choose an avatar to add hand bones
            </p>
          </div>
        }
        overlay={
          <>
            {/* Status overlay */}
            {selectedAvatar && (
              <div className="absolute top-4 left-4 glass-panel p-3 rounded-lg">
                <p className="text-sm">
                  <span className="text-cyan-400">{selectedAvatar.name}</span>
                </p>
                {processingStage === "complete" && (
                  <div className="flex items-center gap-2 text-green-400 text-xs font-medium mt-2">
                    <Check className="w-3 h-3" />
                    Hand bones added (
                    {(leftHandData?.bonesAdded || 0) +
                      (rightHandData?.bonesAdded || 0)}{" "}
                    total)
                  </div>
                )}
              </div>
            )}

            {/* Processing overlay */}
            {processingStage !== "idle" &&
              processingStage !== "complete" &&
              processingStage !== "error" && (
                <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                  <div className="glass-panel p-6 rounded-xl text-center">
                    <Loader2 className="w-8 h-8 animate-spin text-orange-400 mx-auto mb-3" />
                    <p className="text-sm font-medium">Processing...</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {
                        PROCESSING_STEPS.find((s) => s.id === processingStage)
                          ?.label
                      }
                    </p>
                  </div>
                </div>
              )}
          </>
        }
      />
    </StudioPageLayout>
  );
}
