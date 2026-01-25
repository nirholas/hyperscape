/**
 * ActionBarPanel - A window-based action bar panel
 *
 * Features:
 * - Configurable slot count (4-9 slots, adjustable via +/- buttons)
 * - Drag items from inventory to action bar
 * - Drag skills/spells/prayers to action bar
 * - Keyboard shortcuts (1-9)
 * - Right-click context menu
 * - Multiple action bars support (up to 5)
 * - Horizontal layout only (1xN where N is slot count)
 */

import React, { useCallback } from "react";
import { DndContext, DragOverlay } from "@dnd-kit/core";
import { useTheme } from "@/ui";

// Types
export type {
  ActionBarSlotContent,
  ActionBarPanelProps,
  ActionBarSlotUpdatePayload,
} from "./types";

// Utils and constants
export {
  ACTION_BAR_DIMENSIONS,
  SLOT_SIZE,
  SLOT_GAP,
  PADDING,
  CONTROL_BUTTON_SIZE,
  CONTROL_BUTTON_GAP,
  MIN_SLOT_COUNT,
  MAX_SLOT_COUNT,
  getSlotIcon,
} from "./utils";

// Hooks
import { useActionBarState } from "./useActionBarState";
import { useActionBarDragDrop } from "./useActionBarDragDrop";
import {
  useContextMenu,
  ActionBarContextMenuPortal,
} from "./ActionBarContextMenu";

// Components
import { ActionBarSlot, RubbishBin } from "./ActionBarSlot";

// Local imports
import type { ActionBarPanelProps } from "./types";
import {
  SLOT_SIZE,
  SLOT_GAP,
  PADDING,
  CONTROL_BUTTON_SIZE,
  CONTROL_BUTTON_GAP,
  MIN_SLOT_COUNT,
  MAX_SLOT_COUNT,
  getSlotIcon,
} from "./utils";

