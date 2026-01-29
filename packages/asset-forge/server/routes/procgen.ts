/**
 * Procgen Routes
 *
 * API endpoints for managing procedural generation presets,
 * batch generation, and integration with LOD/impostor systems.
 *
 * Endpoints:
 * - GET /api/procgen/presets - List all presets
 * - GET /api/procgen/presets/:id - Get preset by ID
 * - POST /api/procgen/presets - Create preset
 * - PUT /api/procgen/presets/:id - Update preset
 * - DELETE /api/procgen/presets/:id - Delete preset
 * - POST /api/procgen/presets/:id/duplicate - Duplicate preset
 * - GET /api/procgen/assets - List generated assets
 * - POST /api/procgen/assets - Record generated asset
 * - DELETE /api/procgen/assets/:id - Delete generated asset
 * - POST /api/procgen/batch/seeds - Generate batch seeds
 * - GET /api/procgen/export - Export manifest
 * - POST /api/procgen/import - Import manifest
 */

import { Elysia, t } from "elysia";
import type { ProcgenPresetService } from "../services/ProcgenPresetService";
import type {
  ProcgenCategory,
  ProcgenPreset,
} from "../../src/types/ProcgenPresets";

// Validation schemas
const PresetCategorySchema = t.Union([
  t.Literal("tree"),
  t.Literal("rock"),
  t.Literal("plant"),
  t.Literal("building"),
  t.Literal("terrain"),
  t.Literal("roads"),
]);

const TreeSettingsSchema = t.Object({
  basePreset: t.String(),
  seed: t.Number(),
  showLeaves: t.Boolean(),
  overrides: t.Optional(
    t.Object({
      scale: t.Optional(t.Number()),
      trunkGirth: t.Optional(t.Number()),
      branchLength: t.Optional(t.Number()),
      leafDensity: t.Optional(t.Number()),
    }),
  ),
});

const RockSettingsSchema = t.Object({
  shapePreset: t.String(),
  rockTypePreset: t.Optional(t.String()),
  seed: t.Number(),
  subdivisions: t.Number(),
  flatShading: t.Boolean(),
  overrides: t.Optional(
    t.Object({
      scale: t.Optional(t.Number()),
      roughness: t.Optional(t.Number()),
      noiseScale: t.Optional(t.Number()),
      noiseStrength: t.Optional(t.Number()),
    }),
  ),
});

const PlantSettingsSchema = t.Object({
  basePreset: t.String(),
  seed: t.Number(),
  overrides: t.Optional(
    t.Object({
      scale: t.Optional(t.Number()),
      leafCount: t.Optional(t.Number()),
      leafSize: t.Optional(t.Number()),
      stemLength: t.Optional(t.Number()),
    }),
  ),
});

const BuildingSettingsSchema = t.Object({
  buildingType: t.String(),
  seed: t.String(),
  showRoof: t.Boolean(),
  overrides: t.Optional(
    t.Object({
      floors: t.Optional(t.Number()),
      width: t.Optional(t.Number()),
      depth: t.Optional(t.Number()),
    }),
  ),
});

const TerrainSettingsSchema = t.Object({
  basePreset: t.String(),
  seed: t.Number(),
  overrides: t.Optional(
    t.Object({
      worldSize: t.Optional(t.Number()),
      tileSize: t.Optional(t.Number()),
      maxHeight: t.Optional(t.Number()),
      waterThreshold: t.Optional(t.Number()),
    }),
  ),
});

const RoadsSettingsSchema = t.Object({
  townSize: t.Union([
    t.Literal("hamlet"),
    t.Literal("village"),
    t.Literal("town"),
  ]),
  seed: t.Number(),
});

const CreatePresetSchema = t.Object({
  name: t.String({ minLength: 1, maxLength: 100 }),
  description: t.Optional(t.String({ maxLength: 500 })),
  category: PresetCategorySchema,
  settings: t.Union([
    TreeSettingsSchema,
    RockSettingsSchema,
    PlantSettingsSchema,
    BuildingSettingsSchema,
    TerrainSettingsSchema,
    RoadsSettingsSchema,
  ]),
  tags: t.Optional(t.Array(t.String())),
});

const GeneratedAssetSchema = t.Object({
  presetId: t.String(),
  presetName: t.String(),
  category: PresetCategorySchema,
  seed: t.Number(),
  modelPath: t.Optional(t.String()),
  thumbnailPath: t.Optional(t.String()),
  lod: t.Optional(
    t.Object({
      lod0Path: t.Optional(t.String()),
      lod1Path: t.Optional(t.String()),
      lod2Path: t.Optional(t.String()),
      impostorPath: t.Optional(t.String()),
    }),
  ),
  stats: t.Optional(
    t.Object({
      vertices: t.Number(),
      triangles: t.Number(),
      generationTime: t.Number(),
    }),
  ),
});

