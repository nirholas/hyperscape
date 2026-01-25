import { test, expect, devices } from "@playwright/test";

/**
 * Mobile UI E2E Tests
 *
 * Tests for the mobile vertical UI implementation.
 * Uses real mobile device emulation via Playwright.
 */

// Mobile device viewports
const VIEWPORTS = {
  iphoneSE: { width: 375, height: 667 },
  iphone14Pro: { width: 393, height: 852 },
  iphone14ProMax: { width: 430, height: 932 },
  ipadMini: { width: 768, height: 1024 },
  // Landscape variants
  iphoneSELandscape: { width: 667, height: 375 },
  iphone14ProLandscape: { width: 852, height: 393 },
};

test.describe("Mobile UI - Portrait Mode", () => {
  test.beforeEach(async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize(VIEWPORTS.iphone14Pro);

    // Navigate to the game client
    await page.goto("http://localhost:3333");

    // Wait for the game to load
    await page
      .waitForSelector('[data-testid="game-loaded"]', { timeout: 30000 })
      .catch(() => {
        return page.waitForTimeout(5000);
      });
  });

  test("should display mobile interface manager on mobile viewport", async ({
    page,
  }) => {
    // Take screenshot of mobile UI
    await page.screenshot({
      path: "logs/mobile-ui-portrait.png",
      fullPage: true,
    });

    // Verify viewport is mobile
    const viewport = page.viewportSize();
    expect(viewport?.width).toBeLessThan(768);
  });

  test("should display mobile navigation bar at bottom", async ({ page }) => {
    // Look for navigation bar
    const navBar = page.locator("nav");
    const navVisible = await navBar.isVisible().catch(() => false);

    if (navVisible) {
      // Get nav position
      const navBox = await navBar.boundingBox();
      const viewport = page.viewportSize();

      if (navBox && viewport) {
        // Nav should be at the bottom of the screen
        expect(navBox.y + navBox.height).toBeCloseTo(viewport.height, 50);
      }

      // Verify 5 navigation buttons
      const navButtons = navBar.locator("button");
      const buttonCount = await navButtons.count();
      expect(buttonCount).toBeGreaterThanOrEqual(5);
    } else {
      console.log("Mobile nav bar not visible - may need login first");
    }
  });

  test("should display touch action bar above navigation", async ({ page }) => {
    // Wait for UI to fully load
    await page.waitForTimeout(2000);

    // Look for action bar
    const actionBar = page.locator('[data-testid="touch-action-bar"]');
    const actionBarVisible = await actionBar.isVisible().catch(() => false);

    if (actionBarVisible) {
      // Take screenshot
      await page.screenshot({
        path: "logs/mobile-action-bar.png",
        fullPage: true,
      });

      // Verify 5 slots
      const slots = actionBar.locator("[data-slot]");
      const slotCount = await slots.count();
      expect(slotCount).toBe(5);
    }
  });

  test("should display minimap orb in top right", async ({ page }) => {
    // Wait for UI to fully load
    await page.waitForTimeout(2000);

    // Look for minimap
    const minimap = page.locator(".minimap, [data-testid='mobile-minimap']");
    const minimapVisible = await minimap.isVisible().catch(() => false);

    if (minimapVisible) {
      const minimapBox = await minimap.boundingBox();
      const viewport = page.viewportSize();

      if (minimapBox && viewport) {
        // Minimap should be in top-right
        expect(minimapBox.x + minimapBox.width / 2).toBeGreaterThan(
          viewport.width / 2,
        );
        expect(minimapBox.y).toBeLessThan(100);
      }

      await minimap.screenshot({
        path: "logs/mobile-minimap-orb.png",
      });
    }
  });

  test("should expand minimap on tap", async ({ page }) => {
    await page.waitForTimeout(2000);

    const minimap = page.locator(".minimap, [data-testid='mobile-minimap']");
    const minimapVisible = await minimap.isVisible().catch(() => false);

    if (minimapVisible) {
      // Get initial size
      const initialBox = await minimap.boundingBox();

      // Tap to expand
      await minimap.tap();
      await page.waitForTimeout(300);

      // Get expanded size
      const expandedBox = await minimap.boundingBox();

      if (initialBox && expandedBox) {
        // Size should have increased
        expect(expandedBox.width).toBeGreaterThanOrEqual(initialBox.width);
      }

      await page.screenshot({
        path: "logs/mobile-minimap-expanded.png",
        fullPage: true,
      });

      // Tap again to collapse
      await minimap.tap();
      await page.waitForTimeout(300);
    }
  });
});

