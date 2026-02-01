ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "runecraftingLevel" integer DEFAULT 1;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "runecraftingXp" integer DEFAULT 0;--> statement-breakpoint
