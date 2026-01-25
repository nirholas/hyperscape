import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useWorldMap } from "../../src/core/map/useWorldMap";
import { useMapMarkers } from "../../src/core/map/useMapMarkers";
import { useMapNavigation } from "../../src/core/map/useMapNavigation";
import {
  worldToMap,
  mapToWorld,
  calculateDistance,
  calculateBearing,
  formatDistance,
  formatCoordinates,
  isWithinBounds,
  clampToBounds,
  clampZoom,
  findRegionAt,
  type WorldCoordinate,
  type MapViewport,
  type WorldBounds,
  type MapRegion,
} from "../../src/core/map/mapUtils";

describe("mapUtils", () => {
  describe("worldToMap", () => {
    it("should convert world coordinates to map pixels", () => {
      const viewport: MapViewport = {
        center: { x: 100, y: 100 },
        zoom: 1.0,
        size: { width: 400, height: 300 },
      };

      // Center of viewport should map to center of screen
      const center = worldToMap({ x: 100, y: 100 }, viewport);
      expect(center.x).toBe(200); // width / 2
      expect(center.y).toBe(150); // height / 2

      // Point to the right should have higher x
      const right = worldToMap({ x: 110, y: 100 }, viewport);
      expect(right.x).toBeGreaterThan(center.x);

      // Point above should have lower y (y is inverted)
      const above = worldToMap({ x: 100, y: 110 }, viewport);
      expect(above.y).toBeLessThan(center.y);
    });

    it("should account for zoom level", () => {
      const baseViewport: MapViewport = {
        center: { x: 100, y: 100 },
        zoom: 1.0,
        size: { width: 400, height: 300 },
      };

      const zoomedViewport: MapViewport = {
        ...baseViewport,
        zoom: 2.0,
      };

      const basePos = worldToMap({ x: 110, y: 100 }, baseViewport);
      const zoomedPos = worldToMap({ x: 110, y: 100 }, zoomedViewport);

      // At 2x zoom, the offset should be twice as large
      expect(zoomedPos.x - 200).toBe((basePos.x - 200) * 2);
    });
  });

  describe("mapToWorld", () => {
    it("should convert map pixels to world coordinates", () => {
      const viewport: MapViewport = {
        center: { x: 100, y: 100 },
        zoom: 1.0,
        size: { width: 400, height: 300 },
      };

      // Center of screen should map to viewport center
      const center = mapToWorld({ x: 200, y: 150 }, viewport);
      expect(center.x).toBeCloseTo(100);
      expect(center.y).toBeCloseTo(100);
    });

    it("should be inverse of worldToMap", () => {
      const viewport: MapViewport = {
        center: { x: 3200, y: 3200 },
        zoom: 1.5,
        size: { width: 800, height: 600 },
      };

      const original: WorldCoordinate = { x: 3250, y: 3180 };
      const mapCoord = worldToMap(original, viewport);
      const roundTrip = mapToWorld(mapCoord, viewport);

      expect(roundTrip.x).toBeCloseTo(original.x);
      expect(roundTrip.y).toBeCloseTo(original.y);
    });
  });

  describe("calculateDistance", () => {
    it("should calculate Euclidean distance", () => {
      const a: WorldCoordinate = { x: 0, y: 0 };
      const b: WorldCoordinate = { x: 3, y: 4 };

      expect(calculateDistance(a, b)).toBe(5);
    });

    it("should return 0 for same point", () => {
      const point: WorldCoordinate = { x: 100, y: 200 };
      expect(calculateDistance(point, point)).toBe(0);
    });
  });

  describe("calculateBearing", () => {
    it("should calculate bearing in degrees", () => {
      const from: WorldCoordinate = { x: 0, y: 0 };

      // North (positive Y)
      expect(calculateBearing(from, { x: 0, y: 10 })).toBeCloseTo(0);

      // East (positive X)
      expect(calculateBearing(from, { x: 10, y: 0 })).toBeCloseTo(90);

      // South (negative Y)
      expect(calculateBearing(from, { x: 0, y: -10 })).toBeCloseTo(180);

      // West (negative X)
      expect(calculateBearing(from, { x: -10, y: 0 })).toBeCloseTo(270);
    });
  });

  describe("formatDistance", () => {
    it("should format distance in tiles for short distances", () => {
      expect(formatDistance(42)).toBe("42 tiles");
      expect(formatDistance(99)).toBe("99 tiles");
    });

    it("should format distance in km for longer distances", () => {
      expect(formatDistance(150)).toContain("km");
      expect(formatDistance(2500)).toContain("km");
    });
  });

  describe("formatCoordinates", () => {
    it("should format coordinates as (x, y)", () => {
      expect(formatCoordinates({ x: 3200, y: 3200 })).toBe("(3200, 3200)");
      expect(formatCoordinates({ x: 100.7, y: 200.3 })).toBe("(101, 200)");
    });

    it("should include z level when requested", () => {
      expect(formatCoordinates({ x: 100, y: 200, z: 1 }, true)).toBe(
        "(100, 200, 1)",
      );
    });
  });

  describe("isWithinBounds", () => {
    const bounds: WorldBounds = {
      minX: 0,
      minY: 0,
      maxX: 100,
      maxY: 100,
    };

    it("should return true for points within bounds", () => {
      expect(isWithinBounds({ x: 50, y: 50 }, bounds)).toBe(true);
      expect(isWithinBounds({ x: 0, y: 0 }, bounds)).toBe(true);
      expect(isWithinBounds({ x: 100, y: 100 }, bounds)).toBe(true);
    });

    it("should return false for points outside bounds", () => {
      expect(isWithinBounds({ x: -1, y: 50 }, bounds)).toBe(false);
      expect(isWithinBounds({ x: 50, y: 101 }, bounds)).toBe(false);
    });
  });

  describe("clampToBounds", () => {
    const bounds: WorldBounds = {
      minX: 0,
      minY: 0,
      maxX: 100,
      maxY: 100,
    };

    it("should not modify points within bounds", () => {
      const point: WorldCoordinate = { x: 50, y: 50 };
      const clamped = clampToBounds(point, bounds);
      expect(clamped.x).toBe(50);
      expect(clamped.y).toBe(50);
    });

    it("should clamp points outside bounds", () => {
      expect(clampToBounds({ x: -10, y: 50 }, bounds).x).toBe(0);
      expect(clampToBounds({ x: 150, y: 50 }, bounds).x).toBe(100);
      expect(clampToBounds({ x: 50, y: -10 }, bounds).y).toBe(0);
      expect(clampToBounds({ x: 50, y: 150 }, bounds).y).toBe(100);
    });
  });

  describe("clampZoom", () => {
    it("should clamp zoom to valid range", () => {
      expect(clampZoom(0.1, 0.25, 4)).toBe(0.25);
      expect(clampZoom(5, 0.25, 4)).toBe(4);
      expect(clampZoom(1.5, 0.25, 4)).toBe(1.5);
    });
  });

  describe("findRegionAt", () => {
    const regions: MapRegion[] = [
      {
        id: "lumbridge",
        name: "Lumbridge",
        bounds: { minX: 3200, minY: 3200, maxX: 3300, maxY: 3300 },
        children: [
          {
            id: "lumbridge-castle",
            name: "Lumbridge Castle",
            bounds: { minX: 3220, minY: 3220, maxX: 3240, maxY: 3240 },
          },
        ],
      },
    ];

    it("should find region containing coordinate", () => {
      const region = findRegionAt({ x: 3250, y: 3250 }, regions);
      expect(region?.id).toBe("lumbridge");
    });

    it("should find child region if more specific", () => {
      const region = findRegionAt({ x: 3230, y: 3230 }, regions);
      expect(region?.id).toBe("lumbridge-castle");
    });

    it("should return null for coordinate outside regions", () => {
      const region = findRegionAt({ x: 0, y: 0 }, regions);
      expect(region).toBeNull();
    });
  });
});

