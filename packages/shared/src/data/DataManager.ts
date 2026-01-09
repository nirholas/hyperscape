/**
 * Data Manager - Centralized Content Database
 *
 * Provides a single point of access to all externalized data including:
 * - Items and equipment
 * - NPCs (categorized as: mob, boss, neutral, quest)
 * - World areas and spawn points
 * - Treasure locations
 * - Banks and stores
 * - Starting items and equipment requirements
 *
 * This system validates data on load and provides type-safe access methods.
 *
 * NPC Categories:
 * - mob: Combat NPCs (goblins, bandits, guards)
 * - boss: Powerful special combat encounters
 * - neutral: Non-combat NPCs (shopkeepers, bank clerks)
 * - quest: Quest-related NPCs (quest givers, quest objectives)
 */

import { BANKS, GENERAL_STORES } from "./banks-stores";
import { ITEMS } from "./items";
import { ALL_NPCS } from "./npcs";
import { COMBAT_CONSTANTS } from "../constants/CombatConstants";
import { generateAllNotedItems } from "./NoteGenerator";
import {
  ALL_WORLD_AREAS,
  STARTER_TOWNS,
  getMobSpawnsInArea,
  getNPCsInArea,
} from "./world-areas";
import { BIOMES } from "./world-structure";
import { loadSkillUnlocks, type SkillUnlocksManifest } from "./skill-unlocks";
import {
  TierDataProvider,
  loadTierRequirements,
  type TierRequirementsManifest,
  type TierableItem,
} from "./TierDataProvider";
import {
  processingDataProvider,
  type CookingManifest,
  type FiremakingManifest,
  type SmeltingManifest,
  type SmithingManifest,
} from "./ProcessingDataProvider";

// Define constants from JSON data
const STARTING_ITEMS: Array<{ id: string }> = []; // Stub - data removed
const TREASURE_LOCATIONS: TreasureLocation[] = []; // Stub - data removed

// Required item category files - must ALL exist for directory loading
// Used by both filesystem and CDN loading for atomic validation
const REQUIRED_ITEM_FILES = [
  "weapons",
  "tools",
  "resources",
  "food",
  "misc",
] as const;
const getAllTreasureLocations = () => TREASURE_LOCATIONS;
const getTreasureLocationsByDifficulty = (_difficulty: number) =>
  TREASURE_LOCATIONS;

import type {
  Item,
  NPCData,
  NPCDataInput,
  NPCCategory,
  TreasureLocation,
  StoreData,
  BiomeData,
} from "../types/core/core";
import type { DataValidationResult } from "../types/core/validation-types";
import type { MobSpawnPoint, NPCLocation, WorldArea } from "./world-areas";
import { WeaponType, EquipmentSlotName, AttackType } from "../types/core/core";

/**
 * Gathering Tool Data - derived from items.json where item.tool is defined
 * Defines tool properties for gathering skills (woodcutting, mining, fishing)
 *
 * OSRS Mechanics:
 * - Woodcutting: tier used for success rate lookup, roll frequency is fixed (4 ticks)
 * - Mining: rollTicks defines time between attempts, success is level-only
 * - Fishing: equipment doesn't affect speed or success
 */
export interface GatheringToolData {
  /** Item ID matching inventory items (e.g., "bronze_hatchet") */
  itemId: string;
  /** Gathering skill this tool is used for */
  skill: "woodcutting" | "mining" | "fishing";
  /** Metal tier for success rate lookup (e.g., "bronze", "dragon") */
  tier: string;
  /** Skill level required to use this tool (derived from tier or explicit) */
  levelRequired: number;
  /** For mining: ticks between roll attempts (OSRS-accurate) */
  rollTicks?: number;
  /** Priority for best tool selection (lower = better, 1 = best) */
  priority: number;
}

/**
 * Tool data embedded in items.json
 */
export interface ItemToolData {
  skill: "woodcutting" | "mining" | "fishing";
  priority: number;
  rollTicks?: number;
}

/**
 * External Resource Data - loaded from gathering/*.json manifests
 * Used by ResourceSystem for trees, ores, and fishing spots.
 */
export interface ExternalResourceData {
  id: string;
  name: string;
  type: string;
  examine?: string;
  modelPath: string | null;
  depletedModelPath: string | null;
  scale: number;
  depletedScale: number;
  harvestSkill: string;
  toolRequired: string | null;
  /** Secondary consumable required (e.g., "fishing_bait", "feathers") */
  secondaryRequired?: string;
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
    stackable: boolean;
    /** Level required to catch this specific fish (OSRS-accurate) */
    levelRequired?: number;
    /** OSRS catch rate at level 1 (x/256) - for priority rolling */
    catchLow?: number;
    /** OSRS catch rate at level 99 (x/256) - for priority rolling */
    catchHigh?: number;
  }>;
}

/**
 * Woodcutting manifest structure - gathering/woodcutting.json
 */
export interface WoodcuttingManifest {
  trees: ExternalResourceData[];
}

/**
 * Mining manifest structure - gathering/mining.json
 */
export interface MiningManifest {
  rocks: ExternalResourceData[];
}

/**
 * Fishing manifest structure - gathering/fishing.json
 */
export interface FishingManifest {
  spots: ExternalResourceData[];
}

/**
 * Centralized Data Manager
 */
export class DataManager {
  private static instance: DataManager;
  private isInitialized = false;
  private validationResult: DataValidationResult | null = null;
  private worldAssetsDir: string | null = null;

  private constructor() {
    // Private constructor for singleton pattern
  }

  /**
   * Get the singleton instance
   */
  public static getInstance(): DataManager {
    if (!DataManager.instance) {
      DataManager.instance = new DataManager();
    }
    return DataManager.instance;
  }

