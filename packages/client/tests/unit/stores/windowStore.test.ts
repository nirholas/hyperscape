/**
 * Window Store Migration Tests
 *
 * Tests for the versioned migration system in windowStore.
 * Ensures migrations transform state correctly when upgrading
 * from older schema versions.
 *
 * @packageDocumentation
 */

import { describe, it, expect, beforeEach } from "vitest";

// Types that match windowStore's internal types
interface WindowState {
  id: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  minSize?: { width: number; height: number };
  maxSize?: { width: number; height: number };
  aspectRatio?: number;
  tabs: TabState[];
  activeTabIndex: number;
  transparency: number;
  visible: boolean;
  zIndex: number;
  locked: boolean;
  anchor?: WindowAnchor;
}

interface TabState {
  id: string;
  windowId: string;
  label: string;
  icon?: string;
  closeable: boolean;
  content: string;
}

type WindowAnchor =
  | "top-left"
  | "top-center"
  | "top-right"
  | "left-center"
  | "center"
  | "right-center"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

type MigrationFn = (
  windows: Map<string, WindowState>,
) => Map<string, WindowState>;

// ============================================================================
// Migration Functions (extracted from windowStore for testing)
// These mirror the exact logic from windowStore.ts
// ============================================================================

const migrations: Record<number, MigrationFn> = {
  // Migration 1 → 2: Remove maxSize from minimap/chat windows
  2: (windows) => {
    const migrated = new Map<string, WindowState>();
    for (const [id, windowState] of windows) {
      const shouldRemoveMaxSize =
        id === "minimap-window" ||
        id.startsWith("panel-chat-") ||
        id.startsWith("panel-minimap-");

      if (shouldRemoveMaxSize && windowState.maxSize !== undefined) {
        const { maxSize: _, ...rest } = windowState;
        migrated.set(id, rest as WindowState);
      } else {
        migrated.set(id, windowState);
      }
    }
    return migrated;
  },

  // Migration 2 → 3: Remove maxSize from menubar windows
  3: (windows) => {
    const migrated = new Map<string, WindowState>();
    for (const [id, windowState] of windows) {
      const shouldRemoveMaxSize =
        id.startsWith("panel-menubar-") || id === "menubar-window";

      if (shouldRemoveMaxSize && windowState.maxSize !== undefined) {
        const { maxSize: _, ...rest } = windowState;
        migrated.set(id, rest as WindowState);
      } else {
        migrated.set(id, windowState);
      }
    }
    return migrated;
  },

  // Migration 5 → 6: Remove aspectRatio from minimap windows
  6: (windows) => {
    const migrated = new Map<string, WindowState>();
    for (const [id, windowState] of windows) {
      const isMinimap =
        id.startsWith("panel-minimap-") || id === "minimap-window";

      if (isMinimap && windowState.aspectRatio !== undefined) {
        const { aspectRatio: _, ...rest } = windowState;
        migrated.set(id, rest as WindowState);
      } else {
        migrated.set(id, windowState);
      }
    }
    return migrated;
  },

  // Migration 10 → 11: Clear all windows for new default layout
  11: () => {
    return new Map<string, WindowState>();
  },

  // Migration 12 → 13: Add anchor property to windows
  13: (windows) => {
    const migrated = new Map<string, WindowState>();
    for (const [id, windowState] of windows) {
      const anchor = windowState.anchor ?? getDefaultAnchor(id);
      migrated.set(id, {
        ...windowState,
        anchor,
      });
    }
    return migrated;
  },

  // Migration 14 → 15: Clear all windows for improved flush layout
  15: () => {
    return new Map<string, WindowState>();
  },
};

// Helper function matching windowStore's getDefaultAnchor
function getDefaultAnchor(windowId: string): WindowAnchor {
  const id = windowId.toLowerCase();

  if (id.includes("chat") || id.includes("skills") || id.includes("prayer")) {
    return "bottom-left";
  }
  if (id.includes("minimap")) {
    return "top-right";
  }
  if (
    id.includes("inventory") ||
    id.includes("equipment") ||
    id.includes("menubar") ||
    id.includes("menu-bar")
  ) {
    return "bottom-right";
  }
  if (id.includes("actionbar") || id.includes("action-bar")) {
    return "bottom-center";
  }
  return "top-left";
}

