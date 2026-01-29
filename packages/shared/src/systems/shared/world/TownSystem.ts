/**
 * TownSystem - Procedural Town Generation
 * Generates deterministic towns with flatness-based placement.
 * Towns are safe zones with bank/store/anvil buildings.
 *
 * This system delegates procedural generation to @hyperscape/procgen/building/town
 * while handling runtime concerns (manifest loading, terrain integration, queries).
 *
 * **Building Collision:**
 * - Generates building layouts using BuildingGenerator
 * - Registers collision data with BuildingCollisionService
 * - Stores layouts for BuildingRenderingSystem to reuse
 *
 * Configuration loaded from world-config.json via DataManager.
 * IMPORTANT: DataManager.loadManifests*() must be called BEFORE TownSystem.init()
 * otherwise default configuration values will be used.
 */

import { System } from "../infrastructure/System";
import type { World } from "../../../core/World";
import type {
  ProceduralTown,
  TownBuilding,
  TownSize,
  TownBuildingType,
  ManifestTown,
  ManifestTownSize,
  TownEntryPoint,
  TownInternalRoad,
  TownPath,
  TownLandmark,
  TownPlaza,
} from "../../../types/world/world-types";
import type { BuildingLayoutInput } from "../../../types/world/building-collision-types";
import { Logger } from "../../../utils/Logger";
import { DataManager } from "../../../data/DataManager";
import {
  TownGenerator,
  type TownGeneratorConfig,
  type TownSizeConfig,
  type GeneratedTown,
  type TerrainProvider,
} from "@hyperscape/procgen/building/town";
import {
  BuildingGenerator,
  type BuildingLayout,
  CELL_SIZE,
  FOUNDATION_HEIGHT,
  snapToBuildingGrid,
} from "@hyperscape/procgen/building";
import { BuildingCollisionService } from "./BuildingCollisionService";
import type { FlatZone } from "../../../types/world/terrain";

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

const BUILDING_CONFIG: Record<
  TownBuildingType,
  { width: number; depth: number; priority: number }
> = {
  bank: { width: 8, depth: 6, priority: 1 },
  store: { width: 7, depth: 5, priority: 2 },
  anvil: { width: 5, depth: 4, priority: 3 },
  well: { width: 3, depth: 3, priority: 4 },
  house: { width: 6, depth: 5, priority: 5 },
  inn: { width: 10, depth: 12, priority: 2 },
  smithy: { width: 7, depth: 7, priority: 3 },
  "simple-house": { width: 6, depth: 6, priority: 6 },
  "long-house": { width: 5, depth: 12, priority: 6 },
};

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

/**
 * Building type mapping from TownBuildingType to procgen recipe keys.
 * Some town building types don't have direct procgen equivalents and use fallbacks.
 */
const BUILDING_TYPE_TO_RECIPE: Record<string, string> = {
  bank: "bank",
  store: "store",
  inn: "inn",
  smithy: "smithy",
  house: "simple-house",
  "simple-house": "simple-house",
  "long-house": "long-house",
};

/**
 * Building types that are stations (not visual buildings with collision).
 * These are spawned as interactive entities by StationSpawnerSystem.
 */
const STATION_TYPES = new Set(["well", "anvil"]);

export class TownSystem extends System {
  private towns: ProceduralTown[] = [];
  private seed: number = 0;
  private config!: TownConfig;
  private townGenerator!: TownGenerator;
  private terrainSystem?: {
    getHeightAt(x: number, z: number): number;
    getBiomeAtWorldPosition?(x: number, z: number): string;
  };

  /** BuildingGenerator for generating building layouts */
  private buildingGenerator!: BuildingGenerator;

  /** BuildingCollisionService for registering building collision */
  private collisionService!: BuildingCollisionService;

  /** Cached building layouts by building ID (for BuildingRenderingSystem reuse) */
  private buildingLayouts: Map<string, BuildingLayout> = new Map();

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
    this.config = loadTownConfig();
    this.terrainSystem = this.world.getSystem("terrain") as
      | {
          getHeightAt(x: number, z: number): number;
          getBiomeAtWorldPosition?(x: number, z: number): string;
        }
      | undefined;

    // Initialize the procedural town generator with terrain integration
    this.initializeTownGenerator();

    // Initialize building generator for layout generation
    this.buildingGenerator = new BuildingGenerator();

    // Initialize building collision service
    this.collisionService = new BuildingCollisionService(this.world);

