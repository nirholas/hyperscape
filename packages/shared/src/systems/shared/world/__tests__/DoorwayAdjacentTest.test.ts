/**
 * DOORWAY ADJACENCY AND CORNER TEST
 *
 * Tests specifically for:
 * 1. Tiles LEFT and RIGHT of a doorway (should be blocked from outside)
 * 2. Diagonal corner movement near doorways (should be blocked if it clips)
 * 3. Various approach angles to door-adjacent tiles
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { BuildingCollisionService } from "../BuildingCollisionService";
import { CollisionMatrix } from "../../movement/CollisionMatrix";
import { BFSPathfinder } from "../../movement/BFSPathfinder";
import type { TileCoord } from "../../movement/TileSystem";
import type { World } from "../../../../core/World";

const TEST_TIMEOUT = 60000;

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
 * Create a 2x2 cell building (8x8 tiles) with ONE door in center of north wall.
 *
 * Building layout:
 *
 *   W W D D W W W W   <- North wall (D = door at tiles 17,18 with z=16)
 *   W . . . . . . W   <- Interior
 *   ...
 *   W W W W W W W W   <- South wall
 *
 * Door position: tiles (17,16) and (18,16) have door opening facing north
 * Door exterior: tiles (17,15) and (18,15)
 */
function createBuildingWithCenterDoor() {
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
        // Door at cell (0,0) and (1,0) on north side
        externalOpenings: new Map([["0,0,north", "door"]]),
      },
    ],
    stairs: null,
  };
}

