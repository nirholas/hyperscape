/**
 * useSkillTree Hook
 *
 * Main hook for skill tree state management including point allocation,
 * undo/redo, and search/filter functionality.
 *
 * @packageDocumentation
 */

import { useCallback, useMemo, useReducer, useRef } from "react";
import type { Point } from "../../types";
import {
  type SkillNodeId,
  type SkillNodeDef,
  type SkillNodeProgress,
  type SkillNodeState,
  type SkillCost,
  type SkillTreeDef,
  type SkillConnection,
  type SkillFilterOptions,
  type NodePath,
  computeNodeState,
  canRefundNode,
  findPathToNode,
  getConnections,
  filterNodes,
  calculateTotalCost,
  canAfford,
  getRefundAmount,
} from "./skillTreeUtils";

// ============================================================================
// Types
// ============================================================================

/** Allocation action for undo/redo */
interface AllocationAction {
  type: "purchase" | "refund";
  nodeId: SkillNodeId;
  previousRank: number;
  newRank: number;
  cost: SkillCost[];
}

/** State for the skill tree */
interface SkillTreeState {
  /** Node progress map */
  progress: Map<SkillNodeId, SkillNodeProgress>;
  /** History stack for undo */
  history: AllocationAction[];
  /** Redo stack */
  redoStack: AllocationAction[];
  /** Currently selected node */
  selectedNodeId: SkillNodeId | null;
  /** Current filter options */
  filter: SkillFilterOptions;
  /** Pan offset for viewport */
  viewOffset: Point;
  /** Zoom level (1 = 100%) */
  zoom: number;
}

/** Actions for the reducer */
type SkillTreeAction =
  | { type: "PURCHASE_NODE"; nodeId: SkillNodeId }
  | { type: "REFUND_NODE"; nodeId: SkillNodeId }
  | { type: "UNDO" }
  | { type: "REDO" }
  | { type: "RESET" }
  | { type: "SELECT_NODE"; nodeId: SkillNodeId | null }
  | { type: "SET_FILTER"; filter: SkillFilterOptions }
  | { type: "SET_VIEW"; offset: Point; zoom: number }
  | { type: "SET_PROGRESS"; progress: Map<SkillNodeId, SkillNodeProgress> };

/** Options for useSkillTree hook */
export interface UseSkillTreeOptions {
  /** Skill tree definition */
  tree: SkillTreeDef;
  /** Available resources for purchases */
  resources?: Map<string, number>;
  /** Initial node progress */
  initialProgress?: Map<SkillNodeId, SkillNodeProgress>;
  /** Callback when a node is purchased */
  onPurchase?: (nodeId: SkillNodeId, cost: SkillCost[]) => void;
  /** Callback when a node is refunded */
  onRefund?: (nodeId: SkillNodeId, refund: SkillCost[]) => void;
  /** Callback when an allocation fails (insufficient resources, etc.) */
  onAllocationError?: (error: string, nodeId: SkillNodeId) => void;
  /** Refund ratio (0-1, default 1.0 = full refund) */
  refundRatio?: number;
  /** Maximum history length for undo */
  maxHistory?: number;
}

/** Result from useSkillTree hook */
export interface UseSkillTreeResult {
  // Node data
  /** All node definitions */
  nodes: SkillNodeDef[];
  /** Map of node definitions by ID */
  nodesMap: Map<SkillNodeId, SkillNodeDef>;
  /** Node progress map */
  progress: Map<SkillNodeId, SkillNodeProgress>;
  /** All connections between nodes */
  connections: SkillConnection[];
  /** Filtered nodes based on current filter */
  filteredNodes: SkillNodeDef[];

  // Selection
  /** Currently selected node ID */
  selectedNodeId: SkillNodeId | null;
  /** Currently selected node definition */
  selectedNode: SkillNodeDef | null;
  /** Progress for selected node */
  selectedNodeProgress: SkillNodeProgress | null;
  /** Select a node */
  selectNode: (nodeId: SkillNodeId | null) => void;

