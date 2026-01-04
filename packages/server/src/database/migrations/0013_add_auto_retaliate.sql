ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "autoRetaliate" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_characters_auto_retaliate" ON "characters" USING btree ("autoRetaliate");
