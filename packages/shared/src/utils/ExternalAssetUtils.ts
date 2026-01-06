/**
 * External Asset Utilities
 * Helper functions to access assets loaded from 3D Asset Forge manifests
 */

import { ALL_NPCS } from "../data/npcs";
import type { NPCData } from "../types/core/core";
import type {
  ExternalResourceData,
  GatheringToolData,
} from "../data/DataManager";

interface ExternalBuilding {
  id: string;
  name: string;
  type: string;
  modelPath: string;
  iconPath?: string;
  description: string;
}

interface ExternalAvatar {
  id: string;
  name: string;
  description: string;
  type: string;
  isRigged: boolean;
  characterHeight: number;
  modelPath: string;
  animations?: { idle?: string; walk?: string; run?: string };
}

/**
 * Get all NPCs loaded from manifests
 */
export function getExternalNPCs(): Map<string, NPCData> {
  return ALL_NPCS;
}

/**
 * Get NPC by ID
 */
export function getExternalNPC(id: string): NPCData | null {
  return ALL_NPCS.get(id) || null;
}

/**
 * Get all external resources loaded from manifests
 */
export function getExternalResources(): Map<string, ExternalResourceData> {
  const resources = (
    globalThis as { EXTERNAL_RESOURCES?: Map<string, ExternalResourceData> }
  ).EXTERNAL_RESOURCES;
  return resources || new Map();
}

/**
 * Get external resource by ID
 */
export function getExternalResource(id: string): ExternalResourceData | null {
  const resources = getExternalResources();
  return resources.get(id) || null;
}

/**
 * Get all external buildings loaded from manifests
 */
export function getExternalBuildings(): Map<string, ExternalBuilding> {
  const buildings = (
    globalThis as { EXTERNAL_BUILDINGS?: Map<string, ExternalBuilding> }
  ).EXTERNAL_BUILDINGS;
  return buildings || new Map();
}

/**
 * Get external building by ID
 */
export function getExternalBuilding(id: string): ExternalBuilding | null {
  const buildings = getExternalBuildings();
  return buildings.get(id) || null;
}

/**
 * Get all external avatars loaded from manifests
 */
export function getExternalAvatars(): Map<string, ExternalAvatar> {
  const avatars = (
    globalThis as { EXTERNAL_AVATARS?: Map<string, ExternalAvatar> }
  ).EXTERNAL_AVATARS;
  return avatars || new Map();
}

/**
 * Get external avatar by ID
 */
export function getExternalAvatar(id: string): ExternalAvatar | null {
  const avatars = getExternalAvatars();
  return avatars.get(id) || null;
}

/**
 * Get all external gathering tools loaded from manifests
 */
export function getExternalTools(): Map<string, GatheringToolData> {
  const tools = (
    globalThis as { EXTERNAL_TOOLS?: Map<string, GatheringToolData> }
  ).EXTERNAL_TOOLS;
  return tools || new Map();
}

/**
 * Get external tool by item ID
 */
export function getExternalTool(itemId: string): GatheringToolData | null {
  const tools = getExternalTools();
  return tools.get(itemId) || null;
}

/**
 * Get all tools for a specific skill, sorted by priority (best first)
 */
export function getExternalToolsForSkill(
  skill: "woodcutting" | "mining" | "fishing",
): GatheringToolData[] {
  const tools = getExternalTools();
  return Array.from(tools.values())
    .filter((t) => t.skill === skill)
    .sort((a, b) => a.priority - b.priority);
}

/**
 * Check if external assets are loaded
 */
export function hasExternalAssets(): boolean {
  return (
    getExternalNPCs().size > 0 ||
    getExternalResources().size > 0 ||
    getExternalBuildings().size > 0 ||
    getExternalAvatars().size > 0 ||
    getExternalTools().size > 0
  );
}

/**
 * Get summary of loaded external assets
 */
export function getExternalAssetsSummary(): {
  npcs: number;
  resources: number;
  buildings: number;
  avatars: number;
  tools: number;
  total: number;
} {
  return {
    npcs: getExternalNPCs().size,
    resources: getExternalResources().size,
    buildings: getExternalBuildings().size,
    avatars: getExternalAvatars().size,
    tools: getExternalTools().size,
    total:
      getExternalNPCs().size +
      getExternalResources().size +
      getExternalBuildings().size +
      getExternalAvatars().size +
      getExternalTools().size,
  };
}