  // Allocation
  /** Purchase a rank in a node */
  purchaseNode: (nodeId: SkillNodeId) => boolean;
  /** Refund a rank from a node */
  refundNode: (nodeId: SkillNodeId) => boolean;
  /** Check if a node can be purchased */
  canPurchaseNode: (nodeId: SkillNodeId) => boolean;
  /** Check if a node can be refunded */
  canRefundNode: (nodeId: SkillNodeId) => boolean;
  /** Get state of a node */
  getNodeState: (nodeId: SkillNodeId) => SkillNodeState;
  /** Get cost to purchase next rank of a node */
  getNodeCost: (nodeId: SkillNodeId) => SkillCost[];
  /** Get refund for a node */
  getNodeRefund: (nodeId: SkillNodeId) => SkillCost[];

  // Undo/Redo
  /** Undo last allocation */
  undo: () => void;
  /** Redo last undone allocation */
  redo: () => void;
  /** Whether undo is available */
  canUndo: boolean;
  /** Whether redo is available */
  canRedo: boolean;
  /** Reset all allocations */
  reset: () => void;

  // Path finding
  /** Find path to a node from current state */
  findPathTo: (nodeId: SkillNodeId) => NodePath | null;
  /** Get total cost to reach a node */
  getCostToNode: (nodeId: SkillNodeId) => SkillCost[];

  // Filter/Search
  /** Current filter options */
  filter: SkillFilterOptions;
  /** Set filter options */
  setFilter: (filter: SkillFilterOptions) => void;
  /** Search nodes by query */
  search: (query: string) => void;
  /** Clear all filters */
  clearFilter: () => void;

  // Viewport
  /** Current view offset */
  viewOffset: Point;
  /** Current zoom level */
  zoom: number;
  /** Set view position and zoom */
  setView: (offset: Point, zoom: number) => void;
  /** Pan the view */
  pan: (deltaX: number, deltaY: number) => void;
  /** Zoom in/out */
  setZoom: (zoom: number) => void;
  /** Center view on a node */
  centerOnNode: (nodeId: SkillNodeId) => void;
  /** Fit entire tree in view */
  fitToView: () => void;

  // Stats
  /** Total points spent */
  totalPointsSpent: number;
  /** Total nodes purchased */
  totalNodesPurchased: number;
  /** Nodes by state count */
  nodeStateCounts: Record<SkillNodeState, number>;
}

// ============================================================================
// Reducer
// ============================================================================

function createInitialState(
  tree: SkillTreeDef,
  initialProgress?: Map<SkillNodeId, SkillNodeProgress>,
): SkillTreeState {
  const progress = new Map<SkillNodeId, SkillNodeProgress>();
  const nodesMap = new Map<SkillNodeId, SkillNodeDef>();

  // Build nodes map
  tree.nodes.forEach((node) => {
    nodesMap.set(node.id, node);
  });

  // Initialize progress for all nodes
  tree.nodes.forEach((node) => {
    const initial = initialProgress?.get(node.id);
    const currentRank = initial?.currentRank ?? 0;

    progress.set(node.id, {
      nodeId: node.id,
      currentRank,
      state: computeNodeState(node.id, nodesMap, progress),
    });
  });

  // Recompute states after initial setup
  tree.nodes.forEach((node) => {
    const nodeProgress = progress.get(node.id);
    if (nodeProgress) {
      nodeProgress.state = computeNodeState(node.id, nodesMap, progress);
    }
  });

  return {
    progress,
    history: [],
    redoStack: [],
    selectedNodeId: null,
    filter: {},
    viewOffset: { x: 0, y: 0 },
    zoom: 1,
  };
}

