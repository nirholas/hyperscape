/**
 * Tests for useCurrency and useCurrencies hooks
 */

import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  useCurrency,
  useCurrencies,
  useCurrencyStore,
} from "../../src/core/currency/useCurrency";
import {
  formatCurrency,
  parseCurrency,
  compactNumber,
  convertCurrency,
  validateAmount,
  calculateBreakdown,
  toTotalCopper,
  formatBreakdown,
  getChangeIndicator,
  formatChange,
} from "../../src/core/currency/currencyUtils";

describe("currencyUtils", () => {
  describe("formatCurrency", () => {
    it("should format small amounts without suffix", () => {
      const result = formatCurrency(500, "gold", { compact: true });
      expect(result.value).toBe("500");
      expect(result.suffix).toBe("");
      expect(result.currencySuffix).toBe("g");
    });

    it("should format thousands with k suffix", () => {
      const result = formatCurrency(1500, "gold", { compact: true });
      expect(result.value).toBe("1.5");
      expect(result.suffix).toBe("k");
      expect(result.full).toBe("1.5k g");
    });

    it("should format millions with M suffix", () => {
      const result = formatCurrency(2500000, "gold", { compact: true });
      expect(result.value).toBe("2.5");
      expect(result.suffix).toBe("M");
    });

    it("should format billions with B suffix", () => {
      const result = formatCurrency(1500000000, "gold", { compact: true });
      expect(result.value).toBe("1.5");
      expect(result.suffix).toBe("B");
    });

    it("should format without compact notation", () => {
      const result = formatCurrency(1234567, "gold", { compact: false });
      expect(result.value).toBe("1,234,567");
      expect(result.suffix).toBe("");
    });

    it("should respect showSuffix option", () => {
      const result = formatCurrency(1000, "gold", {
        compact: true,
        showSuffix: false,
      });
      expect(result.currencySuffix).toBe("");
    });
  });

  describe("parseCurrency", () => {
    it("should parse simple numbers", () => {
      expect(parseCurrency("1234")).toBe(1234);
    });

    it("should parse k suffix", () => {
      expect(parseCurrency("1.5k")).toBe(1500);
      expect(parseCurrency("10K")).toBe(10000);
    });

    it("should parse M suffix", () => {
      expect(parseCurrency("2.5M")).toBe(2500000);
      expect(parseCurrency("1m")).toBe(1000000);
    });

    it("should parse B suffix", () => {
      expect(parseCurrency("1B")).toBe(1000000000);
    });

    it("should handle numbers with commas", () => {
      expect(parseCurrency("1,234,567")).toBe(1234567);
    });

    it("should return 0 for invalid input", () => {
      expect(parseCurrency("invalid")).toBe(0);
      expect(parseCurrency("")).toBe(0);
    });
  });

  describe("compactNumber", () => {
    it("should compact thousands", () => {
      const result = compactNumber(1500, 1);
      expect(result.value).toBe("1.5");
      expect(result.suffix).toBe("k");
    });

    it("should compact millions", () => {
      const result = compactNumber(2345678, 2);
      expect(result.value).toBe("2.35");
      expect(result.suffix).toBe("M");
    });

    it("should not compact small numbers", () => {
      const result = compactNumber(500, 1);
      expect(result.value).toBe("500");
      expect(result.suffix).toBe("");
    });

    it("should handle negative numbers", () => {
      const result = compactNumber(-1500, 1);
      expect(result.value).toBe("-1.5");
      expect(result.suffix).toBe("k");
    });
  });

  describe("convertCurrency", () => {
    it("should convert gold to gems", () => {
      // 100 gold = 1 gem (gems have 100x conversion rate)
      const result = convertCurrency(100, "gold", "gems");
      expect(result).toBe(1);
    });

    it("should convert gems to gold", () => {
      const result = convertCurrency(1, "gems", "gold");
      expect(result).toBe(100);
    });

    it("should convert gold to tokens", () => {
      // 10 gold = 1 token (tokens have 10x conversion rate)
      const result = convertCurrency(10, "gold", "tokens");
      expect(result).toBe(1);
    });
  });

  describe("validateAmount", () => {
    it("should validate positive amounts", () => {
      const result = validateAmount(100, "gold");
      expect(result.valid).toBe(true);
    });

    it("should reject negative amounts", () => {
      const result = validateAmount(-100, "gold");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("negative");
    });

    it("should reject non-integer amounts", () => {
      const result = validateAmount(100.5, "gold");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("whole number");
    });

    it("should reject amounts exceeding balance", () => {
      const result = validateAmount(1000, "gold", 500);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Insufficient");
    });
  });

  describe("calculateBreakdown", () => {
    it("should calculate breakdown correctly", () => {
      const result = calculateBreakdown(12345);
      expect(result.gold).toBe(1);
      expect(result.silver).toBe(23);
      expect(result.copper).toBe(45);
    });

    it("should handle zero", () => {
      const result = calculateBreakdown(0);
      expect(result.gold).toBe(0);
      expect(result.silver).toBe(0);
      expect(result.copper).toBe(0);
    });

    it("should handle copper only", () => {
      const result = calculateBreakdown(50);
      expect(result.gold).toBe(0);
      expect(result.silver).toBe(0);
      expect(result.copper).toBe(50);
    });
  });

  describe("toTotalCopper", () => {
    it("should convert breakdown to total copper", () => {
      const result = toTotalCopper({ gold: 1, silver: 23, copper: 45 });
      expect(result).toBe(12345);
    });

    it("should handle partial breakdown", () => {
      const result = toTotalCopper({ gold: 1 });
      expect(result).toBe(10000);
    });
  });

  describe("formatBreakdown", () => {
    it("should format breakdown with all currencies", () => {
      const result = formatBreakdown({ gold: 1, silver: 23, copper: 45 });
      expect(result).toBe("1g 23s 45c");
    });

    it("should omit zero currencies", () => {
      const result = formatBreakdown({ gold: 5, silver: 0, copper: 0 });
      expect(result).toBe("5g");
    });

    it("should show copper for zero amount", () => {
      const result = formatBreakdown({ gold: 0, silver: 0, copper: 0 });
      expect(result).toBe("0c");
    });
  });

  describe("getChangeIndicator", () => {
    it("should return gain for positive delta", () => {
      expect(getChangeIndicator(100)).toBe("gain");
    });

    it("should return loss for negative delta", () => {
      expect(getChangeIndicator(-100)).toBe("loss");
    });

    it("should return neutral for zero delta", () => {
      expect(getChangeIndicator(0)).toBe("neutral");
    });
  });

  describe("formatChange", () => {
    it("should format positive change with plus sign", () => {
      const result = formatChange(100, "gold");
      expect(result.formatted).toContain("+");
      expect(result.indicator).toBe("gain");
    });

    it("should format negative change with minus sign", () => {
      const result = formatChange(-100, "gold");
      expect(result.formatted).toContain("-");
      expect(result.indicator).toBe("loss");
    });
  });
});

