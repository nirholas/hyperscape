ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "miningLevel" integer DEFAULT 1;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "miningXp" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "autoRetaliate" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_player_slot_unique" ON "inventory" USING btree ("playerId","slotIndex") WHERE "slotIndex" >= 0;
