"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Globe,
  RefreshCw,
  Plus,
  Trash2,
  ChevronRight,
  ChevronDown,
  Box,
  User,
  Sword,
  TreeDeciduous,
  Building,
  Gem,
  X,
  Search,
  Eye,
  EyeOff,
} from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { SpectacularButton } from "@/components/ui/spectacular-button";
import { Badge } from "@/components/ui/badge";
import { NeonInput } from "@/components/ui/neon-input";
import { cn, logger } from "@/lib/utils";

const log = logger.child("WorldView");

// Entity types that can exist in the game world
type EntityType =
  | "player"
  | "npc"
  | "mob"
  | "item"
  | "resource"
  | "building"
  | "prop";

interface WorldEntity {
  id: string;
  name: string;
  type: EntityType;
  position: { x: number; y: number; z: number };
  rotation?: { x: number; y: number; z: number };
  scale?: { x: number; y: number; z: number };
  modelPath?: string;
  spawnArea?: string;
  metadata?: Record<string, unknown>;
  isActive?: boolean;
  loadedAt?: string;
}

interface WorldArea {
  id: string;
  name: string;
  entities: WorldEntity[];
}

const entityTypeIcons: Record<EntityType, typeof Box> = {
  player: User,
  npc: User,
  mob: Sword,
  item: Gem,
  resource: TreeDeciduous,
  building: Building,
  prop: Box,
};

const entityTypeColors: Record<EntityType, string> = {
  player: "text-cyan-400 bg-cyan-500/20",
  npc: "text-green-400 bg-green-500/20",
  mob: "text-red-400 bg-red-500/20",
  item: "text-amber-400 bg-amber-500/20",
  resource: "text-emerald-400 bg-emerald-500/20",
  building: "text-purple-400 bg-purple-500/20",
  prop: "text-gray-400 bg-gray-500/20",
};

interface EntityRowProps {
  entity: WorldEntity;
  onRemove: (id: string) => void;
  onToggleVisibility: (id: string) => void;
}

