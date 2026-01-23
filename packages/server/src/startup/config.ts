/**
 * Configuration Module - Environment and path resolution
 *
 * Centralizes all environment variable loading and path resolution for the server.
 * Ensures consistent configuration across all server modules.
 *
 * Responsibilities:
 * - Load environment variables from .env files
 * - Resolve file paths for assets, world data, and build outputs
 * - Create necessary directories
 * - Fetch manifests from CDN at startup
 * - Export typed configuration object
 *
 * Usage:
 * ```typescript
 * const config = await loadConfig();
 * console.log(config.port, config.worldDir, config.assetsDir);
 * ```
 */

import dotenv from "dotenv";
import fs from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";

/**
 * List of manifest files to fetch from CDN
 * Includes root-level files and subdirectory files (items/, gathering/, recipes/)
 */
const MANIFEST_FILES = [
  // Root-level manifests
  "biomes.json",
  "buildings.json",
  // Legacy single-file items (backwards compatibility)
  "items.json",
  "model-bounds.json",
  "music.json",
  "npcs.json",
  "prayers.json",
  // Legacy single-file gathering/resources (backwards compatibility)
  "resources.json",
  "skill-unlocks.json",
  "stations.json",
  "stores.json",
  "tier-requirements.json",
  "tools.json",
  "vegetation.json",
  "world-areas.json",
  // Items directory
  "items/food.json",
  "items/misc.json",
  "items/resources.json",
  "items/tools.json",
  "items/weapons.json",
  // Gathering directory
  "gathering/fishing.json",
  "gathering/mining.json",
  "gathering/woodcutting.json",
  // Recipes directory
  "recipes/cooking.json",
  "recipes/firemaking.json",
  "recipes/smelting.json",
  "recipes/smithing.json",
];

/**
 * Determine which REQUIRED manifests are missing locally.
 *
 * These are the minimum files needed for server startup (DataManager).
 * Other manifests are optional and have sensible fallbacks.
 */
async function getMissingRequiredManifests(
  manifestsDir: string,
): Promise<string[]> {
  const requiredRootFiles = [
    "npcs.json",
    "world-areas.json",
    "biomes.json",
    "stores.json",
  ] as const;

  const missing: string[] = [];

  for (const file of requiredRootFiles) {
    const exists = await fs.pathExists(path.join(manifestsDir, file));
    if (!exists) {
      missing.push(file);
    }
  }

  // Items manifest: either legacy single file OR the full category directory set
  const hasItemsJson = await fs.pathExists(
    path.join(manifestsDir, "items.json"),
  );

  const requiredItemCategoryFiles = [
    "weapons",
    "tools",
    "resources",
    "food",
    "misc",
  ] as const;

  let hasAllItemCategoryFiles = true;
  for (const file of requiredItemCategoryFiles) {
    const exists = await fs.pathExists(
      path.join(manifestsDir, "items", `${file}.json`),
    );
    if (!exists) {
      hasAllItemCategoryFiles = false;
    }
  }

  if (!hasItemsJson && !hasAllItemCategoryFiles) {
    missing.push(
      "items.json or items/{weapons,tools,resources,food,misc}.json",
    );
  }

  return missing;
}

function isLocalhostUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname === "localhost" ||
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "0.0.0.0"
    );
  } catch {
    // If URL parsing fails, treat as non-localhost to avoid surprising fallbacks
    return false;
  }
}

/**
 * Server configuration interface
 * Contains all paths, ports, and settings needed by server modules
 */
export interface ServerConfig {
  /** Server HTTP port */
  port: number;

  /** World data directory path */
  worldDir: string;

  /** Assets directory path (models, music, textures) */
  assetsDir: string;

  /** Manifests directory path (fetched from CDN) */
  manifestsDir: string;

  /** Hyperscape root directory */
  hyperscapeRoot: string;

  /** Built-in assets directory */
  builtInAssetsDir: string;

  /** Package root directory (for public/ and world/ access) */
  __dirname: string;

  /** Use local PostgreSQL via Docker */
  useLocalPostgres: boolean;

  /** Explicit database URL (overrides Docker) */
  databaseUrl?: string;

  /** CDN base URL for assets */
  cdnUrl: string;

  /** Assets URL (CDN + trailing slash) */
  assetsUrl: string;

  /** System plugins path */
  systemsPath?: string;

  /** Admin code for protected endpoints */
  adminCode?: string;

  /** JWT secret for token signing */
  jwtSecret?: string;

  /** Auto-save interval in seconds */
  saveInterval: number;

  /** Node environment */
  nodeEnv: string;

  /** Commit hash for deployment tracking */
  commitHash?: string;
}

