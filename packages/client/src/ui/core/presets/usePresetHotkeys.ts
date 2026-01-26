import { useEffect, useCallback, useMemo } from "react";
import { usePresetStore } from "../../stores/presetStore";
import { useWindowStore } from "../../stores/windowStore";
import {
  useKeybindStore,
  DEFAULT_PRESET_KEYBINDS,
} from "../../stores/keybindStore";
import { useFeatureEnabled } from "../../stores/complexityStore";
import type { Size } from "../../types";

export interface PresetHotkeyConfig {
  enabled?: boolean;
  saveModifier?: "shift" | "ctrl" | "alt";
}

export interface PresetHotkeyResult {
  loadPresetBySlot: (slot: number) => Promise<void>;
  savePresetToSlot: (slot: number, name?: string) => Promise<void>;
}

/** Default slot keys (fallback when customKeybinds disabled) */
const DEFAULT_SLOT_KEYS = ["F1", "F2", "F3", "F4"] as const;

export function usePresetHotkeys(
  config: PresetHotkeyConfig = {},
): PresetHotkeyResult {
  const { enabled = true } = config;

  // Check if preset hotkeys feature is enabled
  const presetHotkeysEnabled = useFeatureEnabled("presetHotkeys");
  const customKeybindsEnabled = useFeatureEnabled("customKeybinds");

  // Get keybinds from store
  const getKey = useKeybindStore((s) => s.getKey);

  // Build slot keys from keybindStore when customKeybinds is enabled
  const slotKeys = useMemo((): string[] => {
    if (!customKeybindsEnabled) {
      return [...DEFAULT_SLOT_KEYS];
    }

    // Get load keybinds from store (preset.load.0 through preset.load.3)
    return DEFAULT_PRESET_KEYBINDS.filter((def) =>
      def.id.startsWith("preset.load."),
    ).map((def) => getKey(def.id));
  }, [customKeybindsEnabled, getKey]);

  // Build save keys (with modifier)
  const saveKeys = useMemo((): string[] => {
    if (!customKeybindsEnabled) {
      return DEFAULT_SLOT_KEYS.map((k) => `Shift+${k}`);
    }

    // Get save keybinds from store (preset.save.0 through preset.save.3)
    return DEFAULT_PRESET_KEYBINDS.filter((def) =>
      def.id.startsWith("preset.save."),
    ).map((def) => getKey(def.id));
  }, [customKeybindsEnabled, getKey]);

  const presets = usePresetStore((s) => s.presets);
  const savePreset = usePresetStore((s) => s.savePreset);
  const setActivePreset = usePresetStore((s) => s.setActivePreset);
  const getAllWindows = useWindowStore((s) => s.getAllWindows);
  const setWindows = useWindowStore((s) => s.setWindows);

  const loadPresetBySlot = useCallback(
    async (slot: number): Promise<void> => {
      const preset = presets.find(
        (p) => p.name === `Preset ${slot + 1}` || presets.indexOf(p) === slot,
      );
      if (!preset) {
        console.warn(`No preset in slot ${slot + 1}`);
        return;
      }

      const currentWidth = window.innerWidth;
      const currentHeight = window.innerHeight;
      const scaleX = currentWidth / preset.resolution.width;
      const scaleY = currentHeight / preset.resolution.height;

      const scaledWindows = preset.windows.map((w) => ({
        ...w,
        position: {
          x: Math.round(w.position.x * scaleX),
          y: Math.round(w.position.y * scaleY),
        },
        size: {
          width: Math.min(w.size.width, currentWidth - 50),
          height: Math.min(w.size.height, currentHeight - 50),
        },
      }));

      setWindows(scaledWindows);
      setActivePreset(preset.id);
    },
    [presets, setWindows, setActivePreset],
  );

  const savePresetToSlot = useCallback(
    async (slot: number, name?: string): Promise<void> => {
      const windows = getAllWindows();
      const resolution: Size = {
        width: window.innerWidth,
        height: window.innerHeight,
      };
      const presetName = name ?? `Preset ${slot + 1}`;
      await savePreset(presetName, windows, resolution);
    },
    [getAllWindows, savePreset],
  );

  useEffect(() => {
    // Check both the config enabled flag and the presetHotkeys feature flag
    if (!enabled || !presetHotkeysEnabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip if in input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      // Build the key string from the event
      const keyParts: string[] = [];
      if (e.shiftKey) keyParts.push("Shift");
      if (e.ctrlKey) keyParts.push("Ctrl");
      if (e.altKey) keyParts.push("Alt");
      keyParts.push(e.key);
      const pressedKey = keyParts.join("+");

      // Check save keys first (they have modifiers)
      const saveIndex = saveKeys.findIndex((k) => k === pressedKey);
      if (saveIndex !== -1) {
        e.preventDefault();
        savePresetToSlot(saveIndex);
        return;
      }

      // Check load keys (no modifiers, or check against the stored keybind)
      const loadIndex = slotKeys.findIndex((k) => k === e.key);
      if (loadIndex !== -1 && !e.shiftKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        loadPresetBySlot(loadIndex);
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    enabled,
    presetHotkeysEnabled,
    slotKeys,
    saveKeys,
    loadPresetBySlot,
    savePresetToSlot,
  ]);

  return { loadPresetBySlot, savePresetToSlot };
}