describe("Doorway Adjacent and Corner Navigation", () => {
  let world: World;
  let collisionService: BuildingCollisionService;
  let pathfinder: BFSPathfinder;

  const BUILDING_POS = { x: 20, y: 0, z: 20 };
  const BUILDING_ID = "doorway_test";

  beforeAll(async () => {
    world = createMockWorld();
    collisionService = new BuildingCollisionService(world);

    const layout = createBuildingWithCenterDoor();
    collisionService.registerBuilding(
      BUILDING_ID,
      "test_town",
      layout,
      BUILDING_POS,
      0,
    );

    pathfinder = new BFSPathfinder();
    collisionService.setDebugLogging(true);
  }, TEST_TIMEOUT);

  afterAll(() => {
    collisionService.clear();
  });

  it("should dump building layout for analysis", () => {
    const building = collisionService.getBuilding(BUILDING_ID);
    expect(building).not.toBeNull();

    const bbox = building!.boundingBox;
    const floor0 = building!.floors[0];

    console.log(`\n=== BUILDING LAYOUT ===`);
    console.log(
      `Bbox: (${bbox.minTileX},${bbox.minTileZ}) → (${bbox.maxTileX},${bbox.maxTileZ})`,
    );

    // Find door tiles
    const doorWalls = floor0.wallSegments.filter(
      (w) => w.hasOpening && w.openingType === "door",
    );
    console.log(`\nDoor wall segments: ${doorWalls.length}`);
    for (const door of doorWalls) {
      console.log(`  Door at (${door.tileX},${door.tileZ}) side=${door.side}`);
    }

    // Find tiles adjacent to door (left/right)
    console.log(`\nDoor-adjacent analysis:`);
    for (const door of doorWalls) {
      // Door is on north wall, tiles to left/right are on same Z but different X
      const leftTile = { x: door.tileX - 1, z: door.tileZ };
      const rightTile = { x: door.tileX + 1, z: door.tileZ };

      // Check if these are wall tiles or interior tiles
      const leftIsWall = floor0.wallSegments.some(
        (w) =>
          w.tileX === leftTile.x &&
          w.tileZ === leftTile.z &&
          w.side === door.side &&
          !w.hasOpening,
      );
      const rightIsWall = floor0.wallSegments.some(
        (w) =>
          w.tileX === rightTile.x &&
          w.tileZ === rightTile.z &&
          w.side === door.side &&
          !w.hasOpening,
      );

      console.log(`  Door (${door.tileX},${door.tileZ}) side=${door.side}:`);
      console.log(`    Left (${leftTile.x},${leftTile.z}): wall=${leftIsWall}`);
      console.log(
        `    Right (${rightTile.x},${rightTile.z}): wall=${rightIsWall}`,
      );
    }

    // ASCII map
    console.log(`\n=== ASCII MAP (W=wall, D=door, .=floor) ===`);
    for (let z = bbox.minTileZ - 2; z <= bbox.maxTileZ + 2; z++) {
      let row = `${z.toString().padStart(3)}: `;
      for (let x = bbox.minTileX - 2; x <= bbox.maxTileX + 2; x++) {
        const isDoor = doorWalls.some((d) => d.tileX === x && d.tileZ === z);
        const inFootprint =
          collisionService.isTileInBuildingFootprint(x, z) !== null;
        const isWalkable = floor0.walkableTiles.has(`${x},${z}`);

        if (isDoor) {
          row += "D";
        } else if (isWalkable) {
          row += ".";
        } else if (inFootprint) {
          row += "#";
        } else {
          row += " ";
        }
      }
      console.log(row);
    }
  });

  it("CRITICAL: Non-door wall tiles should block ground player", () => {
    const building = collisionService.getBuilding(BUILDING_ID)!;
    const floor0 = building.floors[0];
    const bbox = building.boundingBox;

    // Find all door tiles first
    const doorTileSet = new Set<string>();
    const doorWalls = floor0.wallSegments.filter(
      (w) =>
        w.hasOpening && (w.openingType === "door" || w.openingType === "arch"),
    );
    for (const door of doorWalls) {
      doorTileSet.add(`${door.tileX},${door.tileZ}`);
    }

    console.log(`\n=== NON-DOOR WALL TILE BLOCKING TEST ===`);
    console.log(`Door tiles: ${Array.from(doorTileSet).join("; ")}`);

    // Find wall tiles that are NOT doors (solid walls)
    const solidWalls = floor0.wallSegments.filter((w) => !w.hasOpening);

    let testedCount = 0;
    let blockedCount = 0;
    let allowedCount = 0;

    for (const wall of solidWalls) {
      // Calculate outside tile based on wall direction
      let outsideX = wall.tileX;
      let outsideZ = wall.tileZ;

      if (wall.side === "north") outsideZ -= 1;
      else if (wall.side === "south") outsideZ += 1;
      else if (wall.side === "east") outsideX += 1;
      else if (wall.side === "west") outsideX -= 1;

      const outsideTile: TileCoord = { x: outsideX, z: outsideZ };
      const insideTile: TileCoord = { x: wall.tileX, z: wall.tileZ };

      // Skip if outside tile is also in building
      if (
        collisionService.isTileInBuildingFootprint(outsideTile.x, outsideTile.z)
      ) {
        continue;
      }

      testedCount++;

      const check = collisionService.checkBuildingMovement(
        outsideTile,
        insideTile,
        0,
        null, // ground player
      );

      if (check.buildingAllowsMovement) {
        allowedCount++;
        console.log(
          `  ❌ Wall tile (${wall.tileX},${wall.tileZ}) side=${wall.side} ALLOWS entry from (${outsideTile.x},${outsideTile.z})!`,
        );
        console.log(`     Reason: ${check.blockReason || "none"}`);
        console.log(
          `     Door openings: [${check.targetDoorOpenings.join(",")}]`,
        );
      } else {
        blockedCount++;
      }
    }

    console.log(
      `\nTested: ${testedCount}, Blocked: ${blockedCount}, Allowed: ${allowedCount}`,
    );

    // All non-door wall tiles should block entry
    expect(allowedCount).toBe(0);
  });

  it("CRITICAL: Diagonal entry to non-door tiles should be blocked", () => {
    const building = collisionService.getBuilding(BUILDING_ID)!;
    const bbox = building.boundingBox;
    const floor0 = building.floors[0];

    console.log(`\n=== DIAGONAL ENTRY TO NON-DOOR TILES TEST ===`);

    // Find door tiles
    const doorTileSet = new Set<string>();
    const doorWalls = floor0.wallSegments.filter(
      (w) =>
        w.hasOpening && (w.openingType === "door" || w.openingType === "arch"),
    );
    for (const door of doorWalls) {
      doorTileSet.add(`${door.tileX},${door.tileZ}`);
    }

    console.log(`Door tiles: ${Array.from(doorTileSet).join("; ")}`);

    // Test diagonal entry to various edge tiles that are NOT doors
    // Building corner tile (should have walls on 2 sides)
    const cornerTile: TileCoord = { x: bbox.minTileX, z: bbox.minTileZ };

    // All 4 diagonal approaches
    const diagonalApproaches = [
      { name: "NW→SE", from: { x: cornerTile.x - 1, z: cornerTile.z - 1 } },
      { name: "NE→SW", from: { x: cornerTile.x + 1, z: cornerTile.z - 1 } },
      { name: "SW→NE", from: { x: cornerTile.x - 1, z: cornerTile.z + 1 } },
    ];

    console.log(
      `\nTesting diagonal approaches to corner (${cornerTile.x},${cornerTile.z}):`,
    );

    let blockedCount = 0;
    let allowedCount = 0;

    for (const approach of diagonalApproaches) {
      // Skip if from tile is inside building
      if (
        collisionService.isTileInBuildingFootprint(
          approach.from.x,
          approach.from.z,
        )
      ) {
        continue;
      }

      const check = collisionService.checkBuildingMovement(
        approach.from,
        cornerTile,
        0,
        null, // ground player
      );

      if (check.buildingAllowsMovement) {
        allowedCount++;
        console.log(
          `  ${approach.name} from (${approach.from.x},${approach.from.z}): ALLOWED ❌`,
        );
      } else {
        blockedCount++;
        console.log(
          `  ${approach.name} from (${approach.from.x},${approach.from.z}): BLOCKED ✅`,
        );
      }
    }

    // Also test diagonal entry to tiles adjacent to the door (but not the door itself)
    // E.g., tile (16,16) is the NW corner, not a door
    const nonDoorEdgeTile: TileCoord = { x: bbox.minTileX, z: bbox.minTileZ };
    const isDoor = doorTileSet.has(`${nonDoorEdgeTile.x},${nonDoorEdgeTile.z}`);

    if (!isDoor) {
      console.log(
        `\nTesting diagonal entry to edge tile (${nonDoorEdgeTile.x},${nonDoorEdgeTile.z}) - NOT a door:`,
      );

      // From outside, diagonal approach
      const fromOutside: TileCoord = {
        x: nonDoorEdgeTile.x - 1,
        z: nonDoorEdgeTile.z - 1,
      };
      const edgeCheck = collisionService.checkBuildingMovement(
        fromOutside,
        nonDoorEdgeTile,
        0,
        null,
      );

      console.log(`  From (${fromOutside.x},${fromOutside.z})`);
      console.log(`  Allowed: ${edgeCheck.buildingAllowsMovement}`);
      console.log(`  Block reason: ${edgeCheck.blockReason || "none"}`);
      console.log(`  Wall blocked: ${edgeCheck.wallBlocked}`);

      if (edgeCheck.buildingAllowsMovement) {
        allowedCount++;
        console.log(`  ❌ BUG: Diagonal entry to non-door tile allowed!`);
      } else {
        blockedCount++;
        console.log(`  ✅ Correctly blocked`);
      }
    }

    console.log(`\nBlocked: ${blockedCount}, Allowed: ${allowedCount}`);

    // All diagonal entries to non-door tiles should be blocked
    expect(allowedCount).toBe(0);
  });

  it("CRITICAL: Test all approach angles to building corner", () => {
    const building = collisionService.getBuilding(BUILDING_ID)!;
    const bbox = building.boundingBox;

    console.log(`\n=== CORNER APPROACH TEST ===`);

    // Test the NW corner of the building (should be fully blocked)
    const cornerTile: TileCoord = { x: bbox.minTileX, z: bbox.minTileZ };

    // All 8 approach directions
    const approaches = [
      { name: "N", dx: 0, dz: -1 },
      { name: "S", dx: 0, dz: 1 },
      { name: "E", dx: 1, dz: 0 },
      { name: "W", dx: -1, dz: 0 },
      { name: "NW", dx: -1, dz: -1 },
      { name: "NE", dx: 1, dz: -1 },
      { name: "SW", dx: -1, dz: 1 },
      { name: "SE", dx: 1, dz: 1 },
    ];

    console.log(
      `Testing approaches to corner tile (${cornerTile.x},${cornerTile.z}):`,
    );

    let blockedCount = 0;
    let allowedCount = 0;

    for (const approach of approaches) {
      const fromTile: TileCoord = {
        x: cornerTile.x - approach.dx,
        z: cornerTile.z - approach.dz,
      };

      // Skip if fromTile is inside building
      if (collisionService.isTileInBuildingFootprint(fromTile.x, fromTile.z)) {
        continue;
      }

      const check = collisionService.checkBuildingMovement(
        fromTile,
        cornerTile,
        0,
        null, // ground player
      );

      const result = check.buildingAllowsMovement ? "ALLOWED" : "BLOCKED";
      if (check.buildingAllowsMovement) {
        allowedCount++;
        console.log(
          `  ${approach.name.padEnd(2)} from (${fromTile.x},${fromTile.z}): ${result} ❌ BUG?`,
        );
      } else {
        blockedCount++;
        console.log(
          `  ${approach.name.padEnd(2)} from (${fromTile.x},${fromTile.z}): ${result} ✅`,
        );
      }
    }

    console.log(`\nBlocked: ${blockedCount}, Allowed: ${allowedCount}`);

    // Corner should be blocked from all outside approaches
    expect(allowedCount).toBe(0);
  });

  it("CRITICAL: No path should enter building except through door", () => {
    const building = collisionService.getBuilding(BUILDING_ID)!;
    const bbox = building.boundingBox;
    const floor0 = building.floors[0];

    console.log(`\n=== EXHAUSTIVE ENTRY POINT TEST ===`);

    // Ground player walkability
    const groundWalkable = (tile: TileCoord, fromTile?: TileCoord): boolean => {
      const check = collisionService.checkBuildingMovement(
        fromTile ?? null,
        tile,
        0,
        null, // ground player
      );
      return check.buildingAllowsMovement;
    };

    // Test: From every exterior tile, can we directly step into any interior tile?
    // Only door tiles should allow this

    let illegitimateEntries = 0;
    const doorInteriorTiles = new Set<string>();

    // Get door interior tiles
    const doorWalls = floor0.wallSegments.filter(
      (w) =>
        w.hasOpening && (w.openingType === "door" || w.openingType === "arch"),
    );
    for (const door of doorWalls) {
      doorInteriorTiles.add(`${door.tileX},${door.tileZ}`);
    }

    console.log(
      `Door interior tiles: ${Array.from(doorInteriorTiles).join("; ")}`,
    );

    // All interior tiles
    for (const key of floor0.walkableTiles) {
      const [tx, tz] = key.split(",").map(Number);
      const interiorTile: TileCoord = { x: tx, z: tz };

      // Try to step from each adjacent exterior tile
      const adjacents = [
        { dx: 0, dz: -1 },
        { dx: 0, dz: 1 },
        { dx: 1, dz: 0 },
        { dx: -1, dz: 0 },
        { dx: -1, dz: -1 },
        { dx: 1, dz: -1 },
        { dx: -1, dz: 1 },
        { dx: 1, dz: 1 },
      ];

      for (const adj of adjacents) {
        const fromTile: TileCoord = {
          x: interiorTile.x + adj.dx,
          z: interiorTile.z + adj.dz,
        };

        // Only test from OUTSIDE the building
        if (
          collisionService.isTileInBuildingFootprint(fromTile.x, fromTile.z)
        ) {
          continue;
        }

        const canEnter = groundWalkable(interiorTile, fromTile);

        if (canEnter) {
          const isDoorTile = doorInteriorTiles.has(key);
          if (!isDoorTile) {
            illegitimateEntries++;
            console.log(
              `  ❌ BUG: Entry at non-door (${fromTile.x},${fromTile.z}) → (${interiorTile.x},${interiorTile.z})`,
            );
          }
        }
      }
    }

    console.log(`\nIllegitimate entries found: ${illegitimateEntries}`);
    expect(illegitimateEntries).toBe(0);
  });
});
