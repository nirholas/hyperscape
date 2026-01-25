/**
 * Settings Schema Definition
 *
 * Defines the structure and metadata for all settings in the game.
 * Settings are organized by category with validation, defaults, and UI hints.
 *
 * @packageDocumentation
 */

// ============================================================================
// Control Types
// ============================================================================

/** Types of controls for rendering settings */
export type SettingControlType =
  | "slider"
  | "toggle"
  | "select"
  | "keybind"
  | "color"
  | "number";

/** Base setting definition */
export interface SettingDefinitionBase {
  /** Unique ID: "graphics.quality", "audio.master", etc. */
  id: string;
  /** Category for grouping */
  category: SettingCategory;
  /** Display label */
  label: string;
  /** Description for tooltips */
  description?: string;
  /** Keywords for search */
  keywords?: string[];
  /** Whether setting requires restart */
  requiresRestart?: boolean;
  /** Whether setting is advanced (hidden by default) */
  advanced?: boolean;
  /** Dependency on another setting */
  dependsOn?: {
    settingId: string;
    value: unknown;
  };
}

/** Slider setting (numeric range) */
export interface SliderSettingDefinition extends SettingDefinitionBase {
  type: "slider";
  defaultValue: number;
  min: number;
  max: number;
  step: number;
  /** Format for display (e.g., "%", "px") */
  unit?: string;
  /** Show value while dragging */
  showValue?: boolean;
}

/** Toggle setting (boolean) */
export interface ToggleSettingDefinition extends SettingDefinitionBase {
  type: "toggle";
  defaultValue: boolean;
}

/** Select setting (dropdown) */
export interface SelectSettingDefinition extends SettingDefinitionBase {
  type: "select";
  defaultValue: string;
  options: { value: string; label: string }[];
}

/** Keybind setting */
export interface KeybindSettingDefinition extends SettingDefinitionBase {
  type: "keybind";
  defaultValue: string;
  /** Whether modifier keys are allowed */
  allowModifiers?: boolean;
  /** Whether this keybind can be changed */
  isRebindable?: boolean;
}

/** Color setting */
export interface ColorSettingDefinition extends SettingDefinitionBase {
  type: "color";
  defaultValue: string;
  /** Preset colors to show */
  presets?: string[];
  /** Whether alpha channel is supported */
  alpha?: boolean;
}

/** Number input setting */
export interface NumberSettingDefinition extends SettingDefinitionBase {
  type: "number";
  defaultValue: number;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}

/** Union of all setting types */
export type SettingDefinition =
  | SliderSettingDefinition
  | ToggleSettingDefinition
  | SelectSettingDefinition
  | KeybindSettingDefinition
  | ColorSettingDefinition
  | NumberSettingDefinition;

// ============================================================================
// Categories
// ============================================================================

/** Setting categories */
export type SettingCategory =
  | "graphics"
  | "audio"
  | "controls"
  | "interface"
  | "gameplay"
  | "accessibility";

/** Category metadata */
export interface CategoryDefinition {
  id: SettingCategory;
  label: string;
  description: string;
  icon?: string;
  order: number;
}

/** All category definitions */
export const SETTING_CATEGORIES: CategoryDefinition[] = [
  {
    id: "graphics",
    label: "Graphics",
    description: "Visual quality and performance settings",
    icon: "Monitor",
    order: 0,
  },
  {
    id: "audio",
    label: "Audio",
    description: "Sound and music volume settings",
    icon: "Volume2",
    order: 1,
  },
  {
    id: "controls",
    label: "Controls",
    description: "Keybinds and input settings",
    icon: "Keyboard",
    order: 2,
  },
  {
    id: "interface",
    label: "Interface",
    description: "UI scale and display options",
    icon: "Layout",
    order: 3,
  },
  {
    id: "gameplay",
    label: "Gameplay",
    description: "Game behavior settings",
    icon: "Gamepad2",
    order: 4,
  },
  {
    id: "accessibility",
    label: "Accessibility",
    description: "Accessibility and assistive options",
    icon: "Accessibility",
    order: 5,
  },
];

// ============================================================================
// Default Settings
// ============================================================================

