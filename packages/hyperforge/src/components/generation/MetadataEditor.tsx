"use client";

import { useState, useEffect } from "react";
import { NeonInput } from "@/components/ui/neon-input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { SpectacularButton } from "@/components/ui/spectacular-button";
import { useToast } from "@/components/ui/toast";
import { validateAsset } from "@/lib/generation/category-schemas";
import type { AssetCategory } from "@/types/categories";

/**
 * Valid metadata value types for asset metadata fields
 * Used for type-safe metadata editing in forms
 */
export type MetadataValue =
  | string
  | number
  | boolean
  | string[]
  | null
  | undefined;

/**
 * Asset metadata record with typed values
 */
export type AssetMetadata = Record<string, MetadataValue>;

interface MetadataEditorProps {
  category: AssetCategory;
  initialMetadata: AssetMetadata;
  onSave: (metadata: AssetMetadata) => void;
  onCancel: () => void;
}

export function MetadataEditor({
  category,
  initialMetadata,
  onSave,
  onCancel,
}: MetadataEditorProps) {
  const { toast } = useToast();
  const [metadata, setMetadata] = useState(initialMetadata);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    setMetadata(initialMetadata);
  }, [initialMetadata]);

  const handleSave = () => {
    const validation = validateAsset(category, metadata);
    if (!validation.valid) {
      setErrors(validation.errors);
      toast({
        variant: "destructive",
        title: "Validation Failed",
        description: `Please fix ${validation.errors.length} error(s)`,
        duration: 5000,
      });
      return;
    }

    setErrors([]);
    onSave(metadata);
    toast({
      variant: "success",
      title: "Metadata Saved",
      description: "Asset metadata has been updated successfully",
      duration: 3000,
    });
  };

  const updateField = (field: string, value: MetadataValue) => {
    setMetadata((prev) => ({ ...prev, [field]: value }));
  };

  // Render category-specific fields
  const renderFields = () => {
    switch (category) {
      case "npc":
      case "character":
        return (
          <>
            <div className="space-y-2">
              <Label>Name</Label>
              <NeonInput
                value={(metadata.name as string) || ""}
                onChange={(e) => updateField("name", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <NeonInput
                value={(metadata.description as string) || ""}
                onChange={(e) => updateField("description", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Category</Label>
              <Select
                value={(metadata.category as string) || "mob"}
                onChange={(value) => updateField("category", value)}
                options={[
                  { value: "mob", label: "Mob" },
                  { value: "boss", label: "Boss" },
                  { value: "neutral", label: "Neutral" },
                  { value: "quest", label: "Quest" },
                ]}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Level: {metadata.level as number}</Label>
                <Slider
                  value={[metadata.level as number]}
                  onValueChange={([value]) => updateField("level", value)}
                  min={1}
                  max={100}
                  step={1}
                />
              </div>
              <div className="space-y-2">
                <Label>Health: {metadata.health as number}</Label>
                <Slider
                  value={[metadata.health as number]}
                  onValueChange={([value]) => updateField("health", value)}
                  min={1}
                  max={1000}
                  step={10}
                />
              </div>
            </div>
          </>
        );

      case "resource":
        return (
          <>
            <div className="space-y-2">
              <Label>Name</Label>
              <NeonInput
                value={(metadata.name as string) || ""}
                onChange={(e) => updateField("name", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Type</Label>
              <NeonInput
                value={(metadata.type as string) || ""}
                onChange={(e) => updateField("type", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Harvest Skill</Label>
              <NeonInput
                value={(metadata.harvestSkill as string) || ""}
                onChange={(e) => updateField("harvestSkill", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Level Required: {metadata.levelRequired as number}</Label>
              <Slider
                value={[metadata.levelRequired as number]}
                onValueChange={([value]) => updateField("levelRequired", value)}
                min={1}
                max={99}
                step={1}
              />
            </div>
          </>
        );

      case "weapon":
        return (
          <>
            <div className="space-y-2">
              <Label>Name</Label>
              <NeonInput
                value={(metadata.name as string) || ""}
                onChange={(e) => updateField("name", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <NeonInput
                value={(metadata.description as string) || ""}
                onChange={(e) => updateField("description", e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Weapon Type</Label>
                <Select
                  value={(metadata.weaponType as string) || "sword"}
                  onChange={(value) => updateField("weaponType", value)}
                  options={[
                    { value: "sword", label: "Sword" },
                    { value: "axe", label: "Axe" },
                    { value: "mace", label: "Mace" },
                    { value: "dagger", label: "Dagger" },
                  ]}
                />
              </div>
              <div className="space-y-2">
                <Label>Attack Speed: {metadata.attackSpeed as number}</Label>
                <Slider
                  value={[metadata.attackSpeed as number]}
                  onValueChange={([value]) => updateField("attackSpeed", value)}
                  min={2}
                  max={7}
                  step={1}
                />
              </div>
            </div>
          </>
        );

      default:
        return (
          <>
            <div className="space-y-2">
              <Label>Name</Label>
              <NeonInput
                value={(metadata.name as string) || ""}
                onChange={(e) => updateField("name", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <NeonInput
                value={(metadata.description as string) || ""}
                onChange={(e) => updateField("description", e.target.value)}
              />
            </div>
          </>
        );
    }
  };

  return (
    <div className="space-y-4 p-4">
      <div>
        <h3 className="text-lg font-semibold mb-4">Edit Metadata</h3>
        {errors.length > 0 && (
          <div className="mb-4 p-3 rounded bg-destructive/10 border border-destructive/20">
            <p className="text-sm font-semibold text-destructive mb-2">
              Validation Errors:
            </p>
            <ul className="text-xs text-destructive list-disc list-inside space-y-1">
              {errors.map((error, i) => (
                <li key={i}>{error}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="space-y-4">{renderFields()}</div>
      </div>

      <div className="flex gap-2 pt-4 border-t border-glass-border">
        <SpectacularButton
          onClick={onCancel}
          variant="outline"
          className="flex-1"
        >
          Cancel
        </SpectacularButton>
        <SpectacularButton onClick={handleSave} className="flex-1">
          Save Metadata
        </SpectacularButton>
      </div>
    </div>
  );
}