  /**
   * Load manifests from CDN (client) or filesystem (server)
   */
  private async loadManifestsFromCDN(): Promise<void> {
    // On server (Node.js), load from filesystem since HTTP server isn't up yet
    // Check for Node.js-specific globals that don't exist in browsers
    const isServer =
      typeof process !== "undefined" &&
      process.versions !== undefined &&
      process.versions.node !== undefined;

    if (isServer) {
      await this.loadManifestsFromFilesystem();
      return;
    }

    // Client: Load from CDN (localhost:8080 in dev, R2/S3 in prod)
    let cdnUrl = "http://localhost:8080";
    // Check for CDN URL in multiple places (browser env vars, window global, process.env)
    if (typeof window !== "undefined") {
      const windowWithCdn = window as Window & { __CDN_URL?: string };
      if (windowWithCdn.__CDN_URL) {
        cdnUrl = windowWithCdn.__CDN_URL;
      } else if (
        typeof import.meta !== "undefined" &&
        import.meta.env?.PUBLIC_CDN_URL
      ) {
        cdnUrl = import.meta.env.PUBLIC_CDN_URL;
      }
    }
    if (
      typeof process !== "undefined" &&
      typeof process.env !== "undefined" &&
      process.env.PUBLIC_CDN_URL &&
      !cdnUrl.includes("localhost")
    ) {
      cdnUrl = process.env.PUBLIC_CDN_URL;
    }
    const baseUrl = `${cdnUrl}/manifests`;

    // In test/CI environments, CDN might not be available - make loading non-fatal
    const isTestEnv =
      typeof process !== "undefined" &&
      typeof process.env !== "undefined" &&
      process.env.NODE_ENV === "test";

    try {
      // Load tier requirements FIRST - needed for normalizeItem to derive requirements from tier
      try {
        const tierReqRes = await fetch(`${baseUrl}/tier-requirements.json`);
        const tierReqManifest =
          (await tierReqRes.json()) as TierRequirementsManifest;
        loadTierRequirements(tierReqManifest);
      } catch {
        console.warn(
          "[DataManager] tier-requirements.json not found, tier-based requirements unavailable",
        );
      }

      // Load items - try directory first (atomic), fall back to single file
      let loadedFromDirectory = false;
      try {
        // ATOMIC: Fetch all files in parallel, only process if ALL succeed
        const responses = await Promise.all(
          REQUIRED_ITEM_FILES.map((file) =>
            fetch(`${baseUrl}/items/${file}.json`),
          ),
        );

        // Check ALL responses are OK before processing any
        if (responses.every((res) => res.ok)) {
          // All files exist - parse and load
          const allItemArrays = await Promise.all(
            responses.map((res) => res.json()),
          );

          const seenIds = new Set<string>();
          for (let i = 0; i < REQUIRED_ITEM_FILES.length; i++) {
            const items = allItemArrays[i] as Item[];
            for (const item of items) {
              if (seenIds.has(item.id)) {
                throw new Error(
                  `[DataManager] Duplicate item ID "${item.id}" in items/${REQUIRED_ITEM_FILES[i]}.json`,
                );
              }
              seenIds.add(item.id);
              const normalized = this.normalizeItem(item);
              (ITEMS as Map<string, Item>).set(normalized.id, normalized);
            }
          }
          console.log(
            `[DataManager] Loaded ${seenIds.size} items from items/ directory`,
          );
          loadedFromDirectory = true;
        }
      } catch {
        // Directory loading failed - will fall back below
      }

      if (!loadedFromDirectory) {
        // Fallback: Load from single items.json (backwards compatibility)
        const itemsRes = await fetch(`${baseUrl}/items.json`);
        const list = (await itemsRes.json()) as Array<Item>;
        for (const it of list) {
          const normalized = this.normalizeItem(it);
          (ITEMS as Map<string, Item>).set(normalized.id, normalized);
        }
      }

      // Generate noted variants for all eligible items
      // This auto-creates "{itemId}_noted" variants for tradeable, non-stackable items
      const itemsWithNotes = generateAllNotedItems(ITEMS);
      // Clear and repopulate ITEMS map with noted variants included
      (ITEMS as Map<string, Item>).clear();
      for (const [id, item] of itemsWithNotes) {
        (ITEMS as Map<string, Item>).set(id, item);
      }

      // Load NPCs (unified standardized structure with categories: mob, boss, neutral, quest)
      // JSON uses NPCDataInput (optional fields), normalizeNPC() fills in defaults to produce NPCData
      const npcsRes = await fetch(`${baseUrl}/npcs.json`);
      const npcList = (await npcsRes.json()) as Array<NPCDataInput>;

      // Store all NPCs in unified collection
      for (const npc of npcList) {
        const normalized = this.normalizeNPC(npc);
        (ALL_NPCS as Map<string, NPCData>).set(normalized.id, normalized);
      }

      // Load gathering resources from separate per-skill manifests
      // This matches the recipes/ pattern for organizational consistency
      await this.loadGatheringManifestsFromCDN(baseUrl);

      // Load world areas
      const worldAreasRes = await fetch(`${baseUrl}/world-areas.json`);
      const worldAreasData = (await worldAreasRes.json()) as {
        starterTowns: Record<string, WorldArea>;
        level1Areas: Record<string, WorldArea>;
        level2Areas: Record<string, WorldArea>;
        level3Areas: Record<string, WorldArea>;
      };

      // Merge all areas into ALL_WORLD_AREAS
      Object.assign(
        ALL_WORLD_AREAS,
        worldAreasData.starterTowns,
        worldAreasData.level1Areas,
        worldAreasData.level2Areas,
        worldAreasData.level3Areas,
      );
      Object.assign(STARTER_TOWNS, worldAreasData.starterTowns);

      // Load biomes
      const biomesRes = await fetch(`${baseUrl}/biomes.json`);
      const biomeList = (await biomesRes.json()) as Array<BiomeData>;
      for (const biome of biomeList) {
        BIOMES[biome.id] = biome;
      }

      // zones.json removed - use world-areas.json instead
      // WORLD_ZONES remains empty, ZoneDetectionSystem uses ALL_WORLD_AREAS as primary

      // banks.json removed - BankingSystem uses hardcoded STARTER_TOWN_BANKS
      // BANKS object exists but is unused

      // Load stores
      const storesRes = await fetch(`${baseUrl}/stores.json`);
      const storeList = (await storesRes.json()) as Array<StoreData>;
      for (const store of storeList) {
        GENERAL_STORES[store.id] = store;
      }

      // Load recipe manifests for ProcessingDataProvider
      await this.loadRecipeManifestsFromCDN(baseUrl);

      // Build EXTERNAL_TOOLS from items where item.tool is defined
      // This replaces the old tools.json loading
      this.buildToolsFromItems();
    } catch (error) {
      // In test/CI environments, CDN might not be available - this is non-fatal
      if (isTestEnv) {
        console.warn(
          "[DataManager] ⚠️  CDN not available in test environment - skipping manifest loading",
        );
        console.warn(
          "[DataManager] This is expected in CI/test - game data will use defaults",
        );
      } else {
        // In production/development, CDN should be available - log error and re-throw
        console.error(
          "[DataManager] ❌ Failed to load manifests from CDN:",
          error,
        );
        throw error;
      }
    }
  }

