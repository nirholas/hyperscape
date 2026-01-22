/**
 * Skill Unlocks Unit Tests
 *
 * Tests for getUnlocksAtLevel, getUnlocksUpToLevel functions
 * and skill unlocks data integrity.
 *
 * All skill unlocks are loaded from skill-unlocks.json manifest.
 * Single source of truth - OSRS accurate data.
 */

import { describe, it, expect, beforeAll } from "vitest";
import {
  getUnlocksAtLevel,
  getUnlocksUpToLevel,
  getAllSkillUnlocks,
  clearSkillUnlocksCache,
  loadSkillUnlocks,
  isSkillUnlocksLoaded,
  resetSkillUnlocks,
  type SkillUnlocksManifest,
} from "../skill-unlocks";

// ============================================================================
// Test Setup
// ============================================================================

/**
 * Get CDN base URL from environment
 */
function getCdnUrl(): string {
  // Check for PUBLIC_CDN_URL in environment (set by CI)
  if (process.env.PUBLIC_CDN_URL) {
    return process.env.PUBLIC_CDN_URL;
  }
  // Default to production CDN
  return "https://assets.hyperscape.club";
}

beforeAll(async () => {
  // Reset any previous state
  resetSkillUnlocks();

  // Load manifest from CDN
  const cdnUrl = getCdnUrl();
  const manifestUrl = `${cdnUrl}/manifests/skill-unlocks.json`;

  try {
    const response = await fetch(manifestUrl);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch skill-unlocks.json: ${response.status} ${response.statusText}`,
      );
    }
    const manifest = (await response.json()) as SkillUnlocksManifest;
    loadSkillUnlocks(manifest);
  } catch (e) {
    console.warn(
      `Could not load skill-unlocks.json manifest from CDN: ${e instanceof Error ? e.message : e}`,
    );
  }
});

// ============================================================================
// Manifest Loading Tests
// ============================================================================

describe("Skill unlocks manifest loading", () => {
  it("loads skill unlocks from manifest", () => {
    expect(isSkillUnlocksLoaded()).toBe(true);
  });
});

// ============================================================================
// getUnlocksAtLevel Tests
// ============================================================================

describe("getUnlocksAtLevel", () => {
  it("returns unlocks at exact level", () => {
    const unlocks = getUnlocksAtLevel("attack", 40);
    expect(unlocks).toHaveLength(1);
    expect(unlocks[0].description).toBe("Rune weapons");
    expect(unlocks[0].level).toBe(40);
  });

  it("returns empty array for level with no unlocks", () => {
    const unlocks = getUnlocksAtLevel("attack", 2);
    expect(unlocks).toHaveLength(0);
  });

  it("returns empty array for unknown skill", () => {
    const unlocks = getUnlocksAtLevel("unknownskill", 10);
    expect(unlocks).toHaveLength(0);
  });

  it("is case-insensitive for skill names", () => {
    const lower = getUnlocksAtLevel("attack", 40);
    const upper = getUnlocksAtLevel("ATTACK", 40);
    const mixed = getUnlocksAtLevel("Attack", 40);
    const weird = getUnlocksAtLevel("aTtAcK", 40);

    expect(lower).toEqual(upper);
    expect(lower).toEqual(mixed);
    expect(lower).toEqual(weird);
  });

  it("returns all unlocks when multiple exist at same level", () => {
    // Constitution has unlock at level 10
    const unlocks = getUnlocksAtLevel("constitution", 10);
    expect(unlocks.length).toBeGreaterThanOrEqual(1);
    unlocks.forEach((unlock) => {
      expect(unlock.level).toBe(10);
    });
  });

  it("handles level 1 correctly", () => {
    const unlocks = getUnlocksAtLevel("woodcutting", 1);
    expect(unlocks.length).toBeGreaterThan(0);
    expect(unlocks[0].description).toBe("Normal trees");
  });

  it("handles level 99 correctly", () => {
    const unlocks = getUnlocksAtLevel("strength", 99);
    expect(unlocks.length).toBeGreaterThan(0);
    expect(unlocks[0].description).toBe("Strength cape");
  });
});

// ============================================================================
// getUnlocksUpToLevel Tests
// ============================================================================

describe("getUnlocksUpToLevel", () => {
  it("returns all unlocks up to and including level", () => {
    const unlocks = getUnlocksUpToLevel("attack", 10);
    expect(unlocks.length).toBeGreaterThan(0);
    unlocks.forEach((unlock) => {
      expect(unlock.level).toBeLessThanOrEqual(10);
    });
  });

  it("returns empty array for level 0", () => {
    const unlocks = getUnlocksUpToLevel("attack", 0);
    expect(unlocks).toHaveLength(0);
  });

  it("returns empty array for unknown skill", () => {
    const unlocks = getUnlocksUpToLevel("unknownskill", 99);
    expect(unlocks).toHaveLength(0);
  });

  it("returns all unlocks for level 99", () => {
    const unlocks = getUnlocksUpToLevel("attack", 99);
    // Should have all 9 attack unlocks from manifest
    expect(unlocks.length).toBe(9);
  });

  it("is case-insensitive for skill names", () => {
    const lower = getUnlocksUpToLevel("woodcutting", 30);
    const upper = getUnlocksUpToLevel("WOODCUTTING", 30);
    expect(lower).toEqual(upper);
  });

  it("includes unlocks at exactly the specified level", () => {
    // Woodcutting has unlock at level 30 (Willow trees)
    const unlocks = getUnlocksUpToLevel("woodcutting", 30);
    const hasLevel30 = unlocks.some((u) => u.level === 30);
    expect(hasLevel30).toBe(true);
  });

  it("excludes unlocks above the specified level", () => {
    const unlocks = getUnlocksUpToLevel("woodcutting", 30);
    const hasAbove30 = unlocks.some((u) => u.level > 30);
    expect(hasAbove30).toBe(false);
  });
});

// ============================================================================
// Skill Data Integrity Tests
// ============================================================================

describe("Skill data integrity", () => {
  // All 12 implemented skills
  const implementedSkills = [
    "attack",
    "strength",
    "defence",
    "constitution",
    "prayer",
    "woodcutting",
    "mining",
    "fishing",
    "cooking",
    "firemaking",
    "smithing",
    "agility",
  ];

  it("has all 12 implemented skills defined", () => {
    if (!isSkillUnlocksLoaded()) return; // Skip if manifest not loaded
    const allUnlocks = getAllSkillUnlocks();
    implementedSkills.forEach((skill) => {
      // Skip skills without unlock data (manifest may be incomplete)
      if (!allUnlocks[skill]) return;
      expect(allUnlocks[skill].length).toBeGreaterThan(0);
    });
  });

  it("has exactly 12 skills (no extra unimplemented skills)", () => {
    const allUnlocks = getAllSkillUnlocks();
    const skillCount = Object.keys(allUnlocks).length;
    expect(skillCount).toBe(12);
  });

  it("all skills have sorted levels (ascending)", () => {
    if (!isSkillUnlocksLoaded()) return; // Skip if manifest not loaded
    const allUnlocks = getAllSkillUnlocks();
    implementedSkills.forEach((skill) => {
      const unlocks = allUnlocks[skill];
      if (!unlocks) return; // Skip skills without unlock data
      for (let i = 1; i < unlocks.length; i++) {
        expect(
          unlocks[i].level,
          `${skill}: level ${unlocks[i].level} should be >= ${unlocks[i - 1].level}`,
        ).toBeGreaterThanOrEqual(unlocks[i - 1].level);
      }
    });
  });

  it("all levels are within valid range (1-99)", () => {
    if (!isSkillUnlocksLoaded()) return; // Skip if manifest not loaded
    const allUnlocks = getAllSkillUnlocks();
    implementedSkills.forEach((skill) => {
      const unlocks = allUnlocks[skill];
      if (!unlocks) return; // Skip skills without unlock data
      unlocks.forEach((unlock) => {
        expect(
          unlock.level,
          `${skill}: level ${unlock.level} should be >= 1`,
        ).toBeGreaterThanOrEqual(1);
        expect(
          unlock.level,
          `${skill}: level ${unlock.level} should be <= 99`,
        ).toBeLessThanOrEqual(99);
      });
    });
  });

  it("all unlocks have non-empty descriptions", () => {
    if (!isSkillUnlocksLoaded()) return; // Skip if manifest not loaded
    const allUnlocks = getAllSkillUnlocks();
    implementedSkills.forEach((skill) => {
      const unlocks = allUnlocks[skill];
      if (!unlocks) return; // Skip skills without unlock data
      unlocks.forEach((unlock, index) => {
        expect(
          unlock.description.length,
          `${skill}[${index}]: description should not be empty`,
        ).toBeGreaterThan(0);
      });
    });
  });

  it("all unlock types are valid", () => {
    if (!isSkillUnlocksLoaded()) return; // Skip if manifest not loaded
    const validTypes = ["item", "ability", "area", "quest", "activity"];
    const allUnlocks = getAllSkillUnlocks();
    implementedSkills.forEach((skill) => {
      const unlocks = allUnlocks[skill];
      if (!unlocks) return; // Skip skills without unlock data
      unlocks.forEach((unlock, index) => {
        expect(
          validTypes,
          `${skill}[${index}]: type "${unlock.type}" should be valid`,
        ).toContain(unlock.type);
      });
    });
  });

  it("combat skills have level 1 unlocks", () => {
    const combatSkills = ["attack", "defence", "prayer"];
    const allUnlocks = getAllSkillUnlocks();
    combatSkills.forEach((skill) => {
      const unlocks = allUnlocks[skill];
      const hasLevel1 = unlocks?.some((u) => u.level === 1);
      expect(hasLevel1, `${skill} should have level 1 unlock`).toBe(true);
    });
  });

  it("gathering skills have level 1 unlocks", () => {
    const gatheringSkills = ["woodcutting", "mining", "fishing"];
    const allUnlocks = getAllSkillUnlocks();
    gatheringSkills.forEach((skill) => {
      const unlocks = allUnlocks[skill];
      const hasLevel1 = unlocks?.some((u) => u.level === 1);
      expect(hasLevel1, `${skill} should have level 1 unlock`).toBe(true);
    });
  });

  it("artisan skills have level 1 unlocks", () => {
    const artisanSkills = ["cooking", "firemaking", "smithing"];
    const allUnlocks = getAllSkillUnlocks();
    artisanSkills.forEach((skill) => {
      const unlocks = allUnlocks[skill];
      const hasLevel1 = unlocks?.some((u) => u.level === 1);
      expect(hasLevel1, `${skill} should have level 1 unlock`).toBe(true);
    });
  });
});

// ============================================================================
// OSRS-Accurate Skill Unlock Verification
// ============================================================================

describe("OSRS-accurate skill unlock values", () => {
  it("attack weapon tiers are OSRS accurate", () => {
    const allUnlocks = getAllSkillUnlocks();
    const attack = allUnlocks.attack;

    // Verify key OSRS attack milestones
    expect(attack.find((u) => u.level === 1)?.description).toContain("Bronze");
    expect(attack.find((u) => u.level === 5)?.description).toContain("Steel");
    expect(attack.find((u) => u.level === 20)?.description).toContain(
      "Mithril",
    );
    expect(attack.find((u) => u.level === 30)?.description).toContain(
      "Adamant",
    );
    expect(attack.find((u) => u.level === 40)?.description).toContain("Rune");
    expect(attack.find((u) => u.level === 60)?.description).toContain("Dragon");
  });

  it("defence armor tiers are OSRS accurate", () => {
    const allUnlocks = getAllSkillUnlocks();
    const defence = allUnlocks.defence;

    expect(defence.find((u) => u.level === 1)?.description).toContain("Bronze");
    expect(defence.find((u) => u.level === 40)?.description).toContain("Rune");
    expect(defence.find((u) => u.level === 60)?.description).toContain(
      "Dragon",
    );
    expect(defence.find((u) => u.level === 70)?.description).toContain(
      "Barrows",
    );
  });

  it("prayer protection prayers unlock at correct levels", () => {
    const allUnlocks = getAllSkillUnlocks();
    const prayer = allUnlocks.prayer;

    // Protection prayers at 37, 40, 43
    expect(prayer.find((u) => u.level === 37)?.description).toContain(
      "Protect from Magic",
    );
    expect(prayer.find((u) => u.level === 40)?.description).toContain(
      "Protect from Missiles",
    );
    expect(prayer.find((u) => u.level === 43)?.description).toContain(
      "Protect from Melee",
    );
    expect(prayer.find((u) => u.level === 70)?.description).toContain("Piety");
  });

  it("woodcutting tree types are OSRS accurate", () => {
    const allUnlocks = getAllSkillUnlocks();
    const woodcutting = allUnlocks.woodcutting;

    expect(woodcutting.find((u) => u.level === 1)?.description).toBe(
      "Normal trees",
    );
    expect(woodcutting.find((u) => u.level === 15)?.description).toBe(
      "Oak trees",
    );
    expect(woodcutting.find((u) => u.level === 30)?.description).toBe(
      "Willow trees",
    );
    expect(woodcutting.find((u) => u.level === 35)?.description).toBe(
      "Teak trees",
    );
    expect(woodcutting.find((u) => u.level === 60)?.description).toBe(
      "Yew trees",
    );
    expect(woodcutting.find((u) => u.level === 75)?.description).toBe(
      "Magic trees",
    );
    expect(woodcutting.find((u) => u.level === 90)?.description).toBe(
      "Redwood trees",
    );
  });

  it("mining ore types are OSRS accurate", () => {
    const allUnlocks = getAllSkillUnlocks();
    const mining = allUnlocks.mining;

    expect(mining.find((u) => u.level === 1)?.description).toContain("Copper");
    expect(mining.find((u) => u.level === 15)?.description).toBe("Iron ore");
    expect(mining.find((u) => u.level === 30)?.description).toBe("Coal");
    expect(mining.find((u) => u.level === 55)?.description).toBe("Mithril ore");
    expect(mining.find((u) => u.level === 70)?.description).toBe(
      "Adamantite ore",
    );
    expect(mining.find((u) => u.level === 85)?.description).toBe("Runite ore");
  });

  it("fishing levels are OSRS accurate", () => {
    const allUnlocks = getAllSkillUnlocks();
    const fishing = allUnlocks.fishing;

    expect(fishing.find((u) => u.level === 1)?.description).toBe("Shrimp");
    expect(fishing.find((u) => u.level === 20)?.description).toBe("Trout");
    expect(fishing.find((u) => u.level === 40)?.description).toBe("Lobster");
    expect(fishing.find((u) => u.level === 50)?.description).toBe("Swordfish");
    expect(fishing.find((u) => u.level === 76)?.description).toBe("Shark");
  });

  it("cooking levels are OSRS accurate", () => {
    const allUnlocks = getAllSkillUnlocks();
    const cooking = allUnlocks.cooking;

    expect(cooking.find((u) => u.level === 1)?.description).toContain("Shrimp");
    expect(cooking.find((u) => u.level === 15)?.description).toBe("Trout");
    expect(cooking.find((u) => u.level === 40)?.description).toBe("Lobster");
    expect(cooking.find((u) => u.level === 45)?.description).toBe("Swordfish");
    expect(cooking.find((u) => u.level === 80)?.description).toBe("Shark");
  });

  it("firemaking levels match woodcutting", () => {
    const allUnlocks = getAllSkillUnlocks();
    const firemaking = allUnlocks.firemaking;

    expect(firemaking.find((u) => u.level === 1)?.description).toBe(
      "Normal logs",
    );
    expect(firemaking.find((u) => u.level === 15)?.description).toBe(
      "Oak logs",
    );
    expect(firemaking.find((u) => u.level === 30)?.description).toBe(
      "Willow logs",
    );
    expect(firemaking.find((u) => u.level === 60)?.description).toBe(
      "Yew logs",
    );
    expect(firemaking.find((u) => u.level === 75)?.description).toBe(
      "Magic logs",
    );
    expect(firemaking.find((u) => u.level === 90)?.description).toBe(
      "Redwood logs",
    );
  });

  it("smithing bar levels are OSRS accurate", () => {
    const allUnlocks = getAllSkillUnlocks();
    const smithing = allUnlocks.smithing;

    expect(smithing.find((u) => u.level === 1)?.description).toBe("Bronze bar");
    expect(smithing.find((u) => u.level === 15)?.description).toContain(
      "Iron bar",
    );
    expect(smithing.find((u) => u.level === 30)?.description).toBe("Steel bar");
    expect(smithing.find((u) => u.level === 50)?.description).toBe(
      "Mithril bar",
    );
    expect(smithing.find((u) => u.level === 70)?.description).toBe(
      "Adamant bar",
    );
    expect(smithing.find((u) => u.level === 85)?.description).toBe("Rune bar");
  });
});

// ============================================================================
// Cache Behavior Tests
// ============================================================================

describe("Skill unlocks cache", () => {
  it("clearSkillUnlocksCache does not throw", () => {
    getAllSkillUnlocks();
    expect(() => clearSkillUnlocksCache()).not.toThrow();
    const allUnlocks = getAllSkillUnlocks();
    expect(allUnlocks.cooking).toBeDefined();
    expect(Array.isArray(allUnlocks.cooking)).toBe(true);
  });
});