// Run migrations incrementally
function runMigrations(
  windows: Map<string, WindowState>,
  fromVersion: number,
  toVersion: number,
): Map<string, WindowState> {
  let current = windows;

  for (let version = fromVersion + 1; version <= toVersion; version++) {
    const migration = migrations[version];
    if (migration) {
      current = migration(current);
    }
  }

  return current;
}

// Helper to create a test window
function createTestWindow(
  id: string,
  overrides?: Partial<WindowState>,
): WindowState {
  return {
    id,
    position: { x: 100, y: 100 },
    size: { width: 400, height: 300 },
    minSize: { width: 200, height: 150 },
    tabs: [],
    activeTabIndex: 0,
    transparency: 0,
    visible: true,
    zIndex: 1000,
    locked: false,
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("WindowStore Migrations", () => {
  describe("Migration v2: Remove maxSize from minimap/chat windows", () => {
    it("should remove maxSize from minimap-window", () => {
      const windows = new Map<string, WindowState>();
      windows.set(
        "minimap-window",
        createTestWindow("minimap-window", {
          maxSize: { width: 500, height: 500 },
        }),
      );

      const result = migrations[2](windows);
      const window = result.get("minimap-window");

      expect(window).toBeDefined();
      expect(window!.maxSize).toBeUndefined();
    });

    it("should remove maxSize from panel-chat-* windows", () => {
      const windows = new Map<string, WindowState>();
      windows.set(
        "panel-chat-123",
        createTestWindow("panel-chat-123", {
          maxSize: { width: 600, height: 400 },
        }),
      );

      const result = migrations[2](windows);
      const window = result.get("panel-chat-123");

      expect(window).toBeDefined();
      expect(window!.maxSize).toBeUndefined();
    });

    it("should remove maxSize from panel-minimap-* windows", () => {
      const windows = new Map<string, WindowState>();
      windows.set(
        "panel-minimap-abc",
        createTestWindow("panel-minimap-abc", {
          maxSize: { width: 300, height: 300 },
        }),
      );

      const result = migrations[2](windows);
      const window = result.get("panel-minimap-abc");

      expect(window).toBeDefined();
      expect(window!.maxSize).toBeUndefined();
    });

    it("should preserve maxSize for other windows", () => {
      const windows = new Map<string, WindowState>();
      windows.set(
        "inventory-window",
        createTestWindow("inventory-window", {
          maxSize: { width: 400, height: 400 },
        }),
      );

      const result = migrations[2](windows);
      const window = result.get("inventory-window");

      expect(window).toBeDefined();
      expect(window!.maxSize).toEqual({ width: 400, height: 400 });
    });

    it("should handle windows without maxSize", () => {
      const windows = new Map<string, WindowState>();
      windows.set("minimap-window", createTestWindow("minimap-window"));

      const result = migrations[2](windows);
      const window = result.get("minimap-window");

      expect(window).toBeDefined();
      expect(window!.maxSize).toBeUndefined();
    });
  });

  describe("Migration v3: Remove maxSize from menubar windows", () => {
    it("should remove maxSize from menubar-window", () => {
      const windows = new Map<string, WindowState>();
      windows.set(
        "menubar-window",
        createTestWindow("menubar-window", {
          maxSize: { width: 200, height: 50 },
        }),
      );

      const result = migrations[3](windows);
      const window = result.get("menubar-window");

      expect(window).toBeDefined();
      expect(window!.maxSize).toBeUndefined();
    });

    it("should remove maxSize from panel-menubar-* windows", () => {
      const windows = new Map<string, WindowState>();
      windows.set(
        "panel-menubar-main",
        createTestWindow("panel-menubar-main", {
          maxSize: { width: 180, height: 60 },
        }),
      );

      const result = migrations[3](windows);
      const window = result.get("panel-menubar-main");

      expect(window).toBeDefined();
      expect(window!.maxSize).toBeUndefined();
    });

    it("should preserve maxSize for non-menubar windows", () => {
      const windows = new Map<string, WindowState>();
      windows.set(
        "settings-window",
        createTestWindow("settings-window", {
          maxSize: { width: 500, height: 400 },
        }),
      );

      const result = migrations[3](windows);
      const window = result.get("settings-window");

      expect(window).toBeDefined();
      expect(window!.maxSize).toEqual({ width: 500, height: 400 });
    });
  });

  describe("Migration v6: Remove aspectRatio from minimap windows", () => {
    it("should remove aspectRatio from minimap-window", () => {
      const windows = new Map<string, WindowState>();
      windows.set(
        "minimap-window",
        createTestWindow("minimap-window", {
          aspectRatio: 1.0,
        }),
      );

      const result = migrations[6](windows);
      const window = result.get("minimap-window");

      expect(window).toBeDefined();
      expect(window!.aspectRatio).toBeUndefined();
    });

    it("should remove aspectRatio from panel-minimap-* windows", () => {
      const windows = new Map<string, WindowState>();
      windows.set(
        "panel-minimap-xyz",
        createTestWindow("panel-minimap-xyz", {
          aspectRatio: 1.5,
        }),
      );

      const result = migrations[6](windows);
      const window = result.get("panel-minimap-xyz");

      expect(window).toBeDefined();
      expect(window!.aspectRatio).toBeUndefined();
    });

    it("should preserve aspectRatio for non-minimap windows", () => {
      const windows = new Map<string, WindowState>();
      windows.set(
        "video-window",
        createTestWindow("video-window", {
          aspectRatio: 1.777,
        }),
      );

      const result = migrations[6](windows);
      const window = result.get("video-window");

      expect(window).toBeDefined();
      expect(window!.aspectRatio).toBe(1.777);
    });
  });

  describe("Migration v11: Clear all windows for new layout", () => {
    it("should return empty Map", () => {
      const windows = new Map<string, WindowState>();
      windows.set("window-1", createTestWindow("window-1"));
      windows.set("window-2", createTestWindow("window-2"));
      windows.set("window-3", createTestWindow("window-3"));

      const result = migrations[11](windows);

      expect(result.size).toBe(0);
    });

    it("should return new empty Map instance", () => {
      const windows = new Map<string, WindowState>();
      const result = migrations[11](windows);

      expect(result).toBeInstanceOf(Map);
      expect(result).not.toBe(windows);
    });
  });

  describe("Migration v13: Add anchor property to windows", () => {
    it("should add top-right anchor to minimap windows", () => {
      const windows = new Map<string, WindowState>();
      windows.set("panel-minimap-main", createTestWindow("panel-minimap-main"));

      const result = migrations[13](windows);
      const window = result.get("panel-minimap-main");

      expect(window).toBeDefined();
      expect(window!.anchor).toBe("top-right");
    });

    it("should add bottom-left anchor to chat windows", () => {
      const windows = new Map<string, WindowState>();
      windows.set("panel-chat-main", createTestWindow("panel-chat-main"));

      const result = migrations[13](windows);
      const window = result.get("panel-chat-main");

      expect(window).toBeDefined();
      expect(window!.anchor).toBe("bottom-left");
    });

    it("should add bottom-right anchor to inventory windows", () => {
      const windows = new Map<string, WindowState>();
      windows.set(
        "panel-inventory-main",
        createTestWindow("panel-inventory-main"),
      );

      const result = migrations[13](windows);
      const window = result.get("panel-inventory-main");

      expect(window).toBeDefined();
      expect(window!.anchor).toBe("bottom-right");
    });

    it("should add bottom-center anchor to actionbar windows", () => {
      const windows = new Map<string, WindowState>();
      windows.set(
        "panel-actionbar-main",
        createTestWindow("panel-actionbar-main"),
      );

      const result = migrations[13](windows);
      const window = result.get("panel-actionbar-main");

      expect(window).toBeDefined();
      expect(window!.anchor).toBe("bottom-center");
    });

    it("should default to top-left for unknown windows", () => {
      const windows = new Map<string, WindowState>();
      windows.set("panel-custom-abc", createTestWindow("panel-custom-abc"));

      const result = migrations[13](windows);
      const window = result.get("panel-custom-abc");

      expect(window).toBeDefined();
      expect(window!.anchor).toBe("top-left");
    });

    it("should preserve existing anchor if set", () => {
      const windows = new Map<string, WindowState>();
      windows.set(
        "panel-chat-main",
        createTestWindow("panel-chat-main", {
          anchor: "center",
        }),
      );

      const result = migrations[13](windows);
      const window = result.get("panel-chat-main");

      expect(window).toBeDefined();
      expect(window!.anchor).toBe("center");
    });
  });

  describe("Migration v15: Clear all windows for improved layout", () => {
    it("should return empty Map", () => {
      const windows = new Map<string, WindowState>();
      windows.set("some-window", createTestWindow("some-window"));

      const result = migrations[15](windows);

      expect(result.size).toBe(0);
    });
  });

  describe("runMigrations", () => {
    it("should run migrations incrementally", () => {
      const windows = new Map<string, WindowState>();
      windows.set(
        "minimap-window",
        createTestWindow("minimap-window", {
          maxSize: { width: 500, height: 500 },
          aspectRatio: 1.0,
        }),
      );

      // Run v2 and v6 (skip v3, v4, v5 which don't affect minimap)
      const result = runMigrations(windows, 1, 6);
      const window = result.get("minimap-window");

      expect(window).toBeDefined();
      expect(window!.maxSize).toBeUndefined();
      expect(window!.aspectRatio).toBeUndefined();
    });

    it("should skip missing migration versions", () => {
      const windows = new Map<string, WindowState>();
      windows.set("test-window", createTestWindow("test-window"));

      // Migrations 1, 4, 5, 7, 8, 9, 10, 12, 14 don't exist in our test subset
      // This should not throw
      const result = runMigrations(windows, 0, 10);

      expect(result.size).toBe(1);
    });

    it("should handle empty windows Map", () => {
      const windows = new Map<string, WindowState>();

      const result = runMigrations(windows, 1, 15);

      expect(result.size).toBe(0);
    });

    it("should apply layout reset migrations", () => {
      const windows = new Map<string, WindowState>();
      windows.set("window-a", createTestWindow("window-a"));
      windows.set("window-b", createTestWindow("window-b"));

      // Migration v11 clears all windows
      const result = runMigrations(windows, 10, 11);

      expect(result.size).toBe(0);
    });
  });

  describe("getDefaultAnchor", () => {
    it("should return bottom-left for chat windows", () => {
      expect(getDefaultAnchor("panel-chat-main")).toBe("bottom-left");
      expect(getDefaultAnchor("chat-window")).toBe("bottom-left");
    });

    it("should return bottom-left for skills windows", () => {
      expect(getDefaultAnchor("panel-skills-main")).toBe("bottom-left");
      expect(getDefaultAnchor("skills-window")).toBe("bottom-left");
    });

    it("should return bottom-left for prayer windows", () => {
      expect(getDefaultAnchor("panel-prayer-main")).toBe("bottom-left");
    });

    it("should return top-right for minimap windows", () => {
      expect(getDefaultAnchor("panel-minimap-main")).toBe("top-right");
      expect(getDefaultAnchor("minimap-window")).toBe("top-right");
    });

    it("should return bottom-right for inventory windows", () => {
      expect(getDefaultAnchor("panel-inventory-main")).toBe("bottom-right");
      expect(getDefaultAnchor("inventory-window")).toBe("bottom-right");
    });

    it("should return bottom-right for equipment windows", () => {
      expect(getDefaultAnchor("panel-equipment-main")).toBe("bottom-right");
    });

    it("should return bottom-right for menubar windows", () => {
      expect(getDefaultAnchor("panel-menubar-main")).toBe("bottom-right");
      expect(getDefaultAnchor("menu-bar-window")).toBe("bottom-right");
    });

    it("should return bottom-center for actionbar windows", () => {
      expect(getDefaultAnchor("panel-actionbar-main")).toBe("bottom-center");
      expect(getDefaultAnchor("action-bar-window")).toBe("bottom-center");
    });

    it("should return top-left for unknown windows", () => {
      expect(getDefaultAnchor("custom-window")).toBe("top-left");
      expect(getDefaultAnchor("settings-panel")).toBe("top-left");
    });

    it("should be case-insensitive", () => {
      expect(getDefaultAnchor("MINIMAP-WINDOW")).toBe("top-right");
      expect(getDefaultAnchor("Panel-Chat-Main")).toBe("bottom-left");
    });
  });
});
