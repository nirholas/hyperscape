/**
 * Vitest Global Setup
 *
 * This file runs before all tests and sets up:
 * - Three.js server-side polyfills
 * - Environment variables
 * - Global test utilities
 */

import { beforeAll, afterAll, afterEach } from "vitest";

// Server-side Three.js polyfills
beforeAll(async () => {
  // Import Three.js polyfills for server-side testing
  // These mock document, window, and canvas for GLB loading
  await import("@/lib/server/three-polyfills");
});

// Clean up after each test
afterEach(() => {
  // Clear any global state between tests
});

// Final cleanup
afterAll(() => {
  // Clean up any persistent resources
});

/**
 * Global test configuration
 */
declare global {
  // Add any global test variables here

  var TEST_ASSETS_PATH: string;
}

globalThis.TEST_ASSETS_PATH = new URL(
  "../../test-assets",
  import.meta.url,
).pathname;
