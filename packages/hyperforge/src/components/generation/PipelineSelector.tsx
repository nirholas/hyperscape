"use client";

import { Select } from "@/components/ui/select";
import type { GenerationPipeline } from "@/types/generation";

interface PipelineSelectorProps {
  value: GenerationPipeline;
  onChange: (value: GenerationPipeline) => void;
}

const pipelineOptions = [
  { value: "text-to-3d", label: "Text to 3D" },
  { value: "image-to-3d", label: "Image to 3D" },
];

export function PipelineSelector({ value, onChange }: PipelineSelectorProps) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">Pipeline</label>
      <Select
        value={value}
        onChange={(v) => onChange(v as GenerationPipeline)}
        options={pipelineOptions}
      />
    </div>
  );
}
