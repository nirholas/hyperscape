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
import { COLORS } from "../../constants";

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

export function SmeltingPanel({
  furnaceId,
  availableBars,
  world,
  onClose,
}: SmeltingPanelProps) {
  const [selectedBar, setSelectedBar] = useState<SmeltingBar | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [showQuantityInput, setShowQuantityInput] = useState(false);
  const [customQuantity, setCustomQuantity] = useState("");

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
    const qty = parseInt(customQuantity, 10);
    if (qty > 0 && selectedBar) {
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
          background:
            "linear-gradient(135deg, rgba(20, 15, 10, 0.98) 0%, rgba(15, 10, 5, 0.98) 100%)",
          borderColor: "rgba(139, 69, 19, 0.7)",
          minWidth: "320px",
          maxWidth: "400px",
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
            <span className="text-lg">🔥</span>
            <span
              className="font-semibold text-sm"
              style={{ color: COLORS.ACCENT }}
            >
              Smelting
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
        <div className="p-3">
          {availableBars.length === 0 ? (
            <div
              className="text-center py-4 text-sm"
              style={{ color: "rgba(242, 208, 138, 0.7)" }}
            >
              You don't have the materials to smelt anything.
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <div
                className="text-xs mb-1"
                style={{ color: "rgba(242, 208, 138, 0.8)" }}
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
                          ? "rgba(242, 208, 138, 0.15)"
                          : "rgba(0, 0, 0, 0.3)",
                      borderColor:
                        selectedBar?.barItemId === bar.barItemId
                          ? "rgba(242, 208, 138, 0.5)"
                          : "rgba(139, 69, 19, 0.3)",
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
                        style={{ color: COLORS.ACCENT }}
                      >
                        {formatItemName(bar.barItemId)}
                      </div>
                      <div
                        className="text-[10px]"
                        style={{ color: "rgba(242, 208, 138, 0.6)" }}
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
                        background: "rgba(0, 0, 0, 0.4)",
                        color: "rgba(242, 208, 138, 0.8)",
                      }}
                    >
                      Lv {bar.levelRequired}
                    </div>
                  </button>
                ))}
              </div>

              {/* Quantity Selection */}
              {selectedBar && (
                <div className="mt-2 pt-2 border-t border-[rgba(139,69,19,0.3)]">
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
                          onClick={() => handleSmelt(selectedBar, qty)}
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
                        onClick={() => handleSmelt(selectedBar, 28)}
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
