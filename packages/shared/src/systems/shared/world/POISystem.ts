/**
 * POISystem - Points of Interest Generation
 * Generates procedural POIs (dungeons, shrines, landmarks, etc.) for road connections.
 *
 * POIs are smaller than towns but significant enough to warrant road access.
 * The RoadNetworkSystem extends roads from towns to nearby important POIs.
 *
 * Configuration loaded from world-config.json via DataManager.
 * IMPORTANT: DataManager.loadManifests*() must be called BEFORE POISystem.init()
 */

import { System } from "../infrastructure/System";
import type { World } from "../../../core/World";
import type {
  PointOfInterest,
  POICategory,
  POIConfig,
} from "../../../types/world/world-types";
import { NoiseGenerator } from "../../../utils/NoiseGenerator";
import { Logger } from "../../../utils/Logger";
import { DataManager } from "../../../data/DataManager";
import type { TownSystem } from "./TownSystem";

// Default configuration values
const DEFAULTS: POIConfig = {
  countPerCategory: {
    dungeon: 8,
    shrine: 12,
    landmark: 15,
    resource_area: 10,
    ruin: 6,
    camp: 8,
    crossing: 5,
    waystation: 10,
  },
  minDistanceFromTowns: 100,
  minPOISpacing: 200,
  maxRoadExtensionDistance: 500,
  importanceThresholdForRoad: 0.5,
};

// POI category properties
const CATEGORY_PROPERTIES: Record<
  POICategory,
  { radius: number; baseImportance: number; preferredBiomes: string[] }
> = {
  dungeon: {
    radius: 30,
    baseImportance: 0.9,
    preferredBiomes: ["mountains", "forest", "swamp"],
  },
  shrine: {
    radius: 10,
    baseImportance: 0.6,
    preferredBiomes: ["forest", "plains", "valley"],
  },
  landmark: {
    radius: 20,
    baseImportance: 0.5,
    preferredBiomes: ["mountains", "plains", "desert"],
  },
  resource_area: {
    radius: 25,
    baseImportance: 0.7,
    preferredBiomes: ["forest", "mountains", "plains"],
  },
  ruin: {
    radius: 35,
    baseImportance: 0.8,
    preferredBiomes: ["desert", "forest", "swamp"],
  },
  camp: {
    radius: 20,
    baseImportance: 0.4,
    preferredBiomes: ["forest", "plains", "mountains"],
  },
  crossing: {
    radius: 15,
    baseImportance: 0.85,
    preferredBiomes: ["mountains", "swamp", "valley"],
  },
  waystation: {
    radius: 12,
    baseImportance: 0.3,
    preferredBiomes: ["plains", "valley", "forest"],
  },
};

// Name generation for POIs
const POI_NAME_PREFIXES: Record<POICategory, string[]> = {
  dungeon: ["Dark", "Ancient", "Forgotten", "Shadow", "Deep", "Lost", "Cursed"],
  shrine: ["Sacred", "Hidden", "Old", "Blessed", "Quiet", "Stone", "Forest"],
  landmark: ["Tall", "Great", "Ancient", "Lone", "Twin", "Fallen", "Standing"],
  resource_area: ["Rich", "Old", "Northern", "Southern", "Eastern", "Western"],
  ruin: ["Crumbling", "Ancient", "Forgotten", "Abandoned", "Broken", "Silent"],
  camp: ["Hidden", "Outlaw", "Hunter", "Ranger", "Traveler", "Merchant"],
  crossing: ["Old", "Stone", "Narrow", "Wide", "Rocky", "Swift"],
  waystation: ["Roadside", "Halfway", "Lonely", "Traveler", "Dusty", "Shady"],
};

const POI_NAME_SUFFIXES: Record<POICategory, string[]> = {
  dungeon: ["Caverns", "Depths", "Mines", "Catacombs", "Tunnels", "Halls"],
  shrine: ["Shrine", "Altar", "Grove", "Circle", "Stones", "Spring"],
  landmark: ["Rock", "Tree", "Falls", "Peak", "Spire", "Mesa"],
  resource_area: ["Quarry", "Grove", "Fishing Hole", "Mine", "Camp", "Fields"],
  ruin: ["Ruins", "Tower", "Keep", "Temple", "Fortress", "Manor"],
  camp: ["Camp", "Hideout", "Lair", "Den", "Outpost", "Shelter"],
  crossing: ["Bridge", "Ford", "Pass", "Crossing", "Gate", "Gap"],
  waystation: ["Rest", "Inn", "Stop", "Shelter", "Post", "Lodge"],
};

const dist2D = (x1: number, z1: number, x2: number, z2: number): number =>
  Math.sqrt((x2 - x1) ** 2 + (z2 - z1) ** 2);

/**
 * Load POI configuration from DataManager
 */
