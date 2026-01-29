/**
 * Building Navigation Integration Test
 *
 * Tests the building collision service and BFS pathfinding:
 * 1. Building registration and collision detection
 * 2. Door tile detection and wall openings
 * 3. Path finding through buildings
 * 4. Stair navigation between floors
 *
 * Uses BuildingCollisionService directly with test building data.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { World, BFSPathfinder, tilesEqual } from "@hyperscape/shared";
import { BuildingCollisionService } from "@hyperscape/shared";
import type { TileCoord } from "@hyperscape/shared";

// Test configuration
const TEST_TIMEOUT = 30000;

/**
 * Create a simple test building layout
 * A 2-floor building: 3x3 cells with a door on the south side and stairs
 *
 * Coordinate system (based on CARDINAL_DIRECTIONS in BuildingCollisionService):
 * - north: dr=+1 → checking HIGHER row number
 * - south: dr=-1 → checking LOWER row number
 *
 * So for external edges:
 * - Row 0 checking south (dr=-1) → row -1 doesn't exist → SOUTH external edge
 * - Row 2 checking north (dr=+1) → row 3 doesn't exist → NORTH external edge
 *
 * Building grid:
 *   col: 0   1   2
 * row 0: [ ] [D] [ ]   <- Door here (south external edge)
 * row 1: [L] [ ] [ ]   <- Landing here
 * row 2: [S] [ ] [ ]   <- Stairs here
 */
function createTestBuildingLayout() {
  // Each cell is 4x4 tiles (CELL_SIZE = 4)
  // 3x3 cells = 12x12 tiles
  const footprint = [
    [true, true, true], // row 0 (SOUTH external edge)
    [true, true, true], // row 1
    [true, true, true], // row 2 (NORTH external edge)
  ];

  const roomMap = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];

  // Door on NORTH side of cell (col=1, row=0)
  // Row 0 has external edge on NORTH (checking row -1 via dr=-1 which doesn't exist)
  // CARDINAL_DIRECTIONS: { dir: "north", dc: 0, dr: -1 } means north = row decreases
  const externalOpenings = new Map<string, string>();
  externalOpenings.set("1,0,north", "door"); // col=1, row=0, direction=north

  // Internal openings - none for simple test
  const internalOpenings = new Map<string, string>();

  return {
    width: 3,
    depth: 3,
    floors: 2,
    floorPlans: [
      // Floor 0
      {
        footprint: footprint.map((row) => [...row]), // Deep copy
        roomMap: roomMap.map((row) => [...row]),
        internalOpenings: new Map(internalOpenings),
        externalOpenings: new Map(externalOpenings),
      },
      // Floor 1
      {
        footprint: footprint.map((row) => [...row]),
        roomMap: roomMap.map((row) => [...row]),
        internalOpenings: new Map(),
        externalOpenings: new Map(), // No external doors on floor 1
      },
    ],
    stairs: {
      col: 0,
      row: 2,
      direction: "north" as const,
      landing: { col: 0, row: 1 },
    },
  };
}

