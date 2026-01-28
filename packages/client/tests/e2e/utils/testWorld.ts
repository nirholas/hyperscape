/**
 * Test Utilities for Real Hyperscape Instances
 *
 * Per project rules: NO MOCKS. Tests use real Hyperscape servers
 * and verify behavior through:
 * - Three.js scene introspection
 * - Visual testing with colored cube proxies
 * - Screenshot verification
 *
 * @packageDocumentation
 */

import type { Page } from "@playwright/test";

/**
 * Wait for the game to fully load
 */
export async function waitForGameLoad(
  page: Page,
  timeout = 30000,
): Promise<void> {
  // Wait for the loading screen to disappear
  await page.waitForFunction(
    () => {
      const win = window as unknown as { __HYPERSCAPE_LOADING__?: boolean };
      return win.__HYPERSCAPE_LOADING__ === false;
    },
    { timeout },
  );
}

/**
 * Wait for the player to spawn in the world
 */
export async function waitForPlayerSpawn(
  page: Page,
  timeout = 30000,
): Promise<void> {
  await page.waitForFunction(
    () => {
      const win = window as unknown as {
        world?: { entities?: { player?: { id?: string } } };
      };
      return win.world?.entities?.player?.id !== undefined;
    },
    { timeout },
  );
}

/**
 * Get player position from Three.js scene
 */
export async function getPlayerPosition(
  page: Page,
): Promise<{ x: number; y: number; z: number }> {
  return await page.evaluate(() => {
    const win = window as unknown as {
      world?: {
        entities?: {
          player?: {
            mesh?: { position: { x: number; y: number; z: number } };
          };
        };
      };
    };
    const pos = win.world?.entities?.player?.mesh?.position;
    return pos ? { x: pos.x, y: pos.y, z: pos.z } : { x: 0, y: 0, z: 0 };
  });
}

/**
 * Get player stats from the game world
 */
export async function getPlayerStats(page: Page): Promise<{
  health?: { current: number; max: number };
  coins?: number;
}> {
  return await page.evaluate(() => {
    const win = window as unknown as {
      world?: {
        network?: {
          lastInventoryByPlayerId?: Record<string, { coins?: number }>;
        };
        entities?: {
          player?: {
            id?: string;
            health?: number;
            maxHealth?: number;
          };
        };
      };
    };

    const player = win.world?.entities?.player;
    const playerId = player?.id;
    const inventory = playerId
      ? win.world?.network?.lastInventoryByPlayerId?.[playerId]
      : undefined;

    return {
      health: player
        ? { current: player.health ?? 0, max: player.maxHealth ?? 10 }
        : undefined,
      coins: inventory?.coins ?? 0,
    };
  });
}

/**
 * Open a panel by clicking its button
 */
export async function openPanel(page: Page, panelId: string): Promise<void> {
  // Click the panel button in the navigation ribbon or radial menu
  await page.click(`[data-panel-id="${panelId}"]`);
  // Wait for panel to be visible
  await page.waitForSelector(`[data-panel="${panelId}"]`, { state: "visible" });
}

/**
 * Close a panel
 */
export async function closePanel(page: Page, panelId: string): Promise<void> {
  // Click the close button
  await page.click(`[data-panel="${panelId}"] [data-close-button]`);
  // Wait for panel to be hidden
  await page.waitForSelector(`[data-panel="${panelId}"]`, { state: "hidden" });
}

/**
 * Take a screenshot of the game canvas for visual testing
 */
export async function takeGameScreenshot(
  page: Page,
  name: string,
): Promise<Buffer> {
  const canvas = await page.$("canvas");
  if (!canvas) {
    throw new Error("Game canvas not found");
  }
  return await canvas.screenshot({ path: `screenshots/${name}.png` });
}

// ============================================================================
// Entity Introspection Utilities
// ============================================================================

/**
 * Get all entities of a specific type from the world
 */
export async function getEntitiesByType(
  page: Page,
  entityType: string,
): Promise<
  Array<{
    id: string;
    position: { x: number; y: number; z: number };
    health?: number;
  }>
