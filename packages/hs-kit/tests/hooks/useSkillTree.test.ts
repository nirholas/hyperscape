import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSkillTree } from "../../src/core/skilltree/useSkillTree";
import type {
  SkillTreeDef,
  SkillNodeDef,
  SkillNodeProgress,
} from "../../src/core/skilltree/skillTreeUtils";

// ============================================================================
// Test Fixtures
// ============================================================================

function createTestTree(): SkillTreeDef {
  return {
    id: "test-tree",
    name: "Test Skill Tree",
    startingNodes: ["node-1"],
    layout: {
      type: "radial",
      width: 800,
      height: 600,
      center: { x: 400, y: 300 },
      tierRadius: 100,
    },
    nodes: [
      {
        id: "node-1",
        name: "Basic Skill",
        description: "A basic starting skill",
        icon: "🔥",
        position: { x: 400, y: 300 },
        tier: 0,
        dependencies: [],
        costs: [{ type: "skill_points", amount: 1 }],
        maxRank: 1,
        tags: ["fire", "basic"],
      },
      {
        id: "node-2",
        name: "Advanced Skill",
        description: "An advanced skill",
        icon: "🔮",
        position: { x: 500, y: 300 },
        tier: 1,
        dependencies: ["node-1"],
        costs: [{ type: "skill_points", amount: 2 }],
        maxRank: 1,
        tags: ["magic", "advanced"],
      },
      {
        id: "node-3",
        name: "Multi-Rank Skill",
        description: "A skill with multiple ranks",
        icon: "⚡",
        position: { x: 400, y: 200 },
        tier: 1,
        dependencies: ["node-1"],
        costs: [
          { type: "skill_points", amount: 1 },
          { type: "skill_points", amount: 2 },
          { type: "skill_points", amount: 3 },
        ],
        maxRank: 3,
        tags: ["lightning", "multi"],
        isKeystone: true,
      },
      {
        id: "node-4",
        name: "Final Skill",
        description: "A skill requiring multiple prerequisites",
        icon: "💀",
        position: { x: 500, y: 200 },
        tier: 2,
        dependencies: ["node-2", "node-3"],
        costs: [{ type: "skill_points", amount: 5 }],
        maxRank: 1,
        tags: ["ultimate"],
      },
    ],
  };
}

function createResources(points: number = 100): Map<string, number> {
  return new Map([["skill_points", points]]);
}

// ============================================================================
// Tests
// ============================================================================

