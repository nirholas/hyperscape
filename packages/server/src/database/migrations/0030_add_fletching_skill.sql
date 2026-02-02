ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "fletchingLevel" integer DEFAULT 1;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "fletchingXp" integer DEFAULT 0;--> statement-breakpoint
