/**
 * Structure Services
 *
 * Barrel export for structure-related services.
 */

export {
  loadStructures,
  saveStructures,
  getStructure,
  upsertStructure,
  deleteStructure,
  loadPieceLibrary,
  savePieceLibrary,
  addPiece,
  getPiece,
  deletePiece,
} from "./structure-service";

export {
  generatePiece,
  buildPiecePrompt,
  getStyleVariants,
  getDefaultPrompt,
  getDefaultDimensions,
  type PieceGenerationOptions,
  type PieceGenerationResult,
} from "./piece-generation";
