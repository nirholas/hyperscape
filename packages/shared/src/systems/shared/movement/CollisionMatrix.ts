/**
 * CollisionMatrix - Zone-based collision storage
 *
 * Stores collision flags per tile in zone-sized chunks (8x8).
 * Uses Int32Array for efficient memory and bitwise operations.
 *
 * Architecture:
 * - World divided into zones (8x8 tiles each)
 * - Each zone = Int32Array[64] = 256 bytes
 * - Zone lookup: O(1) via coordinate math
 * - Tile lookup within zone: O(1) via array index
 *
 * Memory footprint:
 * - 1000x1000 tile world = 125x125 zones = 15,625 zones
 * - 15,625 zones × 256 bytes = ~4MB
 *
 * @see CollisionFlags for flag definitions
 */

import {
  CollisionFlag,
  CollisionMask,
  getWallFlagForDirection,
  getOppositeWallFlag,
} from "./CollisionFlags";

/** Zone size in tiles (8x8 = 64 tiles per zone) */
export const ZONE_SIZE = 8;

/** Number of tiles per zone */
const TILES_PER_ZONE = ZONE_SIZE * ZONE_SIZE; // 64

/**
 * Interface for collision matrix operations
 */
export interface ICollisionMatrix {
  /** Get flags for a tile */
  getFlags(tileX: number, tileZ: number): number;

  /** Set flags for a tile (replaces existing) */
  setFlags(tileX: number, tileZ: number, flags: number): void;

  /** Add flags to a tile (bitwise OR) */
  addFlags(tileX: number, tileZ: number, flags: number): void;

  /** Remove flags from a tile (bitwise AND NOT) */
  removeFlags(tileX: number, tileZ: number, flags: number): void;

  /** Check if tile has specific flags (any of them) */
  hasFlags(tileX: number, tileZ: number, flags: number): boolean;

  /** Check if movement from one tile to another is blocked */
  isBlocked(fromX: number, fromZ: number, toX: number, toZ: number): boolean;

  /** Check if a tile is walkable (no blocking flags) */
  isWalkable(tileX: number, tileZ: number): boolean;

  /** Clear all collision data */
  clear(): void;

  /** Get raw zone data for networking */
  getZoneData(zoneX: number, zoneZ: number): Int32Array | null;

  /** Set raw zone data from network */
  setZoneData(zoneX: number, zoneZ: number, data: Int32Array): void;

  /** Get count of allocated zones (for debugging) */
  getZoneCount(): number;
}

/**
 * CollisionMatrix implementation with zone-based storage
 */
export class CollisionMatrix implements ICollisionMatrix {
  /** Zone storage: Map<"zoneX,zoneZ", Int32Array[64]> */
  private zones: Map<string, Int32Array>;

  constructor() {
    this.zones = new Map();
  }

  /**
   * Get zone key from tile coordinates
   * Uses Math.floor for correct negative coordinate handling
   */
  private getZoneKey(tileX: number, tileZ: number): string {
    const zoneX = Math.floor(tileX / ZONE_SIZE);
    const zoneZ = Math.floor(tileZ / ZONE_SIZE);
    return `${zoneX},${zoneZ}`;
  }

  /**
   * Get tile index within a zone (0-63)
   * Uses corrected modulo for negative numbers
   */
  private getTileIndex(tileX: number, tileZ: number): number {
    const localX = ((tileX % ZONE_SIZE) + ZONE_SIZE) % ZONE_SIZE;
    const localZ = ((tileZ % ZONE_SIZE) + ZONE_SIZE) % ZONE_SIZE;
    return localX + localZ * ZONE_SIZE;
  }

  /**
   * Get or create a zone for the given tile coordinates
   */
  private getOrCreateZone(tileX: number, tileZ: number): Int32Array {
    const key = this.getZoneKey(tileX, tileZ);
    let zone = this.zones.get(key);
    if (!zone) {
      zone = new Int32Array(TILES_PER_ZONE);
      this.zones.set(key, zone);
    }
    return zone;
  }

  /**
   * Get zone if it exists (returns null if not allocated)
   */
  private getZone(tileX: number, tileZ: number): Int32Array | null {
    const key = this.getZoneKey(tileX, tileZ);
    return this.zones.get(key) ?? null;
  }

  /**
   * Get collision flags for a tile
   * Returns 0 if zone not allocated (unblocked)
   */
  getFlags(tileX: number, tileZ: number): number {
    const zone = this.getZone(tileX, tileZ);
    if (!zone) return 0;
    const index = this.getTileIndex(tileX, tileZ);
    return zone[index];
  }

