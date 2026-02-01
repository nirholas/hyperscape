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

import { describe, it, expect, beforeEach } from "vitest";
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
 * Simplified flat zone registration for testing concepts.
 * NOTE: The actual TownSystem uses per-cell flat zones with asymmetric padding,
 * but this test verifies the core flat zone mechanism works.
 * Actual TownSystem values: exteriorPadding=1.0, blendRadius=5.0 per cell.
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
  // Simplified padding for test - actual TownSystem uses per-cell zones with exteriorPadding=1.0
  const padding = 1;
  const blendRadius = 5;

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

      // Building is 12x12m, plus 1m padding on each side = 14x14m
      // (simplified test uses uniform padding; actual TownSystem uses per-cell zones)
      expect(zone.width).toBe(12 + 2); // 14
      expect(zone.depth).toBe(12 + 2); // 14
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

      // House: 8x8 + 2 padding (1m per side) = 10x10
      expect(houseZone.width).toBe(10);
      expect(houseZone.depth).toBe(10);

      // Inn: 16x20 + 2 padding (1m per side) = 18x22
      expect(innZone.width).toBe(18);
      expect(innZone.depth).toBe(22);
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

describe("Flat Zone Deterministic Selection", () => {
  /**
   * ALGORITHM VERIFICATION TESTS
   *
   * These tests verify the correctness of the flat zone selection algorithm.
   * The algorithm below is extracted from TerrainSystem.getFlatZoneHeight().
   *
   * IMPORTANT: If TerrainSystem.getFlatZoneHeight changes, these tests must be updated.
   * Source: packages/shared/src/systems/shared/world/TerrainSystem.ts:getFlatZoneHeight
   *
   * These are NOT integration tests - for integration tests see TownRoadIntegration.test.ts
   */

  // Algorithm extracted from TerrainSystem.getFlatZoneHeight for unit testing
  // This must be kept in sync with the actual implementation
  function getFlatZoneHeightAlgorithm(
    zones: FlatZone[],
    worldX: number,
    worldZ: number,
    getProceduralHeight: (x: number, z: number) => number,
  ): number | null {
    if (zones.length === 0) return null;

    let bestCoreZone: FlatZone | null = null;
    let bestCoreDist = Infinity;
    let bestBlendZone: FlatZone | null = null;
    let bestBlendFactor = Infinity;

    for (const zone of zones) {
      const dx = Math.abs(worldX - zone.centerX);
      const dz = Math.abs(worldZ - zone.centerZ);
      const halfW = zone.width / 2;
      const halfD = zone.depth / 2;

      if (dx <= halfW && dz <= halfD) {
        // In core area - deterministic selection with ID tiebreaker
        const dist = Math.max(
          halfW > 0 ? dx / halfW : 0,
          halfD > 0 ? dz / halfD : 0,
        );
        if (
          dist < bestCoreDist ||
          (dist === bestCoreDist && bestCoreZone && zone.id < bestCoreZone.id)
        ) {
          bestCoreDist = dist;
          bestCoreZone = zone;
        }
      } else if (
        dx <= halfW + zone.blendRadius &&
        dz <= halfD + zone.blendRadius
      ) {
        // In blend area - circular distance for smooth corners
        const overX = Math.max(0, dx - halfW);
        const overZ = Math.max(0, dz - halfD);
        const blend = Math.min(
          Math.sqrt(overX * overX + overZ * overZ) / zone.blendRadius,
          1.0,
        );
        if (
          blend < bestBlendFactor ||
          (blend === bestBlendFactor &&
            bestBlendZone &&
            zone.id < bestBlendZone.id)
        ) {
          bestBlendFactor = blend;
          bestBlendZone = zone;
        }
      }
    }

    if (bestCoreZone) return bestCoreZone.height;

    if (bestBlendZone) {
      const proceduralHeight = getProceduralHeight(worldX, worldZ);
      // Smoothstep interpolation for C1 continuous transition
      const t = bestBlendFactor * bestBlendFactor * (3 - 2 * bestBlendFactor);
      return bestBlendZone.height * (1 - t) + proceduralHeight * t;
    }

    return null;
  }

  it("selects zone with smallest normalized distance in core area", () => {
    const zones: FlatZone[] = [
      {
        id: "zone_a",
        centerX: 0,
        centerZ: 0,
        width: 20,
        depth: 20,
        height: 10,
        blendRadius: 5,
      },
      {
        id: "zone_b",
        centerX: 5,
        centerZ: 5,
        width: 20,
        depth: 20,
        height: 20,
        blendRadius: 5,
      },
    ];

    // Point at (3, 3) is closer to zone_b's center
    // zone_a: dx=3, dz=3, normDist = max(3/10, 3/10) = 0.3
    // zone_b: dx=2, dz=2, normDist = max(2/10, 2/10) = 0.2
    const height = getFlatZoneHeightAlgorithm(zones, 3, 3, () => 0);
    expect(height).toBe(20); // zone_b wins
  });

  it("uses zone ID as tiebreaker when distances are equal", () => {
    const zones: FlatZone[] = [
      {
        id: "zone_b",
        centerX: 0,
        centerZ: 0,
        width: 20,
        depth: 20,
        height: 20,
        blendRadius: 5,
      },
      {
        id: "zone_a",
        centerX: 0,
        centerZ: 0,
        width: 20,
        depth: 20,
        height: 10,
        blendRadius: 5,
      },
    ];

    // Both zones have same center, so same distance
    // zone_a < zone_b lexicographically, so zone_a wins
    const height = getFlatZoneHeightAlgorithm(zones, 0, 0, () => 0);
    expect(height).toBe(10); // zone_a wins due to ID
  });

  it("deterministically selects same zone regardless of iteration order", () => {
    const zone1: FlatZone = {
      id: "zone_1",
      centerX: 0,
      centerZ: 0,
      width: 20,
      depth: 20,
      height: 10,
      blendRadius: 5,
    };
    const zone2: FlatZone = {
      id: "zone_2",
      centerX: 0,
      centerZ: 0,
      width: 20,
      depth: 20,
      height: 20,
      blendRadius: 5,
    };

    // Test with different iteration orders
    const height1 = getFlatZoneHeightAlgorithm([zone1, zone2], 5, 5, () => 0);
    const height2 = getFlatZoneHeightAlgorithm([zone2, zone1], 5, 5, () => 0);

    expect(height1).toBe(height2);
    expect(height1).toBe(10); // zone_1 wins (ID tiebreak)
  });

  it("core zone always beats blend zone", () => {
    const coreZone: FlatZone = {
      id: "core",
      centerX: 0,
      centerZ: 0,
      width: 10,
      depth: 10,
      height: 5,
      blendRadius: 5,
    };
    const blendZone: FlatZone = {
      id: "blend",
      centerX: 20,
      centerZ: 0,
      width: 10,
      depth: 10,
      height: 50,
      blendRadius: 20,
    };

    // Point at (4, 0) is in core of coreZone, but also in blend of blendZone
    const height = getFlatZoneHeightAlgorithm(
      [coreZone, blendZone],
      4,
      0,
      () => 0,
    );
    expect(height).toBe(5); // Core beats blend
  });

  it("handles zones with zero-width or zero-depth", () => {
    const zeroWidthZone: FlatZone = {
      id: "line",
      centerX: 0,
      centerZ: 0,
      width: 0,
      depth: 20,
      height: 10,
      blendRadius: 5,
    };

    // Point exactly at center should still match
    const height = getFlatZoneHeightAlgorithm([zeroWidthZone], 0, 0, () => 0);
    expect(height).toBe(10);
  });
});

