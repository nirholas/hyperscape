/**
 * Edit Mode Toolbar Component
 *
 * Floating toolbar displayed when in edit mode, providing
 * quick access to layout editing controls.
 *
 * @packageDocumentation
 */

import React from "react";
import { useTheme } from "../stores/themeStore";
import { useEditStore } from "../stores/editStore";
import { useWindowStore } from "../stores/windowStore";
import { usePresetStore } from "../stores/presetStore";

/** Props for EditModeToolbar */
export interface EditModeToolbarProps {
  /** Position of the toolbar */
  position?: "top" | "bottom";
  /** Whether to show grid controls */
  showGridControls?: boolean;
  /** Whether to show snap controls */
  showSnapControls?: boolean;
  /** Whether to show preset controls */
  showPresetControls?: boolean;
  /** Callback when reset is clicked */
  onReset?: () => void;
  /** Custom className */
  className?: string;
  /** Custom style */
  style?: React.CSSProperties;
}

/** Tool button component */
function ToolButton({
  icon,
  label,
  active,
  onClick,
  disabled,
}: {
  icon: string;
  label: string;
  active?: boolean;
  onClick: () => void;
  disabled?: boolean;
}): React.ReactElement {
  const theme = useTheme();

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: "4px 8px",
        backgroundColor: active
          ? theme.colors.accent.primary
          : theme.colors.background.tertiary,
        color: active
          ? theme.colors.background.primary
          : theme.colors.text.primary,
        border: `1px solid ${active ? theme.colors.accent.primary : theme.colors.border.default}`,
        borderRadius: theme.borderRadius.sm,
        fontSize: theme.typography.fontSize.xs,
        fontWeight: theme.typography.fontWeight.medium,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        transition: theme.transitions.fast,
      }}
    >
      <span style={{ fontSize: 14 }}>{icon}</span>
      <span>{label}</span>
    </button>
  );
}

/** Grid size selector */
function GridSizeSelector(): React.ReactElement {
  const theme = useTheme();
  const gridSize = useEditStore((s) => s.gridSize);
  const setGridSize = useEditStore((s) => s.setGridSize);

  const sizes = [8, 16, 24, 32];

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <span
        style={{
          fontSize: theme.typography.fontSize.xs,
          color: theme.colors.text.secondary,
        }}
      >
        Grid:
      </span>
      {sizes.map((size) => (
        <button
          key={size}
          onClick={() => setGridSize(size)}
          style={{
            width: 24,
            height: 24,
            padding: 0,
            backgroundColor:
              gridSize === size
                ? theme.colors.accent.primary
                : theme.colors.background.tertiary,
            color:
              gridSize === size
                ? theme.colors.background.primary
                : theme.colors.text.primary,
            border: `1px solid ${gridSize === size ? theme.colors.accent.primary : theme.colors.border.default}`,
            borderRadius: theme.borderRadius.sm,
            fontSize: theme.typography.fontSize.xs,
            fontWeight: theme.typography.fontWeight.medium,
            cursor: "pointer",
            transition: theme.transitions.fast,
          }}
        >
          {size}
        </button>
      ))}
    </div>
  );
}

/**
 * Edit Mode Toolbar
 *
 * Displays when in edit mode with controls for:
 * - Grid toggle and size selection
 * - Snap toggle
 * - Alignment guides toggle
 * - Reset layout button
 * - Quick save preset
 * - Lock all / Unlock all windows
 *
 * @example
 * ```tsx
 * {isEditMode && <EditModeToolbar position="top" />}
 * ```
 */
export function EditModeToolbar({
  position = "top",
  showGridControls = true,
  showSnapControls = true,
  showPresetControls = true,
  onReset,
  className,
  style,
}: EditModeToolbarProps): React.ReactElement {
  const theme = useTheme();

  // Edit store state
  const showGrid = useEditStore((s) => s.showGrid);
  const setShowGrid = useEditStore((s) => s.setShowGrid);
  const snapEnabled = useEditStore((s) => s.snapEnabled);
  const setSnapEnabled = useEditStore((s) => s.setSnapEnabled);
  const showGuides = useEditStore((s) => s.showGuides);
  const setShowGuides = useEditStore((s) => s.setShowGuides);

  // Window store for lock/unlock all
  const windows = useWindowStore((s) => Array.from(s.windows.values()));
  const updateWindow = useWindowStore((s) => s.updateWindow);

  // Preset store for quick save
  const savePreset = usePresetStore((s) => s.savePreset);
  const presets = usePresetStore((s) => s.presets);

  // Lock/unlock all windows
  const handleLockAll = () => {
    windows.forEach((w) => {
      updateWindow(w.id, { locked: true });
    });
  };

  const handleUnlockAll = () => {
    windows.forEach((w) => {
      updateWindow(w.id, { locked: false });
    });
  };

  // Quick save to next available slot
  const handleQuickSave = async () => {
    const nextSlot = presets.length;
    if (nextSlot < 4) {
      const resolution = {
        width: window.innerWidth,
        height: window.innerHeight,
      };
      await savePreset(`Preset ${nextSlot + 1}`, windows, resolution);
    }
  };

  const positionStyle: React.CSSProperties =
    position === "top" ? { top: 60 } : { bottom: 60 };

  return (
    <div
      className={className}
      style={{
        position: "fixed",
        left: "50%",
        transform: "translateX(-50%)",
        ...positionStyle,
        display: "flex",
        alignItems: "center",
        gap: theme.spacing.sm,
        padding: theme.spacing.sm,
        backgroundColor: theme.colors.background.glass,
        borderRadius: theme.borderRadius.lg,
        border: `1px solid ${theme.colors.border.decorative}`,
        boxShadow: theme.shadows.lg,
        zIndex: 9998,
        backdropFilter: `blur(${theme.glass.blur}px)`,
        ...style,
      }}
    >
      {/* Grid controls */}
      {showGridControls && (
        <>
          <ToolButton
            icon="⊞"
            label="Grid"
            active={showGrid}
            onClick={() => setShowGrid(!showGrid)}
          />
          <GridSizeSelector />
          <div
            style={{
              width: 1,
              height: 20,
              backgroundColor: theme.colors.border.default,
            }}
          />
        </>
      )}

      {/* Snap controls */}
      {showSnapControls && (
        <>
          <ToolButton
            icon="🧲"
            label="Snap"
            active={snapEnabled}
            onClick={() => setSnapEnabled(!snapEnabled)}
          />
          <ToolButton
            icon="📏"
            label="Guides"
            active={showGuides}
            onClick={() => setShowGuides(!showGuides)}
          />
          <div
            style={{
              width: 1,
              height: 20,
              backgroundColor: theme.colors.border.default,
            }}
          />
        </>
      )}

      {/* Window controls */}
      <ToolButton icon="🔒" label="Lock All" onClick={handleLockAll} />
      <ToolButton icon="🔓" label="Unlock All" onClick={handleUnlockAll} />

      {/* Preset controls */}
      {showPresetControls && (
        <>
          <div
            style={{
              width: 1,
              height: 20,
              backgroundColor: theme.colors.border.default,
            }}
          />
          <ToolButton
            icon="💾"
            label="Quick Save"
            onClick={handleQuickSave}
            disabled={presets.length >= 4}
          />
        </>
      )}

      {/* Reset button */}
      {onReset && (
        <>
          <div
            style={{
              width: 1,
              height: 20,
              backgroundColor: theme.colors.border.default,
            }}
          />
          <ToolButton icon="↺" label="Reset" onClick={onReset} />
        </>
      )}
    </div>
  );
}
