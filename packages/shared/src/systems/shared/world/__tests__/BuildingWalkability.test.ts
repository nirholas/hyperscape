/**
 * Building Walkability Tests
 *
 * Verifies that buildings use the same walkability system as the duel arena:
 * 1. Flat zones are registered for buildings
 * 2. Terrain height is modified under buildings
 * 3. Players walk at the correct elevation
 *
 * The duel arena works because it registers flat zones with TerrainSystem.
 * Buildings must do the same for consistent walkability.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { FlatZone } from "../../../../types/world/terrain";

// Building constants from procgen
const CELL_SIZE = 4; // meters per cell
const FOUNDATION_HEIGHT = 0.5; // building elevation above terrain

/**
 * Mock TerrainSystem that tracks flat zone registrations
 */
class MockTerrainSystem {
  private flatZones = new Map<string, FlatZone>();

  getHeightAt(x: number, z: number): number {
    // Check for flat zone
    for (const zone of this.flatZones.values()) {
      const dx = Math.abs(x - zone.centerX);
      const dz = Math.abs(z - zone.centerZ);
      const halfWidth = zone.width / 2;
      const halfDepth = zone.depth / 2;

      if (dx <= halfWidth && dz <= halfDepth) {
        return zone.height;
      }
    }
    // Default procedural height
    return 0;
  }

  registerFlatZone(zone: FlatZone): void {
    this.flatZones.set(zone.id, zone);
  }

  getFlatZone(id: string): FlatZone | undefined {
    return this.flatZones.get(id);
  }

  getFlatZoneCount(): number {
    return this.flatZones.size;
  }

  getAllFlatZones(): FlatZone[] {
    return Array.from(this.flatZones.values());
  }
}

/**
 * Simulate the TownSystem's registerBuildingFlatZone logic
 */
function registerBuildingFlatZone(
  terrain: MockTerrainSystem,
  building: {
    id: string;
    position: { x: number; y: number; z: number };
    rotation: number;
  },
  layout: { width: number; depth: number },
  groundY: number,
): void {
  const buildingWidth = layout.width * CELL_SIZE;
  const buildingDepth = layout.depth * CELL_SIZE;
  const floorHeight = groundY + FOUNDATION_HEIGHT;
  const padding = 2;
  const blendRadius = 3;

  const zone: FlatZone = {
    id: `building_${building.id}`,
    centerX: building.position.x,
    centerZ: building.position.z,
    width: buildingWidth + padding * 2,
    depth: buildingDepth + padding * 2,
    height: floorHeight,
    blendRadius,
  };

  terrain.registerFlatZone(zone);
}

/**
 * Simulate the duel arena's flat zone registration
 */
function registerDuelArenaFlatZone(
  terrain: MockTerrainSystem,
  arenaId: string,
  centerX: number,
  centerZ: number,
  width: number,
  length: number,
  heightOffset: number,
): void {
  // Duel arena uses procedural height + offset
  const proceduralHeight = terrain.getHeightAt(centerX, centerZ);
  const flatHeight = proceduralHeight + heightOffset;

  const zone: FlatZone = {
    id: `arena_${arenaId}`,
    centerX,
    centerZ,
    width,
    depth: length,
    height: flatHeight,
    blendRadius: 5,
  };

  terrain.registerFlatZone(zone);
}