describe("useSkillTree", () => {
  let testTree: SkillTreeDef;
  let resources: Map<string, number>;

  beforeEach(() => {
    testTree = createTestTree();
    resources = createResources();
  });

  describe("initialization", () => {
    it("should initialize with all nodes", () => {
      const { result } = renderHook(() =>
        useSkillTree({ tree: testTree, resources }),
      );

      expect(result.current.nodes.length).toBe(4);
      expect(result.current.nodesMap.size).toBe(4);
    });

    it("should initialize starting nodes as available", () => {
      const { result } = renderHook(() =>
        useSkillTree({ tree: testTree, resources }),
      );

      const node1Progress = result.current.progress.get("node-1");
      expect(node1Progress?.state).toBe("available");
    });

    it("should initialize dependent nodes as locked", () => {
      const { result } = renderHook(() =>
        useSkillTree({ tree: testTree, resources }),
      );

      const node2Progress = result.current.progress.get("node-2");
      expect(node2Progress?.state).toBe("locked");
    });

    it("should initialize with provided progress", () => {
      const initialProgress = new Map<string, SkillNodeProgress>([
        ["node-1", { nodeId: "node-1", currentRank: 1, state: "purchased" }],
      ]);

      const { result } = renderHook(() =>
        useSkillTree({ tree: testTree, resources, initialProgress }),
      );

      const node1Progress = result.current.progress.get("node-1");
      expect(node1Progress?.currentRank).toBe(1);
    });
  });

  describe("node state", () => {
    it("should correctly compute node states", () => {
      const { result } = renderHook(() =>
        useSkillTree({ tree: testTree, resources }),
      );

      expect(result.current.getNodeState("node-1")).toBe("available");
      expect(result.current.getNodeState("node-2")).toBe("locked");
    });

    it("should update dependent node states when prerequisite is purchased", () => {
      const { result } = renderHook(() =>
        useSkillTree({ tree: testTree, resources }),
      );

      // Purchase node-1
      act(() => {
        result.current.purchaseNode("node-1");
      });

      // node-2 and node-3 should now be available
      expect(result.current.getNodeState("node-2")).toBe("available");
      expect(result.current.getNodeState("node-3")).toBe("available");
    });
  });

  describe("purchasing nodes", () => {
    it("should purchase available nodes", () => {
      const { result } = renderHook(() =>
        useSkillTree({ tree: testTree, resources }),
      );

      act(() => {
        const success = result.current.purchaseNode("node-1");
        expect(success).toBe(true);
      });

      const progress = result.current.progress.get("node-1");
      expect(progress?.currentRank).toBe(1);
      expect(progress?.state).toBe("maxed");
    });

    it("should not purchase locked nodes", () => {
      const { result } = renderHook(() =>
        useSkillTree({ tree: testTree, resources }),
      );

      act(() => {
        const success = result.current.purchaseNode("node-2");
        expect(success).toBe(false);
      });

      const progress = result.current.progress.get("node-2");
      expect(progress?.currentRank).toBe(0);
    });

    it("should increment rank for multi-rank nodes", () => {
      const { result } = renderHook(() =>
        useSkillTree({ tree: testTree, resources }),
      );

      // Purchase node-1 to unlock node-3
      act(() => {
        result.current.purchaseNode("node-1");
      });

      // Purchase node-3 three times
      act(() => {
        result.current.purchaseNode("node-3");
      });
      expect(result.current.progress.get("node-3")?.currentRank).toBe(1);

      act(() => {
        result.current.purchaseNode("node-3");
      });
      expect(result.current.progress.get("node-3")?.currentRank).toBe(2);

      act(() => {
        result.current.purchaseNode("node-3");
      });
      expect(result.current.progress.get("node-3")?.currentRank).toBe(3);
      expect(result.current.progress.get("node-3")?.state).toBe("maxed");
    });

    it("should not purchase when resources are insufficient", () => {
      const lowResources = createResources(0);
      const { result } = renderHook(() =>
        useSkillTree({ tree: testTree, resources: lowResources }),
      );

      act(() => {
        const success = result.current.purchaseNode("node-1");
        expect(success).toBe(false);
      });

      expect(result.current.progress.get("node-1")?.currentRank).toBe(0);
    });

    it("should call onPurchase callback", () => {
      const onPurchase = vi.fn();
      const { result } = renderHook(() =>
        useSkillTree({ tree: testTree, resources, onPurchase }),
      );

      act(() => {
        result.current.purchaseNode("node-1");
      });

      expect(onPurchase).toHaveBeenCalledWith("node-1", [
        { type: "skill_points", amount: 1 },
      ]);
    });
  });

  describe("refunding nodes", () => {
    it("should refund purchased nodes", () => {
      const onRefund = vi.fn();
      const { result } = renderHook(() =>
        useSkillTree({ tree: testTree, resources, onRefund }),
      );

      // Purchase then refund
      act(() => {
        result.current.purchaseNode("node-1");
      });

      act(() => {
        const success = result.current.refundNode("node-1");
        expect(success).toBe(true);
      });

      expect(result.current.progress.get("node-1")?.currentRank).toBe(0);
      expect(onRefund).toHaveBeenCalled();
    });

    it("should not refund nodes with purchased dependents", () => {
      const { result } = renderHook(() =>
        useSkillTree({ tree: testTree, resources }),
      );

      // Purchase node-1 first
      act(() => {
        result.current.purchaseNode("node-1");
      });

      // Now purchase node-2 (which depends on node-1)
      act(() => {
        result.current.purchaseNode("node-2");
      });

      // Verify both are purchased
      expect(result.current.progress.get("node-1")?.currentRank).toBe(1);
      expect(result.current.progress.get("node-2")?.currentRank).toBe(1);

      // Should not be able to refund node-1 because node-2 depends on it
      const success = result.current.canRefundNode("node-1");
      expect(success).toBe(false);

      // Attempt to refund should fail
      act(() => {
        result.current.refundNode("node-1");
      });

      // node-1 should still be purchased
      expect(result.current.progress.get("node-1")?.currentRank).toBe(1);
    });

    it("should apply refund ratio", () => {
      const onRefund = vi.fn();
      const { result } = renderHook(() =>
        useSkillTree({ tree: testTree, resources, onRefund, refundRatio: 0.5 }),
      );

      act(() => {
        result.current.purchaseNode("node-1");
      });

      act(() => {
        result.current.refundNode("node-1");
      });

      // Refund should be 0.5 * 1 = 0 (floor)
      expect(onRefund).toHaveBeenCalledWith("node-1", [
        { type: "skill_points", amount: 0 },
      ]);
    });
  });

  describe("undo/redo", () => {
    it("should undo purchase", () => {
      const { result } = renderHook(() =>
        useSkillTree({ tree: testTree, resources }),
      );

      act(() => {
        result.current.purchaseNode("node-1");
      });
      expect(result.current.progress.get("node-1")?.currentRank).toBe(1);

      act(() => {
        result.current.undo();
      });
      expect(result.current.progress.get("node-1")?.currentRank).toBe(0);
    });

    it("should redo undone purchase", () => {
      const { result } = renderHook(() =>
        useSkillTree({ tree: testTree, resources }),
      );

      act(() => {
        result.current.purchaseNode("node-1");
      });

      act(() => {
        result.current.undo();
      });
      expect(result.current.progress.get("node-1")?.currentRank).toBe(0);

      act(() => {
        result.current.redo();
      });
      expect(result.current.progress.get("node-1")?.currentRank).toBe(1);
    });

    it("should report canUndo/canRedo correctly", () => {
      const { result } = renderHook(() =>
        useSkillTree({ tree: testTree, resources }),
      );

      expect(result.current.canUndo).toBe(false);
      expect(result.current.canRedo).toBe(false);

      act(() => {
        result.current.purchaseNode("node-1");
      });
      expect(result.current.canUndo).toBe(true);
      expect(result.current.canRedo).toBe(false);

      act(() => {
        result.current.undo();
      });
      expect(result.current.canUndo).toBe(false);
      expect(result.current.canRedo).toBe(true);
    });

    it("should clear redo stack on new purchase", () => {
      const { result } = renderHook(() =>
        useSkillTree({ tree: testTree, resources }),
      );

      // Purchase node-1
      act(() => {
        result.current.purchaseNode("node-1");
      });
      expect(result.current.progress.get("node-1")?.currentRank).toBe(1);

      // Undo
      act(() => {
        result.current.undo();
      });
      expect(result.current.progress.get("node-1")?.currentRank).toBe(0);
      expect(result.current.canRedo).toBe(true);

      // New purchase should clear redo stack
      // Note: Since node-1 is back to 0 and available, we can purchase it again
      act(() => {
        const success = result.current.purchaseNode("node-1");
        expect(success).toBe(true);
      });

      // After a new action, redo stack should be cleared
      expect(result.current.canRedo).toBe(false);
    });
  });

  describe("reset", () => {
    it("should reset all progress", () => {
      const { result } = renderHook(() =>
        useSkillTree({ tree: testTree, resources }),
      );

      act(() => {
        result.current.purchaseNode("node-1");
        result.current.purchaseNode("node-2");
      });

      act(() => {
        result.current.reset();
      });

      expect(result.current.progress.get("node-1")?.currentRank).toBe(0);
      expect(result.current.progress.get("node-2")?.currentRank).toBe(0);
      expect(result.current.canUndo).toBe(false);
      expect(result.current.canRedo).toBe(false);
    });
  });

  describe("selection", () => {
    it("should select and deselect nodes", () => {
      const { result } = renderHook(() =>
        useSkillTree({ tree: testTree, resources }),
      );

      expect(result.current.selectedNodeId).toBe(null);

      act(() => {
        result.current.selectNode("node-1");
      });
      expect(result.current.selectedNodeId).toBe("node-1");
      expect(result.current.selectedNode?.name).toBe("Basic Skill");

      act(() => {
        result.current.selectNode(null);
      });
      expect(result.current.selectedNodeId).toBe(null);
    });
  });

  describe("filtering", () => {
    it("should filter by query", () => {
      const { result } = renderHook(() =>
        useSkillTree({ tree: testTree, resources }),
      );

      act(() => {
        result.current.search("advanced");
      });

      expect(result.current.filteredNodes.length).toBe(1);
      expect(result.current.filteredNodes[0].name).toBe("Advanced Skill");
    });

    it("should filter by tags", () => {
      const { result } = renderHook(() =>
        useSkillTree({ tree: testTree, resources }),
      );

      act(() => {
        result.current.setFilter({ tags: ["fire"] });
      });

      expect(result.current.filteredNodes.length).toBe(1);
      expect(result.current.filteredNodes[0].id).toBe("node-1");
    });

    it("should clear filter", () => {
      const { result } = renderHook(() =>
        useSkillTree({ tree: testTree, resources }),
      );

      act(() => {
        result.current.search("advanced");
      });
      expect(result.current.filteredNodes.length).toBe(1);

      act(() => {
        result.current.clearFilter();
      });
      expect(result.current.filteredNodes.length).toBe(4);
    });
  });

  describe("path finding", () => {
    it("should find path to locked node", () => {
      const { result } = renderHook(() =>
        useSkillTree({ tree: testTree, resources }),
      );

      const path = result.current.findPathTo("node-2");
      expect(path).not.toBe(null);
      expect(path?.nodes).toContain("node-1");
      expect(path?.nodes).toContain("node-2");
    });

    it("should return empty path for already available node", () => {
      const { result } = renderHook(() =>
        useSkillTree({ tree: testTree, resources }),
      );

      const path = result.current.findPathTo("node-1");
      expect(path?.nodes.length).toBe(1);
    });

    it("should calculate cost to node", () => {
      const { result } = renderHook(() =>
        useSkillTree({ tree: testTree, resources }),
      );

      const cost = result.current.getCostToNode("node-2");
      expect(cost.length).toBeGreaterThan(0);
      expect(cost[0].type).toBe("skill_points");
      expect(cost[0].amount).toBeGreaterThanOrEqual(3); // node-1 (1) + node-2 (2)
    });
  });

  describe("viewport", () => {
    it("should pan view", () => {
      const { result } = renderHook(() =>
        useSkillTree({ tree: testTree, resources }),
      );

      expect(result.current.viewOffset).toEqual({ x: 0, y: 0 });

      act(() => {
        result.current.pan(100, 50);
      });

      expect(result.current.viewOffset).toEqual({ x: 100, y: 50 });
    });

    it("should zoom view", () => {
      const { result } = renderHook(() =>
        useSkillTree({ tree: testTree, resources }),
      );

      expect(result.current.zoom).toBe(1);

      act(() => {
        result.current.setZoom(1.5);
      });

      expect(result.current.zoom).toBe(1.5);
    });

    it("should clamp zoom to bounds", () => {
      const { result } = renderHook(() =>
        useSkillTree({ tree: testTree, resources }),
      );

      act(() => {
        result.current.setZoom(10);
      });
      expect(result.current.zoom).toBe(3); // Max zoom

      act(() => {
        result.current.setZoom(0.01);
      });
      expect(result.current.zoom).toBe(0.1); // Min zoom
    });
  });

  describe("stats", () => {
    it("should calculate total points spent", () => {
      const { result } = renderHook(() =>
        useSkillTree({ tree: testTree, resources }),
      );

      expect(result.current.totalPointsSpent).toBe(0);

      // Purchase node-1 first (1 point)
      act(() => {
        result.current.purchaseNode("node-1");
      });

      // Then purchase node-2 (2 points) - it depends on node-1
      act(() => {
        result.current.purchaseNode("node-2");
      });

      expect(result.current.totalPointsSpent).toBe(3);
    });

    it("should calculate total nodes purchased", () => {
      const { result } = renderHook(() =>
        useSkillTree({ tree: testTree, resources }),
      );

      expect(result.current.totalNodesPurchased).toBe(0);

      // Purchase node-1 first
      act(() => {
        result.current.purchaseNode("node-1");
      });

      // Then purchase node-2 (depends on node-1)
      act(() => {
        result.current.purchaseNode("node-2");
      });

      expect(result.current.totalNodesPurchased).toBe(2);
    });

    it("should track node state counts", () => {
      const { result } = renderHook(() =>
        useSkillTree({ tree: testTree, resources }),
      );

      // Initial state
      expect(result.current.nodeStateCounts.available).toBe(1);
      expect(result.current.nodeStateCounts.locked).toBe(3);

      act(() => {
        result.current.purchaseNode("node-1");
      });

      expect(result.current.nodeStateCounts.maxed).toBe(1);
      expect(result.current.nodeStateCounts.available).toBe(2);
      expect(result.current.nodeStateCounts.locked).toBe(1);
    });
  });

  describe("connections", () => {
    it("should generate connections from node dependencies", () => {
      const { result } = renderHook(() =>
        useSkillTree({ tree: testTree, resources }),
      );

      // Should have connections: node-1->node-2, node-1->node-3, node-2->node-4, node-3->node-4
      expect(result.current.connections.length).toBe(4);
    });

    it("should mark connections as active when source is purchased", () => {
      const { result } = renderHook(() =>
        useSkillTree({ tree: testTree, resources }),
      );

      // Initially no active connections
      const initialActive = result.current.connections.filter((c) => c.active);
      expect(initialActive.length).toBe(0);

      act(() => {
        result.current.purchaseNode("node-1");
      });

      // Connections from node-1 should now be active
      const activeConnections = result.current.connections.filter(
        (c) => c.active,
      );
      expect(activeConnections.length).toBe(2); // node-1->node-2, node-1->node-3
    });
  });
});
