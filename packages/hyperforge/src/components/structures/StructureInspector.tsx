"use client";

/**
 * StructureInspector - Right panel for structure/building and town properties
 *
 * Features:
 * - Building mode: Structure metadata, piece transforms, piece list
 * - Town mode: Town metadata, building placement, building list
 * - Context-aware UI based on active mode
 */

import { useState } from "react";
import {
  Trash2,
  ChevronDown,
  ChevronRight,
  Box,
  Move,
  RotateCw,
  Maximize2,
  Building2,
  Copy,
  Layers,
  Check,
  Edit3,
  Hash,
  Calendar,
  Sparkles,
  MapPin,
  Home,
  Ruler,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import { NeonInput } from "@/components/ui/neon-input";
import { Checkbox } from "@/components/ui/checkbox";
import type {
  StructureDefinition,
  PlacedPiece,
  PieceTransform,
  TownDefinition,
  PlacedBuilding,
  Position3D,
} from "@/types/structures";

// =============================================================================
// TYPES
// =============================================================================

/**
 * Inspector mode based on palette view:
 * - "pieces" = editing a building with pieces
 * - "buildings" = browsing completed buildings (shows selected building info)
 * - "towns" = editing a town with buildings
 */
type InspectorMode = "pieces" | "buildings" | "towns";

interface StructureInspectorProps {
  // Mode determines what content to show (matches palette view mode)
  mode: InspectorMode;
  // Building/pieces mode props
  structure: StructureDefinition | null;
  selectedPieceId: string | null;
  onSelectPiece: (id: string | null) => void;
  onUpdateStructure: (updates: Partial<StructureDefinition>) => void;
  onRemovePiece: (id: string) => void;
  onDuplicatePiece?: (id: string) => void;
  onUpdatePieceTransform: (
    pieceId: string,
    transform: Partial<PieceTransform>,
  ) => void;
  // Called when user finishes adjusting transforms (commits to history)
  onCommitTransform?: () => void;
  // Town mode props
  town?: TownDefinition | null;
  selectedBuildingId?: string | null;
  onSelectBuilding?: (id: string | null) => void;
  onUpdateTown?: (updates: Partial<TownDefinition>) => void;
  onRemoveBuilding?: (id: string) => void;
  onDuplicateBuilding?: (id: string) => void;
  onUpdateBuildingTransform?: (
    buildingId: string,
    updates: { position?: Position3D; rotation?: number; scale?: number },
  ) => void;
  // Available buildings for reference in town mode
  availableBuildings?: StructureDefinition[];
}

// =============================================================================
// SECTION HEADER
// =============================================================================

interface SectionHeaderProps {
  icon: React.ReactNode;
  title: string;
  badge?: string | number;
  isOpen: boolean;
  onToggle: () => void;
  color?: string;
}

function SectionHeader({
  icon,
  title,
  badge,
  isOpen,
  onToggle,
  color = "cyan",
}: SectionHeaderProps) {
  const colorClasses: Record<string, string> = {
    cyan: "text-cyan-400",
    purple: "text-purple-400",
    amber: "text-amber-400",
    green: "text-green-400",
  };

  return (
    <button
      onClick={onToggle}
      className="w-full flex items-center gap-2 px-4 py-3 hover:bg-white/5 transition-colors border-b border-glass-border"
    >
      <div
        className={cn(
          "w-5 h-5 flex items-center justify-center",
          colorClasses[color],
        )}
      >
        {icon}
      </div>
      <span className="text-sm font-medium flex-1 text-left">{title}</span>
      {badge !== undefined && (
        <span
          className={cn(
            "px-1.5 py-0.5 rounded text-[10px] font-medium",
            `bg-${color}-500/20 ${colorClasses[color]}`,
          )}
        >
          {badge}
        </span>
      )}
      {isOpen ? (
        <ChevronDown className="w-4 h-4 text-muted-foreground" />
      ) : (
        <ChevronRight className="w-4 h-4 text-muted-foreground" />
      )}
    </button>
  );
}

// =============================================================================
// VECTOR INPUT (3D) WITH SLIDERS
// =============================================================================

interface VectorInputProps {
  label: string;
  value: { x: number; y: number; z: number };
  onChange: (value: { x: number; y: number; z: number }) => void;
  onCommit?: () => void; // Called when user finishes adjusting (mouseup/blur)
  step?: number;
  icon?: React.ReactNode;
  min?: number;
  max?: number;
}

function VectorInput({
  label,
  value,
  onChange,
  onCommit,
  step = 0.1,
  icon,
  min = -20,
  max = 20,
}: VectorInputProps) {
  const axisConfig = {
    x: {
      color: "red",
      bgClass: "bg-red-500",
      textClass: "text-red-400",
      sliderClass: "accent-red-500",
    },
    y: {
      color: "green",
      bgClass: "bg-green-500",
      textClass: "text-green-400",
      sliderClass: "accent-green-500",
    },
    z: {
      color: "blue",
      bgClass: "bg-blue-500",
      textClass: "text-blue-400",
      sliderClass: "accent-blue-500",
    },
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {icon}
        <span className="font-medium">{label}</span>
      </div>
      <div className="space-y-2">
        {(["x", "y", "z"] as const).map((axis) => (
          <div key={axis} className="flex items-center gap-2">
            <span
              className={cn(
                "w-4 text-[10px] font-bold uppercase",
                axisConfig[axis].textClass,
              )}
            >
              {axis}
            </span>
            <div className="flex-1 relative">
              <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={value[axis]}
                onChange={(e) =>
                  onChange({ ...value, [axis]: parseFloat(e.target.value) })
                }
                onMouseUp={onCommit}
                onTouchEnd={onCommit}
                className={cn(
                  "w-full h-2 rounded-lg appearance-none cursor-pointer",
                  "bg-glass-bg/50 border border-glass-border",
                  axisConfig[axis].sliderClass,
                )}
                style={{
                  background: `linear-gradient(to right, ${axisConfig[axis].color === "red" ? "#ef4444" : axisConfig[axis].color === "green" ? "#22c55e" : "#3b82f6"}33 0%, ${axisConfig[axis].color === "red" ? "#ef4444" : axisConfig[axis].color === "green" ? "#22c55e" : "#3b82f6"} ${((value[axis] - min) / (max - min)) * 100}%, rgba(255,255,255,0.1) ${((value[axis] - min) / (max - min)) * 100}%, rgba(255,255,255,0.1) 100%)`,
                }}
              />
            </div>
            <input
              type="number"
              value={value[axis].toFixed(2)}
              onChange={(e) =>
                onChange({ ...value, [axis]: parseFloat(e.target.value) || 0 })
              }
              onBlur={onCommit}
              step={step}
              className={cn(
                "w-16 px-2 py-1 bg-glass-bg/50 border rounded text-xs text-right font-mono",
                "focus:outline-none focus:ring-1",
                axis === "x" && "border-red-500/30 focus:ring-red-500/50",
                axis === "y" && "border-green-500/30 focus:ring-green-500/50",
                axis === "z" && "border-blue-500/30 focus:ring-blue-500/50",
              )}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// =============================================================================
// SINGLE VALUE INPUT WITH SLIDER
// =============================================================================

interface SingleValueInputProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  onCommit?: () => void; // Called when user finishes adjusting (mouseup/blur)
  step?: number;
  icon?: React.ReactNode;
  suffix?: string;
  min?: number;
  max?: number;
}

function SingleValueInput({
  label,
  value,
  onChange,
  onCommit,
  step = 1,
  icon,
  suffix,
  min = 0,
  max = 360,
}: SingleValueInputProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {icon}
        <span className="font-medium">{label}</span>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          onMouseUp={onCommit}
          onTouchEnd={onCommit}
          className="flex-1 h-2 rounded-lg appearance-none cursor-pointer bg-glass-bg/50 border border-glass-border accent-cyan-500"
          style={{
            background: `linear-gradient(to right, #06b6d4 0%, #06b6d4 ${((value - min) / (max - min)) * 100}%, rgba(255,255,255,0.1) ${((value - min) / (max - min)) * 100}%, rgba(255,255,255,0.1) 100%)`,
          }}
        />
        <div className="relative w-20">
          <input
            type="number"
            value={value}
            onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
            onBlur={onCommit}
            step={step}
            className="w-full px-2 py-1 bg-glass-bg/50 border border-glass-border rounded text-xs text-right font-mono focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
          />
          {suffix && (
            <span className="absolute right-6 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">
              {suffix}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// PIECE LIST ITEM
// =============================================================================

interface PieceListItemProps {
  piece: PlacedPiece;
  index: number;
  isSelected: boolean;
  onClick: () => void;
  onDelete: () => void;
}

function PieceListItem({
  piece,
  index,
  isSelected,
  onClick,
  onDelete,
}: PieceListItemProps) {
  const pieceType = piece.pieceId.split("_")[0] || "piece";

  const typeColors: Record<string, string> = {
    wall: "bg-amber-500/20 text-amber-400",
    door: "bg-orange-500/20 text-orange-400",
    window: "bg-sky-500/20 text-sky-400",
    roof: "bg-red-500/20 text-red-400",
    floor: "bg-stone-500/20 text-stone-400",
    piece: "bg-purple-500/20 text-purple-400",
  };

  return (
    <div
      className={cn(
        "flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-all group",
        isSelected
          ? "bg-cyan-500/20 ring-1 ring-cyan-500/50"
          : "hover:bg-white/5",
      )}
      onClick={onClick}
    >
      <div className="w-6 h-6 rounded bg-glass-bg/50 flex items-center justify-center text-[10px] font-mono text-muted-foreground">
        {index + 1}
      </div>
      <div className="flex-1 min-w-0">
        <span
          className={cn(
            "px-1.5 py-0.5 rounded text-[9px] font-medium uppercase",
            typeColors[pieceType] || typeColors.piece,
          )}
        >
          {pieceType}
        </span>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg hover:bg-red-500/20 transition-all"
        title="Delete piece"
      >
        <Trash2 className="w-3.5 h-3.5 text-red-400" />
      </button>
    </div>
  );
}

// =============================================================================
// BUILDING LIST ITEM (for towns)
// =============================================================================

interface BuildingListItemProps {
  building: PlacedBuilding;
  index: number;
  isSelected: boolean;
  onClick: () => void;
  onDelete: () => void;
  structureInfo?: StructureDefinition;
}

function BuildingListItem({
  building,
  index: _index,
  isSelected,
  onClick,
  onDelete,
  structureInfo,
}: BuildingListItemProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-all group",
        isSelected
          ? "bg-amber-500/20 ring-1 ring-amber-500/50"
          : "hover:bg-white/5",
      )}
      onClick={onClick}
    >
      <div className="w-8 h-8 rounded-lg bg-amber-900/30 flex items-center justify-center overflow-hidden flex-shrink-0">
        {structureInfo?.thumbnailUrl ? (
          <img
            src={structureInfo.thumbnailUrl}
            alt={building.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <Building2 className="w-4 h-4 text-amber-400/60" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium truncate">{building.name}</div>
        <div className="text-[10px] text-muted-foreground">
          {structureInfo?.pieces.length || 0} pieces
        </div>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg hover:bg-red-500/20 transition-all"
        title="Remove building"
      >
        <Trash2 className="w-3.5 h-3.5 text-red-400" />
      </button>
    </div>
  );
}

// =============================================================================
// STAT ITEM
// =============================================================================

interface StatItemProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  color?: string;
}

function StatItem({ icon, label, value, color = "muted" }: StatItemProps) {
  const colorClasses: Record<string, string> = {
    muted: "text-muted-foreground",
    cyan: "text-cyan-400",
    green: "text-green-400",
    amber: "text-amber-400",
  };

  return (
    <div className="flex items-center gap-2 py-1.5">
      <div className="w-5 h-5 flex items-center justify-center text-muted-foreground">
        {icon}
      </div>
      <span className="text-xs text-muted-foreground flex-1">{label}</span>
      <span className={cn("text-xs font-medium", colorClasses[color])}>
        {value}
      </span>
    </div>
  );
}

// =============================================================================
// BUILDING INSPECTOR CONTENT
// =============================================================================

interface BuildingInspectorProps {
  structure: StructureDefinition;
  selectedPieceId: string | null;
  onSelectPiece: (id: string | null) => void;
  onUpdateStructure: (updates: Partial<StructureDefinition>) => void;
  onRemovePiece: (id: string) => void;
  onDuplicatePiece?: (id: string) => void;
  onUpdatePieceTransform: (
    pieceId: string,
    transform: Partial<PieceTransform>,
  ) => void;
  onCommitTransform?: () => void;
}

function BuildingInspector({
  structure,
  selectedPieceId,
  onSelectPiece,
  onUpdateStructure,
  onRemovePiece,
  onDuplicatePiece,
  onUpdatePieceTransform,
  onCommitTransform,
}: BuildingInspectorProps) {
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [pieceOpen, setPieceOpen] = useState(true);
  const [listOpen, setListOpen] = useState(true);

  const selectedPiece = structure.pieces.find((p) => p.id === selectedPieceId);

  return (
    <>
      {/* Header */}
      <div className="px-4 py-3 border-b border-glass-border bg-glass-bg/30">
        <div className="flex items-center gap-2 mb-1">
          <Building2 className="w-4 h-4 text-cyan-400" />
          <span className="text-xs text-muted-foreground uppercase tracking-wide">
            Building Properties
          </span>
        </div>
        {structure.bakedModelUrl && (
          <div className="flex items-center gap-1.5 mt-2">
            <div className="w-4 h-4 rounded-full bg-green-500/20 flex items-center justify-center">
              <Check className="w-2.5 h-2.5 text-green-400" />
            </div>
            <span className="text-[11px] text-green-400 font-medium">
              Baked & Ready
            </span>
          </div>
        )}
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Details Section */}
        <div>
          <SectionHeader
            icon={<Edit3 className="w-4 h-4" />}
            title="Details"
            isOpen={detailsOpen}
            onToggle={() => setDetailsOpen(!detailsOpen)}
            color="cyan"
          />
          {detailsOpen && (
            <div className="p-4 space-y-4 border-b border-glass-border">
              <div className="space-y-2">
                <Label className="text-xs">Building Name</Label>
                <NeonInput
                  value={structure.name}
                  onChange={(e) => onUpdateStructure({ name: e.target.value })}
                  placeholder="Enter building name..."
                  className="h-9"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Description</Label>
                <textarea
                  value={structure.description}
                  onChange={(e) =>
                    onUpdateStructure({ description: e.target.value })
                  }
                  placeholder="Describe this building..."
                  rows={2}
                  className="w-full px-3 py-2 bg-glass-bg/50 border border-glass-border rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-cyan-500/50 placeholder:text-muted-foreground"
                />
              </div>

              <div className="flex items-center gap-3 py-2 px-3 rounded-lg bg-glass-bg/30 border border-glass-border">
                <Checkbox
                  id="enterable"
                  checked={structure.enterable}
                  onCheckedChange={(checked) =>
                    onUpdateStructure({ enterable: checked === true })
                  }
                />
                <div className="flex-1">
                  <label
                    htmlFor="enterable"
                    className="text-sm font-medium cursor-pointer"
                  >
                    Enterable
                  </label>
                  <p className="text-[11px] text-muted-foreground">
                    Players can walk inside this building
                  </p>
                </div>
              </div>

              <div className="pt-2 border-t border-glass-border/50">
                <StatItem
                  icon={<Layers className="w-3.5 h-3.5" />}
                  label="Total Pieces"
                  value={structure.pieces.length}
                  color="cyan"
                />
                <StatItem
                  icon={<Hash className="w-3.5 h-3.5" />}
                  label="ID"
                  value={structure.id.slice(0, 16) + "..."}
                />
                <StatItem
                  icon={<Calendar className="w-3.5 h-3.5" />}
                  label="Created"
                  value={new Date(structure.createdAt).toLocaleDateString()}
                />
              </div>
            </div>
          )}
        </div>

        {/* Selected Piece Section */}
        {selectedPiece && (
          <div>
            <SectionHeader
              icon={<Sparkles className="w-4 h-4" />}
              title="Selected Piece"
              isOpen={pieceOpen}
              onToggle={() => setPieceOpen(!pieceOpen)}
              color="purple"
            />
            {pieceOpen && (
              <div className="p-4 space-y-4 border-b border-glass-border">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-1 rounded-lg bg-purple-500/20 text-purple-400 text-xs font-medium uppercase">
                    {selectedPiece.pieceId.split("_")[0]}
                  </span>
                </div>

                <VectorInput
                  label="Position"
                  icon={<Move className="w-3.5 h-3.5" />}
                  value={selectedPiece.transform.position}
                  onChange={(position) =>
                    onUpdatePieceTransform(selectedPiece.id, { position })
                  }
                  onCommit={onCommitTransform}
                  step={0.5}
                  min={-20}
                  max={20}
                />

                <VectorInput
                  label="Rotation"
                  icon={<RotateCw className="w-3.5 h-3.5" />}
                  value={selectedPiece.transform.rotation}
                  onChange={(rotation) =>
                    onUpdatePieceTransform(selectedPiece.id, { rotation })
                  }
                  onCommit={onCommitTransform}
                  step={15}
                  min={0}
                  max={360}
                />

                <VectorInput
                  label="Scale"
                  icon={<Maximize2 className="w-3.5 h-3.5" />}
                  value={selectedPiece.transform.scale}
                  onChange={(scale) =>
                    onUpdatePieceTransform(selectedPiece.id, { scale })
                  }
                  onCommit={onCommitTransform}
                  step={0.1}
                  min={0.1}
                  max={3}
                />

                <div className="flex gap-2 pt-2">
                  <button
                    onClick={() => onDuplicatePiece?.(selectedPiece.id)}
                    className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 text-xs font-medium hover:bg-cyan-500/20 transition-colors"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    Duplicate
                  </button>
                  <button
                    onClick={() => onRemovePiece(selectedPiece.id)}
                    className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-medium hover:bg-red-500/20 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Pieces List Section */}
        <div>
          <SectionHeader
            icon={<Box className="w-4 h-4" />}
            title="Placed Pieces"
            badge={structure.pieces.length}
            isOpen={listOpen}
            onToggle={() => setListOpen(!listOpen)}
            color="amber"
          />
          {listOpen && (
            <div className="p-3">
              {structure.pieces.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <div className="w-12 h-12 rounded-xl bg-glass-bg/50 flex items-center justify-center mb-3">
                    <Box className="w-6 h-6 text-muted-foreground" />
                  </div>
                  <p className="text-xs text-muted-foreground mb-1">
                    No pieces placed yet
                  </p>
                  <p className="text-[11px] text-muted-foreground/70">
                    Select pieces from the left panel
                  </p>
                </div>
              ) : (
                <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
                  {structure.pieces.map((piece, index) => (
                    <PieceListItem
                      key={piece.id}
                      piece={piece}
                      index={index}
                      isSelected={piece.id === selectedPieceId}
                      onClick={() => onSelectPiece(piece.id)}
                      onDelete={() => onRemovePiece(piece.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-glass-border bg-glass-bg/30">
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <kbd className="px-1.5 py-0.5 rounded bg-glass-bg border border-glass-border font-mono text-[10px]">
            Del
          </kbd>
          <span>remove •</span>
          <kbd className="px-1.5 py-0.5 rounded bg-glass-bg border border-glass-border font-mono text-[10px]">
            D
          </kbd>
          <span>duplicate</span>
        </div>
      </div>
    </>
  );
}

// =============================================================================
// TOWN INSPECTOR CONTENT
// =============================================================================

interface TownInspectorProps {
  town: TownDefinition;
  selectedBuildingId: string | null;
  onSelectBuilding: (id: string | null) => void;
  onUpdateTown: (updates: Partial<TownDefinition>) => void;
  onRemoveBuilding: (id: string) => void;
  onDuplicateBuilding?: (id: string) => void;
  onUpdateBuildingTransform: (
    buildingId: string,
    updates: { position?: Position3D; rotation?: number; scale?: number },
  ) => void;
  availableBuildings: StructureDefinition[];
}

function TownInspector({
  town,
  selectedBuildingId,
  onSelectBuilding,
  onUpdateTown,
  onRemoveBuilding,
  onDuplicateBuilding,
  onUpdateBuildingTransform,
  availableBuildings,
}: TownInspectorProps) {
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [buildingOpen, setBuildingOpen] = useState(true);
  const [listOpen, setListOpen] = useState(true);

  const selectedBuilding = town.buildings.find(
    (b) => b.id === selectedBuildingId,
  );
  const selectedStructureInfo = selectedBuilding
    ? availableBuildings.find((s) => s.id === selectedBuilding.structureId)
    : null;

  return (
    <>
      {/* Header */}
      <div className="px-4 py-3 border-b border-glass-border bg-glass-bg/30">
        <div className="flex items-center gap-2 mb-1">
          <MapPin className="w-4 h-4 text-amber-400" />
          <span className="text-xs text-muted-foreground uppercase tracking-wide">
            Town Properties
          </span>
        </div>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Details Section */}
        <div>
          <SectionHeader
            icon={<Edit3 className="w-4 h-4" />}
            title="Details"
            isOpen={detailsOpen}
            onToggle={() => setDetailsOpen(!detailsOpen)}
            color="amber"
          />
          {detailsOpen && (
            <div className="p-4 space-y-4 border-b border-glass-border">
              <div className="space-y-2">
                <Label className="text-xs">Town Name</Label>
                <NeonInput
                  value={town.name}
                  onChange={(e) => onUpdateTown({ name: e.target.value })}
                  placeholder="Enter town name..."
                  className="h-9"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Description</Label>
                <textarea
                  value={town.description}
                  onChange={(e) =>
                    onUpdateTown({ description: e.target.value })
                  }
                  placeholder="Describe this town..."
                  rows={2}
                  className="w-full px-3 py-2 bg-glass-bg/50 border border-glass-border rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-amber-500/50 placeholder:text-muted-foreground"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label className="text-xs">Width (m)</Label>
                  <NeonInput
                    type="number"
                    value={town.bounds.width}
                    onChange={(e) =>
                      onUpdateTown({
                        bounds: {
                          ...town.bounds,
                          width: parseFloat(e.target.value) || 100,
                        },
                      })
                    }
                    className="h-9"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Depth (m)</Label>
                  <NeonInput
                    type="number"
                    value={town.bounds.depth}
                    onChange={(e) =>
                      onUpdateTown({
                        bounds: {
                          ...town.bounds,
                          depth: parseFloat(e.target.value) || 100,
                        },
                      })
                    }
                    className="h-9"
                  />
                </div>
              </div>

              <div className="pt-2 border-t border-glass-border/50">
                <StatItem
                  icon={<Building2 className="w-3.5 h-3.5" />}
                  label="Buildings"
                  value={town.buildings.length}
                  color="amber"
                />
                <StatItem
                  icon={<Ruler className="w-3.5 h-3.5" />}
                  label="Area"
                  value={`${town.bounds.width}×${town.bounds.depth}m`}
                />
                <StatItem
                  icon={<Calendar className="w-3.5 h-3.5" />}
                  label="Updated"
                  value={new Date(town.updatedAt).toLocaleDateString()}
                />
              </div>
            </div>
          )}
        </div>

        {/* Selected Building Section */}
        {selectedBuilding && (
          <div>
            <SectionHeader
              icon={<Home className="w-4 h-4" />}
              title="Selected Building"
              isOpen={buildingOpen}
              onToggle={() => setBuildingOpen(!buildingOpen)}
              color="purple"
            />
            {buildingOpen && (
              <div className="p-4 space-y-4 border-b border-glass-border">
                {/* Building Info */}
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-lg bg-purple-900/30 flex items-center justify-center overflow-hidden">
                    {selectedStructureInfo?.thumbnailUrl ? (
                      <img
                        src={selectedStructureInfo.thumbnailUrl}
                        alt={selectedBuilding.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <Building2 className="w-6 h-6 text-purple-400/60" />
                    )}
                  </div>
                  <div>
                    <div className="text-sm font-medium">
                      {selectedBuilding.name}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {selectedStructureInfo?.pieces.length || 0} pieces
                    </div>
                  </div>
                </div>

                {/* Position */}
                <VectorInput
                  label="Position"
                  icon={<Move className="w-3.5 h-3.5" />}
                  value={selectedBuilding.position}
                  onChange={(position) =>
                    onUpdateBuildingTransform(selectedBuilding.id, { position })
                  }
                  step={1}
                  min={-100}
                  max={100}
                />

                {/* Rotation (single Y-axis) */}
                <SingleValueInput
                  label="Rotation"
                  icon={<RotateCw className="w-3.5 h-3.5" />}
                  value={selectedBuilding.rotation}
                  onChange={(rotation) =>
                    onUpdateBuildingTransform(selectedBuilding.id, { rotation })
                  }
                  step={15}
                  suffix="°"
                  min={0}
                  max={360}
                />

                {/* Scale */}
                <SingleValueInput
                  label="Scale"
                  icon={<Maximize2 className="w-3.5 h-3.5" />}
                  value={selectedBuilding.scale}
                  onChange={(scale) =>
                    onUpdateBuildingTransform(selectedBuilding.id, { scale })
                  }
                  step={0.1}
                  min={0.1}
                  max={5}
                />

                <div className="flex gap-2 pt-2">
                  <button
                    onClick={() => onDuplicateBuilding?.(selectedBuilding.id)}
                    className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-medium hover:bg-amber-500/20 transition-colors"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    Duplicate
                  </button>
                  <button
                    onClick={() => onRemoveBuilding(selectedBuilding.id)}
                    className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-medium hover:bg-red-500/20 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Remove
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Buildings List Section */}
        <div>
          <SectionHeader
            icon={<Building2 className="w-4 h-4" />}
            title="Placed Buildings"
            badge={town.buildings.length}
            isOpen={listOpen}
            onToggle={() => setListOpen(!listOpen)}
            color="cyan"
          />
          {listOpen && (
            <div className="p-3">
              {town.buildings.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <div className="w-12 h-12 rounded-xl bg-glass-bg/50 flex items-center justify-center mb-3">
                    <Building2 className="w-6 h-6 text-muted-foreground" />
                  </div>
                  <p className="text-xs text-muted-foreground mb-1">
                    No buildings placed yet
                  </p>
                  <p className="text-[11px] text-muted-foreground/70">
                    Select buildings from the left panel
                  </p>
                </div>
              ) : (
                <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
                  {town.buildings.map((building, index) => (
                    <BuildingListItem
                      key={building.id}
                      building={building}
                      index={index}
                      isSelected={building.id === selectedBuildingId}
                      onClick={() => onSelectBuilding(building.id)}
                      onDelete={() => onRemoveBuilding(building.id)}
                      structureInfo={availableBuildings.find(
                        (s) => s.id === building.structureId,
                      )}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-glass-border bg-glass-bg/30">
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <kbd className="px-1.5 py-0.5 rounded bg-glass-bg border border-glass-border font-mono text-[10px]">
            Del
          </kbd>
          <span>remove •</span>
          <kbd className="px-1.5 py-0.5 rounded bg-glass-bg border border-glass-border font-mono text-[10px]">
            D
          </kbd>
          <span>duplicate</span>
        </div>
      </div>
    </>
  );
}

// =============================================================================
// BUILDINGS BROWSER CONTENT (when viewing completed buildings)
// =============================================================================

interface BuildingsBrowserProps {
  structure: StructureDefinition | null;
}

function BuildingsBrowser({ structure }: BuildingsBrowserProps) {
  if (!structure) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center p-6">
        <div className="w-16 h-16 rounded-2xl bg-purple-500/10 flex items-center justify-center mb-4">
          <Building2 className="w-8 h-8 text-purple-400" />
        </div>
        <h3 className="text-sm font-medium text-white/80 mb-2">
          Completed Buildings
        </h3>
        <p className="text-xs text-muted-foreground mb-4">
          Select a building from the left panel to view its details
        </p>
        <div className="w-full max-w-[200px] p-3 rounded-lg bg-glass-bg/30 border border-glass-border">
          <p className="text-[11px] text-muted-foreground">
            💡 Buildings can be added to Towns to create settlements
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-glass-border bg-purple-500/5">
        <div className="flex items-center gap-2 mb-1">
          <Building2 className="w-4 h-4 text-purple-400" />
          <span className="text-xs text-muted-foreground uppercase tracking-wide">
            Building Details
          </span>
        </div>
        {structure.bakedModelUrl && (
          <div className="flex items-center gap-1.5 mt-2">
            <div className="w-4 h-4 rounded-full bg-green-500/20 flex items-center justify-center">
              <Check className="w-2.5 h-2.5 text-green-400" />
            </div>
            <span className="text-[11px] text-green-400 font-medium">
              Baked & Ready for Towns
            </span>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Thumbnail */}
        {structure.thumbnailUrl && (
          <div className="w-full aspect-video rounded-lg overflow-hidden bg-glass-bg/30 border border-glass-border">
            <img
              src={structure.thumbnailUrl}
              alt={structure.name}
              className="w-full h-full object-cover"
            />
          </div>
        )}

        {/* Name & Description */}
        <div>
          <h3 className="text-lg font-semibold mb-1">{structure.name}</h3>
          <p className="text-sm text-muted-foreground">
            {structure.description || "No description"}
          </p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 rounded-lg bg-glass-bg/30 border border-glass-border">
            <div className="flex items-center gap-2 mb-1">
              <Layers className="w-4 h-4 text-cyan-400" />
              <span className="text-xs text-muted-foreground">Pieces</span>
            </div>
            <span className="text-xl font-bold text-cyan-400">
              {structure.pieces.length}
            </span>
          </div>
          <div className="p-3 rounded-lg bg-glass-bg/30 border border-glass-border">
            <div className="flex items-center gap-2 mb-1">
              <Home className="w-4 h-4 text-amber-400" />
              <span className="text-xs text-muted-foreground">Type</span>
            </div>
            <span className="text-sm font-medium text-amber-400">
              {structure.enterable ? "Enterable" : "Solid"}
            </span>
          </div>
        </div>

        {/* Metadata */}
        <div className="space-y-2 pt-3 border-t border-glass-border/50">
          <StatItem
            icon={<Hash className="w-3.5 h-3.5" />}
            label="ID"
            value={structure.id.slice(0, 20) + "..."}
          />
          <StatItem
            icon={<Calendar className="w-3.5 h-3.5" />}
            label="Created"
            value={new Date(structure.createdAt).toLocaleDateString()}
          />
          {structure.bakedAt && (
            <StatItem
              icon={<Sparkles className="w-3.5 h-3.5" />}
              label="Baked"
              value={new Date(structure.bakedAt).toLocaleDateString()}
              color="green"
            />
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-glass-border bg-glass-bg/30">
        <p className="text-[11px] text-muted-foreground text-center">
          Switch to <span className="text-amber-400">Towns</span> to place this
          building
        </p>
      </div>
    </div>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function StructureInspector({
  mode,
  structure,
  selectedPieceId,
  onSelectPiece,
  onUpdateStructure,
  onRemovePiece,
  onDuplicatePiece,
  onUpdatePieceTransform,
  onCommitTransform,
  town,
  selectedBuildingId,
  onSelectBuilding,
  onUpdateTown,
  onRemoveBuilding,
  onDuplicateBuilding,
  onUpdateBuildingTransform,
  availableBuildings = [],
}: StructureInspectorProps) {
  // PIECES MODE - Building editor
  if (mode === "pieces") {
    if (!structure) {
      return (
        <div className="h-full flex flex-col items-center justify-center text-center p-6">
          <div className="w-16 h-16 rounded-2xl bg-glass-bg/50 flex items-center justify-center mb-4">
            <Building2 className="w-8 h-8 text-muted-foreground" />
          </div>
          <h3 className="text-sm font-medium text-white/80 mb-1">
            No Building Selected
          </h3>
          <p className="text-xs text-muted-foreground">
            Create or select a building to view its properties
          </p>
        </div>
      );
    }

    return (
      <div className="h-full flex flex-col overflow-hidden">
        <BuildingInspector
          structure={structure}
          selectedPieceId={selectedPieceId}
          onSelectPiece={onSelectPiece}
          onUpdateStructure={onUpdateStructure}
          onRemovePiece={onRemovePiece}
          onDuplicatePiece={onDuplicatePiece}
          onUpdatePieceTransform={onUpdatePieceTransform}
          onCommitTransform={onCommitTransform}
        />
      </div>
    );
  }

  // BUILDINGS MODE - Browse completed buildings
  if (mode === "buildings") {
    return <BuildingsBrowser structure={structure} />;
  }

  // TOWNS MODE - Town editor
  if (mode === "towns") {
    if (!town) {
      return (
        <div className="h-full flex flex-col items-center justify-center text-center p-6">
          <div className="w-16 h-16 rounded-2xl bg-glass-bg/50 flex items-center justify-center mb-4">
            <MapPin className="w-8 h-8 text-muted-foreground" />
          </div>
          <h3 className="text-sm font-medium text-white/80 mb-1">
            No Town Selected
          </h3>
          <p className="text-xs text-muted-foreground">
            Create or select a town to view its properties
          </p>
        </div>
      );
    }

    if (
      onSelectBuilding &&
      onUpdateTown &&
      onRemoveBuilding &&
      onUpdateBuildingTransform
    ) {
      return (
        <div className="h-full flex flex-col overflow-hidden">
          <TownInspector
            town={town}
            selectedBuildingId={selectedBuildingId ?? null}
            onSelectBuilding={onSelectBuilding}
            onUpdateTown={onUpdateTown}
            onRemoveBuilding={onRemoveBuilding}
            onDuplicateBuilding={onDuplicateBuilding}
            onUpdateBuildingTransform={onUpdateBuildingTransform}
            availableBuildings={availableBuildings}
          />
        </div>
      );
    }
  }

  // Fallback
  return (
    <div className="h-full flex flex-col items-center justify-center text-center p-6">
      <div className="w-16 h-16 rounded-2xl bg-glass-bg/50 flex items-center justify-center mb-4">
        <Box className="w-8 h-8 text-muted-foreground" />
      </div>
      <h3 className="text-sm font-medium text-white/80 mb-1">
        Structure Studio
      </h3>
      <p className="text-xs text-muted-foreground">
        Select a mode from the left panel
      </p>
    </div>
  );
}