  /**
   * Load manifests from filesystem (server-side only)
   * Uses packages/server/world/assets/manifests/ directory
   */
  private async loadManifestsFromFilesystem(): Promise<void> {
    // Dynamic import for Node.js modules (not available in browser)
    const fs = await import("fs/promises");
    const path = await import("path");

    // Find manifests directory - assets are in packages/server/world/assets/
    let manifestsDir: string;
    if (process.env.ASSETS_DIR) {
      manifestsDir = path.join(process.env.ASSETS_DIR, "manifests");
    } else {
      // cwd is typically packages/server when running the server
      const cwd = process.cwd();
      // Normalize path separators for cross-platform compatibility (Windows uses \, Unix uses /)
      const normalizedCwd = cwd.replace(/\\/g, "/");
      if (
        normalizedCwd.endsWith("/packages/server") ||
        normalizedCwd.includes("/packages/server/")
      ) {
        // Running from packages/server - assets are in world/assets/
        manifestsDir = path.join(cwd, "world", "assets", "manifests");
      } else if (normalizedCwd.includes("/packages/")) {
        // Running from another package - navigate to server assets
        const workspaceRoot = path.resolve(cwd, "../..");
        manifestsDir = path.join(
          workspaceRoot,
          "packages",
          "server",
          "world",
          "assets",
          "manifests",
        );
      } else {
        // Already at workspace root
        manifestsDir = path.join(
          cwd,
          "packages",
          "server",
          "world",
          "assets",
          "manifests",
        );
      }
    }

    console.log(
      `[DataManager] Loading manifests from filesystem: ${manifestsDir}`,
    );

    try {
      // Load tier requirements FIRST - needed for normalizeItem to derive requirements from tier
      const tierReqPath = path.join(manifestsDir, "tier-requirements.json");
      try {
        const tierReqData = await fs.readFile(tierReqPath, "utf-8");
        const tierReqManifest = JSON.parse(
          tierReqData,
        ) as TierRequirementsManifest;
        loadTierRequirements(tierReqManifest);
      } catch {
        console.warn(
          "[DataManager] tier-requirements.json not found, tier-based requirements unavailable",
        );
      }

      // Load items - try directory first, fall back to single file
      const itemsDir = path.join(manifestsDir, "items");
      let loadedFromDirectory = false;

      try {
        await fs.access(itemsDir);
        // Directory exists - try to load from it (validates all required files)
        loadedFromDirectory = await this.loadItemsFromDirectory(
          fs,
          path,
          itemsDir,
        );
      } catch {
        // Directory doesn't exist - will fall back below
      }

      if (!loadedFromDirectory) {
        // Fallback: Load from single items.json (backwards compatibility)
        const itemsPath = path.join(manifestsDir, "items.json");
        const itemsData = await fs.readFile(itemsPath, "utf-8");
        const list = JSON.parse(itemsData) as Array<Item>;
        for (const it of list) {
          const normalized = this.normalizeItem(it);
          (ITEMS as Map<string, Item>).set(normalized.id, normalized);
        }
      }

      // Generate noted variants
      const itemsWithNotes = generateAllNotedItems(ITEMS);
      (ITEMS as Map<string, Item>).clear();
      for (const [id, item] of itemsWithNotes) {
        (ITEMS as Map<string, Item>).set(id, item);
      }

      // Load NPCs
      const npcsPath = path.join(manifestsDir, "npcs.json");
      const npcsData = await fs.readFile(npcsPath, "utf-8");
      const npcList = JSON.parse(npcsData) as Array<NPCDataInput>;
      for (const npc of npcList) {
        const normalized = this.normalizeNPC(npc);
        (ALL_NPCS as Map<string, NPCData>).set(normalized.id, normalized);
      }

      // Load gathering resources from separate per-skill manifests
      // This matches the recipes/ pattern for organizational consistency
      await this.loadGatheringManifestsFromFilesystem(fs, path, manifestsDir);

      // Load world areas
      const worldAreasPath = path.join(manifestsDir, "world-areas.json");
      const worldAreasData = await fs.readFile(worldAreasPath, "utf-8");
      const worldAreas = JSON.parse(worldAreasData) as {
        starterTowns: Record<string, WorldArea>;
        level1Areas: Record<string, WorldArea>;
        level2Areas: Record<string, WorldArea>;
        level3Areas: Record<string, WorldArea>;
      };
      Object.assign(
        ALL_WORLD_AREAS,
        worldAreas.starterTowns,
        worldAreas.level1Areas,
        worldAreas.level2Areas,
        worldAreas.level3Areas,
      );
      Object.assign(STARTER_TOWNS, worldAreas.starterTowns);

      // Load biomes
      const biomesPath = path.join(manifestsDir, "biomes.json");
      const biomesData = await fs.readFile(biomesPath, "utf-8");
      const biomeList = JSON.parse(biomesData) as Array<BiomeData>;
      for (const biome of biomeList) {
        BIOMES[biome.id] = biome;
      }

      // Load stores
      const storesPath = path.join(manifestsDir, "stores.json");
      const storesData = await fs.readFile(storesPath, "utf-8");
      const storeList = JSON.parse(storesData) as Array<StoreData>;
      for (const store of storeList) {
        (GENERAL_STORES as Record<string, StoreData>)[store.id] = store;
      }

      // Load skill unlocks
      const skillUnlocksPath = path.join(manifestsDir, "skill-unlocks.json");
      try {
        const skillUnlocksData = await fs.readFile(skillUnlocksPath, "utf-8");
        const skillUnlocksManifest = JSON.parse(
          skillUnlocksData,
        ) as SkillUnlocksManifest;
        loadSkillUnlocks(skillUnlocksManifest);
      } catch {
        console.warn(
          "[DataManager] skill-unlocks.json not found, skill unlocks will be empty until loaded",
        );
      }

      // Load recipe manifests for ProcessingDataProvider
      await this.loadRecipeManifestsFromFilesystem(fs, path, manifestsDir);

      // Build EXTERNAL_TOOLS from items where item.tool is defined
      // This replaces the old tools.json loading
      this.buildToolsFromItems();

      // Count tools for logging
      const toolCount =
        (globalThis as { EXTERNAL_TOOLS?: Map<string, GatheringToolData> })
          .EXTERNAL_TOOLS?.size ?? 0;

      console.log(
        `[DataManager] ✅ Loaded manifests from filesystem (${(ITEMS as Map<string, Item>).size} items, ${(ALL_NPCS as Map<string, NPCData>).size} NPCs, ${Object.keys(BIOMES).length} biomes, ${toolCount} tools)`,
      );
    } catch (error) {
      console.error(
        "[DataManager] ❌ Failed to load manifests from filesystem:",
        error,
      );
      throw error;
    }
  }