describe("useWorldMap", () => {
  it("should initialize with default values", () => {
    const { result } = renderHook(() => useWorldMap());

    expect(result.current.viewport.zoom).toBe(1.0);
    expect(result.current.viewport.center).toEqual({ x: 3200, y: 3200 });
  });

  it("should initialize with custom center and zoom", () => {
    const { result } = renderHook(() =>
      useWorldMap({
        initialCenter: { x: 1000, y: 2000 },
        initialZoom: 2.0,
      }),
    );

    expect(result.current.viewport.center).toEqual({ x: 1000, y: 2000 });
    expect(result.current.viewport.zoom).toBe(2.0);
  });

  it("should zoom in and out", () => {
    const { result } = renderHook(() => useWorldMap({ initialZoom: 1.0 }));

    act(() => {
      result.current.zoomIn();
    });
    expect(result.current.viewport.zoom).toBeGreaterThan(1.0);

    act(() => {
      result.current.zoomOut();
    });
    expect(result.current.viewport.zoom).toBeCloseTo(1.0, 1);
  });

  it("should clamp zoom to valid range", () => {
    const { result } = renderHook(() =>
      useWorldMap({
        initialZoom: 1.0,
        minZoom: 0.5,
        maxZoom: 2.0,
      }),
    );

    act(() => {
      result.current.setZoom(0.1);
    });
    expect(result.current.viewport.zoom).toBe(0.5);

    act(() => {
      result.current.setZoom(10);
    });
    expect(result.current.viewport.zoom).toBe(2.0);
  });

  it("should pan the map", () => {
    const { result } = renderHook(() =>
      useWorldMap({ initialCenter: { x: 100, y: 100 } }),
    );

    const initialCenter = { ...result.current.viewport.center };

    act(() => {
      result.current.panWorld(50, 50);
    });

    expect(result.current.viewport.center.x).toBe(initialCenter.x + 50);
    expect(result.current.viewport.center.y).toBe(initialCenter.y + 50);
  });

  it("should reset to initial state", () => {
    const initialCenter = { x: 500, y: 500 };
    const initialZoom = 1.5;

    const { result } = renderHook(() =>
      useWorldMap({
        initialCenter,
        initialZoom,
      }),
    );

    act(() => {
      result.current.setCenter({ x: 1000, y: 1000 });
      result.current.setZoom(3.0);
    });

    act(() => {
      result.current.reset();
    });

    expect(result.current.viewport.center).toEqual(initialCenter);
    expect(result.current.viewport.zoom).toBe(initialZoom);
  });

  it("should convert coordinates correctly", () => {
    const { result } = renderHook(() =>
      useWorldMap({
        initialCenter: { x: 100, y: 100 },
        initialZoom: 1.0,
      }),
    );

    const worldCoord: WorldCoordinate = { x: 110, y: 110 };
    const mapCoord = result.current.worldToMapCoord(worldCoord);
    const backToWorld = result.current.mapToWorldCoord(mapCoord);

    expect(backToWorld.x).toBeCloseTo(worldCoord.x);
    expect(backToWorld.y).toBeCloseTo(worldCoord.y);
  });

  it("should call onViewportChange when viewport changes", () => {
    const onViewportChange = vi.fn();

    const { result } = renderHook(() =>
      useWorldMap({
        onViewportChange,
      }),
    );

    act(() => {
      result.current.setZoom(2.0);
    });

    expect(onViewportChange).toHaveBeenCalled();
  });
});

