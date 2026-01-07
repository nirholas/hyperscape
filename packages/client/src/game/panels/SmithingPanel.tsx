/**
 * SmithingPanel - OSRS-style smithing interface
 *
 * Features:
 * - Shows available items to smith based on player's bars
 * - Displays level requirements, bar requirements, XP
 * - Groups items by category (weapons, armor, etc.)
 * - Allows quantity selection (1, 5, 10, All, X)
 * - Sends smithing request to server
 */

import React, { useState, useMemo } from "react";
import type { ClientWorld } from "../../types";
import { COLORS } from "../../constants";

interface SmithingRecipe {
  itemId: string;
  name: string;
  barType: string;
  barsRequired: number;
  levelRequired: number;
  xp: number;
  category: string;
}

interface SmithingPanelProps {
  anvilId: string;
  availableRecipes: SmithingRecipe[];
  world: ClientWorld;
  onClose: () => void;
}

/**
 * Get icon for item type
 */
function getItemIcon(itemId: string, category: string): string {
  const id = itemId.toLowerCase();

  // Weapons
  if (category === "weapons" || id.includes("sword") || id.includes("scimitar"))
    return "⚔️";
  if (id.includes("dagger")) return "🗡️";
  if (id.includes("mace")) return "🔨";
  if (id.includes("axe") && !id.includes("pickaxe")) return "🪓";
  if (id.includes("warhammer")) return "⚒️";

  // Armor
  if (
    category === "armor" ||
    id.includes("platebody") ||
    id.includes("chainbody")
  )
    return "🛡️";
  if (id.includes("helmet") || id.includes("helm") || id.includes("full_helm"))
    return "⛑️";
  if (id.includes("platelegs") || id.includes("plateskirt")) return "👖";
  if (
    id.includes("shield") ||
    id.includes("sq_shield") ||
    id.includes("kiteshield")
  )
    return "🛡️";
  if (id.includes("boots")) return "👢";
  if (id.includes("gauntlets") || id.includes("gloves")) return "🧤";

  // Tools
  if (id.includes("pickaxe")) return "⛏️";
  if (id.includes("hatchet")) return "🪓";

  // Misc
  if (id.includes("nails")) return "📍";
  if (id.includes("bar")) return "🔶";
  if (id.includes("arrowtips") || id.includes("dart")) return "➤";
  if (id.includes("knife")) return "🔪";

  return "🔨";
}

/**
 * Get bar type icon
 */
function getBarIcon(barType: string): string {
  const type = barType.toLowerCase();
  if (type.includes("bronze")) return "🟤";
  if (type.includes("iron")) return "⚫";
  if (type.includes("steel")) return "⚪";
  if (type.includes("mithril")) return "🔵";
  if (type.includes("adamant")) return "🟢";
  if (type.includes("rune") || type.includes("runite")) return "🔷";
  return "🔶";
}

/**
 * Format item name from itemId
 */
function formatItemName(itemId: string): string {
  return itemId.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
}

/**
 * Category order for display
 */
const CATEGORY_ORDER = ["weapons", "armor", "tools", "misc"];

