import React, { useState, useRef, useEffect } from "react";
import { useEditMode } from "../core/edit/useEditMode";
import { useGrid } from "../core/edit/useGrid";
import { usePresets } from "../core/presets/usePresets";
import { useWindowManager } from "../core/window/useWindowManager";
import { useTheme } from "../stores/themeStore";
import { useEditStore } from "../stores/editStore";
import { useWindowStore } from "../stores/windowStore";
import { useDrop } from "../core/drag/useDrop";
import { useDragStore } from "../stores/dragStore";
import { AlignmentGuides } from "./AlignmentGuides";
import type { EditModeOverlayProps } from "../types";

/**
 * Delete Zone Component
 *
 * A drop target that appears in edit mode for deleting panels/windows.
 * Users can drag panels onto this zone to remove them from the interface.
 * The component is always mounted but only visible when dragging a window.
 */
function DeleteZone(): React.ReactElement {
  const theme = useTheme();
  const destroyWindow = useWindowStore((s) => s.destroyWindow);
  const isDragging = useDragStore((s) => s.isDragging);
  const dragItem = useDragStore((s) => s.item);

  // Check if we're dragging a window (not just any item)
  const isDraggingWindow = isDragging && dragItem?.type === "window";

  // Set up drop target for windows - always registered for proper drop detection
  const { isOver, canDrop, dropProps } = useDrop({
    id: "delete-zone",
    accepts: ["window"],
    disabled: !isDraggingWindow, // Only accept drops when dragging a window
    onDrop: (item) => {
      // Delete the window when dropped
      if (item.id) {
        destroyWindow(item.id);
      }
    },
  });

  const isActive = isOver && canDrop;

  // Always render but hide when not dragging a window
  // This ensures the drop target is properly registered
  return (
    <div
      ref={dropProps.ref as React.Ref<HTMLDivElement>}
      data-drop-id={dropProps["data-drop-id"]}
      style={{
        display: isDraggingWindow ? "flex" : "none",
        alignItems: "center",
        justifyContent: "center",
        gap: theme.spacing.xs,
        padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
        backgroundColor: isActive
          ? theme.colors.state.danger
          : theme.colors.state.danger + "33",
        border: `2px dashed ${isActive ? theme.colors.state.danger : theme.colors.state.danger + "80"}`,
        borderRadius: theme.borderRadius.md,
        color: isActive ? "#fff" : theme.colors.state.danger,
        fontSize: theme.typography.fontSize.sm,
        fontWeight: theme.typography.fontWeight.medium,
        transition: "all 0.15s ease",
        transform: isActive ? "scale(1.05)" : "scale(1)",
        cursor: "pointer",
        minWidth: 100,
      }}
    >
      <span style={{ fontSize: 16 }}>🗑️</span>
      <span>{isActive ? "Release to Delete" : "Delete"}</span>
    </div>
  );
}

/**
 * Grid overlay and toolbar shown during edit mode
 *
 * @example
 * ```tsx
 * function App() {
 *   const { isUnlocked } = useEditMode();
 *
 *   return (
 *     <div>
 *       {isUnlocked && <EditModeOverlay />}
 *       <Windows />
 *     </div>
 *   );
 * }
 * ```
 */
