import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getLiveRegion,
  announce,
  getDraggableAriaAttributes,
  getDroppableAriaAttributes,
  SCREEN_READER_INSTRUCTIONS,
} from "../src/core/drag/accessibility";

describe("Accessibility", () => {
  beforeEach(() => {
    // Clean up any existing live regions
    const existing = document.getElementById("hs-kit-live-region");
    if (existing) existing.remove();
  });

  afterEach(() => {
    const region = document.getElementById("hs-kit-live-region");
    if (region) region.remove();
  });

  describe("getLiveRegion", () => {
    it("should create live region if not exists", () => {
      const region = getLiveRegion();
      expect(region).toBeDefined();
      expect(region.id).toBe("hs-kit-live-region");
    });

    it("should have correct ARIA attributes", () => {
      const region = getLiveRegion();
      expect(region.getAttribute("role")).toBe("status");
      expect(region.getAttribute("aria-live")).toBe("polite");
      expect(region.getAttribute("aria-atomic")).toBe("true");
    });

    it("should return same element on subsequent calls", () => {
      const region1 = getLiveRegion();
      const region2 = getLiveRegion();
      expect(region1).toBe(region2);
    });

    it("should be visually hidden", () => {
      const region = getLiveRegion();
      expect(region.style.width).toBe("1px");
      expect(region.style.height).toBe("1px");
      expect(region.style.overflow).toBe("hidden");
    });
  });

  describe("announce", () => {
    it("should set live region text content", async () => {
      announce("Test announcement");

      await new Promise((resolve) => setTimeout(resolve, 100));

      const region = getLiveRegion();
      expect(region.textContent).toBe("Test announcement");
    });

    it("should handle announcement objects", async () => {
      announce({ message: "Object announcement", priority: "assertive" });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const region = getLiveRegion();
      expect(region.textContent).toBe("Object announcement");
      expect(region.getAttribute("aria-live")).toBe("assertive");
    });
  });

  describe("getDraggableAriaAttributes", () => {
    it("should return correct attributes when not dragging", () => {
      const attrs = getDraggableAriaAttributes("test-id", false);

      expect(attrs.role).toBe("button");
      expect(attrs["aria-roledescription"]).toBe("draggable");
      expect(attrs["aria-grabbed"]).toBe(false);
      expect(attrs["aria-disabled"]).toBe(false);
      expect(attrs.tabIndex).toBe(0);
    });

    it("should return correct attributes when dragging", () => {
      const attrs = getDraggableAriaAttributes("test-id", true);

      expect(attrs["aria-grabbed"]).toBe(true);
    });

    it("should handle disabled state", () => {
      const attrs = getDraggableAriaAttributes("test-id", false, true);

      expect(attrs["aria-disabled"]).toBe(true);
      expect(attrs.tabIndex).toBe(-1);
    });

    it("should include describedby reference", () => {
      const attrs = getDraggableAriaAttributes("my-item", false);
      expect(attrs["aria-describedby"]).toBe("hs-kit-instructions-my-item");
    });
  });

  describe("getDroppableAriaAttributes", () => {
    it("should return none when not over", () => {
      const attrs = getDroppableAriaAttributes("drop-id", false, true);
      expect(attrs["aria-dropeffect"]).toBe("none");
    });

    it("should return move when over and can drop", () => {
      const attrs = getDroppableAriaAttributes("drop-id", true, true);
      expect(attrs["aria-dropeffect"]).toBe("move");
    });

    it("should return none when cannot drop", () => {
      const attrs = getDroppableAriaAttributes("drop-id", true, false);
      expect(attrs["aria-dropeffect"]).toBe("none");
    });
  });

  describe("SCREEN_READER_INSTRUCTIONS", () => {
    it("should contain key instructions", () => {
      expect(SCREEN_READER_INSTRUCTIONS).toContain("Space");
      expect(SCREEN_READER_INSTRUCTIONS).toContain("Enter");
      expect(SCREEN_READER_INSTRUCTIONS).toContain("arrow");
      expect(SCREEN_READER_INSTRUCTIONS).toContain("Escape");
    });
  });
});
