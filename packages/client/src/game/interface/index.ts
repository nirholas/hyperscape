/**
 * Hyperscape Interface Components
 *
 * Customizable windows, tabs, and layout presets for game UI.
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

// Shared hooks for player data and modal panels
export {
  usePlayerData,
  useModalPanels,
  type PlayerDataState,
  type ModalPanelsState,
  type BankData,
  type StoreData,
  type DialogueData,
  type SmeltingData,
  type SmithingData,
  type LootWindowData,
  type QuestStartData,
  type QuestCompleteData,
  type XpLampData,
} from "@/hooks";

// Mobile interface components
export { MobileInterfaceManager } from "./MobileInterfaceManager";
export { CompactStatusHUD } from "./CompactStatusHUD";
export { getMobileUISizes } from "./mobileUISizes";
