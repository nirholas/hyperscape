import React, { useState } from "react";
import { usePresets } from "../core/presets/usePresets";
import { useTheme } from "../stores/themeStore";
import { useFeatureEnabled } from "../stores/complexityStore";
import type { PresetPanelProps } from "../types";

/**
 * Panel for managing layout presets
 *
 * @example
 * ```tsx
 * function SettingsWindow() {
 *   return (
 *     <Window windowId="settings">
 *       <TabBar windowId="settings" />
 *       <PresetPanel />
 *     </Window>
 *   );
 * }
 * ```
 */
export function PresetPanel({
  className,
  style,
}: PresetPanelProps): React.ReactElement {
  const theme = useTheme();
  const canPublish = useFeatureEnabled("interfaceSharingPublish");
  const {
    presets,
    activePreset,
    savePreset,
    loadPreset,
    deletePreset,
    renamePreset,
    isLoading,
  } = usePresets();

  const [newPresetName, setNewPresetName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [sharingPresetId, setSharingPresetId] = useState<string | null>(null);
  const [isSharing, setIsSharing] = useState(false);

  const containerStyle: React.CSSProperties = {
    padding: theme.spacing.md,
    ...style,
  };

  const headingStyle: React.CSSProperties = {
    color: theme.colors.text.primary,
    fontSize: theme.typography.fontSize.lg,
    fontWeight: theme.typography.fontWeight.bold,
    marginBottom: theme.spacing.md,
  };

  const listStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.md,
  };

  const presetItemStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: theme.spacing.sm,
    padding: theme.spacing.sm,
    backgroundColor: theme.colors.background.tertiary,
    borderRadius: theme.borderRadius.sm,
    border: `1px solid ${theme.colors.border.default}`,
  };

  const activePresetStyle: React.CSSProperties = {
    ...presetItemStyle,
    borderColor: theme.colors.accent.primary,
  };

  const buttonStyle: React.CSSProperties = {
    padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
    backgroundColor: theme.colors.background.secondary,
    border: `1px solid ${theme.colors.border.default}`,
    borderRadius: theme.borderRadius.sm,
    color: theme.colors.text.primary,
    cursor: "pointer",
    fontSize: theme.typography.fontSize.sm,
  };

  const inputStyle: React.CSSProperties = {
    flex: 1,
    padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
    backgroundColor: theme.colors.background.primary,
    border: `1px solid ${theme.colors.border.default}`,
    borderRadius: theme.borderRadius.sm,
    color: theme.colors.text.primary,
    fontSize: theme.typography.fontSize.sm,
  };

  const handleSave = async () => {
    if (newPresetName.trim()) {
      await savePreset(newPresetName.trim());
      setNewPresetName("");
    }
  };

  const handleRename = async (id: string) => {
    if (editName.trim()) {
      await renamePreset(id, editName.trim());
      setEditingId(null);
      setEditName("");
    }
  };

  // Share preset publicly (requires interfaceSharingPublish feature)
  const handleShare = async (presetId: string) => {
    if (!canPublish) return;

    const preset = presets.find((p) => p.id === presetId);
    if (!preset) return;

    setIsSharing(true);
    setSharingPresetId(presetId);

    try {
      // Note: This requires the API endpoint to be available
      // The actual API call would need to be wired up in the consuming app
      // For now, we emit an event that the app can listen to
      if (typeof window !== "undefined") {
        const event = new CustomEvent("presetShareRequest", {
          detail: {
            presetId,
            presetName: preset.name,
            layoutData: JSON.stringify(preset.windows),
            resolution: preset.resolution,
          },
        });
        window.dispatchEvent(event);
      }
    } catch {
      console.error("Failed to share preset");
    } finally {
      setIsSharing(false);
    }
  };

  if (isLoading) {
    return (
      <div className={className} style={containerStyle}>
        <div style={{ color: theme.colors.text.muted }}>Loading presets...</div>
      </div>
    );
  }

  return (
    <div className={className} style={containerStyle}>
      <h3 style={headingStyle}>Layout Presets</h3>

      {/* Preset list */}
      <div style={listStyle}>
        {presets.length === 0 ? (
          <div
            style={{
              color: theme.colors.text.muted,
              fontSize: theme.typography.fontSize.sm,
            }}
          >
            No saved presets. Save your current layout below.
          </div>
        ) : (
          presets.map((preset, index) => (
            <div
              key={preset.id}
              style={
                activePreset?.id === preset.id
                  ? activePresetStyle
                  : presetItemStyle
              }
            >
              {editingId === preset.id ? (
                <>
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    style={inputStyle}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleRename(preset.id);
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    autoFocus
                  />
                  <button
                    style={buttonStyle}
                    onClick={() => handleRename(preset.id)}
                  >
                    Save
                  </button>
                  <button
                    style={buttonStyle}
                    onClick={() => setEditingId(null)}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <span
                    style={{
                      color: theme.colors.text.muted,
                      fontSize: theme.typography.fontSize.xs,
                      minWidth: 24,
                    }}
                  >
                    F{index + 1}
                  </span>
                  <span
                    style={{
                      flex: 1,
                      color: theme.colors.text.primary,
                      fontSize: theme.typography.fontSize.sm,
                    }}
                  >
                    {preset.name}
                  </span>
                  <button
                    style={buttonStyle}
                    onClick={() => loadPreset(preset.id)}
                  >
                    Load
                  </button>
                  {canPublish ? (
                    <button
                      style={{
                        ...buttonStyle,
                        backgroundColor: "transparent",
                        color: theme.colors.accent.primary,
                      }}
                      onClick={() => handleShare(preset.id)}
                      disabled={isSharing && sharingPresetId === preset.id}
                      title="Share this preset publicly"
                    >
                      {isSharing && sharingPresetId === preset.id
                        ? "..."
                        : "Share"}
                    </button>
                  ) : (
                    <span
                      style={{
                        padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
                        color: theme.colors.text.muted,
                        fontSize: theme.typography.fontSize.sm,
                        cursor: "help",
                      }}
                      title="Upgrade to Standard mode to share presets"
                    >
                      🔒
                    </span>
                  )}
                  <button
                    style={buttonStyle}
                    onClick={() => {
                      setEditingId(preset.id);
                      setEditName(preset.name);
                    }}
                  >
                    Rename
                  </button>
                  <button
                    style={{
                      ...buttonStyle,
                      backgroundColor: "transparent",
                      color: theme.colors.state.danger,
                    }}
                    onClick={() => deletePreset(preset.id)}
                  >
                    Delete
                  </button>
                </>
              )}
            </div>
          ))
        )}
      </div>

      {/* Save new preset */}
      <div
        style={{
          display: "flex",
          gap: theme.spacing.sm,
          paddingTop: theme.spacing.md,
          borderTop: `1px solid ${theme.colors.border.default}`,
        }}
      >
        <input
          type="text"
          value={newPresetName}
          onChange={(e) => setNewPresetName(e.target.value)}
          placeholder="New preset name"
          style={inputStyle}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
          }}
        />
        <button
          style={{
            ...buttonStyle,
            backgroundColor: theme.colors.accent.primary,
            borderColor: theme.colors.accent.primary,
          }}
          onClick={handleSave}
          disabled={!newPresetName.trim()}
        >
          Save Current Layout
        </button>
      </div>

      {/* Help text */}
      <div
        style={{
          marginTop: theme.spacing.md,
          color: theme.colors.text.muted,
          fontSize: theme.typography.fontSize.xs,
        }}
      >
        Tip: Press F1-F4 to quickly load the first 4 presets
      </div>
    </div>
  );
}
