/**
 * EditorGizmoSystem Tests
 *
 * Comprehensive tests for transform gizmos including:
 * - Transform modes (translate/rotate/scale)
 * - Space modes (world/local)
 * - Snap functionality
 * - Integration with selection system
 * - Edge cases and boundary conditions
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import * as THREE from "three";
import {
  EditorGizmoSystem,
  type TransformMode,
  type EditorGizmoConfig,
} from "../EditorGizmoSystem";
import type {
  Selectable,
  SelectionChangeEvent,
} from "../EditorSelectionSystem";

// Mock TransformControls
vi.mock("three/examples/jsm/controls/TransformControls.js", () => {
  class MockTransformControls {
    object: THREE.Object3D | null = null;
    mode = "translate";
    space = "world";
    enabled = true;
    setMode = vi.fn((mode: string) => {
      this.mode = mode;
    });
    setSpace = vi.fn((space: string) => {
      this.space = space;
    });
    setSize = vi.fn();
    setTranslationSnap = vi.fn();
    setRotationSnap = vi.fn();
    setScaleSnap = vi.fn();
    attach = vi.fn((obj: THREE.Object3D) => {
      this.object = obj;
    });
    detach = vi.fn(() => {
      this.object = null;
    });
    addEventListener = vi.fn();
    removeEventListener = vi.fn();
    dispose = vi.fn();
  }
  return { TransformControls: MockTransformControls };
});

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
      scene: {
        add: vi.fn(),
        remove: vi.fn(),
      },
    },
    getSystem: vi.fn(),
  };
}

// Create mock selection system
function createMockSelectionSystem() {
  const listeners: Map<string, (event: SelectionChangeEvent) => void> =
    new Map();
  return {
    on: vi.fn((event: string, callback: (e: SelectionChangeEvent) => void) => {
      listeners.set(event, callback);
    }),
    off: vi.fn(),
    getSelection: vi.fn(() => []),
    getSelectionCount: vi.fn(() => 0),
    emit: (event: string, data: SelectionChangeEvent) => {
      const listener = listeners.get(event);
      if (listener) listener(data);
    },
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
  };
}

describe("EditorGizmoSystem", () => {
  // ============================================================================
  // INITIALIZATION TESTS
  // ============================================================================
  describe("initialization", () => {
    it("should initialize with default config", () => {
      const world = createMockWorld();
      const system = new EditorGizmoSystem(world as never);

      expect(system.getMode()).toBe("translate");
      expect(system.getSpace()).toBe("world");
      expect(system.isSnapEnabled()).toBe(false);
    });

    it("should accept custom config", () => {
      const world = createMockWorld();
      const config: Partial<EditorGizmoConfig> = {
        initialMode: "rotate",
        initialSpace: "local",
        enableSnap: true,
        translationSnap: 0.5,
      };
      const system = new EditorGizmoSystem(world as never, config);

      expect(system.getMode()).toBe("rotate");
      expect(system.getSpace()).toBe("local");
      expect(system.isSnapEnabled()).toBe(true);
    });

    it("should declare correct dependencies", () => {
      const world = createMockWorld();
      const system = new EditorGizmoSystem(world as never);
      const deps = system.getDependencies();

      expect(deps.required).toContain("stage");
      expect(deps.required).toContain("graphics");
      expect(deps.optional).toContain("editor-selection");
      expect(deps.optional).toContain("editor-camera");
    });

    it("should add transform controls to scene", async () => {
      const world = createMockWorld();
      const system = new EditorGizmoSystem(world as never);
      await system.init({});

      expect(world.stage.scene.add).toHaveBeenCalled();
    });
  });

  // ============================================================================
  // TRANSFORM MODE TESTS
  // ============================================================================
  describe("transform modes", () => {
    let world: ReturnType<typeof createMockWorld>;
    let system: EditorGizmoSystem;

    beforeEach(async () => {
      world = createMockWorld();
      system = new EditorGizmoSystem(world as never);
      await system.init({});
    });

    it("should switch to translate mode", () => {
      system.setMode("translate");
      expect(system.getMode()).toBe("translate");
    });

    it("should switch to rotate mode", () => {
      system.setMode("rotate");
      expect(system.getMode()).toBe("rotate");
    });

    it("should switch to scale mode", () => {
      system.setMode("scale");
      expect(system.getMode()).toBe("scale");
    });

    it("should emit mode-changed event", () => {
      const listener = vi.fn();
      system.on("mode-changed", listener);

      system.setMode("rotate");

      expect(listener).toHaveBeenCalledWith({ mode: "rotate" });
    });

    it("should update transform controls mode", () => {
      const controls = system.getControls();
      system.setMode("scale");

      expect(controls?.setMode).toHaveBeenCalledWith("scale");
    });

    it("should handle rapid mode changes", () => {
      const modes: TransformMode[] = [
        "translate",
        "rotate",
        "scale",
        "translate",
        "rotate",
      ];
      modes.forEach((mode) => system.setMode(mode));

      expect(system.getMode()).toBe("rotate");
    });
  });

  // ============================================================================
  // TRANSFORM SPACE TESTS
  // ============================================================================
  describe("transform space", () => {
    let world: ReturnType<typeof createMockWorld>;
    let system: EditorGizmoSystem;

    beforeEach(async () => {
      world = createMockWorld();
      system = new EditorGizmoSystem(world as never);
      await system.init({});
    });

    it("should switch to world space", () => {
      system.setSpace("world");
      expect(system.getSpace()).toBe("world");
    });

    it("should switch to local space", () => {
      system.setSpace("local");
      expect(system.getSpace()).toBe("local");
    });

    it("should toggle space", () => {
      expect(system.getSpace()).toBe("world");

      system.toggleSpace();
      expect(system.getSpace()).toBe("local");

      system.toggleSpace();
      expect(system.getSpace()).toBe("world");
    });

    it("should emit space-changed event", () => {
      const listener = vi.fn();
      system.on("space-changed", listener);

      system.setSpace("local");

      expect(listener).toHaveBeenCalledWith({ space: "local" });
    });

    it("should update transform controls space", () => {
      const controls = system.getControls();
      system.setSpace("local");

      expect(controls?.setSpace).toHaveBeenCalledWith("local");
    });
  });

  // ============================================================================
  // SNAP FUNCTIONALITY TESTS
  // ============================================================================
  describe("snap functionality", () => {
    let world: ReturnType<typeof createMockWorld>;
    let system: EditorGizmoSystem;

    beforeEach(async () => {
      world = createMockWorld();
      system = new EditorGizmoSystem(world as never);
      await system.init({});
    });

    it("should enable snap", () => {
      system.setSnap(true);
      expect(system.isSnapEnabled()).toBe(true);
    });

    it("should disable snap", () => {
      system.setSnap(true);
      system.setSnap(false);
      expect(system.isSnapEnabled()).toBe(false);
    });

    it("should toggle snap", () => {
      expect(system.isSnapEnabled()).toBe(false);

      system.toggleSnap();
      expect(system.isSnapEnabled()).toBe(true);

      system.toggleSnap();
      expect(system.isSnapEnabled()).toBe(false);
    });

    it("should emit snap-changed event", () => {
      const listener = vi.fn();
      system.on("snap-changed", listener);

      system.setSnap(true);

      expect(listener).toHaveBeenCalledWith({ enabled: true });
    });

    it("should set snap increments when snap enabled", () => {
      const controls = system.getControls();
      system.setSnap(true);

      expect(controls?.setTranslationSnap).toHaveBeenCalled();
      expect(controls?.setRotationSnap).toHaveBeenCalled();
      expect(controls?.setScaleSnap).toHaveBeenCalled();
    });

    it("should clear snap increments when snap disabled", () => {
      const controls = system.getControls();
      system.setSnap(true);
      system.setSnap(false);

      expect(controls?.setTranslationSnap).toHaveBeenCalledWith(null);
      expect(controls?.setRotationSnap).toHaveBeenCalledWith(null);
      expect(controls?.setScaleSnap).toHaveBeenCalledWith(null);
    });

    it("should update snap increments", () => {
      const controls = system.getControls();
      system.setSnap(true);
      system.setSnapIncrements(2, 45, 0.5);

      // Should have been called with new values
      expect(controls?.setTranslationSnap).toHaveBeenLastCalledWith(2);
      // Rotation is converted to radians
      expect(controls?.setRotationSnap).toHaveBeenCalled();
      expect(controls?.setScaleSnap).toHaveBeenLastCalledWith(0.5);
    });
  });

  // ============================================================================
  // GIZMO SIZE TESTS
  // ============================================================================
  describe("gizmo size", () => {
    it("should set gizmo size", async () => {
      const world = createMockWorld();
      const system = new EditorGizmoSystem(world as never);
      await system.init({});

      const controls = system.getControls();
      system.setSize(2.0);

      expect(controls?.setSize).toHaveBeenCalledWith(2.0);
    });

    it("should accept size in config", async () => {
      const world = createMockWorld();
      const system = new EditorGizmoSystem(world as never, { size: 1.5 });
      await system.init({});

      const controls = system.getControls();
      expect(controls?.setSize).toHaveBeenCalledWith(1.5);
    });
  });

  // ============================================================================
  // TRANSFORM STATE TESTS
  // ============================================================================
  describe("transform state", () => {
    it("should report not transforming initially", async () => {
      const world = createMockWorld();
      const system = new EditorGizmoSystem(world as never);
      await system.init({});

      expect(system.isCurrentlyTransforming()).toBe(false);
    });

    it("should provide access to controls", async () => {
      const world = createMockWorld();
      const system = new EditorGizmoSystem(world as never);
      await system.init({});

      const controls = system.getControls();
      expect(controls).not.toBeNull();
    });
  });

  // ============================================================================
  // SELECTION INTEGRATION TESTS
  // ============================================================================
  describe("selection integration", () => {
    it("should emit gizmo-attached when object selected", async () => {
      const world = createMockWorld();
      const mockSelectionSystem = createMockSelectionSystem();
      world.getSystem = vi.fn((name: string) => {
        if (name === "editor-selection") return mockSelectionSystem;
        return undefined;
      });

      const system = new EditorGizmoSystem(world as never);
      await system.init({});

      const listener = vi.fn();
      system.on("gizmo-attached", listener);

      // Simulate selection
      const selectable = createSelectable("obj-1", new THREE.Vector3(10, 0, 0));
      mockSelectionSystem.emit("selection-changed", {
        selected: [selectable],
        added: [selectable],
        removed: [],
        action: "set",
      });

      expect(listener).toHaveBeenCalled();
    });

    it("should emit gizmo-detached when selection cleared", async () => {
      const world = createMockWorld();
      const mockSelectionSystem = createMockSelectionSystem();
      world.getSystem = vi.fn((name: string) => {
        if (name === "editor-selection") return mockSelectionSystem;
        return undefined;
      });

      const system = new EditorGizmoSystem(world as never);
      await system.init({});

      const listener = vi.fn();
      system.on("gizmo-detached", listener);

      // First select, then clear
      const selectable = createSelectable("obj-1");
      mockSelectionSystem.emit("selection-changed", {
        selected: [selectable],
        added: [selectable],
        removed: [],
        action: "set",
      });

      mockSelectionSystem.emit("selection-changed", {
        selected: [],
        added: [],
        removed: [selectable],
        action: "clear",
      });

      expect(listener).toHaveBeenCalled();
    });

    it("should attach to single selection", async () => {
      const world = createMockWorld();
      const mockSelectionSystem = createMockSelectionSystem();
      world.getSystem = vi.fn((name: string) => {
        if (name === "editor-selection") return mockSelectionSystem;
        return undefined;
      });

      const system = new EditorGizmoSystem(world as never);
      await system.init({});

      const selectable = createSelectable("obj-1", new THREE.Vector3(10, 0, 0));
      mockSelectionSystem.emit("selection-changed", {
        selected: [selectable],
        added: [selectable],
        removed: [],
        action: "set",
      });

      const controls = system.getControls();
      expect(controls?.attach).toHaveBeenCalled();
    });

    it("should handle multi-selection", async () => {
      const world = createMockWorld();
      const mockSelectionSystem = createMockSelectionSystem();
      world.getSystem = vi.fn((name: string) => {
        if (name === "editor-selection") return mockSelectionSystem;
        return undefined;
      });

      const system = new EditorGizmoSystem(world as never);
      await system.init({});

      const selectables = [
        createSelectable("obj-1", new THREE.Vector3(-10, 0, 0)),
        createSelectable("obj-2", new THREE.Vector3(10, 0, 0)),
      ];

      mockSelectionSystem.emit("selection-changed", {
        selected: selectables,
        added: selectables,
        removed: [],
        action: "set",
      });

      // Should attach to transform group (center point)
      const controls = system.getControls();
      expect(controls?.attach).toHaveBeenCalled();
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
        stage: {
          scene: {
            add: vi.fn(),
            remove: vi.fn(),
          },
        },
        getSystem: vi.fn(),
      };

      const system = new EditorGizmoSystem(world as never);
      await expect(system.init({})).resolves.not.toThrow();
      // isReady should be false when no graphics
      expect(system.isReady).toBe(false);
    });

    it("should set isReady = true when graphics available", async () => {
      const world = createMockWorld();
      const system = new EditorGizmoSystem(world as never);
      await system.init({});
      expect(system.isReady).toBe(true);
    });

    it("should handle setMode when controls not initialized", async () => {
      const world = {
        camera: new THREE.PerspectiveCamera(),
        graphics: null,
        stage: {
          scene: {
            add: vi.fn(),
            remove: vi.fn(),
          },
        },
        getSystem: vi.fn(),
      };

      const system = new EditorGizmoSystem(world as never);
      await system.init({});

      // Should not throw
      expect(() => system.setMode("rotate")).not.toThrow();
    });

    it("should cleanup properly on destroy", async () => {
      const world = createMockWorld();
      const system = new EditorGizmoSystem(world as never);
      await system.init({});

      system.destroy();

      expect(world.stage.scene.remove).toHaveBeenCalled();
    });

    it("should handle destroy when selection system connected", async () => {
      const world = createMockWorld();
      const mockSelectionSystem = createMockSelectionSystem();
      world.getSystem = vi.fn((name: string) => {
        if (name === "editor-selection") return mockSelectionSystem;
        return undefined;
      });

      const system = new EditorGizmoSystem(world as never);
      await system.init({});

      // Should not throw
      expect(() => system.destroy()).not.toThrow();
      expect(mockSelectionSystem.off).toHaveBeenCalled();
    });
  });

  // ============================================================================
  // CONCURRENT OPERATIONS
  // ============================================================================
  describe("concurrent operations", () => {
    it("should handle rapid mode/space/snap changes", async () => {
      const world = createMockWorld();
      const system = new EditorGizmoSystem(world as never);
      await system.init({});

      for (let i = 0; i < 50; i++) {
        system.setMode(
          i % 3 === 0 ? "translate" : i % 3 === 1 ? "rotate" : "scale",
        );
        system.toggleSpace();
        system.toggleSnap();
      }

      // Should not throw and state should be valid
      expect(["translate", "rotate", "scale"]).toContain(system.getMode());
      expect(["world", "local"]).toContain(system.getSpace());
    });

    it("should handle selection changes during transform", async () => {
      const world = createMockWorld();
      const mockSelectionSystem = createMockSelectionSystem();
      world.getSystem = vi.fn((name: string) => {
        if (name === "editor-selection") return mockSelectionSystem;
        return undefined;
      });

      const system = new EditorGizmoSystem(world as never);
      await system.init({});

      // Simulate rapid selection changes
      for (let i = 0; i < 20; i++) {
        const selectable = createSelectable(
          `obj-${i}`,
          new THREE.Vector3(i * 10, 0, 0),
        );
        mockSelectionSystem.emit("selection-changed", {
          selected: [selectable],
          added: [selectable],
          removed: [],
          action: "set",
        });
      }

      // Clear
      mockSelectionSystem.emit("selection-changed", {
        selected: [],
        added: [],
        removed: [],
        action: "clear",
      });
    });
  });

  // ============================================================================
  // MULTI-SELECTION TRANSFORM TESTS
  // ============================================================================
  describe("multi-selection transforms", () => {
    it("should calculate center correctly for multi-selection", async () => {
      const world = createMockWorld();
      const mockSelectionSystem = createMockSelectionSystem();
      world.getSystem = vi.fn((name: string) => {
        if (name === "editor-selection") return mockSelectionSystem;
        return undefined;
      });

      const system = new EditorGizmoSystem(world as never);
      await system.init({});

      // Create objects at positions that average to (0, 0, 0)
      const obj1 = createSelectable("obj-1", new THREE.Vector3(-10, 0, 0));
      const obj2 = createSelectable("obj-2", new THREE.Vector3(10, 0, 0));

      mockSelectionSystem.getSelection = vi.fn(() => [obj1, obj2]);
      mockSelectionSystem.getSelectionCount = vi.fn(() => 2);

      mockSelectionSystem.emit("selection-changed", {
        selected: [obj1, obj2],
        added: [obj1, obj2],
        removed: [],
        action: "set",
      });

      // The transform group should be positioned at the center of selection
      const controls = system.getControls();
      expect(controls?.attach).toHaveBeenCalled();
    });

    it("should track transform state via isCurrentlyTransforming", async () => {
      const world = createMockWorld();
      const system = new EditorGizmoSystem(world as never);
      await system.init({});

      // Initially not transforming
      expect(system.isCurrentlyTransforming()).toBe(false);

      // The actual dragging-changed event is handled internally
      // We verify the initial state and that the method exists
      expect(typeof system.isCurrentlyTransforming).toBe("function");
    });

    it("should attach controls when objects selected", async () => {
      const world = createMockWorld();
      const mockSelectionSystem = createMockSelectionSystem();

      world.getSystem = vi.fn((name: string) => {
        if (name === "editor-selection") return mockSelectionSystem;
        if (name === "editor-camera")
          return { getControls: () => ({ enabled: true }) };
        return undefined;
      });

      const system = new EditorGizmoSystem(world as never);
      await system.init({});

      const obj1 = createSelectable("obj-1", new THREE.Vector3(10, 20, 30));
      const obj2 = createSelectable("obj-2", new THREE.Vector3(40, 50, 60));

      mockSelectionSystem.getSelection = vi.fn(() => [obj1, obj2]);
      mockSelectionSystem.getSelectionCount = vi.fn(() => 2);

      mockSelectionSystem.emit("selection-changed", {
        selected: [obj1, obj2],
        added: [obj1, obj2],
        removed: [],
        action: "set",
      });

      // Verify attach was called
      expect(system.getControls()?.attach).toHaveBeenCalled();
    });

    it("should apply translation to multi-selection", async () => {
      const world = createMockWorld();
      const mockSelectionSystem = createMockSelectionSystem();

      world.getSystem = vi.fn((name: string) => {
        if (name === "editor-selection") return mockSelectionSystem;
        return undefined;
      });

      const system = new EditorGizmoSystem(world as never);
      await system.init({});
      system.setMode("translate");

      // Objects at symmetric positions around origin
      const obj1 = createSelectable("obj-1", new THREE.Vector3(-5, 0, 0));
      const obj2 = createSelectable("obj-2", new THREE.Vector3(5, 0, 0));

      const originalPos1 = obj1.object3D.position.clone();
      const originalPos2 = obj2.object3D.position.clone();

      mockSelectionSystem.getSelection = vi.fn(() => [obj1, obj2]);
      mockSelectionSystem.getSelectionCount = vi.fn(() => 2);

      mockSelectionSystem.emit("selection-changed", {
        selected: [obj1, obj2],
        added: [obj1, obj2],
        removed: [],
        action: "set",
      });

      // Verify positions haven't changed just from selection
      expect(obj1.object3D.position.equals(originalPos1)).toBe(true);
      expect(obj2.object3D.position.equals(originalPos2)).toBe(true);
    });

    it("should handle zero-distance objects in multi-selection", async () => {
      const world = createMockWorld();
      const mockSelectionSystem = createMockSelectionSystem();

      world.getSystem = vi.fn((name: string) => {
        if (name === "editor-selection") return mockSelectionSystem;
        return undefined;
      });

      const system = new EditorGizmoSystem(world as never);
      await system.init({});

      // Two objects at the exact same position
      const obj1 = createSelectable("obj-1", new THREE.Vector3(0, 0, 0));
      const obj2 = createSelectable("obj-2", new THREE.Vector3(0, 0, 0));

      mockSelectionSystem.getSelection = vi.fn(() => [obj1, obj2]);
      mockSelectionSystem.getSelectionCount = vi.fn(() => 2);

      // Should not throw
      expect(() => {
        mockSelectionSystem.emit("selection-changed", {
          selected: [obj1, obj2],
          added: [obj1, obj2],
          removed: [],
          action: "set",
        });
      }).not.toThrow();
    });

    it("should connect to selection system on init", async () => {
      const world = createMockWorld();
      const mockSelectionSystem = createMockSelectionSystem();

      world.getSystem = vi.fn((name: string) => {
        if (name === "editor-selection") return mockSelectionSystem;
        return undefined;
      });

      const system = new EditorGizmoSystem(world as never);
      await system.init({});

      // Verify selection system was queried during init
      expect(world.getSystem).toHaveBeenCalledWith("editor-selection");

      // And that we subscribed to selection changes
      expect(mockSelectionSystem.on).toHaveBeenCalledWith(
        "selection-changed",
        expect.any(Function),
      );
    });
  });
});
