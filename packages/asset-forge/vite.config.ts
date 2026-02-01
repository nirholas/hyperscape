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
      esbuildOptions: {
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