/** Graphics settings */
export const GRAPHICS_SETTINGS: SettingDefinition[] = [
  {
    id: "graphics.quality",
    category: "graphics",
    type: "select",
    label: "Graphics Quality",
    description: "Overall graphics quality preset",
    defaultValue: "high",
    options: [
      { value: "low", label: "Low" },
      { value: "medium", label: "Medium" },
      { value: "high", label: "High" },
      { value: "ultra", label: "Ultra" },
      { value: "custom", label: "Custom" },
    ],
    keywords: ["quality", "preset", "performance"],
  },
  {
    id: "graphics.resolution",
    category: "graphics",
    type: "select",
    label: "Resolution",
    description: "Render resolution (affects performance)",
    defaultValue: "native",
    options: [
      { value: "native", label: "Native" },
      { value: "1920x1080", label: "1920x1080" },
      { value: "1280x720", label: "1280x720" },
      { value: "960x540", label: "960x540" },
    ],
    keywords: ["resolution", "render", "screen"],
  },
  {
    id: "graphics.fpsLimit",
    category: "graphics",
    type: "select",
    label: "FPS Limit",
    description: "Maximum frames per second",
    defaultValue: "60",
    options: [
      { value: "30", label: "30 FPS" },
      { value: "60", label: "60 FPS" },
      { value: "120", label: "120 FPS" },
      { value: "144", label: "144 FPS" },
      { value: "unlimited", label: "Unlimited" },
    ],
    keywords: ["fps", "framerate", "limit", "performance"],
  },
  {
    id: "graphics.vsync",
    category: "graphics",
    type: "toggle",
    label: "V-Sync",
    description: "Synchronize with display refresh rate",
    defaultValue: true,
    keywords: ["vsync", "screen tear", "sync"],
  },
  {
    id: "graphics.shadows",
    category: "graphics",
    type: "select",
    label: "Shadow Quality",
    description: "Shadow rendering quality",
    defaultValue: "high",
    options: [
      { value: "off", label: "Off" },
      { value: "low", label: "Low" },
      { value: "medium", label: "Medium" },
      { value: "high", label: "High" },
    ],
    keywords: ["shadows", "lighting"],
    advanced: true,
  },
  {
    id: "graphics.antialiasing",
    category: "graphics",
    type: "select",
    label: "Anti-Aliasing",
    description: "Edge smoothing method",
    defaultValue: "fxaa",
    options: [
      { value: "off", label: "Off" },
      { value: "fxaa", label: "FXAA" },
      { value: "smaa", label: "SMAA" },
      { value: "msaa2x", label: "MSAA 2x" },
      { value: "msaa4x", label: "MSAA 4x" },
    ],
    keywords: ["antialiasing", "aa", "smoothing", "jaggies"],
    advanced: true,
  },
  {
    id: "graphics.drawDistance",
    category: "graphics",
    type: "slider",
    label: "Draw Distance",
    description: "How far objects render",
    defaultValue: 100,
    min: 25,
    max: 200,
    step: 25,
    unit: "%",
    keywords: ["draw", "distance", "render", "far"],
    advanced: true,
  },
  {
    id: "graphics.particles",
    category: "graphics",
    type: "select",
    label: "Particle Effects",
    description: "Particle effect quality",
    defaultValue: "high",
    options: [
      { value: "off", label: "Off" },
      { value: "low", label: "Low" },
      { value: "medium", label: "Medium" },
      { value: "high", label: "High" },
    ],
    keywords: ["particles", "effects", "vfx"],
    advanced: true,
  },
];

/** Audio settings */
export const AUDIO_SETTINGS: SettingDefinition[] = [
  {
    id: "audio.master",
    category: "audio",
    type: "slider",
    label: "Master Volume",
    description: "Overall game volume",
    defaultValue: 80,
    min: 0,
    max: 100,
    step: 1,
    unit: "%",
    showValue: true,
    keywords: ["volume", "master", "sound"],
  },
  {
    id: "audio.music",
    category: "audio",
    type: "slider",
    label: "Music Volume",
    description: "Background music volume",
    defaultValue: 60,
    min: 0,
    max: 100,
    step: 1,
    unit: "%",
    showValue: true,
    keywords: ["music", "volume", "background"],
  },
  {
    id: "audio.sfx",
    category: "audio",
    type: "slider",
    label: "Sound Effects",
    description: "Sound effects volume",
    defaultValue: 80,
    min: 0,
    max: 100,
    step: 1,
    unit: "%",
    showValue: true,
    keywords: ["sfx", "sound", "effects", "volume"],
  },
  {
    id: "audio.voice",
    category: "audio",
    type: "slider",
    label: "Voice Volume",
    description: "Voice chat and NPC voices",
    defaultValue: 100,
    min: 0,
    max: 100,
    step: 1,
    unit: "%",
    showValue: true,
    keywords: ["voice", "chat", "npc", "volume"],
  },
  {
    id: "audio.ambient",
    category: "audio",
    type: "slider",
    label: "Ambient Sounds",
    description: "Environmental ambient audio",
    defaultValue: 70,
    min: 0,
    max: 100,
    step: 1,
    unit: "%",
    showValue: true,
    keywords: ["ambient", "environment", "background"],
    advanced: true,
  },
  {
    id: "audio.mute",
    category: "audio",
    type: "toggle",
    label: "Mute All",
    description: "Mute all game audio",
    defaultValue: false,
    keywords: ["mute", "silent", "quiet"],
  },
  {
    id: "audio.muteUnfocused",
    category: "audio",
    type: "toggle",
    label: "Mute When Unfocused",
    description: "Mute audio when game is in background",
    defaultValue: false,
    keywords: ["mute", "background", "focus", "tab"],
  },
];

