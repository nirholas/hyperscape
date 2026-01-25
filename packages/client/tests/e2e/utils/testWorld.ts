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
