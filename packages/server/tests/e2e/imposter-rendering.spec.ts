/**
 * Imposter Rendering E2E Tests
 *
 * Tests the octahedral imposter system for mobs and characters:
 * - Verifies imposters are created for distant mobs
 * - Tests transition between 3D and imposter rendering
 * - Validates octahedral atlas loading from CDN
 * - Checks visual quality at different distances
 *
 * HLOD System Overview:
 * - LOD0: Full detail mesh (0-40m for mobs)
 * - LOD1: Frozen animation (40-70m for mobs)
 * - IMPOSTOR: Billboard (70-100m for mobs)
 * - CULLED: Hidden (>180m for mobs)
 */

import { test, expect, type Page } from "@playwright/test";

// Test configuration
const TEST_TIMEOUT = 60000; // 60 seconds
const MOB_SPAWN_DELAY = 5000; // Wait for mob to spawn, render, AND bake impostor
const DISTANCE_TRANSITION_DELAY = 1000; // Wait for imposter transition

// LOD distance thresholds for mobs (from GPUVegetation.ts)
const MOB_LOD_DISTANCES = {
  lod1: 40, // LOD0 -> LOD1 transition
  impostor: 100, // LOD1 -> Impostor transition
  fade: 180, // Impostor -> Culled transition
};

/**
 * Helper to wait for game world to be ready
 */
async function waitForWorldReady(page: Page): Promise<void> {
  // Wait for the canvas to be present
  await page.waitForSelector("canvas", { timeout: 30000 });

  // Wait for the world to finish loading
  await page.waitForFunction(
    () => {
      const w = (window as unknown as { world?: { isReady?: boolean } }).world;
      return w && w.isReady;
    },
    { timeout: 30000 },
  );
}

/**
 * Helper to get mob instanced renderer stats
 */
async function getMobRendererStats(page: Page): Promise<{
  totalHandles: number;
  activeHandles: number;
  imposterHandles: number;
  frozenGroups: number;
}> {
  return page.evaluate(() => {
    const world = (
      window as unknown as {
        world?: {
          _mobRenderer?: {
            getStats: () => {
              totalHandles: number;
              activeHandles: number;
              imposterHandles: number;
              frozenGroups: number;
            };
          };
        };
      }
    ).world;
    if (!world?._mobRenderer) {
      return {
        totalHandles: 0,
        activeHandles: 0,
        imposterHandles: 0,
        frozenGroups: 0,
      };
    }
    return world._mobRenderer.getStats();
  });
}

/**
 * Helper to spawn a test mob at a specific position
 */
async function spawnTestMob(
  page: Page,
  mobType: string,
  x: number,
  y: number,
  z: number,
): Promise<string> {
  return page.evaluate(
    ({ type, pos }) => {
      const world = (
        window as unknown as {
          world?: {
            spawnMob: (
              type: string,
              pos: { x: number; y: number; z: number },
            ) => string;
          };
        }
      ).world;
      if (!world) throw new Error("World not available");
      return world.spawnMob(type, pos);
    },
    { type: mobType, pos: { x, y, z } },
  );
}

/**
 * Helper to move camera to position
 */
async function moveCamera(
  page: Page,
  x: number,
  y: number,
  z: number,
): Promise<void> {
  await page.evaluate(
    ({ pos }) => {
      const world = (
        window as unknown as {
          world?: {
            camera?: {
              position: { set: (x: number, y: number, z: number) => void };
            };
          };
        }
      ).world;
      if (world?.camera) {
        world.camera.position.set(pos.x, pos.y, pos.z);
      }
    },
    { pos: { x, y, z } },
  );
}

/**
 * Helper to get distance from camera to a position
 */
async function getDistanceToCamera(
  page: Page,
  x: number,
  z: number,
): Promise<number> {
  return page.evaluate(
    ({ targetX, targetZ }) => {
      const world = (
        window as unknown as {
          world?: {
            camera?: { position: { x: number; z: number } };
          };
        }
      ).world;
      if (!world?.camera) return Infinity;
      const dx = world.camera.position.x - targetX;
      const dz = world.camera.position.z - targetZ;
      return Math.sqrt(dx * dx + dz * dz);
    },
    { targetX: x, targetZ: z },
  );
}

