/**
 * Hyperscape Interface Components
 *
 * Built on hs-kit for customizable windows, tabs, and layout presets.
 *
 * @packageDocumentation
 */

// Core interface components
export { InterfaceManager } from "./InterfaceManager";
export { NavigationRibbon } from "./NavigationRibbon";

// Panel registry for wiring up game panels
export {
  createPanelRenderer,
  getAvailablePanels,
  getPanelConfig,
  getPanelSizeForViewport,
  getResponsivePanelSize,
  calculateResponsiveSize,
  getDeviceType,
  constrainToAspectRatio,
  PANEL_CONFIG,
  type PanelRenderContext,
  type PanelConfig,
  type PanelSize,
  type ResponsiveSizes,
} from "./PanelRegistry";

// Community preset sharing
export { LoadFromPlayer, type LoadFromPlayerProps } from "./LoadFromPlayer";