export const createProcgenRoutes = (presetService: ProcgenPresetService) => {
  return (
    new Elysia({ prefix: "/api/procgen", name: "procgen" })
      .guard({
        beforeHandle: ({ request }) => {
          console.log(
            `[Procgen] ${request.method} ${new URL(request.url).pathname}`,
          );
        },
      })

      // List presets
      .get(
        "/presets",
        ({ query }) => {
          const category = query.category as ProcgenCategory | undefined;
          const presets = presetService.listPresets(category);
          return { presets, count: presets.length };
        },
        {
          query: t.Object({
            category: t.Optional(PresetCategorySchema),
          }),
        },
      )

      // Get preset by ID
      .get(
        "/presets/:id",
        ({ params, set }) => {
          const preset = presetService.getPreset(params.id);
          if (!preset) {
            set.status = 404;
            return { error: "Preset not found" };
          }
          return { preset };
        },
        {
          params: t.Object({ id: t.String() }),
        },
      )

      // Create preset
      .post(
        "/presets",
        ({ body }) => {
          const preset = presetService.createPreset(
            body as Omit<ProcgenPreset, "id" | "createdAt" | "updatedAt">,
          );
          return { preset, message: "Preset created successfully" };
        },
        {
          body: CreatePresetSchema,
        },
      )

      // Update preset
      .put(
        "/presets/:id",
        ({ params, body, set }) => {
          const updated = presetService.updatePreset(params.id, body);
          if (!updated) {
            set.status = 404;
            return { error: "Preset not found" };
          }
          return { preset: updated, message: "Preset updated successfully" };
        },
        {
          params: t.Object({ id: t.String() }),
          body: t.Partial(CreatePresetSchema),
        },
      )

      // Delete preset
      .delete(
        "/presets/:id",
        ({ params, set }) => {
          const deleted = presetService.deletePreset(params.id);
          if (!deleted) {
            set.status = 404;
            return { error: "Preset not found" };
          }
          return { message: "Preset deleted successfully" };
        },
        {
          params: t.Object({ id: t.String() }),
        },
      )

      // Duplicate preset
      .post(
        "/presets/:id/duplicate",
        ({ params, body, set }) => {
          const duplicated = presetService.duplicatePreset(
            params.id,
            body.name,
          );
          if (!duplicated) {
            set.status = 404;
            return { error: "Preset not found" };
          }
          return {
            preset: duplicated,
            message: "Preset duplicated successfully",
          };
        },
        {
          params: t.Object({ id: t.String() }),
          body: t.Object({ name: t.String({ minLength: 1 }) }),
        },
      )

      // List generated assets
      .get(
        "/assets",
        ({ query }) => {
          const assets = presetService.listGeneratedAssets({
            presetId: query.presetId,
            category: query.category as ProcgenCategory | undefined,
          });
          return { assets, count: assets.length };
        },
        {
          query: t.Object({
            presetId: t.Optional(t.String()),
            category: t.Optional(PresetCategorySchema),
          }),
        },
      )

      // Record generated asset
      .post(
        "/assets",
        ({ body }) => {
          const asset = presetService.recordGeneratedAsset(body);
          return { asset, message: "Asset recorded successfully" };
        },
        {
          body: GeneratedAssetSchema,
        },
      )

      // Delete generated asset
      .delete(
        "/assets/:id",
        ({ params, query, set }) => {
          const deleteFiles = query.deleteFiles === "true";
          const deleted = presetService.deleteGeneratedAsset(
            params.id,
            deleteFiles,
          );
          if (!deleted) {
            set.status = 404;
            return { error: "Asset not found" };
          }
          return { message: "Asset deleted successfully" };
        },
        {
          params: t.Object({ id: t.String() }),
          query: t.Object({ deleteFiles: t.Optional(t.String()) }),
        },
      )

      // Generate batch seeds
      .post(
        "/batch/seeds",
        ({ body }) => {
          const seeds = presetService.generateBatchSeeds(
            body.baseSeed,
            body.count,
            body.step,
          );
          return { seeds, count: seeds.length };
        },
        {
          body: t.Object({
            baseSeed: t.Number(),
            count: t.Number({ minimum: 1, maximum: 100 }),
            step: t.Optional(t.Number({ minimum: 1 })),
          }),
        },
      )

      // Get output path for asset
      .post(
        "/path",
        ({ body }) => {
          const modelPath = presetService.getAssetOutputPath(
            body.category as ProcgenCategory,
            body.presetName,
            body.seed,
            body.extension,
          );
          const thumbnailPath = presetService.getThumbnailPath(
            body.category as ProcgenCategory,
            body.presetName,
            body.seed,
          );
          return { modelPath, thumbnailPath };
        },
        {
          body: t.Object({
            category: PresetCategorySchema,
            presetName: t.String(),
            seed: t.Number(),
            extension: t.Optional(t.String()),
          }),
        },
      )

      // Export manifest
      .get("/export", () => {
        const manifest = presetService.exportManifest();
        return { manifest };
      })

      // Import manifest
      .post(
        "/import",
        ({ body }) => {
          presetService.importManifest(body.manifest, body.merge ?? true);
          return { message: "Manifest imported successfully" };
        },
        {
          body: t.Object({
            manifest: t.Object({
              version: t.Optional(t.Number()),
              presets: t.Optional(
                t.Object({
                  trees: t.Optional(t.Array(t.Any())),
                  rocks: t.Optional(t.Array(t.Any())),
                  plants: t.Optional(t.Array(t.Any())),
                  buildings: t.Optional(t.Array(t.Any())),
                  terrain: t.Optional(t.Array(t.Any())),
                }),
              ),
              generatedAssets: t.Optional(t.Array(t.Any())),
            }),
            merge: t.Optional(t.Boolean()),
          }),
        },
      )
  );
};
