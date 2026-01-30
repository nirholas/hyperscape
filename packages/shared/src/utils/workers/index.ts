/**
 * Web Worker Utilities
 *
 * Provides infrastructure for parallel processing:
 * - WorkerPool: Generic worker pool for task distribution
 * - TerrainWorker: Specialized workers for terrain generation
 * - LODWorker: Auto-LOD generation for 3D assets
 * - VegetationWorker: Vegetation placement computation
 * - ProcgenWorker: Road generation and path smoothing
 *
 * ## Currently Used:
 * - TerrainWorker: generateTerrainHeightmapAsync, generateTerrainTilesBatch
 * - LODWorker: generateLODsAsync, generateLODsBatch
 * - VegetationWorker: generateVegetationPlacementsAsync
 * - ProcgenWorker: smoothPathAsync (used by RoadNetworkSystem)
 *
 * ## Available but Not Yet Integrated:
 * - ProcgenWorker.findPathAsync: A* pathfinding for procgen roads (stepSize=20m)
 * - ProcgenWorker.calculateRoadInfluenceAsync: Terrain deformation near roads
 * - ProcgenWorker.findPathsBatch: Batch A* for multiple roads
 *
 * NOTE: BatchComputeWorker was removed because it was never used.
 * The operations it would handle (distance queries, combat levels) are either:
 * - Already optimized via SpatialEntityRegistry (chunk-based spatial partitioning)
 * - Too fast to benefit from worker overhead (single combat level lookups)
 */

export { WorkerPool, createWorkerFromFunction } from "./WorkerPool";
export {
  getTerrainWorkerPool,
  generateTerrainHeightmapAsync,
  generateTerrainTilesBatch,
  terminateTerrainWorkerPool,
  isTerrainWorkerAvailable,
  type TerrainWorkerConfig,
  type TerrainWorkerInput,
  type TerrainWorkerOutput,
  type TerrainBatchResult,
} from "./TerrainWorker";
export {
  getLODWorkerPool,
  generateLODsAsync,
  generateLODsBatch,
  generateLODsSync,
  terminateLODWorkerPool,
  isLODWorkerAvailable,
  getLODWorkerStats,
  LOD_PRESETS,
  type LODWorkerInput,
  type LODWorkerOutput,
  type LODLevelOutput,
} from "./LODWorker";
export {
  getVegetationWorkerPool,
  generateVegetationPlacementsAsync,
  generateVegetationTilesBatch,
  terminateVegetationWorkerPool,
  isVegetationWorkerAvailable,
  type VegetationWorkerInput,
  type VegetationWorkerOutput,
  type VegetationLayerInput,
  type PlacementData,
  type VegetationBatchResult,
} from "./VegetationWorker";
export {
  getProcgenWorkerPool,
  findPathAsync,
  findPathsBatch,
  calculateRoadInfluenceAsync,
  smoothPathAsync,
  terminateProcgenWorkerPool,
  isProcgenWorkerAvailable,
  type PathfindOutput,
  type RoadInfluenceOutput,
  type SmoothPathOutput,
  type ProcgenWorkerInput,
  type ProcgenWorkerOutput,
} from "./ProcgenWorker";
export {
  getGrassWorkerPool,
  generateGrassPlacementsAsync,
  generateGrassChunksBatch,
  terminateGrassWorkerPool,
  isGrassWorkerAvailable,
  type GrassWorkerInput,
  type GrassWorkerOutput,
  type GrassPlacementData,
  type GrassBatchResult,
} from "./GrassWorker";

// PhysX Worker - Offloads physics simulation to web worker
export {
  isPhysicsWorkerAvailable,
  initPhysicsWorker,
  isPhysicsWorkerReady,
  simulateInWorker,
  addActorToWorker,
  removeActorFromWorker,
  setWorkerActorTransform,
  setWorkerActorVelocity,
  destroyPhysicsWorker,
  type PhysicsActorType,
  type SerializedShape,
  type SerializedActor,
  type ActorTransform,
  type ActorVelocity,
  type SerializedContactEvent,
  type SerializedTriggerEvent,
  type PhysicsWorkerInput,
  type PhysicsWorkerOutput,
} from "./PhysicsWorker";

// Minimap Worker - 2D canvas-based minimap rendering in web worker
export {
  MinimapWorkerManager,
  isMinimapWorkerSupported,
  createMinimapWorkerWithCanvas,
  createMinimapWorker,
  type MinimapTile,
  type MinimapEntity,
  type MinimapCamera,
  type MinimapConfig,
  type MinimapWorkerInput,
  type MinimapWorkerOutput,
} from "./MinimapWorker";
