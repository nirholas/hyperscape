/**
 * EditorGizmoSystem.ts - Transform Gizmos for Editor Mode
 *
 * Provides visual transform gizmos for manipulating selected objects:
 * - Translate gizmo: Move objects along X, Y, Z axes or planes
 * - Rotate gizmo: Rotate objects around X, Y, Z axes
 * - Scale gizmo: Scale objects uniformly or per-axis
 *
 * Uses THREE.js TransformControls under the hood.
 *
 * @module EditorGizmoSystem
 */

import * as THREE from "three";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";

import {
  System,
  type SystemDependencies,
} from "../shared/infrastructure/System";
import type { World } from "../../core/World";
import type { WorldOptions } from "../../types";
import type {
  EditorSelectionSystem,
  Selectable,
  SelectionChangeEvent,
} from "./EditorSelectionSystem";

/**
 * Transform mode for gizmos
 */
export type TransformMode = "translate" | "rotate" | "scale";

/**
 * Transform space for gizmos
 */
export type TransformSpace = "world" | "local";

/**
 * Transform event data
 */
export interface TransformEvent {
  /** The object being transformed */
  object: THREE.Object3D;
  /** The selectable wrapper */
  selectable: Selectable | null;
  /** Transform mode */
  mode: TransformMode;
  /** Whether transform is in progress */
  transforming: boolean;
}

/**
 * Configuration for EditorGizmoSystem
 */
export interface EditorGizmoConfig {
  /** Initial transform mode */
  initialMode: TransformMode;
  /** Initial transform space */
  initialSpace: TransformSpace;
  /** Gizmo size multiplier */
  size: number;
  /** Enable snapping */
  enableSnap: boolean;
  /** Translation snap increment */
  translationSnap: number;
  /** Rotation snap increment (degrees) */
  rotationSnap: number;
  /** Scale snap increment */
  scaleSnap: number;
  /** Show gizmo even with no selection (for single object) */
  showAlways: boolean;
}

const DEFAULT_CONFIG: EditorGizmoConfig = {
  initialMode: "translate",
  initialSpace: "world",
  size: 1,
  enableSnap: false,
  translationSnap: 1,
  rotationSnap: 15,
  scaleSnap: 0.1,
  showAlways: false,
};

/**
 * EditorGizmoSystem - Transform gizmos for world editing
 *
 * Provides visual handles for moving, rotating, and scaling objects.
 */
export class EditorGizmoSystem extends System {
  private config: EditorGizmoConfig;
  private transformControls: TransformControls | null = null;
  private mode: TransformMode = "translate";
  private space: TransformSpace = "world";
  private domElement: HTMLElement | null = null;
  private selectionSystem: EditorSelectionSystem | null = null;

  // Group for multi-selection transforms
  private transformGroup: THREE.Group;
  private transformGroupCenter = new THREE.Vector3();
  private originalTransforms: Map<
    string,
    { position: THREE.Vector3; rotation: THREE.Euler; scale: THREE.Vector3 }
  > = new Map();

  // Current selection tracking
  private currentSelectable: Selectable | null = null;
  private isTransforming = false;

  // Snapping state
  private snapEnabled = false;

  constructor(world: World, config: Partial<EditorGizmoConfig> = {}) {
    super(world);
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.mode = this.config.initialMode;
    this.space = this.config.initialSpace;
    this.snapEnabled = this.config.enableSnap;

    // Create transform group for multi-selection
    this.transformGroup = new THREE.Group();
    this.transformGroup.name = "editor-transform-group";
  }

  override getDependencies(): SystemDependencies {
    return {
      required: ["stage", "graphics"],
      optional: ["editor-selection", "editor-camera"],
    };
  }

  override async init(options: WorldOptions): Promise<void> {
    await super.init(options);

    // Get DOM element from graphics system
    const graphics = this.world.graphics;
    if (!graphics?.renderer?.domElement) {
      console.warn("[EditorGizmoSystem] No renderer DOM element available");
      return;
    }

    this.domElement = graphics.renderer.domElement;
    this.setupTransformControls();
    this.setupKeyboardShortcuts();

    // Connect to selection system if available
    this.selectionSystem =
      (this.world.getSystem("editor-selection") as
        | EditorSelectionSystem
        | undefined) ?? null;
    if (this.selectionSystem) {
      this.selectionSystem.on("selection-changed", this.onSelectionChanged);
    }
  }

