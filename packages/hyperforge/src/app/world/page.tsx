"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import {
  Save,
  Play,
  Undo2,
  Redo2,
  Grid3X3,
  Loader2,
  ChevronLeft,
  RefreshCw,
  Wifi,
  WifiOff,
  MousePointer2,
  Plus,
  Trash2,
  Hand,
  Maximize2,
  ChevronDown,
  X,
  MapPin,
  Map as MapIcon,
} from "lucide-react";
import { StudioPageLayout } from "@/components/layout/StudioPageLayout";
import { TileGridEditor } from "@/components/world/TileGridEditor";
import { TileInspector } from "@/components/world/TileInspector";
import { SpawnPalette } from "@/components/world/SpawnPalette";
import { SpectacularButton } from "@/components/ui/spectacular-button";
import { useToast } from "@/components/ui/toast";
import { logger } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { useLiveServer } from "@/hooks/useLiveServer";
import type {
  TileCoord,
  TileSpawn,
  WorldAreaDefinition,
  PlaceableItem,
  EditorTool,
  Tile,
} from "@/lib/world/tile-types";
import {
  convertWorldAreasToEditor,
  convertEditorToWorldAreas,
  createSpawnFromItem,
  setTileSpawn,
} from "@/lib/world/tile-service";
import type { WorldAreasConfig } from "@/lib/game/manifests";
// World size matches TerrainSystem.CONFIG in the game
const FULL_WORLD_SIZE = 100; // 100x100 tile grid = 10km x 10km

const log = logger.child("Page:world");

// ============================================================================
// TOOL CONFIG
// ============================================================================

const TOOLS: Array<{
  id: EditorTool;
  icon: typeof MousePointer2;
  label: string;
  shortcut: string;
}> = [
  { id: "select", icon: MousePointer2, label: "Select", shortcut: "V" },
  { id: "place", icon: Plus, label: "Place", shortcut: "P" },
  { id: "erase", icon: Trash2, label: "Erase", shortcut: "E" },
  { id: "pan", icon: Hand, label: "Pan", shortcut: "Space" },
];

// ============================================================================
// PAGE COMPONENT
// ============================================================================

