"use client";

import { useState, useCallback, Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Environment, Grid, Html } from "@react-three/drei";
import { ModelViewer, type ModelInfo } from "./ModelViewer";
import { VRMViewer, type VRMViewerRef, type VRMInfo } from "./VRMViewer";
import type { VRM } from "@pixiv/three-vrm";
import { Eye, EyeOff, Grid3X3 } from "lucide-react";

export interface StudioViewerProps {
  /** URL of the GLB/GLTF model to display */
  modelUrl?: string | null;
  /** URL of a second model (e.g., equipment to attach) */
  secondaryModelUrl?: string | null;
  /** If true, use VRMViewer instead of ModelViewer */
  isVRM?: boolean;
  /** VRM URL for VRMViewer mode */
  vrmUrl?: string | null;
  /** Ref for VRMViewer to control animations */
  vrmRef?: React.RefObject<VRMViewerRef>;
  /** Callback when primary model loads */
  onModelLoad?: (info: ModelInfo) => void;
  /** Callback when VRM loads */
  onVRMLoad?: (vrm: VRM, info: VRMInfo) => void;
  /** Show grid by default */
  showGrid?: boolean;
  /** Show skeleton/bones overlay */
  showSkeleton?: boolean;
  /** Environment preset */
  environment?: "studio" | "warehouse" | "sunset" | "apartment" | "night";
  /** Custom placeholder content */
  placeholder?: React.ReactNode;
  /** Additional className for the container */
  className?: string;
  /** Show mini controls */
  showControls?: boolean;
  /** Custom overlay content */
  overlay?: React.ReactNode;
}

/**
 * Reusable 3D viewer for studio pages
 * Supports both GLB/GLTF and VRM models
 */
export function StudioViewer({
  modelUrl,
  secondaryModelUrl,
  isVRM = false,
  vrmUrl,
  vrmRef,
  onModelLoad,
  onVRMLoad,
  showGrid: initialShowGrid = true,
  showSkeleton: initialShowSkeleton = false,
  environment = "studio",
  placeholder,
  className = "",
  showControls = true,
  overlay,
}: StudioViewerProps) {
  const [showGrid, setShowGrid] = useState(initialShowGrid);
  const [showBones, setShowBones] = useState(initialShowSkeleton);

  // Toggle grid visibility
  const toggleGrid = useCallback(() => {
    setShowGrid((prev) => !prev);
  }, []);

  // Toggle skeleton visibility
  const toggleBones = useCallback(() => {
    setShowBones((prev) => !prev);
    if (vrmRef?.current) {
      vrmRef.current.toggleSkeleton();
    }
  }, [vrmRef]);

  // Determine what to show
  const hasModel = modelUrl || vrmUrl || isVRM;

  // If VRM mode with vrmUrl, use dedicated VRMViewer
  if (isVRM && vrmUrl) {
    return (
      <div className={`relative h-full w-full ${className}`}>
        <VRMViewer
          ref={vrmRef}
          vrmUrl={vrmUrl}
          onLoad={onVRMLoad}
          showSkeleton={showBones}
          className="h-full"
        />

        {/* Mini Controls */}
        {showControls && (
          <ViewerControls
            showGrid={showGrid}
            showBones={showBones}
            onToggleGrid={toggleGrid}
            onToggleBones={toggleBones}
          />
        )}

        {overlay}
      </div>
    );
  }

  return (
    <div
      className={`relative h-full w-full bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 ${className}`}
    >
      {hasModel ? (
        <Canvas
          camera={{ position: [3, 2, 3], fov: 50 }}
          gl={{ antialias: true }}
        >
          <Suspense fallback={<LoadingFallback />}>
            <ambientLight intensity={0.4} />
            <directionalLight position={[10, 10, 5]} intensity={1} castShadow />
            <Environment preset={environment} />

            {/* Primary Model */}
            {modelUrl && (
              <ModelViewer modelUrl={modelUrl} onModelLoad={onModelLoad} />
            )}

            {/* Secondary Model (equipment, etc.) */}
            {secondaryModelUrl && <ModelViewer modelUrl={secondaryModelUrl} />}

            {/* Grid */}
            {showGrid && (
              <Grid
                args={[10, 10]}
                cellSize={0.5}
                cellThickness={0.5}
                cellColor="#333"
                sectionSize={2}
                sectionThickness={1}
                sectionColor="#444"
                fadeDistance={15}
                fadeStrength={1}
                followCamera={false}
                infiniteGrid
              />
            )}

            <OrbitControls
              enablePan={true}
              enableZoom={true}
              enableRotate={true}
              minDistance={0.5}
              maxDistance={20}
              target={[0, 0.5, 0]}
            />
          </Suspense>
        </Canvas>
      ) : (
        // Placeholder when no model
        <div className="h-full flex items-center justify-center">
          {placeholder || <DefaultPlaceholder />}
        </div>
      )}

      {/* Mini Controls */}
      {showControls && hasModel && (
        <ViewerControls
          showGrid={showGrid}
          showBones={showBones}
          onToggleGrid={toggleGrid}
          onToggleBones={toggleBones}
        />
      )}

      {overlay}
    </div>
  );
}

/**
 * Loading fallback component
 */
function LoadingFallback() {
  return (
    <Html center>
      <div className="flex flex-col items-center gap-2 text-white">
        <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin" />
        <span className="text-sm">Loading model...</span>
      </div>
    </Html>
  );
}

/**
 * Default placeholder when no model is selected
 */
function DefaultPlaceholder() {
  return (
    <div className="text-center p-8">
      <div className="w-24 h-24 rounded-full bg-glass-bg flex items-center justify-center mx-auto mb-4">
        <Grid3X3 className="w-12 h-12 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-semibold text-muted-foreground">
        No Model Selected
      </h3>
      <p className="text-sm text-muted-foreground mt-2">
        Select assets from the sidebar to view them here
      </p>
    </div>
  );
}

/**
 * Mini controls for the viewer
 */
function ViewerControls({
  showGrid,
  showBones,
  onToggleGrid,
  onToggleBones,
}: {
  showGrid: boolean;
  showBones: boolean;
  onToggleGrid: () => void;
  onToggleBones: () => void;
}) {
  return (
    <div className="absolute bottom-4 right-4 flex items-center gap-1 glass-panel p-1 rounded-lg">
      <button
        onClick={onToggleGrid}
        title={showGrid ? "Hide Grid" : "Show Grid"}
        className={`p-2 rounded transition-colors ${
          showGrid
            ? "bg-cyan-500/20 text-cyan-400"
            : "text-muted-foreground hover:text-foreground hover:bg-glass-bg"
        }`}
      >
        <Grid3X3 className="w-4 h-4" />
      </button>
      <button
        onClick={onToggleBones}
        title={showBones ? "Hide Skeleton" : "Show Skeleton"}
        className={`p-2 rounded transition-colors ${
          showBones
            ? "bg-orange-500/20 text-orange-400"
            : "text-muted-foreground hover:text-foreground hover:bg-glass-bg"
        }`}
      >
        {showBones ? (
          <EyeOff className="w-4 h-4" />
        ) : (
          <Eye className="w-4 h-4" />
        )}
      </button>
    </div>
  );
}
