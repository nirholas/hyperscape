/**
 * ActionBarPanel - Individual slot component
 */

import React, { memo, useMemo, useCallback, useRef, useEffect } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { useTheme } from "@/ui";
import type { ActionBarSlotContent } from "./types";
import { getSlotIcon, SLOT_SIZE } from "./utils";

export interface ActionBarSlotProps {
  slot: ActionBarSlotContent;
  slotIndex: number;
  slotSize: number;
  shortcut: string;
  isHovered: boolean;
  isActive: boolean;
  isLocked: boolean;
  onHover: () => void;
  onLeave: () => void;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

export const ActionBarSlot = memo(function ActionBarSlot({
  slot,
  slotIndex,
  slotSize,
  shortcut,
  isHovered,
  isActive,
  isLocked,
  onHover,
  onLeave,
  onClick,
  onContextMenu,
}: ActionBarSlotProps) {
  const theme = useTheme();
  const isEmpty = slot.type === "empty";
  const isPrayer = slot.type === "prayer";

  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    isDragging,
  } = useDraggable({
    id: `actionbar-slot-${slotIndex}`,
    data: { slot, slotIndex, source: "actionbar" },
    disabled: isEmpty || isLocked,
  });

  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `actionbar-drop-${slotIndex}`,
    data: { slotIndex, target: "actionbar" },
  });

  // Track drag and long press state
  const pointerStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggeredRef = useRef(false);

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  // Wrap pointer handlers
  const wrappedListeners = useMemo(() => {
    if (!listeners) return {};

    const originalPointerDown = listeners.onPointerDown;

    return {
      ...listeners,
      onPointerDown: (e: React.PointerEvent) => {
        longPressTriggeredRef.current = false;
        pointerStartPosRef.current = { x: e.clientX, y: e.clientY };

        // Long-press for touch devices
        if (e.pointerType === "touch" && !isEmpty) {
          clearLongPressTimer();
          longPressTimerRef.current = setTimeout(() => {
            longPressTriggeredRef.current = true;
            const syntheticEvent = {
              preventDefault: () => {},
              clientX: e.clientX,
              clientY: e.clientY,
            } as React.MouseEvent;
            onContextMenu(syntheticEvent);
          }, 500);
        }

        originalPointerDown?.(e);
      },
      onPointerUp: () => {
        clearLongPressTimer();
      },
      onPointerCancel: () => {
        clearLongPressTimer();
      },
    };
  }, [listeners, isEmpty, onContextMenu, clearLongPressTimer]);

  // Handle click
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (longPressTriggeredRef.current) {
        longPressTriggeredRef.current = false;
        return;
      }

      if (pointerStartPosRef.current) {
        const dx = e.clientX - pointerStartPosRef.current.x;
        const dy = e.clientY - pointerStartPosRef.current.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance > 3) {
          return;
        }
      }

      onClick();
    },
    [onClick],
  );

  useEffect(() => {
    return () => {
      clearLongPressTimer();
    };
  }, [clearLongPressTimer]);

  // Combine refs
  const combinedRef = (node: HTMLButtonElement | null) => {
    setDragRef(node);
    setDropRef(node);
  };

  const icon = getSlotIcon(slot);

  const slotStyle = useMemo(
    (): React.CSSProperties => ({
      width: slotSize,
      height: slotSize,
      background: isEmpty
        ? theme.colors.background.primary
        : isPrayer && isActive
          ? `radial-gradient(ellipse at center, ${theme.colors.accent.primary}4D 0%, ${theme.colors.background.secondary} 70%)`
          : isOver
            ? `linear-gradient(180deg, ${theme.colors.accent.secondary}33 0%, ${theme.colors.background.primary} 100%)`
            : isHovered
              ? `linear-gradient(180deg, ${theme.colors.accent.secondary}22 0%, ${theme.colors.background.primary} 100%)`
              : `linear-gradient(180deg, ${theme.colors.background.secondary} 0%, ${theme.colors.background.primary} 100%)`,
      border: isEmpty
        ? `1px solid ${theme.colors.border.default}66`
        : isPrayer && isActive
          ? `1px solid ${theme.colors.accent.primary}B3`
          : isOver
            ? `2px solid ${theme.colors.accent.primary}B3`
            : isHovered
              ? `1px solid ${theme.colors.accent.primary}80`
              : `1px solid ${theme.colors.border.default}`,
      borderRadius: 4,
      cursor:
        isEmpty || isLocked ? "default" : isDragging ? "grabbing" : "grab",
      opacity: isDragging ? 0.3 : 1,
      transform: isOver
        ? "scale(1.05)"
        : isDragging
          ? "scale(0.95)"
          : "scale(1)",
      transition:
        "transform 0.15s ease, opacity 0.15s ease, background 0.15s ease, border 0.15s ease",
      touchAction: "none",
      boxShadow:
        isPrayer && isActive
          ? `0 0 12px ${theme.colors.accent.primary}80, inset 0 0 15px ${theme.colors.accent.primary}33`
          : isOver
            ? `0 0 8px ${theme.colors.accent.primary}66`
            : `inset 0 2px 4px rgba(0, 0, 0, 0.4)`,
    }),
    [
      isEmpty,
      isPrayer,
      isActive,
      isOver,
      isHovered,
      isDragging,
      isLocked,
      slotSize,
      theme,
    ],
  );

  return (
    <button
      ref={combinedRef}
      onClick={handleClick}
      onContextMenu={onContextMenu}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      className="relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
      title={
        isEmpty
          ? `Empty slot (${shortcut})`
          : `${slot.label || slot.itemId || slot.skillId || "Unknown"} (${shortcut})`
      }
      style={slotStyle}
      {...attributes}
      {...wrappedListeners}
    >
      {/* Icon */}
      {!isEmpty && (
        <div
          className="flex items-center justify-center h-full"
          style={{
            fontSize: 16,
            filter: "drop-shadow(0 1px 2px rgba(0, 0, 0, 0.5))",
          }}
        >
          {icon}
        </div>
      )}

      {/* Quantity Badge */}
      {slot.type === "item" && slot.quantity && slot.quantity > 1 && (
        <div
          className="absolute font-bold"
          style={{
            bottom: 1,
            right: 1,
            background: theme.colors.background.overlay,
            color: theme.colors.text.primary,
            fontSize: 8,
            padding: "0px 2px",
            borderRadius: 2,
            lineHeight: 1.1,
          }}
        >
          {slot.quantity > 999
            ? `${Math.floor(slot.quantity / 1000)}K`
            : slot.quantity}
        </div>
      )}

      {/* Shortcut Key */}
      <div
        className="absolute font-bold"
        style={{
          top: 1,
          left: 2,
          color: isEmpty
            ? `${theme.colors.text.secondary}80`
            : `${theme.colors.text.secondary}A6`,
          fontSize: 7,
          textShadow: "0 1px 1px rgba(0, 0, 0, 0.6)",
        }}
      >
        {shortcut}
      </div>
    </button>
  );
});