export default function WorldEditorPage() {
  const { toast } = useToast();
  const [mounted, setMounted] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Areas data
  const [areas, setAreas] = useState<WorldAreaDefinition[]>([]);
  const [currentArea, setCurrentArea] = useState<WorldAreaDefinition | null>(
    null,
  );
  const [originalAreas, setOriginalAreas] = useState<WorldAreaDefinition[]>([]);

  // Selection state
  const [selectedTile, setSelectedTile] = useState<TileCoord | null>(null);
  const [selectedSpawn, setSelectedSpawn] = useState<TileSpawn | null>(null);
  const [selectedTiles, setSelectedTiles] = useState<TileCoord[]>([]);

  // Editor state
  const [tool, setTool] = useState<EditorTool>("select");
  const [placingItem, setPlacingItem] = useState<PlaceableItem | null>(null);
  const [showGrid, setShowGrid] = useState(true);
  const [showFullWorld, setShowFullWorld] = useState(false);

  // Available entities for quick placement
  const [availableEntities, setAvailableEntities] = useState<
    Array<{ id: string; name: string; type: "mob" | "npc" | "resource" }>
  >([]);

  // History for undo/redo
  const [history, setHistory] = useState<WorldAreaDefinition[][]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  // Live server connection
  const [_dataSource, setDataSource] = useState<"live" | "manifests">(
    "manifests",
  );
  const {
    connection,
    connect: connectLive,
    disconnect: disconnectLive,
    refresh: _refreshLive,
  } = useLiveServer({
    autoConnect: false,
  });

  useEffect(() => {
    setMounted(true);
  }, []);

  // Load world areas
  useEffect(() => {
    if (!mounted) return;

    async function loadData() {
      setIsLoading(true);
      try {
        // Load world areas from manifest
        const res = await fetch("/api/game/manifests?type=areas");
        if (res.ok) {
          const data = await res.json();

          if (data.success && data.data) {
            // Load the raw world areas config to convert to editor format
            const configRes = await fetch("/api/world/config");
            if (configRes.ok) {
              const configData: WorldAreasConfig = await configRes.json();
              const editorAreas = convertWorldAreasToEditor(configData);

              setAreas(editorAreas);
              setOriginalAreas(
                JSON.parse(
                  JSON.stringify(
                    editorAreas.map((a) => ({
                      ...a,
                      tiles: Object.fromEntries(a.tiles),
                    })),
                  ),
                ),
              );

              // Select first area by default
              if (editorAreas.length > 0) {
                setCurrentArea(editorAreas[0]);
              }

              // Initialize history
              setHistory([editorAreas]);
              setHistoryIndex(0);

              log.info("Loaded world areas", { count: editorAreas.length });
            } else {
              // Fallback: create areas from flat list
              log.warn("Could not load world config, using flat area list");
              setDataSource("manifests");
            }
          }
        }

        // Load available entities for quick placement
        try {
          const [npcsRes, resourcesRes] = await Promise.all([
            fetch("/api/game/manifests/npcs"),
            fetch("/api/game/manifests/resources"),
          ]);

          const entities: Array<{
            id: string;
            name: string;
            type: "mob" | "npc" | "resource";
          }> = [];

          if (npcsRes.ok) {
            const npcsData = await npcsRes.json();
            npcsData.forEach(
              (npc: { id: string; name: string; hostile?: boolean }) => {
                entities.push({
                  id: npc.id,
                  name: npc.name,
                  type: npc.hostile ? "mob" : "npc",
                });
              },
            );
          }

          if (resourcesRes.ok) {
            const resourcesData = await resourcesRes.json();
            resourcesData.forEach((res: { id: string; name: string }) => {
              entities.push({
                id: res.id,
                name: res.name,
                type: "resource",
              });
            });
          }

          setAvailableEntities(entities);
          log.info("Loaded available entities", { count: entities.length });
        } catch (e) {
          log.warn("Failed to load available entities", { error: e });
        }
      } catch (error) {
        log.error("Failed to load world data:", error);
        toast({
          variant: "destructive",
          title: "Failed to load world",
          description: "Could not load world areas",
        });
      } finally {
        setIsLoading(false);
      }
    }

    loadData();
  }, [mounted, toast]);

  // Update current area in areas list
  const handleAreaChange = useCallback(
    (updatedArea: WorldAreaDefinition) => {
      setCurrentArea(updatedArea);
      setAreas((prev) =>
        prev.map((a) => (a.id === updatedArea.id ? updatedArea : a)),
      );

      // Save to history
      setHistory((prev) => {
        const newHistory = prev.slice(0, historyIndex + 1);
        const newAreas = areas.map((a) =>
          a.id === updatedArea.id ? updatedArea : a,
        );
        newHistory.push(newAreas);
        return newHistory;
      });
      setHistoryIndex((prev) => prev + 1);
    },
    [areas, historyIndex],
  );

  // Handle palette item selection
  const handleSelectPaletteItem = useCallback((item: PlaceableItem) => {
    setPlacingItem(item);
    setTool("place");
  }, []);

  // Handle placing entity from inspector
  const handlePlaceEntity = useCallback(
    (
      entity: { id: string; name: string; type: "mob" | "npc" | "resource" },
      coord: TileCoord,
    ) => {
      if (!currentArea) return;

      const item: PlaceableItem = {
        type: entity.type,
        entityId: entity.id,
        name: entity.name,
      };

      const spawn = createSpawnFromItem(item, coord);
      const newArea = setTileSpawn(currentArea, coord, spawn);
      handleAreaChange(newArea);
      setSelectedSpawn(spawn);

      log.info("Placed entity from inspector", { entityId: entity.id, coord });
    },
    [currentArea, handleAreaChange],
  );

  // Clear placing item when tool changes
  const handleToolChange = useCallback((newTool: EditorTool) => {
    setTool(newTool);
    if (newTool !== "place") {
      setPlacingItem(null);
    }
  }, []);

  // Undo/Redo
  const handleUndo = useCallback(() => {
    if (historyIndex > 0) {
      setHistoryIndex((prev) => prev - 1);
      const prevAreas = history[historyIndex - 1];
      setAreas(prevAreas);
      const current = prevAreas.find((a) => a.id === currentArea?.id);
      if (current) setCurrentArea(current);
    }
  }, [history, historyIndex, currentArea]);

  const handleRedo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      setHistoryIndex((prev) => prev + 1);
      const nextAreas = history[historyIndex + 1];
      setAreas(nextAreas);
      const current = nextAreas.find((a) => a.id === currentArea?.id);
      if (current) setCurrentArea(current);
    }
  }, [history, historyIndex, currentArea]);

  // Save to server
  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      // Convert editor format to world-areas.json format
      const worldAreasConfig = convertEditorToWorldAreas(areas);

      const res = await fetch("/api/world/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(worldAreasConfig),
      });

      if (!res.ok) {
        throw new Error("Failed to save world configuration");
      }

      // Update original for dirty tracking
      setOriginalAreas(
        JSON.parse(
          JSON.stringify(
            areas.map((a) => ({
              ...a,
              tiles: Object.fromEntries(a.tiles),
            })),
          ),
        ),
      );

      toast({
        title: "World Saved",
        description: `Saved ${areas.length} areas with spawn data`,
      });
    } catch (error) {
      log.error("Failed to save world:", error);
      toast({
        variant: "destructive",
        title: "Save Failed",
        description: "Could not save world configuration",
      });
    } finally {
      setIsSaving(false);
    }
  }, [areas, toast]);

  // Toggle live mode
  const handleToggleLiveMode = useCallback(() => {
    if (connection.connected) {
      disconnectLive();
      toast({
        title: "Disconnected",
        description: "Disconnected from live game server",
      });
    } else {
      connectLive();
      toast({
        title: "Connecting...",
        description: "Connecting to live game server at localhost:5555",
      });
    }
  }, [connection.connected, connectLive, disconnectLive, toast]);

  // Refresh data
  const handleRefresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const configRes = await fetch("/api/world/config");
      if (configRes.ok) {
        const configData: WorldAreasConfig = await configRes.json();
        const editorAreas = convertWorldAreasToEditor(configData);

        setAreas(editorAreas);
        setOriginalAreas(
          JSON.parse(
            JSON.stringify(
              editorAreas.map((a) => ({
                ...a,
                tiles: Object.fromEntries(a.tiles),
              })),
            ),
          ),
        );

        // Keep current area selection if still exists
        if (currentArea) {
          const updated = editorAreas.find((a) => a.id === currentArea.id);
          setCurrentArea(updated || editorAreas[0] || null);
        }

        toast({
          title: "Refreshed",
          description: "World data reloaded from manifests",
        });
      }
    } catch (error) {
      log.error("Failed to refresh:", error);
      toast({
        variant: "destructive",
        title: "Refresh Failed",
        description: "Could not reload world data",
      });
    } finally {
      setIsLoading(false);
    }
  }, [currentArea, toast]);

  // Test in game
  const handleTestInGame = useCallback(() => {
    window.open("http://localhost:3333", "_blank");
  }, []);

  // Full world view - shows entire 100x100 tile world with procedural terrain
  const fullWorldArea = useMemo((): WorldAreaDefinition => {
    const halfSize = FULL_WORLD_SIZE / 2; // 50 tiles in each direction

    // Merge all area tiles into one combined tiles Map
    const allTiles = new Map<string, Tile>();
    for (const area of areas) {
      for (const [key, tile] of area.tiles) {
        allTiles.set(key, tile);
      }
    }

    // Count spawns
    let mobCount = 0;
    let npcCount = 0;
    let resourceCount = 0;
    for (const tile of allTiles.values()) {
      for (const spawn of tile.contents.spawns) {
        if (spawn.type === "mob") mobCount++;
        else if (spawn.type === "npc") npcCount++;
        else if (spawn.type === "resource") resourceCount++;
      }
    }

    return {
      id: "__full_world__",
      name: "Full World",
      description: "Complete 10km x 10km world view with procedural terrain",
      bounds: {
        minX: -halfSize,
        maxX: halfSize,
        minZ: -halfSize,
        maxZ: halfSize,
      },
      tiles: allTiles,
      spawnCounts: {
        mob: mobCount,
        npc: npcCount,
        resource: resourceCount,
      },
    };
  }, [areas]);

  // Active area - either current area or full world view
  const activeArea = showFullWorld ? fullWorldArea : currentArea;

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT"
      ) {
        return;
      }

      // Ctrl/Cmd + Z = Undo
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      }
      // Ctrl/Cmd + Shift + Z = Redo
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && e.shiftKey) {
        e.preventDefault();
        handleRedo();
      }
      // Ctrl/Cmd + S = Save
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
      // Tool shortcuts
      if (e.key === "v" || e.key === "V") {
        setTool("select");
        setPlacingItem(null);
      }
      if (e.key === "p" || e.key === "P") {
        setTool("place");
      }
      if (e.key === "e" || e.key === "E") {
        setTool("erase");
        setPlacingItem(null);
      }
      if (e.key === " ") {
        e.preventDefault();
        setTool("pan");
        setPlacingItem(null);
      }
      // G = Toggle grid
      if (e.key === "g" || e.key === "G") {
        setShowGrid((prev) => !prev);
      }
      // Escape = Deselect
      if (e.key === "Escape") {
        setSelectedTile(null);
        setSelectedSpawn(null);
        setSelectedTiles([]);
        setPlacingItem(null);
        setTool("select");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleUndo, handleRedo, handleSave]);

  // Check if dirty (has unsaved changes)
  const isDirty = useMemo(() => {
    // Simple check - compare serialized state
    const current = JSON.stringify(
      areas.map((a) => ({
        ...a,
        tiles: Object.fromEntries(a.tiles),
      })),
    );
    const original = JSON.stringify(originalAreas);
    return current !== original;
  }, [areas, originalAreas]);

  // SSR loading state
  if (!mounted) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Left sidebar - Spawn Palette
  const leftSidebar = (
    <SpawnPalette
      onSelectItem={handleSelectPaletteItem}
      selectedItem={placingItem}
    />
  );

  return (
    <StudioPageLayout
      title="World Editor"
      icon={MapIcon}
      sidebar={leftSidebar}
      headerContent={
        <div className="flex items-center gap-2">
          {/* Back to Studio */}
          <Link
            href="/"
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            Studio
          </Link>

          <div className="w-px h-6 bg-glass-border mx-2" />

          {/* Area Selector */}
          <div className="relative">
            <select
              value={currentArea?.id || ""}
              onChange={(e) => {
                const area = areas.find((a) => a.id === e.target.value);
                setCurrentArea(area || null);
                setSelectedTile(null);
                setSelectedSpawn(null);
                setSelectedTiles([]);
              }}
              className="h-8 pl-3 pr-8 text-xs bg-glass-bg border border-glass-border rounded-md focus:outline-none focus:ring-1 focus:ring-cyan-500/50 appearance-none min-w-[140px]"
            >
              {areas.length === 0 && <option value="">No areas</option>}
              {areas.map((area) => (
                <option key={area.id} value={area.id}>
                  {area.name}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none text-muted-foreground" />
          </div>

          <div className="w-px h-6 bg-glass-border mx-2" />

          {/* Tool Selector */}
          <div className="flex items-center bg-glass-bg rounded-lg p-0.5 border border-glass-border">
            {TOOLS.map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  onClick={() => handleToolChange(t.id)}
                  className={cn(
                    "p-1.5 rounded-md transition-colors",
                    tool === t.id
                      ? "bg-cyan-500/20 text-cyan-400"
                      : "hover:bg-white/5 text-muted-foreground hover:text-foreground",
                  )}
                  title={`${t.label} (${t.shortcut})`}
                >
                  <Icon className="w-4 h-4" />
                </button>
              );
            })}
          </div>

          {/* Placing item indicator */}
          {placingItem && (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-cyan-500/20 border border-cyan-500/30 text-cyan-400 text-xs">
              <Plus className="w-3 h-3" />
              {placingItem.name}
              <button
                onClick={() => {
                  setPlacingItem(null);
                  setTool("select");
                }}
                className="ml-1 hover:text-white"
              >
                ×
              </button>
            </div>
          )}

          <div className="w-px h-6 bg-glass-border mx-2" />

          {/* Live Server Connection */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleToggleLiveMode}
              className={cn(
                "flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-colors",
                connection.connected
                  ? "bg-green-500/20 text-green-400 border border-green-500/30"
                  : connection.connecting
                    ? "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30"
                    : "bg-glass-bg text-muted-foreground border border-glass-border hover:border-cyan-500/30",
              )}
              title={
                connection.connected
                  ? "Connected to live server - click to disconnect"
                  : "Click to connect to live game server"
              }
            >
              {connection.connected ? (
                <Wifi className="w-3 h-3" />
              ) : connection.connecting ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <WifiOff className="w-3 h-3" />
              )}
              {connection.connected
                ? "LIVE"
                : connection.connecting
                  ? "..."
                  : "Connect"}
            </button>

            <button
              onClick={handleRefresh}
              disabled={isLoading}
              className="p-1.5 rounded hover:bg-glass-bg disabled:opacity-50 disabled:cursor-not-allowed"
              title="Refresh from manifests"
            >
              <RefreshCw
                className={cn("w-3.5 h-3.5", isLoading && "animate-spin")}
              />
            </button>
          </div>

          <div className="w-px h-6 bg-glass-border mx-2" />

          {/* Undo/Redo */}
          <button
            onClick={handleUndo}
            disabled={historyIndex <= 0}
            className="p-2 rounded hover:bg-glass-bg disabled:opacity-50 disabled:cursor-not-allowed"
            title="Undo (Ctrl+Z)"
          >
            <Undo2 className="w-4 h-4" />
          </button>
          <button
            onClick={handleRedo}
            disabled={historyIndex >= history.length - 1}
            className="p-2 rounded hover:bg-glass-bg disabled:opacity-50 disabled:cursor-not-allowed"
            title="Redo (Ctrl+Shift+Z)"
          >
            <Redo2 className="w-4 h-4" />
          </button>

          <div className="w-px h-6 bg-glass-border mx-2" />

          {/* Full World toggle */}
          <button
            onClick={() => setShowFullWorld(!showFullWorld)}
            className={cn(
              "p-2 rounded transition-colors flex items-center gap-1",
              showFullWorld
                ? "bg-blue-500/20 text-blue-400"
                : "hover:bg-glass-bg",
            )}
            title={
              showFullWorld
                ? "Showing full world (100x100 tiles) - click to show area only"
                : "Click to show full world with procedural terrain"
            }
          >
            <Maximize2 className="w-4 h-4" />
            <span className="text-xs hidden sm:inline">
              {showFullWorld ? "World" : "Area"}
            </span>
          </button>

          {/* Grid toggle */}
          <button
            onClick={() => setShowGrid(!showGrid)}
            className={cn(
              "p-2 rounded transition-colors",
              showGrid ? "bg-cyan-500/20 text-cyan-400" : "hover:bg-glass-bg",
            )}
            title="Toggle grid (G)"
          >
            <Grid3X3 className="w-4 h-4" />
          </button>

          <div className="w-px h-6 bg-glass-border mx-2" />

          {/* Dirty indicator */}
          {isDirty && (
            <span className="text-xs text-amber-400 px-2">Unsaved changes</span>
          )}

          {/* Actions */}
          <SpectacularButton
            variant="outline"
            onClick={handleSave}
            disabled={isSaving || !isDirty}
            title="Save (Ctrl+S)"
          >
            {isSaving ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Save className="w-4 h-4 mr-2" />
            )}
            Save
          </SpectacularButton>

          <SpectacularButton variant="default" onClick={handleTestInGame}>
            <Play className="w-4 h-4 mr-2" />
            Test
          </SpectacularButton>
        </div>
      }
    >
      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <Loader2 className="w-8 h-8 animate-spin text-cyan-500 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">
              Loading world areas...
            </p>
          </div>
        </div>
      ) : (
        <div className="absolute inset-0 flex">
          <TileGridEditor
            area={activeArea}
            onAreaChange={handleAreaChange}
            selectedTile={selectedTile}
            onSelectTile={setSelectedTile}
            selectedSpawn={selectedSpawn}
            onSelectSpawn={setSelectedSpawn}
            selectedTiles={selectedTiles}
            onSelectTiles={setSelectedTiles}
            placingItem={placingItem}
            onPlacingItemUsed={() => {
              // Keep the tool but could clear if single-place mode
            }}
            tool={tool}
          />

          {/* Floating Tile Inspector Panel */}
          <div
            className={cn(
              "absolute top-4 right-4 w-72 max-h-[calc(100%-2rem)] bg-zinc-900/95 backdrop-blur-sm border border-zinc-700 rounded-lg shadow-xl transition-all duration-200 overflow-hidden",
              selectedTile
                ? "opacity-100 translate-x-0"
                : "opacity-0 translate-x-4 pointer-events-none",
            )}
          >
            {/* Panel Header with close button */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-700 bg-zinc-800/50">
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4 text-cyan-400" />
                <span className="text-sm font-medium">Tile Inspector</span>
              </div>
              <button
                onClick={() => {
                  setSelectedTile(null);
                  setSelectedSpawn(null);
                }}
                className="p-1 rounded hover:bg-zinc-700 transition-colors"
                title="Close panel"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Inspector Content */}
            <TileInspector
              area={currentArea}
              onAreaChange={handleAreaChange}
              selectedTile={selectedTile}
              selectedSpawn={selectedSpawn}
              onSelectSpawn={setSelectedSpawn}
              availableEntities={availableEntities}
              onPlaceEntity={handlePlaceEntity}
            />
          </div>
        </div>
      )}
    </StudioPageLayout>
  );
}
