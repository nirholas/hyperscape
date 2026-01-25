/**
 * RightPanel Component
 *
 * Right-side panel containing inventory grid and equipment paperdoll views.
 * RS3-style tab switcher between backpack and worn equipment.
 */

import React, { useCallback } from "react";
import { useThemeStore, useMobileLayout } from "hs-kit";
import type { PlayerEquipmentItems } from "@hyperscape/shared";
import { INV_SLOTS_PER_ROW, INV_SLOT_SIZE } from "../constants";
import { getItemIcon, formatItemName } from "../utils";
import type { InventorySlotViewItem, RightPanelMode } from "../types";
import { InventoryPanel } from "../../InventoryPanel";

export interface RightPanelProps {
  mode: RightPanelMode;
  onChangeMode: (mode: RightPanelMode) => void;

  // Inventory data
  inventory: InventorySlotViewItem[];
  coins: number;

  // Equipment data
  equipment?: PlayerEquipmentItems | null;

  // Inventory actions
  onDeposit: (itemId: string, quantity: number) => void;
  onDepositAll: () => void;
  onOpenCoinModal: (action: "deposit" | "withdraw") => void;
  onContextMenu: (
    e: React.MouseEvent,
    itemId: string,
    quantity: number,
    type: "bank" | "inventory",
    tabIndex?: number,
    slot?: number,
  ) => void;

  // Equipment actions
  onDepositEquipment: (slot: string) => void;
  onDepositAllEquipment: () => void;
}

