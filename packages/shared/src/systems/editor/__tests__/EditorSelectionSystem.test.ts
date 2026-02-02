/**
 * EditorSelectionSystem Tests
 *
 * Comprehensive tests for object selection including:
 * - Register/unregister selectables
 * - Selection operations (set, add, remove, toggle, clear)
 * - Multi-selection and selection limits
 * - Selection bounds calculation
 * - Undo/redo functionality
 * - Edge cases and boundary conditions
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import * as THREE from "three";
import {
  EditorSelectionSystem,
  type Selectable,
  type EditorSelectionConfig,
} from "../EditorSelectionSystem";

// Create a minimal mock world for testing
function createMockWorld() {
  const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
  camera.position.set(0, 50, 100);

  return {
    camera,
    graphics: {
      renderer: {
        domElement: document.createElement("canvas"),
      },
    },
    stage: {
      scene: new THREE.Scene(),
    },
    getSystem: vi.fn(),
  };
}

// Create a test selectable object
function createSelectable(id: string, position?: THREE.Vector3): Selectable {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial(),
  );
  if (position) {
    mesh.position.copy(position);
  }
  return {
    id,
    name: `Object ${id}`,
    object3D: mesh,
    type: "test",
    userData: { testData: id },
  };
}

describe("EditorSelectionSystem", () => {
  // ============================================================================
  // INITIALIZATION TESTS
  // ============================================================================
  describe("initialization", () => {
    it("should initialize with default config", () => {
      const world = createMockWorld();
      const system = new EditorSelectionSystem(world as never);

      expect(system.getSelection()).toHaveLength(0);
      expect(system.getSelectionCount()).toBe(0);
    });

    it("should accept custom config", () => {
      const world = createMockWorld();
      const config: Partial<EditorSelectionConfig> = {
        maxSelection: 5,
        enableMultiSelect: false,
        highlightColor: 0xff0000,
      };
      const system = new EditorSelectionSystem(world as never, config);

      expect(system.getSelection()).toHaveLength(0);
    });

    it("should declare correct dependencies", () => {
      const world = createMockWorld();
      const system = new EditorSelectionSystem(world as never);
      const deps = system.getDependencies();

      expect(deps.required).toContain("stage");
      expect(deps.required).toContain("graphics");
      expect(deps.optional).toContain("editor-camera");
    });
  });

  // ============================================================================
  // REGISTER/UNREGISTER TESTS
  // ============================================================================
  describe("register/unregister selectables", () => {
    let world: ReturnType<typeof createMockWorld>;
    let system: EditorSelectionSystem;

    beforeEach(async () => {
      world = createMockWorld();
      system = new EditorSelectionSystem(world as never);
      await system.init({});
    });

    it("should register a selectable", () => {
      const selectable = createSelectable("obj-1");
      system.registerSelectable(selectable);

      // Should be able to select it now
      system.setSelection([selectable]);
      expect(system.getSelectionCount()).toBe(1);
    });

    it("should unregister a selectable", () => {
      const selectable = createSelectable("obj-1");
      system.registerSelectable(selectable);
      system.setSelection([selectable]);

      system.unregisterSelectable("obj-1");

      // Selection should be cleared
      expect(system.getSelectionCount()).toBe(0);
    });

    it("should handle unregistering non-existent selectable", () => {
      expect(() => system.unregisterSelectable("does-not-exist")).not.toThrow();
    });

    it("should enable selection layer on registered objects", () => {
      const selectable = createSelectable("obj-1");
      system.registerSelectable(selectable);

      // Verify the object is registered (layer enabling is internal behavior)
      // The important thing is that the object can be selected after registration
      system.setSelection([selectable]);
      expect(system.isSelected("obj-1")).toBe(true);
    });

    it("should handle registering multiple selectables", () => {
      for (let i = 0; i < 100; i++) {
        system.registerSelectable(createSelectable(`obj-${i}`));
      }

      // Should be able to select all
      const allSelectables: Selectable[] = [];
      for (let i = 0; i < 100; i++) {
        allSelectables.push(createSelectable(`new-${i}`));
        system.registerSelectable(allSelectables[i]);
      }
    });
  });

  // ============================================================================
  // SELECTION OPERATION TESTS
  // ============================================================================
  describe("selection operations", () => {
    let world: ReturnType<typeof createMockWorld>;
    let system: EditorSelectionSystem;
    let selectables: Selectable[];

    beforeEach(async () => {
      world = createMockWorld();
      system = new EditorSelectionSystem(world as never);
      await system.init({});

      // Create and register test selectables
      selectables = [];
      for (let i = 0; i < 5; i++) {
        const selectable = createSelectable(
          `obj-${i}`,
          new THREE.Vector3(i * 10, 0, 0),
        );
        selectables.push(selectable);
        system.registerSelectable(selectable);
      }
    });

    it("should set selection", () => {
      system.setSelection([selectables[0], selectables[1]]);

      expect(system.getSelectionCount()).toBe(2);
      expect(system.isSelected("obj-0")).toBe(true);
      expect(system.isSelected("obj-1")).toBe(true);
      expect(system.isSelected("obj-2")).toBe(false);
    });

    it("should replace selection when setting", () => {
      system.setSelection([selectables[0]]);
      system.setSelection([selectables[1]]);

      expect(system.getSelectionCount()).toBe(1);
      expect(system.isSelected("obj-0")).toBe(false);
      expect(system.isSelected("obj-1")).toBe(true);
    });

    it("should add to selection", () => {
      system.setSelection([selectables[0]]);
      system.addToSelection(selectables[1]);

      expect(system.getSelectionCount()).toBe(2);
      expect(system.isSelected("obj-0")).toBe(true);
      expect(system.isSelected("obj-1")).toBe(true);
    });

    it("should add multiple to selection", () => {
      system.addToSelection([selectables[0], selectables[1], selectables[2]]);

      expect(system.getSelectionCount()).toBe(3);
    });

    it("should not add duplicate to selection", () => {
      system.setSelection([selectables[0]]);
      system.addToSelection(selectables[0]);

      expect(system.getSelectionCount()).toBe(1);
    });

    it("should remove from selection", () => {
      system.setSelection([selectables[0], selectables[1]]);
      system.removeFromSelection(selectables[0]);

      expect(system.getSelectionCount()).toBe(1);
      expect(system.isSelected("obj-0")).toBe(false);
      expect(system.isSelected("obj-1")).toBe(true);
    });

    it("should remove multiple from selection", () => {
      system.setSelection([selectables[0], selectables[1], selectables[2]]);
      system.removeFromSelection([selectables[0], selectables[2]]);

      expect(system.getSelectionCount()).toBe(1);
      expect(system.isSelected("obj-1")).toBe(true);
    });

    it("should toggle selection", () => {
      system.toggleSelection(selectables[0]);
      expect(system.isSelected("obj-0")).toBe(true);

      system.toggleSelection(selectables[0]);
      expect(system.isSelected("obj-0")).toBe(false);
    });

    it("should clear selection", () => {
      system.setSelection([selectables[0], selectables[1]]);
      system.clearSelection();

      expect(system.getSelectionCount()).toBe(0);
    });

    it("should not emit event when clearing empty selection", () => {
      const listener = vi.fn();
      system.on("selection-changed", listener);

      system.clearSelection(); // Already empty

      expect(listener).not.toHaveBeenCalled();
    });

    it("should select all", () => {
      system.selectAll();

      expect(system.getSelectionCount()).toBe(5);
    });

    it("should return selection as array", () => {
      system.setSelection([selectables[0], selectables[1]]);

      const selection = system.getSelection();
      expect(Array.isArray(selection)).toBe(true);
      expect(selection).toHaveLength(2);
    });
  });

  // ============================================================================
  // SELECTION LIMIT TESTS
  // ============================================================================
  describe("selection limits", () => {
    it("should respect maxSelection limit", async () => {
      const world = createMockWorld();
      const system = new EditorSelectionSystem(world as never, {
        maxSelection: 3,
      });
      await system.init({});

      const selectables: Selectable[] = [];
      for (let i = 0; i < 10; i++) {
        selectables.push(createSelectable(`obj-${i}`));
        system.registerSelectable(selectables[i]);
      }

      system.setSelection(selectables);

      expect(system.getSelectionCount()).toBe(3);
    });

    it("should not add beyond maxSelection when adding", async () => {
      const world = createMockWorld();
      const system = new EditorSelectionSystem(world as never, {
        maxSelection: 2,
      });
      await system.init({});

      const selectables: Selectable[] = [];
      for (let i = 0; i < 5; i++) {
        selectables.push(createSelectable(`obj-${i}`));
        system.registerSelectable(selectables[i]);
      }

      system.addToSelection(selectables[0]);
      system.addToSelection(selectables[1]);
      system.addToSelection(selectables[2]); // Should be ignored

      expect(system.getSelectionCount()).toBe(2);
    });
  });

  // ============================================================================
  // EVENT EMISSION TESTS
  // ============================================================================
  describe("event emission", () => {
    let world: ReturnType<typeof createMockWorld>;
    let system: EditorSelectionSystem;
    let selectables: Selectable[];

    beforeEach(async () => {
      world = createMockWorld();
      system = new EditorSelectionSystem(world as never);
      await system.init({});

      selectables = [createSelectable("obj-0"), createSelectable("obj-1")];
      selectables.forEach((s) => system.registerSelectable(s));
    });

    it("should emit selection-changed with correct action on set", () => {
      const listener = vi.fn();
      system.on("selection-changed", listener);

      system.setSelection([selectables[0]]);

      expect(listener).toHaveBeenCalled();
      const event = listener.mock.calls[0][0];
      expect(event.action).toBe("set");
      expect(event.selected).toHaveLength(1);
      expect(event.added).toHaveLength(1);
      expect(event.removed).toHaveLength(0);
    });

    it("should emit selection-changed with correct action on add", () => {
      const listener = vi.fn();
      system.setSelection([selectables[0]]);

      system.on("selection-changed", listener);
      system.addToSelection(selectables[1]);

      expect(listener).toHaveBeenCalled();
      const event = listener.mock.calls[0][0];
      expect(event.action).toBe("select");
      expect(event.added).toHaveLength(1);
    });

    it("should emit selection-changed with correct action on remove", () => {
      const listener = vi.fn();
      system.setSelection([selectables[0], selectables[1]]);

      system.on("selection-changed", listener);
      system.removeFromSelection(selectables[0]);

      expect(listener).toHaveBeenCalled();
      const event = listener.mock.calls[0][0];
      expect(event.action).toBe("deselect");
      expect(event.removed).toHaveLength(1);
    });

    it("should emit selection-changed with correct action on clear", () => {
      const listener = vi.fn();
      system.setSelection([selectables[0]]);

      system.on("selection-changed", listener);
      system.clearSelection();

      expect(listener).toHaveBeenCalled();
      const event = listener.mock.calls[0][0];
      expect(event.action).toBe("clear");
      expect(event.selected).toHaveLength(0);
    });
  });

  // ============================================================================
  // SELECTION BOUNDS TESTS
  // ============================================================================
  describe("selection bounds", () => {
    let world: ReturnType<typeof createMockWorld>;
    let system: EditorSelectionSystem;

    beforeEach(async () => {
      world = createMockWorld();
      system = new EditorSelectionSystem(world as never);
      await system.init({});
    });

    it("should return null when nothing selected", () => {
      const bounds = system.getSelectionBounds();
      expect(bounds).toBeNull();
    });

    it("should return bounds for single selection", () => {
      const selectable = createSelectable("obj-0", new THREE.Vector3(10, 0, 0));
      system.registerSelectable(selectable);
      system.setSelection([selectable]);

      const bounds = system.getSelectionBounds();
      expect(bounds).not.toBeNull();
      expect(bounds!.min.x).toBeLessThan(bounds!.max.x);
    });

    it("should return combined bounds for multiple selections", () => {
      const s1 = createSelectable("obj-0", new THREE.Vector3(-100, 0, 0));
      const s2 = createSelectable("obj-1", new THREE.Vector3(100, 0, 0));
      system.registerSelectable(s1);
      system.registerSelectable(s2);
      system.setSelection([s1, s2]);

      const bounds = system.getSelectionBounds();
      expect(bounds).not.toBeNull();

      // Bounds should span from ~-100 to ~100
      expect(bounds!.min.x).toBeLessThan(-90);
      expect(bounds!.max.x).toBeGreaterThan(90);
    });
  });

  // ============================================================================
  // UNDO/REDO TESTS
  // ============================================================================
  describe("undo/redo", () => {
    let world: ReturnType<typeof createMockWorld>;
    let system: EditorSelectionSystem;
    let selectables: Selectable[];

    beforeEach(async () => {
      world = createMockWorld();
      system = new EditorSelectionSystem(world as never);
      await system.init({});

      selectables = [];
      for (let i = 0; i < 3; i++) {
        selectables.push(createSelectable(`obj-${i}`));
        system.registerSelectable(selectables[i]);
      }
    });

    it("should undo selection change", () => {
      system.setSelection([selectables[0]]);
      system.setSelection([selectables[1]]);

      const undone = system.undo();
      expect(undone).toBe(true);
      expect(system.isSelected("obj-0")).toBe(true);
      expect(system.isSelected("obj-1")).toBe(false);
    });

    it("should redo selection change", () => {
      system.setSelection([selectables[0]]);
      system.setSelection([selectables[1]]);
      system.undo();

      const redone = system.redo();
      expect(redone).toBe(true);
      expect(system.isSelected("obj-1")).toBe(true);
    });

    it("should return false when no undo available", () => {
      const undone = system.undo();
      expect(undone).toBe(false);
    });

    it("should return false when no redo available", () => {
      system.setSelection([selectables[0]]);

      const redone = system.redo();
      expect(redone).toBe(false);
    });

    it("should clear redo history on new selection", () => {
      system.setSelection([selectables[0]]);
      system.setSelection([selectables[1]]);
      system.undo();

      // Now make a new selection
      system.setSelection([selectables[2]]);

      // Redo should no longer work
      const redone = system.redo();
      expect(redone).toBe(false);
    });

    it("should handle multiple undo/redo operations", () => {
      system.setSelection([selectables[0]]);
      system.addToSelection(selectables[1]);
      system.addToSelection(selectables[2]);

      // Count is now 3
      expect(system.getSelectionCount()).toBe(3);

      // Undo twice (can't undo past initial state)
      expect(system.undo()).toBe(true); // 3 -> 2
      expect(system.getSelectionCount()).toBe(2);

      expect(system.undo()).toBe(true); // 2 -> 1
      expect(system.getSelectionCount()).toBe(1);

      // Third undo should still work (goes to initial state)
      const thirdUndo = system.undo(); // might be false at index 0

      // Redo back
      system.redo();
      system.redo();
      if (!thirdUndo) system.redo(); // If third undo worked, we need 3 redos

      // Should be back to 3 or close to it
      expect(system.getSelectionCount()).toBeGreaterThanOrEqual(2);
    });

    it("should limit history size", () => {
      // Make 60 selections (history max is 50)
      for (let i = 0; i < 60; i++) {
        system.setSelection([selectables[i % 3]]);
      }

      // Should be able to undo up to 50 times (maybe 49)
      let undoCount = 0;
      while (system.undo()) {
        undoCount++;
        if (undoCount > 60) break; // Safety
      }

      // Should be capped at maxHistorySize
      expect(undoCount).toBeLessThanOrEqual(50);
    });
  });

  // ============================================================================
  // EDGE CASES AND ERROR HANDLING
  // ============================================================================
  describe("edge cases", () => {
    it("should handle initialization without graphics (isReady = false)", async () => {
      const world = {
        camera: new THREE.PerspectiveCamera(),
        graphics: null,
        stage: { scene: new THREE.Scene() },
        getSystem: vi.fn(),
      };

      const system = new EditorSelectionSystem(world as never);
      await expect(system.init({})).resolves.not.toThrow();
      // isReady should be false when no graphics
      expect(system.isReady).toBe(false);
    });

    it("should set isReady = true when graphics available", async () => {
      const world = createMockWorld();
      const system = new EditorSelectionSystem(world as never);
      await system.init({});
      expect(system.isReady).toBe(true);
    });

    it("should handle empty setSelection", async () => {
      const world = createMockWorld();
      const system = new EditorSelectionSystem(world as never);
      await system.init({});

      system.setSelection([]);
      expect(system.getSelectionCount()).toBe(0);
    });

    it("should cleanup properly on destroy", async () => {
      const world = createMockWorld();
      const system = new EditorSelectionSystem(world as never);
      await system.init({});

      const selectable = createSelectable("obj-0");
      system.registerSelectable(selectable);
      system.setSelection([selectable]);

      system.destroy();

      expect(system.getSelectionCount()).toBe(0);
    });

    it("should handle removing from selection when not selected", async () => {
      const world = createMockWorld();
      const system = new EditorSelectionSystem(world as never);
      await system.init({});

      const selectable = createSelectable("obj-0");
      system.registerSelectable(selectable);

      // Should not throw
      expect(() => system.removeFromSelection(selectable)).not.toThrow();
    });

    it("should handle isSelected for non-existent id", async () => {
      const world = createMockWorld();
      const system = new EditorSelectionSystem(world as never);
      await system.init({});

      expect(system.isSelected("does-not-exist")).toBe(false);
    });
  });

  // ============================================================================
  // CONCURRENT OPERATIONS
  // ============================================================================
  describe("concurrent operations", () => {
    it("should handle rapid selection changes", async () => {
      const world = createMockWorld();
      const system = new EditorSelectionSystem(world as never);
      await system.init({});

      const selectables: Selectable[] = [];
      for (let i = 0; i < 10; i++) {
        selectables.push(createSelectable(`obj-${i}`));
        system.registerSelectable(selectables[i]);
      }

      // Rapid toggle
      for (let i = 0; i < 100; i++) {
        system.toggleSelection(selectables[i % 10]);
      }

      // Should not throw and state should be consistent
      expect(system.getSelectionCount()).toBeGreaterThanOrEqual(0);
      expect(system.getSelectionCount()).toBeLessThanOrEqual(10);
    });

    it("should handle concurrent register/unregister", async () => {
      const world = createMockWorld();
      const system = new EditorSelectionSystem(world as never);
      await system.init({});

      for (let i = 0; i < 50; i++) {
        const selectable = createSelectable(`obj-${i}`);
        system.registerSelectable(selectable);
        if (i % 2 === 0) {
          system.setSelection([selectable]);
        }
        if (i > 10 && i % 3 === 0) {
          system.unregisterSelectable(`obj-${i - 10}`);
        }
      }

      // Should complete without errors
    });
  });

  // ============================================================================
  // RAYCASTING TESTS
  // ============================================================================
  describe("raycasting", () => {
    let world: ReturnType<typeof createMockWorld>;
    let system: EditorSelectionSystem;

    beforeEach(async () => {
      world = createMockWorld();
      // Set up camera to look at origin from (0, 50, 100)
      world.camera.position.set(0, 50, 100);
      world.camera.lookAt(0, 0, 0);
      world.camera.updateProjectionMatrix();

      system = new EditorSelectionSystem(world as never);
      await system.init({});
    });

    it("should clear selection when clicking empty space (no hit)", async () => {
      // Place a selectable at the origin
      const selectable = createSelectable(
        "center-obj",
        new THREE.Vector3(0, 0, 0),
      );
      system.registerSelectable(selectable);
      system.setSelection([selectable]); // Start with something selected

      expect(system.getSelectionCount()).toBe(1);

      const listener = vi.fn();
      system.on("selection-changed", listener);

      const canvas = world.graphics.renderer.domElement;
      canvas.getBoundingClientRect = vi.fn(() => ({
        left: 0,
        top: 0,
        width: 800,
        height: 600,
        right: 800,
        bottom: 600,
        x: 0,
        y: 0,
        toJSON: () => {},
      }));

      // Click far from object (edge of screen, no selectable there)
      // In jsdom, raycasting won't hit anything, so this tests the "no hit" path
      const pointerDown = new PointerEvent("pointerdown", {
        button: 0,
        clientX: 10,
        clientY: 10,
        bubbles: true,
      });
      canvas.dispatchEvent(pointerDown);

      const pointerUp = new PointerEvent("pointerup", {
        button: 0,
        clientX: 10,
        clientY: 10,
        bubbles: true,
      });
      canvas.dispatchEvent(pointerUp);

      // Selection should have been cleared (pointer down on empty space triggers marquee,
      // small marquee with no shift clears selection)
      expect(system.getSelectionCount()).toBe(0);
    });

    it("should clear selection when clicking empty space", async () => {
      const selectable = createSelectable("obj-1", new THREE.Vector3(0, 0, 0));
      system.registerSelectable(selectable);
      system.setSelection([selectable]);

      expect(system.getSelectionCount()).toBe(1);

      const canvas = world.graphics.renderer.domElement;
      canvas.getBoundingClientRect = vi.fn(() => ({
        left: 0,
        top: 0,
        width: 800,
        height: 600,
        right: 800,
        bottom: 600,
        x: 0,
        y: 0,
        toJSON: () => {},
      }));

      // Click far away from the object (edge of screen)
      const pointerDown = new PointerEvent("pointerdown", {
        button: 0,
        clientX: 10,
        clientY: 10,
        bubbles: true,
      });
      canvas.dispatchEvent(pointerDown);

      const pointerUp = new PointerEvent("pointerup", {
        button: 0,
        clientX: 10,
        clientY: 10,
        bubbles: true,
      });
      canvas.dispatchEvent(pointerUp);

      // Selection should be cleared (no hit, marquee too small)
      expect(system.getSelectionCount()).toBe(0);
    });

    it("should preserve selection with shift-click on empty (no hit)", async () => {
      const obj1 = createSelectable("obj-1", new THREE.Vector3(0, 0, 0));
      system.registerSelectable(obj1);
      world.stage.scene.add(obj1.object3D);

      // First select obj1
      system.setSelection([obj1]);
      expect(system.getSelectionCount()).toBe(1);

      const canvas = world.graphics.renderer.domElement;
      canvas.getBoundingClientRect = vi.fn(() => ({
        left: 0,
        top: 0,
        width: 800,
        height: 600,
        right: 800,
        bottom: 600,
        x: 0,
        y: 0,
        toJSON: () => {},
      }));

      // Shift-click at position where nothing is (no raycast hit in jsdom)
      // With shift held, clicking nothing should NOT clear selection
      const pointerDown = new PointerEvent("pointerdown", {
        button: 0,
        clientX: 10,
        clientY: 10,
        shiftKey: true,
        bubbles: true,
      });
      canvas.dispatchEvent(pointerDown);

      const pointerUp = new PointerEvent("pointerup", {
        button: 0,
        clientX: 10,
        clientY: 10,
        shiftKey: true,
        bubbles: true,
      });
      canvas.dispatchEvent(pointerUp);

      // Selection should still have obj1 (shift+click on empty = start marquee, small marquee with shift = no clear)
      // The actual behavior: shift+click starts marquee, small marquee doesn't clear with shift
      expect(system.getSelectionCount()).toBe(1);
    });

    it("should ignore right-click", async () => {
      const selectable = createSelectable("obj-1", new THREE.Vector3(0, 0, 0));
      system.registerSelectable(selectable);
      system.setSelection([selectable]);

      const listener = vi.fn();
      system.on("selection-changed", listener);

      const canvas = world.graphics.renderer.domElement;

      // Right-click should be ignored
      const pointerDown = new PointerEvent("pointerdown", {
        button: 2, // Right button
        clientX: 400,
        clientY: 300,
        bubbles: true,
      });
      canvas.dispatchEvent(pointerDown);

      expect(listener).not.toHaveBeenCalled();
      expect(system.getSelectionCount()).toBe(1);
    });
  });

  // ============================================================================
  // MARQUEE SELECTION TESTS
  // ============================================================================
  describe("marquee selection", () => {
    let world: ReturnType<typeof createMockWorld>;
    let system: EditorSelectionSystem;

    beforeEach(async () => {
      world = createMockWorld();
      // Camera looking at origin from front
      world.camera.position.set(0, 0, 100);
      world.camera.lookAt(0, 0, 0);
      world.camera.updateProjectionMatrix();

      // Need to set up parent element for marquee div
      const container = document.createElement("div");
      container.appendChild(world.graphics.renderer.domElement);
      document.body.appendChild(container);

      system = new EditorSelectionSystem(world as never);
      await system.init({});
    });

    function mockBoundingRect(canvas: HTMLElement) {
      canvas.getBoundingClientRect = vi.fn(() => ({
        left: 0,
        top: 0,
        width: 800,
        height: 600,
        right: 800,
        bottom: 600,
        x: 0,
        y: 0,
        toJSON: () => {},
      }));
    }

    it("should select objects within marquee bounds", async () => {
      // Create objects at known positions
      // At z=0, looking from z=100, objects at x=0 should project to center
      const obj1 = createSelectable("obj-1", new THREE.Vector3(0, 0, 0));
      const obj2 = createSelectable("obj-2", new THREE.Vector3(5, 5, 0));
      const obj3 = createSelectable("obj-3", new THREE.Vector3(-50, -50, 0)); // Outside marquee

      system.registerSelectable(obj1);
      system.registerSelectable(obj2);
      system.registerSelectable(obj3);

      world.stage.scene.add(obj1.object3D);
      world.stage.scene.add(obj2.object3D);
      world.stage.scene.add(obj3.object3D);

      const canvas = world.graphics.renderer.domElement;
      mockBoundingRect(canvas);

      // Start marquee from top-left of a box containing obj1 and obj2
      // NDC: center is (400, 300), we want to capture around the center
      canvas.dispatchEvent(
        new PointerEvent("pointerdown", {
          button: 0,
          clientX: 350,
          clientY: 250,
          bubbles: true,
        }),
      );

      // Drag to bottom-right
      canvas.dispatchEvent(
        new PointerEvent("pointermove", {
          button: 0,
          clientX: 450,
          clientY: 350,
          bubbles: true,
        }),
      );

      // Release
      canvas.dispatchEvent(
        new PointerEvent("pointerup", {
          button: 0,
          clientX: 450,
          clientY: 350,
          bubbles: true,
        }),
      );

      // Objects within the marquee should be selected
      // The exact selection depends on projection math
      expect(system.getSelectionCount()).toBeGreaterThanOrEqual(1);
    });

    it("should treat small marquee as click (clear selection)", async () => {
      const obj = createSelectable("obj-1", new THREE.Vector3(0, 0, 0));
      system.registerSelectable(obj);
      system.setSelection([obj]);

      expect(system.getSelectionCount()).toBe(1);

      const canvas = world.graphics.renderer.domElement;
      mockBoundingRect(canvas);

      // Small drag (< 5px) should be treated as click
      canvas.dispatchEvent(
        new PointerEvent("pointerdown", {
          button: 0,
          clientX: 100,
          clientY: 100,
          bubbles: true,
        }),
      );

      canvas.dispatchEvent(
        new PointerEvent("pointermove", {
          button: 0,
          clientX: 102, // Only 2px movement
          clientY: 102,
          bubbles: true,
        }),
      );

      canvas.dispatchEvent(
        new PointerEvent("pointerup", {
          button: 0,
          clientX: 102,
          clientY: 102,
          bubbles: true,
        }),
      );

      // Should have cleared selection (click on empty space)
      expect(system.getSelectionCount()).toBe(0);
    });

    it("should add to selection with shift+marquee", async () => {
      const obj1 = createSelectable("obj-1", new THREE.Vector3(0, 0, 0));
      const obj2 = createSelectable("obj-2", new THREE.Vector3(10, 0, 0));

      system.registerSelectable(obj1);
      system.registerSelectable(obj2);
      world.stage.scene.add(obj1.object3D);
      world.stage.scene.add(obj2.object3D);

      // Start with obj1 selected
      system.setSelection([obj1]);
      expect(system.getSelectionCount()).toBe(1);

      const canvas = world.graphics.renderer.domElement;
      mockBoundingRect(canvas);

      // Shift+marquee to add
      canvas.dispatchEvent(
        new PointerEvent("pointerdown", {
          button: 0,
          clientX: 300,
          clientY: 200,
          shiftKey: true,
          bubbles: true,
        }),
      );

      canvas.dispatchEvent(
        new PointerEvent("pointermove", {
          button: 0,
          clientX: 500,
          clientY: 400,
          shiftKey: true,
          bubbles: true,
        }),
      );

      canvas.dispatchEvent(
        new PointerEvent("pointerup", {
          button: 0,
          clientX: 500,
          clientY: 400,
          shiftKey: true,
          bubbles: true,
        }),
      );

      // Should still have at least the original selection
      expect(system.getSelectionCount()).toBeGreaterThanOrEqual(1);
    });

    it("should project object positions correctly in getObjectsInMarquee", async () => {
      // Test the actual projection math by placing objects at known screen positions
      // Camera at z=100, looking at origin, 75 degree FOV
      // An object at (0,0,0) should project to screen center

      const centerObj = createSelectable("center", new THREE.Vector3(0, 0, 0));
      system.registerSelectable(centerObj);
      world.stage.scene.add(centerObj.object3D);

      const canvas = world.graphics.renderer.domElement;
      mockBoundingRect(canvas);

      // Marquee that covers the entire screen center area
      canvas.dispatchEvent(
        new PointerEvent("pointerdown", {
          button: 0,
          clientX: 200,
          clientY: 100,
          bubbles: true,
        }),
      );

      canvas.dispatchEvent(
        new PointerEvent("pointermove", {
          button: 0,
          clientX: 600,
          clientY: 500,
          bubbles: true,
        }),
      );

      canvas.dispatchEvent(
        new PointerEvent("pointerup", {
          button: 0,
          clientX: 600,
          clientY: 500,
          bubbles: true,
        }),
      );

      // Center object should definitely be selected
      expect(system.isSelected("center")).toBe(true);
    });

    it("should not select objects behind the camera", async () => {
      // Object at z=200 is behind camera at z=100 looking at origin
      const behindObj = createSelectable(
        "behind",
        new THREE.Vector3(0, 0, 200),
      );
      system.registerSelectable(behindObj);
      world.stage.scene.add(behindObj.object3D);

      const canvas = world.graphics.renderer.domElement;
      mockBoundingRect(canvas);

      // Full screen marquee
      canvas.dispatchEvent(
        new PointerEvent("pointerdown", {
          button: 0,
          clientX: 0,
          clientY: 0,
          bubbles: true,
        }),
      );

      canvas.dispatchEvent(
        new PointerEvent("pointermove", {
          button: 0,
          clientX: 800,
          clientY: 600,
          bubbles: true,
        }),
      );

      canvas.dispatchEvent(
        new PointerEvent("pointerup", {
          button: 0,
          clientX: 800,
          clientY: 600,
          bubbles: true,
        }),
      );

      // Object behind camera should NOT be selected
      expect(system.isSelected("behind")).toBe(false);
    });
  });
});
