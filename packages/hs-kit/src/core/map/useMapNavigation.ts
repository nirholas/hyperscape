/**
 * useMapNavigation Hook
 *
 * Hook for map navigation features including minimap sync, focus, and history.
 *
 * @packageDocumentation
 */

import { useState, useCallback, useRef } from "react";
import type { WorldCoordinate, WorldBounds } from "./mapUtils";
import {
  calculateDistance,
  calculateBearing,
  formatDistance,
  formatCoordinates,
  clampToBounds,
  DEFAULT_WORLD_BOUNDS,
} from "./mapUtils";

// ============================================================================
// Types
// ============================================================================

/** Navigation history entry */
export interface NavigationHistoryEntry {
  center: WorldCoordinate;
  zoom: number;
  timestamp: number;
  label?: string;
}

/** Bookmark/saved location */
export interface MapBookmark {
  id: string;
  name: string;
  position: WorldCoordinate;
  zoom?: number;
  icon?: string;
  color?: string;
  createdAt: number;
}

/** Options for useMapNavigation hook */
export interface MapNavigationOptions {
  /** World bounds for clamping */
  worldBounds?: WorldBounds;
  /** Maximum history entries to keep */
  maxHistory?: number;
  /** Callback when navigation occurs */
  onNavigate?: (entry: NavigationHistoryEntry) => void;
  /** Initial bookmarks */
  initialBookmarks?: MapBookmark[];
}

/** Map navigation hook result */
export interface MapNavigationResult {
  /** Navigation history */
  history: NavigationHistoryEntry[];
  /** Current history index */
  historyIndex: number;
  /** Can go back in history */
  canGoBack: boolean;
  /** Can go forward in history */
  canGoForward: boolean;
  /** Saved bookmarks */
  bookmarks: MapBookmark[];

  // Navigation actions
  /** Navigate to a position */
  navigateTo: (center: WorldCoordinate, zoom?: number, label?: string) => void;
  /** Go back in history */
  goBack: () => NavigationHistoryEntry | null;
  /** Go forward in history */
  goForward: () => NavigationHistoryEntry | null;
  /** Clear history */
  clearHistory: () => void;

  // Bookmark actions
  /** Add a bookmark */
  addBookmark: (
    name: string,
    position: WorldCoordinate,
    zoom?: number,
  ) => MapBookmark;
  /** Remove a bookmark */
  removeBookmark: (id: string) => void;
  /** Update a bookmark */
  updateBookmark: (id: string, updates: Partial<MapBookmark>) => void;
  /** Navigate to a bookmark */
  goToBookmark: (id: string) => MapBookmark | null;

  // Distance/bearing utilities
  /** Get distance from current position to target */
  getDistanceTo: (from: WorldCoordinate, to: WorldCoordinate) => number;
  /** Get formatted distance */
  getFormattedDistance: (from: WorldCoordinate, to: WorldCoordinate) => string;
  /** Get bearing from current position to target */
  getBearingTo: (from: WorldCoordinate, to: WorldCoordinate) => number;
  /** Get formatted coordinates */
  getFormattedCoordinates: (coord: WorldCoordinate) => string;

  // Minimap sync
  /** Current minimap center for sync */
  minimapCenter: WorldCoordinate | null;
  /** Set minimap center (called by minimap) */
  setMinimapCenter: (center: WorldCoordinate | null) => void;
  /** Sync world map to minimap position */
  syncToMinimap: () => void;
  /** Whether currently synced to minimap */
  isSyncedToMinimap: boolean;
  /** Toggle minimap sync */
  toggleMinimapSync: () => void;

  // Focus mode
  /** Entity being followed/focused */
  focusedEntityId: string | null;
  /** Set entity to follow */
  setFocusedEntity: (entityId: string | null) => void;
  /** Update focused entity position (called externally) */
  updateFocusedPosition: (position: WorldCoordinate) => void;
}

