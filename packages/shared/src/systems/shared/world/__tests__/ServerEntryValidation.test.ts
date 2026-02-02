/**
 * SERVER ENTRY VALIDATION TEST
 *
 * This test validates that the server's checkBuildingMovement correctly
 * allows door entry from the CORRECT direction and blocks from wrong directions.
 *
 * Specifically tests:
 * - North-facing door: entry from north (dz < 0 → dz=+1 movement) should work
 * - Entry from other directions should be blocked
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { BuildingCollisionService } from "../BuildingCollisionService";
import { CollisionMatrix } from "../../movement/CollisionMatrix";
import type { TileCoord } from "../../movement/TileSystem";
import type { World } from "../../../../core/World";

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

describe("Server Entry Validation", () => {
  let world: World;
  let collisionService: BuildingCollisionService;

  const BUILDING_POS = { x: 20, y: 0, z: 20 };
  const BUILDING_ID = "server_entry_test";

  beforeAll(() => {
    world = createMockWorld();
    collisionService = new BuildingCollisionService(world);

    const layout = createBuildingWithNorthDoor();
    collisionService.registerBuilding(
      BUILDING_ID,
      "test_town",
      layout,
      BUILDING_POS,
      0,
    );

    collisionService.setDebugLogging(true);
  });

  afterAll(() => {
    collisionService.clear();
  });

  it("should identify door tiles correctly", () => {
    const building = collisionService.getBuilding(BUILDING_ID);
    expect(building).not.toBeNull();

    const floor0 = building!.floors[0];
    const doorWalls = floor0.wallSegments.filter(
      (w) => w.hasOpening && w.openingType === "door",
    );

    console.log(`\n=== DOOR IDENTIFICATION ===`);
    console.log(`Door wall segments: ${doorWalls.length}`);

    for (const door of doorWalls) {
      console.log(`  Door at (${door.tileX},${door.tileZ}) side=${door.side}`);

      // Verify getDoorOpeningsAtTile returns the correct direction
      const openings = collisionService.getDoorOpeningsAtTile(
        door.tileX,
        door.tileZ,
        0,
      );
      console.log(`  getDoorOpeningsAtTile: [${openings.join(", ")}]`);

      expect(openings).toContain(door.side);
    }
  });

  it("CRITICAL: Entry from north (correct direction) should be ALLOWED", () => {
    // Find the door tile
    const closestDoor = collisionService.findClosestDoorTile(
      BUILDING_ID,
      20,
      20,
    );
    expect(closestDoor).not.toBeNull();

    const doorExterior: TileCoord = {
      x: closestDoor!.tileX,
      z: closestDoor!.tileZ,
    };
    const doorInterior: TileCoord = {
      x: closestDoor!.interiorTileX,
      z: closestDoor!.interiorTileZ,
    };

    console.log(`\n=== DOOR ENTRY TEST ===`);
    console.log(
      `Door exterior (approach): (${doorExterior.x},${doorExterior.z})`,
    );
    console.log(`Door interior: (${doorInterior.x},${doorInterior.z})`);
    console.log(`Door direction: ${closestDoor!.direction}`);

    // Test entry from exterior to interior (THIS SHOULD WORK)
    const check = collisionService.checkBuildingMovement(
      doorExterior,
      doorInterior,
      0,
      null, // ground player
    );

    console.log(`\nEntry from exterior to interior:`);
    console.log(`  From: (${doorExterior.x},${doorExterior.z})`);
    console.log(`  To: (${doorInterior.x},${doorInterior.z})`);
    console.log(`  Allowed: ${check.buildingAllowsMovement}`);
    console.log(`  Block reason: ${check.blockReason || "none"}`);
    console.log(
      `  Target door openings: [${check.targetDoorOpenings.join(", ")}]`,
    );

    if (!check.buildingAllowsMovement) {
      console.log(`  ❌ BUG: Entry through door should be ALLOWED!`);
    } else {
      console.log(`  ✅ Correctly allowed`);
    }

    expect(check.buildingAllowsMovement).toBe(true);
  });

  it("CRITICAL: Entry from wrong direction (east/west/south) should be BLOCKED", () => {
    const building = collisionService.getBuilding(BUILDING_ID)!;
    const floor0 = building.floors[0];
    const doorWalls = floor0.wallSegments.filter(
      (w) => w.hasOpening && w.openingType === "door",
    );

    // Pick the first door
    const door = doorWalls[0];
    expect(door).not.toBeUndefined();

    console.log(`\n=== WRONG DIRECTION ENTRY TEST ===`);
    console.log(`Door at (${door.tileX},${door.tileZ}) facing ${door.side}`);

    const doorTile: TileCoord = { x: door.tileX, z: door.tileZ };

    // For a north-facing door, entry from south/east/west should be blocked
    const wrongApproaches = [
      { name: "from south", from: { x: door.tileX, z: door.tileZ + 1 } },
      { name: "from east", from: { x: door.tileX + 1, z: door.tileZ } },
      { name: "from west", from: { x: door.tileX - 1, z: door.tileZ } },
    ];

    // Filter out approaches that are inside the building
    const validWrongApproaches = wrongApproaches.filter((a) => {
      return (
        collisionService.isTileInBuildingFootprint(a.from.x, a.from.z) === null
      );
    });

    let blockedCount = 0;
    let allowedCount = 0;

    for (const approach of validWrongApproaches) {
      const check = collisionService.checkBuildingMovement(
        approach.from,
        doorTile,
        0,
        null, // ground player
      );

      console.log(
        `\n${approach.name}: (${approach.from.x},${approach.from.z}) → (${doorTile.x},${doorTile.z})`,
      );
      console.log(`  Allowed: ${check.buildingAllowsMovement}`);
      console.log(`  Block reason: ${check.blockReason || "none"}`);

      if (check.buildingAllowsMovement) {
        allowedCount++;
        console.log(`  ❌ BUG: Entry from wrong direction should be BLOCKED!`);
      } else {
        blockedCount++;
        console.log(`  ✅ Correctly blocked`);
      }
    }

    console.log(`\nBlocked: ${blockedCount}, Allowed: ${allowedCount}`);
    expect(allowedCount).toBe(0);
  });

  it("should show full movement trace for debugging", () => {
    const closestDoor = collisionService.findClosestDoorTile(
      BUILDING_ID,
      20,
      20,
    );
    expect(closestDoor).not.toBeNull();

    console.log(`\n=== FULL MOVEMENT TRACE ===`);

    // Simulate approach from 5 tiles away
    const startTile: TileCoord = {
      x: closestDoor!.tileX,
      z: closestDoor!.tileZ - 5,
    };
    const doorExterior: TileCoord = {
      x: closestDoor!.tileX,
      z: closestDoor!.tileZ,
    };
    const doorInterior: TileCoord = {
      x: closestDoor!.interiorTileX,
      z: closestDoor!.interiorTileZ,
    };

    console.log(`Start: (${startTile.x},${startTile.z})`);
    console.log(`Door exterior: (${doorExterior.x},${doorExterior.z})`);
    console.log(`Door interior: (${doorInterior.x},${doorInterior.z})`);

    // Check each step
    let currentTile = startTile;
    let allStepsValid = true;

    while (currentTile.z < doorExterior.z) {
      const nextTile: TileCoord = { x: currentTile.x, z: currentTile.z + 1 };

      const check = collisionService.checkBuildingMovement(
        currentTile,
        nextTile,
        0,
        null, // ground player
      );

      console.log(
        `Step (${currentTile.x},${currentTile.z}) → (${nextTile.x},${nextTile.z}): ` +
          `${check.buildingAllowsMovement ? "✅" : "❌"} ${check.blockReason || ""}`,
      );

      if (!check.buildingAllowsMovement) {
        allStepsValid = false;
        break;
      }

      currentTile = nextTile;
    }

    // Final step: exterior to interior
    const finalCheck = collisionService.checkBuildingMovement(
      doorExterior,
      doorInterior,
      0,
      null,
    );
    console.log(
      `Final step (${doorExterior.x},${doorExterior.z}) → (${doorInterior.x},${doorInterior.z}): ` +
        `${finalCheck.buildingAllowsMovement ? "✅" : "❌"} ${finalCheck.blockReason || ""}`,
    );

    expect(allStepsValid).toBe(true);
    expect(finalCheck.buildingAllowsMovement).toBe(true);
  });
});
