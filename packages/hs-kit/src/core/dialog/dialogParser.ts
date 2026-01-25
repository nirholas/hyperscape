/**
 * Dialog Parser
 *
 * Parses dialog scripts/trees and provides utilities for dialog flow.
 * Supports text nodes, choices, branches, actions, and end nodes.
 *
 * @packageDocumentation
 */

// ============================================================================
// Types
// ============================================================================

/** NPC mood/emotion for portrait display */
export type DialogMood =
  | "neutral"
  | "happy"
  | "sad"
  | "angry"
  | "surprised"
  | "thinking"
  | "worried"
  | "laughing"
  | "confused"
  | "serious";

/** Type of dialog node */
export type DialogNodeType = "text" | "choice" | "branch" | "action" | "end";

/** Action types that can be triggered from dialog */
export type DialogActionType =
  | "quest_start"
  | "quest_complete"
  | "quest_progress"
  | "shop_open"
  | "trade_open"
  | "bank_open"
  | "teleport"
  | "give_item"
  | "take_item"
  | "give_xp"
  | "set_flag"
  | "play_sound"
  | "play_animation"
  | "custom";

/** Condition for branching */
export interface DialogCondition {
  /** Condition type */
  type:
    | "quest_state"
    | "item_count"
    | "skill_level"
    | "flag"
    | "variable"
    | "custom";
  /** Key for the condition (quest id, item id, skill name, flag name) */
  key: string;
  /** Operator for comparison */
  operator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "has" | "not_has";
  /** Value to compare against */
  value: string | number | boolean;
  /** Custom condition evaluator (for type: 'custom') */
  evaluate?: (context: DialogContext) => boolean;
}

/** Action payload for action nodes */
export interface DialogAction {
  /** Action type */
  type: DialogActionType;
  /** Action parameters */
  params: Record<string, unknown>;
  /** Delay before executing (ms) */
  delay?: number;
}

/** Single choice option */
export interface DialogChoice {
  /** Choice ID */
  id: string;
  /** Display text for the choice */
  text: string;
  /** Node to go to when selected */
  nextNodeId: string;
  /** Conditions that must be met to show this choice */
  conditions?: DialogCondition[];
  /** Whether this choice is disabled (shown but not selectable) */
  disabled?: boolean;
  /** Tooltip for disabled state */
  disabledReason?: string;
  /** Optional keyboard shortcut (1-9) */
  hotkey?: number;
}

/** Base dialog node */
export interface DialogNodeBase {
  /** Unique node ID */
  id: string;
  /** Node type */
  type: DialogNodeType;
  /** Optional tags for filtering/querying */
  tags?: string[];
}

/** Text node - NPC speaks */
export interface DialogTextNode extends DialogNodeBase {
  type: "text";
  /** Speaker name (NPC name) */
  speaker: string;
  /** Text content (supports {variable} interpolation) */
  text: string;
  /** Optional voice line ID */
  voiceLineId?: string;
  /** NPC mood/emotion */
  mood?: DialogMood;
  /** Portrait image URL or key */
  portrait?: string;
  /** Next node to go to */
  nextNodeId?: string;
  /** Typing speed multiplier (1.0 = normal) */
  typingSpeed?: number;
  /** Auto-continue after delay (ms), null = wait for input */
  autoContinue?: number;
}

/** Choice node - Player responds */
export interface DialogChoiceNode extends DialogNodeBase {
  type: "choice";
  /** Optional prompt text before choices */
  prompt?: string;
  /** Available choices */
  choices: DialogChoice[];
  /** Speaker for the prompt (if any) */
  speaker?: string;
  /** Portrait for prompt */
  portrait?: string;
  /** Mood for prompt */
  mood?: DialogMood;
}

/** Branch node - Conditional routing */
export interface DialogBranchNode extends DialogNodeBase {
  type: "branch";
  /** Conditions to evaluate in order */
  branches: Array<{
    conditions: DialogCondition[];
    nextNodeId: string;
  }>;
  /** Default node if no conditions match */
  defaultNodeId: string;
}

/** Action node - Trigger event */
export interface DialogActionNode extends DialogNodeBase {
  type: "action";
  /** Actions to execute */
  actions: DialogAction[];
  /** Next node to go to after actions */
  nextNodeId?: string;
}

/** End node - Close dialog */
export interface DialogEndNode extends DialogNodeBase {
  type: "end";
  /** Optional final actions before closing */
  actions?: DialogAction[];
  /** Optional closing text */
  closingText?: string;
}

