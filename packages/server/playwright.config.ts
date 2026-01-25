import { defineConfig } from "@playwright/test";
import dotenv from "dotenv";
import path from "path";

const configDir = process.cwd();
const repoRoot = path.resolve(configDir, "..", "..");
dotenv.config({ path: path.join(repoRoot, ".env") });
dotenv.config({ path: path.join(configDir, ".env") });

const parseOptionalNumber = (value?: string): number | undefined => {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const serverPort =
  parseOptionalNumber(process.env.PLAYWRIGHT_SERVER_PORT) ?? 5555;
const reuseExistingServer =
  process.env.PLAYWRIGHT_REUSE_EXISTING_SERVER === "true" || !process.env.CI;
const offlineMode =
  process.env.PLAYWRIGHT_OFFLINE === "1" ||
  process.env.PLAYWRIGHT_OFFLINE === "true";
const testCdnUrl =
  process.env.PLAYWRIGHT_CDN_URL ||
  `http://localhost:${serverPort}/game-assets`;
const testMatch = offlineMode
  ? ["**/terrain-island.spec.ts"]
  : ["**/*.spec.ts"];

export default defineConfig({
  testDir: "./tests",
  testMatch,
  timeout: 120000, // 2 minutes per test
  expect: {
    timeout: 10000,
  },
  fullyParallel: false, // Run tests sequentially to avoid port conflicts
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { outputFolder: "playwright-report" }]],
  use: {
    trace: "on-first-retry",
    launchOptions: {
      args: [
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
      ],
    },
  },
  // Auto-start server before tests and shut down after
  webServer: offlineMode
    ? undefined
    : {
        command: "bun run start",
        port: serverPort,
        timeout: 120 * 1000, // 2 minutes to start
        reuseExistingServer,
        env: {
          NODE_ENV: "test",
          PUBLIC_CDN_URL: testCdnUrl,
          ...(process.env.DATABASE_URL && {
            DATABASE_URL: process.env.DATABASE_URL,
          }),
          ...(process.env.USE_LOCAL_POSTGRES && {
            USE_LOCAL_POSTGRES: process.env.USE_LOCAL_POSTGRES,
          }),
          ...(process.env.POSTGRES_CONTAINER && {
            POSTGRES_CONTAINER: process.env.POSTGRES_CONTAINER,
          }),
          ...(process.env.POSTGRES_USER && {
            POSTGRES_USER: process.env.POSTGRES_USER,
          }),
          ...(process.env.POSTGRES_PASSWORD && {
            POSTGRES_PASSWORD: process.env.POSTGRES_PASSWORD,
          }),
          ...(process.env.POSTGRES_DB && {
            POSTGRES_DB: process.env.POSTGRES_DB,
          }),
          ...(process.env.POSTGRES_PORT && {
            POSTGRES_PORT: process.env.POSTGRES_PORT,
          }),
          ...(process.env.LIVEKIT_URL &&
            process.env.LIVEKIT_API_KEY &&
            process.env.LIVEKIT_API_SECRET && {
              LIVEKIT_URL: process.env.LIVEKIT_URL,
              LIVEKIT_API_KEY: process.env.LIVEKIT_API_KEY,
              LIVEKIT_API_SECRET: process.env.LIVEKIT_API_SECRET,
            }),
          // In CI, disable Docker and explicitly pass DATABASE_URL
          // Also set CDN to server's own port (5555) since no external CDN is running
          // Locally, allow Docker to be used (default behavior)
          ...(process.env.CI && {
            USE_LOCAL_POSTGRES: "false",
            DATABASE_URL:
              process.env.DATABASE_URL ||
              "postgresql://hyperscape:hyperscape_test@localhost:5432/hyperscape_test",
            PUBLIC_CDN_URL: "http://localhost:5555/game-assets",
          }),
        },
      },
});
