/**
 * Dialog System
 *
 * Complete dialog/conversation system for RPG-style interactions.
 *
 * @packageDocumentation
 */

// Dialog parser and types
export {
  // Types
  type DialogMood,
  type DialogNodeType,
  type DialogActionType,
  type DialogCondition,
  type DialogAction,
  type DialogChoice,
  type DialogNode,
  type DialogNodeBase,
  type DialogTextNode,
  type DialogChoiceNode,
  type DialogBranchNode,
  type DialogActionNode,
  type DialogEndNode,
  type DialogTree,
  type DialogContext,
  type ParsedDialog,
  type DialogTreeRaw,
  type DialogNodeRaw,
  // Parser functions
  parseDialogTree,
  evaluateCondition,
  evaluateConditions,
  interpolateText,
  getNextNode,
  getAvailableChoices,
  createSimpleDialog,
} from "./dialogParser";

// Dialog state hook
export {
  useDialog,
  type DialogState,
  type UseDialogOptions,
  type UseDialogResult,
} from "./useDialog";

// Dialog history hook
export {
  useDialogHistory,
  type DialogHistoryEntry,
  type DialogHistoryEntryType,
  type UseDialogHistoryOptions,
  type UseDialogHistoryResult,
} from "./useDialogHistory";
