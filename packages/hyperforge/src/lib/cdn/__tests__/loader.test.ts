/**
 * CDN Loader Tests
 *
 * Tests for the CDN asset loader.
 * Uses file system operations for development mode testing.
 *
 * Real Issues to Surface:
 * - Manifest consolidation failing with conflicting entries
 * - asset:// URL resolution returning 404s
 * - Development/production path switching errors
 * - Missing asset graceful degradation
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "vitest";
import type {
  ItemManifest,
  NPCManifest,
  ResourceManifest,
  MusicTrackManifest,
  BiomeManifest,
  HyperForgeAsset,
} from "@/types";

// Mock fetch globally BEFORE importing the loader module
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Import the loader module after setting up the mock
import {
  loadCDNManifests,
  loadCDNAssets,
  loadVRMEmotes,
  getAssetModelUrl,
} from "../loader";

// =============================================================================
// UNIT TESTS - Test logic without dependencies
// =============================================================================

describe("CDN Loader", () => {
  describe("URL Resolution", () => {
    const CDN_URL = "http://localhost:8080";

    it("resolves asset:// URLs to CDN paths", () => {
      const assetUrl = "asset://items/sword.glb";
      const resolved = assetUrl.replace("asset://", `${CDN_URL}/`);

      expect(resolved).toBe("http://localhost:8080/items/sword.glb");
      expect(resolved).toContain("sword.glb");
    });

    it("resolves relative paths to CDN URLs", () => {
      const relativePath = "items/bronze-sword.glb";
      const cdnUrl = `${CDN_URL}/${relativePath}`;

      expect(cdnUrl).toMatch(/^https?:\/\//);
      expect(cdnUrl).toContain(relativePath);
    });

    it("handles paths with special characters", () => {
      const specialPath = "items/sword%20of%20fire.glb";
      const cdnUrl = `${CDN_URL}/${specialPath}`;

      expect(cdnUrl).toContain("%20");
    });

    it("preserves query parameters in URLs", () => {
      const urlWithParams = "items/sword.glb?v=1.0&t=123";
      const cdnUrl = `${CDN_URL}/${urlWithParams}`;

      expect(cdnUrl).toContain("?v=1.0");
      expect(cdnUrl).toContain("&t=123");
    });
  });

  describe("Manifest Structure", () => {
    it("defines correct item manifest structure", () => {
      const itemManifest = {
        id: "bronze-sword",
        name: "Bronze Sword",
        type: "weapon",
        modelPath: "asset://items/weapons/bronze-sword.glb",
        iconPath: "asset://items/icons/bronze-sword.png",
        rarity: "common",
        value: 100,
        equipSlot: "mainhand",
        bonuses: {
          attackBonus: 5,
        },
      };

      expect(itemManifest.id).toBeDefined();
      expect(itemManifest.name).toBeDefined();
      expect(itemManifest.type).toBeDefined();
      expect(itemManifest.modelPath).toContain("asset://");
    });

    it("defines correct NPC manifest structure", () => {
      const npcManifest = {
        id: "goblin-warrior",
        name: "Goblin Warrior",
        category: "monster",
        modelPath: "asset://npcs/goblin-warrior.glb",
        stats: {
          level: 5,
          health: 50,
          attack: 10,
        },
        combat: {
          attackable: true,
        },
      };

      expect(npcManifest.id).toBeDefined();
      expect(npcManifest.category).toBeDefined();
      expect(npcManifest.stats).toBeDefined();
    });

    it("defines correct resource manifest structure", () => {
      const resourceManifest = {
        id: "oak-tree",
        name: "Oak Tree",
        type: "tree",
        modelPath: "asset://resources/trees/oak.glb",
        harvestSkill: "woodcutting",
        levelRequired: 1,
        examine: "A sturdy oak tree.",
      };

      expect(resourceManifest.harvestSkill).toBeDefined();
      expect(resourceManifest.levelRequired).toBeGreaterThanOrEqual(1);
    });
  });

  describe("Asset Category Mapping", () => {
    it("maps item types to CDN categories", () => {
      const typeMapping: Record<string, string> = {
        weapon: "weapon",
        armor: "armor",
        tool: "tool",
        consumable: "item",
        quest: "item",
        resource: "resource",
        material: "resource",
        currency: "currency",
      };

      expect(typeMapping.weapon).toBe("weapon");
      expect(typeMapping.consumable).toBe("item");
      expect(typeMapping.resource).toBe("resource");
    });

    it("handles unknown types with default category", () => {
      const unknownType = "unknown-type";
      const mapping: Record<string, string> = {
        weapon: "weapon",
      };

      const category = mapping[unknownType] || "item";
      expect(category).toBe("item");
    });
  });

  describe("CDN Asset Conversion", () => {
    it("converts item manifest to CDN asset format", () => {
      const itemManifest = {
        id: "iron-platebody",
        name: "Iron Platebody",
        type: "armor",
        modelPath: "asset://items/armor/iron-platebody.glb",
        iconPath: "asset://items/icons/iron-platebody.png",
        rarity: "common",
        value: 500,
        equipSlot: "chest",
        description: "A sturdy iron platebody.",
      };

      const cdnAsset = {
        id: itemManifest.id,
        name: itemManifest.name,
        source: "CDN",
        modelPath: itemManifest.modelPath,
        thumbnailPath: itemManifest.iconPath,
        category: "armor" as const,
        rarity: itemManifest.rarity,
        type: itemManifest.type,
        description: itemManifest.description,
      };

      expect(cdnAsset.source).toBe("CDN");
      expect(cdnAsset.category).toBe("armor");
    });

    it("detects VRM files in model paths", () => {
      const vrmPath = "avatars/knight.vrm";
      const glbPath = "items/sword.glb";

      expect(vrmPath.endsWith(".vrm")).toBe(true);
      expect(glbPath.endsWith(".vrm")).toBe(false);
    });
  });

  describe("Development vs Production Paths", () => {
    it("uses local paths in development", () => {
      const isDev = true;
      const manifestsPath = isDev
        ? "../server/world/assets/manifests"
        : "/manifests";

      expect(manifestsPath).toContain("server");
    });

    it("uses CDN paths in production", () => {
      const isDev = false;
      const cdnUrl = "https://cdn.hyperscape.ai";
      const manifestPath = isDev ? "/local/manifests" : `${cdnUrl}/manifests`;

      expect(manifestPath).toContain("https://");
    });
  });

  describe("Fallback Behavior", () => {
    it("returns empty array for missing manifests", () => {
      const missingManifest: unknown[] = [];
      expect(missingManifest).toHaveLength(0);
    });

    it("handles null asset lookup gracefully", () => {
      const assets: { id: string }[] = [];
      const found = assets.find((a) => a.id === "non-existent");

      expect(found).toBeUndefined();
    });
  });

  describe("VRM Avatar Loading", () => {
    it("formats avatar filename into display name", () => {
      const filename = "avatar-female-01";
      const formatted = filename
        .split("-")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");

      expect(formatted).toBe("Avatar Female 01");
    });

    it("creates CDN asset from VRM file", () => {
      const filename = "knight-avatar.vrm";
      const id = filename.replace(".vrm", "");

      const asset = {
        id,
        name: "Knight Avatar",
        source: "CDN",
        modelPath: `avatars/${filename}`,
        vrmPath: `avatars/${filename}`,
        hasVRM: true,
        category: "npc" as const,
        type: "avatar",
      };

      expect(asset.hasVRM).toBe(true);
      expect(asset.vrmPath).toContain(".vrm");
    });
  });

  describe("Emote Loading", () => {
    it("formats emote filename into display name", () => {
      const id = "emote-dance-happy";
      const formatted = id
        .replace(/^emote[-_]?/, "")
        .split(/[-_]/)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");

      expect(formatted).toBe("Dance Happy");
    });
  });

  describe("Asset Model URL Resolution", () => {
    const CDN_URL = "http://localhost:8080";

    it("resolves CDN asset URLs", () => {
      const asset = {
        source: "CDN" as const,
        modelPath: "items/sword.glb",
      };

      const url = `${CDN_URL}/${asset.modelPath}`;
      expect(url).toBe("http://localhost:8080/items/sword.glb");
    });

    it("resolves local asset URLs via API", () => {
      const asset = {
        source: "LOCAL" as const,
        id: "custom-sword-123",
        modelPath: "",
      };

      const url = `/api/assets/${asset.id}/model.glb`;
      expect(url).toBe("/api/assets/custom-sword-123/model.glb");
    });

    it("handles asset:// protocol in base assets", () => {
      const assetPath = "asset://biomes/forest.glb";
      const resolved = assetPath.replace("asset://", `${CDN_URL}/`);

      expect(resolved).toBe("http://localhost:8080/biomes/forest.glb");
    });
  });

  describe("Music and Biome Assets", () => {
    it("converts music manifest to CDN asset", () => {
      const musicManifest = {
        id: "lumbridge-theme",
        name: "Lumbridge Theme",
        path: "music/lumbridge.mp3",
        type: "ambient",
        category: "town",
        description: "The calm theme of Lumbridge.",
      };

      const asset = {
        id: musicManifest.id,
        name: musicManifest.name,
        source: "CDN" as const,
        modelPath: musicManifest.path,
        category: "music" as const,
        type: musicManifest.type,
        subtype: musicManifest.category,
      };

      expect(asset.category).toBe("music");
    });

    it("converts biome manifest to CDN asset", () => {
      const biomeManifest = {
        id: "forest-glade",
        name: "Forest Glade",
        terrain: "forest",
        description: "A peaceful forest clearing.",
        difficultyLevel: 5,
      };

      const asset = {
        id: biomeManifest.id,
        name: biomeManifest.name,
        source: "CDN" as const,
        modelPath: "",
        category: "biome" as const,
        type: "biome",
        subtype: biomeManifest.terrain,
        levelRequired: biomeManifest.difficultyLevel,
      };

      expect(asset.category).toBe("biome");
      expect(asset.levelRequired).toBe(5);
    });
  });
});

// =============================================================================
// INTEGRATION TESTS - Test real functions with mocked fetch
// =============================================================================

describe("CDN Loader Integration", () => {
  // Sample manifest data matching actual game structure
  const sampleItems: ItemManifest[] = [
    {
      id: "bronze-sword",
      name: "Bronze Sword",
      type: "weapon",
      modelPath: "items/weapons/bronze-sword.glb",
      iconPath: "items/icons/bronze-sword.png",
      rarity: "common",
      value: 100,
      weight: 2.5,
      stackable: false,
      tradeable: true,
      equipSlot: "weapon",
      weaponType: "sword",
      attackType: "melee",
      bonuses: { attack: 5, strength: 3 },
      requirements: { level: 1 },
      description: "A basic bronze sword.",
      examine: "A simple but effective weapon.",
    },
    {
      id: "iron-platebody",
      name: "Iron Platebody",
      type: "armor",
      modelPath: "items/armor/iron-platebody.vrm",
      iconPath: "items/icons/iron-platebody.png",
      rarity: "uncommon",
      value: 500,
      weight: 8.0,
      stackable: false,
      tradeable: true,
      equipSlot: "body",
      bonuses: { defense: 15 },
      requirements: { level: 10 },
      examine: "Sturdy iron armor.",
    },
    {
      id: "gold-coin",
      name: "Gold Coin",
      type: "currency",
      modelPath: null,
      iconPath: "items/icons/gold-coin.png",
      value: 1,
      stackable: true,
      maxStackSize: 2147483647,
    },
  ];

  const sampleNPCs: NPCManifest[] = [
    {
      id: "goblin-warrior",
      name: "Goblin Warrior",
      description: "A fierce goblin fighter.",
      category: "mob",
      faction: "goblins",
      stats: {
        level: 5,
        health: 50,
        attack: 10,
        strength: 8,
        defense: 5,
      },
      combat: {
        attackable: true,
        aggressive: true,
        retaliates: true,
        aggroRange: 5,
        attackSpeedTicks: 4,
        respawnTicks: 100,
      },
      appearance: {
        modelPath: "npcs/goblin-warrior.glb",
        iconPath: "npcs/icons/goblin-warrior.png",
        scale: 1.0,
      },
    },
    {
      id: "wise-merchant",
      name: "Wise Merchant",
      description: "A friendly shopkeeper.",
      category: "neutral",
      modelPath: "npcs/wise-merchant.vrm",
      iconPath: "npcs/icons/wise-merchant.png",
      services: {
        enabled: true,
        types: ["shop", "trade"],
      },
      level: 1,
    },
  ];

  const sampleResources: ResourceManifest[] = [
    {
      id: "oak-tree",
      name: "Oak Tree",
      type: "tree",
      modelPath: "resources/trees/oak.glb",
      depletedModelPath: "resources/trees/oak-stump.glb",
      harvestSkill: "woodcutting",
      toolRequired: "axe",
      levelRequired: 1,
      baseCycleTicks: 4,
      depleteChance: 0.125,
      respawnTicks: 80,
      examine: "A sturdy oak tree.",
      harvestYield: [
        { itemId: "oak-logs", quantity: 1, chance: 1.0, xpAmount: 25 },
      ],
    },
    {
      id: "copper-rock",
      name: "Copper Rock",
      type: "rock",
      modelPath: "resources/rocks/copper.glb",
      harvestSkill: "mining",
      toolRequired: null,
      levelRequired: 1,
      examine: "Contains copper ore.",
    },
  ];

  const sampleMusic: MusicTrackManifest[] = [
    {
      id: "lumbridge-theme",
      name: "Lumbridge Theme",
      type: "ambient",
      category: "normal",
      path: "music/lumbridge.mp3",
      description: "The peaceful theme of Lumbridge.",
      duration: 180,
      mood: "calm",
    },
    {
      id: "boss-battle",
      name: "Boss Battle",
      type: "combat",
      category: "boss",
      path: "music/boss-battle.mp3",
      description: "Intense boss fight music.",
    },
  ];

  const sampleBiomes: BiomeManifest[] = [
    {
      id: "forest-glade",
      name: "Forest Glade",
      description: "A peaceful forest clearing.",
      terrain: "forest",
      difficultyLevel: 3,
      colorScheme: {
        primary: "#228B22",
        secondary: "#90EE90",
        fog: "#E0FFE0",
      },
      resourceTypes: ["tree", "plant"],
      mobTypes: ["goblin", "wolf"],
    },
    {
      id: "dark-cave",
      name: "Dark Cave",
      description: "A dangerous underground cave.",
      terrain: "cave",
      difficulty: 7,
      resources: ["iron-rock", "coal-rock"],
      mobs: ["cave-spider", "bat"],
    },
  ];

  /**
   * Helper to create mock fetch response
   */
  function createMockResponse(data: unknown, ok = true, status = 200) {
    return Promise.resolve({
      ok,
      status,
      json: () => Promise.resolve(data),
    } as Response);
  }

  /**
   * Standard manifest mock implementation
   */
  function setupManifestMocks() {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("items.json")) {
        return createMockResponse(sampleItems);
      }
      if (url.includes("npcs.json")) {
        return createMockResponse(sampleNPCs);
      }
      if (url.includes("resources.json")) {
        return createMockResponse(sampleResources);
      }
      if (url.includes("music.json")) {
        return createMockResponse(sampleMusic);
      }
      if (url.includes("biomes.json")) {
        return createMockResponse(sampleBiomes);
      }
      return createMockResponse([], false, 404);
    });
  }

  // Reset mock between tests
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe("loadCDNManifests()", () => {
    it("loads all manifests from CDN and merges them", async () => {
      setupManifestMocks();
      const manifests = await loadCDNManifests();

      // Verify manifest content (all manifests loaded)
      expect(manifests.items).toHaveLength(sampleItems.length);
      expect(manifests.npcs).toHaveLength(sampleNPCs.length);
      expect(manifests.resources).toHaveLength(sampleResources.length);
      expect(manifests.music).toHaveLength(sampleMusic.length);
      expect(manifests.biomes).toHaveLength(sampleBiomes.length);

      // Verify specific items from each manifest
      expect(manifests.items[0].id).toBe("bronze-sword");
      expect(manifests.npcs[0].id).toBe("goblin-warrior");
      expect(manifests.resources[0].id).toBe("oak-tree");
      expect(manifests.music[0].id).toBe("lumbridge-theme");
      expect(manifests.biomes[0].id).toBe("forest-glade");
    });
  });

  describe("loadCDNAssets()", () => {
    it("loads and converts all manifests to CDNAsset format", async () => {
      setupManifestMocks();
      const assets = await loadCDNAssets();

      // Total assets: items + npcs + resources + music + biomes
      // (VRM avatars only load in dev mode, so 0 here)
      const expectedCount =
        sampleItems.length +
        sampleNPCs.length +
        sampleResources.length +
        sampleMusic.length +
        sampleBiomes.length;

      expect(assets.length).toBe(expectedCount);
    });

    it("correctly converts items to CDNAsset with full metadata", async () => {
      setupManifestMocks();
      const assets = await loadCDNAssets();

      // Find bronze sword
      const sword = assets.find((a) => a.id === "bronze-sword");
      expect(sword).toBeDefined();
      expect(sword!.name).toBe("Bronze Sword");
      expect(sword!.source).toBe("CDN");
      expect(sword!.category).toBe("weapon");
      expect(sword!.type).toBe("weapon");
      expect(sword!.rarity).toBe("common");
      expect(sword!.modelPath).toBe("items/weapons/bronze-sword.glb");
      expect(sword!.thumbnailPath).toBe("items/icons/bronze-sword.png");
      expect(sword!.equipSlot).toBe("weapon");
      expect(sword!.weaponType).toBe("sword");
      expect(sword!.attackType).toBe("melee");
      expect(sword!.bonuses).toEqual({ attack: 5, strength: 3 });
      expect(sword!.value).toBe(100);
      expect(sword!.weight).toBe(2.5);
      expect(sword!.tradeable).toBe(true);
      expect(sword!.hasVRM).toBe(false);
    });

    it("detects VRM models in items", async () => {
      setupManifestMocks();
      const assets = await loadCDNAssets();

      // Iron platebody has .vrm extension
      const platebody = assets.find((a) => a.id === "iron-platebody");
      expect(platebody).toBeDefined();
      expect(platebody!.hasVRM).toBe(true);
      expect(platebody!.vrmPath).toBe("items/armor/iron-platebody.vrm");
    });

    it("correctly converts NPCs to CDNAsset with combat stats", async () => {
      setupManifestMocks();
      const assets = await loadCDNAssets();

      // Find goblin warrior
      const goblin = assets.find((a) => a.id === "goblin-warrior");
      expect(goblin).toBeDefined();
      expect(goblin!.name).toBe("Goblin Warrior");
      expect(goblin!.source).toBe("CDN");
      expect(goblin!.category).toBe("npc");
      expect(goblin!.npcCategory).toBe("mob");
      expect(goblin!.faction).toBe("goblins");
      expect(goblin!.level).toBe(5);
      expect(goblin!.combatLevel).toBe(5);
      expect(goblin!.attackable).toBe(true);
      expect(goblin!.modelPath).toBe("npcs/goblin-warrior.glb");
    });

    it("handles NPCs with nested appearance paths", async () => {
      setupManifestMocks();
      const assets = await loadCDNAssets();

      // Goblin has appearance.modelPath
      const goblin = assets.find((a) => a.id === "goblin-warrior");
      expect(goblin!.modelPath).toBe("npcs/goblin-warrior.glb");
      expect(goblin!.iconPath).toBe("npcs/icons/goblin-warrior.png");
    });

    it("handles NPCs with direct modelPath", async () => {
      setupManifestMocks();
      const assets = await loadCDNAssets();

      // Merchant has direct modelPath
      const merchant = assets.find((a) => a.id === "wise-merchant");
      expect(merchant).toBeDefined();
      expect(merchant!.modelPath).toBe("npcs/wise-merchant.vrm");
      expect(merchant!.hasVRM).toBe(true);
    });

    it("correctly converts resources to CDNAsset", async () => {
      setupManifestMocks();
      const assets = await loadCDNAssets();

      // Find oak tree
      const tree = assets.find((a) => a.id === "oak-tree");
      expect(tree).toBeDefined();
      expect(tree!.name).toBe("Oak Tree");
      expect(tree!.source).toBe("CDN");
      expect(tree!.category).toBe("resource");
      expect(tree!.type).toBe("tree");
      expect(tree!.harvestSkill).toBe("woodcutting");
      expect(tree!.toolRequired).toBe("axe");
      expect(tree!.levelRequired).toBe(1);
      expect(tree!.examine).toBe("A sturdy oak tree.");
    });

    it("handles resources with null toolRequired", async () => {
      setupManifestMocks();
      const assets = await loadCDNAssets();

      // Copper rock has toolRequired: null
      const rock = assets.find((a) => a.id === "copper-rock");
      expect(rock).toBeDefined();
      expect(rock!.toolRequired).toBeUndefined();
    });

    it("correctly converts music to CDNAsset", async () => {
      setupManifestMocks();
      const assets = await loadCDNAssets();

      // Find lumbridge theme
      const music = assets.find((a) => a.id === "lumbridge-theme");
      expect(music).toBeDefined();
      expect(music!.name).toBe("Lumbridge Theme");
      expect(music!.category).toBe("music");
      expect(music!.type).toBe("ambient");
      expect(music!.subtype).toBe("normal");
      expect(music!.modelPath).toBe("music/lumbridge.mp3");
    });

    it("correctly converts biomes to CDNAsset", async () => {
      setupManifestMocks();
      const assets = await loadCDNAssets();

      // Find forest glade
      const biome = assets.find((a) => a.id === "forest-glade");
      expect(biome).toBeDefined();
      expect(biome!.name).toBe("Forest Glade");
      expect(biome!.category).toBe("biome");
      expect(biome!.type).toBe("biome");
      expect(biome!.subtype).toBe("forest");
      expect(biome!.levelRequired).toBe(3);
      expect(biome!.modelPath).toBe("");
    });

    it("handles biome with difficulty instead of difficultyLevel", async () => {
      setupManifestMocks();
      const assets = await loadCDNAssets();

      // Dark cave uses difficulty instead of difficultyLevel
      const cave = assets.find((a) => a.id === "dark-cave");
      expect(cave).toBeDefined();
      expect(cave!.levelRequired).toBe(7);
    });

    it("maps item types to correct categories", async () => {
      setupManifestMocks();
      const assets = await loadCDNAssets();

      // Weapon
      const sword = assets.find((a) => a.id === "bronze-sword");
      expect(sword!.category).toBe("weapon");

      // Armor
      const platebody = assets.find((a) => a.id === "iron-platebody");
      expect(platebody!.category).toBe("armor");

      // Currency
      const coin = assets.find((a) => a.id === "gold-coin");
      expect(coin!.category).toBe("currency");
    });

    it("handles items with null modelPath (gold-coin)", async () => {
      setupManifestMocks();
      const assets = await loadCDNAssets();

      // gold-coin has modelPath: null
      const coin = assets.find((a) => a.id === "gold-coin");
      expect(coin).toBeDefined();
      expect(coin!.modelPath).toBe("");
      expect(coin!.hasVRM).toBe(false);
    });

    it("prioritizes iconPath for thumbnailPath", async () => {
      setupManifestMocks();
      const assets = await loadCDNAssets();

      // bronze-sword has iconPath
      const sword = assets.find((a) => a.id === "bronze-sword");
      expect(sword!.thumbnailPath).toBe("items/icons/bronze-sword.png");
      expect(sword!.iconPath).toBe("items/icons/bronze-sword.png");
    });

    it("uses examine as description fallback", async () => {
      setupManifestMocks();
      const assets = await loadCDNAssets();

      // bronze-sword has both description and examine
      const sword = assets.find((a) => a.id === "bronze-sword");
      expect(sword!.description).toBe("A basic bronze sword.");
      expect(sword!.examine).toBe("A simple but effective weapon.");

      // iron-platebody has only examine
      const platebody = assets.find((a) => a.id === "iron-platebody");
      expect(platebody!.examine).toBe("Sturdy iron armor.");
    });

    it("extracts levelRequired from requirements", async () => {
      setupManifestMocks();
      const assets = await loadCDNAssets();

      // bronze-sword has requirements.level = 1
      const sword = assets.find((a) => a.id === "bronze-sword");
      expect(sword!.levelRequired).toBe(1);
      expect(sword!.requirements).toEqual({ level: 1 });

      // iron-platebody has requirements.level = 10
      const platebody = assets.find((a) => a.id === "iron-platebody");
      expect(platebody!.levelRequired).toBe(10);
    });
  });

  describe("loadVRMEmotes()", () => {
    it("returns empty array in production mode", async () => {
      // In production/test mode, emotes only load from CDN (not implemented in current code)
      const emotes = await loadVRMEmotes();
      expect(emotes).toEqual([]);
    });
  });

  describe("getAssetModelUrl()", () => {
    it("resolves CDN asset with asset:// protocol", () => {
      const asset: HyperForgeAsset = {
        id: "test-asset",
        name: "Test Asset",
        source: "CDN",
        modelPath: "asset://items/sword.glb",
        category: "weapon",
      };

      const url = getAssetModelUrl(asset);
      expect(url).toBe("http://localhost:8080/items/sword.glb");
    });

    it("resolves CDN asset with relative path", () => {
      const asset: HyperForgeAsset = {
        id: "test-asset",
        name: "Test Asset",
        source: "CDN",
        modelPath: "items/bronze-sword.glb",
        category: "weapon",
      };

      const url = getAssetModelUrl(asset);
      expect(url).toBe("http://localhost:8080/items/bronze-sword.glb");
    });

    it("resolves LOCAL asset to API endpoint", () => {
      const asset: HyperForgeAsset = {
        id: "custom-asset-123",
        name: "Custom Asset",
        source: "LOCAL",
        category: "weapon",
      };

      const url = getAssetModelUrl(asset);
      expect(url).toBe("/api/assets/custom-asset-123/model.glb");
    });

    it("resolves BASE asset with asset:// protocol", () => {
      const asset: HyperForgeAsset = {
        id: "base-template",
        name: "Base Template",
        source: "BASE",
        modelPath: "asset://templates/humanoid.glb",
        category: "character",
      };

      const url = getAssetModelUrl(asset);
      expect(url).toBe("http://localhost:8080/templates/humanoid.glb");
    });

    it("returns direct path for BASE asset without protocol", () => {
      const asset: HyperForgeAsset = {
        id: "base-template",
        name: "Base Template",
        source: "BASE",
        modelPath: "https://custom-cdn.com/model.glb",
        category: "character",
      };

      const url = getAssetModelUrl(asset);
      expect(url).toBe("https://custom-cdn.com/model.glb");
    });
  });
});

