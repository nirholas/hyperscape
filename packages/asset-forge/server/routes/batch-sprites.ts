/**
 * Batch Sprite Generation Routes
 *
 * Lists game model .glb files and saves generated icon PNGs
 * to the game's icons directory.
 */

import { Elysia, t } from "elysia";
import path from "path";
import fs from "fs";

export const createBatchSpritesRoutes = (rootDir: string) => {
  const gameAssetsDir = path.resolve(rootDir, "../server/world/assets");
  const modelsDir = path.join(gameAssetsDir, "models");
  const iconsDir = path.join(gameAssetsDir, "icons");

  return new Elysia({ prefix: "/api/batch", name: "batch-sprites" })
    .get("/game-models", async () => {
      const models: { name: string; file: string; url: string }[] = [];

      if (!fs.existsSync(modelsDir)) {
        return { models: [], total: 0, error: "Models directory not found" };
      }

      const dirs = await fs.promises.readdir(modelsDir, {
        withFileTypes: true,
      });
      for (const dir of dirs) {
        if (!dir.isDirectory()) continue;
        const dirPath = path.join(modelsDir, dir.name);
        const files = await fs.promises.readdir(dirPath);
        for (const file of files) {
          if (!file.endsWith(".glb")) continue;
          // Skip raw/base template files
          if (file.endsWith("_raw.glb")) continue;
          // Skip aligned (equipped) variants — we just want ground models
          if (file.includes("-aligned")) continue;
          models.push({
            name: dir.name,
            file,
            url: `/game-models/${dir.name}/${file}`,
          });
        }
      }

      // Sort alphabetically
      models.sort((a, b) => a.name.localeCompare(b.name));

      return { models, total: models.length };
    })
    .post(
      "/save-icon",
      async ({ body }) => {
        const { filename, imageData } = body;

        // Create icons directory if it doesn't exist
        await fs.promises.mkdir(iconsDir, { recursive: true });

        // Extract base64 data from data URL
        const base64Data = imageData.replace(/^data:image\/\w+;base64,/, "");
        const buffer = Buffer.from(base64Data, "base64");

        const filepath = path.join(iconsDir, filename);
        await Bun.write(filepath, buffer);

        console.log(
          `[BatchSprites] Saved: icons/${filename} (${(buffer.length / 1024).toFixed(1)} KB)`,
        );

        return {
          success: true,
          path: `icons/${filename}`,
          size: buffer.length,
        };
      },
      {
        body: t.Object({
          filename: t.String({ maxLength: 128 }),
          imageData: t.String(),
        }),
      },
    );
};
