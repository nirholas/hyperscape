/**
 * EditorCameraSystem.ts - Camera Controls for Editor Mode
 *
 * Provides camera controls optimized for world editing:
 * - Orbital mode: Rotate around a focus point (for inspecting objects)
 * - Pan mode: Move the camera parallel to view plane
 * - Fly mode: Free-form camera movement (WASD + mouse)
 * - Zoom: Scroll wheel or pinch gesture
 *
 * This system uses THREE.js OrbitControls as the base but adds
 * editor-specific features like focus-on-selection and camera bookmarks.
 *
 * @module EditorCameraSystem
 */

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import {
  System,
  type SystemDependencies,
} from "../shared/infrastructure/System";
import type { World } from "../../core/World";
import type { WorldOptions } from "../../types";

/**
 * Camera mode for editor
 */
export type EditorCameraMode = "orbit" | "pan" | "fly";

/**
 * Camera bookmark for saving/restoring camera positions
 */
export interface CameraBookmark {
  name: string;
  position: THREE.Vector3;
  target: THREE.Vector3;
  zoom: number;
}

/**
 * Configuration for EditorCameraSystem
 */
export interface EditorCameraConfig {
  /** Initial camera mode */
  initialMode: EditorCameraMode;
  /** Enable damping/inertia for smooth camera movement */
  enableDamping: boolean;
  /** Damping factor (0-1, higher = more responsive) */
  dampingFactor: number;
  /** Minimum distance for orbit/zoom */
  minDistance: number;
  /** Maximum distance for orbit/zoom */
  maxDistance: number;
  /** Enable zoom */
  enableZoom: boolean;
  /** Enable pan */
  enablePan: boolean;
  /** Enable rotate */
  enableRotate: boolean;
  /** Pan speed multiplier */
  panSpeed: number;
  /** Rotate speed multiplier */
  rotateSpeed: number;
  /** Zoom speed multiplier */
  zoomSpeed: number;
  /** Fly mode movement speed (units per second) */
  flySpeed: number;
  /** Fly mode fast multiplier (when holding shift) */
  flyFastMultiplier: number;
}

const DEFAULT_CONFIG: EditorCameraConfig = {
  initialMode: "orbit",
  enableDamping: true,
  dampingFactor: 0.1,
  minDistance: 1,
  maxDistance: 2000,
  enableZoom: true,
  enablePan: true,
  enableRotate: true,
  panSpeed: 1.0,
  rotateSpeed: 1.0,
  zoomSpeed: 1.0,
  flySpeed: 50,
  flyFastMultiplier: 3,
};

/**
 * EditorCameraSystem - Camera controls for world editing
 *
 * Provides multiple camera modes and smooth controls for editing workflows.
 */
export class EditorCameraSystem extends System {
  private config: EditorCameraConfig;
  private controls: OrbitControls | null = null;
  private mode: EditorCameraMode = "orbit";
  private bookmarks: Map<string, CameraBookmark> = new Map();
  private domElement: HTMLElement | null = null;

