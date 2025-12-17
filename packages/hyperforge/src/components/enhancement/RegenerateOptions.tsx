"use client";

import { useState } from "react";
import { NeonInput } from "@/components/ui/neon-input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { SpectacularButton } from "@/components/ui/spectacular-button";
import { useToast } from "@/components/ui/toast";
import { ProgressTracker } from "../generation/ProgressTracker";
import type { AssetData } from "@/types/asset";
import { logger } from "@/lib/utils";

const log = logger.child("RegenerateOptions");

interface RegenerateOptionsProps {
  asset: AssetData;
}

export function RegenerateOptions({ asset }: RegenerateOptionsProps) {
  const { toast } = useToast();
  const [prompt, setPrompt] = useState("");
  const [variationStrength, setVariationStrength] = useState(50);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);

  const handleRegenerate = async () => {
    setIsProcessing(true);
    setProgress(0);

    try {
      const response = await fetch("/api/enhancement/regenerate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assetId: asset.id,
          prompt: prompt || `Regenerate ${asset.name}`,
          variationStrength,
        }),
      });

      if (!response.ok) {
        throw new Error("Regeneration failed");
      }

      // Simulate progress
      const interval = setInterval(() => {
        setProgress((prev) => {
          if (prev >= 100) {
            clearInterval(interval);
            setIsProcessing(false);
            toast({
              variant: "success",
              title: "Regeneration Complete",
              description: "Asset variation has been generated successfully",
              duration: 5000,
            });
            return 100;
          }
          return prev + 10;
        });
      }, 1000);
    } catch (error) {
      log.error({ error }, "Regeneration error");
      setIsProcessing(false);
      toast({
        variant: "destructive",
        title: "Regeneration Failed",
        description:
          error instanceof Error
            ? error.message
            : "Regeneration operation failed",
        duration: 5000,
      });
    }
  };

  return (
    <div className="space-y-6 p-4">
      <div>
        <h3 className="text-lg font-semibold mb-4">Regenerate Asset</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Generate a new variation of this asset with similar characteristics.
        </p>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Prompt (optional)</Label>
            <NeonInput
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Leave empty to use original prompt"
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
              Higher values create more variation from the original
            </p>
          </div>

          {isProcessing && (
            <ProgressTracker
              progress={progress}
              currentStep="Regenerating model..."
            />
          )}

          <SpectacularButton
            onClick={handleRegenerate}
            disabled={isProcessing}
            className="w-full"
          >
            {isProcessing ? "Processing..." : "Regenerate"}
          </SpectacularButton>
        </div>
      </div>
    </div>
  );
}