  /**
   * Set collision flags for a tile (replaces existing)
   */
  setFlags(tileX: number, tileZ: number, flags: number): void {
    const zone = this.getOrCreateZone(tileX, tileZ);
    const index = this.getTileIndex(tileX, tileZ);
    zone[index] = flags;
  }

  /**
   * Add collision flags to a tile (bitwise OR)
   */
  addFlags(tileX: number, tileZ: number, flags: number): void {
    const zone = this.getOrCreateZone(tileX, tileZ);
    const index = this.getTileIndex(tileX, tileZ);
    zone[index] |= flags;
  }

  /**
   * Remove collision flags from a tile (bitwise AND NOT)
   */
  removeFlags(tileX: number, tileZ: number, flags: number): void {
    const zone = this.getZone(tileX, tileZ);
    if (!zone) return; // Nothing to remove from unallocated zone
    const index = this.getTileIndex(tileX, tileZ);
    zone[index] &= ~flags;
  }

  /**
   * Check if tile has any of the specified flags
   */
  hasFlags(tileX: number, tileZ: number, flags: number): boolean {
    const zone = this.getZone(tileX, tileZ);
    if (!zone) return false;
    const index = this.getTileIndex(tileX, tileZ);
    return (zone[index] & flags) !== 0;
  }

  /**
   * Check if a tile is walkable (no blocking flags)
   */
  isWalkable(tileX: number, tileZ: number): boolean {
    return !this.hasFlags(tileX, tileZ, CollisionMask.BLOCKS_MOVEMENT);
  }

  /**
   * Check if movement from one tile to another is blocked
   *
   * Handles:
   * - Full tile blocking (BLOCKED, WATER, etc.)
   * - Entity occupancy (OCCUPIED_PLAYER, OCCUPIED_NPC)
   * - Directional walls (movement direction specific)
   * - Diagonal movement (checks cardinal tiles too)
   */
  isBlocked(fromX: number, fromZ: number, toX: number, toZ: number): boolean {
    const dx = toX - fromX;
    const dz = toZ - fromZ;

    // Check destination tile for full blocking
    const destFlags = this.getFlags(toX, toZ);
    if (destFlags & CollisionMask.BLOCKS_MOVEMENT) {
      return true;
    }

    // Check directional wall flags
    // Wall in destination blocking entry from our direction
    const entryWallFlag = getWallFlagForDirection(-dx, -dz);
    if (entryWallFlag && destFlags & entryWallFlag) {
      return true;
    }

    // Wall in source blocking exit in our direction
    const sourceFlags = this.getFlags(fromX, fromZ);
    const exitWallFlag = getOppositeWallFlag(entryWallFlag);
    if (exitWallFlag && sourceFlags & exitWallFlag) {
      return true;
    }

    // Diagonal movement requires checking both cardinal tiles
    if (dx !== 0 && dz !== 0) {
      // Check horizontal adjacent tile
      const horizFlags = this.getFlags(fromX + dx, fromZ);
      if (horizFlags & CollisionMask.BLOCKS_MOVEMENT) {
        return true;
      }

      // Check vertical adjacent tile
      const vertFlags = this.getFlags(fromX, fromZ + dz);
      if (vertFlags & CollisionMask.BLOCKS_MOVEMENT) {
        return true;
      }

      // Check wall flags for diagonal clipping
      // Horizontal tile: check if wall blocks from our Z direction
      const horizWallFlag = getWallFlagForDirection(0, -dz);
      if (horizWallFlag && horizFlags & horizWallFlag) {
        return true;
      }

      // Vertical tile: check if wall blocks from our X direction
      const vertWallFlag = getWallFlagForDirection(-dx, 0);
      if (vertWallFlag && vertFlags & vertWallFlag) {
        return true;
      }
    }

    return false;
  }

  /**
   * Clear all collision data
   */
  clear(): void {
    this.zones.clear();
  }

  /**
   * Get raw zone data for networking
   * Returns null if zone not allocated
   */
  getZoneData(zoneX: number, zoneZ: number): Int32Array | null {
    const key = `${zoneX},${zoneZ}`;
    return this.zones.get(key) ?? null;
  }

  /**
   * Set raw zone data from network
   * Creates a copy to prevent external mutation
   */
  setZoneData(zoneX: number, zoneZ: number, data: Int32Array): void {
    if (data.length !== TILES_PER_ZONE) {
      console.error(
        `CollisionMatrix: Invalid zone data length ${data.length}, expected ${TILES_PER_ZONE}`,
      );
      return;
    }
    const key = `${zoneX},${zoneZ}`;
    // Create a copy to prevent external mutation
    this.zones.set(key, new Int32Array(data));
  }

