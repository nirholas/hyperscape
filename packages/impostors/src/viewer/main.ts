/**
 * Octahedral Impostor Viewer - Application Entry Point
 *
 * WebGPU-only viewer with TSL shaders.
 */

import "../style.css";
import { ImpostorViewer, type RendererType } from "./ImpostorViewer";
import { OctahedronType } from "../lib";
import { createColoredCube, createTestTorusKnot } from "../lib/utils";
import * as THREE from "three";
import { MeshStandardNodeMaterial } from "three/webgpu";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

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
 * Setup demo mesh switching functionality
 */
function setupDemoMeshSwitcher(
  viewer: ImpostorViewer,
  rendererType: RendererType,
): void {
  // Track if tree is currently loading
  let treeLoading = false;
  let cachedTree: THREE.Group | null = null;

  // Add keyboard controls for switching meshes
  window.addEventListener("keydown", (event) => {
    switch (event.key) {
      case "1":
        void viewer.setSourceMesh(createColoredCube());
        break;
      case "2":
        void viewer.setSourceMesh(createTestTorusKnot());
        break;
      case "3":
        void viewer.setSourceMesh(createSphere());
        break;
      case "4":
        void viewer.setSourceMesh(createMonkey());
        break;
      case "5":
        loadTree(viewer);
        break;
    }
  });

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
║                                                                ║
╚════════════════════════════════════════════════════════════════╝
  `);
}

function createSphere(): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(0.5, 32, 32);
  const material = new MeshStandardNodeMaterial();
  material.color = new THREE.Color(0x4488ff);
  material.roughness = 0.3;
  material.metalness = 0.7;
  return new THREE.Mesh(geometry, material);
}

function createMonkey(): THREE.Group {
  const group = new THREE.Group();

  // Head
  const headMat = new MeshStandardNodeMaterial();
  headMat.color = new THREE.Color(0x8b4513);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.4, 32, 32), headMat);
  group.add(head);

  // Eyes
  const eyeGeom = new THREE.SphereGeometry(0.08, 16, 16);
  const eyeMat = new MeshStandardNodeMaterial();
  eyeMat.color = new THREE.Color(0xffffff);

  const leftEye = new THREE.Mesh(eyeGeom, eyeMat);
  leftEye.position.set(-0.15, 0.1, 0.35);
  group.add(leftEye);

  const rightEye = new THREE.Mesh(eyeGeom, eyeMat);
  rightEye.position.set(0.15, 0.1, 0.35);
  group.add(rightEye);

  // Pupils
  const pupilGeom = new THREE.SphereGeometry(0.04, 16, 16);
  const pupilMat = new MeshStandardNodeMaterial();
  pupilMat.color = new THREE.Color(0x000000);

  const leftPupil = new THREE.Mesh(pupilGeom, pupilMat);
  leftPupil.position.set(-0.15, 0.1, 0.42);
  group.add(leftPupil);

  const rightPupil = new THREE.Mesh(pupilGeom, pupilMat);
  rightPupil.position.set(0.15, 0.1, 0.42);
  group.add(rightPupil);

  // Ears
  const earGeom = new THREE.SphereGeometry(0.15, 16, 16);
  const earMat = new MeshStandardNodeMaterial();
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
  const snoutMat = new MeshStandardNodeMaterial();
  snoutMat.color = new THREE.Color(0xa0522d);
  const snout = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 16), snoutMat);
  snout.position.set(0, -0.1, 0.35);
  snout.scale.set(1.2, 0.8, 0.8);
  group.add(snout);

  return group;
}