export function loadPOIConfig(): POIConfig {
  const manifest = DataManager.getWorldConfig()?.pois;
  if (!manifest) return { ...DEFAULTS };

  return {
    countPerCategory: {
      ...DEFAULTS.countPerCategory,
      ...manifest.countPerCategory,
    },
    minDistanceFromTowns:
      manifest.minDistanceFromTowns ?? DEFAULTS.minDistanceFromTowns,
    minPOISpacing: manifest.minPOISpacing ?? DEFAULTS.minPOISpacing,
    maxRoadExtensionDistance:
      manifest.maxRoadExtensionDistance ?? DEFAULTS.maxRoadExtensionDistance,
    importanceThresholdForRoad:
      manifest.importanceThresholdForRoad ??
      DEFAULTS.importanceThresholdForRoad,
  };
}

export class POISystem extends System {
  private pois: PointOfInterest[] = [];
  private seed: number = 0;
  private randomState: number = 0;
  private config!: POIConfig;
  private noise!: NoiseGenerator;
  private townSystem?: TownSystem;
  private terrainSystem?: {
    getHeightAt(x: number, z: number): number;
    getBiomeAtWorldPosition?(x: number, z: number): string;
  };

  constructor(world: World) {
    super(world);
  }

  getDependencies() {
    return { required: ["terrain", "towns"], optional: [] };
  }

  async init(): Promise<void> {
    const worldConfig = (this.world as { config?: { terrainSeed?: number } })
      .config;
    this.seed = worldConfig?.terrainSeed ?? 0;
    this.randomState = this.seed;
    this.config = loadPOIConfig();
    this.noise = new NoiseGenerator(this.seed + 98765);

    this.terrainSystem = this.world.getSystem("terrain") as
      | {
          getHeightAt(x: number, z: number): number;
          getBiomeAtWorldPosition?(x: number, z: number): string;
        }
      | undefined;

    this.townSystem = this.world.getSystem("towns") as TownSystem | undefined;

    Logger.system(
      "POISystem",
      `Config: ${Object.values(this.config.countPerCategory).reduce((a, b) => (a ?? 0) + (b ?? 0), 0)} total POIs planned`,
    );
  }

  async start(): Promise<void> {
    if (!this.terrainSystem) {
      throw new Error("POISystem requires TerrainSystem");
    }
    if (!this.townSystem) {
      throw new Error("POISystem requires TownSystem");
    }

    // Generate POIs
    this.generatePOIs();

    Logger.system(
      "POISystem",
      `Generated ${this.pois.length} points of interest`,
    );
  }

  private random(): number {
    this.randomState = (this.randomState * 1664525 + 1013904223) >>> 0;
    return this.randomState / 0xffffffff;
  }

  private resetRandom(seed: number): void {
    this.randomState = seed;
  }

  /**
   * Generate POIs for all categories
   */
  private generatePOIs(): void {
    const categories = Object.keys(
      this.config.countPerCategory,
    ) as POICategory[];
    const worldSize = 10000; // TODO: Get from config
    const halfWorld = worldSize / 2;

    let totalGenerated = 0;

    for (const category of categories) {
      const count = this.config.countPerCategory[category] ?? 0;
      if (count === 0) continue;

      const generated = this.generatePOIsForCategory(
        category,
        count,
        halfWorld,
      );
      this.pois.push(...generated);
      totalGenerated += generated.length;
    }

    // Sort by importance (highest first) for road connection priority
    this.pois.sort((a, b) => b.importance - a.importance);

    Logger.system(
      "POISystem",
      `Categories: ${categories.map((c) => `${c}:${this.pois.filter((p) => p.category === c).length}`).join(", ")}`,
    );
  }

