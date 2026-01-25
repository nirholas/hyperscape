/**
 * Tests for useLayoutSharing hook
 */

import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useLayoutSharing } from "../../src/core/presets/useLayoutSharing";
import { useWindowStore } from "../../src/stores/windowStore";

describe("useLayoutSharing", () => {
  beforeEach(() => {
    useWindowStore.getState().reset();
  });

  describe("generateShareCode", () => {
    it("should generate a share code", () => {
      // Create some windows first
      const store = useWindowStore.getState();
      store.createWindow({
        id: "test-window",
        position: { x: 100, y: 100 },
        size: { width: 300, height: 200 },
        tabs: [{ label: "Test", content: "test_panel" }],
      });

      const { result } = renderHook(() => useLayoutSharing());

      let shareCode: string = "";
      act(() => {
        shareCode = result.current.generateShareCode("Test Layout");
      });

      expect(shareCode).toMatch(/^HSL1-/); // Prefix + version
      expect(shareCode.length).toBeGreaterThan(10);
    });

    it("should include layout name in share code", () => {
      const { result } = renderHook(() => useLayoutSharing());

      const shareCode = result.current.generateShareCode("My Custom Layout");

      // Decode and check name is present
      const layout = result.current.importFromShareCode(shareCode);
      expect(layout?.name).toBe("My Custom Layout");
    });
  });

  describe("importFromShareCode", () => {
    it("should import valid share code", () => {
      const { result } = renderHook(() => useLayoutSharing());

      const shareCode = result.current.generateShareCode("Test");

      let layout;
      act(() => {
        layout = result.current.importFromShareCode(shareCode);
      });

      expect(layout).not.toBeNull();
      expect(layout?.name).toBe("Test");
    });

    it("should reject invalid share code", () => {
      const { result } = renderHook(() => useLayoutSharing());

      let layout;
      act(() => {
        layout = result.current.importFromShareCode("invalid-code");
      });

      expect(layout).toBeNull();
      expect(result.current.error).toBe("Invalid share code");
    });

    it("should reject malformed share code", () => {
      const { result } = renderHook(() => useLayoutSharing());

      let layout;
      act(() => {
        layout = result.current.importFromShareCode("HSL1-notbase64!");
      });

      expect(layout).toBeNull();
    });
  });

  describe("validateShareCode", () => {
    it("should validate correct share code", () => {
      // Need to create a window for valid layout
      const store = useWindowStore.getState();
      store.createWindow({
        id: "valid-test",
        position: { x: 100, y: 100 },
        size: { width: 200, height: 150 },
        tabs: [{ label: "Test", content: "test" }],
      });

      const { result } = renderHook(() => useLayoutSharing());

      const shareCode = result.current.generateShareCode("Test");

      const validation = result.current.validateShareCode(shareCode);
      expect(validation.valid).toBe(true);
    });

    it("should reject empty share code", () => {
      const { result } = renderHook(() => useLayoutSharing());

      const validation = result.current.validateShareCode("");
      expect(validation.valid).toBe(false);
      expect(validation.error).toBe("Empty share code");
    });

    it("should reject wrong prefix", () => {
      const { result } = renderHook(() => useLayoutSharing());

      const validation = result.current.validateShareCode("WRONG1-abc");
      expect(validation.valid).toBe(false);
    });
  });

  describe("applySharedLayout", () => {
    it("should apply layout to window store", () => {
      const store = useWindowStore.getState();
      store.createWindow({
        id: "window1",
        position: { x: 50, y: 50 },
        size: { width: 200, height: 150 },
        tabs: [{ label: "Panel", content: "inventory" }],
      });

      const { result } = renderHook(() => useLayoutSharing());

      const shareCode = result.current.generateShareCode("Test");
      const layout = result.current.importFromShareCode(shareCode);

      // Clear windows
      store.reset();

      act(() => {
        result.current.applySharedLayout(layout!, false);
      });

      const windows = store.getAllWindows();
      expect(windows.length).toBeGreaterThan(0);
    });
  });

  describe("exportAsJSON/importFromJSON", () => {
    it("should export as JSON", () => {
      const store = useWindowStore.getState();
      store.createWindow({
        id: "json-test",
        position: { x: 100, y: 100 },
        size: { width: 300, height: 200 },
        tabs: [{ label: "Test", content: "test" }],
      });

      const { result } = renderHook(() => useLayoutSharing());

      let json: string = "";
      act(() => {
        json = result.current.exportAsJSON("JSON Layout");
      });

      expect(json).toContain("JSON Layout");
      expect(() => JSON.parse(json)).not.toThrow();
    });

    it("should import from JSON", () => {
      const { result } = renderHook(() => useLayoutSharing());

      const json = result.current.exportAsJSON("Test");

      let layout;
      act(() => {
        layout = result.current.importFromJSON(json);
      });

      expect(layout).not.toBeNull();
      expect(layout?.name).toBe("Test");
    });

    it("should reject invalid JSON", () => {
      const { result } = renderHook(() => useLayoutSharing());

      let layout;
      act(() => {
        layout = result.current.importFromJSON("not valid json");
      });

      expect(layout).toBeNull();
      expect(result.current.error).toBe("Failed to parse JSON");
    });
  });

  describe("error handling", () => {
    it("should clear error", () => {
      const { result } = renderHook(() => useLayoutSharing());

      // Trigger an error
      act(() => {
        result.current.importFromShareCode("invalid");
      });

      expect(result.current.error).not.toBeNull();

      act(() => {
        result.current.clearError();
      });

      expect(result.current.error).toBeNull();
    });
  });
});