  // Fly mode state
  private flyKeys = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    up: false,
    down: false,
    fast: false,
  };
  private flyDirection = new THREE.Vector3();

  // Reusable vectors for calculations
  private _tempVec3 = new THREE.Vector3();
  private _tempEuler = new THREE.Euler(0, 0, 0, "YXZ");

  constructor(world: World, config: Partial<EditorCameraConfig> = {}) {
    super(world);
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.mode = this.config.initialMode;
  }

  override getDependencies(): SystemDependencies {
    return {
      required: ["stage", "graphics"],
      optional: [],
    };
  }

  override async init(options: WorldOptions): Promise<void> {
    await super.init(options);

    // Get DOM element from graphics system
    const graphics = this.world.graphics;
    if (!graphics?.renderer?.domElement) {
      console.warn("[EditorCameraSystem] No renderer DOM element available");
      return;
    }

    this.domElement = graphics.renderer.domElement;
    this.setupOrbitControls();
    this.setupKeyboardListeners();
  }

  private setupOrbitControls(): void {
    if (!this.domElement) return;

    this.controls = new OrbitControls(this.world.camera, this.domElement);

    // Configure controls based on config
    this.controls.enableDamping = this.config.enableDamping;
    this.controls.dampingFactor = this.config.dampingFactor;
    this.controls.minDistance = this.config.minDistance;
    this.controls.maxDistance = this.config.maxDistance;
    this.controls.enableZoom = this.config.enableZoom;
    this.controls.enablePan = this.config.enablePan;
    this.controls.enableRotate = this.config.enableRotate;
    this.controls.panSpeed = this.config.panSpeed;
    this.controls.rotateSpeed = this.config.rotateSpeed;
    this.controls.zoomSpeed = this.config.zoomSpeed;

    // Set reasonable defaults for world editing
    this.controls.screenSpacePanning = true;
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.PAN,
    };

    // Set initial target to origin
    this.controls.target.set(0, 0, 0);

    // Position camera for a good initial view
    this.world.camera.position.set(50, 50, 50);
    this.controls.update();
  }

  private setupKeyboardListeners(): void {
    if (!this.domElement) return;

    // Make canvas focusable
    this.domElement.tabIndex = 0;

    this.domElement.addEventListener("keydown", this.onKeyDown);
    this.domElement.addEventListener("keyup", this.onKeyUp);
    this.domElement.addEventListener("blur", this.onBlur);
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    // Don't handle if focused on input
    if (
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement
    ) {
      return;
    }

    switch (event.code) {
      case "KeyW":
        this.flyKeys.forward = true;
        break;
      case "KeyS":
        this.flyKeys.backward = true;
        break;
      case "KeyA":
        this.flyKeys.left = true;
        break;
      case "KeyD":
        this.flyKeys.right = true;
        break;
      case "KeyQ":
      case "Space":
        this.flyKeys.up = true;
        break;
      case "KeyE":
      case "ControlLeft":
      case "ControlRight":
        this.flyKeys.down = true;
        break;
      case "ShiftLeft":
      case "ShiftRight":
        this.flyKeys.fast = true;
        break;
      // Mode switching shortcuts
      case "Digit1":
        this.setMode("orbit");
        break;
      case "Digit2":
        this.setMode("pan");
        break;
      case "Digit3":
        this.setMode("fly");
        break;
      // Focus on origin
      case "KeyF":
        if (event.shiftKey) {
          this.focusOn(new THREE.Vector3(0, 0, 0));
        }
        break;
    }
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    switch (event.code) {
      case "KeyW":
        this.flyKeys.forward = false;
        break;
      case "KeyS":
        this.flyKeys.backward = false;
        break;
      case "KeyA":
        this.flyKeys.left = false;
        break;
      case "KeyD":
        this.flyKeys.right = false;
        break;
      case "KeyQ":
      case "Space":
        this.flyKeys.up = false;
        break;
      case "KeyE":
      case "ControlLeft":
      case "ControlRight":
        this.flyKeys.down = false;
        break;
      case "ShiftLeft":
      case "ShiftRight":
        this.flyKeys.fast = false;
        break;
    }
  };

  private onBlur = (): void => {
    // Reset all fly keys when focus is lost
    const keys = this.flyKeys;
    keys.forward = keys.backward = keys.left = keys.right = false;
    keys.up = keys.down = keys.fast = false;
  };

  /**
   * Set the camera mode
   */
  setMode(mode: EditorCameraMode): void {
    this.mode = mode;

    if (this.controls) {
      switch (mode) {
        case "orbit":
          this.controls.enableRotate = true;
          this.controls.enablePan = true;
          this.controls.mouseButtons = {
            LEFT: THREE.MOUSE.ROTATE,
            MIDDLE: THREE.MOUSE.PAN,
            RIGHT: THREE.MOUSE.PAN,
          };
          break;
        case "pan":
          this.controls.enableRotate = false;
          this.controls.enablePan = true;
          this.controls.mouseButtons = {
            LEFT: THREE.MOUSE.PAN,
            MIDDLE: THREE.MOUSE.PAN,
            RIGHT: THREE.MOUSE.PAN,
          };
          break;
        case "fly":
          // In fly mode, we handle movement ourselves
          this.controls.enableRotate = true;
          this.controls.enablePan = false;
          this.controls.mouseButtons = {
            LEFT: THREE.MOUSE.ROTATE,
            MIDDLE: undefined as unknown as THREE.MOUSE,
            RIGHT: undefined as unknown as THREE.MOUSE,
          };
          break;
      }
    }

    this.emit("mode-changed", { mode });
  }

  /**
   * Get current camera mode
   */
  getMode(): EditorCameraMode {
    return this.mode;
  }

  /**
   * Focus camera on a specific point
   */
  focusOn(target: THREE.Vector3, distance?: number): void {
    if (!this.controls) return;

    // Calculate distance if not provided
    const focusDistance =
      distance ?? this.world.camera.position.distanceTo(target);
    const clampedDistance = THREE.MathUtils.clamp(
      focusDistance,
      this.config.minDistance,
      this.config.maxDistance,
    );

    // Animate to target (simple immediate move for now)
    this.controls.target.copy(target);

    // Position camera at appropriate distance
    const direction = this._tempVec3
      .copy(this.world.camera.position)
      .sub(target)
      .normalize();
    this.world.camera.position
      .copy(target)
      .addScaledVector(direction, clampedDistance);

    this.controls.update();
    this.emit("focus-changed", {
      target: target.clone(),
      distance: clampedDistance,
    });
  }

  /**
   * Focus camera on a bounding box
   */
  focusOnBounds(box: THREE.Box3, padding: number = 1.2): void {
    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    box.getCenter(center);
    box.getSize(size);

    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = this.world.camera.fov * (Math.PI / 180);
    const distance = (maxDim * padding) / (2 * Math.tan(fov / 2));

    this.focusOn(center, distance);
  }

  /**
   * Save current camera position as a bookmark
   */
  saveBookmark(name: string): void {
    const bookmark: CameraBookmark = {
      name,
      position: this.world.camera.position.clone(),
      target: this.controls?.target.clone() ?? new THREE.Vector3(),
      zoom: this.world.camera.zoom,
    };
    this.bookmarks.set(name, bookmark);
    this.emit("bookmark-saved", { bookmark });
  }

  /**
   * Load a camera bookmark
   */
  loadBookmark(name: string): boolean {
    const bookmark = this.bookmarks.get(name);
    if (!bookmark) return false;

    this.world.camera.position.copy(bookmark.position);
    this.world.camera.zoom = bookmark.zoom;
    this.world.camera.updateProjectionMatrix();

    if (this.controls) {
      this.controls.target.copy(bookmark.target);
      this.controls.update();
    }

    this.emit("bookmark-loaded", { bookmark });
    return true;
  }

  /**
   * Get all bookmarks
   */
  getBookmarks(): CameraBookmark[] {
    return Array.from(this.bookmarks.values());
  }

  /**
   * Delete a bookmark
   */
  deleteBookmark(name: string): boolean {
    const deleted = this.bookmarks.delete(name);
    if (deleted) {
      this.emit("bookmark-deleted", { name });
    }
    return deleted;
  }

  /**
   * Get the orbit controls instance for external customization
   */
  getControls(): OrbitControls | null {
    return this.controls;
  }

  /**
   * Get current camera target
   */
  getTarget(): THREE.Vector3 {
    return this.controls?.target.clone() ?? new THREE.Vector3();
  }

  /**
   * Set camera target without changing camera position
   */
  setTarget(target: THREE.Vector3): void {
    if (this.controls) {
      this.controls.target.copy(target);
      this.controls.update();
    }
  }

  override update(delta: number): void {
    if (!this.controls) return;

    // Handle fly mode movement
    if (this.mode === "fly") {
      this.updateFlyMode(delta);
    }

    // Always update orbit controls (handles damping)
    this.controls.update();
  }

  private updateFlyMode(delta: number): void {
    const speed = this.flyKeys.fast
      ? this.config.flySpeed * this.config.flyFastMultiplier
      : this.config.flySpeed;

    // Reset direction
    this.flyDirection.set(0, 0, 0);

    // Calculate movement direction based on camera orientation
    if (this.flyKeys.forward) this.flyDirection.z -= 1;
    if (this.flyKeys.backward) this.flyDirection.z += 1;
    if (this.flyKeys.left) this.flyDirection.x -= 1;
    if (this.flyKeys.right) this.flyDirection.x += 1;
    if (this.flyKeys.up) this.flyDirection.y += 1;
    if (this.flyKeys.down) this.flyDirection.y -= 1;

    // Normalize if moving diagonally
    if (this.flyDirection.lengthSq() > 0) {
      this.flyDirection.normalize();

      // Get camera rotation (Y-axis only for horizontal movement)
      this._tempEuler.setFromQuaternion(this.world.camera.quaternion, "YXZ");
      const yRotation = this._tempEuler.y;

      // Rotate horizontal movement by camera Y rotation
      const cos = Math.cos(yRotation);
      const sin = Math.sin(yRotation);
      const x = this.flyDirection.x * cos - this.flyDirection.z * sin;
      const z = this.flyDirection.x * sin + this.flyDirection.z * cos;

      // Apply movement
      const moveX = x * speed * delta;
      const moveY = this.flyDirection.y * speed * delta;
      const moveZ = z * speed * delta;

      this.world.camera.position.x += moveX;
      this.world.camera.position.y += moveY;
      this.world.camera.position.z += moveZ;

      // Move target along with camera in fly mode
      if (this.controls) {
        this.controls.target.x += moveX;
        this.controls.target.y += moveY;
        this.controls.target.z += moveZ;
      }
    }
  }

  override destroy(): void {
    if (this.domElement) {
      this.domElement.removeEventListener("keydown", this.onKeyDown);
      this.domElement.removeEventListener("keyup", this.onKeyUp);
      this.domElement.removeEventListener("blur", this.onBlur);
    }

    if (this.controls) {
      this.controls.dispose();
      this.controls = null;
    }

    this.bookmarks.clear();
    super.destroy();
  }
}
