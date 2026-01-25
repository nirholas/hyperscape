/**
 * Skill Tree System
 *
 * Hooks and utilities for building skill/talent trees.
 *
 * @packageDocumentation
 */

// Utilities and types
export {
  // Types
  type SkillNodeId,
  type SkillNodeState,
  type SkillCost,
  type SkillNodeDef,
  type SkillNodeProgress,
  type SkillConnection,
  type SkillTreeDef,
  type SkillTreeLayout,
  type NodePath,
  type SkillFilterOptions,
  // Dependency checking
  areDependenciesMet,
  computeNodeState,
  getDependentNodes,
  canRefundNode,
  // Path finding
  findPathToNode,
  getConnections,
  // Filtering
  filterNodes,
  // Layout
  polarToCartesian,
  calculateRadialLayout,
  calculateConnectionPath,
  getTreeBounds,
  // Cost utilities
  calculateTotalCost,
  canAfford,
  getRefundAmount,
} from "./skillTreeUtils";

// Main skill tree hook
export {
  useSkillTree,
  type UseSkillTreeOptions,
  type UseSkillTreeResult,
} from "./useSkillTree";

// Individual node hook
export {
  useSkillNode,
  type UseSkillNodeOptions,
  type UseSkillNodeResult,
} from "./useSkillNode";
