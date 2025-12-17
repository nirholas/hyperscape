"use client";

import { useState, useEffect, useCallback } from "react";
import type { BaseAsset } from "@/types";

/**
 * Extended source type for library assets
 * - "CDN": Production game assets from Cloudflare S3 CDN
 * - "FORGE": Generated in HyperForge, stored in Supabase Storage
 * - "LOCAL": Legacy local filesystem storage (deprecated)
 */
export type LibraryAssetSource = "CDN" | "FORGE" | "LOCAL";

/**
 * Library asset - unified type for assets displayed in the asset library
 * Extends BaseAsset with additional fields for library display
 */
export interface LibraryAsset extends Omit<BaseAsset, "source"> {
  source: LibraryAssetSource;
  createdAt?: string;
  status?: string;
  // Model paths
  modelPath?: string;
  // CDN-specific fields
  examine?: string;
  value?: number;
  weight?: number;
  stackable?: boolean;
  tradeable?: boolean;
  equipSlot?: string;
  weaponType?: string;
  attackType?: string;
  equippedModelPath?: string;
  npcCategory?: string;
  faction?: string;
  level?: number;
  combatLevel?: number;
  attackable?: boolean;
  harvestSkill?: string;
  toolRequired?: string;
  levelRequired?: number;
}

export function useCDNAssets() {
  const [assets, setAssets] = useState<LibraryAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const loadAssets = useCallback(async () => {
    try {
      setLoading(true);

      // Fetch both CDN and local assets in parallel
      const [cdnResponse, localResponse] = await Promise.all([
        fetch("/api/assets/cdn").catch(() => null),
        fetch("/api/assets/local").catch(() => null),
      ]);

      const cdnAssets: LibraryAsset[] = [];
      const localAssets: LibraryAsset[] = [];

      // Parse CDN assets
      if (cdnResponse?.ok) {
        const data = await cdnResponse.json();
        if (Array.isArray(data)) {
          cdnAssets.push(
            ...data.map((a: LibraryAsset) => ({
              ...a,
              source: "CDN" as const,
            })),
          );
        }
      }

      // Parse local assets
      if (localResponse?.ok) {
        const data = await localResponse.json();
        if (Array.isArray(data)) {
          localAssets.push(...data);
        }
      }

      // Combine: CDN assets first (verified in-game), then local/forge assets
      // CDN = GitHub repo = verified in-game items (highest priority)
      // LOCAL/FORGE = Supabase = HyperForge generations (lower priority)
      const allAssets = [...cdnAssets, ...localAssets];
      setAssets(allAssets);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Unknown error"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAssets();
  }, [loadAssets]);

  // Expose refresh function for after generation
  const refresh = useCallback(() => {
    loadAssets();
  }, [loadAssets]);

  return { assets, loading, error, refresh };
}
