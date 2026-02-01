/**
 * Octahedral Impostor Viewer - Application Entry Point
 *
 * WebGPU-only viewer with TSL shaders.
 * Supports both static and animated impostors.
 */

import "../style.css";
import { ImpostorViewer, type RendererType } from "./ImpostorViewer";
import {
  OctahedronType,
  AnimatedImpostorBaker,
  AnimatedOctahedralImpostor,
} from "../lib";
import type { AnimatedBakeResult } from "../lib/types";
import { createColoredCube, createTestTorusKnot } from "../lib/utils";
import * as THREE from "three/webgpu";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

/**
 * WebGPU only
 */
function getRendererTypeFromURL(): RendererType {
  if (!navigator.gpu) {
    throw new Error("WebGPU required");
  }
  return "webgpu";
}

// Wait for DOM
document.addEventListener("DOMContentLoaded", () => {
  const container = document.getElementById("app") || document.body;
  const rendererType = getRendererTypeFromURL();

  console.log(
    `[ImpostorViewer] Starting with ${rendererType.toUpperCase()} renderer`,
  );
  console.log(
    `[ImpostorViewer] To switch renderers, use URL parameter: ?renderer=webgl or ?renderer=webgpu`,
  );

  // Create viewer with separate horizontal/vertical grid sizes
  // gridSizeX/Y = 31 matches the old working code (GRID_SIZE = 31)
  const viewer = new ImpostorViewer({
    container,
    atlasWidth: 2048,
    atlasHeight: 2048,
    gridSizeX: 31, // Horizontal resolution (columns) - old default
    gridSizeY: 31, // Vertical resolution (rows) - old default
    octType: OctahedronType.HEMI,
    showDebugUI: true,
    rendererType,
  });

  // Add demo controls for switching meshes
  setupDemoMeshSwitcher(viewer, rendererType);

  // Expose viewer globally for debugging
  (window as { viewer?: ImpostorViewer }).viewer = viewer;
});

/**
 * Animated impostor state
 */
interface AnimatedImpostorState {
  impostor: AnimatedOctahedralImpostor | null;
  bakeResult: AnimatedBakeResult | null;
  isPlaying: boolean;
  // Original model for comparison
  originalModel: THREE.Group | null;
  originalMixer: THREE.AnimationMixer | null;
  originalAction: THREE.AnimationAction | null;
}

/**
 * Setup demo mesh switching functionality
 */
