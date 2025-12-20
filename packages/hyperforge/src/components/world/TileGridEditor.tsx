"use client";

import React, {
  useRef,
  useState,
  useCallback,
  useEffect,
  useMemo,
} from "react";
import { Trash2, Shield, Ban, Droplets } from "lucide-react";
import { cn } from "@/lib/utils";
import { logger } from "@/lib/utils";
import type {
  TileCoord,
  TileSpawn,
  WorldAreaDefinition,
  PlaceableItem,
  EditorTool,
  ViewportState,
} from "@/lib/world/tile-types";
import { tileKey, DEFAULT_VIEWPORT } from "@/lib/world/tile-types";
import {
  getTileAtPosition,
  setTileSpawn,
  removeTileSpawn,
  clearTile,
  moveTileSpawn,
  createSpawnFromItem,
  getTilesInRadius,
} from "@/lib/world/tile-service";

const log = logger.child("TileGridEditor");

// ============================================================================
// TYPES
// ============================================================================

interface TileGridEditorProps {
  area: WorldAreaDefinition | null;
  onAreaChange: (area: WorldAreaDefinition) => void;
  selectedTile: TileCoord | null;
  onSelectTile: (coord: TileCoord | null) => void;
  selectedSpawn: TileSpawn | null;
  onSelectSpawn: (spawn: TileSpawn | null) => void;
  selectedTiles: TileCoord[];
  onSelectTiles: (coords: TileCoord[]) => void;
  placingItem: PlaceableItem | null;
  onPlacingItemUsed: () => void;
  tool: EditorTool;
}

