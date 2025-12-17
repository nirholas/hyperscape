"use client";

import { useState, useEffect } from "react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { logger } from "@/lib/utils";

const log = logger.child("VariantDefinitionPanel");
import { SpectacularButton } from "@/components/ui/spectacular-button";
import { NeonInput } from "@/components/ui/neon-input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Plus,
  Trash2,
  Palette,
  Image as ImageIcon,
  Sparkles,
} from "lucide-react";
import type { TextureVariant } from "./GenerationFormRouter";
import {
  generateVariantId,
  createVariantFromPreset,
} from "@/stores/variant-store";

interface MaterialPreset {
  id: string;
  name: string;
  displayName: string;
  category: string;
  tier: number;
  color: string;
  stylePrompt: string;
  description?: string;
}

interface VariantDefinitionPanelProps {
  variants: TextureVariant[];
  onVariantsChange: (variants: TextureVariant[]) => void;
  materialPresets?: MaterialPreset[];
}

export function VariantDefinitionPanel({
  variants,
  onVariantsChange,
  materialPresets = [],
}: VariantDefinitionPanelProps) {
  const [presets, setPresets] = useState<MaterialPreset[]>(materialPresets);
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [customVariant, setCustomVariant] = useState<Partial<TextureVariant>>({
    name: "",
    prompt: "",
  });

  // Load material presets if not provided
  useEffect(() => {
    if (materialPresets.length === 0) {
      fetch("/prompts/material-presets.json")
        .then((res) => res.json())
        .then((data) => setPresets(data))
        .catch((err) => log.error("Failed to load material presets", err));
    }
  }, [materialPresets]);

  const addVariantFromPreset = (preset: MaterialPreset) => {
    // Check if already added
    if (variants.some((v) => v.materialPresetId === preset.id)) {
      return;
    }

    const newVariant = createVariantFromPreset(preset);
    onVariantsChange([...variants, newVariant]);
  };

  const addCustomVariant = () => {
    if (!customVariant.name) return;

    const newVariant: TextureVariant = {
      id: generateVariantId(),
      name: customVariant.name,
      prompt: customVariant.prompt,
      referenceImageUrl: customVariant.referenceImageUrl,
    };

    onVariantsChange([...variants, newVariant]);
    setCustomVariant({ name: "", prompt: "" });
    setShowCustomForm(false);
  };

  const removeVariant = (id: string) => {
    onVariantsChange(variants.filter((v) => v.id !== id));
  };

  const getPresetColor = (variantItem: TextureVariant): string => {
    if (variantItem.materialPresetId) {
      const preset = presets.find((p) => p.id === variantItem.materialPresetId);
      return preset?.color || "#888888";
    }
    return "#888888";
  };

  // Group presets by category
  const presetsByCategory = presets.reduce(
    (acc, preset) => {
      const category = preset.category || "custom";
      if (!acc[category]) {
        acc[category] = [];
      }
      acc[category].push(preset);
      return acc;
    },
    {} as Record<string, MaterialPreset[]>,
  );

  return (
    <GlassPanel className="p-6 space-y-6">
      <div>
        <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
          <Palette className="w-4 h-4 text-purple-400" />
          Texture Variants
        </h3>
        <p className="text-xs text-muted-foreground mb-4">
          Define texture variants to generate. Each variant uses the same base
          mesh with different textures.
        </p>
      </div>

      {/* Selected Variants */}
      {variants.length > 0 && (
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">
            Selected Variants ({variants.length})
          </Label>
          <div className="flex flex-wrap gap-2">
            {variants.map((variantItem) => (
              <Badge
                key={variantItem.id}
                variant="secondary"
                className="flex items-center gap-2 px-3 py-1.5"
              >
                <div
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: getPresetColor(variantItem) }}
                />
                <span>{variantItem.name}</span>
                <button
                  onClick={() => removeVariant(variantItem.id)}
                  className="ml-1 hover:text-red-400 transition-colors"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Material Presets */}
      <div className="space-y-3">
        <Label className="text-xs text-muted-foreground">
          Quick Add from Presets
        </Label>

        {Object.entries(presetsByCategory).map(
          ([category, categoryPresets]) => (
            <div key={category} className="space-y-2">
              <p className="text-xs font-medium capitalize text-muted-foreground">
                {category}
              </p>
              <div className="flex flex-wrap gap-2">
                {categoryPresets.map((preset) => {
                  const isSelected = variants.some(
                    (v) => v.materialPresetId === preset.id,
                  );
                  return (
                    <button
                      key={preset.id}
                      onClick={() => addVariantFromPreset(preset)}
                      disabled={isSelected}
                      className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-all text-sm ${
                        isSelected
                          ? "border-neon-blue/50 bg-neon-blue/10 text-neon-blue cursor-not-allowed"
                          : "border-glass-border hover:border-neon-blue/50 hover:bg-glass-bg"
                      }`}
                    >
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: preset.color }}
                      />
                      {preset.displayName}
                      {isSelected && <span className="text-xs">✓</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          ),
        )}
      </div>

      {/* Custom Variant Form */}
      {showCustomForm ? (
        <div className="space-y-4 p-4 border border-glass-border rounded-lg">
          <h4 className="text-sm font-medium flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-yellow-400" />
            Custom Variant
          </h4>

          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Variant Name</Label>
              <NeonInput
                value={customVariant.name || ""}
                onChange={(e) =>
                  setCustomVariant({ ...customVariant, name: e.target.value })
                }
                placeholder="e.g., Copper Ore, Volcanic Rock"
              />
            </div>

            <div className="space-y-2">
              <Label>Texture Prompt</Label>
              <Textarea
                value={customVariant.prompt || ""}
                onChange={(e) =>
                  setCustomVariant({ ...customVariant, prompt: e.target.value })
                }
                placeholder="Describe the texture style... e.g., 'copper ore texture with green patina and rough surface'"
                rows={3}
              />
            </div>

            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <ImageIcon className="w-4 h-4" aria-hidden="true" />
                Reference Image URL (optional)
              </Label>
              <NeonInput
                value={customVariant.referenceImageUrl || ""}
                onChange={(e) =>
                  setCustomVariant({
                    ...customVariant,
                    referenceImageUrl: e.target.value,
                  })
                }
                placeholder="https://..."
              />
            </div>

            <div className="flex gap-2">
              <SpectacularButton
                size="sm"
                onClick={addCustomVariant}
                disabled={!customVariant.name}
              >
                <Plus className="w-4 h-4 mr-1" />
                Add Variant
              </SpectacularButton>
              <SpectacularButton
                size="sm"
                variant="outline"
                onClick={() => {
                  setShowCustomForm(false);
                  setCustomVariant({ name: "", prompt: "" });
                }}
              >
                Cancel
              </SpectacularButton>
            </div>
          </div>
        </div>
      ) : (
        <SpectacularButton
          size="sm"
          variant="outline"
          onClick={() => setShowCustomForm(true)}
          className="w-full"
        >
          <Plus className="w-4 h-4 mr-2" />
          Add Custom Variant
        </SpectacularButton>
      )}

      {/* Empty State */}
      {variants.length === 0 && !showCustomForm && (
        <div className="text-center py-4 text-muted-foreground text-sm">
          No variants selected. Add presets above or create custom variants.
        </div>
      )}
    </GlassPanel>
  );
}
