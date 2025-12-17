"use client";

import { Textarea } from "@/components/ui/textarea";
import { SpectacularButton } from "@/components/ui/spectacular-button";
import { Sparkles } from "lucide-react";

export interface PromptInputProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  onSubmit?: () => void;
  placeholder?: string;
  label?: string;
}

export function PromptInput({
  value,
  onChange,
  disabled,
  onSubmit,
  placeholder = "Describe the 3D asset you want to create...",
  label = "Prompt",
}: PromptInputProps) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">{label}</label>
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        rows={4}
        className="resize-none"
      />
      <SpectacularButton
        onClick={onSubmit}
        disabled={disabled || !value.trim()}
        className="w-full"
      >
        <Sparkles className="w-4 h-4 mr-2" />
        Generate
      </SpectacularButton>
    </div>
  );
}
