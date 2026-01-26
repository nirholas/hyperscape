/**
 * Core types for UI system
 * @packageDocumentation
 */

import type { ReactNode } from "react";

// ============================================================================
// Branded Types
// ============================================================================

/**
 * Brand symbol for creating nominal types.
 * Used to prevent accidental mixing of string IDs at compile time.
 */
declare const __brand: unique symbol;

/**
 * Branded type helper - creates a nominal type from a base type.
 * This ensures that WindowId and TabId cannot be accidentally interchanged.
 */
export type Brand<T, B extends string> = T & { readonly [__brand]: B };

/**
 * Branded type for Window IDs.
 * Use `createWindowId()` to create instances safely.
 */
export type WindowId = Brand<string, "WindowId">;

/**
 * Branded type for Tab IDs.
 * Use `createTabId()` to create instances safely.
 */
export type TabId = Brand<string, "TabId">;

/**
 * Branded type for Preset IDs.
 * Use `createPresetId()` to create instances safely.
 */
export type PresetId = Brand<string, "PresetId">;

/**
 * Create a branded WindowId from a string.
 */
export function createWindowId(id: string): WindowId {
  return id as WindowId;
}

/**
 * Create a branded TabId from a string.
 */
export function createTabId(id: string): TabId {
  return id as TabId;
}

/**
 * Create a branded PresetId from a string.
 */
export function createPresetId(id: string): PresetId {
  return id as PresetId;
}

// ============================================================================
// Geometry Types
// ============================================================================

/** 2D point coordinates */
export interface Point {
  x: number;
  y: number;
}

/** 2D size dimensions */
export interface Size {
  width: number;
  height: number;
}

/** Rectangle combining position and size */
export interface Rect extends Point, Size {}

