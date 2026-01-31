-- Migration: Add foreign key constraint to operations_log table
-- Ensures referential integrity between operations_log and characters
-- Uses CASCADE DELETE to clean up orphaned records when characters are deleted

DO $$ BEGIN
  ALTER TABLE "operations_log" ADD CONSTRAINT "operations_log_playerId_characters_id_fk"
    FOREIGN KEY ("playerId") REFERENCES "public"."characters"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
