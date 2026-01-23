#!/usr/bin/env node
/**
 * Ensure Assets Script (Local Development Only)
 *
 * Downloads game assets for local development. In CI/production,
 * manifests are committed to the repo and don't need to be fetched.
 *
 * Behavior:
 * - CI/Production: Skip - manifests are in the repo
 * - Development: If /packages/server/world/assets/ is empty → clone from GitHub
 *
 * Note: Manifests are committed to the repo. This script is only
 * needed for local development with full assets (models, audio, textures).
 */

import { existsSync, readdirSync, rmSync, mkdirSync } from "fs";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");
const assetsDir = path.join(rootDir, "packages/server/world/assets");
const assetsRepo = "https://github.com/HyperscapeAI/assets.git";

// Local CDN URL for development
const LOCAL_CDN_URL = "http://localhost:8080";

function dirHasNonHiddenFiles(dir) {
  if (!existsSync(dir)) return false;
  try {
    const files = readdirSync(dir);
    return files.some((f) => !f.startsWith("."));
  } catch {
    return false;
  }
}

function hasFullAssets(dir) {
  // IMPORTANT:
  // The repo may contain a local manifests cache (manifests/) and PhysX runtime (web/),
  // but local development also needs the full binary assets (world/, models/, audio/, etc).
  //
  // Treat manifests-only as "missing" so we auto-download real assets.
  const hasWorld = dirHasNonHiddenFiles(path.join(dir, "world"));
  const hasModels = dirHasNonHiddenFiles(path.join(dir, "models"));
  return hasWorld && hasModels;
}

function isGitRepo(dir) {
  return existsSync(path.join(dir, ".git"));
}

function checkGitLfs() {
  try {
    execSync("git lfs version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function printLfsInstallInstructions() {
  console.error(`
⚠️  Git LFS is required for game assets (local development only)

Install it for your platform:
  macOS:   brew install git-lfs
  Ubuntu:  sudo apt install git-lfs
  Windows: Download from https://git-lfs.com

Then re-run:
  bun install

Note: In CI/production, manifests are committed to the repo.
`);
}

function isCI() {
  // Check for common CI/deployment environment variables
  return !!(
    process.env.CI ||
    process.env.RAILWAY_ENVIRONMENT ||
    process.env.RAILWAY_SERVICE_ID ||
    process.env.VERCEL ||
    process.env.NETLIFY ||
    process.env.GITHUB_ACTIONS ||
    process.env.GITLAB_CI ||
    process.env.CIRCLECI ||
    process.env.DOCKER_BUILD ||
    process.env.SKIP_ASSETS
  );
}

async function main() {
  console.log("📦 Checking game assets...");

  // Skip asset download in CI/production environments
  // Manifests are committed to the repo
  if (isCI()) {
    console.log("⏭️  Skipping asset download (CI/production environment)");
    console.log("   Manifests are committed to the repo");
    return;
  }

  if (hasFullAssets(assetsDir)) {
    console.log("✅ Assets already present (full asset pack found)");
    // Ensure LFS objects are present if this is a git repo (safe no-op if up-to-date)
    if (isGitRepo(assetsDir)) {
      try {
        execSync(`git -C "${assetsDir}" lfs pull`, { stdio: "ignore" });
      } catch {
        // Non-fatal: some environments may not have LFS filters configured
      }
    }
    return;
  }

  // Check for git-lfs before attempting download
  if (!checkGitLfs()) {
    printLfsInstallInstructions();
    process.exit(1);
  }

  // Initialize git-lfs (safe to run multiple times, ignore errors if already set up)
  try {
    execSync("git lfs install", { stdio: "ignore" });
  } catch {
    // May fail if already initialized - that's ok
  }

  console.log("📥 Downloading game assets for local development (~200MB)...");
  console.log(`   From: ${assetsRepo}`);
  console.log(`   To: ${assetsDir}`);

  try {
    // Ensure parent directory exists
    const parentDir = path.dirname(assetsDir);
    mkdirSync(parentDir, { recursive: true });

    // If we have a partial/manifest-only directory, remove it so clone succeeds.
    // (This directory is intentionally gitignored in the main repo.)
    if (existsSync(assetsDir) && !isGitRepo(assetsDir)) {
      console.log("🧹 Removing partial assets directory (manifests-only)...");
      rmSync(assetsDir, { recursive: true, force: true });
    }

    // Clone with depth 1 for faster download (keep .git for future syncs)
    execSync(`git clone --depth 1 ${assetsRepo} "${assetsDir}"`, {
      stdio: "inherit",
      cwd: rootDir,
    });

    // Ensure large binary assets are downloaded
    execSync(`git -C "${assetsDir}" lfs pull`, { stdio: "inherit" });

    console.log("✅ Assets downloaded successfully!");
    console.log("   Run 'bun run assets:sync' to update assets later");
  } catch (error) {
    console.error("❌ Failed to download assets:", error);
    console.error("   You can manually clone:");
    console.error(`   git clone ${assetsRepo} ${assetsDir}`);
    process.exit(1);
  }
}

main();