export function RightPanel({
  mode,
  onChangeMode,
  inventory,
  coins,
  equipment,
  onDeposit,
  onDepositAll,
  onOpenCoinModal,
  onContextMenu,
  onDepositEquipment,
  onDepositAllEquipment,
}: RightPanelProps) {
  const theme = useThemeStore((s) => s.theme);
  const { shouldUseMobileUI } = useMobileLayout();

  // Responsive sizing
  const responsiveSlotSize = shouldUseMobileUI ? 34 : INV_SLOT_SIZE;

  /**
   * Render a single equipment slot for the paperdoll layout
   */
  const renderEquipmentSlot = useCallback(
    (key: string, label: string, icon: string) => {
      const item = equipment?.[key as keyof PlayerEquipmentItems] ?? null;
      const hasItem = !!item;

      return (
        <button
          key={key}
          onClick={() => hasItem && onDepositEquipment(key)}
          className="w-full h-full rounded transition-all duration-200 cursor-pointer group relative"
          style={{
            background: hasItem
              ? `linear-gradient(135deg, ${theme.colors.slot.filled} 0%, ${theme.colors.slot.empty} 100%)`
              : theme.colors.background.overlay,
            borderWidth: "2px",
            borderStyle: "solid",
            borderColor: hasItem
              ? theme.colors.border.hover
              : theme.colors.border.default,
            boxShadow: hasItem
              ? `0 2px 8px rgba(0, 0, 0, 0.6), inset 0 1px 0 ${theme.colors.border.default}1a`
              : "inset 0 2px 4px rgba(0, 0, 0, 0.3)",
          }}
          onMouseEnter={(e) => {
            if (hasItem) {
              e.currentTarget.style.borderColor = theme.colors.state.success;
              e.currentTarget.style.background = `linear-gradient(135deg, ${theme.colors.state.success}33 0%, ${theme.colors.state.success}1a 100%)`;
            }
          }}
          onMouseLeave={(e) => {
            if (hasItem) {
              e.currentTarget.style.borderColor = theme.colors.border.hover;
              e.currentTarget.style.background = `linear-gradient(135deg, ${theme.colors.slot.filled} 0%, ${theme.colors.slot.empty} 100%)`;
            }
          }}
          title={
            hasItem
              ? `${formatItemName(item.id)} - Click to deposit`
              : `${label} (empty)`
          }
        >
          {/* Slot Label */}
          <div
            className="absolute top-0.5 left-1 text-[8px] font-medium uppercase tracking-wider"
            style={{
              color: theme.colors.text.secondary,
              textShadow: "0 1px 2px rgba(0, 0, 0, 0.8)",
            }}
          >
            {label}
          </div>

          {/* Slot Content */}
          <div className="flex flex-col items-center justify-center h-full pt-2">
            {!hasItem ? (
              <span
                className="transition-transform duration-200 group-hover:scale-110"
                style={{
                  fontSize: "1.25rem",
                  filter: "grayscale(100%) opacity(0.3)",
                }}
              >
                {icon}
              </span>
            ) : (
              <>
                <span
                  className="transition-transform duration-200 group-hover:scale-110"
                  style={{
                    fontSize: "1.25rem",
                    filter: "drop-shadow(0 2px 4px rgba(0, 0, 0, 0.8))",
                  }}
                >
                  {getItemIcon(item.id)}
                </span>
                <div
                  className="text-center px-0.5 mt-0.5"
                  style={{
                    fontSize: "8px",
                    color: theme.colors.text.secondary,
                    lineHeight: "1.1",
                    maxWidth: "100%",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {formatItemName(item.id).slice(0, 10)}
                </div>
              </>
            )}
          </div>
        </button>
      );
    },
    [equipment, onDepositEquipment, theme],
  );

  return (
    <div
      className="flex flex-col rounded-lg"
      style={{
        background: theme.colors.background.primary,
        border: `2px solid ${theme.colors.border.decorative}`,
        boxShadow: `0 10px 30px rgba(0, 0, 0, 0.5), inset 0 1px 0 ${theme.colors.border.default}`,
        width: shouldUseMobileUI
          ? "100%"
          : `${INV_SLOTS_PER_ROW * (responsiveSlotSize + 4) + 24}px`,
        minWidth: shouldUseMobileUI ? undefined : "180px",
      }}
    >
      {/* RS3-style Tab Header with view switcher */}
      <div
        className="flex justify-between items-center px-2 py-1.5 rounded-t-lg"
        style={{
          background: `linear-gradient(180deg, ${theme.colors.border.decorative}66 0%, ${theme.colors.border.decorative}33 100%)`,
          borderBottom: `1px solid ${theme.colors.border.decorative}`,
        }}
      >
        {/* Tab Buttons */}
        <div className="flex gap-1">
          <button
            onClick={() => onChangeMode("inventory")}
            className="px-2 py-1 rounded text-xs font-bold transition-all"
            style={{
              background:
                mode === "inventory"
                  ? theme.colors.border.decorative
                  : theme.colors.background.overlay,
              color:
                mode === "inventory"
                  ? theme.colors.accent.primary
                  : theme.colors.text.muted,
              border:
                mode === "inventory"
                  ? `1px solid ${theme.colors.border.default}`
                  : "1px solid transparent",
            }}
            title="View Backpack"
          >
            🎒
          </button>
          <button
            onClick={() => onChangeMode("equipment")}
            className="px-2 py-1 rounded text-xs font-bold transition-all"
            style={{
              background:
                mode === "equipment"
                  ? theme.colors.border.decorative
                  : theme.colors.background.overlay,
              color:
                mode === "equipment"
                  ? theme.colors.accent.primary
                  : theme.colors.text.muted,
              border:
                mode === "equipment"
                  ? `1px solid ${theme.colors.border.default}`
                  : "1px solid transparent",
            }}
            title="View Worn Equipment"
          >
            ⚔️
          </button>
        </div>
        <span
          className="text-xs font-bold"
          style={{ color: theme.colors.accent.primary }}
        >
          {mode === "inventory" ? "Inventory" : "Equipment"}
        </span>
      </div>

      {/* Content Area - switches between inventory and equipment */}
      {mode === "inventory" ? (
        <>
          {/* Modern Inventory Panel in bank mode */}
          <div
            className="flex-1"
            style={{ minHeight: shouldUseMobileUI ? "200px" : "280px" }}
          >
            <InventoryPanel
              items={inventory}
              coins={coins}
              embeddedMode="bank"
              onEmbeddedClick={(item) => onDeposit(item.itemId, 1)}
              onEmbeddedContextMenu={(e, item) =>
                onContextMenu(e, item.itemId, item.quantity || 1, "inventory")
              }
              showCoinPouch={false}
              footerHint="Left: Deposit 1 | Right: Options"
            />
          </div>

          {/* Coin Pouch Section */}
          <div
            className="mx-2 mb-2 p-2 rounded flex items-center justify-between"
            style={{
              background: theme.colors.background.overlay,
              border: `1px solid ${theme.colors.border.decorative}`,
            }}
          >
            <div className="flex items-center gap-2">
              <span className="text-base">💰</span>
              <span
                className="text-sm font-bold"
                style={{ color: theme.colors.accent.primary }}
              >
                {coins.toLocaleString()}
              </span>
            </div>
            <button
              onClick={() => onOpenCoinModal("deposit")}
              disabled={coins <= 0}
              className="px-2 py-1 rounded text-xs font-bold transition-colors disabled:opacity-30"
              style={{
                background: `${theme.colors.state.success}99`,
                color: theme.colors.text.primary,
                border: `1px solid ${theme.colors.border.decorative}`,
              }}
              onMouseEnter={(e) => {
                if (coins > 0)
                  e.currentTarget.style.background = `${theme.colors.state.success}cc`;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = `${theme.colors.state.success}99`;
              }}
            >
              Deposit
            </button>
          </div>

          {/* Deposit All Button */}
          <div className="px-2 pb-2">
            <button
              onClick={onDepositAll}
              className="w-full py-2 rounded text-sm font-bold transition-colors"
              style={{
                background: `linear-gradient(180deg, ${theme.colors.border.decorative} 0%, ${theme.colors.border.decorative}80 100%)`,
                color: theme.colors.accent.primary,
                border: `1px solid ${theme.colors.border.decorative}`,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = `linear-gradient(180deg, ${theme.colors.border.decorative}e6 0%, ${theme.colors.border.decorative}b3 100%)`;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = `linear-gradient(180deg, ${theme.colors.border.decorative} 0%, ${theme.colors.border.decorative}80 100%)`;
              }}
            >
              Deposit Inventory
            </button>
          </div>
        </>
      ) : (
        <>
          {/* Equipment View - Paperdoll layout matching EquipmentPanel */}
          <div
            className="p-2 flex-1"
            style={{
              background: `linear-gradient(135deg, ${theme.colors.background.secondary} 0%, ${theme.colors.background.primary} 100%)`,
              borderRadius: "4px",
              margin: "4px",
            }}
          >
            {/* Paperdoll Grid: 3 columns x 3 rows (melee-only MVP) */}
            <div
              className="grid gap-1 h-full"
              style={{
                gridTemplateColumns: "repeat(3, 1fr)",
                gridTemplateRows: "repeat(3, 1fr)",
              }}
            >
              {/* Row 1: empty, helmet, empty */}
              <div />
              {renderEquipmentSlot("helmet", "Head", "⛑️")}
              <div />

              {/* Row 2: weapon, body, shield */}
              {renderEquipmentSlot("weapon", "Weapon", "⚔️")}
              {renderEquipmentSlot("body", "Body", "🎽")}
              {renderEquipmentSlot("shield", "Shield", "🛡️")}

              {/* Row 3: empty, legs, empty */}
              <div />
              {renderEquipmentSlot("legs", "Legs", "👖")}
              <div />
              {/* Row 4: Arrows slot hidden for melee-only MVP */}
            </div>
          </div>

          {/* Deposit All Equipment Button */}
          <div className="px-2 pb-2">
            <button
              onClick={onDepositAllEquipment}
              disabled={
                !equipment || Object.values(equipment).every((item) => !item)
              }
              className="w-full py-2 rounded text-sm font-bold transition-colors disabled:opacity-30"
              style={{
                background: `linear-gradient(180deg, ${theme.colors.border.decorative} 0%, ${theme.colors.border.decorative}80 100%)`,
                color: theme.colors.accent.primary,
                border: `1px solid ${theme.colors.border.decorative}`,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = `linear-gradient(180deg, ${theme.colors.border.decorative}e6 0%, ${theme.colors.border.decorative}b3 100%)`;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = `linear-gradient(180deg, ${theme.colors.border.decorative} 0%, ${theme.colors.border.decorative}80 100%)`;
              }}
            >
              Deposit Worn Items
            </button>
          </div>
        </>
      )}
    </div>
  );
}
