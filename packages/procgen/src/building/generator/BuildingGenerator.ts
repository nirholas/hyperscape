/**
 * BuildingGenerator
 * Main class for procedural building generation
 */

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import type {
  BuildingRecipe,
  BuildingLayout,
  BuildingStats,
  FloorPlan,
  Room,
  Cell,
  StairPlacement,
  BaseFootprint,
  RNG,
  PropPlacements,
  GeneratedBuilding,
  BuildingGeneratorOptions,
} from "./types";

import {
  CELL_SIZE,
  WALL_HEIGHT,
  WALL_THICKNESS,
  FLOOR_THICKNESS,
  ROOF_THICKNESS,
  FLOOR_HEIGHT,
  FOUNDATION_HEIGHT,
  FOUNDATION_OVERHANG,
  TERRAIN_DEPTH,
  ENTRANCE_STEP_HEIGHT,
  ENTRANCE_STEP_DEPTH,
  ENTRANCE_STEP_COUNT,
  TERRAIN_STEP_COUNT,
  RAILING_HEIGHT,
  RAILING_THICKNESS,
  DOOR_WIDTH,
  DOOR_HEIGHT,
  ARCH_WIDTH,
  WINDOW_WIDTH,
  WINDOW_HEIGHT,
  WINDOW_SILL_HEIGHT,
  COUNTER_HEIGHT,
  COUNTER_DEPTH,
  COUNTER_LENGTH,
  NPC_HEIGHT,
  NPC_WIDTH,
  FORGE_SIZE,
  ANVIL_SIZE,
  palette,
  getSideVector,
} from "./constants";

import { getRecipe } from "./recipes";
import { createRng } from "./rng";
import {
  applyVertexColors,
  removeInternalFaces,
  getCellCenter,
  greedyMesh2D,
  createMergedFloorGeometry,
  getCachedBox,
  createLOD1Geometry,
  createLOD2Geometry,
  geometryCache,
} from "./geometry";

// Re-export for convenience
export { BUILDING_RECIPES, getRecipe } from "./recipes";
export { createRng } from "./rng";
export * from "./types";
export * from "./constants";

/**
 * BuildingGenerator class
 * Creates procedural buildings from recipes
 */
export class BuildingGenerator {
  private uberMaterial: THREE.MeshStandardMaterial;

