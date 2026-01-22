-- Quest Audit Log Table
-- Tracks all quest state changes for security auditing and exploit detection
-- Immutable log - no updates or deletes in normal operation

CREATE TABLE IF NOT EXISTS "quest_audit_log" (
  "id" SERIAL PRIMARY KEY,
  "playerId" TEXT NOT NULL REFERENCES "characters"("id") ON DELETE CASCADE,
  "questId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "questPointsAwarded" INTEGER DEFAULT 0,
  "stageId" TEXT,
  "stageProgress" JSONB DEFAULT '{}',
  "timestamp" BIGINT NOT NULL,
  "metadata" JSONB DEFAULT '{}'
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS "idx_quest_audit_log_player" ON "quest_audit_log" ("playerId");
CREATE INDEX IF NOT EXISTS "idx_quest_audit_log_quest" ON "quest_audit_log" ("questId");
CREATE INDEX IF NOT EXISTS "idx_quest_audit_log_player_quest" ON "quest_audit_log" ("playerId", "questId");
CREATE INDEX IF NOT EXISTS "idx_quest_audit_log_timestamp" ON "quest_audit_log" ("timestamp");
CREATE INDEX IF NOT EXISTS "idx_quest_audit_log_action" ON "quest_audit_log" ("action");