/** Controls settings */
export const CONTROLS_SETTINGS: SettingDefinition[] = [
  {
    id: "controls.mouseSensitivity",
    category: "controls",
    type: "slider",
    label: "Mouse Sensitivity",
    description: "Camera rotation speed with mouse",
    defaultValue: 50,
    min: 10,
    max: 100,
    step: 5,
    unit: "%",
    showValue: true,
    keywords: ["mouse", "sensitivity", "camera", "speed"],
  },
  {
    id: "controls.invertY",
    category: "controls",
    type: "toggle",
    label: "Invert Y-Axis",
    description: "Invert vertical camera movement",
    defaultValue: false,
    keywords: ["invert", "y-axis", "camera", "vertical"],
  },
  {
    id: "controls.invertX",
    category: "controls",
    type: "toggle",
    label: "Invert X-Axis",
    description: "Invert horizontal camera movement",
    defaultValue: false,
    keywords: ["invert", "x-axis", "camera", "horizontal"],
    advanced: true,
  },
  {
    id: "controls.cameraSmoothing",
    category: "controls",
    type: "slider",
    label: "Camera Smoothing",
    description: "Camera movement smoothing",
    defaultValue: 50,
    min: 0,
    max: 100,
    step: 10,
    unit: "%",
    keywords: ["camera", "smooth", "lerp"],
    advanced: true,
  },
  {
    id: "controls.keyMoveForward",
    category: "controls",
    type: "keybind",
    label: "Move Forward",
    description: "Key to move forward",
    defaultValue: "W",
    allowModifiers: false,
    isRebindable: true,
    keywords: ["move", "forward", "walk", "run"],
  },
  {
    id: "controls.keyMoveBackward",
    category: "controls",
    type: "keybind",
    label: "Move Backward",
    description: "Key to move backward",
    defaultValue: "S",
    allowModifiers: false,
    isRebindable: true,
    keywords: ["move", "backward", "back"],
  },
  {
    id: "controls.keyMoveLeft",
    category: "controls",
    type: "keybind",
    label: "Strafe Left",
    description: "Key to strafe left",
    defaultValue: "A",
    allowModifiers: false,
    isRebindable: true,
    keywords: ["strafe", "left", "move"],
  },
  {
    id: "controls.keyMoveRight",
    category: "controls",
    type: "keybind",
    label: "Strafe Right",
    description: "Key to strafe right",
    defaultValue: "D",
    allowModifiers: false,
    isRebindable: true,
    keywords: ["strafe", "right", "move"],
  },
  {
    id: "controls.keyJump",
    category: "controls",
    type: "keybind",
    label: "Jump",
    description: "Key to jump",
    defaultValue: "Space",
    allowModifiers: false,
    isRebindable: true,
    keywords: ["jump", "leap"],
  },
  {
    id: "controls.keySprint",
    category: "controls",
    type: "keybind",
    label: "Sprint",
    description: "Key to sprint/run",
    defaultValue: "Shift",
    allowModifiers: false,
    isRebindable: true,
    keywords: ["sprint", "run", "fast"],
  },
];