interface ContextMenuState {
  x: number;
  y: number;
  coord: TileCoord;
  spawn: TileSpawn | null;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const SPAWN_COLORS: Record<string, string> = {
  mob: "bg-red-500",
  npc: "bg-green-500",
  resource: "bg-emerald-500",
};

const SPAWN_ICONS: Record<string, string> = {
  mob: "⚔️",
  npc: "👤",
  resource: "🌲",
};

// Terrain type colors for visualization (overrides for explicit terrain types)
const TERRAIN_COLORS: Record<string, { bg: string; border: string }> = {
  water: { bg: "bg-blue-600/60", border: "border-blue-400/50" },
  lake: { bg: "bg-blue-600/60", border: "border-blue-400/50" },
  pond: { bg: "bg-blue-500/50", border: "border-blue-400/40" },
  river: { bg: "bg-blue-500/50", border: "border-blue-400/40" },
  swamp: { bg: "bg-teal-700/50", border: "border-teal-500/40" },
  road: { bg: "bg-amber-800/40", border: "border-amber-600/30" },
  path: { bg: "bg-amber-700/30", border: "border-amber-500/20" },
  rock: { bg: "bg-stone-600/50", border: "border-stone-400/40" },
  sand: { bg: "bg-yellow-600/40", border: "border-yellow-500/30" },
};

// ============================================================================
// COMPONENT
// ============================================================================

export function TileGridEditor({
  area,
  onAreaChange,
  selectedTile,
  onSelectTile,
  selectedSpawn,
  onSelectSpawn,
  selectedTiles,
  onSelectTiles,
  placingItem,
  onPlacingItemUsed,
  tool,
}: TileGridEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<ViewportState>(DEFAULT_VIEWPORT);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [draggedSpawn, setDraggedSpawn] = useState<{
    spawn: TileSpawn;
    coord: TileCoord;
  } | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [hoveredTile, setHoveredTile] = useState<TileCoord | null>(null);

  // Debug: log area data
  useEffect(() => {
    if (area) {
      log.debug("TileGridEditor received area", {
        areaId: area.id,
        tileCount: area.tiles.size,
        bounds: area.bounds,
        spawnCounts: area.spawnCounts,
      });
    }
  }, [area]);

  // Auto-center viewport on spawns when area changes
  useEffect(() => {
    if (!area || !containerRef.current) return;

    // Delay to ensure container has rendered with proper dimensions
    const timer = setTimeout(() => {
      if (!containerRef.current) return;

      const tilePixelSize = viewport.tileSize * viewport.zoom;
      const containerRect = containerRef.current.getBoundingClientRect();

      // Skip if container has no size yet
      if (containerRect.width === 0 || containerRect.height === 0) {
        log.warn("Container has no size, skipping auto-center");
        return;
      }

      // Find center of spawns or center of bounds if no spawns
      let centerX = (area.bounds.minX + area.bounds.maxX) / 2;
      let centerZ = (area.bounds.minZ + area.bounds.maxZ) / 2;

      if (area.tiles.size > 0) {
        // Calculate center of all tiles with spawns
        const tilesWithSpawns = Array.from(area.tiles.values()).filter(
          (t) => t.contents.spawns.length > 0,
        );
        if (tilesWithSpawns.length > 0) {
          const sumX = tilesWithSpawns.reduce((acc, t) => acc + t.coord.x, 0);
          const sumZ = tilesWithSpawns.reduce((acc, t) => acc + t.coord.z, 0);
          centerX = sumX / tilesWithSpawns.length;
          centerZ = sumZ / tilesWithSpawns.length;
        }
      }

      // Calculate pan to center the spawns in the viewport
      const panX =
        containerRect.width / 2 - (centerX - area.bounds.minX) * tilePixelSize;
      const panZ =
        containerRect.height / 2 - (centerZ - area.bounds.minZ) * tilePixelSize;

      setViewport((prev) => ({
        ...prev,
        panX,
        panZ,
      }));

      // Also calculate optimal zoom to fit the area
      const worldWidth =
        (area.bounds.maxX - area.bounds.minX) * viewport.tileSize;
      const worldHeight =
        (area.bounds.maxZ - area.bounds.minZ) * viewport.tileSize;
      const fitZoom = Math.min(
        (containerRect.width - 40) / worldWidth,
        (containerRect.height - 40) / worldHeight,
        1.5, // Max initial zoom
      );
      const clampedZoom = Math.max(0.15, Math.min(2, fitZoom));

      // Recalculate pan with new zoom
      const adjustedTilePixelSize = viewport.tileSize * clampedZoom;
      const adjustedPanX =
        containerRect.width / 2 -
        (centerX - area.bounds.minX) * adjustedTilePixelSize;
      const adjustedPanZ =
        containerRect.height / 2 -
        (centerZ - area.bounds.minZ) * adjustedTilePixelSize;

      setViewport((prev) => ({
        ...prev,
        zoom: clampedZoom,
        panX: adjustedPanX,
        panZ: adjustedPanZ,
      }));

      log.info("Auto-centered and zoomed viewport", {
        centerX,
        centerZ,
        panX: adjustedPanX,
        panZ: adjustedPanZ,
        zoom: clampedZoom,
        containerWidth: containerRect.width,
        containerHeight: containerRect.height,
      });
    }, 100);

    return () => clearTimeout(timer);
  }, [area?.id]); // Only re-center when area changes, not on every render

  // Calculate visible tile range based on viewport with culling
  const visibleRange = useMemo(() => {
    if (!area || !containerRef.current) return null;

    const { bounds } = area;
    const tilePixelSize = viewport.tileSize * viewport.zoom;
    const containerRect = containerRef.current.getBoundingClientRect();

    // Calculate which tiles are actually visible in the viewport
    // Add 2 tile margin for smooth panning
    const margin = 2;

    // Convert screen coordinates to tile coordinates
    const screenMinX = -viewport.panX / tilePixelSize + bounds.minX - margin;
    const screenMaxX =
      (containerRect.width - viewport.panX) / tilePixelSize +
      bounds.minX +
      margin;
    const screenMinZ = -viewport.panZ / tilePixelSize + bounds.minZ - margin;
    const screenMaxZ =
      (containerRect.height - viewport.panZ) / tilePixelSize +
      bounds.minZ +
      margin;

    // Clamp to area bounds
    const visMinX = Math.max(bounds.minX, Math.floor(screenMinX));
    const visMaxX = Math.min(bounds.maxX, Math.ceil(screenMaxX));
    const visMinZ = Math.max(bounds.minZ, Math.floor(screenMinZ));
    const visMaxZ = Math.min(bounds.maxZ, Math.ceil(screenMaxZ));

    return {
      // Full bounds for reference
      boundsMinX: bounds.minX,
      boundsMaxX: bounds.maxX,
      boundsMinZ: bounds.minZ,
      boundsMaxZ: bounds.maxZ,
      // Visible range (culled)
      minX: visMinX,
      maxX: visMaxX,
      minZ: visMinZ,
      maxZ: visMaxZ,
      width: visMaxX - visMinX,
      height: visMaxZ - visMinZ,
      tilePixelSize,
    };
  }, [
    area,
    viewport,
    containerRef.current?.getBoundingClientRect().width,
    containerRef.current?.getBoundingClientRect().height,
  ]);

  // Convert tile coordinate to screen position
  const tileToScreen = useCallback(
    (coord: TileCoord): { x: number; y: number } => {
      if (!area) return { x: 0, y: 0 };

      const tilePixelSize = viewport.tileSize * viewport.zoom;
      return {
        x: (coord.x - area.bounds.minX) * tilePixelSize + viewport.panX,
        y: (coord.z - area.bounds.minZ) * tilePixelSize + viewport.panZ,
      };
    },
    [area, viewport],
  );

  // Convert screen position to tile coordinate
  const screenToTile = useCallback(
    (screenX: number, screenY: number): TileCoord | null => {
      if (!area || !containerRef.current) return null;

      const rect = containerRef.current.getBoundingClientRect();
      const x = screenX - rect.left;
      const y = screenY - rect.top;

      const tilePixelSize = viewport.tileSize * viewport.zoom;
      const tileX =
        Math.floor((x - viewport.panX) / tilePixelSize) + area.bounds.minX;
      const tileZ =
        Math.floor((y - viewport.panZ) / tilePixelSize) + area.bounds.minZ;

      // Check if within bounds
      if (
        tileX < area.bounds.minX ||
        tileX >= area.bounds.maxX ||
        tileZ < area.bounds.minZ ||
        tileZ >= area.bounds.maxZ
      ) {
        return null;
      }

      return { x: tileX, z: tileZ };
    },
    [area, viewport],
  );

  // Track if spacebar is held for panning
  const [spacePressed, setSpacePressed] = useState(false);

  // Spacebar hold for pan mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" && !e.repeat) {
        e.preventDefault();
        setSpacePressed(true);
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        setSpacePressed(false);
        setIsPanning(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  // Handle mouse wheel/trackpad gestures using native event listener
  // to properly prevent default on non-passive wheel events
  // - Ctrl/Cmd + wheel = zoom (standard for design tools)
  // - Regular wheel = pan (natural for trackpad two-finger scroll)
  // - Pinch gesture = zoom (handled by browser as ctrl+wheel)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();

      // Check if it's a pinch/zoom gesture (ctrl/meta key) or actual mouse wheel zoom intent
      const isZoomGesture = e.ctrlKey || e.metaKey;

      if (isZoomGesture) {
        // Zoom: ctrl/cmd + scroll or pinch
        // Smaller delta for smoother zoom, especially on trackpad
        const zoomDelta = -e.deltaY * 0.01;
        setViewport((v) => ({
          ...v,
          zoom: Math.max(0.1, Math.min(5, v.zoom + zoomDelta)),
        }));
      } else {
        // Pan: regular scroll (two-finger swipe on trackpad, scroll wheel on mouse)
        // deltaX = horizontal, deltaY = vertical
        setViewport((v) => ({
          ...v,
          panX: v.panX - e.deltaX,
          panZ: v.panZ - e.deltaY,
        }));
      }
    };

    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, []);

