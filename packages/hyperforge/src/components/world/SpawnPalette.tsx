"use client";

import { useState, useMemo, useEffect } from "react";
import {
  Search,
  Sword,
  User,
  TreeDeciduous,
  ChevronDown,
  ChevronRight,
  GripVertical,
  Loader2,
  AlertCircle,
  RefreshCw,
  Building,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { logger } from "@/lib/utils";
import type { PlaceableItem } from "@/lib/world/tile-types";
import type { NpcDefinition, ResourceDefinition } from "@/lib/game/manifests";
import type { StructureDefinition } from "@/types/structures";

const log = logger.child("SpawnPalette");

// ============================================================================
// TYPES
// ============================================================================

interface SpawnPaletteProps {
  onSelectItem: (item: PlaceableItem) => void;
  selectedItem: PlaceableItem | null;
}

type CategoryType = "all" | "mob" | "npc" | "resource" | "structure";

interface CategoryConfig {
  label: string;
  icon: typeof Sword;
  color: string;
  bgColor: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const CATEGORY_CONFIG: Record<CategoryType, CategoryConfig> = {
  all: {
    label: "All",
    icon: GripVertical,
    color: "text-muted-foreground",
    bgColor: "bg-zinc-500/20",
  },
  mob: {
    label: "Mobs",
    icon: Sword,
    color: "text-red-400",
    bgColor: "bg-red-500/20",
  },
  npc: {
    label: "NPCs",
    icon: User,
    color: "text-green-400",
    bgColor: "bg-green-500/20",
  },
  resource: {
    label: "Resources",
    icon: TreeDeciduous,
    color: "text-emerald-400",
    bgColor: "bg-emerald-500/20",
  },
  structure: {
    label: "Structures",
    icon: Building,
    color: "text-amber-400",
    bgColor: "bg-amber-500/20",
  },
};

// ============================================================================
// COMPONENT
// ============================================================================

export function SpawnPalette({
  onSelectItem,
  selectedItem,
}: SpawnPaletteProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<CategoryType>("all");
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(["mob", "npc", "resource", "structure"]),
  );

  // Data loading state
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mobs, setMobs] = useState<NpcDefinition[]>([]);
  const [npcs, setNpcs] = useState<NpcDefinition[]>([]);
  const [resources, setResources] = useState<ResourceDefinition[]>([]);
  const [structures, setStructures] = useState<StructureDefinition[]>([]);

  // Load data from manifests
  useEffect(() => {
    async function loadData() {
      setIsLoading(true);
      setError(null);

      try {
        // Load NPCs (includes mobs)
        const npcsRes = await fetch("/api/game/manifests/npcs");
        if (!npcsRes.ok) throw new Error("Failed to load NPCs");
        const npcsData: NpcDefinition[] = await npcsRes.json();

        // Split into mobs and NPCs
        setMobs(npcsData.filter((n) => n.category === "mob"));
        setNpcs(npcsData.filter((n) => n.category !== "mob"));

        // Load resources
        const resourcesRes = await fetch("/api/game/manifests/resources");
        if (!resourcesRes.ok) throw new Error("Failed to load resources");
        const resourcesData: ResourceDefinition[] = await resourcesRes.json();
        setResources(resourcesData);

        // Load structures (baked only)
        try {
          const structuresRes = await fetch("/api/structures");
          if (structuresRes.ok) {
            const structuresData = await structuresRes.json();
            // Only show baked structures that can be placed
            const bakedStructures = (structuresData.structures || []).filter(
              (s: StructureDefinition) => s.bakedModelUrl,
            );
            setStructures(bakedStructures);
          }
        } catch {
          // Structures API may not be available yet
          log.warn("Failed to load structures - API may not be available");
        }

        log.info("Loaded spawn palette data", {
          mobs: npcsData.filter((n) => n.category === "mob").length,
          npcs: npcsData.filter((n) => n.category !== "mob").length,
          resources: resourcesData.length,
          structures: structures.length,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        log.error("Failed to load palette data", { error: message });
        setError(message);
      } finally {
        setIsLoading(false);
      }
    }

    loadData();
  }, []);

  // Convert to PlaceableItems
  const allItems = useMemo((): PlaceableItem[] => {
    const items: PlaceableItem[] = [];

    // Add mobs
    for (const mob of mobs) {
      items.push({
        type: "mob",
        entityId: mob.id,
        name: mob.name,
        iconPath: mob.appearance?.iconPath,
        modelPath: mob.appearance?.modelPath,
        defaults: {
          spawnRadius: 3,
          maxCount: 1,
          respawnTicks: 100,
        },
      });
    }

    // Add NPCs
    for (const npc of npcs) {
      items.push({
        type: "npc",
        entityId: npc.id,
        name: npc.name,
        iconPath: npc.appearance?.iconPath,
        modelPath: npc.appearance?.modelPath,
        defaults: {
          npcType: npc.services?.types?.[0] || "neutral",
        },
      });
    }

    // Add resources
    for (const resource of resources) {
      items.push({
        type: "resource",
        entityId: resource.id,
        name: resource.name,
        modelPath: resource.modelPath ?? undefined,
        defaults: {
          resourceType: resource.type,
        },
      });
    }

    // Add structures (baked buildings)
    for (const structure of structures) {
      items.push({
        type: "structure",
        entityId: structure.id,
        name: structure.name,
        modelPath: structure.bakedModelUrl ?? undefined,
        defaults: {
          rotation: 0,
          scale: 1,
          enterable: structure.enterable,
        },
      });
    }

    return items;
  }, [mobs, npcs, resources, structures]);

  // Filter items
  const filteredItems = useMemo(() => {
    return allItems.filter((item) => {
      // Search filter
      const matchesSearch = item.name
        .toLowerCase()
        .includes(searchQuery.toLowerCase());

      // Category filter
      if (categoryFilter === "all") return matchesSearch;
      return matchesSearch && item.type === categoryFilter;
    });
  }, [allItems, searchQuery, categoryFilter]);

  // Group items by type
  const groupedItems = useMemo(() => {
    const groups: Record<string, PlaceableItem[]> = {
      mob: [],
      npc: [],
      resource: [],
      structure: [],
    };

    for (const item of filteredItems) {
      if (groups[item.type]) {
        groups[item.type].push(item);
      }
    }

    return groups;
  }, [filteredItems]);

  const toggleCategory = (category: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  const handleDragStart = (e: React.DragEvent, item: PlaceableItem) => {
    e.dataTransfer.setData("application/json", JSON.stringify(item));
    e.dataTransfer.effectAllowed = "copy";
    onSelectItem(item);
  };

  const handleItemClick = (item: PlaceableItem) => {
    onSelectItem(item);
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="flex flex-col h-full">
        <div className="p-4 border-b border-glass-border">
          <h3 className="text-sm font-semibold">Spawn Palette</h3>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <Loader2 className="w-6 h-6 mx-auto mb-2 animate-spin text-cyan-500" />
            <p className="text-xs text-muted-foreground">Loading entities...</p>
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="flex flex-col h-full">
        <div className="p-4 border-b border-glass-border">
          <h3 className="text-sm font-semibold">Spawn Palette</h3>
        </div>
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="text-center">
            <AlertCircle className="w-6 h-6 mx-auto mb-2 text-red-400" />
            <p className="text-xs text-red-400 mb-2">{error}</p>
            <button
              onClick={() => window.location.reload()}
              className="flex items-center gap-1 px-2 py-1 text-xs bg-glass-bg border border-glass-border rounded hover:border-cyan-500/30"
            >
              <RefreshCw className="w-3 h-3" />
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-glass-border">
        <h3 className="text-sm font-semibold mb-3">Spawn Palette</h3>

        {/* Search */}
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search entities..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-glass-bg border border-glass-border rounded-lg text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
          />
        </div>

        {/* Category Filter */}
        <div className="flex flex-wrap gap-1">
          {(Object.keys(CATEGORY_CONFIG) as CategoryType[]).map((key) => {
            const config = CATEGORY_CONFIG[key];
            const Icon = config.icon;
            return (
              <button
                key={key}
                onClick={() => setCategoryFilter(key)}
                className={cn(
                  "px-2 py-1 text-xs rounded-md flex items-center gap-1 transition-colors",
                  categoryFilter === key
                    ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"
                    : "bg-glass-bg border border-glass-border hover:border-cyan-500/30",
                )}
              >
                <Icon
                  className={cn(
                    "w-3 h-3",
                    categoryFilter === key ? "text-cyan-400" : config.color,
                  )}
                />
                {key !== "all" && config.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Entity List */}
      <div className="flex-1 overflow-y-auto p-2">
        {filteredItems.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">
            No entities found
          </div>
        ) : (
          Object.entries(groupedItems).map(([category, items]) => {
            if (items.length === 0) return null;

            const config = CATEGORY_CONFIG[category as CategoryType];
            const Icon = config.icon;
            const isExpanded = expandedCategories.has(category);

            return (
              <div key={category} className="mb-2">
                {/* Category Header */}
                <button
                  onClick={() => toggleCategory(category)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-glass-bg transition-colors"
                >
                  {isExpanded ? (
                    <ChevronDown className="w-3 h-3 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="w-3 h-3 text-muted-foreground" />
                  )}
                  <Icon className={cn("w-4 h-4", config.color)} />
                  <span className="text-xs font-medium">{config.label}</span>
                  <span className="text-xs text-muted-foreground ml-auto">
                    {items.length}
                  </span>
                </button>

                {/* Items */}
                {isExpanded && (
                  <div className="mt-1 ml-5 space-y-1">
                    {items.map((item) => (
                      <PaletteItem
                        key={`${item.type}-${item.entityId}`}
                        item={item}
                        config={config}
                        isSelected={
                          selectedItem?.entityId === item.entityId &&
                          selectedItem?.type === item.type
                        }
                        onDragStart={handleDragStart}
                        onClick={handleItemClick}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-glass-border text-xs text-muted-foreground">
        <div className="flex items-center justify-between">
          <span>Drag to place on grid</span>
          <span className="text-[10px]">{allItems.length} entities</span>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// PALETTE ITEM COMPONENT
// ============================================================================

interface PaletteItemProps {
  item: PlaceableItem;
  config: CategoryConfig;
  isSelected: boolean;
  onDragStart: (e: React.DragEvent, item: PlaceableItem) => void;
  onClick: (item: PlaceableItem) => void;
}

function PaletteItem({
  item,
  config,
  isSelected,
  onDragStart,
  onClick,
}: PaletteItemProps) {
  const Icon = config.icon;

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, item)}
      onClick={() => onClick(item)}
      className={cn(
        "flex items-center gap-2 p-2 rounded-lg border cursor-grab active:cursor-grabbing group transition-colors",
        isSelected
          ? "border-cyan-500 bg-cyan-500/10"
          : "border-glass-border bg-glass-bg/50 hover:border-cyan-500/30",
      )}
    >
      {/* Drag Handle */}
      <GripVertical className="w-3 h-3 text-muted-foreground/50 group-hover:text-muted-foreground" />

      {/* Icon */}
      <div
        className={cn(
          "w-6 h-6 rounded flex items-center justify-center",
          config.bgColor,
        )}
      >
        <Icon className={cn("w-3.5 h-3.5", config.color)} />
      </div>

      {/* Name */}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium truncate">{item.name}</p>
        <p className="text-[10px] text-muted-foreground truncate">
          {item.entityId}
        </p>
      </div>
    </div>
  );
}
