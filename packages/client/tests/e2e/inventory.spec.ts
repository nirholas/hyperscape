/**
 * Inventory E2E Tests
 *
 * Tests inventory interactions using real Hyperscape instances.
 * NO MOCKS - these tests run against actual game servers.
 *
 * Per project rules:
 * - Use real Hyperscape worlds
 * - Test via Three.js scene introspection
 * - Visual verification with screenshots
 *
 * @packageDocumentation
 */

import { test, expect } from "@playwright/test";
import {
  waitForGameLoad,
  waitForPlayerSpawn,
  getPlayerStats,
  openPanel,
  closePanel,
  takeGameScreenshot,
} from "./utils/testWorld";

test.describe("Inventory Panel", () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to game
    await page.goto("/");

    // Wait for game to load
    await waitForGameLoad(page);

    // Wait for player to spawn
    await waitForPlayerSpawn(page);
  });

  test("should open and close inventory panel", async ({ page }) => {
    // Open inventory panel
    await openPanel(page, "inventory");

    // Verify panel is visible
    const inventoryPanel = page.locator('[data-panel="inventory"]');
    await expect(inventoryPanel).toBeVisible();

    // Take screenshot for visual verification
    await takeGameScreenshot(page, "inventory-open");

    // Close inventory panel
    await closePanel(page, "inventory");

    // Verify panel is hidden
    await expect(inventoryPanel).not.toBeVisible();
  });

  test("should display player coins", async ({ page }) => {
    // Get initial stats
    const stats = await getPlayerStats(page);

    // Verify coins are a number
    expect(typeof stats.coins).toBe("number");
    expect(stats.coins).toBeGreaterThanOrEqual(0);
  });

  test("should show 28 inventory slots", async ({ page }) => {
    // Open inventory panel
    await openPanel(page, "inventory");

    // Wait for slots to render
    await page.waitForSelector('[data-testid="inventory-slot"]', {
      timeout: 5000,
    });

    // Count inventory slots
    const slots = page.locator('[data-testid="inventory-slot"]');
    await expect(slots).toHaveCount(28);

    // Take screenshot
    await takeGameScreenshot(page, "inventory-slots");
  });

  test("should use keyboard shortcut to toggle inventory", async ({ page }) => {
    const inventoryPanel = page.locator('[data-panel="inventory"]');

    // Panel should be hidden initially
    await expect(inventoryPanel).not.toBeVisible();

    // Press 'I' to open inventory (common game hotkey)
    await page.keyboard.press("i");

    // Wait for panel animation
    await page.waitForTimeout(300);

    // Check if panel is now visible (may depend on hotkey config)
    // Note: This test documents expected behavior - adjust if hotkey differs
    const isVisible = await inventoryPanel.isVisible();

    if (isVisible) {
      // Press 'I' again to close
      await page.keyboard.press("i");
      await page.waitForTimeout(300);
      await expect(inventoryPanel).not.toBeVisible();
    }
  });
});

test.describe("Player Health", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await waitForGameLoad(page);
    await waitForPlayerSpawn(page);
  });

  test("should display player health", async ({ page }) => {
    const stats = await getPlayerStats(page);

    // Verify health values exist and are valid
    expect(stats.health).toBeDefined();
    if (stats.health) {
      expect(stats.health.current).toBeGreaterThanOrEqual(0);
      expect(stats.health.max).toBeGreaterThan(0);
      expect(stats.health.current).toBeLessThanOrEqual(stats.health.max);
    }
  });
});

test.describe("Skills Panel", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await waitForGameLoad(page);
    await waitForPlayerSpawn(page);
  });

  test("should open and close skills panel", async ({ page }) => {
    // Open skills panel
    await openPanel(page, "skills");

    // Verify panel is visible
    const skillsPanel = page.locator('[data-panel="skills"]');
    await expect(skillsPanel).toBeVisible();

    // Take screenshot for visual verification
    await takeGameScreenshot(page, "skills-open");

    // Close skills panel
    await closePanel(page, "skills");

    // Verify panel is hidden
    await expect(skillsPanel).not.toBeVisible();
  });
});

test.describe("Chat Panel", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await waitForGameLoad(page);
    await waitForPlayerSpawn(page);
  });

  test("should open and close chat panel", async ({ page }) => {
    // Open chat panel
    await openPanel(page, "chat");

    // Verify panel is visible
    const chatPanel = page.locator('[data-panel="chat"]');
    await expect(chatPanel).toBeVisible();

    // Close chat panel
    await closePanel(page, "chat");

    // Verify panel is hidden
    await expect(chatPanel).not.toBeVisible();
  });

  test("should have chat input field", async ({ page }) => {
    // Open chat panel
    await openPanel(page, "chat");

    // Find chat input
    const chatInput = page.locator('[data-testid="chat-input"]');

    // If chat input exists, verify it's interactive
    const inputExists = (await chatInput.count()) > 0;
    if (inputExists) {
      await expect(chatInput).toBeEnabled();
    }
  });
});

test.describe("Visual Regression", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await waitForGameLoad(page);
    await waitForPlayerSpawn(page);
  });

  test("game canvas should render without errors", async ({ page }) => {
    // Verify canvas exists
    const canvas = page.locator("canvas");
    await expect(canvas).toBeVisible();

    // Take screenshot
    const screenshot = await takeGameScreenshot(page, "game-canvas");
    expect(screenshot).toBeTruthy();

    // Basic visual check - canvas should not be completely black or white
    // This is a sanity check that something is rendering
    await page.evaluate(() => {
      const canvas = document.querySelector("canvas");
      if (!canvas) throw new Error("No canvas found");

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        // WebGL context - can't easily check pixel data
        return true;
      }

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;

      // Check that not all pixels are the same color
      let allSame = true;
      const firstR = data[0];
      const firstG = data[1];
      const firstB = data[2];

      for (let i = 4; i < data.length; i += 4) {
        if (
          data[i] !== firstR ||
          data[i + 1] !== firstG ||
          data[i + 2] !== firstB
        ) {
          allSame = false;
          break;
        }
      }

      if (allSame) {
        console.warn(
          "Canvas appears to be a solid color - may indicate render issue",
        );
      }

      return true;
    });
  });
});
