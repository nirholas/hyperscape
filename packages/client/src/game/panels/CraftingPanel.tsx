/**
 * CraftingPanel - OSRS-style crafting interface
 *
 * Features:
 * - Shows available items to craft based on player's materials
 * - Groups recipes by category (leather, studded, dragonhide, jewelry, gem cutting)
 * - Displays level requirements, material requirements, XP
 * - Allows quantity selection (1, 5, 10, All, X)
 * - Sends crafting request to server
 */

import React, { useState, useMemo, useEffect } from "react";
import type { ClientWorld } from "../../types";
import { useThemeStore } from "@/ui";
import { formatItemName } from "@/utils";

interface CraftingRecipe {
  output: string;
  name: string;
  category: string;
  inputs: Array<{ item: string; amount: number }>;
  tools: string[];
  level: number;
  xp: number;
  meetsLevel: boolean;
  hasInputs: boolean;
}

interface CraftingPanelProps {
  availableRecipes: CraftingRecipe[];
  world: ClientWorld;
  onClose: () => void;
  station?: string;
}

/**
 * Get icon for crafting item type
 */
function getItemIcon(output: string, category: string): string {
  const id = output.toLowerCase();

  // Leather items
  if (id.includes("leather") && !id.includes("dragon")) return "🧥";
  if (id.includes("vambraces") || id.includes("vambrace")) return "🧤";
  if (id.includes("chaps")) return "👖";
  if (id.includes("coif")) return "⛑️";
  if (id.includes("cowl")) return "⛑️";
  if (id.includes("body")) return "🛡️";

  // Dragonhide
  if (
    category === "dragonhide" ||
    id.includes("dhide") ||
    id.includes("dragon")
  )
    return "🐉";

  // Studded
  if (id.includes("studded")) return "🔩";

  // Jewelry
  if (id.includes("ring")) return "💍";
  if (id.includes("necklace")) return "📿";
  if (id.includes("amulet")) return "📿";
  if (id.includes("bracelet")) return "⌚";

  // Gems
  if (id.includes("sapphire")) return "💎";
  if (id.includes("emerald")) return "💚";
  if (id.includes("ruby")) return "❤️";
  if (id.includes("diamond")) return "💠";

  // Gem cutting
  if (category === "gem_cutting") return "💎";

  return "🧵";
}

/**
 * Category display order and labels
 */
const CATEGORY_ORDER = [
  "leather",
  "studded",
  "dragonhide",
  "jewelry",
  "gem_cutting",
];
const CATEGORY_LABELS: Record<string, string> = {
  leather: "Leather",
  studded: "Studded",
  dragonhide: "Dragonhide",
  jewelry: "Jewelry",
  gem_cutting: "Gem Cutting",
};

/** localStorage key for Make X memory */
const CRAFTING_LAST_X_KEY = "crafting_last_x";

