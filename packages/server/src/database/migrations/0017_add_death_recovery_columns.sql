-- Migration: Add crash recovery columns to player_deaths table
-- P0-003: Enables server restart recovery by storing actual item data
--
-- New columns:
-- - items: JSONB array of item objects {itemId, quantity} for recovery
-- - killedBy: TEXT identifying what killed the player
-- - recovered: BOOLEAN tracking if death was processed during crash recovery
--
-- These columns enable the server to recreate gravestones/ground items
-- after a crash, preventing permanent item loss.

-- Add items column (JSONB for efficient querying and indexing)
ALTER TABLE "player_deaths" ADD COLUMN IF NOT EXISTS "items" JSONB DEFAULT '[]'::jsonb NOT NULL;

-- Add killedBy column
ALTER TABLE "player_deaths" ADD COLUMN IF NOT EXISTS "killedBy" TEXT DEFAULT 'unknown' NOT NULL;

-- Add recovered column for crash recovery tracking
ALTER TABLE "player_deaths" ADD COLUMN IF NOT EXISTS "recovered" BOOLEAN DEFAULT false NOT NULL;

-- Add CHECK constraint for valid zoneType values
DO $$ BEGIN
  ALTER TABLE "player_deaths" ADD CONSTRAINT "player_deaths_zoneType_check"
    CHECK ("zoneType" IN ('safe_area', 'wilderness', 'pvp_zone', 'unknown'));
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Add index on recovered column for efficient recovery queries
CREATE INDEX IF NOT EXISTS "idx_player_deaths_recovered" ON "player_deaths" USING btree ("recovered");

-- Add composite index for recovery queries (unrecovered deaths)
CREATE INDEX IF NOT EXISTS "idx_player_deaths_recovery_lookup" ON "player_deaths" USING btree ("recovered", "timestamp");