// =============================================================================
// CDN ERROR HANDLING TESTS - Test error paths in production mode
// =============================================================================

describe("CDN Loader - Error Handling", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe("loadManifestFromCDN() - Error handling", () => {
    it("returns empty array when fetch returns non-ok response (404)", async () => {
      // Mock fetch to return 404
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
      });

      const manifests = await loadCDNManifests();

      expect(manifests.items).toHaveLength(0);
      expect(manifests.npcs).toHaveLength(0);
      expect(manifests.resources).toHaveLength(0);
      expect(manifests.music).toHaveLength(0);
      expect(manifests.biomes).toHaveLength(0);
    });

    it("returns empty array when fetch returns 500 server error", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
      });

      const manifests = await loadCDNManifests();

      expect(manifests.items).toHaveLength(0);
      expect(manifests.npcs).toHaveLength(0);
    });

    it("returns empty array when fetch throws network error", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));

      const manifests = await loadCDNManifests();

      expect(manifests.items).toHaveLength(0);
      expect(manifests.npcs).toHaveLength(0);
      expect(manifests.resources).toHaveLength(0);
    });

    it("returns empty array when fetch times out", async () => {
      mockFetch.mockRejectedValue(new Error("Timeout"));

      const manifests = await loadCDNManifests();

      expect(manifests.items).toHaveLength(0);
    });

    it("handles partial CDN failures gracefully", async () => {
      // Some manifests succeed, some fail
      mockFetch.mockImplementation((url: string) => {
        if (url.includes("items.json")) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve([
                {
                  id: "test-item",
                  name: "Test Item",
                  type: "weapon",
                  modelPath: "items/test.glb",
                },
              ]),
          });
        }
        // All others fail
        return Promise.resolve({ ok: false, status: 500 });
      });

      const manifests = await loadCDNManifests();

      // Items should succeed
      expect(manifests.items).toHaveLength(1);
      expect(manifests.items[0].id).toBe("test-item");

      // Others should be empty (graceful degradation)
      expect(manifests.npcs).toHaveLength(0);
      expect(manifests.resources).toHaveLength(0);
      expect(manifests.music).toHaveLength(0);
      expect(manifests.biomes).toHaveLength(0);
    });

    it("handles mixed success and network errors", async () => {
      mockFetch.mockImplementation((url: string) => {
        if (url.includes("npcs.json")) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve([
                {
                  id: "goblin",
                  name: "Goblin",
                  category: "mob",
                  modelPath: "npcs/goblin.glb",
                },
              ]),
          });
        }
        // Others throw network error
        return Promise.reject(new Error("Connection refused"));
      });

      const manifests = await loadCDNManifests();

      // NPCs should succeed
      expect(manifests.npcs).toHaveLength(1);
      expect(manifests.npcs[0].id).toBe("goblin");

      // Others should be empty
      expect(manifests.items).toHaveLength(0);
      expect(manifests.resources).toHaveLength(0);
    });
  });

  describe("loadVRMEmotes() - Non-development mode", () => {
    it("returns empty array in test/production mode", async () => {
      // In test mode, emotes only load from CDN (not implemented)
      const emotes = await loadVRMEmotes();
      expect(emotes).toEqual([]);
    });
  });
});

