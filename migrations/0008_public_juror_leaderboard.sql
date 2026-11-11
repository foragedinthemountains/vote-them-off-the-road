-- 0008: Public, opt-in Jury XP leaderboard.
-- Apply after 0007 and after deploying the updated Worker. No existing
-- member opts in automatically. This is additive and repeatable.
CREATE TABLE IF NOT EXISTS public_juror_leaderboard (
  owner_user_id TEXT PRIMARY KEY REFERENCES public_members(id) ON DELETE CASCADE,
  account_voter_key_hash TEXT NOT NULL UNIQUE,
  opted_in_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_leaderboard_join
  ON public_juror_leaderboard(account_voter_key_hash);
-- Marker inserted last so the Worker detects a complete migration.
CREATE TABLE IF NOT EXISTS leaderboard_migration_complete (
  id INTEGER PRIMARY KEY CHECK(id=1),
  completed_at INTEGER NOT NULL DEFAULT (unixepoch())
);
INSERT OR IGNORE INTO leaderboard_migration_complete(id) VALUES(1);
