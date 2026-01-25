/**
 * Chunk-based spatial partitioning for efficient entity queries.
 * 64m grid, hysteresis for boundary stability, cached active chunks.
 */

import {
  WORLD_CONSTANTS,
  DISTANCE_CONSTANTS,
} from "../../../constants/GameConstants";

type ChunkKey = string;

interface EntityRegistration {
  entityId: string;
  x: number;
  z: number;
  entityType: string;
  chunkKey: ChunkKey;
  isPlayer: boolean;
}

export interface SpatialQueryResult {
  entityId: string;
  entityType: string;
  distanceSq: number;
}

export interface ChunkStats {
  totalChunks: number;
  activeChunks: number;
  totalEntities: number;
  playerCount: number;
  avgEntitiesPerChunk: number;
}

export class SpatialEntityRegistry {
  private readonly CHUNK_SIZE = WORLD_CONSTANTS.CHUNK_SIZE;
  private readonly HYSTERESIS = DISTANCE_CONSTANTS.SIMULATION.CHUNK_HYSTERESIS;
  private readonly ACTIVE_RADIUS_SQ =
    DISTANCE_CONSTANTS.SIMULATION_SQ.CHUNK_ACTIVE;
  private readonly ACTIVE_RADIUS = Math.sqrt(
    DISTANCE_CONSTANTS.SIMULATION_SQ.CHUNK_ACTIVE,
  );

  private entityChunks = new Map<ChunkKey, Set<string>>();
  private entities = new Map<string, EntityRegistration>();
  private players = new Set<string>();
  private activeChunksCache = new Set<ChunkKey>();
  private activeChunksDirty = true;
  private lastPlayerChunks = new Map<string, ChunkKey>();

  private getChunkKey(x: number, z: number): ChunkKey {
    return `${Math.floor(x / this.CHUNK_SIZE)}_${Math.floor(z / this.CHUNK_SIZE)}`;
  }

  private parseChunkKey(key: ChunkKey): { chunkX: number; chunkZ: number } {
    const [chunkX, chunkZ] = key.split("_").map(Number);
    return { chunkX, chunkZ };
  }

  addEntity(
    entityId: string,
    x: number,
    z: number,
    entityType: string,
    isPlayer: boolean = false,
  ): void {
    if (this.entities.has(entityId)) {
      this.updateEntityPosition(entityId, x, z);
      return;
    }

    const chunkKey = this.getChunkKey(x, z);
    const registration: EntityRegistration = {
      entityId,
      x,
      z,
      entityType,
      chunkKey,
      isPlayer,
    };

    this.entities.set(entityId, registration);

    let chunk = this.entityChunks.get(chunkKey);
    if (!chunk) {
      chunk = new Set();
      this.entityChunks.set(chunkKey, chunk);
    }
    chunk.add(entityId);

    if (isPlayer) {
      this.players.add(entityId);
      this.lastPlayerChunks.set(entityId, chunkKey);
      this.activeChunksDirty = true;
    }
  }

  removeEntity(entityId: string): void {
    const registration = this.entities.get(entityId);
    if (!registration) return;

    const chunk = this.entityChunks.get(registration.chunkKey);
    if (chunk) {
      chunk.delete(entityId);
      if (chunk.size === 0) this.entityChunks.delete(registration.chunkKey);
    }

    if (registration.isPlayer) {
      this.players.delete(entityId);
      this.lastPlayerChunks.delete(entityId);
      this.activeChunksDirty = true;
    }

    this.entities.delete(entityId);
  }

  updateEntityPosition(entityId: string, x: number, z: number): void {
    const registration = this.entities.get(entityId);
    if (!registration) return;

    registration.x = x;
    registration.z = z;

    const newChunkKey = this.getChunkKey(x, z);
    if (newChunkKey === registration.chunkKey) return;

    // Hysteresis for players to prevent boundary jitter
    if (registration.isPlayer) {
      const oldChunk = this.parseChunkKey(registration.chunkKey);
      const oldCenterX = (oldChunk.chunkX + 0.5) * this.CHUNK_SIZE;
      const oldCenterZ = (oldChunk.chunkZ + 0.5) * this.CHUNK_SIZE;
      const distFromOldCenter = Math.sqrt(
        (x - oldCenterX) ** 2 + (z - oldCenterZ) ** 2,
      );
      if (distFromOldCenter < this.CHUNK_SIZE / 2 + this.HYSTERESIS) return;
    }

    // Move to new chunk
    const oldChunk = this.entityChunks.get(registration.chunkKey);
    if (oldChunk) {
      oldChunk.delete(entityId);
      if (oldChunk.size === 0) this.entityChunks.delete(registration.chunkKey);
    }

    let newChunk = this.entityChunks.get(newChunkKey);
    if (!newChunk) {
      newChunk = new Set();
      this.entityChunks.set(newChunkKey, newChunk);
    }
    newChunk.add(entityId);

    registration.chunkKey = newChunkKey;

    if (registration.isPlayer) {
      this.lastPlayerChunks.set(entityId, newChunkKey);
      this.activeChunksDirty = true;
    }
  }

