ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "smithingLevel" integer DEFAULT 1;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "smithingXp" integer DEFAULT 0;--> statement-breakpoint