  constructor() {
    this.uberMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.85,
      metalness: 0.05,
    });
  }

  /**
   * Generate a building from a recipe type
   */
  generate(
    typeKey: string,
    options: BuildingGeneratorOptions = {},
  ): GeneratedBuilding | null {
    const recipe = getRecipe(typeKey);
    if (!recipe) {
      console.warn(`Unknown building type: ${typeKey}`);
      return null;
    }

    const seed = options.seed || `${typeKey}_${Date.now()}`;
    const rng = createRng(seed);
    const includeRoof = options.includeRoof !== false;
    const useGreedyMeshing = options.useGreedyMeshing !== false; // Default: true

    // Use cached layout if provided, otherwise generate new one
    // This optimization allows BuildingRenderingSystem to reuse layouts
    // already computed by TownSystem, avoiding duplicate computation
    const layout = options.cachedLayout || this.generateLayout(recipe, rng);
    const { building, stats } = this.buildBuilding(
      layout,
      recipe,
      typeKey,
      rng,
      includeRoof,
      useGreedyMeshing,
    );

    const result: GeneratedBuilding = {
      mesh: building,
      layout,
      stats,
      recipe,
      typeKey,
    };

    // Generate LOD meshes if requested
    if (options.generateLODs) {
      result.lods = this.generateLODs(layout);
    }

    return result;
  }

  /**
   * Generate LOD (Level of Detail) meshes for a building
   */
  private generateLODs(layout: BuildingLayout): import("./types").LODMesh[] {
    const lods: import("./types").LODMesh[] = [];
    const width = layout.width * CELL_SIZE;
    const depth = layout.depth * CELL_SIZE;
    const totalHeight = layout.floors * FLOOR_HEIGHT + FOUNDATION_HEIGHT;

    // LOD1: Simplified building shell (medium distance)
    const lod1Geo = createLOD1Geometry(
      width,
      depth,
      layout.floors * FLOOR_HEIGHT,
      FOUNDATION_HEIGHT,
    );
    applyVertexColors(lod1Geo, palette.wallOuter);
    const lod1Mesh = new THREE.Mesh(lod1Geo, this.uberMaterial);
    lod1Mesh.name = "lod1";
    lods.push({
      level: 1 as import("./types").LODLevel,
      mesh: lod1Mesh,
      distance: 50, // Switch to LOD1 at 50m
    });

    // LOD2: Minimal box (far distance)
    const lod2Geo = createLOD2Geometry(width, depth, totalHeight);
    applyVertexColors(lod2Geo, palette.wallOuter);
    const lod2Mesh = new THREE.Mesh(lod2Geo, this.uberMaterial);
    lod2Mesh.name = "lod2";
    lods.push({
      level: 2 as import("./types").LODLevel,
      mesh: lod2Mesh,
      distance: 100, // Switch to LOD2 at 100m
    });

    return lods;
  }

  /**
   * Generate a building layout from a recipe
   */
  generateLayout(recipe: BuildingRecipe, rng: RNG): BuildingLayout {
    const baseFootprint = this.generateBaseFootprint(recipe, rng);
    let floors = this.resolveFloorCount(recipe, rng);
    const floorPlans: FloorPlan[] = [];
    const upperFootprints: boolean[][][] = [];

    // Floor 0: base footprint
    upperFootprints.push(baseFootprint.cells);

    // Generate footprints for all upper floors (1, 2, ...)
    // Each upper floor can be slightly smaller than the one below
    const protectedCells: Cell[] = [];
    for (let floorIdx = 1; floorIdx < floors; floorIdx += 1) {
      // Generate upper footprint based on the floor below
      const prevFootprint =
        floorIdx === 1
          ? baseFootprint
          : {
              ...baseFootprint,
              cells: upperFootprints[floorIdx - 1],
            };
      const upper = this.generateUpperFootprint(
        prevFootprint,
        recipe,
        rng,
        protectedCells,
        floorIdx === 1, // Only require full coverage on first upper floor
      );
      if (upper) {
        upperFootprints.push(upper);
      } else {
        // Can't generate this floor, cap the building here
        floors = floorIdx;
        break;
      }
    }

    let stairs: StairPlacement | null = null;
    if (floors > 1) {
      stairs = this.pickStairPlacement(
        baseFootprint.cells,
        upperFootprints[1],
        rng,
      );
      if (!stairs) {
        floors = 1;
        upperFootprints.length = 1;
      }
    }

    for (let floor = 0; floor < floors; floor += 1) {
      const footprint = upperFootprints[floor];
      if (!footprint) {
        throw new Error(
          `Missing footprint for floor ${floor}. floors=${floors}, upperFootprints.length=${upperFootprints.length}`,
        );
      }
      const roomData = this.generateRoomsForFootprint(footprint, recipe, rng);
      const rooms = roomData.rooms;
      const roomMap = roomData.roomMap;
      const archBias = Math.min(
        0.9,
        Math.max(0.1, recipe.archBias - floor * 0.15),
      );
      const extraChance =
        recipe.extraConnectionChance * (floor === 0 ? 1 : 0.7);
      const adjacency = this.collectRoomAdjacencies(footprint, roomMap);
      const internalOpenings = this.selectRoomOpenings(
        rooms.length,
        adjacency,
        archBias,
        extraChance,
        rng,
        baseFootprint.width,
      );

      const entranceRoomId =
        floor === 0
          ? this.chooseEntranceRoomId(
              rooms,
              baseFootprint.foyerCells,
              baseFootprint.width,
            )
          : 0;
      const entranceCount = floor === 0 ? recipe.entranceCount : 0;
      const windowChance = recipe.windowChance * (floor === 0 ? 1 : 0.7);
      const externalOpenings = this.generateExternalOpenings(
        footprint,
        roomMap,
        recipe,
        rng,
        entranceCount,
        entranceRoomId,
        baseFootprint.frontSide,
        windowChance,
        baseFootprint.width,
        stairs,
      );

      if (floors > 1 && floor > 0) {
        this.applyPatioDoors(
          externalOpenings,
          upperFootprints[0],
          footprint,
          recipe,
          rng,
          baseFootprint.width,
        );
      }

      floorPlans.push({
        footprint,
        roomMap,
        rooms,
        internalOpenings,
        externalOpenings,
      });
    }

    if (stairs && floors > 1) {
      const anchorId = this.cellId(stairs.col, stairs.row, baseFootprint.width);
      const landingId = this.cellId(
        stairs.landing.col,
        stairs.landing.row,
        baseFootprint.width,
      );
      const openingKey = this.edgeKey(anchorId, landingId);
      floorPlans[0]?.internalOpenings.set(openingKey, "arch");
      floorPlans[1]?.internalOpenings.set(openingKey, "arch");

      if (floorPlans[0]) {
        this.ensureStairExit(
          floorPlans[0],
          { col: stairs.col, row: stairs.row },
          { col: stairs.landing.col, row: stairs.landing.row },
          baseFootprint.width,
        );
      }
      if (floorPlans[1]) {
        this.ensureStairExit(
          floorPlans[1],
          { col: stairs.landing.col, row: stairs.landing.row },
          { col: stairs.col, row: stairs.row },
          baseFootprint.width,
        );
      }
    }

    // Validate generated layout
    if (baseFootprint.width <= 0 || baseFootprint.depth <= 0) {
      throw new Error(
        `[BuildingGenerator] Invalid layout dimensions: ${baseFootprint.width}x${baseFootprint.depth}`,
      );
    }
    if (floors <= 0 || floorPlans.length === 0) {
      throw new Error(
        `[BuildingGenerator] Invalid floor count: floors=${floors}, floorPlans=${floorPlans.length}`,
      );
    }
    if (floorPlans.length !== floors) {
      throw new Error(
        `[BuildingGenerator] Floor count mismatch: floors=${floors}, floorPlans=${floorPlans.length}`,
      );
    }
    // Validate each floor plan has a footprint
    for (let i = 0; i < floorPlans.length; i++) {
      const plan = floorPlans[i];
      if (!plan.footprint || plan.footprint.length === 0) {
        throw new Error(`[BuildingGenerator] Floor ${i} has invalid footprint`);
      }
    }

    return {
      width: baseFootprint.width,
      depth: baseFootprint.depth,
      floors,
      floorPlans,
      stairs,
    };
  }

  /**
   * Build a Three.js mesh from a layout
   * Returns a group with three children for separate raycast filtering:
   * - "floors": floor tiles, stairs, entrance steps (walkable surfaces - raycastable for click-to-move)
   * - "walls": walls, ceilings, foundation, railings, props (non-walkable - excluded from click raycast)
   * - "roof": actual roof pieces and terrace roofs (can be hidden separately)
   */
  buildBuilding(
    layout: BuildingLayout,
    recipe: BuildingRecipe,
    typeKey: string,
    rng: RNG,
    includeRoof: boolean,
    useGreedyMeshing: boolean = true,
  ): { building: THREE.Mesh | THREE.Group; stats: BuildingStats } {
    // Separate geometry arrays for floors (walkable), walls (non-walkable), and roof
    const floorGeometries: THREE.BufferGeometry[] = []; // Walkable surfaces
    const wallGeometries: THREE.BufferGeometry[] = []; // Non-walkable (walls, ceilings, props)
    const roofGeometries: THREE.BufferGeometry[] = [];

    const stats: BuildingStats = {
      wallSegments: 0,
      doorways: 0,
      archways: 0,
      windows: 0,
      roofPieces: 0,
      floorTiles: 0,
      stairSteps: 0,
      props: 0,
      rooms: 0,
      footprintCells: 0,
      upperFootprintCells: 0,
    };

    const propPlacements: PropPlacements = {};
    if (typeKey === "inn") {
      propPlacements.innBar = this.reserveInnBarPlacement(layout, recipe, rng);
    }
    if (typeKey === "bank") {
      propPlacements.bankCounter = this.reserveBankCounterPlacement(
        layout,
        recipe,
        rng,
      );
    }

    // Add foundation first (sits at ground level) - non-walkable
    if (useGreedyMeshing) {
      this.addFoundationOptimized(wallGeometries, layout);
    } else {
      this.addFoundation(wallGeometries, layout);
    }

    // Add entrance steps at doors on ground floor
    // Visual steps go to walls (decoration), invisible ramps go to floors (walkable)
    this.addEntranceSteps(wallGeometries, layout); // Visual box steps (decoration)
    this.addEntranceRamps(floorGeometries, layout); // Invisible walkable ramps

    for (let floor = 0; floor < layout.floors; floor += 1) {
      // Floor tiles are WALKABLE
      if (useGreedyMeshing) {
        this.addFloorTilesOptimized(floorGeometries, layout, floor, stats);
      } else {
        this.addFloorTiles(floorGeometries, layout, floor, stats);
      }

      // Floor edge skirts are visual trim - non-walkable
      this.addFloorEdgeSkirts(wallGeometries, layout, floor);

      // Walls are non-walkable
      this.addWallsForFloor(
        wallGeometries,
        layout,
        layout.floorPlans[floor],
        floor,
        stats,
      );

      // Add ceiling tiles for floors that have another floor above
      if (floor < layout.floors - 1) {
        // Ceilings are non-walkable (viewed from below)
        if (useGreedyMeshing) {
          this.addCeilingTilesOptimized(wallGeometries, layout, floor, stats);
        } else {
          this.addCeilingTiles(wallGeometries, layout, floor, stats);
        }
        // Terrace roofs go to roof group (they're roofs, not floors with ceilings above)
        this.addTerraceRoofs(roofGeometries, layout, floor, stats);
        // Terrace railings are non-walkable
        this.addTerraceRailings(wallGeometries, layout, floor);
      }
    }

    // Stairs - visual steps go to walls (decoration), invisible ramps go to floors (walkable)
    this.addStairs(wallGeometries, layout, stats); // Visual box steps (decoration)
    this.addStairRamps(floorGeometries, layout); // Invisible walkable ramps
    if (includeRoof) {
      // Actual roof pieces go to roof group
      this.addRoofPieces(roofGeometries, layout, stats);
    }
    // Props are non-walkable
    this.addBuildingProps(
      wallGeometries,
      layout,
      recipe,
      typeKey,
      rng,
      stats,
      propPlacements,
    );

    stats.rooms = layout.floorPlans.reduce(
      (count, plan) => count + plan.rooms.length,
      0,
    );
    stats.footprintCells = this.countFootprintCells(
      layout.floorPlans[0].footprint,
    );
    if (layout.floors > 1) {
      stats.upperFootprintCells = this.countFootprintCells(
        layout.floorPlans[layout.floors - 1].footprint,
      );
    }

    // Create the building group with named children
    const buildingGroup = new THREE.Group();
    buildingGroup.userData = { layout, recipe, stats };

    // Create floors mesh (walkable surfaces - for click-to-move raycast)
    if (floorGeometries.length > 0) {
      const mergedFloors = mergeGeometries(floorGeometries, false);
      if (mergedFloors) {
        const cleanedFloors = removeInternalFaces(mergedFloors);
        mergedFloors.dispose();
        for (const geometry of floorGeometries) {
          geometry.dispose();
        }
        const floorMesh = new THREE.Mesh(cleanedFloors, this.uberMaterial);
        floorMesh.name = "floors";
        floorMesh.userData = { walkable: true };
        buildingGroup.add(floorMesh);
      }
    }

    // Create walls mesh (non-walkable - excluded from click raycast)
    if (wallGeometries.length > 0) {
      const mergedWalls = mergeGeometries(wallGeometries, false);
      if (mergedWalls) {
        const cleanedWalls = removeInternalFaces(mergedWalls);
        mergedWalls.dispose();
        for (const geometry of wallGeometries) {
          geometry.dispose();
        }
        const wallMesh = new THREE.Mesh(cleanedWalls, this.uberMaterial);
        wallMesh.name = "walls";
        wallMesh.userData = { walkable: false };
        buildingGroup.add(wallMesh);
      }
    }

    // Create roof mesh (separate so it can be hidden independently)
    if (roofGeometries.length > 0) {
      const mergedRoof = mergeGeometries(roofGeometries, false);
      if (mergedRoof) {
        const cleanedRoof = removeInternalFaces(mergedRoof);
        mergedRoof.dispose();
        for (const geometry of roofGeometries) {
          geometry.dispose();
        }
        const roofMesh = new THREE.Mesh(cleanedRoof, this.uberMaterial);
        roofMesh.name = "roof";
        roofMesh.userData = { walkable: false };
        buildingGroup.add(roofMesh);
      }
    }

    return { building: buildingGroup, stats };
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    this.uberMaterial.dispose();
    geometryCache.clear();
  }

  /**
   * Get optimization statistics
   */
  static getOptimizationStats(): {
    geometryCacheCount: number;
    cacheKeys: string[];
  } {
    const cacheStats = geometryCache.getStats();
    return {
      geometryCacheCount: cacheStats.count,
      cacheKeys: cacheStats.keys,
    };
  }

  /**
   * Clear all cached geometries (call periodically to free memory)
   */
  static clearCache(): void {
    geometryCache.clear();
  }

  // ============================================================
  // PRIVATE HELPER METHODS
  // ============================================================

  private cellId(col: number, row: number, width: number): number {
    return row * width + col;
  }

  private edgeKey(a: number, b: number): string {
    return a < b ? `${a}:${b}` : `${b}:${a}`;
  }

  private resolveFloorCount(recipe: BuildingRecipe, rng: RNG): number {
    if (recipe.floorsRange) {
      const minFloors = Math.max(1, recipe.floorsRange[0]);
      const maxFloors = Math.max(minFloors, recipe.floorsRange[1]);
      return rng.int(minFloors, maxFloors);
    }
    return Math.max(1, recipe.floors || 1);
  }

  private countFootprintCells(grid: boolean[][]): number {
    let count = 0;
    for (let row = 0; row < grid.length; row += 1) {
      for (let col = 0; col < grid[row].length; col += 1) {
        if (grid[row][col]) count += 1;
      }
    }
    return count;
  }

  private createFootprintGrid(
    width: number,
    depth: number,
    fill: boolean,
  ): boolean[][] {
    const grid: boolean[][] = [];
    for (let row = 0; row < depth; row += 1) {
      const line: boolean[] = [];
      for (let col = 0; col < width; col += 1) {
        line.push(Boolean(fill));
      }
      grid.push(line);
    }
    return grid;
  }

  private isCellOccupied(grid: boolean[][], col: number, row: number): boolean {
    if (row < 0 || row >= grid.length) return false;
    if (col < 0 || col >= grid[row].length) return false;
    return Boolean(grid[row][col]);
  }

  private getExternalSideCount(
    grid: boolean[][],
    col: number,
    row: number,
  ): number {
    let count = 0;
    if (!this.isCellOccupied(grid, col, row)) return 0;
    if (!this.isCellOccupied(grid, col - 1, row)) count += 1;
    if (!this.isCellOccupied(grid, col + 1, row)) count += 1;
    if (!this.isCellOccupied(grid, col, row - 1)) count += 1;
    if (!this.isCellOccupied(grid, col, row + 1)) count += 1;
    return count;
  }

  private generateBaseFootprint(
    recipe: BuildingRecipe,
    rng: RNG,
  ): BaseFootprint {
    const mainWidth = rng.int(recipe.widthRange[0], recipe.widthRange[1]);
    const mainDepth = rng.int(recipe.depthRange[0], recipe.depthRange[1]);
    const frontSide = recipe.frontSide || "south";
    let width = mainWidth;
    let depth = mainDepth;
    let cells: boolean[][] = [];
    const foyerCells = new Set<number>();

    if (
      recipe.footprintStyle === "foyer" &&
      recipe.foyerDepthRange &&
      recipe.foyerWidthRange
    ) {
      // Foyer style: main building with extension at front
      const foyerWidth = rng.int(
        recipe.foyerWidthRange[0],
        recipe.foyerWidthRange[1],
      );
      const foyerDepth = rng.int(
        recipe.foyerDepthRange[0],
        recipe.foyerDepthRange[1],
      );
      depth = mainDepth + foyerDepth;
      cells = this.createFootprintGrid(width, depth, false);

      for (let row = 0; row < mainDepth; row += 1) {
        for (let col = 0; col < width; col += 1) {
          cells[row][col] = true;
        }
      }

      const foyerStart = Math.floor((width - foyerWidth) / 2);
      for (let row = mainDepth; row < depth; row += 1) {
        for (let col = foyerStart; col < foyerStart + foyerWidth; col += 1) {
          cells[row][col] = true;
          foyerCells.add(this.cellId(col, row, width));
        }
      }
    } else if (
      recipe.footprintStyle === "courtyard" &&
      recipe.courtyardSizeRange
    ) {
      // Courtyard style: hollow rectangle with open-air center (keeps, fortresses)
      const courtyardSize = rng.int(
        recipe.courtyardSizeRange[0],
        recipe.courtyardSizeRange[1],
      );

      // Ensure building is large enough for courtyard (need at least 1 cell walls around)
      const minSize = courtyardSize + 2;
      width = Math.max(mainWidth, minSize);
      depth = Math.max(mainDepth, minSize);

      cells = this.createFootprintGrid(width, depth, true);

      // Carve out the center courtyard
      const courtyardStartCol = Math.floor((width - courtyardSize) / 2);
      const courtyardStartRow = Math.floor((depth - courtyardSize) / 2);

      for (
        let row = courtyardStartRow;
        row < courtyardStartRow + courtyardSize;
        row += 1
      ) {
        for (
          let col = courtyardStartCol;
          col < courtyardStartCol + courtyardSize;
          col += 1
        ) {
          if (cells[row]) {
            cells[row][col] = false; // Remove center cells for courtyard
          }
        }
      }
    } else if (
      recipe.footprintStyle === "gallery" &&
      recipe.galleryWidthRange
    ) {
      // Gallery style: large main hall with gallery/walkway on upper floor
      // Ground floor is fully filled, upper floor will have gallery around edges
      cells = this.createFootprintGrid(width, depth, true);

      // Mark center cells as "gallery open" for upper floor handling
      // The actual gallery is created in upper floor generation
      // Ground floor is solid for the main hall
    } else {
      // Default: filled rectangle with optional corner carving
      cells = this.createFootprintGrid(width, depth, true);
      if (
        recipe.carveChance &&
        recipe.carveSizeRange &&
        rng.chance(recipe.carveChance)
      ) {
        this.carveFootprintCorner(
          cells,
          width,
          depth,
          rng,
          recipe.carveSizeRange,
          0.6,
        );
      }
    }

    return { width, depth, cells, mainDepth, foyerCells, frontSide };
  }

  private carveFootprintCorner(
    grid: boolean[][],
    width: number,
    depth: number,
    rng: RNG,
    carveRange: [number, number],
    minFill: number,
  ): void {
    const minCarve = Math.min(carveRange[0], width - 1, depth - 1);
    const maxCarve = Math.min(carveRange[1], width - 1, depth - 1);
    if (minCarve <= 0 || maxCarve <= 0) return;
    const carveWidth = rng.int(minCarve, maxCarve);
    const carveDepth = rng.int(minCarve, maxCarve);
    const corners = [
      { col: 0, row: 0 },
      { col: width - carveWidth, row: 0 },
      { col: 0, row: depth - carveDepth },
      { col: width - carveWidth, row: depth - carveDepth },
    ];
    const corner = rng.pick(corners)!;
    const totalBefore = this.countFootprintCells(grid);
    let removed = 0;
    for (let row = corner.row; row < corner.row + carveDepth; row += 1) {
      for (let col = corner.col; col < corner.col + carveWidth; col += 1) {
        if (grid[row][col]) removed += 1;
      }
    }
    const totalAfter = totalBefore - removed;
    if (totalAfter < totalBefore * minFill) return;
    for (let row = corner.row; row < corner.row + carveDepth; row += 1) {
      for (let col = corner.col; col < corner.col + carveWidth; col += 1) {
        grid[row][col] = false;
      }
    }
  }

  private generateUpperFootprint(
    base: BaseFootprint,
    recipe: BuildingRecipe,
    rng: RNG,
    _protectedCells: Cell[],
    _isTopFloor: boolean,
  ): boolean[][] | null {
    const minCells = recipe.minUpperFloorCells || 2;
    const minShrink = recipe.minUpperFloorShrinkCells || 1;
    const baseCellCount = this.countFootprintCells(base.cells);
    if (baseCellCount < minCells + minShrink) return null;

    const upper = base.cells.map((row) => row.slice());
    let shrunk = 0;

    // Gallery style: create walkway around edges, open center overlooking main hall
    if (recipe.footprintStyle === "gallery" && recipe.galleryWidthRange) {
      const galleryWidth = rng.int(
        recipe.galleryWidthRange[0],
        recipe.galleryWidthRange[1],
      );

      // Remove interior cells to create gallery walkway around the edge
      for (let row = 0; row < upper.length; row += 1) {
        for (let col = 0; col < upper[row].length; col += 1) {
          if (!upper[row][col]) continue;

          // Check if this cell is in the interior (not on gallery edge)
          const distFromNorth = row;
          const distFromSouth = upper.length - 1 - row;
          const distFromWest = col;
          const distFromEast = upper[row].length - 1 - col;
          const minDistFromEdge = Math.min(
            distFromNorth,
            distFromSouth,
            distFromWest,
            distFromEast,
          );

          // If cell is further from edge than gallery width, remove it (open to hall below)
          if (minDistFromEdge >= galleryWidth) {
            upper[row][col] = false;
            shrunk += 1;
          }
        }
      }
    } else {
      // Default: shrink from edges
      const insetAmount = recipe.upperInsetRange
        ? rng.int(recipe.upperInsetRange[0], recipe.upperInsetRange[1])
        : 1;

      for (let i = 0; i < insetAmount; i += 1) {
        for (let row = 0; row < upper.length; row += 1) {
          for (let col = 0; col < upper[row].length; col += 1) {
            if (!upper[row][col]) continue;
            const extSides = this.getExternalSideCount(upper, col, row);
            if (extSides >= 2 && rng.chance(0.5)) {
              upper[row][col] = false;
              shrunk += 1;
            }
          }
        }
      }
    }

    // Exclude foyer from upper floor
    if (recipe.excludeFoyerFromUpper) {
      for (const cellId of base.foyerCells) {
        const col = cellId % base.width;
        const row = Math.floor(cellId / base.width);
        if (upper[row]?.[col]) {
          upper[row][col] = false;
          shrunk += 1;
        }
      }
    }

    const upperCount = this.countFootprintCells(upper);
    if (upperCount < minCells) return null;
    if (shrunk < minShrink && recipe.requireUpperShrink) return null;

    return upper;
  }

  private generateRoomsForFootprint(
    footprint: boolean[][],
    _recipe: BuildingRecipe,
    _rng: RNG,
  ): { rooms: Room[]; roomMap: number[][] } {
    const depth = footprint.length;
    const width = footprint[0]?.length || 0;
    const roomMap: number[][] = footprint.map((row) => row.map(() => -1));
    const rooms: Room[] = [];

    // Simple room generation: flood fill connected cells
    let nextRoomId = 0;
    for (let row = 0; row < depth; row += 1) {
      for (let col = 0; col < width; col += 1) {
        if (!footprint[row][col] || roomMap[row][col] !== -1) continue;

        const roomCells: Cell[] = [];
        const queue: Cell[] = [{ col, row }];
        roomMap[row][col] = nextRoomId;

        while (queue.length > 0) {
          const cell = queue.shift()!;
          roomCells.push(cell);

          const neighbors = [
            { col: cell.col - 1, row: cell.row },
            { col: cell.col + 1, row: cell.row },
            { col: cell.col, row: cell.row - 1 },
            { col: cell.col, row: cell.row + 1 },
          ];

          for (const n of neighbors) {
            if (
              n.row >= 0 &&
              n.row < depth &&
              n.col >= 0 &&
              n.col < width &&
              footprint[n.row][n.col] &&
              roomMap[n.row][n.col] === -1
            ) {
              roomMap[n.row][n.col] = nextRoomId;
              queue.push(n);
            }
          }
        }

        if (roomCells.length > 0) {
          const bounds = {
            minCol: Math.min(...roomCells.map((c) => c.col)),
            maxCol: Math.max(...roomCells.map((c) => c.col)),
            minRow: Math.min(...roomCells.map((c) => c.row)),
            maxRow: Math.max(...roomCells.map((c) => c.row)),
          };

          rooms.push({
            id: nextRoomId,
            area: roomCells.length,
            cells: roomCells,
            bounds,
          });
          nextRoomId += 1;
        }
      }
    }

    return { rooms, roomMap };
  }

  private collectRoomAdjacencies(
    footprint: boolean[][],
    roomMap: number[][],
  ): Map<string, Cell[]> {
    const adjacency = new Map<string, Cell[]>();
    const depth = footprint.length;
    const width = footprint[0]?.length || 0;

    for (let row = 0; row < depth; row += 1) {
      for (let col = 0; col < width; col += 1) {
        if (!footprint[row][col]) continue;
        const roomId = roomMap[row][col];

        const neighbors = [
          { col: col + 1, row, side: "east" },
          { col, row: row + 1, side: "south" },
        ];

        for (const n of neighbors) {
          if (
            n.row >= 0 &&
            n.row < depth &&
            n.col >= 0 &&
            n.col < width &&
            footprint[n.row][n.col]
          ) {
            const neighborRoomId = roomMap[n.row][n.col];
            if (neighborRoomId !== roomId) {
              const key = this.edgeKey(roomId, neighborRoomId);
              if (!adjacency.has(key)) {
                adjacency.set(key, []);
              }
              adjacency.get(key)!.push({ col, row });
            }
          }
        }
      }
    }

    return adjacency;
  }

  private selectRoomOpenings(
    roomCount: number,
    adjacency: Map<string, Cell[]>,
    archBias: number,
    extraChance: number,
    rng: RNG,
    _width: number,
  ): Map<string, string> {
    const openings = new Map<string, string>();

    // Build spanning tree of rooms
    const connected = new Set<number>([0]);
    const edges = Array.from(adjacency.keys());

    while (connected.size < roomCount && edges.length > 0) {
      const available = edges.filter((key) => {
        const [a, b] = key.split(":").map(Number);
        return (
          (connected.has(a) && !connected.has(b)) ||
          (connected.has(b) && !connected.has(a))
        );
      });

      if (available.length === 0) break;

      const edge = rng.pick(available)!;
      const [a, b] = edge.split(":").map(Number);
      connected.add(a);
      connected.add(b);

      const cells = adjacency.get(edge)!;
      const cell = rng.pick(cells)!;
      const openingType = rng.chance(archBias) ? "arch" : "door";
      const cellKey = `${cell.col},${cell.row}`;
      openings.set(cellKey, openingType);
    }

    // Add extra connections
    for (const edge of edges) {
      if (rng.chance(extraChance)) {
        const cells = adjacency.get(edge)!;
        const cell = rng.pick(cells)!;
        const cellKey = `${cell.col},${cell.row}`;
        if (!openings.has(cellKey)) {
          const openingType = rng.chance(archBias) ? "arch" : "door";
          openings.set(cellKey, openingType);
        }
      }
    }

    return openings;
  }

  private chooseEntranceRoomId(
    rooms: Room[],
    foyerCells: Set<number>,
    width: number,
  ): number {
    if (foyerCells.size > 0) {
      for (const room of rooms) {
        for (const cell of room.cells) {
          const cellId = this.cellId(cell.col, cell.row, width);
          if (foyerCells.has(cellId)) {
            return room.id;
          }
        }
      }
    }
    return rooms[0]?.id || 0;
  }

  private generateExternalOpenings(
    footprint: boolean[][],
    roomMap: number[][],
    recipe: BuildingRecipe,
    rng: RNG,
    entranceCount: number,
    _entranceRoomId: number,
    frontSide: string,
    windowChance: number,
    width: number,
    stairs: StairPlacement | null,
  ): Map<string, string> {
    const openings = new Map<string, string>();
    const depth = footprint.length;

    // Track doors per room per side to prevent 2 doors on same wall
    // Key: "roomId-side", Value: number of doors placed
    const doorsPerRoomSide = new Map<string, number>();

    // Collect external edges with room info
    const externalEdges: Array<{
      col: number;
      row: number;
      side: string;
      roomId: number;
    }> = [];

    for (let row = 0; row < depth; row += 1) {
      for (let col = 0; col < width; col += 1) {
        if (!footprint[row][col]) continue;

        const roomId = roomMap[row]?.[col] ?? -1;

        const sides = [
          { dc: 0, dr: -1, side: "north" },
          { dc: 0, dr: 1, side: "south" },
          { dc: -1, dr: 0, side: "west" },
          { dc: 1, dr: 0, side: "east" },
        ];

        for (const { dc, dr, side } of sides) {
          const nc = col + dc;
          const nr = row + dr;
          if (!this.isCellOccupied(footprint, nc, nr)) {
            externalEdges.push({ col, row, side, roomId });
          }
        }
      }
    }

    // Place entrances on front side
    const frontEdges = externalEdges.filter((e) => e.side === frontSide);
    const shuffledFrontEdges = rng.shuffle(frontEdges);
    let entrancesPlaced = 0;

    for (const edge of shuffledFrontEdges) {
      if (entrancesPlaced >= entranceCount) break;

      // Check if this room already has a door on this side
      const roomSideKey = `${edge.roomId}-${edge.side}`;
      const existingDoors = doorsPerRoomSide.get(roomSideKey) || 0;

      if (existingDoors >= 1) {
        // This room already has a door on this side - skip
        continue;
      }

      const key = `${edge.col},${edge.row},${edge.side}`;
      const openingType = rng.chance(recipe.entranceArchChance)
        ? "arch"
        : "door";
      openings.set(key, openingType);
      doorsPerRoomSide.set(roomSideKey, existingDoors + 1);
      entrancesPlaced++;
    }

    // Place windows
    for (const edge of externalEdges) {
      const key = `${edge.col},${edge.row},${edge.side}`;
      if (openings.has(key)) continue;

      // Skip if near stairs
      if (stairs && edge.col === stairs.col && edge.row === stairs.row)
        continue;

      if (rng.chance(windowChance)) {
        openings.set(key, "window");
      }
    }

    return openings;
  }

  private applyPatioDoors(
    externalOpenings: Map<string, string>,
    lowerFootprint: boolean[][],
    upperFootprint: boolean[][],
    recipe: BuildingRecipe,
    rng: RNG,
    _width: number,
  ): void {
    // Find all edges where upper floor cell is adjacent to a terrace (lower floor only)
    const patioEdges: Array<{ col: number; row: number; side: string }> = [];
    const depth = upperFootprint.length;
    const width = upperFootprint[0]?.length || 0;

    for (let row = 0; row < depth; row += 1) {
      for (let col = 0; col < width; col += 1) {
        if (!upperFootprint[row]?.[col]) continue;

        const sides = [
          { dc: 0, dr: -1, side: "north" },
          { dc: 0, dr: 1, side: "south" },
          { dc: -1, dr: 0, side: "west" },
          { dc: 1, dr: 0, side: "east" },
        ];

        for (const { dc, dr, side } of sides) {
          const nc = col + dc;
          const nr = row + dr;
          // Terrace: cell exists on lower floor but NOT on upper floor
          if (
            !this.isCellOccupied(upperFootprint, nc, nr) &&
            this.isCellOccupied(lowerFootprint, nc, nr)
          ) {
            patioEdges.push({ col, row, side });
          }
        }
      }
    }

    // If there are terrace edges, ALWAYS add at least one door to access the terrace
    if (patioEdges.length === 0) return;

    // Determine count: recipe-based (with chance) or guaranteed minimum of 1
    let count = 1;
    if (recipe.patioDoorChance && recipe.patioDoorCountRange) {
      if (rng.chance(recipe.patioDoorChance)) {
        count = rng.int(
          recipe.patioDoorCountRange[0],
          recipe.patioDoorCountRange[1],
        );
      }
    }
    // Always ensure at least 1 door to access the terrace
    count = Math.max(1, count);

    const selected = rng.shuffle(patioEdges).slice(0, count);

    for (const edge of selected) {
      const key = `${edge.col},${edge.row},${edge.side}`;
      externalOpenings.set(key, "door");
    }
  }

  /**
   * Pick a valid stair placement with robust rules:
   *
   * RULES:
   * 1. Stair cell must exist on BOTH floors (it's an opening on upper floor)
   * 2. Landing cell must exist on BOTH floors (flat landing area)
   * 3. Lower floor: both cells must be accessible (have neighbors besides each other)
   * 4. Upper floor landing must lead somewhere useful:
   *    - Has at least one interior neighbor on upper floor (room access), OR
   *    - Is adjacent to a terrace (cell on lower but not upper floor) - gets a door
   * 5. Stairs prefer to be against a wall (stair cell has an external edge)
   * 6. Stairs prefer to point toward building interior (landing has more neighbors)
   */
  private pickStairPlacement(
    lowerFootprint: boolean[][],
    upperFootprint: boolean[][],
    rng: RNG,
  ): StairPlacement | null {
    const candidates: Array<{
      placement: StairPlacement;
      score: number;
    }> = [];
    const depth = lowerFootprint.length;
    const width = lowerFootprint[0]?.length || 0;

    for (let row = 0; row < depth; row += 1) {
      for (let col = 0; col < width; col += 1) {
        // RULE 1: Stair cell must exist on both floors
        if (!lowerFootprint[row][col]) continue;
        if (!upperFootprint[row]?.[col]) continue;

        const directions = [
          { dc: 0, dr: -1, dir: "north" },
          { dc: 0, dr: 1, dir: "south" },
          { dc: -1, dr: 0, dir: "west" },
          { dc: 1, dr: 0, dir: "east" },
        ];

        for (const { dc, dr, dir } of directions) {
          const lc = col + dc;
          const lr = row + dr;

          // RULE 2: Landing cell must exist on both floors
          if (!this.isCellOccupied(lowerFootprint, lc, lr)) continue;
          if (!this.isCellOccupied(upperFootprint, lc, lr)) continue;

          // RULE 3: Lower floor accessibility
          // Both cells need at least one neighbor besides each other on lower floor
          const stairLowerNeighbors = this.countOccupiedNeighbors(
            lowerFootprint,
            col,
            row,
            lc,
            lr,
          );
          const landingLowerNeighbors = this.countOccupiedNeighbors(
            lowerFootprint,
            lc,
            lr,
            col,
            row,
          );
          if (stairLowerNeighbors < 1 || landingLowerNeighbors < 1) continue;

          // RULE 4: Upper floor landing must lead somewhere useful
          // Check if landing has interior neighbors on upper floor (excluding stair cell which is an opening)
          const landingUpperNeighbors = this.countOccupiedNeighbors(
            upperFootprint,
            lc,
            lr,
            col,
            row,
          );

          // Check if landing is adjacent to a terrace (cell on lower but not upper floor)
          const hasTerraceAccess = this.hasAdjacentTerrace(
            lowerFootprint,
            upperFootprint,
            lc,
            lr,
            col,
            row,
          );

          // Landing must have EITHER interior access OR terrace access on upper floor
          if (landingUpperNeighbors < 1 && !hasTerraceAccess) continue;

          // Calculate placement score for prioritization
          let score = 0;

          // RULE 5: Prefer stairs against a wall (external edge on stair cell)
          const stairExternalEdges = this.countExternalEdges(
            lowerFootprint,
            col,
            row,
          );
          if (stairExternalEdges >= 1) score += 10; // Strong preference for wall-backed stairs

          // RULE 6: Prefer landing that opens into building interior
          score += landingUpperNeighbors * 3; // More interior connections = better
          score += landingLowerNeighbors * 2;

          // Bonus for terrace access (stairs leading to terrace door is valid)
          if (hasTerraceAccess) score += 5;

          // Slight penalty for corner positions (less natural)
          if (stairExternalEdges >= 2) score -= 2;

          // RULE 7: Avoid prime bar/counter positions
          // Bars prefer long walls, entrance-facing positions, and non-corner cells
          // Stairs should avoid these to leave good bar spots available
          const wallLength = this.measureExternalWallLength(
            lowerFootprint,
            col,
            row,
          );
          if (wallLength >= 3) {
            // This cell is on a long wall - good for bar, avoid for stairs
            score -= 8;
          }

          // Check if this cell faces an entrance (exterior door)
          // Bars like to face entrances, stairs should not be there
          const landingExternalEdges = this.countExternalEdges(
            lowerFootprint,
            lc,
            lr,
          );
          if (landingExternalEdges >= 1 && landingLowerNeighbors >= 2) {
            // Landing is near external edge with good interior access - prime bar territory
            score -= 5;
          }

          // Cells with high interior connectivity are good for bars
          // Prefer stairs in more secluded positions
          const stairInteriorNeighbors = 4 - stairExternalEdges;
          if (stairInteriorNeighbors >= 3) {
            // Too central - might be prime bar spot
            score -= 3;
          }

          // RULE 8: Avoid doorway positions (doors are typically on south/front side)
          // Check if stair or landing cell is likely to have a door (south-facing external edge)
          const stairHasSouthExternal = !this.isCellOccupied(
            lowerFootprint,
            col,
            row + 1,
          );
          const landingHasSouthExternal = !this.isCellOccupied(
            lowerFootprint,
            lc,
            lr + 1,
          );

          // Heavy penalty for stairs/landing directly on south edge (likely door position)
          if (stairHasSouthExternal) score -= 20;
          if (landingHasSouthExternal) score -= 20;

          // Also check for external edges on other sides that could have doors
          // (entrances can be on any external edge, but south is most common)
          const stairHasNorthExternal = !this.isCellOccupied(
            lowerFootprint,
            col,
            row - 1,
          );
          const stairHasEastExternal = !this.isCellOccupied(
            lowerFootprint,
            col + 1,
            row,
          );
          const stairHasWestExternal = !this.isCellOccupied(
            lowerFootprint,
            col - 1,
            row,
          );

          // Moderate penalty for external edges on other sides
          if (stairHasNorthExternal) score -= 5;
          if (stairHasEastExternal) score -= 5;
          if (stairHasWestExternal) score -= 5;

          // RULE 9: Avoid being 1 tile away from likely door positions
          // Check cells adjacent to stair cell for external edges (potential door neighbors)
          let nearDoorPenalty = 0;
          const stairNeighbors = [
            { c: col - 1, r: row },
            { c: col + 1, r: row },
            { c: col, r: row - 1 },
            { c: col, r: row + 1 },
          ];

          for (const neighbor of stairNeighbors) {
            if (neighbor.c === lc && neighbor.r === lr) continue; // Skip landing
            if (!this.isCellOccupied(lowerFootprint, neighbor.c, neighbor.r))
              continue;

            // Check if this neighbor has a south-facing external edge (likely door)
            if (
              !this.isCellOccupied(lowerFootprint, neighbor.c, neighbor.r + 1)
            ) {
              nearDoorPenalty += 8; // Penalty for being adjacent to likely door cell
            }
            // Check other external edges too
            if (
              !this.isCellOccupied(lowerFootprint, neighbor.c, neighbor.r - 1)
            ) {
              nearDoorPenalty += 3;
            }
            if (
              !this.isCellOccupied(lowerFootprint, neighbor.c + 1, neighbor.r)
            ) {
              nearDoorPenalty += 3;
            }
            if (
              !this.isCellOccupied(lowerFootprint, neighbor.c - 1, neighbor.r)
            ) {
              nearDoorPenalty += 3;
            }
          }
          score -= nearDoorPenalty;

          candidates.push({
            placement: {
              col,
              row,
              direction: dir,
              landing: { col: lc, row: lr },
            },
            score,
          });
        }
      }
    }

    if (candidates.length === 0) return null;

    // Sort by score (highest first)
    candidates.sort((a, b) => b.score - a.score);

    // Pick randomly from top-scoring candidates (within 2 points of best)
    const topScore = candidates[0].score;
    const topCandidates = candidates.filter((c) => c.score >= topScore - 2);

    // topCandidates always has at least one element since candidates[0] passes the filter
    return rng.pick(topCandidates)!.placement;
  }

  /**
   * Check if a cell is adjacent to a terrace (cell exists on lower floor but not upper)
   */
  private hasAdjacentTerrace(
    lowerFootprint: boolean[][],
    upperFootprint: boolean[][],
    col: number,
    row: number,
    excludeCol: number,
    excludeRow: number,
  ): boolean {
    const neighbors = [
      { dc: -1, dr: 0 },
      { dc: 1, dr: 0 },
      { dc: 0, dr: -1 },
      { dc: 0, dr: 1 },
    ];
    for (const { dc, dr } of neighbors) {
      const nc = col + dc;
      const nr = row + dr;
      if (nc === excludeCol && nr === excludeRow) continue;
      // Terrace: exists on lower floor but NOT on upper floor
      if (
        this.isCellOccupied(lowerFootprint, nc, nr) &&
        !this.isCellOccupied(upperFootprint, nc, nr)
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Count external edges of a cell (sides without neighbors)
   */
  private countExternalEdges(
    grid: boolean[][],
    col: number,
    row: number,
  ): number {
    let count = 0;
    const neighbors = [
      { dc: -1, dr: 0 },
      { dc: 1, dr: 0 },
      { dc: 0, dr: -1 },
      { dc: 0, dr: 1 },
    ];
    for (const { dc, dr } of neighbors) {
      if (!this.isCellOccupied(grid, col + dc, row + dr)) {
        count += 1;
      }
    }
    return count;
  }

  /**
   * Measure the longest external wall segment this cell is part of.
   * Used to identify prime bar/counter positions (bars prefer long walls).
   */
  private measureExternalWallLength(
    grid: boolean[][],
    col: number,
    row: number,
  ): number {
    let maxLength = 0;

    // Check each side for external wall
    const sides = [
      { dc: 0, dr: -1, perpDc: 1, perpDr: 0 }, // north wall
      { dc: 0, dr: 1, perpDc: 1, perpDr: 0 }, // south wall
      { dc: 1, dr: 0, perpDc: 0, perpDr: 1 }, // east wall
      { dc: -1, dr: 0, perpDc: 0, perpDr: 1 }, // west wall
    ];

    for (const { dc, dr, perpDc, perpDr } of sides) {
      // Check if this side has an external wall
      if (this.isCellOccupied(grid, col + dc, row + dr)) continue;

      // Count wall length in both perpendicular directions
      let length = 1;

      // Count positive direction
      let checkCol = col + perpDc;
      let checkRow = row + perpDr;
      while (
        this.isCellOccupied(grid, checkCol, checkRow) &&
        !this.isCellOccupied(grid, checkCol + dc, checkRow + dr)
      ) {
        length += 1;
        checkCol += perpDc;
        checkRow += perpDr;
      }

      // Count negative direction
      checkCol = col - perpDc;
      checkRow = row - perpDr;
      while (
        this.isCellOccupied(grid, checkCol, checkRow) &&
        !this.isCellOccupied(grid, checkCol + dc, checkRow + dr)
      ) {
        length += 1;
        checkCol -= perpDc;
        checkRow -= perpDr;
      }

      maxLength = Math.max(maxLength, length);
    }

    return maxLength;
  }

  /**
   * Count occupied neighbors of a cell, excluding a specific cell
   */
  private countOccupiedNeighbors(
    grid: boolean[][],
    col: number,
    row: number,
    excludeCol: number,
    excludeRow: number,
  ): number {
    let count = 0;
    const neighbors = [
      { dc: -1, dr: 0 },
      { dc: 1, dr: 0 },
      { dc: 0, dr: -1 },
      { dc: 0, dr: 1 },
    ];
    for (const { dc, dr } of neighbors) {
      const nc = col + dc;
      const nr = row + dr;
      if (nc === excludeCol && nr === excludeRow) continue;
      if (this.isCellOccupied(grid, nc, nr)) count += 1;
    }
    return count;
  }

  private ensureStairExit(
    plan: FloorPlan,
    stairCell: Cell,
    landingCell: Cell,
    width: number,
  ): void {
    const stairId = this.cellId(stairCell.col, stairCell.row, width);
    const landingId = this.cellId(landingCell.col, landingCell.row, width);
    const key = this.edgeKey(stairId, landingId);
    if (!plan.internalOpenings.has(key)) {
      plan.internalOpenings.set(key, "arch");
    }
  }

  // ============================================================
  // GEOMETRY BUILDING METHODS
  // ============================================================

  /**
   * Add foundation that elevates the building off the ground
   * This makes buildings more robust on uneven terrain
   *
   * The foundation has two parts:
   * 1. Above-ground foundation (FOUNDATION_HEIGHT) - visible stone base
   * 2. Below-ground terrain base (TERRAIN_DEPTH) - extends into terrain for uneven ground
   */
  private addFoundation(
    geometries: THREE.BufferGeometry[],
    layout: BuildingLayout,
  ): void {
    const plan = layout.floorPlans[0];

    for (let row = 0; row < plan.footprint.length; row += 1) {
      for (let col = 0; col < plan.footprint[row].length; col += 1) {
        if (!plan.footprint[row][col]) continue;

        const { x, z } = getCellCenter(
          col,
          row,
          CELL_SIZE,
          layout.width,
          layout.depth,
        );

        // Check which sides have external walls (for overhang)
        const hasNorth = !this.isCellOccupied(plan.footprint, col, row - 1);
        const hasSouth = !this.isCellOccupied(plan.footprint, col, row + 1);
        const hasEast = !this.isCellOccupied(plan.footprint, col + 1, row);
        const hasWest = !this.isCellOccupied(plan.footprint, col - 1, row);

        // Foundation extends slightly past walls with overhang at external edges
        let sizeX = CELL_SIZE;
        let sizeZ = CELL_SIZE;
        let offsetX = 0;
        let offsetZ = 0;

        if (hasWest) {
          sizeX += FOUNDATION_OVERHANG;
          offsetX -= FOUNDATION_OVERHANG / 2;
        }
        if (hasEast) {
          sizeX += FOUNDATION_OVERHANG;
          offsetX += FOUNDATION_OVERHANG / 2;
        }
        if (hasNorth) {
          sizeZ += FOUNDATION_OVERHANG;
          offsetZ -= FOUNDATION_OVERHANG / 2;
        }
        if (hasSouth) {
          sizeZ += FOUNDATION_OVERHANG;
          offsetZ += FOUNDATION_OVERHANG / 2;
        }

        // Above-ground foundation (visible stone base)
        const foundationGeo = new THREE.BoxGeometry(
          sizeX,
          FOUNDATION_HEIGHT,
          sizeZ,
        );
        foundationGeo.translate(
          x + offsetX,
          FOUNDATION_HEIGHT / 2,
          z + offsetZ,
        );
        applyVertexColors(foundationGeo, palette.foundation);
        geometries.push(foundationGeo);

        // Below-ground terrain base (extends into terrain for uneven ground)
        // This ensures the building has a solid base even on slopes
        const terrainBaseGeo = new THREE.BoxGeometry(
          sizeX,
          TERRAIN_DEPTH,
          sizeZ,
        );
        terrainBaseGeo.translate(x + offsetX, -TERRAIN_DEPTH / 2, z + offsetZ);
        applyVertexColors(terrainBaseGeo, palette.foundation);
        geometries.push(terrainBaseGeo);
      }
    }
  }

  /**
   * Add foundation using greedy meshing optimization.
   * Interior tiles are merged, edge tiles handled individually for overhangs.
   */
  private addFoundationOptimized(
    geometries: THREE.BufferGeometry[],
    layout: BuildingLayout,
  ): void {
    const plan = layout.floorPlans[0];
    const rows = plan.footprint.length;
    const cols = plan.footprint[0]?.length ?? 0;

    // Separate interior vs edge cells
    const interiorGrid: boolean[][] = Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => false),
    );
    const edgeCells: Array<{ col: number; row: number }> = [];

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        if (!plan.footprint[row][col]) continue;

        const hasNorth = !this.isCellOccupied(plan.footprint, col, row - 1);
        const hasSouth = !this.isCellOccupied(plan.footprint, col, row + 1);
        const hasEast = !this.isCellOccupied(plan.footprint, col + 1, row);
        const hasWest = !this.isCellOccupied(plan.footprint, col - 1, row);

        if (hasNorth || hasSouth || hasEast || hasWest) {
          edgeCells.push({ col, row });
        } else {
          interiorGrid[row][col] = true;
        }
      }
    }

    // Greedy mesh interior foundation tiles
    const rects = greedyMesh2D(interiorGrid);

    for (const rect of rects) {
      // Above-ground foundation
      const foundationGeo = createMergedFloorGeometry(
        rect,
        CELL_SIZE,
        FOUNDATION_HEIGHT,
        FOUNDATION_HEIGHT / 2,
        layout.width,
        layout.depth,
        0,
      );
      applyVertexColors(foundationGeo, palette.foundation);
      geometries.push(foundationGeo);

      // Below-ground terrain base
      const terrainGeo = createMergedFloorGeometry(
        rect,
        CELL_SIZE,
        TERRAIN_DEPTH,
        -TERRAIN_DEPTH / 2,
        layout.width,
        layout.depth,
        0,
      );
      applyVertexColors(terrainGeo, palette.foundation);
      geometries.push(terrainGeo);
    }

    // Handle edge cells individually (with overhangs)
    for (const { col, row } of edgeCells) {
      const { x, z } = getCellCenter(
        col,
        row,
        CELL_SIZE,
        layout.width,
        layout.depth,
      );

      const hasNorth = !this.isCellOccupied(plan.footprint, col, row - 1);
      const hasSouth = !this.isCellOccupied(plan.footprint, col, row + 1);
      const hasEast = !this.isCellOccupied(plan.footprint, col + 1, row);
      const hasWest = !this.isCellOccupied(plan.footprint, col - 1, row);

      let sizeX = CELL_SIZE;
      let sizeZ = CELL_SIZE;
      let offsetX = 0;
      let offsetZ = 0;

      if (hasWest) {
        sizeX += FOUNDATION_OVERHANG;
        offsetX -= FOUNDATION_OVERHANG / 2;
      }
      if (hasEast) {
        sizeX += FOUNDATION_OVERHANG;
        offsetX += FOUNDATION_OVERHANG / 2;
      }
      if (hasNorth) {
        sizeZ += FOUNDATION_OVERHANG;
        offsetZ -= FOUNDATION_OVERHANG / 2;
      }
      if (hasSouth) {
        sizeZ += FOUNDATION_OVERHANG;
        offsetZ += FOUNDATION_OVERHANG / 2;
      }

      const foundationGeo = getCachedBox(sizeX, FOUNDATION_HEIGHT, sizeZ);
      foundationGeo.translate(x + offsetX, FOUNDATION_HEIGHT / 2, z + offsetZ);
      applyVertexColors(foundationGeo, palette.foundation);
      geometries.push(foundationGeo);

      const terrainGeo = getCachedBox(sizeX, TERRAIN_DEPTH, sizeZ);
      terrainGeo.translate(x + offsetX, -TERRAIN_DEPTH / 2, z + offsetZ);
      applyVertexColors(terrainGeo, palette.foundation);
      geometries.push(terrainGeo);
    }
  }

  /**
   * Add entrance steps at doors on the ground floor
   *
   * Steps are added in two parts:
   * 1. Upper steps: Go UP from ground level to foundation height
   * 2. Terrain steps: Go DOWN from ground level into terrain (for uneven ground)
   *
   * This ensures entrances are walkable even when terrain is sloped or uneven.
   */
  private addEntranceSteps(
    geometries: THREE.BufferGeometry[],
    layout: BuildingLayout,
  ): void {
    const plan = layout.floorPlans[0];
    const halfCell = CELL_SIZE / 2;

    // Find all ground floor doors
    for (const [key, opening] of plan.externalOpenings) {
      // Only add steps for doors (not windows or arches)
      if (opening !== "door") continue;

      const [colStr, rowStr, side] = key.split(",");
      const col = parseInt(colStr, 10);
      const row = parseInt(rowStr, 10);

      const { x, z } = getCellCenter(
        col,
        row,
        CELL_SIZE,
        layout.width,
        layout.depth,
      );
      const sideVec = getSideVector(side);

      // Position steps outside the building
      const stepWidth = DOOR_WIDTH + 0.2; // Slightly wider than door
      const isVertical = sideVec.x !== 0;

      // PART 1: Upper steps - go UP from ground level to foundation
      // These steps start at ground level (Y=0) and go up to FOUNDATION_HEIGHT
      for (let i = 0; i < ENTRANCE_STEP_COUNT; i += 1) {
        // Step Y position: starts at top (near foundation) and goes down
        const stepY = ENTRANCE_STEP_HEIGHT * (ENTRANCE_STEP_COUNT - i - 1);
        const stepDistance =
          halfCell + FOUNDATION_OVERHANG + ENTRANCE_STEP_DEPTH * (i + 0.5);

        const stepX = x + sideVec.x * stepDistance;
        const stepZ = z + sideVec.z * stepDistance;

        // Use cached geometry for entrance steps
        const geometry = getCachedBox(
          isVertical ? ENTRANCE_STEP_DEPTH : stepWidth,
          ENTRANCE_STEP_HEIGHT,
          isVertical ? stepWidth : ENTRANCE_STEP_DEPTH,
        );
        geometry.translate(stepX, stepY + ENTRANCE_STEP_HEIGHT / 2, stepZ);
        applyVertexColors(geometry, palette.foundation);
        geometries.push(geometry);
      }

      // PART 2: Terrain steps - go DOWN from ground level into terrain
      // These steps allow walking up from uneven/lower terrain
      // Each step is the same height but positioned lower, like a staircase going down
      const upperStepsEndDistance =
        halfCell +
        FOUNDATION_OVERHANG +
        ENTRANCE_STEP_DEPTH * ENTRANCE_STEP_COUNT;

      for (let i = 0; i < TERRAIN_STEP_COUNT; i += 1) {
        // Step top Y position: starts at ground level (Y=0) and goes down
        const stepTopY = -ENTRANCE_STEP_HEIGHT * i;
        const stepDistance =
          upperStepsEndDistance + ENTRANCE_STEP_DEPTH * (i + 0.5);

        const stepX = x + sideVec.x * stepDistance;
        const stepZ = z + sideVec.z * stepDistance;

        // Each step extends from its top down to the terrain base (TERRAIN_DEPTH)
        // This creates solid steps that fill the gap to the terrain below
        const stepHeight = stepTopY + TERRAIN_DEPTH; // From step top down to -TERRAIN_DEPTH

        // Use cached geometry for terrain steps
        const geometry = getCachedBox(
          isVertical ? ENTRANCE_STEP_DEPTH : stepWidth,
          stepHeight,
          isVertical ? stepWidth : ENTRANCE_STEP_DEPTH,
        );
        // Position so top of step is at stepTopY (center = top - height/2)
        const stepCenterY = stepTopY - stepHeight / 2;
        geometry.translate(stepX, stepCenterY, stepZ);
        applyVertexColors(geometry, palette.foundation);
        geometries.push(geometry);
      }
    }
  }

  /**
   * Add invisible walkable ramps at entrance doors.
   * These replace the visual box steps for actual walking collision.
   * The ramp is a thin angled plane that the character walks up smoothly.
   */
  private addEntranceRamps(
    geometries: THREE.BufferGeometry[],
    layout: BuildingLayout,
  ): void {
    const plan = layout.floorPlans[0];
    const halfCell = CELL_SIZE / 2;

    // Find all ground floor doors
    for (const [key, opening] of plan.externalOpenings) {
      if (opening !== "door") continue;

      const [colStr, rowStr, side] = key.split(",");
      const col = parseInt(colStr, 10);
      const row = parseInt(rowStr, 10);

      const { x, z } = getCellCenter(
        col,
        row,
        CELL_SIZE,
        layout.width,
        layout.depth,
      );
      const sideVec = getSideVector(side);

      // Ramp parameters
      const rampWidth = DOOR_WIDTH + 0.4; // Wider than door for easy walking
      const isVertical = sideVec.x !== 0;

      // Calculate ramp extent
      // Starts at the door threshold (inside edge of foundation)
      // Ends at the bottom of the terrain steps
      const rampStartDist = halfCell + FOUNDATION_OVERHANG * 0.5; // Inside foundation edge
      const rampEndDist =
        halfCell +
        FOUNDATION_OVERHANG +
        ENTRANCE_STEP_DEPTH * ENTRANCE_STEP_COUNT +
        ENTRANCE_STEP_DEPTH * TERRAIN_STEP_COUNT;

      const rampLength = rampEndDist - rampStartDist;

      // Start Y = foundation height (top of ramp, at door)
      // End Y = terrain level at bottom of terrain steps
      const startY = FOUNDATION_HEIGHT;
      const endY = -ENTRANCE_STEP_HEIGHT * (TERRAIN_STEP_COUNT - 1);

      // Create a plane geometry for the ramp
      const rampGeo = new THREE.PlaneGeometry(
        isVertical ? rampLength : rampWidth,
        isVertical ? rampWidth : rampLength,
      );

      // Calculate ramp center position
      const rampCenterDist = (rampStartDist + rampEndDist) / 2;
      const rampCenterX = x + sideVec.x * rampCenterDist;
      const rampCenterZ = z + sideVec.z * rampCenterDist;
      const rampCenterY = (startY + endY) / 2;

      // Calculate the angle of inclination
      const heightDiff = startY - endY;
      const angle = Math.atan2(heightDiff, rampLength);

      // Position and rotate the ramp
      // First rotate to be horizontal (default plane is vertical facing +Z)
      rampGeo.rotateX(-Math.PI / 2);

      // Then tilt the ramp based on direction
      if (Math.abs(sideVec.z) > 0.5) {
        // North/South facing ramp - tilt around X axis
        const tiltAngle = sideVec.z > 0 ? angle : -angle;
        rampGeo.rotateX(tiltAngle);
      } else {
        // East/West facing ramp - tilt around Z axis
        const tiltAngle = sideVec.x > 0 ? -angle : angle;
        rampGeo.rotateZ(tiltAngle);
      }

      rampGeo.translate(rampCenterX, rampCenterY, rampCenterZ);

      // Use floor color for the ramp (will be mostly hidden under steps anyway)
      // The ramp is thin and positioned under the visual steps
      applyVertexColors(rampGeo, palette.floor);

      geometries.push(rampGeo);
    }
  }

  private addFloorTiles(
    geometries: THREE.BufferGeometry[],
    layout: BuildingLayout,
    floor: number,
    stats: BuildingStats,
  ): void {
    const plan = layout.floorPlans[floor];
    const y = floor * FLOOR_HEIGHT + FOUNDATION_HEIGHT;
    // Inset floor at external walls to fit inside wall thickness
    const floorInset = WALL_THICKNESS / 2;

    for (let row = 0; row < plan.footprint.length; row += 1) {
      for (let col = 0; col < plan.footprint[row].length; col += 1) {
        if (!plan.footprint[row][col]) continue;

        // Skip stair cell on upper floors (it's an opening to lower floor)
        // Landing cell gets a floor tile since it's a flat landing area
        if (layout.stairs && floor > 0) {
          const isStairCell =
            col === layout.stairs.col && row === layout.stairs.row;
          if (isStairCell) continue;
        }

        const { x, z } = getCellCenter(
          col,
          row,
          CELL_SIZE,
          layout.width,
          layout.depth,
        );

        // Check for external walls (edges without neighbors)
        const hasNorth = !this.isCellOccupied(plan.footprint, col, row - 1);
        const hasSouth = !this.isCellOccupied(plan.footprint, col, row + 1);
        const hasEast = !this.isCellOccupied(plan.footprint, col + 1, row);
        const hasWest = !this.isCellOccupied(plan.footprint, col - 1, row);

        // Start with full cell size
        let xSize = CELL_SIZE;
        let zSize = CELL_SIZE;
        let xOffset = 0;
        let zOffset = 0;

        // Only inset at external walls where wall geometry exists
        if (hasWest) {
          xSize -= floorInset;
          xOffset += floorInset / 2;
        }
        if (hasEast) {
          xSize -= floorInset;
          xOffset -= floorInset / 2;
        }
        if (hasNorth) {
          zSize -= floorInset;
          zOffset += floorInset / 2;
        }
        if (hasSouth) {
          zSize -= floorInset;
          zOffset -= floorInset / 2;
        }

        // Ensure minimum size (should never be needed but safety check)
        xSize = Math.max(xSize, CELL_SIZE * 0.5);
        zSize = Math.max(zSize, CELL_SIZE * 0.5);

        // Create floor tile - top surface is at y
        const geometry = new THREE.BoxGeometry(xSize, FLOOR_THICKNESS, zSize);
        geometry.translate(x + xOffset, y - FLOOR_THICKNESS / 2, z + zOffset);
        applyVertexColors(geometry, palette.floor);
        geometries.push(geometry);
        stats.floorTiles += 1;
      }
    }
  }

  /**
   * Add ceiling tiles between floors
   * Only adds ceiling where BOTH current floor AND floor above exist at this cell
   * This prevents collision with terrace roofs
   */
  private addCeilingTiles(
    geometries: THREE.BufferGeometry[],
    layout: BuildingLayout,
    floor: number,
    _stats: BuildingStats,
  ): void {
    const currentPlan = layout.floorPlans[floor];
    const abovePlan = layout.floorPlans[floor + 1];
    if (!abovePlan) return;

    const y = (floor + 1) * FLOOR_HEIGHT + FOUNDATION_HEIGHT;
    const ceilingInset = WALL_THICKNESS / 2;

    for (let row = 0; row < currentPlan.footprint.length; row += 1) {
      for (let col = 0; col < currentPlan.footprint[row].length; col += 1) {
        // Only add ceiling where BOTH current floor AND floor above exist
        if (!currentPlan.footprint[row][col]) continue;
        if (!this.isCellOccupied(abovePlan.footprint, col, row)) continue;

        // Skip stair cell - it's the opening for stairs from below
        // Landing cell gets ceiling since it's a flat landing area
        if (layout.stairs) {
          const isStairCell =
            col === layout.stairs.col && row === layout.stairs.row;
          if (isStairCell) continue;
        }

        const { x, z } = getCellCenter(
          col,
          row,
          CELL_SIZE,
          layout.width,
          layout.depth,
        );

        // Calculate insets based on external walls
        let xSize = CELL_SIZE;
        let zSize = CELL_SIZE;
        let xOffset = 0;
        let zOffset = 0;

        // Check if this is an edge of either floor
        const upperHasNorth = !this.isCellOccupied(
          abovePlan.footprint,
          col,
          row - 1,
        );
        const upperHasSouth = !this.isCellOccupied(
          abovePlan.footprint,
          col,
          row + 1,
        );
        const upperHasEast = !this.isCellOccupied(
          abovePlan.footprint,
          col + 1,
          row,
        );
        const upperHasWest = !this.isCellOccupied(
          abovePlan.footprint,
          col - 1,
          row,
        );

        const hasNorth = !this.isCellOccupied(
          currentPlan.footprint,
          col,
          row - 1,
        );
        const hasSouth = !this.isCellOccupied(
          currentPlan.footprint,
          col,
          row + 1,
        );
        const hasEast = !this.isCellOccupied(
          currentPlan.footprint,
          col + 1,
          row,
        );
        const hasWest = !this.isCellOccupied(
          currentPlan.footprint,
          col - 1,
          row,
        );

        // Inset ceiling to fit within walls (use the more restrictive of the two floors)
        if (hasWest || upperHasWest) {
          xSize -= ceilingInset;
          xOffset += ceilingInset / 2;
        }
        if (hasEast || upperHasEast) {
          xSize -= ceilingInset;
          xOffset -= ceilingInset / 2;
        }
        if (hasNorth || upperHasNorth) {
          zSize -= ceilingInset;
          zOffset += ceilingInset / 2;
        }
        if (hasSouth || upperHasSouth) {
          zSize -= ceilingInset;
          zOffset -= ceilingInset / 2;
        }

        const geometry = new THREE.BoxGeometry(xSize, FLOOR_THICKNESS, zSize);
        geometry.translate(x + xOffset, y - FLOOR_THICKNESS / 2, z + zOffset);
        applyVertexColors(geometry, palette.floor);
        geometries.push(geometry);
      }
    }
  }

  /**
   * Add floor tiles using greedy meshing optimization.
   * Groups interior tiles into larger quads to reduce triangle count.
   * Edge tiles are still handled individually for proper insets.
   */
  private addFloorTilesOptimized(
    geometries: THREE.BufferGeometry[],
    layout: BuildingLayout,
    floor: number,
    stats: BuildingStats,
  ): void {
    const plan = layout.floorPlans[floor];
    const y = floor * FLOOR_HEIGHT + FOUNDATION_HEIGHT;
    const floorInset = WALL_THICKNESS / 2;

    // Build grid of interior cells (no external walls on any side)
    const rows = plan.footprint.length;
    const cols = plan.footprint[0]?.length ?? 0;
    const interiorGrid: boolean[][] = Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => false),
    );
    const edgeCells: Array<{ col: number; row: number }> = [];

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        if (!plan.footprint[row][col]) continue;

        // Skip stair cell on upper floors
        if (layout.stairs && floor > 0) {
          if (col === layout.stairs.col && row === layout.stairs.row) continue;
        }

        // Check for external walls
        const hasNorth = !this.isCellOccupied(plan.footprint, col, row - 1);
        const hasSouth = !this.isCellOccupied(plan.footprint, col, row + 1);
        const hasEast = !this.isCellOccupied(plan.footprint, col + 1, row);
        const hasWest = !this.isCellOccupied(plan.footprint, col - 1, row);

        if (hasNorth || hasSouth || hasEast || hasWest) {
          // Edge cell - needs individual handling for insets
          edgeCells.push({ col, row });
        } else {
          // Interior cell - can be merged
          interiorGrid[row][col] = true;
        }
      }
    }

    // Greedy mesh interior cells
    const rects = greedyMesh2D(interiorGrid);

    for (const rect of rects) {
      const geometry = createMergedFloorGeometry(
        rect,
        CELL_SIZE,
        FLOOR_THICKNESS,
        y - FLOOR_THICKNESS / 2,
        layout.width,
        layout.depth,
        0, // No inset for interior tiles
      );
      applyVertexColors(geometry, palette.floor);
      geometries.push(geometry);
      stats.floorTiles += rect.width * rect.height;
    }

    // Handle edge cells individually (with insets)
    for (const { col, row } of edgeCells) {
      const { x, z } = getCellCenter(
        col,
        row,
        CELL_SIZE,
        layout.width,
        layout.depth,
      );

      const hasNorth = !this.isCellOccupied(plan.footprint, col, row - 1);
      const hasSouth = !this.isCellOccupied(plan.footprint, col, row + 1);
      const hasEast = !this.isCellOccupied(plan.footprint, col + 1, row);
      const hasWest = !this.isCellOccupied(plan.footprint, col - 1, row);

      let xSize = CELL_SIZE;
      let zSize = CELL_SIZE;
      let xOffset = 0;
      let zOffset = 0;

      if (hasWest) {
        xSize -= floorInset;
        xOffset += floorInset / 2;
      }
      if (hasEast) {
        xSize -= floorInset;
        xOffset -= floorInset / 2;
      }
      if (hasNorth) {
        zSize -= floorInset;
        zOffset += floorInset / 2;
      }
      if (hasSouth) {
        zSize -= floorInset;
        zOffset -= floorInset / 2;
      }

      const geometry = getCachedBox(xSize, FLOOR_THICKNESS, zSize);
      geometry.translate(x + xOffset, y - FLOOR_THICKNESS / 2, z + zOffset);
      applyVertexColors(geometry, palette.floor);
      geometries.push(geometry);
      stats.floorTiles += 1;
    }
  }

  /**
   * Add ceiling tiles using greedy meshing optimization.
   */
  private addCeilingTilesOptimized(
    geometries: THREE.BufferGeometry[],
    layout: BuildingLayout,
    floor: number,
    _stats: BuildingStats,
  ): void {
    const currentPlan = layout.floorPlans[floor];
    const abovePlan = layout.floorPlans[floor + 1];
    if (!abovePlan) return;

    const y = (floor + 1) * FLOOR_HEIGHT + FOUNDATION_HEIGHT;
    const rows = currentPlan.footprint.length;
    const cols = currentPlan.footprint[0]?.length ?? 0;

    // Build grid of cells that need ceilings
    const ceilingGrid: boolean[][] = Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => false),
    );

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        if (!currentPlan.footprint[row][col]) continue;
        if (!this.isCellOccupied(abovePlan.footprint, col, row)) continue;

        // Skip stair cell
        if (layout.stairs) {
          if (col === layout.stairs.col && row === layout.stairs.row) continue;
        }

        ceilingGrid[row][col] = true;
      }
    }

    // Greedy mesh ceiling tiles
    const rects = greedyMesh2D(ceilingGrid);

    for (const rect of rects) {
      const geometry = createMergedFloorGeometry(
        rect,
        CELL_SIZE,
        FLOOR_THICKNESS,
        y - FLOOR_THICKNESS / 2,
        layout.width,
        layout.depth,
        WALL_THICKNESS / 2, // Inset from walls
      );
      applyVertexColors(geometry, palette.floor);
      geometries.push(geometry);
    }
  }

  /**
   * Add terrace roofs - flat roofs on cells that have floor below but no floor above
   * These are the "patio" or "balcony" areas
   */
  private addTerraceRoofs(
    geometries: THREE.BufferGeometry[],
    layout: BuildingLayout,
    floor: number,
    stats: BuildingStats,
  ): void {
    const currentPlan = layout.floorPlans[floor];
    const abovePlan = layout.floorPlans[floor + 1];
    if (!abovePlan) return;

    // Terrace roof sits at the same level as the floor above
    const y = (floor + 1) * FLOOR_HEIGHT + FOUNDATION_HEIGHT;

    for (let row = 0; row < currentPlan.footprint.length; row += 1) {
      for (let col = 0; col < currentPlan.footprint[row].length; col += 1) {
        // Only add terrace roof where:
        // 1. Current floor exists
        // 2. Floor above does NOT exist (this creates the terrace)
        if (!currentPlan.footprint[row][col]) continue;
        if (this.isCellOccupied(abovePlan.footprint, col, row)) continue;

        const { x, z } = getCellCenter(
          col,
          row,
          CELL_SIZE,
          layout.width,
          layout.depth,
        );

        // Check if this cell is adjacent to the upper floor (edge of terrace)
        const adjacentToUpper =
          this.isCellOccupied(abovePlan.footprint, col - 1, row) ||
          this.isCellOccupied(abovePlan.footprint, col + 1, row) ||
          this.isCellOccupied(abovePlan.footprint, col, row - 1) ||
          this.isCellOccupied(abovePlan.footprint, col, row + 1);

        // Calculate tile size - extend to meet walls of upper floor
        let xSize = CELL_SIZE;
        let zSize = CELL_SIZE;
        let xOffset = 0;
        let zOffset = 0;

        // Check external walls on current floor
        const hasNorth = !this.isCellOccupied(
          currentPlan.footprint,
          col,
          row - 1,
        );
        const hasSouth = !this.isCellOccupied(
          currentPlan.footprint,
          col,
          row + 1,
        );
        const hasEast = !this.isCellOccupied(
          currentPlan.footprint,
          col + 1,
          row,
        );
        const hasWest = !this.isCellOccupied(
          currentPlan.footprint,
          col - 1,
          row,
        );

        // Check if adjacent cell has upper floor (where upper floor wall would be)
        const upperWallNorth = this.isCellOccupied(
          abovePlan.footprint,
          col,
          row - 1,
        );
        const upperWallSouth = this.isCellOccupied(
          abovePlan.footprint,
          col,
          row + 1,
        );
        const upperWallEast = this.isCellOccupied(
          abovePlan.footprint,
          col + 1,
          row,
        );
        const upperWallWest = this.isCellOccupied(
          abovePlan.footprint,
          col - 1,
          row,
        );

        // Inset from external walls
        const inset = WALL_THICKNESS / 2;
        if (hasWest) {
          xSize -= inset;
          xOffset += inset / 2;
        }
        if (hasEast) {
          xSize -= inset;
          xOffset -= inset / 2;
        }
        if (hasNorth) {
          zSize -= inset;
          zOffset += inset / 2;
        }
        if (hasSouth) {
          zSize -= inset;
          zOffset -= inset / 2;
        }

        // Extend slightly under upper floor walls to prevent gaps
        const extend = WALL_THICKNESS;
        if (upperWallWest) {
          xSize += extend;
          xOffset -= extend / 2;
        }
        if (upperWallEast) {
          xSize += extend;
          xOffset += extend / 2;
        }
        if (upperWallNorth) {
          zSize += extend;
          zOffset -= extend / 2;
        }
        if (upperWallSouth) {
          zSize += extend;
          zOffset += extend / 2;
        }

        // Create terrace roof tile - use patio color if adjacent to upper floor, roof color otherwise
        const color = adjacentToUpper ? palette.patio : palette.roof;
        const geometry = new THREE.BoxGeometry(xSize, FLOOR_THICKNESS, zSize);
        geometry.translate(x + xOffset, y - FLOOR_THICKNESS / 2, z + zOffset);
        applyVertexColors(geometry, color);
        geometries.push(geometry);
        stats.roofPieces += 1;
      }
    }
  }

  /**
   * Add railings around terrace edges
   * These go on cells where there's floor below, no floor above, and adjacent to drop-off
   */
  private addTerraceRailings(
    geometries: THREE.BufferGeometry[],
    layout: BuildingLayout,
    floor: number,
  ): void {
    const currentPlan = layout.floorPlans[floor];
    const abovePlan = layout.floorPlans[floor + 1];
    if (!abovePlan) return;

    // Railing starts at the wall top (not terrace floor) to avoid gap
    const wallTopY =
      (floor + 1) * FLOOR_HEIGHT + FOUNDATION_HEIGHT - FLOOR_THICKNESS;
    const totalRailingHeight = RAILING_HEIGHT + FLOOR_THICKNESS;
    const halfCell = CELL_SIZE / 2;

    // First pass: collect all terrace corner positions (where two external terrace edges meet)
    // A terrace corner is where a terrace cell has external edges on two perpendicular sides
    const terraceCorners = new Set<string>();

    for (let row = 0; row < currentPlan.footprint.length; row += 1) {
      for (let col = 0; col < currentPlan.footprint[row].length; col += 1) {
        if (!currentPlan.footprint[row][col]) continue;
        if (this.isCellOccupied(abovePlan.footprint, col, row)) continue;

        // Check for external terrace edges (no current neighbor AND no upper neighbor)
        const needsNorth =
          !this.isCellOccupied(currentPlan.footprint, col, row - 1) &&
          !this.isCellOccupied(abovePlan.footprint, col, row - 1);
        const needsSouth =
          !this.isCellOccupied(currentPlan.footprint, col, row + 1) &&
          !this.isCellOccupied(abovePlan.footprint, col, row + 1);
        const needsEast =
          !this.isCellOccupied(currentPlan.footprint, col + 1, row) &&
          !this.isCellOccupied(abovePlan.footprint, col + 1, row);
        const needsWest =
          !this.isCellOccupied(currentPlan.footprint, col - 1, row) &&
          !this.isCellOccupied(abovePlan.footprint, col - 1, row);

        // Record terrace corners
        if (needsNorth && needsWest)
          terraceCorners.add(`${col - 0.5},${row - 0.5}`);
        if (needsNorth && needsEast)
          terraceCorners.add(`${col + 0.5},${row - 0.5}`);
        if (needsSouth && needsWest)
          terraceCorners.add(`${col - 0.5},${row + 0.5}`);
        if (needsSouth && needsEast)
          terraceCorners.add(`${col + 0.5},${row + 0.5}`);
      }
    }

    // Second pass: generate railings with proper lengths accounting for corners
    for (let row = 0; row < currentPlan.footprint.length; row += 1) {
      for (let col = 0; col < currentPlan.footprint[row].length; col += 1) {
        if (!currentPlan.footprint[row][col]) continue;
        if (this.isCellOccupied(abovePlan.footprint, col, row)) continue;

        const { x, z } = getCellCenter(
          col,
          row,
          CELL_SIZE,
          layout.width,
          layout.depth,
        );

        // Check for terrace corners at each railing endpoint
        const hasCornerNW = terraceCorners.has(`${col - 0.5},${row - 0.5}`);
        const hasCornerNE = terraceCorners.has(`${col + 0.5},${row - 0.5}`);
        const hasCornerSW = terraceCorners.has(`${col - 0.5},${row + 0.5}`);
        const hasCornerSE = terraceCorners.has(`${col + 0.5},${row + 0.5}`);

        const sides = [
          {
            dc: 0,
            dr: -1,
            side: "north",
            hasStart: hasCornerNW,
            hasEnd: hasCornerNE,
            isVertical: false,
          },
          {
            dc: 0,
            dr: 1,
            side: "south",
            hasStart: hasCornerSW,
            hasEnd: hasCornerSE,
            isVertical: false,
          },
          {
            dc: 1,
            dr: 0,
            side: "east",
            hasStart: hasCornerNE,
            hasEnd: hasCornerSE,
            isVertical: true,
          },
          {
            dc: -1,
            dr: 0,
            side: "west",
            hasStart: hasCornerNW,
            hasEnd: hasCornerSW,
            isVertical: true,
          },
        ];

        for (const { dc, dr, side, hasStart, hasEnd, isVertical } of sides) {
          const nc = col + dc;
          const nr = row + dr;

          const hasCurrentFloorNeighbor = this.isCellOccupied(
            currentPlan.footprint,
            nc,
            nr,
          );
          const hasUpperFloorNeighbor = this.isCellOccupied(
            abovePlan.footprint,
            nc,
            nr,
          );

          if (!hasCurrentFloorNeighbor && !hasUpperFloorNeighbor) {
            // Calculate railing length accounting for corners
            let railingLength = CELL_SIZE;
            let offset = 0;

            if (hasStart) {
              railingLength -= RAILING_THICKNESS;
              offset += RAILING_THICKNESS / 2;
            }
            if (hasEnd) {
              railingLength -= RAILING_THICKNESS;
              offset -= RAILING_THICKNESS / 2;
            }

            // Position at cell edge with offset for corner adjustment
            const ox = isVertical
              ? side === "west"
                ? -halfCell
                : halfCell
              : offset;
            const oz = !isVertical
              ? side === "north"
                ? -halfCell
                : halfCell
              : offset;

            const geometry = new THREE.BoxGeometry(
              isVertical ? RAILING_THICKNESS : railingLength,
              totalRailingHeight,
              isVertical ? railingLength : RAILING_THICKNESS,
            );
            geometry.translate(
              x + ox,
              wallTopY + totalRailingHeight / 2,
              z + oz,
            );
            applyVertexColors(geometry, palette.trim);
            geometries.push(geometry);
          }
        }
      }
    }

    // Third pass: add corner posts at terrace corners
    for (let row = 0; row < currentPlan.footprint.length; row += 1) {
      for (let col = 0; col < currentPlan.footprint[row].length; col += 1) {
        if (!currentPlan.footprint[row][col]) continue;
        if (this.isCellOccupied(abovePlan.footprint, col, row)) continue;

        const { x, z } = getCellCenter(
          col,
          row,
          CELL_SIZE,
          layout.width,
          layout.depth,
        );

        // Check for external terrace edges
        const needsNorth =
          !this.isCellOccupied(currentPlan.footprint, col, row - 1) &&
          !this.isCellOccupied(abovePlan.footprint, col, row - 1);
        const needsSouth =
          !this.isCellOccupied(currentPlan.footprint, col, row + 1) &&
          !this.isCellOccupied(abovePlan.footprint, col, row + 1);
        const needsEast =
          !this.isCellOccupied(currentPlan.footprint, col + 1, row) &&
          !this.isCellOccupied(abovePlan.footprint, col + 1, row);
        const needsWest =
          !this.isCellOccupied(currentPlan.footprint, col - 1, row) &&
          !this.isCellOccupied(abovePlan.footprint, col - 1, row);

        // Add corner posts where two terrace edges meet
        const cornerPositions = [
          {
            hasCorner: needsNorth && needsWest,
            x: x - halfCell,
            z: z - halfCell,
          },
          {
            hasCorner: needsNorth && needsEast,
            x: x + halfCell,
            z: z - halfCell,
          },
          {
            hasCorner: needsSouth && needsWest,
            x: x - halfCell,
            z: z + halfCell,
          },
          {
            hasCorner: needsSouth && needsEast,
            x: x + halfCell,
            z: z + halfCell,
          },
        ];

        for (const { hasCorner, x: cx, z: cz } of cornerPositions) {
          if (hasCorner) {
            const cornerGeo = new THREE.BoxGeometry(
              RAILING_THICKNESS,
              totalRailingHeight,
              RAILING_THICKNESS,
            );
            cornerGeo.translate(cx, wallTopY + totalRailingHeight / 2, cz);
            applyVertexColors(cornerGeo, palette.trim);
            geometries.push(cornerGeo);
          }
        }
      }
    }
  }

  private addFloorEdgeSkirts(
    geometries: THREE.BufferGeometry[],
    layout: BuildingLayout,
    floor: number,
  ): void {
    const plan = layout.floorPlans[floor];
    const y = floor * FLOOR_HEIGHT + FOUNDATION_HEIGHT;
    // Track which edges have been processed to avoid duplicates
    const processedEdges = new Set<string>();

    // First pass: collect all corner post positions for this floor
    // This ensures skirts are shortened correctly even when corner post was placed by adjacent cell
    const cornerPostPositions = new Set<string>();

    for (let row = 0; row < plan.footprint.length; row += 1) {
      for (let col = 0; col < plan.footprint[row].length; col += 1) {
        if (!plan.footprint[row][col]) continue;

        const hasNorth = !this.isCellOccupied(plan.footprint, col, row - 1);
        const hasSouth = !this.isCellOccupied(plan.footprint, col, row + 1);
        const hasEast = !this.isCellOccupied(plan.footprint, col + 1, row);
        const hasWest = !this.isCellOccupied(plan.footprint, col - 1, row);

        // Record corner post positions (same key format as wall generation)
        if (hasNorth && hasWest)
          cornerPostPositions.add(`${col - 0.5},${row - 0.5}`);
        if (hasNorth && hasEast)
          cornerPostPositions.add(`${col + 0.5},${row - 0.5}`);
        if (hasSouth && hasWest)
          cornerPostPositions.add(`${col - 0.5},${row + 0.5}`);
        if (hasSouth && hasEast)
          cornerPostPositions.add(`${col + 0.5},${row + 0.5}`);
      }
    }

    // Second pass: generate skirts with proper lengths accounting for corner posts
    for (let row = 0; row < plan.footprint.length; row += 1) {
      for (let col = 0; col < plan.footprint[row].length; col += 1) {
        if (!plan.footprint[row][col]) continue;

        const { x, z } = getCellCenter(
          col,
          row,
          CELL_SIZE,
          layout.width,
          layout.depth,
        );
        const halfCell = CELL_SIZE / 2;
        const halfThick = WALL_THICKNESS / 2;

        // Check for corner posts at each skirt endpoint using the GLOBAL corner positions
        const hasCornerNW = cornerPostPositions.has(
          `${col - 0.5},${row - 0.5}`,
        );
        const hasCornerNE = cornerPostPositions.has(
          `${col + 0.5},${row - 0.5}`,
        );
        const hasCornerSW = cornerPostPositions.has(
          `${col - 0.5},${row + 0.5}`,
        );
        const hasCornerSE = cornerPostPositions.has(
          `${col + 0.5},${row + 0.5}`,
        );

        // Define sides with corner information from global map
        const sides = [
          {
            dc: -1,
            dr: 0,
            side: "west",
            hasStart: hasCornerNW,
            hasEnd: hasCornerSW,
            isVertical: true,
          },
          {
            dc: 1,
            dr: 0,
            side: "east",
            hasStart: hasCornerNE,
            hasEnd: hasCornerSE,
            isVertical: true,
          },
          {
            dc: 0,
            dr: -1,
            side: "north",
            hasStart: hasCornerNW,
            hasEnd: hasCornerNE,
            isVertical: false,
          },
          {
            dc: 0,
            dr: 1,
            side: "south",
            hasStart: hasCornerSW,
            hasEnd: hasCornerSE,
            isVertical: false,
          },
        ];

        for (const { dc, dr, side, hasStart, hasEnd, isVertical } of sides) {
          const edgeKey = `${Math.min(col, col + dc)},${Math.min(row, row + dr)},${side}`;

          if (
            !this.isCellOccupied(plan.footprint, col + dc, row + dr) &&
            !processedEdges.has(edgeKey)
          ) {
            processedEdges.add(edgeKey);

            // Calculate length, accounting for corner posts
            let length = CELL_SIZE;
            let offset = 0;

            if (hasStart) {
              length -= WALL_THICKNESS;
              offset += WALL_THICKNESS / 2;
            }
            if (hasEnd) {
              length -= WALL_THICKNESS;
              offset -= WALL_THICKNESS / 2;
            }

            // Position of skirt center
            const ox = isVertical
              ? (-halfCell + halfThick) * (side === "west" ? 1 : -1)
              : offset;
            const oz = isVertical
              ? offset
              : (-halfCell + halfThick) * (side === "north" ? 1 : -1);

            const geometry = new THREE.BoxGeometry(
              isVertical ? WALL_THICKNESS : length,
              FLOOR_THICKNESS * 2,
              isVertical ? length : WALL_THICKNESS,
            );
            geometry.translate(x + ox, y - FLOOR_THICKNESS, z + oz);
            applyVertexColors(geometry, palette.trim); // Skirts use trim color
            geometries.push(geometry);
          }
        }
      }
    }
  }

  private addWallsForFloor(
    geometries: THREE.BufferGeometry[],
    layout: BuildingLayout,
    plan: FloorPlan,
    floor: number,
    stats: BuildingStats,
  ): void {
    const y = floor * FLOOR_HEIGHT + FOUNDATION_HEIGHT;
    // For non-top floors, extend walls up to meet the floor above (eliminates gap)
    const isTopFloor = floor === layout.floors - 1;
    const effectiveWallHeight = isTopFloor ? WALL_HEIGHT : FLOOR_HEIGHT;

    // Track which wall segments have been placed to avoid duplicates
    const placedWalls = new Set<string>();
    // Track corner posts that need to be placed (global map so walls can check for posts from any cell)
    const cornerPosts = new Map<
      string,
      { x: number; z: number; height: number }
    >();

    // First pass: identify all corner posts
    // Corner posts are placed at external corners where two external walls meet
    for (let row = 0; row < plan.footprint.length; row += 1) {
      for (let col = 0; col < plan.footprint[row].length; col += 1) {
        if (!plan.footprint[row][col]) continue;

        const { x, z } = getCellCenter(
          col,
          row,
          CELL_SIZE,
          layout.width,
          layout.depth,
        );
        const halfCell = CELL_SIZE / 2;
        const halfThick = WALL_THICKNESS / 2;

        // Check for external walls (no neighbor in that direction)
        const hasNorth = !this.isCellOccupied(plan.footprint, col, row - 1);
        const hasSouth = !this.isCellOccupied(plan.footprint, col, row + 1);
        const hasEast = !this.isCellOccupied(plan.footprint, col + 1, row);
        const hasWest = !this.isCellOccupied(plan.footprint, col - 1, row);

        // Place corner posts at external corners (where two external walls meet)
        // Key format: "col±0.5,row±0.5" ensures each corner position is unique
        if (hasNorth && hasWest) {
          const key = `${col - 0.5},${row - 0.5}`;
          cornerPosts.set(key, {
            x: x - halfCell + halfThick,
            z: z - halfCell + halfThick,
            height: effectiveWallHeight,
          });
        }
        if (hasNorth && hasEast) {
          const key = `${col + 0.5},${row - 0.5}`;
          cornerPosts.set(key, {
            x: x + halfCell - halfThick,
            z: z - halfCell + halfThick,
            height: effectiveWallHeight,
          });
        }
        if (hasSouth && hasWest) {
          const key = `${col - 0.5},${row + 0.5}`;
          cornerPosts.set(key, {
            x: x - halfCell + halfThick,
            z: z + halfCell - halfThick,
            height: effectiveWallHeight,
          });
        }
        if (hasSouth && hasEast) {
          const key = `${col + 0.5},${row + 0.5}`;
          cornerPosts.set(key, {
            x: x + halfCell - halfThick,
            z: z + halfCell - halfThick,
            height: effectiveWallHeight,
          });
        }
      }
    }

    // Second pass: generate walls with proper lengths accounting for corner posts
    for (let row = 0; row < plan.footprint.length; row += 1) {
      for (let col = 0; col < plan.footprint[row].length; col += 1) {
        if (!plan.footprint[row][col]) continue;

        const { x, z } = getCellCenter(
          col,
          row,
          CELL_SIZE,
          layout.width,
          layout.depth,
        );
        const halfCell = CELL_SIZE / 2;
        const halfThick = WALL_THICKNESS / 2;

        // Check for corner posts at each wall endpoint using the GLOBAL cornerPosts map
        // This ensures walls are shortened even when the corner post was placed by an adjacent cell
        const hasCornerNW = cornerPosts.has(`${col - 0.5},${row - 0.5}`);
        const hasCornerNE = cornerPosts.has(`${col + 0.5},${row - 0.5}`);
        const hasCornerSW = cornerPosts.has(`${col - 0.5},${row + 0.5}`);
        const hasCornerSE = cornerPosts.has(`${col + 0.5},${row + 0.5}`);

        // Wall segments - calculate length and offset based on corner posts
        // hasStart/hasEnd now check the global corner posts map, not just this cell's corners
        const sides: Array<{
          dc: number;
          dr: number;
          side: string;
          isVertical: boolean;
          hasStart: boolean; // Has corner post at start (negative direction)
          hasEnd: boolean; // Has corner post at end (positive direction)
        }> = [
          {
            dc: -1,
            dr: 0,
            side: "west",
            isVertical: true,
            hasStart: hasCornerNW,
            hasEnd: hasCornerSW,
          },
          {
            dc: 1,
            dr: 0,
            side: "east",
            isVertical: true,
            hasStart: hasCornerNE,
            hasEnd: hasCornerSE,
          },
          {
            dc: 0,
            dr: -1,
            side: "north",
            isVertical: false,
            hasStart: hasCornerNW,
            hasEnd: hasCornerNE,
          },
          {
            dc: 0,
            dr: 1,
            side: "south",
            isVertical: false,
            hasStart: hasCornerSW,
            hasEnd: hasCornerSE,
          },
        ];

        for (const { dc, dr, side, isVertical, hasStart, hasEnd } of sides) {
          const nc = col + dc;
          const nr = row + dr;
          const externalKey = `${col},${row},${side}`;
          const opening = plan.externalOpenings.get(externalKey);

          // Create unique wall key to avoid duplicates
          const wallKey = `${Math.min(col, nc)},${Math.min(row, nr)},${isVertical ? "v" : "h"}`;

          if (!this.isCellOccupied(plan.footprint, nc, nr)) {
            // External wall - only place if not already placed
            if (!placedWalls.has(wallKey)) {
              placedWalls.add(wallKey);

              // Calculate wall length: full cell minus corner posts at each end
              let wallLength = CELL_SIZE;
              let offset = 0;

              if (hasStart) {
                wallLength -= WALL_THICKNESS;
                offset += WALL_THICKNESS / 2;
              }
              if (hasEnd) {
                wallLength -= WALL_THICKNESS;
                offset -= WALL_THICKNESS / 2;
              }

              // Position of wall center
              const ox = isVertical
                ? (-halfCell + halfThick) * (side === "west" ? 1 : -1)
                : offset;
              const oz = isVertical
                ? offset
                : (-halfCell + halfThick) * (side === "north" ? 1 : -1);

              this.addWallWithOpening(
                geometries,
                x + ox,
                y,
                z + oz,
                isVertical ? WALL_THICKNESS : wallLength,
                isVertical ? wallLength : WALL_THICKNESS,
                opening,
                stats,
                isVertical,
                effectiveWallHeight,
                true, // isExternal = true
              );
            }
          } else {
            // Internal wall - check for openings (no corner posts for internal walls)
            const internalKey = `${col},${row}`;
            const internalOpening = plan.internalOpenings.get(internalKey);
            if (internalOpening && !placedWalls.has(wallKey)) {
              placedWalls.add(wallKey);

              const wallLength = CELL_SIZE - WALL_THICKNESS; // Internal walls don't have corner posts
              const ox = isVertical
                ? (-halfCell + halfThick) * (side === "west" ? 1 : -1)
                : 0;
              const oz = isVertical
                ? 0
                : (-halfCell + halfThick) * (side === "north" ? 1 : -1);

              this.addWallWithOpening(
                geometries,
                x + ox,
                y,
                z + oz,
                isVertical ? WALL_THICKNESS : wallLength,
                isVertical ? wallLength : WALL_THICKNESS,
                internalOpening,
                stats,
                isVertical,
                effectiveWallHeight,
                false, // isExternal = false (internal wall)
              );
            }
          }
        }
      }
    }

    // Add corner posts with correct height (use corner color)
    for (const [_key, pos] of cornerPosts) {
      const geometry = new THREE.BoxGeometry(
        WALL_THICKNESS,
        pos.height,
        WALL_THICKNESS,
      );
      geometry.translate(pos.x, y + pos.height / 2, pos.z);
      applyVertexColors(geometry, palette.wallCorner);
      geometries.push(geometry);
    }
  }

  private addWallWithOpening(
    geometries: THREE.BufferGeometry[],
    x: number,
    y: number,
    z: number,
    width: number,
    depth: number,
    opening: string | undefined,
    stats: BuildingStats,
    isVertical: boolean,
    wallHeight: number = WALL_HEIGHT,
    isExternal: boolean = true,
  ): void {
    const wallLength = isVertical ? depth : width;
    const wallThickness = isVertical ? width : depth;

    // Use outer wall color for external walls, inner wall color for internal
    const wallColor = isExternal ? palette.wallOuter : palette.wallInner;

    if (!opening) {
      // Solid wall
      const geometry = new THREE.BoxGeometry(width, wallHeight, depth);
      geometry.translate(x, y + wallHeight / 2, z);
      applyVertexColors(geometry, wallColor);
      geometries.push(geometry);
      stats.wallSegments += 1;
      return;
    }

    // Wall with opening
    const openingWidth =
      opening === "arch"
        ? ARCH_WIDTH
        : opening === "door"
          ? DOOR_WIDTH
          : WINDOW_WIDTH;
    const openingHeight = opening === "window" ? WINDOW_HEIGHT : DOOR_HEIGHT;
    const openingBottom = opening === "window" ? WINDOW_SILL_HEIGHT : 0;
    const sideWidth = Math.max(0, (wallLength - openingWidth) / 2);

    // Left/Front side piece (full wall height)
    if (sideWidth > 0.01) {
      const geo = isVertical
        ? new THREE.BoxGeometry(wallThickness, wallHeight, sideWidth)
        : new THREE.BoxGeometry(sideWidth, wallHeight, wallThickness);
      const offset = wallLength / 2 - sideWidth / 2;
      geo.translate(
        x + (isVertical ? 0 : -offset),
        y + wallHeight / 2,
        z + (isVertical ? -offset : 0),
      );
      applyVertexColors(geo, wallColor);
      geometries.push(geo);
    }

    // Right/Back side piece (full wall height)
    if (sideWidth > 0.01) {
      const geo = isVertical
        ? new THREE.BoxGeometry(wallThickness, wallHeight, sideWidth)
        : new THREE.BoxGeometry(sideWidth, wallHeight, wallThickness);
      const offset = wallLength / 2 - sideWidth / 2;
      geo.translate(
        x + (isVertical ? 0 : offset),
        y + wallHeight / 2,
        z + (isVertical ? offset : 0),
      );
      applyVertexColors(geo, wallColor);
      geometries.push(geo);
    }

    // Top piece above opening (extends to full wall height)
    const topHeight = wallHeight - openingHeight - openingBottom;
    if (topHeight > 0.01) {
      const geo = isVertical
        ? new THREE.BoxGeometry(wallThickness, topHeight, openingWidth)
        : new THREE.BoxGeometry(openingWidth, topHeight, wallThickness);
      geo.translate(x, y + openingBottom + openingHeight + topHeight / 2, z);
      applyVertexColors(geo, wallColor);
      geometries.push(geo);
    }

    // Bottom piece (for windows)
    if (openingBottom > 0.01) {
      const geo = isVertical
        ? new THREE.BoxGeometry(wallThickness, openingBottom, openingWidth)
        : new THREE.BoxGeometry(openingWidth, openingBottom, wallThickness);
      geo.translate(x, y + openingBottom / 2, z);
      applyVertexColors(geo, wallColor);
      geometries.push(geo);
    }

    // Update stats
    stats.wallSegments += 1;
    if (opening === "door") stats.doorways += 1;
    else if (opening === "arch") stats.archways += 1;
    else if (opening === "window") stats.windows += 1;
  }

  private addStairs(
    geometries: THREE.BufferGeometry[],
    layout: BuildingLayout,
    stats: BuildingStats,
  ): void {
    if (!layout.stairs) return;

    const { col, row, direction } = layout.stairs;
    const { x: cellCenterX, z: cellCenterZ } = getCellCenter(
      col,
      row,
      CELL_SIZE,
      layout.width,
      layout.depth,
    );

    // Get direction vector based on direction name
    const sideVec = getSideVector(direction);
    const dirX = sideVec.x;
    const dirZ = sideVec.z;

    // Stairs fit entirely within the stair cell
    // - Stair cell (col,row): contains the actual stairs
    // - Landing cell: is a flat landing at the top (floor tile handles this)

    // Stairs parameters
    const stepCount = 12; // Steps to climb one floor
    const stepHeight = FLOOR_HEIGHT / stepCount;

    // Width fits within a cell with room for stringers
    const stepWidth = CELL_SIZE - WALL_THICKNESS * 4;
    const stringerThickness = WALL_THICKNESS * 1.5;

    // Total horizontal run fits within one cell (with margin for landing)
    const landingDepth = CELL_SIZE * 0.15; // Small landing at bottom of stairs
    const totalRun = CELL_SIZE - landingDepth * 2; // Stairs fit in middle of cell
    const stepDepth = totalRun / stepCount;

    // Start position - back edge of cell (opposite the direction of travel)
    // Stairs start at the back of the cell and go toward the landing cell
    const stairStartX = cellCenterX - dirX * (CELL_SIZE / 2 - landingDepth);
    const stairStartZ = cellCenterZ - dirZ * (CELL_SIZE / 2 - landingDepth);

    // Base Y position (ground floor)
    const baseY = FOUNDATION_HEIGHT;

    // Create steps as individual treads (within the stair cell)
    for (let i = 0; i < stepCount; i += 1) {
      // Position along the run
      const progress = (i + 0.5) / stepCount;
      const stepX = stairStartX + dirX * totalRun * progress;
      const stepZ = stairStartZ + dirZ * totalRun * progress;

      // Height of this step's top surface
      const stepTopY = baseY + stepHeight * (i + 1);

      // Create step as a solid block from floor to step top
      const fullStepHeight = stepTopY - baseY;

      const geometry = new THREE.BoxGeometry(
        Math.abs(dirZ) > 0.5 ? stepWidth : stepDepth,
        fullStepHeight,
        Math.abs(dirX) > 0.5 ? stepWidth : stepDepth,
      );
      geometry.translate(stepX, baseY + fullStepHeight / 2, stepZ);
      applyVertexColors(geometry, palette.stairs);
      geometries.push(geometry);
      stats.stairSteps += 1;
    }

    // Add stair side walls/stringers (within the stair cell)
    const perpX = -dirZ;
    const perpZ = dirX;

    // Stringer positions (on either side of the steps)
    const leftOffsetX = perpX * (stepWidth / 2 + stringerThickness / 2);
    const leftOffsetZ = perpZ * (stepWidth / 2 + stringerThickness / 2);
    const rightOffsetX = -perpX * (stepWidth / 2 + stringerThickness / 2);
    const rightOffsetZ = -perpZ * (stepWidth / 2 + stringerThickness / 2);

    // Stringers run the length of the stairs (within the stair cell)
    const stringerCenterX = cellCenterX;
    const stringerCenterZ = cellCenterZ;
    const stringerCenterY = baseY + FLOOR_HEIGHT / 2;

    // Left stringer
    const leftStringerGeo = new THREE.BoxGeometry(
      Math.abs(dirZ) > 0.5 ? stringerThickness : totalRun,
      FLOOR_HEIGHT,
      Math.abs(dirX) > 0.5 ? stringerThickness : totalRun,
    );
    leftStringerGeo.translate(
      stringerCenterX + leftOffsetX,
      stringerCenterY,
      stringerCenterZ + leftOffsetZ,
    );
    applyVertexColors(leftStringerGeo, palette.trim); // Stringers use trim color
    geometries.push(leftStringerGeo);

    // Right stringer
    const rightStringerGeo = new THREE.BoxGeometry(
      Math.abs(dirZ) > 0.5 ? stringerThickness : totalRun,
      FLOOR_HEIGHT,
      Math.abs(dirX) > 0.5 ? stringerThickness : totalRun,
    );
    rightStringerGeo.translate(
      stringerCenterX + rightOffsetX,
      stringerCenterY,
      stringerCenterZ + rightOffsetZ,
    );
    applyVertexColors(rightStringerGeo, palette.trim); // Stringers use trim color
    geometries.push(rightStringerGeo);
  }

  /**
   * Add invisible walkable ramps for interior stairs.
   * These replace the visual box steps for actual walking collision.
   * The ramp is a thin angled plane spanning from one floor to the next.
   */
  private addStairRamps(
    geometries: THREE.BufferGeometry[],
    layout: BuildingLayout,
  ): void {
    if (!layout.stairs) return;

    const { col, row, direction, landing } = layout.stairs;
    const { x: cellCenterX, z: cellCenterZ } = getCellCenter(
      col,
      row,
      CELL_SIZE,
      layout.width,
      layout.depth,
    );

    // Get direction vector
    const sideVec = getSideVector(direction);
    const dirX = sideVec.x;
    const dirZ = sideVec.z;

    // Ramp parameters - spans from stair cell to landing cell
    const stepWidth = CELL_SIZE - WALL_THICKNESS * 4;
    const landingDepth = CELL_SIZE * 0.15;

    // Base Y position
    const baseY = FOUNDATION_HEIGHT;

    // Start position (bottom of stairs)
    const rampStartX = cellCenterX - dirX * (CELL_SIZE / 2 - landingDepth);
    const rampStartZ = cellCenterZ - dirZ * (CELL_SIZE / 2 - landingDepth);

    // End position (top landing cell)
    const { x: landingCenterX, z: landingCenterZ } = getCellCenter(
      landing.col,
      landing.row,
      CELL_SIZE,
      layout.width,
      layout.depth,
    );

    // The ramp goes from bottom of stair cell to the landing
    // Calculate the actual ramp length
    const rampEndX = landingCenterX - dirX * (CELL_SIZE / 2 - landingDepth);
    const rampEndZ = landingCenterZ - dirZ * (CELL_SIZE / 2 - landingDepth);

    const rampLength = Math.sqrt(
      Math.pow(rampEndX - rampStartX, 2) + Math.pow(rampEndZ - rampStartZ, 2),
    );

    // Height change
    const startY = baseY;
    const endY = baseY + FLOOR_HEIGHT;
    const heightDiff = endY - startY;

    // Create plane geometry for the ramp
    const isXAligned = Math.abs(dirX) > 0.5;
    const rampGeo = new THREE.PlaneGeometry(
      isXAligned ? rampLength : stepWidth,
      isXAligned ? stepWidth : rampLength,
    );

    // Calculate ramp center
    const rampCenterX = (rampStartX + rampEndX) / 2;
    const rampCenterZ = (rampStartZ + rampEndZ) / 2;
    const rampCenterY = (startY + endY) / 2;

    // Calculate inclination angle
    const angle = Math.atan2(heightDiff, rampLength);

    // Rotate plane to be horizontal first
    rampGeo.rotateX(-Math.PI / 2);

    // Then tilt based on stair direction
    if (Math.abs(dirZ) > 0.5) {
      // North/South stairs - tilt around X axis
      const tiltAngle = dirZ > 0 ? -angle : angle;
      rampGeo.rotateX(tiltAngle);
    } else {
      // East/West stairs - tilt around Z axis
      const tiltAngle = dirX > 0 ? angle : -angle;
      rampGeo.rotateZ(tiltAngle);
    }

    rampGeo.translate(rampCenterX, rampCenterY, rampCenterZ);

    // Use floor color (ramp is thin and hidden under visual steps)
    applyVertexColors(rampGeo, palette.floor);

    geometries.push(rampGeo);
  }

  private addRoofPieces(
    geometries: THREE.BufferGeometry[],
    layout: BuildingLayout,
    stats: BuildingStats,
  ): void {
    const topFloor = layout.floors - 1;
    const plan = layout.floorPlans[topFloor];
    // Roof sits directly on top of the walls (not at floor level above)
    // Wall top = topFloor * FLOOR_HEIGHT + WALL_HEIGHT + FOUNDATION_HEIGHT
    const y = topFloor * FLOOR_HEIGHT + WALL_HEIGHT + FOUNDATION_HEIGHT;

    for (let row = 0; row < plan.footprint.length; row += 1) {
      for (let col = 0; col < plan.footprint[row].length; col += 1) {
        if (!plan.footprint[row][col]) continue;

        const { x, z } = getCellCenter(
          col,
          row,
          CELL_SIZE,
          layout.width,
          layout.depth,
        );

        // Check which sides have external walls (no neighbor)
        const hasNorth = !this.isCellOccupied(plan.footprint, col, row - 1);
        const hasSouth = !this.isCellOccupied(plan.footprint, col, row + 1);
        const hasEast = !this.isCellOccupied(plan.footprint, col + 1, row);
        const hasWest = !this.isCellOccupied(plan.footprint, col - 1, row);

        // Calculate roof tile size to align with walls
        let roofSizeX = CELL_SIZE;
        let roofSizeZ = CELL_SIZE;
        let roofOffsetX = 0;
        let roofOffsetZ = 0;

        // Extend roof slightly past walls for overhang effect
        const overhang = WALL_THICKNESS / 2;

        if (hasWest) {
          roofOffsetX -= overhang / 2;
          roofSizeX += overhang;
        }
        if (hasEast) {
          roofOffsetX += overhang / 2;
          roofSizeX += overhang;
        }
        if (hasNorth) {
          roofOffsetZ -= overhang / 2;
          roofSizeZ += overhang;
        }
        if (hasSouth) {
          roofOffsetZ += overhang / 2;
          roofSizeZ += overhang;
        }

        // Flat roof tile
        const geometry = new THREE.BoxGeometry(
          roofSizeX,
          ROOF_THICKNESS,
          roofSizeZ,
        );
        geometry.translate(
          x + roofOffsetX,
          y + ROOF_THICKNESS / 2,
          z + roofOffsetZ,
        );
        applyVertexColors(geometry, palette.roof);
        geometries.push(geometry);
        stats.roofPieces += 1;
      }
    }
  }

  // ============================================================
  // PROP PLACEMENT METHODS
  // ============================================================

  /**
   * Find the best placement for an NPC (innkeeper, banker, shopkeeper) with counter.
   * Tries to find 2 adjacent cells for a longer counter, falls back to single cell.
   *
   * RULES:
   * 1. NOT in a stair cell or landing cell - don't block stairs
   * 2. Prefer rooms with external door that are FURTHEST from building centroid
   * 3. Within that room, prefer walls FURTHEST from the door
   * 4. Against a solid wall (no door/window behind the NPC)
   * 5. Prefer longer wall segments (more professional look)
   * 6. Not directly blocking an entrance doorway
   * 7. Avoid cells near stairs
   * 8. Try for 2-tile counter when space allows
   */
  private findNpcPlacement(
    layout: BuildingLayout,
    rng: RNG,
  ): {
    roomId: number;
    col: number;
    row: number;
    side: string;
    secondCell?: { col: number; row: number };
  } | null {
    const groundFloor = layout.floorPlans[0];
    if (!groundFloor || groundFloor.rooms.length === 0) return null;

    // Calculate building centroid
    const centroid = this.calculateFootprintCentroid(
      groundFloor.footprint,
      layout.width,
      layout.depth,
    );

    // Find rooms with external door access and calculate their distance from centroid
    const roomsWithDoors: Array<{
      room: Room;
      doorPositions: Array<{ col: number; row: number; side: string }>;
      distFromCentroid: number;
    }> = [];

    for (const room of groundFloor.rooms) {
      const doorPositions: Array<{ col: number; row: number; side: string }> =
        [];

      for (const cell of room.cells) {
        for (const side of ["north", "south", "east", "west"]) {
          const key = `${cell.col},${cell.row},${side}`;
          const opening = groundFloor.externalOpenings.get(key);
          if (opening === "door" || opening === "arch") {
            doorPositions.push({ col: cell.col, row: cell.row, side });
          }
        }
      }

      if (doorPositions.length > 0) {
        // Calculate room centroid distance from building centroid
        const roomCentroid = this.calculateRoomCentroid(
          room,
          layout.width,
          layout.depth,
        );
        const distFromCentroid = Math.sqrt(
          Math.pow(roomCentroid.x - centroid.x, 2) +
            Math.pow(roomCentroid.z - centroid.z, 2),
        );
        roomsWithDoors.push({ room, doorPositions, distFromCentroid });
      }
    }

    // Sort by distance from centroid (furthest first) - bar should be at the "back" of building
    roomsWithDoors.sort((a, b) => b.distFromCentroid - a.distFromCentroid);

    // If no rooms with doors, fallback to largest room
    const candidateRooms =
      roomsWithDoors.length > 0
        ? roomsWithDoors.map((r) => ({
            room: r.room,
            doorPositions: r.doorPositions,
          }))
        : groundFloor.rooms.map((r) => ({
            room: r,
            doorPositions: [] as Array<{
              col: number;
              row: number;
              side: string;
            }>,
          }));

    // First try to find a 2-tile placement
    for (const { room, doorPositions } of candidateRooms) {
      const placement = this.findBestCellsForNpc(
        layout,
        groundFloor,
        room,
        rng,
        2,
        doorPositions,
      );
      if (placement) {
        return { roomId: room.id, ...placement };
      }
    }

    // Fall back to single-tile placement
    for (const { room, doorPositions } of candidateRooms) {
      const placement = this.findBestCellsForNpc(
        layout,
        groundFloor,
        room,
        rng,
        1,
        doorPositions,
      );
      if (placement) {
        return { roomId: room.id, ...placement };
      }
    }

    return null;
  }

  /**
   * Calculate the centroid of a footprint in world coordinates.
   */
  private calculateFootprintCentroid(
    footprint: boolean[][],
    layoutWidth: number,
    layoutDepth: number,
  ): { x: number; z: number } {
    let sumX = 0;
    let sumZ = 0;
    let count = 0;

    const halfWidth = (layoutWidth * CELL_SIZE) / 2;
    const halfDepth = (layoutDepth * CELL_SIZE) / 2;

    for (let row = 0; row < footprint.length; row++) {
      for (let col = 0; col < (footprint[row]?.length || 0); col++) {
        if (footprint[row][col]) {
          const x = col * CELL_SIZE + CELL_SIZE / 2 - halfWidth;
          const z = row * CELL_SIZE + CELL_SIZE / 2 - halfDepth;
          sumX += x;
          sumZ += z;
          count++;
        }
      }
    }

    return count > 0 ? { x: sumX / count, z: sumZ / count } : { x: 0, z: 0 };
  }

  /**
   * Calculate the centroid of a room in world coordinates.
   */
  private calculateRoomCentroid(
    room: Room,
    layoutWidth: number,
    layoutDepth: number,
  ): { x: number; z: number } {
    let sumX = 0;
    let sumZ = 0;

    const halfWidth = (layoutWidth * CELL_SIZE) / 2;
    const halfDepth = (layoutDepth * CELL_SIZE) / 2;

    for (const cell of room.cells) {
      const x = cell.col * CELL_SIZE + CELL_SIZE / 2 - halfWidth;
      const z = cell.row * CELL_SIZE + CELL_SIZE / 2 - halfDepth;
      sumX += x;
      sumZ += z;
    }

    return room.cells.length > 0
      ? { x: sumX / room.cells.length, z: sumZ / room.cells.length }
      : { x: 0, z: 0 };
  }

  /**
   * Find the best cell(s) and wall side within a room for NPC placement.
   * @param tileCount - Number of tiles to find (1 or 2)
   * @param doorPositions - External door positions in this room (for distance calculation)
   */
  private findBestCellsForNpc(
    layout: BuildingLayout,
    floorPlan: FloorPlan,
    room: Room,
    rng: RNG,
    tileCount: 1 | 2,
    doorPositions: Array<{ col: number; row: number; side: string }> = [],
  ): {
    col: number;
    row: number;
    side: string;
    secondCell?: { col: number; row: number };
  } | null {
    const candidates: Array<{
      col: number;
      row: number;
      side: string;
      score: number;
      secondCell?: { col: number; row: number };
    }> = [];

    // Build a set of room cells for quick lookup
    const roomCellSet = new Set(room.cells.map((c) => `${c.col},${c.row}`));

    // Pre-calculate door positions in grid coordinates for distance checks
    const doorCells = doorPositions.map((d) => ({ col: d.col, row: d.row }));

    for (const cell of room.cells) {
      // RULE 1: Skip stair cells and landing cells
      if (layout.stairs) {
        if (cell.col === layout.stairs.col && cell.row === layout.stairs.row)
          continue;
        if (
          cell.col === layout.stairs.landing.col &&
          cell.row === layout.stairs.landing.row
        )
          continue;
      }

      // RULE 7: Penalty for cells adjacent to stairs (within 1 cell)
      let nearStairs = false;
      if (layout.stairs) {
        const stairDist =
          Math.abs(cell.col - layout.stairs.col) +
          Math.abs(cell.row - layout.stairs.row);
        const landingDist =
          Math.abs(cell.col - layout.stairs.landing.col) +
          Math.abs(cell.row - layout.stairs.landing.row);
        nearStairs = stairDist <= 1 || landingDist <= 1;
      }

      // Check each wall side of this cell
      for (const side of ["north", "south", "east", "west"] as const) {
        // Check if this cell is valid for NPC placement on this side
        if (!this.isValidNpcCell(layout, floorPlan, cell.col, cell.row, side))
          continue;

        // For 2-tile placement, find an adjacent cell along the wall
        let secondCell: { col: number; row: number } | undefined;
        if (tileCount === 2) {
          secondCell = this.findAdjacentNpcCell(
            layout,
            floorPlan,
            room,
            cell.col,
            cell.row,
            side,
            roomCellSet,
          );
          if (!secondCell) continue; // Need 2 cells but can't find adjacent valid cell
        }

        // Calculate base placement score
        let score = this.scoreNpcPlacement(
          floorPlan,
          room,
          cell.col,
          cell.row,
          side,
        );

        // RULE 3: Prefer walls FURTHEST from doors in the room
        if (doorCells.length > 0) {
          // Calculate minimum distance to any door
          let minDoorDist = Infinity;
          for (const door of doorCells) {
            const dist =
              Math.abs(cell.col - door.col) + Math.abs(cell.row - door.row);
            minDoorDist = Math.min(minDoorDist, dist);
          }
          // Bonus for being far from doors (up to +20 for 4+ cells away)
          score += Math.min(minDoorDist * 5, 20);
        }

        // RULE 7: Penalty for being near stairs
        if (nearStairs) {
          score -= 25;
        }

        // Bonus for 2-tile counter (more professional)
        if (secondCell) {
          score += 25;
          // Add score from second cell too
          score +=
            this.scoreNpcPlacement(
              floorPlan,
              room,
              secondCell.col,
              secondCell.row,
              side,
            ) * 0.5;

          // Also check second cell's distance from doors
          if (doorCells.length > 0) {
            let minDoorDist2 = Infinity;
            for (const door of doorCells) {
              const dist =
                Math.abs(secondCell.col - door.col) +
                Math.abs(secondCell.row - door.row);
              minDoorDist2 = Math.min(minDoorDist2, dist);
            }
            score += Math.min(minDoorDist2 * 2.5, 10);
          }
        }

        candidates.push({
          col: cell.col,
          row: cell.row,
          side,
          score,
          secondCell,
        });
      }
    }

    if (candidates.length === 0) return null;

    // Sort by score and pick from top candidates
    candidates.sort((a, b) => b.score - a.score);
    const topScore = candidates[0].score;
    const topCandidates = candidates.filter((c) => c.score >= topScore - 5);

    const picked = rng.pick(topCandidates)!;
    return {
      col: picked.col,
      row: picked.row,
      side: picked.side,
      secondCell: picked.secondCell,
    };
  }

  /**
   * Check if a cell is valid for NPC placement on a given side.
   */
  private isValidNpcCell(
    layout: BuildingLayout,
    floorPlan: FloorPlan,
    col: number,
    row: number,
    side: string,
  ): boolean {
    // Skip stair cells
    if (layout.stairs) {
      if (col === layout.stairs.col && row === layout.stairs.row) return false;
      if (
        col === layout.stairs.landing.col &&
        row === layout.stairs.landing.row
      )
        return false;
    }

    const wallKey = `${col},${row},${side}`;

    // Must be against a solid external wall (no opening behind NPC)
    const externalOpening = floorPlan.externalOpenings.get(wallKey);
    if (externalOpening) return false;

    // Check if this side is an external wall
    const { dc, dr } = this.getSideOffset(side);
    const neighborCol = col + dc;
    const neighborRow = row + dr;
    const isExternalWall = !this.isCellOccupied(
      floorPlan.footprint,
      neighborCol,
      neighborRow,
    );

    if (!isExternalWall) return false;

    // Bar should not be adjacent to a door tile
    // Check all adjacent cells (perpendicular to wall) for doors
    const perpDc = side === "north" || side === "south" ? 1 : 0;
    const perpDr = side === "east" || side === "west" ? 1 : 0;

    // Check both perpendicular neighbors
    for (const dir of [1, -1]) {
      const adjCol = col + perpDc * dir;
      const adjRow = row + perpDr * dir;

      // Check if adjacent cell has a door on any side
      for (const adjSide of ["north", "south", "east", "west"]) {
        const adjKey = `${adjCol},${adjRow},${adjSide}`;
        const adjOpening = floorPlan.externalOpenings.get(adjKey);
        if (adjOpening === "door" || adjOpening === "arch") {
          return false; // Adjacent to a door - not valid for bar
        }
      }
    }

    // Also check the cell itself for doors on other sides
    for (const checkSide of ["north", "south", "east", "west"]) {
      if (checkSide === side) continue; // Already checked this side (it's behind the NPC)
      const checkKey = `${col},${row},${checkSide}`;
      const checkOpening = floorPlan.externalOpenings.get(checkKey);
      if (checkOpening === "door" || checkOpening === "arch") {
        return false; // This cell has a door on another side - not ideal for bar
      }
    }

    return true;
  }

  /**
   * Find an adjacent cell along the same wall that's also valid for NPC placement.
   * The 2-tile bar should not extend through walls or be adjacent to doors.
   */
  private findAdjacentNpcCell(
    layout: BuildingLayout,
    floorPlan: FloorPlan,
    _room: Room,
    col: number,
    row: number,
    side: string,
    roomCellSet: Set<string>,
  ): { col: number; row: number } | undefined {
    // Get perpendicular direction (along the wall)
    const perpDc = side === "north" || side === "south" ? 1 : 0;
    const perpDr = side === "east" || side === "west" ? 1 : 0;

    // Check both directions along the wall
    const directions = [
      { col: col + perpDc, row: row + perpDr },
      { col: col - perpDc, row: row - perpDr },
    ];

    for (const adj of directions) {
      // Must be in the same room (ensures bar doesn't go through internal walls)
      if (!roomCellSet.has(`${adj.col},${adj.row}`)) continue;

      // Must exist in footprint (ensures bar doesn't extend outside building)
      if (!this.isCellOccupied(floorPlan.footprint, adj.col, adj.row)) continue;

      // Must also be valid for NPC placement on the same side
      // This checks for doors, stairs, etc.
      if (!this.isValidNpcCell(layout, floorPlan, adj.col, adj.row, side))
        continue;

      // Additional check: ensure this cell also has the same external wall on the same side
      // (bar should be against a continuous wall, not extending past a corner)
      const { dc, dr } = this.getSideOffset(side);
      const neighborCol = adj.col + dc;
      const neighborRow = adj.row + dr;
      const isExternalWall = !this.isCellOccupied(
        floorPlan.footprint,
        neighborCol,
        neighborRow,
      );
      if (!isExternalWall) continue;

      return { col: adj.col, row: adj.row };
    }

    return undefined;
  }

  /**
   * Calculate a score for NPC placement at a specific cell and side.
   * Note: Distance from doors is handled separately in findBestCellsForNpc.
   */
  private scoreNpcPlacement(
    floorPlan: FloorPlan,
    _room: Room,
    col: number,
    row: number,
    side: string,
  ): number {
    let score = 0;

    // Prefer walls that are part of longer wall segments (more professional bar)
    const wallLength = this.measureWallLength(
      floorPlan.footprint,
      col,
      row,
      side,
    );
    score += wallLength * 5;

    // Prefer cells not in corners (bar should be centered on wall)
    const externalEdgeCount = this.countExternalEdges(
      floorPlan.footprint,
      col,
      row,
    );
    if (externalEdgeCount >= 2) {
      score -= 10;
    }

    // Bonus for cells with more interior neighbors (NPC faces toward customers)
    const interiorNeighbors = 4 - externalEdgeCount;
    score += interiorNeighbors * 3;

    // Penalty if door is directly in front of NPC (don't block entrance)
    const oppositeSide = this.getOppositeSide(side);
    const oppositeKey = `${col},${row},${oppositeSide}`;
    const oppositeOpening = floorPlan.externalOpenings.get(oppositeKey);
    if (oppositeOpening === "door" || oppositeOpening === "arch") {
      // This would put the bar right at the entrance - avoid!
      score -= 20;
    }

    return score;
  }

  /**
   * Measure how long a wall segment is (how many consecutive cells share this external edge).
   */
  private measureWallLength(
    footprint: boolean[][],
    col: number,
    row: number,
    side: string,
  ): number {
    const { dc, dr } = this.getSideOffset(side);
    const perpDc = side === "north" || side === "south" ? 1 : 0;
    const perpDr = side === "east" || side === "west" ? 1 : 0;

    let length = 1;

    // Count in positive perpendicular direction
    let checkCol = col + perpDc;
    let checkRow = row + perpDr;
    while (
      this.isCellOccupied(footprint, checkCol, checkRow) &&
      !this.isCellOccupied(footprint, checkCol + dc, checkRow + dr)
    ) {
      length += 1;
      checkCol += perpDc;
      checkRow += perpDr;
    }

    // Count in negative perpendicular direction
    checkCol = col - perpDc;
    checkRow = row - perpDr;
    while (
      this.isCellOccupied(footprint, checkCol, checkRow) &&
      !this.isCellOccupied(footprint, checkCol + dc, checkRow + dr)
    ) {
      length += 1;
      checkCol -= perpDc;
      checkRow -= perpDr;
    }

    return length;
  }

  /**
   * Get the offset for a side direction.
   */
  private getSideOffset(side: string): { dc: number; dr: number } {
    switch (side) {
      case "north":
        return { dc: 0, dr: -1 };
      case "south":
        return { dc: 0, dr: 1 };
      case "east":
        return { dc: 1, dr: 0 };
      case "west":
        return { dc: -1, dr: 0 };
      default:
        return { dc: 0, dr: 0 };
    }
  }

  /**
   * Get the opposite side.
   */
  private getOppositeSide(side: string): string {
    switch (side) {
      case "north":
        return "south";
      case "south":
        return "north";
      case "east":
        return "west";
      case "west":
        return "east";
      default:
        return side;
    }
  }

  private reserveInnBarPlacement(
    layout: BuildingLayout,
    _recipe: BuildingRecipe,
    rng: RNG,
  ): { roomId: number; col: number; row: number; side: string } | null {
    return this.findNpcPlacement(layout, rng);
  }

  private reserveBankCounterPlacement(
    layout: BuildingLayout,
    _recipe: BuildingRecipe,
    rng: RNG,
  ): { roomId: number; col: number; row: number; side: string } | null {
    return this.findNpcPlacement(layout, rng);
  }

  private addBuildingProps(
    geometries: THREE.BufferGeometry[],
    layout: BuildingLayout,
    _recipe: BuildingRecipe,
    typeKey: string,
    rng: RNG,
    stats: BuildingStats,
    propPlacements: PropPlacements,
  ): void {
    if (typeKey === "inn" && propPlacements.innBar) {
      const { col, row, side, secondCell } = propPlacements.innBar;
      this.addCounterWithNpc(
        geometries,
        layout,
        col,
        row,
        side,
        secondCell,
        palette.bar,
        palette.innkeeper,
        stats,
      );
    }

    if (typeKey === "bank" && propPlacements.bankCounter) {
      const { col, row, side, secondCell } = propPlacements.bankCounter;
      this.addCounterWithNpc(
        geometries,
        layout,
        col,
        row,
        side,
        secondCell,
        palette.counter,
        palette.banker,
        stats,
      );
    }

    if (typeKey === "smithy") {
      const groundFloor = layout.floorPlans[0];
      if (groundFloor && groundFloor.rooms.length > 0) {
        const room = groundFloor.rooms[0];
        const cell = rng.pick(room.cells);
        if (cell) {
          const { x, z } = getCellCenter(
            cell.col,
            cell.row,
            CELL_SIZE,
            layout.width,
            layout.depth,
          );
          this.addForgeProps(geometries, x, FOUNDATION_HEIGHT, z, stats);
        }
      }
    }
  }

  /**
   * Add a counter and NPC, supporting 1 or 2 tile placements.
   */
  private addCounterWithNpc(
    geometries: THREE.BufferGeometry[],
    layout: BuildingLayout,
    col: number,
    row: number,
    side: string,
    secondCell: { col: number; row: number } | undefined,
    counterColor: THREE.Color,
    npcColor: THREE.Color,
    stats: BuildingStats,
  ): void {
    const { x: x1, z: z1 } = getCellCenter(
      col,
      row,
      CELL_SIZE,
      layout.width,
      layout.depth,
    );

    if (secondCell) {
      // 2-tile counter: calculate center between the two cells
      const { x: x2, z: z2 } = getCellCenter(
        secondCell.col,
        secondCell.row,
        CELL_SIZE,
        layout.width,
        layout.depth,
      );
      const centerX = (x1 + x2) / 2;
      const centerZ = (z1 + z2) / 2;

      // Counter spans both cells
      this.addCounter(
        geometries,
        centerX,
        FOUNDATION_HEIGHT,
        centerZ,
        side,
        counterColor,
        stats,
        2,
      );

      // NPC stands behind the center of the counter
      this.addNpcCube(
        geometries,
        centerX,
        FOUNDATION_HEIGHT,
        centerZ,
        side,
        npcColor,
        stats,
      );
    } else {
      // Single-tile counter
      this.addCounter(
        geometries,
        x1,
        FOUNDATION_HEIGHT,
        z1,
        side,
        counterColor,
        stats,
        1,
      );
      this.addNpcCube(
        geometries,
        x1,
        FOUNDATION_HEIGHT,
        z1,
        side,
        npcColor,
        stats,
      );
    }
  }

  private addCounter(
    geometries: THREE.BufferGeometry[],
    x: number,
    y: number,
    z: number,
    side: string,
    color: THREE.Color,
    stats: BuildingStats,
    tileCount: number = 1,
  ): void {
    const vec = getSideVector(side);
    const offsetX = vec.x * (CELL_SIZE / 4);
    const offsetZ = vec.z * (CELL_SIZE / 4);

    const isNS = side === "north" || side === "south";

    // Counter length scales with tile count
    const counterLength = COUNTER_LENGTH + (tileCount - 1) * CELL_SIZE * 0.8;

    const geometry = new THREE.BoxGeometry(
      isNS ? counterLength : COUNTER_DEPTH,
      COUNTER_HEIGHT,
      isNS ? COUNTER_DEPTH : counterLength,
    );
    geometry.translate(x + offsetX, y + COUNTER_HEIGHT / 2, z + offsetZ);
    applyVertexColors(geometry, color);
    geometries.push(geometry);
    stats.props += 1;
  }

  private addNpcCube(
    geometries: THREE.BufferGeometry[],
    x: number,
    y: number,
    z: number,
    side: string,
    color: THREE.Color,
    stats: BuildingStats,
  ): void {
    const vec = getSideVector(side);
    const offsetX = vec.x * (CELL_SIZE / 4 + COUNTER_DEPTH + NPC_WIDTH / 2);
    const offsetZ = vec.z * (CELL_SIZE / 4 + COUNTER_DEPTH + NPC_WIDTH / 2);

    const geometry = new THREE.BoxGeometry(NPC_WIDTH, NPC_HEIGHT, NPC_WIDTH);
    geometry.translate(x + offsetX, y + NPC_HEIGHT / 2, z + offsetZ);
    applyVertexColors(geometry, color, 0, 0, 1);
    geometries.push(geometry);
    stats.props += 1;
  }

  private addForgeProps(
    geometries: THREE.BufferGeometry[],
    x: number,
    y: number,
    z: number,
    stats: BuildingStats,
  ): void {
    // Forge
    const forgeGeo = new THREE.BoxGeometry(FORGE_SIZE, FORGE_SIZE, FORGE_SIZE);
    forgeGeo.translate(x - CELL_SIZE / 4, y + FORGE_SIZE / 2, z);
    applyVertexColors(forgeGeo, palette.forge);
    geometries.push(forgeGeo);
    stats.props += 1;

    // Anvil
    const anvilGeo = new THREE.BoxGeometry(
      ANVIL_SIZE,
      ANVIL_SIZE * 0.6,
      ANVIL_SIZE * 1.5,
    );
    anvilGeo.translate(x + CELL_SIZE / 4, y + (ANVIL_SIZE * 0.6) / 2, z);
    applyVertexColors(anvilGeo, palette.anvil);
    geometries.push(anvilGeo);
    stats.props += 1;
  }
}

// Default instance for quick use
export const defaultGenerator = new BuildingGenerator();
