/**
 * useSkillNode Hook
 *
 * Hook for managing individual skill node state including
 * interaction handlers and computed properties.
 *
 * @packageDocumentation
 */

import { useCallback, useMemo } from "react";
import type {
  SkillNodeId,
  SkillNodeDef,
  SkillNodeProgress,
  SkillNodeState,
  SkillCost,
} from "./skillTreeUtils";

// ============================================================================
// Types
// ============================================================================

/** Options for useSkillNode hook */
export interface UseSkillNodeOptions {
  /** Node definition */
  node: SkillNodeDef;
  /** Node progress */
  progress: SkillNodeProgress | null;
  /** Whether this node is currently selected */
  selected?: boolean;
  /** Whether this node can be purchased */
  canPurchase?: boolean;
  /** Whether this node can be refunded */
  canRefund?: boolean;
  /** Whether the node is highlighted (e.g., search match) */
  highlighted?: boolean;
  /** Purchase callback */
  onPurchase?: (nodeId: SkillNodeId) => void;
  /** Refund callback */
  onRefund?: (nodeId: SkillNodeId) => void;
  /** Select callback */
  onSelect?: (nodeId: SkillNodeId | null) => void;
  /** Hover callback */
  onHover?: (nodeId: SkillNodeId | null) => void;
  /** Show path to node callback */
  onShowPath?: (nodeId: SkillNodeId) => void;
}

/** Result from useSkillNode hook */
export interface UseSkillNodeResult {
  // State
  /** Current state of the node */
  state: SkillNodeState;
  /** Current rank */
  currentRank: number;
  /** Maximum rank */
  maxRank: number;
  /** Progress fraction (currentRank / maxRank) */
  progressFraction: number;
  /** Whether the node is selected */
  isSelected: boolean;
  /** Whether the node is highlighted */
  isHighlighted: boolean;
  /** Whether the node can be purchased */
  canPurchase: boolean;
  /** Whether the node can be refunded */
  canRefund: boolean;
  /** Whether the node is a keystone */
  isKeystone: boolean;

  // Display
  /** Display name */
  name: string;
  /** Description */
  description: string;
  /** Icon */
  icon: string;
  /** Tags */
  tags: string[];
  /** Tier */
  tier: number;

  // Costs
  /** Cost for next rank (empty if maxed) */
  nextRankCost: SkillCost[];
  /** All costs */
  allCosts: SkillCost[];
  /** Formatted cost string */
  costString: string;
  /** Rank display string (e.g., "2/5") */
  rankString: string;

  // Handlers
  /** Handle click on node */
  handleClick: (e: React.MouseEvent) => void;
  /** Handle right click on node */
  handleContextMenu: (e: React.MouseEvent) => void;
  /** Handle mouse enter */
  handleMouseEnter: () => void;
  /** Handle mouse leave */
  handleMouseLeave: () => void;
  /** Handle keyboard interaction */
  handleKeyDown: (e: React.KeyboardEvent) => void;

  // ARIA attributes
  /** ARIA attributes for accessibility */
  ariaAttributes: {
    role: string;
    "aria-label": string;
    "aria-selected": boolean;
    "aria-disabled": boolean;
    "aria-describedby"?: string;
    tabIndex: number;
  };

