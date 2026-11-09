-- Phase 5: anonymous Jury XP and Guess the Community Verdict.
-- Apply AFTER migrations 0001-0004 have succeeded.
-- Idempotent: existing votes receive their base XP once and are not changed.
CREATE TABLE IF NOT EXISTS jury_xp_events (
  voter_key_hash TEXT NOT NULL,
  event_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('vote','jury_duty','battle','verdict_guess','verdict_correct','caught_up','return','weekly_prediction')),
  xp INTEGER NOT NULL CHECK(xp >= 0 AND xp <= 50),
  eastern_day TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (voter_key_hash, event_key)
);
CREATE INDEX IF NOT EXISTS idx_jury_xp_day
  ON jury_xp_events(voter_key_hash, eastern_day, kind);

CREATE TABLE IF NOT EXISTS jury_verdict_guesses (
  incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  voter_key_hash TEXT NOT NULL,
  guess TEXT NOT NULL CHECK(guess IN ('off','pass','funny')),
  result_choice TEXT CHECK(result_choice IN ('off','pass','funny')),
  was_correct INTEGER CHECK(was_correct IN (0,1)),
  off_votes INTEGER NOT NULL,
  pass_votes INTEGER NOT NULL,
  funny_votes INTEGER NOT NULL,
  eastern_day TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (incident_id,voter_key_hash)
);
CREATE INDEX IF NOT EXISTS idx_jury_guess_day
  ON jury_verdict_guesses(voter_key_hash,eastern_day);

-- Previous legitimate reactions earn 10 XP each, without modifying their votes.
INSERT OR IGNORE INTO jury_xp_events(voter_key_hash,event_key,kind,xp,eastern_day,created_at)
SELECT voter_key_hash,'vote:'||incident_id,'vote',10,
       date(created_at,'unixepoch','-5 hours'),created_at FROM votes_v4;

-- Activation marker last. New code falls back safely before it is present.
CREATE TABLE IF NOT EXISTS jury_xp_migration_complete (
  id INTEGER PRIMARY KEY CHECK(id=1),
  completed_at INTEGER NOT NULL DEFAULT (unixepoch())
);
INSERT OR IGNORE INTO jury_xp_migration_complete(id) VALUES(1);
