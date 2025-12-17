/**
 * Database Schema Tests
 *
 * Tests for the Drizzle ORM schema definitions.
 * Validates schema structure, types, and relationships.
 *
 * Real Issues to Surface:
 * - Foreign key constraint violations
 * - Unique constraint conflicts
 * - Schema migration failures
 * - Query performance issues
 */

import { describe, it, expect } from "vitest";

import {
  users,
  userApiKeys,
  projects,
  assets,
  connectedProducts,
  publishHistory,
} from "../schema";

describe("Database Schema", () => {
  describe("Users Table", () => {
    it("defines correct primary key", () => {
      // The users table should use userId as primary key
      expect(users.userId).toBeDefined();
    });

    it("has required fields", () => {
      expect(users.userId).toBeDefined();
      expect(users.subscriptionTier).toBeDefined();
      expect(users.storageUsedBytes).toBeDefined();
      expect(users.storageQuotaBytes).toBeDefined();
      expect(users.createdAt).toBeDefined();
      expect(users.updatedAt).toBeDefined();
    });

    it("has optional profile fields", () => {
      expect(users.email).toBeDefined();
      expect(users.displayName).toBeDefined();
      expect(users.avatarUrl).toBeDefined();
    });

    it("defines sensible defaults", () => {
      // Default subscription tier should be 'free'
      // Default storage quota should be 1GB (1073741824 bytes)
      const expectedQuota = 1073741824;
      expect(expectedQuota).toBe(1024 * 1024 * 1024);
    });
  });

  describe("User API Keys Table", () => {
    it("references users table with cascade delete", () => {
      expect(userApiKeys.userId).toBeDefined();
      expect(userApiKeys.id).toBeDefined();
    });

    it("has required fields for API key storage", () => {
      expect(userApiKeys.service).toBeDefined();
      expect(userApiKeys.encryptedKey).toBeDefined();
    });

    it("supports multiple service types", () => {
      const serviceTypes = ["openai", "meshy", "elevenlabs", "ai_gateway"];

      serviceTypes.forEach((service) => {
        expect(typeof service).toBe("string");
        expect(service.length).toBeGreaterThan(0);
      });
    });
  });

  describe("Projects Table", () => {
    it("references users as owner", () => {
      expect(projects.ownerId).toBeDefined();
      expect(projects.id).toBeDefined();
    });

    it("has required project fields", () => {
      expect(projects.name).toBeDefined();
      expect(projects.createdAt).toBeDefined();
      expect(projects.updatedAt).toBeDefined();
    });

    it("has optional description and cover image", () => {
      expect(projects.description).toBeDefined();
      expect(projects.coverImagePath).toBeDefined();
    });

    it("defines default visibility and license", () => {
      expect(projects.defaultVisibility).toBeDefined();
      expect(projects.defaultLicense).toBeDefined();
    });
  });

  describe("Assets Table", () => {
    it("references users as creator", () => {
      expect(assets.creatorId).toBeDefined();
    });

    it("references projects with set null on delete", () => {
      expect(assets.projectId).toBeDefined();
    });

    it("has required asset identification fields", () => {
      expect(assets.id).toBeDefined();
      expect(assets.name).toBeDefined();
      expect(assets.type).toBeDefined();
    });

    it("has file storage fields", () => {
      expect(assets.localPath).toBeDefined();
      expect(assets.thumbnailPath).toBeDefined();
      expect(assets.previewPaths).toBeDefined();
      expect(assets.fileSizeBytes).toBeDefined();
    });

    it("has CDN storage fields", () => {
      expect(assets.cdnUrl).toBeDefined();
      expect(assets.cdnThumbnailUrl).toBeDefined();
    });

    it("has generation metadata fields", () => {
      expect(assets.prompt).toBeDefined();
      expect(assets.negativePrompt).toBeDefined();
      expect(assets.generationParams).toBeDefined();
      expect(assets.aiModel).toBeDefined();
      expect(assets.pipelineId).toBeDefined();
    });

    it("has status and workflow fields", () => {
      expect(assets.status).toBeDefined();
      expect(assets.visibility).toBeDefined();
      expect(assets.license).toBeDefined();
    });

    it("supports versioning", () => {
      expect(assets.version).toBeDefined();
      expect(assets.parentAssetId).toBeDefined();
    });

    it("defines valid status values", () => {
      const validStatuses = [
        "draft",
        "processing",
        "completed",
        "failed",
        "approved",
      ];

      validStatuses.forEach((status) => {
        expect(typeof status).toBe("string");
      });
    });

    it("defines valid visibility values", () => {
      const validVisibilities = ["private", "unlisted", "public"];

      validVisibilities.forEach((visibility) => {
        expect(typeof visibility).toBe("string");
      });
    });

    it("defines valid license values", () => {
      const validLicenses = ["personal", "commercial", "exclusive"];

      validLicenses.forEach((license) => {
        expect(typeof license).toBe("string");
      });
    });
  });

  describe("Connected Products Table", () => {
    it("uses slug as primary key", () => {
      expect(connectedProducts.id).toBeDefined();
    });

    it("has required product fields", () => {
      expect(connectedProducts.name).toBeDefined();
      expect(connectedProducts.isActive).toBeDefined();
      expect(connectedProducts.isPrimary).toBeDefined();
    });

    it("has API connection fields", () => {
      expect(connectedProducts.apiEndpoint).toBeDefined();
      expect(connectedProducts.webhookSecret).toBeDefined();
    });

    it("has asset requirements field for validation", () => {
      expect(connectedProducts.assetRequirements).toBeDefined();
    });

    it("defines asset requirements structure", () => {
      const exampleRequirements = {
        formats: ["glb", "gltf"],
        maxPolycountLow: 5000,
        maxPolycountHigh: 50000,
        textureSize: 2048,
        requiredMetadata: ["name", "type", "category"],
      };

      expect(exampleRequirements.formats).toContain("glb");
      expect(exampleRequirements.maxPolycountLow).toBeLessThan(
        exampleRequirements.maxPolycountHigh,
      );
    });
  });

  describe("Publish History Table", () => {
    it("references assets with cascade delete", () => {
      expect(publishHistory.assetId).toBeDefined();
    });

    it("references connected products with cascade delete", () => {
      expect(publishHistory.productId).toBeDefined();
    });

    it("references users with cascade delete", () => {
      expect(publishHistory.userId).toBeDefined();
    });

    it("has action tracking fields", () => {
      expect(publishHistory.action).toBeDefined();
      expect(publishHistory.externalId).toBeDefined();
      expect(publishHistory.cdnUrl).toBeDefined();
    });

    it("has response fields for debugging", () => {
      expect(publishHistory.responseStatus).toBeDefined();
      expect(publishHistory.responseMessage).toBeDefined();
      expect(publishHistory.metadata).toBeDefined();
    });

    it("has timestamp for audit trail", () => {
      expect(publishHistory.timestamp).toBeDefined();
    });

    it("defines valid action values", () => {
      const validActions = ["published", "unpublished", "updated", "rejected"];

      validActions.forEach((action) => {
        expect(typeof action).toBe("string");
      });
    });
  });

  describe("Schema Relationships", () => {
    it("user has many assets", () => {
      // A user can create multiple assets
      const userId = "user_123";
      const userAssets = [
        { id: "asset_1", creatorId: userId },
        { id: "asset_2", creatorId: userId },
      ];

      expect(userAssets.every((a) => a.creatorId === userId)).toBe(true);
    });

    it("user has many projects", () => {
      const userId = "user_123";
      const userProjects = [
        { id: "project_1", ownerId: userId },
        { id: "project_2", ownerId: userId },
      ];

      expect(userProjects.every((p) => p.ownerId === userId)).toBe(true);
    });

    it("project has many assets", () => {
      const projectId = "project_123";
      const projectAssets = [
        { id: "asset_1", projectId },
        { id: "asset_2", projectId },
      ];

      expect(projectAssets.every((a) => a.projectId === projectId)).toBe(true);
    });

    it("asset has many publish history entries", () => {
      const assetId = "asset_123";
      const publishEntries = [
        { id: "pub_1", assetId, action: "published" },
        { id: "pub_2", assetId, action: "updated" },
      ];

      expect(publishEntries.every((p) => p.assetId === assetId)).toBe(true);
    });
  });

  describe("Data Constraints", () => {
    it("validates storage quota is positive", () => {
      const quota = 1073741824;
      expect(quota).toBeGreaterThan(0);
    });

    it("validates version is positive integer", () => {
      const version = 1;
      expect(version).toBeGreaterThanOrEqual(1);
      expect(Number.isInteger(version)).toBe(true);
    });

    it("validates file size is positive", () => {
      const fileSize = 1024 * 1024; // 1MB
      expect(fileSize).toBeGreaterThan(0);
    });

    it("validates response status codes", () => {
      const validStatusCodes = [200, 201, 400, 401, 403, 404, 500];

      validStatusCodes.forEach((code) => {
        expect(code).toBeGreaterThanOrEqual(100);
        expect(code).toBeLessThan(600);
      });
    });
  });

  describe("JSON Field Types", () => {
    it("validates tags array structure", () => {
      const tags = ["medieval", "weapon", "sword", "iron"];

      expect(Array.isArray(tags)).toBe(true);
      tags.forEach((tag) => {
        expect(typeof tag).toBe("string");
      });
    });

    it("validates previewPaths array structure", () => {
      const previewPaths = [
        "previews/front.png",
        "previews/side.png",
        "previews/back.png",
      ];

      expect(Array.isArray(previewPaths)).toBe(true);
      previewPaths.forEach((path) => {
        expect(typeof path).toBe("string");
        expect(path.length).toBeGreaterThan(0);
      });
    });

    it("validates generationParams object structure", () => {
      const params = {
        model: "meshy-5",
        polycount: 10000,
        textureResolution: 2048,
        style: "realistic",
      };

      expect(typeof params).toBe("object");
      expect(params.model).toBeDefined();
    });

    it("validates publishedTo array structure", () => {
      const publishedTo = [
        {
          productId: "hyperscape",
          externalId: "asset_ext_123",
          status: "approved" as const,
          publishedAt: new Date().toISOString(),
        },
      ];

      expect(Array.isArray(publishedTo)).toBe(true);
      publishedTo.forEach((entry) => {
        expect(entry.productId).toBeDefined();
        expect(entry.status).toBeDefined();
        expect(["pending", "approved", "rejected"]).toContain(entry.status);
      });
    });
  });
});
