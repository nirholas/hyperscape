-- Make all column additions idempotent using DO blocks
DO $$ BEGIN
  ALTER TABLE "layout_presets" ADD COLUMN "shareCode" text;
EXCEPTION WHEN duplicate_column THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "layout_presets" ADD COLUMN "description" text;
EXCEPTION WHEN duplicate_column THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "layout_presets" ADD COLUMN "category" text DEFAULT 'custom';
EXCEPTION WHEN duplicate_column THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "layout_presets" ADD COLUMN "tags" text DEFAULT '[]';
EXCEPTION WHEN duplicate_column THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "layout_presets" ADD COLUMN "usageCount" integer DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "layout_presets" ADD COLUMN "rating" real;
EXCEPTION WHEN duplicate_column THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "layout_presets" ADD COLUMN "ratingCount" integer DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "layout_presets" ADD COLUMN "ratingSum" integer DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_layout_presets_share_code" ON "layout_presets" USING btree ("shareCode");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_layout_presets_community" ON "layout_presets" USING btree ("shared","usageCount","rating");--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "layout_presets" ADD CONSTRAINT "layout_presets_shareCode_unique" UNIQUE("shareCode");
EXCEPTION WHEN duplicate_table THEN null;
END $$;
