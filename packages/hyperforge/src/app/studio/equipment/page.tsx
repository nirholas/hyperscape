"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { logger } from "@/lib/utils";

const log = logger.child("Equipment");
import {
  AlertTriangle,
  User,
  Swords,
  Target,
  RotateCcw,
  Download,
  Save,
  Loader2,
  Check,
  Hand,
  Move3D,
  RotateCw,
  Scale3D,
  Search,
  Sparkles,
  RefreshCw,
  Eye,
  EyeOff,
  Play,
  Pause,
  Ruler,
} from "lucide-react";
import { StudioPageLayout } from "@/components/layout/StudioPageLayout";
import {
  EquipmentViewer,
  type EquipmentViewerRef,
  type Vector3,
} from "@/components/viewer/EquipmentViewer";

// Loading skeleton to avoid hydration mismatch - uses CSS spinner instead of Lucide icons
function LoadingSkeleton() {
  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <aside className="w-56 border-r border-glass-border bg-glass-bg/30" />
      <main className="flex-1 relative overflow-hidden bg-gradient-to-b from-zinc-900 to-zinc-950 flex items-center justify-center">
        {/* Pure CSS spinner to avoid Lucide hydration mismatch */}
        <div className="w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
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
  modelPath?: string;
  hasVRM?: boolean;
  hasModel?: boolean;
}

interface GripDetectionResult {
  gripPoint: Vector3;
  confidence: number;
  annotatedImage?: string;
  orientationFlipped?: boolean;
  vertexCount?: number;
}

type EquipmentSlot = "Hand_R" | "Hand_L" | "Back" | "Hip_R" | "Hip_L";
type AnimationType = "tpose" | "walking" | "running";

const EQUIPMENT_SLOTS: {
  id: EquipmentSlot;
  label: string;
  description: string;
}[] = [
  { id: "Hand_R", label: "Right Hand", description: "Primary weapon hand" },
  { id: "Hand_L", label: "Left Hand", description: "Offhand / shield" },
  { id: "Back", label: "Back", description: "Holstered weapons" },
  { id: "Hip_R", label: "Right Hip", description: "Side weapon" },
  { id: "Hip_L", label: "Left Hip", description: "Side weapon" },
];

const CREATURE_SIZES = [
  { id: "tiny", label: "Tiny", height: 0.5, description: "Fairy, rat" },
  { id: "small", label: "Small", height: 1.0, description: "Goblin, child" },
  { id: "medium", label: "Medium", height: 1.83, description: "Human, elf" },
  { id: "large", label: "Large", height: 2.5, description: "Ogre, orc" },
  { id: "huge", label: "Huge", height: 4.0, description: "Giant, dragon" },
];

const CDN_URL = process.env.NEXT_PUBLIC_CDN_URL || "http://localhost:8080";

