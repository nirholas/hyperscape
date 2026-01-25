import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useEquipment } from "../../src/core/equipment/useEquipment";
import type { EquipmentItemData, EquipmentSet } from "../../src/core/equipment";

// Mock equipment items
const createMockItem = (
  overrides: Partial<EquipmentItemData> = {},
): EquipmentItemData => ({
  id: `item-${Math.random().toString(36).slice(2, 9)}`,
  name: "Test Item",
  icon: "/icons/test.png",
  itemLevel: 100,
  rarity: "rare",
  equipSlot: "head",
  stats: { strength: 10, stamina: 5 },
  ...overrides,
});

const mockHelmet: EquipmentItemData = createMockItem({
  id: "helmet-1",
  name: "Steel Helmet",
  equipSlot: "head",
  itemLevel: 150,
  rarity: "epic",
  stats: { armor: 50, stamina: 20 },
});

const mockChestplate: EquipmentItemData = createMockItem({
  id: "chest-1",
  name: "Steel Chestplate",
  equipSlot: "chest",
  itemLevel: 155,
  rarity: "epic",
  stats: { armor: 100, stamina: 30, strength: 15 },
});

const mockSword: EquipmentItemData = createMockItem({
  id: "sword-1",
  name: "Steel Sword",
  equipSlot: "mainHand",
  itemLevel: 160,
  rarity: "rare",
  stats: { attackPower: 80, critChance: 5 },
});

const mockShield: EquipmentItemData = createMockItem({
  id: "shield-1",
  name: "Steel Shield",
  equipSlot: "offHand",
  itemLevel: 145,
  rarity: "uncommon",
  stats: { armor: 30, evasion: 5 },
});

const mock2hSword: EquipmentItemData = createMockItem({
  id: "2h-sword-1",
  name: "Greatsword",
  equipSlot: "twoHand",
  itemLevel: 170,
  rarity: "legendary",
  stats: { attackPower: 150, critChance: 10, critDamage: 20 },
});

const mockRing1: EquipmentItemData = createMockItem({
  id: "ring-1",
  name: "Gold Ring",
  equipSlot: "ring1",
  itemLevel: 100,
  rarity: "common",
  stats: { strength: 5 },
});

const mockRing2: EquipmentItemData = createMockItem({
  id: "ring-2",
  name: "Silver Ring",
  equipSlot: "ring2",
  itemLevel: 100,
  rarity: "uncommon",
  stats: { agility: 5 },
});

const mockSet: EquipmentSet = {
  id: "steel-set",
  name: "Steel Warrior Set",
  itemIds: ["helmet-1", "chest-1", "sword-1", "shield-1"],
  bonuses: [
    { pieces: 2, stats: { armor: 20 }, effect: "+20 Armor" },
    {
      pieces: 4,
      stats: { armor: 50, strength: 10 },
      effect: "+50 Armor, +10 Strength",
    },
  ],
};

