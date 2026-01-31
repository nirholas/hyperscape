/**
 * Octahedral Impostor Viewer - Interactive Editor/Baker Application
 *
 * A Three.js application for visualizing, editing, and baking octahedral impostors.
 * Supports both WebGL and WebGPU renderers with automatic material selection.
 */

import * as THREE from "three";
import * as THREE_WEBGPU from "three/webgpu";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { texture as tslTexture } from "three/tsl";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

/** Material type for WebGPU */
type BasicMaterial = MeshBasicNodeMaterial;
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { Pane } from "tweakpane";

import {
  OctahedralImpostor,
  OctahedronType,
  PBRBakeMode,
  buildOctahedronMesh,
  lerpOctahedronGeometry,
  createTSLImpostorMaterial,
  updateImpostorMaterial,
  updateImpostorAAALighting,
} from "../lib";
import type {
  OctahedronTypeValue,
  OctahedronMeshData,
  PBRBakeModeValue,
  ImpostorBakeResult,
  ImpostorViewData,
  TSLImpostorMaterial,
} from "../lib";

// WebGPU renderer type (for future use)
void THREE_WEBGPU;
void createTSLImpostorMaterial;
import {
  createColoredCube,
  generateHSLGradientColors,
  mapLinear,
} from "../lib/utils";

// Import Text from troika-three-text for debug labels
// @ts-expect-error - troika-three-text doesn't have type definitions
import { Text } from "troika-three-text";

/** Renderer type selection */
export type RendererType = "webgl" | "webgpu";

/**
 * Viewer configuration
 */
export interface ImpostorViewerConfig {
  /** Canvas element or container */
  container: HTMLElement;
  /** Initial atlas width */
  atlasWidth?: number;
  /** Initial atlas height */
  atlasHeight?: number;
  /** Initial horizontal grid size (columns) */
  gridSizeX?: number;
  /** Initial vertical grid size (rows) */
  gridSizeY?: number;
  /** Initial octahedron type */
  octType?: OctahedronTypeValue;
  /** Show debug UI */
  showDebugUI?: boolean;
  /** PBR bake mode (default: FULL for depth + normals) */
  pbrMode?: PBRBakeModeValue;
  /** Renderer type: 'webgl' (default) or 'webgpu' */
  rendererType?: RendererType;
}

/**
 * Debug visualization state
 */
interface DebugState {
  atlasQuads: boolean;
  atlasNumbers: boolean;
  atlasSamples: boolean;
  octahedronQuads: boolean;
  octahedronNumbers: boolean;
  octahedronSamples: boolean;
  octahedronLerp: number;
  showTarget: boolean;
  showWireframe: boolean;
}

/**
 * ImpostorViewer - Interactive Three.js application for impostor visualization
 * Supports both WebGL and WebGPU renderers.
 */
export class ImpostorViewer {
  // Core Three.js objects
  private renderer!: THREE.WebGLRenderer | THREE_WEBGPU.WebGPURenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls!: OrbitControls;

  // Impostor system
  private impostor!: OctahedralImpostor;

  // Configuration
  private config: Required<ImpostorViewerConfig>;
  private atlasWidth: number;
  private atlasHeight: number;
  private gridSizeX: number;
  private gridSizeY: number;
  private octType: OctahedronTypeValue;
  private pbrMode: PBRBakeModeValue;
  private rendererType: RendererType = "webgl";
  private isWebGPU: boolean = false;
  private isInitialized: boolean = false;

  // AAA Bake result
  private bakeResult: ImpostorBakeResult | null = null;
  private normalAtlasPlane: THREE.Mesh | null = null;
  private depthAtlasPlane: THREE.Mesh | null = null;

  // Meshes
  private sourceMesh: THREE.Mesh | THREE.Group | null = null;
  private impostorMesh: THREE.Mesh | null = null;
  private impostorMaterial: THREE.ShaderMaterial | TSLImpostorMaterial | null =
    null;
  private wireframeMesh: THREE.Mesh | null = null;
  private atlasPlaneMesh: THREE.Mesh | null = null;
  private atlasRenderTarget!: THREE.RenderTarget;

  // Octahedron meshes
  private fullOct: OctahedronMeshData | null = null;
  private hemiOct: OctahedronMeshData | null = null;
  private gridOnMesh: THREE.Mesh | null = null;
  private atlasGridOverlay: THREE.Mesh | null = null;

  // Debug visualization
  private debugState: DebugState;
  private samplePointsOnMesh: THREE.Mesh[] = [];
  private samplePointsOnAtlas: THREE.Mesh[] = [];
  private numbersOnMesh: THREE.Object3D[] = [];
  private numbersOnAtlas: THREE.Object3D[] = [];
  private intersectDebug: THREE.Mesh | null = null;

  // View data
  private currentFaceIndices = new THREE.Vector3();
  private currentFaceWeights = new THREE.Vector3();
  private raycaster = new THREE.Raycaster();
  private boundingSphere = new THREE.Sphere();

  // UI
  private pane: Pane | null = null;
  private animationId: number | null = null;
  private fileInput: HTMLInputElement | null = null;
  private dropOverlay: HTMLDivElement | null = null;
  private gltfLoader: GLTFLoader;
  private resizeObserver: ResizeObserver | null = null;

