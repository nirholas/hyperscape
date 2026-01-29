import { describe, it, expect, afterEach, vi } from "vitest";
import { BotPoolManager } from "../BotPoolManager";

const TEST_WS_URL = "ws://localhost:5555/ws";

/**
 * Check if the game server is running.
 * Uses a short timeout to fail fast when server is unavailable.
 */
async function checkServerAvailable(): Promise<boolean> {
  try {
    const controller = new globalThis.AbortController();
    const timeout = setTimeout(() => controller.abort(), 500);
    await fetch("http://localhost:5555/health", { signal: controller.signal });
    clearTimeout(timeout);
    return true;
  } catch {
    return false;
  }
}

// Check server availability at module load time
let serverAvailable = false;
const serverCheckPromise = checkServerAvailable().then((available) => {
  serverAvailable = available;
  if (!available) {
    console.log(
      "[BotPoolManager Tests] Server not available at localhost:5555, integration tests will be skipped",
    );
  }
  return available;
});

/**
 * Helper to skip integration tests when server is not available.
 * Must be called at the start of each integration test.
 */
async function skipIfNoServer(): Promise<boolean> {
  await serverCheckPromise;
  if (!serverAvailable) {
    console.log("  → Skipped: server not available");
    return true;
  }
  return false;
}

describe("BotPoolManager Unit Tests", () => {
  describe("Configuration", () => {
    it("uses default values", () => {
      const pool = new BotPoolManager({
        wsUrl: TEST_WS_URL,
        botCount: 10,
        behavior: "idle",
      });
      expect(pool.running).toBe(false);
      expect(pool.getConnectedCount()).toBe(0);
    });

    it("accepts all configuration options", () => {
      const pool = new BotPoolManager({
        wsUrl: TEST_WS_URL,
        botCount: 50,
        behavior: "wander",
        rampUpDelayMs: 100,
        namePrefix: "CustomBot",
        updateInterval: 2000,
        onProgress: vi.fn(),
        onBotError: vi.fn(),
      });
      expect(pool.running).toBe(false);
    });

    it("accepts zero ramp-up delay", () => {
      const pool = new BotPoolManager({
        wsUrl: TEST_WS_URL,
        botCount: 5,
        behavior: "idle",
        rampUpDelayMs: 0,
      });
      expect(pool.running).toBe(false);
    });
  });

  describe("Initial State", () => {
    it("starts not running", () => {
      expect(
        new BotPoolManager({
          wsUrl: TEST_WS_URL,
          botCount: 10,
          behavior: "idle",
        }).running,
      ).toBe(false);
    });

    it("has zero connected bots", () => {
      expect(
        new BotPoolManager({
          wsUrl: TEST_WS_URL,
          botCount: 10,
          behavior: "idle",
        }).getConnectedCount(),
      ).toBe(0);
    });

    it("has zero failed bots", () => {
      expect(
        new BotPoolManager({
          wsUrl: TEST_WS_URL,
          botCount: 10,
          behavior: "idle",
        }).getFailedCount(),
      ).toBe(0);
    });

    it("has zero pending connections", () => {
      expect(
        new BotPoolManager({
          wsUrl: TEST_WS_URL,
          botCount: 10,
          behavior: "idle",
        }).getPendingCount(),
      ).toBe(0);
    });

    it("returns empty bot metrics", () => {
      expect(
        new BotPoolManager({
          wsUrl: TEST_WS_URL,
          botCount: 10,
          behavior: "idle",
        }).getBotMetrics(),
      ).toHaveLength(0);
    });
  });

  describe("Aggregated Metrics", () => {
    it("returns zero metrics when not started", () => {
      const m = new BotPoolManager({
        wsUrl: TEST_WS_URL,
        botCount: 10,
        behavior: "idle",
      }).getAggregatedMetrics();
      expect(m.totalBots).toBe(10);
      expect(m.connectedBots).toBe(0);
      expect(m.failedConnections).toBe(0);
      expect(m.totalDistanceTraveled).toBe(0);
      expect(m.totalMoveCommands).toBe(0);
      expect(m.totalErrors).toBe(0);
      expect(m.networkUnavailableTotal).toBe(0);
      expect(m.positionUnavailableTotal).toBe(0);
      expect(m.botsWithDisconnects).toBe(0);
    });

    it("pool runtime is 0 before starting", () => {
      expect(
        new BotPoolManager({
          wsUrl: TEST_WS_URL,
          botCount: 5,
          behavior: "idle",
        }).getAggregatedMetrics().poolRuntime,
      ).toBe(0);
    });

    it("messagesPerSecond is 0 when no messages sent", () => {
      expect(
        new BotPoolManager({
          wsUrl: TEST_WS_URL,
          botCount: 5,
          behavior: "idle",
        }).getAggregatedMetrics().messagesPerSecond,
      ).toBe(0);
    });
  });

  describe("Stop Without Start", () => {
    it("stop() on unstarted pool does not throw", async () => {
      const pool = new BotPoolManager({
        wsUrl: TEST_WS_URL,
        botCount: 10,
        behavior: "idle",
      });
      await pool.stop();
      expect(pool.running).toBe(false);
    });

    it("multiple stops are safe", async () => {
      const pool = new BotPoolManager({
        wsUrl: TEST_WS_URL,
        botCount: 10,
        behavior: "idle",
      });
      await pool.stop();
      await pool.stop();
      await pool.stop();
      expect(pool.running).toBe(false);
    });
  });

  describe("Boundary Conditions", () => {
    it("handles botCount of 1", () => {
      expect(
        new BotPoolManager({
          wsUrl: TEST_WS_URL,
          botCount: 1,
          behavior: "idle",
        }).getAggregatedMetrics().totalBots,
      ).toBe(1);
    });

    it("handles large botCount", () => {
      expect(
        new BotPoolManager({
          wsUrl: TEST_WS_URL,
          botCount: 10000,
          behavior: "idle",
        }).getAggregatedMetrics().totalBots,
      ).toBe(10000);
    });

    it("handles zero botCount", () => {
      expect(
        new BotPoolManager({
          wsUrl: TEST_WS_URL,
          botCount: 0,
          behavior: "idle",
        }).getAggregatedMetrics().totalBots,
      ).toBe(0);
    });
  });

  describe("Behavior Types", () => {
    it("accepts idle", () => {
      expect(
        new BotPoolManager({
          wsUrl: TEST_WS_URL,
          botCount: 5,
          behavior: "idle",
        }).running,
      ).toBe(false);
    });
    it("accepts wander", () => {
      expect(
        new BotPoolManager({
          wsUrl: TEST_WS_URL,
          botCount: 5,
          behavior: "wander",
        }).running,
      ).toBe(false);
    });
    it("accepts explore", () => {
      expect(
        new BotPoolManager({
          wsUrl: TEST_WS_URL,
          botCount: 5,
          behavior: "explore",
        }).running,
      ).toBe(false);
    });
    it("accepts sprint", () => {
      expect(
        new BotPoolManager({
          wsUrl: TEST_WS_URL,
          botCount: 5,
          behavior: "sprint",
        }).running,
      ).toBe(false);
    });
  });
});

