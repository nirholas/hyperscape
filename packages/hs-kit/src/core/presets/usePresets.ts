import { useCallback, useEffect } from "react";
import { usePresetStore } from "../../stores/presetStore";
import { useWindowStore } from "../../stores/windowStore";
import type { PresetsResult, LayoutPreset, Size } from "../../types";

/**
 * Hook for managing layout presets
 *
 * @example
 * ```tsx
 * function PresetManager() {
 *   const { presets, activePreset, savePreset, loadPreset, deletePreset, isLoading } = usePresets();
 *
 *   if (isLoading) return <div>Loading presets...</div>;
 *
 *   return (
 *     <div>
 *       <h3>Presets</h3>
 *       {presets.map((preset) => (
 *         <div key={preset.id}>
 *           <span>{preset.name}</span>
 *           <button onClick={() => loadPreset(preset.id)}>Load</button>
 *           <button onClick={() => deletePreset(preset.id)}>Delete</button>
 *         </div>
 *       ))}
 *       <button onClick={() => savePreset('New Preset')}>Save Current Layout</button>
 *     </div>
 *   );
 * }
 * ```
 */
export function usePresets(): PresetsResult {
  const presets = usePresetStore((s) => s.presets);
  const activePresetId = usePresetStore((s) => s.activePresetId);
  const isLoading = usePresetStore((s) => s.isLoading);

  const loadFromStorage = usePresetStore((s) => s.loadFromStorage);
  const savePresetStore = usePresetStore((s) => s.savePreset);
  const deletePresetStore = usePresetStore((s) => s.deletePreset);
  const renamePresetStore = usePresetStore((s) => s.renamePreset);
  const setActivePreset = usePresetStore((s) => s.setActivePreset);

  const getAllWindows = useWindowStore((s) => s.getAllWindows);
  const setWindows = useWindowStore((s) => s.setWindows);

  // Load presets from storage on mount
  useEffect(() => {
    loadFromStorage();
  }, [loadFromStorage]);

  const activePreset = presets.find((p) => p.id === activePresetId) || null;

  const savePreset = useCallback(
    async (name: string): Promise<LayoutPreset> => {
      const windows = getAllWindows();
      const resolution: Size = {
        width: window.innerWidth,
        height: window.innerHeight,
      };

      return savePresetStore(name, windows, resolution);
    },
    [getAllWindows, savePresetStore],
  );

  const loadPreset = useCallback(
    async (id: string): Promise<void> => {
      const preset = presets.find((p) => p.id === id);
      if (!preset) {
        console.warn(`Preset ${id} not found`);
        return;
      }

      // Scale positions if resolution differs
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
        // Only scale size if window would be off-screen
        size: {
          width: Math.min(w.size.width, currentWidth - 50),
          height: Math.min(w.size.height, currentHeight - 50),
        },
      }));

      setWindows(scaledWindows);
      setActivePreset(id);
    },
    [presets, setWindows, setActivePreset],
  );

  const deletePreset = useCallback(
    async (id: string): Promise<void> => {
      await deletePresetStore(id);
    },
    [deletePresetStore],
  );

  const renamePreset = useCallback(
    async (id: string, name: string): Promise<void> => {
      await renamePresetStore(id, name);
    },
    [renamePresetStore],
  );

  return {
    presets,
    activePreset,
    savePreset,
    loadPreset,
    deletePreset,
    renamePreset,
    isLoading,
  };
}
