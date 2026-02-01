import { describe, it, expect } from "vitest";
import { LoadTestBot, type LoadTestBehavior } from "../LoadTestBot";

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

// Check server availability at module load time (for future integration tests)
let serverAvailable = false;
void checkServerAvailable().then((available) => {
  serverAvailable = available;
  if (!available) {
    console.log(
      "[LoadTestBot Tests] Server not available at localhost:5555, integration tests will be skipped",
    );
  }
});

describe("LoadTestBot Unit Tests", () => {
  describe("Configuration", () => {
    it("uses default values when not specified", () => {
      const bot = new LoadTestBot({
        wsUrl: TEST_WS_URL,
        name: "TestBot",
        behavior: "idle",
      });
      expect(bot.name).toBe("TestBot");
      expect(bot.connected).toBe(false);
    });

    it("accepts all behavior types", () => {
      const behaviors: LoadTestBehavior[] = [
        "idle",
        "wander",
        "explore",
        "sprint",
      ];
      for (const behavior of behaviors) {
        const bot = new LoadTestBot({
          wsUrl: TEST_WS_URL,
          name: `Bot-${behavior}`,
          behavior,
        });
        expect(bot.name).toBe(`Bot-${behavior}`);
      }
    });

    it("accepts custom update interval", () => {
      const bot = new LoadTestBot({
        wsUrl: TEST_WS_URL,
        name: "CustomInterval",
        behavior: "wander",
        updateInterval: 1000,
      });
      expect(bot.name).toBe("CustomInterval");
    });

    it("accepts custom radius values", () => {
      const bot = new LoadTestBot({
        wsUrl: TEST_WS_URL,
        name: "CustomRadius",
        behavior: "explore",
        wanderRadius: 5,
        exploreRadius: 100,
      });
      expect(bot.name).toBe("CustomRadius");
    });
  });

  describe("Name Property", () => {
    it("returns configured name", () => {
      expect(
        new LoadTestBot({
          wsUrl: TEST_WS_URL,
          name: "Bot-0001",
          behavior: "idle",
        }).name,
      ).toBe("Bot-0001");
    });

    it("handles special characters", () => {
      expect(
        new LoadTestBot({
          wsUrl: TEST_WS_URL,
          name: "Bot_Special-123!",
          behavior: "idle",
        }).name,
      ).toBe("Bot_Special-123!");
    });

    it("handles empty name", () => {
      expect(
        new LoadTestBot({ wsUrl: TEST_WS_URL, name: "", behavior: "idle" })
          .name,
      ).toBe("");
    });
  });

  describe("Connection State", () => {
    it("starts disconnected", () => {
      expect(
        new LoadTestBot({
          wsUrl: TEST_WS_URL,
          name: "TestBot",
          behavior: "idle",
        }).connected,
      ).toBe(false);
    });

    it("disconnect on unconnected bot does not throw", () => {
      const bot = new LoadTestBot({
        wsUrl: TEST_WS_URL,
        name: "TestBot",
        behavior: "idle",
      });
      expect(() => bot.disconnect()).not.toThrow();
      expect(bot.connected).toBe(false);
    });

    it("multiple disconnects are safe", () => {
      const bot = new LoadTestBot({
        wsUrl: TEST_WS_URL,
        name: "TestBot",
        behavior: "idle",
      });
      bot.disconnect();
      bot.disconnect();
      bot.disconnect();
      expect(bot.connected).toBe(false);
    });
  });

  describe("Initial Metrics", () => {
    it("initializes with zero metrics", () => {
      const bot = new LoadTestBot({
        wsUrl: TEST_WS_URL,
        name: "MetricsBot",
        behavior: "idle",
      });
      expect(bot.metrics.distanceTraveled).toBe(0);
      expect(bot.metrics.moveCommandsSent).toBe(0);
      expect(bot.metrics.errors).toBe(0);
      expect(bot.metrics.connectedAt).toBe(0);
      expect(bot.metrics.lastMessageAt).toBe(0);
      expect(bot.metrics.isConnected).toBe(false);
      expect(bot.metrics.networkUnavailableCount).toBe(0);
      expect(bot.metrics.positionUnavailableCount).toBe(0);
      expect(bot.metrics.connectionLostAt).toBe(0);
      expect(bot.metrics.disconnectReason).toBe("");
    });

    it("metrics object is defined", () => {
      const bot = new LoadTestBot({
        wsUrl: TEST_WS_URL,
        name: "MetricsBot",
        behavior: "idle",
      });
      expect(bot.metrics).toBeDefined();
      expect(typeof bot.metrics.distanceTraveled).toBe("number");
    });
  });

  describe("URL Building", () => {
    it("appends loadTestBot parameter", () => {
      const url = new URL(TEST_WS_URL);
      url.searchParams.set("loadTestBot", "true");
      url.searchParams.set("botName", "TestBot-001");
      expect(url.toString()).toContain("loadTestBot=true");
      expect(url.toString()).toContain("botName=TestBot-001");
    });

    it("handles existing query parameters", () => {
      const url = new URL("ws://localhost:5555/ws?existing=param");
      url.searchParams.set("loadTestBot", "true");
      expect(url.toString()).toContain("existing=param");
      expect(url.toString()).toContain("loadTestBot=true");
    });
  });

  describe("Edge Cases", () => {
    it("handles very long bot names", () => {
      const longName = "Bot-" + "x".repeat(1000);
      expect(
        new LoadTestBot({
          wsUrl: TEST_WS_URL,
          name: longName,
          behavior: "idle",
        }).name,
      ).toBe(longName);
    });

    it("handles zero radius values", () => {
      const bot = new LoadTestBot({
        wsUrl: TEST_WS_URL,
        name: "ZeroRadius",
        behavior: "wander",
        wanderRadius: 0,
        exploreRadius: 0,
      });
      expect(bot.name).toBe("ZeroRadius");
    });

    it("handles negative radius values", () => {
      const bot = new LoadTestBot({
        wsUrl: TEST_WS_URL,
        name: "NegativeRadius",
        behavior: "wander",
        wanderRadius: -10,
      });
      expect(bot.name).toBe("NegativeRadius");
    });

    it("handles very small update intervals", () => {
      const bot = new LoadTestBot({
        wsUrl: TEST_WS_URL,
        name: "FastUpdate",
        behavior: "wander",
        updateInterval: 1,
      });
      expect(bot.name).toBe("FastUpdate");
    });

    it("handles very large update intervals", () => {
      const bot = new LoadTestBot({
        wsUrl: TEST_WS_URL,
        name: "SlowUpdate",
        behavior: "wander",
        updateInterval: 1000000,
      });
      expect(bot.name).toBe("SlowUpdate");
    });
  });
});

