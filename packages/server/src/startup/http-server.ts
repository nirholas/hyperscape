/**
 * HTTP Server Module - Fastify setup and static file serving
 *
 * Configures and initializes the Fastify HTTP server with all necessary
 * middleware, static file serving, CORS, WebSocket support, and proper
 * caching headers for production performance.
 *
 * Responsibilities:
 * - Create Fastify instance with logging
 * - Configure CORS for development and production
 * - Set up static file serving (public/, assets/, world/)
 * - Configure proper MIME types and caching headers
 * - Handle index.html for SPA routing
 * - Register multipart and WebSocket plugins
 * - Set up error handlers
 *
 * Usage:
 * ```typescript
 * const fastify = await createHttpServer(config);
 * // Register routes...
 * await fastify.listen({ port: config.port, host: '0.0.0.0' });
 * ```
 */

import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import statics from "@fastify/static";
import fastifyWebSocket from "@fastify/websocket";
import Fastify, {
  type FastifyInstance,
  type FastifyRequest,
  type FastifyReply,
} from "fastify";
import fs from "fs-extra";
import path from "path";
import type { ServerConfig } from "./config.js";
import {
  getGlobalRateLimit,
  isRateLimitEnabled,
} from "../infrastructure/rate-limit/rate-limit-config.js";

/**
 * Create and configure Fastify HTTP server
 *
 * Sets up Fastify with all middleware, static file serving, CORS, WebSocket
 * support, and proper caching headers. Does NOT start the server listening -
 * that's done after routes are registered.
 *
 * @param config - Server configuration
 * @returns Promise resolving to configured Fastify instance
 */
