/**
 * LoadFromPlayer Component
 *
 * UI for loading interface presets from other players.
 * Supports:
 * - Player name search
 * - Share code input
 * - Preview before applying
 *
 * @packageDocumentation
 */

import React, { useState, useCallback } from "react";
import { useTheme, useWindowStore } from "hs-kit";

/** Preset data returned from API */
interface CommunityPreset {
  name: string;
  layoutData: string;
  resolution: { width: number; height: number } | null;
  description: string | null;
  category: string;
  tags: string[];
  usageCount: number;
  rating: number | null;
  ratingCount: number;
  shareCode: string;
  authorName: string;
  createdAt: number;
}

/** Props for LoadFromPlayer */
export interface LoadFromPlayerProps {
  /** API base URL */
  apiUrl?: string;
  /** Callback when preset is loaded */
  onLoad?: (preset: CommunityPreset) => void;
  /** Optional className */
  className?: string;
}

/**
 * Load From Player Component
 *
 * Allows searching for and loading presets from other players.
 */
export function LoadFromPlayer({
  apiUrl = "",
  onLoad,
  className,
}: LoadFromPlayerProps): React.ReactElement {
  const theme = useTheme();
  const loadLayout = useWindowStore((s) => s.loadLayout);

  const [searchMode, setSearchMode] = useState<"player" | "code">("code");
  const [searchInput, setSearchInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<CommunityPreset[]>([]);
  const [selectedPreset, setSelectedPreset] = useState<CommunityPreset | null>(
    null,
  );

  // Search by player name
  const searchByPlayer = useCallback(async () => {
    if (!searchInput.trim()) return;

    setIsLoading(true);
    setError(null);
    setResults([]);

    try {
      const response = await fetch(
        `${apiUrl}/api/layouts/player/${encodeURIComponent(searchInput.trim())}`,
      );
      const data = await response.json();

      if (!response.ok || !data.success) {
        setError(data.error || "Player not found");
        return;
      }

      if (data.presets.length === 0) {
        setError("No shared presets from this player");
        return;
      }

      setResults(
        data.presets.map((p: CommunityPreset) => ({
          ...p,
          authorName: data.playerName,
        })),
      );
    } catch (_err) {
      setError("Failed to search. Check your connection.");
    } finally {
      setIsLoading(false);
    }
  }, [apiUrl, searchInput]);

  // Search by share code
  const searchByCode = useCallback(async () => {
    const code = searchInput.trim().toUpperCase();
    if (code.length !== 6) {
      setError("Share code must be 6 characters");
      return;
    }

    setIsLoading(true);
    setError(null);
    setResults([]);

    try {
      const response = await fetch(`${apiUrl}/api/layouts/code/${code}`);
      const data = await response.json();

      if (!response.ok || !data.success) {
        setError(data.error || "Preset not found");
        return;
      }

      setResults([data.preset]);
    } catch (_err) {
      setError("Failed to load preset. Check your connection.");
    } finally {
      setIsLoading(false);
    }
  }, [apiUrl, searchInput]);

  // Handle search
  const handleSearch = useCallback(() => {
    if (searchMode === "player") {
      searchByPlayer();
    } else {
      searchByCode();
    }
  }, [searchMode, searchByPlayer, searchByCode]);

  // Apply selected preset
  const handleApply = useCallback(() => {
    if (!selectedPreset) return;

    try {
      const layout = JSON.parse(selectedPreset.layoutData);
      const resolution = selectedPreset.resolution || {
        width: window.innerWidth,
        height: window.innerHeight,
      };

      loadLayout(layout, resolution);
      onLoad?.(selectedPreset);
      setSelectedPreset(null);
    } catch (_err) {
      setError("Failed to apply preset. Layout data is invalid.");
    }
  }, [selectedPreset, loadLayout, onLoad]);

  const containerStyle: React.CSSProperties = {
    padding: theme.spacing.md,
    color: theme.colors.text.primary,
    fontFamily: theme.typography.fontFamily.body,
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
    backgroundColor: theme.colors.background.secondary,
    color: theme.colors.text.primary,
    border: `1px solid ${theme.colors.border.default}`,
    borderRadius: theme.borderRadius.md,
    fontSize: theme.typography.fontSize.sm,
    outline: "none",
  };

  const buttonStyle: React.CSSProperties = {
    padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
    backgroundColor: theme.colors.accent.primary,
    color: theme.colors.background.primary,
    border: "none",
    borderRadius: theme.borderRadius.md,
    fontSize: theme.typography.fontSize.sm,
    fontWeight: theme.typography.fontWeight.medium,
    cursor: "pointer",
    transition: theme.transitions.fast,
  };

  return (
    <div className={className} style={containerStyle}>
      {/* Search Mode Tabs */}
      <div
        style={{
          display: "flex",
          gap: theme.spacing.xs,
          marginBottom: theme.spacing.md,
        }}
      >
        <button
          onClick={() => setSearchMode("code")}
          style={{
            ...buttonStyle,
            flex: 1,
            backgroundColor:
              searchMode === "code"
                ? theme.colors.accent.primary
                : theme.colors.background.tertiary,
            color:
              searchMode === "code"
                ? theme.colors.background.primary
                : theme.colors.text.secondary,
          }}
        >
          Share Code
        </button>
        <button
          onClick={() => setSearchMode("player")}
          style={{
            ...buttonStyle,
            flex: 1,
            backgroundColor:
              searchMode === "player"
                ? theme.colors.accent.primary
                : theme.colors.background.tertiary,
            color:
              searchMode === "player"
                ? theme.colors.background.primary
                : theme.colors.text.secondary,
          }}
        >
          Player Name
        </button>
      </div>

      {/* Search Input */}
      <div style={{ marginBottom: theme.spacing.md }}>
        <div style={{ display: "flex", gap: theme.spacing.sm }}>
          <input
            type="text"
            placeholder={
              searchMode === "code"
                ? "Enter 6-character code"
                : "Enter player name"
            }
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            style={{ ...inputStyle, flex: 1 }}
            maxLength={searchMode === "code" ? 6 : 50}
          />
          <button
            onClick={handleSearch}
            disabled={isLoading}
            style={{
              ...buttonStyle,
              opacity: isLoading ? 0.6 : 1,
            }}
          >
            {isLoading ? "..." : "Search"}
          </button>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div
          style={{
            padding: theme.spacing.sm,
            backgroundColor: "rgba(239, 68, 68, 0.1)",
            border: `1px solid ${theme.colors.state.danger}`,
            borderRadius: theme.borderRadius.md,
            color: theme.colors.state.danger,
            fontSize: theme.typography.fontSize.sm,
            marginBottom: theme.spacing.md,
          }}
        >
          {error}
        </div>
      )}

      {/* Results List */}
      {results.length > 0 && (
        <div
          style={{
            maxHeight: 200,
            overflowY: "auto",
            border: `1px solid ${theme.colors.border.default}`,
            borderRadius: theme.borderRadius.md,
            marginBottom: theme.spacing.md,
          }}
        >
          {results.map((preset, index) => (
            <div
              key={preset.shareCode || index}
              onClick={() => setSelectedPreset(preset)}
              style={{
                padding: theme.spacing.sm,
                backgroundColor:
                  selectedPreset?.shareCode === preset.shareCode
                    ? theme.colors.background.tertiary
                    : "transparent",
                borderBottom:
                  index < results.length - 1
                    ? `1px solid ${theme.colors.border.default}`
                    : "none",
                cursor: "pointer",
                transition: theme.transitions.fast,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span
                  style={{
                    fontWeight: theme.typography.fontWeight.medium,
                    color: theme.colors.text.primary,
                  }}
                >
                  {preset.name}
                </span>
                <span
                  style={{
                    fontSize: theme.typography.fontSize.xs,
                    color: theme.colors.text.muted,
                  }}
                >
                  {preset.shareCode}
                </span>
              </div>
              <div
                style={{
                  display: "flex",
                  gap: theme.spacing.sm,
                  marginTop: 4,
                  fontSize: theme.typography.fontSize.xs,
                  color: theme.colors.text.secondary,
                }}
              >
                <span>by {preset.authorName}</span>
                {preset.rating && (
                  <span>
                    ⭐ {preset.rating.toFixed(1)} ({preset.ratingCount})
                  </span>
                )}
                <span>📥 {preset.usageCount}</span>
              </div>
              {preset.description && (
                <div
                  style={{
                    marginTop: 4,
                    fontSize: theme.typography.fontSize.xs,
                    color: theme.colors.text.muted,
                  }}
                >
                  {preset.description}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Apply Button */}
      {selectedPreset && (
        <div style={{ display: "flex", gap: theme.spacing.sm }}>
          <button
            onClick={() => setSelectedPreset(null)}
            style={{
              ...buttonStyle,
              flex: 1,
              backgroundColor: theme.colors.background.tertiary,
              color: theme.colors.text.secondary,
            }}
          >
            Cancel
          </button>
          <button onClick={handleApply} style={{ ...buttonStyle, flex: 1 }}>
            Load "{selectedPreset.name}"
          </button>
        </div>
      )}
    </div>
  );
}
