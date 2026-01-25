/**
 * Tests for useAdvancedEditOptions hook
 */

import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  useAdvancedEditOptions,
  CONTEXTUAL_PANELS,
} from "../../src/core/edit/useAdvancedEditOptions";
import { useEditStore } from "../../src/stores/editStore";

describe("useAdvancedEditOptions", () => {
  beforeEach(() => {
    // Reset stores
    useEditStore.getState().setMode("locked");
  });

  describe("initial state", () => {
    it("should start with advanced options disabled", () => {
      const { result } = renderHook(() => useAdvancedEditOptions());

      expect(result.current.enabled).toBe(false);
    });

    it("should have default contextual panels", () => {
      const { result } = renderHook(() => useAdvancedEditOptions());

      expect(result.current.availablePanels.length).toBeGreaterThan(0);
      expect(result.current.availablePanels).toEqual(CONTEXTUAL_PANELS);
    });

    it("should have no visible panels initially", () => {
      const { result } = renderHook(() => useAdvancedEditOptions());

      expect(result.current.visiblePanels).toHaveLength(0);
    });
  });

  describe("toggle functionality", () => {
    it("should toggle advanced options on/off", () => {
      const { result } = renderHook(() => useAdvancedEditOptions());

      expect(result.current.enabled).toBe(false);

      act(() => {
        result.current.toggleAdvancedOptions();
      });

      expect(result.current.enabled).toBe(true);

      act(() => {
        result.current.toggleAdvancedOptions();
      });

      expect(result.current.enabled).toBe(false);
    });

    it("should enable advanced options", () => {
      const { result } = renderHook(() => useAdvancedEditOptions());

      act(() => {
        result.current.enableAdvancedOptions();
      });

      expect(result.current.enabled).toBe(true);
    });

    it("should disable advanced options", () => {
      const { result } = renderHook(() => useAdvancedEditOptions());

      act(() => {
        result.current.enableAdvancedOptions();
        result.current.disableAdvancedOptions();
      });

      expect(result.current.enabled).toBe(false);
    });
  });

  describe("panel visibility", () => {
    it("should check if panel is visible", () => {
      const { result } = renderHook(() => useAdvancedEditOptions());

      expect(result.current.isPanelVisible("buff_bar")).toBe(false);
    });
  });

  describe("custom panels", () => {
    it("should merge custom panels with defaults", () => {
      const customPanels = [
        {
          id: "custom_panel",
          name: "Custom Panel",
          icon: "🎨",
          condition: "always" as const,
          defaultSize: { width: 200, height: 100 },
          minSize: { width: 100, height: 50 },
        },
      ];

      const { result } = renderHook(() => useAdvancedEditOptions(customPanels));

      expect(result.current.availablePanels.length).toBe(
        CONTEXTUAL_PANELS.length + 1,
      );
      expect(
        result.current.availablePanels.some((p) => p.id === "custom_panel"),
      ).toBe(true);
    });
  });
});
