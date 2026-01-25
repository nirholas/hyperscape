/**
 * TownSystem - Procedural Town Generation
 * Generates 25 deterministic towns with flatness-based placement.
 * Towns are safe zones with bank/store/anvil buildings.
 * Configuration can be loaded from world-config.json via DataManager.
 */

import { System } from "../infrastructure/System";
import type { World } from "../../../core/World";
import type {
  ProceduralTown,
  TownBuilding,
  TownSize,
  TownBuildingType,
  TownConfigManifest,
  TownSizeConfigManifest,
} from "../../../types/world/world-types";
import { NoiseGenerator } from "../../../utils/NoiseGenerator";
import { Logger } from "../../../utils/Logger";
import { DataManager } from "../../../data/DataManager";

// Default configuration values
const DEFAULTS = {
  townCount: 25,
  worldSize: 10000,
  minTownSpacing: 800,
  flatnessSampleRadius: 40,
  flatnessSampleCount: 16,
  waterThreshold: 5.4,
  optimalWaterDistanceMin: 30,
  optimalWaterDistanceMax: 150,
} as const;

const DEFAULT_TOWN_SIZES: Record<TownSize, TownSizeConfig> = {
  hamlet: { buildingCount: { min: 3, max: 5 }, radius: 25, safeZoneRadius: 40 },
  village: {
    buildingCount: { min: 6, max: 10 },
    radius: 40,
    safeZoneRadius: 60,
  },
  town: { buildingCount: { min: 11, max: 16 }, radius: 60, safeZoneRadius: 80 },
};

const DEFAULT_BIOME_SUITABILITY: Record<string, number> = {
  plains: 1.0,
  valley: 0.95,
  forest: 0.7,
  tundra: 0.4,
  desert: 0.3,
  swamp: 0.2,
  mountains: 0.15,
  lakes: 0.0,
};

interface TownSizeConfig {
  buildingCount: { min: number; max: number };
  radius: number;
  safeZoneRadius: number;
}

/** Town configuration loaded from world-config.json (exported for testing) */
export interface TownConfig {
  townCount: number;
  worldSize: number;
  minTownSpacing: number;
  flatnessSampleRadius: number;
  flatnessSampleCount: number;
  waterThreshold: number;
  optimalWaterDistanceMin: number;
  optimalWaterDistanceMax: number;
  townSizes: Record<TownSize, TownSizeConfig>;
  biomeSuitability: Record<string, number>;
}

/** Load town configuration from DataManager (exported for testing) */
export function loadTownConfig(): TownConfig {
  const manifest = DataManager.getWorldConfig()?.towns;
  const sizes = { ...DEFAULT_TOWN_SIZES };
  const suitability = { ...DEFAULT_BIOME_SUITABILITY };

  if (manifest?.townSizes) {
    for (const key of ["hamlet", "village", "town"] as const) {
      const src = manifest.townSizes[key];
      if (src) {
        sizes[key] = {
          buildingCount: { min: src.minBuildings, max: src.maxBuildings },
          radius: src.radius,
          safeZoneRadius: src.safeZoneRadius,
        };
      }
    }
  }

  if (manifest?.biomeSuitability) {
    Object.assign(suitability, manifest.biomeSuitability);
  }

  return {
    townCount: manifest?.townCount ?? DEFAULTS.townCount,
    worldSize: DEFAULTS.worldSize,
    minTownSpacing: manifest?.minTownSpacing ?? DEFAULTS.minTownSpacing,
    flatnessSampleRadius:
      manifest?.flatnessSampleRadius ?? DEFAULTS.flatnessSampleRadius,
    flatnessSampleCount:
      manifest?.flatnessSampleCount ?? DEFAULTS.flatnessSampleCount,
    waterThreshold: manifest?.waterThreshold ?? DEFAULTS.waterThreshold,
    optimalWaterDistanceMin:
      manifest?.optimalWaterDistanceMin ?? DEFAULTS.optimalWaterDistanceMin,
    optimalWaterDistanceMax:
      manifest?.optimalWaterDistanceMax ?? DEFAULTS.optimalWaterDistanceMax,
    townSizes: sizes,
    biomeSuitability: suitability,
  };
}

const dist2D = (x1: number, z1: number, x2: number, z2: number): number =>
  Math.sqrt((x2 - x1) ** 2 + (z2 - z1) ** 2);

const BUILDING_CONFIG: Record<
  TownBuildingType,
  { width: number; depth: number; priority: number }