  constructor(config: ImpostorViewerConfig) {
    // gridSizeX/Y defaults to 31 to match old working code (GRID_SIZE = 31)
    this.config = {
      container: config.container,
      atlasWidth: config.atlasWidth ?? 2048,
      atlasHeight: config.atlasHeight ?? 2048,
      gridSizeX: config.gridSizeX ?? 31,
      gridSizeY: config.gridSizeY ?? 31,
      octType: config.octType ?? OctahedronType.HEMI,
      showDebugUI: config.showDebugUI ?? true,
      pbrMode: config.pbrMode ?? PBRBakeMode.BASIC, // Use BASIC for Canvas-based atlas
      rendererType: config.rendererType ?? "webgl",
    };

    this.atlasWidth = this.config.atlasWidth;
    this.atlasHeight = this.config.atlasHeight;
    this.gridSizeX = this.config.gridSizeX;
    this.gridSizeY = this.config.gridSizeY;
    this.octType = this.config.octType;
    this.pbrMode = this.config.pbrMode;
    this.rendererType = this.config.rendererType;
    this.isWebGPU = this.rendererType === "webgpu";

    this.debugState = {
      atlasQuads: false,
      atlasNumbers: false,
      atlasSamples: false,
      octahedronQuads: false,
      octahedronNumbers: false,
      octahedronSamples: false,
      octahedronLerp: 1.0,
      showTarget: true,
      showWireframe: true,
    };

    // Initialize GLTF loader
    this.gltfLoader = new GLTFLoader();

    // Initialize scene and camera (shared between renderers)
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xc1eeff);

    this.camera = new THREE.PerspectiveCamera(
      60,
      config.container.clientWidth / config.container.clientHeight,
      0.1,
      1000,
    );
    this.camera.position.set(0, 2, 5);

