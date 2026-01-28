-- Migration: Add magic skill columns to characters table
-- Description: Adds magicLevel, magicXp, and selectedSpell for magic combat support
-- Created: 2026-01-27

-- Add magic level column (combat skill)
ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "magicLevel" integer DEFAULT 1;--> statement-breakpoint

-- Add magic XP column
ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "magicXp" integer DEFAULT 0;--> statement-breakpoint

-- Add selected spell column for autocast spell selection (null = no autocast)
ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "selectedSpell" text;