describe("useCurrency", () => {
  beforeEach(() => {
    useCurrencyStore.getState().reset();
  });

  describe("initial state", () => {
    it("should have zero balance initially", () => {
      const { result } = renderHook(() => useCurrency("gold"));

      expect(result.current.balance.amount).toBe(0);
      expect(result.current.formatted).toBe("0 g");
    });

    it("should have correct currency definition", () => {
      const { result } = renderHook(() => useCurrency("gold"));

      expect(result.current.currency.name).toBe("Gold");
      expect(result.current.currency.color).toBe("#ffd700");
    });
  });

  describe("setBalance", () => {
    it("should set balance correctly", () => {
      const { result } = renderHook(() => useCurrency("gold"));

      act(() => {
        result.current.setBalance(1000);
      });

      expect(result.current.balance.amount).toBe(1000);
    });

    it("should track change amount", () => {
      const { result } = renderHook(() => useCurrency("gold"));

      act(() => {
        result.current.setBalance(1000);
      });

      expect(result.current.lastChange).toBe(1000);
      expect(result.current.changeIndicator).toBe("gain");
    });
  });

  describe("add", () => {
    it("should add to balance", () => {
      const { result } = renderHook(() => useCurrency("gold"));

      act(() => {
        result.current.setBalance(1000);
        result.current.add(500);
      });

      expect(result.current.balance.amount).toBe(1500);
    });
  });

  describe("subtract", () => {
    it("should subtract from balance", () => {
      const { result } = renderHook(() => useCurrency("gold"));

      act(() => {
        result.current.setBalance(1000);
        const success = result.current.subtract(400);
        expect(success).toBe(true);
      });

      expect(result.current.balance.amount).toBe(600);
    });

    it("should return false for insufficient funds", () => {
      const { result } = renderHook(() => useCurrency("gold"));

      act(() => {
        result.current.setBalance(100);
        const success = result.current.subtract(500);
        expect(success).toBe(false);
      });

      // Balance should remain unchanged
      expect(result.current.balance.amount).toBe(100);
    });
  });

  describe("validate", () => {
    it("should validate amounts against balance", () => {
      const { result } = renderHook(() => useCurrency("gold"));

      act(() => {
        result.current.setBalance(1000);
      });

      expect(result.current.validate(500).valid).toBe(true);
      expect(result.current.validate(1500).valid).toBe(false);
    });
  });

  describe("isInsufficientFor", () => {
    it("should check if amount exceeds balance", () => {
      const { result } = renderHook(() => useCurrency("gold"));

      act(() => {
        result.current.setBalance(1000);
      });

      expect(result.current.isInsufficientFor(500)).toBe(false);
      expect(result.current.isInsufficientFor(1500)).toBe(true);
    });
  });

  describe("formatting", () => {
    it("should provide formatted values", () => {
      const { result } = renderHook(() => useCurrency("gold"));

      act(() => {
        result.current.setBalance(1234567);
      });

      expect(result.current.formatted).toBe("1,234,567 g");
      expect(result.current.formattedCompact).toBe("1.2M g");
    });
  });
});