    if (DataManager.getWorldConfig()?.towns) {
      Logger.system(
        "TownSystem",
        `Config: ${this.config.townCount} towns, ${this.config.minTownSpacing}m spacing`,
      );
    }
    this.initialized = true;
  }

  /**
   * Initialize the TownGenerator from @hyperscape/procgen with terrain provider
   */
  private initializeTownGenerator(): void {
    // Create a terrain provider adapter for the terrain system
    const terrainProvider: TerrainProvider = {
      getHeightAt: (x: number, z: number): number => {
        return this.terrainSystem?.getHeightAt(x, z) ?? 10;
      },
      getBiomeAt: (x: number, z: number): string => {
        return this.terrainSystem?.getBiomeAtWorldPosition?.(x, z) ?? "plains";
      },
      getWaterThreshold: (): number => {
        return this.config.waterThreshold;
      },
    };

    // Convert TownConfig to TownGeneratorConfig
    const generatorConfig: Partial<TownGeneratorConfig> = {
      townCount: this.config.townCount,
      worldSize: this.config.worldSize,
      minTownSpacing: this.config.minTownSpacing,
      flatnessSampleRadius: this.config.flatnessSampleRadius,
      flatnessSampleCount: this.config.flatnessSampleCount,
      waterThreshold: this.config.waterThreshold,
      optimalWaterDistanceMin: this.config.optimalWaterDistanceMin,
      optimalWaterDistanceMax: this.config.optimalWaterDistanceMax,
      townSizes: this.config.townSizes,
      biomeSuitability: this.config.biomeSuitability,
    };

    this.townGenerator = new TownGenerator({
      seed: this.seed,
      terrain: terrainProvider,
      config: generatorConfig,
    });
  }

  async start(): Promise<void> {
    if (!this.terrainSystem) {
      throw new Error("TownSystem requires TerrainSystem");
    }

    // Load pre-defined towns from buildings manifest first
    this.loadManifestTowns();

    // Then generate procedural towns (avoiding pre-defined town locations)
    this.generateTowns();

    const manifestTownCount =
      DataManager.getBuildingsManifest()?.towns?.length ?? 0;
    const proceduralTownCount = this.towns.length - manifestTownCount;

    if (manifestTownCount > 0) {
      Logger.system(
        "TownSystem",
        `Loaded ${manifestTownCount} pre-defined towns from buildings manifest`,
      );
    }

    if (this.towns.length === 0) {
      Logger.systemWarn(
        "TownSystem",
        "No towns generated - using manifest-defined areas only",
      );
      return;
    }

    if (
      proceduralTownCount > 0 &&
      proceduralTownCount < this.config.townCount
    ) {
      Logger.systemWarn(
        "TownSystem",
        `Only ${proceduralTownCount}/${this.config.townCount} procedural towns generated`,
      );
    }

    // Generate building layouts, register collision, and register flat zones
    // IMPORTANT: Runs on BOTH client and server:
    // - Server: Authoritative collision data for pathfinding
    // - Client: Prediction collision + flat zones for terrain flattening
    // Note: Runs async with yielding to prevent main thread blocking
    Logger.system(
      "TownSystem",
      `isServer=${this.world.isServer}, towns=${this.towns.length} - registering building collision and flat zones`,
    );
    await this.registerBuildingCollision();

    Logger.system(
      "TownSystem",
      `Total towns: ${this.towns.length} (${manifestTownCount} manifest + ${proceduralTownCount} procedural)`,
    );
  }

  /**
   * Load pre-defined towns from the buildings manifest
   */
  private loadManifestTowns(): void {
    const buildingsManifest = DataManager.getBuildingsManifest();
    if (!buildingsManifest?.towns?.length) {
      return;
    }

    for (const manifestTown of buildingsManifest.towns) {
      // Validate manifest town structure
      if (!manifestTown.id || typeof manifestTown.id !== "string") {
        throw new Error(
          `[TownSystem] Manifest town has invalid id: ${JSON.stringify(manifestTown.id)}`,
        );
      }
      if (
        !manifestTown.position ||
        typeof manifestTown.position.x !== "number" ||
        typeof manifestTown.position.z !== "number"
      ) {
        throw new Error(
          `[TownSystem] Manifest town "${manifestTown.id}" has invalid position: ${JSON.stringify(manifestTown.position)}`,
        );
      }
      if (
        !Array.isArray(manifestTown.buildings) ||
        manifestTown.buildings.length === 0
      ) {
        throw new Error(
          `[TownSystem] Manifest town "${manifestTown.id}" has no buildings`,
        );
      }

      const town = this.convertManifestTown(manifestTown);
      this.towns.push(town);
    }
  }

  /**
   * Convert a manifest town to a ProceduralTown
   * Also generates layout features (roads, paths, landmarks, plaza) using the TownGenerator
   */
  private convertManifestTown(manifest: ManifestTown): ProceduralTown {
    // Map manifest size (sm, md, lg) to TownSize (hamlet, village, town)
    const sizeMap: Record<ManifestTownSize, TownSize> = {
      sm: "hamlet",
      md: "village",
      lg: "town",
    };

    const townSize = sizeMap[manifest.size] ?? "village";

    // Get terrain height at town center
    const y =
      this.terrainSystem?.getHeightAt(
        manifest.position.x,
        manifest.position.z,
      ) ?? manifest.position.y;

    // Get biome at town location
    const biome =
      this.terrainSystem?.getBiomeAtWorldPosition?.(
        manifest.position.x,
        manifest.position.z,
      ) ?? "plains";

    // Convert buildings - positions are relative in manifest, convert to world coords
    // Also calculate entrance positions for each building
    // IMPORTANT: Snap to building grid for proper tile alignment (cells must align with tiles)
    const buildings: TownBuilding[] = manifest.buildings.map((b, index) => {
      // Validate each building in manifest
      if (!b.id || typeof b.id !== "string") {
        throw new Error(
          `[TownSystem] Building ${index} in town "${manifest.id}" has invalid id: ${JSON.stringify(b.id)}`,
        );
      }
      if (!b.type || typeof b.type !== "string") {
        throw new Error(
          `[TownSystem] Building "${b.id}" in town "${manifest.id}" has invalid type: ${JSON.stringify(b.type)}`,
        );
      }
      if (
        !b.position ||
        typeof b.position.x !== "number" ||
        typeof b.position.z !== "number"
      ) {
        throw new Error(
          `[TownSystem] Building "${b.id}" in town "${manifest.id}" has invalid position: ${JSON.stringify(b.position)}`,
        );
      }
      if (
        !b.size ||
        typeof b.size.width !== "number" ||
        typeof b.size.depth !== "number"
      ) {
        throw new Error(
          `[TownSystem] Building "${b.id}" in town "${manifest.id}" has invalid size: ${JSON.stringify(b.size)}`,
        );
      }
      if (typeof b.rotation !== "number" || !Number.isFinite(b.rotation)) {
        throw new Error(
          `[TownSystem] Building "${b.id}" in town "${manifest.id}" has invalid rotation: ${b.rotation}`,
        );
      }

      const rawWorldX = manifest.position.x + b.position.x;
      const rawWorldZ = manifest.position.z + b.position.z;
      // Snap to building grid - critical for collision tile alignment
      const snapped = snapToBuildingGrid(rawWorldX, rawWorldZ);
      const worldX = snapped.x;
      const worldZ = snapped.z;
      const worldY =
        this.terrainSystem?.getHeightAt(worldX, worldZ) ?? b.position.y;

      // Calculate entrance position at the front of the building
      // Front direction based on rotation (Three.js: local +Z faces (sin(θ), cos(θ)))
      const frontDirX = Math.sin(b.rotation);
      const frontDirZ = Math.cos(b.rotation);
      const entranceOffset = b.size.depth / 2 + 0.3;

      return {
        id: b.id,
        type: b.type,
        position: { x: worldX, y: worldY, z: worldZ },
        rotation: b.rotation,
        size: b.size,
        entrance: {
          x: worldX + frontDirX * entranceOffset,
          z: worldZ + frontDirZ * entranceOffset,
        },
      };
    });

    // Use TownGenerator to generate layout features (roads, landmarks, plaza)
    // This ensures manifest towns have the same features as procedurally generated towns
    const generatedTown = this.townGenerator.generateSingleTown(
      manifest.position.x,
      manifest.position.z,
      townSize,
      {
        id: manifest.id,
        name: manifest.name,
        layoutType: townSize === "town" ? "crossroads" : "throughway",
      },
    );

    // Generate paths from roads to manifest building entrances
    const paths = this.generatePathsForManifestBuildings(
      buildings,
      generatedTown.internalRoads ?? [],
      manifest.position,
    );

    // Use the generated layout features but keep the manifest's buildings
    return {
      id: manifest.id,
      name: manifest.name,
      position: {
        x: manifest.position.x,
        y,
        z: manifest.position.z,
      },
      size: townSize,
      safeZoneRadius: manifest.safeZoneRadius,
      biome,
      buildings, // Use manifest buildings with calculated entrances
      suitabilityScore: 1.0, // Pre-defined towns have max suitability
      connectedRoads: [],
      // Use generated layout features
      layoutType: generatedTown.layoutType,
      entryPoints: generatedTown.entryPoints,
      internalRoads: generatedTown.internalRoads,
      paths, // Use paths generated for manifest buildings
      landmarks: generatedTown.landmarks,
      plaza: generatedTown.plaza,
    };
  }

  /**
   * Generate paths from roads to manifest building entrances
   */
  private generatePathsForManifestBuildings(
    buildings: TownBuilding[],
    roads: TownInternalRoad[],
    townCenter: { x: number; z: number },
  ): TownPath[] {
    const paths: TownPath[] = [];
    const roadHalfWidth = 3; // 6m road width / 2
    const pathWidth = 1.5;

    for (const building of buildings) {
      if (!building.entrance) continue;

      // Find closest point on any road to the entrance
      let closestPoint: { x: number; z: number } | null = null;
      let closestDistance = Infinity;

      for (const road of roads) {
        const point = this.closestPointOnSegment(
          building.entrance.x,
          building.entrance.z,
          road.start.x,
          road.start.z,
          road.end.x,
          road.end.z,
        );

        const dist = dist2D(
          building.entrance.x,
          building.entrance.z,
          point.x,
          point.z,
        );
        if (dist < closestDistance) {
          closestDistance = dist;
          closestPoint = point;
        }
      }

      // If no road found, connect to town center
      if (!closestPoint || closestDistance > 50) {
        closestPoint = { x: townCenter.x, z: townCenter.z };
        closestDistance = dist2D(
          building.entrance.x,
          building.entrance.z,
          closestPoint.x,
          closestPoint.z,
        );
      }

      if (closestDistance < 1 || closestDistance > 50) continue;

      // Direction from road to entrance
      const dx = building.entrance.x - closestPoint.x;
      const dz = building.entrance.z - closestPoint.z;
      const len = Math.sqrt(dx * dx + dz * dz);

      if (len < 0.1) continue;

      // Path starts at road edge
      const pathStart = {
        x: closestPoint.x + (dx / len) * roadHalfWidth,
        z: closestPoint.z + (dz / len) * roadHalfWidth,
      };

      paths.push({
        start: pathStart,
        end: { x: building.entrance.x, z: building.entrance.z },
        width: pathWidth,
        buildingId: building.id,
      });
    }

    return paths;
  }

  /**
   * Find closest point on a line segment to a given point
   */
  private closestPointOnSegment(
    px: number,
    pz: number,
    ax: number,
    az: number,
    bx: number,
    bz: number,
  ): { x: number; z: number } {
    const dx = bx - ax;
    const dz = bz - az;
    const lengthSq = dx * dx + dz * dz;

    if (lengthSq === 0) return { x: ax, z: az };

    const t = Math.max(
      0,
      Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lengthSq),
    );
    return {
      x: ax + t * dx,
      z: az + t * dz,
    };
  }

  /**
   * Generate procedural towns using the TownGenerator from @hyperscape/procgen
   */
  private generateTowns(): void {
    // Convert existing manifest towns to GeneratedTown format for avoidance
    const existingTowns: GeneratedTown[] = this.towns.map((t) => ({
      id: t.id,
      name: t.name,
      position: t.position,
      size: t.size,
      safeZoneRadius: t.safeZoneRadius,
      biome: t.biome,
      buildings: t.buildings.map((b) => ({
        id: b.id,
        type: b.type,
        position: b.position,
        rotation: b.rotation,
        size: b.size,
      })),
      suitabilityScore: t.suitabilityScore,
      connectedRoads: t.connectedRoads,
    }));

    // Generate towns using the procgen library
    const result = this.townGenerator.generate(existingTowns);

    // Convert GeneratedTown to ProceduralTown and add to list
    for (const generatedTown of result.towns) {
      const proceduralTown = this.convertGeneratedTown(generatedTown);
      this.towns.push(proceduralTown);
    }

    // Log statistics
    const sizeCount = { hamlet: 0, village: 0, town: 0 };
    const layoutCount: Record<string, number> = {};
    for (const town of this.towns) {
      sizeCount[town.size]++;
      const layout = town.layoutType ?? "unknown";
      layoutCount[layout] = (layoutCount[layout] ?? 0) + 1;
    }
    Logger.system(
      "TownSystem",
      `Sizes: ${sizeCount.hamlet} hamlets, ${sizeCount.village} villages, ${sizeCount.town} towns`,
    );
    Logger.system(
      "TownSystem",
      `Layouts: ${Object.entries(layoutCount)
        .map(([k, v]) => `${v} ${k}`)
        .join(", ")}`,
    );
  }

  /**
   * Convert a GeneratedTown from @hyperscape/procgen to ProceduralTown
   */
  private convertGeneratedTown(generated: GeneratedTown): ProceduralTown {
    // Convert buildings
    const buildings: TownBuilding[] = generated.buildings.map((b) => ({
      id: b.id,
      type: b.type,
      position: b.position,
      rotation: b.rotation,
      size: b.size,
    }));

    // Convert entry points
    const entryPoints: TownEntryPoint[] | undefined =
      generated.entryPoints?.map((e) => ({
        angle: e.angle,
        position: e.position,
      }));

    // Convert internal roads
    const internalRoads: TownInternalRoad[] | undefined =
      generated.internalRoads?.map((r) => ({
        start: r.start,
        end: r.end,
        isMain: r.isMain,
      }));

    // Convert paths
    const paths: TownPath[] | undefined = generated.paths?.map((p) => ({
      start: p.start,
      end: p.end,
      width: p.width,
      buildingId: p.buildingId,
    }));

    // Convert landmarks
    const landmarks: TownLandmark[] | undefined = generated.landmarks?.map(
      (l) => ({
        id: l.id,
        type: l.type,
        position: l.position,
        rotation: l.rotation,
        size: l.size,
      }),
    );

    // Convert plaza
    const plaza: TownPlaza | undefined = generated.plaza
      ? {
          position: generated.plaza.position,
          radius: generated.plaza.radius,
          shape: generated.plaza.shape,
          material: generated.plaza.material,
        }
      : undefined;

    return {
      id: generated.id,
      name: generated.name,
      position: generated.position,
      size: generated.size,
      safeZoneRadius: generated.safeZoneRadius,
      biome: generated.biome,
      buildings,
      suitabilityScore: generated.suitabilityScore,
      connectedRoads: generated.connectedRoads,
      layoutType: generated.layoutType,
      entryPoints,
      internalRoads,
      paths,
      landmarks,
      plaza,
    };
  }

  /**
   * Get the underlying TownGenerator for direct access
   */
  getTownGenerator(): TownGenerator {
    return this.townGenerator;
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
        inn: 0,
        smithy: 0,
        "simple-house": 0,
        "long-house": 0,
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

  // ============================================================================
  // BUILDING COLLISION
  // ============================================================================

  /**
   * Generate building layouts and register collision for all buildings.
   * Called during start() on server side.
   *
   * MAIN THREAD PROTECTION: Processes buildings in batches with yielding
   * to prevent blocking during server startup.
   */
  private async registerBuildingCollision(): Promise<void> {
    let totalBuildings = 0;
    let registeredBuildings = 0;

    // Collect all buildings to process (excluding stations)
    const buildingsToProcess: Array<{
      town: ProceduralTown;
      building: TownBuilding;
    }> = [];

    for (const town of this.towns) {
      for (const building of town.buildings) {
        if (!STATION_TYPES.has(building.type)) {
          buildingsToProcess.push({ town, building });
        }
      }
    }

    totalBuildings = buildingsToProcess.length;

    // Process in batches with yielding to prevent main thread blocking
    const BATCH_SIZE = 5;
    for (
      let batchStart = 0;
      batchStart < buildingsToProcess.length;
      batchStart += BATCH_SIZE
    ) {
      const batchEnd = Math.min(
        batchStart + BATCH_SIZE,
        buildingsToProcess.length,
      );

      for (let i = batchStart; i < batchEnd; i++) {
        const { town, building } = buildingsToProcess[i];

        const recipeKey = BUILDING_TYPE_TO_RECIPE[building.type];
        if (!recipeKey) {
          Logger.systemWarn(
            "TownSystem",
            `Unknown building type for collision: ${building.type} - skipping`,
          );
          continue;
        }

        // Generate building layout using BuildingGenerator
        const generated = this.buildingGenerator.generate(recipeKey, {
          seed: `${town.id}_${building.id}`,
          includeRoof: true,
        });

        if (!generated) {
          Logger.systemWarn(
            "TownSystem",
            `Failed to generate layout for ${building.type} in ${town.name}`,
          );
          continue;
        }

        // Cache the layout for BuildingRenderingSystem to reuse
        this.buildingLayouts.set(building.id, generated.layout);

        // Get ground height at building position
        const groundY =
          this.terrainSystem?.getHeightAt(
            building.position.x,
            building.position.z,
          ) ?? building.position.y;

        // Convert BuildingLayout to BuildingLayoutInput for collision service
        const layoutInput = this.convertLayoutToInput(generated.layout);

        // Register collision with the service
        this.collisionService.registerBuilding(
          building.id,
          town.id,
          layoutInput,
          { x: building.position.x, y: groundY, z: building.position.z },
          building.rotation,
        );

        // Register flat zone with TerrainSystem (like duel arena does)
        // This ensures terrain heightmap is modified so players walk at correct height
        this.registerBuildingFlatZone(building, generated.layout, groundY);

        registeredBuildings++;
      }

      // Yield to main thread between batches
      if (batchEnd < buildingsToProcess.length) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    }

    Logger.system(
      "TownSystem",
      `Registered collision for ${registeredBuildings}/${totalBuildings} buildings`,
    );

    // Log collision service status for debugging
    const buildingCount = this.collisionService.getBuildingCount();
    Logger.system(
      "TownSystem",
      `BuildingCollisionService now has ${buildingCount} buildings registered`,
    );

    // === VALIDATION: Verify building collision system is working ===
    this.validateBuildingCollisionSystem();
  }

  /**
   * Validate that the building collision system is properly set up.
   * Throws errors if critical problems are detected.
   */
  private validateBuildingCollisionSystem(): void {
    const buildingCount = this.collisionService.getBuildingCount();

    // ERROR: No buildings registered when we should have some
    if (buildingCount === 0 && this.towns.length > 0) {
      const totalBuildings = this.towns.reduce(
        (sum, t) => sum + t.buildings.length,
        0,
      );
      throw new Error(
        `[TownSystem] CRITICAL: No buildings registered with collision service! ` +
          `Expected ${totalBuildings} buildings from ${this.towns.length} towns.`,
      );
    }

    // Validate each building has:
    // 1. Walkable tiles
    // 2. At least one door
    // 3. Proper terrain integration (flat zone)
    const allBuildings = this.collisionService.getAllBuildings();
    let errorsFound = 0;

    for (const building of allBuildings) {
      // Use static helper for consistent ground floor lookup
      const groundFloor =
        BuildingCollisionService.getGroundFloorFromData(building);
      if (!groundFloor) {
        Logger.systemError(
          "TownSystem",
          `Building ${building.buildingId} has NO ground floor!`,
        );
        errorsFound++;
        continue;
      }

      // Check walkable tiles
      if (groundFloor.walkableTiles.size === 0) {
        Logger.systemError(
          "TownSystem",
          `Building ${building.buildingId} has NO walkable tiles on ground floor!`,
        );
        errorsFound++;
      }

      // Check for doors using helper
      const doorWalls =
        BuildingCollisionService.getDoorWallSegments(groundFloor);
      const doorCount = doorWalls.length;
      if (doorCount === 0) {
        Logger.systemError(
          "TownSystem",
          `Building ${building.buildingId} has NO doors! Players cannot enter.`,
        );
        errorsFound++;
      }

      // Verify terrain flat zone exists for this building
      if (this.terrainSystem) {
        const centerHeight = this.terrainSystem.getHeightAt(
          building.worldPosition.x,
          building.worldPosition.z,
        );
        const expectedFloor = groundFloor.elevation;
        const heightDiff = Math.abs((centerHeight ?? 0) - expectedFloor);

        if (heightDiff > 0.5) {
          Logger.systemWarn(
            "TownSystem",
            `Building ${building.buildingId} terrain height mismatch: ` +
              `terrain=${centerHeight?.toFixed(2)}, floor=${expectedFloor.toFixed(2)}, diff=${heightDiff.toFixed(2)}m`,
          );
        }
      }

      // Validate door tiles are reachable from outside
      const doorTiles = this.collisionService.getDoorTiles(building.buildingId);
      if (doorTiles.length > 0) {
        let reachableDoors = 0;
        for (const door of doorTiles) {
          // Check if the exterior approach tile is walkable
          const exteriorWalkable =
            this.collisionService.isTileWalkableInBuilding(
              door.tileX,
              door.tileZ,
              0,
            );
          if (exteriorWalkable) {
            reachableDoors++;
          } else {
            Logger.systemWarn(
              "TownSystem",
              `Building ${building.buildingId} door at (${door.tileX},${door.tileZ}) ` +
                `exterior approach tile is NOT walkable!`,
            );
          }
        }

        if (reachableDoors === 0) {
          Logger.systemError(
            "TownSystem",
            `Building ${building.buildingId} has ${doorTiles.length} doors but NONE are reachable from outside!`,
          );
          errorsFound++;
        }
      }
    }

    if (errorsFound > 0) {
      throw new Error(
        `[TownSystem] CRITICAL: ${errorsFound} building collision errors detected! ` +
          `Check logs above for details. Navigation will NOT work correctly.`,
      );
    }

    // === CRITICAL: Test actual pathfinding to buildings ===
    this.validateBuildingPathfinding(allBuildings);

    // === CRITICAL: Validate tiles under buildings are blocked ===
    this.validateBuildingTileBlocking(allBuildings);

    // Summary stats using helper methods
    const totalWalkableTiles = allBuildings.reduce((sum, b) => {
      const floor0 = BuildingCollisionService.getGroundFloorFromData(b);
      return sum + (floor0?.walkableTiles.size ?? 0);
    }, 0);
    const totalDoors = allBuildings.reduce((sum, b) => {
      const floor0 = BuildingCollisionService.getGroundFloorFromData(b);
      if (!floor0) return sum;
      return sum + BuildingCollisionService.getDoorWallSegments(floor0).length;
    }, 0);

    // Print prominent success message
    console.log(
      `\n╔══════════════════════════════════════════════════════════════╗`,
    );
    console.log(
      `║  BUILDING COLLISION SYSTEM: INITIALIZED SUCCESSFULLY         ║`,
    );
    console.log(
      `╠══════════════════════════════════════════════════════════════╣`,
    );
    console.log(
      `║  Buildings registered: ${String(allBuildings.length).padEnd(38)}║`,
    );
    console.log(
      `║  Total walkable tiles: ${String(totalWalkableTiles).padEnd(38)}║`,
    );
    console.log(`║  Total doors: ${String(totalDoors).padEnd(47)}║`);
    console.log(`║  Towns: ${String(this.towns.length).padEnd(53)}║`);
    console.log(
      `╚══════════════════════════════════════════════════════════════╝\n`,
    );

    Logger.system(
      "TownSystem",
      `✓ Building collision validation passed: ${allBuildings.length} buildings, all have doors and walkable tiles`,
    );
  }

  /**
   * Validate that pathfinding actually works to buildings.
   * Tests path from outside to DOOR INTERIOR (the actual entry point).
   * THROWS if pathfinding fails - this is a critical error.
   */
  private validateBuildingPathfinding(
    allBuildings: import("../../../types/world/building-collision-types").BuildingCollisionData[],
  ): void {
    // Import BFSPathfinder for testing (lazy import to avoid circular deps)
    const { BFSPathfinder } = require("../../shared/movement/BFSPathfinder");
    const pathfinder = new BFSPathfinder();

    let buildingsTested = 0;
    let pathfindingErrors = 0;
    const failedBuildings: string[] = [];

    for (const building of allBuildings) {
      // Use static helper for consistent ground floor lookup
      const groundFloor =
        BuildingCollisionService.getGroundFloorFromData(building);
      if (!groundFloor) {
        // This is a critical error - all buildings MUST have a ground floor
        Logger.systemError(
          "TownSystem",
          `VALIDATION ERROR [${building.buildingId}]: No ground floor found!`,
        );
        pathfindingErrors++;
        failedBuildings.push(`${building.buildingId}:no-ground-floor`);
        continue;
      }

      if (groundFloor.walkableTiles.size === 0) {
        Logger.systemError(
          "TownSystem",
          `VALIDATION ERROR [${building.buildingId}]: Ground floor has no walkable tiles!`,
        );
        pathfindingErrors++;
        failedBuildings.push(`${building.buildingId}:no-walkable-tiles`);
        continue;
      }

      // Get ALL doors for this building - test each one
      const allDoors = this.collisionService.getDoorTiles(building.buildingId);
      if (allDoors.length === 0) {
        Logger.systemError(
          "TownSystem",
          `VALIDATION ERROR [${building.buildingId}]: No doors found! Building is inaccessible.`,
        );
        pathfindingErrors++;
        failedBuildings.push(`${building.buildingId}:no-doors`);
        continue;
      }

      // Define walkability check using collision service (reused for all doors)
      const isWalkable = (
        tile: { x: number; z: number },
        fromTile?: { x: number; z: number },
      ): boolean => {
        // Check building walkability
        const buildingWalkable = this.collisionService.isTileWalkableInBuilding(
          tile.x,
          tile.z,
          0,
        );
        if (!buildingWalkable) return false;

        // Check wall blocking if we have a source tile
        if (fromTile) {
          const wallBlocked = this.collisionService.isWallBlocked(
            fromTile.x,
            fromTile.z,
            tile.x,
            tile.z,
            0,
          );
          if (wallBlocked) return false;
        }

        return true;
      };

      // Test EACH door for this building
      let doorsWorking = 0;
      let doorsFailed = 0;
      const doorResults: string[] = [];

      for (const doorInfo of allDoors) {
        // doorInfo has: tileX, tileZ (exterior approach), direction
        // But doorInfo.tileX/tileZ are already the EXTERIOR tiles from getDoorTiles()
        // We need to recalculate to get proper interior
        // Actually, getDoorTiles returns exterior tiles, so we need the interior
        const exteriorX = doorInfo.tileX;
        const exteriorZ = doorInfo.tileZ;

        // Interior tile is one step INTO the building (opposite of door direction)
        let interiorX = exteriorX;
        let interiorZ = exteriorZ;
        switch (doorInfo.direction) {
          case "north":
            interiorZ += 1;
            break; // Door faces north, interior is south (higher Z)
          case "south":
            interiorZ -= 1;
            break; // Door faces south, interior is north (lower Z)
          case "east":
            interiorX -= 1;
            break; // Door faces east, interior is west (lower X)
          case "west":
            interiorX += 1;
            break; // Door faces west, interior is east (higher X)
        }

        // Start from 5 tiles AWAY from door in the approach direction
        let startX = exteriorX;
        let startZ = exteriorZ;
        const approachDistance = 5;
        switch (doorInfo.direction) {
          case "north":
            startZ -= approachDistance;
            break;
          case "south":
            startZ += approachDistance;
            break;
          case "east":
            startX += approachDistance;
            break;
          case "west":
            startX -= approachDistance;
            break;
        }

        // TEST 1: Can we path from outside to door EXTERIOR?
        const pathToExterior = pathfinder.findPath(
          { x: startX, z: startZ },
          { x: exteriorX, z: exteriorZ },
          isWalkable,
        );

        if (pathToExterior.length === 0) {
          doorsFailed++;
          doorResults.push(`door@(${exteriorX},${exteriorZ}):no-path`);
          continue;
        }

        // Verify path reaches exterior (not truncated)
        const lastTile = pathToExterior[pathToExterior.length - 1];
        if (lastTile.x !== exteriorX || lastTile.z !== exteriorZ) {
          doorsFailed++;
          doorResults.push(`door@(${exteriorX},${exteriorZ}):truncated`);
          continue;
        }

        // TEST 2: Can we step from door exterior to door INTERIOR?
        const canEnterDoor = isWalkable(
          { x: interiorX, z: interiorZ },
          { x: exteriorX, z: exteriorZ },
        );
        if (!canEnterDoor) {
          doorsFailed++;
          doorResults.push(`door@(${exteriorX},${exteriorZ}):blocked`);
          continue;
        }

        doorsWorking++;
        doorResults.push(
          `door@(${exteriorX},${exteriorZ}):OK[${pathToExterior.length}]`,
        );
      }

      // Building passes if AT LEAST ONE door works
      if (doorsWorking === 0) {
        Logger.systemError(
          "TownSystem",
          `ALL DOORS FAILED [${building.buildingId}]: ${doorsFailed} doors tested, none accessible. ${doorResults.join(", ")}`,
        );
        pathfindingErrors++;
        failedBuildings.push(`${building.buildingId}:all-doors-failed`);
        continue;
      }

      buildingsTested++;
      if (doorsFailed > 0) {
        Logger.systemWarn(
          "TownSystem",
          `Building ${building.buildingId}: ${doorsWorking}/${allDoors.length} doors work (${doorsFailed} blocked)`,
        );
      }
      Logger.system(
        "TownSystem",
        `✓ Building ${building.buildingId}: ${doorsWorking}/${allDoors.length} doors accessible`,
      );
    }

    if (pathfindingErrors > 0) {
      throw new Error(
        `[TownSystem] CRITICAL PATHFINDING FAILURE: ${pathfindingErrors} building(s) unreachable!\n` +
          `Failed: ${failedBuildings.join(", ")}\n` +
          `Players will NOT be able to enter these buildings. Server startup aborted.`,
      );
    }

    // LARP check: Ensure we actually tested something
    if (buildingsTested === 0 && allBuildings.length > 0) {
      throw new Error(
        `[TownSystem] CRITICAL: ${allBuildings.length} buildings exist but ZERO were validated! ` +
          `All buildings failed pre-checks (no ground floor, no doors, or no walkable tiles).`,
      );
    }

    Logger.system(
      "TownSystem",
      `✓ Pathfinding validation PASSED: All ${buildingsTested}/${allBuildings.length} buildings are reachable from outside`,
    );
  }

  /**
   * Validate that tiles under buildings are properly blocked.
   * This ensures:
   * 1. Tiles INSIDE the building (not walkable floors) are BLOCKED
   * 2. Tiles OUTSIDE (approach areas) are WALKABLE
   * 3. Building floor tiles are WALKABLE
   */
  private validateBuildingTileBlocking(
    allBuildings: import("../../../types/world/building-collision-types").BuildingCollisionData[],
  ): void {
    let tilesChecked = 0;
    let errors = 0;
    const failedChecks: string[] = [];

    for (const building of allBuildings) {
      const bbox = building.boundingBox;
      // Use static helper for consistent ground floor lookup
      const groundFloor =
        BuildingCollisionService.getGroundFloorFromData(building);
      if (!groundFloor) continue;

      // Get door walls once for the entire building check
      const doorWalls =
        BuildingCollisionService.getDoorWallSegments(groundFloor);

      // Check ALL tiles within the building's bounding box
      for (let tx = bbox.minTileX; tx <= bbox.maxTileX; tx++) {
        for (let tz = bbox.minTileZ; tz <= bbox.maxTileZ; tz++) {
          tilesChecked++;
          const key = `${tx},${tz}`;
          const isWalkableFloor = groundFloor.walkableTiles.has(key);
          const isWalkable = this.collisionService.isTileWalkableInBuilding(
            tx,
            tz,
            0,
          );

          if (isWalkableFloor) {
            // Floor tile SHOULD be walkable
            if (!isWalkable) {
              errors++;
              if (failedChecks.length < 5) {
                failedChecks.push(
                  `${building.buildingId}:(${tx},${tz}) floor tile marked NOT walkable`,
                );
              }
            }
          } else {
            // Not a floor tile - check if it's in the interior (should be blocked)
            // Tiles at the edge (within 1 tile margin) are allowed for approach
            const margin = 1;
            const isInterior =
              tx > bbox.minTileX + margin &&
              tx < bbox.maxTileX - margin &&
              tz > bbox.minTileZ + margin &&
              tz < bbox.maxTileZ - margin;

            if (isInterior && isWalkable) {
              // Interior non-floor tile SHOULD be blocked (unless it's a door exterior)
              // Check against pre-fetched door walls
              let isDoorExterior = false;
              for (const wall of doorWalls) {
                const doorTiles =
                  BuildingCollisionService.getDoorExteriorAndInterior(
                    wall.tileX,
                    wall.tileZ,
                    wall.side,
                  );
                if (doorTiles.exteriorX === tx && doorTiles.exteriorZ === tz) {
                  isDoorExterior = true;
                  break;
                }
              }

              if (!isDoorExterior) {
                errors++;
                if (failedChecks.length < 5) {
                  failedChecks.push(
                    `${building.buildingId}:(${tx},${tz}) interior non-floor tile is WALKABLE (should be blocked)`,
                  );
                }
              }
            }
          }
        }
      }
    }

    if (errors > 0) {
      Logger.systemError(
        "TownSystem",
        `TILE BLOCKING VALIDATION FAILED: ${errors} tiles have incorrect walkability!`,
      );
      for (const check of failedChecks) {
        Logger.systemError("TownSystem", `  - ${check}`);
      }
      throw new Error(
        `[TownSystem] CRITICAL: ${errors} tiles have incorrect walkability. ` +
          `Players may walk through walls or be blocked from valid tiles.`,
      );
    }

    Logger.system(
      "TownSystem",
      `✓ Tile blocking validation PASSED: ${tilesChecked} tiles checked, all correct`,
    );
  }

  /**
   * Register a flat zone for a building with TerrainSystem.
   *
   * This is the key to making buildings walkable - same approach as duel arena:
   * 1. Flat zones modify the terrain heightmap
   * 2. getHeightAt() returns the flat zone height instead of procedural terrain
   * 3. Players naturally walk at the correct elevation
   *
   * **Door Approach Y-Transition:**
   *
   * When a player walks from terrain to a building through a door, the Y-elevation
   * transitions as follows:
   *
   * 1. **Far approach** (outside blend radius): Terrain height from procedural generation
   * 2. **Blend zone** (within blendRadius of flat zone edge): Smooth interpolation
   *    between terrain height and building floor height
   * 3. **Door exterior** (within padding area): Building floor height (part of flat zone)
   * 4. **Door interior** (on building floor tile): Building floor height
   *
   * The padding and blend radius are carefully chosen to prevent sharp Y-jumps:
   * - Padding (3m) extends the flat zone beyond the building walls to cover entrance
   *   steps and door approach tiles (which are 1m outside the building bbox)
   * - Blend radius (4m) provides gradual transition from natural terrain to flat zone
   *
   * Total smooth transition zone: ~7m (3m padding + 4m blend) on each side of building.
   *
   * @param building - The building to register a flat zone for
   * @param layout - The building's generated layout
   * @param groundY - The ground height at the building position
   */
  private registerBuildingFlatZone(
    building: TownBuilding,
    layout: BuildingLayout,
    groundY: number,
  ): void {
    if (!this.terrainSystem) return;

    // Calculate building dimensions in world units
    // Building width/depth are in cells, each cell is CELL_SIZE meters (4m)
    const buildingWidth = layout.width * CELL_SIZE;
    const buildingDepth = layout.depth * CELL_SIZE;

    // Floor height is ground + foundation
    // This is where players stand when inside the building
    const floorHeight = groundY + FOUNDATION_HEIGHT;

    // Create flat zone matching building footprint with generous padding
    // Building visuals extend beyond the cell grid:
    // - Wall thickness: 0.22m at cell boundaries
    // - Foundation overhang: 0.15m past walls
    // - Entrance steps: 2 steps × 0.4m depth = 0.8m
    // - Total visual extension: ~1.2m
    //
    // We add extra padding to ensure terrain doesn't poke through and
    // to cover door approach tiles (1 tile = 1m outside building bbox):
    // - 3m padding covers entrance steps + approach area + 2m safety margin
    // - 4m blend radius provides smooth transition to natural terrain
    // - Together with collision margin (1 tile), this prevents clipping
    //
    // IMPORTANT: If changing these values, consider the door approach Y-transition.
    // The flat zone MUST extend at least 1m past the building bbox to cover
    // door approach tiles, otherwise players will experience Y-jumps at doors.
    const padding = 3; // 3m padding for entrance steps and foundation overhang
    const blendRadius = 4; // Smooth terrain transition over 4m

    const zone: FlatZone = {
      id: `building_${building.id}`,
      centerX: building.position.x,
      centerZ: building.position.z,
      width: buildingWidth + padding * 2,
      depth: buildingDepth + padding * 2,
      height: floorHeight,
      blendRadius,
    };

    // Register with TerrainSystem
    const terrain = this.terrainSystem as {
      registerFlatZone?: (zone: FlatZone) => void;
    };
    if (terrain.registerFlatZone) {
      terrain.registerFlatZone(zone);
      Logger.system(
        "TownSystem",
        `Registered flat zone for ${building.id} at (${zone.centerX.toFixed(0)}, ${zone.centerZ.toFixed(0)}) ` +
          `size ${zone.width.toFixed(0)}x${zone.depth.toFixed(0)}m, height=${zone.height.toFixed(2)}m`,
      );
    }
  }

  /**
   * Convert BuildingLayout from procgen to BuildingLayoutInput for collision service
   */
  private convertLayoutToInput(layout: BuildingLayout): BuildingLayoutInput {
    return {
      width: layout.width,
      depth: layout.depth,
      floors: layout.floors,
      floorPlans: layout.floorPlans.map((fp) => ({
        footprint: fp.footprint,
        roomMap: fp.roomMap,
        internalOpenings: fp.internalOpenings,
        externalOpenings: fp.externalOpenings,
      })),
      stairs: layout.stairs,
    };
  }

  // ============================================================================
  // BUILDING LAYOUT ACCESS
  // ============================================================================

  /**
   * Get cached building layout by building ID.
   * Used by BuildingRenderingSystem to avoid regenerating layouts.
   *
   * @param buildingId - Building ID to get layout for
   * @returns BuildingLayout if cached, undefined otherwise
   */
  getBuildingLayout(buildingId: string): BuildingLayout | undefined {
    return this.buildingLayouts.get(buildingId);
  }

  /**
   * Get all cached building layouts.
   * Used by BuildingRenderingSystem for batch rendering.
   */
  getAllBuildingLayouts(): Map<string, BuildingLayout> {
    return this.buildingLayouts;
  }

  /**
   * Get the BuildingCollisionService instance.
   * Used for floor-aware collision queries.
   */
  getCollisionService(): BuildingCollisionService {
    return this.collisionService;
  }

  /**
   * Check if a tile is walkable considering building collision.
   * This is for pathfinding integration.
   *
   * @param tileX - World tile X coordinate
   * @param tileZ - World tile Z coordinate
   * @param floorIndex - Floor level (0 = ground floor)
   * @returns true if walkable at this floor
   */
  isBuildingTileWalkable(
    tileX: number,
    tileZ: number,
    floorIndex: number = 0,
  ): boolean {
    return this.collisionService.isWalkableAtFloor(tileX, tileZ, floorIndex);
  }

  /**
   * Check if movement between tiles is blocked by a building wall.
   *
   * @param fromX - Source tile X
   * @param fromZ - Source tile Z
   * @param toX - Destination tile X
   * @param toZ - Destination tile Z
   * @param floorIndex - Current floor level
   * @returns true if movement blocked by wall
   */
  isBuildingWallBlocked(
    fromX: number,
    fromZ: number,
    toX: number,
    toZ: number,
    floorIndex: number = 0,
  ): boolean {
    return this.collisionService.isWallBlocked(
      fromX,
      fromZ,
      toX,
      toZ,
      floorIndex,
    );
  }

  destroy(): void {
    // Clear collision service
    if (this.collisionService) {
      this.collisionService.clear();
    }

    // Clear cached layouts
    this.buildingLayouts.clear();

    this.towns = [];
    super.destroy();
  }
}
