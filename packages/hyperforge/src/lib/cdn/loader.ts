/**
 * CDN Asset Loader
 * Loads assets from game CDN manifests (same as the game uses)
 * In development, reads directly from server package manifests
 */

import type {
  CDNAsset,
  ItemManifest,
  NPCManifest,
  ResourceManifest,
  MusicManifest,
  BiomeManifest,
  HyperForgeAsset,
} from "./types";
import path from "path";
import fs from "fs/promises";
import { logger } from "@/lib/utils";

const log = logger.child("CDNLoader");

const CDN_URL = process.env.NEXT_PUBLIC_CDN_URL || "http://localhost:8080";

const IS_DEV = process.env.NODE_ENV === "development";

// Path to manifests in development (relative to monorepo root)
const MANIFESTS_PATH = path.resolve(
  process.cwd(),
  "../server/world/assets/manifests",
);

// Path to avatars directory
const AVATARS_PATH = path.resolve(
  process.cwd(),
  "../server/world/assets/avatars",
);

// Path to emotes directory
const EMOTES_PATH = path.resolve(
  process.cwd(),
  "../server/world/assets/emotes",
);

/**
 * Load manifest from file system (development)
 */
async function loadManifestFromFS<T>(filename: string): Promise<T[]> {
  try {
    const filePath = path.join(MANIFESTS_PATH, filename);
    const content = await fs.readFile(filePath, "utf-8");
    return JSON.parse(content) as T[];
  } catch (error) {
    log.warn(`Could not read ${filename}`, { error });
    return [];
  }
}

/**
 * Load manifest from CDN (production)
 */
async function loadManifestFromCDN<T>(filename: string): Promise<T[]> {
  try {
    const res = await fetch(`${CDN_URL}/manifests/${filename}`);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return res.json() as Promise<T[]>;
  } catch (error) {
    log.warn(`Could not fetch ${filename}`, { error });
    return [];
  }
}

/**
 * Load all CDN manifests
 */
export async function loadCDNManifests(): Promise<{
  items: ItemManifest[];
  npcs: NPCManifest[];
  resources: ResourceManifest[];
  music: MusicManifest[];
  biomes: BiomeManifest[];
}> {
  if (IS_DEV) {
    // Development: read from file system
    const [items, npcs, resources, music, biomes] = await Promise.all([
      loadManifestFromFS<ItemManifest>("items.json"),
      loadManifestFromFS<NPCManifest>("npcs.json"),
      loadManifestFromFS<ResourceManifest>("resources.json"),
      loadManifestFromFS<MusicManifest>("music.json"),
      loadManifestFromFS<BiomeManifest>("biomes.json"),
    ]);
    return { items, npcs, resources, music, biomes };
  }

  // Production: fetch from CDN
  const [items, npcs, resources, music, biomes] = await Promise.all([
    loadManifestFromCDN<ItemManifest>("items.json"),
    loadManifestFromCDN<NPCManifest>("npcs.json"),
    loadManifestFromCDN<ResourceManifest>("resources.json"),
    loadManifestFromCDN<MusicManifest>("music.json"),
    loadManifestFromCDN<BiomeManifest>("biomes.json"),
  ]);
  return { items, npcs, resources, music, biomes };
}

/**
 * Convert item manifest to CDN asset with full metadata
 */
function itemToCDNAsset(item: ItemManifest): CDNAsset {
  const modelPath = item.modelPath || "";
  const hasVRM = modelPath.endsWith(".vrm");

  return {
    id: item.id,
    name: item.name,
    source: "CDN",
    modelPath,
    thumbnailPath: item.iconPath || item.thumbnailPath,
    iconPath: item.iconPath,
    category: mapItemTypeToCategory(item.type),
    rarity: item.rarity,
    type: item.type,
    description: item.description || item.examine,
    examine: item.examine,

    // VRM support
    hasVRM,
    vrmPath: hasVRM ? modelPath : undefined,

    // Item metadata
    value: item.value,
    weight: item.weight,
    stackable: item.stackable,
    tradeable: item.tradeable,

    // Equipment metadata
    equipSlot: item.equipSlot,
    weaponType: item.weaponType,
    attackType: item.attackType,
    equippedModelPath: item.equippedModelPath,

    // Combat stats
    bonuses: item.bonuses,

    // Requirements
    requirements: item.requirements,
    levelRequired: item.requirements?.level,
  };
}

/**
 * Map item types to CDN asset categories
 */
function mapItemTypeToCategory(type: string): CDNAsset["category"] {
  const mapping: Record<string, CDNAsset["category"]> = {
    weapon: "weapon",
    armor: "armor",
    tool: "tool",
    consumable: "item",
    quest: "item",
    resource: "resource",
    material: "resource",
    currency: "currency",
  };
  return mapping[type] || "item";
}

/**
 * Convert NPC manifest to CDN asset with full metadata
 */
function npcToCDNAsset(npc: NPCManifest): CDNAsset {
  // Get model path from appearance or direct field
  const modelPath = npc.appearance?.modelPath || npc.modelPath || "";
  const iconPath = npc.appearance?.iconPath || npc.iconPath;
  const hasVRM = modelPath.endsWith(".vrm");

  return {
    id: npc.id,
    name: npc.name,
    source: "CDN",
    modelPath,
    thumbnailPath: iconPath || npc.thumbnailPath,
    iconPath,
    category: "npc",
    type: npc.category,
    subtype: npc.category,
    description: npc.description,

    // VRM support
    hasVRM,
    vrmPath: hasVRM ? modelPath : undefined,

    // NPC-specific
    npcCategory: npc.category,
    faction: npc.faction,
    level: npc.stats?.level || npc.level,
    combatLevel: npc.stats?.level,
    attackable: npc.combat?.attackable,
  };
}

