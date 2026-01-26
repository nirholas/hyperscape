CREATE TABLE IF NOT EXISTS "friend_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"fromPlayerId" text NOT NULL,
	"toPlayerId" text NOT NULL,
	"createdAt" bigint NOT NULL,
	CONSTRAINT "friend_requests_fromPlayerId_toPlayerId_unique" UNIQUE("fromPlayerId","toPlayerId")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "friendships" (
	"id" serial PRIMARY KEY NOT NULL,
	"playerId" text NOT NULL,
	"friendId" text NOT NULL,
	"createdAt" bigint DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT NOT NULL,
	"note" text,
	CONSTRAINT "friendships_playerId_friendId_unique" UNIQUE("playerId","friendId")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ignore_list" (
	"id" serial PRIMARY KEY NOT NULL,
	"playerId" text NOT NULL,
	"ignoredPlayerId" text NOT NULL,
	"createdAt" bigint DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT NOT NULL,
	CONSTRAINT "ignore_list_playerId_ignoredPlayerId_unique" UNIQUE("playerId","ignoredPlayerId")
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "friend_requests" ADD CONSTRAINT "friend_requests_fromPlayerId_characters_id_fk" FOREIGN KEY ("fromPlayerId") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "friend_requests" ADD CONSTRAINT "friend_requests_toPlayerId_characters_id_fk" FOREIGN KEY ("toPlayerId") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "friendships" ADD CONSTRAINT "friendships_playerId_characters_id_fk" FOREIGN KEY ("playerId") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "friendships" ADD CONSTRAINT "friendships_friendId_characters_id_fk" FOREIGN KEY ("friendId") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "ignore_list" ADD CONSTRAINT "ignore_list_playerId_characters_id_fk" FOREIGN KEY ("playerId") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "ignore_list" ADD CONSTRAINT "ignore_list_ignoredPlayerId_characters_id_fk" FOREIGN KEY ("ignoredPlayerId") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_friend_requests_to" ON "friend_requests" USING btree ("toPlayerId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_friend_requests_from" ON "friend_requests" USING btree ("fromPlayerId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_friend_requests_created" ON "friend_requests" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_friendships_player" ON "friendships" USING btree ("playerId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_friendships_friend" ON "friendships" USING btree ("friendId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ignore_list_player" ON "ignore_list" USING btree ("playerId");