> {
  return await page.evaluate((type) => {
    const win = window as unknown as {
      world?: {
        entities?: {
          entities?: Map<
            string,
            {
              type?: string;
              id?: string;
              health?: number;
              mesh?: { position: { x: number; y: number; z: number } };
            }
          >;
        };
      };
    };

    const entities = win.world?.entities?.entities;
    if (!entities) return [];

    const results: Array<{
      id: string;
      position: { x: number; y: number; z: number };
      health?: number;
    }> = [];
    entities.forEach((entity, id) => {
      if (entity.type === type) {
        const pos = entity.mesh?.position;
        results.push({
          id,
          position: pos
            ? { x: pos.x, y: pos.y, z: pos.z }
            : { x: 0, y: 0, z: 0 },
          health: entity.health,
        });
      }
    });

    return results;
  }, entityType);
}

/**
 * Get the player's inventory from the world
 */
export async function getPlayerInventory(
  page: Page,
): Promise<Array<{ itemId: string; quantity: number; slot: number }>> {
  return await page.evaluate(() => {
    const win = window as unknown as {
      world?: {
        network?: {
          lastInventoryByPlayerId?: Record<
            string,
            {
              items?: Array<{ itemId: string; quantity: number; slot: number }>;
            }
          >;
        };
        entities?: {
          player?: { id?: string };
        };
      };
    };

    const playerId = win.world?.entities?.player?.id;
    if (!playerId) return [];

    const inventory = win.world?.network?.lastInventoryByPlayerId?.[playerId];
    return inventory?.items || [];
  });
}

/**
 * Get the player's equipment from the world
 */
export async function getPlayerEquipment(
  page: Page,
): Promise<Record<string, { itemId: string } | null>> {
  return await page.evaluate(() => {
    const win = window as unknown as {
      world?: {
        network?: {
          lastEquipmentByPlayerId?: Record<
            string,
            Record<string, { item?: { id: string } } | null>
          >;
        };
        entities?: {
          player?: { id?: string };
        };
      };
    };

    const playerId = win.world?.entities?.player?.id;
    if (!playerId) return {};

    const equipment = win.world?.network?.lastEquipmentByPlayerId?.[playerId];
    if (!equipment) return {};

    const result: Record<string, { itemId: string } | null> = {};
    for (const [slot, data] of Object.entries(equipment)) {
      result[slot] = data?.item ? { itemId: data.item.id } : null;
    }
    return result;
  });
}

/**
 * Get the player's skill levels
 */
export async function getPlayerSkills(
  page: Page,
): Promise<Record<string, { level: number; xp: number }>> {
  return await page.evaluate(() => {
    const win = window as unknown as {
      world?: {
        network?: {
          lastSkillsByPlayerId?: Record<
            string,
            Record<string, { level: number; xp: number }>
          >;
        };
        entities?: {
          player?: { id?: string };
        };
      };
    };

    const playerId = win.world?.entities?.player?.id;
    if (!playerId) return {};

    return win.world?.network?.lastSkillsByPlayerId?.[playerId] || {};
  });
}

// ============================================================================
// Input Simulation Utilities
// ============================================================================

/**
 * Simulate a click at a specific world position
 * Converts world coordinates to screen coordinates using the camera projection
 */
export async function clickAtWorldPosition(
  page: Page,
  worldPos: { x: number; z: number },
): Promise<void> {
  const canvas = await page.$("canvas");
  if (!canvas) return;

  const box = await canvas.boundingBox();
  if (!box) return;

  // Convert world position to screen position using the game's camera
  const screenPos = await page.evaluate(
    ({ worldX, worldZ, canvasWidth, canvasHeight }) => {
      const win = window as unknown as {
        THREE?: {
          Vector3: new (
            x: number,
            y: number,
            z: number,
          ) => {
            project: (camera: unknown) => { x: number; y: number };
          };
        };
        world?: {
          camera?: unknown;
        };
      };

      if (!win.THREE || !win.world?.camera) {
        // Fallback to center if camera not available
        return { x: canvasWidth / 2, y: canvasHeight / 2 };
      }

      // Create a vector at the world position (y=0 for ground level)
      const worldVector = new win.THREE.Vector3(worldX, 0, worldZ);

      // Project to normalized device coordinates (-1 to 1)
      const ndc = worldVector.project(win.world.camera);

      // Convert to screen coordinates
      const screenX = ((ndc.x + 1) / 2) * canvasWidth;
      const screenY = ((1 - ndc.y) / 2) * canvasHeight;

      return { x: screenX, y: screenY };
    },
    {
      worldX: worldPos.x,
      worldZ: worldPos.z,
      canvasWidth: box.width,
      canvasHeight: box.height,
    },
  );

  // Click at the calculated screen position
  await page.mouse.click(box.x + screenPos.x, box.y + screenPos.y);
}

