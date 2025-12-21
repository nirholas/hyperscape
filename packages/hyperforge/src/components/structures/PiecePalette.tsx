"use client";

/**
 * PiecePalette - Building piece selection panel
 *
 * Features:
 * - Categorized tabs (Walls, Doors, Windows, Roof, Floor, Baked)
 * - Loads pieces from API (Meshy-generated only)
 * - Thumbnail grid of available pieces
 * - Click to select for placement
 * - Generate new pieces via Meshy
 * - Shows completed/baked structures
 */

import { useState, useMemo, useEffect, useCallback } from "react";
import {
  Square,
  DoorOpen,
  AppWindow,
  Home,
  Layers,
  Plus,
  Search,
  Loader2,
  RefreshCw,
  Sparkles,
  Building2,
  Package,
  ArrowRight,
  Hammer,
  MapPin,
  Trash2,
  X,
} from "lucide-react";
import { cn, logger } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import type {
  BuildingPiece,
  BuildingPieceType,
  StructureDefinition,
  TownDefinition,
} from "@/types/structures";
import { PIECE_TYPE_CONFIG } from "@/types/structures";
import { PieceGenerationModal } from "./PieceGenerationModal";
import { FullBuildingGenerationModal } from "./FullBuildingGenerationModal";

const log = logger.child("PiecePalette");

// =============================================================================
// TYPES
// =============================================================================

/** View modes for the palette */
export type PaletteViewMode = "pieces" | "buildings" | "towns";

interface PiecePaletteProps {
  onSelectPiece: (piece: BuildingPiece) => void;
  selectedPiece: BuildingPiece | null;
  /** Shared piece library (if provided, palette will use this instead of loading its own) */
  pieces?: BuildingPiece[];
  /** Callback when a new piece is generated */
  onPieceGenerated?: (piece: BuildingPiece) => void;
  /** Loading state for pieces */
  isLoading?: boolean;
  /** Refresh the piece library */
  onRefresh?: () => void;
  /** Callback when a baked structure is selected for viewing */
  onSelectBakedStructure?: (structure: StructureDefinition) => void;
  /** Callback when a town is selected for viewing */
  onSelectTown?: (town: TownDefinition) => void;
  /** Callback when a building is selected to place in town */
  onSelectBuildingForTown?: (structure: StructureDefinition) => void;
  /** Callback to create a new building from pieces */
  onCreateNewBuilding?: () => void;
  /** Callback to create a new town from buildings */
  onCreateNewTown?: () => void;
  /** Current structure being edited (to show workflow state) */
  currentStructure?: StructureDefinition | null;
  /** Callback when view mode changes */
  onViewModeChange?: (mode: PaletteViewMode) => void;
}

// =============================================================================
// TAB ICONS
// =============================================================================

const TAB_ICONS: Record<BuildingPieceType, typeof Square> = {
  wall: Square,
  door: DoorOpen,
  window: AppWindow,
  roof: Home,
  floor: Layers,
};

// =============================================================================
// PIECE CARD COMPONENT
// =============================================================================

interface PieceCardProps {
  piece: BuildingPiece;
  isSelected: boolean;
  onClick: () => void;
  onDelete?: () => void;
}

