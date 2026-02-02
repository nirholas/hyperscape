import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: [
        "node_modules/",
        "src/**/*.test.ts",
        "**/*.d.ts",
        "**/*.config.*",
      ],
    },
    include: ["src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts}"],
    watchExclude: ["**/node_modules/**", "**/dist/**", "**/build/**"],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
  resolve: {
    alias: [
      // More specific aliases first (longer paths)
      {
        find: "@hyperscape/procgen/building/town",
        replacement: path.resolve(
          __dirname,
          "../procgen/dist/building/town/index.js",
        ),
      },
      {
        find: "@hyperscape/procgen/building/viewer",
        replacement: path.resolve(
          __dirname,
          "../procgen/dist/building/viewer/index.js",
        ),
      },
      {
        find: "@hyperscape/procgen/building",
        replacement: path.resolve(
          __dirname,
          "../procgen/dist/building/index.js",
        ),
      },
      {
        find: "@hyperscape/procgen/terrain",
        replacement: path.resolve(
          __dirname,
          "../procgen/dist/terrain/index.js",
        ),
      },
      {
        find: "@hyperscape/procgen/rock",
        replacement: path.resolve(__dirname, "../procgen/dist/rock/index.js"),
      },
      {
        find: "@hyperscape/procgen/plant",
        replacement: path.resolve(__dirname, "../procgen/dist/plant/index.js"),
      },
      {
        find: "@hyperscape/procgen/vegetation",
        replacement: path.resolve(
          __dirname,
          "../procgen/dist/vegetation/index.js",
        ),
      },
      {
        find: "@hyperscape/procgen/items/dock",
        replacement: path.resolve(
          __dirname,
          "../procgen/dist/items/dock/index.js",
        ),
      },
      {
        find: "@hyperscape/procgen/items",
        replacement: path.resolve(__dirname, "../procgen/dist/items/index.js"),
      },
      {
        find: "@hyperscape/procgen",
        replacement: path.resolve(__dirname, "../procgen/dist/index.js"),
      },
      {
        find: "@",
        replacement: path.resolve(__dirname, "./src"),
      },
    ],
  },
});
