/**
 * NPCPositionBuffer - Typed array buffer for NPC positions
 *
 * Uses TypedArrays for efficient memory layout and batch operations.
 * Ideal for network serialization and GPU-friendly data access.
 *
 * Memory layout per NPC (20 bytes):
 * - Position: Float32 x 3 (12 bytes)
 * - Tile: Int16 x 2 (4 bytes)
 * - Flags: Uint8 x 4 (4 bytes)
 *
 * Performance characteristics:
 * - Cache-friendly linear memory layout
 * - Zero allocation after construction
 * - Efficient batch iteration
 * - Direct buffer access for network serialization
 *
 */

import type { Position3D } from "../../types";
import type { TileCoord } from "../../systems/shared/movement/TileSystem";

/**
 * NPC flags stored in the buffer
 */
export const enum NPCFlag {
  NONE = 0,
  DEAD = 1 << 0,
  IN_COMBAT = 1 << 1,
  WANDERING = 1 << 2,
  CHASING = 1 << 3,
  ATTACKING = 1 << 4,
  BLOCKED = 1 << 5,
  VISIBLE = 1 << 6,
  DIRTY = 1 << 7, // Position changed this tick
}

/**
 * Buffer configuration
 */
export interface NPCPositionBufferConfig {
  /** Maximum number of NPCs */
  maxNPCs: number;
  /** Initial count (optional, for pre-warming) */
  initialCount?: number;
}

/**
 * NPCPositionBuffer - Efficient storage for NPC spatial data
 *
 * Stores positions, tiles, and flags for all NPCs in a contiguous
 * TypedArray buffer for optimal performance.
 */
export class NPCPositionBuffer {
  // Constants for buffer layout
  private static readonly FLOATS_PER_POSITION = 3; // x, y, z
  private static readonly INTS_PER_TILE = 2; // x, z
  private static readonly FLAGS_PER_NPC = 4; // flags, reserved, reserved, reserved

  // Typed arrays for efficient storage
  private readonly _positions: Float32Array;
  private readonly _tiles: Int16Array;
  private readonly _flags: Uint8Array;

  // Capacity and count
  private readonly _maxNPCs: number;
  private _count: number = 0;

  // ID to index mapping (for sparse access by NPC ID)
  private readonly _idToIndex = new Map<string, number>();
  private readonly _indexToId: string[] = [];

  // Pre-allocated output objects for zero-allocation getters
  private readonly _tempPosition: Position3D = { x: 0, y: 0, z: 0 };
  private readonly _tempTile: TileCoord = { x: 0, z: 0 };

  constructor(config: NPCPositionBufferConfig) {
    this._maxNPCs = config.maxNPCs;

    // Allocate typed arrays
    this._positions = new Float32Array(
      config.maxNPCs * NPCPositionBuffer.FLOATS_PER_POSITION,
    );
    this._tiles = new Int16Array(
      config.maxNPCs * NPCPositionBuffer.INTS_PER_TILE,
    );
    this._flags = new Uint8Array(
      config.maxNPCs * NPCPositionBuffer.FLAGS_PER_NPC,
    );

    // Pre-allocate index mapping array
    this._indexToId.length = config.maxNPCs;
  }

  /**
   * Add an NPC to the buffer
   *
   * @param id - Unique NPC identifier
   * @returns Index in the buffer, or -1 if full
   */
  add(id: string): number {
    if (this._count >= this._maxNPCs) {
      return -1;
    }

    const index = this._count++;
    this._idToIndex.set(id, index);
    this._indexToId[index] = id;

    // Initialize to zero
    this.clearAt(index);

    return index;
  }

  /**
   * Remove an NPC from the buffer
   *
   * Uses swap-and-pop for O(1) removal.
   *
   * @param id - NPC identifier to remove
   * @returns true if removed
   */
  remove(id: string): boolean {
    const index = this._idToIndex.get(id);
    if (index === undefined) {
      return false;
    }

    const lastIndex = this._count - 1;

    if (index !== lastIndex) {
      // Swap with last element
      const lastId = this._indexToId[lastIndex];

      // Copy last element to removed position
      this.copyAt(index, lastIndex);

      // Update mappings
      this._idToIndex.set(lastId, index);
      this._indexToId[index] = lastId;
    }

    // Remove last element
    this._idToIndex.delete(id);
    this._indexToId[lastIndex] = "";
    this._count--;

    return true;
  }

  /**
   * Set position for NPC at index
   */
  setPosition(index: number, x: number, y: number, z: number): void {
    const offset = index * NPCPositionBuffer.FLOATS_PER_POSITION;
    this._positions[offset] = x;
    this._positions[offset + 1] = y;
    this._positions[offset + 2] = z;

    // Mark dirty
    this.setFlag(index, NPCFlag.DIRTY);
  }

  /**
   * Set position from Position3D object
   */
  setPositionFrom(index: number, pos: Position3D): void {
    this.setPosition(index, pos.x, pos.y, pos.z);
  }

  /**
   * Get position for NPC at index (zero-allocation)
   *
   * Writes to the internal temp object.
   * Returns a reference that may be overwritten by next call.
   */
  getPosition(index: number): Position3D {
    const offset = index * NPCPositionBuffer.FLOATS_PER_POSITION;
    this._tempPosition.x = this._positions[offset];
    this._tempPosition.y = this._positions[offset + 1];
    this._tempPosition.z = this._positions[offset + 2];
    return this._tempPosition;
  }

  /**
   * Get position into provided object (zero-allocation)
   */
  getPositionInto(index: number, out: Position3D): void {
    const offset = index * NPCPositionBuffer.FLOATS_PER_POSITION;
    out.x = this._positions[offset];
    out.y = this._positions[offset + 1];
    out.z = this._positions[offset + 2];
  }