function EntityRow({ entity, onRemove, onToggleVisibility }: EntityRowProps) {
  const [expanded, setExpanded] = useState(false);
  const Icon = entityTypeIcons[entity.type];

  return (
    <div className="border border-glass-border rounded-lg overflow-hidden">
      {/* Entity Header */}
      <div
        className="flex items-center gap-2 p-2 hover:bg-glass-bg/50 cursor-pointer transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <button className="p-0.5">
          {expanded ? (
            <ChevronDown className="w-3 h-3 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-3 h-3 text-muted-foreground" />
          )}
        </button>

        <div className={cn("p-1.5 rounded", entityTypeColors[entity.type])}>
          <Icon className="w-3 h-3" />
        </div>

        <span className="flex-1 text-sm font-medium truncate">
          {entity.name}
        </span>

        <Badge variant="outline" className="text-xs capitalize">
          {entity.type}
        </Badge>

        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleVisibility(entity.id);
          }}
          className="p-1 hover:bg-glass-bg rounded transition-colors"
          title={entity.isActive ? "Hide" : "Show"}
        >
          {entity.isActive !== false ? (
            <Eye className="w-3 h-3 text-muted-foreground" />
          ) : (
            <EyeOff className="w-3 h-3 text-muted-foreground" />
          )}
        </button>

        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove(entity.id);
          }}
          className="p-1 hover:bg-red-500/20 hover:text-red-400 rounded transition-colors"
          title="Remove"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>

      {/* Expanded Metadata */}
      {expanded && (
        <div className="px-3 pb-3 pt-1 border-t border-glass-border bg-glass-bg/30 space-y-2 text-xs">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <span className="text-muted-foreground">ID:</span>
              <span className="ml-1 font-mono">{entity.id}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Type:</span>
              <span className="ml-1 capitalize">{entity.type}</span>
            </div>
          </div>

          <div>
            <span className="text-muted-foreground">Position:</span>
            <span className="ml-1 font-mono">
              ({entity.position.x.toFixed(2)}, {entity.position.y.toFixed(2)},{" "}
              {entity.position.z.toFixed(2)})
            </span>
          </div>

          {entity.rotation && (
            <div>
              <span className="text-muted-foreground">Rotation:</span>
              <span className="ml-1 font-mono">
                ({entity.rotation.x.toFixed(2)}, {entity.rotation.y.toFixed(2)},{" "}
                {entity.rotation.z.toFixed(2)})
              </span>
            </div>
          )}

          {entity.scale && (
            <div>
              <span className="text-muted-foreground">Scale:</span>
              <span className="ml-1 font-mono">
                ({entity.scale.x.toFixed(2)}, {entity.scale.y.toFixed(2)},{" "}
                {entity.scale.z.toFixed(2)})
              </span>
            </div>
          )}

          {entity.modelPath && (
            <div>
              <span className="text-muted-foreground">Model:</span>
              <span className="ml-1 font-mono text-cyan-400 truncate block">
                {entity.modelPath}
              </span>
            </div>
          )}

          {entity.spawnArea && (
            <div>
              <span className="text-muted-foreground">Spawn Area:</span>
              <span className="ml-1">{entity.spawnArea}</span>
            </div>
          )}

          {entity.loadedAt && (
            <div>
              <span className="text-muted-foreground">Loaded:</span>
              <span className="ml-1">
                {new Date(entity.loadedAt).toLocaleString()}
              </span>
            </div>
          )}

          {entity.metadata && Object.keys(entity.metadata).length > 0 && (
            <div className="pt-2 border-t border-glass-border">
              <span className="text-muted-foreground block mb-1">
                Metadata:
              </span>
              <pre className="bg-glass-bg p-2 rounded text-[10px] overflow-x-auto">
                {JSON.stringify(entity.metadata, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface WorldViewProps {
  isOpen: boolean;
  onClose: () => void;
}

export function WorldView({ isOpen, onClose }: WorldViewProps) {
  const [entities, setEntities] = useState<WorldEntity[]>([]);
  const [areas, setAreas] = useState<WorldArea[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<EntityType | "all">("all");
  const [showAddPanel, setShowAddPanel] = useState(false);

  // New entity form state
  const [newEntity, setNewEntity] = useState<Partial<WorldEntity>>({
    name: "",
    type: "prop",
    position: { x: 0, y: 0, z: 0 },
  });

  // Fetch world data from real API
  const fetchWorldData = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/world/entities");
      if (res.ok) {
        const data = await res.json();
        setEntities(data.entities || []);
        setAreas(data.areas || []);
      } else {
        // API returned error - show empty state
        log.warn("World API returned error:", res.status);
        setEntities([]);
        setAreas([]);
      }
    } catch (error) {
      log.error("Failed to fetch world data:", error);
      setEntities([]);
      setAreas([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      fetchWorldData();
    }
  }, [isOpen, fetchWorldData]);

  // Filter entities
  const filteredEntities = entities.filter((entity) => {
    const matchesSearch =
      entity.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      entity.id.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType = typeFilter === "all" || entity.type === typeFilter;
    return matchesSearch && matchesType;
  });

  // Group entities by type
  const groupedEntities = filteredEntities.reduce(
    (acc, entity) => {
      if (!acc[entity.type]) acc[entity.type] = [];
      acc[entity.type].push(entity);
      return acc;
    },
    {} as Record<EntityType, WorldEntity[]>,
  );

  const handleRemoveEntity = async (id: string) => {
    // Optimistically remove from UI
    const previousEntities = [...entities];
    setEntities((prev) => prev.filter((e) => e.id !== id));

    try {
      const res = await fetch(`/api/world/entities/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        // Restore on failure
        setEntities(previousEntities);
        log.error("Failed to remove entity:", await res.text());
      }
    } catch (error) {
      // Restore on failure
      setEntities(previousEntities);
      log.error("Failed to remove entity:", error);
    }
  };

  const handleToggleVisibility = (id: string) => {
    setEntities((prev) =>
      prev.map((e) =>
        e.id === id
          ? { ...e, isActive: e.isActive === false ? true : false }
          : e,
      ),
    );
  };

  const handleAddEntity = async () => {
    if (!newEntity.name || !newEntity.type) return;

    const entity: WorldEntity = {
      id: `${newEntity.type}_${Date.now()}`,
      name: newEntity.name,
      type: newEntity.type as EntityType,
      position: newEntity.position || { x: 0, y: 0, z: 0 },
      isActive: true,
      loadedAt: new Date().toISOString(),
    };

    setEntities((prev) => [...prev, entity]);
    setNewEntity({ name: "", type: "prop", position: { x: 0, y: 0, z: 0 } });
    setShowAddPanel(false);

    try {
      await fetch("/api/world/entities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entity),
      });
    } catch (error) {
      log.error("Failed to add entity:", error);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <GlassPanel
        intensity="high"
        className="w-full max-w-4xl max-h-[85vh] flex flex-col m-4"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-glass-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center">
              <Globe className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="font-bold text-lg">World View</h2>
              <p className="text-xs text-muted-foreground">
                {entities.length} entities loaded • {areas.length} areas
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <SpectacularButton
              variant="ghost"
              size="sm"
              onClick={fetchWorldData}
              disabled={isLoading}
            >
              <RefreshCw
                className={cn("w-4 h-4", isLoading && "animate-spin")}
              />
            </SpectacularButton>
            <SpectacularButton
              variant="ghost"
              size="sm"
              onClick={() => setShowAddPanel(!showAddPanel)}
            >
              <Plus className="w-4 h-4" />
            </SpectacularButton>
            <SpectacularButton variant="ghost" size="sm" onClick={onClose}>
              <X className="w-4 h-4" />
            </SpectacularButton>
          </div>
        </div>

        {/* Add Entity Panel */}
        {showAddPanel && (
          <div className="p-4 border-b border-glass-border bg-glass-bg/30">
            <div className="grid grid-cols-4 gap-3">
              <NeonInput
                placeholder="Entity name..."
                value={newEntity.name || ""}
                onChange={(e) =>
                  setNewEntity({ ...newEntity, name: e.target.value })
                }
              />
              <select
                value={newEntity.type}
                onChange={(e) =>
                  setNewEntity({
                    ...newEntity,
                    type: e.target.value as EntityType,
                  })
                }
                className="px-3 py-2 bg-glass-bg border border-glass-border rounded-lg text-sm"
              >
                <option value="prop">Prop</option>
                <option value="npc">NPC</option>
                <option value="mob">Mob</option>
                <option value="item">Item</option>
                <option value="resource">Resource</option>
                <option value="building">Building</option>
              </select>
              <div className="flex gap-1">
                <input
                  type="number"
                  placeholder="X"
                  value={newEntity.position?.x || 0}
                  onChange={(e) =>
                    setNewEntity({
                      ...newEntity,
                      position: {
                        ...newEntity.position!,
                        x: parseFloat(e.target.value) || 0,
                      },
                    })
                  }
                  className="w-full px-2 py-2 bg-glass-bg border border-glass-border rounded text-sm text-center"
                />
                <input
                  type="number"
                  placeholder="Y"
                  value={newEntity.position?.y || 0}
                  onChange={(e) =>
                    setNewEntity({
                      ...newEntity,
                      position: {
                        ...newEntity.position!,
                        y: parseFloat(e.target.value) || 0,
                      },
                    })
                  }
                  className="w-full px-2 py-2 bg-glass-bg border border-glass-border rounded text-sm text-center"
                />
                <input
                  type="number"
                  placeholder="Z"
                  value={newEntity.position?.z || 0}
                  onChange={(e) =>
                    setNewEntity({
                      ...newEntity,
                      position: {
                        ...newEntity.position!,
                        z: parseFloat(e.target.value) || 0,
                      },
                    })
                  }
                  className="w-full px-2 py-2 bg-glass-bg border border-glass-border rounded text-sm text-center"
                />
              </div>
              <SpectacularButton
                variant="primary"
                size="sm"
                onClick={handleAddEntity}
                disabled={!newEntity.name}
              >
                Add Entity
              </SpectacularButton>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="p-4 border-b border-glass-border flex gap-3">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search entities..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-glass-bg border border-glass-border rounded-lg text-sm"
            />
          </div>
          <select
            value={typeFilter}
            onChange={(e) =>
              setTypeFilter(e.target.value as EntityType | "all")
            }
            className="px-3 py-2 bg-glass-bg border border-glass-border rounded-lg text-sm"
          >
            <option value="all">All Types</option>
            <option value="player">Players</option>
            <option value="npc">NPCs</option>
            <option value="mob">Mobs</option>
            <option value="item">Items</option>
            <option value="resource">Resources</option>
            <option value="building">Buildings</option>
            <option value="prop">Props</option>
          </select>
        </div>

        {/* Entity List */}
        <div className="flex-1 overflow-y-auto p-4 themed-scrollbar">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="w-8 h-8 animate-spin text-cyan-400" />
            </div>
          ) : filteredEntities.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Globe className="w-12 h-12 mx-auto mb-4 opacity-30" />
              <p>No entities found</p>
              <p className="text-xs mt-1">
                Try adjusting your search or add new entities
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {Object.entries(groupedEntities).map(([type, typeEntities]) => (
                <div key={type}>
                  <div className="flex items-center gap-2 mb-2">
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-xs capitalize",
                        entityTypeColors[type as EntityType],
                      )}
                    >
                      {type}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      ({typeEntities.length})
                    </span>
                  </div>
                  <div className="space-y-2">
                    {typeEntities.map((entity) => (
                      <EntityRow
                        key={entity.id}
                        entity={entity}
                        onRemove={handleRemoveEntity}
                        onToggleVisibility={handleToggleVisibility}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer Stats */}
        <div className="p-3 border-t border-glass-border flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-4">
            {Object.entries(
              entities.reduce(
                (acc, e) => {
                  acc[e.type] = (acc[e.type] || 0) + 1;
                  return acc;
                },
                {} as Record<string, number>,
              ),
            ).map(([type, count]) => (
              <span key={type} className="capitalize">
                {type}: {count}
              </span>
            ))}
          </div>
          <span>
            {entities.filter((e) => e.isActive !== false).length} active
          </span>
        </div>
      </GlassPanel>
    </div>
  );
}