/** Edges of a rectangle */
export interface Edges {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

// ============================================================================
// Drag System Types
// ============================================================================

/** Types of draggable items */
export type DragItemType =
  | "window"
  | "tab"
  | "resize-handle"
  | "item"
  | "custom";

/** Direction for resize handles */
export type ResizeDirection = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/** Data attached to a drag operation */
export interface DragItem {
  id: string;
  type: DragItemType;
  sourceId: string | null;
  data?: unknown;
}

/** Current state of a drag operation */
export interface DragState {
  /** Whether a drag is in progress */
  isDragging: boolean;
  /** The item being dragged */
  item: DragItem | null;
  /** Starting position of the drag */
  origin: Point;
  /** Current position of the pointer */
  current: Point;
  /** Delta from origin to current */
  delta: Point;
  /** IDs of drop targets currently being hovered */
  overTargets: string[];
}

/** Configuration for useDrag hook */
export interface DragConfig {
  /** Unique identifier for this draggable */
  id: string;
  /** Type of drag item */
  type: DragItemType;
  /** Optional source identifier (e.g., window ID for tab drags) */
  sourceId?: string;
  /** Custom data to attach to the drag */
  data?: unknown;
  /** Disable dragging */
  disabled?: boolean;
  /** Callback when drag starts */
  onDragStart?: (item: DragItem) => void;
  /** Callback during drag */
  onDrag?: (item: DragItem, delta: Point) => void;
  /** Callback when drag ends */
  onDragEnd?: (item: DragItem, delta: Point) => void;
}

/** Return value from useDrag hook */
export interface DragResult {
  /** Whether this item is currently being dragged */
  isDragging: boolean;
  /** Current drag delta from origin (updated in real-time during drag) */
  delta: Point;
  /** Current absolute position (updated in real-time during drag) */
  position: Point;
  /** Props to spread on the drag handle element */
  dragHandleProps: {
    onPointerDown: (e: React.PointerEvent) => void;
    style: { cursor: string; touchAction: string };
  };
}

/** Configuration for useDrop hook */
export interface DropConfig {
  /** Unique identifier for this drop target */
  id: string;
  /** Types of items this target accepts */
  accepts: DragItemType[];
  /** Callback when item is dropped */
  onDrop: (item: DragItem, position: Point) => void;
  /** Callback when drag enters this target */
  onDragEnter?: (item: DragItem) => void;
  /** Callback when drag leaves this target */
  onDragLeave?: (item: DragItem) => void;
  /** Callback while dragging over this target */
  onDragOver?: (item: DragItem, position: Point) => void;
  /** Disable this drop target */
  disabled?: boolean;
}

/** Return value from useDrop hook */
export interface DropResult {
  /** Whether a compatible drag is over this target */
  isOver: boolean;
  /** Whether the current drag can be dropped here */
  canDrop: boolean;
  /** Current drag position relative to the drop target (0,0 is top-left corner) */
  relativePosition: Point | null;
  /** Bounding rect of the drop target element */
  dropRect: Rect | null;
  /** The current drag item (if any) */
  dragItem: DragItem | null;
  /** Props to spread on the drop target element */
  dropProps: {
    ref: React.RefCallback<HTMLElement>;
    "data-drop-id": string;
  };
}

// ============================================================================
// Window System Types
// ============================================================================

/**
 * Anchor points for window positioning relative to viewport.
 * Based on Unity/Unreal UI best practices, windows maintain their position
 * relative to their anchor point when the viewport resizes.
 */
export type WindowAnchor =
  | "top-left"
  | "top-center"
  | "top-right"
  | "left-center"
  | "center"
  | "right-center"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

/** State of a single tab */
export interface TabState {
  /** Unique identifier */
  id: string;
  /** ID of the window containing this tab */
  windowId: string;
  /** Display label */
  label: string;
  /** Optional icon (URL or component name) */
  icon?: string;
  /** Whether this tab can be closed */
  closeable: boolean;
  /** Content to render (panel ID or component) */
  content: ReactNode | string;
}

/** Configuration for creating a new tab */
export interface TabConfig {
  /** Optional ID (generated if not provided) */
  id?: string;
  /** Display label */
  label: string;
  /** Optional icon */
  icon?: string;
  /** Whether closeable */
  closeable?: boolean;
  /** Content */
  content: ReactNode | string;
}

/** State of a single window */
export interface WindowState {
  /** Unique identifier */
  id: string;
  /** Position on screen */
  position: Point;
  /** Current size */
  size: Size;
  /** Minimum allowed size */
  minSize: Size;
  /** Maximum allowed size (optional) */
  maxSize?: Size;
  /** Aspect ratio to maintain during resize (width/height, e.g., 1.0 for square) */
  aspectRatio?: number;
  /** Tabs contained in this window */
  tabs: TabState[];
  /** Index of the active tab */
  activeTabIndex: number;
  /** Transparency level (0-100, 0 = fully transparent) */
  transparency: number;
  /** Whether the window is visible */
  visible: boolean;
  /** Z-index for layering */
  zIndex: number;
  /** Whether window is locked (not draggable in locked mode) */
  locked: boolean;
  /** Anchor point for viewport-relative positioning (defaults to top-left if not set) */
  anchor?: WindowAnchor;
}

/** Configuration for creating a new window */
export interface WindowConfig {
  /** Optional ID (generated if not provided) */
  id?: string;
  /** Initial position */
  position?: Point;
  /** Initial size */
  size?: Size;
  /** Minimum size */
  minSize?: Size;
  /** Maximum size */
  maxSize?: Size;
  /** Aspect ratio to maintain during resize (width/height, e.g., 1.0 for square) */
  aspectRatio?: number;
  /** Initial tabs */
  tabs?: TabConfig[];
  /** Initial transparency (0-100) */
  transparency?: number;
  /** Anchor point for viewport-relative positioning */
  anchor?: WindowAnchor;
}

// ============================================================================
// Edit Mode Types
// ============================================================================

/** Interface mode */
export type EditMode = "locked" | "unlocked";

/** Edit mode state */
export interface EditState {
  /** Current mode */
  mode: EditMode;
  /** Grid size in pixels */
  gridSize: number;
  /** Whether snap to grid is enabled */
  snapEnabled: boolean;
  /** Whether to show grid overlay */
  showGrid: boolean;
  /** Whether to show alignment guides */
  showGuides: boolean;
}

/** Alignment guide line */
export interface AlignmentGuide {
  /** Type of alignment */
  type: "edge" | "center";
  /** Which edge/center */
  edge: "left" | "right" | "top" | "bottom" | "centerX" | "centerY";
  /** Position of the guide line */
  position: number;
  /** ID of the window this aligns with */
  targetWindowId: string;
}

// ============================================================================
// Preset System Types
// ============================================================================

/** Saved layout preset */
export interface LayoutPreset {
  /** Unique identifier */
  id: string;
  /** Display name */
  name: string;
  /** Window states */
  windows: WindowState[];
  /** When preset was created */
  createdAt: number;
  /** When preset was last modified */
  modifiedAt: number;
  /** Screen resolution when preset was saved */
  resolution: Size;
}

/** Return value from usePresets hook */
export interface PresetsResult {
  /** All saved presets */
  presets: LayoutPreset[];
  /** Currently active preset (if any) */
  activePreset: LayoutPreset | null;
  /** Save current layout as a preset */
  savePreset: (name: string) => Promise<LayoutPreset>;
  /** Load a preset */
  loadPreset: (id: string) => Promise<void>;
  /** Delete a preset */
  deletePreset: (id: string) => Promise<void>;
  /** Update preset name */
  renamePreset: (id: string, name: string) => Promise<void>;
  /** Whether presets are loading */
  isLoading: boolean;
}

/** Return value from useEditMode hook */
export interface EditModeResult {
  /** Current mode */
  mode: EditMode;
  /** Whether interface is locked */
  isLocked: boolean;
  /** Whether interface is unlocked (editing) */
  isUnlocked: boolean;
  /** Toggle between modes */
  toggleMode: () => void;
  /** Set specific mode */
  setMode: (mode: EditMode) => void;
  /** Grid settings */
  gridSize: number;
  /** Snap enabled */
  snapEnabled: boolean;
  /** Set snap enabled */
  setSnapEnabled: (enabled: boolean) => void;
  /** Show grid */
  showGrid: boolean;
  /** Set show grid */
  setShowGrid: (show: boolean) => void;
  /** Show guides */
  showGuides: boolean;
  /** Set show guides */
  setShowGuides: (show: boolean) => void;

