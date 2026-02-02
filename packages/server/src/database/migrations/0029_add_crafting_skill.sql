ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "craftingLevel" integer DEFAULT 1;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "craftingXp" integer DEFAULT 0;--> statement-breakpoint
