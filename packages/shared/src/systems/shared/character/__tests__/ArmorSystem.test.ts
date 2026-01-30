/**
 * ArmorSystem Tests
 *
 * Tests the armor system:
 * - Manifest validation (32 items, no duplicates, valid fields)
 * - Per-style defence bonus summation
 * - Armor equip to correct slot with defence requirements
 * - Weapon attack style mapping (OSRS combat triangle)
 * - Defense bonus helper functions
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  WEAPON_DEFAULT_ATTACK_STYLE,
  type MeleeAttackStyle,
} from "../../../../constants/CombatConstants";
import { WeaponType } from "../../../../types/game/item-types";

// ============================================================================
// Types (mirrors actual types)
// ============================================================================

interface Item {
  id: string;
  name: string;
  type: string;
  equipSlot?: string;
  bonuses?: Record<string, number>;
  requirements?: {
    skills?: Record<string, number>;
  };
}

interface EquipmentSlot {
  id: string;
  name: string;
  slot: string;
  itemId: string | null;
  item: Item | null;
}

interface PlayerEquipment {
  playerId: string;
  weapon: EquipmentSlot;
  shield: EquipmentSlot;
  helmet: EquipmentSlot;
  body: EquipmentSlot;
  legs: EquipmentSlot;
  boots: EquipmentSlot;
  gloves: EquipmentSlot;
  cape: EquipmentSlot;
  amulet: EquipmentSlot;
  ring: EquipmentSlot;
  arrows: EquipmentSlot;
  totalStats: Record<string, number>;
}

// ============================================================================
// Mock Equipment Manager (extended for per-style bonuses)
// ============================================================================

class MockArmorEquipmentManager {
  private playerEquipment = new Map<string, PlayerEquipment>();
  private playerSkills = new Map<string, Record<string, number>>();
  private inventoryItems = new Map<string, Map<string, number>>();
  private itemDatabase = new Map<string, Item>();

  registerItem(item: Item): void {
    this.itemDatabase.set(item.id, item);
  }

  initializePlayer(playerId: string): void {
    const equipment: PlayerEquipment = {
      playerId,
      weapon: {
        id: `${playerId}_weapon`,
        name: "Weapon Slot",
        slot: "weapon",
        itemId: null,
        item: null,
      },
      shield: {
        id: `${playerId}_shield`,
        name: "Shield Slot",
        slot: "shield",
        itemId: null,
        item: null,
      },
      helmet: {
        id: `${playerId}_helmet`,
        name: "Helmet Slot",
        slot: "helmet",
        itemId: null,
        item: null,
      },
      body: {
        id: `${playerId}_body`,
        name: "Body Slot",
        slot: "body",
        itemId: null,
        item: null,
      },
      legs: {
        id: `${playerId}_legs`,
        name: "Legs Slot",
        slot: "legs",
        itemId: null,
        item: null,
      },
      boots: {
        id: `${playerId}_boots`,
        name: "Boots Slot",
        slot: "boots",
        itemId: null,
        item: null,
      },
      gloves: {
        id: `${playerId}_gloves`,
        name: "Gloves Slot",
        slot: "gloves",
        itemId: null,
        item: null,
      },
      cape: {
        id: `${playerId}_cape`,
        name: "Cape Slot",
        slot: "cape",
        itemId: null,
        item: null,
      },
      amulet: {
        id: `${playerId}_amulet`,
        name: "Amulet Slot",
        slot: "amulet",
        itemId: null,
        item: null,
      },
      ring: {
        id: `${playerId}_ring`,
        name: "Ring Slot",
        slot: "ring",
        itemId: null,
        item: null,
      },
      arrows: {
        id: `${playerId}_arrows`,
        name: "Arrow Slot",
        slot: "arrows",
        itemId: null,
        item: null,
      },
      totalStats: {
        attack: 0,
        strength: 0,
        defense: 0,
        ranged: 0,
        constitution: 0,
        rangedAttack: 0,
        rangedStrength: 0,
        magicAttack: 0,
        magicDefense: 0,
        defenseStab: 0,
        defenseSlash: 0,
        defenseCrush: 0,
        defenseRanged: 0,
        attackStab: 0,
        attackSlash: 0,
        attackCrush: 0,
      },
    };
    this.playerEquipment.set(playerId, equipment);
    this.playerSkills.set(playerId, {
      attack: 1,
      strength: 1,
      defense: 1,
      ranged: 1,
      magic: 1,
    });
    this.inventoryItems.set(playerId, new Map());
  }

  setSkills(playerId: string, skills: Record<string, number>): void {
    this.playerSkills.set(playerId, skills);
  }

  addToInventory(playerId: string, itemId: string): void {
    const inv = this.inventoryItems.get(playerId) ?? new Map();
    inv.set(itemId, (inv.get(itemId) ?? 0) + 1);
    this.inventoryItems.set(playerId, inv);
  }

  private removeFromInventory(playerId: string, itemId: string): boolean {
    const inv = this.inventoryItems.get(playerId);
    if (!inv) return false;
    const qty = inv.get(itemId) ?? 0;
    if (qty <= 0) return false;
    if (qty === 1) inv.delete(itemId);
    else inv.set(itemId, qty - 1);
    return true;
  }

  private meetsRequirements(playerId: string, item: Item): boolean {
    const skills = this.playerSkills.get(playerId);
    if (!skills) return false;
    const reqs = item.requirements?.skills;
    if (!reqs) return true;
    for (const [skill, level] of Object.entries(reqs)) {
      if ((skills[skill] ?? 1) < level) return false;
    }
    return true;
  }

  private getSlotName(item: Item): string | null {
    if (item.type === "weapon") return "weapon";
    if (item.type === "armor") return item.equipSlot ?? null;
    return null;
  }

  tryEquip(
    playerId: string,
    itemId: string,
  ): { success: boolean; error?: string } {
    const equipment = this.playerEquipment.get(playerId);
    if (!equipment) return { success: false, error: "Player not found" };
    const item = this.itemDatabase.get(itemId);
    if (!item) return { success: false, error: "Item not found" };
    const inv = this.inventoryItems.get(playerId);
    if (!inv?.has(itemId)) return { success: false, error: "Not in inventory" };
    if (!this.meetsRequirements(playerId, item))
      return { success: false, error: "Requirements not met" };
    const slotName = this.getSlotName(item);
    if (!slotName) return { success: false, error: "Cannot equip" };
    const slot = equipment[slotName as keyof PlayerEquipment] as EquipmentSlot;
    if (!slot || typeof slot === "string")
      return { success: false, error: "Invalid slot" };

    // Unequip existing
    if (slot.itemId) {
      this.addToInventory(playerId, slot.itemId);
      slot.itemId = null;
      slot.item = null;
    }

    this.removeFromInventory(playerId, itemId);
    slot.itemId = itemId;
    slot.item = item;
    this.recalculateStats(playerId);
    return { success: true };
  }

  unequip(playerId: string, slotName: string): void {
    const equipment = this.playerEquipment.get(playerId);
    if (!equipment) return;
    const slot = equipment[slotName as keyof PlayerEquipment] as EquipmentSlot;
    if (!slot || typeof slot === "string" || !slot.itemId) return;
    this.addToInventory(playerId, slot.itemId);
    slot.itemId = null;
    slot.item = null;
    this.recalculateStats(playerId);
  }

  private recalculateStats(playerId: string): void {
    const equipment = this.playerEquipment.get(playerId);
    if (!equipment) return;

    // Reset all stats (mirrors real EquipmentSystem)
    for (const key of Object.keys(equipment.totalStats)) {
      equipment.totalStats[key] = 0;
    }

    const slots: EquipmentSlot[] = [
      equipment.weapon,
      equipment.shield,
      equipment.helmet,
      equipment.body,
      equipment.legs,
      equipment.boots,
      equipment.gloves,
      equipment.cape,
      equipment.amulet,
      equipment.ring,
      equipment.arrows,
    ];

    for (const slot of slots) {
      if (slot.item?.bonuses) {
        for (const [stat, bonus] of Object.entries(slot.item.bonuses)) {
          if (stat in equipment.totalStats) {
            equipment.totalStats[stat] += bonus;
          }
        }
      }
    }
  }

  getStats(playerId: string): Record<string, number> {
    return this.playerEquipment.get(playerId)?.totalStats ?? {};
  }

  getEquipment(playerId: string): PlayerEquipment | undefined {
    return this.playerEquipment.get(playerId);
  }
}

// ============================================================================
// Per-Style Bonus Helpers (mirrors DamageCalculator)
// ============================================================================

interface EquipmentStats {
  attack: number;
  defense: number;
  defenseStab?: number;
  defenseSlash?: number;
  defenseCrush?: number;
  defenseRanged?: number;
  attackStab?: number;
  attackSlash?: number;
  attackCrush?: number;
}

function getAttackBonusForStyle(
  stats: EquipmentStats,
  style: MeleeAttackStyle,
): number {
  switch (style) {
    case "stab":
      return stats.attackStab ?? stats.attack;
    case "slash":
      return stats.attackSlash ?? stats.attack;
    case "crush":
      return stats.attackCrush ?? stats.attack;
    default: {
      const _: never = style;
      return stats.attack;
    }
  }
}

function getDefenseBonusForStyle(
  stats: EquipmentStats,
  style: MeleeAttackStyle,
): number {
  switch (style) {
    case "stab":
      return stats.defenseStab ?? stats.defense;
    case "slash":
      return stats.defenseSlash ?? stats.defense;
    case "crush":
      return stats.defenseCrush ?? stats.defense;
    default: {
      const _: never = style;
      return stats.defense;
    }
  }
}

// ============================================================================
// Test Fixtures: OSRS-Accurate Armor Items
// ============================================================================

/** Rune platebody (tier 5 melee body — requires 40 defence) */
const RUNE_PLATEBODY: Item = {
  id: "rune_platebody",
  name: "Rune Platebody",
  type: "armor",
  equipSlot: "body",
  bonuses: {
    defenseStab: 82,
    defenseSlash: 80,
    defenseCrush: 72,
    defenseRanged: 80,
    magicDefense: -6,
    attackMagic: -30,
    attackRanged: -15,
  },
  requirements: { skills: { defence: 40 } },
};