describe("useEquipment", () => {
  describe("initialization", () => {
    it("should start with empty equipment", () => {
      const { result } = renderHook(() => useEquipment());

      expect(result.current.equipment.head).toBeNull();
      expect(result.current.equipment.chest).toBeNull();
      expect(result.current.equipment.mainHand).toBeNull();
    });

    it("should initialize with provided equipment", () => {
      const { result } = renderHook(() =>
        useEquipment({
          initialEquipment: { head: mockHelmet },
        }),
      );

      expect(result.current.equipment.head).toEqual(mockHelmet);
      expect(result.current.equipment.chest).toBeNull();
    });
  });

  describe("equipItem", () => {
    it("should equip item to specified slot", () => {
      const { result } = renderHook(() => useEquipment());

      act(() => {
        result.current.equipItem(mockHelmet, "head");
      });

      expect(result.current.equipment.head).toEqual(mockHelmet);
    });

    it("should auto-detect slot from item", () => {
      const { result } = renderHook(() => useEquipment());

      act(() => {
        result.current.equipItem(mockHelmet);
      });

      expect(result.current.equipment.head).toEqual(mockHelmet);
    });

    it("should return unequipped item when replacing", () => {
      const { result } = renderHook(() =>
        useEquipment({ initialEquipment: { head: mockHelmet } }),
      );

      const newHelmet = createMockItem({
        id: "helmet-2",
        name: "New Helmet",
        equipSlot: "head",
      });

      let equipResult: ReturnType<typeof result.current.equipItem>;

      act(() => {
        equipResult = result.current.equipItem(newHelmet, "head");
      });

      expect(equipResult!.success).toBe(true);
      expect(equipResult!.unequipped).toHaveLength(1);
      expect(equipResult!.unequipped[0]).toEqual(mockHelmet);
      expect(result.current.equipment.head).toEqual(newHelmet);
    });

    it("should handle two-hand weapon conflicts", () => {
      const { result } = renderHook(() =>
        useEquipment({
          initialEquipment: { mainHand: mockSword, offHand: mockShield },
        }),
      );

      let equipResult: ReturnType<typeof result.current.equipItem>;

      act(() => {
        equipResult = result.current.equipItem(mock2hSword, "twoHand");
      });

      expect(equipResult!.success).toBe(true);
      expect(equipResult!.unequipped).toHaveLength(2);
      expect(result.current.equipment.twoHand).toEqual(mock2hSword);
      expect(result.current.equipment.mainHand).toBeNull();
      expect(result.current.equipment.offHand).toBeNull();
    });

    it("should reject items that don't fit the slot", () => {
      const { result } = renderHook(() => useEquipment());

      let equipResult: ReturnType<typeof result.current.equipItem>;

      act(() => {
        equipResult = result.current.equipItem(mockHelmet, "chest");
      });

      expect(equipResult!.success).toBe(false);
      expect(equipResult!.error).toBeDefined();
      expect(result.current.equipment.chest).toBeNull();
    });

    it("should call onEquip callback", () => {
      const onEquip = vi.fn();
      const { result } = renderHook(() => useEquipment({ onEquip }));

      act(() => {
        result.current.equipItem(mockHelmet, "head");
      });

      expect(onEquip).toHaveBeenCalledWith(mockHelmet, "head");
    });
  });

  describe("unequipItem", () => {
    it("should unequip item from slot", () => {
      const { result } = renderHook(() =>
        useEquipment({ initialEquipment: { head: mockHelmet } }),
      );

      let unequipped: EquipmentItemData | null;

      act(() => {
        unequipped = result.current.unequipItem("head");
      });

      expect(unequipped).toEqual(mockHelmet);
      expect(result.current.equipment.head).toBeNull();
    });

    it("should return null for empty slot", () => {
      const { result } = renderHook(() => useEquipment());

      let unequipped: EquipmentItemData | null;

      act(() => {
        unequipped = result.current.unequipItem("head");
      });

      expect(unequipped).toBeNull();
    });

    it("should call onUnequip callback", () => {
      const onUnequip = vi.fn();
      const { result } = renderHook(() =>
        useEquipment({ initialEquipment: { head: mockHelmet }, onUnequip }),
      );

      act(() => {
        result.current.unequipItem("head");
      });

      expect(onUnequip).toHaveBeenCalledWith(mockHelmet, "head");
    });
  });

  describe("canEquip", () => {
    it("should return true for valid equipment", () => {
      const { result } = renderHook(() => useEquipment());

      const canEquipResult = result.current.canEquip(mockHelmet, "head");

      expect(canEquipResult.canEquip).toBe(true);
    });

    it("should return false for level requirement not met", () => {
      const highLevelHelmet = createMockItem({
        equipSlot: "head",
        requiredLevel: 100,
      });

      const { result } = renderHook(() => useEquipment({ playerLevel: 50 }));

      const canEquipResult = result.current.canEquip(highLevelHelmet, "head");

      expect(canEquipResult.canEquip).toBe(false);
      expect(canEquipResult.reason).toContain("level");
    });
  });

  describe("totalStats", () => {
    it("should calculate total stats from all equipment", () => {
      const { result } = renderHook(() =>
        useEquipment({
          initialEquipment: {
            head: mockHelmet,
            chest: mockChestplate,
          },
        }),
      );

      expect(result.current.totalStats.armor).toBe(150); // 50 + 100
      expect(result.current.totalStats.stamina).toBe(50); // 20 + 30
      expect(result.current.totalStats.strength).toBe(15);
    });

    it("should update when equipment changes", () => {
      const { result } = renderHook(() =>
        useEquipment({ initialEquipment: { head: mockHelmet } }),
      );

      expect(result.current.totalStats.armor).toBe(50);

      act(() => {
        result.current.equipItem(mockChestplate, "chest");
      });

      expect(result.current.totalStats.armor).toBe(150);
    });
  });

  describe("averageItemLevel", () => {
    it("should calculate average item level", () => {
      const { result } = renderHook(() =>
        useEquipment({
          initialEquipment: {
            head: mockHelmet, // 150
            chest: mockChestplate, // 155
          },
        }),
      );

      // Average depends on total slots considered
      expect(result.current.averageItemLevel).toBeGreaterThan(0);
    });
  });

  describe("setBonuses", () => {
    it("should calculate set bonuses correctly", () => {
      const { result } = renderHook(() =>
        useEquipment({
          initialEquipment: {
            head: mockHelmet,
            chest: mockChestplate,
          },
          sets: [mockSet],
        }),
      );

      const setBonus = result.current.setBonuses.find(
        (b) => b.set.id === "steel-set",
      );

      expect(setBonus).toBeDefined();
      expect(setBonus!.equippedCount).toBe(2);
      expect(setBonus!.activeBonus).toBeDefined();
      expect(setBonus!.activeBonus!.pieces).toBe(2);
    });

    it("should show next bonus threshold", () => {
      const { result } = renderHook(() =>
        useEquipment({
          initialEquipment: { head: mockHelmet },
          sets: [mockSet],
        }),
      );

      const setBonus = result.current.setBonuses.find(
        (b) => b.set.id === "steel-set",
      );

      expect(setBonus!.equippedCount).toBe(1);
      expect(setBonus!.nextBonus).toBeDefined();
      expect(setBonus!.nextBonus!.pieces).toBe(2);
    });
  });

  describe("clearAll", () => {
    it("should clear all equipment", () => {
      const { result } = renderHook(() =>
        useEquipment({
          initialEquipment: {
            head: mockHelmet,
            chest: mockChestplate,
            ring1: mockRing1,
          },
        }),
      );

      let cleared: EquipmentItemData[];

      act(() => {
        cleared = result.current.clearAll();
      });

      expect(cleared).toHaveLength(3);
      expect(result.current.equipment.head).toBeNull();
      expect(result.current.equipment.chest).toBeNull();
      expect(result.current.equipment.ring1).toBeNull();
    });
  });

  describe("getValidSlots", () => {
    it("should return valid slots for item", () => {
      const { result } = renderHook(() => useEquipment());

      const validSlots = result.current.getValidSlots(mockHelmet);

      expect(validSlots).toContain("head");
      expect(validSlots).not.toContain("chest");
    });

    it("should return both ring slots for ring items", () => {
      const ringItem = createMockItem({
        equipSlot: ["ring1", "ring2"],
      });

      const { result } = renderHook(() => useEquipment());

      const validSlots = result.current.getValidSlots(ringItem);

      expect(validSlots).toContain("ring1");
      expect(validSlots).toContain("ring2");
    });
  });

  describe("swapSlots", () => {
    it("should swap compatible items between slots", () => {
      // Create two ring items that can go in either ring slot
      const ring1 = createMockItem({
        id: "ring-a",
        name: "Ring A",
        equipSlot: ["ring1", "ring2"],
      });
      const ring2 = createMockItem({
        id: "ring-b",
        name: "Ring B",
        equipSlot: ["ring1", "ring2"],
      });

      const { result } = renderHook(() =>
        useEquipment({
          initialEquipment: { ring1, ring2 },
        }),
      );

      let success: boolean;

      act(() => {
        success = result.current.swapSlots("ring1", "ring2");
      });

      expect(success).toBe(true);
      expect(result.current.equipment.ring1!.id).toBe("ring-b");
      expect(result.current.equipment.ring2!.id).toBe("ring-a");
    });

    it("should fail for incompatible slots", () => {
      const { result } = renderHook(() =>
        useEquipment({
          initialEquipment: { head: mockHelmet, chest: mockChestplate },
        }),
      );

      let success: boolean;

      act(() => {
        success = result.current.swapSlots("head", "chest");
      });

      expect(success).toBe(false);
    });
  });

  describe("calculateGearScore", () => {
    it("should calculate gear score based on equipment", () => {
      const { result } = renderHook(() =>
        useEquipment({
          initialEquipment: {
            head: mockHelmet,
            chest: mockChestplate,
            mainHand: mockSword,
          },
        }),
      );

      const gearScore = result.current.calculateGearScore();

      expect(gearScore).toBeGreaterThan(0);
    });

    it("should return 0 for empty equipment", () => {
      const { result } = renderHook(() => useEquipment());

      const gearScore = result.current.calculateGearScore();

      expect(gearScore).toBe(0);
    });
  });

  describe("itemsNeedingRepair", () => {
    it("should return items with low durability", () => {
      const damagedHelmet = createMockItem({
        equipSlot: "head",
        durability: 10,
        maxDurability: 100,
      });

      const { result } = renderHook(() =>
        useEquipment({
          initialEquipment: { head: damagedHelmet },
        }),
      );

      expect(result.current.itemsNeedingRepair).toHaveLength(1);
    });

    it("should not include items with good durability", () => {
      const goodHelmet = createMockItem({
        equipSlot: "head",
        durability: 90,
        maxDurability: 100,
      });

      const { result } = renderHook(() =>
        useEquipment({
          initialEquipment: { head: goodHelmet },
        }),
      );

      expect(result.current.itemsNeedingRepair).toHaveLength(0);
    });
  });
});
