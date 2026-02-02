/**
 * ProceduralDocks.ts - Dock Generation System
 *
 * System for generating procedural docks on water bodies (ponds, lakes).
 *
 * Architecture:
 * - Detects pond shorelines using terrain height sampling
 * - Scores potential dock placement locations
 * - Generates dock geometry using DockGenerator
 * - Integrates with collision system for walkable surfaces
 *
 * @module ProceduralDocks
 */

import * as THREE from "three";
import { System } from "../infrastructure/System";
import type { World } from "../../../types";
import { TERRAIN_CONSTANTS } from "../../../constants/GameConstants";
import type {
  ShorelinePoint,
  WaterBody,
  ItemCollisionData,
} from "@hyperscape/procgen/items";
import {
  DockGenerator,
  DEFAULT_DOCK_PARAMS,
  type GeneratedDock,
  type DockRecipe,
} from "@hyperscape/procgen/items/dock";

// Constants
const WATER_THRESHOLD = TERRAIN_CONSTANTS.WATER_THRESHOLD;
const WATER_LEVEL = 5.0;
const SHORELINE_SAMPLES = 64;
const MAX_SLOPE_FOR_DOCK = 0.4;
const MIN_WATER_DEPTH = 1.5;

/** Known pond on the island */
const ISLAND_POND: WaterBody = {
  id: "island-pond",
  type: "pond",
  center: { x: -80, z: 60 },
  radius: 50,
};

/** Find shoreline points around a water body using binary search */
function findShorelinePoints(
  waterBody: WaterBody,
  getTerrainHeight: (x: number, z: number) => number,
  samples: number = SHORELINE_SAMPLES,
): ShorelinePoint[] {
  const shorelinePoints: ShorelinePoint[] = [];

  // Sample points in concentric rings around the pond center
  // We're looking for where terrain crosses from below to above water threshold
  const { center, radius } = waterBody;

  // For each angle around the circle
  for (let i = 0; i < samples; i++) {
    const angle = (i / samples) * Math.PI * 2;
    const dirX = Math.cos(angle);
    const dirZ = Math.sin(angle);

    // Binary search along the radial line to find shoreline
    let minDist = radius * 0.3; // Start from inner pond
    let maxDist = radius * 1.5; // Extend beyond nominal radius
    let foundShoreline = false;

    // Sample along the radial to find water edge
    for (let step = 0; step < 20; step++) {
      const midDist = (minDist + maxDist) / 2;
      const x = center.x + dirX * midDist;
      const z = center.z + dirZ * midDist;
      const height = getTerrainHeight(x, z);

      if (height < WATER_THRESHOLD) {
        // Still underwater, move outward
        minDist = midDist;
      } else {
        // Above water, move inward
        maxDist = midDist;
        foundShoreline = true;
      }

      // Stop when converged
      if (maxDist - minDist < 0.5) break;
    }

    if (!foundShoreline) continue;

    // The shoreline is at the boundary we found
    const shorelineDist = (minDist + maxDist) / 2;
    const shoreX = center.x + dirX * shorelineDist;
    const shoreZ = center.z + dirZ * shorelineDist;
    const height = getTerrainHeight(shoreX, shoreZ);

    // Calculate slope at this point
    const sampleDist = 1.0;
    const heightInward = getTerrainHeight(
      shoreX - dirX * sampleDist,
      shoreZ - dirZ * sampleDist,
    );
    const heightOutward = getTerrainHeight(
      shoreX + dirX * sampleDist,
      shoreZ + dirZ * sampleDist,
    );
    const slope = Math.abs(heightOutward - heightInward) / (sampleDist * 2);

    shorelinePoints.push({
      position: { x: shoreX, y: height, z: shoreZ },
      landwardNormal: { x: dirX, z: dirZ }, // Points away from water
      waterwardNormal: { x: -dirX, z: -dirZ }, // Points into water
      height,
      slope,
      distanceFromCenter: shorelineDist,
    });
  }

  return shorelinePoints;
}

