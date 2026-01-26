/**
 * useSettingsCategory Hook
 *
 * Hook for managing category-specific settings state.
 * Provides filtered settings and category-level operations.
 *
 * @packageDocumentation
 */

import React, { useCallback, useMemo, useState } from "react";
import {
  getSettingsByCategory,
  getCategoryDefaults,
  SETTING_CATEGORIES,
  type SettingCategory,
  type SettingDefinition,
  type CategoryDefinition,
} from "./settingsSchema";
import { useSettings, type UseSettingsResult } from "./useSettings";

// ============================================================================
// Types
// ============================================================================

/** Result from useSettingsCategory hook */
export interface UseSettingsCategoryResult {
  /** Current category */
  category: SettingCategory;
  /** Category metadata */
  categoryInfo: CategoryDefinition;
  /** All settings in this category */
  settings: SettingDefinition[];
  /** Non-advanced settings only */
  basicSettings: SettingDefinition[];
  /** Advanced settings only */
  advancedSettings: SettingDefinition[];
  /** Whether to show advanced settings */
  showAdvanced: boolean;
  /** Toggle advanced settings visibility */
  setShowAdvanced: (show: boolean) => void;
  /** Get a setting value */
  getValue: <T>(id: string) => T;
  /** Set a setting value */
  setValue: (id: string, value: unknown) => void;
  /** Reset all settings in this category */
  resetCategory: () => void;
  /** Check if a setting is enabled (based on dependencies) */
  isSettingEnabled: (setting: SettingDefinition) => boolean;
  /** Whether this category has unsaved changes */
  hasChanges: boolean;
}

/** Options for useSettingsCategory hook */
export interface UseSettingsCategoryOptions {
  /** The category to manage */
  category: SettingCategory;
  /** Shared settings hook result (optional - creates new if not provided) */
  settingsHook?: UseSettingsResult;
  /** Initial state for showing advanced settings */
  initialShowAdvanced?: boolean;
}

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Hook for managing settings within a specific category
 *
 * @example
 * ```tsx
 * function GraphicsSettings() {
 *   const {
 *     settings,
 *     getValue,
 *     setValue,
 *     resetCategory,
 *     showAdvanced,
 *     setShowAdvanced,
 *   } = useSettingsCategory({ category: 'graphics' });
 *
 *   return (
 *     <div>
 *       {settings.map((setting) => (
 *         <SettingControl
 *           key={setting.id}
 *           setting={setting}
 *           value={getValue(setting.id)}
 *           onChange={(value) => setValue(setting.id, value)}
 *         />
 *       ))}
 *       <button onClick={resetCategory}>Reset Graphics</button>
 *       <label>
 *         <input
 *           type="checkbox"
 *           checked={showAdvanced}
 *           onChange={(e) => setShowAdvanced(e.target.checked)}
 *         />
 *         Show Advanced
 *       </label>
 *     </div>
 *   );
 * }
 * ```
 */
export function useSettingsCategory(
  options: UseSettingsCategoryOptions,
): UseSettingsCategoryResult {
  const { category, settingsHook, initialShowAdvanced = false } = options;

  // Use provided hook or create new one
  const settings = settingsHook ?? useSettings();
  const [showAdvanced, setShowAdvanced] = useState(initialShowAdvanced);

  // Get category info
  const categoryInfo = useMemo(() => {
    return (
      SETTING_CATEGORIES.find((c) => c.id === category) ?? {
        id: category,
        label: category,
        description: "",
        order: 99,
      }
    );
  }, [category]);

  // Get settings for this category
  const categorySettings = useMemo(() => {
    return getSettingsByCategory(category);
  }, [category]);

  // Split into basic and advanced
  const basicSettings = useMemo(() => {
    return categorySettings.filter((s) => !s.advanced);
  }, [categorySettings]);

  const advancedSettings = useMemo(() => {
    return categorySettings.filter((s) => s.advanced);
  }, [categorySettings]);

  // Settings to display based on showAdvanced flag
  const displaySettings = useMemo(() => {
    return showAdvanced ? categorySettings : basicSettings;
  }, [categorySettings, basicSettings, showAdvanced]);

  // Check if a setting is enabled based on dependencies
  const isSettingEnabled = useCallback(
    (setting: SettingDefinition): boolean => {
      if (!setting.dependsOn) return true;
      const depValue = settings.getValue(setting.dependsOn.settingId);
      return depValue === setting.dependsOn.value;
    },
    [settings],
  );

  // Get value with type safety
  const getValue = useCallback(
    <T>(id: string): T => {
      return settings.getValue<T>(id);
    },
    [settings],
  );

  // Set value
  const setValue = useCallback(
    (id: string, value: unknown) => {
      settings.setValue(id, value);
    },
    [settings],
  );

  // Reset category
  const resetCategory = useCallback(() => {
    settings.resetCategory(category);
  }, [settings, category]);

  // Check if this category has changes
  const hasChanges = useMemo(() => {
    const defaults = getCategoryDefaults(category);
    for (const id of Object.keys(defaults)) {
      const currentValue = settings.values[id];
      // Check against saved values (not defaults)
      // For now, compare to the current values in the settings hook
      // A more sophisticated implementation would compare to saved state
      if (currentValue !== defaults[id]) {
        return true;
      }
    }
    return false;
  }, [category, settings.values]);

  return {
    category,
    categoryInfo,
    settings: displaySettings,
    basicSettings,
    advancedSettings,
    showAdvanced,
    setShowAdvanced,
    getValue,
    setValue,
    resetCategory,
    isSettingEnabled,
    hasChanges,
  };
}

// ============================================================================
// Utility Hooks
// ============================================================================

/**
 * Hook to get all category definitions
 */
export function useSettingCategories(): CategoryDefinition[] {
  return useMemo(() => {
    return [...SETTING_CATEGORIES].sort((a, b) => a.order - b.order);
  }, []);
}

/**
 * Hook to track the currently active category tab
 */
export function useActiveCategoryTab(
  initialCategory: SettingCategory = "graphics",
): {
  activeCategory: SettingCategory;
  setActiveCategory: (category: SettingCategory) => void;
  categories: CategoryDefinition[];
} {
  const [activeCategory, setActiveCategory] =
    React.useState<SettingCategory>(initialCategory);
  const categories = useSettingCategories();

  return {
    activeCategory,
    setActiveCategory,
    categories,
  };
}