/** Union of all dialog node types */
export type DialogNode =
  | DialogTextNode
  | DialogChoiceNode
  | DialogBranchNode
  | DialogActionNode
  | DialogEndNode;

/** Complete dialog tree */
export interface DialogTree {
  /** Unique dialog ID */
  id: string;
  /** Dialog title (for history/logs) */
  title: string;
  /** Starting node ID */
  startNodeId: string;
  /** All nodes in the dialog */
  nodes: Map<string, DialogNode>;
  /** Default speaker (can be overridden per node) */
  defaultSpeaker?: string;
  /** Default portrait */
  defaultPortrait?: string;
  /** Metadata */
  metadata?: Record<string, unknown>;
}

/** Context passed to condition evaluators and action handlers */
export interface DialogContext {
  /** Current player state */
  player?: {
    name: string;
    skills?: Record<string, number>;
    inventory?: Array<{ id: string; quantity: number }>;
    questStates?: Record<string, string>;
    flags?: Record<string, boolean>;
    variables?: Record<string, unknown>;
  };
  /** NPC being talked to */
  npc?: {
    id: string;
    name: string;
  };
  /** Custom data */
  custom?: Record<string, unknown>;
}

/** Parsed dialog with resolved references */
export interface ParsedDialog {
  tree: DialogTree;
  errors: string[];
  warnings: string[];
}

// ============================================================================
// Parser Functions
// ============================================================================

/**
 * Parse a raw dialog object into a DialogTree
 */
export function parseDialogTree(raw: DialogTreeRaw): ParsedDialog {
  const errors: string[] = [];
  const warnings: string[] = [];
  const nodes = new Map<string, DialogNode>();

  // Parse nodes
  if (!raw.nodes || !Array.isArray(raw.nodes)) {
    errors.push("Dialog tree must have a nodes array");
    return {
      tree: {
        id: raw.id || "unknown",
        title: raw.title || "Unknown Dialog",
        startNodeId: raw.startNodeId || "",
        nodes,
        defaultSpeaker: raw.defaultSpeaker,
        defaultPortrait: raw.defaultPortrait,
        metadata: raw.metadata,
      },
      errors,
      warnings,
    };
  }

  for (const nodeRaw of raw.nodes) {
    if (!nodeRaw.id) {
      errors.push("Node missing required 'id' field");
      continue;
    }
    if (!nodeRaw.type) {
      errors.push(`Node ${nodeRaw.id} missing required 'type' field`);
      continue;
    }

    const node = parseNode(nodeRaw, errors, warnings);
    if (node) {
      nodes.set(node.id, node);
    }
  }

  // Validate references
  validateReferences(nodes, raw.startNodeId ?? "", errors, warnings);

  return {
    tree: {
      id: raw.id || `dialog_${Date.now()}`,
      title: raw.title || "Dialog",
      startNodeId: raw.startNodeId || "",
      nodes,
      defaultSpeaker: raw.defaultSpeaker,
      defaultPortrait: raw.defaultPortrait,
      metadata: raw.metadata,
    },
    errors,
    warnings,
  };
}

/** Raw dialog tree input format */
export interface DialogTreeRaw {
  id?: string;
  title?: string;
  startNodeId?: string;
  nodes?: DialogNodeRaw[];
  defaultSpeaker?: string;
  defaultPortrait?: string;
  metadata?: Record<string, unknown>;
}

/** Raw node input format */
export interface DialogNodeRaw {
  id?: string;
  type?: DialogNodeType;
  speaker?: string;
  text?: string;
  voiceLineId?: string;
  mood?: DialogMood;
  portrait?: string;
  nextNodeId?: string;
  typingSpeed?: number;
  autoContinue?: number;
  prompt?: string;
  choices?: DialogChoice[];
  branches?: Array<{
    conditions: DialogCondition[];
    nextNodeId: string;
  }>;
  defaultNodeId?: string;
  actions?: DialogAction[];
  closingText?: string;
  tags?: string[];
}

