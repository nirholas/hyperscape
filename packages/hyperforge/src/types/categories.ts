/**
 * Asset Category Definitions
 *
 * @deprecated Import from '@/types' instead.
 * This file is maintained for backwards compatibility only.
 *
 * Migration guide:
 * - import { AssetCategory, CATEGORIES, getCategory } from '@/types'
 */

export type {
  AssetCategory,
  CategoryDefinition,
  CategoryMetadataSchema,
} from "./index";
export {
  CATEGORIES,
  getCategory,
  getAllCategories,
  getCategoriesByManifestType,
} from "./index";