// ============================================================================
// Utilities
// ============================================================================

/** Generate unique bookmark ID */
function generateBookmarkId(): string {
  return `bookmark-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Hook for map navigation features
 *
 * @example
 * ```tsx
 * function NavigableMap() {
 *   const { viewport, setCenter, setZoom } = useWorldMap();
 *   const {
 *     history,
 *     canGoBack,
 *     canGoForward,
 *     goBack,
 *     goForward,
 *     navigateTo,
 *     bookmarks,
 *     addBookmark,
 *   } = useMapNavigation();
 *
 *   // Navigate and track history
 *   const handleLocationClick = (coord: WorldCoordinate) => {
 *     navigateTo(coord, viewport.zoom);
 *     setCenter(coord);
 *   };
 *
 *   return (
 *     <div>
 *       <button disabled={!canGoBack} onClick={() => {
 *         const entry = goBack();
 *         if (entry) {
 *           setCenter(entry.center);
 *           setZoom(entry.zoom);
 *         }
 *       }}>
 *         Back
 *       </button>
 *       <button disabled={!canGoForward} onClick={() => {
 *         const entry = goForward();
 *         if (entry) {
 *           setCenter(entry.center);
 *           setZoom(entry.zoom);
 *         }
 *       }}>
 *         Forward
 *       </button>
 *     </div>
 *   );
 * }
 * ```
 */
export function useMapNavigation(
  options: MapNavigationOptions = {},
): MapNavigationResult {
  const {
    worldBounds = DEFAULT_WORLD_BOUNDS,
    maxHistory = 50,
    onNavigate,
    initialBookmarks = [],
  } = options;

  // Combined history state to ensure atomic updates
  const [historyState, setHistoryState] = useState<{
    entries: NavigationHistoryEntry[];
    index: number;
  }>({
    entries: [],
    index: -1,
  });

  // Extract for easier access
  const history = historyState.entries;
  const historyIndex = historyState.index;

  // Bookmarks
  const [bookmarks, setBookmarks] = useState<MapBookmark[]>(initialBookmarks);

  // Minimap sync
  const [minimapCenter, setMinimapCenter] = useState<WorldCoordinate | null>(
    null,
  );
  const [isSyncedToMinimap, setIsSyncedToMinimap] = useState(false);

  // Focus/follow mode
  const [focusedEntityId, setFocusedEntity] = useState<string | null>(null);
  const focusedPositionRef = useRef<WorldCoordinate | null>(null);

  // Computed values
  const canGoBack = historyIndex > 0;
  const canGoForward = historyIndex < history.length - 1;

  // Navigation actions
  const navigateTo = useCallback(
    (center: WorldCoordinate, zoom: number = 1.0, label?: string) => {
      const clamped = clampToBounds(center, worldBounds);
      const entry: NavigationHistoryEntry = {
        center: clamped,
        zoom,
        timestamp: Date.now(),
        label,
      };

      setHistoryState((prev) => {
        // If we're not at the end of history, truncate forward entries
        const newEntries = prev.entries.slice(0, prev.index + 1);
        newEntries.push(entry);

        // Limit history size
        let finalEntries = newEntries;
        let offset = 0;
        if (newEntries.length > maxHistory) {
          offset = newEntries.length - maxHistory;
          finalEntries = newEntries.slice(offset);
        }

        return {
          entries: finalEntries,
          index: Math.min(prev.index + 1 - offset, maxHistory - 1),
        };
      });

      onNavigate?.(entry);
    },
    [worldBounds, maxHistory, onNavigate],
  );

  const goBack = useCallback((): NavigationHistoryEntry | null => {
    let entry: NavigationHistoryEntry | null = null;

    setHistoryState((prev) => {
      if (prev.index <= 0) return prev;

      const newIndex = prev.index - 1;
      entry = prev.entries[newIndex];
      return {
        ...prev,
        index: newIndex,
      };
    });

    if (entry) {
      onNavigate?.(entry);
    }
    return entry;
  }, [onNavigate]);

  const goForward = useCallback((): NavigationHistoryEntry | null => {
    let entry: NavigationHistoryEntry | null = null;

    setHistoryState((prev) => {
      if (prev.index >= prev.entries.length - 1) return prev;

      const newIndex = prev.index + 1;
      entry = prev.entries[newIndex];
      return {
        ...prev,
        index: newIndex,
      };
    });

    if (entry) {
      onNavigate?.(entry);
    }
    return entry;
  }, [onNavigate]);

  const clearHistory = useCallback(() => {
    setHistoryState({ entries: [], index: -1 });
  }, []);

  // Bookmark actions
  const addBookmark = useCallback(
    (name: string, position: WorldCoordinate, zoom?: number): MapBookmark => {
      const bookmark: MapBookmark = {
        id: generateBookmarkId(),
        name,
        position: clampToBounds(position, worldBounds),
        zoom,
        createdAt: Date.now(),
      };

      setBookmarks((prev) => [...prev, bookmark]);
      return bookmark;
    },
    [worldBounds],
  );

  const removeBookmark = useCallback((id: string) => {
    setBookmarks((prev) => prev.filter((b) => b.id !== id));
  }, []);

  const updateBookmark = useCallback(
    (id: string, updates: Partial<MapBookmark>) => {
      setBookmarks((prev) =>
        prev.map((b) => {
          if (b.id !== id) return b;
          const updated = { ...b, ...updates };
          if (updates.position) {
            updated.position = clampToBounds(updates.position, worldBounds);
          }
          return updated;
        }),
      );
    },
    [worldBounds],
  );

  const goToBookmark = useCallback(
    (id: string): MapBookmark | null => {
      const bookmark = bookmarks.find((b) => b.id === id);
      if (!bookmark) return null;

      navigateTo(bookmark.position, bookmark.zoom ?? 1.0, bookmark.name);
      return bookmark;
    },
    [bookmarks, navigateTo],
  );

  // Distance/bearing utilities
  const getDistanceTo = useCallback(
    (from: WorldCoordinate, to: WorldCoordinate): number => {
      return calculateDistance(from, to);
    },
    [],
  );

  const getFormattedDistance = useCallback(
    (from: WorldCoordinate, to: WorldCoordinate): string => {
      const distance = calculateDistance(from, to);
      return formatDistance(distance);
    },
    [],
  );

  const getBearingTo = useCallback(
    (from: WorldCoordinate, to: WorldCoordinate): number => {
      return calculateBearing(from, to);
    },
    [],
  );

  const getFormattedCoordinates = useCallback(
    (coord: WorldCoordinate): string => {
      return formatCoordinates(coord);
    },
    [],
  );

  // Minimap sync
  const syncToMinimap = useCallback(() => {
    if (minimapCenter) {
      navigateTo(minimapCenter);
    }
  }, [minimapCenter, navigateTo]);

  const toggleMinimapSync = useCallback(() => {
    setIsSyncedToMinimap((prev) => !prev);
  }, []);

  // Focus mode
  const updateFocusedPosition = useCallback((position: WorldCoordinate) => {
    focusedPositionRef.current = position;
  }, []);

  return {
    history,
    historyIndex,
    canGoBack,
    canGoForward,
    bookmarks,

    navigateTo,
    goBack,
    goForward,
    clearHistory,

    addBookmark,
    removeBookmark,
    updateBookmark,
    goToBookmark,

    getDistanceTo,
    getFormattedDistance,
    getBearingTo,
    getFormattedCoordinates,

    minimapCenter,
    setMinimapCenter,
    syncToMinimap,
    isSyncedToMinimap,
    toggleMinimapSync,

    focusedEntityId,
    setFocusedEntity,
    updateFocusedPosition,
  };
}
