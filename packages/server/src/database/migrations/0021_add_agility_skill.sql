ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "agilityLevel" integer DEFAULT 1;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "agilityXp" integer DEFAULT 0;--> statement-breakpoint