describe("useMapMarkers", () => {
  it("should initialize with empty markers", () => {
    const { result } = renderHook(() => useMapMarkers());

    expect(result.current.markers).toEqual([]);
    expect(result.current.visibleMarkers).toEqual([]);
  });

  it("should add and remove markers", () => {
    const { result } = renderHook(() => useMapMarkers());

    let marker: { id: string };

    act(() => {
      marker = result.current.addMarker({
        type: "poi",
        position: { x: 100, y: 100 },
        label: "Test POI",
      });
    });

    expect(result.current.markers.length).toBe(1);
    expect(result.current.markers[0].label).toBe("Test POI");

    act(() => {
      result.current.removeMarker(marker.id);
    });

    expect(result.current.markers.length).toBe(0);
  });

  it("should filter markers by layer visibility", () => {
    const { result } = renderHook(() => useMapMarkers());

    act(() => {
      result.current.addMarker({
        type: "quest",
        position: { x: 100, y: 100 },
        label: "Quest",
      });
      result.current.addMarker({
        type: "resource",
        position: { x: 200, y: 200 },
        label: "Resource",
      });
    });

    // Resources layer is hidden by default
    expect(result.current.visibleMarkers.length).toBe(1);
    expect(result.current.visibleMarkers[0].type).toBe("quest");

    act(() => {
      result.current.setLayerVisible("resources", true);
    });

    expect(result.current.visibleMarkers.length).toBe(2);
  });

  it("should toggle layer visibility", () => {
    const { result } = renderHook(() => useMapMarkers());

    const questsLayer = result.current.layers.find((l) => l.id === "quests");
    expect(questsLayer?.visible).toBe(true);

    act(() => {
      result.current.toggleLayer("quests");
    });

    const updatedLayer = result.current.layers.find((l) => l.id === "quests");
    expect(updatedLayer?.visible).toBe(false);
  });

  it("should set and clear waypoint", () => {
    const { result } = renderHook(() => useMapMarkers());

    act(() => {
      result.current.setWaypoint({ x: 500, y: 500 }, "My Destination");
    });

    expect(result.current.waypoint).not.toBeNull();
    expect(result.current.waypoint?.position).toEqual({ x: 500, y: 500 });
    expect(result.current.waypoint?.label).toBe("My Destination");

    act(() => {
      result.current.setWaypoint(null);
    });

    expect(result.current.waypoint).toBeNull();
  });

  it("should select and hover markers", () => {
    const { result } = renderHook(() => useMapMarkers());

    let marker: { id: string };

    act(() => {
      marker = result.current.addMarker({
        type: "poi",
        position: { x: 100, y: 100 },
        label: "Test",
      });
    });

    act(() => {
      result.current.selectMarker(marker.id);
    });

    expect(result.current.selectedMarker?.id).toBe(marker.id);

    act(() => {
      result.current.selectMarker(null);
    });

    expect(result.current.selectedMarker).toBeNull();
  });

  it("should query markers by type", () => {
    const { result } = renderHook(() => useMapMarkers());

    act(() => {
      result.current.addMarker({
        type: "quest",
        position: { x: 100, y: 100 },
        label: "Quest 1",
      });
      result.current.addMarker({
        type: "quest",
        position: { x: 200, y: 200 },
        label: "Quest 2",
      });
      result.current.addMarker({
        type: "poi",
        position: { x: 300, y: 300 },
        label: "POI",
      });
    });

    expect(result.current.getMarkersByType("quest").length).toBe(2);
    expect(result.current.getMarkersByType("poi").length).toBe(1);
  });
});