    // Add lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 2.6);
    this.scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 3.8);
    directionalLight.position.set(5, 10, 7.5);
    this.scene.add(directionalLight);

    // Initialize renderer (WebGPU requires async init)
    // Use IIFE to handle async in constructor
    void (async () => {
      await this.initRenderer(config.container);
      await this.completeInitialization(config.container);
    })();
  }

  /**
   * Create a basic material for WebGPU (MeshBasicNodeMaterial).
   * Uses colorNode with tslTexture() for render target textures.
   */
  private createBasicMaterial(options?: {
    color?: THREE.ColorRepresentation;
    map?: THREE.Texture | null;
    side?: THREE.Side;
    wireframe?: boolean;
    transparent?: boolean;
  }): BasicMaterial {
    const mat = new MeshBasicNodeMaterial();
    if (options?.color !== undefined)
      mat.color = new THREE.Color(options.color);
    if (options?.map !== undefined && options.map !== null) {
      // Following Three.js WebGPU RTT example: direct texture() call without Fn() wrapper
      mat.colorNode = tslTexture(options.map);
    }
    if (options?.side !== undefined) mat.side = options.side;
    if (options?.wireframe !== undefined) mat.wireframe = options.wireframe;
    if (options?.transparent !== undefined)
      mat.transparent = options.transparent;
    return mat;
  }

  /**
   * Initialize WebGPU renderer
   */
  private async initRenderer(container: HTMLElement): Promise<void> {
    if (!navigator.gpu) {
      throw new Error("WebGPU is required");
    }

    console.log("[ImpostorViewer] Initializing WebGPU renderer...");
    const webgpuRenderer = new THREE_WEBGPU.WebGPURenderer({
      antialias: true,
    });
    await webgpuRenderer.init();
    webgpuRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    webgpuRenderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer = webgpuRenderer;
    this.isWebGPU = true;
    console.log("[ImpostorViewer] WebGPU renderer initialized");

    container.appendChild(this.renderer.domElement);
  }

  /**
   * Complete initialization after renderer is ready
   */
  private async completeInitialization(container: HTMLElement): Promise<void> {
    // Setup controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);

    // Create impostor system - works with both WebGL and WebGPU renderers
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.impostor = new OctahedralImpostor(this.renderer as any);

    // Create atlas render target - following Three.js WebGPU RTT example pattern
    this.atlasRenderTarget = new THREE_WEBGPU.RenderTarget(
      this.atlasWidth,
      this.atlasHeight,
    );
    this.atlasRenderTarget.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.atlasRenderTarget.texture.wrapT = THREE.ClampToEdgeWrapping;

    // Create atlas plane
    const atlasPlaneGeo = new THREE.PlaneGeometry(1, 1);
    const atlasPlaneMat = this.createBasicMaterial({
      map: this.atlasRenderTarget.texture,
      side: THREE.DoubleSide,
    });
    this.atlasPlaneMesh = new THREE.Mesh(atlasPlaneGeo, atlasPlaneMat);
    this.atlasPlaneMesh.position.set(0, 1.5, 0);
    this.scene.add(this.atlasPlaneMesh);

    // Create debug intersection point
    const debugMat = this.createBasicMaterial({ color: "white" });
    this.intersectDebug = new THREE.Mesh(
      new THREE.SphereGeometry(0.01),
      debugMat,
    );
    this.scene.add(this.intersectDebug);

    // Set up resize handler
    window.addEventListener("resize", this.handleResize);

    // Use ResizeObserver to detect when container gets valid dimensions
    this.resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          this.handleResize();
        }
      }
    });
    this.resizeObserver.observe(container);

    // Initialize UI
    if (this.config.showDebugUI) {
      this.setupUI();
    }

    // Setup file upload (drag & drop + file input)
    this.setupFileUpload();

    // Load default mesh (await for WebGPU async baking)
    await this.setSourceMesh(createColoredCube());

    // Mark as initialized
    this.isInitialized = true;

    // Start animation
    this.animate();

    // Trigger initial resize check after first frame
    requestAnimationFrame(() => this.handleResize());
  }

  /**
   * Setup drag & drop and file input for 3D mesh upload
   */
  private setupFileUpload(): void {
    const { container } = this.config;

    // Create hidden file input
    this.fileInput = document.createElement("input");
    this.fileInput.type = "file";
    this.fileInput.accept = ".glb,.gltf";
    this.fileInput.style.display = "none";
    container.appendChild(this.fileInput);

    this.fileInput.addEventListener("change", (e) => {
      const target = e.target as HTMLInputElement;
      const file = target.files?.[0];
      if (file) {
        this.loadMeshFromFile(file);
      }
    });

    // Create drop overlay
    this.dropOverlay = document.createElement("div");
    this.dropOverlay.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 100, 200, 0.5);
      display: none;
      align-items: center;
      justify-content: center;
      font-family: sans-serif;
      font-size: 24px;
      color: white;
      pointer-events: none;
      z-index: 1000;
    `;
    this.dropOverlay.textContent = "Drop GLB/GLTF file here";

    // Make container position relative for overlay positioning
    if (getComputedStyle(container).position === "static") {
      container.style.position = "relative";
    }
    container.appendChild(this.dropOverlay);

    // Drag & drop handlers
    container.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.dropOverlay) {
        this.dropOverlay.style.display = "flex";
      }
    });

    container.addEventListener("dragleave", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.dropOverlay) {
        this.dropOverlay.style.display = "none";
      }
    });

    container.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.dropOverlay) {
        this.dropOverlay.style.display = "none";
      }

      const file = e.dataTransfer?.files[0];
      if (file && (file.name.endsWith(".glb") || file.name.endsWith(".gltf"))) {
        this.loadMeshFromFile(file);
      }
    });
  }

  /**
   * Open file picker dialog for mesh upload
   */
  openFilePicker(): void {
    this.fileInput?.click();
  }

  /**
   * Load a 3D mesh from a File object
   */
  loadMeshFromFile(file: File): void {
    const url = URL.createObjectURL(file);
    console.log(`[ImpostorViewer] Loading: ${file.name}`);

    this.gltfLoader.load(
      url,
      (gltf) => {
        URL.revokeObjectURL(url);
        console.log(`[ImpostorViewer] Loaded: ${file.name}`);
        void this.setSourceMesh(gltf.scene);
      },
      (progress) => {
        if (progress.total > 0) {
          const percent = Math.round((progress.loaded / progress.total) * 100);
          console.log(`[ImpostorViewer] Loading ${file.name}: ${percent}%`);
        }
      },
      (error) => {
        URL.revokeObjectURL(url);
        console.error(`[ImpostorViewer] Failed to load ${file.name}:`, error);
      },
    );
  }

  /**
   * Load a 3D mesh from a URL
   */
  loadMeshFromURL(url: string): void {
    console.log(`[ImpostorViewer] Loading from URL: ${url}`);

    this.gltfLoader.load(
      url,
      (gltf) => {
        console.log(`[ImpostorViewer] Loaded from URL: ${url}`);
        void this.setSourceMesh(gltf.scene);
      },
      (progress) => {
        if (progress.total > 0) {
          const percent = Math.round((progress.loaded / progress.total) * 100);
          console.log(`[ImpostorViewer] Loading: ${percent}%`);
        }
      },
      (error) => {
        console.error(`[ImpostorViewer] Failed to load from URL:`, error);
      },
    );
  }

  /**
   * Set the source mesh to create impostor from
   */
  async setSourceMesh(mesh: THREE.Mesh | THREE.Group): Promise<void> {
    // Remove old mesh
    if (this.sourceMesh) {
      this.scene.remove(this.sourceMesh);
    }

    this.sourceMesh = mesh;
    await this.generate();
  }

  /**
   * Generate/regenerate the impostor
   *
   * Convention:
   * - gridSizeX/Y represents the number of points/cells per axis
   * - Points are at grid corners (not cell centers) to match shader sampling
   */
  async generate(): Promise<void> {
    if (!this.sourceMesh) return;

    this.cleanup();

    // Build octahedron meshes (supports non-square grids)
    // Use corner points (useCellCenters=false) to match original behavior
    this.fullOct = buildOctahedronMesh(
      OctahedronType.FULL,
      this.gridSizeX,
      this.gridSizeY,
      [-1.5, 0, 0],
      false,
    );
    this.hemiOct = buildOctahedronMesh(
      OctahedronType.HEMI,
      this.gridSizeX,
      this.gridSizeY,
      [0, 0, 0],
      false,
    );

    // Offset for display
    [
      this.fullOct.filledMesh,
      this.fullOct.wireframeMesh,
      this.hemiOct.filledMesh,
      this.hemiOct.wireframeMesh,
    ].forEach((mesh) => {
      mesh.position.x -= 3.0;
    });

    this.scene.add(this.fullOct.filledMesh, this.fullOct.wireframeMesh);
    this.scene.add(this.hemiOct.filledMesh, this.hemiOct.wireframeMesh);

    // Apply lerp
    lerpOctahedronGeometry(this.fullOct, this.debugState.octahedronLerp);
    lerpOctahedronGeometry(this.hemiOct, this.debugState.octahedronLerp);

    // Compute bounding sphere for source mesh
    this.boundingSphere = new THREE.Sphere();
    const tempSphere = new THREE.Sphere();
    this.sourceMesh.traverse((node) => {
      if (node instanceof THREE.Mesh && node.geometry) {
        node.geometry.computeBoundingSphere();
        if (node.geometry.boundingSphere) {
          const center = node.geometry.boundingSphere.center.clone();
          node.geometry.translate(-center.x, -center.y, -center.z);
          node.position.add(center);
          tempSphere.copy(node.geometry.boundingSphere);
          this.boundingSphere.union(tempSphere);
        }
      }
    });
    this.sourceMesh.position.copy(this.boundingSphere.center);

    // Bake impostor (async for WebGPU renderAsync support)
    const activeOct =
      this.octType === OctahedronType.HEMI ? this.hemiOct : this.fullOct;
    await this.populateAtlas(activeOct);

    // Create debug visualization
    this.createDebugVisualization();

    // Create impostor mesh
    this.createImpostorMesh();
  }

  private async populateAtlas(_oct: OctahedronMeshData): Promise<void> {
    if (!this.sourceMesh) return;

    // Use the AAA baker for full quality impostor baking
    // This bakes albedo, normals, depth, and optionally PBR channels
    console.log(`[ImpostorViewer] Baking with mode: ${this.pbrMode}`);

    // Reset source mesh scale (baker handles scaling internally)
    this.sourceMesh.scale.setScalar(1);

    // Use the appropriate bake method based on PBR mode
    // All bake methods are async for WebGPU renderAsync() support
    if (this.pbrMode === PBRBakeMode.BASIC) {
      // Basic: just albedo (uses legacy bake)
      this.bakeResult = await this.impostor.bake(this.sourceMesh, {
        atlasWidth: this.atlasWidth,
        atlasHeight: this.atlasHeight,
        gridSizeX: this.gridSizeX,
        gridSizeY: this.gridSizeY,
        octType: this.octType,
      });
    } else if (this.pbrMode === PBRBakeMode.STANDARD) {
      // Standard: albedo + normals
      this.bakeResult = await this.impostor.bakeWithNormals(this.sourceMesh, {
        atlasWidth: this.atlasWidth,
        atlasHeight: this.atlasHeight,
        gridSizeX: this.gridSizeX,
        gridSizeY: this.gridSizeY,
        octType: this.octType,
      });
    } else {
      // FULL or COMPLETE: albedo + normals + depth (+ PBR)
      this.bakeResult = await this.impostor.bakeFull(this.sourceMesh, {
        atlasWidth: this.atlasWidth,
        atlasHeight: this.atlasHeight,
        gridSizeX: this.gridSizeX,
        gridSizeY: this.gridSizeY,
        octType: this.octType,
        pbrMode: this.pbrMode,
      });
    }

    // Update the atlas render target with the baked texture
    if (this.bakeResult.renderTarget) {
      if (this.atlasPlaneMesh) {
        const oldMat = this.atlasPlaneMesh.material as BasicMaterial;
        oldMat.dispose();

        // Use the texture directly - DON'T modify StorageTexture properties after compute!
        // The baker returns a StorageTexture that's ready to use as-is
        const rt = this.bakeResult.renderTarget;
        const newMat = this.createBasicMaterial({
          map: rt.texture,
          side: THREE.DoubleSide,
        });
        this.atlasPlaneMesh.material = newMat;

        console.log("[populateAtlas] Atlas RT:", rt.width, "x", rt.height);
      }
    }

    // Create/update normal atlas preview plane
    if (this.bakeResult.normalRenderTarget) {
      if (this.normalAtlasPlane) {
        this.scene.remove(this.normalAtlasPlane);
        (this.normalAtlasPlane.material as BasicMaterial).dispose();
        this.normalAtlasPlane.geometry.dispose();
      }
      const geo = new THREE.PlaneGeometry(0.5, 0.5);
      const normalRT = this.bakeResult.normalRenderTarget;
      // Don't modify texture properties - use as-is from baker
      const mat = this.createBasicMaterial({
        map: normalRT.texture,
        side: THREE.DoubleSide,
      });
      this.normalAtlasPlane = new THREE.Mesh(geo, mat);
      this.normalAtlasPlane.position.set(-0.8, 1.5, 0);
      this.scene.add(this.normalAtlasPlane);
    }

    // Create/update depth atlas preview plane
    if (this.bakeResult.depthRenderTarget) {
      if (this.depthAtlasPlane) {
        this.scene.remove(this.depthAtlasPlane);
        (this.depthAtlasPlane.material as BasicMaterial).dispose();
        this.depthAtlasPlane.geometry.dispose();
      }
      const geo = new THREE.PlaneGeometry(0.5, 0.5);
      const depthRT = this.bakeResult.depthRenderTarget;
      // Don't modify texture properties - use as-is from baker
      const mat = this.createBasicMaterial({
        map: depthRT.texture,
        side: THREE.DoubleSide,
      });
      this.depthAtlasPlane = new THREE.Mesh(geo, mat);
      this.depthAtlasPlane.position.set(0.8, 1.5, 0);
      this.scene.add(this.depthAtlasPlane);
    }

    // Update atlas plane scale
    if (this.atlasPlaneMesh) {
      const scale = 1 + 1 / Math.max(this.gridSizeX, this.gridSizeY);
      this.atlasPlaneMesh.scale.setScalar(scale);
    }

    // Store bounding sphere from bake result
    if (this.bakeResult.boundingSphere) {
      this.boundingSphere.copy(this.bakeResult.boundingSphere);
    }

    // Add source mesh to main scene
    if (this.sourceMesh) {
      this.sourceMesh.visible = this.debugState.showTarget;
      this.scene.add(this.sourceMesh);
    }

    console.log(
      `[ImpostorViewer] Bake complete: albedo=${!!this.bakeResult.atlasTexture}, normal=${!!this.bakeResult.normalAtlasTexture}, depth=${!!this.bakeResult.depthAtlasTexture}`,
    );
  }

  private createDebugVisualization(): void {
    const oct =
      this.octType === OctahedronType.HEMI ? this.hemiOct! : this.fullOct!;
    const offset = new THREE.Vector3(
      this.octType === OctahedronType.HEMI ? 0 : -1.5,
      0,
      0,
    );

    // Grid on mesh (clone and reposition)
    // IMPORTANT: Use filledMesh for raycasting (has triangle indices for face/barycoord)
    // wireframeMesh is LineSegments which doesn't support face raycasting
    this.gridOnMesh = oct.filledMesh.clone() as THREE.Mesh;
    this.gridOnMesh.position.x = 0;
    this.gridOnMesh.visible = this.debugState.octahedronQuads;
    this.scene.add(this.gridOnMesh);

    // Atlas grid overlay (supports non-square)
    // gridSize points requires passing (gridSize - 1) to buildOctahedronMesh
    const atlasOverlay = buildOctahedronMesh(
      this.octType,
      this.gridSizeX,
      this.gridSizeY,
      [0, 0, 0],
      true,
    );
    this.atlasGridOverlay = atlasOverlay.wireframeMesh;
    this.atlasGridOverlay.position.set(0, 1.5, 0);
    this.atlasGridOverlay.rotation.x = (3 * Math.PI) / 2;
    this.atlasGridOverlay.visible = this.debugState.atlasQuads;
    this.scene.add(this.atlasGridOverlay);

    // Sample points
    const sampleColors = generateHSLGradientColors(oct.octPoints.length);
    const avgGridSize = (this.gridSizeX + this.gridSizeY) / 2;
    const dynamicFontSize = Math.max(
      0.005,
      mapLinear(avgGridSize, 4, 24, 0.03, 0.005),
    );

    for (let i = 0; i < oct.octPoints.length; i += 3) {
      // Sphere on octahedron
      const sphereMat = this.createBasicMaterial({ color: sampleColors[i] });
      const sphereOnMesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.01, 16, 16),
        sphereMat,
      );
      sphereOnMesh.position.set(
        oct.octPoints[i],
        oct.octPoints[i + 1],
        oct.octPoints[i + 2],
      );
      sphereOnMesh.position.add(offset);
      sphereOnMesh.visible = this.debugState.octahedronSamples;
      this.scene.add(sphereOnMesh);
      this.samplePointsOnMesh.push(sphereOnMesh);

      // Sphere on atlas
      const rotMat = new THREE.Matrix4().makeRotationX((3 * Math.PI) / 2);
      const pos = new THREE.Vector3(
        oct.planePoints[i],
        oct.planePoints[i + 1],
        oct.planePoints[i + 2],
      );
      pos.applyMatrix4(rotMat);
      pos.y += 1.5;

      const atlasSphereMat = this.createBasicMaterial({
        color: sampleColors[i],
      });
      const sphereOnAtlas = new THREE.Mesh(
        new THREE.SphereGeometry(0.01, 16, 16),
        atlasSphereMat,
      );
      sphereOnAtlas.position.copy(pos);
      sphereOnAtlas.visible = this.debugState.atlasSamples;
      this.scene.add(sphereOnAtlas);
      this.samplePointsOnAtlas.push(sphereOnAtlas);

      // Number labels on mesh
      const numberOnMesh = new Text();
      numberOnMesh.text = `${i / 3}`;
      numberOnMesh.fontSize = dynamicFontSize;
      numberOnMesh.position.set(
        oct.octPoints[i],
        oct.octPoints[i + 1],
        oct.octPoints[i + 2] + 0.01,
      );
      numberOnMesh.position.add(offset);
      numberOnMesh.color = 0x000000;
      numberOnMesh.visible = this.debugState.octahedronNumbers;
      numberOnMesh.sync();
      this.scene.add(numberOnMesh);
      this.numbersOnMesh.push(numberOnMesh);

      // Number labels on atlas
      const numberOnAtlas = new Text();
      numberOnAtlas.text = `${i / 3}`;
      numberOnAtlas.fontSize = dynamicFontSize;
      numberOnAtlas.position.copy(pos);
      numberOnAtlas.position.z += 0.01;
      numberOnAtlas.color = 0x666666;
      numberOnAtlas.visible = this.debugState.atlasNumbers;
      numberOnAtlas.sync();
      this.scene.add(numberOnAtlas);
      this.numbersOnAtlas.push(numberOnAtlas);
    }
  }

  private createImpostorMesh(): void {
    if (!this.bakeResult) {
      console.warn(
        "[ImpostorViewer] No bake result available for impostor mesh",
      );
      return;
    }

    // Create TSL material for WebGPU
    console.log("[ImpostorViewer] Creating TSL material...");

    this.impostorMaterial = createTSLImpostorMaterial({
      atlasTexture: this.bakeResult.atlasTexture,
      normalAtlasTexture: this.bakeResult.normalAtlasTexture,
      depthAtlasTexture: this.bakeResult.depthAtlasTexture,
      pbrAtlasTexture: this.bakeResult.pbrAtlasTexture,
      gridSizeX: this.gridSizeX,
      gridSizeY: this.gridSizeY,
      enableAAA: !!this.bakeResult.normalAtlasTexture,
      enableDepthBlending: !!this.bakeResult.depthAtlasTexture,
      enableSpecular: !!this.bakeResult.normalAtlasTexture,
      depthNear: this.bakeResult.depthNear ?? 0.001,
      depthFar: this.bakeResult.depthFar ?? 10,
    });

    // Set default lighting
    const tslMat = this.impostorMaterial as TSLImpostorMaterial;
    if (
      tslMat.updateLighting &&
      (this.bakeResult.normalAtlasTexture || this.bakeResult.depthAtlasTexture)
    ) {
      tslMat.updateLighting({
        ambientColor: new THREE.Vector3(1, 1, 1),
        ambientIntensity: 0.4,
        directionalLights: [
          {
            direction: new THREE.Vector3(0.5, 0.8, 0.3).normalize(),
            color: new THREE.Vector3(1, 0.98, 0.95),
            intensity: 1.2,
          },
        ],
        specular: {
          shininess: 32,
          intensity: 0.5,
        },
      });
    }

    this.impostorMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      this.impostorMaterial,
    );
    this.impostorMesh.position.z = 2;
    this.scene.add(this.impostorMesh);

    const wireframeMat = this.createBasicMaterial({
      wireframe: true,
      color: "red",
    });
    this.wireframeMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      wireframeMat,
    );
    this.wireframeMesh.position.z = 2;
    this.wireframeMesh.visible = this.debugState.showWireframe;
    this.scene.add(this.wireframeMesh);

    console.log(
      `[ImpostorViewer] Created ${this.isWebGPU ? "WebGPU/TSL" : "WebGL/GLSL"} impostor mesh`,
      {
        hasAtlas: !!this.bakeResult.atlasTexture,
        hasNormals: !!this.bakeResult.normalAtlasTexture,
        hasDepth: !!this.bakeResult.depthAtlasTexture,
        gridSize: `${this.gridSizeX}x${this.gridSizeY}`,
        meshPosition: this.impostorMesh?.position.toArray(),
        meshVisible: this.impostorMesh?.visible,
      },
    );
  }

  private cleanup(): void {
    // Clear atlas (cast for type compatibility - works with both WebGL and WebGPU)
    this.renderer.setRenderTarget(
      this.atlasRenderTarget as THREE.WebGLRenderTarget,
    );
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear();
    this.renderer.setRenderTarget(null);

    // Remove octahedron meshes
    if (this.fullOct) {
      this.scene.remove(this.fullOct.filledMesh, this.fullOct.wireframeMesh);
    }
    if (this.hemiOct) {
      this.scene.remove(this.hemiOct.filledMesh, this.hemiOct.wireframeMesh);
    }

    // Remove debug objects
    this.samplePointsOnMesh.forEach((mesh) => {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
    });
    this.samplePointsOnMesh = [];

    this.samplePointsOnAtlas.forEach((mesh) => {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
    });
    this.samplePointsOnAtlas = [];

    this.numbersOnMesh.forEach((text) => {
      this.scene.remove(text);
      const textWithDispose = text as unknown as { dispose?: () => void };
      if (textWithDispose.dispose) {
        textWithDispose.dispose();
      }
    });
    this.numbersOnMesh = [];

    this.numbersOnAtlas.forEach((text) => {
      this.scene.remove(text);
      const textWithDispose = text as unknown as { dispose?: () => void };
      if (textWithDispose.dispose) {
        textWithDispose.dispose();
      }
    });
    this.numbersOnAtlas = [];

    if (this.gridOnMesh) {
      this.scene.remove(this.gridOnMesh);
      this.gridOnMesh = null;
    }

    if (this.atlasGridOverlay) {
      this.scene.remove(this.atlasGridOverlay);
      this.atlasGridOverlay = null;
    }

    if (this.impostorMesh) {
      this.scene.remove(this.impostorMesh);
      this.impostorMesh.geometry.dispose();
      this.impostorMesh = null;
    }

    if (this.wireframeMesh) {
      this.scene.remove(this.wireframeMesh);
      this.wireframeMesh.geometry.dispose();
      this.wireframeMesh = null;
    }

    // Clean up atlas preview planes
    if (this.normalAtlasPlane) {
      this.scene.remove(this.normalAtlasPlane);
      this.normalAtlasPlane.geometry.dispose();
      (this.normalAtlasPlane.material as THREE.Material).dispose();
      this.normalAtlasPlane = null;
    }

    if (this.depthAtlasPlane) {
      this.scene.remove(this.depthAtlasPlane);
      this.depthAtlasPlane.geometry.dispose();
      (this.depthAtlasPlane.material as THREE.Material).dispose();
      this.depthAtlasPlane = null;
    }

    // Dispose bake result render targets
    if (this.bakeResult) {
      this.bakeResult.renderTarget?.dispose();
      this.bakeResult.normalRenderTarget?.dispose();
      this.bakeResult.depthRenderTarget?.dispose();
      this.bakeResult.pbrRenderTarget?.dispose();
      this.bakeResult = null;
    }

    if (this.sourceMesh) {
      this.scene.remove(this.sourceMesh);
    }
  }

  private setupUI(): void {
    this.pane = new Pane({ title: "Impostor Baking" });

    // Renderer info (read-only display)
    const rendererParams = { renderer: this.rendererType };
    this.pane.addBinding(rendererParams, "renderer", {
      label: "Renderer",
      readonly: true,
    });

    // Add WebGPU status indicator
    const gpuStatus = navigator.gpu ? "Available" : "Not Supported";
    this.pane.addBlade({
      view: "text",
      label: "WebGPU",
      parse: (v: string) => v,
      value: gpuStatus,
    });

    // Debug folder
    const debugFolder = this.pane.addFolder({ title: "Debug", expanded: true });

    // Atlas debug
    const atlasDebugFolder = debugFolder.addFolder({
      title: "Atlas Debug",
      expanded: true,
    });
    atlasDebugFolder
      .addBinding(this.debugState, "atlasQuads", { label: "quads" })
      .on("change", ({ value }) => {
        if (this.atlasGridOverlay) this.atlasGridOverlay.visible = value;
      });
    atlasDebugFolder
      .addBinding(this.debugState, "atlasNumbers", { label: "numbers" })
      .on("change", ({ value }) => {
        this.numbersOnAtlas.forEach((t) => (t.visible = value));
      });
    atlasDebugFolder
      .addBinding(this.debugState, "atlasSamples", { label: "samples" })
      .on("change", ({ value }) => {
        this.samplePointsOnAtlas.forEach((m) => (m.visible = value));
      });

    // Octahedron debug
    const octFolder = debugFolder.addFolder({
      title: "Octahedron Debug",
      expanded: true,
    });
    octFolder
      .addBinding(this.debugState, "octahedronQuads", { label: "quads" })
      .on("change", ({ value }) => {
        if (this.gridOnMesh) this.gridOnMesh.visible = value;
      });
    octFolder
      .addBinding(this.debugState, "showTarget", { label: "target" })
      .on("change", ({ value }) => {
        if (this.sourceMesh) this.sourceMesh.visible = value;
      });
    octFolder
      .addBinding(this.debugState, "octahedronNumbers", { label: "numbers" })
      .on("change", ({ value }) => {
        this.numbersOnMesh.forEach((t) => (t.visible = value));
      });
    octFolder
      .addBinding(this.debugState, "octahedronSamples", { label: "samples" })
      .on("change", ({ value }) => {
        this.samplePointsOnMesh.forEach((m) => (m.visible = value));
      });
    octFolder
      .addBinding(this.debugState, "octahedronLerp", {
        label: "lerp",
        min: 0,
        max: 1,
      })
      .on("change", ({ value }) => {
        if (this.hemiOct) lerpOctahedronGeometry(this.hemiOct, value);
        if (this.fullOct) lerpOctahedronGeometry(this.fullOct, value);
      });

    // Impostor debug
    const impostorFolder = debugFolder.addFolder({
      title: "Impostor Debug",
      expanded: true,
    });
    impostorFolder
      .addBinding(this.debugState, "showWireframe", { label: "wireframe" })
      .on("change", ({ value }) => {
        if (this.wireframeMesh) this.wireframeMesh.visible = value;
      });

    // General settings
    const generalFolder = this.pane.addFolder({
      title: "General",
      expanded: true,
    });

    const params = {
      atlasWidth: this.atlasWidth,
      atlasHeight: this.atlasHeight,
      gridSizeX: this.gridSizeX,
      gridSizeY: this.gridSizeY,
      octType: this.octType,
    };

    // Atlas dimensions
    const atlasFolder = generalFolder.addFolder({
      title: "Atlas Size",
      expanded: false,
    });
    atlasFolder
      .addBinding(params, "atlasWidth", {
        label: "Width",
        options: {
          "128": 128,
          "256": 256,
          "512": 512,
          "1024": 1024,
          "2048": 2048,
          "4096": 4096,
        },
      })
      .on("change", ({ value }) => {
        this.atlasWidth = value;
        this.atlasRenderTarget.setSize(this.atlasWidth, this.atlasHeight);
        void this.generate();
      });
    atlasFolder
      .addBinding(params, "atlasHeight", {
        label: "Height",
        options: {
          "128": 128,
          "256": 256,
          "512": 512,
          "1024": 1024,
          "2048": 2048,
          "4096": 4096,
        },
      })
      .on("change", ({ value }) => {
        this.atlasHeight = value;
        this.atlasRenderTarget.setSize(this.atlasWidth, this.atlasHeight);
        void this.generate();
      });

    // Grid dimensions (separate horizontal/vertical)
    const gridFolder = generalFolder.addFolder({
      title: "Grid Size",
      expanded: true,
    });
    gridFolder
      .addBinding(params, "gridSizeX", {
        label: "Horizontal",
        min: 3,
        max: 64,
        step: 1,
      })
      .on("change", ({ value }) => {
        this.gridSizeX = value;
      });
    gridFolder
      .addBinding(params, "gridSizeY", {
        label: "Vertical",
        min: 3,
        max: 64,
        step: 1,
      })
      .on("change", ({ value }) => {
        this.gridSizeY = value;
      });

    generalFolder
      .addBinding(params, "octType", {
        options: {
          Hemisphere: OctahedronType.HEMI,
          "Full Sphere": OctahedronType.FULL,
        },
      })
      .on("change", ({ value }) => {
        this.octType = value;
        void this.generate();
      });

    // Bake mode selector
    const bakeParams = { pbrMode: this.pbrMode };
    generalFolder
      .addBinding(bakeParams, "pbrMode", {
        label: "Bake Mode",
        options: {
          "Basic (Color only)": PBRBakeMode.BASIC,
          "Standard (+ Normals)": PBRBakeMode.STANDARD,
          "Full (+ Depth)": PBRBakeMode.FULL,
          "Complete (+ PBR)": PBRBakeMode.COMPLETE,
        },
      })
      .on("change", ({ value }) => {
        this.pbrMode = value;
        void this.generate();
      });

    generalFolder
      .addButton({ title: "Re-Generate" })
      .on("click", () => void this.generate());

    // Lighting controls (only shown for AAA modes)
    const lightingFolder = this.pane.addFolder({
      title: "Lighting",
      expanded: false,
    });
    const lightingParams = {
      ambientIntensity: 0.4,
      lightIntensity: 1.2,
      specularIntensity: 0.5,
      specularShininess: 32,
    };

    // Helper to update lighting for either material type
    const updateLighting = (
      config: Parameters<typeof updateImpostorAAALighting>[1],
    ) => {
      if (!this.impostorMaterial || !this.bakeResult?.normalAtlasTexture)
        return;

      if (this.isWebGPU) {
        // TSL material
        const tslMat = this.impostorMaterial as TSLImpostorMaterial;
        if (tslMat.updateLighting) {
          tslMat.updateLighting(config);
        }
      } else {
        // GLSL material
        updateImpostorAAALighting(
          this.impostorMaterial as THREE.ShaderMaterial,
          config,
        );
      }
    };

    lightingFolder
      .addBinding(lightingParams, "ambientIntensity", {
        min: 0,
        max: 2,
        step: 0.1,
      })
      .on("change", ({ value }) => {
        updateLighting({ ambientIntensity: value });
      });
    lightingFolder
      .addBinding(lightingParams, "lightIntensity", {
        min: 0,
        max: 3,
        step: 0.1,
      })
      .on("change", ({ value }) => {
        updateLighting({
          directionalLights: [
            {
              direction: new THREE.Vector3(0.5, 0.8, 0.3).normalize(),
              color: new THREE.Vector3(1, 0.98, 0.95),
              intensity: value,
            },
          ],
        });
      });
    lightingFolder
      .addBinding(lightingParams, "specularIntensity", {
        min: 0,
        max: 2,
        step: 0.1,
      })
      .on("change", ({ value }) => {
        updateLighting({ specular: { intensity: value } });
      });
    lightingFolder
      .addBinding(lightingParams, "specularShininess", {
        min: 4,
        max: 256,
        step: 4,
      })
      .on("change", ({ value }) => {
        updateLighting({ specular: { shininess: value } });
      });

    // Upload
    const uploadFolder = this.pane.addFolder({
      title: "Upload Mesh",
      expanded: true,
    });
    uploadFolder
      .addButton({ title: "Upload GLB/GLTF" })
      .on("click", () => this.openFilePicker());

    // Export
    const exportFolder = this.pane.addFolder({
      title: "Export",
      expanded: true,
    });
    exportFolder
      .addButton({ title: "Download Atlas (PNG)" })
      .on("click", () => this.downloadAtlas("png"));
    exportFolder
      .addButton({ title: "Download Atlas (JPEG)" })
      .on("click", () => this.downloadAtlas("jpeg"));
  }

  private downloadAtlas(format: "png" | "jpeg" = "png"): void {
    if (this.atlasRenderTarget) {
      const dataUrl = this.exportAtlasDataURL(format);
      const link = document.createElement("a");
      link.download = `impostor-atlas.${format}`;
      link.href = dataUrl;
      link.click();
      console.log(`[ImpostorViewer] Atlas exported as ${format.toUpperCase()}`);
    }
  }

  /**
   * Export the current atlas as a data URL
   * Note: Works with both WebGL and WebGPU, but uses the bake result render target
   */
  exportAtlasDataURL(format: "png" | "jpeg" = "png"): string {
    // Use the bake result's render target (always WebGL-based) for export
    const renderTarget =
      this.bakeResult?.renderTarget ?? this.atlasRenderTarget;
    const width = renderTarget.width;
    const height = renderTarget.height;
    const pixels = new Uint8Array(width * height * 4);

    // Use the impostor's internal WebGL renderer for reading (works in both modes)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bakingRenderer = (this.impostor as any)
      .renderer as THREE.WebGLRenderer;
    if (bakingRenderer && bakingRenderer.readRenderTargetPixels) {
      bakingRenderer.readRenderTargetPixels(
        renderTarget as THREE.WebGLRenderTarget,
        0,
        0,
        width,
        height,
        pixels,
      );
    } else if (!this.isWebGPU && this.renderer instanceof THREE.WebGLRenderer) {
      // Fallback for WebGL mode
      this.renderer.readRenderTargetPixels(
        this.atlasRenderTarget as THREE.WebGLRenderTarget,
        0,
        0,
        width,
        height,
        pixels,
      );
    } else {
      console.warn(
        "[ImpostorViewer] Cannot export atlas - no compatible renderer available",
      );
      return "";
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d")!;
    const imageData = ctx.createImageData(width, height);

    // Flip Y
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const srcIdx = ((height - y - 1) * width + x) * 4;
        const dstIdx = (y * width + x) * 4;
        imageData.data[dstIdx] = pixels[srcIdx];
        imageData.data[dstIdx + 1] = pixels[srcIdx + 1];
        imageData.data[dstIdx + 2] = pixels[srcIdx + 2];
        imageData.data[dstIdx + 3] = pixels[srcIdx + 3];
      }
    }

    ctx.putImageData(imageData, 0, 0);
    return canvas.toDataURL(
      `image/${format}`,
      format === "jpeg" ? 0.9 : undefined,
    );
  }

  /**
   * Export the current atlas as a Blob
   */
  async exportAtlasAsBlob(format: "png" | "jpeg" = "png"): Promise<Blob> {
    const dataUrl = this.exportAtlasDataURL(format);
    if (!dataUrl) {
      throw new Error("Failed to export atlas");
    }
    const response = await fetch(dataUrl);
    return response.blob();
  }

  private raycastMeshToFindViewDirection(): void {
    if (!this.gridOnMesh) return;

    this.raycaster.ray.origin.copy(this.camera.position);
    this.raycaster.ray.direction
      .subVectors(this.gridOnMesh.position, this.camera.position)
      .normalize();

    const intersects = this.raycaster.intersectObject(this.gridOnMesh);
    if (intersects.length > 0) {
      const hit = intersects[0];
      if (hit.face && hit.barycoord) {
        this.currentFaceIndices.set(hit.face.a, hit.face.b, hit.face.c);
        this.currentFaceWeights.copy(hit.barycoord);
        if (this.intersectDebug) {
          this.intersectDebug.position.copy(hit.point);
        }
      }
    }
  }

  private animate = (): void => {
    this.animationId = requestAnimationFrame(this.animate);

    // Don't update if not fully initialized
    if (!this.isInitialized) return;

    this.controls.update();

    // Update sample point positions based on lerp
    const oct =
      this.octType === OctahedronType.HEMI ? this.hemiOct : this.fullOct;
    if (oct) {
      const t = this.debugState.octahedronLerp;
      this.samplePointsOnMesh.forEach((mesh, i) => {
        const x = t * oct.octPoints[i * 3] + (1 - t) * oct.planePoints[i * 3];
        const y =
          t * oct.octPoints[i * 3 + 1] + (1 - t) * oct.planePoints[i * 3 + 1];
        const z =
          t * oct.octPoints[i * 3 + 2] + (1 - t) * oct.planePoints[i * 3 + 2];
        mesh.position.set(x, y, z);
      });

      this.numbersOnMesh.forEach((text, i) => {
        const x = t * oct.octPoints[i * 3] + (1 - t) * oct.planePoints[i * 3];
        const y =
          t * oct.octPoints[i * 3 + 1] + (1 - t) * oct.planePoints[i * 3 + 1];
        const z =
          t * oct.octPoints[i * 3 + 2] + (1 - t) * oct.planePoints[i * 3 + 2];
        text.position.set(x, y, z);
        (text as { lookAt?: (pos: THREE.Vector3) => void }).lookAt?.(
          this.camera.position,
        );
      });
    }

    // Update impostor
    if (this.impostorMesh && this.impostorMaterial) {
      // Use proper view data update based on material type
      if (this.isWebGPU) {
        // TSL material
        const tslMat = this.impostorMaterial as TSLImpostorMaterial;
        tslMat.updateView(this.currentFaceIndices, this.currentFaceWeights);
      } else {
        // GLSL ShaderMaterial
        const viewData: ImpostorViewData = {
          faceIndices: this.currentFaceIndices,
          faceWeights: this.currentFaceWeights,
        };
        updateImpostorMaterial(
          this.impostorMaterial as THREE.ShaderMaterial,
          viewData,
        );
      }

      this.impostorMesh.lookAt(this.camera.position);

      if (this.wireframeMesh) {
        this.wireframeMesh.rotation.copy(this.impostorMesh.rotation);
      }
    }

    this.raycastMeshToFindViewDirection();
    this.renderer.render(this.scene, this.camera);
  };

  private handleResize = (): void => {
    const { container } = this.config;
    const width = container.clientWidth;
    const height = container.clientHeight;

    // Only update if dimensions are valid
    if (width > 0 && height > 0) {
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(width, height);
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    }
  };

  /**
   * Manually trigger resize (useful when container size changes programmatically)
   */
  resize(): void {
    this.handleResize();
  }

  /**
   * Dispose of all resources
   */
  dispose(): void {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
    }

    window.removeEventListener("resize", this.handleResize);

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    this.cleanup();
    this.impostor.dispose();
    this.atlasRenderTarget.dispose();
    this.renderer.dispose();

    if (this.pane) {
      this.pane.dispose();
    }

    // Clean up file upload elements
    if (this.fileInput) {
      this.fileInput.remove();
    }
    if (this.dropOverlay) {
      this.dropOverlay.remove();
    }
  }
}