describe("useCurrencies", () => {
  beforeEach(() => {
    useCurrencyStore.getState().reset();
  });

  describe("initial state", () => {
    it("should have empty balances initially", () => {
      const { result } = renderHook(() => useCurrencies());

      expect(result.current.balances).toHaveLength(0);
      expect(result.current.history).toHaveLength(0);
    });
  });

  describe("setBalance", () => {
    it("should set balance for currency type", () => {
      const { result } = renderHook(() => useCurrencies());

      act(() => {
        result.current.setBalance("gold", 1000);
        result.current.setBalance("gems", 50);
      });

      expect(result.current.getBalance("gold").amount).toBe(1000);
      expect(result.current.getBalance("gems").amount).toBe(50);
    });
  });

  describe("transfer", () => {
    it("should transfer between currencies", () => {
      const { result } = renderHook(() => useCurrencies());

      act(() => {
        result.current.setBalance("gold", 1000);
        result.current.setBalance("gems", 0);
        const success = result.current.transfer("gold", "gems", 500);
        expect(success).toBe(true);
      });

      expect(result.current.getBalance("gold").amount).toBe(500);
      expect(result.current.getBalance("gems").amount).toBe(500);
    });

    it("should fail transfer with insufficient funds", () => {
      const { result } = renderHook(() => useCurrencies());

      act(() => {
        result.current.setBalance("gold", 100);
        const success = result.current.transfer("gold", "gems", 500);
        expect(success).toBe(false);
      });

      // Balance should remain unchanged
      expect(result.current.getBalance("gold").amount).toBe(100);
    });
  });

  describe("history", () => {
    it("should track transaction history", () => {
      const { result } = renderHook(() => useCurrencies());

      act(() => {
        result.current.setBalance("gold", 1000);
        result.current.setBalance("gold", 1500);
      });

      expect(result.current.history.length).toBeGreaterThan(0);
    });

    it("should clear history", () => {
      const { result } = renderHook(() => useCurrencies());

      act(() => {
        result.current.setBalance("gold", 1000);
        result.current.clearHistory();
      });

      expect(result.current.history).toHaveLength(0);
    });
  });

  describe("getFormattedBalance", () => {
    it("should return formatted balance", () => {
      const { result } = renderHook(() => useCurrencies());

      act(() => {
        result.current.setBalance("gold", 1500000);
      });

      expect(result.current.getFormattedBalance("gold", true)).toBe("1.5M g");
      expect(result.current.getFormattedBalance("gold", false)).toBe(
        "1,500,000 g",
      );
    });
  });

  describe("totalValueInGold", () => {
    it("should calculate total value across currencies", () => {
      const { result } = renderHook(() => useCurrencies());

      act(() => {
        result.current.setBalance("gold", 1000);
        result.current.setBalance("gems", 1); // 1 gem = 100 gold
      });

      // Gold: 1000 + Gems: 100 = 1100
      expect(result.current.totalValueInGold).toBe(1100);
    });
  });

  describe("reset", () => {
    it("should reset all balances and history", () => {
      const { result } = renderHook(() => useCurrencies());

      act(() => {
        result.current.setBalance("gold", 1000);
        result.current.setBalance("gems", 50);
        result.current.reset();
      });

      expect(result.current.balances).toHaveLength(0);
      expect(result.current.history).toHaveLength(0);
    });
  });
});