export function SmithingPanel({
  anvilId,
  availableRecipes,
  world,
  onClose,
}: SmithingPanelProps) {
  const [selectedRecipe, setSelectedRecipe] = useState<SmithingRecipe | null>(
    null,
  );
  const [showQuantityInput, setShowQuantityInput] = useState(false);
  const [customQuantity, setCustomQuantity] = useState("");

  // Group recipes by category
  const groupedRecipes = useMemo(() => {
    const groups: Record<string, SmithingRecipe[]> = {};

    for (const recipe of availableRecipes) {
      const category = recipe.category || "misc";
      if (!groups[category]) {
        groups[category] = [];
      }
      groups[category].push(recipe);
    }

    // Sort by category order
    const sorted: Array<[string, SmithingRecipe[]]> = [];
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

  const handleSmith = (recipe: SmithingRecipe, qty: number) => {
    if (world.network?.send) {
      world.network.send("processingSmithing", {
        recipeId: recipe.itemId,
        anvilId,
        quantity: qty,
      });
    }
    onClose();
  };

  const handleCustomQuantitySubmit = () => {
    const qty = parseInt(customQuantity, 10);
    if (qty > 0 && selectedRecipe) {
      handleSmith(selectedRecipe, qty);
    }
    setShowQuantityInput(false);
    setCustomQuantity("");
  };

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-[2000] pointer-events-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="rounded-lg shadow-2xl border"
        style={{
          background:
            "linear-gradient(135deg, rgba(20, 15, 10, 0.98) 0%, rgba(15, 10, 5, 0.98) 100%)",
          borderColor: "rgba(139, 69, 19, 0.7)",
          minWidth: "380px",
          maxWidth: "480px",
          maxHeight: "80vh",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-3 py-2 border-b"
          style={{
            background:
              "linear-gradient(to bottom, rgba(139, 69, 19, 0.3), rgba(100, 50, 20, 0.2))",
            borderColor: "rgba(139, 69, 19, 0.5)",
          }}
        >
          <div className="flex items-center gap-2">
            <span className="text-lg">🔨</span>
            <span
              className="font-semibold text-sm"
              style={{ color: COLORS.ACCENT }}
            >
              Smithing
            </span>
          </div>
          <button
            onClick={onClose}
            className="w-6 h-6 flex items-center justify-center rounded hover:bg-red-900/50 transition-colors"
            style={{ color: COLORS.ACCENT }}
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div
          className="p-3 overflow-y-auto"
          style={{ maxHeight: "calc(80vh - 100px)" }}
        >
          {availableRecipes.length === 0 ? (
            <div
              className="text-center py-4 text-sm"
              style={{ color: "rgba(242, 208, 138, 0.7)" }}
            >
              You don't have the bars to smith anything.
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {groupedRecipes.map(([category, recipes]) => (
                <div key={category}>
                  {/* Category Header */}
                  <div
                    className="text-xs font-semibold uppercase tracking-wider mb-1.5 px-1"
                    style={{ color: "rgba(242, 208, 138, 0.6)" }}
                  >
                    {category}
                  </div>

                  {/* Recipe Grid */}
                  <div className="grid grid-cols-2 gap-1">
                    {recipes.map((recipe) => (
                      <button
                        key={recipe.itemId}
                        onClick={() => setSelectedRecipe(recipe)}
                        className={`flex items-center gap-2 p-2 rounded border transition-all text-left ${
                          selectedRecipe?.itemId === recipe.itemId
                            ? "ring-2 ring-yellow-500"
                            : ""
                        }`}
                        style={{
                          background:
                            selectedRecipe?.itemId === recipe.itemId
                              ? "rgba(242, 208, 138, 0.15)"
                              : "rgba(0, 0, 0, 0.3)",
                          borderColor:
                            selectedRecipe?.itemId === recipe.itemId
                              ? "rgba(242, 208, 138, 0.5)"
                              : "rgba(139, 69, 19, 0.3)",
                        }}
                      >
                        {/* Item Icon */}
                        <span className="text-lg">
                          {getItemIcon(recipe.itemId, recipe.category)}
                        </span>

                        {/* Item Info */}
                        <div className="flex-1 min-w-0">
                          <div
                            className="font-medium text-xs truncate"
                            style={{ color: COLORS.ACCENT }}
                          >
                            {recipe.name || formatItemName(recipe.itemId)}
                          </div>
                          <div
                            className="text-[9px] flex items-center gap-1"
                            style={{ color: "rgba(242, 208, 138, 0.5)" }}
                          >
                            <span>{getBarIcon(recipe.barType)}</span>
                            <span>×{recipe.barsRequired}</span>
                            <span className="mx-0.5">|</span>
                            <span>Lv{recipe.levelRequired}</span>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ))}

              {/* Selected Recipe Details & Quantity */}
              {selectedRecipe && (
                <div className="mt-2 pt-3 border-t border-[rgba(139,69,19,0.3)]">
                  {/* Recipe Details */}
                  <div className="flex items-center gap-3 mb-3">
                    <span className="text-2xl">
                      {getItemIcon(
                        selectedRecipe.itemId,
                        selectedRecipe.category,
                      )}
                    </span>
                    <div>
                      <div
                        className="font-semibold text-sm"
                        style={{ color: COLORS.ACCENT }}
                      >
                        {selectedRecipe.name ||
                          formatItemName(selectedRecipe.itemId)}
                      </div>
                      <div
                        className="text-xs"
                        style={{ color: "rgba(242, 208, 138, 0.7)" }}
                      >
                        {selectedRecipe.barsRequired}×{" "}
                        {formatItemName(selectedRecipe.barType)} |{" "}
                        {selectedRecipe.xp} XP
                      </div>
                    </div>
                  </div>

                  {/* Quantity Selection */}
                  <div
                    className="text-xs mb-2"
                    style={{ color: "rgba(242, 208, 138, 0.8)" }}
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
                          background: "rgba(0, 0, 0, 0.5)",
                          border: "1px solid rgba(139, 69, 19, 0.5)",
                          color: COLORS.ACCENT,
                        }}
                        placeholder="Amount"
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
                          background: "rgba(34, 197, 94, 0.3)",
                          border: "1px solid rgba(34, 197, 94, 0.5)",
                          color: "#22c55e",
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
                          onClick={() => handleSmith(selectedRecipe, qty)}
                          className="flex-1 px-2 py-1.5 rounded text-xs font-medium transition-colors hover:brightness-110"
                          style={{
                            background: "rgba(242, 208, 138, 0.2)",
                            border: "1px solid rgba(242, 208, 138, 0.3)",
                            color: COLORS.ACCENT,
                          }}
                        >
                          {qty}
                        </button>
                      ))}
                      <button
                        onClick={() => handleSmith(selectedRecipe, 28)}
                        className="flex-1 px-2 py-1.5 rounded text-xs font-medium transition-colors hover:brightness-110"
                        style={{
                          background: "rgba(242, 208, 138, 0.2)",
                          border: "1px solid rgba(242, 208, 138, 0.3)",
                          color: COLORS.ACCENT,
                        }}
                      >
                        All
                      </button>
                      <button
                        onClick={() => setShowQuantityInput(true)}
                        className="flex-1 px-2 py-1.5 rounded text-xs font-medium transition-colors hover:brightness-110"
                        style={{
                          background: "rgba(242, 208, 138, 0.2)",
                          border: "1px solid rgba(242, 208, 138, 0.3)",
                          color: COLORS.ACCENT,
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
    </div>
  );
}
