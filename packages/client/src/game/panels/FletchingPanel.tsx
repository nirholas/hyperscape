/**
 * FletchingPanel - OSRS-style fletching interface
 *
 * Features:
 * - Shows available items to fletch based on player's materials
 * - Groups recipes by category (arrow_shafts, shortbows, longbows, stringing, arrows)
 * - Displays output quantity for multi-output recipes (e.g., "Arrow shafts (x15)")
 * - Allows quantity selection (1, 5, 10, All, X)
 * - Auto-selects when only one recipe is available
 * - Sends fletching request to server
 */

import React, { useState, useMemo, useEffect } from "react";
import type { ClientWorld } from "../../types";
import { useThemeStore } from "@/ui";
import { formatItemName } from "@/utils";

interface FletchingRecipe {
  recipeId: string;
  output: string;
  name: string;
  category: string;
  outputQuantity: number;
  inputs: Array<{ item: string; amount: number }>;
  tools: string[];
  level: number;
  xp: number;
  meetsLevel: boolean;
  hasInputs: boolean;
}

interface FletchingPanelProps {
  availableRecipes: FletchingRecipe[];
  world: ClientWorld;
  onClose: () => void;
}

/**
 * Get icon for fletching item type
 */
function getItemIcon(output: string, category: string): string {
  const id = output.toLowerCase();

  if (category === "arrow_shafts" || id.includes("arrow_shaft")) return "🪵";
  if (category === "shortbows" || id.includes("shortbow")) return "🏹";
  if (category === "longbows" || id.includes("longbow")) return "🎯";
  if (category === "stringing") return "🧵";
  if (category === "arrows" || id.includes("arrow")) return "➳";

  return "🪓";
}

/**
 * Category display order and labels
 */
const CATEGORY_ORDER = [
  "arrow_shafts",
  "shortbows",
  "longbows",
  "stringing",
  "arrows",
];
const CATEGORY_LABELS: Record<string, string> = {
  arrow_shafts: "Arrow Shafts",
  shortbows: "Shortbows",
  longbows: "Longbows",
  stringing: "Stringing",
  arrows: "Arrows",
};

/** localStorage key for Make X memory */
const FLETCHING_LAST_X_KEY = "fletching_last_x";

export function FletchingPanel({
  availableRecipes,
  world,
  onClose,
}: FletchingPanelProps) {
  const theme = useThemeStore((s) => s.theme);
  const [selectedRecipe, setSelectedRecipe] = useState<FletchingRecipe | null>(
    null,
  );
  const [showQuantityInput, setShowQuantityInput] = useState(false);
  const [customQuantity, setCustomQuantity] = useState("");

  // Make X memory - remember last custom quantity (OSRS feature)
  const [lastCustomQuantity, setLastCustomQuantity] = useState(() => {
    try {
      const stored = localStorage.getItem(FLETCHING_LAST_X_KEY);
      return stored ? parseInt(stored, 10) || 10 : 10;
    } catch {
      return 10;
    }
  });

  // Group recipes by category
  const groupedRecipes = useMemo(() => {
    const groups: Record<string, FletchingRecipe[]> = {};

    for (const recipe of availableRecipes) {
      const category = recipe.category || "misc";
      if (!groups[category]) {
        groups[category] = [];
      }
      groups[category].push(recipe);
    }

    // Sort by category order
    const sorted: Array<[string, FletchingRecipe[]]> = [];
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

  // Auto-select when only one recipe (e.g., stringing a specific bow)
  useEffect(() => {
    if (availableRecipes.length === 1) {
      setSelectedRecipe(availableRecipes[0]);
    }
  }, [availableRecipes]);

  const handleFletch = (recipe: FletchingRecipe, qty: number) => {
    if (world.network?.send) {
      world.network.send("processingFletching", {
        recipeId: recipe.recipeId,
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
          localStorage.setItem(FLETCHING_LAST_X_KEY, String(qty));
          setLastCustomQuantity(qty);
        } catch {
          // localStorage may be unavailable
        }
      }
      handleFletch(selectedRecipe, qty);
    }
    setShowQuantityInput(false);
    setCustomQuantity("");
  };

  /**
   * Format recipe display name, appending output quantity for multi-output recipes
   */
  const getDisplayName = (recipe: FletchingRecipe): string => {
    const name = recipe.name || formatItemName(recipe.output);
    if (recipe.outputQuantity > 1) {
      return `${name} (x${recipe.outputQuantity})`;
    }
    return name;
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
            You don&apos;t have the materials to fletch anything.
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
                    const canFletch = recipe.meetsLevel && recipe.hasInputs;
                    return (
                      <button
                        key={recipe.recipeId}
                        onClick={() => setSelectedRecipe(recipe)}
                        className={`flex items-center gap-2 p-2 rounded border transition-all text-left ${
                          selectedRecipe?.recipeId === recipe.recipeId
                            ? "ring-2 ring-yellow-500"
                            : ""
                        }`}
                        style={{
                          background:
                            selectedRecipe?.recipeId === recipe.recipeId
                              ? `${theme.colors.accent.primary}15`
                              : theme.colors.background.tertiary,
                          borderColor:
                            selectedRecipe?.recipeId === recipe.recipeId
                              ? `${theme.colors.accent.primary}50`
                              : theme.colors.border.default,
                          opacity: canFletch ? 1 : 0.5,
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
                            {getDisplayName(recipe)}
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
                      {getDisplayName(selectedRecipe)}
                    </div>
                    <div
                      className="text-xs"
                      style={{ color: theme.colors.text.secondary }}
                    >
                      {selectedRecipe.inputs
                        .map(
                          (inp) => `${inp.amount}x ${formatItemName(inp.item)}`,
                        )
                        .join(", ")}{" "}
                      | {selectedRecipe.xp} XP
                    </div>
                    {!selectedRecipe.meetsLevel && (
                      <div
                        className="text-[10px]"
                        style={{ color: theme.colors.state.danger }}
                      >
                        Requires Fletching level {selectedRecipe.level}
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
                        onClick={() => handleFletch(selectedRecipe, qty)}
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
                      onClick={() => handleFletch(selectedRecipe, -1)}
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
