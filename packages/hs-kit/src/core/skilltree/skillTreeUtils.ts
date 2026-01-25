/**
 * Skill Tree Utilities
 *
 * Path finding, dependency checking, and layout utilities for skill trees.
 *
 * @packageDocumentation
 */

import type { Point } from "../../types";

// ============================================================================
// Types
// ============================================================================

/** Unique identifier for skill nodes */
export type SkillNodeId = string;

/** State of a skill node */
export type SkillNodeState = "locked" | "available" | "purchased" | "maxed";

/** Cost type for skills */
export interface SkillCost {
  /** Cost type identifier (e.g., "skill_points", "gold", "xp") */
  type: string;
  /** Amount required */
  amount: number;
}

/** Skill node definition */
export interface SkillNodeDef {
  /** Unique identifier */
  id: SkillNodeId;
  /** Display name */
  name: string;
  /** Description text */
  description: string;
  /** Icon (URL or component name) */
  icon: string;
  /** Position in the tree (can be polar or cartesian) */
  position: Point;
  /** Tier/ring level (0 = center, higher = outer rings) */
  tier: number;
  /** IDs of nodes that must be purchased before this one */
  dependencies: SkillNodeId[];
  /** Costs to purchase each rank */
  costs: SkillCost[];
  /** Maximum ranks purchasable (1 = single purchase, >1 = multi-rank) */
  maxRank: number;
  /** Tags for filtering (e.g., ["offense", "fire", "passive"]) */
  tags: string[];
  /** Whether this is a keystone/major node */
  isKeystone?: boolean;
  /** Custom data for application use */
  data?: Record<string, unknown>;
}

/** Current state of a skill node */
export interface SkillNodeProgress {
  /** Node definition ID */
  nodeId: SkillNodeId;
  /** Current rank (0 = not purchased) */
  currentRank: number;
  /** Computed state based on dependencies and rank */
  state: SkillNodeState;
}

/** Connection between two nodes */
export interface SkillConnection {
  /** Source node ID */
  from: SkillNodeId;
  /** Target node ID */
  to: SkillNodeId;
  /** Whether the connection is active (source purchased) */
  active: boolean;
  /** Whether the target is available */
  targetAvailable: boolean;
  /** Whether the connection should be highlighted (target has progress) */
  highlighted: boolean;
  /** Progress percentage of target node (0-100) */
  targetProgress: number;
}

/** Skill tree definition */
export interface SkillTreeDef {
  /** Tree identifier */
  id: string;
  /** Display name */
  name: string;
  /** All nodes in the tree */
  nodes: SkillNodeDef[];
  /** Starting node IDs (no dependencies required) */
  startingNodes: SkillNodeId[];
  /** Layout configuration */
  layout: SkillTreeLayout;
}

/** Layout configuration for skill tree */
export interface SkillTreeLayout {
  /** Layout type */
  type: "radial" | "grid" | "freeform";
  /** Center position for radial layout */
  center?: Point;
  /** Radius step between tiers for radial layout */
  tierRadius?: number;
  /** Grid cell size for grid layout */
  cellSize?: number;
  /** Total width of the tree */
  width: number;
  /** Total height of the tree */
  height: number;
}

/** Path between two nodes */
export interface NodePath {
  /** Ordered list of node IDs from start to end */
  nodes: SkillNodeId[];
  /** Total cost to unlock this path */
  totalCost: SkillCost[];
  /** Number of nodes to purchase */
  nodeCount: number;
}

/** Filter options for nodes */
export interface SkillFilterOptions {
  /** Search query (matches name, description, tags) */
  query?: string;
  /** Filter by tags (OR match) */
  tags?: string[];
  /** Filter by state */
  states?: SkillNodeState[];
  /** Filter by tier */
  tiers?: number[];
  /** Only show keystones */
  keystonesOnly?: boolean;
}

// ============================================================================
// Dependency Checking
// ============================================================================

/**
 * Check if all dependencies for a node are met
 */
export function areDependenciesMet(
  nodeId: SkillNodeId,
  nodes: Map<SkillNodeId, SkillNodeDef>,
  progress: Map<SkillNodeId, SkillNodeProgress>,
): boolean {
  const node = nodes.get(nodeId);
  if (!node) return false;

  // No dependencies means always available
  if (node.dependencies.length === 0) return true;

  // Check each dependency
  return node.dependencies.every((depId) => {
    const depProgress = progress.get(depId);
    return depProgress && depProgress.currentRank > 0;
  });
}