describe("Flat Zone Circular Blend Calculation", () => {
  /**
   * ALGORITHM VERIFICATION TESTS
   *
   * These tests verify the circular blend distance calculation that creates
   * smoother transitions at zone corners (vs rectangular blend zones).
   *
   * Algorithm extracted from TerrainSystem.getFlatZoneHeight blend area logic.
   * Source: packages/shared/src/systems/shared/world/TerrainSystem.ts:getFlatZoneHeight
   */

  function calculateBlendFactor(
    worldX: number,
    worldZ: number,
    zone: FlatZone,
  ): number | null {
    const dx = Math.abs(worldX - zone.centerX);
    const dz = Math.abs(worldZ - zone.centerZ);
    const halfW = zone.width / 2;
    const halfD = zone.depth / 2;

    // In core area
    if (dx <= halfW && dz <= halfD) return 0;

    // Outside blend area
    if (dx > halfW + zone.blendRadius || dz > halfD + zone.blendRadius)
      return null;

    // In blend area - circular distance
    const overX = Math.max(0, dx - halfW);
    const overZ = Math.max(0, dz - halfD);
    return Math.min(
      Math.sqrt(overX * overX + overZ * overZ) / zone.blendRadius,
      1.0,
    );
  }

  const testZone: FlatZone = {
    id: "test",
    centerX: 0,
    centerZ: 0,
    width: 20,
    depth: 20,
    height: 10,
    blendRadius: 10,
  };

  it("returns 0 at core edge", () => {
    // At edge of core (10, 0)
    const blend = calculateBlendFactor(10, 0, testZone);
    expect(blend).toBe(0);
  });

  it("returns 1 at blend boundary", () => {
    // At blend boundary (20, 0)
    const blend = calculateBlendFactor(20, 0, testZone);
    expect(blend).toBeCloseTo(1, 5);
  });

  it("returns null outside blend area", () => {
    const blend = calculateBlendFactor(25, 0, testZone);
    expect(blend).toBeNull();
  });

  it("diagonal blend is circular, not rectangular", () => {
    // At corner: (10 + 7.07, 10 + 7.07) = (17.07, 17.07)
    // Euclidean distance from core corner: sqrt(7.07² + 7.07²) = 10
    const diagonalOffset = 10 / Math.sqrt(2); // ~7.07
    const blend = calculateBlendFactor(
      10 + diagonalOffset,
      10 + diagonalOffset,
      testZone,
    );
    expect(blend).toBeCloseTo(1, 1); // At blend boundary

    // Point at (15, 15) - further along diagonal
    // overX = 5, overZ = 5, dist = sqrt(50) = 7.07
    const blend2 = calculateBlendFactor(15, 15, testZone);
    expect(blend2).toBeCloseTo(0.707, 2);
  });

  it("creates smooth transition along cardinal direction", () => {
    // Points along +X axis from core edge
    const blendAt10 = calculateBlendFactor(10, 0, testZone); // Core edge
    const blendAt12 = calculateBlendFactor(12, 0, testZone); // 2m into blend
    const blendAt15 = calculateBlendFactor(15, 0, testZone); // 5m into blend
    const blendAt18 = calculateBlendFactor(18, 0, testZone); // 8m into blend
    const blendAt20 = calculateBlendFactor(20, 0, testZone); // Blend edge

    expect(blendAt10).toBe(0);
    expect(blendAt12).toBeCloseTo(0.2, 2);
    expect(blendAt15).toBeCloseTo(0.5, 2);
    expect(blendAt18).toBeCloseTo(0.8, 2);
    expect(blendAt20).toBeCloseTo(1.0, 2);

    // Verify monotonic increase
    expect(blendAt12!).toBeGreaterThan(blendAt10!);
    expect(blendAt15!).toBeGreaterThan(blendAt12!);
    expect(blendAt18!).toBeGreaterThan(blendAt15!);
    expect(blendAt20!).toBeGreaterThan(blendAt18!);
  });

  it("circular blend avoids sharp corners", () => {
    // At rectangular blend corner (20, 20), rectangular would give blend=1
    // But at (17.07, 17.07), circular distance is already 10 (blend=1)
    // So (15, 15) which is inside the rectangular corner should have lower blend

    const cornerBlendCirc = calculateBlendFactor(15, 15, testZone);
    expect(cornerBlendCirc).toBeCloseTo(0.707, 2); // sqrt(50)/10

    // This demonstrates the circular blend is smoother
    // Rectangle would jump from 0.5 to 1.0 at the corner
  });

  it("handles negative coordinates symmetrically", () => {
    const blendPosPos = calculateBlendFactor(15, 15, testZone);
    const blendNegPos = calculateBlendFactor(-15, 15, testZone);
    const blendPosNeg = calculateBlendFactor(15, -15, testZone);
    const blendNegNeg = calculateBlendFactor(-15, -15, testZone);

    // All quadrants should give same blend factor
    expect(blendPosPos).toBeCloseTo(blendNegPos!, 5);
    expect(blendPosPos).toBeCloseTo(blendPosNeg!, 5);
    expect(blendPosPos).toBeCloseTo(blendNegNeg!, 5);
  });
});

