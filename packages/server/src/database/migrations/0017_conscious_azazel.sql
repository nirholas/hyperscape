CREATE TABLE "layout_presets" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"slotIndex" integer NOT NULL,
	"name" text NOT NULL,
	"layoutData" text NOT NULL,
	"resolution" text,
	"shared" integer DEFAULT 0 NOT NULL,
	"createdAt" bigint DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT NOT NULL,
	"updatedAt" bigint DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT NOT NULL,
	CONSTRAINT "layout_presets_userId_slotIndex_unique" UNIQUE("userId","slotIndex")
);
--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "prayerLevel" integer DEFAULT 1;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "smithingLevel" integer DEFAULT 1;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "prayerXp" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "smithingXp" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "prayerPoints" integer DEFAULT 1;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "prayerMaxPoints" integer DEFAULT 1;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "activePrayers" text DEFAULT '[]';--> statement-breakpoint
ALTER TABLE "layout_presets" ADD CONSTRAINT "layout_presets_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_layout_presets_user" ON "layout_presets" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "idx_layout_presets_shared" ON "layout_presets" USING btree ("shared");