/**
 * Simulate keyboard movement
 */
export async function simulateMovement(
  page: Page,
  direction: "up" | "down" | "left" | "right",
  durationMs: number = 500,
): Promise<void> {
  const keyMap = {
    up: "KeyW",
    down: "KeyS",
    left: "KeyA",
    right: "KeyD",
  };

  await page.keyboard.down(keyMap[direction]);
  await page.waitForTimeout(durationMs);
  await page.keyboard.up(keyMap[direction]);
}

/**
 * Wait for a specific condition in the world
 */
export async function waitForWorldCondition(
  page: Page,
  condition: string,
  timeout: number = 10000,
): Promise<boolean> {
  try {
    await page.waitForFunction(
      (cond) => {
        // Evaluate the condition string in the context of the world
        const win = window as unknown as { world?: unknown };
        if (!win.world) return false;
        // Simple condition evaluation
        try {
          return new Function("world", `return ${cond}`)(win.world);
        } catch {
          return false;
        }
      },
      condition,
      { timeout },
    );
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// Test Cleanup Utilities
// ============================================================================

/**
 * Reset the test world to a clean state
 */
export async function resetTestWorld(page: Page): Promise<void> {
  // Import and call cleanup from visualTesting
  await page.evaluate(() => {
    const win = window as unknown as {
      world?: {
        scene?: {
          children: Array<{
            userData?: { isTestProxy?: boolean };
            parent?: { remove: (obj: unknown) => void };
          }>;
        };
      };
    };

    // Clean up test proxies
    const scene = win.world?.scene;
    if (scene) {
      const toRemove = scene.children.filter((c) => c.userData?.isTestProxy);
      toRemove.forEach((obj) => {
        obj.parent?.remove(obj);
      });
    }
  });
}

/**
 * Capture error logs from the browser console
 */
export function setupErrorCapture(page: Page): { errors: string[] } {
  const errors: string[] = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      errors.push(msg.text());
    }
  });

  page.on("pageerror", (error) => {
    errors.push(error.message);
  });

  return { errors };
}

// ============================================================================
// Security Testing Utilities
// ============================================================================

/**
 * Check if auth tokens are stored securely (not in URL, proper storage)
 */
export async function verifySecureTokenStorage(page: Page): Promise<{
  hasLocalStorageToken: boolean;
  hasSessionStorageToken: boolean;
  tokenInUrl: boolean;
  urlHasSensitiveParams: boolean;
}> {
  const url = page.url();

  // Check URL for sensitive parameters
  const urlParams = new URL(url).searchParams;
  const sensitiveParams = ["authToken", "token", "secret", "password", "key"];
  const urlHasSensitiveParams = sensitiveParams.some((p) => urlParams.has(p));
  const tokenInUrl = urlParams.has("authToken") || urlParams.has("token");

  // Check storage
  const storageInfo = await page.evaluate(() => {
    const localToken = localStorage.getItem("privy_auth_token");
    const sessionToken = sessionStorage.getItem("privy_auth_token");
    return {
      hasLocalStorageToken: !!localToken,
      hasSessionStorageToken: !!sessionToken,
    };
  });

  return {
    ...storageInfo,
    tokenInUrl,
    urlHasSensitiveParams,
  };
}

/**
 * Verify that CSRF protection is enabled
 */
export async function verifyCsrfProtection(page: Page): Promise<{
  hasCsrfToken: boolean;
  csrfInCookies: boolean;
}> {
  const cookies = await page.context().cookies();
  const csrfCookie = cookies.find(
    (c) =>
      c.name.toLowerCase().includes("csrf") ||
      c.name.toLowerCase().includes("xsrf"),
  );

  const hasCsrfToken = await page.evaluate(() => {
    const win = window as unknown as {
      __CSRF_TOKEN__?: string;
    };
    return !!win.__CSRF_TOKEN__;
  });

  return {
    hasCsrfToken,
    csrfInCookies: !!csrfCookie,
  };
}

// ============================================================================
// Network Testing Utilities
// ============================================================================

/**
 * Check WebSocket connection status
 */
