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

/** List of manifest files to fetch from CDN */
const MANIFEST_FILES = [
  "items.json",
  "npcs.json",
  "resources.json",
  "tools.json",
  "biomes.json",
  "world-areas.json",
  "stores.json",
  "music.json",
  "vegetation.json",
  "buildings.json",
];

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
  // In development, skip if local manifests already exist (dev may have local assets)
  if (nodeEnv === "development") {
    const existingFiles = await fs.readdir(manifestsDir).catch(() => []);
    if (existingFiles.length > 0) {
      console.log(
        `[Config] ⏭️  Skipping CDN fetch in development - ${existingFiles.length} local manifests found`,
      );
      return;
    }
  }

  console.log(`[Config] 📥 Fetching manifests from CDN: ${cdnUrl}`);
  const baseUrl = cdnUrl.endsWith("/") ? cdnUrl : `${cdnUrl}/`;

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

  // Fail if no manifests could be fetched and none exist locally
  if (fetched === 0) {
    const existingFiles = await fs.readdir(manifestsDir).catch(() => []);
    if (existingFiles.length === 0) {
      throw new Error(
        `Failed to fetch any manifests from CDN (${cdnUrl}) and no local manifests exist`,
      );
    }
    console.warn(
      `[Config] ⚠️  Using ${existingFiles.length} existing local manifests`,
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
