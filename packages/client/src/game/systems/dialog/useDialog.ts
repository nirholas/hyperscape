/**
 * useDialog Hook
 *
 * Core hook for managing dialog state, typewriter effects, and navigation.
 *
 * @packageDocumentation
 */

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import type {
  DialogTree,
  DialogNode,
  DialogContext,
  DialogAction,
  DialogChoice,
  DialogMood,
  DialogTextNode,
  DialogChoiceNode,
} from "./dialogParser";
import {
  getNextNode,
  getAvailableChoices,
  interpolateText,
} from "./dialogParser";

// ============================================================================
// Types
// ============================================================================

/** Current state of a dialog instance */
export interface DialogState {
  /** Whether dialog is currently open */
  isOpen: boolean;
  /** Current node being displayed */
  currentNode: DialogNode | null;
  /** Current dialog tree */
  tree: DialogTree | null;
  /** Dialog context for conditions */
  context: DialogContext;
  /** Text being typed (typewriter effect) */
  displayedText: string;
  /** Full text of current node */
  fullText: string;
  /** Whether typewriter is complete */
  isTypingComplete: boolean;
  /** Whether waiting for user input */
  isWaitingForInput: boolean;
  /** Available choices (if choice node) */
  availableChoices: DialogChoice[];
  /** Currently highlighted choice index */
  highlightedChoiceIndex: number;
  /** Current speaker name */
  speaker: string;
  /** Current portrait */
  portrait: string | null;
  /** Current mood */
  mood: DialogMood;
  /** Whether currently processing actions */
  isProcessingActions: boolean;
  /** Voice line ID for current node */
  voiceLineId: string | null;
}

/** Options for useDialog hook */
export interface UseDialogOptions {
  /** Default typing speed (characters per second) */
  typingSpeed?: number;
  /** Callback when action needs to be executed */
  onAction?: (action: DialogAction) => Promise<void> | void;
  /** Callback when dialog opens */
  onOpen?: (tree: DialogTree) => void;
  /** Callback when dialog closes */
  onClose?: (tree: DialogTree) => void;
  /** Callback when node changes */
  onNodeChange?: (node: DialogNode, tree: DialogTree) => void;
  /** Callback when voice line should play */
  onVoiceLine?: (voiceLineId: string) => void;
  /** Callback when typing starts */
  onTypingStart?: () => void;
  /** Callback when typing completes */
  onTypingComplete?: () => void;
  /** Initial context */
  initialContext?: DialogContext;
}

/** Result from useDialog hook */
export interface UseDialogResult {
  /** Current dialog state */
  state: DialogState;
  /** Open a dialog tree */
  open: (tree: DialogTree, context?: DialogContext) => void;
  /** Close the dialog */
  close: () => void;
  /** Continue to next node (for text nodes) */
  continue: () => void;
  /** Select a choice (for choice nodes) */
  selectChoice: (choiceId: string) => void;
  /** Skip typewriter effect */
  skipTyping: () => void;
  /** Navigate choice highlight */
  highlightChoice: (index: number) => void;
  /** Select currently highlighted choice */
  selectHighlightedChoice: () => void;
  /** Update context */
  updateContext: (updates: Partial<DialogContext>) => void;
  /** Go to a specific node */
  goToNode: (nodeId: string) => void;
  /** Check if can continue (not waiting for choice) */
  canContinue: boolean;
  /** Check if can select choices */
  hasChoices: boolean;
}

// ============================================================================
// Hook Implementation
// ============================================================================

const DEFAULT_TYPING_SPEED = 40; // characters per second

const initialState: DialogState = {
  isOpen: false,
  currentNode: null,
  tree: null,
  context: {},
  displayedText: "",
  fullText: "",
  isTypingComplete: true,
  isWaitingForInput: false,
  availableChoices: [],
  highlightedChoiceIndex: 0,
  speaker: "",
  portrait: null,
  mood: "neutral",
  isProcessingActions: false,
  voiceLineId: null,
};

