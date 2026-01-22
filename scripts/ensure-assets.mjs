#!/usr/bin/env node
/**
 * Ensure Assets Script (Local Development Only)
 *
 * Downloads game assets for local development. In production and CI,
 * assets are served from CDN (https://d20g7vd4m53hpb.cloudfront.net).
 *
 * Behavior:
 * - CI/Production: Skip - assets come from CDN
 * - Development: If /packages/server/world/assets/ is empty → clone from GitHub
 *
 * Note: The server fetches manifests from CDN at startup. This script is only
 * needed for local development with full assets (models, audio, textures).
 */

import { existsSync, readdirSync } from "fs";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");
const assetsDir = path.join(rootDir, "packages/server/world/assets");
const assetsRepo = "https://github.com/HyperscapeAI/assets.git";

// CDN URL for production assets
const CDN_URL = "https://d20g7vd4m53hpb.cloudfront.net";

function hasContent(dir) {
  if (!existsSync(dir)) return false;
  try {
    const files = readdirSync(dir);
    // Ignore hidden files like .gitkeep
    return files.some((f) => !f.startsWith("."));
  } catch {
    return false;
  }
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

Note: In CI/production, assets are served from CDN: ${CDN_URL}
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
  // Assets are served from CDN, manifests fetched at server startup
  if (isCI()) {
    console.log("⏭️  Skipping asset download (CI/production environment)");
    console.log(`   Assets served from CDN: ${CDN_URL}`);
    console.log("   Manifests fetched at server startup");
    return;
  }

  if (hasContent(assetsDir)) {
    console.log("✅ Assets already present");
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
  console.log(`   (Production uses CDN: ${CDN_URL})`);

  try {
    // Ensure parent directory exists
    const parentDir = path.dirname(assetsDir);
    if (!existsSync(parentDir)) {
      execSync(`mkdir -p "${parentDir}"`, { stdio: "inherit" });
    }

    // Clone with depth 1 for faster download (keep .git for future syncs)
    execSync(`git clone --depth 1 ${assetsRepo} "${assetsDir}"`, {
      stdio: "inherit",
      cwd: rootDir,
    });

    console.log("✅ Assets downloaded successfully!");
    console.log("   Run 'bun run assets:sync' to update assets later");
  } catch (error) {
    console.error("❌ Failed to download assets:", error.message);
    console.error("   You can manually clone:");
    console.error(`   git clone ${assetsRepo} ${assetsDir}`);
    process.exit(1);
  }
}

main();
