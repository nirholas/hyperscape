"use client";

import { useState } from "react";
import {
  Sword,
  Wand2,
  Loader2,
  Save,
  Shield,
  Sparkles,
  Coins,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { SpectacularButton } from "@/components/ui/spectacular-button";
import { NeonInput } from "@/components/ui/neon-input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import type { Item, GeneratedItemContent } from "@/types/game/content-types";

interface ItemGeneratorProps {
  onContentGenerated?: (content: GeneratedItemContent) => void;
}

const rarityColors: Record<string, string> = {
  common: "text-gray-400 bg-gray-500/10",
  uncommon: "text-green-400 bg-green-500/10",
  rare: "text-blue-400 bg-blue-500/10",
  epic: "text-purple-400 bg-purple-500/10",
  legendary: "text-orange-400 bg-orange-500/10",
  unique: "text-red-400 bg-red-500/10",
};

export function ItemGenerator({ onContentGenerated }: ItemGeneratorProps) {
  const { toast } = useToast();
  const [isGenerating, setIsGenerating] = useState(false);

  // Form state
  const [itemName, setItemName] = useState("");
  const [itemType, setItemType] = useState("weapon");
  const [rarity, setRarity] = useState("uncommon");
  const [level, setLevel] = useState("10");
  const [equipSlot, setEquipSlot] = useState("");
  const [theme, setTheme] = useState("");

  // Generated content
  const [generatedContent, setGeneratedContent] =
    useState<GeneratedItemContent | null>(null);
  const [expandedSections, setExpandedSections] = useState<
    Record<string, boolean>
  >({
    stats: true,
    requirements: true,
  });

  const typeOptions = [
    { value: "weapon", label: "Weapon" },
    { value: "armor", label: "Armor" },
    { value: "tool", label: "Tool" },
    { value: "consumable", label: "Consumable" },
    { value: "material", label: "Material/Resource" },
    { value: "quest", label: "Quest Item" },
  ];

  const rarityOptions = [
    { value: "common", label: "Common" },
    { value: "uncommon", label: "Uncommon" },
    { value: "rare", label: "Rare" },
    { value: "epic", label: "Epic" },
    { value: "legendary", label: "Legendary" },
    { value: "unique", label: "Unique" },
  ];

  const equipSlotOptions = [
    { value: "", label: "Auto-detect" },
    { value: "weapon", label: "Main Hand" },
    { value: "shield", label: "Off Hand / Shield" },
    { value: "head", label: "Head" },
    { value: "body", label: "Body" },
    { value: "legs", label: "Legs" },
    { value: "hands", label: "Hands" },
    { value: "feet", label: "Feet" },
    { value: "cape", label: "Cape" },
    { value: "neck", label: "Necklace" },
    { value: "ring", label: "Ring" },
  ];

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  const handleGenerate = async () => {
    setIsGenerating(true);

    try {
      const response = await fetch("/api/content/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "item",
          name: itemName || undefined,
          itemType,
          rarity,
          level: parseInt(level) || 10,
          equipSlot: equipSlot || undefined,
          theme: theme || undefined,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Generation failed");
      }

      const result = await response.json();
      setGeneratedContent(result.content);

      toast({
        variant: "success",
        title: "Item Generated",
        description: `Created "${result.content.item.name}"`,
      });

      onContentGenerated?.(result.content);
    } catch (error) {
      console.error("Generation failed:", error);
      toast({
        variant: "destructive",
        title: "Generation Failed",
        description:
          error instanceof Error ? error.message : "Failed to generate item",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleExportManifest = async () => {
    if (!generatedContent) return;

    try {
      const manifestEntry = {
        ...generatedContent.item,
        generatedAt: generatedContent.generatedAt,
      };

      await navigator.clipboard.writeText(
        JSON.stringify(manifestEntry, null, 2),
      );

      toast({
        variant: "success",
        title: "Copied to Clipboard",
        description: "Item manifest copied. Add to items.json",
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Export Failed",
        description:
          error instanceof Error ? error.message : "Failed to export",
      });
    }
  };

  const isEquipment =
    itemType === "weapon" || itemType === "armor" || itemType === "tool";

  return (
    <div className="h-full overflow-y-auto themed-scrollbar p-4 space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-2">Item Generator</h2>
        <p className="text-sm text-muted-foreground">
          Generate items with stats, descriptions, and lore.
        </p>
      </div>

      {/* Basic Info */}
      <GlassPanel className="p-4 space-y-4">
        <h3 className="font-semibold flex items-center gap-2">
          <Sword className="w-4 h-4" />
          Item Details
        </h3>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Item Name (optional)</Label>
            <NeonInput
              value={itemName}
              onChange={(e) => setItemName(e.target.value)}
              placeholder="Leave empty to auto-generate"
            />
          </div>
          <div className="space-y-2">
            <Label>Item Type</Label>
            <Select
              value={itemType}
              onChange={(v) => setItemType(v)}
              options={typeOptions}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Rarity</Label>
            <Select
              value={rarity}
              onChange={(v) => setRarity(v)}
              options={rarityOptions}
            />
          </div>
          <div className="space-y-2">
            <Label>Level Requirement</Label>
            <NeonInput
              type="number"
              value={level}
              onChange={(e) => setLevel(e.target.value)}
              placeholder="10"
            />
          </div>
        </div>

        {isEquipment && (
          <div className="space-y-2">
            <Label>Equipment Slot</Label>
            <Select
              value={equipSlot}
              onChange={(v) => setEquipSlot(v)}
              options={equipSlotOptions}
            />
          </div>
        )}

        <div className="space-y-2">
          <Label>Theme/Style</Label>
          <NeonInput
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
            placeholder="e.g., dragon-themed, ancient artifact, goblin-made"
          />
        </div>
      </GlassPanel>

      {/* Generate Button */}
      <SpectacularButton
        className="w-full"
        size="lg"
        onClick={handleGenerate}
        disabled={isGenerating}
      >
        {isGenerating ? (
          <>
            <Loader2 className="w-5 h-5 mr-2 animate-spin" />
            Generating Item...
          </>
        ) : (
          <>
            <Wand2 className="w-5 h-5 mr-2" />
            Generate Item
          </>
        )}
      </SpectacularButton>

      {/* Generated Content */}
      {generatedContent && (
        <GlassPanel className="p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-lg">
                {generatedContent.item.name}
              </h3>
              <div className="flex items-center gap-2 mt-1">
                <Badge
                  className={cn(
                    "text-xs",
                    rarityColors[generatedContent.item.rarity],
                  )}
                >
                  <Sparkles className="w-3 h-3 mr-1" />
                  {generatedContent.item.rarity}
                </Badge>
                <Badge variant="outline" className="text-xs">
                  {generatedContent.item.type}
                </Badge>
                {generatedContent.item.equipSlot && (
                  <Badge variant="outline" className="text-xs">
                    {generatedContent.item.equipSlot}
                  </Badge>
                )}
              </div>
            </div>
            <SpectacularButton size="sm" onClick={handleExportManifest}>
              <Save className="w-4 h-4 mr-2" />
              Export
            </SpectacularButton>
          </div>

          <p className="text-sm">{generatedContent.item.description}</p>

          {generatedContent.item.examine && (
            <p className="text-sm text-muted-foreground italic">
              "{generatedContent.item.examine}"
            </p>
          )}

          {/* Value and Weight */}
          <div className="flex gap-4 text-sm">
            <span className="flex items-center gap-1">
              <Coins className="w-4 h-4 text-yellow-400" />
              {generatedContent.item.value.toLocaleString()} gp
            </span>
            <span className="text-muted-foreground">
              Weight: {generatedContent.item.weight} kg
            </span>
            {generatedContent.item.stackable && (
              <Badge variant="outline" className="text-xs">
                Stackable
              </Badge>
            )}
            {!generatedContent.item.tradeable && (
              <Badge variant="outline" className="text-xs text-red-400">
                Untradeable
              </Badge>
            )}
          </div>

          {/* Combat Stats */}
          {generatedContent.item.bonuses && (
            <div className="border-t border-glass-border pt-4">
              <button
                onClick={() => toggleSection("stats")}
                className="w-full flex items-center justify-between py-1"
              >
                <span className="font-semibold flex items-center gap-2">
                  <Sword className="w-4 h-4" />
                  Combat Bonuses
                </span>
                {expandedSections.stats ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
              </button>

              {expandedSections.stats && (
                <div className="grid grid-cols-5 gap-2 mt-3">
                  {Object.entries(generatedContent.item.bonuses).map(
                    ([stat, value]) =>
                      value !== 0 && (
                        <div
                          key={stat}
                          className="flex flex-col items-center p-2 rounded bg-glass-bg/50"
                        >
                          <span className="text-xs text-muted-foreground capitalize">
                            {stat}
                          </span>
                          <span
                            className={cn(
                              "font-bold",
                              value > 0 ? "text-green-400" : "text-red-400",
                            )}
                          >
                            {value > 0 ? "+" : ""}
                            {value}
                          </span>
                        </div>
                      ),
                  )}
                </div>
              )}
            </div>
          )}

          {/* Weapon Stats */}
          {(generatedContent.item.attackSpeed ||
            generatedContent.item.attackRange) && (
            <div className="flex gap-4 text-sm">
              {generatedContent.item.weaponType && (
                <span>Type: {generatedContent.item.weaponType}</span>
              )}
              {generatedContent.item.attackType && (
                <span>Attack: {generatedContent.item.attackType}</span>
              )}
              {generatedContent.item.attackSpeed && (
                <span>Speed: {generatedContent.item.attackSpeed}</span>
              )}
              {generatedContent.item.attackRange && (
                <span>Range: {generatedContent.item.attackRange}</span>
              )}
            </div>
          )}

          {/* Requirements */}
          {generatedContent.item.requirements && (
            <div className="border-t border-glass-border pt-4">
              <button
                onClick={() => toggleSection("requirements")}
                className="w-full flex items-center justify-between py-1"
              >
                <span className="font-semibold flex items-center gap-2">
                  <Shield className="w-4 h-4" />
                  Requirements
                </span>
                {expandedSections.requirements ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
              </button>

              {expandedSections.requirements && (
                <div className="space-y-2 mt-3">
                  {generatedContent.item.requirements.level && (
                    <div className="flex justify-between text-sm p-2 rounded bg-glass-bg/50">
                      <span>Level</span>
                      <span className="font-medium">
                        {generatedContent.item.requirements.level}
                      </span>
                    </div>
                  )}
                  {generatedContent.item.requirements.skills &&
                    Object.entries(
                      generatedContent.item.requirements.skills,
                    ).map(([skill, lvl]) => (
                      <div
                        key={skill}
                        className="flex justify-between text-sm p-2 rounded bg-glass-bg/50"
                      >
                        <span className="capitalize">{skill}</span>
                        <span className="font-medium">{lvl}</span>
                      </div>
                    ))}
                </div>
              )}
            </div>
          )}

          {/* ID */}
          <div className="border-t border-glass-border pt-4 flex justify-between text-sm">
            <span className="text-muted-foreground">Item ID</span>
            <span className="font-mono text-xs">
              {generatedContent.item.id}
            </span>
          </div>
        </GlassPanel>
      )}
    </div>
  );
}