  /**
   * Load external assets from CDN (works for both client and server)
   */
  private async loadExternalAssetsFromWorld(): Promise<void> {
    // Both client and server now load from CDN
    await this.loadManifestsFromCDN();
  }

  /**
   * Load items from items/ directory (multiple JSON files) - Filesystem version
   * Returns true if successful, false if should fall back to single file
   *
   * CRITICAL: Validates ALL required files exist before loading any.
   * This prevents partial loads if a file is missing.
   */
  private async loadItemsFromDirectory(
    fs: typeof import("fs/promises"),
    path: typeof import("path"),
    itemsDir: string,
  ): Promise<boolean> {
    // Validate ALL required files exist before loading any
    for (const file of REQUIRED_ITEM_FILES) {
      const filePath = path.join(itemsDir, `${file}.json`);
      try {
        await fs.access(filePath);
      } catch {
        console.warn(
          `[DataManager] items/${file}.json not found, falling back to items.json`,
        );
        return false;
      }
    }

    // All files exist - safe to load
    const seenIds = new Set<string>();

    for (const file of REQUIRED_ITEM_FILES) {
      const filePath = path.join(itemsDir, `${file}.json`);
      const data = await fs.readFile(filePath, "utf-8");
      const items = JSON.parse(data) as Array<Item>;

      for (const item of items) {
        // Duplicate ID check
        if (seenIds.has(item.id)) {
          throw new Error(
            `[DataManager] Duplicate item ID "${item.id}" found in items/${file}.json`,
          );
        }
        seenIds.add(item.id);

        const normalized = this.normalizeItem(item);
        (ITEMS as Map<string, Item>).set(normalized.id, normalized);
      }
    }

    console.log(
      `[DataManager] Loaded ${seenIds.size} items from items/ directory`,
    );
    return true;
  }

  private normalizeItem(item: Item): Item {
    // Ensure required fields have sane defaults and enums
    const safeWeaponType = item.weaponType ?? WeaponType.NONE;
    const equipSlot = item.equipSlot ?? null;
    const attackType = item.attackType ?? null;

    // Validate: weapons with equipSlot "weapon" should have equippedModelPath
    if (equipSlot === "weapon" && !item.equippedModelPath) {
      console.warn(
        `[DataManager] Weapon "${item.id}" missing equippedModelPath - will use convention fallback`,
      );
    }

    // Derive requirements from tier if not explicitly set
    // This implements the tier-based requirements system
    let requirements = item.requirements;
    if (!requirements && item.tier && TierDataProvider.isLoaded()) {
      const tierableItem: TierableItem = {
        id: item.id,
        type: item.type,
        tier: item.tier,
        equipSlot: equipSlot || undefined,
        attackType: attackType || undefined,
        tool: item.tool,
      };
      const derived = TierDataProvider.getRequirements(tierableItem);
      if (derived) {
        // Calculate level as max of all skill requirements
        const level = Math.max(
          1,
          ...Object.values(derived).filter(
            (v): v is number => typeof v === "number",
          ),
        );
        requirements = {
          level,
          skills: derived,
        };
      }
    }

    // Apply defaults only for missing fields (use ?? to preserve falsy values like 0)
    const normalized: Item = {
      ...item,
      type: item.type,
      weaponType: safeWeaponType,
      equipSlot: equipSlot as EquipmentSlotName | null,
      attackType: attackType as AttackType | null,
      // Inventory properties with defaults
      quantity: item.quantity ?? 1,
      stackable: item.stackable ?? false,
      maxStackSize: item.maxStackSize ?? 1,
      value: item.value ?? 0,
      weight: item.weight ?? 0.1,
      // Equipment properties with defaults
      equipable: item.equipable ?? !!equipSlot,
      // Item properties with defaults
      description: item.description || item.name || "Item",
      examine: item.examine || item.description || item.name || "Item",
      // Optional properties
      healAmount: item.healAmount,
      attackSpeed: item.attackSpeed,
      // Melee weapons default to standard range, others use manifest value
      attackRange:
        item.attackRange ??
        (attackType === AttackType.MELEE
          ? COMBAT_CONSTANTS.DEFAULTS.ITEM.ATTACK_RANGE
          : undefined),
      equippedModelPath: item.equippedModelPath,
      bonuses: item.bonuses,
      requirements: requirements,
    };
    return normalized;
  }