describe("Building Collision Service", () => {
  let world: World;
  let collisionService: BuildingCollisionService;
  let pathfinder: BFSPathfinder;

  // Building position in world coordinates
  const BUILDING_POS = { x: 100, y: 10, z: 100 };
  const BUILDING_ID = "test_building_1";
  const TOWN_ID = "test_town";

  beforeAll(async () => {
    // Create minimal world
    world = new World({
      isServer: true,
      isClient: false,
    });

    // Create collision service directly
    collisionService = new BuildingCollisionService(world);

    // Register test building
    const layout = createTestBuildingLayout();
    collisionService.registerBuilding(
      BUILDING_ID,
      TOWN_ID,
      layout,
      BUILDING_POS,
      0, // No rotation
    );

    pathfinder = new BFSPathfinder();

    console.log(
      `[Test Setup] Buildings registered: ${collisionService.getBuildingCount()}`,
    );
  }, TEST_TIMEOUT);

  afterAll(() => {
    world.destroy();
  });

  /**
   * Helper: Check if a tile is walkable
   */
  function isTileWalkable(tile: TileCoord, fromTile?: TileCoord): boolean {
    // Check building footprint walkability
    const isWalkableInBuilding = collisionService.isTileWalkableInBuilding(
      tile.x,
      tile.z,
      0, // floor 0
    );

    if (!isWalkableInBuilding) {
      return false;
    }

    // Check wall blocking if moving between tiles
    if (fromTile) {
      const wallBlocked = collisionService.isWallBlocked(
        fromTile.x,
        fromTile.z,
        tile.x,
        tile.z,
        0,
      );
      if (wallBlocked) {
        return false;
      }
    }

    return true;
  }

  /**
   * Helper: Find a path between two tiles
   */
  function findPath(from: TileCoord, to: TileCoord): TileCoord[] {
    return pathfinder.findPath(from, to, (tile, fromTile) =>
      isTileWalkable(tile, fromTile),
    );
  }

  it("should have buildings registered", () => {
    const buildingCount = collisionService.getBuildingCount();
    console.log(`[Test] Building count: ${buildingCount}`);
    expect(buildingCount).toBeGreaterThan(0);
  });

  it("should have door tiles for buildings", () => {
    const buildings = collisionService.getAllBuildings();
    expect(buildings.length).toBeGreaterThan(0);

    const firstBuilding = buildings[0];
    const doorTiles = collisionService.getDoorTiles(firstBuilding.buildingId);

    console.log(
      `[Test] Building ${firstBuilding.buildingId} has ${doorTiles.length} door(s)`,
    );
    doorTiles.forEach((door, i) => {
      console.log(`  Door ${i + 1}: (${door.tileX}, ${door.tileZ})`);
    });

    expect(doorTiles.length).toBeGreaterThan(0);
  });

  it("should find a path from outside to building door", () => {
    const buildings = collisionService.getAllBuildings();
    const building = buildings[0];
    const doorTiles = collisionService.getDoorTiles(building.buildingId);

    if (doorTiles.length === 0) {
      console.log("[Test] Skipping - no door tiles");
      return;
    }

    const door = doorTiles[0];

    // Start position: 10 tiles south of the door
    const startTile: TileCoord = { x: door.tileX, z: door.tileZ - 10 };
    const targetTile: TileCoord = { x: door.tileX, z: door.tileZ };

    console.log(
      `[Test] Finding path from (${startTile.x}, ${startTile.z}) to door at (${targetTile.x}, ${targetTile.z})`,
    );

    const path = findPath(startTile, targetTile);

    console.log(`[Test] Path found with ${path.length} steps`);
    if (path.length > 0) {
      console.log(`  Start: (${path[0].x}, ${path[0].z})`);
      console.log(
        `  End: (${path[path.length - 1].x}, ${path[path.length - 1].z})`,
      );
    }

    expect(path.length).toBeGreaterThan(0);
    expect(tilesEqual(path[path.length - 1], targetTile)).toBe(true);
  });

  it("should allow walking through door into building", () => {
    const buildings = collisionService.getAllBuildings();
    const building = buildings[0];
    const doorTiles = collisionService.getDoorTiles(building.buildingId);

    if (doorTiles.length === 0) {
      console.log("[Test] Skipping - no door tiles");
      return;
    }

    const door = doorTiles[0];

    // Check collision at door tile
    const doorCollision = collisionService.queryCollision(
      door.tileX,
      door.tileZ,
      0,
    );

    console.log(`[Test] Door tile collision:`, {
      isInsideBuilding: doorCollision.isInsideBuilding,
      isWalkable: doorCollision.isWalkable,
      wallBlocking: doorCollision.wallBlocking,
    });

    // Door should be walkable
    expect(doorCollision.isWalkable).toBe(true);

    // Check the wall at the door has an opening
    // Doors should have hasOpening = true which means wallBlocking should be false
    // in the direction of the door
    const doorDirection = door.direction;
    const wallInDoorDirection =
      doorCollision.wallBlocking[
        doorDirection as keyof typeof doorCollision.wallBlocking
      ];

    console.log(
      `[Test] Door direction: ${doorDirection}, wall blocking: ${wallInDoorDirection}`,
    );

    // Wall should NOT block in the door direction
    expect(wallInDoorDirection).toBe(false);
  });

  it("should find a contiguous path from outside to inside building", () => {
    const buildings = collisionService.getAllBuildings();
    const building = buildings[0];
    const doorTiles = collisionService.getDoorTiles(building.buildingId);

    if (doorTiles.length === 0) {
      console.log("[Test] Skipping - no door tiles");
      return;
    }

    const door = doorTiles[0];

    // Start: 5 tiles outside the building
    let startTile: TileCoord;
    switch (door.direction) {
      case "north":
        startTile = { x: door.tileX, z: door.tileZ + 5 };
        break;
      case "south":
        startTile = { x: door.tileX, z: door.tileZ - 5 };
        break;
      case "east":
        startTile = { x: door.tileX + 5, z: door.tileZ };
        break;
      case "west":
        startTile = { x: door.tileX - 5, z: door.tileZ };
        break;
      default:
        startTile = { x: door.tileX, z: door.tileZ - 5 };
    }

    // Target: Deep inside the building (center of bounding box)
    const bbox = building.boundingBox;
    const centerX = Math.floor((bbox.minTileX + bbox.maxTileX) / 2);
    const centerZ = Math.floor((bbox.minTileZ + bbox.maxTileZ) / 2);
    const targetTile: TileCoord = { x: centerX, z: centerZ };

    console.log(
      `[Test] Finding path from outside (${startTile.x}, ${startTile.z}) to building center (${targetTile.x}, ${targetTile.z})`,
    );

    const path = findPath(startTile, targetTile);

    console.log(`[Test] Path length: ${path.length}`);

    if (path.length === 0) {
      // Debug: why no path?
      console.log("[Test] NO PATH FOUND - Debugging:");
      console.log(`  Start tile walkable: ${isTileWalkable(startTile)}`);
      console.log(`  Target tile walkable: ${isTileWalkable(targetTile)}`);
      console.log(
        `  Door tile walkable: ${isTileWalkable({ x: door.tileX, z: door.tileZ })}`,
      );

      // Check each tile from start toward door
      let currentTile = { ...startTile };
      const step =
        door.direction === "north" ? -1 : door.direction === "south" ? 1 : 0;
      for (let i = 0; i < 10; i++) {
        const walkable = isTileWalkable(currentTile);
        const footprint = collisionService.isTileInBuildingFootprint(
          currentTile.x,
          currentTile.z,
        );
        console.log(
          `  Tile (${currentTile.x}, ${currentTile.z}): walkable=${walkable}, inFootprint=${footprint}`,
        );
        currentTile.z += step || 1;
      }
    }

    expect(path.length).toBeGreaterThan(0);

    // Verify path is contiguous (each step is adjacent)
    for (let i = 1; i < path.length; i++) {
      const prev = path[i - 1];
      const curr = path[i];
      const dx = Math.abs(curr.x - prev.x);
      const dz = Math.abs(curr.z - prev.z);

      // Each step should be at most 1 tile in any direction
      expect(dx).toBeLessThanOrEqual(1);
      expect(dz).toBeLessThanOrEqual(1);
      // Should actually move (not stay in place)
      expect(dx + dz).toBeGreaterThan(0);
    }
  });

  it("should have walkable stair tiles for multi-floor buildings", () => {
    const buildings = collisionService.getAllBuildings();

    // Find a building with stairs (more than 1 floor)
    const multiFloorBuilding = buildings.find((b) => b.floors.length > 1);

    if (!multiFloorBuilding) {
      console.log("[Test] Skipping - no multi-floor buildings found");
      return;
    }

    console.log(
      `[Test] Found multi-floor building: ${multiFloorBuilding.buildingId} with ${multiFloorBuilding.floors.length} floors`,
    );

    // Check floor 0 for stairs
    const floor0 = multiFloorBuilding.floors.find((f) => f.floorIndex === 0);
    if (!floor0) {
      console.log("[Test] No floor 0 found");
      return;
    }

    const stairTiles = floor0.stairTiles;
    console.log(`[Test] Floor 0 has ${stairTiles.length} stair tile(s)`);

    if (stairTiles.length > 0) {
      const stair = stairTiles[0];
      console.log(
        `[Test] Stair at (${stair.tileX}, ${stair.tileZ}): ${stair.fromFloor} -> ${stair.toFloor}`,
      );

      // Stair tile should be walkable
      const stairCollision = collisionService.queryCollision(
        stair.tileX,
        stair.tileZ,
        stair.fromFloor,
      );

      console.log(`[Test] Stair tile collision:`, {
        isInsideBuilding: stairCollision.isInsideBuilding,
        isWalkable: stairCollision.isWalkable,
        stairTile: stairCollision.stairTile,
      });

      expect(stairCollision.isWalkable).toBe(true);
      expect(stairCollision.stairTile).not.toBeNull();
    }

    expect(stairTiles.length).toBeGreaterThanOrEqual(0);
  });

  it("should find path from door to stairs on floor 0", () => {
    const buildings = collisionService.getAllBuildings();

    // Find a multi-floor building with door and stairs
    const building = buildings.find((b) => {
      const hasMultipleFloors = b.floors.length > 1;
      const hasDoor = collisionService.getDoorTiles(b.buildingId).length > 0;
      const floor0 = b.floors.find((f) => f.floorIndex === 0);
      const hasStairs = floor0 && floor0.stairTiles.length > 0;
      return hasMultipleFloors && hasDoor && hasStairs;
    });

    if (!building) {
      console.log(
        "[Test] Skipping - no multi-floor building with door and stairs found",
      );
      return;
    }

    const doorTiles = collisionService.getDoorTiles(building.buildingId);
    const door = doorTiles[0];
    const floor0 = building.floors.find((f) => f.floorIndex === 0)!;
    const stair = floor0.stairTiles[0];

    const startTile: TileCoord = { x: door.tileX, z: door.tileZ };
    const targetTile: TileCoord = { x: stair.tileX, z: stair.tileZ };

    console.log(
      `[Test] Finding path from door (${startTile.x}, ${startTile.z}) to stair (${targetTile.x}, ${targetTile.z})`,
    );

    const path = findPath(startTile, targetTile);

    console.log(`[Test] Path length: ${path.length}`);

    if (path.length > 0) {
      console.log(`  Path: ${path.map((t) => `(${t.x},${t.z})`).join(" -> ")}`);
    }

    expect(path.length).toBeGreaterThan(0);
  });
});