export async function getWebSocketStatus(page: Page): Promise<{
  isConnected: boolean;
  reconnectAttempts: number;
  lastError: string | null;
}> {
  return await page.evaluate(() => {
    const win = window as unknown as {
      world?: {
        network?: {
          isConnected?: () => boolean;
          connected?: boolean;
          reconnectAttempts?: number;
          lastError?: string;
        };
      };
    };

    const network = win.world?.network;
    return {
      isConnected: network?.isConnected?.() ?? network?.connected ?? false,
      reconnectAttempts: network?.reconnectAttempts ?? 0,
      lastError: network?.lastError ?? null,
    };
  });
}

/**
 * Wait for WebSocket connection to be established
 */
export async function waitForWebSocketConnection(
  page: Page,
  timeout = 15000,
): Promise<boolean> {
  try {
    await page.waitForFunction(
      () => {
        const win = window as unknown as {
          world?: {
            network?: {
              isConnected?: () => boolean;
              connected?: boolean;
            };
          };
        };
        const network = win.world?.network;
        return network?.isConnected?.() ?? network?.connected ?? false;
      },
      { timeout },
    );
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// Performance Testing Utilities
// ============================================================================

/**
 * Get rendering performance metrics
 */
export async function getPerformanceMetrics(page: Page): Promise<{
  fps: number | null;
  frameTime: number | null;
  memoryUsage: number | null;
}> {
  return await page.evaluate(() => {
    const win = window as unknown as {
      world?: {
        stats?: {
          fps?: number;
          frameTime?: number;
        };
      };
    };

    const memory = (
      performance as Performance & {
        memory?: { usedJSHeapSize: number };
      }
    ).memory;

    return {
      fps: win.world?.stats?.fps ?? null,
      frameTime: win.world?.stats?.frameTime ?? null,
      memoryUsage: memory?.usedJSHeapSize ?? null,
    };
  });
}

/**
 * Measure page load performance
 */
export async function measurePageLoadTime(page: Page): Promise<{
  domContentLoaded: number;
  loadComplete: number;
  firstPaint: number | null;
}> {
  const timing = await page.evaluate(() => {
    const perf = performance.getEntriesByType(
      "navigation",
    )[0] as PerformanceNavigationTiming;
    const paint = performance.getEntriesByType("paint");
    const firstPaint = paint.find((p) => p.name === "first-paint");

    return {
      domContentLoaded: perf?.domContentLoadedEventEnd ?? 0,
      loadComplete: perf?.loadEventEnd ?? 0,
      firstPaint: firstPaint?.startTime ?? null,
    };
  });

  return timing;
}

// ============================================================================
// UI State Testing Utilities
// ============================================================================

/**
 * Get the current UI state (which panels are open, etc.)
 */
export async function getUIState(page: Page): Promise<{
  openPanels: string[];
  hasEscapeMenu: boolean;
  hasNotifications: boolean;
  isLoading: boolean;
}> {
  return await page.evaluate(() => {
    const openPanels: string[] = [];
    document.querySelectorAll("[data-panel]").forEach((panel) => {
      const el = panel as HTMLElement;
      if (el.offsetParent !== null) {
        // Element is visible
        openPanels.push(el.dataset.panel ?? "unknown");
      }
    });

    const escapeMenu = document.querySelector(
      '[data-testid="escape-menu"], [class*="escape-menu"]',
    ) as HTMLElement | null;
    const notifications = document.querySelectorAll(
      '[data-testid="toast"], [class*="notification"]:not([class*="container"])',
    );
    const loading = document.querySelector(
      '[data-testid="loading-screen"], .loading-screen',
    ) as HTMLElement | null;

    return {
      openPanels,
      hasEscapeMenu: escapeMenu?.offsetParent !== null,
      hasNotifications: notifications.length > 0,
      isLoading: loading?.offsetParent !== null,
    };
  });
}

/**
 * Assert that no critical console errors occurred
 */
export function assertNoConsoleErrors(
  errors: string[],
  allowedPatterns: RegExp[] = [],
): void {
  const knownSafePatterns = [
    /ResizeObserver loop/i,
    /Script error/i,
    /favicon/i,
    /Failed to load resource.*favicon/i,
  ];

  const allPatterns = [...knownSafePatterns, ...allowedPatterns];

  const criticalErrors = errors.filter((error) => {
    return !allPatterns.some((pattern) => pattern.test(error));
  });

  if (criticalErrors.length > 0) {
    throw new Error(
      `Found ${criticalErrors.length} critical console errors:\n${criticalErrors.join("\n")}`,
    );
  }
}
