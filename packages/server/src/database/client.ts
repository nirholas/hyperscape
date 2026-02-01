/**
 * Database Client and Migration Manager
 *
 * This module handles PostgreSQL database initialization using Drizzle ORM.
 * It provides a singleton pattern for database connections to prevent connection pool exhaustion.
 *
 * **Key Features**:
 * - Singleton connection pool to prevent connection leaks
 * - Automatic migration runner that finds migrations in multiple possible locations
 * - Connection testing before returning database instance
 * - Graceful error handling for existing tables
 *
 * **Architecture**:
 * - Uses node-postgres (pg) for connection pooling
 * - Wraps pg with Drizzle ORM for type-safe queries
 * - Runs migrations from /src/database/migrations/ on startup
 * - Searches multiple paths to support both development and production builds
 *
 * **Migration System**:
 * The migration system searches for the `meta/_journal.json` file in these locations (in order):
 * 1. process.cwd()/src/database/migrations (development from server package)
 * 2. process.cwd()/packages/server/src/database/migrations (development from workspace root)
 * 3. __dirname/migrations (production build)
 * 4. __dirname/database/migrations (alternative build structure)
 * 5. __dirname/../src/database/migrations (alternative build structure)
 *
 * **Connection Pooling**:
 * - Max 20 connections per pool (min 2)
 * - 10 second idle timeout (aggressively reaps idle connections)
 * - 30 second connection timeout
 * - allowExitOnIdle: true (cleanup on hot reload)
 *
 * **Usage**:
 * ```typescript
 * const { db, pool } = await initializeDatabase(connectionString);
 * const users = await db.select().from(schema.users);
 * await pool.end(); // Cleanup on shutdown
 * ```
 *
 * **Referenced by**: index.ts (server startup), DatabaseSystem.ts (database operations)
 */

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import * as schema from "./schema";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const { Pool } = pg;

// Get directory path for migrations
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Singleton instances - only one database connection per server process
 * This prevents connection pool exhaustion from multiple initialization attempts
 */
let dbInstance: ReturnType<typeof drizzle> | undefined;
let poolInstance: pg.Pool | undefined;

/**
 * Track connection errors for monitoring
 */
let connectionErrorCount = 0;

/**
 * Detect if connection string is for a serverless database (Neon, Supabase, etc.)
 * These require special handling for connection management
 */
function isServerlessDatabase(connectionString: string): boolean {
  return (
    connectionString.includes("neon.tech") ||
    connectionString.includes("supabase.co") ||
    connectionString.includes("pooler") ||
    connectionString.includes("-pooler.")
  );
}

/**
 * Initialize the database and run migrations
 *
 * This is the main entry point for database setup. It creates a connection pool,
 * initializes Drizzle ORM, and runs all pending migrations.
 *
 * **Hot Reload Safety**: Automatically closes any stale connection pools from previous
 * dev server instances before creating a new one. This prevents connection exhaustion
 * during development.
 *
 * @param connectionString - PostgreSQL connection URL (postgresql://user:pass@host:port/database)
 * @returns Object with db (Drizzle instance) and pool (pg.Pool) for direct access
 * @throws Error if connection fails or migrations encounter unexpected errors
 */
