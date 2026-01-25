/**
 * Tests for theme store
 */

import { describe, it, expect, beforeEach } from "vitest";
import { useThemeStore } from "../../src/stores/themeStore";
import { darkTheme, lightTheme } from "../../src/styled/themes";

describe("themeStore", () => {
  beforeEach(() => {
    // Reset to dark theme
    useThemeStore.getState().setTheme("dark");
  });

  describe("initial state", () => {
    it("should default to dark theme", () => {
      const state = useThemeStore.getState();
      expect(state.themeName).toBe("dark");
      expect(state.theme.name).toBe("dark");
    });
  });

  describe("setTheme", () => {
    it("should change to light theme", () => {
      useThemeStore.getState().setTheme("light");

      const state = useThemeStore.getState();
      expect(state.themeName).toBe("light");
      expect(state.theme).toEqual(lightTheme);
    });

    it("should change back to dark theme", () => {
      useThemeStore.getState().setTheme("light");
      useThemeStore.getState().setTheme("dark");

      const state = useThemeStore.getState();
      expect(state.themeName).toBe("dark");
      expect(state.theme).toEqual(darkTheme);
    });
  });

  describe("toggleTheme", () => {
    it("should toggle from dark to light", () => {
      useThemeStore.getState().toggleTheme();

      expect(useThemeStore.getState().themeName).toBe("light");
    });

    it("should toggle from light to dark", () => {
      useThemeStore.getState().setTheme("light");
      useThemeStore.getState().toggleTheme();

      expect(useThemeStore.getState().themeName).toBe("dark");
    });
  });

  describe("isDark/isLight", () => {
    it("should correctly identify dark theme", () => {
      expect(useThemeStore.getState().isDark()).toBe(true);
      expect(useThemeStore.getState().isLight()).toBe(false);
    });

    it("should correctly identify light theme", () => {
      useThemeStore.getState().setTheme("light");

      expect(useThemeStore.getState().isDark()).toBe(false);
      expect(useThemeStore.getState().isLight()).toBe(true);
    });
  });
});

describe("theme objects", () => {
  describe("darkTheme", () => {
    it("should have required color properties", () => {
      expect(darkTheme.colors.background.primary).toBeDefined();
      expect(darkTheme.colors.text.primary).toBeDefined();
      expect(darkTheme.colors.accent.primary).toBeDefined();
    });

    it("should have spacing values", () => {
      expect(darkTheme.spacing.xs).toBe(4);
      expect(darkTheme.spacing.sm).toBe(8);
      expect(darkTheme.spacing.md).toBe(16);
    });

    it("should have typography values", () => {
      expect(darkTheme.typography.fontFamily).toBeDefined();
      expect(darkTheme.typography.fontSize.base).toBeDefined();
    });
  });

  describe("lightTheme", () => {
    it("should have different background colors than dark", () => {
      expect(lightTheme.colors.background.primary).not.toBe(
        darkTheme.colors.background.primary,
      );
    });

    it("should have same spacing as dark theme", () => {
      expect(lightTheme.spacing).toEqual(darkTheme.spacing);
    });
  });
});