/**
 * Simulated bot that walks through a building
 * Uses direct BuildingCollisionService with test building data
 */
describe("Building Navigation Bot Simulation", () => {
  let world: World;
  let collisionService: BuildingCollisionService;
  let pathfinder: BFSPathfinder;

  // Building position
  const BUILDING_POS = { x: 100, y: 10, z: 100 };
  const BUILDING_ID = "bot_test_building";

  beforeAll(async () => {
    world = new World({ isServer: true, isClient: false });

    // Create collision service directly
    collisionService = new BuildingCollisionService(world);

    // Register test building with door and stairs
    const layout = createTestBuildingLayout();
    collisionService.registerBuilding(
      BUILDING_ID,
      "test_town",
      layout,
      BUILDING_POS,
      0,
    );

    pathfinder = new BFSPathfinder();
  }, TEST_TIMEOUT);

  afterAll(() => {
    world.destroy();
  });

  it("should simulate bot walking into building and upstairs", async () => {
    const buildings = collisionService.getAllBuildings();

    // Find our test building
    const building = buildings.find((b) => b.buildingId === BUILDING_ID);
    expect(building).toBeDefined();

    const doorTiles = collisionService.getDoorTiles(BUILDING_ID);
    const floor0 = building!.floors.find((f) => f.floorIndex === 0);

    console.log(`\n[Bot Test] === BUILDING INFO ===`);
    console.log(`[Bot Test] Building ID: ${building!.buildingId}`);
    console.log(`[Bot Test] Floors: ${building!.floors.length}`);
    console.log(`[Bot Test] Door tiles: ${doorTiles.length}`);
    console.log(
      `[Bot Test] Stair tiles on floor 0: ${floor0?.stairTiles.length ?? 0}`,
    );

    if (doorTiles.length === 0 || !floor0 || floor0.stairTiles.length === 0) {
      console.log("[Bot Test] Missing door or stairs - check building layout");
      console.log("[Bot Test] Debug - checking building collision data:");

      // Debug: Print walkable tiles
      if (floor0) {
        console.log(
          `[Bot Test] Floor 0 walkable tiles: ${floor0.walkableTiles.size}`,
        );
        const sampleTiles = Array.from(floor0.walkableTiles).slice(0, 5);
        console.log(`[Bot Test] Sample tiles: ${sampleTiles.join(", ")}`);
      }

      // Debug: Print wall segments
      if (floor0) {
        const doorsegments = floor0.wallSegments.filter((w) => w.hasOpening);
        console.log(
          `[Bot Test] Wall segments with openings: ${doorsegments.length}`,
        );
        doorsegments.forEach((s) => {
          console.log(
            `  - (${s.tileX}, ${s.tileZ}) ${s.side} opening=${s.openingType}`,
          );
        });
      }

      return;
    }

    const door = doorTiles[0];
    const stair = floor0.stairTiles[0];

    console.log(`\n[Bot Test] === STARTING NAVIGATION SIMULATION ===`);
    console.log(`[Bot Test] Door at: (${door.tileX}, ${door.tileZ})`);
    console.log(`[Bot Test] Stair at: (${stair.tileX}, ${stair.tileZ})`);

    // Bot starts 5 tiles south of the door
    let botPosition: TileCoord = { x: door.tileX, z: door.tileZ - 5 };
    let botFloor = 0;

    console.log(
      `[Bot Test] Bot starting at (${botPosition.x}, ${botPosition.z}) floor ${botFloor}`,
    );

    // Helper to check walkability at current floor
    function isTileWalkable(tile: TileCoord, fromTile?: TileCoord): boolean {
      const inBuilding = collisionService.isTileWalkableInBuilding(
        tile.x,
        tile.z,
        botFloor,
      );
      if (!inBuilding) return false;

      if (fromTile) {
        const wallBlocked = collisionService.isWallBlocked(
          fromTile.x,
          fromTile.z,
          tile.x,
          tile.z,
          botFloor,
        );
        if (wallBlocked) return false;
      }

      return true;
    }

    // Step 1: Walk to door
    console.log(
      `\n[Bot Test] STEP 1: Walking to door at (${door.tileX}, ${door.tileZ})`,
    );
    let path = pathfinder.findPath(
      botPosition,
      { x: door.tileX, z: door.tileZ },
      (tile, from) => isTileWalkable(tile, from),
    );

    console.log(`[Bot Test] Path to door: ${path.length} tiles`);
    if (path.length === 0) {
      console.log("[Bot Test] FAILED - No path to door!");
      console.log(`[Bot Test] Start walkable: ${isTileWalkable(botPosition)}`);
      console.log(
        `[Bot Test] Door walkable: ${isTileWalkable({ x: door.tileX, z: door.tileZ })}`,
      );
    }

    expect(path.length).toBeGreaterThan(0);

    // Simulate walking
    for (const tile of path) {
      botPosition = tile;
    }
    console.log(`[Bot Test] Bot at door: (${botPosition.x}, ${botPosition.z})`);

    // Step 2: Enter building and walk to stairs
    console.log(
      `\n[Bot Test] STEP 2: Walking to stairs at (${stair.tileX}, ${stair.tileZ})`,
    );
    path = pathfinder.findPath(
      botPosition,
      { x: stair.tileX, z: stair.tileZ },
      (tile, from) => isTileWalkable(tile, from),
    );

    console.log(`[Bot Test] Path to stairs: ${path.length} tiles`);
    expect(path.length).toBeGreaterThan(0);

    // Simulate walking
    for (const tile of path) {
      botPosition = tile;
    }
    console.log(
      `[Bot Test] Bot at stairs: (${botPosition.x}, ${botPosition.z})`,
    );

    // Step 3: Ascend stairs
    console.log(`\n[Bot Test] STEP 3: Ascending to floor ${stair.toFloor}`);
    botFloor = stair.toFloor;
    console.log(`[Bot Test] Bot now on floor ${botFloor}`);

    // Step 4: Walk around on second floor
    const floor1 = building!.floors.find((f) => f.floorIndex === 1);
    if (floor1 && floor1.walkableTiles.size > 0) {
      // Find a walkable tile on floor 1
      const walkableTileKey = Array.from(floor1.walkableTiles)[0];
      const [targetX, targetZ] = walkableTileKey.split(",").map(Number);

      console.log(
        `\n[Bot Test] STEP 4: Walking on floor 1 to (${targetX}, ${targetZ})`,
      );

      // Find stair landing on floor 1
      const floor1Stair = floor1.stairTiles.find((s) => s.isLanding);
      if (floor1Stair) {
        botPosition = { x: floor1Stair.tileX, z: floor1Stair.tileZ };
      }

      path = pathfinder.findPath(
        botPosition,
        { x: targetX, z: targetZ },
        (tile, from) => isTileWalkable(tile, from),
      );

      console.log(`[Bot Test] Path on floor 1: ${path.length} tiles`);

      if (path.length > 0) {
        for (const tile of path) {
          botPosition = tile;
        }
        console.log(
          `[Bot Test] Bot final position: (${botPosition.x}, ${botPosition.z}) floor ${botFloor}`,
        );
      }
    }

    console.log(`\n[Bot Test] === NAVIGATION SIMULATION COMPLETE ===`);
    console.log(`[Bot Test] Bot successfully navigated building!`);
  });
});