function createReducer(
  tree: SkillTreeDef,
  resources: Map<string, number>,
  onPurchase: ((nodeId: SkillNodeId, cost: SkillCost[]) => void) | undefined,
  onRefund: ((nodeId: SkillNodeId, refund: SkillCost[]) => void) | undefined,
  refundRatio: number,
  maxHistory: number,
) {
  const nodesMap = new Map<SkillNodeId, SkillNodeDef>();
  tree.nodes.forEach((node) => nodesMap.set(node.id, node));

  return function reducer(
    state: SkillTreeState,
    action: SkillTreeAction,
  ): SkillTreeState {
    switch (action.type) {
      case "PURCHASE_NODE": {
        const node = nodesMap.get(action.nodeId);
        const nodeProgress = state.progress.get(action.nodeId);

        if (!node || !nodeProgress) return state;

        // Check if can purchase
        if (
          nodeProgress.state !== "available" &&
          nodeProgress.state !== "purchased"
        ) {
          return state;
        }

        const currentRank = nodeProgress.currentRank;
        if (currentRank >= node.maxRank) return state;

        // Get cost for next rank
        const costIndex = Math.min(currentRank, node.costs.length - 1);
        const cost = node.costs[costIndex] ? [node.costs[costIndex]] : [];

        // Check if can afford
        if (!canAfford(cost, resources)) return state;

        // Create new progress
        const newProgress = new Map(state.progress);
        const newRank = currentRank + 1;

        newProgress.set(action.nodeId, {
          nodeId: action.nodeId,
          currentRank: newRank,
          state: newRank >= node.maxRank ? "maxed" : "purchased",
        });

        // Update states of dependent nodes
        tree.nodes.forEach((n) => {
          if (n.dependencies.includes(action.nodeId)) {
            const prog = newProgress.get(n.id);
            if (prog) {
              prog.state = computeNodeState(n.id, nodesMap, newProgress);
            }
          }
        });

        // Create history action
        const historyAction: AllocationAction = {
          type: "purchase",
          nodeId: action.nodeId,
          previousRank: currentRank,
          newRank,
          cost,
        };

        // Call callback
        onPurchase?.(action.nodeId, cost);

        return {
          ...state,
          progress: newProgress,
          history: [...state.history.slice(-maxHistory + 1), historyAction],
          redoStack: [],
        };
      }

      case "REFUND_NODE": {
        const node = nodesMap.get(action.nodeId);
        const nodeProgress = state.progress.get(action.nodeId);

        if (!node || !nodeProgress) return state;

        const currentRank = nodeProgress.currentRank;
        if (currentRank <= 0) return state;

        // Check if can refund (no dependent nodes purchased)
        if (!canRefundNode(action.nodeId, nodesMap, state.progress)) {
          return state;
        }

        // Calculate refund
        const costIndex = Math.min(currentRank - 1, node.costs.length - 1);
        const refundCost = node.costs[costIndex]
          ? [
              {
                type: node.costs[costIndex].type,
                amount: Math.floor(node.costs[costIndex].amount * refundRatio),
              },
            ]
          : [];

        // Create new progress
        const newProgress = new Map(state.progress);
        const newRank = currentRank - 1;

        newProgress.set(action.nodeId, {
          nodeId: action.nodeId,
          currentRank: newRank,
          state: computeNodeState(action.nodeId, nodesMap, newProgress),
        });

        // Update states of dependent nodes
        tree.nodes.forEach((n) => {
          if (n.dependencies.includes(action.nodeId)) {
            const prog = newProgress.get(n.id);
            if (prog) {
              prog.state = computeNodeState(n.id, nodesMap, newProgress);
            }
          }
        });

        // Create history action
        const historyAction: AllocationAction = {
          type: "refund",
          nodeId: action.nodeId,
          previousRank: currentRank,
          newRank,
          cost: refundCost,
        };

        // Call callback
        onRefund?.(action.nodeId, refundCost);

        return {
          ...state,
          progress: newProgress,
          history: [...state.history.slice(-maxHistory + 1), historyAction],
          redoStack: [],
        };
      }

      case "UNDO": {
        if (state.history.length === 0) return state;

        const lastAction = state.history[state.history.length - 1];
        const node = nodesMap.get(lastAction.nodeId);
        if (!node) return state;

        const newProgress = new Map(state.progress);

        // Reverse the action
        newProgress.set(lastAction.nodeId, {
          nodeId: lastAction.nodeId,
          currentRank: lastAction.previousRank,
          state: computeNodeState(lastAction.nodeId, nodesMap, newProgress),
        });

        // Update dependent node states
        tree.nodes.forEach((n) => {
          if (n.dependencies.includes(lastAction.nodeId)) {
            const prog = newProgress.get(n.id);
            if (prog) {
              prog.state = computeNodeState(n.id, nodesMap, newProgress);
            }
          }
        });

        return {
          ...state,
          progress: newProgress,
          history: state.history.slice(0, -1),
          redoStack: [...state.redoStack, lastAction],
        };
      }

      case "REDO": {
        if (state.redoStack.length === 0) return state;

        const redoAction = state.redoStack[state.redoStack.length - 1];
        const node = nodesMap.get(redoAction.nodeId);
        if (!node) return state;

        const newProgress = new Map(state.progress);

        // Apply the action
        newProgress.set(redoAction.nodeId, {
          nodeId: redoAction.nodeId,
          currentRank: redoAction.newRank,
          state:
            redoAction.newRank >= node.maxRank
              ? "maxed"
              : redoAction.newRank > 0
                ? "purchased"
                : "available",
        });

        // Update dependent node states
        tree.nodes.forEach((n) => {
          if (n.dependencies.includes(redoAction.nodeId)) {
            const prog = newProgress.get(n.id);
            if (prog) {
              prog.state = computeNodeState(n.id, nodesMap, newProgress);
            }
          }
        });

        return {
          ...state,
          progress: newProgress,
          history: [...state.history, redoAction],
          redoStack: state.redoStack.slice(0, -1),
        };
      }

      case "RESET": {
        return createInitialState(tree);
      }

      case "SELECT_NODE": {
        return {
          ...state,
          selectedNodeId: action.nodeId,
        };
      }

      case "SET_FILTER": {
        return {
          ...state,
          filter: action.filter,
        };
      }

      case "SET_VIEW": {
        return {
          ...state,
          viewOffset: action.offset,
          zoom: Math.max(0.1, Math.min(3, action.zoom)),
        };
      }

      case "SET_PROGRESS": {
        // Recompute states for all nodes
        const newProgress = new Map(action.progress);
        tree.nodes.forEach((node) => {
          const prog = newProgress.get(node.id);
          if (prog) {
            prog.state = computeNodeState(node.id, nodesMap, newProgress);
          }
        });
        return {
          ...state,
          progress: newProgress,
          history: [],
          redoStack: [],
        };
      }

      default:
        return state;
    }
  };
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Hook for managing skill tree state
 *
 * @example
 * ```tsx
 * function SkillTreePanel({ treeDef }: { treeDef: SkillTreeDef }) {
 *   const resources = useMemo(() => new Map([["skill_points", playerPoints]]), [playerPoints]);
 *
 *   const {
 *     nodes,
 *     connections,
 *     progress,
 *     selectedNode,
 *     selectNode,
 *     purchaseNode,
 *     canPurchaseNode,
 *     filter,
 *     setFilter,
 *     viewOffset,
 *     zoom,
 *     pan,
 *   } = useSkillTree({
 *     tree: treeDef,
 *     resources,
 *     onPurchase: (nodeId, cost) => spendPoints(cost),
 *   });
 *
 *   return (
 *     <SkillTree viewOffset={viewOffset} zoom={zoom} onPan={pan}>
 *       {connections.map(conn => (
 *         <SkillConnection key={`${conn.from}-${conn.to}`} {...conn} />
 *       ))}
 *       {nodes.map(node => (
 *         <SkillNode
 *           key={node.id}
 *           node={node}
 *           progress={progress.get(node.id)}
 *           selected={selectedNode?.id === node.id}
 *           onClick={() => selectNode(node.id)}
 *           onPurchase={() => purchaseNode(node.id)}
 *           canPurchase={canPurchaseNode(node.id)}
 *         />
 *       ))}
 *     </SkillTree>
 *   );
 * }
 * ```
 */
export function useSkillTree(options: UseSkillTreeOptions): UseSkillTreeResult {
  const {
    tree,
    resources = new Map(),
    initialProgress,
    onPurchase,
    onRefund,
    refundRatio = 1.0,
    maxHistory = 50,
  } = options;

  // Build nodes map
  const nodesMap = useMemo(() => {
    const map = new Map<SkillNodeId, SkillNodeDef>();
    tree.nodes.forEach((node) => map.set(node.id, node));
    return map;
  }, [tree]);

  // Create reducer with current options
  const reducer = useMemo(
    () =>
      createReducer(
        tree,
        resources,
        onPurchase,
        onRefund,
        refundRatio,
        maxHistory,
      ),
    [tree, resources, onPurchase, onRefund, refundRatio, maxHistory],
  );

  // Initialize state
  const [state, dispatch] = useReducer(
    reducer,
    { tree, initialProgress },
    ({ tree, initialProgress }) => createInitialState(tree, initialProgress),
  );

  // Refs for mutable values
  const resourcesRef = useRef(resources);
  resourcesRef.current = resources;

  // Connections
  const connections = useMemo(
    () => getConnections(nodesMap, state.progress),
    [nodesMap, state.progress],
  );

  // Filtered nodes
  const filteredNodes = useMemo(
    () => filterNodes(tree.nodes, state.progress, state.filter),
    [tree.nodes, state.progress, state.filter],
  );

  // Selected node
  const selectedNode = state.selectedNodeId
    ? (nodesMap.get(state.selectedNodeId) ?? null)
    : null;
  const selectedNodeProgress = state.selectedNodeId
    ? (state.progress.get(state.selectedNodeId) ?? null)
    : null;

  // Selection
  const selectNode = useCallback((nodeId: SkillNodeId | null) => {
    dispatch({ type: "SELECT_NODE", nodeId });
  }, []);

  // Allocation
  const purchaseNode = useCallback(
    (nodeId: SkillNodeId): boolean => {
      const node = nodesMap.get(nodeId);
      const progress = state.progress.get(nodeId);

      if (!node || !progress) return false;

      // Check state
      if (progress.state !== "available" && progress.state !== "purchased") {
        return false;
      }

      // Check max rank
      if (progress.currentRank >= node.maxRank) return false;

      // Check cost
      const costIndex = Math.min(progress.currentRank, node.costs.length - 1);
      const cost = node.costs[costIndex] ? [node.costs[costIndex]] : [];

      if (!canAfford(cost, resourcesRef.current)) return false;

      dispatch({ type: "PURCHASE_NODE", nodeId });
      return true;
    },
    [nodesMap, state.progress],
  );

  const refundNodeFn = useCallback(
    (nodeId: SkillNodeId): boolean => {
      const progress = state.progress.get(nodeId);
      if (!progress || progress.currentRank <= 0) return false;

      if (!canRefundNode(nodeId, nodesMap, state.progress)) return false;

      dispatch({ type: "REFUND_NODE", nodeId });
      return true;
    },
    [nodesMap, state.progress],
  );

  const canPurchaseNodeFn = useCallback(
    (nodeId: SkillNodeId): boolean => {
      const node = nodesMap.get(nodeId);
      const progress = state.progress.get(nodeId);

      if (!node || !progress) return false;
      if (progress.state !== "available" && progress.state !== "purchased")
        return false;
      if (progress.currentRank >= node.maxRank) return false;

      const costIndex = Math.min(progress.currentRank, node.costs.length - 1);
      const cost = node.costs[costIndex] ? [node.costs[costIndex]] : [];

      return canAfford(cost, resourcesRef.current);
    },
    [nodesMap, state.progress],
  );

  const canRefundNodeFn = useCallback(
    (nodeId: SkillNodeId): boolean => {
      const progress = state.progress.get(nodeId);
      if (!progress || progress.currentRank <= 0) return false;
      return canRefundNode(nodeId, nodesMap, state.progress);
    },
    [nodesMap, state.progress],
  );

  const getNodeState = useCallback(
    (nodeId: SkillNodeId): SkillNodeState => {
      return state.progress.get(nodeId)?.state ?? "locked";
    },
    [state.progress],
  );

  const getNodeCost = useCallback(
    (nodeId: SkillNodeId): SkillCost[] => {
      const node = nodesMap.get(nodeId);
      const progress = state.progress.get(nodeId);
      if (!node || !progress) return [];

      const costIndex = Math.min(progress.currentRank, node.costs.length - 1);
      return node.costs[costIndex] ? [node.costs[costIndex]] : [];
    },
    [nodesMap, state.progress],
  );

  const getNodeRefundFn = useCallback(
    (nodeId: SkillNodeId): SkillCost[] => {
      const node = nodesMap.get(nodeId);
      const progress = state.progress.get(nodeId);
      if (!node || !progress) return [];
      return getRefundAmount(node, progress.currentRank, refundRatio);
    },
    [nodesMap, state.progress, refundRatio],
  );

  // Undo/Redo
  const undo = useCallback(() => dispatch({ type: "UNDO" }), []);
  const redo = useCallback(() => dispatch({ type: "REDO" }), []);
  const reset = useCallback(() => dispatch({ type: "RESET" }), []);

  // Path finding
  const findPathTo = useCallback(
    (nodeId: SkillNodeId): NodePath | null => {
      return findPathToNode(
        nodeId,
        nodesMap,
        state.progress,
        tree.startingNodes,
      );
    },
    [nodesMap, state.progress, tree.startingNodes],
  );

  const getCostToNode = useCallback(
    (nodeId: SkillNodeId): SkillCost[] => {
      const path = findPathTo(nodeId);
      if (!path) return [];
      return calculateTotalCost(path.nodes, nodesMap, state.progress);
    },
    [findPathTo, nodesMap, state.progress],
  );

  // Filter
  const setFilter = useCallback((filter: SkillFilterOptions) => {
    dispatch({ type: "SET_FILTER", filter });
  }, []);

  const search = useCallback((query: string) => {
    dispatch({ type: "SET_FILTER", filter: { query } });
  }, []);

  const clearFilter = useCallback(() => {
    dispatch({ type: "SET_FILTER", filter: {} });
  }, []);

  // Viewport
  const setView = useCallback((offset: Point, zoom: number) => {
    dispatch({ type: "SET_VIEW", offset, zoom });
  }, []);

  const pan = useCallback(
    (deltaX: number, deltaY: number) => {
      dispatch({
        type: "SET_VIEW",
        offset: {
          x: state.viewOffset.x + deltaX,
          y: state.viewOffset.y + deltaY,
        },
        zoom: state.zoom,
      });
    },
    [state.viewOffset, state.zoom],
  );

  const setZoom = useCallback(
    (zoom: number) => {
      dispatch({ type: "SET_VIEW", offset: state.viewOffset, zoom });
    },
    [state.viewOffset],
  );

  const centerOnNode = useCallback(
    (nodeId: SkillNodeId) => {
      const node = nodesMap.get(nodeId);
      if (!node) return;

      // Center the view on the node
      dispatch({
        type: "SET_VIEW",
        offset: {
          x: -node.position.x,
          y: -node.position.y,
        },
        zoom: state.zoom,
      });
    },
    [nodesMap, state.zoom],
  );

  const fitToView = useCallback(() => {
    const bounds = tree.layout;
    dispatch({
      type: "SET_VIEW",
      offset: { x: -bounds.width / 2, y: -bounds.height / 2 },
      zoom: 1,
    });
  }, [tree.layout]);

  // Stats
  const stats = useMemo(() => {
    let totalPointsSpent = 0;
    let totalNodesPurchased = 0;
    const nodeStateCounts: Record<SkillNodeState, number> = {
      locked: 0,
      available: 0,
      purchased: 0,
      maxed: 0,
    };

    state.progress.forEach((progress, nodeId) => {
      const node = nodesMap.get(nodeId);
      if (!node) return;

      nodeStateCounts[progress.state]++;

      if (progress.currentRank > 0) {
        totalNodesPurchased++;

        // Sum up costs for all purchased ranks
        for (let i = 0; i < progress.currentRank; i++) {
          const costIndex = Math.min(i, node.costs.length - 1);
          const cost = node.costs[costIndex];
          if (cost && cost.type === "skill_points") {
            totalPointsSpent += cost.amount;
          }
        }
      }
    });

    return { totalPointsSpent, totalNodesPurchased, nodeStateCounts };
  }, [state.progress, nodesMap]);

  return {
    // Node data
    nodes: tree.nodes,
    nodesMap,
    progress: state.progress,
    connections,
    filteredNodes,

    // Selection
    selectedNodeId: state.selectedNodeId,
    selectedNode,
    selectedNodeProgress,
    selectNode,

    // Allocation
    purchaseNode,
    refundNode: refundNodeFn,
    canPurchaseNode: canPurchaseNodeFn,
    canRefundNode: canRefundNodeFn,
    getNodeState,
    getNodeCost,
    getNodeRefund: getNodeRefundFn,

    // Undo/Redo
    undo,
    redo,
    canUndo: state.history.length > 0,
    canRedo: state.redoStack.length > 0,
    reset,

    // Path finding
    findPathTo,
    getCostToNode,

    // Filter
    filter: state.filter,
    setFilter,
    search,
    clearFilter,

    // Viewport
    viewOffset: state.viewOffset,
    zoom: state.zoom,
    setView,
    pan,
    setZoom,
    centerOnNode,
    fitToView,

    // Stats
    ...stats,
  };
}
