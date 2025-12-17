/**
 * Playwright Configuration for HyperForge
 *
 * E2E and visual regression testing:
 * - 3D viewer rendering validation
 * - Studio layout visual regression
 * - Asset generation flow testing
 *
 * @see https://playwright.dev/docs/test-configuration
 */

import { defineConfig, devices } from "@playwright/test";

/**
 * Read environment variables from .env.local
 */
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, ".env.local") });

/**
 * Base URL for local development
 */
const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3500";

export default defineConfig({
  // Test directory
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",

  // Parallel execution
  fullyParallel: true,
  workers: process.env.CI ? 1 : undefined,

  // Fail the build on CI if you accidentally left test.only in the source code
  forbidOnly: !!process.env.CI,

  // Retry on CI only
  retries: process.env.CI ? 2 : 0,

  // Reporter configuration
  reporter: [
    ["html", { outputFolder: "./playwright-report", open: "never" }],
    ["json", { outputFile: "./playwright-report/results.json" }],
    ["list"],
  ],

  // Shared settings for all projects
  use: {
    baseURL,

    // Collect trace when retrying the failed test
    trace: "on-first-retry",

    // Screenshot on failure
    screenshot: "only-on-failure",

    // Video on failure
    video: "on-first-retry",

    // Default timeout for actions
    actionTimeout: 10000,

    // Navigation timeout (longer for 3D asset loading)
    navigationTimeout: 30000,
  },

  // Visual comparison settings
  expect: {
    // Screenshot comparison options
    toHaveScreenshot: {
      // Allow some pixel differences for GPU rendering variations
      maxDiffPixels: 100,
      maxDiffPixelRatio: 0.01,
      // Threshold for individual pixel comparison
      threshold: 0.2,
      // Animation settling time
      animations: "disabled",
    },
    toMatchSnapshot: {
      maxDiffPixels: 50,
    },
    // Timeout for expect assertions
    timeout: 10000,
  },

  // Test timeout (30s for most, extend for 3D rendering)
  timeout: 30000,

  // Configure projects for major browsers
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Enable WebGL for 3D rendering
        launchOptions: {
          args: ["--enable-webgl", "--use-gl=angle", "--ignore-gpu-blocklist"],
        },
      },
    },

    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },

    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },

    // Mobile viewports for responsive testing
    {
      name: "Mobile Chrome",
      use: { ...devices["Pixel 5"] },
    },
  ],

  // Run local dev server before starting tests
  webServer: {
    command: "bun run dev",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120000, // 2 minutes for Next.js to start
    stdout: "pipe",
    stderr: "pipe",
  },

  // Output directory for test artifacts
  outputDir: "./test-results/playwright",

  // Snapshot directory
  snapshotDir: "./e2e/__snapshots__",

  // Snapshot path template
  snapshotPathTemplate:
    "{snapshotDir}/{testFilePath}/{testName}-{projectName}{ext}",
});