  // Hold-to-toggle state (for visual feedback)
  /** Whether user is currently holding the toggle key */
  isHolding: boolean;
  /** Current hold progress (0-100) */
  holdProgress: number;

  // Hold-to-toggle settings
  /** Whether hold-to-toggle is enabled (vs instant toggle) */
  holdToToggle: boolean;
  /** Duration in ms required to hold before toggle */
  holdDuration: number;
  /** The key used to toggle edit mode */
  toggleKey: string;
  /** Set hold-to-toggle enabled */
  setHoldToToggle: (enabled: boolean) => void;
  /** Set hold duration */
  setHoldDuration: (duration: number) => void;
  /** Set toggle key */
  setToggleKey: (key: string) => void;
}

/** Return value from useGrid hook */
export interface GridResult {
  /** Snap a value to the grid */
  snapToGrid: (value: number) => number;
  /** Snap a point to the grid */
  snapPointToGrid: (point: Point) => Point;
  /** Get grid lines for rendering */
  getGridLines: (viewport: Size) => {
    x: number[];
    y: number[];
    majorX: number[];
    majorY: number[];
  };
  /** Major grid size (e.g., every 4th line) */
  majorGridSize: number;
}

/** Return value from useTabs hook */
export interface TabsResult {
  /** All tabs in the window */
  tabs: TabState[];
  /** Currently active tab */
  activeTab: TabState | undefined;
  /** Active tab index */
  activeTabIndex: number;
  /** Set active tab by index */
  setActiveTab: (index: number) => void;
  /** Add a new tab */
  addTab: (config: TabConfig) => TabState;
  /** Remove a tab by ID */
  removeTab: (tabId: string) => void;
  /** Reorder tabs */
  reorderTabs: (fromIndex: number, toIndex: number) => void;
}

/** Operations for moving tabs between windows */
export interface TabOperations {
  /** Move a tab to another window */
  moveTab: (tabId: string, targetWindowId: string, index?: number) => void;
  /** Split a tab into a new window */
  splitTab: (tabId: string, position: Point) => WindowState;
  /** Merge all tabs from one window into another */
  mergeWindow: (sourceWindowId: string, targetWindowId: string) => void;
}

/** Return value from useWindow hook */
export interface WindowResult {
  /** Current window state */
  window: WindowState;
  /** Update window position */
  updatePosition: (position: Point) => void;
  /** Update window size */
  updateSize: (size: Size) => void;
  /** Close (remove) the window */
  close: () => void;
  /** Bring window to front */
  bringToFront: () => void;
  /** Set transparency level */
  setTransparency: (value: number) => void;
  /** Toggle visibility */
  toggleVisible: () => void;
}

// ============================================================================
// Component Props Types
// ============================================================================

/** Props for Window component */
export interface WindowProps {
  /** Unique window identifier */
  windowId: string;
  /** Optional pre-fetched window state (for optimization) */
  windowState?: WindowState;
  /** Override for edit mode (bypasses store lookup) */
  isUnlocked?: boolean;
  /** Whether window combining via tab drag is enabled */
  windowCombiningEnabled?: boolean;
  /** Error handler callback */
  onError?: (error: Error, windowId: string) => void;
  /** Custom error fallback component */
  errorFallback?: ReactNode;
  /** Whether to show error UI on error */
  showErrorUI?: boolean;
  /** Window content */
  children?: ReactNode;
  /** Optional className */
  className?: string;
  /** Optional style */
  style?: React.CSSProperties;
}

/** Props for Tab component */
export interface TabProps {
  /** Tab state */
  tab: TabState;
  /** Whether this tab is active */
  isActive: boolean;
  /** Callback when tab is clicked */
  onActivate: () => void;
  /** Callback when close button is clicked */
  onClose?: () => void;
  /** Optional className */
  className?: string;
  /** Optional style */
  style?: React.CSSProperties;
}

/** Props for TabBar component */
export interface TabBarProps {
  /** Window ID this tab bar belongs to */
  windowId: string;
  /** Optional className */
  className?: string;
  /** Optional style */
  style?: React.CSSProperties;
}

/** Props for AlignmentGuides component */
export interface AlignmentGuidesProps {
  /** Array of alignment guides to display */
  guides: AlignmentGuide[];
  /** Optional className */
  className?: string;
  /** Optional style */
  style?: React.CSSProperties;
}

/** Props for EditModeOverlay component */
export interface EditModeOverlayProps {
  /** Optional className */
  className?: string;
  /** Optional style */
  style?: React.CSSProperties;
  /** Current number of action bars */
  actionBarCount?: number;
  /** Maximum number of action bars allowed */
  maxActionBars?: number;
  /** Callback when add action bar button is clicked */
  onAddActionBar?: () => void;
}

/** Props for PresetPanel component */
export interface PresetPanelProps {
  /** Optional className */
  className?: string;
  /** Optional style */
  style?: React.CSSProperties;
}

/** Props for TransparencySlider component */
export interface TransparencySliderProps {
  /** Current transparency value (0-100) */
  value: number;
  /** Callback when value changes */
  onChange: (value: number) => void;
  /** Optional className */
  className?: string;
  /** Optional style */
  style?: React.CSSProperties;
}

// ============================================================================
// Hook Result Types
// ============================================================================

/** Return value from useAlignmentGuides hook */
export interface AlignmentGuidesResult {
  /** Currently active alignment guides */
  guides: AlignmentGuide[];
  /** Snap a position to alignment guides */
  snapToGuide: (position: Point, size: Size) => Point;
  /** Calculate current alignment guides */
  calculateGuides: (position: Point, size: Size) => AlignmentGuide[];
}

/** Return value from useWindowManager hook */
export interface WindowManagerResult {
  /** All windows sorted by z-index */
  windows: WindowState[];
  /** Create a new window */
  createWindow: (config?: WindowConfig) => WindowState;
  /** Destroy a window by ID */
  destroyWindow: (id: string) => void;
  /** Get a window by ID */
  getWindow: (id: string) => WindowState | undefined;
  /** Get the top-most window */
  getTopWindow: () => WindowState | undefined;
  /** Reset all windows to initial state */
  resetLayout: () => void;
}
