"use client";

import { useState, useEffect, useCallback } from "react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { SpectacularButton } from "@/components/ui/spectacular-button";
import { NeonInput } from "@/components/ui/neon-input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/components/ui/toast";
import { Wand2, Loader2, Save, Eye, Mic, Volume2 } from "lucide-react";
import { DialogueTreeEditor } from "./DialogueTreeEditor";
import { logger } from "@/lib/utils";

const log = logger.child("NPCContentGenerator");
import type {
  DialogueTree,
  DialogueNode,
  DialogueAudio,
  DialogueGenerationContext,
  GeneratedNPCContent,
} from "@/types/game/dialogue-types";

type VoicePreset = {
  id: string;
  name: string;
  description: string;
};

interface NPCContentGeneratorProps {
  onContentGenerated?: (content: GeneratedNPCContent) => void;
}

export function NPCContentGenerator({
  onContentGenerated,
}: NPCContentGeneratorProps) {
  const { toast } = useToast();
  const [isGenerating, setIsGenerating] = useState(false);
  const [showEditor, setShowEditor] = useState(false);

  // Form state
  const [npcName, setNpcName] = useState("");
  const [npcDescription, setNpcDescription] = useState("");
  const [npcCategory, setNpcCategory] = useState<
    "mob" | "boss" | "neutral" | "quest"
  >("neutral");
  const [npcPersonality, setNpcPersonality] = useState("");
  const [npcRole, setNpcRole] = useState("");
  const [tone, setTone] = useState<
    "friendly" | "grumpy" | "mysterious" | "aggressive" | "formal"
  >("friendly");
  const [services, setServices] = useState<string[]>([]);
  const [generateBackstory, setGenerateBackstory] = useState(true);
  const [lore, setLore] = useState("");

  // Quest context
  const [hasQuest, setHasQuest] = useState(false);
  const [questId, setQuestId] = useState("");
  const [questName, setQuestName] = useState("");
  const [questDescription, setQuestDescription] = useState("");

  // Generated content
  const [generatedContent, setGeneratedContent] =
    useState<GeneratedNPCContent | null>(null);
  const [dialogueTree, setDialogueTree] = useState<DialogueTree | null>(null);

  // Voice generation state
  const [voicePresets, setVoicePresets] = useState<VoicePreset[]>([]);
  const [selectedVoice, setSelectedVoice] = useState<string>("");
  const [isGeneratingVoices, setIsGeneratingVoices] = useState(false);
  const [voiceProgress, setVoiceProgress] = useState({ current: 0, total: 0 });
  const [generatedVoiceCount, setGeneratedVoiceCount] = useState(0);

  // Load voice presets
  useEffect(() => {
    async function loadPresets() {
      try {
        const res = await fetch("/api/audio/voices?type=presets");
        if (res.ok) {
          const data = await res.json();
          setVoicePresets(data.voices || []);
        }
      } catch (error) {
        log.error("Failed to load voice presets:", error);
      }
    }
    loadPresets();
  }, []);

  // Auto-select voice preset based on NPC category/role
  const getRecommendedVoice = useCallback(() => {
    const roleLower = npcRole.toLowerCase();
    const categoryLower = npcCategory.toLowerCase();
    const personalityLower = npcPersonality.toLowerCase();

    // Map NPC characteristics to voice presets
    if (roleLower.includes("guard") || roleLower.includes("soldier")) {
      return "guard";
    }
    if (
      roleLower.includes("mage") ||
      roleLower.includes("wizard") ||
      roleLower.includes("witch")
    ) {
      return "female-mage";
    }
    if (
      roleLower.includes("merchant") ||
      roleLower.includes("shop") ||
      roleLower.includes("trader")
    ) {
      return "merchant";
    }
    if (
      roleLower.includes("inn") ||
      roleLower.includes("bartend") ||
      roleLower.includes("tavern")
    ) {
      return "innkeeper";
    }
    if (
      roleLower.includes("sage") ||
      roleLower.includes("elder") ||
      personalityLower.includes("wise")
    ) {
      return "old-sage";
    }
    if (
      categoryLower === "boss" ||
      categoryLower === "mob" ||
      personalityLower.includes("evil")
    ) {
      return "villain";
    }
    if (
      personalityLower.includes("young") ||
      personalityLower.includes("energetic")
    ) {
      return "young-hero";
    }
    // Default based on category
    if (categoryLower === "quest") {
      return "young-hero";
    }
    return "merchant"; // Friendly default
  }, [npcRole, npcCategory, npcPersonality]);

  // Auto-select voice when content is generated
  useEffect(() => {
    if (generatedContent && voicePresets.length > 0 && !selectedVoice) {
      const recommended = getRecommendedVoice();
      setSelectedVoice(recommended);
    }
  }, [generatedContent, voicePresets, selectedVoice, getRecommendedVoice]);

  // Generate voices for all dialogue nodes
  const handleGenerateAllVoices = useCallback(async () => {
    if (!dialogueTree?.nodes || !selectedVoice) return;

    const nodes = dialogueTree.nodes;
    setIsGeneratingVoices(true);
    setVoiceProgress({ current: 0, total: nodes.length });

    let successCount = 0;
    const updatedNodes: DialogueNode[] = [];

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      setVoiceProgress({ current: i + 1, total: nodes.length });

      // Skip if no text or already has audio
      if (!node.text || node.audio) {
        updatedNodes.push(node);
        continue;
      }

      try {
        const res = await fetch("/api/audio/voice/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: node.text,
            voicePreset: selectedVoice,
            npcId: generatedContent?.id,
            dialogueNodeId: node.id,
            withTimestamps: true,
            saveToAsset: true,
          }),
        });

        if (res.ok) {
          const data = await res.json();
          const audio: DialogueAudio = {
            url: data.asset.url,
            voiceId: data.asset.voiceId,
            duration: data.asset.duration,
            generatedAt: data.asset.generatedAt,
            timestamps: data.asset.timestamps,
          };
          updatedNodes.push({ ...node, audio });
          successCount++;
        } else {
          updatedNodes.push(node);
        }
      } catch (error) {
        log.error(`Failed to generate voice for node ${node.id}:`, error);
        updatedNodes.push(node);
      }
    }

    // Update the dialogue tree with audio
    const updatedTree: DialogueTree = {
      ...dialogueTree,
      nodes: updatedNodes,
      hasAudio: successCount > 0,
      voiceConfig: {
        voiceId: selectedVoice,
        voicePreset: selectedVoice,
      },
    };

    setDialogueTree(updatedTree);
    setGeneratedVoiceCount(successCount);

    if (generatedContent) {
      setGeneratedContent({
        ...generatedContent,
        dialogue: updatedTree,
      });
    }

    setIsGeneratingVoices(false);

    toast({
      variant: successCount > 0 ? "success" : "destructive",
      title: successCount > 0 ? "Voices Generated" : "Voice Generation Failed",
      description: `Generated ${successCount} of ${nodes.length} voice clips`,
    });
  }, [dialogueTree, selectedVoice, generatedContent, toast]);

  const categoryOptions = [
    { value: "neutral", label: "Neutral (Shopkeeper, Banker, etc.)" },
    { value: "quest", label: "Quest NPC" },
    { value: "mob", label: "Mob (Hostile)" },
    { value: "boss", label: "Boss" },
  ];

  const toneOptions = [
    { value: "friendly", label: "Friendly" },
    { value: "grumpy", label: "Grumpy" },
    { value: "mysterious", label: "Mysterious" },
    { value: "aggressive", label: "Aggressive" },
    { value: "formal", label: "Formal" },
  ];

  const serviceOptions = [
    { id: "bank", label: "Bank" },
    { id: "shop", label: "Shop" },
    { id: "quest", label: "Quest Giver" },
    { id: "skill_trainer", label: "Skill Trainer" },
    { id: "teleport", label: "Teleport" },
  ];

  const handleServiceToggle = (serviceId: string) => {
    setServices((prev) =>
      prev.includes(serviceId)
        ? prev.filter((s) => s !== serviceId)
        : [...prev, serviceId],
    );
  };

  const handleGenerate = async () => {
    if (!npcName.trim()) {
      toast({
        variant: "destructive",
        title: "Name Required",
        description: "Please enter an NPC name",
      });
      return;
    }

    if (!npcDescription.trim()) {
      toast({
        variant: "destructive",
        title: "Description Required",
        description: "Please enter an NPC description",
      });
      return;
    }

    setIsGenerating(true);

    try {
      const context: DialogueGenerationContext = {
        npcName,
        npcDescription,
        npcCategory,
        npcPersonality: npcPersonality || undefined,
        npcRole: npcRole || undefined,
        services: services.length > 0 ? services : undefined,
        tone,
        lore: lore || undefined,
      };

      if (hasQuest && questId && questName) {
        context.questContext = {
          questId,
          questName,
          questDescription,
        };
      }

      const response = await fetch("/api/content/dialogue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "generateFull",
          ...context,
          generateBackstory,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Generation failed");
      }

      const result = await response.json();
      setGeneratedContent(result.content);
      setDialogueTree(result.content.dialogue);

      toast({
        variant: "success",
        title: "Content Generated",
        description: `Generated ${result.content.dialogue.nodes.length} dialogue nodes`,
      });

      onContentGenerated?.(result.content);
    } catch (error) {
      log.error("Generation failed:", error);
      toast({
        variant: "destructive",
        title: "Generation Failed",
        description:
          error instanceof Error ? error.message : "Failed to generate content",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSaveDialogue = (tree: DialogueTree) => {
    setDialogueTree(tree);
    if (generatedContent) {
      setGeneratedContent({
        ...generatedContent,
        dialogue: tree,
      });
    }
    toast({
      variant: "success",
      title: "Dialogue Updated",
      description: "Your changes have been saved",
    });
  };

  const handleExportManifest = async () => {
    if (!generatedContent) return;

    try {
      const response = await fetch("/api/manifest/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "preview",
          category:
            npcCategory === "mob" || npcCategory === "boss"
              ? "npc"
              : npcCategory,
          metadata: {
            id: generatedContent.id,
            name: generatedContent.name,
            description: generatedContent.description,
            category: generatedContent.category,
            dialogue: generatedContent.dialogue,
          },
        }),
      });

      const result = await response.json();
      log.info("Manifest preview:", result);

      toast({
        variant: "success",
        title: "Export Preview",
        description: "Check console for manifest preview",
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

  if (showEditor && dialogueTree) {
    return (
      <div className="h-full flex flex-col">
        <div className="p-4 border-b border-glass-border flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">
              {npcName} - Dialogue Editor
            </h2>
            <p className="text-sm text-muted-foreground">
              {dialogueTree.nodes.length} nodes
            </p>
          </div>
          <div className="flex gap-2">
            <SpectacularButton
              variant="outline"
              onClick={() => setShowEditor(false)}
            >
              Back to Form
            </SpectacularButton>
            <SpectacularButton onClick={handleExportManifest}>
              <Save className="w-4 h-4 mr-2" />
              Export to Manifest
            </SpectacularButton>
          </div>
        </div>
        <div className="flex-1">
          <DialogueTreeEditor
            initialTree={dialogueTree}
            npcName={npcName}
            npcId={generatedContent?.id}
            onSave={handleSaveDialogue}
            onGenerate={handleGenerate}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-4 space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-2">NPC Content Generator</h2>
        <p className="text-sm text-muted-foreground">
          Generate complete NPC content including dialogue trees, backstory, and
          manifest data.
        </p>
      </div>

      {/* Basic Info */}
      <GlassPanel className="p-4 space-y-4">
        <h3 className="font-semibold">Basic Information</h3>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>NPC Name *</Label>
            <NeonInput
              value={npcName}
              onChange={(e) => setNpcName(e.target.value)}
              placeholder="e.g., Bob the Banker"
            />
          </div>
          <div className="space-y-2">
            <Label>Category *</Label>
            <Select
              value={npcCategory}
              onChange={(v) => setNpcCategory(v as typeof npcCategory)}
              options={categoryOptions}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label>Description *</Label>
          <textarea
            value={npcDescription}
            onChange={(e) => setNpcDescription(e.target.value)}
            className="w-full h-20 p-2 bg-glass-bg border border-glass-border rounded text-sm resize-none"
            placeholder="A friendly banker who works at the Lumbridge Bank. He's known for his helpful nature and encyclopedic knowledge of the kingdom's economy."
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Role</Label>
            <NeonInput
              value={npcRole}
              onChange={(e) => setNpcRole(e.target.value)}
              placeholder="e.g., banker, shopkeeper, guard"
            />
          </div>
          <div className="space-y-2">
            <Label>Personality</Label>
            <NeonInput
              value={npcPersonality}
              onChange={(e) => setNpcPersonality(e.target.value)}
              placeholder="e.g., cheerful, mysterious, grumpy"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label>Tone</Label>
          <Select
            value={tone}
            onChange={(v) => setTone(v as typeof tone)}
            options={toneOptions}
          />
        </div>
      </GlassPanel>

      {/* Services */}
      <GlassPanel className="p-4 space-y-4">
        <h3 className="font-semibold">Services</h3>
        <p className="text-sm text-muted-foreground">
          Select services this NPC provides. Dialogue will include options to
          access them.
        </p>

        <div className="flex flex-wrap gap-4">
          {serviceOptions.map((service) => (
            <div key={service.id} className="flex items-center gap-2">
              <Checkbox
                id={service.id}
                checked={services.includes(service.id)}
                onCheckedChange={() => handleServiceToggle(service.id)}
              />
              <Label htmlFor={service.id} className="cursor-pointer">
                {service.label}
              </Label>
            </div>
          ))}
        </div>
      </GlassPanel>

      {/* Quest Context */}
      <GlassPanel className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Quest Context</h3>
          <Checkbox
            id="hasQuest"
            checked={hasQuest}
            onCheckedChange={(checked) => setHasQuest(checked === true)}
          />
        </div>

        {hasQuest && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Quest ID</Label>
                <NeonInput
                  value={questId}
                  onChange={(e) => setQuestId(e.target.value)}
                  placeholder="e.g., goblin_slayer"
                />
              </div>
              <div className="space-y-2">
                <Label>Quest Name</Label>
                <NeonInput
                  value={questName}
                  onChange={(e) => setQuestName(e.target.value)}
                  placeholder="e.g., Goblin Slayer"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Quest Description</Label>
              <textarea
                value={questDescription}
                onChange={(e) => setQuestDescription(e.target.value)}
                className="w-full h-16 p-2 bg-glass-bg border border-glass-border rounded text-sm resize-none"
                placeholder="Describe the quest objectives and rewards..."
              />
            </div>
          </div>
        )}
      </GlassPanel>

      {/* World Lore */}
      <GlassPanel className="p-4 space-y-4">
        <h3 className="font-semibold">World Lore (Optional)</h3>
        <textarea
          value={lore}
          onChange={(e) => setLore(e.target.value)}
          className="w-full h-24 p-2 bg-glass-bg border border-glass-border rounded text-sm resize-none"
          placeholder="Add any world lore or context that should influence the dialogue..."
        />
      </GlassPanel>

      {/* Options */}
      <GlassPanel className="p-4 space-y-4">
        <h3 className="font-semibold">Generation Options</h3>
        <div className="flex items-center gap-2">
          <Checkbox
            id="generateBackstory"
            checked={generateBackstory}
            onCheckedChange={(checked) =>
              setGenerateBackstory(checked === true)
            }
          />
          <Label htmlFor="generateBackstory" className="cursor-pointer">
            Generate backstory
          </Label>
        </div>
      </GlassPanel>

      {/* Generate Button */}
      <SpectacularButton
        className="w-full"
        size="lg"
        onClick={handleGenerate}
        disabled={isGenerating || !npcName.trim() || !npcDescription.trim()}
      >
        {isGenerating ? (
          <>
            <Loader2 className="w-5 h-5 mr-2 animate-spin" />
            Generating Content...
          </>
        ) : (
          <>
            <Wand2 className="w-5 h-5 mr-2" />
            Generate NPC Content
          </>
        )}
      </SpectacularButton>

      {/* Generated Content Preview */}
      {generatedContent && (
        <GlassPanel className="p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Generated Content</h3>
            <SpectacularButton size="sm" onClick={() => setShowEditor(true)}>
              <Eye className="w-4 h-4 mr-2" />
              Edit Dialogue Tree
            </SpectacularButton>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">ID</span>
              <span className="font-mono">{generatedContent.id}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Dialogue Nodes</span>
              <span>{generatedContent.dialogue.nodes.length}</span>
            </div>
            {generatedVoiceCount > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Voice Clips</span>
                <span className="text-green-400 flex items-center gap-1">
                  <Volume2 className="w-3 h-3" />
                  {generatedVoiceCount}
                </span>
              </div>
            )}
          </div>

          {generatedContent.backstory && (
            <div className="space-y-2">
              <Label>Backstory</Label>
              <p className="text-sm text-muted-foreground bg-glass-bg/50 p-3 rounded">
                {generatedContent.backstory}
              </p>
            </div>
          )}

          {/* Voice Generation Section */}
          <div className="border-t border-glass-border pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-2">
                <Mic className="w-4 h-4" />
                Generate Voice Audio
              </Label>
              {dialogueTree?.hasAudio && (
                <span className="text-xs text-green-400">✓ Has Audio</span>
              )}
            </div>

            <div className="flex gap-2">
              <Select
                value={selectedVoice}
                onChange={(v) => setSelectedVoice(v)}
                options={voicePresets.map((p) => ({
                  value: p.id,
                  label: p.name,
                }))}
                placeholder="Select voice..."
                className="flex-1"
              />
              <SpectacularButton
                onClick={handleGenerateAllVoices}
                disabled={!selectedVoice || isGeneratingVoices}
              >
                {isGeneratingVoices ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    {voiceProgress.current}/{voiceProgress.total}
                  </>
                ) : (
                  <>
                    <Mic className="w-4 h-4 mr-2" />
                    Generate All Voices
                  </>
                )}
              </SpectacularButton>
            </div>

            {selectedVoice && voicePresets.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {voicePresets.find((p) => p.id === selectedVoice)
                  ?.description || ""}
              </p>
            )}

            {isGeneratingVoices && (
              <div className="space-y-1">
                <div className="h-2 bg-glass-bg rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all duration-300"
                    style={{
                      width: `${(voiceProgress.current / voiceProgress.total) * 100}%`,
                    }}
                  />
                </div>
                <p className="text-xs text-muted-foreground text-center">
                  Generating voice {voiceProgress.current} of{" "}
                  {voiceProgress.total}...
                </p>
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <SpectacularButton
              className="flex-1"
              onClick={() => setShowEditor(true)}
            >
              <Eye className="w-4 h-4 mr-2" />
              View & Edit Dialogue
            </SpectacularButton>
            <SpectacularButton
              className="flex-1"
              variant="outline"
              onClick={handleExportManifest}
            >
              <Save className="w-4 h-4 mr-2" />
              Export to Game
            </SpectacularButton>
          </div>
        </GlassPanel>
      )}
    </div>
  );
}
