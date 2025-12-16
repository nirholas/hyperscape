import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { gateway } from "@ai-sdk/gateway";
import { v4 as uuidv4 } from "uuid";
import type {
  Quest,
  QuestObjective,
  QuestReward,
  WorldArea,
  Item,
  Store,
  Biome,
} from "@/types/game/content-types";

const model = gateway("google/gemini-2.0-flash-001");

// ============================================
// QUEST GENERATION
// ============================================

interface QuestGenerationRequest {
  type: "quest";
  name?: string;
  category?: "main" | "side" | "daily" | "event";
  difficulty?: "easy" | "medium" | "hard" | "legendary";
  theme?: string;
  startNpc?: { id: string; name: string };
  targetLevel?: number;
  objectives?: string; // Description of what the player should do
  lore?: string;
}

async function generateQuest(req: QuestGenerationRequest): Promise<Quest> {
  const prompt = `Generate a quest for a RuneScape-style MMORPG.

Quest Parameters:
- Name: ${req.name || "Generate a creative name"}
- Category: ${req.category || "side"}
- Difficulty: ${req.difficulty || "medium"}
- Theme/Setting: ${req.theme || "general fantasy"}
- Target Level: ${req.targetLevel || 10}
${req.startNpc ? `- Quest Giver: ${req.startNpc.name} (${req.startNpc.id})` : ""}
${req.objectives ? `- Objectives Hint: ${req.objectives}` : ""}
${req.lore ? `- World Lore: ${req.lore}` : ""}

Generate a quest with the following structure (JSON only, no markdown):
{
  "name": "Quest Name",
  "description": "2-3 sentence description shown in quest log",
  "objectives": [
    {
      "id": "obj_1",
      "type": "kill|collect|deliver|talk|explore|craft|skill|interact",
      "target": "target_id",
      "targetName": "Display Name",
      "quantity": 5,
      "description": "Kill 5 Goblins",
      "optional": false,
      "hint": "Optional hint for players"
    }
  ],
  "rewards": [
    {"type": "xp", "name": "Experience", "quantity": 500},
    {"type": "gold", "name": "Gold Coins", "quantity": 100},
    {"type": "item", "id": "item_id", "name": "Item Name", "quantity": 1}
  ],
  "requirements": [
    {"type": "level", "name": "Combat Level", "value": 5}
  ],
  "lore": "Detailed backstory and context (3-4 sentences)",
  "hint": "A subtle hint if players get stuck"
}

Rules:
1. Create 2-5 objectives that tell a story
2. Include appropriate rewards for the difficulty
3. Make objectives specific with real game entities (goblins, bronze_sword, etc.)
4. Use snake_case for IDs
5. Make the quest feel like authentic RuneScape content`;

  const result = await generateText({
    model,
    prompt,
    temperature: 0.8,
  });

  const jsonMatch = result.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Failed to parse quest JSON");

  const questData = JSON.parse(jsonMatch[0]);
  const questId = req.name
    ? req.name.toLowerCase().replace(/\s+/g, "_")
    : `quest_${uuidv4().slice(0, 8)}`;

  return {
    id: questId,
    name: questData.name,
    description: questData.description,
    category: req.category || "side",
    difficulty: req.difficulty || "medium",
    recommendedLevel: req.targetLevel || 10,
    objectives: questData.objectives.map((obj: QuestObjective, i: number) => ({
      ...obj,
      id: obj.id || `obj_${i + 1}`,
    })),
    rewards: questData.rewards,
    requirements: questData.requirements,
    startNpcId: req.startNpc?.id || "quest_giver",
    startNpcName: req.startNpc?.name || "Quest Giver",
    lore: questData.lore,
    hint: questData.hint,
    repeatable: req.category === "daily",
    cooldown: req.category === "daily" ? 1440 : undefined, // 24 hours for dailies
  };
}

// ============================================
// WORLD AREA GENERATION
// ============================================

interface AreaGenerationRequest {
  type: "area";
  name?: string;
  biome?: string;
  difficultyLevel?: number;
  size?: "small" | "medium" | "large";
  safeZone?: boolean;
  theme?: string;
  includeNpcs?: boolean;
  includeResources?: boolean;
  includeMobs?: boolean;
}