function setupDemoMeshSwitcher(
  viewer: ImpostorViewer,
  rendererType: RendererType,
): void {
  // Track if tree is currently loading
  let treeLoading = false;
  let cachedTree: THREE.Group | null = null;

  // Animated impostor state
  const animatedState: AnimatedImpostorState = {
    impostor: null,
    bakeResult: null,
    isPlaying: false,
    originalModel: null,
    originalMixer: null,
    originalAction: null,
  };
  let humanLoading = false;
  let lastTime = performance.now();

  // Add keyboard controls for switching meshes
  window.addEventListener("keydown", (event) => {
    switch (event.key) {
      case "1":
        clearAnimatedImpostor(viewer, animatedState);
        void viewer.setSourceMesh(createColoredCube());
        break;
      case "2":
        clearAnimatedImpostor(viewer, animatedState);
        void viewer.setSourceMesh(createTestTorusKnot());
        break;
      case "3":
        clearAnimatedImpostor(viewer, animatedState);
        void viewer.setSourceMesh(createSphere());
        break;
      case "4":
        clearAnimatedImpostor(viewer, animatedState);
        void viewer.setSourceMesh(createMonkey());
        break;
      case "5":
        clearAnimatedImpostor(viewer, animatedState);
        loadTree(viewer);
        break;
      case "6":
        loadAnimatedHuman(viewer, animatedState, "walking");
        break;
      case "7":
        loadAnimatedHuman(viewer, animatedState, "running");
        break;
      case " ": // Space bar - toggle animation pause
        if (animatedState.impostor) {
          const paused = animatedState.impostor.isPaused();
          animatedState.impostor.setPaused(!paused);

          // Also pause/resume original model animation
          if (animatedState.originalAction) {
            animatedState.originalAction.paused = !paused;
          }

          console.log(`[Animated] Animation ${paused ? "resumed" : "paused"}`);
        }
        break;
    }
  });

  // Animation update loop
  function animationLoop(): void {
    const now = performance.now();
    const delta = (now - lastTime) / 1000;
    lastTime = now;

    // Update impostor animation
    if (animatedState.impostor && !animatedState.impostor.isPaused()) {
      animatedState.impostor.update(now);
    }

    // Update original model animation
    if (animatedState.originalMixer) {
      animatedState.originalMixer.update(delta);
    }

    requestAnimationFrame(animationLoop);
  }
  animationLoop();

  // Clear animated impostor from scene
  function clearAnimatedImpostor(
    viewer: ImpostorViewer,
    state: AnimatedImpostorState,
  ): void {
    const scene = viewer.getScene();

    // Clear impostor
    if (state.impostor) {
      scene.remove(state.impostor);
      state.impostor.dispose();
      state.impostor = null;
    }

    // Clear original model
    if (state.originalModel) {
      scene.remove(state.originalModel);
      state.originalModel = null;
    }
    if (state.originalAction) {
      state.originalAction.stop();
      state.originalAction = null;
    }
    if (state.originalMixer) {
      state.originalMixer.stopAllAction();
      state.originalMixer = null;
    }

    state.bakeResult = null;
    state.isPlaying = false;
  }

  // Load animated human with walk/run cycle
  async function loadAnimatedHuman(
    viewer: ImpostorViewer,
    state: AnimatedImpostorState,
    animation: "walking" | "running",
  ): Promise<void> {
    if (humanLoading) {
      console.log("[Human] Already loading...");
      return;
    }

    humanLoading = true;
    console.log(`[Human] Loading human with ${animation} animation...`);

    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);

    try {
      // Load the rigged human model
      const humanGltf = await new Promise<THREE.Group>((resolve, reject) => {
        loader.load(
          "/human_rigged.glb",
          (gltf) => resolve(gltf.scene),
          undefined,
          reject,
        );
      });

      // Load the animation
      const animGltf = await new Promise<{ animations: THREE.AnimationClip[] }>(
        (resolve, reject) => {
          loader.load(
            `/animations/${animation}.glb`,
            (gltf) => resolve(gltf),
            undefined,
            reject,
          );
        },
      );

      if (!animGltf.animations || animGltf.animations.length === 0) {
        throw new Error(`No animations found in ${animation}.glb`);
      }

      const clip = animGltf.animations[0];
      console.log(
        `[Human] Loaded ${animation} animation: ${clip.duration.toFixed(2)}s @ ${clip.tracks.length} tracks`,
      );

      // Get the renderer for baking
      const renderer = viewer.getRenderer() as THREE.WebGPURenderer;

      // Create the animated impostor baker
      const baker = new AnimatedImpostorBaker(renderer);

      // Create mixer for the human model
      const mixer = new THREE.AnimationMixer(humanGltf);

      // Clear previous animated impostor
      clearAnimatedImpostor(viewer, state);
      // Note: Don't clear viewer.setSourceMesh(null) as it causes WebGPU texture errors

      console.log("[Human] Baking walk cycle impostor...");

      // Bake the walk cycle
      const bakeResult = await baker.bakeWalkCycle(
        humanGltf,
        mixer,
        clip,
        `human_${animation}`,
        {
          atlasSize: 512,
          spritesPerSide: 8,
          animationFPS: 12,
          hemisphere: true,
        },
      );

      // Log bounding sphere from bake result
      const bsRadius = bakeResult.boundingSphere.radius;
      const bsCenter = bakeResult.boundingSphere.center;
      console.log(
        `[Human] Baked ${bakeResult.frameCount} frames @ ${bakeResult.animationFPS}fps`,
      );
      console.log(
        `[Human] Bake result bounding sphere: radius=${bsRadius.toFixed(4)}, center=(${bsCenter.x.toFixed(4)}, ${bsCenter.y.toFixed(4)}, ${bsCenter.z.toFixed(4)})`,
      );

      // --- FIRST: Measure the original model BEFORE any manipulation ---
      // Compute the ORIGINAL bounding box to determine the model's native size
      const origBbox = new THREE.Box3().setFromObject(humanGltf);
      const origSize = new THREE.Vector3();
      origBbox.getSize(origSize);
      const origCenter = new THREE.Vector3();
      origBbox.getCenter(origCenter);

      console.log(
        `[Human] ORIGINAL model (pre-clone) bounding box: size=(${origSize.x.toFixed(4)}, ${origSize.y.toFixed(4)}, ${origSize.z.toFixed(4)}), center=(${origCenter.x.toFixed(4)}, ${origCenter.y.toFixed(4)}, ${origCenter.z.toFixed(4)})`,
      );
      console.log(
        `[Human] ORIGINAL model transforms: pos=(${humanGltf.position.x.toFixed(4)}, ${humanGltf.position.y.toFixed(4)}, ${humanGltf.position.z.toFixed(4)}), scale=(${humanGltf.scale.x.toFixed(4)}, ${humanGltf.scale.y.toFixed(4)}, ${humanGltf.scale.z.toFixed(4)})`,
      );

      // --- Clone and setup original model for display ---
      const displayModel = humanGltf.clone(true);

      // The model's native size (origSize.y) is the "100x too big" size
      // We need to scale it down to a target height
      const targetHeight = 1.5; // Human-scale in scene units
      const scaleFactor = targetHeight / origSize.y;

      console.log(
        `[Human] Calculated scale factor: ${scaleFactor.toFixed(6)} (target=${targetHeight}, native height=${origSize.y.toFixed(4)})`,
      );

      // Apply scale to the display model
      displayModel.scale.setScalar(scaleFactor);

      // Position the model's feet on the ground
      // After scaling, the model height is targetHeight
      // We need to offset Y by the scaled center offset
      const scaledCenterY = origCenter.y * scaleFactor;
      const scaledHeight = origSize.y * scaleFactor;
      const yOffset = scaledHeight / 2 - scaledCenterY; // Adjust so bottom is at y=0

      displayModel.position.set(2, -yOffset, 0);
      displayModel.updateMatrixWorld(true);

      console.log(
        `[Human] Display model: scale=${scaleFactor.toFixed(6)}, position=(2, ${(-yOffset).toFixed(4)}, 0), final height=${scaledHeight.toFixed(4)}`,
      );

      // Create the animated impostor with explicit scale matching
      // The impostor constructor multiplies by boundingSphere diameter
      // So we need to compensate: final_scale = (targetHeight) / (diameter * constructorScale)
      // With constructorScale = 1.0, diameter = bsRadius * 2
      // impostorScale = targetHeight / (bsRadius * 2 * 1.0) = targetHeight / (bsRadius * 2)
      const impostorTargetHeight = targetHeight;
      const impostorConstructorScale = impostorTargetHeight / (bsRadius * 2);

      state.impostor = new AnimatedOctahedralImpostor(bakeResult, {
        scale: impostorConstructorScale,
        alphaClamp: 0.05,
        flipY: false,
        paused: false,
      });

      // The impostor is now scaled to targetHeight tall
      // Position next to the original model
      const impostorYOffset = targetHeight / 2; // Center of billboard at half-height
      state.impostor.position.set(-2, impostorYOffset, 0);

      console.log(
        `[Human] Impostor: constructorScale=${impostorConstructorScale.toFixed(6)}, actual mesh scale=${state.impostor.scale.x.toFixed(6)}, position=(-2, ${impostorYOffset.toFixed(4)}, 0)`,
      );

      // Add both to scene
      const scene = viewer.getScene();
      scene.add(state.impostor);
      scene.add(displayModel);

      // Set up animation on the display model
      const displayMixer = new THREE.AnimationMixer(displayModel);
      const displayAction = displayMixer.clipAction(clip);
      displayAction.play();

      // Store references for animation updates
      state.originalModel = displayModel;
      state.originalMixer = displayMixer;
      state.originalAction = displayAction;
      state.bakeResult = bakeResult;
      state.isPlaying = true;

      console.log(`[Human] Both models ready!`);
      console.log(
        `[Human] Original model on RIGHT (x=2), Impostor on LEFT (x=-2)`,
      );
      console.log(`[Human] Press SPACE to pause/resume animation`);

      // Cleanup baker
      baker.dispose();
    } catch (error) {
      console.error("[Human] Failed to load:", error);
    } finally {
      humanLoading = false;
    }
  }

  // Tree loading function
  function loadTree(viewer: ImpostorViewer): void {
    // Use cached tree if available
    if (cachedTree) {
      const clone = cachedTree.clone(true);
      void viewer.setSourceMesh(clone);
      console.log("[Tree] Using cached tree model");
      return;
    }

    // Prevent multiple simultaneous loads
    if (treeLoading) {
      console.log("[Tree] Already loading...");
      return;
    }

    treeLoading = true;
    console.log("[Tree] Loading tree.glb...");

    const loader = new GLTFLoader();
    loader.load(
      "/tree.glb",
      (gltf) => {
        treeLoading = false;
        cachedTree = gltf.scene;

        // Clone for use (keep original cached)
        const clone = cachedTree.clone(true);
        void viewer.setSourceMesh(clone);

        console.log("[Tree] Loaded successfully");
      },
      (progress) => {
        if (progress.total > 0) {
          const percent = Math.round((progress.loaded / progress.total) * 100);
          console.log(`[Tree] Loading: ${percent}%`);
        }
      },
      (error) => {
        treeLoading = false;
        console.error("[Tree] Failed to load tree.glb:", error);
      },
    );
  }

  // Log instructions
  const currentRenderer = rendererType.toUpperCase();
  const webgpuStatus = navigator.gpu ? "Available" : "Not Supported";
  console.log(`
╔════════════════════════════════════════════════════════════════╗
║          Octahedral Impostor Baker - Instructions              ║
╠════════════════════════════════════════════════════════════════╣
║                                                                ║
║  RENDERER: ${currentRenderer.padEnd(52)}║
║  WebGPU Status: ${webgpuStatus.padEnd(47)}║
║                                                                ║
║  SWITCH RENDERER (URL parameters):                             ║
║    WebGPU (TSL) is default when available                      ║
║    ?renderer=webgl  - Force WebGL renderer (GLSL shaders)      ║
║                                                                ║
║  UPLOAD:                                                       ║
║    - Drag & drop a GLB/GLTF file onto the window               ║
║    - Or use the "Upload GLB/GLTF" button in the UI panel       ║
║                                                                ║
║  EXPORT:                                                       ║
║    - Use "Download Atlas (PNG)" or "Download Atlas (JPEG)"     ║
║      buttons in the Export panel                               ║
║                                                                ║
║  KEYBOARD SHORTCUTS:                                           ║
║    1 - Load Colored Cube                                       ║
║    2 - Load Torus Knot                                         ║
║    3 - Load Sphere                                             ║
║    4 - Load Monkey (Suzanne)                                   ║
║    5 - Load Tree (tree.glb)                                    ║
║    6 - Load Animated Human (Walking)                           ║
║    7 - Load Animated Human (Running)                           ║
║    SPACE - Pause/Resume Animation                              ║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝
  `);
}

