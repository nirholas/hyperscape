"use client";

import { useState } from "react";
import { logger } from "@/lib/utils";

const log = logger.child("BatchGenerator");
void log; // Logger initialized for future use
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { SpectacularButton } from "@/components/ui/spectacular-button";
import { ProgressTracker } from "./ProgressTracker";
import type { GenerationConfig } from "./GenerationFormRouter";
import { useGenerationStore } from "@/stores/generation-store";

interface BatchGeneratorProps {
  baseConfig: GenerationConfig;
  onComplete: (results: GenerationResult[]) => void;
  onCancel: () => void;
}

interface GenerationResult {
  id: string;
  modelUrl: string;
  thumbnailUrl?: string;
  metadata: Record<string, unknown>;
}

export function BatchGenerator({
  baseConfig,
  onComplete,
  onCancel,
}: BatchGeneratorProps) {
  const [count, setCount] = useState(3);
  const [variationStrength, setVariationStrength] = useState(50);
  const [isGenerating, setIsGenerating] = useState(false);
  const { updateProgress, addBatchJob } = useGenerationStore();

  const handleGenerate = async () => {
    setIsGenerating(true);
    const batchId = crypto.randomUUID();

    // Add batch job to store
    addBatchJob({
      id: batchId,
      category: baseConfig.category,
      baseConfig,
      variations: count,
      status: "processing",
      results: [],
    });

    try {
      const response = await fetch("/api/generation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "batch",
          config: baseConfig,
          count,
        }),
      });

      if (!response.ok) {
        throw new Error("Batch generation failed");
      }

      const { results } = await response.json();

      // Simulate progress
      for (let i = 0; i < count; i++) {
        updateProgress(
          Math.floor(((i + 1) / count) * 100),
          `Generating variation ${i + 1} of ${count}...`,
        );
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }

      onComplete(results);
      setIsGenerating(false);
    } catch (error) {
      log.error("Batch generation error", error);
      setIsGenerating(false);
    }
  };

  return (
    <div className="space-y-6 p-4">
      <div>
        <h3 className="text-lg font-semibold mb-4">Batch Generation</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Generate multiple variations of this asset.
        </p>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Number of Variations: {count}</Label>
            <Slider
              value={[count]}
              onValueChange={([value]) => setCount(value)}
              min={1}
              max={10}
              step={1}
            />
          </div>

          <div className="space-y-2">
            <Label>Variation Strength: {variationStrength}%</Label>
            <Slider
              value={[variationStrength]}
              onValueChange={([value]) => setVariationStrength(value)}
              min={0}
              max={100}
              step={5}
            />
            <p className="text-xs text-muted-foreground">
              Higher values create more variation from the base
            </p>
          </div>

          {isGenerating && (
            <ProgressTracker
              progress={0}
              currentStep="Starting batch generation..."
            />
          )}

          <div className="flex gap-2">
            <SpectacularButton
              onClick={onCancel}
              variant="outline"
              className="flex-1"
              disabled={isGenerating}
            >
              Cancel
            </SpectacularButton>
            <SpectacularButton
              onClick={handleGenerate}
              className="flex-1"
              disabled={isGenerating}
            >
              {isGenerating ? "Generating..." : `Generate ${count} Variations`}
            </SpectacularButton>
          </div>
        </div>
      </div>
    </div>
  );
}
