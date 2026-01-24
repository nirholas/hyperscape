/**
 * Settings System
 *
 * Hooks and utilities for managing game settings.
 *
 * @packageDocumentation
 */

// Main hooks
export {
  useSettings,
  type UseSettingsResult,
  type UseSettingsOptions,
  type SettingsProfile,
  type SettingsPersistence,
} from "./useSettings";

export {
  useSettingsCategory,
  useSettingCategories,
  useActiveCategoryTab,
  type UseSettingsCategoryResult,
  type UseSettingsCategoryOptions,
} from "./useSettingsCategory";

// Schema and types
export {
  // Types
  type SettingControlType,
  type SettingDefinitionBase,
  type SliderSettingDefinition,
  type ToggleSettingDefinition,
  type SelectSettingDefinition,
  type KeybindSettingDefinition,
  type ColorSettingDefinition,
  type NumberSettingDefinition,
  type SettingDefinition,
  type SettingCategory,
  type CategoryDefinition,
  // Constants
  SETTING_CATEGORIES,
  GRAPHICS_SETTINGS,
  AUDIO_SETTINGS,
  CONTROLS_SETTINGS,
  INTERFACE_SETTINGS,
  GAMEPLAY_SETTINGS,
  ACCESSIBILITY_SETTINGS,
  ALL_SETTINGS,
  // Utilities
  getSettingsByCategory,
  getSettingById,
  getDefaultValues,
  getCategoryDefaults,
  searchSettings,
  validateSettingValue,
} from "./settingsSchema";
