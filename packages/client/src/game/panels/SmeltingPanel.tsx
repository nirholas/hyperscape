/**
 * SmeltingPanel - OSRS-style smelting interface
 *
 * Features:
 * - Shows available bars to smelt based on player's inventory
 * - Displays level requirements, ore requirements
 * - Allows quantity selection (1, 5, 10, All, X)
 * - Sends smelting request to server
 */

import React, { useState } from "react";
import type { ClientWorld } from "../../types";
import { useThemeStore } from "hs-kit";

interface SmeltingBar {
  barItemId: string;
  levelRequired: number;
  primaryOre: string;
  secondaryOre: string | null;
  coalRequired: number;
}

interface SmeltingPanelProps {
  furnaceId: string;
  availableBars: SmeltingBar[];
  world: ClientWorld;
  onClose: () => void;
}

/**
 * Format item name from itemId
 */
function formatItemName(itemId: string): string {
  return itemId.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
}

/**
 * Get icon for bar/ore type
 */
function getItemIcon(itemId: string): string {
  const id = itemId.toLowerCase();
  if (id.includes("bronze")) return "🟤";
  if (id.includes("iron")) return "⚫";
  if (id.includes("steel")) return "⚪";
  if (id.includes("mithril")) return "🔵";
  if (id.includes("adamant")) return "🟢";
  if (id.includes("rune") || id.includes("runite")) return "🔷";
  if (id.includes("gold")) return "🟡";
  if (id.includes("silver")) return "⚪";
  if (id.includes("coal")) return "⬛";
  if (id.includes("ore")) return "🪨";
  return "🔶";
}

/** localStorage key for Make X memory */
const SMELTING_LAST_X_KEY = "smelting_last_x";

export function SmeltingPanel({
  furnaceId,
  availableBars,
  world,
  onClose,
}: SmeltingPanelProps) {
  const theme = useThemeStore((s) => s.theme);
  const [selectedBar, setSelectedBar] = useState<SmeltingBar | null>(null);
  const [showQuantityInput, setShowQuantityInput] = useState(false);
  const [customQuantity, setCustomQuantity] = useState("");

  // Make X memory - remember last custom quantity (OSRS feature)
  const [lastCustomQuantity, setLastCustomQuantity] = useState(() => {
    try {
      const stored = localStorage.getItem(SMELTING_LAST_X_KEY);
      return stored ? parseInt(stored, 10) || 10 : 10;
    } catch {
      return 10;
    }
  });

  const handleSmelt = (bar: SmeltingBar, qty: number) => {
    if (world.network?.send) {
      world.network.send("processingSmelting", {
        barItemId: bar.barItemId,
        furnaceId,
        quantity: qty,
      });
    }
    onClose();
  };

  const handleCustomQuantitySubmit = () => {
    // Use entered quantity, or fall back to last X if empty (OSRS behavior)
    const qty = customQuantity.trim()
      ? parseInt(customQuantity, 10)
      : lastCustomQuantity;

    if (qty > 0 && selectedBar) {
      // Save to localStorage for Make X memory (only if custom value entered)
      if (customQuantity.trim()) {
        try {
          localStorage.setItem(SMELTING_LAST_X_KEY, String(qty));
          setLastCustomQuantity(qty);
        } catch {
          // localStorage may be unavailable
        }
      }
      handleSmelt(selectedBar, qty);
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
          background: `linear-gradient(135deg, ${theme.colors.background.secondary} 0%, ${theme.colors.background.primary} 100%)`,
          borderColor: theme.colors.border.decorative,
          minWidth: "320px",
          maxWidth: "400px",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-3 py-2 border-b"
          style={{
            background: `linear-gradient(to bottom, ${theme.colors.border.decorative}30, ${theme.colors.border.decorative}20)`,
            borderColor: theme.colors.border.decorative,
          }}
        >
          <div className="flex items-center gap-2">
            <span className="text-lg">🔥</span>
            <span
              className="font-semibold text-sm"
              style={{ color: theme.colors.accent.primary }}
            >
              Smelting
            </span>
          </div>
          <button
            onClick={onClose}
            className="w-6 h-6 flex items-center justify-center rounded hover:bg-red-900/50 transition-colors"
            style={{ color: theme.colors.accent.primary }}
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div className="p-3">
          {availableBars.length === 0 ? (
            <div
              className="text-center py-4 text-sm"
              style={{ color: theme.colors.text.secondary }}
            >
              You don't have the materials to smelt anything.
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <div
                className="text-xs mb-1"
                style={{ color: theme.colors.text.secondary }}
              >
                Select a bar to smelt:
              </div>

              {/* Bar List */}
              <div className="flex flex-col gap-1 max-h-60 overflow-y-auto">
                {availableBars.map((bar) => (
                  <button
                    key={bar.barItemId}
                    onClick={() => setSelectedBar(bar)}
                    className={`flex items-center gap-2 p-2 rounded border transition-all ${
                      selectedBar?.barItemId === bar.barItemId
                        ? "ring-2 ring-yellow-500"
                        : ""
                    }`}
                    style={{
                      background:
                        selectedBar?.barItemId === bar.barItemId
                          ? `${theme.colors.accent.primary}15`
                          : theme.colors.background.tertiary,
                      borderColor:
                        selectedBar?.barItemId === bar.barItemId
                          ? `${theme.colors.accent.primary}50`
                          : theme.colors.border.default,
                    }}
                  >
                    {/* Bar Icon */}
                    <span className="text-xl">
                      {getItemIcon(bar.barItemId)}
                    </span>

                    {/* Bar Info */}
                    <div className="flex-1 text-left">
                      <div
                        className="font-medium text-sm"
                        style={{ color: theme.colors.accent.primary }}
                      >
                        {formatItemName(bar.barItemId)}
                      </div>
                      <div
                        className="text-[10px]"
                        style={{ color: theme.colors.text.muted }}
                      >
                        {formatItemName(bar.primaryOre)}
                        {bar.secondaryOre &&
                          ` + ${formatItemName(bar.secondaryOre)}`}
                        {bar.coalRequired > 0 && ` + ${bar.coalRequired} Coal`}
                      </div>
                    </div>

                    {/* Level Requirement */}
                    <div
                      className="text-xs px-2 py-1 rounded"
                      style={{
                        background: theme.colors.background.tertiary,
                        color: theme.colors.text.secondary,
                      }}
                    >
                      Lv {bar.levelRequired}
                    </div>
                  </button>
                ))}
              </div>

              {/* Quantity Selection */}
              {selectedBar && (
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
                          background: theme.colors.background.tertiary,
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
                          onClick={() => handleSmelt(selectedBar, qty)}
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
                        onClick={() => handleSmelt(selectedBar, 28)}
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
    </div>
  );
}
