/**
 * BankSlotItem - Memoized Bank Slot Component
 *
 * CRITICAL: This component uses React.memo to prevent unnecessary re-renders.
 * Without memoization, all 480 slots would re-render on ANY state change
 * (hover, drag, selection). With React.memo, only slots whose props
 * actually changed will re-render.
 *
 * Performance impact: Reduces re-renders from O(n) to O(1) for most interactions.
 *
 * DO NOT REMOVE React.memo - it is essential for performance!
 */

import React, { memo } from "react";
import { useThemeStore } from "@/ui";
import type { BankItem } from "../types";
import { formatItemName, formatQuantity } from "../utils";
import { ItemIcon } from "@/ui/components/ItemIcon";

/**
 * Props for the memoized BankSlotItem component
 */
export interface BankSlotItemProps {
  item: BankItem;
  slotIndex: number;
  itemTabIndex: number;
  isDragging: boolean;
  isDropTarget: boolean;
  showSwapHighlight: boolean;
  showInsertLine: boolean;
  showFaintGuide: boolean;
  dropColor: string;
  guideColor: string;
  /** Slot size in pixels - responsive based on mobile/desktop */
  slotSize?: number;
  onDragStart: (slotIndex: number, tabIndex: number) => void;
  onDragOver: (e: React.DragEvent, slotIndex: number, tabIndex: number) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent, slotIndex: number, tabIndex: number) => void;
  onDragEnd: () => void;
  onClick: (itemId: string, tabIndex: number, slot: number) => void;
  onContextMenu: (e: React.MouseEvent, item: BankItem) => void;
}

/**
 * Memoized bank slot component to prevent unnecessary re-renders.
 *
 * CRITICAL: Do NOT remove memo() wrapper - essential for 480-slot performance!
 */
export const BankSlotItem = memo(function BankSlotItem({
  item,
  slotIndex,
  itemTabIndex,
  isDragging,
  isDropTarget: _isDropTarget,
  showSwapHighlight,
  showInsertLine,
  showFaintGuide,
  dropColor,
  guideColor,
  slotSize = 42, // Default to desktop size
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
  onClick,
  onContextMenu,
}: BankSlotItemProps) {
  const theme = useThemeStore((s) => s.theme);
  const isPlaceholder = item.quantity === 0;

  return (
    <div
      className="rounded flex items-center justify-center relative cursor-grab active:cursor-grabbing"
      style={{
        width: slotSize,
        height: slotSize,
        background: showSwapHighlight
          ? `linear-gradient(135deg, rgba(${dropColor}, 0.35) 0%, rgba(${dropColor}, 0.2) 100%)`
          : isPlaceholder
            ? `linear-gradient(135deg, ${theme.colors.background.panelSecondary}66 0%, ${theme.colors.background.panelPrimary}66 100%)`
            : `linear-gradient(135deg, ${theme.colors.slot.filled} 0%, ${theme.colors.slot.empty} 100%)`,
        border: showSwapHighlight
          ? `2px solid rgba(${dropColor}, 0.9)`
          : isPlaceholder
            ? `1px dashed ${theme.colors.border.default}33`
            : `1px solid ${theme.colors.border.hover}`,
        transform: isDragging ? "scale(0.9)" : "scale(1)",
        opacity: isDragging ? 0.4 : isPlaceholder ? 0.6 : 1,
        transition:
          "transform 0.15s ease, opacity 0.15s ease, background 0.1s ease, border 0.1s ease",
        boxShadow: showSwapHighlight
          ? `0 0 12px rgba(${dropColor}, 0.5)`
          : "none",
      }}
      title={
        isPlaceholder
          ? `${formatItemName(item.itemId)} (placeholder)`
          : `${formatItemName(item.itemId)} x${item.quantity} (Tab ${itemTabIndex})`
      }
      draggable={true}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        onDragStart(slotIndex, itemTabIndex);
      }}
      onDragOver={(e) => onDragOver(e, slotIndex, itemTabIndex)}
      onDragLeave={onDragLeave}
      onDrop={(e) => onDrop(e, slotIndex, itemTabIndex)}
      onDragEnd={onDragEnd}
      onClick={() => onClick(item.itemId, itemTabIndex, slotIndex)}
      onContextMenu={(e) => onContextMenu(e, item)}
    >
      {/* Single INSERT LINE on left edge */}
      {(showInsertLine || showFaintGuide) && (
        <div
          style={{
            position: "absolute",
            left: -4,
            top: 0,
            bottom: 0,
            width: showInsertLine ? 6 : 3,
            background: showInsertLine
              ? `rgba(${dropColor}, 1)`
              : `rgba(${guideColor}, 0.2)`,
            borderRadius: 3,
            zIndex: 20,
            boxShadow: showInsertLine
              ? `0 0 10px rgba(${dropColor}, 0.9), 0 0 20px rgba(${dropColor}, 0.5)`
              : "none",
            transition: "all 0.1s ease",
          }}
        />
      )}
      <span className="select-none pointer-events-none">
        <ItemIcon itemId={item.itemId} size={38} />
      </span>
      {item.quantity > 1 && (
        <span
          className="absolute bottom-0 right-0.5 text-[10px] font-bold pointer-events-none"
          style={{
            color:
              item.quantity >= 10000000
                ? theme.colors.state.success
                : item.quantity >= 100000
                  ? theme.colors.text.primary
                  : theme.colors.state.warning,
            textShadow: "1px 1px 1px black, -1px -1px 1px black",
          }}
        >
          {formatQuantity(item.quantity)}
        </span>
      )}
    </div>
  );
});