> = {
  bank: { width: 8, depth: 6, priority: 1 },
  store: { width: 7, depth: 5, priority: 2 },
  anvil: { width: 5, depth: 4, priority: 3 },
  well: { width: 3, depth: 3, priority: 4 },
  house: { width: 6, depth: 5, priority: 5 },
};

const NAME_PREFIXES = [
  "Oak",
  "River",
  "Stone",
  "Green",
  "High",
  "Low",
  "North",
  "South",
  "East",
  "West",
  "Iron",
  "Gold",
  "Silver",
  "Crystal",
  "Shadow",
  "Sun",
  "Moon",
  "Star",
  "Thunder",
  "Frost",
  "Fire",
  "Wind",
  "Storm",
  "Cloud",
  "Lake",
];

const NAME_SUFFIXES = [
  "haven",
  "ford",
  "wick",
  "ton",
  "bridge",
  "vale",
  "hollow",
  "reach",
  "fall",
  "watch",
  "keep",
  "stead",
  "dale",
  "brook",
  "field",
  "grove",
  "hill",
  "cliff",
  "port",
  "gate",
  "marsh",
  "moor",
  "wood",
  "mere",
  "crest",
];

interface TownCandidate {
  x: number;
  z: number;
  flatnessScore: number;
  waterProximityScore: number;
  biomeScore: number;
  totalScore: number;
  biome: string;
}

export class TownSystem extends System {
  private towns: ProceduralTown[] = [];
  private noise!: NoiseGenerator;
  private seed: number = 0;
  private randomState: number = 0;
  private config!: TownConfig;
  private terrainSystem?: {
    getHeightAt(x: number, z: number): number;
    getBiomeAtWorldPosition?(x: number, z: number): string;
  };

  constructor(world: World) {
    super(world);
  }

  getDependencies() {
    return { required: ["terrain"], optional: [] };
  }

  async init(): Promise<void> {
    const worldConfig = (this.world as { config?: { terrainSeed?: number } })
      .config;
    this.seed = worldConfig?.terrainSeed ?? 0;
    this.randomState = this.seed;
    this.noise = new NoiseGenerator(this.seed);
    this.config = loadTownConfig();
    this.terrainSystem = this.world.getSystem("terrain") as
      | {
          getHeightAt(x: number, z: number): number;
          getBiomeAtWorldPosition?(x: number, z: number): string;
        }
      | undefined;

    if (DataManager.getWorldConfig()?.towns) {
      Logger.system(
        "TownSystem",
        `Config: ${this.config.townCount} towns, ${this.config.minTownSpacing}m spacing`,
      );
    }
    this.initialized = true;
  }

  async start(): Promise<void> {
    if (!this.terrainSystem) {
      throw new Error("TownSystem requires TerrainSystem");
    }

    this.generateTowns();

    if (this.towns.length === 0) {
      // No procedural towns generated - this is OK if using manifest-defined towns
      // (e.g., Central Haven in world-areas.json)
      Logger.systemWarn(
        "TownSystem",
        "No procedural towns generated - using manifest-defined areas only",
      );
      return;
    }

    if (this.towns.length < this.config.townCount) {
      Logger.systemWarn(
        "TownSystem",
        `Only ${this.towns.length}/${this.config.townCount} towns generated`,
      );
    }

    Logger.system(
      "TownSystem",
      `Generated ${this.towns.length} towns from seed ${this.seed}`,
    );
  }

  private random(): number {
    this.randomState = (this.randomState * 1664525 + 1013904223) >>> 0;
    return this.randomState / 0xffffffff;
  }

  private resetRandom(seed: number): void {
    this.randomState = seed;
  }

  private generateTownName(townIndex: number): string {
    this.resetRandom(this.seed + townIndex * 7919);
    const prefixIndex = Math.floor(this.random() * NAME_PREFIXES.length);
    const suffixIndex = Math.floor(this.random() * NAME_SUFFIXES.length);
    return NAME_PREFIXES[prefixIndex] + NAME_SUFFIXES[suffixIndex];
  }

