import { describe, it, expect, beforeEach } from "vitest";
import { useEditStore } from "../../src/stores/editStore";

describe("editStore", () => {
  beforeEach(() => {
    useEditStore.setState({
      mode: "locked",
      gridSize: 8,
      snapEnabled: true,
      showGrid: true,
      showGuides: true,
    });
  });

  describe("toggleMode", () => {
    it("should toggle from locked to unlocked", () => {
      const { toggleMode } = useEditStore.getState();
      toggleMode();
      expect(useEditStore.getState().mode).toBe("unlocked");
    });

    it("should toggle from unlocked to locked", () => {
      useEditStore.setState({ mode: "unlocked" });
      const { toggleMode } = useEditStore.getState();
      toggleMode();
      expect(useEditStore.getState().mode).toBe("locked");
    });
  });

  describe("setMode", () => {
    it("should set mode directly", () => {
      const { setMode } = useEditStore.getState();
      setMode("unlocked");
      expect(useEditStore.getState().mode).toBe("unlocked");
      setMode("locked");
      expect(useEditStore.getState().mode).toBe("locked");
    });
  });

  describe("setSnapEnabled", () => {
    it("should enable snap", () => {
      useEditStore.setState({ snapEnabled: false });
      const { setSnapEnabled } = useEditStore.getState();
      setSnapEnabled(true);
      expect(useEditStore.getState().snapEnabled).toBe(true);
    });

    it("should disable snap", () => {
      const { setSnapEnabled } = useEditStore.getState();
      setSnapEnabled(false);
      expect(useEditStore.getState().snapEnabled).toBe(false);
    });
  });

  describe("setShowGrid", () => {
    it("should show grid", () => {
      useEditStore.setState({ showGrid: false });
      const { setShowGrid } = useEditStore.getState();
      setShowGrid(true);
      expect(useEditStore.getState().showGrid).toBe(true);
    });

    it("should hide grid", () => {
      const { setShowGrid } = useEditStore.getState();
      setShowGrid(false);
      expect(useEditStore.getState().showGrid).toBe(false);
    });
  });

  describe("setShowGuides", () => {
    it("should show guides", () => {
      useEditStore.setState({ showGuides: false });
      const { setShowGuides } = useEditStore.getState();
      setShowGuides(true);
      expect(useEditStore.getState().showGuides).toBe(true);
    });

    it("should hide guides", () => {
      const { setShowGuides } = useEditStore.getState();
      setShowGuides(false);
      expect(useEditStore.getState().showGuides).toBe(false);
    });
  });

  describe("gridSize", () => {
    it("should have default grid size of 8", () => {
      expect(useEditStore.getState().gridSize).toBe(8);
    });
  });
});
