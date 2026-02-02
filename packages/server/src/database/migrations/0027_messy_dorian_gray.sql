CREATE TABLE IF NOT EXISTS "operations_log" (
	"id" text PRIMARY KEY NOT NULL,
	"playerId" text NOT NULL,
	"operationType" text NOT NULL,
	"operationState" jsonb NOT NULL,
	"completed" boolean DEFAULT false,
	"timestamp" bigint NOT NULL,
	"completedAt" bigint
);
--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "magicLevel" integer DEFAULT 1;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "magicXp" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "selectedSpell" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_operations_log_incomplete" ON "operations_log" USING btree ("playerId","completed");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_operations_log_timestamp" ON "operations_log" USING btree ("timestamp");