/** Rune full helm (tier 5 melee helmet) */
const RUNE_FULL_HELM: Item = {
  id: "rune_full_helm",
  name: "Rune Full Helm",
  type: "armor",
  equipSlot: "helmet",
  bonuses: {
    defenseStab: 30,
    defenseSlash: 32,
    defenseCrush: 27,
    defenseRanged: 30,
    magicDefense: -1,
    attackMagic: -6,
    attackRanged: -2,
  },
  requirements: { skills: { defence: 40 } },
};

/** Rune platelegs (tier 5 melee legs) */
const RUNE_PLATELEGS: Item = {
  id: "rune_platelegs",
  name: "Rune Platelegs",
  type: "armor",
  equipSlot: "legs",
  bonuses: {
    defenseStab: 51,
    defenseSlash: 49,
    defenseCrush: 47,
    defenseRanged: 49,
    magicDefense: -4,
    attackMagic: -21,
    attackRanged: -11,
  },
  requirements: { skills: { defence: 40 } },
};

/** Bronze full helm (tier 1 — no requirements) */
const BRONZE_FULL_HELM: Item = {
  id: "bronze_full_helm",
  name: "Bronze Full Helm",
  type: "armor",
  equipSlot: "helmet",
  bonuses: {
    defenseStab: 7,
    defenseSlash: 8,
    defenseCrush: 6,
    defenseRanged: 7,
    magicDefense: -1,
    attackMagic: -6,
    attackRanged: -2,
  },
};

