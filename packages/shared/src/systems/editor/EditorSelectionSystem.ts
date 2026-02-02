/**
 * EditorSelectionSystem.ts - Object Selection for Editor Mode
 *
 * Provides selection functionality for world editing:
 * - Single-click selection
 * - Multi-select with Shift
 * - Marquee/box selection with drag
 * - Selection groups
 * - Selection history for undo/redo
 *
 * Emits events when selection changes so other systems (like gizmos)
 * can respond appropriately.
 *
 * @module EditorSelectionSystem
 */

import * as THREE from "three";

import {
  System,
  type SystemDependencies,
} from "../shared/infrastructure/System";
import type { World } from "../../core/World";
import type { WorldOptions } from "../../types";

/**
 * Selectable object interface
 * Any object that can be selected must implement this interface
 */
export interface Selectable {
  /** Unique identifier */
  id: string;
  /** Display name for UI */
  name: string;
  /** The THREE.js object */
  object3D: THREE.Object3D;
  /** Type of selectable (building, tree, rock, road, etc.) */
  type: string;
  /** Optional user data */
  userData?: Record<string, unknown>;
}

/**
 * Selection change event data
 */
export interface SelectionChangeEvent {
  /** All currently selected objects */
  selected: Selectable[];
  /** Objects that were just added to selection */
  added: Selectable[];
  /** Objects that were just removed from selection */
  removed: Selectable[];
  /** The selection action that triggered this change */
  action: "select" | "deselect" | "toggle" | "clear" | "set";
}

/**
 * Configuration for EditorSelectionSystem
 */
export interface EditorSelectionConfig {
  /** Enable multi-select with Shift key */
  enableMultiSelect: boolean;
  /** Enable marquee/box selection */
  enableMarqueeSelect: boolean;
  /** Color for selection highlight */
  highlightColor: number;
  /** Opacity for selection highlight */
  highlightOpacity: number;
  /** Enable selection outlines */
  enableOutline: boolean;
  /** Maximum number of objects that can be selected */
  maxSelection: number;
  /** Raycast layers for selection */
  selectableLayers: number;
}

const DEFAULT_CONFIG: EditorSelectionConfig = {
  enableMultiSelect: true,
  enableMarqueeSelect: true,
  highlightColor: 0x00aaff,
  highlightOpacity: 0.3,
  enableOutline: true,
  maxSelection: 1000,
  selectableLayers: 1,
};

/**
 * EditorSelectionSystem - Object selection for world editing
 *
 * Handles all selection interactions including click, multi-select, and marquee.
 *
 * Note: This system requires a graphics renderer with a DOM element.
 * If not available, the system will be partially initialized (isReady = false).
 * Manual selection via setSelection/addToSelection still works.
 */
export class EditorSelectionSystem extends System {
  private config: EditorSelectionConfig;
  private selection: Map<string, Selectable> = new Map();
  private selectables: Map<string, Selectable> = new Map();
  private objectToSelectable: WeakMap<THREE.Object3D, Selectable> =
    new WeakMap();
  private domElement: HTMLElement | null = null;

  /**
   * Whether the system is fully initialized with mouse/keyboard controls.
   * False if graphics/renderer was not available during init.
   */
  public isReady = false;

  // Raycasting
  private raycaster: THREE.Raycaster;
  private mouse: THREE.Vector2 = new THREE.Vector2();
  private _tempVec3 = new THREE.Vector3(); // Reusable for marquee calculations

  // Marquee selection state
  private isMarqueeActive = false;
  private marqueeStart: THREE.Vector2 = new THREE.Vector2();
  private marqueeEnd: THREE.Vector2 = new THREE.Vector2();
  private marqueeDiv: HTMLDivElement | null = null;

  // Selection history for undo
  private selectionHistory: Array<Set<string>> = [];
  private historyIndex = -1;
  private readonly maxHistorySize = 50;

  // Highlight materials
  private highlightMaterial: THREE.MeshBasicMaterial;
  private highlightMeshes: Map<string, THREE.Mesh> = new Map();