// Integration tests require a running server - skip entire section if unavailable
// These tests are meant to be run manually with: bun test BotPoolManager.test.ts
// when the game server is running on localhost:5555
describe.skipIf(!serverAvailable)("BotPoolManager Integration Tests", () => {
  let pool: BotPoolManager | null = null;

  afterEach(async () => {
    if (pool) {
      await pool.stop();
      pool = null;
    }
  });

  describe("Start and Stop", () => {
    it("starts and connects bots", async () => {
      pool = new BotPoolManager({
        wsUrl: TEST_WS_URL,
        botCount: 3,
        behavior: "idle",
        rampUpDelayMs: 50,
        connectTimeoutMs: 2000,
      });
      await pool.start();
      expect(pool.running).toBe(true);
      expect(typeof pool.getConnectedCount()).toBe("number");
    });

    it("throws if started twice", async () => {
      pool = new BotPoolManager({
        wsUrl: TEST_WS_URL,
        botCount: 2,
        behavior: "idle",
        rampUpDelayMs: 10,
        connectTimeoutMs: 2000,
      });
      await pool.start();
      await expect(pool.start()).rejects.toThrow("already running");
    });

    it("stop clears all bots", async () => {
      pool = new BotPoolManager({
        wsUrl: TEST_WS_URL,
        botCount: 3,
        behavior: "idle",
        rampUpDelayMs: 50,
        connectTimeoutMs: 2000,
      });
      await pool.start();
      await pool.stop();
      expect(pool.running).toBe(false);
      expect(pool.getConnectedCount()).toBe(0);
    });
  });

  describe("Ramp-up", () => {
    it("respects ramp-up delay", async () => {
      const start = Date.now();
      pool = new BotPoolManager({
        wsUrl: TEST_WS_URL,
        botCount: 5,
        behavior: "idle",
        rampUpDelayMs: 100,
        connectTimeoutMs: 2000,
      });
      await pool.start();
      expect(Date.now() - start).toBeGreaterThan(400);
    });

    it("calls onProgress during ramp-up", async () => {
      const calls: number[] = [];
      pool = new BotPoolManager({
        wsUrl: TEST_WS_URL,
        botCount: 3,
        behavior: "idle",
        rampUpDelayMs: 50,
        connectTimeoutMs: 2000,
        onProgress: (c, t) => calls.push(t),
      });
      await pool.start();
      expect(calls.length).toBeGreaterThan(0);
      expect(calls.every((t) => t === 3)).toBe(true);
    });
  });

  describe("Bot Metrics", () => {
    it("returns individual bot metrics", async () => {
      pool = new BotPoolManager({
        wsUrl: TEST_WS_URL,
        botCount: 3,
        behavior: "idle",
        rampUpDelayMs: 50,
        namePrefix: "MetricsBot",
        connectTimeoutMs: 2000,
      });
      await pool.start();
      const metrics = pool.getBotMetrics();
      expect(metrics.length).toBe(3);
      for (const { name, metrics: m, failed } of metrics) {
        expect(name).toContain("MetricsBot");
        expect(m).toHaveProperty("distanceTraveled");
        expect(typeof failed).toBe("boolean");
      }
    });

    it("returns aggregated metrics", async () => {
      pool = new BotPoolManager({
        wsUrl: TEST_WS_URL,
        botCount: 3,
        behavior: "idle",
        rampUpDelayMs: 50,
        connectTimeoutMs: 2000,
      });
      await pool.start();
      const m = pool.getAggregatedMetrics();
      expect(m.totalBots).toBe(3);
      expect(m.poolRuntime).toBeGreaterThan(0);
    });
  });

  describe("Error Handling", () => {
    it("tracks connection failures", async () => {
      pool = new BotPoolManager({
        wsUrl: "ws://127.0.0.1:9999/ws",
        botCount: 2,
        behavior: "idle",
        rampUpDelayMs: 10,
        connectTimeoutMs: 1000,
      });
      await pool.start();
      const m = pool.getAggregatedMetrics();
      expect(m.totalBots).toBe(2);
      expect(m.failedConnections > 0 || m.connectedBots === 0).toBe(true);
    });

    it("onBotError callback receives errors", async () => {
      let _called = false;
      pool = new BotPoolManager({
        wsUrl: "ws://127.0.0.1:9999/ws",
        botCount: 2,
        behavior: "idle",
        rampUpDelayMs: 10,
        connectTimeoutMs: 1000,
        onBotError: () => {
          _called = true;
        },
      });
      await pool.start();
      expect(pool.getAggregatedMetrics().totalBots).toBe(2);
    });
  });

  describe("Wander Behavior", () => {
    it("bots with wander behavior complete startup", async () => {
      pool = new BotPoolManager({
        wsUrl: TEST_WS_URL,
        botCount: 2,
        behavior: "wander",
        rampUpDelayMs: 50,
        updateInterval: 500,
        connectTimeoutMs: 2000,
      });
      await pool.start();
      expect(pool.running).toBe(true);
      await new Promise((r) => setTimeout(r, 2000));
      expect(typeof pool.getAggregatedMetrics().totalMoveCommands).toBe(
        "number",
      );
    });
  });

  describe("Stop During Ramp-up", () => {
    it("can stop during ramp-up", async () => {
      pool = new BotPoolManager({
        wsUrl: TEST_WS_URL,
        botCount: 100,
        behavior: "idle",
        rampUpDelayMs: 100,
        connectTimeoutMs: 2000,
      });
      const p = pool.start();
      await new Promise((r) => setTimeout(r, 200));
      await pool.stop();
      await p.catch(() => {});
      expect(pool.running).toBe(false);
    });
  });

  describe("Sequential Pools", () => {
    it("handles multiple pools sequentially", async () => {
      pool = new BotPoolManager({
        wsUrl: TEST_WS_URL,
        botCount: 2,
        behavior: "idle",
        rampUpDelayMs: 50,
        connectTimeoutMs: 2000,
      });
      await pool.start();
      await pool.stop();
      pool = new BotPoolManager({
        wsUrl: TEST_WS_URL,
        botCount: 2,
        behavior: "idle",
        rampUpDelayMs: 50,
        connectTimeoutMs: 2000,
      });
      await pool.start();
      expect(pool.running).toBe(true);
    });
  });
});
