/**
 * hs-kit Theme - Re-exports from themes.ts
 *
 * This file provides backwards compatibility.
 * The main theme system is now in themes.ts with base and hyperscape variants.
 *
 * @deprecated Import from themes.ts instead
 * @packageDocumentation
 */

// Re-export the hyperscape theme as default for backwards compatibility
export {
  hyperscapeTheme as theme,
  type Theme,
  getThemedGlassmorphismStyle as getGlassmorphismStyle,
  getThemedWindowShadow as getWindowShadow,
} from "./themes";

// Re-export the hyperscape theme directly
import { hyperscapeTheme as defaultTheme } from "./themes";
export default defaultTheme;
