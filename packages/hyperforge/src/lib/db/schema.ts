/**
 * Hyperforge Database Schema
 * Uses PostgreSQL with a separate "hyperforge" schema to avoid conflicts with game tables
 */

import {
  pgSchema,
  text,
  integer,
  timestamp,
  boolean,
  jsonb,
  bigint,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// Create a separate schema to isolate HyperForge tables from the game
export const hyperforgeSchema = pgSchema("hyperforge");

// ============================================================================
// USERS - Creator profiles linked to Privy auth
// ============================================================================

export const users = hyperforgeSchema.table("users", {
  // Primary key from Privy (shared identity across products)
  userId: text("user_id").primaryKey(),

  // Profile info
  email: text("email"),
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),

  // Subscription & limits
  subscriptionTier: text("subscription_tier").notNull().default("free"), // free | pro | studio
  storageUsedBytes: bigint("storage_used_bytes", { mode: "number" })
    .notNull()
    .default(0),
  storageQuotaBytes: bigint("storage_quota_bytes", { mode: "number" })
    .notNull()
    .default(1073741824), // 1GB default

  // Timestamps
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const usersRelations = relations(users, ({ many }) => ({
  assets: many(assets),
  projects: many(projects),
  apiKeys: many(userApiKeys),
}));

// ============================================================================
// USER API KEYS - Encrypted storage for user's AI service keys
// ============================================================================

export const userApiKeys = hyperforgeSchema.table("user_api_keys", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id")
    .notNull()
    .references(() => users.userId, { onDelete: "cascade" }),

  // Key identification
  service: text("service").notNull(), // openai | meshy | elevenlabs | ai_gateway
  keyName: text("key_name"), // User-friendly name

  // Encrypted key value (encrypt before storing!)
  encryptedKey: text("encrypted_key").notNull(),

  // Metadata
  lastUsedAt: timestamp("last_used_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const userApiKeysRelations = relations(userApiKeys, ({ one }) => ({
  user: one(users, {
    fields: [userApiKeys.userId],
    references: [users.userId],
  }),
}));

// ============================================================================
// PROJECTS - Grouping/workspace for assets
// ============================================================================

export const projects = hyperforgeSchema.table("projects", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.userId, { onDelete: "cascade" }),

  // Project info
  name: text("name").notNull(),
  description: text("description"),
  coverImagePath: text("cover_image_path"),

  // Settings
  defaultVisibility: text("default_visibility").notNull().default("private"),
  defaultLicense: text("default_license").notNull().default("personal"),

  // Timestamps
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const projectsRelations = relations(projects, ({ one, many }) => ({
  owner: one(users, {
    fields: [projects.ownerId],
    references: [users.userId],
  }),
  assets: many(assets),
}));

// ============================================================================
// ASSETS - Created assets with generation metadata
// ============================================================================

export const assets = hyperforgeSchema.table("assets", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  creatorId: text("creator_id")
    .notNull()
    .references(() => users.userId, { onDelete: "cascade" }),
  projectId: text("project_id").references(() => projects.id, {
    onDelete: "set null",
  }),

  // Asset identification
  name: text("name").notNull(),
  description: text("description"),
  type: text("type").notNull(), // character | item | environment | equipment | weapon | armor
  category: text("category"), // Sub-category
  tags: jsonb("tags").$type<string[]>().default([]),

  // File storage (local paths)
  localPath: text("local_path"), // Primary model file
  thumbnailPath: text("thumbnail_path"),
  previewPaths: jsonb("preview_paths").$type<string[]>(),
  fileSizeBytes: bigint("file_size_bytes", { mode: "number" }),

  // CDN storage (after publish)
  cdnUrl: text("cdn_url"),
  cdnThumbnailUrl: text("cdn_thumbnail_url"),

  // Generation metadata
  prompt: text("prompt"),
  negativePrompt: text("negative_prompt"),
  generationParams: jsonb("generation_params").$type<Record<string, unknown>>(),
  aiModel: text("ai_model"), // Model used for generation
  pipelineId: text("pipeline_id"), // Reference to generation pipeline

  // Status & workflow
  status: text("status").notNull().default("draft"), // draft | processing | completed | failed | approved
  visibility: text("visibility").notNull().default("private"), // private | unlisted | public
  license: text("license").notNull().default("personal"), // personal | commercial | exclusive

  // Multi-product publishing
  publishedTo: jsonb("published_to").$type<
    Array<{
      productId: string;
      externalId: string;
      status: "pending" | "approved" | "rejected";
      publishedAt: string;
    }>
  >(),

  // Versioning
  version: integer("version").notNull().default(1),
  parentAssetId: text("parent_asset_id"),

  // Timestamps
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const assetsRelations = relations(assets, ({ one, many }) => ({
  creator: one(users, {
    fields: [assets.creatorId],
    references: [users.userId],
  }),
  project: one(projects, {
    fields: [assets.projectId],
    references: [projects.id],
  }),
  publishHistory: many(publishHistory),
}));

// ============================================================================
// CONNECTED PRODUCTS - Registry of products that can receive assets
// ============================================================================

export const connectedProducts = hyperforgeSchema.table("connected_products", {
  id: text("id").primaryKey(), // Slug: "hyperscape", "future-game"
  name: text("name").notNull(),
  description: text("description"),
  iconUrl: text("icon_url"),

  // API connection
  apiEndpoint: text("api_endpoint"), // Webhook URL for publishing
  webhookSecret: text("webhook_secret"), // HMAC secret for verification

  // Asset requirements
  assetRequirements: jsonb("asset_requirements").$type<{
    formats: string[];
    maxPolycountLow: number;
    maxPolycountHigh: number;
    textureSize: number;
    requiredMetadata: string[];
  }>(),

  // Status
  isActive: boolean("is_active").notNull().default(true),
  isPrimary: boolean("is_primary").notNull().default(false), // Hyperscape = primary

  // Timestamps
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const connectedProductsRelations = relations(
  connectedProducts,
  ({ many }) => ({
    publishHistory: many(publishHistory),
  }),
);

// ============================================================================
// PUBLISH HISTORY - Audit log of all publishing actions
// ============================================================================

export const publishHistory = hyperforgeSchema.table("publish_history", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  assetId: text("asset_id")
    .notNull()
    .references(() => assets.id, { onDelete: "cascade" }),
  productId: text("product_id")
    .notNull()
    .references(() => connectedProducts.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.userId, { onDelete: "cascade" }),

  // Action details
  action: text("action").notNull(), // published | unpublished | updated | rejected
  externalId: text("external_id"), // ID in target product's database
  cdnUrl: text("cdn_url"), // CDN URL at time of publish

  // Response from target product
  responseStatus: integer("response_status"),
  responseMessage: text("response_message"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),

  // Timestamp
  timestamp: timestamp("timestamp").notNull().defaultNow(),
});

export const publishHistoryRelations = relations(publishHistory, ({ one }) => ({
  asset: one(assets, {
    fields: [publishHistory.assetId],
    references: [assets.id],
  }),
  product: one(connectedProducts, {
    fields: [publishHistory.productId],
    references: [connectedProducts.id],
  }),
  user: one(users, {
    fields: [publishHistory.userId],
    references: [users.userId],
  }),
}));

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type UserApiKey = typeof userApiKeys.$inferSelect;
export type NewUserApiKey = typeof userApiKeys.$inferInsert;

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;

export type Asset = typeof assets.$inferSelect;
export type NewAsset = typeof assets.$inferInsert;

export type ConnectedProduct = typeof connectedProducts.$inferSelect;
export type NewConnectedProduct = typeof connectedProducts.$inferInsert;

export type PublishHistoryEntry = typeof publishHistory.$inferSelect;
export type NewPublishHistoryEntry = typeof publishHistory.$inferInsert;