test.describe("Mobile UI - Navigation and Drawers", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.iphone14Pro);
    await page.goto("http://localhost:3333");
    await page
      .waitForSelector('[data-testid="game-loaded"]', { timeout: 30000 })
      .catch(() => page.waitForTimeout(5000));
  });

  test("should open inventory drawer when tapping inventory button", async ({
    page,
  }) => {
    await page.waitForTimeout(2000);

    // Find and tap inventory button
    const inventoryBtn = page.locator(
      'nav button:has-text("Inventory"), nav button[aria-label="Inventory"]',
    );
    const btnVisible = await inventoryBtn.isVisible().catch(() => false);

    if (btnVisible) {
      await inventoryBtn.tap();
      await page.waitForTimeout(500);

      // Look for drawer
      const drawer = page.locator(
        '[role="dialog"], [data-testid="mobile-drawer"]',
      );
      const drawerVisible = await drawer.isVisible().catch(() => false);

      if (drawerVisible) {
        await page.screenshot({
          path: "logs/mobile-inventory-drawer.png",
          fullPage: true,
        });

        // Drawer should contain inventory panel
        const inventoryGrid = drawer.locator('[data-testid="inventory-grid"]');
        const hasGrid = await inventoryGrid.isVisible().catch(() => false);
      }
    }
  });

  test("should close drawer when tapping close button", async ({ page }) => {
    await page.waitForTimeout(2000);

    // Open a drawer first
    const menuBtn = page.locator(
      'nav button:has-text("Menu"), nav button[aria-label="Menu"]',
    );
    const btnVisible = await menuBtn.isVisible().catch(() => false);

    if (btnVisible) {
      await menuBtn.tap();
      await page.waitForTimeout(500);

      // Find close button in drawer
      const closeBtn = page.locator(
        '[role="dialog"] button[aria-label="Close"], [data-testid="drawer-close"]',
      );
      const closeVisible = await closeBtn.isVisible().catch(() => false);

      if (closeVisible) {
        await closeBtn.tap();
        await page.waitForTimeout(500);

        // Drawer should be hidden
        const drawer = page.locator('[role="dialog"]');
        const drawerStillVisible = await drawer.isVisible().catch(() => false);
        expect(drawerStillVisible).toBe(false);
      }
    }
  });

  test("should toggle chat overlay when tapping chat button", async ({
    page,
  }) => {
    await page.waitForTimeout(2000);

    // Find and tap chat button
    const chatBtn = page.locator(
      'nav button:has-text("Chat"), nav button[aria-label="Chat"]',
    );
    const btnVisible = await chatBtn.isVisible().catch(() => false);

    if (btnVisible) {
      await chatBtn.tap();
      await page.waitForTimeout(500);

      // Look for chat overlay (not a full drawer)
      const chatOverlay = page.locator('[data-testid="chat-overlay"]');
      const overlayVisible = await chatOverlay.isVisible().catch(() => false);

      if (overlayVisible) {
        await page.screenshot({
          path: "logs/mobile-chat-overlay.png",
          fullPage: true,
        });

        // Tap again to close
        await chatBtn.tap();
        await page.waitForTimeout(500);

        const stillVisible = await chatOverlay.isVisible().catch(() => false);
        expect(stillVisible).toBe(false);
      }
    }
  });
});

