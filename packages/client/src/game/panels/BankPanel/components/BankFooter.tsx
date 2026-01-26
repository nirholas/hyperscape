/**
 * BankFooter Component
 *
 * Status bar with slot count, Item/Note toggle, and placeholder controls.
 * RS3-style bank footer displaying stats and quick-access toggles.
 */

import { useThemeStore } from "@/ui";
import { TAB_INDEX_ALL } from "../constants";
import type { BankItem } from "../types";

export interface BankFooterProps {
  items: BankItem[];
  filteredItems: BankItem[];
  maxSlots: number;
  selectedTab: number;

  withdrawAsNote: boolean;
  onToggleNote: (value: boolean) => void;

  alwaysSetPlaceholder: boolean;
  onTogglePlaceholder: () => void;
  onReleaseAllPlaceholders: () => void;
}

export function BankFooter({
  items,
  filteredItems,
  maxSlots,
  selectedTab,
  withdrawAsNote,
  onToggleNote,
  alwaysSetPlaceholder,
  onTogglePlaceholder,
  onReleaseAllPlaceholders,
}: BankFooterProps) {
  const theme = useThemeStore((s) => s.theme);
  const placeholderCount = items.filter((i) => i.quantity === 0).length;

  return (
    <div
      className="mx-3 mb-2 mt-1 px-3 py-1.5 flex justify-between items-center text-xs rounded"
      style={{
        background: theme.colors.background.panelSecondary,
        border: `1px solid ${theme.colors.border.decorative}`,
        color: theme.colors.text.secondary,
      }}
    >
      <div className="flex items-center gap-3">
        <span>
          {selectedTab === TAB_INDEX_ALL
            ? `${items.length} items`
            : `${filteredItems.length} in tab`}{" "}
          • {items.length}/{maxSlots} slots
        </span>
        {/* RS3-style: Count items with qty=0 as placeholders */}
        {placeholderCount > 0 && (
          <span style={{ opacity: 0.6 }}>
            ({placeholderCount} placeholder
            {placeholderCount !== 1 ? "s" : ""})
          </span>
        )}
      </div>
      <div className="flex items-center gap-3">
        {/* BANK NOTE SYSTEM: Item/Note Toggle Buttons */}
        <div
          className="flex rounded overflow-hidden"
          style={{
            border: `1px solid ${theme.colors.border.decorative}`,
          }}
        >
          <button
            onClick={() => onToggleNote(false)}
            className="px-2 py-0.5 text-[10px] font-bold transition-all"
            style={{
              background: !withdrawAsNote
                ? theme.colors.border.decorative
                : theme.colors.background.overlay,
              color: !withdrawAsNote
                ? theme.colors.accent.primary
                : theme.colors.text.muted,
              borderRight: `1px solid ${theme.colors.border.decorative}`,
            }}
            title="Withdraw items as-is (1 slot per item)"
          >
            Item
          </button>
          <button
            onClick={() => onToggleNote(true)}
            className="px-2 py-0.5 text-[10px] font-bold transition-all"
            style={{
              background: withdrawAsNote
                ? theme.colors.border.decorative
                : theme.colors.background.overlay,
              color: withdrawAsNote
                ? theme.colors.accent.primary
                : theme.colors.text.muted,
            }}
            title="Withdraw items as bank notes (stackable, all fit in 1 slot)"
          >
            Note
          </button>
        </div>
        {/* Always Set Placeholder Checkbox */}
        <label
          className="flex items-center gap-1.5 cursor-pointer select-none"
          title={
            alwaysSetPlaceholder
              ? "Placeholders ON: Withdrawing all creates placeholder"
              : "Placeholders OFF: Withdrawing all removes slot"
          }
        >
          <input
            type="checkbox"
            checked={alwaysSetPlaceholder}
            onChange={onTogglePlaceholder}
            className="w-3.5 h-3.5 rounded cursor-pointer"
            style={{
              accentColor: theme.colors.accent.primary,
            }}
          />
          <span
            className="text-[10px] font-medium"
            style={{
              color: alwaysSetPlaceholder
                ? theme.colors.accent.primary
                : theme.colors.text.muted,
            }}
          >
            Always placeholder
          </span>
        </label>
        {/* Release All Placeholders (RS3-style: items with qty=0) */}
        {placeholderCount > 0 && (
          <button
            onClick={onReleaseAllPlaceholders}
            className="px-2 py-0.5 rounded text-[10px] font-medium transition-all"
            style={{
              background: `${theme.colors.state.danger}80`,
              color: theme.colors.text.primary,
              border: `1px solid ${theme.colors.state.danger}99`,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = `${theme.colors.state.danger}b3`;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = `${theme.colors.state.danger}80`;
            }}
            title="Release all placeholders"
          >
            Clear All
          </button>
        )}
      </div>
    </div>
  );
}
