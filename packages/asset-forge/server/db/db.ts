/**
 * Database Connection
 * PostgreSQL connection using Bun-optimized postgres library and Drizzle ORM
 *
 * NOTE: Database is OPTIONAL for local development. Asset system works file-based.
 * Set DATABASE_URL to enable database features.
 */

import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { schema } from "./schema";
import type { Sql } from "postgres";

// Check if database is available
const DATABASE_URL = process.env.DATABASE_URL;
const isDatabaseEnabled = Boolean(DATABASE_URL);

// Create postgres client only if DATABASE_URL is provided
let queryClient: Sql | null = null;
let db: PostgresJsDatabase<typeof schema> | null = null;

if (isDatabaseEnabled && DATABASE_URL) {
  // Create postgres client (optimized for Bun)
  // Using connection pool with sensible defaults
  queryClient = postgres(DATABASE_URL, {
    max: 20, // Maximum number of connections
    idle_timeout: 20, // Close idle connections after 20 seconds
    connect_timeout: 10, // Fail after 10 seconds if can't connect
    prepare: false, // Disable prepared statements for better compatibility
  });

  // Create Drizzle instance with schema
  db = drizzle(queryClient, { schema });

  // Test connection
  queryClient`SELECT NOW()`
    .then((result) => {
      console.log("[Database] ✓ Connected to PostgreSQL at", result[0].now);
    })
    .catch((error) => {
      console.error("[Database] ✗ Connection failed:", error.message);
      console.warn(
        "[Database] Continuing without database - file-based storage only",
      );
      queryClient = null;
      db = null;
    });

  // Graceful shutdown
  process.on("SIGINT", async () => {
    if (queryClient) {
      console.log("[Database] Closing connection...");
      await queryClient.end();
    }
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    if (queryClient) {
      console.log("[Database] Closing connection...");
      await queryClient.end();
    }
    process.exit(0);
  });
} else {
  console.log(
    "[Database] DATABASE_URL not set - running in file-based mode (database features disabled)",
  );
}

export { queryClient, db, isDatabaseEnabled };
