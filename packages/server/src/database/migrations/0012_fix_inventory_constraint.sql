-- Migration: Fix missing unique constraint on inventory (playerId, slotIndex)
-- This ensures the index exists even if the previous migration failed or was skipped.

-- Step 1: Delete duplicate inventory entries (safety cleanup)
DELETE FROM inventory
WHERE id NOT IN (
  SELECT MAX(id)
  FROM inventory
  WHERE "slotIndex" >= 0
  GROUP BY "playerId", "slotIndex"
)
AND "slotIndex" >= 0;

-- Step 2: Ensure unique index exists
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_player_slot_unique"
ON inventory ("playerId", "slotIndex")
WHERE "slotIndex" >= 0;
