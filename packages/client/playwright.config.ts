import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright Configuration for Client Tests
 *
 * Tests run against real Hyperscape instances - NO MOCKS.
 * Uses visual testing with colored cube proxies per project rules.
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
    // Base URL for the client
    baseURL: "http://localhost:3333",
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
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 5"] },
    },
  ],
  // Auto-start dev servers before tests
  webServer: [
    // Start the game server
    {
      command: "bun run start",
      cwd: "../server",
      port: 5555,
      timeout: 120 * 1000,
      reuseExistingServer: !process.env.CI,
    },
    // Start the client
    {
      command: "bun run dev",
      port: 3333,
      timeout: 60 * 1000,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