export function ActionBarPanel({
  world,
  barId = 0,
  isEditMode = false,
  windowId,
  useParentDndContext = false,
}: ActionBarPanelProps): React.ReactElement {
  const theme = useTheme();

  // State management
  const {
    slotCount,
    slots,
    hoveredSlot,
    activePrayers,
    isLocked,
    keyboardShortcuts,
    setSlots,
    setHoveredSlot,
    handleIncreaseSlots,
    handleDecreaseSlots,
    handleToggleLock,
    handleClearAll,
    handleUseSlot,
  } = useActionBarState({
    world,
    barId,
    isEditMode,
    windowId,
    useParentDndContext,
  });

  // Drag and drop
  const { sensors, draggedSlot, handleDragStart, handleDragEnd } =
    useActionBarDragDrop({
      slots,
      setSlots,
    });

  // Context menu
  const {
    contextMenu,
    menuRef,
    handleContextMenu,
    handleMenuItemClick: baseHandleMenuItemClick,
    handleRubbishBinContextMenu,
  } = useContextMenu(handleUseSlot, handleClearAll);

  // Extended menu item click handler to handle remove action
  const handleMenuItemClick = useCallback(
    (menuItem: {
      id: string;
      label: string;
      styledLabel: Array<{ text: string; color?: string }>;
    }) => {
      if (menuItem.id === "remove" && contextMenu.targetIndex >= 0) {
        setSlots((prev) => {
          const newSlots = [...prev];
          newSlots[contextMenu.targetIndex] = {
            type: "empty",
            id: `empty-${contextMenu.targetIndex}`,
          };
          return newSlots;
        });
      }
      baseHandleMenuItemClick(menuItem);
    },
    [contextMenu.targetIndex, setSlots, baseHandleMenuItemClick],
  );

  // Control button styles
  const getControlButtonStyle = (isDisabled: boolean): React.CSSProperties => ({
    width: CONTROL_BUTTON_SIZE,
    height: CONTROL_BUTTON_SIZE,
    minWidth: CONTROL_BUTTON_SIZE,
    minHeight: CONTROL_BUTTON_SIZE,
    background: isDisabled
      ? theme.colors.background.primary
      : `linear-gradient(180deg, ${theme.colors.background.secondary} 0%, ${theme.colors.background.primary} 100%)`,
    border: isDisabled
      ? `1px solid ${theme.colors.border.default}33`
      : `1px solid ${theme.colors.border.default}`,
    borderRadius: 4,
    color: isDisabled
      ? `${theme.colors.text.secondary}4D`
      : theme.colors.text.secondary,
    fontSize: 14,
    fontWeight: "bold",
    cursor: isDisabled ? "not-allowed" : "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "all 0.15s ease",
    boxShadow: `inset 0 2px 4px rgba(0, 0, 0, 0.4)`,
  });

  // Action bar content
  const actionBarContent = (
    <>
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: CONTROL_BUTTON_GAP,
        }}
      >
        {/* Decrease button */}
        {isEditMode && (
          <button
            onClick={handleDecreaseSlots}
            disabled={slotCount <= MIN_SLOT_COUNT}
            title={`Remove slot (${slotCount}/${MAX_SLOT_COUNT})`}
            className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
            style={getControlButtonStyle(slotCount <= MIN_SLOT_COUNT)}
            onMouseEnter={(e) => {
              if (slotCount > MIN_SLOT_COUNT) {
                e.currentTarget.style.background = `linear-gradient(180deg, ${theme.colors.accent.secondary}22 0%, ${theme.colors.background.primary} 100%)`;
                e.currentTarget.style.borderColor = theme.colors.accent.primary;
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background =
                slotCount <= MIN_SLOT_COUNT
                  ? theme.colors.background.primary
                  : `linear-gradient(180deg, ${theme.colors.background.secondary} 0%, ${theme.colors.background.primary} 100%)`;
              e.currentTarget.style.borderColor =
                slotCount <= MIN_SLOT_COUNT
                  ? `${theme.colors.border.default}33`
                  : theme.colors.border.default;
            }}
          >
            −
          </button>
        )}

        {/* Slots container */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${slotCount}, ${SLOT_SIZE}px)`,
            gap: SLOT_GAP,
            padding: PADDING,
            justifyContent: "center",
            background: `linear-gradient(180deg, ${theme.colors.background.secondary} 0%, ${theme.colors.background.primary} 100%)`,
            border: `1px solid ${theme.colors.border.default}`,
            borderRadius: 4,
            boxShadow: `inset 0 2px 8px rgba(0, 0, 0, 0.5), ${theme.shadows.md}`,
          }}
        >
          {slots.map((slot, index) => (
            <ActionBarSlot
              key={`${barId}-${index}`}
              slot={slot}
              slotIndex={index}
              slotSize={SLOT_SIZE}
              shortcut={keyboardShortcuts[index] || ""}
              isHovered={hoveredSlot === index}
              isActive={
                slot.type === "prayer" && slot.prayerId
                  ? activePrayers.has(slot.prayerId)
                  : false
              }
              isLocked={isLocked}
              onHover={() => setHoveredSlot(index)}
              onLeave={() => setHoveredSlot(null)}
              onClick={() => handleUseSlot(slot, index)}
              onContextMenu={(e) => handleContextMenu(e, slot, index)}
            />
          ))}
        </div>

        {/* Rubbish bin */}
        {!isLocked && (
          <RubbishBin
            onContextMenu={handleRubbishBinContextMenu}
            isDragging={draggedSlot !== null}
          />
        )}

        {/* Lock button */}
        <button
          onClick={handleToggleLock}
          title={isLocked ? "Unlock action bar" : "Lock action bar"}
          className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
          style={{
            ...getControlButtonStyle(false),
            opacity: isLocked ? 1 : 0.6,
            color: isLocked
              ? theme.colors.state.warning
              : theme.colors.text.secondary,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = `linear-gradient(180deg, ${theme.colors.accent.secondary}22 0%, ${theme.colors.background.primary} 100%)`;
            e.currentTarget.style.borderColor = theme.colors.accent.primary;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = `linear-gradient(180deg, ${theme.colors.background.secondary} 0%, ${theme.colors.background.primary} 100%)`;
            e.currentTarget.style.borderColor = theme.colors.border.default;
          }}
        >
          {isLocked ? "🔒" : "🔓"}
        </button>

        {/* Increase button */}
        {isEditMode && (
          <button
            onClick={handleIncreaseSlots}
            disabled={slotCount >= MAX_SLOT_COUNT}
            title={`Add slot (${slotCount}/${MAX_SLOT_COUNT})`}
            className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
            style={getControlButtonStyle(slotCount >= MAX_SLOT_COUNT)}
            onMouseEnter={(e) => {
              if (slotCount < MAX_SLOT_COUNT) {
                e.currentTarget.style.background = `linear-gradient(180deg, ${theme.colors.accent.secondary}22 0%, ${theme.colors.background.primary} 100%)`;
                e.currentTarget.style.borderColor = theme.colors.accent.primary;
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background =
                slotCount >= MAX_SLOT_COUNT
                  ? theme.colors.background.primary
                  : `linear-gradient(180deg, ${theme.colors.background.secondary} 0%, ${theme.colors.background.primary} 100%)`;
              e.currentTarget.style.borderColor =
                slotCount >= MAX_SLOT_COUNT
                  ? `${theme.colors.border.default}33`
                  : theme.colors.border.default;
            }}
          >
            +
          </button>
        )}
      </div>

      {/* Drag Overlay */}
      {!useParentDndContext && (
        <DragOverlay>
          {draggedSlot && (
            <div
              style={{
                width: SLOT_SIZE,
                height: SLOT_SIZE,
                background: `linear-gradient(180deg, ${theme.colors.accent.secondary}4D 0%, ${theme.colors.background.secondary} 100%)`,
                border: `2px solid ${theme.colors.accent.primary}CC`,
                borderRadius: 4,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 16,
                boxShadow: `0 4px 12px rgba(0, 0, 0, 0.4), 0 0 8px ${theme.colors.accent.primary}40`,
                pointerEvents: "none",
              }}
            >
              {getSlotIcon(draggedSlot)}
            </div>
          )}
        </DragOverlay>
      )}
    </>
  );

  return (
    <>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {useParentDndContext ? (
          actionBarContent
        ) : (
          <DndContext
            sensors={sensors}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            {actionBarContent}
          </DndContext>
        )}
      </div>

      <ActionBarContextMenuPortal
        contextMenu={contextMenu}
        menuRef={menuRef}
        onItemClick={handleMenuItemClick}
      />
    </>
  );
}
