"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { logger } from "@/lib/utils";

const log = logger.child("Armor");
import {
  Shield,
  AlertTriangle,
  User,
  Shirt,
  Crown,
  RotateCcw,
  Download,
  Loader2,
  Check,
  Play,
  Pause,
  Search,
  Layers,
  Zap,
  Link2,
} from "lucide-react";
import { StudioPageLayout } from "@/components/layout/StudioPageLayout";
import { StudioViewer } from "@/components/viewer/StudioViewer";
import { Slider } from "@/components/ui/slider";

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

type EquipmentSlot = "Head" | "Spine2" | "Pelvis";

const EQUIPMENT_SLOTS: {
  id: EquipmentSlot;
  label: string;
  icon: typeof Crown;
}[] = [
  { id: "Head", label: "Helmet", icon: Crown },
  { id: "Spine2", label: "Body Armor", icon: Shirt },
  { id: "Pelvis", label: "Leg Armor", icon: Shield },
];

const CDN_URL = process.env.NEXT_PUBLIC_CDN_URL || "http://localhost:8080";

export default function ArmorFittingPage() {
  // Hydration fix
  const [mounted, setMounted] = useState(false);

  // State
  const [avatars, setAvatars] = useState<Asset[]>([]);
  const [armorPieces, setArmorPieces] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  const [selectedAvatar, setSelectedAvatar] = useState<Asset | null>(null);
  const [selectedArmor, setSelectedArmor] = useState<Asset | null>(null);
  const [equipmentSlot, setEquipmentSlot] = useState<EquipmentSlot>("Spine2");

  // Fitting state
  const [isFitting, setIsFitting] = useState(false);
  const [isBinding, setIsBinding] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [fittingProgress, setFittingProgress] = useState(0);
  const [isArmorFitted, setIsArmorFitted] = useState(false);
  const [isArmorBound, setIsArmorBound] = useState(false);
  const [isAnimationPlaying, setIsAnimationPlaying] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [fittedArmorUrl, setFittedArmorUrl] = useState<string | null>(null);
  const [fittingStats, setFittingStats] = useState<{
    bodyRegions: number;
    vertexCount: number;
    method: string;
    iterations?: number;
  } | null>(null);

  // Fitting config
  const [fittingConfig, setFittingConfig] = useState({
    margin: 0.02,
    iterations: 10,
    targetOffset: 0.02,
    rigidity: 0.7,
    smoothingPasses: 3,
  });

  // Ensure consistent rendering between server and client
  useEffect(() => {
    setMounted(true);
  }, []);

  // Load assets
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

        setArmorPieces(
          all.filter(
            (a) =>
              a.type === "armor" ||
              a.category === "armor" ||
              a.type === "helmet" ||
              a.category === "equipment",
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

  // Helper to resolve model URLs for API calls
  const resolveApiUrl = useCallback((asset: Asset | null): string | null => {
    if (!asset) return null;
    const path = asset.modelUrl || asset.modelPath;
    if (!path) return null;

    if (path.startsWith("http")) return path;
    if (path.startsWith("/")) {
      // Local API path - needs full URL for server-side fetch
      return `${typeof window !== "undefined" ? window.location.origin : ""}${path}`;
    }
    if (path.startsWith("asset://"))
      return path.replace("asset://", `${CDN_URL}/`);
    return `${CDN_URL}/${path}`;
  }, []);

  // Real armor fitting using ArmorFittingService
  const handlePerformFitting = useCallback(async () => {
    if (!selectedAvatar || !selectedArmor) return;

    setIsFitting(true);
    setFittingProgress(0);
    setFittingStats(null);
    setSessionId(null);
    setFittedArmorUrl(null);

    try {
      // Get model URLs
      const avatarUrl = resolveApiUrl(selectedAvatar);
      const armorUrl = resolveApiUrl(selectedArmor);

      if (!avatarUrl || !armorUrl) {
        throw new Error("Missing model URLs");
      }

      log.info("Starting fitting:", { avatarUrl, armorUrl });

      // Progress simulation for UX (real fitting happens server-side)
      const progressInterval = setInterval(() => {
        setFittingProgress((p) => Math.min(p + 10, 90));
      }, 200);

      const response = await fetch("/api/armor/fit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          avatarUrl,
          armorUrl,
          config: {
            equipmentSlot,
            method: "hull",
            margin: fittingConfig.margin,
            iterations: fittingConfig.iterations,
            targetOffset: fittingConfig.targetOffset,
            rigidity: fittingConfig.rigidity,
            smoothingPasses: fittingConfig.smoothingPasses,
          },
        }),
      });

      clearInterval(progressInterval);

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Fitting failed");
      }

      const result = await response.json();

      // Store session ID for subsequent bind/export operations
      setSessionId(result.sessionId);

      // Create blob URL from base64 GLB for preview
      if (result.fittedArmorGlb) {
        const binaryString = atob(result.fittedArmorGlb);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: "model/gltf-binary" });
        const url = URL.createObjectURL(blob);
        setFittedArmorUrl(url);
      }

      setFittingProgress(100);
      setIsArmorFitted(true);
      setFittingStats(result.stats);

      log.info("Fitting complete:", result);
    } catch (error) {
      log.error("Fitting failed:", error);
      setFittingProgress(0);
    } finally {
      setIsFitting(false);
    }
  }, [
    selectedAvatar,
    selectedArmor,
    equipmentSlot,
    fittingConfig,
    resolveApiUrl,
  ]);

  const handleBindToSkeleton = useCallback(async () => {
    if (!isArmorFitted || !sessionId) return;

    setIsBinding(true);

    try {
      const response = await fetch("/api/armor/fit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "bind",
          sessionId,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Binding failed");
      }

      const result = await response.json();
      setIsArmorBound(true);
      log.info("Bound to skeleton:", result);
    } catch (error) {
      log.error("Binding failed:", error);
      alert(error instanceof Error ? error.message : "Binding failed");
    } finally {
      setIsBinding(false);
    }
  }, [isArmorFitted, sessionId]);

  const handleReset = useCallback(() => {
    setIsArmorFitted(false);
    setIsArmorBound(false);
    setFittingProgress(0);
    setFittingStats(null);
    setSessionId(null);
    // Clean up blob URL
    if (fittedArmorUrl) {
      URL.revokeObjectURL(fittedArmorUrl);
      setFittedArmorUrl(null);
    }
  }, [fittedArmorUrl]);

  const handleExport = useCallback(async () => {
    if (!isArmorBound || !sessionId) return;

    setIsExporting(true);

    try {
      const response = await fetch("/api/armor/fit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "export",
          sessionId,
          exportMethod: "minimal",
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Export failed");
      }

      // Download the GLB file
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `fitted-armor-${Date.now()}.glb`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      log.info("Export complete");
    } catch (error) {
      log.error("Export failed:", error);
      alert(error instanceof Error ? error.message : "Export failed");
    } finally {
      setIsExporting(false);
    }
  }, [isArmorBound, sessionId]);

  // Show loading skeleton during SSR to avoid hydration mismatch
  if (!mounted) {
    return <LoadingSkeleton />;
  }

  const avatarHasVRM =
    selectedAvatar?.hasVRM ||
    selectedAvatar?.modelUrl?.includes(".vrm") ||
    selectedAvatar?.source === "LOCAL";

  const filteredAvatars = avatars.filter((a) =>
    a.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );
  const filteredArmor = armorPieces.filter((a) =>
    a.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  // Asset Selection Sidebar
  const assetSidebar = (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-glass-border">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search assets..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-glass-bg border border-glass-border rounded-lg text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* Avatar Selection */}
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

        {selectedAvatar && !avatarHasVRM && (
          <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
              <div>
                <h4 className="text-sm font-medium text-amber-400">
                  VRM Required
                </h4>
                <p className="text-xs text-amber-300/70 mt-1">
                  Convert in{" "}
                  <Link href="/studio/retarget" className="underline">
                    Retarget
                  </Link>
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Armor Selection */}
        <div>
          <div className="flex items-center gap-2 mb-2 px-1">
            <Shield className="w-4 h-4 text-purple-400" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Armor
            </h3>
          </div>
          <div className="space-y-1">
            {loading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : filteredArmor.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No armor found
              </p>
            ) : (
              filteredArmor.map((armor) => (
                <button
                  key={armor.id}
                  onClick={() => {
                    setSelectedArmor(armor);
                    setIsArmorFitted(false);
                    setIsArmorBound(false);
                  }}
                  className={`w-full p-2 rounded-lg text-left transition-all text-sm ${
                    selectedArmor?.id === armor.id
                      ? "bg-purple-500/20 border border-purple-500/40"
                      : "bg-glass-bg/30 border border-transparent hover:bg-glass-bg/50"
                  }`}
                >
                  <div className="font-medium truncate">{armor.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {armor.source}
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
      {/* Equipment Slot */}
      <div>
        <h3 className="text-sm font-semibold mb-3">Equipment Slot</h3>
        <div className="grid grid-cols-3 gap-2">
          {EQUIPMENT_SLOTS.map((slot) => (
            <button
              key={slot.id}
              onClick={() => setEquipmentSlot(slot.id)}
              className={`p-2 rounded-lg text-center transition-all text-xs ${
                equipmentSlot === slot.id
                  ? "bg-purple-500/20 border border-purple-500/40"
                  : "bg-glass-bg/30 border border-transparent hover:bg-glass-bg/50"
              }`}
            >
              <slot.icon className="w-4 h-4 mx-auto mb-1" />
              {slot.label}
            </button>
          ))}
        </div>
      </div>

      {/* Fitting Config */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Layers className="w-4 h-4 text-blue-400" />
          <h3 className="text-sm font-semibold">Fitting Settings</h3>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground flex justify-between mb-1">
              <span>Target Offset</span>
              <span>{fittingConfig.targetOffset.toFixed(2)}m</span>
            </label>
            <Slider
              value={[fittingConfig.targetOffset * 100]}
              onValueChange={([v]) =>
                setFittingConfig((c) => ({ ...c, targetOffset: v / 100 }))
              }
              min={0}
              max={10}
              step={1}
            />
          </div>

          <div>
            <label className="text-xs text-muted-foreground flex justify-between mb-1">
              <span>Iterations</span>
              <span>{fittingConfig.iterations}</span>
            </label>
            <Slider
              value={[fittingConfig.iterations]}
              onValueChange={([v]) =>
                setFittingConfig((c) => ({ ...c, iterations: v }))
              }
              min={1}
              max={20}
              step={1}
            />
          </div>

          <div>
            <label className="text-xs text-muted-foreground flex justify-between mb-1">
              <span>Rigidity</span>
              <span>{fittingConfig.rigidity.toFixed(1)}</span>
            </label>
            <Slider
              value={[fittingConfig.rigidity * 10]}
              onValueChange={([v]) =>
                setFittingConfig((c) => ({ ...c, rigidity: v / 10 }))
              }
              min={0}
              max={10}
              step={1}
            />
          </div>
        </div>
      </div>

      {/* Fitting Actions */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Zap className="w-4 h-4 text-green-400" />
          <h3 className="text-sm font-semibold">Fitting Process</h3>
        </div>

        <div className="space-y-2">
          <button
            onClick={handlePerformFitting}
            disabled={!selectedAvatar || !selectedArmor || isFitting}
            className={`w-full py-2 rounded-lg font-medium transition-all flex items-center justify-center gap-2 text-sm ${
              isArmorFitted
                ? "bg-green-500/20 text-green-400 border border-green-500/40"
                : "bg-gradient-to-r from-purple-500 to-pink-600 text-white hover:from-purple-400 hover:to-pink-500"
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {isFitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {fittingProgress}%
              </>
            ) : isArmorFitted ? (
              <>
                <Check className="w-4 h-4" />
                Fitted
              </>
            ) : (
              "Perform Fitting"
            )}
          </button>

          <button
            onClick={handleBindToSkeleton}
            disabled={!isArmorFitted || isArmorBound || isBinding}
            className={`w-full py-2 rounded-lg font-medium transition-all flex items-center justify-center gap-2 text-sm ${
              isArmorBound
                ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/40"
                : "bg-gradient-to-r from-cyan-500 to-blue-600 text-white hover:from-cyan-400 hover:to-blue-500"
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {isBinding ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Binding...
              </>
            ) : isArmorBound ? (
              <>
                <Check className="w-4 h-4" />
                Bound
              </>
            ) : (
              <>
                <Link2 className="w-4 h-4" />
                Bind to Skeleton
              </>
            )}
          </button>
        </div>

        {/* Fitting Stats */}
        {fittingStats && (
          <div className="mt-3 p-3 bg-green-500/10 border border-green-500/30 rounded-lg text-xs space-y-1">
            <div className="flex justify-between text-green-300/70">
              <span>Body Regions:</span>
              <span>{fittingStats.bodyRegions}</span>
            </div>
            <div className="flex justify-between text-green-300/70">
              <span>Vertices:</span>
              <span>{fittingStats.vertexCount.toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-green-300/70">
              <span>Method:</span>
              <span>{fittingStats.method}</span>
            </div>
          </div>
        )}
      </div>

      {/* Animation Test */}
      {isArmorBound && (
        <div>
          <h3 className="text-sm font-semibold mb-3">Test Animation</h3>
          <button
            onClick={() => setIsAnimationPlaying(!isAnimationPlaying)}
            className="w-full py-2 rounded-lg border border-glass-border text-sm flex items-center justify-center gap-2 hover:bg-glass-bg transition-all"
          >
            {isAnimationPlaying ? (
              <Pause className="w-4 h-4" />
            ) : (
              <Play className="w-4 h-4" />
            )}
            {isAnimationPlaying ? "Pause" : "Play Animation"}
          </button>
        </div>
      )}

      {/* Export */}
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
          disabled={!isArmorBound || isExporting}
          className="w-full py-2 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-medium hover:from-cyan-400 hover:to-blue-500 transition-all flex items-center justify-center gap-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isExporting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Exporting...
            </>
          ) : (
            <>
              <Download className="w-4 h-4" />
              Export Fitted Armor
            </>
          )}
        </button>
      </div>
    </div>
  );

  // Get model URLs for viewer
  // Handle different URL formats:
  // - http/https URLs: use as-is
  // - /api/... paths: use as-is (local API)
  // - asset://... : replace with CDN URL
  // - relative paths: prepend CDN URL
  const resolveModelUrl = (asset: Asset | null): string | null => {
    if (!asset) return null;
    // Try modelUrl first, then modelPath
    const url = asset.modelUrl || asset.modelPath;
    // Don't return just the CDN base URL if path is empty
    if (!url || url === "" || url === "http://localhost:8080/") return null;
    if (url.startsWith("http")) return url;
    if (url.startsWith("/")) return url; // Local API paths start with /
    if (url.startsWith("asset://"))
      return url.replace("asset://", `${CDN_URL}/`);
    return `${CDN_URL}/${url}`;
  };

  const avatarModelUrl = resolveModelUrl(selectedAvatar);
  // Use fitted armor URL if available, otherwise use original armor URL
  const armorModelUrl = fittedArmorUrl || resolveModelUrl(selectedArmor);

  return (
    <StudioPageLayout
      title="Armor Fitting"
      description="Fit armor and helmets to VRM avatars"
      assetSidebar={assetSidebar}
      toolsSidebar={toolsSidebar}
    >
      {/* 3D Viewport with StudioViewer */}
      <StudioViewer
        modelUrl={avatarModelUrl}
        secondaryModelUrl={armorModelUrl}
        placeholder={
          <div className="text-center p-8">
            <div className="w-24 h-24 rounded-full bg-glass-bg flex items-center justify-center mx-auto mb-4">
              <Shield className="w-12 h-12 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold text-muted-foreground">
              Select Assets
            </h3>
            <p className="text-sm text-muted-foreground mt-2">
              Choose an avatar and armor piece to begin
            </p>
          </div>
        }
        overlay={
          <>
            {/* Status overlay */}
            {selectedAvatar && selectedArmor && (
              <div className="absolute top-4 left-4 glass-panel p-3 rounded-lg">
                <p className="text-sm text-muted-foreground">
                  <span className="text-cyan-400">{selectedAvatar.name}</span> +{" "}
                  <span className="text-purple-400">{selectedArmor.name}</span>
                </p>
                {isArmorFitted && (
                  <div className="flex items-center gap-2 text-green-400 text-xs font-medium mt-2">
                    <Check className="w-3 h-3" />
                    Armor Fitted {isArmorBound && "& Bound"}
                  </div>
                )}
              </div>
            )}

            {/* Fitting progress overlay */}
            {isFitting && (
              <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                <div className="glass-panel p-6 rounded-xl text-center">
                  <Loader2 className="w-8 h-8 animate-spin text-purple-400 mx-auto mb-3" />
                  <p className="text-sm font-medium">Fitting armor...</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {fittingProgress}%
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
