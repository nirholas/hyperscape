/**
 * Settings Schema Types
 *
 * Type definitions for settings controls configuration.
 *
 * @packageDocumentation
 */

// ============================================================================
// Base Setting Definition
// ============================================================================

/** Base properties shared by all setting definitions */
export interface BaseSettingDefinition {
  /** Unique setting identifier (e.g., 'audio.master') */
  id: string;
  /** Display label */
  label: string;
  /** Optional description */
  description?: string;
  /** Optional icon */
  icon?: string;
  /** Category for grouping */
  category?: string;
  /** Whether the setting is hidden */
  hidden?: boolean;
  /** Required complexity level to show this setting */
  complexity?: "basic" | "standard" | "advanced";
}

// ============================================================================
// Slider Setting
// ============================================================================

/** Slider setting definition */
export interface SliderSettingDefinition extends BaseSettingDefinition {
  type: "slider";
  /** Default value */
  defaultValue: number;
  /** Minimum value */
  min: number;
  /** Maximum value */
  max: number;
  /** Step increment */
  step?: number;
  /** Unit label (e.g., '%', 'px') */
  unit?: string;
  /** Whether to show the current value */
  showValue?: boolean;
  /** Custom value formatter */
  formatValue?: (value: number) => string;
  /** Tick mark positions */
  ticks?: number[];
}

// ============================================================================
// Select Setting
// ============================================================================

/** Option for select settings */
export interface SelectOption {
  /** Option value */
  value: string;
  /** Display label */
  label: string;
  /** Optional description */
  description?: string;
  /** Optional icon */
  icon?: string;
  /** Whether the option is disabled */
  disabled?: boolean;
}

/** Select setting definition */
export interface SelectSettingDefinition extends BaseSettingDefinition {
  type: "select";
  /** Default value */
  defaultValue: string;
  /** Available options */
  options: SelectOption[];
  /** Whether to allow custom values */
  allowCustom?: boolean;
  /** Placeholder text */
  placeholder?: string;
}

// ============================================================================
// Toggle Setting
// ============================================================================

/** Toggle setting definition */
export interface ToggleSettingDefinition extends BaseSettingDefinition {
  type: "toggle";
  /** Default value */
  defaultValue: boolean;
  /** Label shown when on */
  onLabel?: string;
  /** Label shown when off */
  offLabel?: string;
}

// ============================================================================
// Keybind Setting
// ============================================================================

/** Keybind setting definition */
export interface KeybindSettingDefinition extends BaseSettingDefinition {
  type: "keybind";
  /** Default value (key combination string) */
  defaultValue: string;
  /** Whether to allow modifier keys (Ctrl, Alt, Shift) */
  allowModifiers?: boolean;
  /** List of reserved/forbidden key combinations */
  reserved?: string[];
  /** Conflict check callback */
  checkConflict?: (value: string) => string | null;
  /** Whether this keybind can be rebound by the user */
  isRebindable?: boolean;
}

// ============================================================================
// Color Setting
// ============================================================================

/** Color setting definition */
export interface ColorSettingDefinition extends BaseSettingDefinition {
  type: "color";
  /** Default value (hex color) */
  defaultValue: string;
  /** Preset color options */
  presets?: string[];
  /** Whether to show alpha channel */
  showAlpha?: boolean;
  /** Color format (hex, rgb, hsl) */
  format?: "hex" | "rgb" | "hsl";
}

// ============================================================================
// Text Setting
// ============================================================================

/** Text setting definition */
export interface TextSettingDefinition extends BaseSettingDefinition {
  type: "text";
  /** Default value */
  defaultValue: string;
  /** Placeholder text */
  placeholder?: string;
  /** Maximum length */
  maxLength?: number;
  /** Validation pattern */
  pattern?: RegExp;
  /** Whether to use multiline textarea */
  multiline?: boolean;
}

// ============================================================================
// Number Setting
// ============================================================================

/** Number setting definition */
export interface NumberSettingDefinition extends BaseSettingDefinition {
  type: "number";
  /** Default value */
  defaultValue: number;
  /** Minimum value */
  min?: number;
  /** Maximum value */
  max?: number;
  /** Step increment */
  step?: number;
  /** Unit label */
  unit?: string;
}

// ============================================================================
// Union Type
// ============================================================================

/** Union of all setting definition types */
export type SettingDefinition =
  | SliderSettingDefinition
  | SelectSettingDefinition
  | ToggleSettingDefinition
  | KeybindSettingDefinition
  | ColorSettingDefinition
  | TextSettingDefinition
  | NumberSettingDefinition;

// ============================================================================
// Settings Category
// ============================================================================

/** Settings category for grouping */
export interface SettingsCategory {
  /** Unique category identifier */
  id: string;
  /** Display label */
  label: string;
  /** Optional icon */
  icon?: string;
  /** Settings in this category */
  settings: SettingDefinition[];
  /** Nested subcategories */
  subcategories?: SettingsCategory[];
}

// ============================================================================
// Settings Schema
// ============================================================================

/** Complete settings schema */
export interface SettingsSchema {
  /** Schema version */
  version: string;
  /** Root categories */
  categories: SettingsCategory[];
}
