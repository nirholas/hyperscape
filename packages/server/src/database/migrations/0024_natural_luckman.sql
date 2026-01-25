CREATE TABLE "quest_audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"playerId" text NOT NULL,
	"questId" text NOT NULL,
	"action" text NOT NULL,
	"questPointsAwarded" integer DEFAULT 0,
	"stageId" text,
	"stageProgress" jsonb DEFAULT '{}'::jsonb,
	"timestamp" bigint NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb
);
--> statement-breakpoint
CREATE TABLE "quest_progress" (
	"id" serial PRIMARY KEY NOT NULL,
	"playerId" text NOT NULL,
	"questId" text NOT NULL,
	"status" text DEFAULT 'not_started' NOT NULL,
	"currentStage" text,
	"stageProgress" jsonb DEFAULT '{}'::jsonb,
	"startedAt" bigint,
	"completedAt" bigint,
	CONSTRAINT "quest_progress_playerId_questId_unique" UNIQUE("playerId","questId")
);
--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "questPoints" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "quest_audit_log" ADD CONSTRAINT "quest_audit_log_playerId_characters_id_fk" FOREIGN KEY ("playerId") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quest_progress" ADD CONSTRAINT "quest_progress_playerId_characters_id_fk" FOREIGN KEY ("playerId") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_quest_audit_log_player" ON "quest_audit_log" USING btree ("playerId");--> statement-breakpoint
CREATE INDEX "idx_quest_audit_log_quest" ON "quest_audit_log" USING btree ("questId");--> statement-breakpoint
CREATE INDEX "idx_quest_audit_log_player_quest" ON "quest_audit_log" USING btree ("playerId","questId");--> statement-breakpoint
CREATE INDEX "idx_quest_audit_log_timestamp" ON "quest_audit_log" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "idx_quest_audit_log_action" ON "quest_audit_log" USING btree ("action");--> statement-breakpoint
CREATE INDEX "idx_quest_progress_player" ON "quest_progress" USING btree ("playerId");--> statement-breakpoint
CREATE INDEX "idx_quest_progress_status" ON "quest_progress" USING btree ("playerId","status");