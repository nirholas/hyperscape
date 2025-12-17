import { defineConfig } from "drizzle-kit";

// HyperForge uses the same Supabase as the game, but with a separate "hyperforge" schema
// to keep tables isolated. Set DATABASE_URL in .env to your Supabase connection string.
const databaseUrl = process.env["DATABASE_URL"];

if (!databaseUrl) {
  console.warn(
    "⚠️  DATABASE_URL not set. HyperForge database operations will fail.",
  );
}

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./src/lib/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl || "",
  },
  // Use a separate schema to avoid conflicts with the game's tables
  schemaFilter: ["hyperforge"],
});
