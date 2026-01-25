-- These columns may already exist from 0018_add_death_recovery_columns.sql
-- Using DO blocks for idempotent column additions
DO $$ BEGIN
  ALTER TABLE "player_deaths" ADD COLUMN "items" jsonb DEFAULT '[]'::jsonb NOT NULL;
EXCEPTION WHEN duplicate_column THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "player_deaths" ADD COLUMN "killedBy" text DEFAULT 'unknown' NOT NULL;
EXCEPTION WHEN duplicate_column THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "player_deaths" ADD COLUMN "recovered" boolean DEFAULT false NOT NULL;
EXCEPTION WHEN duplicate_column THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_player_deaths_recovered" ON "player_deaths" USING btree ("recovered");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_player_deaths_recovery_lookup" ON "player_deaths" USING btree ("recovered","timestamp");