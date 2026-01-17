/**
 * CollisionMatrix Unit Tests
 *
 * Tests the zone-based collision storage system.
 *
 * Key behaviors tested:
 * - Zone allocation and storage
 * - Flag operations (get, set, add, remove, has)
 * - Tile blocking and walkability checks
 * - Directional wall collision
 * - Diagonal movement blocking
 * - Cross-zone boundary handling
 * - Network serialization/deserialization
 */

import { describe, it, expect, beforeEach } from "vitest";
import { CollisionMatrix, ZONE_SIZE } from "../CollisionMatrix";
import { CollisionFlag, CollisionMask } from "../CollisionFlags";

describe("CollisionMatrix", () => {
  let matrix: CollisionMatrix;

  beforeEach(() => {
    matrix = new CollisionMatrix();
  });

  describe("zone allocation", () => {
    it("starts with no zones allocated", () => {
      expect(matrix.getZoneCount()).toBe(0);
    });

    it("allocates zone on first write", () => {
      matrix.setFlags(0, 0, CollisionFlag.BLOCKED);
      expect(matrix.getZoneCount()).toBe(1);
    });

    it("does not allocate zone on read of empty area", () => {
      matrix.getFlags(0, 0);
      expect(matrix.getZoneCount()).toBe(0);
    });

    it("allocates separate zones for different areas", () => {
      matrix.setFlags(0, 0, CollisionFlag.BLOCKED);
      matrix.setFlags(100, 100, CollisionFlag.BLOCKED);
      expect(matrix.getZoneCount()).toBe(2);
    });

    it("reuses same zone for tiles in same zone", () => {
      matrix.setFlags(0, 0, CollisionFlag.BLOCKED);
      matrix.setFlags(1, 1, CollisionFlag.BLOCKED);
      matrix.setFlags(ZONE_SIZE - 1, ZONE_SIZE - 1, CollisionFlag.BLOCKED);
      expect(matrix.getZoneCount()).toBe(1);
    });
  });

  describe("getFlags / setFlags", () => {
    it("returns 0 for unset tiles", () => {
      expect(matrix.getFlags(5, 5)).toBe(0);
    });

    it("returns set flags", () => {
      matrix.setFlags(5, 5, CollisionFlag.BLOCKED);
      expect(matrix.getFlags(5, 5)).toBe(CollisionFlag.BLOCKED);
    });

    it("replaces existing flags", () => {
      matrix.setFlags(5, 5, CollisionFlag.BLOCKED);
      matrix.setFlags(5, 5, CollisionFlag.WATER);
      expect(matrix.getFlags(5, 5)).toBe(CollisionFlag.WATER);
    });

    it("handles combined flags", () => {
      const combinedFlags = CollisionFlag.BLOCKED | CollisionFlag.BLOCK_LOS;
      matrix.setFlags(5, 5, combinedFlags);
      expect(matrix.getFlags(5, 5)).toBe(combinedFlags);
    });

    it("handles negative coordinates", () => {
      matrix.setFlags(-5, -10, CollisionFlag.BLOCKED);
      expect(matrix.getFlags(-5, -10)).toBe(CollisionFlag.BLOCKED);
    });

    it("handles large positive coordinates", () => {
      matrix.setFlags(1000, 2000, CollisionFlag.BLOCKED);
      expect(matrix.getFlags(1000, 2000)).toBe(CollisionFlag.BLOCKED);
    });

    it("handles large negative coordinates", () => {
      matrix.setFlags(-1000, -2000, CollisionFlag.BLOCKED);
      expect(matrix.getFlags(-1000, -2000)).toBe(CollisionFlag.BLOCKED);
    });
  });

  describe("addFlags", () => {
    it("adds flags to empty tile", () => {
      matrix.addFlags(5, 5, CollisionFlag.BLOCKED);
      expect(matrix.getFlags(5, 5)).toBe(CollisionFlag.BLOCKED);
    });

    it("combines flags with existing", () => {
      matrix.setFlags(5, 5, CollisionFlag.BLOCKED);
      matrix.addFlags(5, 5, CollisionFlag.BLOCK_LOS);
      expect(matrix.getFlags(5, 5)).toBe(
        CollisionFlag.BLOCKED | CollisionFlag.BLOCK_LOS,
      );
    });

    it("does not duplicate existing flags", () => {
      matrix.setFlags(5, 5, CollisionFlag.BLOCKED);
      matrix.addFlags(5, 5, CollisionFlag.BLOCKED);
      expect(matrix.getFlags(5, 5)).toBe(CollisionFlag.BLOCKED);
    });

    it("can add multiple flags at once", () => {
      matrix.addFlags(5, 5, CollisionFlag.BLOCKED | CollisionFlag.WATER);
      expect(matrix.getFlags(5, 5)).toBe(
        CollisionFlag.BLOCKED | CollisionFlag.WATER,
      );
    });
  });

  describe("removeFlags", () => {
    it("removes flags from tile", () => {
      matrix.setFlags(5, 5, CollisionFlag.BLOCKED | CollisionFlag.WATER);
      matrix.removeFlags(5, 5, CollisionFlag.WATER);
      expect(matrix.getFlags(5, 5)).toBe(CollisionFlag.BLOCKED);
    });

    it("does nothing when removing non-existent flags", () => {
      matrix.setFlags(5, 5, CollisionFlag.BLOCKED);
      matrix.removeFlags(5, 5, CollisionFlag.WATER);
      expect(matrix.getFlags(5, 5)).toBe(CollisionFlag.BLOCKED);
    });

    it("does nothing on unallocated zone", () => {
      matrix.removeFlags(5, 5, CollisionFlag.BLOCKED);
      expect(matrix.getFlags(5, 5)).toBe(0);
      expect(matrix.getZoneCount()).toBe(0);
    });

    it("can remove all flags", () => {
      matrix.setFlags(5, 5, CollisionFlag.BLOCKED | CollisionFlag.WATER);
      matrix.removeFlags(5, 5, CollisionFlag.BLOCKED | CollisionFlag.WATER);
      expect(matrix.getFlags(5, 5)).toBe(0);
    });
  });

  describe("hasFlags", () => {
    it("returns false for unset tiles", () => {
      expect(matrix.hasFlags(5, 5, CollisionFlag.BLOCKED)).toBe(false);
    });

    it("returns true when tile has flag", () => {
      matrix.setFlags(5, 5, CollisionFlag.BLOCKED);
      expect(matrix.hasFlags(5, 5, CollisionFlag.BLOCKED)).toBe(true);
    });

    it("returns false when tile has different flag", () => {
      matrix.setFlags(5, 5, CollisionFlag.WATER);
      expect(matrix.hasFlags(5, 5, CollisionFlag.BLOCKED)).toBe(false);
    });

    it("returns true when any of multiple flags match", () => {
      matrix.setFlags(5, 5, CollisionFlag.BLOCKED);
      expect(
        matrix.hasFlags(5, 5, CollisionFlag.BLOCKED | CollisionFlag.WATER),
      ).toBe(true);
    });

    it("returns true when tile has all queried flags", () => {
      matrix.setFlags(5, 5, CollisionFlag.BLOCKED | CollisionFlag.WATER);
      expect(
        matrix.hasFlags(5, 5, CollisionFlag.BLOCKED | CollisionFlag.WATER),
      ).toBe(true);
    });
  });

  describe("isWalkable", () => {
    it("returns true for empty tiles", () => {
      expect(matrix.isWalkable(5, 5)).toBe(true);
    });

    it("returns false for blocked tiles", () => {
      matrix.setFlags(5, 5, CollisionFlag.BLOCKED);
      expect(matrix.isWalkable(5, 5)).toBe(false);
    });

    it("returns false for water tiles", () => {
      matrix.setFlags(5, 5, CollisionFlag.WATER);
      expect(matrix.isWalkable(5, 5)).toBe(false);
    });

    it("returns false for steep slope tiles", () => {
      matrix.setFlags(5, 5, CollisionFlag.STEEP_SLOPE);
      expect(matrix.isWalkable(5, 5)).toBe(false);
    });

    it("returns false for player-occupied tiles", () => {
      matrix.setFlags(5, 5, CollisionFlag.OCCUPIED_PLAYER);
      expect(matrix.isWalkable(5, 5)).toBe(false);
    });

    it("returns false for NPC-occupied tiles", () => {
      matrix.setFlags(5, 5, CollisionFlag.OCCUPIED_NPC);
      expect(matrix.isWalkable(5, 5)).toBe(false);
    });

    it("returns true for decoration tiles", () => {
      matrix.setFlags(5, 5, CollisionFlag.DECORATION);
      expect(matrix.isWalkable(5, 5)).toBe(true);
    });

    it("returns true for tiles with only wall flags", () => {
      matrix.setFlags(5, 5, CollisionFlag.WALL_NORTH);
      expect(matrix.isWalkable(5, 5)).toBe(true);
    });
  });

  describe("isBlocked - cardinal movement", () => {
    it("returns false for unblocked movement", () => {
      expect(matrix.isBlocked(5, 5, 6, 5)).toBe(false); // east
    });

    it("returns true when destination is blocked", () => {
      matrix.setFlags(6, 5, CollisionFlag.BLOCKED);
      expect(matrix.isBlocked(5, 5, 6, 5)).toBe(true);
    });

    it("returns true when destination has water", () => {
      matrix.setFlags(6, 5, CollisionFlag.WATER);
      expect(matrix.isBlocked(5, 5, 6, 5)).toBe(true);
    });

    it("returns true when destination is occupied", () => {
      matrix.setFlags(6, 5, CollisionFlag.OCCUPIED_NPC);
      expect(matrix.isBlocked(5, 5, 6, 5)).toBe(true);
    });

    it("allows movement to decoration tiles", () => {
      matrix.setFlags(6, 5, CollisionFlag.DECORATION);
      expect(matrix.isBlocked(5, 5, 6, 5)).toBe(false);
    });
  });

  describe("isBlocked - directional walls", () => {
    it("blocks entry from north when destination has WALL_NORTH", () => {
      matrix.setFlags(5, 5, CollisionFlag.WALL_NORTH);
      // Moving from (5,6) to (5,5) - entering from north
      expect(matrix.isBlocked(5, 6, 5, 5)).toBe(true);
    });

    it("allows entry from south when destination has WALL_NORTH", () => {
      matrix.setFlags(5, 5, CollisionFlag.WALL_NORTH);
      // Moving from (5,4) to (5,5) - entering from south
      expect(matrix.isBlocked(5, 4, 5, 5)).toBe(false);
    });

    it("blocks entry from east when destination has WALL_EAST", () => {
      matrix.setFlags(5, 5, CollisionFlag.WALL_EAST);
      // Moving from (6,5) to (5,5) - entering from east
      expect(matrix.isBlocked(6, 5, 5, 5)).toBe(true);
    });

    it("blocks entry from south when destination has WALL_SOUTH", () => {
      matrix.setFlags(5, 5, CollisionFlag.WALL_SOUTH);
      // Moving from (5,4) to (5,5) - entering from south
      expect(matrix.isBlocked(5, 4, 5, 5)).toBe(true);
    });

    it("blocks entry from west when destination has WALL_WEST", () => {
      matrix.setFlags(5, 5, CollisionFlag.WALL_WEST);
      // Moving from (4,5) to (5,5) - entering from west
      expect(matrix.isBlocked(4, 5, 5, 5)).toBe(true);
    });

    it("blocks exit when source has wall in movement direction", () => {
      matrix.setFlags(5, 5, CollisionFlag.WALL_EAST);
      // Moving from (5,5) to (6,5) - exiting east, but wall blocks east entry
      // Need opposite wall flag check - WALL_WEST on source blocks exit east
      matrix.setFlags(5, 5, CollisionFlag.WALL_EAST);
      // Actually, WALL_EAST on source means wall blocks entry FROM east
      // To block EXIT to east, we need to check differently
      // Let me re-read the isBlocked logic...
      // The source check uses getOppositeWallFlag on the entry flag
      // So if moving east (dx=1), entry flag is WALL_WEST (coming from west)
      // Opposite of WALL_WEST is WALL_EAST
      // So if source has WALL_EAST, it blocks exit east
      expect(matrix.isBlocked(5, 5, 6, 5)).toBe(true);
    });
  });

  describe("isBlocked - diagonal movement", () => {
    it("returns false for unblocked diagonal movement", () => {
      expect(matrix.isBlocked(5, 5, 6, 6)).toBe(false); // northeast
    });

    it("blocks diagonal when destination is blocked", () => {
      matrix.setFlags(6, 6, CollisionFlag.BLOCKED);
      expect(matrix.isBlocked(5, 5, 6, 6)).toBe(true);
    });

    it("blocks diagonal when horizontal adjacent tile is blocked", () => {
      // Moving northeast (5,5) -> (6,6)
      // Horizontal adjacent is (6,5) - directly east
      matrix.setFlags(6, 5, CollisionFlag.BLOCKED);
      expect(matrix.isBlocked(5, 5, 6, 6)).toBe(true);
    });

    it("blocks diagonal when vertical adjacent tile is blocked", () => {
      // Moving northeast (5,5) -> (6,6)
      // Vertical adjacent is (5,6) - directly north
      matrix.setFlags(5, 6, CollisionFlag.BLOCKED);
      expect(matrix.isBlocked(5, 5, 6, 6)).toBe(true);
    });

    it("allows diagonal when adjacent tiles are walkable", () => {
      // Only destination has decoration (walkable)
      matrix.setFlags(6, 6, CollisionFlag.DECORATION);
      expect(matrix.isBlocked(5, 5, 6, 6)).toBe(false);
    });

    it("blocks southeast when east tile is blocked", () => {
      matrix.setFlags(6, 5, CollisionFlag.BLOCKED);
      expect(matrix.isBlocked(5, 5, 6, 4)).toBe(true); // southeast
    });

    it("blocks southwest when west tile is blocked", () => {
      matrix.setFlags(4, 5, CollisionFlag.BLOCKED);
      expect(matrix.isBlocked(5, 5, 4, 4)).toBe(true); // southwest
    });

    it("blocks northwest when north tile is blocked", () => {
      matrix.setFlags(5, 6, CollisionFlag.BLOCKED);
      expect(matrix.isBlocked(5, 5, 4, 6)).toBe(true); // northwest
    });
  });

  describe("isBlocked - diagonal wall clipping", () => {
    it("blocks diagonal when horizontal adjacent has wall blocking Z direction", () => {
      // Moving northeast (5,5) -> (6,6)
      // Horizontal adjacent (6,5) - we're coming from Z=5 (south of Z=6)
      // So we need WALL_SOUTH to block entry from the south (Z- direction)
      // horizWallFlag = getWallFlagForDirection(0, -dz) = getWallFlagForDirection(0, -1) = WALL_SOUTH
      matrix.setFlags(6, 5, CollisionFlag.WALL_SOUTH);
      expect(matrix.isBlocked(5, 5, 6, 6)).toBe(true);
    });

    it("blocks diagonal when vertical adjacent has wall blocking X direction", () => {
      // Moving northeast (5,5) -> (6,6)
      // Vertical adjacent (5,6) - we're coming from X=5 (west of X=6)
      // So we need WALL_WEST to block entry from the west (X- direction)
      // vertWallFlag = getWallFlagForDirection(-dx, 0) = getWallFlagForDirection(-1, 0) = WALL_WEST
      matrix.setFlags(5, 6, CollisionFlag.WALL_WEST);
      expect(matrix.isBlocked(5, 5, 6, 6)).toBe(true);
    });
  });

  describe("cross-zone boundaries", () => {
    it("handles tiles at zone boundary correctly", () => {
      // Tile at edge of zone 0
      matrix.setFlags(ZONE_SIZE - 1, ZONE_SIZE - 1, CollisionFlag.BLOCKED);
      expect(matrix.getFlags(ZONE_SIZE - 1, ZONE_SIZE - 1)).toBe(
        CollisionFlag.BLOCKED,
      );
      // Tile in next zone
      matrix.setFlags(ZONE_SIZE, ZONE_SIZE, CollisionFlag.WATER);
      expect(matrix.getFlags(ZONE_SIZE, ZONE_SIZE)).toBe(CollisionFlag.WATER);
      expect(matrix.getZoneCount()).toBe(2);
    });

    it("checks movement across zone boundary", () => {
      // Block tile in next zone
      matrix.setFlags(ZONE_SIZE, 0, CollisionFlag.BLOCKED);
      expect(matrix.isBlocked(ZONE_SIZE - 1, 0, ZONE_SIZE, 0)).toBe(true);
    });

    it("handles negative zone boundaries", () => {
      matrix.setFlags(-1, -1, CollisionFlag.BLOCKED);
      expect(matrix.getFlags(-1, -1)).toBe(CollisionFlag.BLOCKED);
      expect(matrix.isBlocked(-2, -1, -1, -1)).toBe(true);
    });
  });

  describe("clear", () => {
    it("removes all zones", () => {
      matrix.setFlags(0, 0, CollisionFlag.BLOCKED);
      matrix.setFlags(100, 100, CollisionFlag.BLOCKED);
      expect(matrix.getZoneCount()).toBe(2);

      matrix.clear();
      expect(matrix.getZoneCount()).toBe(0);
    });

    it("clears all collision data", () => {
      matrix.setFlags(5, 5, CollisionFlag.BLOCKED);
      matrix.clear();
      expect(matrix.getFlags(5, 5)).toBe(0);
    });
  });

  describe("zone data operations", () => {
    it("getZoneData returns null for unallocated zone", () => {
      expect(matrix.getZoneData(0, 0)).toBe(null);
    });

    it("getZoneData returns data for allocated zone", () => {
      matrix.setFlags(0, 0, CollisionFlag.BLOCKED);
      const data = matrix.getZoneData(0, 0);
      expect(data).not.toBe(null);
      expect(data!.length).toBe(ZONE_SIZE * ZONE_SIZE);
    });

    it("setZoneData applies zone data", () => {
      const data = new Int32Array(ZONE_SIZE * ZONE_SIZE);
      data[0] = CollisionFlag.BLOCKED;
      data[10] = CollisionFlag.WATER;

      matrix.setZoneData(0, 0, data);

      expect(matrix.getFlags(0, 0)).toBe(CollisionFlag.BLOCKED);
    });

    it("setZoneData creates a copy", () => {
      const data = new Int32Array(ZONE_SIZE * ZONE_SIZE);
      data[0] = CollisionFlag.BLOCKED;

      matrix.setZoneData(0, 0, data);

      // Modify original
      data[0] = CollisionFlag.WATER;

      // Matrix should still have original value
      expect(matrix.getFlags(0, 0)).toBe(CollisionFlag.BLOCKED);
    });

    it("setZoneData rejects invalid length", () => {
      const data = new Int32Array(10); // Wrong size
      matrix.setZoneData(0, 0, data);
      expect(matrix.getZoneData(0, 0)).toBe(null);
    });
  });

  describe("serialization", () => {
    it("serializeZone returns null for unallocated zone", () => {
      expect(matrix.serializeZone(0, 0)).toBe(null);
    });

    it("serializeZone returns base64 string", () => {
      matrix.setFlags(0, 0, CollisionFlag.BLOCKED);
      const serialized = matrix.serializeZone(0, 0);
      expect(typeof serialized).toBe("string");
      expect(serialized!.length).toBeGreaterThan(0);
    });

    it("deserializeZone restores data", () => {
      matrix.setFlags(0, 0, CollisionFlag.BLOCKED);
      matrix.setFlags(5, 5, CollisionFlag.WATER);
      const serialized = matrix.serializeZone(0, 0)!;

      // Create new matrix and deserialize
      const matrix2 = new CollisionMatrix();
      const success = matrix2.deserializeZone(0, 0, serialized);

      expect(success).toBe(true);
      expect(matrix2.getFlags(0, 0)).toBe(CollisionFlag.BLOCKED);
      expect(matrix2.getFlags(5, 5)).toBe(CollisionFlag.WATER);
    });

    it("deserializeZone returns false for invalid data", () => {
      const success = matrix.deserializeZone(0, 0, "invalid base64!!!");
      expect(success).toBe(false);
    });
  });

  describe("getZonesInRadius", () => {
    it("returns empty array when no zones allocated", () => {
      const zones = matrix.getZonesInRadius(0, 0, 10);
      expect(zones).toEqual([]);
    });

    it("returns zones within radius", () => {
      matrix.setFlags(0, 0, CollisionFlag.BLOCKED);
      matrix.setFlags(ZONE_SIZE, 0, CollisionFlag.BLOCKED);

      const zones = matrix.getZonesInRadius(0, 0, ZONE_SIZE * 2);
      expect(zones.length).toBe(2);
    });

    it("excludes zones outside radius", () => {
      matrix.setFlags(0, 0, CollisionFlag.BLOCKED);
      matrix.setFlags(1000, 1000, CollisionFlag.BLOCKED);

      const zones = matrix.getZonesInRadius(0, 0, ZONE_SIZE);
      expect(zones.length).toBe(1);
    });
  });

  describe("debugPrint", () => {
    it("returns grid representation", () => {
      matrix.setFlags(5, 5, CollisionFlag.BLOCKED);
      matrix.setFlags(6, 5, CollisionFlag.WATER);
      matrix.setFlags(7, 5, CollisionFlag.OCCUPIED_NPC);

      const grid = matrix.debugPrint(4, 4, 8, 6);
      expect(Array.isArray(grid)).toBe(true);
      expect(grid.length).toBe(3); // 3 rows (z: 6, 5, 4)
    });

    it("shows blocked tiles as #", () => {
      matrix.setFlags(5, 5, CollisionFlag.BLOCKED);
      const grid = matrix.debugPrint(5, 5, 5, 5);
      expect(grid[0][0]).toBe("#");
    });

    it("shows empty tiles as .", () => {
      const grid = matrix.debugPrint(0, 0, 0, 0);
      expect(grid[0][0]).toBe(".");
    });

    it("shows water tiles as ~", () => {
      matrix.setFlags(5, 5, CollisionFlag.WATER);
      const grid = matrix.debugPrint(5, 5, 5, 5);
      expect(grid[0][0]).toBe("~");
    });

    it("shows occupied tiles as @", () => {
      matrix.setFlags(5, 5, CollisionFlag.OCCUPIED_PLAYER);
      const grid = matrix.debugPrint(5, 5, 5, 5);
      expect(grid[0][0]).toBe("@");
    });
  });
});