  /** Returns 0-1 where 1 is perfectly flat */
  private calculateFlatness(centerX: number, centerZ: number): number {
    if (!this.terrainSystem) throw new Error("terrainSystem required");

    const { flatnessSampleCount, flatnessSampleRadius } = this.config;
    const heights: number[] = [];
    const angleStep = (Math.PI * 2) / flatnessSampleCount;

    for (let i = 0; i < flatnessSampleCount; i++) {
      const angle = i * angleStep;
      const sampleX = centerX + Math.cos(angle) * flatnessSampleRadius;
      const sampleZ = centerZ + Math.sin(angle) * flatnessSampleRadius;
      heights.push(this.terrainSystem.getHeightAt(sampleX, sampleZ));
    }
    heights.push(this.terrainSystem.getHeightAt(centerX, centerZ));

    const mean = heights.reduce((a, b) => a + b, 0) / heights.length;
    const variance =
      heights.reduce((sum, h) => sum + (h - mean) ** 2, 0) / heights.length;
    return Math.exp(-variance / 25);
  }

  /** Returns 0-1 where 1 is optimal distance from water */
  private calculateWaterProximity(centerX: number, centerZ: number): number {
    if (!this.terrainSystem) throw new Error("terrainSystem required");

    const { waterThreshold, optimalWaterDistanceMin, optimalWaterDistanceMax } =
      this.config;
    const centerHeight = this.terrainSystem.getHeightAt(centerX, centerZ);
    if (centerHeight < waterThreshold) return 0;

    let minWaterDistance = Infinity;
    for (let dir = 0; dir < 8; dir++) {
      const angle = (dir / 8) * Math.PI * 2;
      const dx = Math.cos(angle);
      const dz = Math.sin(angle);
      for (let distance = 20; distance <= 300; distance += 20) {
        const height = this.terrainSystem.getHeightAt(
          centerX + dx * distance,
          centerZ + dz * distance,
        );
        if (height < waterThreshold) {
          minWaterDistance = Math.min(minWaterDistance, distance);
          break;
        }
      }
    }

    if (minWaterDistance === Infinity) return 0.5;
    if (
      minWaterDistance >= optimalWaterDistanceMin &&
      minWaterDistance <= optimalWaterDistanceMax
    )
      return 1.0;
    if (minWaterDistance < optimalWaterDistanceMin)
      return minWaterDistance / optimalWaterDistanceMin;
    return Math.max(
      0.3,
      1.0 - (minWaterDistance - optimalWaterDistanceMax) / 500,
    );
  }

  private getBiomeAt(x: number, z: number): string {
    if (this.terrainSystem?.getBiomeAtWorldPosition) {
      return this.terrainSystem.getBiomeAtWorldPosition(x, z);
    }
    const biomeNoise = this.noise.simplex2D(x * 0.0005, z * 0.0005);
    if (biomeNoise > 0.3) return "plains";
    if (biomeNoise > 0) return "forest";
    if (biomeNoise > -0.3) return "valley";
    return "mountains";
  }

  private isTooCloseToExistingTowns(
    x: number,
    z: number,
    existingTowns: TownCandidate[],
  ): boolean {
    const minSpacing = this.config.minTownSpacing;
    return existingTowns.some(
      (town) => dist2D(x, z, town.x, town.z) < minSpacing,
    );
  }

  private generateTownCandidates(): TownCandidate[] {
    const { worldSize, biomeSuitability } = this.config;
    const halfWorld = worldSize / 2;
    const gridSize = 15;
    const cellSize = worldSize / gridSize;
    const candidates: TownCandidate[] = [];

    this.resetRandom(this.seed + 12345);

    for (let gx = 0; gx < gridSize; gx++) {
      for (let gz = 0; gz < gridSize; gz++) {
        const baseX = (gx + 0.5) * cellSize - halfWorld;
        const baseZ = (gz + 0.5) * cellSize - halfWorld;
        const x = baseX + (this.random() - 0.5) * cellSize * 0.8;
        const z = baseZ + (this.random() - 0.5) * cellSize * 0.8;

        if (Math.abs(x) > halfWorld - 200 || Math.abs(z) > halfWorld - 200)
          continue;

        const flatnessScore = this.calculateFlatness(x, z);
        const waterProximityScore = this.calculateWaterProximity(x, z);
        const biome = this.getBiomeAt(x, z);
        const biomeScore = biomeSuitability[biome] ?? 0.3;

        if (waterProximityScore === 0 || biomeScore < 0.1) continue;

        const suitabilityNoise =
          (this.noise.simplex2D(x * 0.002, z * 0.002) + 1) * 0.5;
        const totalScore =
          flatnessScore * 0.4 +
          waterProximityScore * 0.2 +
          biomeScore * 0.25 +
          suitabilityNoise * 0.15;

        candidates.push({
          x,
          z,
          flatnessScore,
          waterProximityScore,
          biomeScore,
          totalScore,
          biome,
        });
      }
    }
    return candidates;
  }

