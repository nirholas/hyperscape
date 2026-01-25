import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react() as never],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/game/panels/BankPanel/**/*.{ts,tsx}"],
      exclude: ["**/*.test.{ts,tsx}", "**/index.ts"],
    },
    // Timeout for async operations
    testTimeout: 10000,
    // Pool configuration for faster tests
    pool: "forks",
  },
  resolve: {
    alias: {
      // Use actual shared package - per project rules, no mocks allowed
      // Tests should use real Hyperscape instances with Playwright
    },
  },
});
