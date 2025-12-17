"use client";

import { useState } from "react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { SpectacularButton } from "@/components/ui/spectacular-button";
import { Trash2, Download, Check } from "lucide-react";
import type { GenerationResult } from "@/types";

interface VariationGridProps {
  variations: GenerationResult[];
  onSelect: (variation: GenerationResult) => void;
  onDelete: (id: string) => void;
  onDownload: (id: string) => void;
  onSaveAll: () => void;
}

export function VariationGrid({
  variations,
  onSelect,
  onDelete,
  onDownload,
  onSaveAll,
}: VariationGridProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const toggleSelection = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const handleDeleteSelected = () => {
    selectedIds.forEach((id) => onDelete(id));
    setSelectedIds(new Set());
  };

  if (variations.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        No variations generated yet
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">
          Variations ({variations.length})
        </h3>
        <div className="flex gap-2">
          {selectedIds.size > 0 && (
            <SpectacularButton
              size="sm"
              variant="outline"
              onClick={handleDeleteSelected}
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Delete Selected ({selectedIds.size})
            </SpectacularButton>
          )}
          <SpectacularButton size="sm" onClick={onSaveAll}>
            <Check className="w-4 h-4 mr-2" />
            Save All
          </SpectacularButton>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {variations.map((variation, index) => {
          const variationId =
            variation.id || variation.taskId || `var-${index}`;
          const isSelected = selectedIds.has(variationId);
          return (
            <GlassPanel
              key={variationId}
              className={`relative cursor-pointer transition-all ${
                isSelected ? "ring-2 ring-neon-blue" : ""
              }`}
              onClick={() => toggleSelection(variationId)}
              intensity="low"
            >
              <div className="aspect-square bg-glass-bg rounded mb-2 flex items-center justify-center">
                {variation.thumbnailUrl ? (
                  <img
                    src={variation.thumbnailUrl}
                    alt={`Variation ${index + 1}`}
                    className="w-full h-full object-cover rounded"
                  />
                ) : (
                  <span className="text-muted-foreground">No preview</span>
                )}
              </div>
              <div className="p-2">
                <p className="text-sm font-medium">Variation {index + 1}</p>
                <div className="flex gap-2 mt-2">
                  <SpectacularButton
                    size="sm"
                    variant="ghost"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelect(variation);
                    }}
                  >
                    Select
                  </SpectacularButton>
                  <SpectacularButton
                    size="sm"
                    variant="ghost"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDownload(variationId);
                    }}
                  >
                    <Download className="w-4 h-4" />
                  </SpectacularButton>
                </div>
              </div>
            </GlassPanel>
          );
        })}
      </div>
    </div>
  );
}
