"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Save,
  Loader2,
  ChevronLeft,
  Undo2,
  Redo2,
  MousePointer2,
  Plus,
  Trash2,
  Hand,
  Box,
  Download,
  Settings,
  Grid3X3,
  RotateCw,
  Move,
  Maximize2,
  RefreshCcw,
} from "lucide-react";
import { StudioPageLayout } from "@/components/layout/StudioPageLayout";
import { StructureViewport } from "@/components/structures/StructureViewport";
import {
  PiecePalette,
  type PaletteViewMode,
} from "@/components/structures/PiecePalette";
import { StructureInspector } from "@/components/structures/StructureInspector";
import { SpectacularButton } from "@/components/ui/spectacular-button";
import { useToast } from "@/components/ui/toast";
import { logger, cn } from "@/lib/utils";
import type {
  StructureDefinition,
  PlacedPiece,
  BuildingPiece,
  StructureEditorTool,
  TransformMode,
  GridSnapConfig,
} from "@/types/structures";
import { DEFAULT_GRID_CONFIG } from "@/types/structures";

const log = logger.child("Page:structures");

// =============================================================================
// TOOL CONFIGURATION
// =============================================================================

const TOOLS: Array<{
  id: StructureEditorTool;
  icon: typeof MousePointer2;
  label: string;
  shortcut: string;
}> = [
  { id: "select", icon: MousePointer2, label: "Select", shortcut: "V" },
  { id: "place", icon: Plus, label: "Place", shortcut: "P" },
  { id: "delete", icon: Trash2, label: "Delete", shortcut: "D" },
  { id: "pan", icon: Hand, label: "Pan", shortcut: "Space" },
];

const TRANSFORM_MODES: Array<{
  id: TransformMode;
  icon: typeof Move;
  label: string;
  shortcut: string;
}> = [
  { id: "translate", icon: Move, label: "Move", shortcut: "G" },
  { id: "rotate", icon: RotateCw, label: "Rotate", shortcut: "R" },
  { id: "scale", icon: Maximize2, label: "Scale", shortcut: "S" },
];

// =============================================================================
// PAGE COMPONENT
// =============================================================================

