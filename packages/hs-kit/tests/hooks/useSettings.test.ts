/**
 * Tests for useSettings hook
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  useSettings,
  type SettingsPersistence,
} from "../../src/core/settings/useSettings";
import {
  getDefaultValues,
  ALL_SETTINGS,
  type SettingCategory,
} from "../../src/core/settings/settingsSchema";

// Mock localStorage
const mockStorage: Record<string, string> = {};
vi.stubGlobal("localStorage", {
  getItem: vi.fn((key: string) => mockStorage[key] ?? null),
  setItem: vi.fn((key: string, value: string) => {
    mockStorage[key] = value;
  }),
  removeItem: vi.fn((key: string) => {
    delete mockStorage[key];
  }),
  clear: vi.fn(() => {
    Object.keys(mockStorage).forEach((key) => delete mockStorage[key]);
  }),
});

// Mock window.dispatchEvent
vi.stubGlobal("window", {
  ...globalThis.window,
  dispatchEvent: vi.fn(),
  CustomEvent: globalThis.CustomEvent,
});

// Mock persistence adapter for testing
function createMockPersistence(): SettingsPersistence & {
  savedData: {
    values: Record<string, unknown>;
    profiles: unknown[];
    activeProfileId: string | null;
  } | null;
} {
  let savedData: {
    values: Record<string, unknown>;
    profiles: unknown[];
    activeProfileId: string | null;
  } | null = null;

  return {
    get savedData() {
      return savedData;
    },
    load: async () => savedData,
    save: async (data) => {
      savedData = data;
    },
  };
}

describe("useSettings", () => {
  beforeEach(() => {
    Object.keys(mockStorage).forEach((key) => delete mockStorage[key]);
    vi.clearAllMocks();
  });

  describe("initialization", () => {
    it("should initialize with default values", async () => {
      const mockPersistence = createMockPersistence();
      const { result } = renderHook(() =>
        useSettings({ persistence: mockPersistence }),
      );

      // Wait for loading to complete
      await vi.waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const defaults = getDefaultValues();
      expect(result.current.values["audio.master"]).toBe(
        defaults["audio.master"],
      );
      expect(result.current.values["graphics.quality"]).toBe(
        defaults["graphics.quality"],
      );
    });

    it("should load persisted values", async () => {
      const mockPersistence = createMockPersistence();
      await mockPersistence.save({
        values: { "audio.master": 50, "graphics.quality": "low" },
        profiles: [],
        activeProfileId: null,
      });

      const { result } = renderHook(() =>
        useSettings({ persistence: mockPersistence }),
      );

      await vi.waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.getValue<number>("audio.master")).toBe(50);
      expect(result.current.getValue<string>("graphics.quality")).toBe("low");
    });
  });

  describe("getValue and setValue", () => {
    it("should get and set setting values", async () => {
      const mockPersistence = createMockPersistence();
      const { result } = renderHook(() =>
        useSettings({ persistence: mockPersistence }),
      );

      await vi.waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Set a value
      act(() => {
        result.current.setValue("audio.master", 50);
      });

      expect(result.current.getValue<number>("audio.master")).toBe(50);
    });

    it("should validate values before setting", async () => {
      const mockPersistence = createMockPersistence();
      const { result } = renderHook(() =>
        useSettings({ persistence: mockPersistence }),
      );

      await vi.waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const originalValue = result.current.getValue<number>("audio.master");

      // Try to set an invalid value (string instead of number)
      act(() => {
        result.current.setValue("audio.master", "invalid");
      });

      // Value should not change
      expect(result.current.getValue<number>("audio.master")).toBe(
        originalValue,
      );
    });

    it("should track unsaved changes", async () => {
      const mockPersistence = createMockPersistence();
      const { result } = renderHook(() =>
        useSettings({ persistence: mockPersistence }),
      );

      await vi.waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.hasUnsavedChanges).toBe(false);

      act(() => {
        result.current.setValue("audio.master", 50);
      });

      expect(result.current.hasUnsavedChanges).toBe(true);
    });
  });

  describe("reset operations", () => {
    it("should reset a single setting", async () => {
      const mockPersistence = createMockPersistence();
      const { result } = renderHook(() =>
        useSettings({ persistence: mockPersistence }),
      );

      await vi.waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const defaults = getDefaultValues();

      // Change a value
      act(() => {
        result.current.setValue("audio.master", 10);
      });

      expect(result.current.getValue<number>("audio.master")).toBe(10);

      // Reset it
      act(() => {
        result.current.resetSetting("audio.master");
      });

      expect(result.current.getValue<number>("audio.master")).toBe(
        defaults["audio.master"],
      );
    });

    it("should reset all settings in a category", async () => {
      const mockPersistence = createMockPersistence();
      const { result } = renderHook(() =>
        useSettings({ persistence: mockPersistence }),
      );

      await vi.waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const defaults = getDefaultValues();

      // Change audio settings
      act(() => {
        result.current.setValue("audio.master", 10);
        result.current.setValue("audio.music", 20);
      });

      // Reset audio category
      act(() => {
        result.current.resetCategory("audio" as SettingCategory);
      });

      expect(result.current.getValue<number>("audio.master")).toBe(
        defaults["audio.master"],
      );
      expect(result.current.getValue<number>("audio.music")).toBe(
        defaults["audio.music"],
      );
    });

    it("should reset all settings", async () => {
      const mockPersistence = createMockPersistence();
      const { result } = renderHook(() =>
        useSettings({ persistence: mockPersistence }),
      );

      await vi.waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const defaults = getDefaultValues();

      // Change multiple settings
      act(() => {
        result.current.setValue("audio.master", 10);
        result.current.setValue("graphics.quality", "low");
      });

      // Reset all
      act(() => {
        result.current.resetAll();
      });

      expect(result.current.getValue<number>("audio.master")).toBe(
        defaults["audio.master"],
      );
      expect(result.current.getValue<string>("graphics.quality")).toBe(
        defaults["graphics.quality"],
      );
    });
  });

  describe("save and discard", () => {
    it("should save changes to persistence", async () => {
      const mockPersistence = createMockPersistence();
      const { result } = renderHook(() =>
        useSettings({ persistence: mockPersistence }),
      );

      await vi.waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      act(() => {
        result.current.setValue("audio.master", 50);
      });

      await act(async () => {
        await result.current.save();
      });

      expect(result.current.hasUnsavedChanges).toBe(false);
      expect(mockPersistence.savedData?.values["audio.master"]).toBe(50);
    });

    it("should discard unsaved changes", async () => {
      const mockPersistence = createMockPersistence();
      await mockPersistence.save({
        values: { "audio.master": 80 },
        profiles: [],
        activeProfileId: null,
      });

      const { result } = renderHook(() =>
        useSettings({ persistence: mockPersistence }),
      );

      await vi.waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      act(() => {
        result.current.setValue("audio.master", 50);
      });

      expect(result.current.getValue<number>("audio.master")).toBe(50);

      act(() => {
        result.current.discardChanges();
      });

      expect(result.current.getValue<number>("audio.master")).toBe(80);
      expect(result.current.hasUnsavedChanges).toBe(false);
    });
  });

  describe("search", () => {
    it("should search settings by keyword", async () => {
      const mockPersistence = createMockPersistence();
      const { result } = renderHook(() =>
        useSettings({ persistence: mockPersistence }),
      );

      await vi.waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const volumeResults = result.current.search("volume");
      expect(volumeResults.length).toBeGreaterThan(0);
      expect(volumeResults.every((s) => s.category === "audio")).toBe(true);
    });

    it("should return all settings for empty query", async () => {
      const mockPersistence = createMockPersistence();
      const { result } = renderHook(() =>
        useSettings({ persistence: mockPersistence }),
      );

      await vi.waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const allResults = result.current.search("");
      expect(allResults.length).toBe(ALL_SETTINGS.length);
    });
  });

  describe("profiles", () => {
    it("should create a new profile", async () => {
      const mockPersistence = createMockPersistence();
      const { result } = renderHook(() =>
        useSettings({ persistence: mockPersistence }),
      );

      await vi.waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      act(() => {
        result.current.setValue("audio.master", 50);
      });

      let profile: { id: string; name: string } | undefined;
      await act(async () => {
        profile = await result.current.createProfile("Test Profile");
      });

      expect(profile?.name).toBe("Test Profile");
      expect(result.current.profiles.length).toBe(1);
      expect(result.current.activeProfile?.id).toBe(profile?.id);
    });

    it("should load a profile", async () => {
      const mockPersistence = createMockPersistence();
      const { result } = renderHook(() =>
        useSettings({ persistence: mockPersistence }),
      );

      await vi.waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Create profile with specific settings
      act(() => {
        result.current.setValue("audio.master", 25);
      });

      let profile: { id: string } | undefined;
      await act(async () => {
        profile = await result.current.createProfile("Quiet Profile");
      });

      // Change settings
      act(() => {
        result.current.setValue("audio.master", 100);
      });

      expect(result.current.getValue<number>("audio.master")).toBe(100);

      // Load the profile
      await act(async () => {
        await result.current.loadProfile(profile!.id);
      });

      expect(result.current.getValue<number>("audio.master")).toBe(25);
    });

    it("should delete a profile", async () => {
      const mockPersistence = createMockPersistence();
      const { result } = renderHook(() =>
        useSettings({ persistence: mockPersistence }),
      );

      await vi.waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      let profile: { id: string } | undefined;
      await act(async () => {
        profile = await result.current.createProfile("To Delete");
      });

      expect(result.current.profiles.length).toBe(1);

      await act(async () => {
        await result.current.deleteProfile(profile!.id);
      });

      expect(result.current.profiles.length).toBe(0);
      expect(result.current.activeProfile).toBe(null);
    });
  });

  describe("import/export", () => {
    it("should export settings as JSON", async () => {
      const mockPersistence = createMockPersistence();
      const { result } = renderHook(() =>
        useSettings({ persistence: mockPersistence }),
      );

      await vi.waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      act(() => {
        result.current.setValue("audio.master", 50);
      });

      const json = result.current.exportSettings();
      const parsed = JSON.parse(json);

      expect(parsed.version).toBe(1);
      expect(parsed.values["audio.master"]).toBe(50);
    });

    it("should import settings from JSON", async () => {
      const mockPersistence = createMockPersistence();
      const { result } = renderHook(() =>
        useSettings({ persistence: mockPersistence }),
      );

      await vi.waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const importJson = JSON.stringify({
        version: 1,
        values: {
          "audio.master": 42,
          "graphics.quality": "low",
        },
      });

      let success: boolean = false;
      act(() => {
        success = result.current.importSettings(importJson);
      });

      expect(success).toBe(true);
      expect(result.current.getValue<number>("audio.master")).toBe(42);
      expect(result.current.getValue<string>("graphics.quality")).toBe("low");
    });

    it("should reject invalid import data", async () => {
      const mockPersistence = createMockPersistence();
      const { result } = renderHook(() =>
        useSettings({ persistence: mockPersistence }),
      );

      await vi.waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      let success: boolean = true;
      act(() => {
        success = result.current.importSettings("not valid json");
      });

      expect(success).toBe(false);
      expect(result.current.error).toBeTruthy();
    });
  });
});
