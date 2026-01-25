import os from "os";
import { System } from "../shared";
import type { World } from "../../types";

// 30Hz tick rate for smooth, consistent gameplay
const TICK_RATE = 1 / 30;
const TICK_INTERVAL_MS = TICK_RATE * 1000;

/**
 * Maximum ticks to run per frame to prevent "tick storms" after long pauses.
 * OSRS-style: let ticks stretch under load, but cap catch-up to prevent
 * running dozens of ticks when tab regains focus after being backgrounded.
 */
const MAX_TICKS_PER_FRAME = 3;

/**
 * Threshold for warning about falling behind (in ticks).
 * If we're more than this many ticks behind, log a warning.
 */
const LAG_WARNING_THRESHOLD = 2;

/**
 * Server Runtime System
 *
 * Manages the server-side game loop with precise timing and performance monitoring.
 *
 * OSRS-Style Tick Handling:
 * - Ticks "stretch" under load (like OSRS worlds with many players)
 * - When behind, run up to MAX_TICKS_PER_FRAME ticks to catch up
 * - If severely behind (e.g., after tab unfocus), skip ahead rather than
 *   running many ticks at once (OSRS "missed tick" behavior)
 * - Performance monitoring with warnings when falling behind
 */
export class ServerRuntime extends System {
  private running = false;
  private lastTickTime = 0;
  private tickAccumulator = 0;

  // Performance monitoring
  private lastStatsTime = 0;
  private statsInterval = 1000; // Cache stats for 1 second
  private cachedStats: {
    maxMemory: number;
    currentMemory: number;
    maxCPU: number;
    currentCPU: number;
  } | null = null;

  // Lag tracking for performance monitoring
  private lagWarningCooldown = 0;

  constructor(world: World) {
    super(world);
  }

  start() {
    this.running = true;
    this.lastTickTime = performance.now();
    this.scheduleTick();
  }

  private scheduleTick() {
    if (!this.running) return;

    // Use setImmediate for more precise timing on server
    setImmediate(() => {
      const currentTime = performance.now();
      const deltaTime = currentTime - this.lastTickTime;

      // Accumulate time
      this.tickAccumulator += deltaTime;

      // Calculate how many ticks we're behind
      const ticksBehind = Math.floor(this.tickAccumulator / TICK_INTERVAL_MS);

      // OSRS-style: Run ticks, but cap at MAX_TICKS_PER_FRAME to prevent tick storms
      let ticksThisFrame = 0;

      while (
        this.tickAccumulator >= TICK_INTERVAL_MS &&
        ticksThisFrame < MAX_TICKS_PER_FRAME
      ) {
        // Perform the tick
        this.world.tick(currentTime);

        // Subtract the tick interval (keep remainder for precision)
        this.tickAccumulator -= TICK_INTERVAL_MS;
        ticksThisFrame++;
      }

      // Log warning if consistently falling behind (OSRS-style tick stretch)
      // Only warn every 5 seconds to avoid log spam
      const ticksStillBehind = Math.floor(
        this.tickAccumulator / TICK_INTERVAL_MS,
      );
      if (
        ticksStillBehind >= LAG_WARNING_THRESHOLD &&
        this.lagWarningCooldown <= 0
      ) {
        console.warn(
          `[ServerRuntime] Server falling behind: ${ticksStillBehind} ticks behind (ran ${ticksThisFrame} this frame)`,
        );
        this.lagWarningCooldown = 5000; // 5 second cooldown
      }
      this.lagWarningCooldown -= deltaTime;

      // OSRS "missed tick" behavior: If severely behind after running max ticks,
      // skip ahead rather than accumulating massive debt
      // This happens when server is severely overloaded or tab was unfocused
      if (this.tickAccumulator > TICK_INTERVAL_MS * MAX_TICKS_PER_FRAME) {
        const skippedTicks = Math.floor(
          this.tickAccumulator / TICK_INTERVAL_MS,
        );
        console.warn(
          `[ServerRuntime] Skipping ${skippedTicks} ticks to prevent tick storm (OSRS missed-tick behavior)`,
        );
        this.tickAccumulator = 0;
      }

      this.lastTickTime = currentTime;

      // Schedule next check
      this.scheduleTick();
    });
  }

  /**
   * Get server performance stats with caching to avoid expensive CPU sampling
   */
  async getStats() {
    const now = Date.now();

    // Return cached stats if recent
    if (this.cachedStats && now - this.lastStatsTime < this.statsInterval) {
      return this.cachedStats;
    }

    // Calculate new stats
    const memUsage = process.memoryUsage();
    const startCPU = process.cpuUsage();

    // Sample CPU over 100ms
    await new Promise((resolve) => setTimeout(resolve, 100));

    const endCPU = process.cpuUsage(startCPU);
    const cpuPercent = (endCPU.user + endCPU.system) / 1000 / 100;

    this.cachedStats = {
      maxMemory: Math.round(os.totalmem() / 1024 / 1024),
      currentMemory: Math.round(memUsage.rss / 1024 / 1024),
      maxCPU: os.cpus().length * 100,
      currentCPU: cpuPercent,
    };

    this.lastStatsTime = now;
    return this.cachedStats;
  }

  destroy() {
    this.running = false;
    this.cachedStats = null;
  }
}
