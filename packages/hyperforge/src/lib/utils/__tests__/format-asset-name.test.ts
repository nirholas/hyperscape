/**
 * Format Asset Name Tests
 *
 * Tests for asset name formatting utilities.
 */

import { describe, it, expect } from "vitest";
import {
  formatAssetName,
  parseMaterialFromName,
  isBaseModel,
  nameToSlug,
} from "@/lib/utils/format-asset-name";

describe("Format Asset Name", () => {
  describe("formatAssetName", () => {
    it("converts hyphenated name to title case", () => {
      expect(formatAssetName("sword-bronze")).toBe("Sword Bronze");
      expect(formatAssetName("iron-helmet")).toBe("Iron Helmet");
    });

    it("handles single word names", () => {
      expect(formatAssetName("sword")).toBe("Sword");
      expect(formatAssetName("shield")).toBe("Shield");
    });

    it("adds (Base) suffix for base models", () => {
      expect(formatAssetName("sword-bronze-base")).toBe("Sword Bronze (Base)");
      expect(formatAssetName("axe-steel-base")).toBe("Axe Steel (Base)");
    });

    it("handles multiple hyphens", () => {
      expect(formatAssetName("two-handed-sword")).toBe("Two Handed Sword");
      expect(formatAssetName("dragon-scale-armor")).toBe("Dragon Scale Armor");
    });

    it("returns 'Unnamed Asset' for empty string", () => {
      expect(formatAssetName("")).toBe("Unnamed Asset");
    });

    it("capitalizes each word correctly", () => {
      expect(formatAssetName("bronze-longsword")).toBe("Bronze Longsword");
      expect(formatAssetName("mithril-platebody")).toBe("Mithril Platebody");
    });

    it("handles base suffix case insensitively", () => {
      expect(formatAssetName("sword-base")).toBe("Sword (Base)");
    });
  });

  describe("parseMaterialFromName", () => {
    it("detects bronze material", () => {
      expect(parseMaterialFromName("bronze-sword")).toBe("bronze");
      expect(parseMaterialFromName("Bronze Helmet")).toBe("bronze");
    });

    it("detects steel material", () => {
      expect(parseMaterialFromName("steel-axe")).toBe("steel");
      expect(parseMaterialFromName("Steel Platelegs")).toBe("steel");
    });

    it("detects mithril material", () => {
      expect(parseMaterialFromName("mithril-dagger")).toBe("mithril");
      expect(parseMaterialFromName("Mithril Shield")).toBe("mithril");
    });

    it("detects iron material", () => {
      expect(parseMaterialFromName("iron-sword")).toBe("iron");
      expect(parseMaterialFromName("Iron Boots")).toBe("iron");
    });

    it("detects wood materials", () => {
      expect(parseMaterialFromName("wood-bow")).toBe("wood");
      expect(parseMaterialFromName("oak-longbow")).toBe("oak");
      expect(parseMaterialFromName("willow-shortbow")).toBe("willow");
    });

    it("detects leather material", () => {
      expect(parseMaterialFromName("leather-armor")).toBe("leather");
      expect(parseMaterialFromName("Leather Gloves")).toBe("leather");
    });

    it("returns undefined for unknown materials", () => {
      expect(parseMaterialFromName("dragon-sword")).toBeUndefined();
      expect(parseMaterialFromName("crystal-staff")).toBeUndefined();
      expect(parseMaterialFromName("goblin")).toBeUndefined();
    });

    it("handles case variations", () => {
      expect(parseMaterialFromName("BRONZE-SWORD")).toBe("bronze");
      expect(parseMaterialFromName("Steel-Axe")).toBe("steel");
      expect(parseMaterialFromName("MITHRIL")).toBe("mithril");
    });
  });

  describe("isBaseModel", () => {
    it("returns true for names ending with -base", () => {
      expect(isBaseModel("sword-base")).toBe(true);
      expect(isBaseModel("bronze-axe-base")).toBe(true);
      expect(isBaseModel("dragon-armor-base")).toBe(true);
    });

    it("returns false for names not ending with -base", () => {
      expect(isBaseModel("sword")).toBe(false);
      expect(isBaseModel("bronze-sword")).toBe(false);
      expect(isBaseModel("base-sword")).toBe(false);
    });

    it("handles case variations", () => {
      expect(isBaseModel("sword-BASE")).toBe(true);
      expect(isBaseModel("sword-Base")).toBe(true);
    });

    it("returns false for empty string", () => {
      expect(isBaseModel("")).toBe(false);
    });
  });

  describe("nameToSlug", () => {
    it("converts display name to slug", () => {
      expect(nameToSlug("Bronze Sword")).toBe("bronze-sword");
      expect(nameToSlug("Iron Helmet")).toBe("iron-helmet");
    });

    it("handles (Base) suffix", () => {
      expect(nameToSlug("Bronze Sword (Base)")).toBe("bronze-sword-base");
      expect(nameToSlug("Steel Axe (Base)")).toBe("steel-axe-base");
    });

    it("handles multiple words", () => {
      expect(nameToSlug("Two Handed Sword")).toBe("two-handed-sword");
      expect(nameToSlug("Dragon Scale Armor")).toBe("dragon-scale-armor");
    });

    it("handles single word names", () => {
      expect(nameToSlug("Sword")).toBe("sword");
      expect(nameToSlug("Shield")).toBe("shield");
    });

    it("handles mixed case (Base) suffix", () => {
      expect(nameToSlug("Sword (base)")).toBe("sword-base");
      expect(nameToSlug("Axe (BASE)")).toBe("axe-base");
    });

    it("handles multiple spaces", () => {
      expect(nameToSlug("Bronze   Sword")).toBe("bronze-sword");
    });

    it("preserves lowercase on conversion", () => {
      expect(nameToSlug("BRONZE SWORD")).toBe("bronze-sword");
    });
  });

  describe("round-trip conversion", () => {
    it("converts name to slug and back (without base)", () => {
      const original = "bronze-sword";
      const displayName = formatAssetName(original);
      const slug = nameToSlug(displayName);

      expect(slug).toBe(original);
    });

    it("converts name to slug and back (with base)", () => {
      const original = "bronze-sword-base";
      const displayName = formatAssetName(original);
      const slug = nameToSlug(displayName);

      expect(slug).toBe(original);
    });
  });
});