function PieceCard({ piece, isSelected, onClick, onDelete }: PieceCardProps) {
  // Color based on piece type
  const colors: Record<BuildingPieceType, string> = {
    wall: "bg-amber-900/50 border-amber-700/50",
    door: "bg-amber-800/50 border-amber-600/50",
    window: "bg-sky-900/50 border-sky-700/50",
    roof: "bg-orange-900/50 border-orange-700/50",
    floor: "bg-stone-800/50 border-stone-600/50",
  };

  const Icon = TAB_ICONS[piece.type];

  return (
    <div className="relative group">
      <button
        onClick={onClick}
        className={cn(
          "w-full aspect-square rounded-lg border-2 p-2 transition-all",
          "hover:scale-105 hover:shadow-lg",
          "flex flex-col items-center justify-center gap-1",
          colors[piece.type],
          isSelected && "ring-2 ring-cyan-500 border-cyan-500",
        )}
      >
        {/* Thumbnail or fallback icon */}
        <div className="w-10 h-10 rounded bg-white/10 flex items-center justify-center overflow-hidden">
          {piece.thumbnailUrl ? (
            <img
              src={piece.thumbnailUrl}
              alt={piece.name}
              className="w-full h-full object-cover"
            />
          ) : (
            <Icon className="w-6 h-6 text-white/60" />
          )}
        </div>
        <span className="text-xs text-white/80 truncate w-full text-center">
          {piece.name}
        </span>
      </button>
      {/* Delete button */}
      {onDelete && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500/90 text-white opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center hover:bg-red-400"
          title="Delete piece"
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

// =============================================================================
// EMPTY STATE COMPONENT
// =============================================================================

interface EmptyStateProps {
  type: BuildingPieceType;
  onGenerate: () => void;
}

function EmptyState({ type, onGenerate }: EmptyStateProps) {
  const config = PIECE_TYPE_CONFIG[type];
  const Icon = TAB_ICONS[type];

  return (
    <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
      <div className="w-16 h-16 rounded-full bg-glass-bg flex items-center justify-center mb-4">
        <Icon className="w-8 h-8 text-muted-foreground" />
      </div>
      <h4 className="text-sm font-medium text-white/80 mb-1">
        No {config.label} Yet
      </h4>
      <p className="text-xs text-muted-foreground mb-4">
        Generate your first {config.label.toLowerCase().slice(0, -1)} using
        Meshy AI
      </p>
      <button
        onClick={onGenerate}
        className={cn(
          "flex items-center gap-2 px-4 py-2 rounded-lg text-sm",
          "bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-medium",
          "hover:from-cyan-400 hover:to-blue-500 transition-all",
        )}
      >
        <Sparkles className="w-4 h-4" />
        Generate {config.label.slice(0, -1)}
      </button>
    </div>
  );
}

// =============================================================================
// BAKED STRUCTURE CARD
// =============================================================================

interface BakedStructureCardProps {
  structure: StructureDefinition;
  onClick: () => void;
  onDelete?: () => void;
}

function BakedStructureCard({
  structure,
  onClick,
  onDelete,
}: BakedStructureCardProps) {
  return (
    <div className="relative group">
      <button
        onClick={onClick}
        className={cn(
          "w-full flex items-start gap-3 p-3 rounded-lg border-2 transition-all text-left",
          "bg-purple-900/20 border-purple-700/30",
          "hover:scale-[1.02] hover:shadow-lg hover:border-purple-500/50",
        )}
      >
        {/* Thumbnail */}
        <div className="w-16 h-16 rounded-lg bg-purple-900/30 flex items-center justify-center flex-shrink-0 overflow-hidden">
          {structure.thumbnailUrl ? (
            <img
              src={structure.thumbnailUrl}
              alt={structure.name}
              className="w-full h-full object-cover"
            />
          ) : (
            <Building2 className="w-8 h-8 text-purple-400/60" />
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-medium text-white/90 truncate">
            {structure.name}
          </h4>
          <p className="text-[11px] text-muted-foreground line-clamp-2 mb-1">
            {structure.description || "No description"}
          </p>
          <div className="flex items-center gap-2 text-[10px] text-purple-400">
            <span>
              {structure.pieces.length > 0
                ? `${structure.pieces.length} pieces`
                : "Full building"}
            </span>
            <span>�</span>
            <span>{structure.enterable ? "Enterable" : "Solid"}</span>
            {structure.bakedAt && (
              <>
                <span>�</span>
                <span>{new Date(structure.bakedAt).toLocaleDateString()}</span>
              </>
            )}
          </div>
        </div>
      </button>
      {/* Delete button */}
      {onDelete && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="absolute top-2 right-2 w-6 h-6 rounded-full bg-red-500/90 text-white opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center hover:bg-red-400"
          title="Delete building"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

// =============================================================================
// TOWN CARD
// =============================================================================

interface TownCardProps {
  town: TownDefinition;
  onClick: () => void;
  onDelete?: () => void;
}

function TownCard({ town, onClick, onDelete }: TownCardProps) {
  return (
    <div className="relative group">
      <button
        onClick={onClick}
        className={cn(
          "w-full flex items-start gap-3 p-3 rounded-lg border-2 transition-all text-left",
          "bg-amber-900/20 border-amber-700/30",
          "hover:scale-[1.02] hover:shadow-lg hover:border-amber-500/50",
        )}
      >
        {/* Thumbnail */}
        <div className="w-16 h-16 rounded-lg bg-amber-900/30 flex items-center justify-center flex-shrink-0 overflow-hidden">
          {town.thumbnailUrl ? (
            <img
              src={town.thumbnailUrl}
              alt={town.name}
              className="w-full h-full object-cover"
            />
          ) : (
            <Home className="w-8 h-8 text-amber-400/60" />
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-medium text-white/90 truncate">
            {town.name}
          </h4>
          <p className="text-[11px] text-muted-foreground line-clamp-2 mb-1">
            {town.description || "No description"}
          </p>
          <div className="flex items-center gap-2 text-[10px] text-amber-400">
            <span>{town.buildings.length} buildings</span>
            <span>�</span>
            <span>
              {town.bounds.width}x{town.bounds.depth}m
            </span>
            {town.updatedAt && (
              <>
                <span>�</span>
                <span>{new Date(town.updatedAt).toLocaleDateString()}</span>
              </>
            )}
          </div>
        </div>
      </button>
      {/* Delete button */}
      {onDelete && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="absolute top-2 right-2 w-6 h-6 rounded-full bg-red-500/90 text-white opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center hover:bg-red-400"
          title="Delete town"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function PiecePalette({
  onSelectPiece,
  selectedPiece,
  pieces: externalPieces,
  onPieceGenerated,
  isLoading: externalLoading,
  onRefresh,
  onSelectBakedStructure,
  onSelectTown,
  onSelectBuildingForTown,
  onCreateNewBuilding,
  onCreateNewTown,
  currentStructure,
  onViewModeChange,
}: PiecePaletteProps) {
  const { toast } = useToast();
  const [viewMode, setViewModeInternal] = useState<PaletteViewMode>("pieces");
  const [activeTab, setActiveTab] = useState<BuildingPieceType>("wall");
  const [searchQuery, setSearchQuery] = useState("");
  const [internalLoading, setInternalLoading] = useState(true);
  const [internalPieces, setInternalPieces] = useState<BuildingPiece[]>([]);
  const [isGenerateModalOpen, setIsGenerateModalOpen] = useState(false);
  const [isFullBuildingModalOpen, setIsFullBuildingModalOpen] = useState(false);

  // Baked structures state
  const [bakedStructures, setBakedStructures] = useState<StructureDefinition[]>(
    [],
  );
  const [bakedLoading, setBakedLoading] = useState(false);

  // Towns state
  const [towns, setTowns] = useState<TownDefinition[]>([]);
  const [townsLoading, setTownsLoading] = useState(false);

  // Handle view mode change with callback
  const setViewMode = useCallback(
    (mode: PaletteViewMode) => {
      setViewModeInternal(mode);
      onViewModeChange?.(mode);
    },
    [onViewModeChange],
  );

  // Get all piece types
  const pieceTypes: BuildingPieceType[] = [
    "wall",
    "door",
    "window",
    "roof",
    "floor",
  ];

  // Use external pieces if provided, otherwise load internally
  const pieces = externalPieces ?? internalPieces;
  const isLoading = externalLoading ?? internalLoading;

  // Load pieces from API (only if not using external pieces)
  const loadPieces = useCallback(async () => {
    if (externalPieces !== undefined) return; // Skip if using external pieces

    setInternalLoading(true);
    try {
      const res = await fetch("/api/structures/pieces");
      if (res.ok) {
        const data = await res.json();
        setInternalPieces(data.pieces || []);
        log.info("Loaded pieces", { count: data.pieces?.length || 0 });
      } else {
        log.warn("Failed to load pieces", { status: res.status });
      }
    } catch (error) {
      log.error("Error loading pieces", { error });
    } finally {
      setInternalLoading(false);
    }
  }, [externalPieces]);

  // Load pieces on mount (only if not using external pieces)
  useEffect(() => {
    if (externalPieces === undefined) {
      loadPieces();
    }
  }, [loadPieces, externalPieces]);

  // Load baked structures
  const loadBakedStructures = useCallback(async () => {
    setBakedLoading(true);
    try {
      const res = await fetch("/api/structures");
      if (res.ok) {
        const data = await res.json();
        // Filter to only baked structures
        const baked = (data.structures || []).filter(
          (s: StructureDefinition) => s.bakedModelUrl,
        );
        setBakedStructures(baked);
        log.info("Loaded baked structures", { count: baked.length });
      }
    } catch (error) {
      log.error("Error loading baked structures", { error });
    } finally {
      setBakedLoading(false);
    }
  }, []);

  // Load baked structures when switching to buildings view
  useEffect(() => {
    if (viewMode === "buildings") {
      loadBakedStructures();
    }
  }, [viewMode, loadBakedStructures]);

  // Load towns
  const loadTowns = useCallback(async () => {
    setTownsLoading(true);
    try {
      const res = await fetch("/api/structures/towns");
      if (res.ok) {
        const data = await res.json();
        setTowns(data.towns || []);
        log.info("Loaded towns", { count: data.towns?.length || 0 });
      }
    } catch (error) {
      log.error("Error loading towns", { error });
    } finally {
      setTownsLoading(false);
    }
  }, []);

  // Load towns when switching to towns view
  useEffect(() => {
    if (viewMode === "towns") {
      loadTowns();
      // Also load baked structures for placing in towns
      loadBakedStructures();
    }
  }, [viewMode, loadTowns, loadBakedStructures]);

  // Filter pieces by tab and search
  const filteredPieces = useMemo(() => {
    return pieces.filter((piece) => {
      if (piece.type !== activeTab) return false;
      if (searchQuery) {
        return piece.name.toLowerCase().includes(searchQuery.toLowerCase());
      }
      return true;
    });
  }, [pieces, activeTab, searchQuery]);

  // Count pieces per type
  const pieceCounts = useMemo(() => {
    const counts: Record<BuildingPieceType, number> = {
      wall: 0,
      door: 0,
      window: 0,
      roof: 0,
      floor: 0,
    };
    for (const piece of pieces) {
      if (counts[piece.type] !== undefined) {
        counts[piece.type]++;
      }
    }
    return counts;
  }, [pieces]);

  // Handle generate new piece - opens generation modal
  const handleGenerateNew = useCallback(() => {
    setIsGenerateModalOpen(true);
  }, []);

  // Handle piece generated from modal
  const handlePieceGenerated = useCallback(
    (piece: BuildingPiece) => {
      // If using external pieces, notify the parent
      if (onPieceGenerated) {
        onPieceGenerated(piece);
      } else {
        // Otherwise update internal state
        setInternalPieces((prev) => [...prev, piece]);
      }
      toast({
        title: "Piece Generated",
        description: `${piece.name} has been added to your library`,
      });
    },
    [toast, onPieceGenerated],
  );

  // Handle full building generated
  const handleFullBuildingGenerated = useCallback(
    (building: StructureDefinition) => {
      // Add to baked structures list
      setBakedStructures((prev) => [...prev, building]);
      toast({
        title: "Building Generated",
        description: `"${building.name}" is ready for town placement`,
      });
    },
    [toast],
  );

  // Handle delete piece
  const handleDeletePiece = useCallback(
    async (pieceId: string) => {
      try {
        const res = await fetch(
          `/api/structures/pieces?id=${encodeURIComponent(pieceId)}`,
          {
            method: "DELETE",
          },
        );
        if (res.ok) {
          // Update local state
          if (onPieceGenerated) {
            // If using external pieces, trigger a refresh
            onRefresh?.();
          } else {
            setInternalPieces((prev) => prev.filter((p) => p.id !== pieceId));
          }
          toast({
            title: "Piece Deleted",
            description: "The piece has been removed from your library",
          });
        } else {
          throw new Error("Failed to delete piece");
        }
      } catch (error) {
        log.error("Failed to delete piece", { error, pieceId });
        toast({
          title: "Delete Failed",
          description: "Could not delete the piece",
          variant: "destructive",
        });
      }
    },
    [toast, onPieceGenerated, onRefresh],
  );

  // Handle delete building
  const handleDeleteBuilding = useCallback(
    async (buildingId: string) => {
      try {
        const res = await fetch(
          `/api/structures?id=${encodeURIComponent(buildingId)}`,
          {
            method: "DELETE",
          },
        );
        if (res.ok) {
          setBakedStructures((prev) => prev.filter((s) => s.id !== buildingId));
          toast({
            title: "Building Deleted",
            description: "The building has been removed",
          });
        } else {
          throw new Error("Failed to delete building");
        }
      } catch (error) {
        log.error("Failed to delete building", { error, buildingId });
        toast({
          title: "Delete Failed",
          description: "Could not delete the building",
          variant: "destructive",
        });
      }
    },
    [toast],
  );

  // Handle delete town
  const handleDeleteTown = useCallback(
    async (townId: string) => {
      try {
        const res = await fetch(`/api/structures/towns?id=${townId}`, {
          method: "DELETE",
        });
        if (res.ok) {
          setTowns((prev) => prev.filter((t) => t.id !== townId));
          toast({
            title: "Town Deleted",
            description: "The town has been removed",
          });
        } else {
          throw new Error("Failed to delete town");
        }
      } catch (error) {
        log.error("Failed to delete town", { error, townId });
        toast({
          title: "Delete Failed",
          description: "Could not delete the town",
          variant: "destructive",
        });
      }
    },
    [toast],
  );

  // Filter baked structures by search
  const filteredBakedStructures = useMemo(() => {
    if (!searchQuery) return bakedStructures;
    return bakedStructures.filter((s) =>
      s.name.toLowerCase().includes(searchQuery.toLowerCase()),
    );
  }, [bakedStructures, searchQuery]);

  // Filter towns by search
  const filteredTowns = useMemo(() => {
    if (!searchQuery) return towns;
    return towns.filter((t) =>
      t.name.toLowerCase().includes(searchQuery.toLowerCase()),
    );
  }, [towns, searchQuery]);

  return (
    <div className="h-full flex flex-col bg-glass-bg/20">
      {/* Header */}
      <div className="p-3 border-b border-glass-border">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-white/90">
            {viewMode === "pieces"
              ? "Building Pieces"
              : viewMode === "buildings"
                ? "Completed Buildings"
                : "Town Layouts"}
          </h3>
          <button
            onClick={
              viewMode === "pieces"
                ? (onRefresh ?? loadPieces)
                : viewMode === "buildings"
                  ? loadBakedStructures
                  : loadTowns
            }
            disabled={
              viewMode === "pieces"
                ? isLoading
                : viewMode === "buildings"
                  ? bakedLoading
                  : townsLoading
            }
            className="p-1 rounded hover:bg-white/10 transition-colors"
            title="Refresh"
          >
            <RefreshCw
              className={cn(
                "w-3.5 h-3.5 text-muted-foreground",
                (viewMode === "pieces"
                  ? isLoading
                  : viewMode === "buildings"
                    ? bakedLoading
                    : townsLoading) && "animate-spin",
              )}
            />
          </button>
        </div>

        {/* View Mode Toggle */}
        <div className="flex gap-1 mb-2">
          <button
            onClick={() => setViewMode("pieces")}
            className={cn(
              "flex-1 flex items-center justify-center gap-1 px-1.5 py-1.5 rounded-md text-[11px] transition-colors",
              viewMode === "pieces"
                ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"
                : "bg-glass-bg border border-glass-border hover:bg-white/5",
            )}
          >
            <Package className="w-3 h-3" />
            Pieces
          </button>
          <button
            onClick={() => setViewMode("buildings")}
            className={cn(
              "flex-1 flex items-center justify-center gap-1 px-1.5 py-1.5 rounded-md text-[11px] transition-colors",
              viewMode === "buildings"
                ? "bg-purple-500/20 text-purple-400 border border-purple-500/30"
                : "bg-glass-bg border border-glass-border hover:bg-white/5",
            )}
          >
            <Building2 className="w-3 h-3" />
            Buildings
            {bakedStructures.length > 0 && (
              <span className="ml-0.5 px-1 py-0.5 rounded-full bg-purple-500/30 text-[9px]">
                {bakedStructures.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setViewMode("towns")}
            className={cn(
              "flex-1 flex items-center justify-center gap-1 px-1.5 py-1.5 rounded-md text-[11px] transition-colors",
              viewMode === "towns"
                ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                : "bg-glass-bg border border-glass-border hover:bg-white/5",
            )}
          >
            <Home className="w-3 h-3" />
            Towns
            {towns.length > 0 && (
              <span className="ml-0.5 px-1 py-0.5 rounded-full bg-amber-500/30 text-[9px]">
                {towns.length}
              </span>
            )}
          </button>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder={
              viewMode === "pieces"
                ? "Search pieces..."
                : viewMode === "buildings"
                  ? "Search buildings..."
                  : "Search towns..."
            }
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 bg-glass-bg border border-glass-border rounded-md text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
          />
        </div>

        {/* Workflow Indicator */}
        <div className="mt-2 flex items-center gap-1 text-[10px] text-muted-foreground">
          <span
            className={cn(viewMode === "pieces" && "text-cyan-400 font-medium")}
          >
            Pieces
          </span>
          <ArrowRight className="w-3 h-3" />
          <span
            className={cn(
              viewMode === "buildings" && "text-purple-400 font-medium",
            )}
          >
            Buildings
          </span>
          <ArrowRight className="w-3 h-3" />
          <span
            className={cn(viewMode === "towns" && "text-amber-400 font-medium")}
          >
            Towns
          </span>
        </div>
      </div>

      {/* Piece Type Tabs - Only show in pieces mode */}
      {viewMode === "pieces" && (
        <div className="flex border-b border-glass-border">
          {pieceTypes.map((type) => {
            const Icon = TAB_ICONS[type];
            const config = PIECE_TYPE_CONFIG[type];
            const count = pieceCounts[type];

            return (
              <button
                key={type}
                onClick={() => setActiveTab(type)}
                className={cn(
                  "flex-1 py-2 px-1 text-xs font-medium transition-colors flex flex-col items-center gap-0.5",
                  activeTab === type
                    ? "text-cyan-400 border-b-2 border-cyan-400 bg-cyan-500/10"
                    : "text-muted-foreground hover:text-white/80 hover:bg-white/5",
                )}
                title={config.label}
              >
                <Icon className="w-4 h-4" />
                <span className="text-[10px]">{count}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto p-2">
        {viewMode === "pieces" ? (
          // Pieces View
          <>
            {/* New Building Action Card */}
            <button
              onClick={onCreateNewBuilding}
              className={cn(
                "w-full flex items-center gap-3 p-3 rounded-lg border-2 border-dashed transition-all mb-3",
                "bg-cyan-500/5 border-cyan-500/30 hover:bg-cyan-500/10 hover:border-cyan-500/50",
                currentStructure && "border-cyan-500/50 bg-cyan-500/10",
              )}
            >
              <div className="w-10 h-10 rounded-lg bg-cyan-500/20 flex items-center justify-center">
                <Hammer className="w-5 h-5 text-cyan-400" />
              </div>
              <div className="flex-1 text-left">
                <div className="text-sm font-medium text-white/90">
                  {currentStructure ? currentStructure.name : "New Building"}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {currentStructure
                    ? `${currentStructure.pieces.length} pieces placed`
                    : "Select pieces below to build"}
                </div>
              </div>
              {!currentStructure && <Plus className="w-4 h-4 text-cyan-400" />}
            </button>

            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
              </div>
            ) : filteredPieces.length === 0 ? (
              <EmptyState type={activeTab} onGenerate={handleGenerateNew} />
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {filteredPieces.map((piece) => (
                  <PieceCard
                    key={piece.id}
                    piece={piece}
                    isSelected={selectedPiece?.id === piece.id}
                    onClick={() => onSelectPiece(piece)}
                    onDelete={() => handleDeletePiece(piece.id)}
                  />
                ))}
              </div>
            )}
          </>
        ) : viewMode === "buildings" ? (
          // Buildings View
          <>
            {/* Action Buttons */}
            <div className="grid grid-cols-2 gap-2 mb-3">
              {/* Generate Full Building */}
              <button
                onClick={() => setIsFullBuildingModalOpen(true)}
                className={cn(
                  "flex flex-col items-center gap-2 p-3 rounded-lg border-2 border-dashed transition-all",
                  "bg-purple-500/5 border-purple-500/30 hover:bg-purple-500/10 hover:border-purple-500/50",
                )}
              >
                <div className="w-8 h-8 rounded-lg bg-purple-500/20 flex items-center justify-center">
                  <Sparkles className="w-4 h-4 text-purple-400" />
                </div>
                <div className="text-center">
                  <div className="text-xs font-medium text-white/90">
                    Generate Building
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    AI full building
                  </div>
                </div>
              </button>

              {/* Create New Town */}
              <button
                onClick={onCreateNewTown}
                className={cn(
                  "flex flex-col items-center gap-2 p-3 rounded-lg border-2 border-dashed transition-all",
                  "bg-amber-500/5 border-amber-500/30 hover:bg-amber-500/10 hover:border-amber-500/50",
                )}
              >
                <div className="w-8 h-8 rounded-lg bg-amber-500/20 flex items-center justify-center">
                  <MapPin className="w-4 h-4 text-amber-400" />
                </div>
                <div className="text-center">
                  <div className="text-xs font-medium text-white/90">
                    Create Town
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    From buildings
                  </div>
                </div>
              </button>
            </div>

            {/* Completed Buildings List */}
            <div className="space-y-2">
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Completed Buildings ({bakedStructures.length})
              </h4>

              {bakedLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-6 h-6 animate-spin text-purple-400" />
                </div>
              ) : filteredBakedStructures.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-6 px-4 text-center">
                  <div className="w-12 h-12 rounded-full bg-glass-bg flex items-center justify-center mb-3">
                    <Building2 className="w-6 h-6 text-muted-foreground" />
                  </div>
                  <h4 className="text-sm font-medium text-white/80 mb-1">
                    No Completed Buildings
                  </h4>
                  <p className="text-xs text-muted-foreground mb-3">
                    Switch to Pieces, build a structure, then Bake it.
                  </p>
                  <button
                    onClick={() => setViewMode("pieces")}
                    className="text-xs text-cyan-400 hover:underline flex items-center gap-1"
                  >
                    Go to Pieces <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-2">
                  {filteredBakedStructures.map((structure) => (
                    <BakedStructureCard
                      key={structure.id}
                      structure={structure}
                      onClick={() => onSelectBakedStructure?.(structure)}
                      onDelete={() => handleDeleteBuilding(structure.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          </>
        ) : (
          // Towns View
          <>
            {/* Create New Town Button */}
            <button
              onClick={onCreateNewTown}
              className={cn(
                "w-full flex items-center gap-3 p-3 rounded-lg border-2 border-dashed transition-all mb-3",
                "bg-amber-500/5 border-amber-500/30 hover:bg-amber-500/10 hover:border-amber-500/50",
              )}
            >
              <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center">
                <MapPin className="w-5 h-5 text-amber-400" />
              </div>
              <div className="flex-1 text-left">
                <div className="text-sm font-medium text-white/90">
                  Create New Town
                </div>
                <div className="text-[11px] text-muted-foreground">
                  Arrange buildings into a town layout
                </div>
              </div>
              <Plus className="w-4 h-4 text-amber-400" />
            </button>

            {townsLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-amber-400" />
              </div>
            ) : (
              <div className="space-y-4">
                {/* Existing Towns */}
                {filteredTowns.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Your Towns ({filteredTowns.length})
                    </h4>
                    {filteredTowns.map((town) => (
                      <TownCard
                        key={town.id}
                        town={town}
                        onClick={() => onSelectTown?.(town)}
                        onDelete={() => handleDeleteTown(town.id)}
                      />
                    ))}
                  </div>
                )}

                {/* Available Buildings to Place */}
                {bakedStructures.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Available Buildings ({bakedStructures.length})
                    </h4>
                    <p className="text-[11px] text-muted-foreground">
                      Click a building to place it in your town
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      {bakedStructures.map((structure) => (
                        <button
                          key={structure.id}
                          onClick={() => onSelectBuildingForTown?.(structure)}
                          className="flex flex-col items-center p-2 rounded-lg bg-glass-bg border border-glass-border hover:border-amber-500/50 hover:bg-amber-500/10 transition-all"
                        >
                          <div className="w-12 h-12 rounded bg-amber-900/30 flex items-center justify-center mb-1">
                            {structure.thumbnailUrl ? (
                              <img
                                src={structure.thumbnailUrl}
                                alt={structure.name}
                                className="w-full h-full object-cover rounded"
                              />
                            ) : (
                              <Building2 className="w-6 h-6 text-amber-400/60" />
                            )}
                          </div>
                          <span className="text-[10px] text-center truncate w-full">
                            {structure.name}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Empty state - no buildings available */}
                {filteredTowns.length === 0 && bakedStructures.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-6 px-4 text-center">
                    <div className="w-12 h-12 rounded-full bg-glass-bg flex items-center justify-center mb-3">
                      <Home className="w-6 h-6 text-muted-foreground" />
                    </div>
                    <h4 className="text-sm font-medium text-white/80 mb-1">
                      No Buildings Available
                    </h4>
                    <p className="text-xs text-muted-foreground mb-3">
                      Create and bake buildings first to add them to towns.
                    </p>
                    <button
                      onClick={() => setViewMode("pieces")}
                      className="text-xs text-cyan-400 hover:underline flex items-center gap-1"
                    >
                      Start with Pieces <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Generate New Button - Only show in pieces mode with pieces */}
      {viewMode === "pieces" && pieces.length > 0 && (
        <div className="p-3 border-t border-glass-border">
          <button
            onClick={handleGenerateNew}
            className={cn(
              "w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg",
              "bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-medium text-sm",
              "hover:from-cyan-400 hover:to-blue-500 transition-all",
            )}
          >
            <Plus className="w-4 h-4" />
            Generate {PIECE_TYPE_CONFIG[activeTab].label.slice(0, -1)}
          </button>
        </div>
      )}

      {/* Total count */}
      <div className="px-3 py-2 border-t border-glass-border text-xs text-muted-foreground text-center">
        {viewMode === "pieces" ? (
          <>
            {pieces.length} piece{pieces.length !== 1 ? "s" : ""} in library
          </>
        ) : viewMode === "buildings" ? (
          <>
            {bakedStructures.length} completed building
            {bakedStructures.length !== 1 ? "s" : ""}
          </>
        ) : (
          <>
            {towns.length} town{towns.length !== 1 ? "s" : ""} �{" "}
            {bakedStructures.length} building
            {bakedStructures.length !== 1 ? "s" : ""}
          </>
        )}
      </div>

      {/* Piece Generation Modal */}
      <PieceGenerationModal
        isOpen={isGenerateModalOpen}
        onClose={() => setIsGenerateModalOpen(false)}
        onGenerated={handlePieceGenerated}
        initialType={activeTab}
      />

      {/* Full Building Generation Modal */}
      <FullBuildingGenerationModal
        isOpen={isFullBuildingModalOpen}
        onClose={() => setIsFullBuildingModalOpen(false)}
        onGenerated={handleFullBuildingGenerated}
      />
    </div>
  );
}