  /**
   * Build EXTERNAL_TOOLS map from items where item.tool is defined
   * This replaces loading from tools.json
   */
  private buildToolsFromItems(): void {
    if (
      !(
        globalThis as {
          EXTERNAL_TOOLS?: Map<string, GatheringToolData>;
        }
      ).EXTERNAL_TOOLS
    ) {
      (
        globalThis as {
          EXTERNAL_TOOLS?: Map<string, GatheringToolData>;
        }
      ).EXTERNAL_TOOLS = new Map();
    }

    const toolsMap = (
      globalThis as unknown as {
        EXTERNAL_TOOLS: Map<string, GatheringToolData>;
      }
    ).EXTERNAL_TOOLS;

    // Clear existing tools
    toolsMap.clear();

    // Build tools from items
    for (const [itemId, item] of ITEMS) {
      if (item.tool) {
        // Determine level required from tier or explicit requirements
        let levelRequired = 1;
        if (item.requirements?.skills) {
          // Use the skill level from requirements that matches the tool skill
          const skillLevel = item.requirements.skills[item.tool.skill];
          if (skillLevel) {
            levelRequired = skillLevel;
          }
        } else if (item.tier && TierDataProvider.isLoaded()) {
          // Derive from tier
          const tierableItem: TierableItem = {
            id: item.id,
            type: item.type,
            tier: item.tier,
            tool: item.tool,
          };
          const derived = TierDataProvider.getRequirements(tierableItem);
          if (derived) {
            const skillLevel = derived[item.tool.skill as keyof typeof derived];
            if (skillLevel) {
              levelRequired = skillLevel;
            }
          }
        }

        const toolData: GatheringToolData = {
          itemId,
          skill: item.tool.skill,
          tier: item.tier || "unknown",
          levelRequired,
          rollTicks: item.tool.rollTicks,
          priority: item.tool.priority,
        };

        toolsMap.set(itemId, toolData);
      }
    }
  }

  /**
   * Load recipe manifests from CDN
   */
  private async loadRecipeManifestsFromCDN(baseUrl: string): Promise<void> {
    // Load cooking recipes
    try {
      const cookingRes = await fetch(`${baseUrl}/recipes/cooking.json`);
      const cookingManifest = (await cookingRes.json()) as CookingManifest;
      processingDataProvider.loadCookingRecipes(cookingManifest);
    } catch {
      console.warn(
        "[DataManager] recipes/cooking.json not found, falling back to embedded item data",
      );
    }

    // Load firemaking recipes
    try {
      const firemakingRes = await fetch(`${baseUrl}/recipes/firemaking.json`);
      const firemakingManifest =
        (await firemakingRes.json()) as FiremakingManifest;
      processingDataProvider.loadFiremakingRecipes(firemakingManifest);
    } catch {
      console.warn(
        "[DataManager] recipes/firemaking.json not found, falling back to embedded item data",
      );
    }

    // Load smelting recipes
    try {
      const smeltingRes = await fetch(`${baseUrl}/recipes/smelting.json`);
      const smeltingManifest = (await smeltingRes.json()) as SmeltingManifest;
      processingDataProvider.loadSmeltingRecipes(smeltingManifest);
    } catch {
      console.warn(
        "[DataManager] recipes/smelting.json not found, falling back to embedded item data",
      );
    }

    // Load smithing recipes
    try {
      const smithingRes = await fetch(`${baseUrl}/recipes/smithing.json`);
      const smithingManifest = (await smithingRes.json()) as SmithingManifest;
      processingDataProvider.loadSmithingRecipes(smithingManifest);
    } catch {
      console.warn(
        "[DataManager] recipes/smithing.json not found, falling back to embedded item data",
      );
    }

    // Rebuild ProcessingDataProvider to use the loaded manifests
    // This is necessary in case it was already lazy-initialized before manifests loaded
    processingDataProvider.rebuild();
  }