/**
 * Convert resource manifest to CDN asset with full metadata
 */
function resourceToCDNAsset(resource: ResourceManifest): CDNAsset {
  return {
    id: resource.id,
    name: resource.name,
    source: "CDN",
    modelPath: resource.modelPath || "",
    category: "resource",
    type: resource.type,
    subtype: resource.type,
    description: resource.examine,
    examine: resource.examine,

    // Resource-specific
    harvestSkill: resource.harvestSkill,
    toolRequired: resource.toolRequired || undefined,
    levelRequired: resource.levelRequired,
  };
}

/**
 * Load VRM avatar files from avatars directory
 */
async function loadVRMAvatars(): Promise<CDNAsset[]> {
  if (!IS_DEV) {
    // In production, VRM avatars would be served from CDN
    // For now, only load in development
    return [];
  }

  try {
    const entries = await fs.readdir(AVATARS_PATH, { withFileTypes: true });
    const vrmFiles = entries
      .filter((e) => e.isFile() && e.name.endsWith(".vrm"))
      .map((e) => e.name);

    return vrmFiles.map((filename): CDNAsset => {
      const id = filename.replace(".vrm", "");
      const name = formatAvatarName(id);

      return {
        id,
        name,
        source: "CDN",
        modelPath: `avatars/${filename}`,
        vrmPath: `avatars/${filename}`,
        hasVRM: true,
        category: "npc", // Avatars show in character/NPC section
        type: "avatar",
        subtype: "character",
        description: `VRM avatar: ${name}`,
      };
    });
  } catch (error) {
    log.warn("Could not load VRM avatars", { error });
    return [];
  }
}

/**
 * Load emote animation files from emotes directory
 */
async function loadEmotes(): Promise<CDNAsset[]> {
  if (!IS_DEV) {
    return [];
  }

  try {
    const entries = await fs.readdir(EMOTES_PATH, { withFileTypes: true });
    const emoteFiles = entries
      .filter((e) => e.isFile() && e.name.endsWith(".glb"))
      .map((e) => e.name);

    return emoteFiles.map((filename): CDNAsset => {
      const id = filename.replace(".glb", "");
      const name = formatEmoteName(id);

      return {
        id,
        name,
        source: "CDN",
        modelPath: `emotes/${filename}`,
        category: "item", // Using item for animations
        type: "emote",
        subtype: "animation",
        description: `Animation: ${name}`,
      };
    });
  } catch (error) {
    log.warn("Could not load emotes", { error });
    return [];
  }
}

/**
 * Format avatar filename into display name
 * e.g. "avatar-female-01" → "Avatar Female 01"
 */
function formatAvatarName(id: string): string {
  return id
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Format emote filename into display name
 * e.g. "emote-dance-happy" → "Dance Happy"
 */
function formatEmoteName(id: string): string {
  return id
    .replace(/^emote[-_]?/, "") // Remove "emote" prefix
    .split(/[-_]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Convert music manifest to CDN asset
 */
function musicToCDNAsset(music: MusicManifest): CDNAsset {
  return {
    id: music.id,
    name: music.name,
    source: "CDN",
    modelPath: music.path,
    category: "music",
    type: music.type,
    subtype: music.category,
    description: music.description,
  };
}

/**
 * Convert biome manifest to CDN asset
 */
function biomeToCDNAsset(biome: BiomeManifest): CDNAsset {
  return {
    id: biome.id,
    name: biome.name,
    source: "CDN",
    modelPath: "",
    category: "biome",
    type: "biome",
    subtype: biome.terrain,
    description: biome.description,
    levelRequired: biome.difficultyLevel || biome.difficulty,
  };
}

/**
 * Load all CDN assets and convert to unified format
 */
export async function loadCDNAssets(): Promise<CDNAsset[]> {
  const [{ items, npcs, resources, music, biomes }, vrmAvatars] =
    await Promise.all([loadCDNManifests(), loadVRMAvatars()]);

  const assets: CDNAsset[] = [
    // VRM avatars first (they're important!)
    ...vrmAvatars,
    // Game items
    ...items.map(itemToCDNAsset),
    // NPCs
    ...npcs.map(npcToCDNAsset),
    // Resources
    ...resources.map(resourceToCDNAsset),
    // Music (for audio studio)
    ...music.map(musicToCDNAsset),
    // Biomes (for world building)
    ...biomes.map(biomeToCDNAsset),
  ];

  return assets;
}

/**
 * Load emotes for VRM animation testing
 * Separate from main assets - only used in Retarget/Animate page
 */
export async function loadVRMEmotes(): Promise<
  { id: string; name: string; path: string }[]
> {
  const emotes = await loadEmotes();
  return emotes.map((e) => ({
    id: e.id,
    name: e.name,
    path: e.modelPath,
  }));
}

/**
 * Get asset model URL (resolves asset:// protocol)
 */
export function getAssetModelUrl(asset: HyperForgeAsset): string {
  if (asset.source === "CDN") {
    // CDN assets use asset:// protocol, resolve to CDN URL
    if (asset.modelPath.startsWith("asset://")) {
      return asset.modelPath.replace("asset://", `${CDN_URL}/`);
    }
    return `${CDN_URL}/${asset.modelPath}`;
  }

  if (asset.source === "LOCAL") {
    // Local assets served from Next.js API with .glb extension
    return `/api/assets/${asset.id}/model.glb`;
  }

  // Base assets
  if (asset.modelPath.startsWith("asset://")) {
    return asset.modelPath.replace("asset://", `${CDN_URL}/`);
  }
  return asset.modelPath;
}