export async function initializeDatabase(connectionString: string) {
  // Force cleanup of stale connections on hot reload
  if (poolInstance) {
    await poolInstance.end().catch((err) => {
      console.warn("[DB] Error ending stale pool:", err);
    });
    poolInstance = undefined;
    dbInstance = undefined;
  }

  // Return cached instance if already initialized (singleton pattern)
  if (dbInstance) {
    return { db: dbInstance, pool: poolInstance! };
  }

  // Detect SSL requirement from connection string or RDS hostname
  const needsSSL =
    connectionString.includes("sslmode=") ||
    connectionString.includes(".rds.amazonaws.com") ||
    connectionString.includes("neon.tech") ||
    connectionString.includes("supabase.co");

  // Detect serverless database for special connection handling
  const isServerless = isServerlessDatabase(connectionString);

  // Configure pool based on database type
  // Serverless databases (Neon, Supabase) need:
  // - Shorter idle timeouts (they aggressively close idle connections)
  // - Keepalive to prevent unexpected disconnects
  // - Lower max connections (serverless pools are limited)
  const poolConfig: pg.PoolConfig = {
    connectionString,
    // For serverless: lower max, for traditional: higher
    max: isServerless ? 10 : 20,
    min: isServerless ? 1 : 2,
    // Serverless DBs close idle connections quickly, so use shorter timeout
    idleTimeoutMillis: isServerless ? 20000 : 30000,
    connectionTimeoutMillis: 30000,
    allowExitOnIdle: true,
    // Enable SSL for cloud databases
    ssl: needsSSL ? { rejectUnauthorized: false } : undefined,
    // TCP keepalive settings to detect dead connections faster
    keepAlive: true,
    keepAliveInitialDelayMillis: isServerless ? 10000 : 30000,
  };

  console.log(
    `[DB] Initializing ${isServerless ? "serverless" : "standard"} PostgreSQL pool (max: ${poolConfig.max}, keepAlive: ${poolConfig.keepAlive})`,
  );

  const pool = new Pool(poolConfig);

  // Add pool error handlers for connection issues
  pool.on("error", (err) => {
    connectionErrorCount++;
    console.error(
      `[DB] Pool connection error (count: ${connectionErrorCount}):`,
      err.message,
    );
    // Don't throw - let the pool try to recover by acquiring new connections
  });

  pool.on("connect", () => {
    // Reset error count on successful connection
    if (connectionErrorCount > 0) {
      console.log(
        `[DB] Pool connection restored after ${connectionErrorCount} errors`,
      );
      connectionErrorCount = 0;
    }
  });

  // Test connection with retry
  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const client = await pool.connect();
      await client.query("SELECT NOW()");
      client.release();
      console.log("[DB] ✓ Connection test successful");
      break;
    } catch (error) {
      console.error(
        `[DB] ❌ Connection attempt ${attempt}/${maxRetries} failed:`,
        error instanceof Error ? error.message : error,
      );
      if (attempt === maxRetries) {
        throw error;
      }
      // Wait before retrying (exponential backoff)
      await new Promise((resolve) =>
        setTimeout(resolve, Math.pow(2, attempt) * 500),
      );
    }
  }

  // Create Drizzle instance
  const db = drizzle(pool, { schema });

  // Run migrations
  try {
    // When bundled by esbuild, we need to find migrations relative to process.cwd()
    // Try multiple possible locations
    const possiblePaths = [
      // Development: from server package root
      path.join(process.cwd(), "src/database/migrations"),
      // Development: from workspace root
      path.join(process.cwd(), "packages/server/src/database/migrations"),
      path.join(__dirname, "migrations"),
      path.join(__dirname, "database/migrations"),
      path.join(__dirname, "../src/database/migrations"),
    ];

    let migrationsFolder: string | null = null;
    for (const testPath of possiblePaths) {
      const journalPath = path.join(testPath, "meta/_journal.json");
      if (fs.existsSync(journalPath)) {
        migrationsFolder = testPath;
        console.log(`[DB] ✓ Found migrations folder: ${testPath}`);
        // Log journal contents
        const journal = JSON.parse(fs.readFileSync(journalPath, "utf-8"));
        console.log(
          `[DB] Journal has ${journal.entries?.length || 0} migrations`,
        );
        break;
      }
    }

    if (!migrationsFolder) {
      throw new Error(
        `Could not find migrations folder. Searched:\n${possiblePaths.map((p) => `  - ${p}`).join("\n")}\n` +
          `Current working directory: ${process.cwd()}\n` +
          `__dirname: ${__dirname}`,
      );
    }

    console.log("[DB] Running migrations...");
    await migrate(db, { migrationsFolder });
    console.log("[DB] ✓ Migrations complete");
  } catch (error) {
    // If tables already exist (42P07), that's fine - the database is already set up
    const hasCode =
      error &&
      typeof error === "object" &&
      "cause" in error &&
      error.cause &&
      typeof error.cause === "object" &&
      "code" in error.cause;
    const hasMessage = error && typeof error === "object" && "message" in error;
    const errorWithCause = error as {
      cause?: { code?: string };
      message?: string;
    };
    const isExistsError =
      (hasCode && errorWithCause.cause?.code === "42P07") || // Table already exists
      (hasCode && errorWithCause.cause?.code === "42701") || // Column already exists
      (hasCode && errorWithCause.cause?.code === "42710") || // Constraint already exists
      (hasMessage &&
        typeof errorWithCause.message === "string" &&
        errorWithCause.message.includes("already exists"));

    if (isExistsError) {
      console.log(
        "[DB] ⚠️  Migration skipped - objects already exist (safe to ignore)",
      );
      // Log the actual error for debugging
      console.log("[DB] Migration error details:", errorWithCause.message);
    } else {
      console.error("[DB] ❌ Migration failed:", error);
      throw error;
    }
  }

  dbInstance = db;
  poolInstance = pool;

  return { db, pool };
}

/**
 * Get the cached Drizzle database instance
 *
 * Use this to access the database from anywhere in the application after initialization.
 * Throws an error if called before initializeDatabase().
 *
 * @returns The Drizzle database instance
 * @throws Error if database hasn't been initialized yet
 */
export function getDatabase() {
  if (!dbInstance) {
    throw new Error(
      "[DB] Database not initialized. Call initializeDatabase() first.",
    );
  }
  return dbInstance;
}

/**
 * Get the cached PostgreSQL connection pool
 *
 * Use this for low-level database operations that need direct pool access.
 * Most operations should use the Drizzle instance from getDatabase() instead.
 *
 * @returns The PostgreSQL connection pool
 * @throws Error if pool hasn't been initialized yet
 */
export function getPool() {
  if (!poolInstance) {
    throw new Error(
      "[DB] Pool not initialized. Call initializeDatabase() first.",
    );
  }
  return poolInstance;
}

/**
 * Close the database connection and clean up resources
 *
 * This should be called during graceful server shutdown to:
 * - Close all active connections in the pool
 * - Release database resources
 * - Allow the process to exit cleanly
 *
 * After calling this, you must call initializeDatabase() again before using the database.
 * Called by the server shutdown handler in index.ts.
 */
export async function closeDatabase() {
  if (poolInstance) {
    await poolInstance.end();
    poolInstance = undefined;
    dbInstance = undefined;
  }
}

/** TypeScript type for the Drizzle database instance with schema */
export type Database = ReturnType<typeof drizzle<typeof schema>>;
