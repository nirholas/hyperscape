"use client";

import type { AssetCategory } from "@/types/categories";
import { NPCGenerationForm } from "./forms/NPCGenerationForm";
import { ResourceGenerationForm } from "./forms/ResourceGenerationForm";
import { WeaponGenerationForm } from "./forms/WeaponGenerationForm";
import { EnvironmentGenerationForm } from "./forms/EnvironmentGenerationForm";
import { PropGenerationForm } from "./forms/PropGenerationForm";
import { BuildingGenerationForm } from "./forms/BuildingGenerationForm";

interface GenerationFormRouterProps {
  category: AssetCategory | null;
  onGenerate: (config: GenerationConfig) => void;
  onCancel: () => void;
}

export interface GenerationConfig {
  category: AssetCategory;
  prompt: string;
  pipeline: "text-to-3d" | "image-to-3d";
  imageUrl?: string;
  quality: "preview" | "medium" | "high"; // Maps to Meshy AI models: meshy-4, meshy-5, latest
  metadata: Record<string, unknown>;
  convertToVRM?: boolean; // Automatically convert to VRM format after generation
  enableHandRigging?: boolean; // Add hand bones for proper finger animation (requires VRM)
  useGPT4Enhancement?: boolean; // Enhance prompt with GPT-4 via Vercel AI Gateway
  generateConceptArt?: boolean; // Generate concept art image before 3D (improves texturing)
  referenceImageUrl?: string; // Custom reference image URL (HTTP URL for Meshy texture_image_url)
  referenceImageDataUrl?: string; // Custom reference image as data URL (fallback)
}

export function GenerationFormRouter({
  category,
  onGenerate,
  onCancel,
}: GenerationFormRouterProps) {
  if (!category) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Select a category to begin
      </div>
    );
  }

  const commonProps = {
    onGenerate,
    onCancel,
  };

  switch (category) {
    case "npc":
    case "character":
      return <NPCGenerationForm {...commonProps} />;
    case "resource":
      return <ResourceGenerationForm {...commonProps} />;
    case "weapon":
      return <WeaponGenerationForm {...commonProps} />;
    case "environment":
      return <EnvironmentGenerationForm {...commonProps} />;
    case "prop":
      return <PropGenerationForm {...commonProps} />;
    case "building":
      return <BuildingGenerationForm {...commonProps} />;
    default:
      return (
        <div className="p-4 text-destructive">Unknown category: {category}</div>
      );
  }
}