/** Green d'hide body (ranged armor — requires 40 ranged, 40 defence) */
const GREEN_DHIDE_BODY: Item = {
  id: "green_dhide_body",
  name: "Green D'hide Body",
  type: "armor",
  equipSlot: "body",
  bonuses: {
    defenseStab: 40,
    defenseSlash: 32,
    defenseCrush: 45,
    defenseRanged: 40,
    magicDefense: 20,
    attackRanged: 15,
  },
  requirements: { skills: { ranged: 40, defence: 40 } },
};

/** Wizard robe top (magic armor — no requirements) */
const WIZARD_ROBE_TOP: Item = {
  id: "wizard_robe_top",
  name: "Wizard Robe Top",
  type: "armor",
  equipSlot: "body",
  bonuses: {
    attackMagic: 3,
    magicDefense: 3,
  },
};

// ============================================================================
// Tests
// ============================================================================

describe("ArmorSystem", () => {
  let manager: MockArmorEquipmentManager;

  beforeEach(() => {
    manager = new MockArmorEquipmentManager();
    manager.initializePlayer("player-1");

    // Register test items
    for (const item of [
      RUNE_PLATEBODY,
      RUNE_FULL_HELM,
      RUNE_PLATELEGS,
      BRONZE_FULL_HELM,
      GREEN_DHIDE_BODY,
      WIZARD_ROBE_TOP,
    ]) {
      manager.registerItem(item);
    }
  });

  // ==========================================================================
  // 9a. Armor Equip Tests
  // ==========================================================================

  describe("Armor Equip", () => {
    it("equips armor to the correct slot (body)", () => {
      manager.setSkills("player-1", { defence: 40, ranged: 1 });
      manager.addToInventory("player-1", "rune_platebody");

      const result = manager.tryEquip("player-1", "rune_platebody");

      expect(result.success).toBe(true);
      expect(manager.getEquipment("player-1")?.body.itemId).toBe(
        "rune_platebody",
      );
    });

    it("equips armor to the correct slot (helmet)", () => {
      manager.addToInventory("player-1", "bronze_full_helm");

      const result = manager.tryEquip("player-1", "bronze_full_helm");

      expect(result.success).toBe(true);
      expect(manager.getEquipment("player-1")?.helmet.itemId).toBe(
        "bronze_full_helm",
      );
    });

    it("equips armor to the correct slot (legs)", () => {
      manager.setSkills("player-1", { defence: 40 });
      manager.addToInventory("player-1", "rune_platelegs");

      const result = manager.tryEquip("player-1", "rune_platelegs");

      expect(result.success).toBe(true);
      expect(manager.getEquipment("player-1")?.legs.itemId).toBe(
        "rune_platelegs",
      );
    });

    it("blocks equip when defence requirement not met", () => {
      manager.setSkills("player-1", { defence: 30 }); // needs 40
      manager.addToInventory("player-1", "rune_platebody");

      const result = manager.tryEquip("player-1", "rune_platebody");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Requirements not met");
    });

    it("blocks equip when ranged requirement not met", () => {
      manager.setSkills("player-1", { defence: 40, ranged: 30 }); // needs 40 ranged
      manager.addToInventory("player-1", "green_dhide_body");

      const result = manager.tryEquip("player-1", "green_dhide_body");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Requirements not met");
    });

    it("allows items with no requirements (wizard robe)", () => {
      manager.addToInventory("player-1", "wizard_robe_top");

      const result = manager.tryEquip("player-1", "wizard_robe_top");

      expect(result.success).toBe(true);
      expect(manager.getEquipment("player-1")?.body.itemId).toBe(
        "wizard_robe_top",
      );
    });
  });

  // ==========================================================================
  // 9b. Per-Style Defence Tests
  // ==========================================================================

  describe("Per-Style Defence Bonuses", () => {
    it("sums rune platebody per-style defence correctly", () => {
      manager.setSkills("player-1", { defence: 40 });
      manager.addToInventory("player-1", "rune_platebody");
      manager.tryEquip("player-1", "rune_platebody");

      const stats = manager.getStats("player-1");
      expect(stats.defenseStab).toBe(82);
      expect(stats.defenseSlash).toBe(80);
      expect(stats.defenseCrush).toBe(72);
      expect(stats.defenseRanged).toBe(80);
    });

    it("sums full rune set bonuses across helmet + body + legs", () => {
      manager.setSkills("player-1", { defence: 40 });
      manager.addToInventory("player-1", "rune_full_helm");
      manager.addToInventory("player-1", "rune_platebody");
      manager.addToInventory("player-1", "rune_platelegs");
      manager.tryEquip("player-1", "rune_full_helm");
      manager.tryEquip("player-1", "rune_platebody");
      manager.tryEquip("player-1", "rune_platelegs");

      const stats = manager.getStats("player-1");
      // helm(30+32+27) + body(82+80+72) + legs(51+49+47)
      expect(stats.defenseStab).toBe(30 + 82 + 51); // 163
      expect(stats.defenseSlash).toBe(32 + 80 + 49); // 161
      expect(stats.defenseCrush).toBe(27 + 72 + 47); // 146
      expect(stats.defenseRanged).toBe(30 + 80 + 49); // 159
    });

    it("returns bonuses to 0 after unequip", () => {
      manager.setSkills("player-1", { defence: 40 });
      manager.addToInventory("player-1", "rune_platebody");
      manager.tryEquip("player-1", "rune_platebody");

      expect(manager.getStats("player-1").defenseStab).toBe(82);

      manager.unequip("player-1", "body");

      expect(manager.getStats("player-1").defenseStab).toBe(0);
      expect(manager.getStats("player-1").defenseSlash).toBe(0);
      expect(manager.getStats("player-1").defenseCrush).toBe(0);
      expect(manager.getStats("player-1").defenseRanged).toBe(0);
    });

    it("tracks negative magic bonuses from melee armor", () => {
      manager.setSkills("player-1", { defence: 40 });
      manager.addToInventory("player-1", "rune_platebody");
      manager.tryEquip("player-1", "rune_platebody");

      const stats = manager.getStats("player-1");
      expect(stats.magicDefense).toBe(-6);
      expect(stats.attackMagic).toBeUndefined(); // not in tracked totalStats
    });
  });

  // ==========================================================================
  // 9c. Defence Bonus Helper Functions
  // ==========================================================================

  describe("Per-Style Bonus Helpers", () => {
    it("getDefenseBonusForStyle returns correct per-style value", () => {
      const stats: EquipmentStats = {
        attack: 0,
        defense: 50,
        defenseStab: 82,
        defenseSlash: 80,
        defenseCrush: 72,
      };

      expect(getDefenseBonusForStyle(stats, "stab")).toBe(82);
      expect(getDefenseBonusForStyle(stats, "slash")).toBe(80);
      expect(getDefenseBonusForStyle(stats, "crush")).toBe(72);
    });

    it("getDefenseBonusForStyle falls back to generic defense", () => {
      const stats: EquipmentStats = { attack: 0, defense: 50 };

      expect(getDefenseBonusForStyle(stats, "stab")).toBe(50);
      expect(getDefenseBonusForStyle(stats, "slash")).toBe(50);
      expect(getDefenseBonusForStyle(stats, "crush")).toBe(50);
    });

    it("getAttackBonusForStyle returns correct per-style value", () => {
      const stats: EquipmentStats = {
        attack: 10,
        defense: 0,
        attackStab: 25,
        attackSlash: 67,
        attackCrush: 18,
      };

      expect(getAttackBonusForStyle(stats, "stab")).toBe(25);
      expect(getAttackBonusForStyle(stats, "slash")).toBe(67);
      expect(getAttackBonusForStyle(stats, "crush")).toBe(18);
    });

    it("getAttackBonusForStyle falls back to generic attack", () => {
      const stats: EquipmentStats = { attack: 10, defense: 0 };

      expect(getAttackBonusForStyle(stats, "stab")).toBe(10);
      expect(getAttackBonusForStyle(stats, "slash")).toBe(10);
      expect(getAttackBonusForStyle(stats, "crush")).toBe(10);
    });
  });

  // ==========================================================================
  // 9d. Weapon Attack Style Mapping
  // ==========================================================================

  describe("Weapon Attack Style Mapping", () => {
    it("maps swords to slash", () => {
      expect(WEAPON_DEFAULT_ATTACK_STYLE[WeaponType.SWORD]).toBe("slash");
    });

    it("maps scimitars to slash", () => {
      expect(WEAPON_DEFAULT_ATTACK_STYLE[WeaponType.SCIMITAR]).toBe("slash");
    });

    it("maps axes to slash", () => {
      expect(WEAPON_DEFAULT_ATTACK_STYLE[WeaponType.AXE]).toBe("slash");
    });

    it("maps maces to crush", () => {
      expect(WEAPON_DEFAULT_ATTACK_STYLE[WeaponType.MACE]).toBe("crush");
    });

    it("maps daggers to stab", () => {
      expect(WEAPON_DEFAULT_ATTACK_STYLE[WeaponType.DAGGER]).toBe("stab");
    });

    it("maps spears to stab", () => {
      expect(WEAPON_DEFAULT_ATTACK_STYLE[WeaponType.SPEAR]).toBe("stab");
    });

    it("maps halberds to slash", () => {
      expect(WEAPON_DEFAULT_ATTACK_STYLE[WeaponType.HALBERD]).toBe("slash");
    });

    it("maps unarmed (none) to crush", () => {
      expect(WEAPON_DEFAULT_ATTACK_STYLE[WeaponType.NONE]).toBe("crush");
    });

    it("returns undefined for non-melee weapon types", () => {
      expect(WEAPON_DEFAULT_ATTACK_STYLE[WeaponType.BOW]).toBeUndefined();
      expect(WEAPON_DEFAULT_ATTACK_STYLE[WeaponType.STAFF]).toBeUndefined();
      expect(WEAPON_DEFAULT_ATTACK_STYLE[WeaponType.WAND]).toBeUndefined();
    });
  });

  // ==========================================================================
  // 9e. Manifest Validation
  // ==========================================================================

  describe("Armor Manifest Validation", () => {
    // Load the actual armor.json manifest
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const armorManifest =
      require("../../../../../../server/world/assets/manifests/items/armor.json") as Array<{
        id: string;
        name: string;
        type: string;
        equipSlot?: string;
        bonuses?: Record<string, number>;
        requirements?: { skills?: Record<string, number> };
      }>;

    it("contains exactly 69 armor items", () => {
      expect(armorManifest).toHaveLength(69);
    });

    it("has no duplicate IDs", () => {
      const ids = armorManifest.map((item) => item.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it("all items have type armor", () => {
      for (const item of armorManifest) {
        expect(item.type).toBe("armor");
      }
    });

    it("all items have valid equipSlot", () => {
      const validSlots = [
        "helmet",
        "body",
        "legs",
        "shield",
        "boots",
        "gloves",
        "cape",
        "amulet",
        "ring",
      ];
      for (const item of armorManifest) {
        expect(validSlots).toContain(item.equipSlot);
      }
    });

    it("all items have bonuses defined", () => {
      for (const item of armorManifest) {
        expect(item.bonuses).toBeDefined();
        expect(typeof item.bonuses).toBe("object");
      }
    });

    it("melee armor has per-style defence bonuses", () => {
      const meleeArmor = armorManifest.filter(
        (item) =>
          (item.id.startsWith("bronze_") ||
            item.id.startsWith("iron_") ||
            item.id.startsWith("steel_") ||
            item.id.startsWith("mithril_") ||
            item.id.startsWith("adamant_") ||
            item.id.startsWith("rune_")) &&
          ["helmet", "body", "legs", "shield"].includes(item.equipSlot!),
      );

      expect(meleeArmor.length).toBe(24); // 6 tiers × 4 slots (helmet/body/legs/shield)

      for (const item of meleeArmor) {
        const b = item.bonuses!;
        expect(b.defenseStab).toBeGreaterThan(0);
        expect(b.defenseSlash).toBeGreaterThan(0);
        expect(b.defenseCrush).toBeGreaterThan(0);
        expect(b.defenseRanged).toBeGreaterThan(0);
      }
    });

    it("melee armor has negative magic bonuses", () => {
      const meleeArmor = armorManifest.filter(
        (item) =>
          (item.id.startsWith("rune_") || item.id.startsWith("adamant_")) &&
          ["helmet", "body", "legs", "shield"].includes(item.equipSlot!),
      );

      expect(meleeArmor.length).toBe(8); // 2 tiers × 4 slots

      for (const item of meleeArmor) {
        const b = item.bonuses!;
        expect(b.attackMagic).toBeLessThan(0);
        // defenseMagic is negative for body/legs, -1 for helmets/shields
        expect(b.defenseMagic).toBeLessThanOrEqual(0);
      }
    });

    it("ranged armor has positive defenseRanged and defenseMagic", () => {
      const rangedArmor = armorManifest.filter(
        (item) =>
          ((item.id.startsWith("leather_") ||
            item.id.startsWith("studded_") ||
            item.id.startsWith("green_dhide_")) &&
            ["helmet", "body", "legs"].includes(item.equipSlot!)) ||
          item.id === "coif", // coif is studded tier head piece
      );

      expect(rangedArmor.length).toBe(8); // leather(3) + studded(2) + coif(1) + green d'hide(2)

      for (const item of rangedArmor) {
        const b = item.bonuses!;
        expect(b.defenseRanged).toBeGreaterThanOrEqual(0);
        // Ranged armor has positive or zero magic defense (combat triangle)
        expect(b.defenseMagic).toBeGreaterThanOrEqual(0);
      }
    });

    it("magic armor has positive attackMagic and defenseMagic", () => {
      const magicArmor = armorManifest.filter(
        (item) =>
          item.id.startsWith("wizard_") || item.id.startsWith("mystic_"),
      );

      expect(magicArmor.length).toBe(8); // wizard(3+boots) + mystic(3+gloves)

      for (const item of magicArmor) {
        const b = item.bonuses!;
        expect(b.attackMagic).toBeGreaterThan(0);
        expect(b.defenseMagic).toBeGreaterThan(0);
      }
    });

    it("all defence values are within OSRS range (0-200)", () => {
      const defenseKeys = [
        "defenseStab",
        "defenseSlash",
        "defenseCrush",
        "defenseRanged",
      ];
      for (const item of armorManifest) {
        for (const key of defenseKeys) {
          const val = item.bonuses?.[key] ?? 0;
          expect(val).toBeGreaterThanOrEqual(0);
          expect(val).toBeLessThanOrEqual(200);
        }
      }
    });

    it("items requiring defence have valid skill requirements", () => {
      const highTierItems = armorManifest.filter(
        (item) =>
          item.id.startsWith("rune_") ||
          item.id.startsWith("adamant_") ||
          item.id.startsWith("mithril_") ||
          item.id.startsWith("green_dhide_") ||
          item.id.startsWith("mystic_"),
      );

      for (const item of highTierItems) {
        expect(item.requirements).toBeDefined();
        expect(item.requirements!.skills).toBeDefined();
        // At least one skill requirement should be > 1
        const skillValues = Object.values(item.requirements!.skills!);
        expect(skillValues.some((v) => v > 1)).toBe(true);
      }
    });
  });
});
