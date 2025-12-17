"use client";

import { useGLTF, Center, Html } from "@react-three/drei";
import { Suspense, useMemo, useEffect, useState } from "react";
import * as THREE from "three";

interface ModelViewerProps {
  modelUrl?: string;
  onModelLoad?: (info: ModelInfo) => void;
}

export interface ModelInfo {
  vertices: number;
  faces: number;
  materials: number;
  animations: number;
  hasRig: boolean;
}

/**
 * Placeholder box shown when no model is loaded
 */
function PlaceholderBox() {
  return (
    <mesh>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#444" wireframe />
    </mesh>
  );
}

/**
 * Loading indicator while model is being fetched
 */
function LoadingIndicator() {
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
 * Error display when model fails to load
 */
function ErrorDisplay({ error }: { error: string }) {
  return (
    <Html center>
      <div className="bg-red-500/80 text-white px-4 py-2 rounded-md text-sm max-w-xs text-center">
        Failed to load model: {error}
      </div>
    </Html>
  );
}

/**
 * The actual model component that loads and displays GLB/GLTF
 */
function LoadedModel({
  modelUrl,
  onModelLoad,
}: {
  modelUrl: string;
  onModelLoad?: (info: ModelInfo) => void;
}) {
  const gltf = useGLTF(modelUrl);
  const [error, setError] = useState<string | null>(null);

  // Calculate model info
  const modelInfo = useMemo(() => {
    let vertices = 0;
    let faces = 0;
    const materials = new Set<THREE.Material>();
    let hasRig = false;

    // #region agent log
    const materialDetails: {
      name: string;
      type: string;
      hasMap: boolean;
      hasNormalMap: boolean;
      color: string;
    }[] = [];
    gltf.scene.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const mats = Array.isArray(child.material)
          ? child.material
          : [child.material];
        mats.forEach((m: THREE.Material) => {
          const stdMat = m as THREE.MeshStandardMaterial;
          materialDetails.push({
            name: m.name || "unnamed",
            type: m.type,
            hasMap: !!stdMat.map,
            hasNormalMap: !!stdMat.normalMap,
            color: stdMat.color ? `#${stdMat.color.getHexString()}` : "none",
          });
        });
      }
    });
    fetch("http://127.0.0.1:7242/ingest/ef06d7d2-0f29-426d-9574-6692c61c9819", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        location: "ModelViewer.tsx:73",
        message: "Model materials inspection",
        data: {
          modelUrl,
          materialCount: materialDetails.length,
          materials: materialDetails.slice(0, 5),
          isVRMFile: modelUrl?.includes(".vrm"),
        },
        timestamp: Date.now(),
        sessionId: "debug-session",
        hypothesisId: "A,B",
      }),
    }).catch(() => {});
    // #endregion

    gltf.scene.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const geometry = child.geometry;
        if (geometry.attributes.position) {
          vertices += geometry.attributes.position.count;
        }
        if (geometry.index) {
          faces += geometry.index.count / 3;
        } else if (geometry.attributes.position) {
          faces += geometry.attributes.position.count / 3;
        }
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => materials.add(m));
        } else if (child.material) {
          materials.add(child.material);
        }
      }
      if (child instanceof THREE.SkinnedMesh) {
        hasRig = true;
      }
    });

    return {
      vertices,
      faces: Math.floor(faces),
      materials: materials.size,
      animations: gltf.animations?.length || 0,
      hasRig,
    };
  }, [gltf]);

  // Notify parent of model info
  useEffect(() => {
    onModelLoad?.(modelInfo);
  }, [modelInfo, onModelLoad]);

  // Auto-scale and center the model
  const scaledScene = useMemo(() => {
    const scene = gltf.scene.clone();

    // Calculate bounding box
    const box = new THREE.Box3().setFromObject(scene);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());

    // Calculate scale to fit in unit cube
    const maxDim = Math.max(size.x, size.y, size.z);
    const scale = maxDim > 0 ? 2 / maxDim : 1;

    scene.scale.setScalar(scale);

    // Center the model
    scene.position.sub(center.multiplyScalar(scale));

    return scene;
  }, [gltf]);

  if (error) {
    return <ErrorDisplay error={error} />;
  }

  return (
    <Center>
      <primitive object={scaledScene} />
    </Center>
  );
}

/**
 * Check if a URL points to a valid 3D model file
 */
function isValidModelUrl(url: string): boolean {
  if (!url || url.trim() === "") return false;

  const lowerUrl = url.toLowerCase();

  // Must end with a valid 3D model extension
  const validExtensions = [".glb", ".gltf"];
  const hasValidExtension = validExtensions.some((ext) =>
    lowerUrl.endsWith(ext),
  );

  // Check for audio/video/image extensions that should NOT be loaded
  const invalidExtensions = [
    ".mp3",
    ".wav",
    ".ogg",
    ".mp4",
    ".webm",
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
  ];
  const hasInvalidExtension = invalidExtensions.some((ext) =>
    lowerUrl.endsWith(ext),
  );

  if (hasInvalidExtension) {
    console.warn("[ModelViewer] Rejecting non-3D asset URL:", url);
    return false;
  }

  return hasValidExtension;
}

/**
 * Main ModelViewer component
 * Loads and displays GLB/GLTF models from URLs
 */
export function ModelViewer({ modelUrl, onModelLoad }: ModelViewerProps) {
  const [loadError, setLoadError] = useState<string | null>(null);

  // Reset error when URL changes
  useEffect(() => {
    setLoadError(null);
  }, [modelUrl]);

  // Show placeholder if no URL or invalid URL (just base CDN URL with no path)
  if (!modelUrl || modelUrl.trim() === "") {
    return <PlaceholderBox />;
  }

  // Validate that the URL is a valid 3D model file
  if (!isValidModelUrl(modelUrl)) {
    console.warn("[ModelViewer] Invalid model URL (not a 3D model):", modelUrl);
    return <PlaceholderBox />;
  }

  // Check if URL is just a base URL without a file path (e.g., "http://localhost:8080/")
  try {
    const url = new URL(modelUrl);
    if (url.pathname === "/" || url.pathname === "") {
      console.warn("[ModelViewer] Invalid model URL (no path):", modelUrl);
      return <PlaceholderBox />;
    }
  } catch {
    // If URL parsing fails, let it try to load anyway
  }

  // Handle loading errors
  if (loadError) {
    return (
      <>
        <PlaceholderBox />
        <ErrorDisplay error={loadError} />
      </>
    );
  }

  return (
    <Suspense fallback={<LoadingIndicator />}>
      <LoadedModel modelUrl={modelUrl} onModelLoad={onModelLoad} />
    </Suspense>
  );
}

// Preload function for optimizing load times
ModelViewer.preload = (url: string) => {
  useGLTF.preload(url);
};