  /**
   * Generate POIs for a specific category
   */
  private generatePOIsForCategory(
    category: POICategory,
    targetCount: number,
    halfWorld: number,
  ): PointOfInterest[] {
    const pois: PointOfInterest[] = [];
    const properties = CATEGORY_PROPERTIES[category];
    const towns = this.townSystem?.getTowns() ?? [];
    const maxAttempts = targetCount * 20;

    this.resetRandom(this.seed + category.charCodeAt(0) * 12345);

    for (
      let attempt = 0;
      attempt < maxAttempts && pois.length < targetCount;
      attempt++
    ) {
      // Random position with some clustering based on noise
      const baseX = (this.random() - 0.5) * halfWorld * 1.8;
      const baseZ = (this.random() - 0.5) * halfWorld * 1.8;

      // Add noise-based clustering
      const clusterNoise = this.noise.simplex2D(baseX * 0.001, baseZ * 0.001);
      if (clusterNoise < -0.3) continue; // Skip low-noise areas for variety

      const x = baseX;
      const z = baseZ;

      // Check world bounds
      if (Math.abs(x) > halfWorld - 100 || Math.abs(z) > halfWorld - 100) {
        continue;
      }

      // Check distance from towns
      const tooCloseToTown = towns.some(
        (t) =>
          dist2D(x, z, t.position.x, t.position.z) <
          this.config.minDistanceFromTowns,
      );
      if (tooCloseToTown) continue;

      // Check distance from existing POIs (all, not just this category)
      const tooCloseToOtherPOI = [...this.pois, ...pois].some(
        (p) =>
          dist2D(x, z, p.position.x, p.position.z) < this.config.minPOISpacing,
      );
      if (tooCloseToOtherPOI) continue;

      // Get terrain info
      const y = this.terrainSystem!.getHeightAt(x, z);
      const biome =
        this.terrainSystem?.getBiomeAtWorldPosition?.(x, z) ?? "plains";

      // Skip underwater
      const waterThreshold = 5.4;
      if (y < waterThreshold && category !== "crossing") continue;

      // Calculate importance based on biome suitability and noise
      let importance = properties.baseImportance;

      // Biome bonus
      if (properties.preferredBiomes.includes(biome)) {
        importance += 0.1;
      }

      // Noise-based variation
      const importanceNoise = this.noise.simplex2D(
        x * 0.002 + 1000,
        z * 0.002 + 1000,
      );
      importance += importanceNoise * 0.15;

      // Clamp importance
      importance = Math.max(0.1, Math.min(1.0, importance));

      // Generate name
      const name = this.generatePOIName(category, pois.length);

      pois.push({
        id: `poi_${category}_${pois.length}`,
        name,
        category,
        position: { x, y, z },
        importance,
        radius: properties.radius,
        biome,
        connectedRoads: [],
        procedural: true,
      });
    }

    return pois;
  }

  /**
   * Generate a name for a POI
   */
  private generatePOIName(category: POICategory, index: number): string {
    this.resetRandom(this.seed + index * 7919 + category.charCodeAt(0));

    const prefixes = POI_NAME_PREFIXES[category];
    const suffixes = POI_NAME_SUFFIXES[category];

    const prefix = prefixes[Math.floor(this.random() * prefixes.length)];
    const suffix = suffixes[Math.floor(this.random() * suffixes.length)];

    return `${prefix} ${suffix}`;
  }

  /**
   * Calculate entry point for a POI (where road connects)
   * Chooses a point on the perimeter closest to a given target
   */
  calculateEntryPoint(
    poi: PointOfInterest,
    targetX: number,
    targetZ: number,
  ): { x: number; z: number; angle: number } {
    const dx = targetX - poi.position.x;
    const dz = targetZ - poi.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist < 1) {
      return { x: poi.position.x, z: poi.position.z, angle: 0 };
    }

    const angle = Math.atan2(dz, dx);
    const edgeDist = poi.radius * 0.8;

    return {
      x: poi.position.x + (dx / dist) * edgeDist,
      z: poi.position.z + (dz / dist) * edgeDist,
      angle,
    };
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  getPOIs(): PointOfInterest[] {
    return this.pois;
  }

  getPOIById(id: string): PointOfInterest | undefined {
    return this.pois.find((p) => p.id === id);
  }

  getPOIsByCategory(category: POICategory): PointOfInterest[] {
    return this.pois.filter((p) => p.category === category);
  }

  /**
   * Get POIs that should be connected to roads
   * (importance >= threshold)
   */
  getImportantPOIs(): PointOfInterest[] {
    return this.pois.filter(
      (p) => p.importance >= this.config.importanceThresholdForRoad,
    );
  }

  /**
   * Get POIs within a certain distance of a position
   */
  getPOIsNear(x: number, z: number, maxDistance: number): PointOfInterest[] {
    return this.pois.filter(
      (p) => dist2D(x, z, p.position.x, p.position.z) <= maxDistance,
    );
  }

  /**
   * Get the nearest POI to a position
   */
  getNearestPOI(x: number, z: number): PointOfInterest | undefined {
    if (this.pois.length === 0) return undefined;

    return this.pois.reduce((nearest, poi) =>
      dist2D(x, z, poi.position.x, poi.position.z) <
      dist2D(x, z, nearest.position.x, nearest.position.z)
        ? poi
        : nearest,
    );
  }

  /**
   * Get POI at a specific position (within its radius)
   */
  getPOIAtPosition(x: number, z: number): PointOfInterest | undefined {
    return this.pois.find(
      (p) => dist2D(x, z, p.position.x, p.position.z) <= p.radius,
    );
  }

  /**
   * Get POIs within bounds
   */
  getPOIsInBounds(
    minX: number,
    minZ: number,
    maxX: number,
    maxZ: number,
  ): PointOfInterest[] {
    return this.pois.filter((poi) => {
      const r = poi.radius;
      return (
        poi.position.x + r >= minX &&
        poi.position.x - r <= maxX &&
        poi.position.z + r >= minZ &&
        poi.position.z - r <= maxZ
      );
    });
  }

  getConfig(): POIConfig {
    return { ...this.config };
  }

  destroy(): void {
    this.pois = [];
    super.destroy();
  }
}
