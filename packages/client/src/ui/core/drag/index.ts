// Drag hooks
export { useDrag } from "./useDrag";
export {
  useDrop,
  useDraggable,
  useDroppable,
  useDndMonitor,
  type DragEndEvent,
} from "./useDrop";

// Context and Provider
export {
  DragProvider,
  DragContext,
  DndProvider,
  useDragContext,
} from "./DragContext";

// Modifiers
export {
  restrictToWindow,
  restrictToHorizontalAxis,
  restrictToVerticalAxis,
  createSnapToGridModifier,
  composeModifiers,
  createModifierContext,
  getViewportSize,
  restrictToWindowEdges,
  restrictToWindowEdgesFully,
  snapToGridModifier,
  composeWindowModifiers,
  type DragModifier,
  type ModifierContext,
  type WindowPositionModifierArgs,
  type WindowPositionModifier,
} from "./modifiers";

// Collision detection
export {
  closestCenter,
  closestCorners,
  rectIntersection,
  pointerWithin,
  isPointInRect,
  getIntersectionArea,
  type CollisionResult,
  type CollisionDetectionStrategy,
} from "./collisionDetection";

// Accessibility
export {
  getLiveRegion,
  announce,
  getDraggableAriaAttributes,
  getDroppableAriaAttributes,
  useAccessibilityAnnouncements,
  DEFAULT_ANNOUNCEMENTS,
  SCREEN_READER_INSTRUCTIONS,
  type Announcement,
} from "./accessibility";

// Utilities
export {
  getElementRect,
  getPointerPosition,
  getRawPointerPosition,
  distance,
  clamp,
  getViewportSize as getViewportSizeUtil,
  clampToViewport,
  clampSizeToViewport,
  dropTargetRegistry,
  getUIScale,
  screenToScaledSpace,
  scaleScreenDelta,
  type DropTargetInfo,
} from "./utils";