export function CraftingPanel({
  availableRecipes,
  world,
  onClose,
}: CraftingPanelProps) {
  const theme = useThemeStore((s) => s.theme);
  const [selectedRecipe, setSelectedRecipe] = useState<CraftingRecipe | null>(
    null,
  );
  const [showQuantityInput, setShowQuantityInput] = useState(false);
  const [customQuantity, setCustomQuantity] = useState("");

  // Make X memory - remember last custom quantity (OSRS feature)
  const [lastCustomQuantity, setLastCustomQuantity] = useState(() => {
    try {
      const stored = localStorage.getItem(CRAFTING_LAST_X_KEY);
      return stored ? parseInt(stored, 10) || 10 : 10;
    } catch {
      return 10;
    }
  });

  // Group recipes by category
  const groupedRecipes = useMemo(() => {
    const groups: Record<string, CraftingRecipe[]> = {};

    for (const recipe of availableRecipes) {
      const category = recipe.category || "misc";
      if (!groups[category]) {
        groups[category] = [];
      }
      groups[category].push(recipe);
    }

    // Sort by category order
    const sorted: Array<[string, CraftingRecipe[]]> = [];
    for (const cat of CATEGORY_ORDER) {
      if (groups[cat]) {
        sorted.push([cat, groups[cat]]);
      }
    }
    // Add any categories not in the predefined order
    for (const cat of Object.keys(groups)) {
      if (!CATEGORY_ORDER.includes(cat)) {
        sorted.push([cat, groups[cat]]);
      }
    }

    return sorted;
  }, [availableRecipes]);

  // Auto-select when only one recipe (e.g., chisel + uncut gem → skip to quantity)
  useEffect(() => {
    if (availableRecipes.length === 1) {
      setSelectedRecipe(availableRecipes[0]);
    }
  }, [availableRecipes]);

  const handleCraft = (recipe: CraftingRecipe, qty: number) => {
    if (world.network?.send) {
      world.network.send("processingCrafting", {
        recipeId: recipe.output,
        quantity: qty,
      });
    }
    onClose();
  };

  const handleCustomQuantitySubmit = () => {
    const qty = customQuantity.trim()
      ? parseInt(customQuantity, 10)
      : lastCustomQuantity;

    if (qty > 0 && selectedRecipe) {
      if (customQuantity.trim()) {
        try {
          localStorage.setItem(CRAFTING_LAST_X_KEY, String(qty));
          setLastCustomQuantity(qty);
        } catch {
          // localStorage may be unavailable
        }
      }
      handleCraft(selectedRecipe, qty);
    }
    setShowQuantityInput(false);
    setCustomQuantity("");
  };

  return (
    <div
      className="rounded-lg shadow-2xl border"
      style={{
        background: `linear-gradient(135deg, ${theme.colors.background.panelSecondary} 0%, ${theme.colors.background.panelPrimary} 100%)`,
        borderColor: theme.colors.border.decorative,
        minWidth: "380px",
        maxWidth: "480px",
        maxHeight: "80vh",
      }}
    >
      {/* Content */}
      <div
        className="p-3 overflow-y-auto"
        style={{ maxHeight: "calc(80vh - 100px)" }}
      >
        {availableRecipes.length === 0 ? (
          <div
            className="text-center py-4 text-sm"
            style={{ color: theme.colors.text.secondary }}
          >
            You don&apos;t have the materials to craft anything.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {groupedRecipes.map(([category, recipes]) => (
              <div key={category}>
                {/* Category Header */}
                <div
                  className="text-xs font-semibold uppercase tracking-wider mb-1.5 px-1"
                  style={{ color: theme.colors.text.muted }}
                >
                  {CATEGORY_LABELS[category] || category}
                </div>

                {/* Recipe Grid */}
                <div className="grid grid-cols-2 gap-1">
                  {recipes.map((recipe) => {
                    const canCraft = recipe.meetsLevel && recipe.hasInputs;
                    return (
                      <button
                        key={recipe.output}
                        onClick={() => setSelectedRecipe(recipe)}
                        className={`flex items-center gap-2 p-2 rounded border transition-all text-left ${
                          selectedRecipe?.output === recipe.output
                            ? "ring-2 ring-yellow-500"
                            : ""
                        }`}
                        style={{
                          background:
                            selectedRecipe?.output === recipe.output
                              ? `${theme.colors.accent.primary}15`
                              : theme.colors.background.tertiary,
                          borderColor:
                            selectedRecipe?.output === recipe.output
                              ? `${theme.colors.accent.primary}50`
                              : theme.colors.border.default,
                          opacity: canCraft ? 1 : 0.5,
                        }}
                      >
                        {/* Item Icon */}
                        <span className="text-lg">
                          {getItemIcon(recipe.output, recipe.category)}
                        </span>

                        {/* Item Info */}
                        <div className="flex-1 min-w-0">
                          <div
                            className="font-medium text-xs truncate"
                            style={{
                              color: recipe.meetsLevel
                                ? theme.colors.accent.primary
                                : theme.colors.state.danger,
                            }}
                          >
                            {recipe.name || formatItemName(recipe.output)}
                          </div>
                          <div
                            className="text-[9px] flex items-center gap-1"
                            style={{ color: theme.colors.text.muted }}
                          >
                            <span>Lv{recipe.level}</span>
                            <span className="mx-0.5">|</span>
                            <span>{recipe.xp} XP</span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            {/* Selected Recipe Details & Quantity */}
            {selectedRecipe && (
              <div
                className="mt-2 pt-3"
                style={{
                  borderTop: `1px solid ${theme.colors.border.default}`,
                }}
              >
                {/* Recipe Details */}
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-2xl">
                    {getItemIcon(
                      selectedRecipe.output,
                      selectedRecipe.category,
                    )}
                  </span>
                  <div>
                    <div
                      className="font-semibold text-sm"
                      style={{ color: theme.colors.accent.primary }}
                    >
                      {selectedRecipe.name ||
                        formatItemName(selectedRecipe.output)}
                    </div>
                    <div
                      className="text-xs"
                      style={{ color: theme.colors.text.secondary }}
                    >
                      {selectedRecipe.inputs
                        .map(
                          (inp) => `${inp.amount}× ${formatItemName(inp.item)}`,
                        )
                        .join(", ")}{" "}
                      | {selectedRecipe.xp} XP
                    </div>
                    {!selectedRecipe.meetsLevel && (
                      <div
                        className="text-[10px]"
                        style={{ color: theme.colors.state.danger }}
                      >
                        Requires Crafting level {selectedRecipe.level}
                      </div>
                    )}
                  </div>
                </div>

                {/* Quantity Selection */}
                <div
                  className="text-xs mb-2"
                  style={{ color: theme.colors.text.secondary }}
                >
                  How many?
                </div>

                {showQuantityInput ? (
                  <div className="flex gap-2">
                    <input
                      type="number"
                      value={customQuantity}
                      onChange={(e) => setCustomQuantity(e.target.value)}
                      className="flex-1 px-2 py-1 rounded text-sm"
                      style={{
                        background: theme.colors.background.panelSecondary,
                        border: `1px solid ${theme.colors.border.default}`,
                        color: theme.colors.accent.primary,
                      }}
                      placeholder={`Amount (last: ${lastCustomQuantity})`}
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleCustomQuantitySubmit();
                        if (e.key === "Escape") setShowQuantityInput(false);
                      }}
                    />
                    <button
                      onClick={handleCustomQuantitySubmit}
                      className="px-3 py-1 rounded text-sm font-medium transition-colors"
                      style={{
                        background: `${theme.colors.state.success}30`,
                        border: `1px solid ${theme.colors.state.success}50`,
                        color: theme.colors.state.success,
                      }}
                    >
                      OK
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-1">
                    {[1, 5, 10].map((qty) => (
                      <button
                        key={qty}
                        onClick={() => handleCraft(selectedRecipe, qty)}
                        className="flex-1 px-2 py-1.5 rounded text-xs font-medium transition-colors hover:brightness-110"
                        style={{
                          background: `${theme.colors.accent.primary}20`,
                          border: `1px solid ${theme.colors.accent.primary}30`,
                          color: theme.colors.accent.primary,
                        }}
                      >
                        {qty}
                      </button>
                    ))}
                    <button
                      onClick={() => handleCraft(selectedRecipe, -1)}
                      className="flex-1 px-2 py-1.5 rounded text-xs font-medium transition-colors hover:brightness-110"
                      style={{
                        background: `${theme.colors.accent.primary}20`,
                        border: `1px solid ${theme.colors.accent.primary}30`,
                        color: theme.colors.accent.primary,
                      }}
                    >
                      All
                    </button>
                    <button
                      onClick={() => setShowQuantityInput(true)}
                      className="flex-1 px-2 py-1.5 rounded text-xs font-medium transition-colors hover:brightness-110"
                      style={{
                        background: `${theme.colors.accent.primary}20`,
                        border: `1px solid ${theme.colors.accent.primary}30`,
                        color: theme.colors.accent.primary,
                      }}
                    >
                      X
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
