ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "miningLevel" integer DEFAULT 1;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "miningXp" integer DEFAULT 0;