  private selectTownLocations(candidates: TownCandidate[]): TownCandidate[] {
    const sorted = [...candidates].sort((a, b) => b.totalScore - a.totalScore);
    const selectedTowns: TownCandidate[] = [];

    for (const candidate of sorted) {
      if (selectedTowns.length >= this.config.townCount) break;
      if (
        !this.isTooCloseToExistingTowns(candidate.x, candidate.z, selectedTowns)
      ) {
        selectedTowns.push(candidate);
      }
    }
    return selectedTowns;
  }

  private determineTownSize(
    suitabilityScore: number,
    townIndex: number,
  ): TownSize {
    this.resetRandom(this.seed + townIndex * 3571);
    const roll = this.random();
    if (suitabilityScore > 0.7 && roll > 0.6) return "town";
    if (suitabilityScore > 0.5 && roll > 0.4) return "village";
    return "hamlet";
  }

  private generateBuildings(
    town: ProceduralTown,
    townIndex: number,
  ): TownBuilding[] {
    const buildings: TownBuilding[] = [];
    const sizeConfig = this.config.townSizes[town.size];
    this.resetRandom(this.seed + townIndex * 9973 + 100000);

    const { min, max } = sizeConfig.buildingCount;
    const buildingCount = min + Math.floor(this.random() * (max - min + 1));

    const buildingTypes: TownBuildingType[] = ["bank", "store", "anvil"];
    if (town.size !== "hamlet") buildingTypes.push("well");
    while (buildingTypes.length < buildingCount) buildingTypes.push("house");

    const placedBuildings: { x: number; z: number; radius: number }[] = [];

    for (let i = 0; i < buildingTypes.length; i++) {
      const buildingType = buildingTypes[i];
      const buildingConfig = BUILDING_CONFIG[buildingType];
      let placed = false;

      for (let attempts = 0; attempts < 50 && !placed; attempts++) {
        const angle = this.random() * Math.PI * 2;
        const minRadius = i === 0 ? 0 : 8;
        const maxRadius = sizeConfig.radius - buildingConfig.width;
        const radius = minRadius + this.random() * (maxRadius - minRadius);

        const buildingX = town.position.x + Math.cos(angle) * radius;
        const buildingZ = town.position.z + Math.sin(angle) * radius;
        const buildingRadius =
          Math.max(buildingConfig.width, buildingConfig.depth) / 2 + 2;

        const overlaps = placedBuildings.some(
          (e) =>
            dist2D(buildingX, buildingZ, e.x, e.z) < buildingRadius + e.radius,
        );

        if (!overlaps) {
          const buildingY = this.terrainSystem!.getHeightAt(
            buildingX,
            buildingZ,
          );
          const toCenter = Math.atan2(
            town.position.z - buildingZ,
            town.position.x - buildingX,
          );
          const rotation = toCenter + Math.PI + (this.random() - 0.5) * 0.3;

          buildings.push({
            id: `${town.id}_building_${i}`,
            type: buildingType,
            position: { x: buildingX, y: buildingY, z: buildingZ },
            rotation,
            size: { width: buildingConfig.width, depth: buildingConfig.depth },
          });
          placedBuildings.push({
            x: buildingX,
            z: buildingZ,
            radius: buildingRadius,
          });
          placed = true;
        }
      }

      if (!placed && ["bank", "store", "anvil"].includes(buildingType)) {
        Logger.systemWarn(
          "TownSystem",
          `Failed to place ${buildingType} in ${town.name}`,
        );
      }
    }

    const placedTypes = new Set(buildings.map((b) => b.type));
    const missing = (["bank", "store", "anvil"] as TownBuildingType[]).filter(
      (t) => !placedTypes.has(t),
    );
    if (missing.length > 0) {
      Logger.systemError(
        "TownSystem",
        `${town.name} missing essential buildings: ${missing.join(", ")}`,
      );
    }

    return buildings;
  }

  private generateTowns(): void {
    const candidates = this.generateTownCandidates();
    const selectedLocations = this.selectTownLocations(candidates);

    this.towns = [];
    for (let i = 0; i < selectedLocations.length; i++) {
      const location = selectedLocations[i];
      const centerY = this.terrainSystem!.getHeightAt(location.x, location.z);
      const townSize = this.determineTownSize(location.totalScore, i);
      const sizeConfig = this.config.townSizes[townSize];

      const town: ProceduralTown = {
        id: `town_${i}`,
        name: this.generateTownName(i),
        position: { x: location.x, y: centerY, z: location.z },
        size: townSize,
        safeZoneRadius: sizeConfig.safeZoneRadius,
        biome: location.biome,
        buildings: [],
        suitabilityScore: location.totalScore,
        connectedRoads: [],
      };
      town.buildings = this.generateBuildings(town, i);
      this.towns.push(town);
    }

    const sizeCount = { hamlet: 0, village: 0, town: 0 };
    for (const town of this.towns) sizeCount[town.size]++;
    Logger.system(
      "TownSystem",
      `Sizes: ${sizeCount.hamlet} hamlets, ${sizeCount.village} villages, ${sizeCount.town} towns`,
    );
  }