export async function createHttpServer(
  config: ServerConfig,
): Promise<FastifyInstance> {
  console.log("[HTTP] Creating Fastify server...");

  // Create Fastify instance with minimal logging
  const fastify = Fastify({ logger: { level: "error" } });

  // Configure CORS for development and production
  // Frontend: Cloudflare Pages (hyperscape.club)
  // Backend: Railway (hyperscape-production.up.railway.app)
  const elizaOSUrl =
    process.env.ELIZAOS_URL ||
    process.env.ELIZAOS_API_URL ||
    (process.env.NODE_ENV === "production"
      ? "https://hyperscape-production.up.railway.app"
      : "http://localhost:4001");
  const clientUrl =
    process.env.CLIENT_URL ||
    process.env.PUBLIC_APP_URL ||
    "http://localhost:3333";
  const serverUrl = process.env.SERVER_URL || `http://localhost:${config.port}`;

  const allowedOrigins = [
    // Production domains (HTTPS)
    "https://hyperscape.club",
    "https://www.hyperscape.club",
    "https://hyperscape.pages.dev",
    "https://hyperscape-production.up.railway.app",
    // Production domains (HTTP for legacy/testing)
    "http://hyperscape.pages.dev",
    // Development (from env vars or defaults)
    elizaOSUrl, // ElizaOS API
    clientUrl, // Game Client
    serverUrl, // Game Server
    // Dynamic patterns (for localhost dev and preview deployments)
    /^https?:\/\/localhost:\d+$/, // Matches http://localhost:3000, 3333, 5555, etc.
    /^https?:\/\/.+\.hyperscape\.pages\.dev$/, // Cloudflare Pages preview deployments
    /^https:\/\/.+\.farcaster\.xyz$/,
    /^https:\/\/.+\.warpcast\.com$/,
    /^https:\/\/.+\.privy\.io$/,
    /^https:\/\/.+\.up\.railway\.app$/,
  ];

  // Add custom domain from env if set
  if (process.env.PUBLIC_APP_URL) {
    allowedOrigins.push(process.env.PUBLIC_APP_URL);
  }

  await fastify.register(cors, {
    origin: allowedOrigins,
    credentials: true,
    methods: ["GET", "PUT", "POST", "DELETE", "OPTIONS", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  });
  console.log(
    "[HTTP] ✅ CORS configured for:",
    allowedOrigins.slice(0, 4).join(", "),
    "...",
  );

  // Configure rate limiting for production security
  if (isRateLimitEnabled()) {
    await fastify.register(rateLimit, getGlobalRateLimit());
    console.log(
      "[HTTP] ✅ Rate limiting enabled (100 requests/min per IP globally)",
    );
  } else {
    console.log("[HTTP] ⚠️  Rate limiting disabled (development mode)");
  }

  // Serve index.html for root path (SPA routing)
  await registerIndexHtmlRoute(fastify, config);

  // Register static file serving (public/, assets/)
  await registerStaticFiles(fastify, config);

  // Register multipart for file uploads
  fastify.register(multipart, {
    limits: {
      fileSize: 100 * 1024 * 1024, // 100MB
    },
  });
  console.log("[HTTP] ✅ Multipart registered");

  // Register WebSocket support
  fastify.register(fastifyWebSocket);
  console.log("[HTTP] ✅ WebSocket support registered");

  // Set up error handler
  fastify.setErrorHandler((err, _req, reply) => {
    fastify.log.error(err);
    reply.status(500).send({ error: "Internal server error" });
  });

  // Debug endpoint to see public directory contents
  fastify.get("/debug/public", async (_req, reply) => {
    const publicDir = path.join(config.__dirname, "public");
    const assetsDir = path.join(publicDir, "assets");
    let publicContents: string[] = [];
    let assetsContents: string[] = [];
    try {
      publicContents = await fs.readdir(publicDir);
    } catch (e) {
      publicContents = [`ERROR: ${e}`];
    }
    try {
      assetsContents = await fs.readdir(assetsDir);
    } catch (e) {
      assetsContents = [`ERROR: ${e}`];
    }
    return reply.send({
      publicDir,
      assetsDir,
      publicContents,
      assetsContents: assetsContents.slice(0, 20), // Limit to 20 items
      configDirname: config.__dirname,
    });
  });

  // SPA catch-all route - serve index.html for any unmatched routes
  // This must be registered AFTER all other routes
  await registerSpaCatchAll(fastify, config);

  console.log("[HTTP] ✅ HTTP server created");
  return fastify;
}

/**
 * Register index.html routes for SPA
 *
 * Serves index.html for both "/" and "/index.html" with no-cache headers
 * to ensure clients always get the latest version.
 *
 * @param fastify - Fastify instance
 * @param config - Server configuration
 * @private
 */
async function registerIndexHtmlRoute(
  fastify: FastifyInstance,
  config: ServerConfig,
): Promise<void> {
  const indexHtmlPath = path.join(config.__dirname, "public", "index.html");

  // Check if index.html exists before registering routes
  if (!(await fs.pathExists(indexHtmlPath))) {
    // Get additional debug info
    const publicDir = path.dirname(indexHtmlPath);
    let publicDirContents: string[] = [];
    try {
      publicDirContents = await fs.readdir(publicDir);
    } catch {
      publicDirContents = ["ERROR: Could not read directory"];
    }

    console.log(
      `[HTTP] ⚠️  No index.html found at ${indexHtmlPath}, registering fallback routes`,
    );
    console.log(
      `[HTTP] ⚠️  Public dir contents: ${JSON.stringify(publicDirContents)}`,
    );
    console.log(`[HTTP] ⚠️  config.__dirname: ${config.__dirname}`);
    console.log(`[HTTP] ⚠️  process.cwd(): ${process.cwd()}`);

    // Register fallback routes that return a helpful message
    const fallbackHandler = async (
      _req: FastifyRequest,
      reply: FastifyReply,
    ) => {
      return reply.status(503).send({
        error: "Frontend not available",
        message:
          "The client application has not been built or deployed. Please ensure the client is built and copied to the server's public directory.",
        expectedPath: indexHtmlPath,
        configDirname: config.__dirname,
        cwd: process.cwd(),
        publicDirContents,
      });
    };

    fastify.get("/", fallbackHandler);
    fastify.get("/index.html", fallbackHandler);
    console.log("[HTTP] ⚠️  Fallback routes registered (frontend not found)");
    return;
  }

  const serveIndexHtml = async (_req: FastifyRequest, reply: FastifyReply) => {
    const html = await fs.promises.readFile(indexHtmlPath, "utf-8");

    return reply
      .type("text/html; charset=utf-8")
      .header("Cache-Control", "no-cache, no-store, must-revalidate")
      .header("Pragma", "no-cache")
      .header("Expires", "0")
      .send(html);
  };

  fastify.get("/", serveIndexHtml);
  fastify.get("/index.html", serveIndexHtml);
  console.log("[HTTP] ✅ Index.html routes registered");
}

/**
 * Register all static file serving
 *
 * Sets up static file serving for:
 * - Public directory (client app, scripts, CSS)
 * - World assets (/assets/world/)
 * - Legacy assets route (/assets/)
 * - Manual music route (workaround for static issues)
 * - System plugins (if SYSTEMS_PATH is set)
 *
 * @param fastify - Fastify instance
 * @param config - Server configuration
 * @private
 */
async function registerStaticFiles(
  fastify: FastifyInstance,
  config: ServerConfig,
): Promise<void> {
  // Serve public directory with proper caching
  await fastify.register(statics, {
    root: path.join(config.__dirname, "public"),
    prefix: "/",
    decorateReply: false,
    list: false,
    index: false,
    setHeaders: (res, filePath) => {
      setStaticHeaders(res, filePath);
    },
  });
  console.log("[HTTP] ✅ Public directory registered");

  // Check if client assets exist in public/assets (built frontend)
  // If they do, we DON'T want to register /assets/ for world assets as it would conflict
  const publicAssetsPath = path.join(config.__dirname, "public", "assets");
  const hasClientAssets = await fs.pathExists(publicAssetsPath);

  if (hasClientAssets) {
    console.log(
      `[HTTP] ✅ Client assets found in public/assets - serving from there`,
    );
  }

  // Register world assets at /assets/world/ (only if assets directory exists)
  // In production, clients get assets directly from CDN (PUBLIC_CDN_URL)
  if (await fs.pathExists(config.assetsDir)) {
    await fastify.register(statics, {
      root: config.assetsDir,
      prefix: "/assets/world/",
      decorateReply: false,
      setHeaders: (res, filePath) => {
        setAssetHeaders(res, filePath);
      },
    });
    console.log(`[HTTP] ✅ Registered /assets/world/ → ${config.assetsDir}`);

    // Manual music route (workaround for static file issues)
    registerMusicRoute(fastify, config);

    // ONLY register /assets/ for world assets if NO client assets exist
    // Otherwise, the public directory already serves /assets/ for the frontend
    if (!hasClientAssets) {
      await fastify.register(statics, {
        root: config.assetsDir,
        prefix: "/assets/",
        decorateReply: false,
        setHeaders: (res, filePath) => {
          setAssetHeaders(res, filePath);
        },
      });
      console.log(`[HTTP] ✅ Registered /assets/ → ${config.assetsDir}`);
    }
  } else {
    console.log(
      `[HTTP] ⏭️  Skipping local assets routes (assets served from CDN: ${config.cdnUrl})`,
    );
  }

  // Register manifests at /manifests/ for DataManager compatibility
  // Manifests are fetched from CDN at startup and cached in manifestsDir
  await fastify.register(statics, {
    root: config.manifestsDir,
    prefix: "/manifests/",
    decorateReply: false,
    setHeaders: (res, filePath) => {
      // Manifests should have short cache to allow updates
      // But not no-cache (that would cause excessive requests)
      setManifestHeaders(res, filePath);
    },
  });
  console.log(`[HTTP] ✅ Registered /manifests/ → ${config.manifestsDir}`);

  // Log available assets
  await logAvailableAssets(fastify, config);

  // Register systems static serving if available
  if (config.systemsPath) {
    await fastify.register(statics, {
      root: config.systemsPath,
      prefix: "/dist/",
      decorateReply: false,
      setHeaders: (res) => {
        res.setHeader("Cache-Control", "public, max-age=300");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET");
      },
    });
    console.log(`[HTTP] ✅ Registered /dist/ → ${config.systemsPath}`);
  }
}

/**
 * Set headers for public static files
 *
 * Configures caching and MIME types for scripts, CSS, HTML, and WASM files.
 *
 * @param res - HTTP response object
 * @param filePath - Path to the file being served
 * @private
 */
function setStaticHeaders(
  res: { setHeader: (k: string, v: string) => void },
  filePath: string,
): void {
  if (filePath.endsWith(".wasm")) {
    res.setHeader("Content-Type", "application/wasm");
    res.setHeader("Cache-Control", "public, max-age=3600");
  } else if (filePath.endsWith(".js")) {
    res.setHeader("Content-Type", "application/javascript; charset=utf-8");
    if (filePath.includes("/assets/")) {
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    } else {
      res.setHeader("Cache-Control", "public, max-age=300");
    }
  } else if (filePath.endsWith(".css")) {
    res.setHeader("Content-Type", "text/css; charset=utf-8");
    if (filePath.includes("/assets/")) {
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    } else {
      res.setHeader("Cache-Control", "public, max-age=300");
    }
  } else if (filePath.endsWith(".html")) {
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  } else {
    res.setHeader("Cache-Control", "public, max-age=300");
  }

  // Security headers for SharedArrayBuffer support
  res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
}

/**
 * Set headers for manifest files
 *
 * Manifests use shorter cache times to allow for updates while still
 * providing reasonable caching. ETags are used for cache validation.
 *
 * @param res - HTTP response object
 * @param filePath - Path to the manifest being served
 * @private
 */
function setManifestHeaders(
  res: { setHeader: (k: string, v: string) => void },
  _filePath: string,
): void {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  // Short cache with revalidation - manifests can change but shouldn't
  // cause excessive requests. 5 minutes cache, must revalidate after.
  res.setHeader("Cache-Control", "public, max-age=300, must-revalidate");
  // CORS headers for client access
  res.setHeader("Access-Control-Allow-Origin", "*");
}

/**
 * Set headers for asset files
 *
 * Configures aggressive caching and MIME types for models, audio, etc.
 *
 * @param res - HTTP response object
 * @param filePath - Path to the asset being served
 * @private
 */
function setAssetHeaders(
  res: { setHeader: (k: string, v: string) => void },
  filePath: string,
): void {
  // Set MIME types
  if (filePath.endsWith(".wasm")) {
    res.setHeader("Content-Type", "application/wasm");
    res.setHeader("Accept-Ranges", "bytes");
  } else if (filePath.endsWith(".mp3")) {
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Accept-Ranges", "bytes");
  } else if (filePath.endsWith(".ogg")) {
    res.setHeader("Content-Type", "audio/ogg");
    res.setHeader("Accept-Ranges", "bytes");
  } else if (filePath.endsWith(".wav")) {
    res.setHeader("Content-Type", "audio/wav");
    res.setHeader("Accept-Ranges", "bytes");
  } else if (filePath.endsWith(".glb")) {
    res.setHeader("Content-Type", "model/gltf-binary");
  }

  // Aggressive caching for assets (immutable, 1 year)
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.setHeader("Expires", new Date(Date.now() + 31536000000).toUTCString());
}

/**
 * Register manual music route
 *
 * Workaround for static file serving issues with music files.
 * Tries multiple paths to find music files.
 *
 * @param fastify - Fastify instance
 * @param config - Server configuration
 * @private
 */
function registerMusicRoute(
  fastify: FastifyInstance,
  config: ServerConfig,
): void {
  fastify.get(
    "/assets/world/music/:category/:filename",
    async (request, reply) => {
      const { category, filename } = request.params as {
        category: string;
        filename: string;
      };

      // Validate inputs
      if (!/^\w+\.mp3$/.test(filename)) {
        return reply.code(400).send({ error: "Invalid filename" });
      }
      if (
        category !== "normal" &&
        category !== "combat" &&
        category !== "intro"
      ) {
        return reply.code(400).send({ error: "Invalid category" });
      }

      // Try primary path
      const primaryPath = path.join(
        config.assetsDir,
        "audio",
        "music",
        category,
        filename,
      );

      // Try alternate paths
      const pubCandidates = [
        path.join(config.__dirname, "../..", "public", "assets/world"),
        path.join(config.__dirname, "..", "public", "assets/world"),
        path.join(process.cwd(), "public", "assets/world"),
        path.join(
          process.cwd(),
          "packages",
          "hyperscape",
          "public",
          "assets/world",
        ),
      ];

      // Try primary path first
      if (await fs.pathExists(primaryPath)) {
        reply.type("audio/mpeg");
        reply.header("Accept-Ranges", "bytes");
        reply.header("Cache-Control", "public, max-age=31536000, immutable");
        return reply.send(fs.createReadStream(primaryPath));
      }

      // Try alternates
      for (const pubRoot of pubCandidates) {
        const altPath = path.join(
          pubRoot,
          "audio",
          "music",
          category,
          filename,
        );

        if (await fs.pathExists(altPath)) {
          reply.type("audio/mpeg");
          reply.header("Accept-Ranges", "bytes");
          reply.header("Cache-Control", "public, max-age=31536000, immutable");
          return reply.send(fs.createReadStream(altPath));
        }
      }

      return reply.code(404).send({
        error: "Music file not found",
        tried: [
          primaryPath,
          ...pubCandidates.map((r) =>
            path.join(r, "music", category, filename),
          ),
        ],
      });
    },
  );
  console.log("[HTTP] ✅ Manual music route registered");
}

/**
 * Log available assets for debugging
 *
 * @param fastify - Fastify instance
 * @param config - Server configuration
 * @private
 */
async function logAvailableAssets(
  fastify: FastifyInstance,
  config: ServerConfig,
): Promise<void> {
  const toolsDir = path.join(config.assetsDir, "models/tools");
  if (await fs.pathExists(toolsDir)) {
    const toolFiles = await fs.readdir(toolsDir);
    fastify.log.info(`[HTTP] Tools available: ${toolFiles.join(", ")}`);
  }

  const mobsDir = path.join(config.assetsDir, "models/mobs");
  if (await fs.pathExists(mobsDir)) {
    const mobFiles = await fs.readdir(mobsDir);
    fastify.log.info(`[HTTP] Mob models available: ${mobFiles.join(", ")}`);
  }
}

/**
 * Register SPA catch-all route
 *
 * For client-side routing, any route that doesn't match an API endpoint
 * or static file should serve index.html. This allows React Router or
 * similar client-side routers to handle the route.
 *
 * @param fastify - Fastify instance
 * @param config - Server configuration
 * @private
 */
async function registerSpaCatchAll(
  fastify: FastifyInstance,
  config: ServerConfig,
): Promise<void> {
  const indexHtmlPath = path.join(config.__dirname, "public", "index.html");

  // Check if index.html exists before registering catch-all
  if (!(await fs.pathExists(indexHtmlPath))) {
    console.log(
      "[HTTP] ⚠️  No index.html found in public directory, skipping SPA catch-all",
    );
    return;
  }

  fastify.setNotFoundHandler(
    async (request: FastifyRequest, reply: FastifyReply) => {
      const url = request.url;

      // Don't serve index.html for API routes or asset requests
      if (
        url.startsWith("/api/") ||
        url.startsWith("/ws") ||
        url.startsWith("/assets/") ||
        url.startsWith("/manifests/") ||
        url.startsWith("/dist/") ||
        url.startsWith("/status") ||
        // Don't serve index.html for file extensions (static files that weren't found)
        /\.[a-zA-Z0-9]+$/.test(url)
      ) {
        return reply.status(404).send({ error: "Not found", path: url });
      }

      // Serve index.html for SPA routes
      const html = await fs.promises.readFile(indexHtmlPath, "utf-8");

      return reply
        .type("text/html; charset=utf-8")
        .header("Cache-Control", "no-cache, no-store, must-revalidate")
        .header("Pragma", "no-cache")
        .header("Expires", "0")
        .send(html);
    },
  );

  console.log("[HTTP] ✅ SPA catch-all route registered");
}