  private setupTransformControls(): void {
    if (!this.domElement) return;

    this.transformControls = new TransformControls(
      this.world.camera,
      this.domElement,
    );

    // Configure controls
    this.transformControls.setMode(this.mode);
    this.transformControls.setSpace(this.space);
    this.transformControls.setSize(this.config.size);

    // Add to scene
    this.world.stage.scene.add(this.transformControls);

    // Set up event listeners (cast to handle three.js type mismatch)
    this.transformControls.addEventListener(
      "dragging-changed",
      this.onDraggingChanged as unknown as (event: THREE.Event) => void,
    );
    this.transformControls.addEventListener(
      "objectChange",
      this.onObjectChange,
    );

    // Initially hide until something is selected
    // TransformControls extends Object3D, so we can access visible via cast
    (this.transformControls as unknown as THREE.Object3D).visible = false;
    this.transformControls.enabled = false;
  }

  private setupKeyboardShortcuts(): void {
    if (!this.domElement) return;

    this.domElement.addEventListener("keydown", this.onKeyDown);
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
        // W for translate (move/walk)
        if (!event.ctrlKey && !event.metaKey && !event.shiftKey) {
          this.setMode("translate");
        }
        break;
      case "KeyE":
        // E for rotate
        if (!event.ctrlKey && !event.metaKey && !event.shiftKey) {
          this.setMode("rotate");
        }
        break;
      case "KeyR":
        // R for scale
        if (!event.ctrlKey && !event.metaKey && !event.shiftKey) {
          this.setMode("scale");
        }
        break;
      case "KeyX":
        // Toggle snap
        if (!event.ctrlKey && !event.metaKey) {
          this.toggleSnap();
        }
        break;
      case "KeyG":
        // Toggle between world and local space
        if (!event.ctrlKey && !event.metaKey) {
          this.toggleSpace();
        }
        break;
    }
  };

  private onSelectionChanged = (event: SelectionChangeEvent): void => {
    const { selected } = event;
    if (selected.length === 0) {
      this.detachGizmo();
    } else if (selected.length === 1) {
      this.attachToObject(selected[0]);
    } else {
      this.attachToMultiSelection(selected);
    }
  };

  private onDraggingChanged = (event: { value: boolean }): void => {
    this.isTransforming = event.value;

    // Disable camera controls while transforming
    const cameraSystem = this.world.getSystem("editor-camera") as
      | { getControls?: () => { enabled: boolean } | null }
      | undefined;
    if (cameraSystem?.getControls) {
      const controls = cameraSystem.getControls();
      if (controls) {
        controls.enabled = !event.value;
      }
    }

    if (event.value) {
      // Starting transform - save original transforms
      this.saveOriginalTransforms();
      this.emit("transform-start", this.createTransformEvent());
    } else {
      // Ending transform
      this.emit("transform-end", this.createTransformEvent());

      // If multi-selection, update individual object positions
      if (
        this.selectionSystem &&
        this.selectionSystem.getSelectionCount() > 1
      ) {
        this.applyGroupTransformToSelection();
      }
    }
  };

  private onObjectChange = (): void => {
    if (this.isTransforming) {
      this.emit("transform-change", this.createTransformEvent());

      // If multi-selection, we need to update individual objects
      if (
        this.selectionSystem &&
        this.selectionSystem.getSelectionCount() > 1
      ) {
        this.updateMultiSelectionTransforms();
      }
    }
  };

  private createTransformEvent(): TransformEvent {
    return {
      object: this.transformControls?.object ?? this.transformGroup,
      selectable: this.currentSelectable,
      mode: this.mode,
      transforming: this.isTransforming,
    };
  }

  private saveOriginalTransforms(): void {
    this.originalTransforms.clear();

    if (!this.selectionSystem) return;

    for (const selectable of this.selectionSystem.getSelection()) {
      this.originalTransforms.set(selectable.id, {
        position: selectable.object3D.position.clone(),
        rotation: selectable.object3D.rotation.clone(),
        scale: selectable.object3D.scale.clone(),
      });
    }
  }

  /**
   * Set visibility on TransformControls (requires cast due to type mismatch)
   */
  private setControlsVisible(visible: boolean): void {
    if (!this.transformControls) return;
    // TransformControls extends Object3D but types don't expose visible directly
    (this.transformControls as unknown as THREE.Object3D).visible = visible;
  }

  private attachToObject(selectable: Selectable): void {
    if (!this.transformControls) return;

    this.currentSelectable = selectable;
    this.transformControls.attach(selectable.object3D);
    this.setControlsVisible(true);
    this.transformControls.enabled = true;

    this.emit("gizmo-attached", { selectable });
  }

  private attachToMultiSelection(selection: Selectable[]): void {
    if (!this.transformControls) return;

    // Calculate center of selection
    this.transformGroupCenter.set(0, 0, 0);
    for (const selectable of selection) {
      const worldPos = new THREE.Vector3();
      selectable.object3D.getWorldPosition(worldPos);
      this.transformGroupCenter.add(worldPos);
    }
    this.transformGroupCenter.divideScalar(selection.length);

    // Position transform group at center
    this.transformGroup.position.copy(this.transformGroupCenter);
    this.transformGroup.rotation.set(0, 0, 0);
    this.transformGroup.scale.set(1, 1, 1);

    // Add to scene if not already
    if (!this.transformGroup.parent) {
      this.world.stage.scene.add(this.transformGroup);
    }

    // Attach gizmo to group
    this.currentSelectable = null;
    this.transformControls.attach(this.transformGroup);
    this.setControlsVisible(true);
    this.transformControls.enabled = true;

    this.emit("gizmo-attached", { selection });
  }

  private updateMultiSelectionTransforms(): void {
    if (!this.selectionSystem) return;

    const selection = this.selectionSystem.getSelection();
    const groupPos = this.transformGroup.position;
    const groupRot = this.transformGroup.quaternion;
    const groupScale = this.transformGroup.scale;

    for (const selectable of selection) {
      const original = this.originalTransforms.get(selectable.id);
      if (!original) continue;

      // Calculate offset from original center
      const offset = original.position.clone().sub(this.transformGroupCenter);

      // Apply group transforms to offset
      switch (this.mode) {
        case "translate":
          // For translation, just add the group's position delta
          selectable.object3D.position.copy(
            original.position
              .clone()
              .add(groupPos)
              .sub(this.transformGroupCenter),
          );
          break;

        case "rotate":
          // For rotation, rotate around group center
          offset.applyQuaternion(groupRot);
          selectable.object3D.position
            .copy(this.transformGroupCenter)
            .add(offset);
          // Also rotate the object itself
          selectable.object3D.quaternion.copy(
            original.rotation as unknown as THREE.Quaternion,
          );
          selectable.object3D.quaternion.premultiply(groupRot);
          break;

        case "scale":
          // For scale, scale offset and object
          offset.multiply(groupScale);
          selectable.object3D.position
            .copy(this.transformGroupCenter)
            .add(offset);
          selectable.object3D.scale.copy(original.scale).multiply(groupScale);
          break;
      }
    }
  }

  private applyGroupTransformToSelection(): void {
    // After transform ends, reset group transform
    this.transformGroup.position.set(0, 0, 0);
    this.transformGroup.rotation.set(0, 0, 0);
    this.transformGroup.scale.set(1, 1, 1);

    // Recalculate center for next transform
    if (this.selectionSystem) {
      const selection = this.selectionSystem.getSelection();
      if (selection.length > 1) {
        this.transformGroupCenter.set(0, 0, 0);
        for (const selectable of selection) {
          const worldPos = new THREE.Vector3();
          selectable.object3D.getWorldPosition(worldPos);
          this.transformGroupCenter.add(worldPos);
        }
        this.transformGroupCenter.divideScalar(selection.length);
        this.transformGroup.position.copy(this.transformGroupCenter);
      }
    }
  }

  private detachGizmo(): void {
    if (!this.transformControls) return;

    this.transformControls.detach();
    this.setControlsVisible(false);
    this.transformControls.enabled = false;
    this.currentSelectable = null;

    // Remove transform group from scene
    if (this.transformGroup.parent) {
      this.world.stage.scene.remove(this.transformGroup);
    }

    this.emit("gizmo-detached", {});
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  /**
   * Set the transform mode
   */
  setMode(mode: TransformMode): void {
    this.mode = mode;
    if (this.transformControls) {
      this.transformControls.setMode(mode);
    }
    this.emit("mode-changed", { mode });
  }

  /**
   * Get current transform mode
   */
  getMode(): TransformMode {
    return this.mode;
  }

  /**
   * Set the transform space
   */
  setSpace(space: TransformSpace): void {
    this.space = space;
    if (this.transformControls) {
      this.transformControls.setSpace(space);
    }
    this.emit("space-changed", { space });
  }

  /**
   * Get current transform space
   */
  getSpace(): TransformSpace {
    return this.space;
  }

  /**
   * Toggle between world and local space
   */
  toggleSpace(): void {
    this.setSpace(this.space === "world" ? "local" : "world");
  }

  /**
   * Enable or disable snapping
   */
  setSnap(enabled: boolean): void {
    this.snapEnabled = enabled;
    this.updateSnapSettings();
    this.emit("snap-changed", { enabled });
  }

  /**
   * Toggle snapping
   */
  toggleSnap(): void {
    this.setSnap(!this.snapEnabled);
  }

  /**
   * Check if snapping is enabled
   */
  isSnapEnabled(): boolean {
    return this.snapEnabled;
  }

  /**
   * Set snap increments
   */
  setSnapIncrements(
    translation?: number,
    rotation?: number,
    scale?: number,
  ): void {
    if (translation !== undefined) this.config.translationSnap = translation;
    if (rotation !== undefined) this.config.rotationSnap = rotation;
    if (scale !== undefined) this.config.scaleSnap = scale;
    this.updateSnapSettings();
  }

  private updateSnapSettings(): void {
    if (!this.transformControls) return;

    if (this.snapEnabled) {
      this.transformControls.setTranslationSnap(this.config.translationSnap);
      this.transformControls.setRotationSnap(
        THREE.MathUtils.degToRad(this.config.rotationSnap),
      );
      this.transformControls.setScaleSnap(this.config.scaleSnap);
    } else {
      this.transformControls.setTranslationSnap(null);
      this.transformControls.setRotationSnap(null);
      this.transformControls.setScaleSnap(null);
    }
  }

  /**
   * Set gizmo size
   */
  setSize(size: number): void {
    this.config.size = size;
    if (this.transformControls) {
      this.transformControls.setSize(size);
    }
  }

  /**
   * Check if currently transforming
   */
  isCurrentlyTransforming(): boolean {
    return this.isTransforming;
  }

  /**
   * Get the transform controls instance for external customization
   */
  getControls(): TransformControls | null {
    return this.transformControls;
  }

  override destroy(): void {
    // Remove event listeners
    if (this.domElement) {
      this.domElement.removeEventListener("keydown", this.onKeyDown);
    }

    // Disconnect from selection system
    if (this.selectionSystem) {
      this.selectionSystem.off("selection-changed", this.onSelectionChanged);
    }

    // Dispose transform controls
    if (this.transformControls) {
      this.transformControls.removeEventListener(
        "dragging-changed",
        this.onDraggingChanged as unknown as (event: THREE.Event) => void,
      );
      this.transformControls.removeEventListener(
        "objectChange",
        this.onObjectChange,
      );
      this.transformControls.detach();
      this.world.stage.scene.remove(this.transformControls);
      this.transformControls.dispose();
      this.transformControls = null;
    }

    // Remove transform group
    if (this.transformGroup.parent) {
      this.world.stage.scene.remove(this.transformGroup);
    }

    this.originalTransforms.clear();
    super.destroy();
  }
}