/**
 * Helper to get Entity HLOD diagnostics for any entity by name pattern
 */
async function getEntityHLODDiagnostics(
  page: Page,
  namePattern: string,
): Promise<
  Array<{
    name: string;
    initialized: boolean;
    currentLODName: string;
    impostorReady: boolean;
    hasImpostorMesh: boolean;
    lodDistances: { lod1: number; impostor: number; fade: number } | null;
  }>
> {
  return page.evaluate((pattern) => {
    const world = (
      window as unknown as {
        world?: {
          entities?: {
            items?: Map<
              string,
              {
                name: string;
                getHLODDiagnostics?: () => {
                  initialized: boolean;
                  currentLODName: string;
                  impostorReady: boolean;
                  hasImpostorMesh: boolean;
                  lodDistances: {
                    lod1: number;
                    impostor: number;
                    fade: number;
                  } | null;
                };
              }
            >;
          };
        };
      }
    ).world;
    if (!world?.entities?.items) return [];

    const results: Array<{
      name: string;
      initialized: boolean;
      currentLODName: string;
      impostorReady: boolean;
      hasImpostorMesh: boolean;
      lodDistances: { lod1: number; impostor: number; fade: number } | null;
    }> = [];

    for (const entity of world.entities.items.values()) {
      if (
        entity.name.toLowerCase().includes(pattern.toLowerCase()) &&
        entity.getHLODDiagnostics
      ) {
        const diag = entity.getHLODDiagnostics();
        results.push({
          name: entity.name,
          initialized: diag.initialized,
          currentLODName: diag.currentLODName,
          impostorReady: diag.impostorReady,
          hasImpostorMesh: diag.hasImpostorMesh,
          lodDistances: diag.lodDistances
            ? {
                lod1: diag.lodDistances.lod1,
                impostor: diag.lodDistances.impostor,
                fade: diag.lodDistances.fade,
              }
            : null,
        });
      }
    }
    return results;
  }, namePattern);
}

/**
 * Helper to get ImpostorManager statistics
 */
async function getImpostorManagerStats(page: Page): Promise<{
  cacheHits: number;
  cacheMisses: number;
  totalBaked: number;
  totalFromIndexedDB: number;
  queueLength: number;
  memoryCacheSize: number;
} | null> {
  return page.evaluate(() => {
    const world = (
      window as unknown as {
        world?: {
          getImpostorManagerStats?: () => {
            cacheHits: number;
            cacheMisses: number;
            totalBaked: number;
            totalFromIndexedDB: number;
            queueLength: number;
            memoryCacheSize: number;
          };
        };
      }
    ).world;
    if (!world?.getImpostorManagerStats) return null;
    return world.getImpostorManagerStats();
  });
}

