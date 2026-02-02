/**
 * TanningPanel - OSRS-style tanning interface
 *
 * Features:
 * - Shows available hides to tan based on player's inventory
 * - Displays cost per hide and available quantity
 * - Allows quantity selection (1, 5, 10, All, X)
 * - Sends tanning request to server
 */

import React, { useState } from "react";
import type { ClientWorld } from "../../types";
import { useThemeStore } from "@/ui";
import { formatItemName } from "@/utils";

interface TanningRecipe {
  input: string;
  output: string;
  cost: number;
  name: string;
  hasHide: boolean;
  hideCount: number;
}

interface TanningPanelProps {
  availableRecipes: TanningRecipe[];
  world: ClientWorld;
  onClose: () => void;
}

/**
 * Get icon for tanning item
 */
function getHideIcon(input: string): string {
  const id = input.toLowerCase();
  if (id.includes("dragon")) return "🐉";
  if (id.includes("cowhide")) return "🐄";
  return "🧶";
}

/** localStorage key for Make X memory */
const TANNING_LAST_X_KEY = "tanning_last_x";

export function TanningPanel({
  availableRecipes,
  world,
  onClose,
}: TanningPanelProps) {
  const theme = useThemeStore((s) => s.theme);
  const [selectedRecipe, setSelectedRecipe] = useState<TanningRecipe | null>(
    null,
  );
  const [showQuantityInput, setShowQuantityInput] = useState(false);
  const [customQuantity, setCustomQuantity] = useState("");

  // Make X memory - remember last custom quantity (OSRS feature)
  const [lastCustomQuantity, setLastCustomQuantity] = useState(() => {
    try {
      const stored = localStorage.getItem(TANNING_LAST_X_KEY);
      return stored ? parseInt(stored, 10) || 10 : 10;
    } catch {
      return 10;
    }
  });

  const handleTan = (recipe: TanningRecipe, qty: number) => {
    if (world.network?.send) {
      world.network.send("processingTanning", {
        inputItemId: recipe.input,
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
          localStorage.setItem(TANNING_LAST_X_KEY, String(qty));
          setLastCustomQuantity(qty);
        } catch {
          // localStorage may be unavailable
        }
      }
      handleTan(selectedRecipe, qty);
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
        minWidth: "320px",
        maxWidth: "400px",
      }}
    >
      {/* Content */}
      <div className="p-3">
        {availableRecipes.length === 0 ? (
          <div
            className="text-center py-4 text-sm"
            style={{ color: theme.colors.text.secondary }}
          >
            No hides available for tanning.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div
              className="text-xs mb-1"
              style={{ color: theme.colors.text.secondary }}
            >
              Select a hide to tan:
            </div>

            {/* Recipe List */}
            <div className="flex flex-col gap-1 max-h-60 overflow-y-auto">
              {availableRecipes.map((recipe) => (
                <button
                  key={recipe.input}
                  onClick={() => setSelectedRecipe(recipe)}
                  className={`flex items-center gap-2 p-2 rounded border transition-all ${
                    selectedRecipe?.input === recipe.input
                      ? "ring-2 ring-yellow-500"
                      : ""
                  }`}
                  style={{
                    background:
                      selectedRecipe?.input === recipe.input
                        ? `${theme.colors.accent.primary}15`
                        : theme.colors.background.tertiary,
                    borderColor:
                      selectedRecipe?.input === recipe.input
                        ? `${theme.colors.accent.primary}50`
                        : theme.colors.border.default,
                    opacity: recipe.hasHide ? 1 : 0.5,
                  }}
                >
                  {/* Hide Icon */}
                  <span className="text-xl">{getHideIcon(recipe.input)}</span>

                  {/* Recipe Info */}
                  <div className="flex-1 text-left">
                    <div
                      className="font-medium text-sm"
                      style={{ color: theme.colors.accent.primary }}
                    >
                      {recipe.name || formatItemName(recipe.output)}
                    </div>
                    <div
                      className="text-[10px]"
                      style={{ color: theme.colors.text.muted }}
                    >
                      {formatItemName(recipe.input)}
                      {recipe.hideCount > 0 &&
                        ` (${recipe.hideCount} in inventory)`}
                    </div>
                  </div>

                  {/* Cost */}
                  <div
                    className="text-xs px-2 py-1 rounded"
                    style={{
                      background: theme.colors.background.panelSecondary,
                      color: theme.colors.text.secondary,
                    }}
                  >
                    {recipe.cost} gp
                  </div>
                </button>
              ))}
            </div>

            {/* Quantity Selection */}
            {selectedRecipe && (
              <div
                className="mt-2 pt-2"
                style={{
                  borderTop: `1px solid ${theme.colors.border.default}`,
                }}
              >
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
                        onClick={() => handleTan(selectedRecipe, qty)}
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
                      onClick={() => handleTan(selectedRecipe, -1)}
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
