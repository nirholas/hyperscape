/**
 * Rendering Systems
 *
 * Centralized rendering utilities including:
 * - ImpostorManager: On-demand impostor generation and caching with IndexedDB persistence
 * - AtlasedImpostorManager: Mega-atlas system for diverse forests with minimal draw calls
 * - AnimatedImpostorManager: Walk cycle animated impostors for mobs/NPCs
 * - LODLevel: Enum for entity LOD states
 * - Types for impostor initialization
 */

export {
  ImpostorManager,
  IMPOSTOR_CONFIG,
  BakePriority,
  LODLevel,
  ImpostorBakeMode,
  type ImpostorOptions,
  type ImpostorInitOptions,
} from "./ImpostorManager";

export {
  AtlasedImpostorManager,
  ATLASED_IMPOSTOR_CONFIG,
} from "./AtlasedImpostorManager";

export { AtlasedImpostorDebug } from "./AtlasedImpostorDebug";

export {
  runAtlasedImpostorTests,
  visualTest,
  downloadAllSlots,
} from "./atlasedImpostorTest";

// Animated impostors for mobs/NPCs
export {
  AnimatedImpostorManager,
  ANIMATED_IMPOSTOR_CONFIG,
  ANIMATED_LOD_DISTANCES,
  initEntityAnimatedHLOD,
  updateEntityAnimatedHLOD,
  cleanupEntityAnimatedHLOD,
  type AnimatedHLODState,
} from "./AnimatedImpostorManager";
