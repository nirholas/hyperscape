/**
 * useResponsiveValue Hook
 *
 * Returns mobile or desktop value based on current layout.
 * Eliminates repeated `shouldUseMobileUI ? X : Y` ternary chains.
 *
 * @packageDocumentation
 */

import { useMobileLayout } from "hs-kit";

/**
 * Returns the appropriate value based on whether mobile UI is active.
 *
 * @param mobileValue - Value to use on mobile
 * @param desktopValue - Value to use on desktop
 * @returns The appropriate value for the current layout
 *
 * @example
 * ```tsx
 * // Before
 * height: shouldUseMobileUI ? MOBILE_CHAT.tabBarHeight : "auto"
 *
 * // After
 * const height = useResponsiveValue(MOBILE_CHAT.tabBarHeight, "auto");
 * ```
 */
export function useResponsiveValue<T>(mobileValue: T, desktopValue: T): T {
  const { shouldUseMobileUI } = useMobileLayout();
  return shouldUseMobileUI ? mobileValue : desktopValue;
}

/**
 * Returns responsive values for multiple properties at once.
 * More efficient than multiple useResponsiveValue calls.
 *
 * @param values - Object mapping property names to [mobileValue, desktopValue] tuples
 * @returns Object with the appropriate values for the current layout
 *
 * @example
 * ```tsx
 * const { height, padding, gap } = useResponsiveValues({
 *   height: [MOBILE_CHAT.tabBarHeight, "auto"],
 *   padding: [12, 8],
 *   gap: [8, 4],
 * });
 * ```
 */
export function useResponsiveValues<
  T extends Record<string, [unknown, unknown]>,
>(values: T): { [K in keyof T]: T[K][0] | T[K][1] } {
  const { shouldUseMobileUI } = useMobileLayout();
  const result = {} as { [K in keyof T]: T[K][0] | T[K][1] };

  for (const key in values) {
    const [mobileValue, desktopValue] = values[key];
    result[key] = shouldUseMobileUI ? mobileValue : desktopValue;
  }

  return result;
}
