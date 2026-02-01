import path from "path";
import { fileURLToPath } from "url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react() as never],
  test: {
    globals: true,
    environment: "jsdom",
    include: ["tests/**/*.test.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/e2e/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: [
        "src/components/WorldBuilder/**/*.{ts,tsx}",
        "src/services/**/*.{ts,tsx}",
      ],
      exclude: ["**/*.test.{ts,tsx}", "**/index.ts"],
    },
    testTimeout: 10000,
    pool: "forks",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@hyperscape/procgen": path.resolve(__dirname, "../procgen/src"),
    },
  },
});
