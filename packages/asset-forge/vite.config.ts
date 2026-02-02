import path from "path";

import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const uiPort = Number(env.ASSET_FORGE_PORT) || 3400;
  const apiPort = Number(env.ASSET_FORGE_API_PORT) || 3401;

  return {
    plugins: [react()],
    // Define process.env for pre-built packages that use it (e.g., MovementUtils.ts)
    define: {
      "process.env.NODE_ENV": JSON.stringify(mode),
      "process.env.GAME_MODE": JSON.stringify(env.GAME_MODE || ""),
    },
    build: {
      target: "esnext", // Support top-level await
    },
    resolve: {
      dedupe: ["react", "react-dom", "react/jsx-runtime", "three"],
      alias: {
        "@": path.resolve(__dirname, "src"),
        react: path.resolve(__dirname, "../../node_modules/react"),
        "react-dom": path.resolve(__dirname, "../../node_modules/react-dom"),
        "react/jsx-runtime": path.resolve(
          __dirname,
          "../../node_modules/react/jsx-runtime",
        ),
        // Three.js WebGPU module
        "three/webgpu": path.resolve(
          __dirname,
          "../../node_modules/three/build/three.webgpu.js",
        ),
        "three/tsl": path.resolve(
          __dirname,
          "../../node_modules/three/build/three.tsl.js",
        ),
        // Three.js addons (examples/jsm)
        "three/addons": path.resolve(
          __dirname,
          "../../node_modules/three/examples/jsm",
        ),
        // Ensure single Three.js instance across all packages
        three: path.resolve(__dirname, "../../node_modules/three"),
        // Use client-only build of shared to exclude server-side modules (fs-extra, etc.)
        "@hyperscape/shared": path.resolve(
          __dirname,
          "../shared/build/framework.client.js",
        ),
        // Workspace package aliases
        "@hyperscape/decimation": path.resolve(
          __dirname,
          "../decimation/dist/index.js",
        ),
        "@hyperscape/impostor": path.resolve(
          __dirname,
          "../impostors/dist/index.js",
        ),
        // Procgen package aliases for terrain, vegetation, etc.
        // NOTE: More specific paths must come BEFORE less specific paths
        "@hyperscape/procgen/terrain": path.resolve(
          __dirname,
          "../procgen/dist/terrain/index.js",
        ),
        "@hyperscape/procgen/vegetation": path.resolve(
          __dirname,
          "../procgen/dist/vegetation/index.js",
        ),
        "@hyperscape/procgen/building/viewer": path.resolve(
          __dirname,
          "../procgen/dist/building/viewer/index.js",
        ),
        "@hyperscape/procgen/building/town": path.resolve(
          __dirname,
          "../procgen/dist/building/town/index.js",
        ),
        "@hyperscape/procgen/building": path.resolve(
          __dirname,
          "../procgen/dist/building/index.js",
        ),
        "@hyperscape/procgen/rock": path.resolve(
          __dirname,
          "../procgen/dist/rock/index.js",
        ),
        "@hyperscape/procgen/plant": path.resolve(
          __dirname,
          "../procgen/dist/plant/index.js",
        ),
        "@hyperscape/procgen/items/dock": path.resolve(
          __dirname,
          "../procgen/dist/items/dock/index.js",
        ),
        "@hyperscape/procgen/items": path.resolve(
          __dirname,
          "../procgen/dist/items/index.js",
        ),
        "@hyperscape/procgen": path.resolve(
          __dirname,
          "../procgen/dist/index.js",
        ),
      },
    },
    optimizeDeps: {
      include: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "three",
        "@react-three/fiber",
        "@react-three/drei",
      ],
      // Exclude Node.js-only modules that shouldn't be bundled for browser
      exclude: ["fs-extra", "graceful-fs", "better-sqlite3", "knex"],
      esbuildOptions: {
        target: "esnext", // Support top-level await in dependencies like yoga-layout
        resolveExtensions: [".mjs", ".js", ".jsx", ".json", ".ts", ".tsx"],
      },
    },
    server: {
      port: uiPort,
      proxy: {
        "/api": {
          target: `http://localhost:${apiPort}`,
          changeOrigin: true,
        },
        "/assets": {
          target: `http://localhost:${apiPort}`,
          changeOrigin: true,
        },
      },
    },
  };
});