/** Rubbish bin component for drag-to-delete functionality */
export const RubbishBin = memo(function RubbishBin({
  onContextMenu,
  isDragging,
}: {
  onContextMenu: (e: React.MouseEvent) => void;
  isDragging: boolean;
}) {
  const theme = useTheme();
  const { setNodeRef, isOver } = useDroppable({
    id: "actionbar-rubbish-bin",
    data: { target: "rubbish-bin" },
  });

  return (
    <button
      ref={setNodeRef}
      onContextMenu={onContextMenu}
      title="Drag items here to remove them"
      className="relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
      style={{
        width: SLOT_SIZE,
        height: SLOT_SIZE,
        background: isOver
          ? `radial-gradient(ellipse at center, ${theme.colors.state.danger}4D 0%, ${theme.colors.background.secondary} 70%)`
          : isDragging
            ? `linear-gradient(180deg, ${theme.colors.background.tertiary || theme.colors.background.secondary} 0%, ${theme.colors.background.primary} 100%)`
            : `linear-gradient(180deg, ${theme.colors.background.secondary} 0%, ${theme.colors.background.primary} 100%)`,
        border: isOver
          ? `2px solid ${theme.colors.state.danger}B3`
          : isDragging
            ? `1px dashed ${theme.colors.state.warning}80`
            : `1px solid ${theme.colors.border.default}66`,
        borderRadius: 4,
        cursor: "default",
        opacity: isDragging ? 1 : 0.6,
        transform: isOver ? "scale(1.1)" : "scale(1)",
        transition: "all 0.15s ease",
        boxShadow: isOver
          ? `0 0 12px ${theme.colors.state.danger}80, inset 0 0 15px ${theme.colors.state.danger}33`
          : `inset 0 2px 4px rgba(0, 0, 0, 0.4)`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 14,
      }}
    >
      🗑️
    </button>
  );
});