interface PlacementCandidate {
  point: ShorelinePoint;
  score: number;
  components: {
    flatness: number;
    waterDepth: number;
    clearance: number;
    orientation: number;
  };
}

/** Score a shoreline point for dock placement */
function scorePlacementPoint(
  point: ShorelinePoint,
  getTerrainHeight: (x: number, z: number) => number,
  checkObstacle: (x: number, z: number) => boolean,
  dockLength: number,
): PlacementCandidate {
  const components = {
    flatness: 0,
    waterDepth: 0,
    clearance: 0,
    orientation: 0,
  };

  // 1. Flatness score (prefer low slope)
  // Max slope of 0.4 gets 0, flat gets 1
  components.flatness = Math.max(0, 1 - point.slope / MAX_SLOPE_FOR_DOCK);

  // 2. Water depth score (ensure adequate depth for posts)
  // Sample water depth at end of potential dock
  const endX = point.position.x + point.waterwardNormal.x * dockLength;
  const endZ = point.position.z + point.waterwardNormal.z * dockLength;
  const endHeight = getTerrainHeight(endX, endZ);
  const waterDepth = WATER_THRESHOLD - endHeight;

  // ENFORCE minimum depth: if too shallow, disqualify this placement
  if (waterDepth < MIN_WATER_DEPTH) {
    components.waterDepth = 0;
  } else {
    components.waterDepth = Math.min(1, waterDepth / (MIN_WATER_DEPTH * 2));
  }

  // 3. Clearance score (check for obstacles on land side)
  // Sample a few points behind the dock
  let obstacleCount = 0;
  for (let d = 1; d <= 5; d++) {
    const checkX = point.position.x + point.landwardNormal.x * d;
    const checkZ = point.position.z + point.landwardNormal.z * d;
    if (checkObstacle(checkX, checkZ)) {
      obstacleCount++;
    }
  }
  components.clearance = Math.max(0, 1 - obstacleCount / 3);

  // 4. Orientation score (prefer south-facing for aesthetics/lighting)
  // South is +Z direction in this coordinate system
  const facingSouth = point.waterwardNormal.z;
  components.orientation = 0.5 + facingSouth * 0.5; // 0 to 1

  // Calculate total score (weighted)
  const weights = {
    flatness: 0.35,
    waterDepth: 0.3,
    clearance: 0.2,
    orientation: 0.15,
  };

  const score =
    components.flatness * weights.flatness +
    components.waterDepth * weights.waterDepth +
    components.clearance * weights.clearance +
    components.orientation * weights.orientation;

  return {
    point,
    score,
    components,
  };
}

/** Select the best dock placement from candidates using weighted random */
function selectBestPlacement(
  candidates: PlacementCandidate[],
  seed: number,
): PlacementCandidate | null {
  if (candidates.length === 0) return null;

  // Filter out candidates with score below threshold
  const viableCandidates = candidates.filter((c) => c.score > 0.4);
  if (viableCandidates.length === 0) {
    // Fall back to best available even if below threshold
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0];
  }

  // Sort by score descending
  viableCandidates.sort((a, b) => b.score - a.score);

  // Use seed to add some randomness among top candidates
  // Pick from top 3 with weighted probability
  const topCandidates = viableCandidates.slice(0, 3);
  const totalScore = topCandidates.reduce((sum, c) => sum + c.score, 0);

  // Deterministic selection based on seed
  const seededRandom = (seed * 9301 + 49297) % 233280;
  const threshold = (seededRandom / 233280) * totalScore;

  let accumulated = 0;
  for (const candidate of topCandidates) {
    accumulated += candidate.score;
    if (accumulated >= threshold) {
      return candidate;
    }
  }

  return topCandidates[0];
}

interface DockInstance {
  id: string;
  waterBodyId: string;
  dock: GeneratedDock;
  mesh: THREE.Object3D;
}

interface TerrainSystemInterface {
  getHeightAt(x: number, z: number): number;
}

interface StageSystemInterface {
  scene: THREE.Scene;
}

