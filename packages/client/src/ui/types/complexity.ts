/**
 * Progressive Complexity Mode Types
 *
 * Defines the complexity tiering system that shows/hides features
 * based on player experience level.
 *
 * @packageDocumentation
 */

/** Complexity mode levels */
export type ComplexityMode = "simple" | "standard" | "advanced";

/** Feature visibility flags for each mode */
export interface ComplexityFeatures {
  /** Edit mode for customizing interface layout (advanced only) */
  editMode: boolean;
  /** Multiple action bars (standard+) */
  multipleActionBars: boolean;
  /** Combining windows into tabbed groups (standard+) */
  windowCombining: boolean;
  /** Advanced HUD elements like buff bars (standard+) */
  advancedHUD: boolean;
  /** Custom keybind configuration (standard+) */
  customKeybinds: boolean;
  /** Interface sharing - ability to load presets from others (all modes) */
  interfaceSharing: boolean;
  /** Interface sharing - ability to publish/share your own presets (standard+) */
  interfaceSharingPublish: boolean;
  /** Detailed tooltips with stats and requirements (standard+) */
  detailedTooltips: boolean;
  /** Preset hotkeys F1-F4 (standard+) */
  presetHotkeys: boolean;
}

/** Configuration for a complexity mode */
export interface ComplexityModeConfig {
  /** The mode identifier */
  mode: ComplexityMode;
  /** Feature visibility flags */
  features: ComplexityFeatures;
  /** Display name for UI */
  displayName: string;
  /** Description for UI */
  description: string;
}

/**
 * Feature visibility by complexity mode
 *
 * Simple: New players, minimal UI, essential features only
 * Standard: Most features unlocked, recommended for regular play
 * Advanced: All features, full customization for power users
 */
export const COMPLEXITY_MODE_CONFIGS: Record<
  ComplexityMode,
  ComplexityModeConfig
> = {
  simple: {
    mode: "simple",
    displayName: "Simple",
    description: "Streamlined interface for new players",
    features: {
      editMode: false,
      multipleActionBars: false,
      windowCombining: false,
      advancedHUD: false,
      customKeybinds: false,
      interfaceSharing: true, // Can load presets from others
      interfaceSharingPublish: false, // Cannot share own presets
      detailedTooltips: false,
      presetHotkeys: false,
    },
  },
  standard: {
    mode: "standard",
    displayName: "Standard",
    description: "Full interface with all common features",
    features: {
      editMode: false,
      multipleActionBars: true,
      windowCombining: true,
      advancedHUD: true,
      customKeybinds: true,
      interfaceSharing: true,
      interfaceSharingPublish: true,
      detailedTooltips: true,
      presetHotkeys: true,
    },
  },
  advanced: {
    mode: "advanced",
    displayName: "Advanced",
    description: "Complete customization for power users",
    features: {
      editMode: true,
      multipleActionBars: true,
      windowCombining: true,
      advancedHUD: true,
      customKeybinds: true,
      interfaceSharing: true,
      interfaceSharingPublish: true,
      detailedTooltips: true,
      presetHotkeys: true,
    },
  },
};

/** Thresholds for auto-progression prompts */
export interface ProgressionThresholds {
  /** Hours of playtime to suggest standard mode */
  standardPlaytimeHours: number;
  /** Tutorial completion to suggest standard mode */
  tutorialComplete: boolean;
  /** Hours of playtime to suggest advanced mode */
  advancedPlaytimeHours: number;
  /** Player level to suggest advanced mode */
  advancedPlayerLevel: number;
}

/** Default progression thresholds */
export const DEFAULT_PROGRESSION_THRESHOLDS: ProgressionThresholds = {
  standardPlaytimeHours: 2,
  tutorialComplete: true,
  advancedPlaytimeHours: 10,
  advancedPlayerLevel: 50,
};
