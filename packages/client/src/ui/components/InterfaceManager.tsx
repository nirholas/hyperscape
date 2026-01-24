/**
 * Interface Manager Component
 *
 * The unified wrapper component that brings together all hs-kit features.
 * Provides windows, tabs, edit mode, presets, and more in a single component.
 *
 * @packageDocumentation
 */

import React, { type ReactNode, useEffect, useCallback } from "react";
import { DragProvider } from "../core/drag/DragContext";
import { useEditStore } from "../stores/editStore";
import { useWindowStore } from "../stores/windowStore";
import { usePresetStore } from "../stores/presetStore";
import { useTheme } from "../stores/themeStore";
import { EditModeOverlay } from "./EditModeOverlay";
import { DragOverlay } from "./DragOverlay";
import type { WindowState } from "../types";

/** Props for InterfaceManager */
export interface InterfaceManagerProps {
  /** Children to render (typically game viewport) */
  children?: ReactNode;

  /** Initial windows configuration */
  initialWindows?: WindowState[];

  /** Whether to show edit mode overlay */
  showEditOverlay?: boolean;

  /** Whether to show drag overlay */
  showDragOverlay?: boolean;

  /** Whether to enable preset hotkeys (F1-F4) */
  enablePresetHotkeys?: boolean;

  /** Whether to enable edit mode hotkey (L) */
  enableEditHotkey?: boolean;

  /** Callback when mode changes */
  onModeChange?: (mode: "locked" | "unlocked") => void;

  /** Callback when preset is loaded */
  onPresetLoad?: (presetId: number) => void;

  /** Custom render function for windows */
  renderWindow?: (window: WindowState) => ReactNode;

  /** Custom render function for panel content */
  renderPanel?: (panelId: string) => ReactNode;

  /** Z-index base for the interface layer */
  zIndexBase?: number;

  /** Custom className */
  className?: string;

  /** Custom style */
  style?: React.CSSProperties;
}

/**
 * Interface Manager Component
 *
 * The main entry point for hs-kit's UI system. Wraps your application
 * and provides all the necessary context and overlays.
 *
 * @example
 * ```tsx
 * function Game() {
 *   return (
 *     <InterfaceManager
 *       showEditOverlay
 *       showDragOverlay
 *       enablePresetHotkeys
 *       enableEditHotkey
 *       renderWindow={(window) => <GameWindow window={window} />}
 *       renderPanel={(panelId) => <GamePanel panelId={panelId} />}
 *     >
 *       <GameViewport />
 *     </InterfaceManager>
 *   );
 * }
 * ```
 */
export function InterfaceManager({
  children,
  initialWindows,
  showEditOverlay = true,
  showDragOverlay = true,
  enablePresetHotkeys = true,
  enableEditHotkey = true,
  onModeChange,
  onPresetLoad,
  renderWindow,
  renderPanel: _renderPanel,
  zIndexBase = 0,
  className,
  style,
}: InterfaceManagerProps): React.ReactElement {
  const mode = useEditStore((s) => s.mode);
  const toggleMode = useEditStore((s) => s.toggleMode);
  const windows = useWindowStore((s) => s.getAllWindows());
  const setWindows = useWindowStore((s) => s.setWindows);
  const presets = usePresetStore((s) => s.presets);
  const setActivePreset = usePresetStore((s) => s.setActivePreset);
  const theme = useTheme();

  // Initialize windows if provided
  useEffect(() => {
    if (initialWindows && initialWindows.length > 0) {
      setWindows(initialWindows);
    }
  }, []); // Only on mount

  // Handle mode change callback
  useEffect(() => {
    onModeChange?.(mode);
  }, [mode, onModeChange]);

  // Load a preset by index (F1=0, F2=1, etc.)
  const loadPresetByIndex = useCallback(
    (index: number) => {
      const preset = presets[index];
      if (preset) {
        setWindows(preset.windows);
        setActivePreset(preset.id);
        onPresetLoad?.(index);
      }
    },
    [presets, setWindows, setActivePreset, onPresetLoad],
  );

  // Handle keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Edit mode toggle (L key)
      if (
        enableEditHotkey &&
        e.key.toLowerCase() === "l" &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.metaKey
      ) {
        // Don't toggle if typing in an input
        const target = e.target as HTMLElement;
        if (
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable
        ) {
          return;
        }
        e.preventDefault();
        toggleMode();
      }

      // Preset hotkeys (F1-F4)
      if (enablePresetHotkeys && e.key.match(/^F[1-4]$/)) {
        e.preventDefault();
        const presetIndex = parseInt(e.key.substring(1), 10) - 1; // F1 = 0, F2 = 1, etc.

        if (e.shiftKey) {
          // Shift+F1-F4: Save preset (handled by usePresetHotkeys)
          // This is typically handled by the PresetPanel component
        } else {
          // F1-F4: Load preset
          loadPresetByIndex(presetIndex);
        }
      }
    },
    [enableEditHotkey, enablePresetHotkeys, toggleMode, loadPresetByIndex],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const containerStyle: React.CSSProperties = {
    position: "relative",
    width: "100%",
    height: "100%",
    overflow: "hidden",
    backgroundColor: theme.colors.background.primary,
    color: theme.colors.text.primary,
    fontFamily: theme.typography.fontFamily.body,
    ...style,
  };

  const windowLayerStyle: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    pointerEvents: "none",
    zIndex: zIndexBase + 10,
  };

  const overlayLayerStyle: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    pointerEvents: "none",
    zIndex: zIndexBase + 100,
  };

  return (
    <DragProvider>
      <div className={className} style={containerStyle}>
        {/* Main content (game viewport) */}
        {children}

        {/* Windows layer */}
        <div style={windowLayerStyle}>
          {renderWindow &&
            windows.map((w) => (
              <div key={w.id} style={{ pointerEvents: "auto" }}>
                {renderWindow(w)}
              </div>
            ))}
        </div>

        {/* Overlay layer */}
        <div style={overlayLayerStyle}>
          {/* Edit mode overlay */}
          {showEditOverlay && mode === "unlocked" && <EditModeOverlay />}

          {/* Drag overlay */}
          {showDragOverlay && <DragOverlay />}
        </div>
      </div>
    </DragProvider>
  );
}

/**
 * Provider-only version of InterfaceManager
 *
 * Use this if you want to manage windows manually but still
 * want the drag context and overlays.
 */
export function InterfaceProvider({
  children,
  showEditOverlay = true,
  showDragOverlay = true,
}: {
  children: ReactNode;
  showEditOverlay?: boolean;
  showDragOverlay?: boolean;
}): React.ReactElement {
  const mode = useEditStore((s) => s.mode);

  return (
    <DragProvider>
      {children}
      {showEditOverlay && mode === "unlocked" && <EditModeOverlay />}
      {showDragOverlay && <DragOverlay />}
    </DragProvider>
  );
}