export default function StructureStudioPage() {
  const { toast } = useToast();
  const [mounted, setMounted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Structure state
  const [structure, setStructure] = useState<StructureDefinition | null>(null);
  const [_structures, _setStructures] = useState<StructureDefinition[]>([]);

  // Selection state
  const [selectedPieceId, setSelectedPieceId] = useState<string | null>(null);
  const [placingPiece, setPlacingPiece] = useState<BuildingPiece | null>(null);

  // Editor state
  const [tool, setTool] = useState<StructureEditorTool>("select");
  const [transformMode, setTransformMode] =
    useState<TransformMode>("translate");
  const [gridConfig, setGridConfig] =
    useState<GridSnapConfig>(DEFAULT_GRID_CONFIG);

  // History for undo/redo
  const [history, setHistory] = useState<StructureDefinition[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  // Shared piece library for palette and viewport
  const [pieceLibrary, setPieceLibrary] = useState<BuildingPiece[]>([]);
  const [isPiecesLoading, setIsPiecesLoading] = useState(false);

  // Track palette view mode for inspector context
  const [paletteViewMode, setPaletteViewMode] =
    useState<PaletteViewMode>("pieces");

  // Load piece library
  const loadPieceLibrary = useCallback(async () => {
    setIsPiecesLoading(true);
    try {
      const res = await fetch("/api/structures/pieces");
      if (res.ok) {
        const data = await res.json();
        setPieceLibrary(data.pieces || []);
        log.info("Loaded piece library", { count: data.pieces?.length || 0 });
      }
    } catch (error) {
      log.error("Failed to load piece library", { error });
    } finally {
      setIsPiecesLoading(false);
    }
  }, []);

  // Add a piece to the library (called after generation)
  const handlePieceAdded = useCallback((piece: BuildingPiece) => {
    setPieceLibrary((prev) => [...prev, piece]);
    log.info("Added piece to library", { id: piece.id, name: piece.name });
  }, []);

  useEffect(() => {
    setMounted(true);
    loadPieceLibrary();
  }, [loadPieceLibrary]);

  // Create new structure
  const createNewStructure = useCallback(() => {
    const newStructure: StructureDefinition = {
      id: `structure_${Date.now()}`,
      name: "New Structure",
      description: "",
      pieces: [],
      bounds: { width: 10, height: 5, depth: 10 },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      enterable: true,
    };
    setStructure(newStructure);
    setHistory([newStructure]);
    setHistoryIndex(0);
    setSelectedPieceId(null);
    log.info("Created new structure", { id: newStructure.id });
  }, []);

  // Update structure with history tracking
  const updateStructure = useCallback(
    (
      updater: (s: StructureDefinition) => StructureDefinition,
      addToHistory = true,
    ) => {
      if (!structure) return;

      const updated = updater({
        ...structure,
        updatedAt: new Date().toISOString(),
      });
      setStructure(updated);

      // Only add to history if requested (not during live dragging)
      if (addToHistory) {
        setHistory((prev) => {
          const newHistory = prev.slice(0, historyIndex + 1);
          newHistory.push(updated);
          return newHistory;
        });
        setHistoryIndex((prev) => prev + 1);
      }
    },
    [structure, historyIndex],
  );

  // Place a piece in the structure
  const placePiece = useCallback(
    (piece: BuildingPiece, position: { x: number; y: number; z: number }) => {
      if (!structure) return;

      const placedPiece: PlacedPiece = {
        id: `placed_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        pieceId: piece.id,
        transform: {
          position,
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
        },
      };

      updateStructure((s) => ({
        ...s,
        pieces: [...s.pieces, placedPiece],
      }));

      setSelectedPieceId(placedPiece.id);
      log.info("Placed piece", { pieceId: piece.id, position });
    },
    [structure, updateStructure],
  );

  // Remove a piece from the structure
  const removePiece = useCallback(
    (pieceInstanceId: string) => {
      updateStructure((s) => ({
        ...s,
        pieces: s.pieces.filter((p) => p.id !== pieceInstanceId),
      }));

      if (selectedPieceId === pieceInstanceId) {
        setSelectedPieceId(null);
      }
      log.info("Removed piece", { id: pieceInstanceId });
    },
    [updateStructure, selectedPieceId],
  );

  // Duplicate a placed piece
  const duplicatePiece = useCallback(
    (pieceInstanceId: string) => {
      if (!structure) return;

      const originalPiece = structure.pieces.find(
        (p) => p.id === pieceInstanceId,
      );
      if (!originalPiece) return;

      const newPiece: PlacedPiece = {
        id: `placed_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        pieceId: originalPiece.pieceId,
        transform: {
          position: {
            x: originalPiece.transform.position.x + 1, // Offset slightly
            y: originalPiece.transform.position.y,
            z: originalPiece.transform.position.z + 1,
          },
          rotation: { ...originalPiece.transform.rotation },
          scale: { ...originalPiece.transform.scale },
        },
      };

      updateStructure((s) => ({
        ...s,
        pieces: [...s.pieces, newPiece],
      }));

      setSelectedPieceId(newPiece.id);
      log.info("Duplicated piece", {
        original: pieceInstanceId,
        new: newPiece.id,
      });

      toast({
        title: "Piece Duplicated",
        description: "Use drag to position the new piece",
      });
    },
    [structure, updateStructure, toast],
  );

  // Update a placed piece's transform (live - no history during dragging)
  const updatePieceTransform = useCallback(
    (pieceInstanceId: string, transform: Partial<PlacedPiece["transform"]>) => {
      // Use addToHistory=false for live updates (slider dragging)
      updateStructure(
        (s) => ({
          ...s,
          pieces: s.pieces.map((p) =>
            p.id === pieceInstanceId
              ? { ...p, transform: { ...p.transform, ...transform } }
              : p,
          ),
        }),
        false,
      );
    },
    [updateStructure],
  );

  // Commit current state to history (call after transform changes complete)
  const commitToHistory = useCallback(() => {
    if (!structure) return;
    setHistory((prev) => {
      const newHistory = prev.slice(0, historyIndex + 1);
      newHistory.push(structure);
      return newHistory;
    });
    setHistoryIndex((prev) => prev + 1);
  }, [structure, historyIndex]);

  // Handle palette selection
  const handlePaletteSelect = useCallback((piece: BuildingPiece) => {
    setPlacingPiece(piece);
    setTool("place");
  }, []);

  // Handle tool change
  const handleToolChange = useCallback((newTool: StructureEditorTool) => {
    setTool(newTool);
    if (newTool !== "place") {
      setPlacingPiece(null);
    }
  }, []);

  // Undo/Redo
  const handleUndo = useCallback(() => {
    if (historyIndex > 0) {
      setHistoryIndex((prev) => prev - 1);
      setStructure(history[historyIndex - 1]);
    }
  }, [history, historyIndex]);

  const handleRedo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      setHistoryIndex((prev) => prev + 1);
      setStructure(history[historyIndex + 1]);
    }
  }, [history, historyIndex]);

  // Reset/Clear structure
  const handleReset = useCallback(() => {
    if (!structure) return;

    const clearedStructure: StructureDefinition = {
      ...structure,
      pieces: [],
      updatedAt: new Date().toISOString(),
      bakedModelUrl: undefined,
      bakedAt: undefined,
    };

    setStructure(clearedStructure);
    setHistory((prev) => [
      ...prev.slice(0, historyIndex + 1),
      clearedStructure,
    ]);
    setHistoryIndex((prev) => prev + 1);
    setSelectedPieceId(null);
    setPlacingPiece(null);

    toast({
      title: "Structure Cleared",
      description: "All pieces have been removed",
    });

    log.info("Reset structure", { id: structure.id });
  }, [structure, historyIndex, toast]);

  // Save structure
  const handleSave = useCallback(async () => {
    if (!structure) return;

    setIsSaving(true);
    try {
      const res = await fetch("/api/structures", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(structure),
      });

      if (!res.ok) {
        throw new Error("Failed to save structure");
      }

      toast({
        title: "Structure Saved",
        description: `Saved "${structure.name}" with ${structure.pieces.length} pieces`,
      });
    } catch (error) {
      log.error("Failed to save structure:", error);
      toast({
        variant: "destructive",
        title: "Save Failed",
        description: "Could not save structure",
      });
    } finally {
      setIsSaving(false);
    }
  }, [structure, toast]);

  // Bake structure
  const handleBake = useCallback(async () => {
    if (!structure || structure.pieces.length === 0) {
      toast({
        variant: "destructive",
        title: "Cannot Bake",
        description: "Add some pieces to the structure first",
      });
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch("/api/structures/bake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          structureId: structure.id,
          structure,
        }),
      });

      if (!res.ok) {
        throw new Error("Failed to bake structure");
      }

      const result = await res.json();

      updateStructure((s) => ({
        ...s,
        bakedModelUrl: result.modelUrl,
        bakedAt: new Date().toISOString(),
      }));

      toast({
        title: "Structure Baked",
        description: "Structure has been merged into a single model",
      });
    } catch (error) {
      log.error("Failed to bake structure:", error);
      toast({
        variant: "destructive",
        title: "Bake Failed",
        description: "Could not bake structure",
      });
    } finally {
      setIsLoading(false);
    }
  }, [structure, toast, updateStructure]);

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
        handleToolChange("select");
      }
      if (e.key === "p" || e.key === "P") {
        handleToolChange("place");
      }
      if (e.key === "d" || e.key === "D") {
        handleToolChange("delete");
      }
      if (e.key === " ") {
        e.preventDefault();
        handleToolChange("pan");
      }
      // Transform mode shortcuts
      if (e.key === "g" || e.key === "G") {
        setTransformMode("translate");
      }
      if (e.key === "r" && !e.ctrlKey && !e.metaKey) {
        setTransformMode("rotate");
      }
      if (e.key === "s" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setTransformMode("scale");
      }
      // Delete selected
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedPieceId) {
          removePiece(selectedPieceId);
        }
      }
      // Escape = Deselect
      if (e.key === "Escape") {
        setSelectedPieceId(null);
        setPlacingPiece(null);
        handleToolChange("select");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    handleUndo,
    handleRedo,
    handleSave,
    handleToolChange,
    selectedPieceId,
    removePiece,
  ]);

  // Load a baked structure for viewing/editing
  const handleSelectBakedStructure = useCallback(
    (bakedStructure: StructureDefinition) => {
      setStructure(bakedStructure);
      setHistory([bakedStructure]);
      setHistoryIndex(0);
      setSelectedPieceId(null);
      setPlacingPiece(null);
      handleToolChange("select");

      toast({
        title: "Building Loaded",
        description: `Loaded "${bakedStructure.name}" with ${bakedStructure.pieces.length} pieces`,
      });

      log.info("Loaded baked structure", {
        id: bakedStructure.id,
        name: bakedStructure.name,
        pieces: bakedStructure.pieces.length,
      });
    },
    [toast, handleToolChange],
  );

  // Handle creating a new building
  const handleCreateNewBuilding = useCallback(() => {
    createNewStructure();
    toast({
      title: "New Building Started",
      description: "Select pieces from below to start building",
    });
  }, [createNewStructure, toast]);

  // Handle creating a new town (placeholder for now)
  const handleCreateNewTown = useCallback(() => {
    toast({
      title: "Town Editor Coming Soon",
      description: "Town editing will be available in the next update",
    });
    log.info("Create new town requested");
  }, [toast]);

  // Create initial structure on mount
  useEffect(() => {
    if (mounted && !structure) {
      createNewStructure();
    }
  }, [mounted, structure, createNewStructure]);

  // SSR loading state
  if (!mounted) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Left sidebar - Piece Palette
  const leftSidebar = (
    <PiecePalette
      onSelectPiece={handlePaletteSelect}
      selectedPiece={placingPiece}
      pieces={pieceLibrary}
      onPieceGenerated={handlePieceAdded}
      isLoading={isPiecesLoading}
      onRefresh={loadPieceLibrary}
      onSelectBakedStructure={handleSelectBakedStructure}
      onCreateNewBuilding={handleCreateNewBuilding}
      onCreateNewTown={handleCreateNewTown}
      currentStructure={structure}
      onViewModeChange={setPaletteViewMode}
    />
  );

  return (
    <StudioPageLayout
      title="Structure Studio"
      icon={Box}
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

          {/* Structure name */}
          <span className="text-sm font-medium text-cyan-400">
            {structure?.name || "No Structure"}
          </span>

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

          <div className="w-px h-6 bg-glass-border mx-1" />

          {/* Transform Mode Selector */}
          <div className="flex items-center bg-glass-bg rounded-lg p-0.5 border border-glass-border">
            {TRANSFORM_MODES.map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  onClick={() => setTransformMode(t.id)}
                  className={cn(
                    "p-1.5 rounded-md transition-colors",
                    transformMode === t.id
                      ? "bg-purple-500/20 text-purple-400"
                      : "hover:bg-white/5 text-muted-foreground hover:text-foreground",
                  )}
                  title={`${t.label} (${t.shortcut})`}
                >
                  <Icon className="w-4 h-4" />
                </button>
              );
            })}
          </div>

          {/* Placing piece indicator */}
          {placingPiece && (
            <>
              <div className="w-px h-6 bg-glass-border mx-2" />
              <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-cyan-500/20 border border-cyan-500/30 text-cyan-400 text-xs">
                <Plus className="w-3 h-3" />
                {placingPiece.name}
                <button
                  onClick={() => {
                    setPlacingPiece(null);
                    handleToolChange("select");
                  }}
                  className="ml-1 hover:text-white"
                >
                  ×
                </button>
              </div>
            </>
          )}

          <div className="w-px h-6 bg-glass-border mx-2" />

          {/* Grid toggle */}
          <button
            onClick={() =>
              setGridConfig((c) => ({ ...c, showGrid: !c.showGrid }))
            }
            className={cn(
              "p-2 rounded transition-colors",
              gridConfig.showGrid
                ? "bg-cyan-500/20 text-cyan-400"
                : "hover:bg-glass-bg",
            )}
            title="Toggle grid"
          >
            <Grid3X3 className="w-4 h-4" />
          </button>

          {/* Snap toggle */}
          <button
            onClick={() =>
              setGridConfig((c) => ({ ...c, enabled: !c.enabled }))
            }
            className={cn(
              "p-2 rounded transition-colors",
              gridConfig.enabled
                ? "bg-cyan-500/20 text-cyan-400"
                : "hover:bg-glass-bg",
            )}
            title={`Snap: ${gridConfig.enabled ? "ON" : "OFF"}`}
          >
            <Settings className="w-4 h-4" />
          </button>

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
          <button
            onClick={handleReset}
            disabled={!structure || structure.pieces.length === 0}
            className="p-2 rounded hover:bg-glass-bg disabled:opacity-50 disabled:cursor-not-allowed text-orange-400 hover:text-orange-300"
            title="Clear All Pieces"
          >
            <RefreshCcw className="w-4 h-4" />
          </button>

          <div className="w-px h-6 bg-glass-border mx-2" />

          {/* Piece count */}
          <span className="text-xs text-muted-foreground">
            {structure?.pieces.length || 0} pieces
          </span>

          <div className="flex-1" />

          {/* Actions */}
          <SpectacularButton
            variant="outline"
            onClick={handleBake}
            disabled={isLoading || !structure || structure.pieces.length === 0}
            title="Bake structure into single model"
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Download className="w-4 h-4 mr-2" />
            )}
            Bake
          </SpectacularButton>

          <SpectacularButton
            variant="outline"
            onClick={handleSave}
            disabled={isSaving || !structure}
            title="Save (Ctrl+S)"
          >
            {isSaving ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Save className="w-4 h-4 mr-2" />
            )}
            Save
          </SpectacularButton>

          <SpectacularButton variant="default" onClick={createNewStructure}>
            <Plus className="w-4 h-4 mr-2" />
            New
          </SpectacularButton>
        </div>
      }
    >
      <div className="absolute inset-0 flex">
        {/* Main 3D Viewport */}
        <div className="flex-1 relative">
          <StructureViewport
            structure={structure}
            selectedPieceId={selectedPieceId}
            onSelectPiece={setSelectedPieceId}
            placingPiece={placingPiece}
            onPlacePiece={placePiece}
            onPlacingComplete={() => setPlacingPiece(null)}
            tool={tool}
            transformMode={transformMode}
            gridConfig={gridConfig}
            onTransformPiece={updatePieceTransform}
            pieceLibrary={pieceLibrary}
            onDuplicatePiece={duplicatePiece}
            onDeletePiece={removePiece}
          />
        </div>

        {/* Right Panel - Structure Inspector */}
        <div className="w-72 border-l border-glass-border bg-glass-bg/20 flex flex-col flex-shrink-0">
          <StructureInspector
            mode={paletteViewMode}
            structure={structure}
            selectedPieceId={selectedPieceId}
            onSelectPiece={setSelectedPieceId}
            onUpdateStructure={(updates) => {
              if (structure) {
                updateStructure((s) => ({ ...s, ...updates }));
              }
            }}
            onRemovePiece={removePiece}
            onDuplicatePiece={duplicatePiece}
            onUpdatePieceTransform={updatePieceTransform}
            onCommitTransform={commitToHistory}
          />
        </div>
      </div>
    </StudioPageLayout>
  );
}