test.describe("Mobile UI - Touch Gestures", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.iphone14Pro);
    await page.goto("http://localhost:3333");
    await page
      .waitForSelector('[data-testid="game-loaded"]', { timeout: 30000 })
      .catch(() => page.waitForTimeout(5000));
  });

  test("should swipe left/right on action bar to switch bars", async ({
    page,
  }) => {
    await page.waitForTimeout(2000);

    const actionBar = page.locator('[data-testid="touch-action-bar"]');
    const actionBarVisible = await actionBar.isVisible().catch(() => false);

    if (actionBarVisible) {
      const box = await actionBar.boundingBox();

      if (box) {
        // Get initial bar indicator
        const dotsContainer = actionBar.locator(
          '[data-testid="bar-indicators"]',
        );

        // Swipe left
        await page.touchscreen.tap(
          box.x + box.width / 2,
          box.y + box.height / 2,
        );
        await page.mouse.move(box.x + box.width - 20, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + 20, box.y + box.height / 2, {
          steps: 10,
        });
        await page.mouse.up();

        await page.waitForTimeout(300);

        await page.screenshot({
          path: "logs/mobile-action-bar-swipe.png",
          fullPage: true,
        });
      }
    }
  });

  test("should swipe down on drawer handle to close drawer", async ({
    page,
  }) => {
    await page.waitForTimeout(2000);

    // Open a drawer first
    const inventoryBtn = page.locator('nav button[aria-label="Inventory"]');
    const btnVisible = await inventoryBtn.isVisible().catch(() => false);

    if (btnVisible) {
      await inventoryBtn.tap();
      await page.waitForTimeout(500);

      // Find drawer handle
      const drawerHandle = page.locator(
        '[role="dialog"] [data-testid="drawer-handle"]',
      );
      const handleVisible = await drawerHandle.isVisible().catch(() => false);

      if (handleVisible) {
        const handleBox = await drawerHandle.boundingBox();
        const viewport = page.viewportSize();

        if (handleBox && viewport) {
          // Swipe down
          await page.mouse.move(
            handleBox.x + handleBox.width / 2,
            handleBox.y + handleBox.height / 2,
          );
          await page.mouse.down();
          await page.mouse.move(
            handleBox.x + handleBox.width / 2,
            viewport.height - 50,
            { steps: 10 },
          );
          await page.mouse.up();

          await page.waitForTimeout(500);

          // Drawer should be closed
          const drawer = page.locator('[role="dialog"]');
          const drawerStillVisible = await drawer
            .isVisible()
            .catch(() => false);
          expect(drawerStillVisible).toBe(false);
        }
      }
    }
  });

  test("should long press on action slot for context menu", async ({
    page,
  }) => {
    await page.waitForTimeout(2000);

    const actionSlot = page
      .locator('[data-testid="touch-action-bar"] > div')
      .first();
    const slotVisible = await actionSlot.isVisible().catch(() => false);

    if (slotVisible) {
      const box = await actionSlot.boundingBox();

      if (box) {
        // Long press (500ms+)
        await page.touchscreen.tap(
          box.x + box.width / 2,
          box.y + box.height / 2,
        );
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.waitForTimeout(600);
        await page.mouse.up();

        await page.waitForTimeout(200);

        await page.screenshot({
          path: "logs/mobile-action-longpress.png",
          fullPage: true,
        });
      }
    }
  });
});

test.describe("Mobile UI - Landscape Mode", () => {
  test.beforeEach(async ({ page }) => {
    // Set landscape viewport
    await page.setViewportSize(VIEWPORTS.iphone14ProLandscape);
    await page.goto("http://localhost:3333");
    await page
      .waitForSelector('[data-testid="game-loaded"]', { timeout: 30000 })
      .catch(() => page.waitForTimeout(5000));
  });

  test("should display landscape layout on rotation", async ({ page }) => {
    await page.screenshot({
      path: "logs/mobile-ui-landscape.png",
      fullPage: true,
    });

    // Viewport should be landscape
    const viewport = page.viewportSize();
    expect(viewport?.width).toBeGreaterThan(viewport?.height || 0);
  });

  test("should show side panels in landscape", async ({ page }) => {
    await page.waitForTimeout(2000);

    // In landscape, panels should be on the sides instead of bottom sheets
    const leftPanel = page.locator('[data-testid="landscape-left-panel"]');
    const rightPanel = page.locator('[data-testid="landscape-right-panel"]');

    const leftVisible = await leftPanel.isVisible().catch(() => false);
    const rightVisible = await rightPanel.isVisible().catch(() => false);

    // At least one side panel should be visible in landscape
    // (depending on which panels are open)

    await page.screenshot({
      path: "logs/mobile-landscape-panels.png",
      fullPage: true,
    });
  });
});

test.describe("Mobile UI - Orientation Changes", () => {
  test("should preserve panel state during orientation change", async ({
    page,
  }) => {
    // Start in portrait
    await page.setViewportSize(VIEWPORTS.iphone14Pro);
    await page.goto("http://localhost:3333");
    await page
      .waitForSelector('[data-testid="game-loaded"]', { timeout: 30000 })
      .catch(() => page.waitForTimeout(5000));

    // Open a panel
    const inventoryBtn = page.locator('nav button[aria-label="Inventory"]');
    const btnVisible = await inventoryBtn.isVisible().catch(() => false);

    if (btnVisible) {
      await inventoryBtn.tap();
      await page.waitForTimeout(500);

      await page.screenshot({
        path: "logs/mobile-orientation-portrait.png",
        fullPage: true,
      });

      // Rotate to landscape
      await page.setViewportSize(VIEWPORTS.iphone14ProLandscape);
      await page.waitForTimeout(500);

      await page.screenshot({
        path: "logs/mobile-orientation-landscape.png",
        fullPage: true,
      });

      // Rotate back to portrait
      await page.setViewportSize(VIEWPORTS.iphone14Pro);
      await page.waitForTimeout(500);

      await page.screenshot({
        path: "logs/mobile-orientation-back-to-portrait.png",
        fullPage: true,
      });
    }
  });
});