async function generateArea(req: AreaGenerationRequest): Promise<WorldArea> {
  const sizeMap = { small: 20, medium: 40, large: 80 };
  const halfSize = sizeMap[req.size || "medium"] / 2;

  const prompt = `Generate a world area for a RuneScape-style MMORPG.

Area Parameters:
- Name: ${req.name || "Generate a creative name"}
- Biome: ${req.biome || "forest"}
- Difficulty Level: ${req.difficultyLevel ?? 1} (0=safe, 1-2=easy, 3-4=medium, 5=hard)
- Size: ${req.size || "medium"} (bounds: -${halfSize} to ${halfSize})
- Safe Zone: ${req.safeZone ?? false}
- Theme: ${req.theme || "general fantasy"}

Generate area data (JSON only, no markdown):
{
  "name": "Area Name",
  "description": "Atmospheric description (2-3 sentences)",
  "npcs": [
    {"id": "npc_id", "type": "shopkeeper|banker|guard|quest", "position": {"x": 5, "y": 0, "z": -5}}
  ],
  "resources": [
    {"type": "tree|rock|fishing_spot", "resourceId": "tree_normal", "position": {"x": 10, "y": 0, "z": 10}}
  ],
  "mobSpawns": [
    {"mobId": "goblin", "mobName": "Goblin", "position": {"x": 0, "y": 0, "z": 15}, "spawnRadius": 5, "maxCount": 3}
  ],
  "ambientSound": "forest_birds|wind_plains|water_river",
  "colorScheme": {"primary": "#2E7D32", "secondary": "#66BB6A", "fog": "#B0BEC5"}
}

Rules:
1. Place ${req.includeNpcs !== false ? "1-3 NPCs" : "no NPCs"} appropriate to the area
2. Add ${req.includeResources !== false ? "3-6 resources" : "no resources"} matching the biome
3. Include ${req.includeMobs !== false && !req.safeZone ? "1-3 mob spawn points" : "no mob spawns"}
4. Use existing game IDs: tree_normal, tree_oak, goblin, bank_clerk, shopkeeper
5. Position within bounds: x/z between -${halfSize} and ${halfSize}, y=0`;

  const result = await generateText({
    model,
    prompt,
    temperature: 0.7,
  });

  const jsonMatch = result.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Failed to parse area JSON");

  const areaData = JSON.parse(jsonMatch[0]);
  const areaId = req.name
    ? req.name.toLowerCase().replace(/\s+/g, "_")
    : `area_${uuidv4().slice(0, 8)}`;

  return {
    id: areaId,
    name: areaData.name,
    description: areaData.description,
    difficultyLevel: req.difficultyLevel ?? 1,
    bounds: {
      minX: -halfSize,
      maxX: halfSize,
      minZ: -halfSize,
      maxZ: halfSize,
    },
    biomeType: req.biome || "forest",
    safeZone: req.safeZone ?? false,
    npcs: areaData.npcs || [],
    resources: areaData.resources || [],
    mobSpawns: areaData.mobSpawns || [],
    ambientSound: areaData.ambientSound,
    colorScheme: areaData.colorScheme,
  };
}

// ============================================
// ITEM GENERATION
// ============================================

interface ItemGenerationRequest {
  type: "item";
  name?: string;
  itemType?: string;
  rarity?: string;
  level?: number;
  theme?: string;
  equipSlot?: string;
}

async function generateItem(req: ItemGenerationRequest): Promise<Item> {
  const prompt = `Generate an item for a RuneScape-style MMORPG.

Item Parameters:
- Name: ${req.name || "Generate a creative name"}
- Type: ${req.itemType || "weapon"}
- Rarity: ${req.rarity || "uncommon"}
- Level Requirement: ${req.level || 10}
- Theme: ${req.theme || "general fantasy"}
${req.equipSlot ? `- Equipment Slot: ${req.equipSlot}` : ""}

Generate item data (JSON only, no markdown):
{
  "name": "Item Name",
  "description": "Short description for tooltips",
  "examine": "What players see when examining (flavor text)",
  "value": 500,
  "weight": 2.5,
  "stackable": false,
  "tradeable": true,
  "equipSlot": "weapon|head|body|legs|hands|feet|cape|neck|ring|shield",
  "weaponType": "SWORD|AXE|MACE|DAGGER|SPEAR|BOW|STAFF|WAND",
  "attackType": "MELEE|RANGED|MAGIC",
  "attackSpeed": 4,
  "attackRange": 1,
  "bonuses": {
    "attack": 15,
    "strength": 12,
    "defense": 5,
    "ranged": 0,
    "magic": 0
  },
  "requirements": {
    "level": 10,
    "skills": {"attack": 10}
  }
}

Rules:
1. Balance stats based on rarity and level
2. Value should scale: common(100), uncommon(500), rare(2000), epic(10000), legendary(50000+)
3. Bonuses should be appropriate for the item type
4. Include lore-appropriate examine text
5. Make it feel like authentic RuneScape equipment`;

  const result = await generateText({
    model,
    prompt,
    temperature: 0.7,
  });

  const jsonMatch = result.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Failed to parse item JSON");

  const itemData = JSON.parse(jsonMatch[0]);
  const itemId = req.name
    ? req.name.toLowerCase().replace(/\s+/g, "_")
    : `item_${uuidv4().slice(0, 8)}`;

  return {
    id: itemId,
    name: itemData.name,
    type: (req.itemType as Item["type"]) || "weapon",
    description: itemData.description,
    examine: itemData.examine,
    rarity: (req.rarity as Item["rarity"]) || "uncommon",
    value: itemData.value,
    weight: itemData.weight,
    stackable: itemData.stackable ?? false,
    tradeable: itemData.tradeable ?? true,
    equipSlot: itemData.equipSlot,
    weaponType: itemData.weaponType,
    attackType: itemData.attackType,
    attackSpeed: itemData.attackSpeed,
    attackRange: itemData.attackRange,
    bonuses: itemData.bonuses,
    requirements: itemData.requirements,
  };
}