  /**
   * Load recipe manifests from filesystem (server-side)
   */
  private async loadRecipeManifestsFromFilesystem(
    fs: typeof import("fs/promises"),
    path: typeof import("path"),
    manifestsDir: string,
  ): Promise<void> {
    const recipesDir = path.join(manifestsDir, "recipes");

    // Load cooking recipes
    try {
      const cookingPath = path.join(recipesDir, "cooking.json");
      const cookingData = await fs.readFile(cookingPath, "utf-8");
      const cookingManifest = JSON.parse(cookingData) as CookingManifest;
      processingDataProvider.loadCookingRecipes(cookingManifest);
    } catch {
      console.warn(
        "[DataManager] recipes/cooking.json not found, falling back to embedded item data",
      );
    }

    // Load firemaking recipes
    try {
      const firemakingPath = path.join(recipesDir, "firemaking.json");
      const firemakingData = await fs.readFile(firemakingPath, "utf-8");
      const firemakingManifest = JSON.parse(
        firemakingData,
      ) as FiremakingManifest;
      processingDataProvider.loadFiremakingRecipes(firemakingManifest);
    } catch {
      console.warn(
        "[DataManager] recipes/firemaking.json not found, falling back to embedded item data",
      );
    }

    // Load smelting recipes
    try {
      const smeltingPath = path.join(recipesDir, "smelting.json");
      const smeltingData = await fs.readFile(smeltingPath, "utf-8");
      const smeltingManifest = JSON.parse(smeltingData) as SmeltingManifest;
      processingDataProvider.loadSmeltingRecipes(smeltingManifest);
    } catch {
      console.warn(
        "[DataManager] recipes/smelting.json not found, falling back to embedded item data",
      );
    }

    // Load smithing recipes
    try {
      const smithingPath = path.join(recipesDir, "smithing.json");
      const smithingData = await fs.readFile(smithingPath, "utf-8");
      const smithingManifest = JSON.parse(smithingData) as SmithingManifest;
      processingDataProvider.loadSmithingRecipes(smithingManifest);
    } catch {
      console.warn(
        "[DataManager] recipes/smithing.json not found, falling back to embedded item data",
      );
    }

    // Rebuild ProcessingDataProvider to use the loaded manifests
    // This is necessary in case it was already lazy-initialized before manifests loaded
    processingDataProvider.rebuild();
  }

  /**
   * Load gathering manifests from CDN
   * Loads woodcutting, mining, and fishing data from gathering/*.json
   * and populates EXTERNAL_RESOURCES for ResourceSystem
   */
  private async loadGatheringManifestsFromCDN(baseUrl: string): Promise<void> {
    // Initialize EXTERNAL_RESOURCES map if needed
    if (
      !(
        globalThis as {
          EXTERNAL_RESOURCES?: Map<string, ExternalResourceData>;
        }
      ).EXTERNAL_RESOURCES
    ) {
      (
        globalThis as {
          EXTERNAL_RESOURCES?: Map<string, ExternalResourceData>;
        }
      ).EXTERNAL_RESOURCES = new Map();
    }

    const resourcesMap = (
      globalThis as unknown as {
        EXTERNAL_RESOURCES: Map<string, ExternalResourceData>;
      }
    ).EXTERNAL_RESOURCES;

    // Load woodcutting (trees)
    try {
      const woodcuttingRes = await fetch(
        `${baseUrl}/gathering/woodcutting.json`,
      );
      const woodcuttingManifest =
        (await woodcuttingRes.json()) as WoodcuttingManifest;
      for (const tree of woodcuttingManifest.trees) {
        resourcesMap.set(tree.id, tree);
      }
    } catch {
      console.warn(
        "[DataManager] gathering/woodcutting.json not found, trying legacy resources.json",
      );
    }

    // Load mining (rocks/ores)
    try {
      const miningRes = await fetch(`${baseUrl}/gathering/mining.json`);
      const miningManifest = (await miningRes.json()) as MiningManifest;
      for (const rock of miningManifest.rocks) {
        resourcesMap.set(rock.id, rock);
      }
    } catch {
      console.warn(
        "[DataManager] gathering/mining.json not found, trying legacy resources.json",
      );
    }

    // Load fishing (spots)
    try {
      const fishingRes = await fetch(`${baseUrl}/gathering/fishing.json`);
      const fishingManifest = (await fishingRes.json()) as FishingManifest;
      for (const spot of fishingManifest.spots) {
        resourcesMap.set(spot.id, spot);
      }
    } catch {
      console.warn(
        "[DataManager] gathering/fishing.json not found, trying legacy resources.json",
      );
    }

    // Fallback to legacy resources.json if no resources loaded
    if (resourcesMap.size === 0) {
      console.warn(
        "[DataManager] No gathering manifests found, falling back to resources.json",
      );
      try {
        const resourcesRes = await fetch(`${baseUrl}/resources.json`);
        const resourceList =
          (await resourcesRes.json()) as Array<ExternalResourceData>;
        for (const resource of resourceList) {
          resourcesMap.set(resource.id, resource);
        }
      } catch {
        console.error(
          "[DataManager] Failed to load resources - gathering skills will not work",
        );
      }
    }
  }

  /**
   * Load gathering manifests from filesystem (server-side)
   * Loads woodcutting, mining, and fishing data from gathering/*.json
   * and populates EXTERNAL_RESOURCES for ResourceSystem
   */
  private async loadGatheringManifestsFromFilesystem(
    fs: typeof import("fs/promises"),
    path: typeof import("path"),
    manifestsDir: string,
  ): Promise<void> {
    // Initialize EXTERNAL_RESOURCES map if needed
    if (
      !(
        globalThis as {
          EXTERNAL_RESOURCES?: Map<string, ExternalResourceData>;
        }
      ).EXTERNAL_RESOURCES
    ) {
      (
        globalThis as {
          EXTERNAL_RESOURCES?: Map<string, ExternalResourceData>;
        }
      ).EXTERNAL_RESOURCES = new Map();
    }

    const resourcesMap = (
      globalThis as unknown as {
        EXTERNAL_RESOURCES: Map<string, ExternalResourceData>;
      }
    ).EXTERNAL_RESOURCES;

    const gatheringDir = path.join(manifestsDir, "gathering");

    // Load woodcutting (trees)
    try {
      const woodcuttingPath = path.join(gatheringDir, "woodcutting.json");
      const woodcuttingData = await fs.readFile(woodcuttingPath, "utf-8");
      const woodcuttingManifest = JSON.parse(
        woodcuttingData,
      ) as WoodcuttingManifest;
      for (const tree of woodcuttingManifest.trees) {
        resourcesMap.set(tree.id, tree);
      }
    } catch {
      console.warn(
        "[DataManager] gathering/woodcutting.json not found, trying legacy resources.json",
      );
    }

    // Load mining (rocks/ores)
    try {
      const miningPath = path.join(gatheringDir, "mining.json");
      const miningData = await fs.readFile(miningPath, "utf-8");
      const miningManifest = JSON.parse(miningData) as MiningManifest;
      for (const rock of miningManifest.rocks) {
        resourcesMap.set(rock.id, rock);
      }
    } catch {
      console.warn(
        "[DataManager] gathering/mining.json not found, trying legacy resources.json",
      );
    }

    // Load fishing (spots)
    try {
      const fishingPath = path.join(gatheringDir, "fishing.json");
      const fishingData = await fs.readFile(fishingPath, "utf-8");
      const fishingManifest = JSON.parse(fishingData) as FishingManifest;
      for (const spot of fishingManifest.spots) {
        resourcesMap.set(spot.id, spot);
      }
    } catch {
      console.warn(
        "[DataManager] gathering/fishing.json not found, trying legacy resources.json",
      );
    }

    // Fallback to legacy resources.json if no resources loaded
    if (resourcesMap.size === 0) {
      console.warn(
        "[DataManager] No gathering manifests found, falling back to resources.json",
      );
      try {
        const resourcesPath = path.join(manifestsDir, "resources.json");
        const resourcesData = await fs.readFile(resourcesPath, "utf-8");
        const resourceList = JSON.parse(
          resourcesData,
        ) as Array<ExternalResourceData>;
        for (const resource of resourceList) {
          resourcesMap.set(resource.id, resource);
        }
      } catch {
        console.error(
          "[DataManager] Failed to load resources - gathering skills will not work",
        );
      }
    }
  }