describe("useMapNavigation", () => {
  it("should track navigation history", () => {
    const { result } = renderHook(() => useMapNavigation());

    expect(result.current.history.length).toBe(0);
    expect(result.current.canGoBack).toBe(false);
    expect(result.current.canGoForward).toBe(false);

    act(() => {
      result.current.navigateTo({ x: 100, y: 100 }, 1.0);
    });

    expect(result.current.history.length).toBe(1);

    act(() => {
      result.current.navigateTo({ x: 200, y: 200 }, 1.5);
    });

    expect(result.current.history.length).toBe(2);
    expect(result.current.canGoBack).toBe(true);
  });

  it("should navigate back and forward", () => {
    const { result } = renderHook(() => useMapNavigation());

    act(() => {
      result.current.navigateTo({ x: 100, y: 100 }, 1.0, "First");
      result.current.navigateTo({ x: 200, y: 200 }, 1.5, "Second");
      result.current.navigateTo({ x: 300, y: 300 }, 2.0, "Third");
    });

    expect(result.current.canGoBack).toBe(true);
    expect(result.current.canGoForward).toBe(false);

    let backEntry: { center: WorldCoordinate } | null = null;

    act(() => {
      backEntry = result.current.goBack();
    });

    expect(backEntry?.center.x).toBe(200);
    expect(result.current.canGoForward).toBe(true);

    act(() => {
      result.current.goForward();
    });

    expect(result.current.canGoForward).toBe(false);
  });

  it("should manage bookmarks", () => {
    const { result } = renderHook(() => useMapNavigation());

    let bookmark: { id: string; name: string };

    act(() => {
      bookmark = result.current.addBookmark("Home", { x: 500, y: 500 }, 1.0);
    });

    expect(result.current.bookmarks.length).toBe(1);
    expect(result.current.bookmarks[0].name).toBe("Home");

    act(() => {
      result.current.updateBookmark(bookmark.id, { name: "My Home" });
    });

    expect(result.current.bookmarks[0].name).toBe("My Home");

    act(() => {
      result.current.removeBookmark(bookmark.id);
    });

    expect(result.current.bookmarks.length).toBe(0);
  });

  it("should navigate to bookmark", () => {
    const onNavigate = vi.fn();
    const { result } = renderHook(() => useMapNavigation({ onNavigate }));

    let bookmark: { id: string };

    act(() => {
      bookmark = result.current.addBookmark(
        "Target",
        { x: 1000, y: 1000 },
        2.0,
      );
    });

    act(() => {
      result.current.goToBookmark(bookmark.id);
    });

    expect(onNavigate).toHaveBeenCalled();
    const lastCall = onNavigate.mock.calls[onNavigate.mock.calls.length - 1][0];
    expect(lastCall.center.x).toBe(1000);
  });

  it("should calculate distance and bearing", () => {
    const { result } = renderHook(() => useMapNavigation());

    const from: WorldCoordinate = { x: 0, y: 0 };
    const to: WorldCoordinate = { x: 3, y: 4 };

    expect(result.current.getDistanceTo(from, to)).toBe(5);
    expect(result.current.getFormattedDistance(from, to)).toBe("5 tiles");
    expect(result.current.getBearingTo(from, to)).toBeGreaterThan(0);
    expect(result.current.getFormattedCoordinates(to)).toBe("(3, 4)");
  });

  it("should manage minimap sync state", () => {
    const { result } = renderHook(() => useMapNavigation());

    expect(result.current.isSyncedToMinimap).toBe(false);

    act(() => {
      result.current.toggleMinimapSync();
    });

    expect(result.current.isSyncedToMinimap).toBe(true);

    act(() => {
      result.current.setMinimapCenter({ x: 100, y: 100 });
    });

    expect(result.current.minimapCenter).toEqual({ x: 100, y: 100 });
  });
});
