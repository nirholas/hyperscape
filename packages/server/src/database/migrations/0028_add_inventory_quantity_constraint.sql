-- Migration: Add quantity constraint to inventory table
-- Prevents zero or negative quantities from persisting in the database.
-- This is a safety net for the duel settlement system and any future
-- operations that modify inventory quantities directly via SQL.

ALTER TABLE inventory ADD CONSTRAINT inventory_quantity_positive CHECK (quantity >= 1);
--> statement-breakpoint
ALTER TABLE bank_storage ADD CONSTRAINT bank_quantity_positive CHECK (quantity >= 1);
