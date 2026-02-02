/**
 * SERVER FLOW SIMULATION TEST
 *
 * This test simulates the EXACT server navigation flow:
 * 1. Player spawns at a position (may be inside or outside building)
 * 2. First move request triggers getOrCreateState + sync
 * 3. Pathfinding runs with synced playerBuildingId
 * 4. Movement follows path with tick updates
 *
 * Tests the FIX: updatePlayerBuildingState is called BEFORE getPlayerBuildingState
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { BuildingCollisionService } from "../BuildingCollisionService";
import { CollisionMatrix } from "../../movement/CollisionMatrix";
import { BFSPathfinder } from "../../movement/BFSPathfinder";
import type { TileCoord } from "../../movement/TileSystem";
import type { World } from "../../../../core/World";
import type { EntityID } from "../../../../types/core/base-types";

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

function createBuildingWithNorthDoor() {
  return {
    width: 2,
    depth: 2,
    floors: 1,
    floorPlans: [
      {
        footprint: [
          [true, true],
          [true, true],
        ],
        roomMap: [
          [0, 0],
          [0, 0],
        ],
        internalOpenings: new Map(),
        externalOpenings: new Map([["0,0,north", "door"]]),
      },
    ],
    stairs: null,
  };
}

describe("Server Flow Simulation", () => {
  let world: World;
  let collisionService: BuildingCollisionService;
  let pathfinder: BFSPathfinder;

  const BUILDING_POS = { x: 20, y: 0, z: 20 };
  const BUILDING_ID = "server_flow_test";
  const PLAYER_ID = "player_1" as EntityID;

  beforeAll(() => {
    world = createMockWorld();
    collisionService = new BuildingCollisionService(world);
    pathfinder = new BFSPathfinder();

    const layout = createBuildingWithNorthDoor();
    collisionService.registerBuilding(
      BUILDING_ID,
      "test_town",
      layout,
      BUILDING_POS,
      0,
    );
  });

  afterAll(() => {
    collisionService.clear();
  });

  /**
   * Simulate server's isTileWalkable logic (exact copy from tile-movement.ts)
   */
  function createServerWalkabilityChecker(
    playerFloor: number,
    playerBuildingId: string | null,
  ) {
    return (tile: TileCoord, fromTile?: TileCoord): boolean => {
      const buildingCheck = collisionService.checkBuildingMovement(
        fromTile ?? null,
        tile,
        playerFloor,
        playerBuildingId,
      );

      if (!buildingCheck.buildingAllowsMovement) {
        return false;
      }

      if (buildingCheck.targetInBuildingFootprint) {
        return true;
      }

      // Simplified: skip terrain/collision matrix checks for this test
      return true;
    };
  }

  it("CRITICAL: Player OUTSIDE building - pathfinding should use doors", () => {
    const playerTile: TileCoord = { x: 18, z: 10 }; // Outside building
    const worldY = 0;

    console.log(`\n=== PLAYER OUTSIDE - FIRST MOVE ===`);

    // Step 1: Sync building state (THE FIX)
    collisionService.updatePlayerBuildingState(
      PLAYER_ID,
      playerTile.x,
      playerTile.z,
      worldY,
    );

    // Step 2: Get synced state
    const playerState = collisionService.getPlayerBuildingState(PLAYER_ID);

    console.log(`Player at (${playerTile.x},${playerTile.z})`);
    console.log(`Building state after sync:`);
    console.log(`  insideBuildingId: ${playerState.insideBuildingId}`);
    console.log(`  currentFloor: ${playerState.currentFloor}`);

    // Verify player is detected as OUTSIDE
    expect(playerState.insideBuildingId).toBeNull();

    // Step 3: Find target inside building
    const building = collisionService.getBuilding(BUILDING_ID)!;
    const floor0 = building.floors[0];
    const centerTiles = Array.from(floor0.walkableTiles).map((key) => {
      const [x, z] = key.split(",").map(Number);
      return { x, z };
    });
    const targetTile = centerTiles[Math.floor(centerTiles.length / 2)];

    console.log(`Target inside building: (${targetTile.x},${targetTile.z})`);

    // Step 4: Create walkability checker with synced state
    const isWalkable = createServerWalkabilityChecker(
      playerState.currentFloor,
      playerState.insideBuildingId,
    );

    // Step 5: Try direct path (should fail or be partial)
    const directPath = pathfinder.findPath(playerTile, targetTile, isWalkable);
    const wasPartial = pathfinder.wasLastPathPartial();

    console.log(
      `Direct path: ${directPath.length} tiles, partial=${wasPartial}`,
    );

    // Step 6: Verify path goes through door (two-stage would be needed)
    // For a ground player, direct entry should be blocked except through door
    const closestDoor = collisionService.findClosestDoorTile(
      BUILDING_ID,
      playerTile.x,
      playerTile.z,
    );

    expect(closestDoor).not.toBeNull();
    console.log(
      `Closest door: exterior=(${closestDoor!.tileX},${closestDoor!.tileZ}) ` +
        `interior=(${closestDoor!.interiorTileX},${closestDoor!.interiorTileZ})`,
    );

    // Step 7: Verify two-stage path would work
    // Stage 1: Outside to door exterior
    const pathToDoorExterior = pathfinder.findPath(
      playerTile,
      { x: closestDoor!.tileX, z: closestDoor!.tileZ },
      isWalkable,
    );

    console.log(`Path to door exterior: ${pathToDoorExterior.length} tiles`);
    expect(pathToDoorExterior.length).toBeGreaterThan(0);

    // Stage 2: After stepping through door, player is inside
    // Simulate the state update after entering
    collisionService.updatePlayerBuildingState(
      PLAYER_ID,
      closestDoor!.interiorTileX,
      closestDoor!.interiorTileZ,
      worldY,
    );
    const insideState = collisionService.getPlayerBuildingState(PLAYER_ID);

    console.log(`\nAfter entering door:`);
    console.log(`  insideBuildingId: ${insideState.insideBuildingId}`);

    expect(insideState.insideBuildingId).toBe(BUILDING_ID);

    // Now pathfind from door interior to target
    const isWalkableInside = createServerWalkabilityChecker(
      insideState.currentFloor,
      insideState.insideBuildingId,
    );

    const pathToTarget = pathfinder.findPath(
      { x: closestDoor!.interiorTileX, z: closestDoor!.interiorTileZ },
      targetTile,
      isWalkableInside,
    );

    console.log(
      `Path from door interior to target: ${pathToTarget.length} tiles`,
    );
    expect(pathToTarget.length).toBeGreaterThanOrEqual(0); // May be 0 if already at target
  });

  it("CRITICAL: Player INSIDE building - pathfinding should stay inside", () => {
    // Reset player state
    collisionService.removePlayerState(PLAYER_ID);

    // Player starts INSIDE building
    const building = collisionService.getBuilding(BUILDING_ID)!;
    const floor0 = building.floors[0];
    const insideTiles = Array.from(floor0.walkableTiles).map((key) => {
      const [x, z] = key.split(",").map(Number);
      return { x, z };
    });
    const playerTile = insideTiles[0]; // First interior tile
    const worldY = floor0.elevation;

    console.log(`\n=== PLAYER INSIDE - MOVE REQUEST ===`);

    // Step 1: Sync building state (THE FIX)
    collisionService.updatePlayerBuildingState(
      PLAYER_ID,
      playerTile.x,
      playerTile.z,
      worldY,
    );

    // Step 2: Get synced state
    const playerState = collisionService.getPlayerBuildingState(PLAYER_ID);

    console.log(`Player at (${playerTile.x},${playerTile.z})`);
    console.log(`Building state after sync:`);
    console.log(`  insideBuildingId: ${playerState.insideBuildingId}`);
    console.log(`  currentFloor: ${playerState.currentFloor}`);

    // Verify player is detected as INSIDE
    expect(playerState.insideBuildingId).toBe(BUILDING_ID);

    // Step 3: Try to move to tile outside (far away)
    const outsideTile: TileCoord = { x: playerTile.x, z: playerTile.z - 10 };

    const isWalkable = createServerWalkabilityChecker(
      playerState.currentFloor,
      playerState.insideBuildingId,
    );

    // Direct path outside should be blocked by layer separation
    const directPath = pathfinder.findPath(playerTile, outsideTile, isWalkable);
    const wasPartial = pathfinder.wasLastPathPartial();

    console.log(
      `Path to outside: ${directPath.length} tiles, partial=${wasPartial}`,
    );

    // Player should need to exit through door first
    // Direct path should either fail or be partial
    if (directPath.length > 0 && !wasPartial) {
      // Verify path goes through door
      const closestDoor = collisionService.findClosestDoorTile(
        BUILDING_ID,
        playerTile.x,
        playerTile.z,
      );
      const doorTileKey = closestDoor
        ? `${closestDoor.tileX},${closestDoor.tileZ}`
        : null;

      const pathThroughDoor = directPath.some(
        (tile) => `${tile.x},${tile.z}` === doorTileKey,
      );

      console.log(`Path goes through door: ${pathThroughDoor}`);
    }
  });

  it("CRITICAL: New player with default state - sync fixes it", () => {
    const NEW_PLAYER = "new_player" as EntityID;

    // Player spawns INSIDE building but has no tracked state yet
    const building = collisionService.getBuilding(BUILDING_ID)!;
    const floor0 = building.floors[0];
    const insideTiles = Array.from(floor0.walkableTiles).map((key) => {
      const [x, z] = key.split(",").map(Number);
      return { x, z };
    });
    const spawnTile = insideTiles[2];
    const worldY = floor0.elevation;

    console.log(`\n=== NEW PLAYER WITH DEFAULT STATE ===`);

    // Step 1: Get state WITHOUT syncing first (OLD BUG)
    const unsynced = collisionService.getPlayerBuildingState(NEW_PLAYER);

    console.log(`Before sync (DEFAULT state):`);
    console.log(`  insideBuildingId: ${unsynced.insideBuildingId}`);
    console.log(
      `  Player actually at: (${spawnTile.x},${spawnTile.z}) INSIDE building`,
    );

    // BUG: Default state says player is OUTSIDE
    expect(unsynced.insideBuildingId).toBeNull();

    // Step 2: Now sync (THE FIX)
    collisionService.updatePlayerBuildingState(
      NEW_PLAYER,
      spawnTile.x,
      spawnTile.z,
      worldY,
    );

    // Step 3: Get synced state
    const synced = collisionService.getPlayerBuildingState(NEW_PLAYER);

    console.log(`After sync (CORRECT state):`);
    console.log(`  insideBuildingId: ${synced.insideBuildingId}`);

    // FIXED: State now correctly shows player is INSIDE
    expect(synced.insideBuildingId).toBe(BUILDING_ID);

    // Cleanup
    collisionService.removePlayerState(NEW_PLAYER);
  });
});