/**
 * Fetch manifests from CDN and cache locally
 *
 * Downloads all manifest JSON files from the CDN and saves them to the local
 * manifests directory. Compares with existing files to avoid unnecessary updates
 * and ensure cache freshness.
 *
 * @param cdnUrl - Base CDN URL
 * @param manifestsDir - Local directory to cache manifests
 * @param nodeEnv - Current environment (development/production)
 */
async function fetchManifestsFromCDN(
  cdnUrl: string,
  manifestsDir: string,
  nodeEnv: string,
): Promise<void> {
  // In development, skip CDN fetch only if REQUIRED local manifests already exist.
  // This preserves local asset editing while preventing partial-cache startup failures.
  if (nodeEnv === "development") {
    const missingRequired = await getMissingRequiredManifests(manifestsDir);
    if (missingRequired.length === 0) {
      const existingFiles = await fs.readdir(manifestsDir).catch(() => []);
      console.log(
        `[Config] ⏭️  Skipping CDN fetch in development - required local manifests found (${existingFiles.length} file(s))`,
      );
      return;
    }
    console.log(
      `[Config] 📦 Local manifests incomplete (${missingRequired.join(", ")}). Fetching from CDN...`,
    );
  }

  const fetchFrom = async (sourceCdnUrl: string): Promise<void> => {
    console.log(`[Config] 📥 Fetching manifests from CDN: ${sourceCdnUrl}`);
    const baseUrl = sourceCdnUrl.endsWith("/")
      ? sourceCdnUrl
      : `${sourceCdnUrl}/`;

    let fetched = 0;
    let updated = 0;
    let failed = 0;

    for (const file of MANIFEST_FILES) {
      const url = `${baseUrl}manifests/${file}`;
      const localPath = path.join(manifestsDir, file);

      try {
        const response = await fetch(url);
        if (!response.ok) {
          console.warn(`[Config] ⚠️  ${file}: HTTP ${response.status}`);
          failed++;
          continue;
        }

        const newContent = await response.text();
        fetched++;

        // Ensure subdirectory exists for nested files (items/, gathering/, recipes/)
        const localDir = path.dirname(localPath);
        await fs.ensureDir(localDir);

        // Compare with existing file to check if update needed
        let existingContent = "";
        try {
          existingContent = await fs.readFile(localPath, "utf-8");
        } catch {
          // File doesn't exist, will be created
        }

        // Only write if content changed (avoids unnecessary disk writes)
        if (newContent !== existingContent) {
          await fs.writeFile(localPath, newContent, "utf-8");
          updated++;
          console.log(`[Config] ✅ ${file} updated`);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[Config] ⚠️  Failed to fetch ${file}: ${message}`);
        failed++;
      }
    }

    console.log(
      `[Config] 📦 Manifests: ${fetched} fetched, ${updated} updated, ${failed} failed`,
    );
  };

  // First attempt: fetch from configured CDN URL
  await fetchFrom(cdnUrl);

  // Validate required manifests exist after fetch
  let missingRequiredAfter = await getMissingRequiredManifests(manifestsDir);

  // Development convenience: if configured CDN is localhost and required manifests are still missing,
  // fall back to the production assets CDN to bootstrap local manifests.
  if (
    nodeEnv === "development" &&
    missingRequiredAfter.length > 0 &&
    isLocalhostUrl(cdnUrl)
  ) {
    const fallbackCdnUrl = "https://assets.hyperscape.club";
    console.warn(
      `[Config] ⚠️  Required manifests still missing after fetching from ${cdnUrl}: ${missingRequiredAfter.join(", ")}.`,
    );
    console.warn(
      `[Config] 💡 Falling back to production CDN for manifests: ${fallbackCdnUrl}`,
    );
    await fetchFrom(fallbackCdnUrl);
    missingRequiredAfter = await getMissingRequiredManifests(manifestsDir);
  }

  if (missingRequiredAfter.length > 0) {
    // In TEST environments, allow starting without manifests
    if (nodeEnv === "test" || process.env.SKIP_MANIFESTS === "true") {
      console.warn(
        `[Config] ⚠️  Required manifests missing - running in minimal mode (test)`,
      );
      console.warn(`[Config] Missing: ${missingRequiredAfter.join(", ")}`);
      return;
    }

    throw new Error(
      `Missing required manifests in ${manifestsDir}: ${missingRequiredAfter.join(", ")}. ` +
        `Ensure your CDN has /manifests populated (PUBLIC_CDN_URL=${cdnUrl}) or run 'bun install' to download assets for local development.`,
    );
  }
}

/**
 * Load and validate server configuration
 *
 * Loads environment variables from multiple locations (workspace root, parent dirs),
 * resolves all necessary paths, creates directories, and fetches manifests from CDN.
 *
 * @returns Promise resolving to complete server configuration
 * @throws Error if critical directories cannot be created
 */
export async function loadConfig(): Promise<ServerConfig> {
  // Load environment variables from multiple possible locations
  // Priority: local .env > parent .env > workspace root .env
  dotenv.config({ path: ".env" });
  dotenv.config({ path: "../../../.env" }); // Root workspace .env
  dotenv.config({ path: "../../.env" }); // Parent directory .env

  // ES module equivalent of __dirname
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  // Resolve paths correctly for both dev and build
  // Built: __dirname is .../packages/server/dist (single bundled file) → go up 1 level
  // Dev: __dirname is .../packages/server/src/startup → go up 2 levels
  let hyperscapeRoot: string;
  if (
    __dirname.endsWith("/dist") ||
    __dirname.includes("/dist/") ||
    __dirname.endsWith("/build") ||
    __dirname.includes("/build/")
  ) {
    // Built version: bundled to dist/index.js, go up 1 level to packages/server/
    hyperscapeRoot = path.join(__dirname, "..");
  } else if (__dirname.includes("/server/src/")) {
    // Dev version: go up from server/src/startup/ to packages/server/
    hyperscapeRoot = path.join(__dirname, "../..");
  } else {
    // Fallback: assume we're 1 level deep (like dist/ or build/)
    hyperscapeRoot = path.join(__dirname, "..");
  }

  // Environment variables with defaults
  const WORLD = process.env["WORLD"] || "world";
  const PORT = parseInt(process.env["PORT"] || "5555", 10);
  const USE_LOCAL_POSTGRES =
    (process.env["USE_LOCAL_POSTGRES"] || "true") === "true";
  const DATABASE_URL = process.env["DATABASE_URL"];
  const CDN_URL = process.env["PUBLIC_CDN_URL"] || "http://localhost:8080";
  const SYSTEMS_PATH = process.env["SYSTEMS_PATH"];
  const ADMIN_CODE = process.env["ADMIN_CODE"];
  const JWT_SECRET = process.env["JWT_SECRET"];
  const SAVE_INTERVAL = parseInt(process.env["SAVE_INTERVAL"] || "60", 10);
  const NODE_ENV = process.env["NODE_ENV"] || "development";
  const COMMIT_HASH = process.env["COMMIT_HASH"];

  // Resolve world and assets directories
  const worldDir = path.isAbsolute(WORLD)
    ? WORLD
    : path.join(hyperscapeRoot, WORLD);

  // Manifests directory - local cache for CDN-fetched manifests
  const manifestsDir = path.join(hyperscapeRoot, "world/assets/manifests");

  // Use root assets directory (not per-world assets)
  // This is the main assets folder at workspace root: /assets/
  const workspaceRoot = path.resolve(hyperscapeRoot, "../..");
  const assetsDir = path.join(workspaceRoot, "assets");
  const builtInAssetsDir = path.join(hyperscapeRoot, "src/world/assets");

  // Create world and manifests folders if needed
  await fs.ensureDir(worldDir);
  await fs.ensureDir(manifestsDir);

  // Construct assets URL with trailing slash
  const assetsUrl = CDN_URL.endsWith("/") ? CDN_URL : `${CDN_URL}/`;

  // Fetch manifests from CDN at startup (production and CI)
  // Skip in development if manifests already exist locally
  await fetchManifestsFromCDN(CDN_URL, manifestsDir, NODE_ENV);

  return {
    port: PORT,
    worldDir,
    assetsDir,
    manifestsDir,
    hyperscapeRoot,
    builtInAssetsDir,
    __dirname: hyperscapeRoot, // Package root (for public/ access)
    useLocalPostgres: USE_LOCAL_POSTGRES,
    databaseUrl: DATABASE_URL,
    cdnUrl: CDN_URL,
    assetsUrl,
    systemsPath: SYSTEMS_PATH,
    adminCode: ADMIN_CODE,
    jwtSecret: JWT_SECRET,
    saveInterval: SAVE_INTERVAL,
    nodeEnv: NODE_ENV,
    commitHash: COMMIT_HASH,
  };
}

/**
 * Get public environment variables for client
 *
 * Filters all environment variables starting with PUBLIC_ and returns them
 * as a record. Used by /env.js endpoint to expose config to the client.
 *
 * @returns Record of public environment variables
 */
export function getPublicEnvs(): Record<string, string> {
  const publicEnvs: Record<string, string> = {};

  for (const key in process.env) {
    if (key.startsWith("PUBLIC_")) {
      const value = process.env[key];
      if (value) {
        publicEnvs[key] = value;
      }
    }
  }

  return publicEnvs;
}
// Deploy trigger: 1769051068