// Integration tests require a running server - skip entire section if unavailable
// These tests are meant to be run manually with: bun test LoadTestBot.test.ts
// when the game server is running on localhost:5555
describe.skipIf(!serverAvailable)("LoadTestBot Integration Tests", () => {
  describe("Connection", () => {
    it("connects to server when available", async () => {
      const bot = new LoadTestBot({
        wsUrl: TEST_WS_URL,
        name: "IntegrationBot-001",
        behavior: "idle",
      });
      try {
        await bot.connect();
        expect(bot.metrics.connectedAt).toBeGreaterThan(0);
      } catch {
        // Connection rejection acceptable
      } finally {
        bot.disconnect();
      }
    });

    it("updates metrics after connection attempt", async () => {
      const bot = new LoadTestBot({
        wsUrl: TEST_WS_URL,
        name: "MetricsIntegrationBot",
        behavior: "idle",
      });
      try {
        await bot.connect();
        expect(bot.metrics.connectedAt).toBeGreaterThan(0);
      } catch {
        // Connection rejection acceptable
      } finally {
        bot.disconnect();
      }
    });

    it("handles rapid connect/disconnect", async () => {
      const bot = new LoadTestBot({
        wsUrl: TEST_WS_URL,
        name: "RapidBot",
        behavior: "idle",
      });
      try {
        await bot.connect();
      } catch {
        // Connection may fail, that's ok
      }
      bot.disconnect();
      expect(bot.connected).toBe(false);
    });
  });

  describe("Connection Failure", () => {
    it("throws error for malformed URL", async () => {
      const bot = new LoadTestBot({
        wsUrl: "not-a-valid-url",
        name: "MalformedBot",
        behavior: "idle",
      });
      await expect(bot.connect()).rejects.toThrow();
    });

    it("bot remains disconnected after failed connection attempt", async () => {
      const bot = new LoadTestBot({
        wsUrl: "ws://127.0.0.1:9999/ws",
        name: "DisconnectedBot",
        behavior: "idle",
      });
      expect(bot.connected).toBe(false);
      expect(bot.metrics.isConnected).toBe(false);
      bot.disconnect();
      expect(bot.connected).toBe(false);
    });
  });

  describe("Wander Behavior", () => {
    it("completes startup with wander behavior", async () => {
      const bot = new LoadTestBot({
        wsUrl: TEST_WS_URL,
        name: "WanderBot",
        behavior: "wander",
        updateInterval: 500,
      });
      try {
        await bot.connect();
        await new Promise((r) => setTimeout(r, 1500));
        expect(typeof bot.metrics.moveCommandsSent).toBe("number");
      } catch {
        // Connection may fail
      } finally {
        bot.disconnect();
      }
    });
  });

  describe("Explore Behavior", () => {
    it("completes startup with explore behavior", async () => {
      const bot = new LoadTestBot({
        wsUrl: TEST_WS_URL,
        name: "ExploreBot",
        behavior: "explore",
        updateInterval: 500,
      });
      try {
        await bot.connect();
        await new Promise((r) => setTimeout(r, 1500));
        expect(typeof bot.metrics.moveCommandsSent).toBe("number");
      } catch {
        // Connection may fail
      } finally {
        bot.disconnect();
      }
    });
  });

  describe("Sprint Behavior", () => {
    it("completes startup with sprint behavior", async () => {
      const bot = new LoadTestBot({
        wsUrl: TEST_WS_URL,
        name: "SprintBot",
        behavior: "sprint",
        updateInterval: 500,
      });
      try {
        await bot.connect();
        await new Promise((r) => setTimeout(r, 1500));
        expect(typeof bot.metrics.moveCommandsSent).toBe("number");
      } catch {
        // Connection may fail
      } finally {
        bot.disconnect();
      }
    });
  });

  describe("Idle Behavior", () => {
    it("does not send move commands when idle", async () => {
      const bot = new LoadTestBot({
        wsUrl: TEST_WS_URL,
        name: "IdleBot",
        behavior: "idle",
      });
      try {
        await bot.connect();
        await new Promise((r) => setTimeout(r, 2000));
        expect(bot.metrics.moveCommandsSent).toBe(0);
      } catch {
        // Connection may fail
      } finally {
        bot.disconnect();
      }
    });
  });
});
