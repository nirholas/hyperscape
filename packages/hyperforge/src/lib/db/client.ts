/**
 * Database Client
 * Singleton Drizzle client for Hyperforge PostgreSQL database
 * Uses the same Supabase as the game, but with a separate "hyperforge" schema
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { logger } from "@/lib/utils";

const log = logger.child("DB");

// Get database URL from environment (same Supabase as the game)
const databaseUrl = process.env["DATABASE_URL"];

if (!databaseUrl) {
  log.warn(
    "DATABASE_URL not set. HyperForge database operations will fail. " +
      "Set DATABASE_URL in your .env file to your Supabase connection string.",
  );
}

// Create PostgreSQL connection
// Using connection pooling mode for serverless compatibility
const sql = postgres(databaseUrl || "", {
  // Connection pool settings for Next.js serverless
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
  // Disable prepare for Supabase's transaction mode pooler
  prepare: false,
});

// Create Drizzle client with schema
export const db = drizzle(sql, { schema });

// Export raw sql client for advanced queries if needed
export { sql };

/**
 * Initialize the hyperforge schema if it doesn't exist
 * Run this once during setup
 */
export async function initializeSchema(): Promise<void> {
  try {
    await sql`CREATE SCHEMA IF NOT EXISTS hyperforge`;
    log.info("HyperForge schema initialized");
  } catch (error) {
    log.error("Failed to initialize hyperforge schema:", error);
    throw error;
  }
}
