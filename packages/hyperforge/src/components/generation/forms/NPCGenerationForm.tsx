"use client";

import { useState } from "react";
import { PromptInput } from "../PromptInput";
import { PipelineSelector } from "../PipelineSelector";
import { Select } from "@/components/ui/select";
import { NeonInput } from "@/components/ui/neon-input";
import { Label } from "@/components/ui/label";
import { SpectacularButton } from "@/components/ui/spectacular-button";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import type { GenerationConfig } from "../GenerationFormRouter";
import {
  generateAssetId,
  getDefaultMetadata,
} from "@/lib/generation/category-schemas";

interface NPCGenerationFormProps {
  onGenerate: (config: GenerationConfig) => void;
  onCancel: () => void;
}

export function NPCGenerationForm({
  onGenerate,
  onCancel,
}: NPCGenerationFormProps) {
  const [prompt, setPrompt] = useState("");
  const [pipeline, setPipeline] = useState<"text-to-3d" | "image-to-3d">(
    "text-to-3d",
  );
  const [imageUrl, setImageUrl] = useState("");
  const [quality, setQuality] = useState<"preview" | "medium" | "high">("high");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<
    "mob" | "boss" | "neutral" | "quest"
  >("mob");
  const [level, setLevel] = useState(1);
  const [health, setHealth] = useState(10);
  const [combatLevel, setCombatLevel] = useState(1);
  const [scale, setScale] = useState(1.0);
  const [convertToVRM, setConvertToVRM] = useState(true); // Default to true for NPCs
  const [enableHandRigging, setEnableHandRigging] = useState(false); // Hand rigging requires VRM

  const handleGenerate = () => {
    const assetId = generateAssetId(name || prompt, "npc");
    const defaults = getDefaultMetadata("npc", {
      level,
      health,
      combatLevel,
      scale,
    });

    const config: GenerationConfig = {
      category: "npc",
      prompt: prompt || `A ${category} named ${name || "NPC"}`,
      pipeline,
      imageUrl: imageUrl || undefined,
      quality,
      convertToVRM,
      enableHandRigging, // Hand rigging runs on GLB before VRM conversion
      metadata: {
        id: assetId,
        name: name || assetId,
        description: description || prompt,
        category,
        level,
        health,
        combatLevel,
        scale,
        ...defaults,
      },
    };

    onGenerate(config);
  };

  const categoryOptions = [
    { value: "mob", label: "Mob" },
    { value: "boss", label: "Boss" },
    { value: "neutral", label: "Neutral" },
    { value: "quest", label: "Quest" },
  ];

  const qualityOptions = [
    { value: "standard", label: "Standard" },
    { value: "high", label: "High" },
    { value: "ultra", label: "Ultra" },
  ];

  return (
    <div className="space-y-6 p-4">
      <div>
        <h3 className="text-lg font-semibold mb-4">3D Model Generation</h3>
        <div className="space-y-4">
          <PipelineSelector value={pipeline} onChange={setPipeline} />

          {pipeline === "image-to-3d" && (
            <div className="space-y-2">
              <Label>Image URL</Label>
              <NeonInput
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                placeholder="https://..."
              />
            </div>
          )}

          <PromptInput
            value={prompt}
            onChange={setPrompt}
            placeholder="Describe the NPC (e.g., 'A fierce goblin warrior with rusty armor')"
          />

          <div className="space-y-2">
            <Label>Quality</Label>
            <Select
              value={quality}
              onChange={(value) =>
                setQuality(value as "preview" | "medium" | "high")
              }
              options={qualityOptions}
            />
          </div>

          <div className="flex items-center space-x-2 pt-2">
            <Checkbox
              id="convertToVRM"
              checked={convertToVRM}
              onCheckedChange={(checked) => setConvertToVRM(checked === true)}
            />
            <Label
              htmlFor="convertToVRM"
              className="text-sm font-normal cursor-pointer"
            >
              Convert to VRM format (for Hyperscape animation)
            </Label>
          </div>

          {/* Hand Rigging - adds bones to GLB before VRM conversion */}
          <div className="flex items-center space-x-2">
            <Checkbox
              id="enableHandRigging"
              checked={enableHandRigging}
              onCheckedChange={(checked) =>
                setEnableHandRigging(checked === true)
              }
            />
            <Label
              htmlFor="enableHandRigging"
              className="text-sm font-normal cursor-pointer"
            >
              Add hand bones (runs before VRM)
            </Label>
          </div>
        </div>
      </div>

      <div className="border-t border-glass-border pt-6">
        <h3 className="text-lg font-semibold mb-4">NPC Metadata</h3>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Name</Label>
            <NeonInput
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Goblin Warrior"
            />
          </div>

          <div className="space-y-2">
            <Label>Description</Label>
            <NeonInput
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="A fierce goblin warrior..."
            />
          </div>

          <div className="space-y-2">
            <Label>Category</Label>
            <Select
              value={category}
              onChange={(value) =>
                setCategory(value as "mob" | "boss" | "neutral" | "quest")
              }
              options={categoryOptions}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Level: {level}</Label>
              <Slider
                value={[level]}
                onValueChange={([value]) => setLevel(value)}
                min={1}
                max={100}
                step={1}
              />
            </div>

            <div className="space-y-2">
              <Label>Health: {health}</Label>
              <Slider
                value={[health]}
                onValueChange={([value]) => setHealth(value)}
                min={1}
                max={1000}
                step={10}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Combat Level: {combatLevel}</Label>
              <Slider
                value={[combatLevel]}
                onValueChange={([value]) => setCombatLevel(value)}
                min={1}
                max={100}
                step={1}
              />
            </div>

            <div className="space-y-2">
              <Label>Scale: {scale.toFixed(1)}</Label>
              <Slider
                value={[scale]}
                onValueChange={([value]) => setScale(value)}
                min={0.5}
                max={3.0}
                step={0.1}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="flex gap-2 pt-4 border-t border-glass-border">
        <SpectacularButton
          onClick={onCancel}
          variant="outline"
          className="flex-1"
        >
          Cancel
        </SpectacularButton>
        <SpectacularButton
          onClick={handleGenerate}
          className="flex-1"
          disabled={!prompt && !imageUrl}
        >
          Generate
        </SpectacularButton>
      </div>
    </div>
  );
}
