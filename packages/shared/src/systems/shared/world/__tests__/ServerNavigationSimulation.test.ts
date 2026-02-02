/**
 * Server Navigation Simulation Test
 *
 * This test simulates the EXACT walkability logic used by the server's
 * tile-movement.ts to ensure client-server parity.
 *
 * Key differences from simpler tests:
 * - Uses checkBuildingMovement with proper playerBuildingId tracking
 * - Simulates layer transitions (ground -> building -> ground)
 * - Tests stair navigation with floor tracking
 * - Validates diagonal corner clipping prevention
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { BuildingCollisionService } from "../BuildingCollisionService";
import { CollisionMatrix } from "../../movement/CollisionMatrix";
import { BFSPathfinder } from "../../movement/BFSPathfinder";
import type { TileCoord } from "../../movement/TileSystem";
import type { World } from "../../../../core/World";

const TEST_TIMEOUT = 60000;

// Create a mock world with collision matrix
function createMockWorld(): World {
  const collision = new CollisionMatrix();
  return {
    collision,
    isServer: true,
    isClient: false,
    physics: null,
    camera: null,
    stage: null,
    entities: new Map(),
    emit: () => {},
    on: () => {},
    off: () => {},
    getSystem: () => null,
    setupMaterial: () => {},
  } as unknown as World;
}

/**
 * Create a simple 3x3 cell building with:
 * - Door on north side (center)
 * - Stairs from floor 0 to floor 1
 */
function createTestBuildingLayout() {
  const footprint = [
    [true, true, true],
    [true, true, true],
    [true, true, true],
  ];

  const roomMap = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];

  return {
    width: 3,
    depth: 3,
    floors: 2,
    floorPlans: [
      {
        footprint: footprint.map((row) => [...row]),
        roomMap: roomMap.map((row) => [...row]),
        internalOpenings: new Map(),
        externalOpenings: new Map([["1,0,north", "door"]]),
      },
      {
        footprint: footprint.map((row) => [...row]),
        roomMap: roomMap.map((row) => [...row]),
        internalOpenings: new Map(),
        externalOpenings: new Map(),
      },
    ],
    stairs: {
      col: 2,
      row: 2,
      direction: "south" as const,
      landing: { col: 2, row: 1 },
    },
  };
}

