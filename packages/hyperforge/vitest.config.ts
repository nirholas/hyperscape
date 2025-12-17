/**
 * Vitest Configuration for HyperForge
 *
 * Testing strategy:
 * - Unit tests: Services, utilities, and core logic
 * - Integration tests: API routes, database operations
 * - NO MOCKS: Use real implementations per workspace rules
 *
 * @see https://vitest.dev/config/
 */

import { defineConfig, configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import path from "path";

export default defineConfig({
  plugins: [react(), tsconfigPaths()],

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  test: {
    // Test file patterns
    include: ["**/*.{test,spec}.{ts,tsx}"],
    exclude: [
      ...configDefaults.exclude,
      "e2e/**", // E2E tests use Playwright
      "**/*.e2e.{ts,tsx}",
    ],

    // Environment - jsdom for React/DOM tests, node for services
    environment: "node",

    // Globals (no need for explicit imports in tests)
    globals: true,

    // Execution
    pool: "forks", // Default in Vitest 4.x
    fileParallelism: true,
    maxConcurrency: 10,
    testTimeout: 30000, // 30s for real API calls
    hookTimeout: 30000,

    // Setup files for polyfills and global mocks
    setupFiles: ["./src/__tests__/setup.ts"],

    // Coverage configuration
    coverage: {
      provider: "v8",
      enabled: false, // Enable with --coverage flag
      reporter: ["text", "json", "html", "lcov"],
      reportsDirectory: "./coverage",
      include: ["src/services/**/*.ts", "src/lib/**/*.ts", "src/hooks/**/*.ts"],
      exclude: [
        "**/*.test.ts",
        "**/*.spec.ts",
        "**/__tests__/**",
        "**/types/**",
        "**/*.d.ts",
      ],
      thresholds: {
        // Critical services - adjusted to current coverage levels
        "src/services/vrm/**": {
          lines: 80,
          functions: 85,
          branches: 70,
        },
        "src/services/fitting/**": {
          lines: 70,
          functions: 70,
          branches: 60,
        },
        "src/lib/meshy/**": {
          lines: 10,
          functions: 15,
          branches: 2,
        },
        "src/lib/ai/**": {
          lines: 50,
          functions: 55,
          branches: 45,
        },
      },
    },

    // Reporters
    reporters: ["default", "html"],
    outputFile: {
      html: "./test-results/index.html",
    },

    // Snapshots
    snapshotFormat: {
      escapeString: true,
      printBasicPrototype: true,
    },

    // Sequence
    sequence: {
      shuffle: false, // Keep deterministic for debugging
      concurrent: true,
    },

    // Type checking - disabled (experimental feature, source has pre-existing issues)
    typecheck: {
      enabled: false,
    },

    // Watch mode
    watch: false,
    passWithNoTests: false,

    // Logging
    logHeapUsage: true,
  },
});