/**
 * Compute the state of a node based on dependencies and progress
 */
export function computeNodeState(
  nodeId: SkillNodeId,
  nodes: Map<SkillNodeId, SkillNodeDef>,
  progress: Map<SkillNodeId, SkillNodeProgress>,
): SkillNodeState {
  const node = nodes.get(nodeId);
  const nodeProgress = progress.get(nodeId);

  if (!node) return "locked";

  const currentRank = nodeProgress?.currentRank ?? 0;

  // Maxed out
  if (currentRank >= node.maxRank) return "maxed";

  // Has at least one rank purchased
  if (currentRank > 0) return "purchased";

  // Check dependencies
  if (areDependenciesMet(nodeId, nodes, progress)) return "available";

  return "locked";
}

/**
 * Get all nodes that depend on a given node
 */
export function getDependentNodes(
  nodeId: SkillNodeId,
  nodes: Map<SkillNodeId, SkillNodeDef>,
): SkillNodeId[] {
  const dependents: SkillNodeId[] = [];

  nodes.forEach((node, id) => {
    if (node.dependencies.includes(nodeId)) {
      dependents.push(id);
    }
  });

  return dependents;
}

/**
 * Check if a node can be safely refunded without breaking dependencies
 */
export function canRefundNode(
  nodeId: SkillNodeId,
  nodes: Map<SkillNodeId, SkillNodeDef>,
  progress: Map<SkillNodeId, SkillNodeProgress>,
): boolean {
  const dependents = getDependentNodes(nodeId, nodes);

  // Check if any dependent node has been purchased
  return !dependents.some((depId) => {
    const depProgress = progress.get(depId);
    return depProgress && depProgress.currentRank > 0;
  });
}

// ============================================================================
// Path Finding
// ============================================================================

/**
 * Find the shortest path from a starting position to a target node
 * Uses BFS to find the path with minimum node count
 */
export function findPathToNode(
  targetId: SkillNodeId,
  nodes: Map<SkillNodeId, SkillNodeDef>,
  progress: Map<SkillNodeId, SkillNodeProgress>,
  startingNodes: SkillNodeId[],
): NodePath | null {
  // If target doesn't exist, return null
  const targetNode = nodes.get(targetId);
  if (!targetNode) return null;

  // If already purchased or available, return empty path
  const targetProgress = progress.get(targetId);
  if (targetProgress && targetProgress.currentRank > 0) {
    return { nodes: [], totalCost: [], nodeCount: 0 };
  }
  if (areDependenciesMet(targetId, nodes, progress)) {
    return {
      nodes: [targetId],
      totalCost: [...targetNode.costs],
      nodeCount: 1,
    };
  }

  // BFS from starting nodes
  const visited = new Set<SkillNodeId>();
  const parent = new Map<SkillNodeId, SkillNodeId | null>();

  // Start from purchased nodes and starting nodes
  const queue: SkillNodeId[] = [];

  // Add all purchased nodes as starting points
  progress.forEach((p, id) => {
    if (p.currentRank > 0) {
      queue.push(id);
      visited.add(id);
      parent.set(id, null);
    }
  });

  // Add starting nodes if not already purchased
  startingNodes.forEach((id) => {
    if (!visited.has(id)) {
      queue.push(id);
      visited.add(id);
      parent.set(id, null);
    }
  });

  // BFS
  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const currentNode = nodes.get(currentId);
    if (!currentNode) continue;

    // Get nodes that can be unlocked from this one
    const unlockable: SkillNodeId[] = [];
    nodes.forEach((node, id) => {
      if (!visited.has(id) && node.dependencies.includes(currentId)) {
        unlockable.push(id);
      }
    });

    for (const nextId of unlockable) {
      const nextNode = nodes.get(nextId);
      if (!nextNode) continue;

      // Check if all other dependencies are met or in the path
      const otherDeps = nextNode.dependencies.filter((d) => d !== currentId);
      const allDepsOk = otherDeps.every((depId) => {
        const depProgress = progress.get(depId);
        return (
          (depProgress && depProgress.currentRank > 0) || visited.has(depId)
        );
      });

      if (allDepsOk) {
        visited.add(nextId);
        parent.set(nextId, currentId);
        queue.push(nextId);

        // Found target
        if (nextId === targetId) {
          // Reconstruct path
          const path: SkillNodeId[] = [];
          const costs: SkillCost[] = [];
          let current: SkillNodeId | null = targetId;

          while (current !== null) {
            const node = nodes.get(current);
            const prog = progress.get(current);
            // Only add nodes that aren't already purchased
            if (node && (!prog || prog.currentRank === 0)) {
              path.unshift(current);
              node.costs.forEach((cost) => {
                const existing = costs.find((c) => c.type === cost.type);
                if (existing) {
                  existing.amount += cost.amount;
                } else {
                  costs.push({ ...cost });
                }
              });
            }
            current = parent.get(current) ?? null;
          }

          return {
            nodes: path,
            totalCost: costs,
            nodeCount: path.length,
          };
        }
      }
    }
  }

  // No path found
  return null;
}