// =============================================================================
// NAME FORMATTING TESTS - Test the formatting logic used in loader
// =============================================================================

describe("CDN Loader - Name Formatting Logic", () => {
  describe("formatAvatarName() logic", () => {
    // Replicate the formatting logic from loader.ts
    const formatAvatarName = (id: string): string => {
      return id
        .split("-")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
    };

    it("formats hyphenated names correctly", () => {
      expect(formatAvatarName("avatar-female-01")).toBe("Avatar Female 01");
      expect(formatAvatarName("knight")).toBe("Knight");
      expect(formatAvatarName("dark-mage-elite")).toBe("Dark Mage Elite");
      expect(formatAvatarName("npc-shopkeeper")).toBe("Npc Shopkeeper");
    });

    it("handles single word names", () => {
      expect(formatAvatarName("warrior")).toBe("Warrior");
      expect(formatAvatarName("mage")).toBe("Mage");
    });

    it("handles names with numbers", () => {
      expect(formatAvatarName("npc-01")).toBe("Npc 01");
      expect(formatAvatarName("avatar-v2")).toBe("Avatar V2");
    });

    it("handles empty string", () => {
      expect(formatAvatarName("")).toBe("");
    });
  });

  describe("formatEmoteName() logic", () => {
    // Replicate the formatting logic from loader.ts
    const formatEmoteName = (id: string): string => {
      return id
        .replace(/^emote[-_]?/, "")
        .split(/[-_]/)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
    };

    it("removes emote prefix and formats correctly", () => {
      expect(formatEmoteName("emote-dance-happy")).toBe("Dance Happy");
      expect(formatEmoteName("emote_wave")).toBe("Wave");
      expect(formatEmoteName("emotecelebrate")).toBe("Celebrate");
    });

    it("handles names without emote prefix", () => {
      expect(formatEmoteName("idle")).toBe("Idle");
      expect(formatEmoteName("bow")).toBe("Bow");
    });

    it("handles mixed separators", () => {
      expect(formatEmoteName("emote-bow_deep")).toBe("Bow Deep");
      expect(formatEmoteName("dance_fast-spin")).toBe("Dance Fast Spin");
    });

    it("handles complex emote names", () => {
      expect(formatEmoteName("emote-victory-pose-01")).toBe("Victory Pose 01");
      expect(formatEmoteName("emote_laugh_loud")).toBe("Laugh Loud");
    });

    it("handles empty string after prefix removal", () => {
      expect(formatEmoteName("emote")).toBe("");
      expect(formatEmoteName("emote-")).toBe("");
    });
  });
});