function createSphere(): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(0.5, 32, 32);
  const material = new THREE.MeshStandardNodeMaterial();
  material.color = new THREE.Color(0x4488ff);
  material.roughness = 0.3;
  material.metalness = 0.7;
  return new THREE.Mesh(geometry, material);
}

function createMonkey(): THREE.Group {
  const group = new THREE.Group();

  // Head
  const headMat = new THREE.MeshStandardNodeMaterial();
  headMat.color = new THREE.Color(0x8b4513);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.4, 32, 32), headMat);
  group.add(head);

  // Eyes
  const eyeGeom = new THREE.SphereGeometry(0.08, 16, 16);
  const eyeMat = new THREE.MeshStandardNodeMaterial();
  eyeMat.color = new THREE.Color(0xffffff);

  const leftEye = new THREE.Mesh(eyeGeom, eyeMat);
  leftEye.position.set(-0.15, 0.1, 0.35);
  group.add(leftEye);

  const rightEye = new THREE.Mesh(eyeGeom, eyeMat);
  rightEye.position.set(0.15, 0.1, 0.35);
  group.add(rightEye);

  // Pupils
  const pupilGeom = new THREE.SphereGeometry(0.04, 16, 16);
  const pupilMat = new THREE.MeshStandardNodeMaterial();
  pupilMat.color = new THREE.Color(0x000000);

  const leftPupil = new THREE.Mesh(pupilGeom, pupilMat);
  leftPupil.position.set(-0.15, 0.1, 0.42);
  group.add(leftPupil);

  const rightPupil = new THREE.Mesh(pupilGeom, pupilMat);
  rightPupil.position.set(0.15, 0.1, 0.42);
  group.add(rightPupil);

  // Ears
  const earGeom = new THREE.SphereGeometry(0.15, 16, 16);
  const earMat = new THREE.MeshStandardNodeMaterial();
  earMat.color = new THREE.Color(0x8b4513);

  const leftEar = new THREE.Mesh(earGeom, earMat);
  leftEar.position.set(-0.4, 0.15, 0);
  leftEar.scale.set(0.5, 1, 0.5);
  group.add(leftEar);

  const rightEar = new THREE.Mesh(earGeom, earMat);
  rightEar.position.set(0.4, 0.15, 0);
  rightEar.scale.set(0.5, 1, 0.5);
  group.add(rightEar);

  // Snout
  const snoutMat = new THREE.MeshStandardNodeMaterial();
  snoutMat.color = new THREE.Color(0xa0522d);
  const snout = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 16), snoutMat);
  snout.position.set(0, -0.1, 0.35);
  snout.scale.set(1.2, 0.8, 0.8);
  group.add(snout);

  return group;
}