/**
 * Get all connections between nodes
 */
export function getConnections(
  nodes: Map<SkillNodeId, SkillNodeDef>,
  progress: Map<SkillNodeId, SkillNodeProgress>,
): SkillConnection[] {
  const connections: SkillConnection[] = [];

  nodes.forEach((node) => {
    node.dependencies.forEach((depId) => {
      const depProgress = progress.get(depId);
      const nodeProgress = progress.get(node.id);

      const active = depProgress ? depProgress.currentRank > 0 : false;
      const targetState = computeNodeState(node.id, nodes, progress);

      // Calculate if target node has progress (highlighted) and progress percentage
      const hasProgress = nodeProgress ? nodeProgress.currentRank > 0 : false;
      const targetMaxRank = node.maxRank || 1;
      const targetCurrentRank = nodeProgress?.currentRank || 0;
      const targetProgress = (targetCurrentRank / targetMaxRank) * 100;

      connections.push({
        from: depId,
        to: node.id,
        active,
        targetAvailable:
          targetState === "available" ||
          targetState === "purchased" ||
          targetState === "maxed",
        highlighted: hasProgress && targetCurrentRank < targetMaxRank, // Highlight if progressing but not maxed
        targetProgress,
      });
    });
  });

  return connections;
}

// ============================================================================
// Filtering
// ============================================================================

/**
 * Filter nodes based on search and filter criteria
 */
export function filterNodes(
  nodes: SkillNodeDef[],
  progress: Map<SkillNodeId, SkillNodeProgress>,
  options: SkillFilterOptions,
): SkillNodeDef[] {
  return nodes.filter((node) => {
    // Query filter
    if (options.query) {
      const query = options.query.toLowerCase();
      const matchesName = node.name.toLowerCase().includes(query);
      const matchesDesc = node.description.toLowerCase().includes(query);
      const matchesTags = node.tags.some((t) =>
        t.toLowerCase().includes(query),
      );
      if (!matchesName && !matchesDesc && !matchesTags) return false;
    }

    // Tags filter (OR match)
    if (options.tags && options.tags.length > 0) {
      const hasMatchingTag = options.tags.some((tag) =>
        node.tags.includes(tag),
      );
      if (!hasMatchingTag) return false;
    }

    // State filter
    if (options.states && options.states.length > 0) {
      const nodeProgress = progress.get(node.id);
      const state = nodeProgress?.state ?? "locked";
      if (!options.states.includes(state)) return false;
    }

    // Tier filter
    if (options.tiers && options.tiers.length > 0) {
      if (!options.tiers.includes(node.tier)) return false;
    }

    // Keystones only
    if (options.keystonesOnly && !node.isKeystone) return false;

    return true;
  });
}

// ============================================================================
// Layout Utilities
// ============================================================================

/**
 * Convert polar coordinates to cartesian
 */
export function polarToCartesian(
  centerX: number,
  centerY: number,
  radius: number,
  angleInDegrees: number,
): Point {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180;
  return {
    x: centerX + radius * Math.cos(angleInRadians),
    y: centerY + radius * Math.sin(angleInRadians),
  };
}

/**
 * Calculate positions for nodes in a radial layout
 */