  constructor(world: World, config: Partial<EditorSelectionConfig> = {}) {
    super(world);
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.raycaster = new THREE.Raycaster();
    this.raycaster.layers.set(this.config.selectableLayers);

    // Create highlight material
    this.highlightMaterial = new THREE.MeshBasicMaterial({
      color: this.config.highlightColor,
      transparent: true,
      opacity: this.config.highlightOpacity,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  }

  override getDependencies(): SystemDependencies {
    return {
      required: ["stage", "graphics"],
      optional: ["editor-camera"],
    };
  }

  override async init(options: WorldOptions): Promise<void> {
    await super.init(options);

    // Get DOM element from graphics system
    const graphics = this.world.graphics;
    if (!graphics?.renderer?.domElement) {
      console.warn(
        "[EditorSelectionSystem] No renderer DOM element available - mouse/keyboard controls disabled. " +
          "Check isReady property. Manual selection via API still works.",
      );
      this.isReady = false;
      return;
    }

    this.domElement = graphics.renderer.domElement;
    this.setupEventListeners();
    this.createMarqueeElement();
    this.isReady = true;
  }

  private setupEventListeners(): void {
    if (!this.domElement) return;

    this.domElement.addEventListener("pointerdown", this.onPointerDown);
    this.domElement.addEventListener("pointermove", this.onPointerMove);
    this.domElement.addEventListener("pointerup", this.onPointerUp);
    this.domElement.addEventListener("keydown", this.onKeyDown);
  }

  private createMarqueeElement(): void {
    if (!this.domElement?.parentElement) return;

    this.marqueeDiv = document.createElement("div");
    this.marqueeDiv.style.cssText = `
      position: absolute;
      border: 1px solid #00aaff;
      background: rgba(0, 170, 255, 0.1);
      pointer-events: none;
      display: none;
      z-index: 1000;
    `;
    this.domElement.parentElement.appendChild(this.marqueeDiv);
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return; // Left click only

    const rect = this.domElement!.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    // Check if we clicked on a selectable
    const hit = this.raycastSelectables();

    if (hit) {
      // Direct selection
      if (event.shiftKey && this.config.enableMultiSelect) {
        this.toggleSelection(hit);
      } else {
        this.setSelection([hit]);
      }
    } else if (this.config.enableMarqueeSelect) {
      // Start marquee selection
      this.startMarquee(event);
    } else if (!event.shiftKey) {
      // Clicked on nothing, clear selection
      this.clearSelection();
    }
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.isMarqueeActive) return;
    this.updateMarquee(event);
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (event.button !== 0) return;

    if (this.isMarqueeActive) {
      this.endMarquee(event);
    }
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    // Don't handle if focused on input
    if (
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement
    ) {
      return;
    }

    switch (event.code) {
      case "Escape":
        this.clearSelection();
        break;
      case "KeyA":
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          this.selectAll();
        }
        break;
      case "KeyZ":
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          if (event.shiftKey) {
            this.redo();
          } else {
            this.undo();
          }
        }
        break;
      case "Delete":
      case "Backspace":
        this.emit("delete-requested", { selected: this.getSelection() });
        break;
    }
  };

  private raycastSelectables(): Selectable | null {
    if (this.selectables.size === 0) return null;

    const objects = Array.from(this.selectables.values()).map(
      (s) => s.object3D,
    );
    this.raycaster.setFromCamera(this.mouse, this.world.camera);
    const intersects = this.raycaster.intersectObjects(objects, true);

    if (intersects.length === 0) return null;

    // Find the selectable for the hit object (traverse up parent chain)
    for (
      let obj: THREE.Object3D | null = intersects[0].object;
      obj;
      obj = obj.parent
    ) {
      const selectable = this.objectToSelectable.get(obj);
      if (selectable) return selectable;
    }
    return null;
  }

  private startMarquee(event: PointerEvent): void {
    this.isMarqueeActive = true;
    const rect = this.domElement!.getBoundingClientRect();
    this.marqueeStart.set(event.clientX - rect.left, event.clientY - rect.top);
    this.marqueeEnd.copy(this.marqueeStart);

    if (this.marqueeDiv) {
      this.marqueeDiv.style.display = "block";
      this.updateMarqueeElement();
    }
  }

  private updateMarquee(event: PointerEvent): void {
    const rect = this.domElement!.getBoundingClientRect();
    this.marqueeEnd.set(event.clientX - rect.left, event.clientY - rect.top);
    this.updateMarqueeElement();
  }

  private updateMarqueeElement(): void {
    if (!this.marqueeDiv) return;

    const left = Math.min(this.marqueeStart.x, this.marqueeEnd.x);
    const top = Math.min(this.marqueeStart.y, this.marqueeEnd.y);
    const width = Math.abs(this.marqueeEnd.x - this.marqueeStart.x);
    const height = Math.abs(this.marqueeEnd.y - this.marqueeStart.y);

    this.marqueeDiv.style.left = `${left}px`;
    this.marqueeDiv.style.top = `${top}px`;
    this.marqueeDiv.style.width = `${width}px`;
    this.marqueeDiv.style.height = `${height}px`;
  }

  private endMarquee(event: PointerEvent): void {
    this.isMarqueeActive = false;

    if (this.marqueeDiv) {
      this.marqueeDiv.style.display = "none";
    }

    // If the marquee is too small, treat as a click
    const width = Math.abs(this.marqueeEnd.x - this.marqueeStart.x);
    const height = Math.abs(this.marqueeEnd.y - this.marqueeStart.y);

    if (width < 5 && height < 5) {
      if (!event.shiftKey) {
        this.clearSelection();
      }
      return;
    }

    // Select all objects within the marquee
    const selected = this.getObjectsInMarquee();

    if (event.shiftKey && this.config.enableMultiSelect) {
      // Add to existing selection
      for (const selectable of selected) {
        this.addToSelection(selectable);
      }
    } else {
      this.setSelection(selected);
    }
  }

  private getObjectsInMarquee(): Selectable[] {
    const result: Selectable[] = [];
    const rect = this.domElement!.getBoundingClientRect();

    // Convert marquee bounds to normalized device coordinates
    const minX =
      (Math.min(this.marqueeStart.x, this.marqueeEnd.x) / rect.width) * 2 - 1;
    const maxX =
      (Math.max(this.marqueeStart.x, this.marqueeEnd.x) / rect.width) * 2 - 1;
    const minY =
      -(Math.max(this.marqueeStart.y, this.marqueeEnd.y) / rect.height) * 2 + 1;
    const maxY =
      -(Math.min(this.marqueeStart.y, this.marqueeEnd.y) / rect.height) * 2 + 1;

    // Check each selectable object
    for (const selectable of this.selectables.values()) {
      selectable.object3D.getWorldPosition(this._tempVec3);
      this._tempVec3.project(this.world.camera);

      const { x, y, z } = this._tempVec3;
      // Check if within marquee bounds and in front of camera
      if (
        x >= minX &&
        x <= maxX &&
        y >= minY &&
        y <= maxY &&
        z >= -1 &&
        z <= 1
      ) {
        result.push(selectable);
      }
    }
    return result;
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  /**
   * Register a selectable object
   */
  registerSelectable(selectable: Selectable): void {
    this.selectables.set(selectable.id, selectable);
    this.objectToSelectable.set(selectable.object3D, selectable);
    selectable.object3D.layers.enable(this.config.selectableLayers);
  }

  /**
   * Unregister a selectable object
   */
  unregisterSelectable(id: string): void {
    const selectable = this.selectables.get(id);
    if (!selectable) return;

    if (this.selection.has(id)) {
      this.removeFromSelection(selectable);
    }
    this.selectables.delete(id);
    this.objectToSelectable.delete(selectable.object3D);
  }

  /**
   * Set selection to exactly these objects (replaces current selection)
   */
  setSelection(selectables: Selectable[]): void {
    const oldSelection = new Set(this.selection.keys());
    const newSelection = new Set(selectables.map((s) => s.id));

    // Determine added and removed
    const added: Selectable[] = [];
    const removed: Selectable[] = [];

    for (const id of oldSelection) {
      if (!newSelection.has(id)) {
        const selectable = this.selectables.get(id);
        if (selectable) removed.push(selectable);
      }
    }

    for (const selectable of selectables) {
      if (!oldSelection.has(selectable.id)) {
        added.push(selectable);
      }
    }

    // Apply changes
    this.selection.clear();
    for (const selectable of selectables) {
      if (this.selection.size < this.config.maxSelection) {
        this.selection.set(selectable.id, selectable);
      }
    }

    // Update visuals
    this.updateSelectionVisuals(added, removed);

    // Save to history
    this.saveToHistory();

    // Emit event
    this.emit("selection-changed", {
      selected: this.getSelection(),
      added,
      removed,
      action: "set",
    } as SelectionChangeEvent);
  }

  /**
   * Add object(s) to selection
   */
  addToSelection(selectable: Selectable | Selectable[]): void {
    const items = Array.isArray(selectable) ? selectable : [selectable];
    const added: Selectable[] = [];

    for (const item of items) {
      if (
        !this.selection.has(item.id) &&
        this.selection.size < this.config.maxSelection
      ) {
        this.selection.set(item.id, item);
        added.push(item);
      }
    }

    if (added.length > 0) {
      this.updateSelectionVisuals(added, []);
      this.saveToHistory();
      this.emit("selection-changed", {
        selected: this.getSelection(),
        added,
        removed: [],
        action: "select",
      } as SelectionChangeEvent);
    }
  }

  /**
   * Remove object(s) from selection
   */
  removeFromSelection(selectable: Selectable | Selectable[]): void {
    const items = Array.isArray(selectable) ? selectable : [selectable];
    const removed: Selectable[] = [];

    for (const item of items) {
      if (this.selection.has(item.id)) {
        this.selection.delete(item.id);
        removed.push(item);
      }
    }

    if (removed.length > 0) {
      this.updateSelectionVisuals([], removed);
      this.saveToHistory();
      this.emit("selection-changed", {
        selected: this.getSelection(),
        added: [],
        removed,
        action: "deselect",
      } as SelectionChangeEvent);
    }
  }

  /**
   * Toggle selection state of an object
   */
  toggleSelection(selectable: Selectable): void {
    if (this.selection.has(selectable.id)) {
      this.removeFromSelection(selectable);
    } else {
      this.addToSelection(selectable);
    }
  }

  /**
   * Clear all selection
   */
  clearSelection(): void {
    if (this.selection.size === 0) return;

    const removed = this.getSelection();
    this.selection.clear();
    this.updateSelectionVisuals([], removed);
    this.saveToHistory();

    this.emit("selection-changed", {
      selected: [],
      added: [],
      removed,
      action: "clear",
    } as SelectionChangeEvent);
  }

  /**
   * Select all registered selectables
   */
  selectAll(): void {
    const all = Array.from(this.selectables.values()).slice(
      0,
      this.config.maxSelection,
    );
    this.setSelection(all);
  }

  /**
   * Get current selection
   */
  getSelection(): Selectable[] {
    return Array.from(this.selection.values());
  }

  /**
   * Check if an object is selected
   */
  isSelected(id: string): boolean {
    return this.selection.has(id);
  }

  /**
   * Get selection count
   */
  getSelectionCount(): number {
    return this.selection.size;
  }

  /**
   * Get bounding box of selection
   */
  getSelectionBounds(): THREE.Box3 | null {
    if (this.selection.size === 0) return null;

    const box = new THREE.Box3();
    let first = true;

    for (const selectable of this.selection.values()) {
      const objectBox = new THREE.Box3().setFromObject(selectable.object3D);
      if (first) {
        box.copy(objectBox);
        first = false;
      } else {
        box.union(objectBox);
      }
    }

    return box;
  }

  /**
   * Undo last selection change
   */
  undo(): boolean {
    if (this.historyIndex <= 0) return false;

    this.historyIndex--;
    const state = this.selectionHistory[this.historyIndex];
    this.restoreSelectionState(state);
    return true;
  }

  /**
   * Redo selection change
   */
  redo(): boolean {
    if (this.historyIndex >= this.selectionHistory.length - 1) return false;

    this.historyIndex++;
    const state = this.selectionHistory[this.historyIndex];
    this.restoreSelectionState(state);
    return true;
  }

  private saveToHistory(): void {
    // Remove any redo history
    this.selectionHistory = this.selectionHistory.slice(
      0,
      this.historyIndex + 1,
    );

    // Add current state
    this.selectionHistory.push(new Set(this.selection.keys()));
    this.historyIndex = this.selectionHistory.length - 1;

    // Trim history if too large
    if (this.selectionHistory.length > this.maxHistorySize) {
      this.selectionHistory.shift();
      this.historyIndex--;
    }
  }

  private restoreSelectionState(state: Set<string>): void {
    const oldSelection = new Set(this.selection.keys());
    const added: Selectable[] = [];
    const removed: Selectable[] = [];

    // Find removed
    for (const id of oldSelection) {
      if (!state.has(id)) {
        const selectable = this.selectables.get(id);
        if (selectable) removed.push(selectable);
      }
    }

    // Find added
    for (const id of state) {
      if (!oldSelection.has(id)) {
        const selectable = this.selectables.get(id);
        if (selectable) added.push(selectable);
      }
    }

    // Apply
    this.selection.clear();
    for (const id of state) {
      const selectable = this.selectables.get(id);
      if (selectable) {
        this.selection.set(id, selectable);
      }
    }

    this.updateSelectionVisuals(added, removed);
  }

  private updateSelectionVisuals(
    added: Selectable[],
    removed: Selectable[],
  ): void {
    // Remove highlights from deselected
    for (const selectable of removed) {
      this.removeHighlight(selectable);
    }

    // Add highlights to selected
    for (const selectable of added) {
      this.addHighlight(selectable);
    }
  }

  private addHighlight(selectable: Selectable): void {
    if (!this.config.enableOutline) return;
    if (this.highlightMeshes.has(selectable.id)) return;

    // Create a highlight mesh that outlines the selection
    // This is a simple bounding box approach - could be replaced with proper outlines
    const box = new THREE.Box3().setFromObject(selectable.object3D);
    const size = new THREE.Vector3();
    box.getSize(size);

    // Scale up slightly for visibility
    size.multiplyScalar(1.02);

    const geometry = new THREE.BoxGeometry(size.x, size.y, size.z);
    const mesh = new THREE.Mesh(geometry, this.highlightMaterial);

    // Position at object center
    box.getCenter(mesh.position);

    // Add to scene
    this.world.stage.scene.add(mesh);
    this.highlightMeshes.set(selectable.id, mesh);
  }

  private removeHighlight(selectable: Selectable): void {
    const mesh = this.highlightMeshes.get(selectable.id);
    if (mesh) {
      this.world.stage.scene.remove(mesh);
      mesh.geometry.dispose();
      this.highlightMeshes.delete(selectable.id);
    }
  }

  override destroy(): void {
    // Remove event listeners
    if (this.domElement) {
      this.domElement.removeEventListener("pointerdown", this.onPointerDown);
      this.domElement.removeEventListener("pointermove", this.onPointerMove);
      this.domElement.removeEventListener("pointerup", this.onPointerUp);
      this.domElement.removeEventListener("keydown", this.onKeyDown);
    }

    // Remove marquee element
    if (this.marqueeDiv?.parentElement) {
      this.marqueeDiv.parentElement.removeChild(this.marqueeDiv);
    }

    // Clean up highlights
    for (const mesh of this.highlightMeshes.values()) {
      this.world.stage.scene.remove(mesh);
      mesh.geometry.dispose();
    }
    this.highlightMeshes.clear();

    // Dispose materials
    this.highlightMaterial.dispose();

    // Clear data structures
    this.selection.clear();
    this.selectables.clear();
    this.selectionHistory.length = 0;

    super.destroy();
  }
}