  private normalizeNPC(npc: NPCDataInput): NPCData {
    // Ensure required fields have sane defaults
    const defaults: Partial<NPCData> = {
      faction: npc.faction || "unknown",
      stats: {
        level: npc.stats?.level ?? 1,
        health: npc.stats?.health ?? 10, // OSRS: hitpoints = max HP directly
        attack: npc.stats?.attack ?? 1,
        strength: npc.stats?.strength ?? 1,
        defense: npc.stats?.defense ?? 1,
        ranged: npc.stats?.ranged ?? 1,
        magic: npc.stats?.magic ?? 1,
      },
      combat: {
        attackable: npc.combat?.attackable ?? true,
        aggressive: npc.combat?.aggressive ?? false,
        retaliates: npc.combat?.retaliates ?? true,
        aggroRange: npc.combat?.aggroRange ?? 0, // 0 = non-aggressive by default
        combatRange:
          npc.combat?.combatRange ?? COMBAT_CONSTANTS.DEFAULTS.NPC.COMBAT_RANGE,
        attackSpeedTicks:
          npc.combat?.attackSpeedTicks ??
          COMBAT_CONSTANTS.DEFAULTS.NPC.ATTACK_SPEED_TICKS,
        respawnTime:
          (npc.combat?.respawnTicks ??
            COMBAT_CONSTANTS.DEFAULTS.NPC.RESPAWN_TICKS) *
          COMBAT_CONSTANTS.TICK_DURATION_MS, // Convert ticks to ms
        xpReward: npc.combat?.xpReward ?? 0,
        poisonous: npc.combat?.poisonous ?? false,
        immuneToPoison: npc.combat?.immuneToPoison ?? false,
      },
      movement: {
        type: npc.movement?.type ?? "stationary",
        speed: npc.movement?.speed ?? 1,
        wanderRadius: npc.movement?.wanderRadius ?? 0,
        roaming: npc.movement?.roaming ?? false,
      },
      drops: {
        defaultDrop: npc.drops?.defaultDrop ?? {
          enabled: false,
          itemId: "",
          quantity: 0,
        },
        always: npc.drops?.always ?? [],
        common: npc.drops?.common ?? [],
        uncommon: npc.drops?.uncommon ?? [],
        rare: npc.drops?.rare ?? [],
        veryRare: npc.drops?.veryRare ?? [],
        rareDropTable: npc.drops?.rareDropTable ?? false,
        rareDropTableChance: npc.drops?.rareDropTableChance,
      },
      services: {
        enabled: npc.services?.enabled ?? false,
        types: npc.services?.types ?? [],
        shopInventory: npc.services?.shopInventory,
        questIds: npc.services?.questIds,
      },
      behavior: {
        enabled: npc.behavior?.enabled ?? false,
        config: npc.behavior?.config,
      },
      appearance: {
        modelPath: npc.appearance?.modelPath ?? "",
        iconPath: npc.appearance?.iconPath,
        scale: npc.appearance?.scale ?? 1.0,
        tint: npc.appearance?.tint,
      },
      position: npc.position || { x: 0, y: 0, z: 0 },
    };
    return {
      ...npc,
      ...defaults,
    } as NPCData;
  }

  /**
   * Initialize the data manager and validate all data
   */
  public async initialize(): Promise<DataValidationResult> {
    if (this.isInitialized) {
      return this.validationResult!;
    }

    // Load externally generated assets (Forge) before validation
    await this.loadExternalAssetsFromWorld();

    this.validationResult = await this.validateAllData();
    this.isInitialized = true;

    if (!this.validationResult.isValid) {
      throw new Error(
        `[DataManager] ❌ Data validation failed: ${this.validationResult.errors.join(", ")}`,
      );
    }

    return this.validationResult;
  }

  /**
   * Validate all externalized data
   */
  private async validateAllData(): Promise<DataValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate items (warning only - manifests might be loading)
    const itemCount = ITEMS.size;
    if (itemCount === 0) {
      warnings.push("No items loaded from manifests yet");
    }

    // Validate NPCs (warning only - manifests might be loading)
    const npcCount = ALL_NPCS.size;
    if (npcCount === 0) {
      warnings.push("No NPCs loaded from manifests yet");
    }

