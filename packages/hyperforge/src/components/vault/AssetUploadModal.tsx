"use client";

import { useState, useRef, useCallback } from "react";
import {
  X,
  Upload,
  FileUp,
  Loader2,
  Package,
  Sword,
  Shield,
  Axe,
  TreeDeciduous,
  Skull,
  Coins,
  Image as ImageIcon,
  AlertCircle,
  Check,
} from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { SpectacularButton } from "@/components/ui/spectacular-button";
import { NeonInput } from "@/components/ui/neon-input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

// Asset categories with icons
const ASSET_CATEGORIES = [
  { value: "weapon", label: "Weapon", icon: Sword },
  { value: "armor", label: "Armor", icon: Shield },
  { value: "tool", label: "Tool", icon: Axe },
  { value: "item", label: "Item", icon: Package },
  { value: "resource", label: "Resource", icon: TreeDeciduous },
  { value: "npc", label: "NPC/Mob", icon: Skull },
  { value: "environment", label: "Environment", icon: TreeDeciduous },
  { value: "avatar", label: "Avatar", icon: Package },
] as const;

const RARITY_OPTIONS = [
  { value: "common", label: "Common", color: "text-gray-400" },
  { value: "uncommon", label: "Uncommon", color: "text-green-400" },
  { value: "rare", label: "Rare", color: "text-blue-400" },
  { value: "epic", label: "Epic", color: "text-purple-400" },
  { value: "legendary", label: "Legendary", color: "text-orange-400" },
] as const;

const EQUIP_SLOTS = [
  "weapon",
  "shield",
  "head",
  "body",
  "legs",
  "hands",
  "feet",
  "cape",
  "neck",
  "ring",
] as const;

const WEAPON_TYPES = [
  "SWORD",
  "AXE",
  "MACE",
  "DAGGER",
  "SPEAR",
  "BOW",
  "STAFF",
  "WAND",
] as const;

const ATTACK_TYPES = ["MELEE", "RANGED", "MAGIC"] as const;

interface AssetUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUploadComplete?: (asset: {
    id: string;
    name: string;
    category: string;
  }) => void;
}

