/**
 * Game Manifests Service
 *
 * Consolidated loading and caching of all game manifest files.
 * Loads at startup and provides typed access to all game data.
 *
 * Manifest files are the source of truth for:
 * - Items (weapons, armor, tools, resources)
 * - NPCs (mobs, shopkeepers, bankers)
 * - Resources (trees, rocks, fishing spots)
 * - Stores (shop inventories)
 * - Music (ambient, combat, theme tracks)
 * - Buildings (structures, props)
 *
 * World areas are loaded on-demand as they define runtime positions.
 */

import { promises as fs } from "fs";
import path from "path";
import { logger } from "@/lib/utils";

const log = logger.child("GameManifests");

// ============================================================================
// Path Configuration
// ============================================================================

const MANIFESTS_DIR =
  process.env.HYPERSCAPE_MANIFESTS_DIR ||
  path.resolve(process.cwd(), "..", "server", "world", "assets", "manifests");

// ============================================================================
// Type Definitions
// ============================================================================

// --- Items ---
export interface ItemBonuses {
  attack: number;
  strength: number;
  defense: number;
  ranged: number;
}

export interface ItemRequirements {
  level: number;
  skills: Record<string, number>;
}

export interface ItemDefinition {
  id: string;
  name: string;
  type: "weapon" | "armor" | "tool" | "resource" | "currency";
  value: number;
  weight: number;
  equipSlot?: string;
  weaponType?: string;
  attackType?: string;
  attackSpeed?: number;
  attackRange?: number;
  stackable?: boolean;
  maxStackSize?: number;
  description: string;
  examine: string;
  tradeable: boolean;
  rarity: "common" | "uncommon" | "rare" | "very_rare" | "legendary" | "always";
  modelPath: string | null;
  equippedModelPath?: string;
  iconPath: string;
  thumbnailPath?: string;
  bonuses?: ItemBonuses;
  requirements?: ItemRequirements;
}

// --- NPCs ---
export interface NpcStats {
  level: number;
  health: number;
  attack: number;
  strength: number;
  defense: number;
  ranged: number;
  magic: number;
}

export interface NpcCombat {
  attackable: boolean;
  aggressive?: boolean;
  retaliates?: boolean;
  aggroRange?: number;
  combatRange?: number;
  attackSpeedTicks?: number;
  respawnTicks?: number;
}

export interface NpcMovement {
  type: "stationary" | "wander" | "patrol";
  speed: number;
  wanderRadius: number;
}

export interface NpcServices {
  enabled: boolean;
  types: string[];
}

export interface DialogueNode {
  id: string;
  text: string;
  responses?: Array<{
    text: string;
    nextNodeId: string;
    effect?: string;
  }>;
}

export interface NpcDialogue {
  entryNodeId: string;
  nodes: DialogueNode[];
}

export interface NpcDropItem {
  itemId: string;
  minQuantity: number;
  maxQuantity: number;
  chance: number;
  rarity: string;
}

export interface NpcDrops {
  defaultDrop?: {
    enabled: boolean;
    itemId: string;
    quantity: number;
  };
  always: NpcDropItem[];
  common: NpcDropItem[];
  uncommon: NpcDropItem[];
  rare: NpcDropItem[];
  veryRare: NpcDropItem[];
}

export interface NpcAppearance {
  modelPath: string;
  iconPath: string;
  scale: number;
}

export interface NpcDefinition {
  id: string;
  name: string;
  description: string;
  category: "mob" | "neutral";
  faction: string;
  stats?: NpcStats;
  combat?: NpcCombat;
  movement?: NpcMovement;
  services?: NpcServices;
  dialogue?: NpcDialogue;
  drops?: NpcDrops;
  appearance?: NpcAppearance;
  spawnBiomes?: string[];
  // Optional flattened fields for backwards compatibility
  modelPath?: string;
  iconPath?: string;
  thumbnailPath?: string;
  level?: number;
  combatLevel?: number;
}

// --- Resources ---
export interface HarvestYield {
  itemId: string;
  itemName: string;
  quantity: number;
  chance: number;
  xpAmount: number;
  stackable: boolean;
}

export interface ResourceDefinition {
  id: string;
  name: string;
  type: string;
  examine: string;
  modelPath: string | null;
  depletedModelPath?: string | null;
  scale: number;
  depletedScale?: number;
  harvestSkill: string;
  toolRequired: string;
  levelRequired: number;
  baseCycleTicks: number;
  depleteChance: number;
  respawnTicks: number;
  harvestYield: HarvestYield[];
}

// --- Stores ---
export interface StoreItem {
  id: string;
  itemId: string;
  name: string;
  price: number;
  stockQuantity: number;
  restockTime: number;
  description: string;
  category: string;
}

