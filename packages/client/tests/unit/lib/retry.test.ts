/**
 * Retry Utility Unit Tests
 *
 * Tests for the retry utility with exponential backoff.
 * These tests use real async functions without mocking.
 */

import { describe, it, expect } from "vitest";
import {
  withRetry,
  tryWithRetry,
  retryable,
  type RetryOptions,
} from "../../../src/lib/retry";

describe("withRetry", () => {
  describe("successful operations", () => {
    it("should return result on first successful attempt", async () => {
      const fn = async () => "success";

      const result = await withRetry(fn);

      expect(result).toBe("success");
    });

    it("should work with async operations", async () => {
      const fn = async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return 42;
      };

      const result = await withRetry(fn);

      expect(result).toBe(42);
    });
  });

  describe("retry behavior", () => {
    it("should retry on failure and succeed eventually", async () => {
      let attempts = 0;
      const fn = async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error("Not yet");
        }
        return "success on attempt 3";
      };

      const result = await withRetry(fn, {
        maxRetries: 5,
        initialDelay: 10,
      });

      expect(result).toBe("success on attempt 3");
      expect(attempts).toBe(3);
    });

    it("should throw after max retries exceeded", async () => {
      let attempts = 0;
      const fn = async () => {
        attempts++;
        throw new Error("Always fails");
      };

      await expect(
        withRetry(fn, {
          maxRetries: 3,
          initialDelay: 10,
        }),
      ).rejects.toThrow("Always fails");

      expect(attempts).toBe(4); // Initial + 3 retries
    });

    it("should call onRetry callback on each retry", async () => {
      let attempts = 0;
      const retryAttempts: number[] = [];

      const fn = async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error("Retry me");
        }
        return "done";
      };

      await withRetry(fn, {
        maxRetries: 5,
        initialDelay: 10,
        onRetry: (attempt) => {
          retryAttempts.push(attempt);
        },
      });

      expect(retryAttempts).toEqual([1, 2]);
    });
  });

  describe("backoff strategies", () => {
    it("should use exponential backoff by default", async () => {
      const delays: number[] = [];
      let attempts = 0;

      const fn = async () => {
        attempts++;
        if (attempts < 4) {
          throw new Error("Fail");
        }
        return "done";
      };

      await withRetry(fn, {
        maxRetries: 5,
        initialDelay: 100,
        backoffMultiplier: 2,
        onRetry: (_attempt, _error, delay) => {
          delays.push(delay);
        },
      });

      // Exponential: 100, 200, 400
      expect(delays[0]).toBe(100);
      expect(delays[1]).toBe(200);
      expect(delays[2]).toBe(400);
    });

    it("should use linear backoff when specified", async () => {
      const delays: number[] = [];
      let attempts = 0;

      const fn = async () => {
        attempts++;
        if (attempts < 4) {
          throw new Error("Fail");
        }
        return "done";
      };

      await withRetry(fn, {
        maxRetries: 5,
        initialDelay: 100,
        backoff: "linear",
        linearIncrement: 50,
        onRetry: (_attempt, _error, delay) => {
          delays.push(delay);
        },
      });

      // Linear: 100, 150, 200
      expect(delays[0]).toBe(100);
      expect(delays[1]).toBe(150);
      expect(delays[2]).toBe(200);
    });

    it("should use fixed delay when specified", async () => {
      const delays: number[] = [];
      let attempts = 0;

      const fn = async () => {
        attempts++;
        if (attempts < 4) {
          throw new Error("Fail");
        }
        return "done";
      };

      await withRetry(fn, {
        maxRetries: 5,
        initialDelay: 100,
        backoff: "fixed",
        onRetry: (_attempt, _error, delay) => {
          delays.push(delay);
        },
      });

      // Fixed: all same
      expect(delays[0]).toBe(100);
      expect(delays[1]).toBe(100);
      expect(delays[2]).toBe(100);
    });

    it("should respect maxDelay", async () => {
      const delays: number[] = [];
      let attempts = 0;

      const fn = async () => {
        attempts++;
        if (attempts < 6) {
          throw new Error("Fail");
        }
        return "done";
      };

      await withRetry(fn, {
        maxRetries: 10,
        initialDelay: 100,
        maxDelay: 300,
        backoffMultiplier: 2,
        onRetry: (_attempt, _error, delay) => {
          delays.push(delay);
        },
      });

      // Exponential with cap: 100, 200, 300, 300, 300
      expect(delays[0]).toBe(100);
      expect(delays[1]).toBe(200);
      expect(delays[2]).toBe(300);
      expect(delays[3]).toBe(300); // Capped
      expect(delays[4]).toBe(300); // Capped
    });
  });

  describe("isRetryable predicate", () => {
    it("should not retry when isRetryable returns false", async () => {
      let attempts = 0;

      const fn = async () => {
        attempts++;
        throw new Error("Non-retryable");
      };

      await expect(
        withRetry(fn, {
          maxRetries: 5,
          initialDelay: 10,
          isRetryable: (error) => !error.message.includes("Non-retryable"),
        }),
      ).rejects.toThrow("Non-retryable");

      expect(attempts).toBe(1); // No retries
    });

    it("should retry when isRetryable returns true", async () => {
      let attempts = 0;

      const fn = async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error("Retryable error");
        }
        return "success";
      };

      const result = await withRetry(fn, {
        maxRetries: 5,
        initialDelay: 10,
        isRetryable: (error) => error.message.includes("Retryable"),
      });

      expect(result).toBe("success");
      expect(attempts).toBe(3);
    });
  });

  describe("abort signal", () => {
    it("should abort when signal is triggered", async () => {
      const controller = new AbortController();
      let attempts = 0;

      const fn = async () => {
        attempts++;
        throw new Error("Keep retrying");
      };

      // Abort after 50ms
      setTimeout(() => controller.abort(), 50);

      await expect(
        withRetry(fn, {
          maxRetries: 10,
          initialDelay: 100,
          signal: controller.signal,
        }),
      ).rejects.toThrow();

      // Should have been aborted before all retries
      expect(attempts).toBeLessThanOrEqual(2);
    });
  });
});

describe("tryWithRetry", () => {
  it("should return success result on success", async () => {
    const fn = async () => "hello";

    const result = await tryWithRetry(fn);

    expect(result.success).toBe(true);
    expect(result.value).toBe("hello");
    expect(result.error).toBeUndefined();
  });

  it("should return failure result after max retries", async () => {
    const fn = async () => {
      throw new Error("Failed");
    };

    const result = await tryWithRetry(fn, {
      maxRetries: 2,
      initialDelay: 10,
    });

    expect(result.success).toBe(false);
    expect(result.value).toBeUndefined();
    expect(result.error?.message).toBe("Failed");
    expect(result.attempts).toBe(3); // Initial + 2 retries
  });
});

describe("retryable", () => {
  it("should create a retryable version of a function", async () => {
    let attempts = 0;

    const unreliableFn = async (value: number): Promise<number> => {
      attempts++;
      if (attempts < 2) {
        throw new Error("Temporary failure");
      }
      return value * 2;
    };

    const reliableFn = retryable(unreliableFn, {
      maxRetries: 3,
      initialDelay: 10,
    });

    const result = await reliableFn(21);

    expect(result).toBe(42);
    expect(attempts).toBe(2);
  });

  it("should pass arguments correctly", async () => {
    const fn = async (a: string, b: number): Promise<string> => {
      return `${a}-${b}`;
    };

    const retryableFn = retryable(fn, { maxRetries: 1 });

    const result = await retryableFn("test", 123);

    expect(result).toBe("test-123");
  });
});