export function AssetUploadModal({
  isOpen,
  onClose,
  onUploadComplete,
}: AssetUploadModalProps) {
  // File states
  const [modelFile, setModelFile] = useState<File | null>(null);
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null);
  const [thumbnailPreview, setThumbnailPreview] = useState<string | null>(null);

  // Form states
  const [name, setName] = useState("");
  const [category, setCategory] = useState<string>("item");
  const [description, setDescription] = useState("");
  const [rarity, setRarity] = useState<string>("common");

  // Item properties
  const [value, setValue] = useState<string>("");
  const [weight, setWeight] = useState<string>("");
  const [stackable, setStackable] = useState(false);
  const [tradeable, setTradeable] = useState(true);

  // Equipment properties
  const [equipSlot, setEquipSlot] = useState<string>("");
  const [weaponType, setWeaponType] = useState<string>("");
  const [attackType, setAttackType] = useState<string>("");
  const [attackSpeed, setAttackSpeed] = useState<string>("");
  const [attackRange, setAttackRange] = useState<string>("");

  // Combat bonuses
  const [bonusAttack, setBonusAttack] = useState<string>("");
  const [bonusStrength, setBonusStrength] = useState<string>("");
  const [bonusDefense, setBonusDefense] = useState<string>("");
  const [bonusRanged, setBonusRanged] = useState<string>("");
  const [bonusMagic, setBonusMagic] = useState<string>("");

  // Requirements
  const [levelRequired, setLevelRequired] = useState<string>("");

  // NPC properties
  const [npcCategory, setNpcCategory] = useState<string>("mob");
  const [faction, setFaction] = useState<string>("");
  const [combatLevel, setCombatLevel] = useState<string>("");
  const [health, setHealth] = useState<string>("");
  const [aggressive, setAggressive] = useState(false);

  // Resource properties
  const [harvestSkill, setHarvestSkill] = useState<string>("");
  const [toolRequired, setToolRequired] = useState<string>("");

  // Upload state
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState(false);

  // File input refs
  const modelInputRef = useRef<HTMLInputElement>(null);
  const thumbnailInputRef = useRef<HTMLInputElement>(null);

  // Handle model file selection
  const handleModelSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        const validExtensions = [".glb", ".gltf", ".vrm"];
        const hasValidExtension = validExtensions.some((ext) =>
          file.name.toLowerCase().endsWith(ext),
        );

        if (!hasValidExtension) {
          setUploadError(
            "Invalid file type. Supported formats: GLB, GLTF, VRM",
          );
          return;
        }

        setModelFile(file);
        setUploadError(null);

        // Auto-fill name from filename if empty
        if (!name) {
          const baseName = file.name.replace(/\.[^.]+$/, "");
          setName(baseName.replace(/[-_]/g, " "));
        }
      }
    },
    [name],
  );

  // Handle thumbnail selection
  const handleThumbnailSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        if (!file.type.startsWith("image/")) {
          setUploadError("Thumbnail must be an image file");
          return;
        }

        setThumbnailFile(file);

        // Create preview
        const reader = new FileReader();
        reader.onload = (e) => {
          setThumbnailPreview(e.target?.result as string);
        };
        reader.readAsDataURL(file);
      }
    },
    [],
  );

  // Handle form submission
  const handleSubmit = async () => {
    if (!modelFile) {
      setUploadError("Please select a model file");
      return;
    }

    if (!name.trim()) {
      setUploadError("Please enter an asset name");
      return;
    }

    setIsUploading(true);
    setUploadError(null);

    try {
      const formData = new FormData();
      formData.append("model", modelFile);

      if (thumbnailFile) {
        formData.append("thumbnail", thumbnailFile);
      }

      // Build metadata object
      const metadata: Record<string, unknown> = {
        name: name.trim(),
        category,
        description: description.trim() || undefined,
        rarity,
      };

      // Add category-specific metadata
      if (
        category === "weapon" ||
        category === "armor" ||
        category === "tool" ||
        category === "item"
      ) {
        if (value) metadata.value = parseInt(value, 10);
        if (weight) metadata.weight = parseFloat(weight);
        metadata.stackable = stackable;
        metadata.tradeable = tradeable;

        if (equipSlot) metadata.equipSlot = equipSlot;
        if (weaponType) metadata.weaponType = weaponType;
        if (attackType) metadata.attackType = attackType;
        if (attackSpeed) metadata.attackSpeed = parseFloat(attackSpeed);
        if (attackRange) metadata.attackRange = parseFloat(attackRange);

        if (bonusAttack) metadata.bonusAttack = parseInt(bonusAttack, 10);
        if (bonusStrength) metadata.bonusStrength = parseInt(bonusStrength, 10);
        if (bonusDefense) metadata.bonusDefense = parseInt(bonusDefense, 10);
        if (bonusRanged) metadata.bonusRanged = parseInt(bonusRanged, 10);
        if (bonusMagic) metadata.bonusMagic = parseInt(bonusMagic, 10);

        if (levelRequired) metadata.levelRequired = parseInt(levelRequired, 10);
      }

      if (category === "npc") {
        metadata.npcCategory = npcCategory;
        if (faction) metadata.faction = faction;
        if (combatLevel) metadata.combatLevel = parseInt(combatLevel, 10);
        if (health) metadata.health = parseInt(health, 10);
        metadata.aggressive = aggressive;
      }

      if (category === "resource") {
        if (harvestSkill) metadata.harvestSkill = harvestSkill;
        if (toolRequired) metadata.toolRequired = toolRequired;
        if (levelRequired) metadata.levelRequired = parseInt(levelRequired, 10);
      }

      formData.append("metadata", JSON.stringify(metadata));

      const response = await fetch("/api/assets/upload", {
        method: "POST",
        body: formData,
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Upload failed");
      }

      setUploadSuccess(true);
      onUploadComplete?.(result.asset);

      // Reset form after short delay
      setTimeout(() => {
        resetForm();
        onClose();
      }, 1500);
    } catch (error) {
      console.error("Upload failed:", error);
      setUploadError(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setIsUploading(false);
    }
  };

  // Reset form
  const resetForm = () => {
    setModelFile(null);
    setThumbnailFile(null);
    setThumbnailPreview(null);
    setName("");
    setCategory("item");
    setDescription("");
    setRarity("common");
    setValue("");
    setWeight("");
    setStackable(false);
    setTradeable(true);
    setEquipSlot("");
    setWeaponType("");
    setAttackType("");
    setAttackSpeed("");
    setAttackRange("");
    setBonusAttack("");
    setBonusStrength("");
    setBonusDefense("");
    setBonusRanged("");
    setBonusMagic("");
    setLevelRequired("");
    setNpcCategory("mob");
    setFaction("");
    setCombatLevel("");
    setHealth("");
    setAggressive(false);
    setHarvestSkill("");
    setToolRequired("");
    setUploadError(null);
    setUploadSuccess(false);
  };

  if (!isOpen) return null;

  const isEquipment =
    category === "weapon" || category === "armor" || category === "tool";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <GlassPanel
        intensity="high"
        className="w-full max-w-2xl max-h-[90vh] flex flex-col m-4"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-glass-border">
          <div className="flex items-center gap-2">
            <Upload className="w-5 h-5 text-cyan-400" />
            <h2 className="text-lg font-semibold">Upload 3D Model</h2>
          </div>
          <SpectacularButton
            variant="ghost"
            size="sm"
            onClick={() => {
              resetForm();
              onClose();
            }}
          >
            <X className="w-4 h-4" />
          </SpectacularButton>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto themed-scrollbar p-4 space-y-4">
          {/* Success State */}
          {uploadSuccess && (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mb-4">
                <Check className="w-8 h-8 text-green-400" />
              </div>
              <h3 className="text-lg font-semibold text-green-400">
                Upload Successful!
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                Your asset has been added to the library
              </p>
            </div>
          )}

          {!uploadSuccess && (
            <>
              {/* File Upload Section */}
              <div className="grid grid-cols-2 gap-4">
                {/* Model File */}
                <div
                  className={cn(
                    "border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors",
                    modelFile
                      ? "border-cyan-500/50 bg-cyan-500/10"
                      : "border-glass-border hover:border-cyan-500/30",
                  )}
                  onClick={() => modelInputRef.current?.click()}
                >
                  <input
                    ref={modelInputRef}
                    type="file"
                    accept=".glb,.gltf,.vrm"
                    onChange={handleModelSelect}
                    className="hidden"
                  />
                  <FileUp
                    className={cn(
                      "w-8 h-8 mx-auto mb-2",
                      modelFile ? "text-cyan-400" : "text-muted-foreground",
                    )}
                  />
                  {modelFile ? (
                    <>
                      <p className="text-sm font-medium text-cyan-400">
                        {modelFile.name}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {(modelFile.size / 1024 / 1024).toFixed(2)} MB
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-medium">Drop 3D Model</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        GLB, GLTF, or VRM
                      </p>
                    </>
                  )}
                </div>

                {/* Thumbnail */}
                <div
                  className={cn(
                    "border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors",
                    thumbnailFile
                      ? "border-purple-500/50 bg-purple-500/10"
                      : "border-glass-border hover:border-purple-500/30",
                  )}
                  onClick={() => thumbnailInputRef.current?.click()}
                >
                  <input
                    ref={thumbnailInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleThumbnailSelect}
                    className="hidden"
                  />
                  {thumbnailPreview ? (
                    <img
                      src={thumbnailPreview}
                      alt="Thumbnail preview"
                      className="w-16 h-16 mx-auto object-cover rounded mb-2"
                    />
                  ) : (
                    <ImageIcon className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                  )}
                  <p className="text-sm font-medium">
                    {thumbnailFile
                      ? thumbnailFile.name
                      : "Thumbnail (Optional)"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    PNG, JPG, WebP
                  </p>
                </div>
              </div>

              {/* Basic Info */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-muted-foreground">
                  Basic Information
                </h3>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Name *</Label>
                    <NeonInput
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Asset name"
                      className="mt-1"
                    />
                  </div>

                  <div>
                    <Label className="text-xs">Rarity</Label>
                    <select
                      value={rarity}
                      onChange={(e) => setRarity(e.target.value)}
                      className="w-full mt-1 h-9 px-3 rounded-md bg-glass-bg border border-glass-border text-sm"
                    >
                      {RARITY_OPTIONS.map((r) => (
                        <option key={r.value} value={r.value}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Category Selection */}
                <div>
                  <Label className="text-xs">Category *</Label>
                  <div className="grid grid-cols-4 gap-2 mt-1">
                    {ASSET_CATEGORIES.map((cat) => {
                      const Icon = cat.icon;
                      return (
                        <button
                          key={cat.value}
                          type="button"
                          onClick={() => setCategory(cat.value)}
                          className={cn(
                            "flex flex-col items-center gap-1 p-2 rounded-lg border transition-colors",
                            category === cat.value
                              ? "border-cyan-500 bg-cyan-500/10 text-cyan-400"
                              : "border-glass-border hover:border-cyan-500/30",
                          )}
                        >
                          <Icon className="w-4 h-4" />
                          <span className="text-xs">{cat.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <Label className="text-xs">Description</Label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Describe this asset..."
                    rows={2}
                    className="w-full mt-1 px-3 py-2 rounded-md bg-glass-bg border border-glass-border text-sm resize-none"
                  />
                </div>
              </div>

              {/* Item Properties */}
              {(category === "weapon" ||
                category === "armor" ||
                category === "tool" ||
                category === "item") && (
                <div className="space-y-3 pt-2 border-t border-glass-border">
                  <h3 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
                    <Coins className="w-4 h-4" />
                    Item Properties
                  </h3>

                  <div className="grid grid-cols-4 gap-3">
                    <div>
                      <Label className="text-xs">Value (Gold)</Label>
                      <NeonInput
                        type="number"
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        placeholder="0"
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Weight</Label>
                      <NeonInput
                        type="number"
                        step="0.1"
                        value={weight}
                        onChange={(e) => setWeight(e.target.value)}
                        placeholder="0"
                        className="mt-1"
                      />
                    </div>
                    <div className="flex items-center gap-2 pt-5">
                      <input
                        type="checkbox"
                        id="stackable"
                        checked={stackable}
                        onChange={(e) => setStackable(e.target.checked)}
                        className="rounded"
                      />
                      <Label htmlFor="stackable" className="text-xs">
                        Stackable
                      </Label>
                    </div>
                    <div className="flex items-center gap-2 pt-5">
                      <input
                        type="checkbox"
                        id="tradeable"
                        checked={tradeable}
                        onChange={(e) => setTradeable(e.target.checked)}
                        className="rounded"
                      />
                      <Label htmlFor="tradeable" className="text-xs">
                        Tradeable
                      </Label>
                    </div>
                  </div>
                </div>
              )}

              {/* Equipment Properties */}
              {isEquipment && (
                <div className="space-y-3 pt-2 border-t border-glass-border">
                  <h3 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
                    <Shield className="w-4 h-4" />
                    Equipment Properties
                  </h3>

                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <Label className="text-xs">Equip Slot</Label>
                      <select
                        value={equipSlot}
                        onChange={(e) => setEquipSlot(e.target.value)}
                        className="w-full mt-1 h-9 px-3 rounded-md bg-glass-bg border border-glass-border text-sm"
                      >
                        <option value="">Select slot...</option>
                        {EQUIP_SLOTS.map((slot) => (
                          <option key={slot} value={slot}>
                            {slot.charAt(0).toUpperCase() + slot.slice(1)}
                          </option>
                        ))}
                      </select>
                    </div>

                    {category === "weapon" && (
                      <>
                        <div>
                          <Label className="text-xs">Weapon Type</Label>
                          <select
                            value={weaponType}
                            onChange={(e) => setWeaponType(e.target.value)}
                            className="w-full mt-1 h-9 px-3 rounded-md bg-glass-bg border border-glass-border text-sm"
                          >
                            <option value="">Select type...</option>
                            {WEAPON_TYPES.map((type) => (
                              <option key={type} value={type}>
                                {type}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <Label className="text-xs">Attack Type</Label>
                          <select
                            value={attackType}
                            onChange={(e) => setAttackType(e.target.value)}
                            className="w-full mt-1 h-9 px-3 rounded-md bg-glass-bg border border-glass-border text-sm"
                          >
                            <option value="">Select type...</option>
                            {ATTACK_TYPES.map((type) => (
                              <option key={type} value={type}>
                                {type}
                              </option>
                            ))}
                          </select>
                        </div>
                      </>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Attack Speed</Label>
                      <NeonInput
                        type="number"
                        step="0.1"
                        value={attackSpeed}
                        onChange={(e) => setAttackSpeed(e.target.value)}
                        placeholder="4"
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Attack Range</Label>
                      <NeonInput
                        type="number"
                        value={attackRange}
                        onChange={(e) => setAttackRange(e.target.value)}
                        placeholder="1"
                        className="mt-1"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Combat Bonuses */}
              {isEquipment && (
                <div className="space-y-3 pt-2 border-t border-glass-border">
                  <h3 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
                    <Sword className="w-4 h-4" />
                    Combat Bonuses
                  </h3>

                  <div className="grid grid-cols-5 gap-2">
                    <div>
                      <Label className="text-xs">Attack</Label>
                      <NeonInput
                        type="number"
                        value={bonusAttack}
                        onChange={(e) => setBonusAttack(e.target.value)}
                        placeholder="0"
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Strength</Label>
                      <NeonInput
                        type="number"
                        value={bonusStrength}
                        onChange={(e) => setBonusStrength(e.target.value)}
                        placeholder="0"
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Defense</Label>
                      <NeonInput
                        type="number"
                        value={bonusDefense}
                        onChange={(e) => setBonusDefense(e.target.value)}
                        placeholder="0"
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Ranged</Label>
                      <NeonInput
                        type="number"
                        value={bonusRanged}
                        onChange={(e) => setBonusRanged(e.target.value)}
                        placeholder="0"
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Magic</Label>
                      <NeonInput
                        type="number"
                        value={bonusMagic}
                        onChange={(e) => setBonusMagic(e.target.value)}
                        placeholder="0"
                        className="mt-1"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Level Required</Label>
                      <NeonInput
                        type="number"
                        value={levelRequired}
                        onChange={(e) => setLevelRequired(e.target.value)}
                        placeholder="1"
                        className="mt-1"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* NPC Properties */}
              {category === "npc" && (
                <div className="space-y-3 pt-2 border-t border-glass-border">
                  <h3 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
                    <Skull className="w-4 h-4" />
                    NPC Properties
                  </h3>

                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <Label className="text-xs">NPC Type</Label>
                      <select
                        value={npcCategory}
                        onChange={(e) => setNpcCategory(e.target.value)}
                        className="w-full mt-1 h-9 px-3 rounded-md bg-glass-bg border border-glass-border text-sm"
                      >
                        <option value="mob">Monster</option>
                        <option value="boss">Boss</option>
                        <option value="neutral">Neutral NPC</option>
                        <option value="quest">Quest NPC</option>
                      </select>
                    </div>
                    <div>
                      <Label className="text-xs">Faction</Label>
                      <NeonInput
                        value={faction}
                        onChange={(e) => setFaction(e.target.value)}
                        placeholder="monster"
                        className="mt-1"
                      />
                    </div>
                    <div className="flex items-center gap-2 pt-5">
                      <input
                        type="checkbox"
                        id="aggressive"
                        checked={aggressive}
                        onChange={(e) => setAggressive(e.target.checked)}
                        className="rounded"
                      />
                      <Label htmlFor="aggressive" className="text-xs">
                        Aggressive
                      </Label>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Combat Level</Label>
                      <NeonInput
                        type="number"
                        value={combatLevel}
                        onChange={(e) => setCombatLevel(e.target.value)}
                        placeholder="1"
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Health</Label>
                      <NeonInput
                        type="number"
                        value={health}
                        onChange={(e) => setHealth(e.target.value)}
                        placeholder="10"
                        className="mt-1"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Resource Properties */}
              {category === "resource" && (
                <div className="space-y-3 pt-2 border-t border-glass-border">
                  <h3 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
                    <TreeDeciduous className="w-4 h-4" />
                    Resource Properties
                  </h3>

                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <Label className="text-xs">Harvest Skill</Label>
                      <select
                        value={harvestSkill}
                        onChange={(e) => setHarvestSkill(e.target.value)}
                        className="w-full mt-1 h-9 px-3 rounded-md bg-glass-bg border border-glass-border text-sm"
                      >
                        <option value="">Select skill...</option>
                        <option value="woodcutting">Woodcutting</option>
                        <option value="mining">Mining</option>
                        <option value="fishing">Fishing</option>
                        <option value="farming">Farming</option>
                      </select>
                    </div>
                    <div>
                      <Label className="text-xs">Tool Required</Label>
                      <NeonInput
                        value={toolRequired}
                        onChange={(e) => setToolRequired(e.target.value)}
                        placeholder="bronze_hatchet"
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Level Required</Label>
                      <NeonInput
                        type="number"
                        value={levelRequired}
                        onChange={(e) => setLevelRequired(e.target.value)}
                        placeholder="1"
                        className="mt-1"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Error Display */}
              {uploadError && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <p className="text-sm">{uploadError}</p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {!uploadSuccess && (
          <div className="flex items-center justify-end gap-2 p-4 border-t border-glass-border">
            <SpectacularButton
              variant="outline"
              onClick={() => {
                resetForm();
                onClose();
              }}
              disabled={isUploading}
            >
              Cancel
            </SpectacularButton>
            <SpectacularButton
              variant="default"
              onClick={handleSubmit}
              disabled={!modelFile || !name.trim() || isUploading}
            >
              {isUploading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4 mr-2" />
                  Upload Asset
                </>
              )}
            </SpectacularButton>
          </div>
        )}
      </GlassPanel>
    </div>
  );
}