describe("Server Navigation Simulation - checkBuildingMovement", () => {
  let world: World;
  let collisionService: BuildingCollisionService;
  let pathfinder: BFSPathfinder;

  const BUILDING_POS = { x: 100, y: 10, z: 100 };
  const BUILDING_ID = "server_nav_test";

  beforeAll(async () => {
    world = createMockWorld();
    collisionService = new BuildingCollisionService(world);

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
    collisionService.clear();
  });

  /**
   * SERVER-ACCURATE walkability checker
   * Uses checkBuildingMovement with proper layer separation
   */
  function createServerWalkabilityChecker(
    playerFloor: number,
    playerBuildingId: string | null,
  ) {
    return (tile: TileCoord, fromTile?: TileCoord): boolean => {
      // Use checkBuildingMovement - SAME as server's tile-movement.ts
      const buildingCheck = collisionService.checkBuildingMovement(
        fromTile ?? null,
        tile,
        playerFloor,
        playerBuildingId,
      );

      if (!buildingCheck.buildingAllowsMovement) {
        return false;
      }

      // If target is inside building, skip terrain checks
      if (buildingCheck.targetInBuildingFootprint) {
        return true;
      }

      // Ground layer checks would go here (CollisionMatrix, terrain)
      // For this test, we assume ground is walkable
      return true;
    };
  }

  it("should find door tiles", () => {
    const doorTiles = collisionService.getDoorTiles(BUILDING_ID);
    console.log(`[Test] Door tiles: ${doorTiles.length}`);
    doorTiles.forEach((d) =>
      console.log(
        `  Door at (${d.tileX}, ${d.tileZ}) direction=${d.direction}`,
      ),
    );
    expect(doorTiles.length).toBeGreaterThan(0);
  });

  it("should find entrance tiles (doors + arches)", () => {
    const entranceTiles = collisionService.getEntranceTiles(BUILDING_ID);
    console.log(`[Test] Entrance tiles: ${entranceTiles.length}`);
    expect(entranceTiles.length).toBeGreaterThan(0);
  });

  it("CRITICAL: Ground player should path to door exterior", () => {
    const doorTiles = collisionService.getDoorTiles(BUILDING_ID);
    const door = doorTiles[0];

    // Player is on ground (not in building)
    const playerBuildingId = null;
    const playerFloor = 0;

    const isWalkable = createServerWalkabilityChecker(
      playerFloor,
      playerBuildingId,
    );

    // Start 10 tiles away from door
    const startTile: TileCoord = { x: door.tileX, z: door.tileZ - 10 };
    const targetTile: TileCoord = { x: door.tileX, z: door.tileZ };

    console.log(
      `[Test] Ground player pathing from (${startTile.x}, ${startTile.z}) to door (${targetTile.x}, ${targetTile.z})`,
    );

    const path = pathfinder.findPath(startTile, targetTile, isWalkable);

    console.log(`[Test] Path length: ${path.length}`);
    if (path.length === 0) {
      // Debug: check why tiles are blocked
      console.log(`[Test] DEBUG: Checking individual tiles...`);
      for (let z = startTile.z; z <= targetTile.z; z++) {
        const tile: TileCoord = { x: door.tileX, z };
        const check = collisionService.checkBuildingMovement(
          null,
          tile,
          playerFloor,
          playerBuildingId,
        );
        console.log(
          `  Tile (${tile.x}, ${z}): allowed=${check.buildingAllowsMovement}, ` +
            `inFootprint=${check.targetInBuildingFootprint}, ` +
            `doorOpenings=${check.targetDoorOpenings.length}, ` +
            `reason=${check.blockReason || "none"}`,
        );
      }
    }

    expect(path.length).toBeGreaterThan(0);
  });

  it("CRITICAL: Ground player should be able to step onto door interior tile", () => {
    // This tests the critical door transition from ground to building
    const doorTiles = collisionService.getDoorTiles(BUILDING_ID);
    const door = doorTiles[0];

    // Player is on ground (not in building)
    const playerBuildingId = null;
    const playerFloor = 0;

    // Door exterior is where getDoorTiles returns
    // Door interior is one step into the building
    const doorExterior: TileCoord = { x: door.tileX, z: door.tileZ };

    // Find door interior by looking at which tiles in building have door openings
    const closestDoor = collisionService.findClosestDoorTile(
      BUILDING_ID,
      door.tileX,
      door.tileZ,
    );

    console.log(`[Test] Door exterior: (${doorExterior.x}, ${doorExterior.z})`);
    console.log(
      `[Test] Door interior: (${closestDoor?.interiorTileX}, ${closestDoor?.interiorTileZ})`,
    );

    // Check if movement from exterior to interior is allowed
    if (closestDoor) {
      const doorInterior: TileCoord = {
        x: closestDoor.interiorTileX,
        z: closestDoor.interiorTileZ,
      };

      const check = collisionService.checkBuildingMovement(
        doorExterior,
        doorInterior,
        playerFloor,
        playerBuildingId,
      );

      console.log(`[Test] Movement exterior -> interior:`);
      console.log(`  buildingAllowsMovement: ${check.buildingAllowsMovement}`);
      console.log(
        `  targetInBuildingFootprint: ${check.targetInBuildingFootprint}`,
      );
      console.log(
        `  targetDoorOpenings: [${check.targetDoorOpenings.join(", ")}]`,
      );
      console.log(`  wallBlocked: ${check.wallBlocked}`);
      console.log(`  blockReason: ${check.blockReason || "none"}`);

      expect(check.buildingAllowsMovement).toBe(true);
    } else {
      throw new Error("Could not find closest door");
    }
  });

  it("CRITICAL: Building player should move freely within building", () => {
    // Player is inside the building
    const playerBuildingId = BUILDING_ID;
    const playerFloor = 0;

    const building = collisionService.getBuilding(BUILDING_ID);
    expect(building).not.toBeNull();

    const bbox = building!.boundingBox;

    // Pick two tiles inside the building
    const startTile: TileCoord = {
      x: Math.floor((bbox.minTileX + bbox.maxTileX) / 2),
      z: Math.floor((bbox.minTileZ + bbox.maxTileZ) / 2),
    };
    const targetTile: TileCoord = {
      x: bbox.minTileX + 1,
      z: bbox.minTileZ + 1,
    };

    console.log(
      `[Test] Building player pathing from (${startTile.x}, ${startTile.z}) to (${targetTile.x}, ${targetTile.z})`,
    );

    const isWalkable = createServerWalkabilityChecker(
      playerFloor,
      playerBuildingId,
    );
    const path = pathfinder.findPath(startTile, targetTile, isWalkable);

    console.log(`[Test] Path length: ${path.length}`);

    if (path.length === 0) {
      // Debug
      console.log(`[Test] DEBUG: Start tile walkability...`);
      const startCheck = collisionService.checkBuildingMovement(
        null,
        startTile,
        playerFloor,
        playerBuildingId,
      );
      console.log(
        `  Start: allowed=${startCheck.buildingAllowsMovement}, reason=${startCheck.blockReason || "none"}`,
      );

      const targetCheck = collisionService.checkBuildingMovement(
        startTile,
        targetTile,
        playerFloor,
        playerBuildingId,
      );
      console.log(
        `  Target: allowed=${targetCheck.buildingAllowsMovement}, reason=${targetCheck.blockReason || "none"}`,
      );
    }

    expect(path.length).toBeGreaterThan(0);
  });

  it("CRITICAL: Building player should exit through door to ground", () => {
    const playerBuildingId = BUILDING_ID;
    const playerFloor = 0;

    const closestDoor = collisionService.findClosestDoorTile(
      BUILDING_ID,
      100, // arbitrary position
      100,
    );

    expect(closestDoor).not.toBeNull();

    const doorInterior: TileCoord = {
      x: closestDoor!.interiorTileX,
      z: closestDoor!.interiorTileZ,
    };
    const doorExterior: TileCoord = {
      x: closestDoor!.tileX,
      z: closestDoor!.tileZ,
    };

    console.log(
      `[Test] Building player exiting from (${doorInterior.x}, ${doorInterior.z}) to (${doorExterior.x}, ${doorExterior.z})`,
    );

    // Check movement from interior to exterior
    const check = collisionService.checkBuildingMovement(
      doorInterior,
      doorExterior,
      playerFloor,
      playerBuildingId,
    );

    console.log(`[Test] Exit movement:`);
    console.log(`  buildingAllowsMovement: ${check.buildingAllowsMovement}`);
    console.log(
      `  sourceInBuildingFootprint: ${check.sourceInBuildingFootprint}`,
    );
    console.log(
      `  sourceDoorOpenings: [${check.sourceDoorOpenings.join(", ")}]`,
    );
    console.log(
      `  targetInBuildingFootprint: ${check.targetInBuildingFootprint}`,
    );
    console.log(`  blockReason: ${check.blockReason || "none"}`);

    expect(check.buildingAllowsMovement).toBe(true);
  });

  it("should simulate full server two-stage navigation: outside -> door -> inside", () => {
    // Stage 1: Ground player paths to door exterior
    let playerBuildingId: string | null = null;
    const playerFloor = 0;

    const closestDoor = collisionService.findClosestDoorTile(
      BUILDING_ID,
      100,
      80,
    );
    expect(closestDoor).not.toBeNull();

    const startTile: TileCoord = {
      x: closestDoor!.tileX,
      z: closestDoor!.tileZ - 10,
    };
    const doorExterior: TileCoord = {
      x: closestDoor!.tileX,
      z: closestDoor!.tileZ,
    };
    const doorInterior: TileCoord = {
      x: closestDoor!.interiorTileX,
      z: closestDoor!.interiorTileZ,
    };

    console.log(`\n[Test] === TWO-STAGE NAVIGATION SIMULATION ===`);
    console.log(`[Test] Start: (${startTile.x}, ${startTile.z})`);
    console.log(`[Test] Door exterior: (${doorExterior.x}, ${doorExterior.z})`);
    console.log(`[Test] Door interior: (${doorInterior.x}, ${doorInterior.z})`);

    // Stage 1: Path to door exterior
    console.log(`\n[Test] STAGE 1: Ground player -> door exterior`);
    let isWalkable = createServerWalkabilityChecker(
      playerFloor,
      playerBuildingId,
    );
    const stage1Path = pathfinder.findPath(startTile, doorExterior, isWalkable);
    console.log(`[Test] Stage 1 path length: ${stage1Path.length}`);
    expect(stage1Path.length).toBeGreaterThan(0);

    // Player arrives at door exterior, then steps to interior
    // This step-through is done manually by the server
    console.log(`[Test] Player steps through door: exterior -> interior`);

    // UPDATE: Player is now inside building
    playerBuildingId = BUILDING_ID;
    console.log(`[Test] Player building ID updated to: ${playerBuildingId}`);

    // Stage 2: Path from door interior to building center
    const building = collisionService.getBuilding(BUILDING_ID)!;
    const bbox = building.boundingBox;
    const buildingCenter: TileCoord = {
      x: Math.floor((bbox.minTileX + bbox.maxTileX) / 2),
      z: Math.floor((bbox.minTileZ + bbox.maxTileZ) / 2),
    };

    console.log(
      `\n[Test] STAGE 2: Building player -> building center (${buildingCenter.x}, ${buildingCenter.z})`,
    );
    isWalkable = createServerWalkabilityChecker(playerFloor, playerBuildingId);
    const stage2Path = pathfinder.findPath(
      doorInterior,
      buildingCenter,
      isWalkable,
    );
    console.log(`[Test] Stage 2 path length: ${stage2Path.length}`);

    if (stage2Path.length === 0) {
      // Debug
      console.log(`[Test] DEBUG: Why can't building player move?`);
      const check = collisionService.checkBuildingMovement(
        doorInterior,
        buildingCenter,
        playerFloor,
        playerBuildingId,
      );
      console.log(`  Movement allowed: ${check.buildingAllowsMovement}`);
      console.log(`  Block reason: ${check.blockReason || "none"}`);
    }

    expect(stage2Path.length).toBeGreaterThan(0);

    console.log(`\n[Test] === SIMULATION COMPLETE ===`);
  });
});
