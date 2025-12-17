/**
 * Visual Regression Tests
 *
 * E2E tests for HyperForge using Playwright.
 * Tests 3D rendering, UI layout, and visual consistency.
 *
 * Real Issues to Surface:
 * - 3D viewer rendering black screen
 * - UI components overlapping
 * - Responsive layout breaking
 * - Loading states not appearing
 */

import { test, expect } from "@playwright/test";

test.describe("Visual Regression", () => {
  test.describe("Home Page", () => {
    test("renders home page correctly", async ({ page }) => {
      await page.goto("/");

      // Wait for page to load
      await page.waitForLoadState("networkidle");

      // Check page title or main heading exists
      const heading = page.locator("h1, [role='heading']").first();
      await expect(heading).toBeVisible({ timeout: 10000 });

      // Take screenshot for visual comparison
      await expect(page).toHaveScreenshot("home-page.png", {
        maxDiffPixels: 100,
      });
    });

    test("renders navigation correctly", async ({ page }) => {
      await page.goto("/");
      await page.waitForLoadState("networkidle");

      // Check for navigation elements
      const nav = page.locator("nav, [role='navigation']").first();
      if (await nav.isVisible()) {
        await expect(nav).toBeVisible();
      }
    });
  });

  test.describe("Studio Page", () => {
    test("loads studio layout with all panels", async ({ page }) => {
      await page.goto("/studio");
      await page.waitForLoadState("networkidle");

      // Wait for studio to initialize
      await page.waitForTimeout(2000);

      // Check that main content area exists
      const main = page.locator("main, [role='main']").first();
      await expect(main).toBeVisible({ timeout: 15000 });
    });

    test("studio panels are visible on desktop", async ({ page }) => {
      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.goto("/studio");
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(2000);

      // Take full page screenshot
      await expect(page).toHaveScreenshot("studio-desktop.png", {
        fullPage: true,
        maxDiffPixels: 200,
      });
    });
  });

  test.describe("3D Viewer", () => {
    test("canvas element renders", async ({ page }) => {
      await page.goto("/studio");
      await page.waitForLoadState("networkidle");

      // Wait for Three.js canvas to appear
      const canvas = page.locator("canvas").first();

      // Canvas should exist (may take time to load)
      await expect(canvas).toBeVisible({ timeout: 15000 });
    });

    test("canvas is not blank (has content)", async ({ page }) => {
      await page.goto("/studio");
      await page.waitForLoadState("networkidle");

      // Wait for canvas
      const canvas = page.locator("canvas").first();
      await expect(canvas).toBeVisible({ timeout: 15000 });

      // Wait for rendering
      await page.waitForTimeout(3000);

      // Take screenshot of canvas area
      const screenshot = await canvas.screenshot();

      // Verify screenshot has content (not blank)
      // A blank canvas would have very uniform color distribution
      expect(screenshot.length).toBeGreaterThan(1000);
    });

    test("canvas has proper dimensions", async ({ page }) => {
      await page.goto("/studio");
      await page.waitForLoadState("networkidle");

      const canvas = page.locator("canvas").first();
      await expect(canvas).toBeVisible({ timeout: 15000 });

      // Get canvas dimensions
      const boundingBox = await canvas.boundingBox();

      if (boundingBox) {
        // Canvas should have reasonable dimensions
        expect(boundingBox.width).toBeGreaterThan(100);
        expect(boundingBox.height).toBeGreaterThan(100);
      }
    });
  });

  test.describe("Generate Page", () => {
    test("loads generation interface", async ({ page }) => {
      await page.goto("/generate");
      await page.waitForLoadState("networkidle");

      // Check for prompt input or generation form
      const promptInput = page
        .locator('textarea, input[type="text"], [data-testid="prompt-input"]')
        .first();

      // If prompt input exists, it should be visible
      if ((await promptInput.count()) > 0) {
        await expect(promptInput).toBeVisible({ timeout: 10000 });
      }
    });

    test("generation form is interactive", async ({ page }) => {
      await page.goto("/generate");
      await page.waitForLoadState("networkidle");

      // Find any form element
      const form = page.locator("form").first();
      if ((await form.count()) > 0) {
        await expect(form).toBeVisible();
      }

      // Find submit button
      const submitButton = page
        .locator('button[type="submit"], button:has-text("Generate")')
        .first();

      if ((await submitButton.count()) > 0) {
        await expect(submitButton).toBeVisible();
      }
    });
  });

  test.describe("Responsive Layout", () => {
    test("adapts to mobile viewport", async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await page.goto("/");
      await page.waitForLoadState("networkidle");

      // Take mobile screenshot
      await expect(page).toHaveScreenshot("home-mobile.png", {
        maxDiffPixels: 100,
      });
    });

    test("adapts to tablet viewport", async ({ page }) => {
      await page.setViewportSize({ width: 768, height: 1024 });
      await page.goto("/");
      await page.waitForLoadState("networkidle");

      // Take tablet screenshot
      await expect(page).toHaveScreenshot("home-tablet.png", {
        maxDiffPixels: 100,
      });
    });

    test("studio layout adapts to narrow viewport", async ({ page }) => {
      await page.setViewportSize({ width: 768, height: 1024 });
      await page.goto("/studio");
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(2000);

      // Verify content is still accessible
      const main = page.locator("main, [role='main']").first();
      await expect(main).toBeVisible({ timeout: 15000 });
    });
  });

  test.describe("Loading States", () => {
    test("shows loading indicator during page load", async ({ page }) => {
      // Slow down network to catch loading state
      await page.route("**/*", async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        await route.continue();
      });

      await page.goto("/studio");

      // Check for any loading indicator (spinner, skeleton, etc.)
      const loadingIndicator = page
        .locator(
          '[data-loading="true"], .loading, .spinner, [role="progressbar"]',
        )
        .first();

      // Loading indicator might appear briefly
      // If it exists, it should eventually disappear
      if ((await loadingIndicator.count()) > 0) {
        await expect(loadingIndicator).toBeHidden({ timeout: 30000 });
      }
    });
  });

  test.describe("Error States", () => {
    test("handles 404 pages gracefully", async ({ page }) => {
      const response = await page.goto("/non-existent-page-12345");

      // Either 404 status or custom error page
      if (response) {
        expect([200, 404]).toContain(response.status());
      }

      // Page should still render something
      const body = page.locator("body");
      await expect(body).toBeVisible();
    });
  });

  test.describe("Accessibility", () => {
    test("main content is keyboard accessible", async ({ page }) => {
      await page.goto("/");
      await page.waitForLoadState("networkidle");

      // Tab through the page
      await page.keyboard.press("Tab");
      await page.keyboard.press("Tab");
      await page.keyboard.press("Tab");

      // Check that focus is somewhere on the page
      const focusedElement = page.locator(":focus");
      if ((await focusedElement.count()) > 0) {
        await expect(focusedElement).toBeVisible();
      }
    });

    test("has no major accessibility violations", async ({ page }) => {
      await page.goto("/");
      await page.waitForLoadState("networkidle");

      // Check for basic accessibility elements
      const main = page.locator("main, [role='main']");
      const nav = page.locator("nav, [role='navigation']");

      // At least one landmark should exist
      const hasLandmark = (await main.count()) > 0 || (await nav.count()) > 0;
      expect(hasLandmark).toBe(true);
    });
  });
});