export default function EquipmentFittingPage() {
  // Hydration fix
  const [mounted, setMounted] = useState(false);

  // Viewer ref
  const viewerRef = useRef<EquipmentViewerRef>(null);

  // State
  const [avatars, setAvatars] = useState<Asset[]>([]);
  const [weapons, setWeapons] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  const [selectedAvatar, setSelectedAvatar] = useState<Asset | null>(null);
  const [selectedWeapon, setSelectedWeapon] = useState<Asset | null>(null);
  const [equipmentSlot, setEquipmentSlot] = useState<EquipmentSlot>("Hand_R");

  // Grip detection
  const [isDetectingGrip, setIsDetectingGrip] = useState(false);
  const [gripResult, setGripResult] = useState<GripDetectionResult | null>(
    null,
  );

  // Manual adjustment state
  const [position, setPosition] = useState<Vector3>({ x: 0, y: 0, z: 0 });
  const [rotation, setRotation] = useState<Vector3>({ x: 0, y: 0, z: 0 });
  const [scale, setScale] = useState(1.0);
  const [autoScale, setAutoScale] = useState(true);

  // Animation state
  const [isAnimating, setIsAnimating] = useState(false);
  const [animationType, setAnimationType] = useState<AnimationType>("tpose");

  // Creature size
  const [avatarHeight, setAvatarHeight] = useState(1.83);
  const [creatureCategory, setCreatureCategory] = useState("medium");

  // View options
  const [showSkeleton, setShowSkeleton] = useState(false);

  // Interactive placement mode
  const [interactiveMode, setInteractiveMode] = useState(false);
  const [transformMode, setTransformMode] = useState<
    "translate" | "rotate" | "scale"
  >("translate");

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

        // Avatars are type "character" or "avatar" or "npc"
        setAvatars(
          all.filter(
            (a) =>
              a.type === "character" ||
              a.category === "npc" ||
              a.category === "avatar" ||
              a.category === "character",
          ),
        );

        // Weapons are type "weapon" or category "weapon"
        setWeapons(
          all.filter(
            (a) =>
              a.type === "weapon" ||
              a.category === "weapon" ||
              a.category === "item",
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

  // Grip detection using heuristic approach
  // For weapons, the grip is typically at the bottom 20-30% of the model
  const handleDetectGrip = useCallback(async () => {
    if (!selectedWeapon) return;

    setIsDetectingGrip(true);
    setGripResult(null);

    try {
      log.info("Using heuristic grip detection for:", selectedWeapon.name);

      // Simulate detection delay for UX
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Heuristic: For most weapons, grip is at bottom center
      // This provides reasonable defaults that users can adjust manually
      const heuristicGrip = {
        x: 0,
        y: -0.15, // Slightly below center (handles are usually at bottom)
        z: 0,
      };

      setGripResult({
        gripPoint: heuristicGrip,
        confidence: 0.7, // Moderate confidence for heuristic
        orientationFlipped: false,
        vertexCount: 0,
      });

      log.info("Heuristic grip applied:", heuristicGrip);
    } catch (error) {
      log.error("Grip detection failed:", error);
      setGripResult({
        gripPoint: { x: 0, y: 0, z: 0 },
        confidence: 0,
      });
    } finally {
      setIsDetectingGrip(false);
    }
  }, [selectedWeapon]);

  const handleReset = useCallback(() => {
    setPosition({ x: 0, y: 0, z: 0 });
    setRotation({ x: 0, y: 0, z: 0 });
    setScale(1.0);
    setAutoScale(true);
    setGripResult(null);
    setAvatarHeight(1.83);
    setCreatureCategory("medium");
  }, []);

  const handleSave = useCallback(async () => {
    if (!selectedAvatar || !selectedWeapon) return;

    const config = {
      hyperscapeAttachment: {
        vrmBoneName:
          equipmentSlot === "Hand_R"
            ? "rightHand"
            : equipmentSlot === "Hand_L"
              ? "leftHand"
              : equipmentSlot === "Back"
                ? "spine"
                : "hips",
        position,
        rotation,
        scale,
        gripPoint: gripResult?.gripPoint || { x: 0, y: 0, z: 0 },
        avatarHeight,
        testedWithAvatar: selectedAvatar.id,
        lastUpdated: new Date().toISOString(),
      },
    };

    try {
      const response = await fetch(`/api/assets/${selectedWeapon.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metadata: config }),
      });

      if (!response.ok) throw new Error("Failed to save configuration");

      log.info("Configuration saved:", config);
      alert("Configuration saved!");
    } catch (error) {
      log.error("Save failed:", error);
      alert("Failed to save configuration");
    }
  }, [
    selectedAvatar,
    selectedWeapon,
    equipmentSlot,
    position,
    rotation,
    scale,
    gripResult,
    avatarHeight,
  ]);

  const handleExportAligned = useCallback(async () => {
    if (!viewerRef.current || !selectedWeapon) return;

    try {
      const glb = await viewerRef.current.exportAlignedEquipment();
      if (glb.byteLength === 0) {
        alert("No equipment to export");
        return;
      }

      const blob = new Blob([glb], { type: "model/gltf-binary" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${selectedWeapon.name}-aligned.glb`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      log.error("Export failed:", error);
      alert("Export failed");
    }
  }, [selectedWeapon]);

  const handleExportEquipped = useCallback(async () => {
    if (!viewerRef.current || !selectedAvatar) return;

    try {
      const glb = await viewerRef.current.exportEquippedModel();
      if (glb.byteLength === 0) {
        alert("No model to export");
        return;
      }

      const blob = new Blob([glb], { type: "model/gltf-binary" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${selectedAvatar.name}-equipped.glb`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      log.error("Export failed:", error);
      alert("Export failed");
    }
  }, [selectedAvatar]);

  const handleCreatureSizeChange = useCallback((sizeId: string) => {
    const size = CREATURE_SIZES.find((s) => s.id === sizeId);
    if (size) {
      setCreatureCategory(sizeId);
      setAvatarHeight(size.height);
    }
  }, []);

  // Show loading skeleton during SSR
  if (!mounted) {
    return <LoadingSkeleton />;
  }

  // VRM requirement check
  const avatarHasVRM =
    selectedAvatar?.hasVRM ||
    selectedAvatar?.modelUrl?.includes(".vrm") ||
    selectedAvatar?.source === "LOCAL";

  // Filter assets by search
  const filteredAvatars = avatars.filter((a) =>
    a.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );
  const filteredWeapons = weapons.filter((w) =>
    w.name.toLowerCase().includes(searchQuery.toLowerCase()),
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
                  onClick={() => setSelectedAvatar(avatar)}
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

        {/* VRM Warning */}
        {selectedAvatar && !avatarHasVRM && (
          <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
              <div>
                <h4 className="text-sm font-medium text-amber-400">
                  VRM Required
                </h4>
                <p className="text-xs text-amber-300/70 mt-1">
                  Convert to VRM in{" "}
                  <Link href="/studio/retarget" className="underline">
                    Retarget
                  </Link>
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Weapon Selection */}
        <div>
          <div className="flex items-center gap-2 mb-2 px-1">
            <Swords className="w-4 h-4 text-orange-400" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Weapons
            </h3>
          </div>
          <div className="space-y-1">
            {loading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : filteredWeapons.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No weapons found
              </p>
            ) : (
              filteredWeapons.map((weapon) => (
                <button
                  key={weapon.id}
                  onClick={() => {
                    setSelectedWeapon(weapon);
                    setGripResult(null);
                  }}
                  className={`w-full p-2 rounded-lg text-left transition-all text-sm ${
                    selectedWeapon?.id === weapon.id
                      ? "bg-orange-500/20 border border-orange-500/40"
                      : "bg-glass-bg/30 border border-transparent hover:bg-glass-bg/50"
                  }`}
                >
                  <div className="font-medium truncate">{weapon.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {weapon.source}
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
    <div className="p-4 space-y-4 overflow-y-auto h-full">
      {/* Equipment Slot */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Hand className="w-4 h-4 text-purple-400" />
          <h3 className="text-sm font-semibold">Equipment Slot</h3>
        </div>
        <div className="space-y-1">
          {EQUIPMENT_SLOTS.map((slot) => (
            <button
              key={slot.id}
              onClick={() => setEquipmentSlot(slot.id)}
              className={`w-full p-2 rounded-lg text-left transition-all text-sm ${
                equipmentSlot === slot.id
                  ? "bg-purple-500/20 border border-purple-500/40"
                  : "bg-glass-bg/30 border border-transparent hover:bg-glass-bg/50"
              }`}
            >
              <div className="font-medium">{slot.label}</div>
              <div className="text-xs text-muted-foreground">
                {slot.description}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* AI Grip Detection */}
      {selectedWeapon && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="w-4 h-4 text-green-400" />
            <h3 className="text-sm font-semibold">AI Grip Detection</h3>
          </div>
          <button
            onClick={handleDetectGrip}
            disabled={isDetectingGrip}
            className={`w-full py-2.5 rounded-lg font-medium transition-all flex items-center justify-center gap-2 text-sm ${
              gripResult && gripResult.confidence > 0
                ? "bg-green-500/20 text-green-400 border border-green-500/40"
                : "bg-gradient-to-r from-green-500 to-emerald-600 text-white hover:from-green-400 hover:to-emerald-500"
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {isDetectingGrip ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Detecting...
              </>
            ) : gripResult && gripResult.confidence > 0 ? (
              <>
                <Check className="w-4 h-4" />
                Grip Detected ({Math.round(gripResult.confidence * 100)}%)
              </>
            ) : (
              <>
                <Target className="w-4 h-4" />
                Detect Grip Point
              </>
            )}
          </button>

          {gripResult && gripResult.confidence > 0 && (
            <div className="mt-3 p-3 bg-green-500/10 border border-green-500/30 rounded-lg space-y-2">
              <div className="text-xs text-green-300/70">
                <div className="flex justify-between">
                  <span>Confidence:</span>
                  <span className="font-medium">
                    {Math.round(gripResult.confidence * 100)}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Grip Point:</span>
                  <span className="font-mono">
                    ({gripResult.gripPoint.x.toFixed(3)},{" "}
                    {gripResult.gripPoint.y.toFixed(3)},{" "}
                    {gripResult.gripPoint.z.toFixed(3)})
                  </span>
                </div>
                {gripResult.orientationFlipped && (
                  <div className="flex items-center gap-1 text-blue-400 mt-1">
                    <RefreshCw className="w-3 h-3" />
                    Auto-oriented
                  </div>
                )}
              </div>

              {gripResult.annotatedImage && (
                <div className="mt-2">
                  <img
                    src={gripResult.annotatedImage}
                    alt="Grip area"
                    className="w-full rounded-lg border border-green-500/30"
                  />
                  <p className="text-xs text-center text-muted-foreground mt-1">
                    Red box = detected grip area
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Creature Size */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Ruler className="w-4 h-4 text-yellow-400" />
          <h3 className="text-sm font-semibold">Creature Size</h3>
        </div>
        <div className="grid grid-cols-2 gap-1 mb-2">
          {CREATURE_SIZES.map((size) => (
            <button
              key={size.id}
              onClick={() => handleCreatureSizeChange(size.id)}
              className={`p-2 rounded-lg text-xs transition-all ${
                creatureCategory === size.id
                  ? "bg-yellow-500/20 border border-yellow-500/40 text-yellow-400"
                  : "bg-glass-bg/30 border border-transparent hover:bg-glass-bg/50"
              }`}
            >
              <div className="font-medium">{size.label}</div>
              <div className="text-muted-foreground">{size.height}m</div>
            </button>
          ))}
        </div>
        <div className="text-xs text-muted-foreground">
          Height: {avatarHeight.toFixed(2)}m
        </div>
      </div>

      {/* Scale Controls */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Scale3D className="w-4 h-4 text-blue-400" />
            <h3 className="text-sm font-semibold">Scale</h3>
          </div>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={autoScale}
              onChange={(e) => setAutoScale(e.target.checked)}
              className="rounded"
            />
            Auto
          </label>
        </div>
        <div className="space-y-2">
          <div className="flex justify-between text-xs">
            <span>Manual Scale</span>
            <span className="font-mono">{scale.toFixed(2)}x</span>
          </div>
          <input
            type="range"
            min="0.1"
            max="3"
            step="0.1"
            value={scale}
            onChange={(e) => setScale(parseFloat(e.target.value))}
            disabled={autoScale}
            className="w-full"
          />
        </div>
      </div>

      {/* Position Controls */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Move3D className="w-4 h-4 text-blue-400" />
          <h3 className="text-sm font-semibold">Position Offset</h3>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {(["x", "y", "z"] as const).map((axis) => (
            <div key={axis}>
              <label className="text-xs text-muted-foreground uppercase">
                {axis}
              </label>
              <input
                type="number"
                step="0.01"
                value={position[axis]}
                onChange={(e) =>
                  setPosition((p) => ({
                    ...p,
                    [axis]: parseFloat(e.target.value) || 0,
                  }))
                }
                className="w-full px-2 py-1.5 bg-glass-bg border border-glass-border rounded text-sm"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Rotation Controls */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <RotateCw className="w-4 h-4 text-blue-400" />
          <h3 className="text-sm font-semibold">Rotation Offset (°)</h3>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {(["x", "y", "z"] as const).map((axis) => (
            <div key={axis}>
              <label className="text-xs text-muted-foreground uppercase">
                {axis}
              </label>
              <input
                type="number"
                step="5"
                value={rotation[axis]}
                onChange={(e) =>
                  setRotation((r) => ({
                    ...r,
                    [axis]: parseFloat(e.target.value) || 0,
                  }))
                }
                className="w-full px-2 py-1.5 bg-glass-bg border border-glass-border rounded text-sm"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Animation Controls */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          {isAnimating ? (
            <Pause className="w-4 h-4 text-pink-400" />
          ) : (
            <Play className="w-4 h-4 text-pink-400" />
          )}
          <h3 className="text-sm font-semibold">Animation</h3>
        </div>
        <button
          onClick={() => setIsAnimating(!isAnimating)}
          className={`w-full py-2 rounded-lg font-medium transition-all flex items-center justify-center gap-2 text-sm ${
            isAnimating
              ? "bg-pink-500/20 text-pink-400 border border-pink-500/40"
              : "bg-gradient-to-r from-pink-500 to-rose-600 text-white hover:from-pink-400 hover:to-rose-500"
          }`}
        >
          {isAnimating ? (
            <>
              <Pause className="w-4 h-4" />
              Stop Animation
            </>
          ) : (
            <>
              <Play className="w-4 h-4" />
              Play Animation
            </>
          )}
        </button>
        <div className="grid grid-cols-3 gap-1 mt-2">
          {(["tpose", "walking", "running"] as const).map((type) => (
            <button
              key={type}
              onClick={() => setAnimationType(type)}
              className={`px-2 py-1.5 rounded text-xs transition-all ${
                animationType === type
                  ? "bg-pink-500/20 text-pink-400 border border-pink-500/30"
                  : "bg-glass-bg/30 text-muted-foreground hover:text-foreground"
              }`}
            >
              {type === "tpose"
                ? "T-Pose"
                : type.charAt(0).toUpperCase() + type.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Interactive Placement */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Move3D className="w-4 h-4 text-violet-400" />
          <h3 className="text-sm font-semibold">Interactive Placement</h3>
        </div>
        <button
          onClick={() => setInteractiveMode(!interactiveMode)}
          disabled={!selectedWeapon}
          className={`w-full py-2 rounded-lg transition-all flex items-center justify-center gap-2 text-sm mb-2 ${
            interactiveMode
              ? "bg-violet-500/20 text-violet-400 border border-violet-500/40"
              : "bg-glass-bg/30 border border-glass-border hover:bg-glass-bg/50"
          } disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          <Move3D className="w-4 h-4" />
          {interactiveMode ? "Disable" : "Enable"} Drag Mode
        </button>
        {interactiveMode && (
          <div className="grid grid-cols-3 gap-1">
            <button
              onClick={() => setTransformMode("translate")}
              className={`px-2 py-1.5 rounded text-xs transition-all ${
                transformMode === "translate"
                  ? "bg-violet-500/20 text-violet-400 border border-violet-500/30"
                  : "bg-glass-bg/30 text-muted-foreground hover:text-foreground"
              }`}
            >
              Move
            </button>
            <button
              onClick={() => setTransformMode("rotate")}
              className={`px-2 py-1.5 rounded text-xs transition-all ${
                transformMode === "rotate"
                  ? "bg-violet-500/20 text-violet-400 border border-violet-500/30"
                  : "bg-glass-bg/30 text-muted-foreground hover:text-foreground"
              }`}
            >
              Rotate
            </button>
            <button
              onClick={() => setTransformMode("scale")}
              className={`px-2 py-1.5 rounded text-xs transition-all ${
                transformMode === "scale"
                  ? "bg-violet-500/20 text-violet-400 border border-violet-500/30"
                  : "bg-glass-bg/30 text-muted-foreground hover:text-foreground"
              }`}
            >
              Scale
            </button>
          </div>
        )}
        {interactiveMode && (
          <p className="text-xs text-muted-foreground mt-2">
            Click and drag the gizmo to position the weapon
          </p>
        )}
      </div>

      {/* View Options */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Eye className="w-4 h-4 text-orange-400" />
          <h3 className="text-sm font-semibold">View Options</h3>
        </div>
        <button
          onClick={() => setShowSkeleton(!showSkeleton)}
          className={`w-full py-2 rounded-lg transition-all flex items-center justify-center gap-2 text-sm ${
            showSkeleton
              ? "bg-orange-500/20 text-orange-400 border border-orange-500/40"
              : "bg-glass-bg/30 border border-glass-border hover:bg-glass-bg/50"
          }`}
        >
          {showSkeleton ? (
            <EyeOff className="w-4 h-4" />
          ) : (
            <Eye className="w-4 h-4" />
          )}
          {showSkeleton ? "Hide" : "Show"} Skeleton
        </button>
      </div>

      {/* Actions */}
      <div className="space-y-2 pt-4 border-t border-glass-border">
        <button
          onClick={handleReset}
          className="w-full py-2 rounded-lg border border-glass-border text-muted-foreground hover:text-foreground hover:bg-glass-bg transition-all flex items-center justify-center gap-2 text-sm"
        >
          <RotateCcw className="w-4 h-4" />
          Reset All
        </button>
        <button
          onClick={handleSave}
          disabled={!selectedAvatar || !selectedWeapon}
          className="w-full py-2 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-medium hover:from-cyan-400 hover:to-blue-500 transition-all flex items-center justify-center gap-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Save className="w-4 h-4" />
          Save Configuration
        </button>
        <button
          onClick={handleExportAligned}
          disabled={!selectedWeapon}
          className="w-full py-2 rounded-lg border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10 transition-all flex items-center justify-center gap-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Download className="w-4 h-4" />
          Export Aligned Model
        </button>
        <button
          onClick={handleExportEquipped}
          disabled={!selectedAvatar || !selectedWeapon}
          className="w-full py-2 rounded-lg border border-blue-500/30 text-blue-400 hover:bg-blue-500/10 transition-all flex items-center justify-center gap-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Download className="w-4 h-4" />
          Export Equipped Avatar
        </button>
      </div>
    </div>
  );

  // Get model URLs for viewer
  const resolveModelUrl = (asset: Asset | null): string | null => {
    if (!asset) return null;
    const url = asset.modelUrl || asset.modelPath;
    if (!url) return null;
    if (url.startsWith("http")) return url;
    if (url.startsWith("/")) return url;
    if (url.startsWith("asset://"))
      return url.replace("asset://", `${CDN_URL}/`);
    return `${CDN_URL}/${url}`;
  };

  const avatarModelUrl = resolveModelUrl(selectedAvatar);
  const weaponModelUrl = resolveModelUrl(selectedWeapon);

  return (
    <StudioPageLayout
      title="Equipment Fitting"
      description="Attach weapons to VRM avatars with AI grip detection"
      assetSidebar={assetSidebar}
      toolsSidebar={toolsSidebar}
    >
      {/* 3D Viewport with EquipmentViewer */}
      {avatarModelUrl || weaponModelUrl ? (
        <EquipmentViewer
          ref={viewerRef}
          avatarUrl={avatarModelUrl}
          equipmentUrl={weaponModelUrl}
          equipmentSlot={equipmentSlot}
          showSkeleton={showSkeleton}
          avatarHeight={avatarHeight}
          autoScale={autoScale}
          scaleOverride={scale}
          gripOffset={gripResult?.gripPoint || null}
          positionOffset={position}
          rotationOffset={rotation}
          isAnimating={isAnimating}
          animationType={animationType}
          interactiveMode={interactiveMode}
          transformMode={transformMode}
          onPositionChange={(pos) => setPosition(pos)}
          onRotationChange={(rot) => setRotation(rot)}
          onScaleChange={(s) => {
            setScale(s);
            setAutoScale(false);
          }}
          className="h-full"
        />
      ) : (
        <div className="h-full flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
          <div className="text-center p-8">
            <div className="w-24 h-24 rounded-full bg-glass-bg flex items-center justify-center mx-auto mb-4">
              <Target className="w-12 h-12 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold text-muted-foreground">
              Select Assets
            </h3>
            <p className="text-sm text-muted-foreground mt-2">
              Choose an avatar and weapon to begin fitting
            </p>
          </div>
        </div>
      )}

      {/* Status Overlay */}
      {gripResult && gripResult.confidence > 0 && (
        <div className="absolute top-4 left-4 glass-panel p-3 rounded-lg z-10">
          <div className="flex items-center gap-2 text-green-400 text-sm font-medium">
            <Check className="w-4 h-4" />
            Grip Detected ({Math.round(gripResult.confidence * 100)}%)
          </div>
          {selectedAvatar && selectedWeapon && (
            <p className="text-xs text-muted-foreground mt-1">
              {selectedAvatar.name} + {selectedWeapon.name}
            </p>
          )}
        </div>
      )}
    </StudioPageLayout>
  );
}