  /**
   * Get count of allocated zones (for debugging/metrics)
   */
  getZoneCount(): number {
    return this.zones.size;
  }

  /**
   * Get all zone keys (for debugging/serialization)
   */
  getZoneKeys(): string[] {
    return Array.from(this.zones.keys());
  }

  /**
   * Debug: Print collision state for a tile range
   */
  debugPrint(
    minX: number,
    minZ: number,
    maxX: number,
    maxZ: number,
  ): string[][] {
    const result: string[][] = [];
    for (let z = maxZ; z >= minZ; z--) {
      const row: string[] = [];
      for (let x = minX; x <= maxX; x++) {
        const flags = this.getFlags(x, z);
        if (flags === 0) {
          row.push(".");
        } else if (flags & CollisionFlag.BLOCKED) {
          row.push("#");
        } else if (flags & CollisionMask.OCCUPIED) {
          row.push("@");
        } else if (flags & CollisionFlag.WATER) {
          row.push("~");
        } else if (flags & CollisionMask.WALLS) {
          row.push("+");
        } else {
          row.push("?");
        }
      }
      result.push(row);
    }
    return result;
  }

  // ============================================================================
  // NETWORK SERIALIZATION
  // ============================================================================

  /**
   * Serialize a zone to base64 for network transport
   * Zone data is 64 int32s = 256 bytes -> ~344 chars base64
   *
   * @param zoneX - Zone X coordinate
   * @param zoneZ - Zone Z coordinate
   * @returns Base64 encoded zone data, or null if zone not allocated
   */
  serializeZone(zoneX: number, zoneZ: number): string | null {
    const data = this.getZoneData(zoneX, zoneZ);
    if (!data) return null;

    // Convert Int32Array to base64
    const bytes = new Uint8Array(data.buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  /**
   * Deserialize and apply zone data from base64
   *
   * @param zoneX - Zone X coordinate
   * @param zoneZ - Zone Z coordinate
   * @param base64Data - Base64 encoded zone data
   * @returns True if successfully applied
   */
  deserializeZone(zoneX: number, zoneZ: number, base64Data: string): boolean {
    try {
      const binary = atob(base64Data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }

      const data = new Int32Array(bytes.buffer);
      if (data.length !== TILES_PER_ZONE) {
        console.error(
          `CollisionMatrix: Invalid deserialized zone length ${data.length}`,
        );
        return false;
      }

      this.setZoneData(zoneX, zoneZ, data);
      return true;
    } catch (error) {
      console.error("CollisionMatrix: Failed to deserialize zone:", error);
      return false;
    }
  }

  /**
   * Get all allocated zones within a tile radius
   * Useful for sending relevant collision data to players
   *
   * @param centerTileX - Center tile X
   * @param centerTileZ - Center tile Z
   * @param radiusTiles - Radius in tiles
   * @returns Array of zone coordinates with data
   */
  getZonesInRadius(
    centerTileX: number,
    centerTileZ: number,
    radiusTiles: number,
  ): Array<{ zoneX: number; zoneZ: number; data: Int32Array }> {
    const centerZoneX = Math.floor(centerTileX / ZONE_SIZE);
    const centerZoneZ = Math.floor(centerTileZ / ZONE_SIZE);
    const zoneRadius = Math.ceil(radiusTiles / ZONE_SIZE);

    const result: Array<{ zoneX: number; zoneZ: number; data: Int32Array }> =
      [];

    for (let dx = -zoneRadius; dx <= zoneRadius; dx++) {
      for (let dz = -zoneRadius; dz <= zoneRadius; dz++) {
        const zoneX = centerZoneX + dx;
        const zoneZ = centerZoneZ + dz;
        const data = this.getZoneData(zoneX, zoneZ);
        if (data) {
          result.push({ zoneX, zoneZ, data });
        }
      }
    }

    return result;
  }

  /**
   * Apply multiple zones from network data
   * Used when receiving bulk collision data from server
   *
   * @param zones - Array of zone data to apply
   */
  applyNetworkZones(
    zones: Array<{ zoneX: number; zoneZ: number; base64Data: string }>,
  ): void {
    for (const zone of zones) {
      this.deserializeZone(zone.zoneX, zone.zoneZ, zone.base64Data);
    }
  }
}

/**
 * Network packet type for zone collision sync
 * Server sends this when player enters new area
 */
export interface ZoneCollisionPacket {
  /** Zones to sync (only allocated zones with collision data) */
  zones: Array<{
    zoneX: number;
    zoneZ: number;
    /** Base64 encoded Int32Array[64] = 256 bytes */
    data: string;
  }>;
}