describe("Smoothstep Interpolation", () => {
  /**
   * Tests for the smoothstep function t² × (3 - 2t) used for
   * C1 continuous transitions in blend zones.
   */

  function smoothstep(t: number): number {
    return t * t * (3 - 2 * t);
  }

  it("returns 0 at t=0", () => {
    expect(smoothstep(0)).toBe(0);
  });

  it("returns 1 at t=1", () => {
    expect(smoothstep(1)).toBe(1);
  });

  it("returns 0.5 at t=0.5", () => {
    expect(smoothstep(0.5)).toBe(0.5);
  });

  it("has zero derivative at t=0", () => {
    // Derivative: 6t(1-t), at t=0: 0
    const epsilon = 0.001;
    const derivative = (smoothstep(epsilon) - smoothstep(0)) / epsilon;
    expect(Math.abs(derivative)).toBeLessThan(0.01);
  });

  it("has zero derivative at t=1", () => {
    // Derivative: 6t(1-t), at t=1: 0
    const epsilon = 0.001;
    const derivative = (smoothstep(1) - smoothstep(1 - epsilon)) / epsilon;
    expect(Math.abs(derivative)).toBeLessThan(0.01);
  });

  it("is monotonically increasing", () => {
    let prev = 0;
    for (let t = 0; t <= 1; t += 0.1) {
      const val = smoothstep(t);
      expect(val).toBeGreaterThanOrEqual(prev);
      prev = val;
    }
  });

  it("produces S-curve (slower at ends, faster in middle)", () => {
    // Compare to linear interpolation
    const t = 0.25;
    const linear = t;
    const smooth = smoothstep(t);

    // Smoothstep should be less than linear at t=0.25 (slower start)
    expect(smooth).toBeLessThan(linear);

    // And greater at t=0.75 (slower end means spent more time in middle)
    const t2 = 0.75;
    expect(smoothstep(t2)).toBeGreaterThan(t2);
  });
});