/**
 * Hook for managing dialog state and navigation
 *
 * @example
 * ```tsx
 * function DialogUI() {
 *   const dialog = useDialog({
 *     typingSpeed: 50,
 *     onAction: async (action) => {
 *       if (action.type === 'quest_start') {
 *         await startQuest(action.params.questId);
 *       }
 *     }
 *   });
 *
 *   // Handle keyboard input
 *   useEffect(() => {
 *     const handleKey = (e: KeyboardEvent) => {
 *       if (e.key === ' ' || e.key === 'Enter') {
 *         if (!dialog.state.isTypingComplete) {
 *           dialog.skipTyping();
 *         } else if (dialog.canContinue) {
 *           dialog.continue();
 *         }
 *       }
 *       // Number keys for choices
 *       if (e.key >= '1' && e.key <= '9' && dialog.hasChoices) {
 *         const index = parseInt(e.key) - 1;
 *         if (index < dialog.state.availableChoices.length) {
 *           dialog.selectChoice(dialog.state.availableChoices[index].id);
 *         }
 *       }
 *     };
 *     window.addEventListener('keydown', handleKey);
 *     return () => window.removeEventListener('keydown', handleKey);
 *   }, [dialog]);
 *
 *   return dialog.state.isOpen ? (
 *     <DialogBox
 *       speaker={dialog.state.speaker}
 *       text={dialog.state.displayedText}
 *       choices={dialog.state.availableChoices}
 *       onChoiceSelect={dialog.selectChoice}
 *       onContinue={dialog.continue}
 *     />
 *   ) : null;
 * }
 * ```
 */