  getTowns(): ProceduralTown[] {
    return this.towns;
  }

  getTownById(id: string): ProceduralTown | undefined {
    return this.towns.find((t) => t.id === id);
  }

  getNearestTown(x: number, z: number): ProceduralTown | undefined {
    if (this.towns.length === 0) return undefined;
    return this.towns.reduce((nearest, town) =>
      dist2D(x, z, town.position.x, town.position.z) <
      dist2D(x, z, nearest.position.x, nearest.position.z)
        ? town
        : nearest,
    );
  }

  /** Get the spawn town (nearest to world origin). Used for initial player spawn and respawn. */
  getSpawnTown(): ProceduralTown | undefined {
    return this.getNearestTown(0, 0);
  }

  isInSafeZone(x: number, z: number): boolean {
    return this.towns.some(
      (town) =>
        dist2D(x, z, town.position.x, town.position.z) <= town.safeZoneRadius,
    );
  }

  getTownAtPosition(x: number, z: number): ProceduralTown | undefined {
    return this.towns.find(
      (town) =>
        dist2D(x, z, town.position.x, town.position.z) <= town.safeZoneRadius,
    );
  }

  getTownsInBounds(
    minX: number,
    minZ: number,
    maxX: number,
    maxZ: number,
  ): ProceduralTown[] {
    return this.towns.filter((town) => {
      const r = town.safeZoneRadius;
      return (
        town.position.x + r >= minX &&
        town.position.x - r <= maxX &&
        town.position.z + r >= minZ &&
        town.position.z - r <= maxZ
      );
    });
  }

  shouldAvoidSpawning(x: number, z: number, avoidRadius: number = 30): boolean {
    return this.towns.some(
      (town) => dist2D(x, z, town.position.x, town.position.z) <= avoidRadius,
    );
  }

  /** Get NPC spawn points in front of buildings of a given type */
  getNPCSpawnPointsForBuildingType(buildingType: TownBuildingType): Array<{
    townId: string;
    townName: string;
    position: { x: number; y: number; z: number };
    rotation: number;
  }> {
    const spawnPoints: Array<{
      townId: string;
      townName: string;
      position: { x: number; y: number; z: number };
      rotation: number;
    }> = [];

    for (const town of this.towns) {
      for (const building of town.buildings) {
        if (building.type === buildingType) {
          const offset = BUILDING_CONFIG[buildingType].depth / 2 + 1;
          spawnPoints.push({
            townId: town.id,
            townName: town.name,
            position: {
              x: building.position.x + Math.cos(building.rotation) * offset,
              y: building.position.y,
              z: building.position.z + Math.sin(building.rotation) * offset,
            },
            rotation: building.rotation + Math.PI,
          });
        }
      }
    }
    return spawnPoints;
  }

  getBuildingsByType(buildingType: TownBuildingType): TownBuilding[] {
    return this.towns.flatMap((town) =>
      town.buildings.filter((b) => b.type === buildingType),
    );
  }

  getTownStats(): {
    totalTowns: number;
    hamlets: number;
    villages: number;
    towns: number;
    totalBuildings: number;
    buildingCounts: Record<TownBuildingType, number>;
  } {
    const stats = {
      totalTowns: this.towns.length,
      hamlets: 0,
      villages: 0,
      towns: 0,
      totalBuildings: 0,
      buildingCounts: {
        bank: 0,
        store: 0,
        anvil: 0,
        well: 0,
        house: 0,
      } as Record<TownBuildingType, number>,
    };

    for (const town of this.towns) {
      if (town.size === "hamlet") stats.hamlets++;
      else if (town.size === "village") stats.villages++;
      else stats.towns++;

      stats.totalBuildings += town.buildings.length;
      for (const building of town.buildings)
        stats.buildingCounts[building.type]++;
    }
    return stats;
  }

  destroy(): void {
    this.towns = [];
    super.destroy();
  }
}
