/**
 * RateLimiter Tests
 *
 * Tests for the rate limiting functionality.
 *
 * @packageDocumentation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  RateLimiter,
  RateLimitError,
  checkRateLimit,
  withRateLimit,
  rateLimiters,
} from "@/lib/RateLimiter";

describe("RateLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("basic rate limiting", () => {
    it("should allow requests within the limit", () => {
      const limiter = new RateLimiter({ maxRequests: 5, windowMs: 1000 }); // 5 requests per second

      for (let i = 0; i < 5; i++) {
        expect(limiter.tryProceed()).toBe(true);
      }
    });

    it("should reject requests exceeding the limit", () => {
      const limiter = new RateLimiter({ maxRequests: 5, windowMs: 1000 }); // 5 requests per second

      // Use up all tokens
      for (let i = 0; i < 5; i++) {
        limiter.tryProceed();
      }

      // Next request should fail
      expect(limiter.tryProceed()).toBe(false);
    });

    it("should replenish tokens after window expires", () => {
      const limiter = new RateLimiter({ maxRequests: 5, windowMs: 1000 }); // 5 requests per second

      // Use up all tokens
      for (let i = 0; i < 5; i++) {
        limiter.tryProceed();
      }

      // Advance past window
      vi.advanceTimersByTime(1001);

      // Should be able to make requests again
      expect(limiter.tryProceed()).toBe(true);
    });
  });

  describe("getRemainingRequests", () => {
    it("should return correct remaining tokens", () => {
      const limiter = new RateLimiter({ maxRequests: 5, windowMs: 1000 });

      expect(limiter.getRemainingRequests()).toBe(5);

      limiter.tryProceed();
      expect(limiter.getRemainingRequests()).toBe(4);

      limiter.tryProceed();
      expect(limiter.getRemainingRequests()).toBe(3);
    });
  });

  describe("check().resetIn", () => {
    it("should return time until window resets", () => {
      const limiter = new RateLimiter({ maxRequests: 5, windowMs: 1000 });

      // Use a token to start the window
      limiter.tryProceed();

      // Advance 300ms
      vi.advanceTimersByTime(300);

      const result = limiter.check();
      expect(result.resetIn).toBeLessThanOrEqual(700);
      expect(result.resetIn).toBeGreaterThanOrEqual(0);
    });
  });

  describe("canProceed (rate limited check)", () => {
    it("should return true when not limited", () => {
      const limiter = new RateLimiter({ maxRequests: 5, windowMs: 1000 });
      expect(limiter.canProceed()).toBe(true);
    });

    it("should return false when limited", () => {
      const limiter = new RateLimiter({ maxRequests: 5, windowMs: 1000 });

      // Use up all tokens
      for (let i = 0; i < 5; i++) {
        limiter.tryProceed();
      }

      expect(limiter.canProceed()).toBe(false);
    });
  });

  describe("reset", () => {
    it("should reset the limiter state", () => {
      const limiter = new RateLimiter({ maxRequests: 5, windowMs: 1000 });

      // Use up all tokens
      for (let i = 0; i < 5; i++) {
        limiter.tryProceed();
      }

      expect(limiter.canProceed()).toBe(false);

      limiter.reset();

      expect(limiter.canProceed()).toBe(true);
      expect(limiter.getRemainingRequests()).toBe(5);
    });
  });
});

describe("RateLimitError", () => {
  it("should have correct properties", () => {
    const result = {
      allowed: false,
      remaining: 0,
      resetIn: 500,
      retryAfter: 500,
    };
    const error = new RateLimitError(result);

    expect(error.message).toContain("500");
    expect(error.retryAfter).toBe(500);
    expect(error.remaining).toBe(0);
    expect(error.name).toBe("RateLimitError");
  });
});

describe("checkRateLimit", () => {
  beforeEach(() => {
    // Reset all pre-configured limiters before each test
    Object.values(rateLimiters).forEach((limiter) => limiter.reset());
  });

  it("should return true when not limited", () => {
    // checkRateLimit returns boolean, not throws
    expect(checkRateLimit("chat")).toBe(true);
  });

  it("should return false when limited", () => {
    // Use up all chat tokens (5 per 10 seconds)
    for (let i = 0; i < 5; i++) {
      checkRateLimit("chat");
    }

    // Next call should return false
    expect(checkRateLimit("chat")).toBe(false);
  });
});

describe("withRateLimit", () => {
  it("should execute function when not limited", () => {
    const limiter = new RateLimiter({ maxRequests: 5, windowMs: 1000 });
    const fn = vi.fn().mockReturnValue("result");

    const wrappedFn = withRateLimit(fn, limiter);
    const result = wrappedFn();

    expect(fn).toHaveBeenCalled();
    expect(result).toBe("result");
  });

  it("should return undefined when limited (without throwOnLimit)", () => {
    const limiter = new RateLimiter({ maxRequests: 1, windowMs: 1000 });
    const fn = vi.fn().mockReturnValue("result");

    const wrappedFn = withRateLimit(fn, limiter);

    // First call succeeds
    expect(wrappedFn()).toBe("result");

    // Second call should return undefined (rate limited)
    expect(wrappedFn()).toBeUndefined();
    expect(fn).toHaveBeenCalledTimes(1); // fn only called once
  });

  it("should throw RateLimitError when limited with throwOnLimit option", () => {
    const limiter = new RateLimiter({ maxRequests: 1, windowMs: 1000 });
    const fn = vi.fn().mockReturnValue("result");

    const wrappedFn = withRateLimit(fn, limiter, { throwOnLimit: true });

    // First call succeeds
    wrappedFn();

    // Second call should throw
    expect(() => wrappedFn()).toThrow(RateLimitError);
  });
});

describe("pre-configured limiters", () => {
  beforeEach(() => {
    // Reset all pre-configured limiters before each test
    Object.values(rateLimiters).forEach((limiter) => limiter.reset());
  });

  it("chat limiter should be configured correctly", () => {
    // Chat limiter: 5 messages per 10 seconds
    expect(rateLimiters.chat).toBeDefined();
    expect(rateLimiters.chat.getRemainingRequests()).toBeGreaterThan(0);
  });

  it("actions limiter should be configured correctly", () => {
    // Action limiter: 30 actions per second
    expect(rateLimiters.actions).toBeDefined();
    expect(rateLimiters.actions.getRemainingRequests()).toBeGreaterThan(0);
  });

  it("api limiter should be configured correctly", () => {
    // API limiter: 60 requests per minute
    expect(rateLimiters.api).toBeDefined();
    expect(rateLimiters.api.getRemainingRequests()).toBeGreaterThan(0);
  });
});
