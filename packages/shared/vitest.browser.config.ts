import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
import path from "path";

/**
 * Browser-specific vitest config for WebGL tests (PlayerSilhouette, etc.)
 * Run with: bun run test:browser
 */
export default defineConfig({
  // Use modern target that supports top-level await
  esbuild: {
    target: "esnext",
  },
  optimizeDeps: {
    esbuildOptions: {
      target: "esnext",
    },
  },
  build: {
    target: "esnext",
  },
  test: {
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts}"],
    watchExclude: ["**/node_modules/**", "**/dist/**", "**/build/**"],
    testTimeout: 30000,
    hookTimeout: 30000,
    // Browser testing for WebGL tests
    browser: {
      enabled: true,
      provider: playwright(),
      instances: [{ browser: "chromium" }],
      headless: true,
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