/** Interface settings */
export const INTERFACE_SETTINGS: SettingDefinition[] = [
  {
    id: "interface.scale",
    category: "interface",
    type: "slider",
    label: "UI Scale",
    description: "Scale of all interface elements",
    defaultValue: 100,
    min: 75,
    max: 150,
    step: 5,
    unit: "%",
    showValue: true,
    keywords: ["ui", "scale", "size", "interface"],
  },
  {
    id: "interface.chatFontSize",
    category: "interface",
    type: "select",
    label: "Chat Font Size",
    description: "Font size in chat window",
    defaultValue: "medium",
    options: [
      { value: "small", label: "Small" },
      { value: "medium", label: "Medium" },
      { value: "large", label: "Large" },
    ],
    keywords: ["chat", "font", "text", "size"],
  },
  {
    id: "interface.tooltipDelay",
    category: "interface",
    type: "slider",
    label: "Tooltip Delay",
    description: "Delay before tooltips appear",
    defaultValue: 300,
    min: 0,
    max: 1000,
    step: 50,
    unit: "ms",
    keywords: ["tooltip", "delay", "hover"],
  },
  {
    id: "interface.showHealthBars",
    category: "interface",
    type: "toggle",
    label: "Show Health Bars",
    description: "Display health bars above entities",
    defaultValue: true,
    keywords: ["health", "bars", "hp", "display"],
  },
  {
    id: "interface.showDamageNumbers",
    category: "interface",
    type: "toggle",
    label: "Show Damage Numbers",
    description: "Display damage numbers in combat",
    defaultValue: true,
    keywords: ["damage", "numbers", "combat", "hit"],
  },
  {
    id: "interface.showPlayerNames",
    category: "interface",
    type: "toggle",
    label: "Show Player Names",
    description: "Display names above other players",
    defaultValue: true,
    keywords: ["names", "players", "display"],
  },
  {
    id: "interface.minimapSize",
    category: "interface",
    type: "select",
    label: "Minimap Size",
    description: "Size of the minimap",
    defaultValue: "medium",
    options: [
      { value: "small", label: "Small" },
      { value: "medium", label: "Medium" },
      { value: "large", label: "Large" },
    ],
    keywords: ["minimap", "size", "map"],
  },
  {
    id: "interface.minimapRotate",
    category: "interface",
    type: "toggle",
    label: "Rotate Minimap",
    description: "Minimap rotates with camera",
    defaultValue: true,
    keywords: ["minimap", "rotate", "compass"],
  },
];

/** Gameplay settings */
export const GAMEPLAY_SETTINGS: SettingDefinition[] = [
  {
    id: "gameplay.autoLoot",
    category: "gameplay",
    type: "toggle",
    label: "Auto-Loot",
    description: "Automatically collect nearby loot",
    defaultValue: false,
    keywords: ["auto", "loot", "collect", "pickup"],
  },
  {
    id: "gameplay.autoLootRange",
    category: "gameplay",
    type: "slider",
    label: "Auto-Loot Range",
    description: "Range for automatic loot collection",
    defaultValue: 3,
    min: 1,
    max: 10,
    step: 1,
    unit: "m",
    keywords: ["auto", "loot", "range", "distance"],
    dependsOn: {
      settingId: "gameplay.autoLoot",
      value: true,
    },
  },
  {
    id: "gameplay.combatMode",
    category: "gameplay",
    type: "select",
    label: "Combat Mode",
    description: "Combat input style",
    defaultValue: "revolution",
    options: [
      { value: "manual", label: "Full Manual" },
      { value: "revolution", label: "Revolution" },
      { value: "legacy", label: "Legacy" },
    ],
    keywords: ["combat", "mode", "revolution", "manual", "legacy"],
  },
  {
    id: "gameplay.targetReticle",
    category: "gameplay",
    type: "toggle",
    label: "Target Reticle",
    description: "Show targeting reticle on enemies",
    defaultValue: true,
    keywords: ["target", "reticle", "crosshair", "enemy"],
  },
  {
    id: "gameplay.confirmLogout",
    category: "gameplay",
    type: "toggle",
    label: "Confirm Logout",
    description: "Ask for confirmation when logging out",
    defaultValue: true,
    keywords: ["logout", "confirm", "exit"],
  },
  {
    id: "gameplay.autoRetaliateEnabled",
    category: "gameplay",
    type: "toggle",
    label: "Auto-Retaliate",
    description: "Automatically attack enemies that attack you",
    defaultValue: true,
    keywords: ["auto", "retaliate", "combat", "attack"],
  },
];

