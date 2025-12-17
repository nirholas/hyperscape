/**
 * CDN Asset Types
 *
 * @deprecated Import from '@/types' instead.
 * This file is maintained for backwards compatibility only.
 *
 * Migration guide:
 * - import { CDNAsset, LocalAsset } from '@/types'
 * - import { ItemManifest, NPCManifest } from '@/types'
 */

// Re-export all types from consolidated location
export type {
  AssetSource,
  AssetCategory,
  Rarity as AssetRarity,
  EquipSlot,
  WeaponType,
  AttackType,
  NPCCategory,
  CDNAsset,
  LocalAsset,
  BaseAsset,
  HyperForgeAsset,
  ItemManifest,
  NPCManifest,
  ResourceManifest,
  MusicTrackManifest as MusicManifest,
  BiomeManifest,
} from "@/types";