    // Validate world areas
    const areaCount = Object.keys(ALL_WORLD_AREAS).length;
    if (areaCount === 0) {
      errors.push("No world areas found in ALL_WORLD_AREAS");
    }

    // Validate treasure locations
    const treasureCount = Object.keys(TREASURE_LOCATIONS).length;
    if (treasureCount === 0) {
      warnings.push("No treasure locations found in TREASURE_LOCATIONS");
    }

    // Validate cross-references (only if we have data)
    if (itemCount > 0 && npcCount > 0) {
      this.validateCrossReferences(errors, warnings);
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      itemCount,
      npcCount,
      areaCount,
      treasureCount,
    };
  }

  /**
   * Validate cross-references between data sets
   */
  private validateCrossReferences(errors: string[], _warnings: string[]): void {
    // Check that mob spawn points reference valid mobs
    for (const [areaId, area] of Object.entries(ALL_WORLD_AREAS)) {
      if (area.mobSpawns) {
        for (const mobSpawn of area.mobSpawns) {
          if (!ALL_NPCS.has(mobSpawn.mobId)) {
            errors.push(
              `Area ${areaId} references unknown NPC: ${mobSpawn.mobId}`,
            );
          }
        }
      }
    }

    // Check that starter items reference valid items
    for (const startingItem of STARTING_ITEMS) {
      if (!ITEMS.has(startingItem.id)) {
        errors.push(
          `Starting item references unknown item: ${startingItem.id}`,
        );
      }
    }
  }

  /**
   * Get validation result
   */
  public getValidationResult(): DataValidationResult | null {
    return this.validationResult;
  }

  // =============================================================================
  // ITEM DATA ACCESS METHODS
  // =============================================================================

  /**
   * Get all items
   */
  public getAllItems(): Map<string, Item> {
    return ITEMS;
  }

  /**
   * Get item by ID
   */
  public getItem(itemId: string): Item | null {
    return ITEMS.get(itemId) || null;
  }

  /**
   * Get items by type
   */
  public getItemsByType(itemType: string): Item[] {
    return Array.from(ITEMS.values()).filter((item) => item.type === itemType);
  }

  // =============================================================================
  // NPC DATA ACCESS METHODS
  // =============================================================================

  /**
   * Get all NPCs
   */
  public getAllNPCs(): Map<string, NPCData> {
    return ALL_NPCS;
  }

  /**
   * Get NPC by ID
   */
  public getNPC(npcId: string): NPCData | null {
    return ALL_NPCS.get(npcId) || null;
  }

  /**
   * Get NPCs by category
   */
  public getNPCsByCategory(category: NPCCategory): NPCData[] {
    return Array.from(ALL_NPCS.values()).filter(
      (npc) => npc.category === category,
    );
  }

  // =============================================================================
  // WORLD AREA DATA ACCESS METHODS
  // =============================================================================

  /**
   * Get all world areas
   */
  public getAllWorldAreas(): Record<string, WorldArea> {
    return ALL_WORLD_AREAS;
  }

  /**
   * Get starter towns
   */
  public getStarterTowns(): Record<string, WorldArea> {
    return STARTER_TOWNS;
  }

  /**
   * Get world area by ID
   */
  public getWorldArea(areaId: string): WorldArea | null {
    return ALL_WORLD_AREAS[areaId] || null;
  }

  /**
   * Get mob spawns in area
   */
  public getMobSpawnsInArea(areaId: string): MobSpawnPoint[] {
    return getMobSpawnsInArea(areaId);
  }

  /**
   * Get NPCs in area
   */
  public getNPCsInArea(areaId: string): NPCLocation[] {
    return getNPCsInArea(areaId);
  }

  // =============================================================================
  // TREASURE DATA ACCESS METHODS
  // =============================================================================

  /**
   * Get all treasure locations
   */
  public getAllTreasureLocations(): TreasureLocation[] {
    return getAllTreasureLocations();
  }

  /**
   * Get treasure locations by difficulty
   */
  public getTreasureLocationsByDifficulty(
    difficulty: 1 | 2 | 3,
  ): TreasureLocation[] {
    return getTreasureLocationsByDifficulty(difficulty);
  }

  /**
   * Get treasure location by ID
   */
  public getTreasureLocation(locationId: string): TreasureLocation | null {
    return (
      TREASURE_LOCATIONS.find(
        (loc) => (loc as TreasureLocation & { id?: string }).id === locationId,
      ) || null
    );
  }

  // =============================================================================
  // STORE AND BANK DATA ACCESS METHODS
  // =============================================================================

  /**
   * Get all general stores
   */
  public getGeneralStores() {
    return GENERAL_STORES;
  }

  /**
   * Get all banks
   */
  public getBanks() {
    return BANKS;
  }

  // =============================================================================
  // STARTING DATA ACCESS METHODS
  // =============================================================================

  /**
   * Get starting items
   */
  public getStartingItems() {
    return STARTING_ITEMS;
  }

  // =============================================================================
  // UTILITY METHODS
  // =============================================================================

  /**
   * Check if data manager is initialized
   */
  public isReady(): boolean {
    return this.isInitialized;
  }

  /**
   * Get data summary for debugging
   */
  public getDataSummary() {
    if (!this.isInitialized) {
      return "DataManager not initialized";
    }

    return {
      items: ITEMS.size,
      npcs: ALL_NPCS.size,
      worldAreas: Object.keys(ALL_WORLD_AREAS).length,
      treasureLocations: TREASURE_LOCATIONS.length,
      stores: Object.keys(GENERAL_STORES).length,
      banks: Object.keys(BANKS).length,
      startingItems: STARTING_ITEMS.length,
      isValid: this.validationResult?.isValid || false,
    };
  }
}

// Export singleton instance
export const dataManager = DataManager.getInstance();