describe("Building Walkability (Same System as Duel Arena)", () => {
  let terrain: MockTerrainSystem;

  beforeEach(() => {
    terrain = new MockTerrainSystem();
  });

  describe("Flat Zone Registration", () => {
    it("building registers flat zone with TerrainSystem", () => {
      const building = {
        id: "bank-1",
        position: { x: 10, y: 0, z: 10 },
        rotation: 0,
      };
      const layout = { width: 3, depth: 3 }; // 3x3 cells = 12x12 meters
      const groundY = 0;

      registerBuildingFlatZone(terrain, building, layout, groundY);

      expect(terrain.getFlatZoneCount()).toBe(1);
      const zone = terrain.getFlatZone("building_bank-1");
      expect(zone).toBeDefined();
    });

    it("duel arena registers flat zone with TerrainSystem", () => {
      registerDuelArenaFlatZone(terrain, "arena-1", 70, 90, 20, 24, 0.4);

      expect(terrain.getFlatZoneCount()).toBe(1);
      const zone = terrain.getFlatZone("arena_arena-1");
      expect(zone).toBeDefined();
    });

    it("both buildings and arenas use same flat zone system", () => {
      // Register a building
      registerBuildingFlatZone(
        terrain,
        { id: "bank-1", position: { x: 10, y: 0, z: 10 }, rotation: 0 },
        { width: 3, depth: 3 },
        0,
      );

      // Register an arena
      registerDuelArenaFlatZone(terrain, "arena-1", 70, 90, 20, 24, 0.4);

      expect(terrain.getFlatZoneCount()).toBe(2);
      expect(terrain.getFlatZone("building_bank-1")).toBeDefined();
      expect(terrain.getFlatZone("arena_arena-1")).toBeDefined();
    });
  });

  describe("Terrain Height Modification", () => {
    it("terrain height inside building is at floor level", () => {
      const building = {
        id: "bank-1",
        position: { x: 10, y: 0, z: 10 },
        rotation: 0,
      };
      const groundY = 5; // Terrain at Y=5
      const expectedFloorHeight = groundY + FOUNDATION_HEIGHT; // 5 + 0.5 = 5.5

      registerBuildingFlatZone(
        terrain,
        building,
        { width: 3, depth: 3 },
        groundY,
      );

      // Height at building center should be floor height
      const heightAtCenter = terrain.getHeightAt(10, 10);
      expect(heightAtCenter).toBe(expectedFloorHeight);

      // Height outside building should be default (0)
      const heightOutside = terrain.getHeightAt(100, 100);
      expect(heightOutside).toBe(0);
    });

    it("terrain height inside arena is at floor level", () => {
      const heightOffset = 0.4;
      registerDuelArenaFlatZone(
        terrain,
        "arena-1",
        70,
        90,
        20,
        24,
        heightOffset,
      );

      // Height at arena center should include offset
      const heightAtCenter = terrain.getHeightAt(70, 90);
      expect(heightAtCenter).toBe(heightOffset);

      // Height outside arena should be default (0)
      const heightOutside = terrain.getHeightAt(200, 200);
      expect(heightOutside).toBe(0);
    });
  });

  describe("Flat Zone Dimensions", () => {
    it("building flat zone covers building footprint plus padding", () => {
      const building = {
        id: "bank-1",
        position: { x: 100, y: 0, z: 100 },
        rotation: 0,
      };
      const layout = { width: 3, depth: 3 }; // 3x3 cells = 12x12 meters

      registerBuildingFlatZone(terrain, building, layout, 0);

      const zone = terrain.getFlatZone("building_bank-1")!;

      // Building is 12x12m, plus 2m padding on each side = 16x16m
      expect(zone.width).toBe(12 + 4); // 16
      expect(zone.depth).toBe(12 + 4); // 16
      expect(zone.centerX).toBe(100);
      expect(zone.centerZ).toBe(100);
    });

    it("different building sizes create appropriately sized flat zones", () => {
      // Small house (2x2 cells = 8x8m)
      registerBuildingFlatZone(
        terrain,
        { id: "house-1", position: { x: 0, y: 0, z: 0 }, rotation: 0 },
        { width: 2, depth: 2 },
        0,
      );

      // Large inn (4x5 cells = 16x20m)
      registerBuildingFlatZone(
        terrain,
        { id: "inn-1", position: { x: 50, y: 0, z: 50 }, rotation: 0 },
        { width: 4, depth: 5 },
        0,
      );

      const houseZone = terrain.getFlatZone("building_house-1")!;
      const innZone = terrain.getFlatZone("building_inn-1")!;

      // House: 8x8 + 4 padding = 12x12
      expect(houseZone.width).toBe(12);
      expect(houseZone.depth).toBe(12);

      // Inn: 16x20 + 4 padding = 20x24
      expect(innZone.width).toBe(20);
      expect(innZone.depth).toBe(24);
    });
  });

  describe("Player Walking Simulation", () => {
    it("player walking into building gets correct Y position", () => {
      const groundY = 10; // Terrain elevation
      registerBuildingFlatZone(
        terrain,
        { id: "bank-1", position: { x: 50, y: 0, z: 50 }, rotation: 0 },
        { width: 3, depth: 3 },
        groundY,
      );

      // Simulate player walking from outside to inside
      const outsidePos = { x: 0, z: 0 };
      const insidePos = { x: 50, z: 50 };

      // Outside: terrain height is default (0)
      const heightOutside = terrain.getHeightAt(outsidePos.x, outsidePos.z);
      expect(heightOutside).toBe(0);

      // Inside: terrain height is building floor
      const heightInside = terrain.getHeightAt(insidePos.x, insidePos.z);
      expect(heightInside).toBe(groundY + FOUNDATION_HEIGHT);

      // Player Y when walking from outside to inside
      const playerYOutside = heightOutside + 0.1; // Small offset above ground
      const playerYInside = heightInside + 0.1;

      expect(playerYOutside).toBeCloseTo(0.1);
      expect(playerYInside).toBeCloseTo(10.6); // 10 + 0.5 foundation + 0.1 offset
    });

    it("player walking in duel arena gets correct Y position", () => {
      const heightOffset = 0.4;
      registerDuelArenaFlatZone(
        terrain,
        "arena-1",
        70,
        90,
        20,
        24,
        heightOffset,
      );

      // Inside arena
      const heightInside = terrain.getHeightAt(70, 90);
      const playerYInside = heightInside + 0.1;

      expect(playerYInside).toBeCloseTo(0.5); // 0.4 offset + 0.1
    });
  });

  describe("Multiple Buildings in Town", () => {
    it("all buildings in town register flat zones", () => {
      const buildings = [
        { id: "bank-1", position: { x: 10, y: 0, z: 10 }, rotation: 0 },
        { id: "inn-1", position: { x: -20, y: 0, z: 10 }, rotation: 0 },
        { id: "store-1", position: { x: 10, y: 0, z: -20 }, rotation: Math.PI },
        { id: "smithy-1", position: { x: -20, y: 0, z: -20 }, rotation: 0 },
      ];

      for (const building of buildings) {
        registerBuildingFlatZone(terrain, building, { width: 3, depth: 3 }, 0);
      }

      expect(terrain.getFlatZoneCount()).toBe(4);

      // Each building should have its own flat zone
      for (const building of buildings) {
        const zone = terrain.getFlatZone(`building_${building.id}`);
        expect(zone).toBeDefined();
        expect(zone!.centerX).toBe(building.position.x);
        expect(zone!.centerZ).toBe(building.position.z);
      }
    });

    it("buildings at different elevations have correct flat zone heights", () => {
      // Building on hill (groundY = 20)
      registerBuildingFlatZone(
        terrain,
        { id: "hilltop-1", position: { x: 0, y: 0, z: 0 }, rotation: 0 },
        { width: 3, depth: 3 },
        20,
      );

      // Building in valley (groundY = 5)
      registerBuildingFlatZone(
        terrain,
        { id: "valley-1", position: { x: 100, y: 0, z: 100 }, rotation: 0 },
        { width: 3, depth: 3 },
        5,
      );

      const hilltopZone = terrain.getFlatZone("building_hilltop-1")!;
      const valleyZone = terrain.getFlatZone("building_valley-1")!;

      // Heights should reflect terrain + foundation
      expect(hilltopZone.height).toBe(20 + FOUNDATION_HEIGHT); // 20.5
      expect(valleyZone.height).toBe(5 + FOUNDATION_HEIGHT); // 5.5
    });
  });

  describe("Consistency with Duel Arena System", () => {
    it("building and arena flat zones have same structure", () => {
      // Register both
      registerBuildingFlatZone(
        terrain,
        { id: "bank-1", position: { x: 10, y: 0, z: 10 }, rotation: 0 },
        { width: 3, depth: 3 },
        0,
      );
      registerDuelArenaFlatZone(terrain, "arena-1", 70, 90, 20, 24, 0.4);

      const buildingZone = terrain.getFlatZone("building_bank-1")!;
      const arenaZone = terrain.getFlatZone("arena_arena-1")!;

      // Both should have required FlatZone properties
      const requiredKeys = [
        "id",
        "centerX",
        "centerZ",
        "width",
        "depth",
        "height",
        "blendRadius",
      ];

      for (const key of requiredKeys) {
        expect(buildingZone).toHaveProperty(key);
        expect(arenaZone).toHaveProperty(key);
      }
    });

    it("getHeightAt works identically for buildings and arenas", () => {
      // Same-sized building and arena at different positions
      registerBuildingFlatZone(
        terrain,
        { id: "building-1", position: { x: 0, y: 0, z: 0 }, rotation: 0 },
        { width: 5, depth: 5 }, // 20x20m
        10, // groundY
      );
      registerDuelArenaFlatZone(
        terrain,
        "arena-1",
        100, // centerX
        100, // centerZ
        20, // width
        20, // depth
        10.5, // heightOffset (same as building floor: 10 + 0.5)
      );

      // Heights at centers should be equal
      const buildingHeight = terrain.getHeightAt(0, 0);
      const arenaHeight = terrain.getHeightAt(100, 100);

      expect(buildingHeight).toBeCloseTo(10.5); // groundY + FOUNDATION
      expect(arenaHeight).toBeCloseTo(10.5); // heightOffset
    });
  });
});