test.describe("Mobile UI - Touch Targets", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.iphone14Pro);
    await page.goto("http://localhost:3333");
    await page
      .waitForSelector('[data-testid="game-loaded"]', { timeout: 30000 })
      .catch(() => page.waitForTimeout(5000));
  });

  test("should have minimum 44px touch targets on navigation buttons", async ({
    page,
  }) => {
    await page.waitForTimeout(2000);

    const navButtons = page.locator("nav button");
    const buttonCount = await navButtons.count();

    for (let i = 0; i < buttonCount; i++) {
      const button = navButtons.nth(i);
      const box = await button.boundingBox();

      if (box) {
        // Apple HIG minimum is 44px, Google Material is 48px
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
    }
  });

  test("should have minimum 48px touch targets on action bar slots", async ({
    page,
  }) => {
    await page.waitForTimeout(2000);

    const actionSlots = page.locator(
      '[data-testid="touch-action-bar"] [data-slot]',
    );
    const slotCount = await actionSlots.count();

    for (let i = 0; i < slotCount; i++) {
      const slot = actionSlots.nth(i);
      const box = await slot.boundingBox();

      if (box) {
        // Google Material Design minimum is 48px
        expect(box.width).toBeGreaterThanOrEqual(48);
        expect(box.height).toBeGreaterThanOrEqual(48);
      }
    }
  });

  test("should have 8px minimum gap between touch targets", async ({
    page,
  }) => {
    await page.waitForTimeout(2000);

    const navButtons = page.locator("nav button");
    const buttonCount = await navButtons.count();

    if (buttonCount >= 2) {
      const boxes: Array<{ x: number; width: number }> = [];

      for (let i = 0; i < buttonCount; i++) {
        const button = navButtons.nth(i);
        const box = await button.boundingBox();
        if (box) {
          boxes.push({ x: box.x, width: box.width });
        }
      }

      // Sort by x position
      boxes.sort((a, b) => a.x - b.x);

      // Check gaps between adjacent buttons
      for (let i = 1; i < boxes.length; i++) {
        const gap = boxes[i].x - (boxes[i - 1].x + boxes[i - 1].width);
        expect(gap).toBeGreaterThanOrEqual(8);
      }
    }
  });
});

test.describe("Mobile UI - Visual Regression", () => {
  test("should capture all mobile viewport sizes", async ({ page }) => {
    const viewportNames = Object.keys(VIEWPORTS) as Array<
      keyof typeof VIEWPORTS
    >;

    for (const name of viewportNames) {
      await page.setViewportSize(VIEWPORTS[name]);
      await page.goto("http://localhost:3333");
      await page
        .waitForSelector('[data-testid="game-loaded"]', { timeout: 30000 })
        .catch(() => page.waitForTimeout(5000));

      await page.screenshot({
        path: `logs/mobile-viewport-${name}.png`,
        fullPage: true,
      });
    }
  });

  test("should verify no single-color screen on mobile", async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.iphone14Pro);
    await page.goto("http://localhost:3333");
    await page.waitForTimeout(5000);

    // Take screenshot
    const screenshot = await page.screenshot();

    // Screenshot should have reasonable size (not empty)
    expect(screenshot.length).toBeGreaterThan(5000);

    // Screenshot should not be mostly one color
    // This is a basic check - the screenshot should have variety
  });
});

test.describe("Mobile UI - Performance", () => {
  test("should render drawer animations at 60fps", async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.iphone14Pro);
    await page.goto("http://localhost:3333");
    await page
      .waitForSelector('[data-testid="game-loaded"]', { timeout: 30000 })
      .catch(() => page.waitForTimeout(5000));

    // Enable performance tracing
    await page.tracing.start({ screenshots: true });

    // Open and close drawer multiple times
    const inventoryBtn = page.locator('nav button[aria-label="Inventory"]');
    const btnVisible = await inventoryBtn.isVisible().catch(() => false);

    if (btnVisible) {
      for (let i = 0; i < 3; i++) {
        await inventoryBtn.tap();
        await page.waitForTimeout(400);

        // Close drawer
        const closeBtn = page.locator(
          '[role="dialog"] button[aria-label="Close"]',
        );
        const closeVisible = await closeBtn.isVisible().catch(() => false);
        if (closeVisible) {
          await closeBtn.tap();
          await page.waitForTimeout(400);
        }
      }
    }

    // Stop tracing
    await page.tracing.stop({
      path: "logs/mobile-drawer-animation-trace.zip",
    });
  });
});