export interface StoreDefinition {
  id: string;
  name: string;
  buyback: boolean;
  buybackRate: number;
  description: string;
  items: StoreItem[];
}

// --- Music ---
export interface MusicTrack {
  id: string;
  name: string;
  type: "theme" | "ambient" | "combat";
  category: string;
  path: string;
  description: string;
  duration: number;
  mood: string;
}

// --- Buildings ---
export interface BuildingDefinition {
  id: string;
  name: string;
  type: string;
  modelPath: string;
  scale?: number;
  interactable?: boolean;
}

// --- World Areas (loaded on demand) ---
export interface Position {
  x: number;
  y: number;
  z: number;
}

export interface NpcSpawn {
  id: string;
  type: string;
  storeId?: string;
  position: Position;
}

export interface ResourceSpawn {
  type: string;
  resourceId: string;
  position: Position;
}

export interface MobSpawn {
  mobId: string;
  position: Position;
  spawnRadius: number;
  maxCount: number;
}

/** Terrain tile definition for visual map features */
export interface TerrainTile {
  x: number;
  z: number;
  type: string; // "water" | "lake" | "road" | "path" | "rock" | "sand" | etc.
  walkable?: boolean;
}

export interface WorldArea {
  id: string;
  name: string;
  description: string;
  difficultyLevel: number;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  biomeType: string;
  safeZone: boolean;
  npcs: NpcSpawn[];
  resources: ResourceSpawn[];
  mobSpawns: MobSpawn[];
  /** Terrain features like lakes, roads, etc. */
  terrain?: TerrainTile[];
}

export interface WorldAreasConfig {
  starterTowns: Record<string, WorldArea>;
  level1Areas: Record<string, WorldArea>;
  level2Areas: Record<string, WorldArea>;
  level3Areas: Record<string, WorldArea>;
}

// ============================================================================
// Cached Data Store
// ============================================================================

interface ManifestCache {
  items: Map<string, ItemDefinition>;
  npcs: Map<string, NpcDefinition>;
  resources: Map<string, ResourceDefinition>;
  stores: Map<string, StoreDefinition>;
  music: Map<string, MusicTrack>;
  buildings: Map<string, BuildingDefinition>;
  loaded: boolean;
  loadedAt: Date | null;
}

const cache: ManifestCache = {
  items: new Map(),
  npcs: new Map(),
  resources: new Map(),
  stores: new Map(),
  music: new Map(),
  buildings: new Map(),
  loaded: false,
  loadedAt: null,
};

// ============================================================================
// File Reading Utilities
// ============================================================================

