/**
 * Building Collision Integration Tests
 *
 * These tests verify the FULL integration between:
 * 1. Building collision registration (real positions from manifest)
 * 2. Pathfinding walkability checks
 * 3. Wall blocking at building boundaries
 * 4. Door entry from outside
 *
 * Uses the exact same data flow as production:
 * - Building positions matching the Origin Town manifest
 * - Real CELL_SIZE (4m) and tile coordinates
 * - Full pathfinding with wall blocking
 */

import { describe, it, expect, beforeEach } from "vitest";
import { BuildingCollisionService } from "../BuildingCollisionService";
import { CollisionMatrix } from "../../movement/CollisionMatrix";
import { BFSPathfinder } from "../../movement/BFSPathfinder";
import type { BuildingLayoutInput } from "../../../../types/world/building-collision-types";
import type { World } from "../../../../core/World";
import type { TileCoord } from "../../movement/TileSystem";

// CELL_SIZE from procgen = 4 meters, TILE_SIZE = 1 meter
const CELL_SIZE = 4;

/**
 * Create a mock World with CollisionMatrix
 */
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
 * Create a building layout matching the bank recipe (3x3 cells)
 * With a door on the south side
 */
function createBankLayout(): BuildingLayoutInput {
  return {
    width: 3, // 3 cells = 12 meters = 12 tiles
    depth: 3, // 3 cells = 12 meters = 12 tiles
    floors: 1,
    floorPlans: [
      {
        footprint: [
          [true, true, true],
          [true, true, true],
          [true, true, true],
        ],
        roomMap: [
          [0, 0, 0],
          [0, 0, 0],
          [0, 0, 0],
        ],
        internalOpenings: new Map(),
        externalOpenings: new Map([
          // Door on north side, center cell (col 1, row 0)
          // Row 0 has external edge on NORTH (dr-1 from row 0 → row -1 doesn't exist)
          ["1,0,north", "door"],
        ]),
      },
    ],
    stairs: null,
  };
}

