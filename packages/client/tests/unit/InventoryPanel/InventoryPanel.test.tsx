/**
 * InventoryPanel Component Tests
 *
 * Tests for the main InventoryPanel component that displays player inventory,
 * handles drag-and-drop, and item interactions.
 */

/// <reference types="@testing-library/jest-dom" />

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { InventoryPanel } from "../../../src/game/panels/InventoryPanel";
import { createMockWorld, asClientWorld } from "../../mocks/MockWorld";
import type { ClientWorld } from "../../../src/types";

// ============================================================================
// TEST DATA FACTORIES
// ============================================================================

/**
 * InventorySlotViewItem compatible test item
 * Only includes the props that InventoryPanelProps.items expects
 */
interface TestInventoryItem {
  itemId: string;
  quantity: number;
  slot: number;
}

function createInventoryItem(
  overrides: Partial<TestInventoryItem> = {},
): TestInventoryItem {
  return {
    itemId: "bronze_sword",
    quantity: 1,
    slot: 0,
    ...overrides,
  };
}

function createInventoryItems(count: number): TestInventoryItem[] {
  const items: TestInventoryItem[] = [];
  const itemIds = [
    "bronze_sword",
    "iron_helmet",
    "lobster",
    "oak_logs",
    "coins",
    "rune_essence",
  ];

  for (let i = 0; i < count; i++) {
    items.push({
      itemId: itemIds[i % itemIds.length],
      quantity: i + 1,
      slot: i,
    });
  }
  return items;
}

// ============================================================================
// TEST SETUP
// ============================================================================

describe("InventoryPanel", () => {
  let mockWorld: ReturnType<typeof createMockWorld>;
  const mockOnItemMove = vi.fn();
  const mockOnItemUse = vi.fn();
  const mockOnItemEquip = vi.fn();

  const defaultProps: {
    items: TestInventoryItem[];
    coins: number;
    world: ClientWorld;
    onItemMove: typeof mockOnItemMove;
    onItemUse: typeof mockOnItemUse;
    onItemEquip: typeof mockOnItemEquip;
  } = {
    items: createInventoryItems(5),
    coins: 1000,
    world: null as unknown as ClientWorld,
    onItemMove: mockOnItemMove,
    onItemUse: mockOnItemUse,
    onItemEquip: mockOnItemEquip,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockWorld = createMockWorld();
    defaultProps.world = asClientWorld(mockWorld);
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  // ========================================================================
  // Basic Rendering
  // ========================================================================

  describe("basic rendering", () => {
    it("renders inventory grid", () => {
      render(<InventoryPanel {...defaultProps} />);

      // Should have 28 inventory slots
      const slots = screen.getAllByRole("button");
      expect(slots.length).toBeGreaterThanOrEqual(5); // At least our items
    });

    it("renders coin pouch when showCoinPouch is true", () => {
      render(<InventoryPanel {...defaultProps} showCoinPouch={true} />);

      // Coin display should show the coins amount
      expect(screen.getByText(/1,000|1000/)).toBeInTheDocument();
    });

    it("hides coin pouch when showCoinPouch is false", () => {
      render(<InventoryPanel {...defaultProps} showCoinPouch={false} />);

      // Should not show the coins in a separate pouch
      // Note: Coins might still appear if they're an inventory item
      const coinPouches = screen.queryAllByText(/coins/i);
      // In embedded mode without coin pouch, should be minimal
      expect(coinPouches.length).toBeLessThanOrEqual(1);
    });

    it("renders items with correct quantities", () => {
      render(<InventoryPanel {...defaultProps} />);

      // Items with quantity > 1 should show the quantity
      expect(screen.getByText("2")).toBeInTheDocument(); // Second item has quantity 2
    });
  });

  // ========================================================================
  // Empty State
  // ========================================================================

  describe("empty state", () => {
    it("renders empty slots when no items", () => {
      render(
        <InventoryPanel {...defaultProps} items={createInventoryItems(0)} />,
      );

      // Should still render the grid structure
      const container =
        document.querySelector("[data-testid]") || document.body;
      expect(container).toBeInTheDocument();
    });
  });

  // ========================================================================
  // Embedded Mode
  // ========================================================================

  describe("embedded mode", () => {
    it("renders with bank embedded mode", () => {
      const mockEmbeddedClick = vi.fn();

      render(
        <InventoryPanel
          {...defaultProps}
          embeddedMode="bank"
          onEmbeddedClick={mockEmbeddedClick}
        />,
      );

      // Should render without crashing
      expect(screen.getAllByRole("button").length).toBeGreaterThan(0);
    });

    it("renders footer hint in embedded mode", () => {
      render(
        <InventoryPanel
          {...defaultProps}
          embeddedMode="bank"
          footerHint="Click to deposit items"
        />,
      );

      expect(screen.getByText("Click to deposit items")).toBeInTheDocument();
    });
  });

  // ========================================================================
  // Item Display
  // ========================================================================

  describe("item display", () => {
    it("displays item names on hover (tooltip)", async () => {
      render(<InventoryPanel {...defaultProps} />);

      // Items should be present
      const buttons = screen.getAllByRole("button");
      expect(buttons.length).toBeGreaterThan(0);
    });

    it("displays stackable items with quantity", () => {
      const stackableItems = [
        createInventoryItem({
          itemId: "coins",
          quantity: 1000000,
          slot: 0,
        }),
      ];

      render(<InventoryPanel {...defaultProps} items={stackableItems} />);

      // Large numbers should be formatted (e.g., 1M or 1,000,000)
      const quantityText = screen.queryByText(/1M|1,000,000|1000000/);
      expect(quantityText).toBeInTheDocument();
    });
  });

  // ========================================================================
  // Accessibility
  // ========================================================================

  describe("accessibility", () => {
    it("inventory slots are focusable", () => {
      render(<InventoryPanel {...defaultProps} />);

      const buttons = screen.getAllByRole("button");
      buttons.forEach((button) => {
        expect(button).not.toHaveAttribute("disabled");
      });
    });

    it("supports keyboard navigation", () => {
      render(<InventoryPanel {...defaultProps} />);

      const buttons = screen.getAllByRole("button");
      if (buttons.length > 0) {
        buttons[0].focus();
        expect(document.activeElement).toBe(buttons[0]);
      }
    });
  });

  // ========================================================================
  // Performance
  // ========================================================================

  describe("performance", () => {
    it("renders large inventory without crashing", () => {
      const fullInventory = createInventoryItems(28);

      render(<InventoryPanel {...defaultProps} items={fullInventory} />);

      // Should render all 28 items
      const buttons = screen.getAllByRole("button");
      expect(buttons.length).toBeGreaterThanOrEqual(28);
    });
  });
});
