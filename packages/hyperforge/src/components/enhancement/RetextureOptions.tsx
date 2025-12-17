"use client";

import { useState } from "react";
import { NeonInput } from "@/components/ui/neon-input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { SpectacularButton } from "@/components/ui/spectacular-button";
import { useToast } from "@/components/ui/toast";
import { ProgressTracker } from "../generation/ProgressTracker";
import type { AssetData } from "@/types/asset";
import { logger } from "@/lib/utils";

const log = logger.child("RetextureOptions");

interface RetextureOptionsProps {
  asset: AssetData;
}

export function RetextureOptions({ asset }: RetextureOptionsProps) {
  const { toast } = useToast();
  const [textPrompt, setTextPrompt] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [styleType, setStyleType] = useState<"text" | "image">("text");
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);

  const handleRetexture = async () => {
    setIsProcessing(true);
    setProgress(0);

    try {
      const response = await fetch("/api/enhancement/retexture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assetId: asset.id,
          styleType,
          textPrompt: styleType === "text" ? textPrompt : undefined,
          imageUrl: styleType === "image" ? imageUrl : undefined,
        }),
      });

      if (!response.ok) {
        throw new Error("Retexture failed");
      }

      // Simulate progress
      const interval = setInterval(() => {
        setProgress((prev) => {
          if (prev >= 100) {
            clearInterval(interval);
            setIsProcessing(false);
            toast({
              variant: "success",
              title: "Retexture Complete",
              description: "Asset has been retextured successfully",
              duration: 5000,
            });
            return 100;
          }
          return prev + 10;
        });
      }, 1000);
    } catch (error) {
      log.error({ error }, "Retexture error");
      setIsProcessing(false);
      toast({
        variant: "destructive",
        title: "Retexture Failed",
        description:
          error instanceof Error ? error.message : "Retexture operation failed",
        duration: 5000,
      });
    }
  };

  const styleOptions = [
    { value: "text", label: "Text Prompt" },
    { value: "image", label: "Reference Image" },
  ];

  return (
    <div className="space-y-6 p-4">
      <div>
        <h3 className="text-lg font-semibold mb-4">Retexture Asset</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Generate new textures for this asset while keeping the same 3D model.
        </p>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Style Type</Label>
            <Select
              value={styleType}
              onChange={(value) => setStyleType(value as "text" | "image")}
              options={styleOptions}
            />
          </div>

          {styleType === "text" ? (
            <div className="space-y-2">
              <Label>Style Prompt</Label>
              <NeonInput
                value={textPrompt}
                onChange={(e) => setTextPrompt(e.target.value)}
                placeholder="e.g., 'Rustic wooden texture with metal accents'"
              />
            </div>
          ) : (
            <div className="space-y-2">
              <Label>Reference Image URL</Label>
              <NeonInput
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                placeholder="https://..."
              />
            </div>
          )}

          {isProcessing && (
            <ProgressTracker
              progress={progress}
              currentStep="Retexturing model..."
            />
          )}

          <SpectacularButton
            onClick={handleRetexture}
            disabled={isProcessing || (!textPrompt && !imageUrl)}
            className="w-full"
          >
            {isProcessing ? "Processing..." : "Retexture"}
          </SpectacularButton>
        </div>
      </div>
    </div>
  );
}
