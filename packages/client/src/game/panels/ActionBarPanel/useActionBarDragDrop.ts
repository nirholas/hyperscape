/**
 * ActionBarPanel - Drag and drop logic hook
 */

import { useState, useCallback } from "react";
import {
  useSensors,
  useSensor,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import type {
  ActionBarSlotContent,
  InventoryDragData,
  DropTargetData,
} from "./types";

export interface UseActionBarDragDropOptions {
  slots: ActionBarSlotContent[];
  setSlots: React.Dispatch<React.SetStateAction<ActionBarSlotContent[]>>;
}

export interface UseActionBarDragDropResult {
  sensors: ReturnType<typeof useSensors>;
  draggedSlot: ActionBarSlotContent | null;
  handleDragStart: (event: DragStartEvent) => void;
  handleDragEnd: (event: DragEndEvent) => void;
}

export function useActionBarDragDrop({
  slots: _slots,
  setSlots,
}: UseActionBarDragDropOptions): UseActionBarDragDropResult {
  const [draggedSlot, setDraggedSlot] = useState<ActionBarSlotContent | null>(
    null,
  );

  // Configure sensors for accessibility and mobile support
  // PointerSensor: distance-based for mouse, TouchSensor: delay-based for mobile long-press
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 250, // Long-press 250ms to start drag on mobile
        tolerance: 5,
      },
    }),
    useSensor(KeyboardSensor),
  );

  // Handle drag start
  const handleDragStart = useCallback((event: DragStartEvent) => {
    const { active } = event;
    const dragData = active.data.current as InventoryDragData | undefined;
    setDraggedSlot(dragData?.slot || null);
  }, []);

  // Handle drag end
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      setDraggedSlot(null);

      const activeData = active.data.current as InventoryDragData | null;

      // Handle drag-out removal
      if (!over) {
        if (
          activeData?.source === "actionbar" &&
          activeData.slotIndex !== undefined
        ) {
          setSlots((prev) => {
            const newSlots = [...prev];
            newSlots[activeData.slotIndex!] = {
              type: "empty",
              id: `empty-${activeData.slotIndex}`,
            };
            return newSlots;
          });
        }
        return;
      }

      const overId = String(over.id);
      const overData = over.data.current as DropTargetData | null;
      const isRubbishBin =
        overId === "actionbar-rubbish-bin" ||
        overData?.target === "rubbish-bin";
      const targetSlotIndex = overData?.slotIndex;

      // Handle drop on rubbish bin
      if (isRubbishBin && activeData?.source === "actionbar") {
        const slotIndex = activeData.slotIndex;
        if (slotIndex !== undefined) {
          setSlots((prev) => {
            const newSlots = [...prev];
            newSlots[slotIndex] = {
              type: "empty",
              id: `empty-${slotIndex}`,
            };
            return newSlots;
          });
        }
        return;
      }

      // Handle drop from inventory
      if (activeData?.source === "inventory" && activeData.item) {
        if (targetSlotIndex !== undefined) {
          const newSlot: ActionBarSlotContent = {
            type: "item",
            id: `item-${activeData.item.itemId}-${Date.now()}`,
            itemId: activeData.item.itemId,
            quantity: activeData.item.quantity,
            label: activeData.item.itemId,
          };
          setSlots((prev) => {
            const newSlots = [...prev];
            newSlots[targetSlotIndex] = newSlot;
            return newSlots;
          });
        }
        return;
      }

      // Handle drop from prayer panel
      if (activeData?.source === "prayer" && activeData.prayer) {
        if (targetSlotIndex !== undefined) {
          const newSlot: ActionBarSlotContent = {
            type: "prayer",
            id: `prayer-${activeData.prayer.id}-${Date.now()}`,
            prayerId: activeData.prayer.id,
            icon: activeData.prayer.icon,
            label: activeData.prayer.name,
          };
          setSlots((prev) => {
            const newSlots = [...prev];
            newSlots[targetSlotIndex] = newSlot;
            return newSlots;
          });
        }
        return;
      }

      // Handle drop from skill panel
      if (activeData?.source === "skill" && activeData.skill) {
        if (targetSlotIndex !== undefined) {
          const skillData = activeData.skill;
          const newSlot: ActionBarSlotContent = {
            type: "skill",
            id: `skill-${skillData.id}-${Date.now()}`,
            skillId: skillData.id,
            icon: skillData.icon,
            label: skillData.name,
          };
          setSlots((prev) => {
            const newSlots = [...prev];
            newSlots[targetSlotIndex] = newSlot;
            return newSlots;
          });
        }
        return;
      }

      // Handle drop from combat style panel
      if (activeData?.source === "combatstyle" && activeData.combatStyle) {
        if (targetSlotIndex !== undefined) {
          const styleData = activeData.combatStyle;
          const newSlot: ActionBarSlotContent = {
            type: "combatstyle",
            id: `combatstyle-${styleData.id}-${Date.now()}`,
            combatStyleId: styleData.id,
            label: styleData.label,
          };
          setSlots((prev) => {
            const newSlots = [...prev];
            newSlots[targetSlotIndex] = newSlot;
            return newSlots;
          });
        }
        return;
      }

      // Reordering within action bar
      if (activeData?.source === "actionbar" && targetSlotIndex !== undefined) {
        const fromIndex = activeData.slotIndex;

        if (fromIndex !== undefined && fromIndex !== targetSlotIndex) {
          setSlots((prev) => {
            const newSlots = [...prev];
            [newSlots[fromIndex], newSlots[targetSlotIndex]] = [
              newSlots[targetSlotIndex],
              newSlots[fromIndex],
            ];
            return newSlots;
          });
        }
      }
    },
    [setSlots],
  );

  return {
    sensors,
    draggedSlot,
    handleDragStart,
    handleDragEnd,
  };
}
