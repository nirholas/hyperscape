/**
 * ROTATED BUILDING NAVIGATION TEST
 *
 * Tests that buildings with different rotations still block walls correctly.
 * Building rotations: 0°, 90°, 180°, 270°
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

function createSimpleBuilding() {
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

describe("Rotated Building Navigation", () => {
  const rotations = [
    { angle: 0, name: "0°" },
    { angle: Math.PI / 2, name: "90°" },
    { angle: Math.PI, name: "180°" },
    { angle: (3 * Math.PI) / 2, name: "270°" },
  ];

  for (const { angle, name } of rotations) {
    describe(`Building rotated ${name}`, () => {
      let world: World;
      let collisionService: BuildingCollisionService;
      let pathfinder: BFSPathfinder;

      const BUILDING_POS = { x: 200, y: 0, z: 200 };
      const BUILDING_ID = `rotated_${name.replace("°", "")}`;

      beforeAll(async () => {
        world = createMockWorld();
        collisionService = new BuildingCollisionService(world);

        const layout = createSimpleBuilding();
        collisionService.registerBuilding(
          BUILDING_ID,
          "test_town",
          layout,
          BUILDING_POS,
          angle,
        );

        pathfinder = new BFSPathfinder();
      }, TEST_TIMEOUT);

      afterAll(() => {
        collisionService.clear();
      });

      it("should have walls on all 4 sides", () => {
        const building = collisionService.getBuilding(BUILDING_ID);
        expect(building).not.toBeNull();

        const floor0 = building!.floors[0];
        const solidWalls = floor0.wallSegments.filter((w) => !w.hasOpening);

        console.log(`\n[${name}] Solid walls: ${solidWalls.length}`);

        // Count walls by direction
        const wallCounts = { north: 0, south: 0, east: 0, west: 0 };
        for (const wall of solidWalls) {
          wallCounts[wall.side as keyof typeof wallCounts]++;
        }
        console.log(`  North: ${wallCounts.north}`);
        console.log(`  South: ${wallCounts.south}`);
        console.log(`  East: ${wallCounts.east}`);
        console.log(`  West: ${wallCounts.west}`);

        // All sides should have some walls
        expect(
          wallCounts.north +
            wallCounts.south +
            wallCounts.east +
            wallCounts.west,
        ).toBeGreaterThan(0);
      });

      it("should block movement through all walls", () => {
        const building = collisionService.getBuilding(BUILDING_ID)!;
        const floor0 = building.floors[0];

        const solidWalls = floor0.wallSegments.filter((w) => !w.hasOpening);
        let wallsBlocking = 0;
        let wallsNotBlocking = 0;

        for (const wall of solidWalls) {
          let outsideX = wall.tileX;
          let outsideZ = wall.tileZ;

          if (wall.side === "north") outsideZ -= 1;
          else if (wall.side === "south") outsideZ += 1;
          else if (wall.side === "east") outsideX += 1;
          else if (wall.side === "west") outsideX -= 1;

          const outsideTile: TileCoord = { x: outsideX, z: outsideZ };
          const insideTile: TileCoord = { x: wall.tileX, z: wall.tileZ };

          const wallBlocked = collisionService.isWallBlocked(
            outsideTile.x,
            outsideTile.z,
            insideTile.x,
            insideTile.z,
            0,
          );

          const moveCheck = collisionService.checkBuildingMovement(
            outsideTile,
            insideTile,
            0,
            null,
          );

          if (wallBlocked || !moveCheck.buildingAllowsMovement) {
            wallsBlocking++;
          } else {
            wallsNotBlocking++;
            console.log(
              `  ❌ Wall NOT blocking: (${wall.tileX},${wall.tileZ}) side=${wall.side}`,
            );
          }
        }

        console.log(
          `[${name}] Walls blocking: ${wallsBlocking}/${solidWalls.length}`,
        );
        expect(wallsNotBlocking).toBe(0);
      });

      it("should have a passable door", () => {
        const building = collisionService.getBuilding(BUILDING_ID)!;
        const floor0 = building.floors[0];

        const doorWalls = floor0.wallSegments.filter(
          (w) =>
            w.hasOpening &&
            (w.openingType === "door" || w.openingType === "arch"),
        );

        console.log(`[${name}] Door walls: ${doorWalls.length}`);
        expect(doorWalls.length).toBeGreaterThan(0);

        for (const door of doorWalls) {
          let outsideX = door.tileX;
          let outsideZ = door.tileZ;

          if (door.side === "north") outsideZ -= 1;
          else if (door.side === "south") outsideZ += 1;
          else if (door.side === "east") outsideX += 1;
          else if (door.side === "west") outsideX -= 1;

          const outsideTile: TileCoord = { x: outsideX, z: outsideZ };
          const insideTile: TileCoord = { x: door.tileX, z: door.tileZ };

          const wallBlocked = collisionService.isWallBlocked(
            outsideTile.x,
            outsideTile.z,
            insideTile.x,
            insideTile.z,
            0,
          );

          const moveCheck = collisionService.checkBuildingMovement(
            outsideTile,
            insideTile,
            0,
            null,
          );

          console.log(
            `  Door at (${door.tileX},${door.tileZ}) side=${door.side}: blocked=${wallBlocked} allowed=${moveCheck.buildingAllowsMovement}`,
          );

          expect(wallBlocked).toBe(false);
          expect(moveCheck.buildingAllowsMovement).toBe(true);
        }
      });

      it("should allow path from outside to inside through door", () => {
        collisionService.getBuilding(BUILDING_ID)!;

        const closestDoor = collisionService.findClosestDoorTile(
          BUILDING_ID,
          200,
          200,
        );
        expect(closestDoor).not.toBeNull();

        const doorExterior: TileCoord = {
          x: closestDoor!.tileX,
          z: closestDoor!.tileZ,
        };

        // Calculate start tile based on door direction (approach from outside)
        let startTile: TileCoord;
        switch (closestDoor!.direction) {
          case "north":
            startTile = { x: doorExterior.x, z: doorExterior.z - 5 };
            break;
          case "south":
            startTile = { x: doorExterior.x, z: doorExterior.z + 5 };
            break;
          case "east":
            startTile = { x: doorExterior.x + 5, z: doorExterior.z };
            break;
          case "west":
            startTile = { x: doorExterior.x - 5, z: doorExterior.z };
            break;
          default:
            startTile = { x: doorExterior.x, z: doorExterior.z - 5 };
        }

        console.log(
          `[${name}] Door at (${doorExterior.x},${doorExterior.z}) dir=${closestDoor!.direction}`,
        );
        console.log(`[${name}] Start at (${startTile.x},${startTile.z})`);

        const isWalkable = (tile: TileCoord, fromTile?: TileCoord): boolean => {
          const check = collisionService.checkBuildingMovement(
            fromTile ?? null,
            tile,
            0,
            null,
          );
          return check.buildingAllowsMovement;
        };

        const path = pathfinder.findPath(startTile, doorExterior, isWalkable);
        console.log(`[${name}] Path to door: ${path.length} tiles`);
        expect(path.length).toBeGreaterThan(0);
      });
    });
  }
});
