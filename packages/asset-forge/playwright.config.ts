import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright Configuration for Asset Forge / World Builder Tests
 *
 * Tests the World Builder UI flow for creating and editing procedural worlds.
 * Uses visual testing and UI interaction verification.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.ts",
  timeout: 120000, // 2 minutes per test
  expect: {
    timeout: 10000,
  },
  fullyParallel: false, // Run tests sequentially for reliable screenshots
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { outputFolder: "playwright-report" }]],
  use: {
    // Base URL for Asset Forge
    baseURL: "http://localhost:3400",
    // Capture trace on first retry
    trace: "on-first-retry",
    // Screenshot on failure
    screenshot: "only-on-failure",
    // Video on failure
    video: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // Auto-start dev server before tests
  webServer: {
    command: "bun run dev",
    port: 3400,
    timeout: 120 * 1000,
    reuseExistingServer: true,
  },
});