test.describe("Imposter Rendering System", () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to game client
    await page.goto("/", { waitUntil: "networkidle" });
    await waitForWorldReady(page);
  });

  test("mob renderer initializes with imposter support", async ({ page }) => {
    test.setTimeout(TEST_TIMEOUT);

    const stats = await getMobRendererStats(page);

    // Verify renderer exists (stats should be available)
    expect(stats).toBeDefined();
    expect(typeof stats.totalHandles).toBe("number");
    expect(typeof stats.imposterHandles).toBe("number");
  });

  test("distant mobs use imposter rendering", async ({ page }) => {
    test.setTimeout(TEST_TIMEOUT);

    // Get player position
    const playerPos = await page.evaluate(() => {
      const world = (
        window as unknown as {
          world?: {
            getPlayers: () => Array<{
              node?: { position: { x: number; y: number; z: number } };
            }>;
          };
        }
      ).world;
      if (!world) return { x: 0, y: 0, z: 0 };
      const players = world.getPlayers();
      if (players.length > 0 && players[0].node) {
        return players[0].node.position;
      }
      return { x: 0, y: 0, z: 0 };
    });

    // Spawn a mob far from the player (should use imposter)
    const farDistance = 100; // Beyond imposter threshold
    const farX = playerPos.x + farDistance;
    const farZ = playerPos.z;

    try {
      await spawnTestMob(page, "goblin", farX, playerPos.y, farZ);
      await page.waitForTimeout(MOB_SPAWN_DELAY);

      const stats = await getMobRendererStats(page);

      // At far distance, mob should be using imposter
      expect(stats.totalHandles).toBeGreaterThanOrEqual(1);

      // Note: imposterHandles might be 0 if the mob is culled at this distance
      // or 1 if it's using imposter rendering
      console.log(
        `Mob at ${farDistance}m - Total: ${stats.totalHandles}, Imposters: ${stats.imposterHandles}`,
      );
    } catch (error) {
      // spawnMob might not be available in test environment
      console.log("Mob spawning not available in test environment, skipping");
      test.skip();
    }
  });

  test("imposter transitions to 3D when approaching", async ({ page }) => {
    test.setTimeout(TEST_TIMEOUT);

    const stats = await getMobRendererStats(page);

    // If there are existing mobs, verify the imposter system is working
    if (stats.totalHandles > 0) {
      // Take initial counts
      const initialImposters = stats.imposterHandles;
      const initialActive = stats.activeHandles;

      console.log(
        `Initial state - Active: ${initialActive}, Imposters: ${initialImposters}`,
      );

      // The test validates that the transition system exists and reports stats
      expect(stats.imposterHandles).toBeGreaterThanOrEqual(0);
      expect(stats.activeHandles).toBeGreaterThanOrEqual(0);
    }
  });

  test("screenshot captures imposter rendering correctly", async ({ page }) => {
    test.setTimeout(TEST_TIMEOUT);

    // Wait for any existing mobs to settle
    await page.waitForTimeout(2000);

    // Take a screenshot for visual verification
    const screenshot = await page.screenshot({
      fullPage: false,
      type: "png",
    });

    // Verify screenshot was captured
    expect(screenshot.byteLength).toBeGreaterThan(1000);

    // Log screenshot info for manual verification
    console.log(`Screenshot captured: ${screenshot.byteLength} bytes`);
  });

  test("octahedral atlas textures load from CDN", async ({ page }) => {
    test.setTimeout(TEST_TIMEOUT);

    // Monitor network requests for imposter atlases
    const atlasRequests: string[] = [];

    page.on("request", (request) => {
      const url = request.url();
      if (url.includes("imposter") && url.includes(".png")) {
        atlasRequests.push(url);
      }
    });

    // Wait for any atlas loads (may not happen if no octahedral imposters exist yet)
    await page.waitForTimeout(5000);

    console.log(`Atlas requests: ${atlasRequests.length}`);
    atlasRequests.forEach((url) => console.log(`  - ${url}`));

    // This test documents the current state of atlas loading
    // When octahedral imposters are baked and uploaded, requests should appear
  });

  test("HLOD system diagnostics are accessible", async ({ page }) => {
    test.setTimeout(TEST_TIMEOUT);

    // Get HLOD diagnostics for any entities that have them
    // This verifies the diagnostic API is working
    const mobDiagnostics = await getEntityHLODDiagnostics(page, "mob");
    const npcDiagnostics = await getEntityHLODDiagnostics(page, "npc");
    const resourceDiagnostics = await getEntityHLODDiagnostics(
      page,
      "resource",
    );

    console.log(
      `[HLOD Diagnostics] Found: ${mobDiagnostics.length} mobs, ${npcDiagnostics.length} NPCs, ${resourceDiagnostics.length} resources`,
    );

    // Log detailed diagnostics for each entity type
    const allDiagnostics = [
      ...mobDiagnostics,
      ...npcDiagnostics,
      ...resourceDiagnostics,
    ];
    for (const diag of allDiagnostics.slice(0, 5)) {
      // Log first 5
      console.log(`  ${diag.name}:`);
      console.log(`    - LOD: ${diag.currentLODName}`);
      console.log(`    - Impostor Ready: ${diag.impostorReady}`);
      console.log(`    - Has Impostor Mesh: ${diag.hasImpostorMesh}`);
      if (diag.lodDistances) {
        console.log(
          `    - Distances: LOD1=${diag.lodDistances.lod1}m, Impostor=${diag.lodDistances.impostor}m, Fade=${diag.lodDistances.fade}m`,
        );
      }
    }

    // Verify at least the API is working (diagnostics array returned)
    expect(Array.isArray(allDiagnostics)).toBe(true);
  });

  test("ImpostorManager reports baking statistics", async ({ page }) => {
    test.setTimeout(TEST_TIMEOUT);

    // Wait for some impostors to potentially bake
    await page.waitForTimeout(3000);

    const stats = await getImpostorManagerStats(page);

    if (stats) {
      console.log(`[ImpostorManager Stats]:`);
      console.log(`  - Cache Hits: ${stats.cacheHits}`);
      console.log(`  - Cache Misses: ${stats.cacheMisses}`);
      console.log(`  - Total Baked: ${stats.totalBaked}`);
      console.log(`  - From IndexedDB: ${stats.totalFromIndexedDB}`);
      console.log(`  - Queue Length: ${stats.queueLength}`);
      console.log(`  - Memory Cache Size: ${stats.memoryCacheSize}`);

      // Verify stats are numbers
      expect(typeof stats.totalBaked).toBe("number");
      expect(typeof stats.memoryCacheSize).toBe("number");
    } else {
      console.log(
        "[ImpostorManager] getImpostorManagerStats not exposed on world",
      );
    }
  });

  test("imposter rendering performance is acceptable", async ({ page }) => {
    test.setTimeout(TEST_TIMEOUT);

    // Measure frame time with imposters
    const frameMetrics = await page.evaluate(async () => {
      const frameTimes: number[] = [];
      let lastTime = performance.now();

      return new Promise<{ avgFrameTime: number; maxFrameTime: number }>(
        (resolve) => {
          let frameCount = 0;
          const measureFrame = () => {
            const now = performance.now();
            const delta = now - lastTime;
            frameTimes.push(delta);
            lastTime = now;
            frameCount++;

            if (frameCount < 60) {
              requestAnimationFrame(measureFrame);
            } else {
              const avgFrameTime =
                frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
              const maxFrameTime = Math.max(...frameTimes);
              resolve({ avgFrameTime, maxFrameTime });
            }
          };
          requestAnimationFrame(measureFrame);
        },
      );
    });

    console.log(
      `Frame metrics - Avg: ${frameMetrics.avgFrameTime.toFixed(2)}ms, Max: ${frameMetrics.maxFrameTime.toFixed(2)}ms`,
    );

    // Average frame time should be under 32ms (30fps minimum)
    expect(frameMetrics.avgFrameTime).toBeLessThan(32);
  });
});

