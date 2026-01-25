import { create } from "zustand";
import type { DragItem, DragState, Point } from "../types";

/** Initial drag state */
const initialDragState: DragState = {
  isDragging: false,
  item: null,
  origin: { x: 0, y: 0 },
  current: { x: 0, y: 0 },
  delta: { x: 0, y: 0 },
  overTargets: [],
};

/** Drag store state and actions */
export interface DragStoreState extends DragState {
  /** Start a drag operation */
  startDrag: (item: DragItem, origin: Point) => void;
  /** Update current position during drag */
  updateDrag: (current: Point) => void;
  /** End the current drag operation */
  endDrag: () => void;
  /** Add a target that the drag is over */
  addOverTarget: (id: string) => void;
  /** Remove a target that the drag left */
  removeOverTarget: (id: string) => void;
  /** Reset to initial state */
  reset: () => void;
}

/**
 * Zustand store for drag-drop state
 *
 * This store is the single source of truth for all drag operations.
 * Use the useDrag and useDrop hooks to interact with this store.
 */
export const useDragStore = create<DragStoreState>((set, get) => ({
  ...initialDragState,

  startDrag: (item: DragItem, origin: Point) => {
    set({
      isDragging: true,
      item,
      origin,
      current: origin,
      delta: { x: 0, y: 0 },
      overTargets: [],
    });
  },

  updateDrag: (current: Point) => {
    const { origin } = get();
    set({
      current,
      delta: {
        x: current.x - origin.x,
        y: current.y - origin.y,
      },
    });
  },

  endDrag: () => {
    set({
      isDragging: false,
      item: null,
      overTargets: [],
    });
  },

  addOverTarget: (id: string) => {
    const { overTargets } = get();
    if (!overTargets.includes(id)) {
      set({ overTargets: [...overTargets, id] });
    }
  },

  removeOverTarget: (id: string) => {
    const { overTargets } = get();
    set({ overTargets: overTargets.filter((t) => t !== id) });
  },

  reset: () => {
    set(initialDragState);
  },
}));
