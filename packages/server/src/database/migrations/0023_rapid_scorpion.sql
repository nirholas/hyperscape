CREATE TABLE IF NOT EXISTS "action_bar_storage" (
	"id" serial PRIMARY KEY NOT NULL,
	"playerId" text NOT NULL,
	"barId" integer DEFAULT 0 NOT NULL,
	"slotCount" integer DEFAULT 7 NOT NULL,
	"slotsData" text NOT NULL,
	"updatedAt" bigint DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT NOT NULL,
	CONSTRAINT "action_bar_storage_playerId_barId_unique" UNIQUE("playerId","barId")
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "action_bar_storage" ADD CONSTRAINT "action_bar_storage_playerId_characters_id_fk" FOREIGN KEY ("playerId") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_action_bar_storage_player" ON "action_bar_storage" USING btree ("playerId");