  // CSS classes
  /** CSS class names for styling */
  classNames: {
    root: string;
    state: string;
    selected: string;
    highlighted: string;
    keystone: string;
  };
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Hook for managing individual skill node state
 *
 * @example
 * ```tsx
 * function SkillNodeComponent({
 *   node,
 *   progress,
 *   selected,
 *   canPurchase,
 *   canRefund,
 *   onPurchase,
 *   onRefund,
 *   onSelect,
 * }: SkillNodeProps) {
 *   const {
 *     state,
 *     currentRank,
 *     maxRank,
 *     rankString,
 *     costString,
 *     isKeystone,
 *     handleClick,
 *     handleContextMenu,
 *     handleMouseEnter,
 *     handleMouseLeave,
 *     ariaAttributes,
 *     classNames,
 *   } = useSkillNode({
 *     node,
 *     progress,
 *     selected,
 *     canPurchase,
 *     canRefund,
 *     onPurchase,
 *     onRefund,
 *     onSelect,
 *   });
 *
 *   return (
 *     <div
 *       className={`${classNames.root} ${classNames.state}`}
 *       onClick={handleClick}
 *       onContextMenu={handleContextMenu}
 *       onMouseEnter={handleMouseEnter}
 *       onMouseLeave={handleMouseLeave}
 *       {...ariaAttributes}
 *     >
 *       <img src={node.icon} alt={node.name} />
 *       <span className="rank">{rankString}</span>
 *       {costString && <span className="cost">{costString}</span>}
 *     </div>
 *   );
 * }
 * ```
 */
export function useSkillNode(options: UseSkillNodeOptions): UseSkillNodeResult {
  const {
    node,
    progress,
    selected = false,
    canPurchase = false,
    canRefund = false,
    highlighted = false,
    onPurchase,
    onRefund,
    onSelect,
    onHover,
    onShowPath,
  } = options;

  // Computed state
  const state: SkillNodeState = progress?.state ?? "locked";
  const currentRank = progress?.currentRank ?? 0;
  const maxRank = node.maxRank;
  const progressFraction = maxRank > 0 ? currentRank / maxRank : 0;
  const isKeystone = node.isKeystone ?? false;

  // Cost calculations
  const nextRankCost = useMemo((): SkillCost[] => {
    if (currentRank >= maxRank) return [];
    const costIndex = Math.min(currentRank, node.costs.length - 1);
    return node.costs[costIndex] ? [node.costs[costIndex]] : [];
  }, [currentRank, maxRank, node.costs]);

  const costString = useMemo(() => {
    if (nextRankCost.length === 0) return "";
    return nextRankCost
      .map((c) => {
        // Format the cost type nicely
        const typeLabel = c.type.replace(/_/g, " ");
        return `${c.amount} ${typeLabel}`;
      })
      .join(", ");
  }, [nextRankCost]);

  const rankString = useMemo(() => {
    if (maxRank === 1) {
      return currentRank > 0 ? "Unlocked" : "";
    }
    return `${currentRank}/${maxRank}`;
  }, [currentRank, maxRank]);

  // Event handlers
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();

      if (e.shiftKey && onShowPath) {
        // Shift+click to show path
        onShowPath(node.id);
        return;
      }

      if (e.ctrlKey || e.metaKey) {
        // Ctrl/Cmd+click to purchase
        if (canPurchase && onPurchase) {
          onPurchase(node.id);
        }
        return;
      }

      // Regular click to select
      if (onSelect) {
        onSelect(selected ? null : node.id);
      }
    },
    [node.id, selected, canPurchase, onPurchase, onSelect, onShowPath],
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      // Right-click to refund or show context menu
      if (canRefund && onRefund) {
        onRefund(node.id);
      }
    },
    [node.id, canRefund, onRefund],
  );

  const handleMouseEnter = useCallback(() => {
    onHover?.(node.id);
  }, [node.id, onHover]);

  const handleMouseLeave = useCallback(() => {
    onHover?.(null);
  }, [onHover]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "Enter":
        case " ":
          e.preventDefault();
          if (canPurchase && onPurchase) {
            onPurchase(node.id);
          } else if (onSelect) {
            onSelect(selected ? null : node.id);
          }
          break;
        case "Backspace":
        case "Delete":
          e.preventDefault();
          if (canRefund && onRefund) {
            onRefund(node.id);
          }
          break;
        case "Escape":
          e.preventDefault();
          onSelect?.(null);
          break;
      }
    },
    [node.id, selected, canPurchase, canRefund, onPurchase, onRefund, onSelect],
  );

  // ARIA attributes
  const ariaAttributes = useMemo(
    () => ({
      role: "button",
      "aria-label": `${node.name}. ${rankString}. ${state === "locked" ? "Locked" : state === "available" ? "Available to unlock" : state === "maxed" ? "Maxed" : "Unlocked"}`,
      "aria-selected": selected,
      "aria-disabled": state === "locked" || (state === "maxed" && !canRefund),
      tabIndex: 0,
    }),
    [node.name, rankString, state, selected, canRefund],
  );

  // CSS class names
  const classNames = useMemo(
    () => ({
      root: "skill-node",
      state: `skill-node--${state}`,
      selected: selected ? "skill-node--selected" : "",
      highlighted: highlighted ? "skill-node--highlighted" : "",
      keystone: isKeystone ? "skill-node--keystone" : "",
    }),
    [state, selected, highlighted, isKeystone],
  );

  return {
    // State
    state,
    currentRank,
    maxRank,
    progressFraction,
    isSelected: selected,
    isHighlighted: highlighted,
    canPurchase,
    canRefund,
    isKeystone,

    // Display
    name: node.name,
    description: node.description,
    icon: node.icon,
    tags: node.tags,
    tier: node.tier,

    // Costs
    nextRankCost,
    allCosts: node.costs,
    costString,
    rankString,

    // Handlers
    handleClick,
    handleContextMenu,
    handleMouseEnter,
    handleMouseLeave,
    handleKeyDown,

    // ARIA attributes
    ariaAttributes,

    // CSS classes
    classNames,
  };
}
