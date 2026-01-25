// Core drag hooks
export { useDrag } from "./useDrag";
export { useDrop } from "./useDrop";
export { useKeyboardDrag } from "./useKeyboardDrag";
export { DragContext, DragProvider, useDragContext } from "./DragContext";

// @dnd-kit compatible hooks
export {
  useDraggable,
  type UseDraggableConfig,
  type UseDraggableReturn,
} from "./useDraggable";
export {
  useDroppable,
  type UseDroppableConfig,
  type UseDroppableReturn,
} from "./useDroppable";

// Enhanced DnD Context (@dnd-kit compatible API)
export {
  DndProvider,
  useDndContext,
  useDndMonitor,
  type DndProviderProps,
  type DragStartEvent,
  type DragMoveEvent,
  type DragOverEvent,
  type DragEndEvent,
  type DragCancelEvent,
} from "./EnhancedDragContext";

// Composable DragOverlay
export {
  ComposableDragOverlay,
  snapCenterToCursor,
  type ComposableDragOverlayProps,
} from "./ComposableDragOverlay";

// Utilities
export {
  isPointInRect,
  getElementRect,
  getPointerPosition,
  distance,
  clamp,
  dropTargetRegistry,
} from "./utils";

// Sensors
export {
  DEFAULT_POINTER_ACTIVATION,
  DEFAULT_KEYBOARD_OPTIONS,
  checkActivationConstraint,
  getKeyboardMovementDelta,
  isStartKey,
  isCancelKey,
  isDropKey,
} from "./sensors";

// Collision Detection
export {
  closestCenter,
  closestCorners,
  rectIntersection,
  pointerWithin,
  getIntersectionArea,
} from "./collisionDetection";

// Modifiers
export {
  restrictToWindow,
  restrictToHorizontalAxis,
  restrictToVerticalAxis,
  createSnapToGridModifier,
  composeModifiers,
  createModifierContext,
} from "./modifiers";

// Auto-scroll
export { DEFAULT_AUTO_SCROLL_CONFIG, useAutoScroll } from "./autoScroll";

// Accessibility
export {
  DEFAULT_ANNOUNCEMENTS,
  getLiveRegion,
  announce,
  getDraggableAriaAttributes,
  getDroppableAriaAttributes,
  SCREEN_READER_INSTRUCTIONS,
  useAccessibilityAnnouncements,
} from "./accessibility";