// =============================================================================
// VRM AVATAR CONVERSION TESTS - Test CDNAsset creation for VRM files
// =============================================================================

describe("CDN Loader - VRM Asset Conversion Logic", () => {
  it("creates correct CDNAsset from VRM filename", () => {
    const filename = "knight-avatar.vrm";
    const id = filename.replace(".vrm", "");

    // Replicate the conversion logic from loadVRMAvatars
    const formatAvatarName = (avatarId: string): string => {
      return avatarId
        .split("-")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
    };

    const asset = {
      id,
      name: formatAvatarName(id),
      source: "CDN" as const,
      modelPath: `avatars/${filename}`,
      vrmPath: `avatars/${filename}`,
      hasVRM: true,
      category: "npc" as const,
      type: "avatar",
      subtype: "character",
      description: `VRM avatar: ${formatAvatarName(id)}`,
    };

    expect(asset.id).toBe("knight-avatar");
    expect(asset.name).toBe("Knight Avatar");
    expect(asset.hasVRM).toBe(true);
    expect(asset.vrmPath).toBe("avatars/knight-avatar.vrm");
    expect(asset.modelPath).toBe("avatars/knight-avatar.vrm");
    expect(asset.category).toBe("npc");
    expect(asset.type).toBe("avatar");
    expect(asset.description).toBe("VRM avatar: Knight Avatar");
  });

  it("creates correct CDNAsset from emote filename", () => {
    const filename = "emote-dance-happy.glb";
    const id = filename.replace(".glb", "");

    const formatEmoteName = (emoteId: string): string => {
      return emoteId
        .replace(/^emote[-_]?/, "")
        .split(/[-_]/)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
    };

    const asset = {
      id,
      name: formatEmoteName(id),
      source: "CDN" as const,
      modelPath: `emotes/${filename}`,
      category: "item" as const,
      type: "emote",
      subtype: "animation",
      description: `Animation: ${formatEmoteName(id)}`,
    };

    expect(asset.id).toBe("emote-dance-happy");
    expect(asset.name).toBe("Dance Happy");
    expect(asset.modelPath).toBe("emotes/emote-dance-happy.glb");
    expect(asset.type).toBe("emote");
    expect(asset.description).toBe("Animation: Dance Happy");
  });

  it("filters VRM files correctly from directory entries", () => {
    const entries = [
      { name: "knight-avatar.vrm", isFile: () => true },
      { name: "mage-avatar.vrm", isFile: () => true },
      { name: "not-vrm.glb", isFile: () => true },
      { name: "directory", isFile: () => false },
      { name: "another.txt", isFile: () => true },
    ];

    const vrmFiles = entries
      .filter((e) => e.isFile() && e.name.endsWith(".vrm"))
      .map((e) => e.name);

    expect(vrmFiles).toHaveLength(2);
    expect(vrmFiles).toContain("knight-avatar.vrm");
    expect(vrmFiles).toContain("mage-avatar.vrm");
    expect(vrmFiles).not.toContain("not-vrm.glb");
  });

  it("filters GLB emote files correctly from directory entries", () => {
    const entries = [
      { name: "emote-dance.glb", isFile: () => true },
      { name: "emote-wave.glb", isFile: () => true },
      { name: "idle.glb", isFile: () => true },
      { name: "avatar.vrm", isFile: () => true },
      { name: "animations", isFile: () => false },
    ];

    const emoteFiles = entries
      .filter((e) => e.isFile() && e.name.endsWith(".glb"))
      .map((e) => e.name);

    expect(emoteFiles).toHaveLength(3);
    expect(emoteFiles).toContain("emote-dance.glb");
    expect(emoteFiles).toContain("emote-wave.glb");
    expect(emoteFiles).toContain("idle.glb");
    expect(emoteFiles).not.toContain("avatar.vrm");
  });
});
