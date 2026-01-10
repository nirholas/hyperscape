/**
 * InventoryActionDispatcher Unit Tests
 *
 * Tests for centralized inventory action dispatching.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  dispatchInventoryAction,
  type InventoryActionContext,
} from "../InventoryActionDispatcher";
import { EventType } from "@hyperscape/shared";

// Mock world object
function createMockWorld(overrides: Partial<MockWorld> = {}): MockWorld {
  return {
    getPlayer: vi.fn(() => ({ id: "player1" })),
    emit: vi.fn(),
    network: {
      send: vi.fn(),
      dropItem: vi.fn(),
    },
    chat: {
      add: vi.fn(),
    },
    ...overrides,
  };
}

interface MockWorld {
  getPlayer: ReturnType<typeof vi.fn>;
  emit: ReturnType<typeof vi.fn>;
  network: {
    send: ReturnType<typeof vi.fn>;
    dropItem?: ReturnType<typeof vi.fn>;
  } | null;
  chat: {
    add: ReturnType<typeof vi.fn>;
  } | null;
}

describe("InventoryActionDispatcher", () => {
  let mockWorld: MockWorld;

  beforeEach(() => {
    mockWorld = createMockWorld();
  });

  // ===========================================================================
  // EAT / DRINK ACTIONS
  // ===========================================================================

  describe("eat action", () => {
    it("emits ITEM_ACTION_SELECTED event", () => {
      const result = dispatchInventoryAction("eat", {
        world: mockWorld as unknown as InventoryActionContext["world"],
        itemId: "shrimp",
        slot: 0,
      });

      expect(result.success).toBe(true);
      expect(mockWorld.emit).toHaveBeenCalledWith(
        EventType.ITEM_ACTION_SELECTED,
        {
          playerId: "player1",
          actionId: "eat",
          itemId: "shrimp",
          slot: 0,
        },
      );
    });
  });

  describe("drink action", () => {
    it("emits ITEM_ACTION_SELECTED event", () => {
      const result = dispatchInventoryAction("drink", {
        world: mockWorld as unknown as InventoryActionContext["world"],
        itemId: "strength_potion",
        slot: 5,
      });

      expect(result.success).toBe(true);
      expect(mockWorld.emit).toHaveBeenCalledWith(
        EventType.ITEM_ACTION_SELECTED,
        {
          playerId: "player1",
          actionId: "drink",
          itemId: "strength_potion",
          slot: 5,
        },
      );
    });
  });

  // ===========================================================================
  // BURY ACTION
  // ===========================================================================

  describe("bury action", () => {
    it("sends buryBones network message", () => {
      const result = dispatchInventoryAction("bury", {
        world: mockWorld as unknown as InventoryActionContext["world"],
        itemId: "bones",
        slot: 3,
      });

      expect(result.success).toBe(true);
      expect(mockWorld.network?.send).toHaveBeenCalledWith("buryBones", {
        itemId: "bones",
        slot: 3,
      });
    });
  });

  // ===========================================================================
  // WIELD / WEAR ACTIONS
  // ===========================================================================

  describe("wield action", () => {
    it("sends equipItem network message", () => {
      const result = dispatchInventoryAction("wield", {
        world: mockWorld as unknown as InventoryActionContext["world"],
        itemId: "bronze_sword",
        slot: 10,
      });

      expect(result.success).toBe(true);
      expect(mockWorld.network?.send).toHaveBeenCalledWith("equipItem", {
        playerId: "player1",
        itemId: "bronze_sword",
        inventorySlot: 10,
      });
    });
  });

  describe("wear action", () => {
    it("sends equipItem network message", () => {
      const result = dispatchInventoryAction("wear", {
        world: mockWorld as unknown as InventoryActionContext["world"],
        itemId: "bronze_platebody",
        slot: 15,
      });

      expect(result.success).toBe(true);
      expect(mockWorld.network?.send).toHaveBeenCalledWith("equipItem", {
        playerId: "player1",
        itemId: "bronze_platebody",
        inventorySlot: 15,
      });
    });
  });

  // ===========================================================================
  // DROP ACTION
  // ===========================================================================

  describe("drop action", () => {
    it("uses dropItem method when available", () => {
      const result = dispatchInventoryAction("drop", {
        world: mockWorld as unknown as InventoryActionContext["world"],
        itemId: "coins",
        slot: 20,
        quantity: 100,
      });

      expect(result.success).toBe(true);
      expect(mockWorld.network?.dropItem).toHaveBeenCalledWith(
        "coins",
        20,
        100,
      );
    });

    it("falls back to network.send when dropItem not available", () => {
      const worldWithoutDropItem = createMockWorld({
        network: {
          send: vi.fn(),
        },
      });

      const result = dispatchInventoryAction("drop", {
        world:
          worldWithoutDropItem as unknown as InventoryActionContext["world"],
        itemId: "logs",
        slot: 5,
        quantity: 10,
      });

      expect(result.success).toBe(true);
      expect(worldWithoutDropItem.network?.send).toHaveBeenCalledWith(
        "dropItem",
        {
          itemId: "logs",
          slot: 5,
          quantity: 10,
        },
      );
    });

    it("defaults quantity to 1", () => {
      const result = dispatchInventoryAction("drop", {
        world: mockWorld as unknown as InventoryActionContext["world"],
        itemId: "bronze_sword",
        slot: 0,
      });

      expect(result.success).toBe(true);
      expect(mockWorld.network?.dropItem).toHaveBeenCalledWith(
        "bronze_sword",
        0,
        1,
      );
    });
  });

  // ===========================================================================
  // EXAMINE ACTION
  // ===========================================================================

  describe("examine action", () => {
    it("emits UI_TOAST and adds chat message", () => {
      const result = dispatchInventoryAction("examine", {
        world: mockWorld as unknown as InventoryActionContext["world"],
        itemId: "bronze_sword",
        slot: 0,
      });

      expect(result.success).toBe(true);
      expect(mockWorld.emit).toHaveBeenCalledWith(
        EventType.UI_TOAST,
        expect.objectContaining({
          type: "info",
        }),
      );
      expect(mockWorld.chat?.add).toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // USE ACTION
  // ===========================================================================

  describe("use action", () => {
    it("emits ITEM_ACTION_SELECTED event for targeting mode", () => {
      const result = dispatchInventoryAction("use", {
        world: mockWorld as unknown as InventoryActionContext["world"],
        itemId: "tinderbox",
        slot: 2,
      });

      expect(result.success).toBe(true);
      expect(mockWorld.emit).toHaveBeenCalledWith(
        EventType.ITEM_ACTION_SELECTED,
        {
          playerId: "player1",
          actionId: "use",
          itemId: "tinderbox",
          slot: 2,
        },
      );
    });
  });

  // ===========================================================================
  // CANCEL ACTION
  // ===========================================================================

  describe("cancel action", () => {
    it("returns success without any side effects", () => {
      const result = dispatchInventoryAction("cancel", {
        world: mockWorld as unknown as InventoryActionContext["world"],
        itemId: "anything",
        slot: 0,
      });

      expect(result.success).toBe(true);
      expect(mockWorld.emit).not.toHaveBeenCalled();
      expect(mockWorld.network?.send).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // ERROR HANDLING
  // ===========================================================================

  describe("error handling", () => {
    it("returns failure when no local player", () => {
      const worldWithoutPlayer = createMockWorld({
        getPlayer: vi.fn(() => null),
      });

      const result = dispatchInventoryAction("eat", {
        world: worldWithoutPlayer as unknown as InventoryActionContext["world"],
        itemId: "shrimp",
        slot: 0,
      });

      expect(result.success).toBe(false);
      expect(result.message).toBe("No local player");
    });

    it("warns for unhandled actions", () => {
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const result = dispatchInventoryAction("unknown_action", {
        world: mockWorld as unknown as InventoryActionContext["world"],
        itemId: "test",
        slot: 0,
      });

      expect(result.success).toBe(false);
      expect(result.message).toBe("Unhandled action: unknown_action");
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Unhandled action"),
      );

      consoleSpy.mockRestore();
    });

    it("does not warn for cancel action", () => {
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      dispatchInventoryAction("cancel", {
        world: mockWorld as unknown as InventoryActionContext["world"],
        itemId: "test",
        slot: 0,
      });

      expect(consoleSpy).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });
});
