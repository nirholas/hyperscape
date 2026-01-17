/**
 * CollisionFlags Unit Tests
 *
 * Tests the collision flag definitions and helper functions.
 *
 * Key behaviors tested:
 * - Flag value uniqueness (bitmask non-overlap)
 * - Mask combinations
 * - getWallFlagForDirection function
 * - getOppositeWallFlag function
 * - Bitwise operations with flags
 */

import { describe, it, expect } from "vitest";
import {
  CollisionFlag,
  CollisionMask,
  getWallFlagForDirection,
  getOppositeWallFlag,
} from "../CollisionFlags";

describe("CollisionFlags", () => {
  describe("flag uniqueness", () => {
    it("all wall flags are unique powers of 2", () => {
      const wallFlags = [
        CollisionFlag.WALL_NORTH_WEST,
        CollisionFlag.WALL_NORTH,
        CollisionFlag.WALL_NORTH_EAST,
        CollisionFlag.WALL_EAST,
        CollisionFlag.WALL_SOUTH_EAST,
        CollisionFlag.WALL_SOUTH,
        CollisionFlag.WALL_SOUTH_WEST,
        CollisionFlag.WALL_WEST,
      ];

      // Check each is a power of 2
      for (const flag of wallFlags) {
        expect(flag & (flag - 1)).toBe(0); // Power of 2 check
        expect(flag).toBeGreaterThan(0);
      }

      // Check no overlaps
      let combined = 0;
      for (const flag of wallFlags) {
        expect(combined & flag).toBe(0); // No overlap with previous
        combined |= flag;
      }
    });

    it("all non-wall flags are unique and don't overlap walls", () => {
      const nonWallFlags = [
        CollisionFlag.OCCUPIED_PLAYER,
        CollisionFlag.OCCUPIED_NPC,
        CollisionFlag.DECORATION,
        CollisionFlag.BLOCKED,
        CollisionFlag.BLOCK_LOS,
        CollisionFlag.WATER,
        CollisionFlag.STEEP_SLOPE,
      ];

      const wallMask = CollisionMask.WALLS;

      for (const flag of nonWallFlags) {
        // Check doesn't overlap with wall flags
        expect(flag & wallMask).toBe(0);
        // Check is power of 2
        expect(flag & (flag - 1)).toBe(0);
      }

      // Check no overlaps among non-wall flags
      let combined = 0;
      for (const flag of nonWallFlags) {
        expect(combined & flag).toBe(0);
        combined |= flag;
      }
    });
  });

  describe("CollisionMask combinations", () => {
    it("BLOCKS_WALK includes BLOCKED, WATER, STEEP_SLOPE", () => {
      expect(CollisionMask.BLOCKS_WALK & CollisionFlag.BLOCKED).toBe(
        CollisionFlag.BLOCKED,
      );
      expect(CollisionMask.BLOCKS_WALK & CollisionFlag.WATER).toBe(
        CollisionFlag.WATER,
      );
      expect(CollisionMask.BLOCKS_WALK & CollisionFlag.STEEP_SLOPE).toBe(
        CollisionFlag.STEEP_SLOPE,
      );
    });

    it("BLOCKS_WALK does not include occupancy", () => {
      expect(CollisionMask.BLOCKS_WALK & CollisionFlag.OCCUPIED_PLAYER).toBe(0);
      expect(CollisionMask.BLOCKS_WALK & CollisionFlag.OCCUPIED_NPC).toBe(0);
    });

    it("OCCUPIED includes both player and NPC", () => {
      expect(CollisionMask.OCCUPIED & CollisionFlag.OCCUPIED_PLAYER).toBe(
        CollisionFlag.OCCUPIED_PLAYER,
      );
      expect(CollisionMask.OCCUPIED & CollisionFlag.OCCUPIED_NPC).toBe(
        CollisionFlag.OCCUPIED_NPC,
      );
    });

    it("BLOCKS_MOVEMENT includes BLOCKS_WALK and OCCUPIED", () => {
      expect(CollisionMask.BLOCKS_MOVEMENT & CollisionMask.BLOCKS_WALK).toBe(
        CollisionMask.BLOCKS_WALK,
      );
      expect(CollisionMask.BLOCKS_MOVEMENT & CollisionMask.OCCUPIED).toBe(
        CollisionMask.OCCUPIED,
      );
    });

    it("WALLS_CARDINAL includes N/E/S/W", () => {
      expect(CollisionMask.WALLS_CARDINAL & CollisionFlag.WALL_NORTH).toBe(
        CollisionFlag.WALL_NORTH,
      );
      expect(CollisionMask.WALLS_CARDINAL & CollisionFlag.WALL_EAST).toBe(
        CollisionFlag.WALL_EAST,
      );
      expect(CollisionMask.WALLS_CARDINAL & CollisionFlag.WALL_SOUTH).toBe(
        CollisionFlag.WALL_SOUTH,
      );
      expect(CollisionMask.WALLS_CARDINAL & CollisionFlag.WALL_WEST).toBe(
        CollisionFlag.WALL_WEST,
      );
    });

    it("WALLS_CARDINAL does not include diagonals", () => {
      expect(CollisionMask.WALLS_CARDINAL & CollisionFlag.WALL_NORTH_WEST).toBe(
        0,
      );
      expect(CollisionMask.WALLS_CARDINAL & CollisionFlag.WALL_NORTH_EAST).toBe(
        0,
      );
      expect(CollisionMask.WALLS_CARDINAL & CollisionFlag.WALL_SOUTH_EAST).toBe(
        0,
      );
      expect(CollisionMask.WALLS_CARDINAL & CollisionFlag.WALL_SOUTH_WEST).toBe(
        0,
      );
    });

    it("WALLS_DIAGONAL includes NW/NE/SE/SW", () => {
      expect(CollisionMask.WALLS_DIAGONAL & CollisionFlag.WALL_NORTH_WEST).toBe(
        CollisionFlag.WALL_NORTH_WEST,
      );
      expect(CollisionMask.WALLS_DIAGONAL & CollisionFlag.WALL_NORTH_EAST).toBe(
        CollisionFlag.WALL_NORTH_EAST,
      );
      expect(CollisionMask.WALLS_DIAGONAL & CollisionFlag.WALL_SOUTH_EAST).toBe(
        CollisionFlag.WALL_SOUTH_EAST,
      );
      expect(CollisionMask.WALLS_DIAGONAL & CollisionFlag.WALL_SOUTH_WEST).toBe(
        CollisionFlag.WALL_SOUTH_WEST,
      );
    });

    it("WALLS equals WALLS_CARDINAL | WALLS_DIAGONAL", () => {
      expect(CollisionMask.WALLS).toBe(
        CollisionMask.WALLS_CARDINAL | CollisionMask.WALLS_DIAGONAL,
      );
    });
  });

  describe("getWallFlagForDirection", () => {
    describe("cardinal directions", () => {
      it("returns WALL_NORTH for north (0, 1)", () => {
        expect(getWallFlagForDirection(0, 1)).toBe(CollisionFlag.WALL_NORTH);
      });

      it("returns WALL_EAST for east (1, 0)", () => {
        expect(getWallFlagForDirection(1, 0)).toBe(CollisionFlag.WALL_EAST);
      });

      it("returns WALL_SOUTH for south (0, -1)", () => {
        expect(getWallFlagForDirection(0, -1)).toBe(CollisionFlag.WALL_SOUTH);
      });

      it("returns WALL_WEST for west (-1, 0)", () => {
        expect(getWallFlagForDirection(-1, 0)).toBe(CollisionFlag.WALL_WEST);
      });
    });

    describe("diagonal directions", () => {
      it("returns WALL_NORTH_WEST for northwest (-1, 1)", () => {
        expect(getWallFlagForDirection(-1, 1)).toBe(
          CollisionFlag.WALL_NORTH_WEST,
        );
      });

      it("returns WALL_NORTH_EAST for northeast (1, 1)", () => {
        expect(getWallFlagForDirection(1, 1)).toBe(
          CollisionFlag.WALL_NORTH_EAST,
        );
      });

      it("returns WALL_SOUTH_EAST for southeast (1, -1)", () => {
        expect(getWallFlagForDirection(1, -1)).toBe(
          CollisionFlag.WALL_SOUTH_EAST,
        );
      });

      it("returns WALL_SOUTH_WEST for southwest (-1, -1)", () => {
        expect(getWallFlagForDirection(-1, -1)).toBe(
          CollisionFlag.WALL_SOUTH_WEST,
        );
      });
    });

    describe("invalid directions", () => {
      it("returns 0 for no movement (0, 0)", () => {
        expect(getWallFlagForDirection(0, 0)).toBe(0);
      });

      it("returns 0 for invalid direction (2, 0)", () => {
        expect(getWallFlagForDirection(2, 0)).toBe(0);
      });

      it("returns 0 for invalid direction (0, 2)", () => {
        expect(getWallFlagForDirection(0, 2)).toBe(0);
      });
    });
  });

  describe("getOppositeWallFlag", () => {
    describe("cardinal opposites", () => {
      it("WALL_NORTH opposite is WALL_SOUTH", () => {
        expect(getOppositeWallFlag(CollisionFlag.WALL_NORTH)).toBe(
          CollisionFlag.WALL_SOUTH,
        );
      });

      it("WALL_SOUTH opposite is WALL_NORTH", () => {
        expect(getOppositeWallFlag(CollisionFlag.WALL_SOUTH)).toBe(
          CollisionFlag.WALL_NORTH,
        );
      });

      it("WALL_EAST opposite is WALL_WEST", () => {
        expect(getOppositeWallFlag(CollisionFlag.WALL_EAST)).toBe(
          CollisionFlag.WALL_WEST,
        );
      });

      it("WALL_WEST opposite is WALL_EAST", () => {
        expect(getOppositeWallFlag(CollisionFlag.WALL_WEST)).toBe(
          CollisionFlag.WALL_EAST,
        );
      });
    });

    describe("diagonal opposites", () => {
      it("WALL_NORTH_WEST opposite is WALL_SOUTH_EAST", () => {
        expect(getOppositeWallFlag(CollisionFlag.WALL_NORTH_WEST)).toBe(
          CollisionFlag.WALL_SOUTH_EAST,
        );
      });

      it("WALL_NORTH_EAST opposite is WALL_SOUTH_WEST", () => {
        expect(getOppositeWallFlag(CollisionFlag.WALL_NORTH_EAST)).toBe(
          CollisionFlag.WALL_SOUTH_WEST,
        );
      });

      it("WALL_SOUTH_EAST opposite is WALL_NORTH_WEST", () => {
        expect(getOppositeWallFlag(CollisionFlag.WALL_SOUTH_EAST)).toBe(
          CollisionFlag.WALL_NORTH_WEST,
        );
      });

      it("WALL_SOUTH_WEST opposite is WALL_NORTH_EAST", () => {
        expect(getOppositeWallFlag(CollisionFlag.WALL_SOUTH_WEST)).toBe(
          CollisionFlag.WALL_NORTH_EAST,
        );
      });
    });

    describe("symmetry", () => {
      it("double opposite returns original for all wall flags", () => {
        const wallFlags = [
          CollisionFlag.WALL_NORTH,
          CollisionFlag.WALL_SOUTH,
          CollisionFlag.WALL_EAST,
          CollisionFlag.WALL_WEST,
          CollisionFlag.WALL_NORTH_WEST,
          CollisionFlag.WALL_NORTH_EAST,
          CollisionFlag.WALL_SOUTH_EAST,
          CollisionFlag.WALL_SOUTH_WEST,
        ];

        for (const flag of wallFlags) {
          expect(getOppositeWallFlag(getOppositeWallFlag(flag))).toBe(flag);
        }
      });
    });

    describe("non-wall flags", () => {
      it("returns 0 for non-wall flags", () => {
        expect(getOppositeWallFlag(CollisionFlag.BLOCKED)).toBe(0);
        expect(getOppositeWallFlag(CollisionFlag.WATER)).toBe(0);
        expect(getOppositeWallFlag(CollisionFlag.OCCUPIED_PLAYER)).toBe(0);
      });

      it("returns 0 for 0", () => {
        expect(getOppositeWallFlag(0)).toBe(0);
      });
    });
  });

  describe("bitwise operations", () => {
    it("can combine multiple flags with OR", () => {
      const combined =
        CollisionFlag.BLOCKED | CollisionFlag.WATER | CollisionFlag.WALL_NORTH;
      expect(combined & CollisionFlag.BLOCKED).toBe(CollisionFlag.BLOCKED);
      expect(combined & CollisionFlag.WATER).toBe(CollisionFlag.WATER);
      expect(combined & CollisionFlag.WALL_NORTH).toBe(
        CollisionFlag.WALL_NORTH,
      );
    });

    it("can check for any flag with AND", () => {
      const combined = CollisionFlag.BLOCKED | CollisionFlag.WATER;
      expect((combined & CollisionFlag.BLOCKED) !== 0).toBe(true);
      expect((combined & CollisionFlag.STEEP_SLOPE) !== 0).toBe(false);
    });

    it("can remove flags with AND NOT", () => {
      let flags = CollisionFlag.BLOCKED | CollisionFlag.WATER;
      flags &= ~CollisionFlag.WATER;
      expect(flags).toBe(CollisionFlag.BLOCKED);
    });

    it("can check against mask", () => {
      const tileFlags = CollisionFlag.BLOCKED | CollisionFlag.DECORATION;
      expect((tileFlags & CollisionMask.BLOCKS_MOVEMENT) !== 0).toBe(true);

      const walkableFlags = CollisionFlag.DECORATION | CollisionFlag.WALL_NORTH;
      expect((walkableFlags & CollisionMask.BLOCKS_MOVEMENT) !== 0).toBe(false);
    });
  });
});
