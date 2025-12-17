import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { logger } from "@/lib/utils";

const log = logger.child("API:game:data");

// Path to the manifests directory
const MANIFESTS_DIR = path.join(
  process.cwd(),
  "..",
  "server",
  "world",
  "assets",
  "manifests",
);

export interface ResourceData {
  id: string;
  name: string;
  type: string;
  examine?: string;
  harvestSkill: string;
  toolRequired: string;
  levelRequired: number;
  baseCycleTicks: number;
  depleteChance: number;
  respawnTicks: number;
  harvestYield: Array<{
    itemId: string;
    itemName: string;
    quantity: number;
    chance: number;
    xpAmount: number;
    stackable?: boolean;
  }>;
}

export interface NPCData {
  id: string;
  name: string;
  description?: string;
  category: string;
  faction?: string;
  stats?: {
    level: number;
    health: number;
    attack: number;
    strength: number;
    defense: number;
    ranged?: number;
    magic?: number;
  };
  combat?: {
    attackable: boolean;
    aggressive?: boolean;
    retaliates?: boolean;
    aggroRange?: number;
    combatRange?: number;
    attackSpeedTicks?: number;
    respawnTicks?: number;
  };
  movement?: {
    type: string;
    speed: number;
    wanderRadius?: number;
  };
  drops?: {
    defaultDrop?: {
      enabled: boolean;
      itemId: string;
      quantity: number;
    };
    always?: DropItem[];
    common?: DropItem[];
    uncommon?: DropItem[];
    rare?: DropItem[];
    veryRare?: DropItem[];
  };
  services?: {
    enabled: boolean;
    types: string[];
  };
}

export interface DropItem {
  itemId: string;
  minQuantity: number;
  maxQuantity: number;
  chance: number;
  rarity: string;
}

export interface ItemData {
  id: string;
  name: string;
  type: string;
  value?: number;
  weight?: number;
  description?: string;
  examine?: string;
  rarity?: string;
  requirements?: {
    level: number;
    skills: Record<string, number>;
  };
  bonuses?: {
    attack?: number;
    strength?: number;
    defense?: number;
    ranged?: number;
    magic?: number;
  };
}

export interface DropSource {
  npcId: string;
  npcName: string;
  npcLevel: number;
  dropRarity: string;
  chance: number;
  minQuantity: number;
  maxQuantity: number;
}

