import { useCallback } from "react";
import { useWindowStore } from "../../stores/windowStore";
import type { WindowState } from "../../types";

export interface ValidationResult {
  errors: string[];
  warnings: string[];
  canSave: boolean;
}

export interface LayoutValidationConfig {
  requiredPanels?: string[];
  maxOcclusionPercent?: number;
  viewportMargin?: number;
}

export interface LayoutValidationResult {
  validate: (windows?: WindowState[]) => ValidationResult;
  validateWindow: (window: WindowState) => ValidationResult;
}

const DEFAULT_CONFIG: Required<LayoutValidationConfig> = {
  requiredPanels: [],
  maxOcclusionPercent: 80,
  viewportMargin: 0,
};

function getWindowLabel(window: WindowState): string {
  return window.tabs[0]?.label || window.id;
}

export function useLayoutValidation(
  config: LayoutValidationConfig = {},
): LayoutValidationResult {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };
  const getAllWindows = useWindowStore((s) => s.getAllWindows);

  const isOffScreen = useCallback(
    (window: WindowState): boolean => {
      const viewport = {
        width:
          typeof globalThis.window !== "undefined"
            ? globalThis.window.innerWidth
            : 1920,
        height:
          typeof globalThis.window !== "undefined"
            ? globalThis.window.innerHeight
            : 1080,
      };
      const margin = mergedConfig.viewportMargin;

      return (
        window.position.x + window.size.width < margin ||
        window.position.x > viewport.width - margin ||
        window.position.y + window.size.height < margin ||
        window.position.y > viewport.height - margin
      );
    },
    [mergedConfig.viewportMargin],
  );

  const calculateOcclusion = useCallback((windows: WindowState[]): number => {
    const viewport = {
      width:
        typeof globalThis.window !== "undefined"
          ? globalThis.window.innerWidth
          : 1920,
      height:
        typeof globalThis.window !== "undefined"
          ? globalThis.window.innerHeight
          : 1080,
    };
    const viewportArea = viewport.width * viewport.height;

    const coveredArea = windows
      .filter((w) => w.visible)
      .reduce((sum, w) => sum + w.size.width * w.size.height, 0);

    return (coveredArea / viewportArea) * 100;
  }, []);

  const validateWindow = useCallback(
    (window: WindowState): ValidationResult => {
      const errors: string[] = [];
      const warnings: string[] = [];
      const label = getWindowLabel(window);

      if (isOffScreen(window)) {
        errors.push(`Window "${label}" is off-screen`);
      }

      if (window.size.width < (window.minSize?.width ?? 100)) {
        warnings.push(`Window "${label}" is below minimum width`);
      }

      if (window.size.height < (window.minSize?.height ?? 50)) {
        warnings.push(`Window "${label}" is below minimum height`);
      }

      return { errors, warnings, canSave: errors.length === 0 };
    },
    [isOffScreen],
  );

  const validate = useCallback(
    (windows?: WindowState[]): ValidationResult => {
      const allWindows = windows ?? getAllWindows();
      const errors: string[] = [];
      const warnings: string[] = [];

      for (const window of allWindows) {
        const result = validateWindow(window);
        errors.push(...result.errors);
        warnings.push(...result.warnings);
      }

      const presentPanels = new Set(
        allWindows.flatMap((w) => w.tabs.map((t) => t.id)),
      );
      for (const required of mergedConfig.requiredPanels) {
        if (!presentPanels.has(required)) {
          errors.push(`Required panel "${required}" is missing`);
        }
      }

      const occlusion = calculateOcclusion(allWindows);
      if (occlusion > mergedConfig.maxOcclusionPercent) {
        warnings.push(
          `${occlusion.toFixed(0)}% of viewport covered by windows`,
        );
      }

      return { errors, warnings, canSave: errors.length === 0 };
    },
    [getAllWindows, validateWindow, calculateOcclusion, mergedConfig],
  );

  return { validate, validateWindow };
}