  // Handle mouse move
  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const coord = screenToTile(e.clientX, e.clientY);
      setHoveredTile(coord);

      if (isPanning) {
        const dx = e.clientX - panStart.x;
        const dy = e.clientY - panStart.y;
        setViewport((v) => ({
          ...v,
          panX: v.panX + dx,
          panZ: v.panZ + dy,
        }));
        setPanStart({ x: e.clientX, y: e.clientY });
      } else if (isDragging && draggedSpawn && area && coord) {
        // Show drag preview - handled in render
      } else if (isDragging && dragStart && area) {
        // Multi-select drag
        const currentCoord = coord;
        if (currentCoord) {
          const minX = Math.min(dragStart.x, currentCoord.x);
          const maxX = Math.max(dragStart.x, currentCoord.x);
          const minZ = Math.min(dragStart.y, currentCoord.z);
          const maxZ = Math.max(dragStart.y, currentCoord.z);

          const selected: TileCoord[] = [];
          for (let x = minX; x <= maxX; x++) {
            for (let z = minZ; z <= maxZ; z++) {
              selected.push({ x, z });
            }
          }
          onSelectTiles(selected);
        }
      }
    },
    [
      area,
      isPanning,
      panStart,
      isDragging,
      dragStart,
      draggedSpawn,
      screenToTile,
      onSelectTiles,
    ],
  );

  // Handle mouse down
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Close context menu on any click
      setContextMenu(null);

      // Middle mouse for panning, or spacebar held
      if (e.button === 1 || spacePressed) {
        e.preventDefault();
        setIsPanning(true);
        setPanStart({ x: e.clientX, y: e.clientY });
        return;
      }

      // Right click is handled by context menu
      if (e.button === 2) return;

      const coord = screenToTile(e.clientX, e.clientY);
      if (!coord || !area) return;

      if (tool === "pan") {
        setIsPanning(true);
        setPanStart({ x: e.clientX, y: e.clientY });
        return;
      }

      if (tool === "place" && placingItem) {
        // Place the item on this tile
        const spawn = createSpawnFromItem(placingItem, coord);
        const newArea = setTileSpawn(area, coord, spawn);
        onAreaChange(newArea);
        onPlacingItemUsed();
        onSelectTile(coord);
        onSelectSpawn(spawn);
        return;
      }

      if (tool === "erase") {
        // Erase all spawns on this tile
        const newArea = clearTile(area, coord);
        onAreaChange(newArea);
        return;
      }

      // Select tool - check for shift key for multi-select
      if (e.shiftKey) {
        setIsDragging(true);
        setDragStart({ x: coord.x, y: coord.z });
        onSelectTiles([coord]);
      } else {
        // Check if clicking on a spawn
        const tile = getTileAtPosition(area, coord.x, coord.z);
        if (tile && tile.contents.spawns.length > 0) {
          onSelectSpawn(tile.contents.spawns[0]);
        } else {
          onSelectSpawn(null);
        }
        onSelectTile(coord);
        onSelectTiles([]);
      }
    },
    [
      area,
      tool,
      placingItem,
      screenToTile,
      spacePressed,
      onAreaChange,
      onPlacingItemUsed,
      onSelectTile,
      onSelectSpawn,
      onSelectTiles,
    ],
  );

  // Handle mouse up
  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    setDragStart(null);
    setIsPanning(false);

    if (draggedSpawn && hoveredTile && area) {
      // Complete the drag operation
      const newArea = moveTileSpawn(
        area,
        draggedSpawn.spawn.id,
        draggedSpawn.coord,
        hoveredTile,
      );
      onAreaChange(newArea);
      onSelectTile(hoveredTile);
    }
    setDraggedSpawn(null);
  }, [draggedSpawn, hoveredTile, area, onAreaChange, onSelectTile]);

  // Handle context menu
  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const coord = screenToTile(e.clientX, e.clientY);
      if (!coord || !area) return;

      const tile = getTileAtPosition(area, coord.x, coord.z);
      const spawn = tile?.contents.spawns[0] || null;

      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        coord,
        spawn,
      });
    },
    [area, screenToTile],
  );

  // Handle spawn drag start
  const handleSpawnDragStart = useCallback(
    (e: React.MouseEvent, spawn: TileSpawn, coord: TileCoord) => {
      e.stopPropagation();
      setDraggedSpawn({ spawn, coord });
      setIsDragging(true);
      onSelectSpawn(spawn);
      onSelectTile(coord);
    },
    [onSelectSpawn, onSelectTile],
  );

  // Context menu actions
  const handleContextAction = useCallback(
    (action: string) => {
      if (!contextMenu || !area) return;

      const { coord, spawn } = contextMenu;

      switch (action) {
        case "delete":
          if (spawn) {
            const newArea = removeTileSpawn(area, coord, spawn.id);
            onAreaChange(newArea);
          }
          break;
        case "clear":
          {
            const newArea = clearTile(area, coord);
            onAreaChange(newArea);
          }
          break;
        case "toggleWalkable":
          {
            const tile = getTileAtPosition(area, coord.x, coord.z);
            if (tile) {
              tile.contents.walkable = !tile.contents.walkable;
              onAreaChange({ ...area });
            }
          }
          break;
        case "toggleSafeZone":
          {
            const tile = getTileAtPosition(area, coord.x, coord.z);
            if (tile) {
              tile.contents.safeZone = !tile.contents.safeZone;
              onAreaChange({ ...area });
            }
          }
          break;
      }

      setContextMenu(null);
    },
    [area, contextMenu, onAreaChange],
  );

  // Close context menu on escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setContextMenu(null);
        onSelectTile(null);
        onSelectSpawn(null);
        onSelectTiles([]);
      }
      if (e.key === "Delete" && selectedSpawn && selectedTile && area) {
        const newArea = removeTileSpawn(area, selectedTile, selectedSpawn.id);
        onAreaChange(newArea);
        onSelectSpawn(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    area,
    selectedSpawn,
    selectedTile,
    onAreaChange,
    onSelectSpawn,
    onSelectTile,
    onSelectTiles,
  ]);

  // Handle drop from palette
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const data = e.dataTransfer.getData("application/json");
      if (!data || !area) return;

      try {
        const item: PlaceableItem = JSON.parse(data);
        const coord = screenToTile(e.clientX, e.clientY);
        if (!coord) return;

        const spawn = createSpawnFromItem(item, coord);
        const newArea = setTileSpawn(area, coord, spawn);
        onAreaChange(newArea);
        onSelectTile(coord);
        onSelectSpawn(spawn);

        log.info("Dropped spawn on tile", {
          coord,
          type: item.type,
          entityId: item.entityId,
        });
      } catch {
        // Invalid JSON
      }
    },
    [area, screenToTile, onAreaChange, onSelectTile, onSelectSpawn],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  // Render tiles
  const renderTiles = useMemo(() => {
    if (!area || !visibleRange) return null;

    const tiles: React.JSX.Element[] = [];
    const tilePixelSize = visibleRange.tilePixelSize;

    for (let x = visibleRange.minX; x < visibleRange.maxX; x++) {
      for (let z = visibleRange.minZ; z < visibleRange.maxZ; z++) {
        const coord = { x, z };
        const key = tileKey(coord);
        const tile = area.tiles.get(key);
        const pos = tileToScreen(coord);

        const isSelected = selectedTile?.x === x && selectedTile?.z === z;
        const isMultiSelected = selectedTiles.some(
          (t) => t.x === x && t.z === z,
        );
        const isHovered = hoveredTile?.x === x && hoveredTile?.z === z;
        const hasSpawns = tile && tile.contents.spawns.length > 0;
        const isWalkable = !tile || tile.contents.walkable;
        const isSafeZone = tile?.contents.safeZone;
        const terrain = tile?.contents.terrain;
        const terrainColors = terrain ? TERRAIN_COLORS[terrain] : null;

        // Highlight spawn radius for selected spawn
        let isInRadius = false;
        if (selectedSpawn && selectedTile && selectedSpawn.type === "mob") {
          const mobSpawn = selectedSpawn as { spawnRadius: number };
          const radiusTiles = getTilesInRadius(
            selectedTile,
            mobSpawn.spawnRadius,
          );
          isInRadius = radiusTiles.some((t) => t.x === x && t.z === z);
        }

        // Tile position and size
        const bgStyle: React.CSSProperties = {
          left: pos.x,
          top: pos.y,
          width: tilePixelSize,
          height: tilePixelSize,
        };

        tiles.push(
          <div
            key={key}
            className={cn(
              "absolute border transition-colors border-zinc-700/50",
              // Explicit terrain styling
              terrainColors
                ? `${terrainColors.bg} ${terrainColors.border}`
                : hasSpawns
                  ? "border-cyan-500/50"
                  : "",
              // Selection states
              isSelected
                ? "border-cyan-400 bg-cyan-500/30 z-10"
                : isMultiSelected
                  ? "border-cyan-300 bg-cyan-400/20"
                  : isHovered
                    ? "border-white/60 bg-white/10"
                    : "",
              // Special states
              isInRadius && !isSelected && "bg-red-500/20 border-red-500/40",
              !isWalkable && "bg-red-900/50 border-red-700/50",
              isSafeZone &&
                !terrainColors &&
                "bg-green-500/20 border-green-500/40",
            )}
            style={bgStyle}
          >
            {/* Spawn indicators */}
            {hasSpawns && (
              <div className="absolute inset-0 flex items-center justify-center">
                {tile.contents.spawns.map((spawn, i) => (
                  <div
                    key={spawn.id}
                    className={cn(
                      "rounded-full flex items-center justify-center cursor-move transition-transform hover:scale-110",
                      SPAWN_COLORS[spawn.type],
                      selectedSpawn?.id === spawn.id &&
                        "ring-2 ring-white scale-110",
                      tilePixelSize < 24
                        ? "w-3 h-3 text-[6px]"
                        : "w-6 h-6 text-xs",
                    )}
                    style={{
                      marginLeft: i > 0 ? -4 : 0,
                    }}
                    onMouseDown={(e) => handleSpawnDragStart(e, spawn, coord)}
                    title={`${spawn.name} (${spawn.type})`}
                  >
                    {tilePixelSize >= 24 && SPAWN_ICONS[spawn.type]}
                  </div>
                ))}
              </div>
            )}

            {/* Tile markers */}
            {!isWalkable && !terrain && (
              <div className="absolute top-0.5 left-0.5">
                <Ban className="w-3 h-3 text-zinc-500" />
              </div>
            )}
            {/* Water indicator */}
            {(terrain === "water" || terrain === "lake") &&
              tilePixelSize >= 20 && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <Droplets className="w-4 h-4 text-blue-200/70" />
                </div>
              )}
            {isSafeZone && !terrainColors && (
              <div className="absolute top-0.5 right-0.5">
                <Shield className="w-3 h-3 text-green-500" />
              </div>
            )}
          </div>,
        );
      }
    }

    return tiles;
  }, [
    area,
    visibleRange,
    tileToScreen,
    selectedTile,
    selectedTiles,
    hoveredTile,
    selectedSpawn,
    handleSpawnDragStart,
  ]);

  if (!area) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <div className="text-center">
          <p className="text-lg font-medium mb-2">No area selected</p>
          <p className="text-sm">Select or create an area to start editing</p>
        </div>
      </div>
    );
  }

  // Determine cursor based on state
  const cursorClass = isPanning
    ? "cursor-grabbing"
    : spacePressed || tool === "pan"
      ? "cursor-grab"
      : tool === "erase"
        ? "cursor-not-allowed"
        : "cursor-crosshair";

  return (
    <div
      ref={containerRef}
      className={cn(
        "flex-1 h-full relative overflow-hidden bg-zinc-900",
        cursorClass,
      )}
      onMouseMove={handleMouseMove}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onContextMenu={handleContextMenu}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      {/* Debug: Area info overlay */}
      <div className="absolute top-2 left-2 z-50 text-xs text-white/60 bg-black/50 px-2 py-1 rounded pointer-events-none">
        {area.name} | Grid: {area.bounds.maxX - area.bounds.minX}x
        {area.bounds.maxZ - area.bounds.minZ} (
        {(area.bounds.maxX - area.bounds.minX) *
          (area.bounds.maxZ - area.bounds.minZ)}{" "}
        tiles) | With data: {area.tiles.size}
      </div>

      {/* Zoom controls */}
      <div className="absolute bottom-4 right-4 z-50 flex items-center gap-2 bg-zinc-800/90 rounded-lg p-1 border border-zinc-700">
        <button
          className="w-8 h-8 flex items-center justify-center hover:bg-zinc-700 rounded text-white/80 hover:text-white"
          onClick={() =>
            setViewport((v) => ({ ...v, zoom: Math.max(0.1, v.zoom - 0.25) }))
          }
          title="Zoom out (Ctrl + scroll)"
        >
          −
        </button>
        <span className="text-xs text-white/70 w-12 text-center">
          {Math.round(viewport.zoom * 100)}%
        </span>
        <button
          className="w-8 h-8 flex items-center justify-center hover:bg-zinc-700 rounded text-white/80 hover:text-white"
          onClick={() =>
            setViewport((v) => ({ ...v, zoom: Math.min(5, v.zoom + 0.25) }))
          }
          title="Zoom in (Ctrl + scroll)"
        >
          +
        </button>
        <div className="w-px h-6 bg-zinc-600 mx-1" />
        <button
          className="w-8 h-8 flex items-center justify-center hover:bg-zinc-700 rounded text-white/80 hover:text-white text-xs"
          onClick={() => setViewport((v) => ({ ...v, zoom: 1 }))}
          title="Reset zoom to 100%"
        >
          1:1
        </button>
        <button
          className="w-8 h-8 flex items-center justify-center hover:bg-zinc-700 rounded text-white/80 hover:text-white text-xs"
          onClick={() => {
            if (!containerRef.current || !area) return;
            const rect = containerRef.current.getBoundingClientRect();

            // Calculate zoom to fit all content
            const worldWidth =
              (area.bounds.maxX - area.bounds.minX) * viewport.tileSize;
            const worldHeight =
              (area.bounds.maxZ - area.bounds.minZ) * viewport.tileSize;
            const fitZoom = Math.min(
              (rect.width - 80) / worldWidth,
              (rect.height - 80) / worldHeight,
              2, // Max zoom for fit
            );

            // Center the view
            const panX = (rect.width - worldWidth * fitZoom) / 2;
            const panZ = (rect.height - worldHeight * fitZoom) / 2;

            setViewport((v) => ({
              ...v,
              zoom: Math.max(0.1, fitZoom),
              panX,
              panZ,
            }));
          }}
          title="Fit to view"
        >
          ⊞
        </button>
      </div>

      {/* Pan hint */}
      <div className="absolute bottom-4 left-4 z-50 text-xs text-white/40 pointer-events-none">
        Scroll to pan • Ctrl+scroll to zoom • Space+drag to pan
      </div>

      {/* Grid container */}
      <div className="absolute inset-0">{renderTiles}</div>

      {/* Drag preview */}
      {draggedSpawn && hoveredTile && (
        <div
          className="absolute pointer-events-none z-20"
          style={{
            ...tileToScreen(hoveredTile),
            width: viewport.tileSize * viewport.zoom,
            height: viewport.tileSize * viewport.zoom,
          }}
        >
          <div
            className={cn(
              "w-6 h-6 rounded-full flex items-center justify-center opacity-70",
              SPAWN_COLORS[draggedSpawn.spawn.type],
            )}
          >
            {SPAWN_ICONS[draggedSpawn.spawn.type]}
          </div>
        </div>
      )}

      {/* Placing item preview */}
      {placingItem && hoveredTile && tool === "place" && (
        <div
          className="absolute pointer-events-none z-20 opacity-60"
          style={{
            ...tileToScreen(hoveredTile),
            width: viewport.tileSize * viewport.zoom,
            height: viewport.tileSize * viewport.zoom,
          }}
        >
          <div
            className={cn(
              "w-full h-full rounded flex items-center justify-center border-2 border-dashed",
              SPAWN_COLORS[placingItem.type],
              "border-white",
            )}
          >
            {SPAWN_ICONS[placingItem.type]}
          </div>
        </div>
      )}

      {/* Context menu */}
      {contextMenu && (
        <div
          className="fixed z-50 min-w-[160px] bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl py-1"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {contextMenu.spawn && (
            <>
              <button
                className="w-full px-3 py-2 text-left text-sm hover:bg-zinc-700 flex items-center gap-2"
                onClick={() => handleContextAction("delete")}
              >
                <Trash2 className="w-4 h-4 text-red-400" />
                Delete Spawn
              </button>
              <div className="h-px bg-zinc-700 my-1" />
            </>
          )}
          <button
            className="w-full px-3 py-2 text-left text-sm hover:bg-zinc-700 flex items-center gap-2"
            onClick={() => handleContextAction("clear")}
          >
            <Trash2 className="w-4 h-4" />
            Clear Tile
          </button>
          <button
            className="w-full px-3 py-2 text-left text-sm hover:bg-zinc-700 flex items-center gap-2"
            onClick={() => handleContextAction("toggleWalkable")}
          >
            <Ban className="w-4 h-4" />
            Toggle Walkable
          </button>
          <button
            className="w-full px-3 py-2 text-left text-sm hover:bg-zinc-700 flex items-center gap-2"
            onClick={() => handleContextAction("toggleSafeZone")}
          >
            <Shield className="w-4 h-4 text-green-400" />
            Toggle Safe Zone
          </button>
        </div>
      )}

      {/* Status bar */}
      <div className="absolute bottom-4 left-4 px-3 py-2 rounded-lg bg-black/80 text-xs font-mono border border-zinc-700">
        <div className="flex items-center gap-4">
          <span>
            <span className="text-muted-foreground">Area: </span>
            <span className="text-cyan-400">{area.name}</span>
          </span>
          <span>
            <span className="text-muted-foreground">Size: </span>
            {area.bounds.maxX - area.bounds.minX} ×{" "}
            {area.bounds.maxZ - area.bounds.minZ}
          </span>
          <span>
            <span className="text-muted-foreground">Zoom: </span>
            {Math.round(viewport.zoom * 100)}%
          </span>
          {hoveredTile && (
            <span>
              <span className="text-muted-foreground">Tile: </span>(
              {hoveredTile.x}, {hoveredTile.z})
            </span>
          )}
        </div>
      </div>

      {/* Spawn counts */}
      <div className="absolute bottom-4 right-4 px-3 py-2 rounded-lg bg-black/80 text-xs font-mono border border-zinc-700">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-red-500" />
            {area.spawnCounts.mobs} mobs
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-green-500" />
            {area.spawnCounts.npcs} NPCs
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            {area.spawnCounts.resources} resources
          </span>
        </div>
      </div>
    </div>
  );
}
