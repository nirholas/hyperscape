"use client";

import { useState } from "react";
import { AssetListItem } from "./AssetListItem";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { Modal } from "@/components/ui/modal";
import { SpectacularButton } from "@/components/ui/spectacular-button";
import { VariantDefinitionPanel } from "@/components/generation/VariantDefinitionPanel";
import { useCDNAssets, type LibraryAsset } from "@/hooks/useCDNAssets";
import {
  cdnAssetToAssetData,
  type CDNAssetInput,
} from "@/lib/utils/asset-converter";
import { useVariantStore } from "@/stores/variant-store";
import type { AssetData } from "@/types/asset";
import type { TextureVariant } from "@/components/generation/GenerationFormRouter";
import { Palette, X, Package } from "lucide-react";
import { logger } from "@/lib/utils";

const log = logger.child("AssetLibrary");

interface AssetLibraryProps {
  onAssetSelect?: (asset: AssetData) => void;
}

export function AssetLibrary({ onAssetSelect }: AssetLibraryProps) {
  const { assets, loading, error } = useCDNAssets();
  const { setBaseModel } = useVariantStore();

  // Variant creation modal state
  const [showVariantModal, setShowVariantModal] = useState(false);
  const [selectedAssetForVariant, setSelectedAssetForVariant] =
    useState<LibraryAsset | null>(null);
  const [pendingVariants, setPendingVariants] = useState<TextureVariant[]>([]);
  const [isCreatingVariants, setIsCreatingVariants] = useState(false);

  const handleCreateVariant = (asset: LibraryAsset) => {
    setSelectedAssetForVariant(asset);
    setBaseModel(asset.id, asset.modelPath || "", asset.name);
    setPendingVariants([]);
    setShowVariantModal(true);
  };

  const handleSubmitVariants = async () => {
    if (!selectedAssetForVariant || pendingVariants.length === 0) return;

    setIsCreatingVariants(true);

    try {
      const response = await fetch("/api/variants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "batch",
          baseModelId: selectedAssetForVariant.id,
          baseModelUrl: selectedAssetForVariant.modelPath,
          variants: pendingVariants,
        }),
      });

      if (response.ok) {
        const result = await response.json();
        log.info("Variants created:", result);
      }
    } catch (error) {
      log.error("Failed to create variants:", error);
    } finally {
      setIsCreatingVariants(false);
      setShowVariantModal(false);
      setSelectedAssetForVariant(null);
      setPendingVariants([]);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Spinner />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-destructive">
        Error loading assets: {error.message}
      </div>
    );
  }

  if (!assets || assets.length === 0) {
    return (
      <EmptyState
        icon={Package}
        title="No Assets"
        description="No assets found in CDN"
      />
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-2">
        <div className="space-y-1">
          {assets.map((asset) => (
            <AssetListItem
              key={asset.id}
              asset={asset}
              onSelect={(selectedAsset) =>
                onAssetSelect?.(
                  cdnAssetToAssetData(selectedAsset as CDNAssetInput),
                )
              }
              onCreateVariant={handleCreateVariant}
            />
          ))}
        </div>
      </div>

      {/* Variant Creation Modal */}
      <Modal
        isOpen={showVariantModal}
        onClose={() => setShowVariantModal(false)}
        title="Create Texture Variants"
      >
        <div className="space-y-4">
          {selectedAssetForVariant && (
            <p className="text-sm text-muted-foreground">
              Create texture variants for{" "}
              <span className="font-medium text-foreground">
                {selectedAssetForVariant.name}
              </span>
              . Each variant uses the same base mesh with different textures.
            </p>
          )}

          <VariantDefinitionPanel
            variants={pendingVariants}
            onVariantsChange={setPendingVariants}
          />

          <div className="flex gap-2 pt-4 border-t border-glass-border">
            <SpectacularButton
              variant="outline"
              onClick={() => setShowVariantModal(false)}
              className="flex-1"
            >
              <X className="w-4 h-4 mr-2" />
              Cancel
            </SpectacularButton>
            <SpectacularButton
              onClick={handleSubmitVariants}
              disabled={pendingVariants.length === 0 || isCreatingVariants}
              className="flex-1"
            >
              <Palette className="w-4 h-4 mr-2" />
              {isCreatingVariants
                ? "Creating..."
                : `Create ${pendingVariants.length} Variant${pendingVariants.length !== 1 ? "s" : ""}`}
            </SpectacularButton>
          </div>
        </div>
      </Modal>
    </div>
  );
}