/** Accessibility settings */
export const ACCESSIBILITY_SETTINGS: SettingDefinition[] = [
  {
    id: "accessibility.colorblindMode",
    category: "accessibility",
    type: "select",
    label: "Colorblind Mode",
    description: "Adjust colors for colorblindness",
    defaultValue: "none",
    options: [
      { value: "none", label: "None" },
      { value: "protanopia", label: "Protanopia (Red-Blind)" },
      { value: "deuteranopia", label: "Deuteranopia (Green-Blind)" },
      { value: "tritanopia", label: "Tritanopia (Blue-Blind)" },
    ],
    keywords: ["colorblind", "color", "accessibility", "vision"],
  },
  {
    id: "accessibility.screenReader",
    category: "accessibility",
    type: "toggle",
    label: "Screen Reader Support",
    description: "Enable enhanced screen reader support",
    defaultValue: false,
    keywords: ["screen reader", "accessibility", "blind", "aria"],
  },
  {
    id: "accessibility.highContrast",
    category: "accessibility",
    type: "toggle",
    label: "High Contrast",
    description: "Increase contrast for better visibility",
    defaultValue: false,
    keywords: ["contrast", "visibility", "accessibility"],
  },
  {
    id: "accessibility.reducedMotion",
    category: "accessibility",
    type: "toggle",
    label: "Reduced Motion",
    description: "Minimize animations and transitions",
    defaultValue: false,
    keywords: ["motion", "animation", "reduce", "accessibility"],
  },
  {
    id: "accessibility.largeText",
    category: "accessibility",
    type: "toggle",
    label: "Large Text",
    description: "Increase text size throughout the UI",
    defaultValue: false,
    keywords: ["text", "large", "size", "font", "accessibility"],
  },
  {
    id: "accessibility.subtitles",
    category: "accessibility",
    type: "toggle",
    label: "Subtitles",
    description: "Show subtitles for dialogue and sounds",
    defaultValue: true,
    keywords: ["subtitles", "captions", "deaf", "hearing"],
  },
  {
    id: "accessibility.flashingEffects",
    category: "accessibility",
    type: "toggle",
    label: "Flashing Effects",
    description: "Enable flashing visual effects",
    defaultValue: true,
    keywords: ["flash", "effects", "seizure", "photosensitive"],
  },
  {
    id: "accessibility.focusHighlight",
    category: "accessibility",
    type: "toggle",
    label: "Focus Highlight",
    description: "Show focus indicators for keyboard navigation",
    defaultValue: true,
    keywords: ["focus", "keyboard", "navigation", "highlight"],
  },
];

/** All settings combined */
export const ALL_SETTINGS: SettingDefinition[] = [
  ...GRAPHICS_SETTINGS,
  ...AUDIO_SETTINGS,
  ...CONTROLS_SETTINGS,
  ...INTERFACE_SETTINGS,
  ...GAMEPLAY_SETTINGS,
  ...ACCESSIBILITY_SETTINGS,
];

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get settings for a specific category
 */
export function getSettingsByCategory(
  category: SettingCategory,
): SettingDefinition[] {
  return ALL_SETTINGS.filter((s) => s.category === category);
}

/**
 * Get a setting definition by ID
 */
export function getSettingById(id: string): SettingDefinition | undefined {
  return ALL_SETTINGS.find((s) => s.id === id);
}

/**
 * Get default values for all settings
 */
export function getDefaultValues(): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};
  for (const setting of ALL_SETTINGS) {
    defaults[setting.id] = setting.defaultValue;
  }
  return defaults;
}

/**
 * Get default values for a specific category
 */
export function getCategoryDefaults(
  category: SettingCategory,
): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};
  for (const setting of getSettingsByCategory(category)) {
    defaults[setting.id] = setting.defaultValue;
  }
  return defaults;
}

/**
 * Search settings by query
 */
export function searchSettings(query: string): SettingDefinition[] {
  const q = query.toLowerCase().trim();
  if (!q) return ALL_SETTINGS;

  return ALL_SETTINGS.filter((setting) => {
    const searchableText = [
      setting.label,
      setting.description ?? "",
      ...(setting.keywords ?? []),
    ]
      .join(" ")
      .toLowerCase();

    return searchableText.includes(q);
  });
}

/**
 * Validate a setting value against its definition
 */
export function validateSettingValue(
  setting: SettingDefinition,
  value: unknown,
): boolean {
  switch (setting.type) {
    case "slider":
    case "number": {
      if (typeof value !== "number") return false;
      if (setting.min !== undefined && value < setting.min) return false;
      if (setting.max !== undefined && value > setting.max) return false;
      return true;
    }
    case "toggle":
      return typeof value === "boolean";
    case "select":
      return (
        typeof value === "string" &&
        setting.options.some((o) => o.value === value)
      );
    case "keybind":
      return typeof value === "string";
    case "color":
      return typeof value === "string" && /^#[0-9A-Fa-f]{6,8}$/.test(value);
    default:
      return true;
  }
}