export function calculateRadialLayout(
  nodes: SkillNodeDef[],
  layout: SkillTreeLayout,
): Map<SkillNodeId, Point> {
  const positions = new Map<SkillNodeId, Point>();
  const center = layout.center ?? { x: layout.width / 2, y: layout.height / 2 };
  const tierRadius = layout.tierRadius ?? 100;

  // Group nodes by tier
  const tiers = new Map<number, SkillNodeDef[]>();
  nodes.forEach((node) => {
    const tierNodes = tiers.get(node.tier) || [];
    tierNodes.push(node);
    tiers.set(node.tier, tierNodes);
  });

  // Position nodes in each tier
  tiers.forEach((tierNodes, tier) => {
    const radius = tier * tierRadius;
    const angleStep = 360 / tierNodes.length;

    tierNodes.forEach((node, index) => {
      if (tier === 0) {
        // Center node
        positions.set(node.id, { x: center.x, y: center.y });
      } else {
        const angle = index * angleStep;
        positions.set(
          node.id,
          polarToCartesian(center.x, center.y, radius, angle),
        );
      }
    });
  });

  return positions;
}

/**
 * Calculate SVG path for a connection between two nodes
 */
export function calculateConnectionPath(
  from: Point,
  to: Point,
  curved: boolean = true,
): string {
  if (!curved) {
    return `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
  }

  // Calculate curved path using quadratic bezier
  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2;

  // Add some curvature perpendicular to the line
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.sqrt(dx * dx + dy * dy);

  // Perpendicular offset (adjustable)
  const offset = length * 0.15;
  const controlX = midX + (-dy / length) * offset;
  const controlY = midY + (dx / length) * offset;

  return `M ${from.x} ${from.y} Q ${controlX} ${controlY} ${to.x} ${to.y}`;
}

/**
 * Get the bounding box of all nodes
 */
export function getTreeBounds(
  nodes: SkillNodeDef[],
  nodeRadius: number = 30,
): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
} {
  if (nodes.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  nodes.forEach((node) => {
    minX = Math.min(minX, node.position.x - nodeRadius);
    minY = Math.min(minY, node.position.y - nodeRadius);
    maxX = Math.max(maxX, node.position.x + nodeRadius);
    maxY = Math.max(maxY, node.position.y + nodeRadius);
  });

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

// ============================================================================
// Cost Utilities
// ============================================================================

/**
 * Calculate total cost to purchase a set of nodes
 */
export function calculateTotalCost(
  nodeIds: SkillNodeId[],
  nodes: Map<SkillNodeId, SkillNodeDef>,
  progress: Map<SkillNodeId, SkillNodeProgress>,
): SkillCost[] {
  const costs: SkillCost[] = [];

  nodeIds.forEach((nodeId) => {
    const node = nodes.get(nodeId);
    const nodeProgress = progress.get(nodeId);
    if (!node) return;

    const currentRank = nodeProgress?.currentRank ?? 0;
    if (currentRank >= node.maxRank) return;

    // Get cost for next rank
    const costIndex = Math.min(currentRank, node.costs.length - 1);
    const nodeCost = node.costs[costIndex];

    if (nodeCost) {
      const existing = costs.find((c) => c.type === nodeCost.type);
      if (existing) {
        existing.amount += nodeCost.amount;
      } else {
        costs.push({ ...nodeCost });
      }
    }
  });

  return costs;
}

/**
 * Check if player has enough resources for a cost
 */
export function canAfford(
  cost: SkillCost[],
  resources: Map<string, number>,
): boolean {
  return cost.every((c) => {
    const available = resources.get(c.type) ?? 0;
    return available >= c.amount;
  });
}

/**
 * Get the refund amount for a node at a given rank
 */
export function getRefundAmount(
  node: SkillNodeDef,
  currentRank: number,
  refundRatio: number = 1.0,
): SkillCost[] {
  if (currentRank <= 0) return [];

  // Sum up costs for all purchased ranks
  const costs: SkillCost[] = [];

  for (let i = 0; i < currentRank; i++) {
    const costIndex = Math.min(i, node.costs.length - 1);
    const rankCost = node.costs[costIndex];

    if (rankCost) {
      const existing = costs.find((c) => c.type === rankCost.type);
      if (existing) {
        existing.amount += Math.floor(rankCost.amount * refundRatio);
      } else {
        costs.push({
          type: rankCost.type,
          amount: Math.floor(rankCost.amount * refundRatio),
        });
      }
    }
  }

  return costs;
}