/** Manages procedural dock generation for water bodies */
export class ProceduralDocks extends System {
  private docks: Map<string, DockInstance> = new Map();
  private generator: DockGenerator;
  private terrainSystem: TerrainSystemInterface | null = null;
  private scene: THREE.Scene | null = null;
  private docksGenerated = false;

  constructor(world: World) {
    super(world);
    this.generator = new DockGenerator();
  }

  /**
   * System init - called automatically by World
   */
  async init(): Promise<void> {
    // Get terrain system reference
    const terrain = this.world.getSystem("terrain");
    if (terrain && "getHeightAt" in terrain) {
      this.terrainSystem = terrain as unknown as TerrainSystemInterface;
    }

    // Get scene from stage system
    const stage = this.world.getSystem("stage");
    if (stage && "scene" in stage) {
      this.scene = (stage as unknown as StageSystemInterface).scene;
    }

    console.log("[ProceduralDocks] Initialized, waiting for terrain...");
  }

  /**
   * Check if terrain system is ready and has valid height data
   * Tests multiple points to ensure terrain is fully loaded
   */
  private isTerrainReady(): boolean {
    if (!this.terrainSystem) return false;

    // Test multiple points around the pond to ensure terrain is fully loaded
    const { center, radius } = ISLAND_POND;
    const testPoints = [
      { x: center.x, z: center.z }, // Center
      { x: center.x + radius * 0.5, z: center.z }, // East
      { x: center.x - radius * 0.5, z: center.z }, // West
      { x: center.x, z: center.z + radius * 0.5 }, // South
      { x: center.x, z: center.z - radius * 0.5 }, // North
    ];

    for (const point of testPoints) {
      const height = this.terrainSystem.getHeightAt(point.x, point.z);
      // Check for invalid height (0 or NaN indicates terrain not loaded)
      if (height === 0 || isNaN(height)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Generate docks for the island pond
   * Called automatically when terrain is ready
   */
  generateDocks(seed: string = "island-docks"): void {
    if (!this.terrainSystem || !this.scene) {
      console.warn(
        "[ProceduralDocks] Systems not ready, cannot generate docks",
      );
      return;
    }

    if (this.docksGenerated) {
      console.log("[ProceduralDocks] Docks already generated");
      return;
    }

    console.log("[ProceduralDocks] Generating docks for island pond...");

    // Generate dock for the main island pond
    const dock = this.generateDockForWaterBody(ISLAND_POND, seed);

    if (dock) {
      console.log(
        `[ProceduralDocks] Generated dock at (${dock.position.x.toFixed(1)}, ${dock.position.z.toFixed(1)})`,
      );
      this.docksGenerated = true;
    } else {
      console.warn("[ProceduralDocks] Failed to find suitable dock location");
    }
  }

  /**
   * Generate a dock for a specific water body
   */
  generateDockForWaterBody(
    waterBody: WaterBody,
    seed: string,
  ): GeneratedDock | null {
    if (!this.terrainSystem || !this.scene) return null;

    // Create terrain height getter
    const getTerrainHeight = (x: number, z: number): number => {
      return this.terrainSystem!.getHeightAt(x, z);
    };

    // Create obstacle checker - checks terrain steepness and water
    const checkObstacle = (x: number, z: number): boolean => {
      const height = getTerrainHeight(x, z);

      // Obstacle if underwater
      if (height < WATER_THRESHOLD) {
        return true;
      }

      // Check terrain steepness at this point
      const sampleDist = 0.5;
      const heightN = getTerrainHeight(x, z + sampleDist);
      const heightS = getTerrainHeight(x, z - sampleDist);
      const heightE = getTerrainHeight(x + sampleDist, z);
      const heightW = getTerrainHeight(x - sampleDist, z);

      const slopeNS = Math.abs(heightN - heightS) / (sampleDist * 2);
      const slopeEW = Math.abs(heightE - heightW) / (sampleDist * 2);
      const maxSlope = Math.max(slopeNS, slopeEW);

      // Obstacle if terrain is too steep (slope > 0.5 = ~27 degrees)
      return maxSlope > 0.5;
    };

    // Find shoreline points
    const shorelinePoints = findShorelinePoints(
      waterBody,
      getTerrainHeight,
      SHORELINE_SAMPLES,
    );

    if (shorelinePoints.length === 0) {
      console.warn(`[ProceduralDocks] No shoreline found for ${waterBody.id}`);
      return null;
    }

    // Estimate dock length for scoring
    const estimatedLength =
      (DEFAULT_DOCK_PARAMS.lengthRange[0] +
        DEFAULT_DOCK_PARAMS.lengthRange[1]) /
      2;

    // Score all placement candidates
    const candidates = shorelinePoints.map((point) =>
      scorePlacementPoint(
        point,
        getTerrainHeight,
        checkObstacle,
        estimatedLength,
      ),
    );

    // Select best placement
    const seedNum = this.hashString(seed);
    const selected = selectBestPlacement(candidates, seedNum);

    if (!selected) {
      console.warn(`[ProceduralDocks] No viable placement for ${waterBody.id}`);
      return null;
    }

    console.log(
      `[ProceduralDocks] Selected placement with score ${selected.score.toFixed(2)}:`,
      `flatness=${selected.components.flatness.toFixed(2)}`,
      `depth=${selected.components.waterDepth.toFixed(2)}`,
      `clearance=${selected.components.clearance.toFixed(2)}`,
      `orientation=${selected.components.orientation.toFixed(2)}`,
    );

    // Generate the dock
    const recipe: DockRecipe = {
      ...DEFAULT_DOCK_PARAMS,
      label: "Pond Dock",
    };

    const dock = this.generator.generate(recipe, selected.point, {
      seed,
      waterLevel: WATER_LEVEL,
      waterFloorDepth: 3.0,
    });

    // DockGenerator now applies WebGPU TSL material internally
    // Add to scene
    this.scene.add(dock.mesh);

    // Store instance
    const instance: DockInstance = {
      id: `dock-${waterBody.id}`,
      waterBodyId: waterBody.id,
      dock,
      mesh: dock.mesh,
    };
    this.docks.set(instance.id, instance);

    return dock;
  }

  /**
   * Get collision data for all docks
   */
  getCollisionData(): ItemCollisionData[] {
    return Array.from(this.docks.values()).map(
      (instance) => instance.dock.collision,
    );
  }

  /**
   * Check if a tile is on a dock
   */
  isDockTile(tileX: number, tileZ: number): boolean {
    for (const instance of this.docks.values()) {
      for (const tile of instance.dock.collision.walkableTiles) {
        if (tile.x === tileX && tile.z === tileZ) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Get dock at a specific tile
   */
  getDockAtTile(tileX: number, tileZ: number): DockInstance | null {
    for (const instance of this.docks.values()) {
      for (const tile of instance.dock.collision.walkableTiles) {
        if (tile.x === tileX && tile.z === tileZ) {
          return instance;
        }
      }
    }
    return null;
  }

  /**
   * Check if movement to a tile is blocked by dock edge
   */
  isDockEdgeBlocked(
    tileX: number,
    tileZ: number,
    direction: "north" | "south" | "east" | "west",
  ): boolean {
    for (const instance of this.docks.values()) {
      for (const edge of instance.dock.collision.blockedEdges) {
        if (
          edge.tileX === tileX &&
          edge.tileZ === tileZ &&
          edge.direction === direction
        ) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Dispose of all dock resources
   */
  dispose(): void {
    for (const instance of this.docks.values()) {
      if (this.scene) {
        this.scene.remove(instance.mesh);
      }
      instance.mesh.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (child.material instanceof THREE.Material) {
            child.material.dispose();
          }
        }
      });
    }
    this.docks.clear();
  }

  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }

  update(_deltaTime: number): void {
    // Check if we should generate docks (terrain became ready)
    if (!this.docksGenerated && this.isTerrainReady()) {
      try {
        this.generateDocks();
      } catch (err) {
        console.error("[ProceduralDocks] Error generating docks:", err);
      }
    }
  }
}

export type { ShorelinePoint, WaterBody, ItemCollisionData };
export { ISLAND_POND, WATER_THRESHOLD, WATER_LEVEL };