  /** Get entities within radius, sorted by distance */
  getEntitiesInRange(
    x: number,
    z: number,
    radius: number,
    entityType?: string,
  ): SpatialQueryResult[] {
    const radiusSq = radius * radius;
    const results: SpatialQueryResult[] = [];

    const minChunkX = Math.floor((x - radius) / this.CHUNK_SIZE);
    const maxChunkX = Math.floor((x + radius) / this.CHUNK_SIZE);
    const minChunkZ = Math.floor((z - radius) / this.CHUNK_SIZE);
    const maxChunkZ = Math.floor((z + radius) / this.CHUNK_SIZE);

    for (let cx = minChunkX; cx <= maxChunkX; cx++) {
      for (let cz = minChunkZ; cz <= maxChunkZ; cz++) {
        const chunk = this.entityChunks.get(`${cx}_${cz}`);
        if (!chunk) continue;

        for (const entityId of chunk) {
          const reg = this.entities.get(entityId);
          if (!reg || (entityType && reg.entityType !== entityType)) continue;

          const dx = reg.x - x;
          const dz = reg.z - z;
          const distSq = dx * dx + dz * dz;

          if (distSq <= radiusSq) {
            results.push({
              entityId: reg.entityId,
              entityType: reg.entityType,
              distanceSq: distSq,
            });
          }
        }
      }
    }

    return results.sort((a, b) => a.distanceSq - b.distanceSq);
  }

  getEntitiesInChunk(chunkKey: ChunkKey): string[] {
    const chunk = this.entityChunks.get(chunkKey);
    return chunk ? Array.from(chunk) : [];
  }

  getPlayerPositions(): Array<{ entityId: string; x: number; z: number }> {
    const positions: Array<{ entityId: string; x: number; z: number }> = [];
    for (const playerId of this.players) {
      const reg = this.entities.get(playerId);
      if (reg) positions.push({ entityId: playerId, x: reg.x, z: reg.z });
    }
    return positions;
  }

  getNearestPlayer(
    x: number,
    z: number,
  ): { entityId: string; distanceSq: number } | null {
    let nearest: { entityId: string; distanceSq: number } | null = null;
    for (const playerId of this.players) {
      const reg = this.entities.get(playerId);
      if (!reg) continue;
      const dx = reg.x - x;
      const dz = reg.z - z;
      const distSq = dx * dx + dz * dz;
      if (!nearest || distSq < nearest.distanceSq) {
        nearest = { entityId: playerId, distanceSq: distSq };
      }
    }
    return nearest;
  }

  /** Get chunks near any player (cached until player changes chunk) */
  getActiveChunks(): Set<ChunkKey> {
    if (!this.activeChunksDirty) return this.activeChunksCache;

    this.activeChunksCache.clear();

    for (const playerId of this.players) {
      const reg = this.entities.get(playerId);
      if (!reg) continue;

      const { x, z } = reg;
      const minCX = Math.floor((x - this.ACTIVE_RADIUS) / this.CHUNK_SIZE);
      const maxCX = Math.floor((x + this.ACTIVE_RADIUS) / this.CHUNK_SIZE);
      const minCZ = Math.floor((z - this.ACTIVE_RADIUS) / this.CHUNK_SIZE);
      const maxCZ = Math.floor((z + this.ACTIVE_RADIUS) / this.CHUNK_SIZE);

      for (let cx = minCX; cx <= maxCX; cx++) {
        for (let cz = minCZ; cz <= maxCZ; cz++) {
          const chunkCenterX = (cx + 0.5) * this.CHUNK_SIZE;
          const chunkCenterZ = (cz + 0.5) * this.CHUNK_SIZE;
          const dx = chunkCenterX - x;
          const dz = chunkCenterZ - z;
          if (dx * dx + dz * dz <= this.ACTIVE_RADIUS_SQ) {
            this.activeChunksCache.add(`${cx}_${cz}`);
          }
        }
      }
    }

    this.activeChunksDirty = false;
    return this.activeChunksCache;
  }

  isChunkActive(chunkKey: ChunkKey): boolean {
    return this.getActiveChunks().has(chunkKey);
  }

  isEntityActive(entityId: string): boolean {
    const reg = this.entities.get(entityId);
    return reg ? this.isChunkActive(reg.chunkKey) : false;
  }

  getActiveEntities(): string[] {
    const result: string[] = [];
    for (const chunkKey of this.getActiveChunks()) {
      const chunk = this.entityChunks.get(chunkKey);
      if (chunk) {
        for (const entityId of chunk) result.push(entityId);
      }
    }
    return result;
  }

  getEntityRegistration(entityId: string): EntityRegistration | undefined {
    return this.entities.get(entityId);
  }

  getStats(): ChunkStats {
    return {
      totalChunks: this.entityChunks.size,
      activeChunks: this.getActiveChunks().size,
      totalEntities: this.entities.size,
      playerCount: this.players.size,
      avgEntitiesPerChunk:
        this.entityChunks.size > 0
          ? this.entities.size / this.entityChunks.size
          : 0,
    };
  }

  clear(): void {
    this.entityChunks.clear();
    this.entities.clear();
    this.players.clear();
    this.activeChunksCache.clear();
    this.lastPlayerChunks.clear();
    this.activeChunksDirty = true;
  }
}