export function useDialog(options: UseDialogOptions = {}): UseDialogResult {
  const {
    typingSpeed = DEFAULT_TYPING_SPEED,
    onAction,
    onOpen,
    onClose,
    onNodeChange,
    onVoiceLine,
    onTypingStart,
    onTypingComplete,
    initialContext = {},
  } = options;

  const [state, setState] = useState<DialogState>({
    ...initialState,
    context: initialContext,
  });

  // Refs for animation frame and typing
  const typingIntervalRef = useRef<number | null>(null);
  const currentCharIndexRef = useRef(0);
  const pendingActionsRef = useRef<DialogAction[]>([]);

  // Cleanup typing interval
  const stopTyping = useCallback(() => {
    if (typingIntervalRef.current !== null) {
      clearInterval(typingIntervalRef.current);
      typingIntervalRef.current = null;
    }
  }, []);

  // Process pending actions (called when typing completes or is skipped)
  const processPendingActions = useCallback(async () => {
    if (!onAction || pendingActionsRef.current.length === 0) return;

    const actionsToProcess = [...pendingActionsRef.current];
    pendingActionsRef.current = [];

    setState((prev) => ({ ...prev, isProcessingActions: true }));

    for (const action of actionsToProcess) {
      if (action.delay) {
        await new Promise((resolve) => setTimeout(resolve, action.delay));
      }
      await onAction(action);
    }

    setState((prev) => ({ ...prev, isProcessingActions: false }));
  }, [onAction]);

  // Start typewriter effect
  const startTyping = useCallback(
    (text: string, speed: number = typingSpeed) => {
      stopTyping();
      currentCharIndexRef.current = 0;
      // Clear any pending actions from previous node
      pendingActionsRef.current = [];

      onTypingStart?.();

      const msPerChar = 1000 / speed;
      typingIntervalRef.current = window.setInterval(() => {
        currentCharIndexRef.current++;
        const currentIndex = currentCharIndexRef.current;

        if (currentIndex >= text.length) {
          stopTyping();
          setState((prev) => ({
            ...prev,
            displayedText: text,
            isTypingComplete: true,
            isWaitingForInput: true,
          }));
          onTypingComplete?.();
          // Process any actions that were queued during typing
          void processPendingActions();
        } else {
          setState((prev) => ({
            ...prev,
            displayedText: text.slice(0, currentIndex),
          }));
        }
      }, msPerChar);
    },
    [
      typingSpeed,
      stopTyping,
      onTypingStart,
      onTypingComplete,
      processPendingActions,
    ],
  );

  // Queue actions - if typing is in progress, queue them; otherwise process immediately
  const processActions = useCallback(
    async (actions: DialogAction[]) => {
      if (!onAction || actions.length === 0) return;

      // Check if typing is in progress
      if (typingIntervalRef.current !== null) {
        // Queue actions to be processed after typing completes
        pendingActionsRef.current.push(...actions);
        return;
      }

      // Process immediately if not typing
      setState((prev) => ({ ...prev, isProcessingActions: true }));

      for (const action of actions) {
        if (action.delay) {
          await new Promise((resolve) => setTimeout(resolve, action.delay));
        }
        await onAction(action);
      }

      setState((prev) => ({ ...prev, isProcessingActions: false }));
    },
    [onAction],
  );

  // Navigate to a node
  const navigateToNode = useCallback(
    async (
      node: DialogNode | null,
      tree: DialogTree,
      context: DialogContext,
    ) => {
      if (!node) {
        // End of dialog
        onClose?.(tree);
        setState((prev) => ({
          ...initialState,
          context: prev.context,
        }));
        stopTyping();
        return;
      }

      onNodeChange?.(node, tree);

      switch (node.type) {
        case "text": {
          const textNode = node as DialogTextNode;
          const interpolated = interpolateText(textNode.text, context);
          const speaker = textNode.speaker || tree.defaultSpeaker || "";
          const portrait = textNode.portrait || tree.defaultPortrait || null;
          const mood = textNode.mood || "neutral";
          const speed = textNode.typingSpeed
            ? typingSpeed * textNode.typingSpeed
            : typingSpeed;

          // Trigger voice line
          if (textNode.voiceLineId) {
            onVoiceLine?.(textNode.voiceLineId);
          }

          setState((prev) => ({
            ...prev,
            currentNode: node,
            tree,
            fullText: interpolated,
            displayedText: "",
            isTypingComplete: false,
            isWaitingForInput: false,
            availableChoices: [],
            highlightedChoiceIndex: 0,
            speaker,
            portrait,
            mood,
            voiceLineId: textNode.voiceLineId || null,
          }));

          startTyping(interpolated, speed);

          // Handle auto-continue
          if (textNode.autoContinue) {
            setTimeout(() => {
              setState((prev) => {
                // Only auto-continue if still on same node
                if (prev.currentNode?.id === node.id && prev.isTypingComplete) {
                  const next = getNextNode(tree, node, context);
                  navigateToNode(next, tree, context);
                }
                return prev;
              });
            }, textNode.autoContinue);
          }
          break;
        }

        case "choice": {
          const choiceNode = node as DialogChoiceNode;
          const available = getAvailableChoices(choiceNode, context);
          const prompt = choiceNode.prompt
            ? interpolateText(choiceNode.prompt, context)
            : "";
          const speaker = choiceNode.speaker || tree.defaultSpeaker || "";
          const portrait = choiceNode.portrait || tree.defaultPortrait || null;
          const mood = choiceNode.mood || "neutral";

          setState((prev) => ({
            ...prev,
            currentNode: node,
            tree,
            fullText: prompt,
            displayedText: prompt,
            isTypingComplete: true,
            isWaitingForInput: true,
            availableChoices: available,
            highlightedChoiceIndex: 0,
            speaker,
            portrait,
            mood,
            voiceLineId: null,
          }));
          break;
        }

        case "branch": {
          // Branches are automatic - evaluate and continue
          const next = getNextNode(tree, node, context);
          navigateToNode(next, tree, context);
          break;
        }

        case "action": {
          // Process actions then continue
          await processActions(node.actions);
          const next = getNextNode(tree, node, context);
          navigateToNode(next, tree, context);
          break;
        }

        case "end": {
          // Process any final actions
          if (node.actions) {
            await processActions(node.actions);
          }

          // Show closing text if any
          if (node.closingText) {
            const interpolated = interpolateText(node.closingText, context);
            setState((prev) => ({
              ...prev,
              currentNode: node,
              fullText: interpolated,
              displayedText: "",
              isTypingComplete: false,
              isWaitingForInput: false,
              availableChoices: [],
            }));
            startTyping(interpolated);
          } else {
            // Close immediately
            onClose?.(tree);
            setState((prev) => ({
              ...initialState,
              context: prev.context,
            }));
          }
          break;
        }
      }
    },
    [
      typingSpeed,
      startTyping,
      stopTyping,
      processActions,
      onNodeChange,
      onVoiceLine,
      onClose,
    ],
  );

  // Open dialog
  const open = useCallback(
    (tree: DialogTree, context?: DialogContext) => {
      const mergedContext = { ...state.context, ...context };
      const startNode = tree.nodes.get(tree.startNodeId);

      onOpen?.(tree);

      setState((prev) => ({
        ...prev,
        isOpen: true,
        tree,
        context: mergedContext,
      }));

      navigateToNode(startNode ?? null, tree, mergedContext);
    },
    [state.context, navigateToNode, onOpen],
  );

  // Close dialog
  const close = useCallback(() => {
    stopTyping();
    if (state.tree) {
      onClose?.(state.tree);
    }
    setState((prev) => ({
      ...initialState,
      context: prev.context,
    }));
  }, [stopTyping, state.tree, onClose]);

  // Continue to next node
  const continueDialog = useCallback(() => {
    if (!state.tree || !state.currentNode) return;
    if (!state.isTypingComplete) return;
    if (state.currentNode.type === "choice") return;
    if (state.isProcessingActions) return;

    // For end nodes with closing text, close the dialog
    if (state.currentNode.type === "end") {
      close();
      return;
    }

    const next = getNextNode(state.tree, state.currentNode, state.context);
    navigateToNode(next, state.tree, state.context);
  }, [state, navigateToNode, close]);

  // Select a choice
  const selectChoice = useCallback(
    (choiceId: string) => {
      if (!state.tree || !state.currentNode) return;
      if (state.currentNode.type !== "choice") return;
      if (state.isProcessingActions) return;

      const choice = state.availableChoices.find((c) => c.id === choiceId);
      if (!choice || choice.disabled) return;

      const next = getNextNode(
        state.tree,
        state.currentNode,
        state.context,
        choiceId,
      );
      navigateToNode(next, state.tree, state.context);
    },
    [state, navigateToNode],
  );

  // Skip typewriter
  const skipTyping = useCallback(() => {
    stopTyping();
    setState((prev) => ({
      ...prev,
      displayedText: prev.fullText,
      isTypingComplete: true,
      isWaitingForInput: true,
    }));
    onTypingComplete?.();
    // Process any actions that were queued during typing
    void processPendingActions();
  }, [stopTyping, onTypingComplete, processPendingActions]);

  // Highlight choice by index
  const highlightChoice = useCallback((index: number) => {
    setState((prev) => {
      const maxIndex = prev.availableChoices.length - 1;
      const clampedIndex = Math.max(0, Math.min(index, maxIndex));
      return { ...prev, highlightedChoiceIndex: clampedIndex };
    });
  }, []);

  // Select currently highlighted choice
  const selectHighlightedChoice = useCallback(() => {
    if (!state.availableChoices.length) return;
    const choice = state.availableChoices[state.highlightedChoiceIndex];
    if (choice && !choice.disabled) {
      selectChoice(choice.id);
    }
  }, [state.availableChoices, state.highlightedChoiceIndex, selectChoice]);

  // Update context
  const updateContext = useCallback((updates: Partial<DialogContext>) => {
    setState((prev) => ({
      ...prev,
      context: { ...prev.context, ...updates },
    }));
  }, []);

  // Go to specific node
  const goToNode = useCallback(
    (nodeId: string) => {
      if (!state.tree) return;
      const node = state.tree.nodes.get(nodeId);
      if (node) {
        navigateToNode(node, state.tree, state.context);
      }
    },
    [state.tree, state.context, navigateToNode],
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopTyping();
    };
  }, [stopTyping]);

  // Computed values
  const canContinue = useMemo(() => {
    if (!state.isOpen || !state.currentNode) return false;
    if (!state.isTypingComplete) return false;
    if (state.isProcessingActions) return false;
    if (state.currentNode.type === "choice") return false;
    return true;
  }, [state]);

  const hasChoices = useMemo(() => {
    return (
      state.isOpen &&
      state.currentNode?.type === "choice" &&
      state.availableChoices.length > 0
    );
  }, [state]);

  return {
    state,
    open,
    close,
    continue: continueDialog,
    selectChoice,
    skipTyping,
    highlightChoice,
    selectHighlightedChoice,
    updateContext,
    goToNode,
    canContinue,
    hasChoices,
  };
}
