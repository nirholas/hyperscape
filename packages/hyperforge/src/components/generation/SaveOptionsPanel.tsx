"use client";

import { GlassPanel } from "@/components/ui/glass-panel";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Save, Image as ImageIcon, Layers, Palette } from "lucide-react";
import type { SaveOptions } from "./GenerationFormRouter";

interface SaveOptionsPanelProps {
  saveOptions: SaveOptions;
  onSaveOptionsChange: (options: SaveOptions) => void;
  generateConceptArt: boolean;
  onGenerateConceptArtChange: (value: boolean) => void;
  useConceptArtForTexturing: boolean;
  onUseConceptArtForTexturingChange: (value: boolean) => void;
  hasReferenceImage?: boolean;
  showVariantOptions?: boolean;
}

export function SaveOptionsPanel({
  saveOptions,
  onSaveOptionsChange,
  generateConceptArt,
  onGenerateConceptArtChange,
  useConceptArtForTexturing,
  onUseConceptArtForTexturingChange,
  hasReferenceImage = false,
  showVariantOptions = true,
}: SaveOptionsPanelProps) {
  const updateSaveOption = (key: keyof SaveOptions, value: boolean) => {
    onSaveOptionsChange({
      ...saveOptions,
      [key]: value,
    });
  };

  return (
    <GlassPanel className="p-6 space-y-6">
      {/* Concept Art Section */}
      <div>
        <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
          <ImageIcon className="w-4 h-4 text-cyan-400" aria-hidden="true" />
          Concept Art Options
        </h3>

        <div className="space-y-4">
          {/* Generate Concept Art Toggle */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-sm">Generate Concept Art</Label>
              <p className="text-xs text-muted-foreground">
                Create AI concept art before 3D generation
              </p>
            </div>
            <Switch
              checked={generateConceptArt}
              onCheckedChange={onGenerateConceptArtChange}
              disabled={hasReferenceImage}
            />
          </div>

          {/* Use for Texturing Toggle */}
          {generateConceptArt && !hasReferenceImage && (
            <div className="flex items-center justify-between pl-4 border-l-2 border-cyan-400/30">
              <div className="space-y-0.5">
                <Label className="text-sm">Use for Texturing</Label>
                <p className="text-xs text-muted-foreground">
                  Apply concept art colors to 3D model texture
                </p>
              </div>
              <Switch
                checked={useConceptArtForTexturing}
                onCheckedChange={onUseConceptArtForTexturingChange}
              />
            </div>
          )}

          {hasReferenceImage && (
            <p className="text-xs text-muted-foreground italic">
              Using custom reference image instead of generated concept art
            </p>
          )}
        </div>
      </div>

      {/* Save Options Section */}
      <div>
        <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
          <Save className="w-4 h-4 text-emerald-400" />
          Save Options
        </h3>

        <div className="space-y-3">
          {/* Save Base Mesh */}
          <div className="flex items-center gap-3">
            <Checkbox
              id="saveBaseMesh"
              checked={saveOptions.saveBaseMesh}
              onCheckedChange={(checked) =>
                updateSaveOption("saveBaseMesh", !!checked)
              }
            />
            <div className="space-y-0.5">
              <Label htmlFor="saveBaseMesh" className="text-sm cursor-pointer">
                Save Base Mesh
              </Label>
              <p className="text-xs text-muted-foreground">
                Untextured mesh for creating variants later
              </p>
            </div>
          </div>

          {/* Save Textured Model */}
          <div className="flex items-center gap-3">
            <Checkbox
              id="saveTexturedModel"
              checked={saveOptions.saveTexturedModel}
              onCheckedChange={(checked) =>
                updateSaveOption("saveTexturedModel", !!checked)
              }
            />
            <div className="space-y-0.5">
              <Label
                htmlFor="saveTexturedModel"
                className="text-sm cursor-pointer"
              >
                Save Textured Model
              </Label>
              <p className="text-xs text-muted-foreground">
                Full model with base texture applied
              </p>
            </div>
          </div>

          {/* Save Variants */}
          {showVariantOptions && (
            <div className="flex items-center gap-3">
              <Checkbox
                id="saveVariants"
                checked={saveOptions.saveVariants}
                onCheckedChange={(checked) =>
                  updateSaveOption("saveVariants", !!checked)
                }
              />
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-purple-400" />
                <div className="space-y-0.5">
                  <Label
                    htmlFor="saveVariants"
                    className="text-sm cursor-pointer"
                  >
                    Generate Texture Variants
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Create multiple texture variations (e.g., Bronze, Steel,
                    Mithril)
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Info Text */}
      <div className="pt-2 border-t border-glass-border">
        <div className="flex items-start gap-2 text-xs text-muted-foreground">
          <Palette className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <p>
            Base meshes can be used to create texture variants later from the
            asset library. This follows RuneScape&apos;s pattern of shared base
            models with different material textures.
          </p>
        </div>
      </div>
    </GlassPanel>
  );
}