// ============================================
// STORE GENERATION
// ============================================

interface StoreGenerationRequest {
  type: "store";
  name?: string;
  storeType?: string;
  owner?: { id: string; name: string };
  location?: string;
  itemCount?: number;
  priceRange?: "cheap" | "normal" | "expensive";
}

async function generateStore(req: StoreGenerationRequest): Promise<Store> {
  const prompt = `Generate a shop/store for a RuneScape-style MMORPG.

Store Parameters:
- Name: ${req.name || "Generate a creative name"}
- Type: ${req.storeType || "general"}
- Owner: ${req.owner?.name || "Generate a shopkeeper name"}
- Location: ${req.location || "Central Town"}
- Number of Items: ${req.itemCount || 8}
- Price Range: ${req.priceRange || "normal"}

Generate store data (JSON only, no markdown):
{
  "name": "Store Name",
  "type": "general|weapon|armor|magic|food|specialty",
  "ownerName": "Shopkeeper Name",
  "description": "Brief description of the shop",
  "items": [
    {"itemId": "bronze_sword", "itemName": "Bronze Sword", "basePrice": 100, "stock": 10},
    {"itemId": "logs", "itemName": "Logs", "basePrice": 5, "stock": "unlimited"}
  ],
  "buybackRate": 0.4
}

Rules:
1. Use existing game item IDs where possible: bronze_sword, steel_sword, chainbody, logs, coins
2. Stock can be a number or "unlimited" for common items
3. Buyback rate typically 0.3-0.5 (30-50% of base price)
4. Include a mix of stock types based on store type
5. Prices should be balanced for the store type`;

  const result = await generateText({
    model,
    prompt,
    temperature: 0.7,
  });

  const jsonMatch = result.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Failed to parse store JSON");

  const storeData = JSON.parse(jsonMatch[0]);
  const storeId = req.name
    ? req.name.toLowerCase().replace(/\s+/g, "_")
    : `store_${uuidv4().slice(0, 8)}`;

  return {
    id: storeId,
    name: storeData.name,
    type: storeData.type || "general",
    ownerId: req.owner?.id,
    ownerName: storeData.ownerName || req.owner?.name,
    location: req.location,
    description: storeData.description,
    items: storeData.items,
    buybackRate: storeData.buybackRate || 0.4,
  };
}

// ============================================
// API ROUTE HANDLER
// ============================================

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { type, ...params } = body;

    let result;
    let generatedAt = new Date().toISOString();

    switch (type) {
      case "quest":
        result = {
          quest: await generateQuest({ type, ...params }),
          generatedAt,
          prompt: JSON.stringify(params),
        };
        break;

      case "area":
        result = {
          area: await generateArea({ type, ...params }),
          generatedAt,
          prompt: JSON.stringify(params),
        };
        break;

      case "item":
        result = {
          item: await generateItem({ type, ...params }),
          generatedAt,
          prompt: JSON.stringify(params),
        };
        break;

      case "store":
        result = {
          store: await generateStore({ type, ...params }),
          generatedAt,
          prompt: JSON.stringify(params),
        };
        break;

      default:
        return NextResponse.json(
          { error: `Unknown content type: ${type}` },
          { status: 400 },
        );
    }

    return NextResponse.json({ success: true, content: result });
  } catch (error) {
    console.error("[API] Content generation failed:", error);
    return NextResponse.json(
      {
        error: "Content generation failed",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