function parseNode(
  raw: DialogNodeRaw,
  errors: string[],
  warnings: string[],
): DialogNode | null {
  const base: DialogNodeBase = {
    id: raw.id!,
    type: raw.type!,
    tags: raw.tags,
  };

  switch (raw.type) {
    case "text":
      if (!raw.text) {
        errors.push(`Text node ${raw.id} missing required 'text' field`);
        return null;
      }
      return {
        ...base,
        type: "text",
        speaker: raw.speaker || "",
        text: raw.text,
        voiceLineId: raw.voiceLineId,
        mood: raw.mood,
        portrait: raw.portrait,
        nextNodeId: raw.nextNodeId,
        typingSpeed: raw.typingSpeed,
        autoContinue: raw.autoContinue,
      } as DialogTextNode;

    case "choice":
      if (!raw.choices || raw.choices.length === 0) {
        errors.push(`Choice node ${raw.id} must have at least one choice`);
        return null;
      }
      return {
        ...base,
        type: "choice",
        prompt: raw.prompt,
        choices: raw.choices,
        speaker: raw.speaker,
        portrait: raw.portrait,
        mood: raw.mood,
      } as DialogChoiceNode;

    case "branch":
      if (!raw.branches || raw.branches.length === 0) {
        errors.push(`Branch node ${raw.id} must have at least one branch`);
        return null;
      }
      if (!raw.defaultNodeId) {
        warnings.push(
          `Branch node ${raw.id} has no defaultNodeId - may cause dead ends`,
        );
      }
      return {
        ...base,
        type: "branch",
        branches: raw.branches,
        defaultNodeId: raw.defaultNodeId || "",
      } as DialogBranchNode;

    case "action":
      if (!raw.actions || raw.actions.length === 0) {
        warnings.push(`Action node ${raw.id} has no actions defined`);
      }
      return {
        ...base,
        type: "action",
        actions: raw.actions || [],
        nextNodeId: raw.nextNodeId,
      } as DialogActionNode;

    case "end":
      return {
        ...base,
        type: "end",
        actions: raw.actions,
        closingText: raw.closingText,
      } as DialogEndNode;

    default:
      errors.push(`Unknown node type: ${raw.type}`);
      return null;
  }
}

function validateReferences(
  nodes: Map<string, DialogNode>,
  startNodeId: string,
  errors: string[],
  warnings: string[],
): void {
  // Check start node exists
  if (!nodes.has(startNodeId)) {
    errors.push(`Start node '${startNodeId}' not found`);
  }

  // Check all node references
  for (const [nodeId, node] of nodes) {
    switch (node.type) {
      case "text":
        if (node.nextNodeId && !nodes.has(node.nextNodeId)) {
          errors.push(
            `Node ${nodeId} references non-existent node '${node.nextNodeId}'`,
          );
        }
        break;

      case "choice":
        for (const choice of node.choices) {
          if (!nodes.has(choice.nextNodeId)) {
            errors.push(
              `Choice '${choice.id}' in node ${nodeId} references non-existent node '${choice.nextNodeId}'`,
            );
          }
        }
        break;

      case "branch":
        for (const branch of node.branches) {
          if (!nodes.has(branch.nextNodeId)) {
            errors.push(
              `Branch in node ${nodeId} references non-existent node '${branch.nextNodeId}'`,
            );
          }
        }
        if (node.defaultNodeId && !nodes.has(node.defaultNodeId)) {
          errors.push(
            `Branch node ${nodeId} default references non-existent node '${node.defaultNodeId}'`,
          );
        }
        break;

      case "action":
        if (node.nextNodeId && !nodes.has(node.nextNodeId)) {
          errors.push(
            `Action node ${nodeId} references non-existent node '${node.nextNodeId}'`,
          );
        }
        break;

      case "end":
        // End nodes don't reference other nodes
        break;
    }
  }

  // Find unreachable nodes
  const reachable = new Set<string>();
  const queue = [startNodeId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (reachable.has(current)) continue;
    reachable.add(current);

    const node = nodes.get(current);
    if (!node) continue;

    switch (node.type) {
      case "text":
        if (node.nextNodeId) queue.push(node.nextNodeId);
        break;
      case "choice":
        for (const choice of node.choices) {
          queue.push(choice.nextNodeId);
        }
        break;
      case "branch":
        for (const branch of node.branches) {
          queue.push(branch.nextNodeId);
        }
        if (node.defaultNodeId) queue.push(node.defaultNodeId);
        break;
      case "action":
        if (node.nextNodeId) queue.push(node.nextNodeId);
        break;
    }
  }

  for (const nodeId of nodes.keys()) {
    if (!reachable.has(nodeId)) {
      warnings.push(`Node '${nodeId}' is unreachable from start`);
    }
  }
}

// ============================================================================
// Condition Evaluation
// ============================================================================

/**
 * Evaluate a condition against the current context
 */