  /**
   * Set tile for NPC at index
   */
  setTile(index: number, x: number, z: number): void {
    const offset = index * NPCPositionBuffer.INTS_PER_TILE;
    this._tiles[offset] = x;
    this._tiles[offset + 1] = z;
  }

  /**
   * Get tile for NPC at index (zero-allocation)
   */
  getTile(index: number): TileCoord {
    const offset = index * NPCPositionBuffer.INTS_PER_TILE;
    this._tempTile.x = this._tiles[offset];
    this._tempTile.z = this._tiles[offset + 1];
    return this._tempTile;
  }

  /**
   * Get tile into provided object (zero-allocation)
   */
  getTileInto(index: number, out: TileCoord): void {
    const offset = index * NPCPositionBuffer.INTS_PER_TILE;
    out.x = this._tiles[offset];
    out.z = this._tiles[offset + 1];
  }

  /**
   * Set flag for NPC at index
   */
  setFlag(index: number, flag: NPCFlag): void {
    const offset = index * NPCPositionBuffer.FLAGS_PER_NPC;
    this._flags[offset] |= flag;
  }

  /**
   * Clear flag for NPC at index
   */
  clearFlag(index: number, flag: NPCFlag): void {
    const offset = index * NPCPositionBuffer.FLAGS_PER_NPC;
    this._flags[offset] &= ~flag;
  }

  /**
   * Check if flag is set
   */
  hasFlag(index: number, flag: NPCFlag): boolean {
    const offset = index * NPCPositionBuffer.FLAGS_PER_NPC;
    return (this._flags[offset] & flag) !== 0;
  }

  /**
   * Get all flags for NPC at index
   */
  getFlags(index: number): number {
    const offset = index * NPCPositionBuffer.FLAGS_PER_NPC;
    return this._flags[offset];
  }

  /**
   * Set all flags for NPC at index
   */
  setFlags(index: number, flags: number): void {
    const offset = index * NPCPositionBuffer.FLAGS_PER_NPC;
    this._flags[offset] = flags;
  }

  /**
   * Get index for NPC ID
   */
  getIndex(id: string): number | undefined {
    return this._idToIndex.get(id);
  }

  /**
   * Get ID for index
   */
  getId(index: number): string {
    return this._indexToId[index] ?? "";
  }

  /**
   * Get current count
   */
  getCount(): number {
    return this._count;
  }

  /**
   * Get maximum capacity
   */
  getMaxCount(): number {
    return this._maxNPCs;
  }

  /**
   * Check if buffer is full
   */
  isFull(): boolean {
    return this._count >= this._maxNPCs;
  }

  /**
   * Clear all NPCs from buffer
   */
  clear(): void {
    this._count = 0;
    this._idToIndex.clear();
    // Note: Don't need to clear typed arrays - they'll be overwritten
  }

  /**
   * Clear dirty flags for all NPCs
   *
   * Call at end of tick after processing position updates.
   */
  clearDirtyFlags(): void {
    for (let i = 0; i < this._count; i++) {
      this.clearFlag(i, NPCFlag.DIRTY);
    }
  }

  /**
   * Get raw position buffer (for network serialization)
   */
  getPositionBuffer(): Float32Array {
    return this._positions;
  }

  /**
   * Get raw tile buffer
   */
  getTileBuffer(): Int16Array {
    return this._tiles;
  }

  /**
   * Get raw flags buffer
   */
  getFlagsBuffer(): Uint8Array {
    return this._flags;
  }

  /**
   * Copy data from one index to another
   */
  private copyAt(destIndex: number, srcIndex: number): void {
    // Copy position
    const destPosOffset = destIndex * NPCPositionBuffer.FLOATS_PER_POSITION;
    const srcPosOffset = srcIndex * NPCPositionBuffer.FLOATS_PER_POSITION;
    this._positions[destPosOffset] = this._positions[srcPosOffset];
    this._positions[destPosOffset + 1] = this._positions[srcPosOffset + 1];
    this._positions[destPosOffset + 2] = this._positions[srcPosOffset + 2];

    // Copy tile
    const destTileOffset = destIndex * NPCPositionBuffer.INTS_PER_TILE;
    const srcTileOffset = srcIndex * NPCPositionBuffer.INTS_PER_TILE;
    this._tiles[destTileOffset] = this._tiles[srcTileOffset];
    this._tiles[destTileOffset + 1] = this._tiles[srcTileOffset + 1];

    // Copy flags
    const destFlagOffset = destIndex * NPCPositionBuffer.FLAGS_PER_NPC;
    const srcFlagOffset = srcIndex * NPCPositionBuffer.FLAGS_PER_NPC;
    for (let i = 0; i < NPCPositionBuffer.FLAGS_PER_NPC; i++) {
      this._flags[destFlagOffset + i] = this._flags[srcFlagOffset + i];
    }
  }

  /**
   * Clear data at index
   */
  private clearAt(index: number): void {
    // Clear position
    const posOffset = index * NPCPositionBuffer.FLOATS_PER_POSITION;
    this._positions[posOffset] = 0;
    this._positions[posOffset + 1] = 0;
    this._positions[posOffset + 2] = 0;

    // Clear tile
    const tileOffset = index * NPCPositionBuffer.INTS_PER_TILE;
    this._tiles[tileOffset] = 0;
    this._tiles[tileOffset + 1] = 0;

    // Clear flags
    const flagOffset = index * NPCPositionBuffer.FLAGS_PER_NPC;
    for (let i = 0; i < NPCPositionBuffer.FLAGS_PER_NPC; i++) {
      this._flags[flagOffset + i] = 0;
    }
  }
}