export function EditModeOverlay({
  className,
  style,
  actionBarCount = 0,
  maxActionBars = 5,
  onAddActionBar,
}: EditModeOverlayProps): React.ReactElement {
  const theme = useTheme();
  const {
    toggleMode,
    showGrid,
    setShowGrid,
    snapEnabled,
    setSnapEnabled,
    gridSize,
  } = useEditMode();
  const { getGridLines, majorGridSize } = useGrid();
  const { presets, savePreset, loadPreset, deletePreset, renamePreset } =
    usePresets();
  const { resetLayout } = useWindowManager();

  // Get active alignment guides from edit store
  const activeGuides = useEditStore((s) => s.activeGuides);
  const showGuides = useEditStore((s) => s.showGuides);

  const [savingPreset, setSavingPreset] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [showPresetDropdown, setShowPresetDropdown] = useState(false);
  const [renamingPresetId, setRenamingPresetId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!showPresetDropdown) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setShowPresetDropdown(false);
        setRenamingPresetId(null);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showPresetDropdown]);

  // Focus rename input when editing
  useEffect(() => {
    if (renamingPresetId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingPresetId]);

  // Handle rename submit
  const handleRenameSubmit = async (presetId: string) => {
    if (renameValue.trim()) {
      await renamePreset(presetId, renameValue.trim());
    }
    setRenamingPresetId(null);
    setRenameValue("");
  };

  // Start renaming a preset
  const startRenaming = (presetId: string, currentName: string) => {
    setRenamingPresetId(presetId);
    setRenameValue(currentName);
  };

  const viewport = {
    width: typeof window !== "undefined" ? window.innerWidth : 1920,
    height: typeof window !== "undefined" ? window.innerHeight : 1080,
  };

  const { x, y, majorX, majorY } = getGridLines(viewport);

  // Grid overlay should be BEHIND windows so users can see them clearly during editing
  // Only the toolbar should be above windows
  const overlayStyle: React.CSSProperties = {
    position: "fixed",
    inset: 0,
    pointerEvents: "none",
    zIndex: 50, // Below windows (which are at 500+)
    ...style,
  };

  // Toolbar should be ABOVE everything including windows
  const toolbarStyle: React.CSSProperties = {
    position: "fixed",
    top: theme.spacing.md,
    left: "50%",
    transform: "translateX(-50%)",
    display: "flex",
    alignItems: "center",
    gap: theme.spacing.sm,
    padding: theme.spacing.sm,
    backgroundColor: theme.colors.background.secondary,
    border: `1px solid ${theme.colors.border.default}`,
    borderRadius: theme.borderRadius.md,
    boxShadow: theme.shadows.lg,
    pointerEvents: "auto",
    zIndex: theme.zIndex.tooltip, // Above everything (9999)
  };

  const buttonStyle: React.CSSProperties = {
    padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
    backgroundColor: theme.colors.background.tertiary,
    border: `1px solid ${theme.colors.border.default}`,
    borderRadius: theme.borderRadius.sm,
    color: theme.colors.text.primary,
    cursor: "pointer",
    fontSize: theme.typography.fontSize.sm,
  };

  const activeButtonStyle: React.CSSProperties = {
    ...buttonStyle,
    backgroundColor: theme.colors.accent.primary,
    borderColor: theme.colors.accent.primary,
  };

  const handleSavePreset = async () => {
    if (presetName.trim()) {
      await savePreset(presetName.trim());
      setPresetName("");
      setSavingPreset(false);
    }
  };

  return (
    <div className={className} style={overlayStyle}>
      {/* Grid lines */}
      {showGrid && (
        <svg
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
          }}
        >
          {/* Minor grid lines */}
          {y.map((py) => (
            <line
              key={`h-${py}`}
              x1={0}
              y1={py}
              x2={viewport.width}
              y2={py}
              stroke={theme.colors.border.default}
              strokeOpacity={0.3}
            />
          ))}
          {x.map((px) => (
            <line
              key={`v-${px}`}
              x1={px}
              y1={0}
              x2={px}
              y2={viewport.height}
              stroke={theme.colors.border.default}
              strokeOpacity={0.3}
            />
          ))}
          {/* Major grid lines */}
          {majorY.map((py) => (
            <line
              key={`mh-${py}`}
              x1={0}
              y1={py}
              x2={viewport.width}
              y2={py}
              stroke={theme.colors.border.hover}
              strokeOpacity={0.5}
            />
          ))}
          {majorX.map((px) => (
            <line
              key={`mv-${px}`}
              x1={px}
              y1={0}
              x2={px}
              y2={viewport.height}
              stroke={theme.colors.border.hover}
              strokeOpacity={0.5}
            />
          ))}
        </svg>
      )}

      {/* Alignment guides - shown when dragging windows */}
      {showGuides && activeGuides.length > 0 && (
        <AlignmentGuides guides={activeGuides} />
      )}

      {/* Toolbar */}
      <div style={toolbarStyle}>
        <span
          style={{
            color: theme.colors.accent.primary,
            fontSize: theme.typography.fontSize.sm,
            fontWeight: theme.typography.fontWeight.bold,
          }}
        >
          Edit Mode
        </span>

        <div
          style={{
            width: 1,
            height: 20,
            backgroundColor: theme.colors.border.default,
          }}
        />

        {/* Delete Zone - appears when dragging a panel */}
        <DeleteZone />

        {/* Add Action Bar button */}
        {onAddActionBar && actionBarCount < maxActionBars && (
          <button
            style={{
              ...buttonStyle,
              backgroundColor: theme.colors.state.info,
              borderColor: theme.colors.state.info,
              color: theme.colors.background.primary,
            }}
            onClick={onAddActionBar}
            title={`Add action bar (${actionBarCount}/${maxActionBars})`}
          >
            + Action Bar
          </button>
        )}

        {onAddActionBar && (
          <div
            style={{
              width: 1,
              height: 20,
              backgroundColor: theme.colors.border.default,
            }}
          />
        )}

        <button
          style={showGrid ? activeButtonStyle : buttonStyle}
          onClick={() => setShowGrid(!showGrid)}
        >
          Grid
        </button>

        <button
          style={snapEnabled ? activeButtonStyle : buttonStyle}
          onClick={() => setSnapEnabled(!snapEnabled)}
        >
          Snap
        </button>

        <button
          style={showGuides ? activeButtonStyle : buttonStyle}
          onClick={() => useEditStore.getState().setShowGuides(!showGuides)}
          title="Show alignment guides when dragging windows"
        >
          Guides
        </button>

        <div
          style={{
            width: 1,
            height: 20,
            backgroundColor: theme.colors.border.default,
          }}
        />

        {/* Preset quick buttons */}
        {presets.slice(0, 4).map((preset, i) => (
          <button
            key={preset.id}
            style={buttonStyle}
            onClick={() => loadPreset(preset.id)}
            title={preset.name}
          >
            F{i + 1}
          </button>
        ))}

        {/* Presets dropdown */}
        <div ref={dropdownRef} style={{ position: "relative" }}>
          <button
            style={showPresetDropdown ? activeButtonStyle : buttonStyle}
            onClick={() => setShowPresetDropdown(!showPresetDropdown)}
            title="View saved presets"
          >
            Presets ▾
          </button>
          {showPresetDropdown && (
            <div
              style={{
                position: "absolute",
                top: "100%",
                left: 0,
                marginTop: theme.spacing.xs,
                minWidth: 220,
                backgroundColor: theme.colors.background.secondary,
                border: `1px solid ${theme.colors.border.default}`,
                borderRadius: theme.borderRadius.md,
                boxShadow: theme.shadows.lg,
                overflow: "hidden",
                zIndex: theme.zIndex.tooltip + 1,
              }}
            >
              {/* Default Layout option */}
              <button
                onClick={() => {
                  resetLayout();
                  setShowPresetDropdown(false);
                }}
                style={{
                  width: "100%",
                  padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
                  backgroundColor: "transparent",
                  border: "none",
                  borderBottom: `1px solid ${theme.colors.border.default}`,
                  color: theme.colors.accent.primary,
                  fontSize: theme.typography.fontSize.sm,
                  textAlign: "left",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: theme.spacing.sm,
                  fontWeight: theme.typography.fontWeight.medium,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor =
                    theme.colors.background.tertiary;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = "transparent";
                }}
              >
                <span style={{ fontSize: 14 }}>↺</span>
                <span>Default Layout</span>
              </button>

              {/* Saved presets */}
              {presets.length === 0 ? (
                <div
                  style={{
                    padding: theme.spacing.sm,
                    color: theme.colors.text.muted,
                    fontSize: theme.typography.fontSize.sm,
                    textAlign: "center",
                  }}
                >
                  No saved presets
                </div>
              ) : (
                presets.map((preset, i) => (
                  <div
                    key={preset.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      borderBottom:
                        i < presets.length - 1
                          ? `1px solid ${theme.colors.border.default}`
                          : "none",
                    }}
                  >
                    {renamingPresetId === preset.id ? (
                      /* Rename input */
                      <div
                        style={{
                          flex: 1,
                          display: "flex",
                          alignItems: "center",
                          padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
                          gap: theme.spacing.xs,
                        }}
                      >
                        <input
                          ref={renameInputRef}
                          type="text"
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter")
                              handleRenameSubmit(preset.id);
                            if (e.key === "Escape") {
                              setRenamingPresetId(null);
                              setRenameValue("");
                            }
                          }}
                          onBlur={() => handleRenameSubmit(preset.id)}
                          style={{
                            flex: 1,
                            padding: `${theme.spacing.xs}px`,
                            backgroundColor: theme.colors.background.primary,
                            border: `1px solid ${theme.colors.accent.primary}`,
                            borderRadius: theme.borderRadius.sm,
                            color: theme.colors.text.primary,
                            fontSize: theme.typography.fontSize.sm,
                            outline: "none",
                          }}
                        />
                      </div>
                    ) : (
                      /* Normal preset row */
                      <>
                        <button
                          onClick={() => {
                            loadPreset(preset.id);
                            setShowPresetDropdown(false);
                          }}
                          style={{
                            flex: 1,
                            padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
                            backgroundColor: "transparent",
                            border: "none",
                            color: theme.colors.text.primary,
                            fontSize: theme.typography.fontSize.sm,
                            textAlign: "left",
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: theme.spacing.sm,
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor =
                              theme.colors.background.tertiary;
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor =
                              "transparent";
                          }}
                        >
                          <span>{preset.name}</span>
                          <span
                            style={{
                              color: theme.colors.text.muted,
                              fontSize: theme.typography.fontSize.xs,
                            }}
                          >
                            {i < 4 ? `F${i + 1}` : ""}
                          </span>
                        </button>
                        {/* Rename button */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            startRenaming(preset.id, preset.name);
                          }}
                          title="Rename preset"
                          style={{
                            padding: theme.spacing.xs,
                            backgroundColor: "transparent",
                            border: "none",
                            color: theme.colors.text.muted,
                            cursor: "pointer",
                            fontSize: 12,
                            opacity: 0.7,
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.opacity = "1";
                            e.currentTarget.style.color =
                              theme.colors.text.primary;
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.opacity = "0.7";
                            e.currentTarget.style.color =
                              theme.colors.text.muted;
                          }}
                        >
                          ✏️
                        </button>
                        {/* Delete button */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            deletePreset(preset.id);
                          }}
                          title="Delete preset"
                          style={{
                            padding: theme.spacing.xs,
                            marginRight: theme.spacing.xs,
                            backgroundColor: "transparent",
                            border: "none",
                            color: theme.colors.text.muted,
                            cursor: "pointer",
                            fontSize: 12,
                            opacity: 0.7,
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.opacity = "1";
                            e.currentTarget.style.color =
                              theme.colors.state.danger;
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.opacity = "0.7";
                            e.currentTarget.style.color =
                              theme.colors.text.muted;
                          }}
                        >
                          🗑️
                        </button>
                      </>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        <div
          style={{
            width: 1,
            height: 20,
            backgroundColor: theme.colors.border.default,
          }}
        />

        {savingPreset ? (
          <>
            <input
              type="text"
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              placeholder="Preset name"
              style={{
                padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
                backgroundColor: theme.colors.background.primary,
                border: `1px solid ${theme.colors.border.default}`,
                borderRadius: theme.borderRadius.sm,
                color: theme.colors.text.primary,
                fontSize: theme.typography.fontSize.sm,
                width: 120,
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSavePreset();
                if (e.key === "Escape") setSavingPreset(false);
              }}
              autoFocus
            />
            <button style={buttonStyle} onClick={handleSavePreset}>
              Save
            </button>
            <button style={buttonStyle} onClick={() => setSavingPreset(false)}>
              Cancel
            </button>
          </>
        ) : (
          <button style={buttonStyle} onClick={() => setSavingPreset(true)}>
            Save Layout
          </button>
        )}

        <button
          style={{
            ...buttonStyle,
            backgroundColor: theme.colors.state.success,
            borderColor: theme.colors.state.success,
          }}
          onClick={toggleMode}
        >
          Lock Interface
        </button>
      </div>

      {/* Grid info indicator (bottom left) */}
      <div
        style={{
          position: "fixed",
          bottom: theme.spacing.md,
          left: theme.spacing.md,
          padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
          backgroundColor: theme.colors.background.secondary,
          border: `1px solid ${theme.colors.border.default}`,
          borderRadius: theme.borderRadius.sm,
          color: theme.colors.text.muted,
          fontSize: theme.typography.fontSize.xs,
          pointerEvents: "auto",
          zIndex: theme.zIndex.tooltip, // Above everything
        }}
      >
        Grid: {gridSize}px • Major: {majorGridSize}px
      </div>
    </div>
  );
}
