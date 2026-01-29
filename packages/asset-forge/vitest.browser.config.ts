import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Browser-specific vitest config for WebGL tests (VRMImposterBaker, etc.)
 * Run with: bun run test:browser
 */
export default defineConfig({
  plugins: [react() as never],
  test: {
    globals: true,
    include: ["src/**/__tests__/**/*.test.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/e2e/**"],
    testTimeout: 30000,
    // Browser testing for WebGL/WebGPU tests
    browser: {
      enabled: true,
      provider: playwright(),
      instances: [{ browser: "chromium" }],
      headless: true,
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@hyperscape/procgen": path.resolve(__dirname, "../procgen/src"),
    },
  },
});