/**
 * GET /api/game/data?type=resource&id=tree_normal
 * GET /api/game/data?type=npc&id=goblin
 * GET /api/game/data?type=item&id=bronze_hatchet
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type");
    const id = searchParams.get("id");

    if (!type || !id) {
      return NextResponse.json(
        { error: "type and id parameters are required" },
        { status: 400 },
      );
    }

    let manifestFile: string;
    switch (type) {
      case "resource":
        manifestFile = "resources.json";
        break;
      case "npc":
      case "mob":
        manifestFile = "npcs.json";
        break;
      case "item":
        manifestFile = "items.json";
        break;
      default:
        return NextResponse.json(
          { error: `Unknown type: ${type}` },
          { status: 400 },
        );
    }

    const manifestPath = path.join(MANIFESTS_DIR, manifestFile);

    try {
      const content = await fs.readFile(manifestPath, "utf-8");
      const data = JSON.parse(content);

      // Find the item by id
      const item = data.find(
        (entry: { id: string }) =>
          entry.id === id || entry.id === id.replace("tree_", "tree_"),
      );

      if (!item) {
        // Try to find by partial match or type
        const partialMatch = data.find(
          (entry: { id: string; type?: string; name?: string }) =>
            entry.id.includes(id) ||
            entry.type === id ||
            entry.name?.toLowerCase() === id.toLowerCase(),
        );

        if (partialMatch) {
          return NextResponse.json({
            type,
            data: partialMatch,
            source: manifestFile,
          });
        }

        return NextResponse.json(
          {
            error: `${type} with id "${id}" not found`,
            available: data.map((d: { id: string }) => d.id),
          },
          { status: 404 },
        );
      }

      // If it's a resource or NPC, also fetch related item data
      let relatedItems: ItemData[] = [];
      if (type === "resource" && item.harvestYield) {
        const itemsContent = await fs.readFile(
          path.join(MANIFESTS_DIR, "items.json"),
          "utf-8",
        );
        const allItems = JSON.parse(itemsContent);
        const yieldItemIds = item.harvestYield.map(
          (y: { itemId: string }) => y.itemId,
        );
        relatedItems = allItems.filter((i: ItemData) =>
          yieldItemIds.includes(i.id),
        );
      }

      if ((type === "npc" || type === "mob") && item.drops) {
        const itemsContent = await fs.readFile(
          path.join(MANIFESTS_DIR, "items.json"),
          "utf-8",
        );
        const allItems = JSON.parse(itemsContent);
        const dropItemIds = new Set<string>();

        if (item.drops.defaultDrop?.itemId)
          dropItemIds.add(item.drops.defaultDrop.itemId);
        item.drops.always?.forEach((d: DropItem) => dropItemIds.add(d.itemId));
        item.drops.common?.forEach((d: DropItem) => dropItemIds.add(d.itemId));
        item.drops.uncommon?.forEach((d: DropItem) =>
          dropItemIds.add(d.itemId),
        );
        item.drops.rare?.forEach((d: DropItem) => dropItemIds.add(d.itemId));
        item.drops.veryRare?.forEach((d: DropItem) =>
          dropItemIds.add(d.itemId),
        );

        relatedItems = allItems.filter((i: ItemData) => dropItemIds.has(i.id));
      }

      // For resources, also fetch tool data
      let toolData: ItemData | null = null;
      if (type === "resource" && item.toolRequired) {
        const itemsContent = await fs.readFile(
          path.join(MANIFESTS_DIR, "items.json"),
          "utf-8",
        );
        const allItems = JSON.parse(itemsContent);
        toolData = allItems.find((i: ItemData) => i.id === item.toolRequired);
      }

      // For items, find which NPCs drop this item
      const dropSources: DropSource[] = [];
      if (type === "item") {
        const npcsContent = await fs.readFile(
          path.join(MANIFESTS_DIR, "npcs.json"),
          "utf-8",
        );
        const allNpcs = JSON.parse(npcsContent);

        for (const npc of allNpcs) {
          if (!npc.drops) continue;

          const npcLevel = npc.stats?.level || 0;
          const npcName = npc.name;
          const npcId = npc.id;

          // Check default drop
          if (
            npc.drops.defaultDrop?.enabled &&
            npc.drops.defaultDrop.itemId === id
          ) {
            dropSources.push({
              npcId,
              npcName,
              npcLevel,
              dropRarity: "always",
              chance: 1.0,
              minQuantity: npc.drops.defaultDrop.quantity,
              maxQuantity: npc.drops.defaultDrop.quantity,
            });
          }

          // Check all drop tiers
          const dropTiers = [
            "always",
            "common",
            "uncommon",
            "rare",
            "veryRare",
          ];
          for (const tier of dropTiers) {
            const drops = npc.drops[tier] as DropItem[] | undefined;
            if (!drops) continue;

            for (const drop of drops) {
              if (drop.itemId === id) {
                dropSources.push({
                  npcId,
                  npcName,
                  npcLevel,
                  dropRarity: tier === "veryRare" ? "very_rare" : tier,
                  chance: drop.chance,
                  minQuantity: drop.minQuantity,
                  maxQuantity: drop.maxQuantity,
                });
              }
            }
          }
        }

        // Sort by chance (highest first)
        dropSources.sort((a, b) => b.chance - a.chance);
      }

      return NextResponse.json({
        type,
        data: item,
        relatedItems,
        toolData,
        dropSources,
        source: manifestFile,
      });
    } catch (error) {
      log.error(`Failed to read ${manifestFile}:`, error);
      return NextResponse.json(
        { error: `Failed to read ${manifestFile}` },
        { status: 500 },
      );
    }
  } catch (error) {
    log.error("Failed to get game data:", error);
    return NextResponse.json(
      { error: "Failed to get game data" },
      { status: 500 },
    );
  }
}
