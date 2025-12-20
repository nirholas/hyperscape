"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  Sword,
  Shield,
  Pickaxe,
  Package,
  User,
  Skull,
  TreeDeciduous,
  Map as MapIcon,
  Coins,
  Music,
  Building,
  Box,
  Mountain,
  Volume2,
  Smile,
} from "lucide-react";
import type { AssetCategory } from "@/types/core";
import { ASSET_CATEGORY_COLORS } from "@/lib/relationships/relationship-types";

// =============================================================================
// TYPES
// =============================================================================

export interface AssetNodeData {
  id: string;
  name: string;
  category: AssetCategory;
  relationshipCount: number;
  isSelected: boolean;
  thumbnailUrl?: string;
  onClick: () => void;
  [key: string]: unknown;
}

// =============================================================================
// CATEGORY ICONS
// =============================================================================

const CATEGORY_ICONS: Record<
  AssetCategory,
  React.ComponentType<{ className?: string; style?: React.CSSProperties }>
> = {
  weapon: Sword,
  armor: Shield,
  tool: Pickaxe,
  item: Package,
  npc: User,
  mob: Skull,
  character: User,
  resource: TreeDeciduous,
  building: Building,
  prop: Box,
  currency: Coins,
  music: Music,
  biome: MapIcon,
  environment: Mountain,
  audio: Volume2,
  avatar: User,
  emote: Smile,
  misc: Package,
};

// =============================================================================
// ASSET NODE COMPONENT
// =============================================================================

export const AssetNode = memo(function AssetNode({
  data,
  selected,
}: NodeProps & { data: AssetNodeData }) {
  const Icon = CATEGORY_ICONS[data.category] || Package;
  const color = ASSET_CATEGORY_COLORS[data.category] || "#6b7280";

  return (
    <div
      onClick={data.onClick}
      className={`
        relative cursor-pointer
        min-w-[160px] max-w-[200px]
        rounded-xl p-3
        transition-all duration-200
        ${
          selected || data.isSelected
            ? "border-2 shadow-lg scale-105"
            : "border-2 border-glass-border hover:border-opacity-60"
        }
        bg-glass-bg/90 backdrop-blur-md
      `}
      style={{
        borderColor: selected || data.isSelected ? color : undefined,
        boxShadow:
          selected || data.isSelected ? `0 0 20px ${color}40` : undefined,
      }}
    >
      {/* Input Handle */}
      <Handle
        type="target"
        position={Position.Left}
        className="!w-3 !h-3 !border-2 !border-background transition-transform hover:scale-125"
        style={{ backgroundColor: color }}
      />

      {/* Content */}
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div
          className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center"
          style={{ backgroundColor: `${color}20` }}
        >
          <Icon className="w-5 h-5" style={{ color }} />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-medium truncate text-foreground">
            {data.name}
          </h3>
          <div className="flex items-center gap-2 mt-1">
            <span
              className="text-[10px] px-1.5 py-0.5 rounded font-medium uppercase"
              style={{ backgroundColor: `${color}20`, color }}
            >
              {data.category}
            </span>
            {data.relationshipCount > 0 && (
              <span className="text-[10px] text-muted-foreground">
                {data.relationshipCount} links
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Output Handle */}
      <Handle
        type="source"
        position={Position.Right}
        className="!w-3 !h-3 !border-2 !border-background transition-transform hover:scale-125"
        style={{ backgroundColor: color }}
      />
    </div>
  );
});

// =============================================================================
// NODE TYPES REGISTRY
// =============================================================================

export const assetNodeTypes = {
  asset: AssetNode,
};
