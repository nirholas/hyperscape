-- Quest Progress Table
CREATE TABLE IF NOT EXISTS "quest_progress" (
  "id" serial PRIMARY KEY,
  "playerId" text NOT NULL REFERENCES "characters"("id") ON DELETE CASCADE,
  "questId" text NOT NULL,
  "status" text NOT NULL DEFAULT 'not_started',
  "currentStage" text,
  "stageProgress" jsonb DEFAULT '{}'::jsonb,
  "startedAt" bigint,
  "completedAt" bigint,
  CONSTRAINT "quest_progress_player_quest_unique" UNIQUE("playerId", "questId")
);--> statement-breakpoint

-- Indexes for quest_progress
CREATE INDEX IF NOT EXISTS "idx_quest_progress_player" ON "quest_progress"("playerId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_quest_progress_status" ON "quest_progress"("playerId", "status");--> statement-breakpoint

-- Add quest_points column to characters
ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "questPoints" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