export function evaluateCondition(
  condition: DialogCondition,
  context: DialogContext,
): boolean {
  // Custom evaluator takes precedence
  if (condition.type === "custom" && condition.evaluate) {
    return condition.evaluate(context);
  }

  const { player } = context;
  if (!player) return false;

  let actualValue: unknown;

  switch (condition.type) {
    case "quest_state":
      actualValue = player.questStates?.[condition.key];
      break;
    case "item_count": {
      const item = player.inventory?.find((i) => i.id === condition.key);
      actualValue = item?.quantity ?? 0;
      break;
    }
    case "skill_level":
      actualValue = player.skills?.[condition.key] ?? 0;
      break;
    case "flag":
      actualValue = player.flags?.[condition.key] ?? false;
      break;
    case "variable":
      actualValue = player.variables?.[condition.key];
      break;
    default:
      return false;
  }

  return compareValues(actualValue, condition.operator, condition.value);
}

function compareValues(
  actual: unknown,
  operator: DialogCondition["operator"],
  expected: string | number | boolean,
): boolean {
  switch (operator) {
    case "eq":
      return actual === expected;
    case "neq":
      return actual !== expected;
    case "gt":
      return typeof actual === "number" && actual > (expected as number);
    case "gte":
      return typeof actual === "number" && actual >= (expected as number);
    case "lt":
      return typeof actual === "number" && actual < (expected as number);
    case "lte":
      return typeof actual === "number" && actual <= (expected as number);
    case "has":
      return actual !== undefined && actual !== null && actual !== false;
    case "not_has":
      return actual === undefined || actual === null || actual === false;
    default:
      return false;
  }
}

/**
 * Evaluate all conditions (AND logic)
 */
export function evaluateConditions(
  conditions: DialogCondition[],
  context: DialogContext,
): boolean {
  return conditions.every((c) => evaluateCondition(c, context));
}

// ============================================================================
// Text Interpolation
// ============================================================================

/**
 * Interpolate variables in dialog text
 * Supports {player.name}, {npc.name}, {custom.key} syntax
 */
export function interpolateText(text: string, context: DialogContext): string {
  return text.replace(/\{([^}]+)\}/g, (match, path) => {
    const parts = path.split(".");
    let value: unknown = context;

    for (const part of parts) {
      if (value && typeof value === "object" && part in value) {
        value = (value as Record<string, unknown>)[part];
      } else {
        return match; // Keep original if path not found
      }
    }

    return String(value ?? match);
  });
}

// ============================================================================
// Dialog Tree Utilities
// ============================================================================

/**
 * Get the next node based on current state and context
 */
export function getNextNode(
  tree: DialogTree,
  currentNode: DialogNode,
  context: DialogContext,
  selectedChoiceId?: string,
): DialogNode | null {
  switch (currentNode.type) {
    case "text":
      return currentNode.nextNodeId
        ? (tree.nodes.get(currentNode.nextNodeId) ?? null)
        : null;

    case "choice": {
      if (!selectedChoiceId) return null;
      const choice = currentNode.choices.find((c) => c.id === selectedChoiceId);
      return choice ? (tree.nodes.get(choice.nextNodeId) ?? null) : null;
    }

    case "branch": {
      // Evaluate branches in order, return first match
      for (const branch of currentNode.branches) {
        if (evaluateConditions(branch.conditions, context)) {
          return tree.nodes.get(branch.nextNodeId) ?? null;
        }
      }
      // Fall back to default
      return tree.nodes.get(currentNode.defaultNodeId) ?? null;
    }

    case "action":
      return currentNode.nextNodeId
        ? (tree.nodes.get(currentNode.nextNodeId) ?? null)
        : null;

    case "end":
      return null;
  }
}

/**
 * Get available choices for a choice node, filtering by conditions
 */
export function getAvailableChoices(
  node: DialogChoiceNode,
  context: DialogContext,
): DialogChoice[] {
  return node.choices.filter((choice) => {
    if (!choice.conditions) return true;
    return evaluateConditions(choice.conditions, context);
  });
}

/**
 * Create a simple dialog tree from an array of text lines
 * Useful for simple linear conversations
 */
export function createSimpleDialog(
  id: string,
  title: string,
  speaker: string,
  lines: string[],
  portrait?: string,
): DialogTree {
  const nodes = new Map<string, DialogNode>();

  lines.forEach((text, index) => {
    const nodeId = `line_${index}`;
    const isLast = index === lines.length - 1;

    nodes.set(nodeId, {
      id: nodeId,
      type: "text",
      speaker,
      text,
      portrait,
      nextNodeId: isLast ? "end" : `line_${index + 1}`,
    } as DialogTextNode);
  });

  nodes.set("end", {
    id: "end",
    type: "end",
  } as DialogEndNode);

  return {
    id,
    title,
    startNodeId: "line_0",
    nodes,
    defaultSpeaker: speaker,
    defaultPortrait: portrait,
  };
}
