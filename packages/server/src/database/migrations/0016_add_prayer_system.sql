-- Prayer Skill and System Columns
-- Adds prayer level/XP tracking and active prayer state persistence

ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "prayerLevel" integer DEFAULT 1;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "prayerXp" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "prayerPoints" integer DEFAULT 1;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "prayerMaxPoints" integer DEFAULT 1;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "activePrayers" text DEFAULT '[]';--> statement-breakpoint