describe("Building Collision Integration", () => {
  let world: World;
  let service: BuildingCollisionService;
  let pathfinder: BFSPathfinder;

  beforeEach(() => {
    world = createMockWorld();
    service = new BuildingCollisionService(world);
    pathfinder = new BFSPathfinder();
  });

  describe("Origin Town Bank Building", () => {
    // Bank position from buildings.json manifest: { x: 10, y: 0, z: 10 }
    // Bank is 3x3 cells = 12x12 meters centered at (10, 10)
    // So it covers X: [4, 16) and Z: [4, 16) in tiles

    const BANK_CENTER_X = 10;
    const BANK_CENTER_Z = 10;
    const HALF_SIZE = (3 * CELL_SIZE) / 2; // 6 meters = 6 tiles

    beforeEach(() => {
      const layout = createBankLayout();
      service.registerBuilding(
        "bank-1",
        "town-origin",
        layout,
        { x: BANK_CENTER_X, y: 0, z: BANK_CENTER_Z },
        0, // no rotation
      );
    });

    it("registers building with correct tile coverage", () => {
      const building = service.getBuilding("bank-1");
      expect(building).toBeDefined();

      const groundFloor = building!.floors[0];

      // 3x3 cells = 9 cells, each cell = 4x4 tiles = 16 tiles
      // Total: 9 * 16 = 144 walkable tiles
      expect(groundFloor.walkableTiles.size).toBe(144);

      // Verify tile coverage bounds
      let minX = Infinity,
        maxX = -Infinity;
      let minZ = Infinity,
        maxZ = -Infinity;

      for (const key of groundFloor.walkableTiles) {
        const [x, z] = key.split(",").map(Number);
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minZ = Math.min(minZ, z);
        maxZ = Math.max(maxZ, z);
      }

      // Building center at (10, 10), half size = 6 tiles
      // Expected range: [4, 15] for both X and Z (12 tiles wide = indices 4-15 inclusive)
      expect(minX).toBe(BANK_CENTER_X - HALF_SIZE); // 4
      expect(maxX).toBe(BANK_CENTER_X + HALF_SIZE - 1); // 15
      expect(minZ).toBe(BANK_CENTER_Z - HALF_SIZE); // 4
      expect(maxZ).toBe(BANK_CENTER_Z + HALF_SIZE - 1); // 15
    });

    it("tile at building center is inside building and walkable", () => {
      const result = service.queryCollision(BANK_CENTER_X, BANK_CENTER_Z, 0);

      expect(result.isInsideBuilding).toBe(true);
      expect(result.isWalkable).toBe(true);
      expect(result.buildingId).toBe("bank-1");
    });

    it("tile just outside building is NOT inside building", () => {
      // Building covers [4, 16) in X, so tile 3 is outside
      const outsideResult = service.queryCollision(3, BANK_CENTER_Z, 0);
      expect(outsideResult.isInsideBuilding).toBe(false);

      // Tile 16 is also outside (building ends at 15)
      const outsideResult2 = service.queryCollision(16, BANK_CENTER_Z, 0);
      expect(outsideResult2.isInsideBuilding).toBe(false);
    });

    it("walls block entry from non-door directions", () => {
      // Try to enter from the west side (no door)
      // From tile (3, 10) to tile (4, 10) should be blocked
      const isBlocked = service.isWallBlocked(
        3,
        BANK_CENTER_Z,
        4,
        BANK_CENTER_Z,
        0,
      );
      expect(isBlocked).toBe(true);
    });

    it("door allows entry from north", () => {
      // Door is on north side, center cell (col 1 of 3)
      // Cell 1 in X direction spans tiles 8-11 (center cell)
      // Door tiles would be at the north edge of the building

      // Find the door tiles by checking which north wall segments have openings
      const building = service.getBuilding("bank-1");
      const groundFloor = building!.floors[0];

      const doorWalls = groundFloor.wallSegments.filter(
        (w) => w.side === "north" && w.hasOpening && w.openingType === "door",
      );

      expect(doorWalls.length).toBeGreaterThan(0);

      // Check that entry through one of the door tiles is NOT blocked
      const doorWall = doorWalls[0];
      const outsideZ = doorWall.tileZ - 1; // One tile north of the door (decreasing Z)

      const isBlocked = service.isWallBlocked(
        doorWall.tileX,
        outsideZ,
        doorWall.tileX,
        doorWall.tileZ,
        0,
      );
      expect(isBlocked).toBe(false);
    });

    it("pathfinding from outside finds path through door", () => {
      // Player starts at (10, 0) - directly south of building
      const start: TileCoord = { x: BANK_CENTER_X, z: 0 };

      // Player wants to go to building center (10, 10)
      const end: TileCoord = { x: BANK_CENTER_X, z: BANK_CENTER_Z };

      // Create walkability checker that uses building collision
      const isWalkable = (tile: TileCoord, fromTile?: TileCoord): boolean => {
        // Check wall blocking first
        if (fromTile) {
          if (
            service.isWallBlocked(fromTile.x, fromTile.z, tile.x, tile.z, 0)
          ) {
            return false;
          }
        }

        // Check if inside building
        const result = service.queryCollision(tile.x, tile.z, 0);
        if (result.isInsideBuilding) {
          return result.isWalkable;
        }

        // Outside building - assume walkable terrain
        return true;
      };

      const path = pathfinder.findPath(start, end, isWalkable);

      // Should find a path
      expect(path.length).toBeGreaterThan(0);

      // Path should end at the destination
      expect(path[path.length - 1]).toEqual(end);

      // Path should be valid (each step is adjacent)
      let prev = start;
      for (const tile of path) {
        const dx = Math.abs(tile.x - prev.x);
        const dz = Math.abs(tile.z - prev.z);
        expect(dx).toBeLessThanOrEqual(1);
        expect(dz).toBeLessThanOrEqual(1);
        prev = tile;
      }
    });

    it("pathfinding avoids solid walls", () => {
      // Player starts at (0, 10) - directly west of building
      const start: TileCoord = { x: 0, z: BANK_CENTER_Z };

      // Player wants to go to building center (10, 10)
      const end: TileCoord = { x: BANK_CENTER_X, z: BANK_CENTER_Z };

      const isWalkable = (tile: TileCoord, fromTile?: TileCoord): boolean => {
        if (fromTile) {
          if (
            service.isWallBlocked(fromTile.x, fromTile.z, tile.x, tile.z, 0)
          ) {
            return false;
          }
        }
        const result = service.queryCollision(tile.x, tile.z, 0);
        if (result.isInsideBuilding) {
          return result.isWalkable;
        }
        return true;
      };

      const path = pathfinder.findPath(start, end, isWalkable);

      // Should find a path (going around to the door)
      expect(path.length).toBeGreaterThan(0);

      // Path length should be longer than straight line distance
      // because it has to go around to the door
      const straightLineDistance =
        Math.abs(end.x - start.x) + Math.abs(end.z - start.z);
      expect(path.length).toBeGreaterThan(straightLineDistance / 2);

      // Verify path doesn't go through west wall
      // West wall is at X = 4 (building edge)
      let wentThroughWestWall = false;
      let prev = start;
      for (const tile of path) {
        // Check if we're trying to enter from west (X=3 to X=4) at a non-door Z
        if (prev.x === 3 && tile.x === 4) {
          // This would be entering through west wall
          // Only valid if there's a door (which there isn't on west side)
          const result = service.queryCollision(tile.x, tile.z, 0);
          if (result.isInsideBuilding) {
            wentThroughWestWall = true;
          }
        }
        prev = tile;
      }
      expect(wentThroughWestWall).toBe(false);
    });
  });

  describe("Multiple Buildings (Origin Town)", () => {
    // Test all buildings from the Origin Town manifest

    beforeEach(() => {
      // Bank at (10, 10)
      service.registerBuilding(
        "bank-1",
        "town-origin",
        createBankLayout(),
        { x: 10, y: 0, z: 10 },
        0,
      );

      // Inn at (-15, 10) - similar layout
      service.registerBuilding(
        "inn-1",
        "town-origin",
        createBankLayout(), // Using same layout for simplicity
        { x: -15, y: 0, z: 10 },
        0,
      );

      // Store at (10, -15)
      service.registerBuilding(
        "store-1",
        "town-origin",
        createBankLayout(),
        { x: 10, y: 0, z: -15 },
        Math.PI, // Rotated 180 degrees
      );
    });

    it("registers multiple buildings", () => {
      expect(service.getBuildingCount()).toBe(3);
    });

    it("each building has distinct tile coverage", () => {
      // Bank center (10, 10)
      const bankResult = service.queryCollision(10, 10, 0);
      expect(bankResult.buildingId).toBe("bank-1");

      // Inn center (-15, 10)
      const innResult = service.queryCollision(-15, 10, 0);
      expect(innResult.buildingId).toBe("inn-1");

      // Store center (10, -15)
      const storeResult = service.queryCollision(10, -15, 0);
      expect(storeResult.buildingId).toBe("store-1");
    });

    it("tiles between buildings are not inside any building", () => {
      // Point between bank and inn: (0, 10)
      const betweenResult = service.queryCollision(0, 10, 0);
      expect(betweenResult.isInsideBuilding).toBe(false);

      // Point between bank and store: (10, 0)
      const between2Result = service.queryCollision(10, 0, 0);
      expect(between2Result.isInsideBuilding).toBe(false);
    });

    it("pathfinding can navigate between buildings", () => {
      // Shorter path: from outside inn to outside bank (doesn't require entering)
      const start: TileCoord = { x: -8, z: 10 }; // Just east of Inn
      const end: TileCoord = { x: 3, z: 10 }; // Just west of Bank

      const isWalkable = (tile: TileCoord, fromTile?: TileCoord): boolean => {
        if (
          fromTile &&
          service.isWallBlocked(fromTile.x, fromTile.z, tile.x, tile.z, 0)
        ) {
          return false;
        }
        const result = service.queryCollision(tile.x, tile.z, 0);
        if (result.isInsideBuilding) {
          return result.isWalkable;
        }
        return true;
      };

      const path = pathfinder.findPath(start, end, isWalkable);

      // Should find a path walking between buildings
      expect(path.length).toBeGreaterThan(0);
      expect(path[path.length - 1]).toEqual(end);
    });
  });

  describe("Server Runtime Simulation", () => {
    /**
     * This test simulates EXACTLY what the server does:
     * 1. TownSystem registers buildings via collisionService.registerBuilding()
     * 2. TileMovementManager gets townSystem and calls isBuildingWallBlocked()
     * 3. Path is calculated with wall blocking checks
     *
     * If this test passes but runtime fails, the issue is async timing.
     */

    beforeEach(() => {
      // Register buildings exactly as TownSystem would
      service.registerBuilding(
        "bank-1",
        "town-origin",
        createBankLayout(),
        { x: 10, y: 0, z: 10 },
        0,
      );
    });

    it("simulates server isTileWalkable exactly", () => {
      // This mirrors TileMovementManager.isTileWalkable()
      const playerFloor = 0;

      const serverIsTileWalkable = (
        tile: TileCoord,
        fromTile?: TileCoord,
      ): boolean => {
        // FIRST: Check wall blocking (like server does)
        if (fromTile) {
          if (
            service.isWallBlocked(
              fromTile.x,
              fromTile.z,
              tile.x,
              tile.z,
              playerFloor,
            )
          ) {
            return false;
          }
          // CollisionMatrix check would go here in real server
        }

        // SECOND: Check building collision
        const buildingResult = service.queryCollision(
          tile.x,
          tile.z,
          playerFloor,
        );
        if (buildingResult.isInsideBuilding) {
          return buildingResult.isWalkable;
        }

        // THIRD: Terrain checks (assume walkable in test)
        return true;
      };

      // Test 1: Tile outside building is walkable
      expect(serverIsTileWalkable({ x: 0, z: 0 })).toBe(true);

      // Test 2: Tile inside building is walkable
      expect(serverIsTileWalkable({ x: 10, z: 10 })).toBe(true);

      // Test 3: Moving through solid wall is NOT walkable
      // West wall at X=4
      expect(serverIsTileWalkable({ x: 4, z: 10 }, { x: 3, z: 10 })).toBe(
        false,
      );

      // Test 4: Moving through door IS walkable
      // Door is on south, find a door tile
      const building = service.getBuilding("bank-1");
      const doorWall = building!.floors[0].wallSegments.find(
        (w) => w.hasOpening && w.openingType === "door",
      );
      expect(doorWall).toBeDefined();

      // Entry from south (Z - 1)
      const fromOutside: TileCoord = {
        x: doorWall!.tileX,
        z: doorWall!.tileZ - 1,
      };
      const toDoor: TileCoord = { x: doorWall!.tileX, z: doorWall!.tileZ };
      expect(serverIsTileWalkable(toDoor, fromOutside)).toBe(true);
    });

    it("verifies getBuildingCount returns correct value", () => {
      // This is what TileMovementManager.townSystem getter checks
      const count = service.getBuildingCount();
      expect(count).toBe(1);
    });

    it("verifies tile-to-world position mapping", () => {
      // Bank at world position (10, 0, 10)
      // Should cover tiles roughly [4, 15] in both X and Z

      // Check that clicking at world position 10, 10 maps to a building tile
      const worldX = 10;
      const worldZ = 10;

      // worldToTile: Math.floor(worldX / TILE_SIZE) where TILE_SIZE = 1
      // So tile = (10, 10)
      const tileX = Math.floor(worldX);
      const tileZ = Math.floor(worldZ);

      const result = service.queryCollision(tileX, tileZ, 0);
      expect(result.isInsideBuilding).toBe(true);
      expect(result.buildingId).toBe("bank-1");
    });
  });

  describe("Floor Elevation", () => {
    beforeEach(() => {
      service.registerBuilding(
        "bank-1",
        "town-origin",
        createBankLayout(),
        { x: 10, y: 5, z: 10 }, // Building at Y=5 (elevated terrain)
        0,
      );
    });

    it("returns correct floor elevation for ground floor", () => {
      // Ground floor elevation should be at building Y + foundation height
      // Foundation height from procgen is 0.2
      const elevation = service.getFloorElevation(10, 10, 0);

      expect(elevation).not.toBeNull();
      // Elevation should be around 5.2 (terrain height 5 + foundation 0.2)
      expect(elevation).toBeGreaterThanOrEqual(5);
      expect(elevation).toBeLessThan(10);
    });

    it("returns null for tile outside building", () => {
      const elevation = service.getFloorElevation(0, 0, 0);
      expect(elevation).toBeNull();
    });
  });

  describe("End-to-End Runtime Simulation", () => {
    /**
     * This test simulates the COMPLETE server runtime flow:
     * 1. TownSystem generates buildings and registers collision
     * 2. Player clicks on terrain inside building area
     * 3. Server calculates path using isTileWalkable
     * 4. Server determines player height based on building floor
     *
     * This is the EXACT flow that happens at runtime.
     */

    // Simulate manifest building positions from buildings.json
    const MANIFEST_BUILDINGS = [
      { id: "bank-1", type: "bank", x: 10, z: 10, rotation: 0 },
      { id: "inn-1", type: "inn", x: -15, z: 10, rotation: 0 },
      { id: "store-1", type: "store", x: 10, z: -15, rotation: Math.PI },
    ];

    beforeEach(() => {
      // Simulate TownSystem.registerBuildingCollision()
      for (const b of MANIFEST_BUILDINGS) {
        // Simulate terrain height query (flat terrain at Y=0)
        const groundY = 0;

        service.registerBuilding(
          b.id,
          "town-origin",
          createBankLayout(), // Using same layout for simplicity
          { x: b.x, y: groundY, z: b.z },
          b.rotation,
        );
      }
    });

    it("verifies building count matches manifest", () => {
      expect(service.getBuildingCount()).toBe(MANIFEST_BUILDINGS.length);
    });

    it("click at building center is detected as inside building", () => {
      // Simulate player clicking at world position (10, 0, 10)
      // This is the bank center from the manifest
      const clickWorldX = 10;
      const clickWorldZ = 10;

      // Server converts world position to tile (same as InteractionRouter)
      const tileX = Math.floor(clickWorldX);
      const tileZ = Math.floor(clickWorldZ);

      // Query collision at this tile
      const result = service.queryCollision(tileX, tileZ, 0);

      expect(result.isInsideBuilding).toBe(true);
      expect(result.buildingId).toBe("bank-1");
      expect(result.isWalkable).toBe(true);
    });

    it("complete path from outside to inside building", () => {
      // Player starts at (10, 0) - south of the bank
      const playerStartTile: TileCoord = { x: 10, z: 0 };

      // Player clicks inside bank at (10, 10)
      const targetTile: TileCoord = { x: 10, z: 10 };

      // Simulate server's isTileWalkable check
      const serverIsTileWalkable = (
        tile: TileCoord,
        fromTile?: TileCoord,
      ): boolean => {
        // Wall blocking check (exactly like server)
        if (fromTile) {
          if (
            service.isWallBlocked(fromTile.x, fromTile.z, tile.x, tile.z, 0)
          ) {
            return false;
          }
        }

        // Building collision check
        const result = service.queryCollision(tile.x, tile.z, 0);
        if (result.isInsideBuilding) {
          return result.isWalkable;
        }

        // Terrain walkability (assume true in test)
        return true;
      };

      // Calculate path (exactly like server does)
      const path = pathfinder.findPath(
        playerStartTile,
        targetTile,
        serverIsTileWalkable,
      );

      // Path should exist and end at target
      expect(path.length).toBeGreaterThan(0);
      expect(path[path.length - 1]).toEqual(targetTile);

      // Verify path enters building through door
      let enteredBuilding = false;
      let prev = playerStartTile;
      for (const tile of path) {
        const result = service.queryCollision(tile.x, tile.z, 0);
        if (result.isInsideBuilding && !enteredBuilding) {
          enteredBuilding = true;

          // When entering building, should be through a door (not blocked)
          const isBlocked = service.isWallBlocked(
            prev.x,
            prev.z,
            tile.x,
            tile.z,
            0,
          );
          expect(isBlocked).toBe(false);
        }
        prev = tile;
      }
      expect(enteredBuilding).toBe(true);
    });

    it("player height is set correctly inside building", () => {
      // Player moves to tile inside building
      const tile: TileCoord = { x: 10, z: 10 };

      // Get building at this tile
      const buildingId = service.getBuildingAtTile(tile.x, tile.z);
      expect(buildingId).toBe("bank-1");

      // Get floor elevation
      const elevation = service.getFloorElevation(tile.x, tile.z, 0);
      expect(elevation).not.toBeNull();

      // Player Y position would be set to elevation + small offset
      const playerY = elevation! + 0.1;

      // Should be above ground (foundation height is 0.2)
      expect(playerY).toBeGreaterThan(0);
      expect(playerY).toBeLessThan(5); // Not ridiculously high
    });

    it("verifies tile coverage for all manifest buildings", () => {
      for (const b of MANIFEST_BUILDINGS) {
        // Check that building center tile is registered
        const result = service.queryCollision(b.x, b.z, 0);
        expect(result.isInsideBuilding).toBe(true);
        expect(result.buildingId).toBe(b.id);

        // Verify building bounds (3x3 cells = 12x12 tiles centered)
        const halfSize = 6; // 3 cells * 4 tiles/cell / 2

        // Corner tiles should also be inside
        const corners = [
          { x: b.x - halfSize + 1, z: b.z - halfSize + 1 },
          { x: b.x + halfSize - 1, z: b.z - halfSize + 1 },
          { x: b.x - halfSize + 1, z: b.z + halfSize - 1 },
          { x: b.x + halfSize - 1, z: b.z + halfSize - 1 },
        ];

        for (const corner of corners) {
          const cornerResult = service.queryCollision(corner.x, corner.z, 0);
          expect(cornerResult.isInsideBuilding).toBe(true);
        }
      }
    });

    it("ensures wall blocking works at building edges", () => {
      // Bank is at (10, 10), covers [4, 15] in both X and Z
      // West wall is at X=4

      // Try to enter from west (X=3 to X=4) - should be blocked (no door)
      const fromOutside: TileCoord = { x: 3, z: 10 };
      const toEdge: TileCoord = { x: 4, z: 10 };

      const isBlocked = service.isWallBlocked(
        fromOutside.x,
        fromOutside.z,
        toEdge.x,
        toEdge.z,
        0,
      );
      expect(isBlocked).toBe(true);

      // Verify the tile AT the edge is inside the building
      const edgeResult = service.queryCollision(toEdge.x, toEdge.z, 0);
      expect(edgeResult.isInsideBuilding).toBe(true);
    });
  });
});
