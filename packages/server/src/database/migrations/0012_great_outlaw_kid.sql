CREATE TABLE IF NOT EXISTS "bank_placeholders" (
	"id" serial PRIMARY KEY NOT NULL,
	"playerId" text NOT NULL,
	"tabIndex" integer DEFAULT 0 NOT NULL,
	"slot" integer NOT NULL,
	"itemId" text NOT NULL,
	"createdAt" bigint DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bank_tabs" (
	"id" serial PRIMARY KEY NOT NULL,
	"playerId" text NOT NULL,
	"tabIndex" integer NOT NULL,
	"iconItemId" text,
	"createdAt" bigint DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bank_storage" DROP CONSTRAINT IF EXISTS "bank_storage_playerId_slot_unique";--> statement-breakpoint
ALTER TABLE "bank_storage" ADD COLUMN IF NOT EXISTS "tabIndex" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "alwaysSetPlaceholder" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bank_placeholders_playerId_tabIndex_slot_idx" ON "bank_placeholders" ("playerId","tabIndex","slot");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bank_tabs_playerId_tabIndex_idx" ON "bank_tabs" ("playerId","tabIndex");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_bank_placeholders_player" ON "bank_placeholders" USING btree ("playerId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_bank_placeholders_player_item" ON "bank_placeholders" USING btree ("playerId","itemId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_bank_tabs_player" ON "bank_tabs" USING btree ("playerId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_bank_storage_player_tab" ON "bank_storage" USING btree ("playerId","tabIndex");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bank_storage_playerId_tabIndex_slot_idx" ON "bank_storage" ("playerId","tabIndex","slot");