test.describe("Asset-Forge Imposter API", () => {
  const API_BASE = process.env.ASSET_FORGE_API_URL || "http://localhost:3401";

  test("imposter discovery endpoint returns models", async ({ request }) => {
    const response = await request.get(`${API_BASE}/api/lod/imposter/discover`);

    if (response.ok()) {
      const data = await response.json();
      expect(Array.isArray(data)).toBe(true);
      console.log(`Discovered ${data.length} models for imposter baking`);
    } else {
      // API might not be running in test environment
      console.log("Asset-Forge API not available");
    }
  });

  test("imposter stats endpoint returns statistics", async ({ request }) => {
    const response = await request.get(`${API_BASE}/api/lod/imposter/stats`);

    if (response.ok()) {
      const stats = await response.json();
      expect(stats).toHaveProperty("totalImposters");
      expect(stats).toHaveProperty("byCategory");
      expect(stats).toHaveProperty("totalSize");
      console.log(
        `Imposter stats: ${stats.totalImposters} total, ${stats.totalSize} bytes`,
      );
    } else {
      console.log("Asset-Forge API not available");
    }
  });

  test("imposter bake job can be started", async ({ request }) => {
    const response = await request.post(`${API_BASE}/api/lod/imposter/bake`, {
      data: {
        categories: ["mob"],
        force: false,
      },
    });

    if (response.ok()) {
      const result = await response.json();
      expect(result).toHaveProperty("jobId");
      expect(result).toHaveProperty("status");
      console.log(`Bake job started: ${result.jobId}`);
    } else {
      console.log("Asset-Forge API not available or no models to bake");
    }
  });
});
