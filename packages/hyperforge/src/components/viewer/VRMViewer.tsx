"use client";

/**
 * VRMViewer - Real VRM viewer with animation support
 *
 * Uses @pixiv/three-vrm to load and display VRM files with animation retargeting.
 * Based on asset-forge's VRMTestViewer but adapted for hyperforge.
 */

import {
  useRef,
  useEffect,
  useState,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";
import type { VRM } from "@pixiv/three-vrm";
import { retargetAnimation } from "@/services/retargeting/AnimationRetargeting";

export interface VRMViewerRef {
  loadAnimation: (url: string) => Promise<void>;
  playAnimation: (name?: string) => void;
  pauseAnimation: () => void;
  stopAnimation: () => void;
  resetCamera: () => void;
  toggleSkeleton: () => void;
  getVRM: () => VRM | null;
}

interface VRMViewerProps {
  vrmUrl: string | null;
  className?: string;
  onLoad?: (vrm: VRM, info: VRMInfo) => void;
  onError?: (error: Error) => void;
  showSkeleton?: boolean;
}

export interface VRMInfo {
  boneCount: number;
  height: number;
  version: string;
}

export const VRMViewer = forwardRef<VRMViewerRef, VRMViewerProps>(
  ({ vrmUrl, className = "", onLoad, onError, showSkeleton = false }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);

    // Three.js refs
    const sceneRef = useRef<THREE.Scene | null>(null);
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
    const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
    const controlsRef = useRef<OrbitControls | null>(null);
    const vrmRef = useRef<VRM | null>(null);
    const mixerRef = useRef<THREE.AnimationMixer | null>(null);
    const currentActionRef = useRef<THREE.AnimationAction | null>(null);
    const skeletonHelperRef = useRef<THREE.SkeletonHelper | null>(null);
    const clockRef = useRef<THREE.Clock>(new THREE.Clock());
    const animationFrameRef = useRef<number>(0);
    const rootToHipsRef = useRef<number>(1);

    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showSkeletonState, setShowSkeletonState] = useState(showSkeleton);

    // Loader with VRM plugin
    const loaderRef = useRef<GLTFLoader | null>(null);

    // Initialize Three.js scene
    useEffect(() => {
      if (!canvasRef.current || !containerRef.current) return;

      const canvas = canvasRef.current;
      const container = containerRef.current;

      // Scene
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x1a1a2e);
      sceneRef.current = scene;

      // Camera
      const camera = new THREE.PerspectiveCamera(
        45,
        container.clientWidth / container.clientHeight,
        0.1,
        100,
      );
      camera.position.set(0, 1.5, 3);
      cameraRef.current = camera;

      // Renderer
      const renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: true,
      });
      renderer.setSize(container.clientWidth, container.clientHeight);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      rendererRef.current = renderer;

      // Controls
      const controls = new OrbitControls(camera, canvas);
      controls.target.set(0, 1, 0);
      controls.enableDamping = true;
      controls.dampingFactor = 0.05;
      controls.update();
      controlsRef.current = controls;

      // Lighting
      const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
      scene.add(ambientLight);

      const directionalLight = new THREE.DirectionalLight(0xffffff, 1.2);
      directionalLight.position.set(2, 4, 2);
      directionalLight.castShadow = true;
      scene.add(directionalLight);

      const backLight = new THREE.DirectionalLight(0x8888ff, 0.3);
      backLight.position.set(-2, 2, -2);
      scene.add(backLight);

      // Ground grid
      const gridHelper = new THREE.GridHelper(10, 20, 0x333344, 0x222233);
      scene.add(gridHelper);

      // GLTF Loader with VRM plugin
      const loader = new GLTFLoader();
      loader.register((parser) => new VRMLoaderPlugin(parser));
      loaderRef.current = loader;

      // Animation loop
      const animate = () => {
        animationFrameRef.current = requestAnimationFrame(animate);

        const delta = clockRef.current.getDelta();

        // Update animation mixer
        if (mixerRef.current) {
          mixerRef.current.update(delta);
        }

        // Update VRM (required for normalized bone animation)
        if (vrmRef.current) {
          vrmRef.current.update(delta);
        }

        controls.update();
        renderer.render(scene, camera);
      };
      animate();

      // Handle resize
      const handleResize = () => {
        if (!containerRef.current) return;
        const width = containerRef.current.clientWidth;
        const height = containerRef.current.clientHeight;

        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height);
      };
      window.addEventListener("resize", handleResize);

      // Cleanup
      return () => {
        window.removeEventListener("resize", handleResize);
        cancelAnimationFrame(animationFrameRef.current);
        renderer.dispose();
        controls.dispose();
      };
    }, []);

    // Load VRM when URL changes
    useEffect(() => {
      if (!vrmUrl || !loaderRef.current || !sceneRef.current) return;

      const scene = sceneRef.current;
      const loader = loaderRef.current;

      // Clear previous VRM
      if (vrmRef.current) {
        scene.remove(vrmRef.current.scene);
        vrmRef.current = null;
      }
      if (skeletonHelperRef.current) {
        scene.remove(skeletonHelperRef.current);
        skeletonHelperRef.current = null;
      }
      if (mixerRef.current) {
        mixerRef.current.stopAllAction();
        mixerRef.current = null;
      }

      setIsLoading(true);
      setError(null);

      console.log("[VRMViewer] Loading VRM:", vrmUrl);

      loader.load(
        vrmUrl,
        (gltf) => {
          const vrm = gltf.userData.vrm as VRM;

          if (!vrm) {
            const err = new Error("No VRM data found in file");
            setError(err.message);
            onError?.(err);
            setIsLoading(false);
            return;
          }

          console.log("[VRMViewer] VRM loaded:", vrm);

          // #region agent log
          const vrmMaterialDetails: {
            name: string;
            type: string;
            hasMap: boolean;
            color: string;
          }[] = [];
          vrm.scene.traverse((child: THREE.Object3D) => {
            if (child instanceof THREE.Mesh) {
              const mats = Array.isArray(child.material)
                ? child.material
                : [child.material];
              mats.forEach((m: THREE.Material) => {
                const anyMat = m as any;
                vrmMaterialDetails.push({
                  name: m.name || "unnamed",
                  type: m.type,
                  hasMap: !!(anyMat.map || anyMat.shadeMultiplyTexture),
                  color: anyMat.color
                    ? `#${anyMat.color.getHexString()}`
                    : "none",
                });
              });
            }
          });
          fetch(
            "http://127.0.0.1:7242/ingest/ef06d7d2-0f29-426d-9574-6692c61c9819",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                location: "VRMViewer.tsx:218",
                message: "VRM materials via VRMLoaderPlugin",
                data: {
                  vrmUrl,
                  materialCount: vrmMaterialDetails.length,
                  materials: vrmMaterialDetails.slice(0, 5),
                },
                timestamp: Date.now(),
                sessionId: "debug-session",
                hypothesisId: "D",
              }),
            },
          ).catch(() => {});
          // #endregion

          // Handle VRM 0.0 rotation
          // VRM meta can be VRM0Meta or VRM1Meta - check for metaVersion first
          const meta = vrm.meta as
            | { metaVersion?: string; specVersion?: string }
            | undefined;
          const vrmVersion =
            meta?.metaVersion ||
            (meta?.specVersion?.startsWith("0.") ? "0" : "1");

          if (vrmVersion === "0") {
            console.log("[VRMViewer] Rotating VRM 0.0 by 180°");
            VRMUtils.rotateVRM0(vrm);
          }

          scene.add(vrm.scene);
          vrmRef.current = vrm;

          // Calculate rootToHips for animation scaling
          const humanoid = vrm.humanoid;
          if (humanoid) {
            const normalizedRestPose = (
              humanoid as {
                normalizedRestPose?: { hips?: { position: number[] } };
              }
            ).normalizedRestPose;
            if (normalizedRestPose?.hips) {
              rootToHipsRef.current = normalizedRestPose.hips.position[1];
            } else {
              const hipsNode = humanoid.getRawBoneNode("hips");
              if (hipsNode) {
                const worldPos = new THREE.Vector3();
                hipsNode.getWorldPosition(worldPos);
                rootToHipsRef.current = worldPos.y;
              }
            }
          }

          // Setup animation mixer
          mixerRef.current = new THREE.AnimationMixer(vrm.scene);

          // Create skeleton helper if enabled
          if (showSkeletonState) {
            vrm.scene.traverse((obj) => {
              if (obj instanceof THREE.SkinnedMesh) {
                const helper = new THREE.SkeletonHelper(obj);
                scene.add(helper);
                skeletonHelperRef.current = helper;
              }
            });
          }

          // Get bone count
          const boneCount = humanoid
            ? Object.keys(humanoid.humanBones).length
            : 0;

          // Auto-fit camera to model bounds
          const box = new THREE.Box3().setFromObject(vrm.scene);
          const size = box.getSize(new THREE.Vector3());
          const center = box.getCenter(new THREE.Vector3());

          const maxDim = Math.max(size.x, size.y, size.z);
          const fov = cameraRef.current!.fov * (Math.PI / 180);
          const cameraDistance = (maxDim / 2 / Math.tan(fov / 2)) * 1.5;

          // Position camera to view the full model
          cameraRef.current!.position.set(
            center.x,
            center.y,
            center.z + cameraDistance,
          );

          // Update orbit controls target to model center
          if (controlsRef.current) {
            controlsRef.current.target.copy(center);
            controlsRef.current.update();
          }

          console.log(
            `[VRMViewer] Model bounds: ${size.x.toFixed(2)} x ${size.y.toFixed(2)} x ${size.z.toFixed(2)}`,
          );
          console.log(
            `[VRMViewer] Camera distance: ${cameraDistance.toFixed(2)}, center: [${center.x.toFixed(2)}, ${center.y.toFixed(2)}, ${center.z.toFixed(2)}]`,
          );

          const info: VRMInfo = {
            boneCount,
            height: rootToHipsRef.current,
            version: vrmVersion,
          };

          onLoad?.(vrm, info);
          setIsLoading(false);
        },
        (progress) => {
          // Progress callback
        },
        (err) => {
          console.error("[VRMViewer] Load error:", err);
          const error = err instanceof Error ? err : new Error(String(err));
          setError(error.message);
          onError?.(error);
          setIsLoading(false);
        },
      );
    }, [vrmUrl, onLoad, onError, showSkeletonState]);

    // Toggle skeleton helper
    useEffect(() => {
      if (!sceneRef.current || !vrmRef.current) return;

      const scene = sceneRef.current;
      const vrm = vrmRef.current;

      if (showSkeletonState && !skeletonHelperRef.current) {
        vrm.scene.traverse((obj) => {
          if (obj instanceof THREE.SkinnedMesh && !skeletonHelperRef.current) {
            const helper = new THREE.SkeletonHelper(obj);
            scene.add(helper);
            skeletonHelperRef.current = helper;
          }
        });
      } else if (!showSkeletonState && skeletonHelperRef.current) {
        scene.remove(skeletonHelperRef.current);
        skeletonHelperRef.current = null;
      }
    }, [showSkeletonState]);

    // Load and play animation
    const loadAnimation = useCallback(async (url: string) => {
      if (!vrmRef.current || !mixerRef.current || !loaderRef.current) {
        console.warn("[VRMViewer] Cannot load animation - VRM not ready");
        return;
      }

      const vrm = vrmRef.current;
      const mixer = mixerRef.current;
      const loader = loaderRef.current;

      console.log("[VRMViewer] Loading animation:", url);

      try {
        const gltf = await loader.loadAsync(url);

        if (!gltf.animations || gltf.animations.length === 0) {
          console.error("[VRMViewer] No animations in file");
          return;
        }

        // Retarget animation to VRM
        const retargetedClip = retargetAnimation(
          gltf,
          vrm,
          rootToHipsRef.current,
        );

        if (!retargetedClip) {
          console.error("[VRMViewer] Animation retargeting failed");
          return;
        }

        console.log("[VRMViewer] Animation retargeted:", retargetedClip.name);

        // Stop current animation
        if (currentActionRef.current) {
          currentActionRef.current.fadeOut(0.2);
        }

        // Play new animation
        const action = mixer.clipAction(retargetedClip);
        action.reset().fadeIn(0.2).play();
        currentActionRef.current = action;
      } catch (err) {
        console.error("[VRMViewer] Failed to load animation:", err);
      }
    }, []);

    const playAnimation = useCallback((name?: string) => {
      if (currentActionRef.current) {
        currentActionRef.current.paused = false;
        currentActionRef.current.play();
      }
    }, []);

    const pauseAnimation = useCallback(() => {
      if (currentActionRef.current) {
        currentActionRef.current.paused = true;
      }
    }, []);

    const stopAnimation = useCallback(() => {
      if (currentActionRef.current) {
        currentActionRef.current.stop();
        currentActionRef.current = null;
      }
    }, []);

    const resetCamera = useCallback(() => {
      if (cameraRef.current && controlsRef.current) {
        // If we have a VRM loaded, fit camera to it
        if (vrmRef.current) {
          const box = new THREE.Box3().setFromObject(vrmRef.current.scene);
          const size = box.getSize(new THREE.Vector3());
          const center = box.getCenter(new THREE.Vector3());

          const maxDim = Math.max(size.x, size.y, size.z);
          const fov = cameraRef.current.fov * (Math.PI / 180);
          const cameraDistance = (maxDim / 2 / Math.tan(fov / 2)) * 1.5;

          cameraRef.current.position.set(
            center.x,
            center.y,
            center.z + cameraDistance,
          );
          controlsRef.current.target.copy(center);
        } else {
          // Default position
          cameraRef.current.position.set(0, 1.5, 3);
          controlsRef.current.target.set(0, 1, 0);
        }
        controlsRef.current.update();
      }
    }, []);

    const toggleSkeleton = useCallback(() => {
      setShowSkeletonState((prev) => !prev);
    }, []);

    const getVRM = useCallback(() => vrmRef.current, []);

    // Expose methods via ref
    useImperativeHandle(
      ref,
      () => ({
        loadAnimation,
        playAnimation,
        pauseAnimation,
        stopAnimation,
        resetCamera,
        toggleSkeleton,
        getVRM,
      }),
      [
        loadAnimation,
        playAnimation,
        pauseAnimation,
        stopAnimation,
        resetCamera,
        toggleSkeleton,
        getVRM,
      ],
    );

    return (
      <div ref={containerRef} className={`relative w-full h-full ${className}`}>
        <canvas ref={canvasRef} className="w-full h-full" />

        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-3">
              <div className="w-10 h-10 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
              <span className="text-sm text-white/80">Loading VRM...</span>
            </div>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-red-500/20 border border-red-500/40 rounded-lg p-4 max-w-md">
              <p className="text-red-400 text-sm">
                Failed to load VRM: {error}
              </p>
            </div>
          </div>
        )}
      </div>
    );
  },
);

VRMViewer.displayName = "VRMViewer";
