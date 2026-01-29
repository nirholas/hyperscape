/**
 * World Builder Utilities
 */

export {
  serializeWorld,
  deserializeWorld,
  exportWorldToJSON,
  importWorldFromJSON,
  downloadWorldAsFile,
  importWorldFromFile,
  validateWorldData,
  validateWorldReferences,
  migrateWorldData,
  generateWorldId,
  generateWorldName,
  createNewWorld,
  calculateWorldStats,
  exportToGameManifest,
  validateGameExport,
  downloadGameManifests,
  copyGameManifestsToClipboard,
  // Autosave
  getAutosaveList,
  autosaveWorld,
  loadAutosave,
  deleteAutosave,
  clearAllAutosaves,
  getMostRecentAutosave,
  // Difficulty zones
  generateDifficultyZones,
  generateWilderness,
  isInWilderness,
  getWildernessLevel,
  // Mob spawns
  generateMobSpawns,
  // Boss generation
  generateBosses,
  // Full export
  exportFullGameManifest,
  downloadAllGameManifests,
  // IndexedDB storage
  saveWorldToIndexedDB,
  loadWorldFromIndexedDB,
  listWorldsInIndexedDB,
  deleteWorldFromIndexedDB,
  saveManifestToIndexedDB,
  loadManifestFromIndexedDB,
  exportAndCacheWorld,
  // Import & merge
  importManifestFromFile,
  mergeManifestIntoWorld,
  importAndMergeFromIndexedDB,
  // Storage availability checks
  isIndexedDBAvailable,
  isLocalStorageAvailable,
} from "./worldPersistence";

// Re-export types
export type { MergeStrategy, ManifestMergeOptions } from "./worldPersistence";

export type {
  ExportValidationError,
  ExportValidationResult,
} from "./worldPersistence";