async function readManifest<T>(filename: string): Promise<T | null> {
  const filePath = path.join(MANIFESTS_DIR, filename);
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return JSON.parse(content) as T;
  } catch (error) {
    log.warn(`Failed to read manifest: ${filename}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

// ============================================================================
// Manifest Loading
// ============================================================================

/**
 * Load all static manifests into memory.
 * Call this at application startup.
 */
export async function loadAllManifests(): Promise<void> {
  if (cache.loaded) {
    log.debug("Manifests already loaded, skipping");
    return;
  }

  log.info("Loading game manifests...");
  const startTime = Date.now();

  // Load all manifests in parallel
  const [items, npcs, resources, stores, music, buildings] = await Promise.all([
    readManifest<ItemDefinition[]>("items.json"),
    readManifest<NpcDefinition[]>("npcs.json"),
    readManifest<ResourceDefinition[]>("resources.json"),
    readManifest<StoreDefinition[]>("stores.json"),
    readManifest<MusicTrack[]>("music.json"),
    readManifest<BuildingDefinition[]>("buildings.json"),
  ]);

  // Populate cache maps
  if (items) {
    for (const item of items) {
      cache.items.set(item.id, item);
    }
  }

  if (npcs) {
    for (const npc of npcs) {
      cache.npcs.set(npc.id, npc);
    }
  }

  if (resources) {
    for (const resource of resources) {
      cache.resources.set(resource.id, resource);
    }
  }

  if (stores) {
    for (const store of stores) {
      cache.stores.set(store.id, store);
    }
  }

  if (music) {
    for (const track of music) {
      cache.music.set(track.id, track);
    }
  }

  if (buildings) {
    for (const building of buildings) {
      cache.buildings.set(building.id, building);
    }
  }

  cache.loaded = true;
  cache.loadedAt = new Date();

  const elapsed = Date.now() - startTime;
  log.info("Game manifests loaded", {
    items: cache.items.size,
    npcs: cache.npcs.size,
    resources: cache.resources.size,
    stores: cache.stores.size,
    music: cache.music.size,
    buildings: cache.buildings.size,
    elapsed: `${elapsed}ms`,
  });
}

/**
 * Reload all manifests (for hot-reload during development)
 */
export async function reloadManifests(): Promise<void> {
  cache.items.clear();
  cache.npcs.clear();
  cache.resources.clear();
  cache.stores.clear();
  cache.music.clear();
  cache.buildings.clear();
  cache.loaded = false;
  cache.loadedAt = null;
  await loadAllManifests();
}

// ============================================================================
// Data Accessors (Static Data)
// ============================================================================

/**
 * Ensure manifests are loaded before accessing
 */
async function ensureLoaded(): Promise<void> {
  if (!cache.loaded) {
    await loadAllManifests();
  }
}

// --- Items ---
export async function getItem(id: string): Promise<ItemDefinition | undefined> {
  await ensureLoaded();
  return cache.items.get(id);
}

export async function getAllItems(): Promise<ItemDefinition[]> {
  await ensureLoaded();
  return Array.from(cache.items.values());
}

export async function getItemsByType(
  type: ItemDefinition["type"],
): Promise<ItemDefinition[]> {
  await ensureLoaded();
  return Array.from(cache.items.values()).filter((item) => item.type === type);
}

// --- NPCs ---
export async function getNpc(id: string): Promise<NpcDefinition | undefined> {
  await ensureLoaded();
  return cache.npcs.get(id);
}

export async function getAllNpcs(): Promise<NpcDefinition[]> {
  await ensureLoaded();
  return Array.from(cache.npcs.values());
}

export async function getMobs(): Promise<NpcDefinition[]> {
  await ensureLoaded();
  return Array.from(cache.npcs.values()).filter(
    (npc) => npc.category === "mob",
  );
}

export async function getNeutralNpcs(): Promise<NpcDefinition[]> {
  await ensureLoaded();
  return Array.from(cache.npcs.values()).filter(
    (npc) => npc.category === "neutral",
  );
}

// --- Resources ---
export async function getResource(
  id: string,
): Promise<ResourceDefinition | undefined> {
  await ensureLoaded();
  return cache.resources.get(id);
}

export async function getAllResources(): Promise<ResourceDefinition[]> {
  await ensureLoaded();
  return Array.from(cache.resources.values());
}

export async function getResourcesBySkill(
  skill: string,
): Promise<ResourceDefinition[]> {
  await ensureLoaded();
  return Array.from(cache.resources.values()).filter(
    (r) => r.harvestSkill === skill,
  );
}

// --- Stores ---
export async function getStore(
  id: string,
): Promise<StoreDefinition | undefined> {
  await ensureLoaded();
  return cache.stores.get(id);
}

export async function getAllStores(): Promise<StoreDefinition[]> {
  await ensureLoaded();
  return Array.from(cache.stores.values());
}

// --- Music ---
export async function getMusicTrack(
  id: string,
): Promise<MusicTrack | undefined> {
  await ensureLoaded();
  return cache.music.get(id);
}

export async function getAllMusic(): Promise<MusicTrack[]> {
  await ensureLoaded();
  return Array.from(cache.music.values());
}

export async function getMusicByCategory(
  category: string,
): Promise<MusicTrack[]> {
  await ensureLoaded();
  return Array.from(cache.music.values()).filter(
    (t) => t.category === category,
  );
}

export async function getMusicByMood(mood: string): Promise<MusicTrack[]> {
  await ensureLoaded();
  return Array.from(cache.music.values()).filter((t) => t.mood === mood);
}

// --- Buildings ---
export async function getBuilding(
  id: string,
): Promise<BuildingDefinition | undefined> {
  await ensureLoaded();
  return cache.buildings.get(id);
}

export async function getAllBuildings(): Promise<BuildingDefinition[]> {
  await ensureLoaded();
  return Array.from(cache.buildings.values());
}

// ============================================================================
// World Areas (Loaded On-Demand)
// ============================================================================

/**
 * Load world areas configuration.
 * This is loaded on-demand as it contains runtime spawn positions.
 */
export async function loadWorldAreas(): Promise<WorldAreasConfig | null> {
  return readManifest<WorldAreasConfig>("world-areas.json");
}

/**
 * Get all areas as a flat array
 */
export async function getAllAreas(): Promise<WorldArea[]> {
  const config = await loadWorldAreas();
  if (!config) return [];

  return [
    ...Object.values(config.starterTowns || {}),
    ...Object.values(config.level1Areas || {}),
    ...Object.values(config.level2Areas || {}),
    ...Object.values(config.level3Areas || {}),
  ];
}

/**
 * Get a specific area by ID
 */
export async function getArea(id: string): Promise<WorldArea | undefined> {
  const areas = await getAllAreas();
  return areas.find((a) => a.id === id);
}

// ============================================================================
// Aggregated Entity Data
// ============================================================================

export interface WorldEntity {
  id: string;
  name: string;
  type: string;
  position: Position;
  scale?: Position;
  modelPath?: string;
  spawnArea: string;
  metadata: Record<string, unknown>;
}

/**
 * Get all entities from world areas with their full definitions.
 * Joins spawn positions with NPC/resource definitions.
 */
export async function getWorldEntities(): Promise<{
  entities: WorldEntity[];
  areas: Array<{ id: string; name: string; entityCount: number }>;
}> {
  await ensureLoaded();
  const worldAreas = await loadWorldAreas();

  if (!worldAreas) {
    return { entities: [], areas: [] };
  }

  const entities: WorldEntity[] = [];
  const areaSummaries: Array<{
    id: string;
    name: string;
    entityCount: number;
  }> = [];

  const allAreaCategories = [
    worldAreas.starterTowns,
    worldAreas.level1Areas,
    worldAreas.level2Areas,
    worldAreas.level3Areas,
  ];

  for (const areaCategory of allAreaCategories) {
    if (!areaCategory) continue;

    for (const area of Object.values(areaCategory)) {
      let entityCount = 0;

      // Process NPCs
      if (area.npcs) {
        for (const spawn of area.npcs) {
          const def = cache.npcs.get(spawn.id);
          entities.push({
            id: `${area.id}_${spawn.id}_${Math.round(spawn.position.x)}_${Math.round(spawn.position.z)}`,
            name: def?.name || spawn.id,
            type:
              spawn.type === "bank"
                ? "bank"
                : def?.category === "mob"
                  ? "mob"
                  : "npc",
            position: spawn.position,
            scale: def?.appearance?.scale
              ? {
                  x: def.appearance.scale,
                  y: def.appearance.scale,
                  z: def.appearance.scale,
                }
              : undefined,
            modelPath: def?.appearance?.modelPath,
            spawnArea: area.id,
            metadata: {
              npcId: spawn.id,
              storeId: spawn.storeId,
              category: def?.category,
              faction: def?.faction,
              hasDialogue: Boolean(def?.dialogue),
              hasServices: Boolean(def?.services?.enabled),
            },
          });
          entityCount++;
        }
      }

      // Process Resources
      if (area.resources) {
        for (const spawn of area.resources) {
          const def = cache.resources.get(spawn.resourceId);
          entities.push({
            id: `${area.id}_${spawn.resourceId}_${Math.round(spawn.position.x)}_${Math.round(spawn.position.z)}`,
            name: def?.name || spawn.resourceId,
            type: "resource",
            position: spawn.position,
            scale: def?.scale
              ? { x: def.scale, y: def.scale, z: def.scale }
              : undefined,
            modelPath: def?.modelPath || undefined,
            spawnArea: area.id,
            metadata: {
              resourceId: spawn.resourceId,
              resourceType: spawn.type,
              harvestSkill: def?.harvestSkill,
              levelRequired: def?.levelRequired,
              toolRequired: def?.toolRequired,
            },
          });
          entityCount++;
        }
      }

      // Process Mobs
      if (area.mobSpawns) {
        for (const spawn of area.mobSpawns) {
          const def = cache.npcs.get(spawn.mobId);
          entities.push({
            id: `${area.id}_${spawn.mobId}_${Math.round(spawn.position.x)}_${Math.round(spawn.position.z)}`,
            name: def?.name || spawn.mobId,
            type: "mob",
            position: spawn.position,
            scale: def?.appearance?.scale
              ? {
                  x: def.appearance.scale,
                  y: def.appearance.scale,
                  z: def.appearance.scale,
                }
              : undefined,
            modelPath: def?.appearance?.modelPath,
            spawnArea: area.id,
            metadata: {
              mobId: spawn.mobId,
              spawnRadius: spawn.spawnRadius,
              maxCount: spawn.maxCount,
              stats: def?.stats,
              hasDrops: Boolean(def?.drops),
            },
          });
          entityCount++;
        }
      }

      areaSummaries.push({
        id: area.id,
        name: area.name,
        entityCount,
      });
    }
  }

  return { entities, areas: areaSummaries };
}

// ============================================================================
// Cache Status
// ============================================================================

export function getManifestStatus(): {
  loaded: boolean;
  loadedAt: Date | null;
  counts: {
    items: number;
    npcs: number;
    resources: number;
    stores: number;
    music: number;
    buildings: number;
  };
} {
  return {
    loaded: cache.loaded,
    loadedAt: cache.loadedAt,
    counts: {
      items: cache.items.size,
      npcs: cache.npcs.size,
      resources: cache.resources.size,
      stores: cache.stores.size,
      music: cache.music.size,
      buildings: cache.buildings.size,
    },
  };
}
