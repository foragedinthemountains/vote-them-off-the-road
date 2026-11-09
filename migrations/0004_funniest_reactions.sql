-- Phase 4D: add a third reaction without rewriting or dropping legacy votes.
-- Run after 0002 and 0003 against the production D1 database.
-- Safe to rerun: existing original votes and their timestamps remain intact.
CREATE TABLE IF NOT EXISTS votes_v4 (
  incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  voter_key_hash TEXT NOT NULL,
  choice TEXT NOT NULL CHECK (choice IN ('off','pass','funny')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (incident_id, voter_key_hash)
);
INSERT OR IGNORE INTO votes_v4 (incident_id, voter_key_hash, choice, created_at)
  SELECT incident_id, voter_key_hash, choice, created_at FROM votes;
CREATE INDEX IF NOT EXISTS idx_votes_v4_choice ON votes_v4(incident_id, choice);

CREATE TABLE IF NOT EXISTS weekly_funny_awards (
  week_start INTEGER NOT NULL,
  rank INTEGER NOT NULL CHECK(rank BETWEEN 1 AND 3),
  incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  funny_votes INTEGER NOT NULL,
  off_votes INTEGER NOT NULL,
  pass_votes INTEGER NOT NULL,
  recorded_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (week_start, rank),
  UNIQUE (week_start, incident_id)
);
CREATE INDEX IF NOT EXISTS idx_weekly_funny_incident
  ON weekly_funny_awards(incident_id);

-- Activation marker MUST be last; the Worker ignores the new table until this row exists.
CREATE TABLE IF NOT EXISTS humor_migration_complete (
  id INTEGER PRIMARY KEY CHECK(id=1),
  completed_at INTEGER NOT NULL DEFAULT (unixepoch())
);
INSERT OR IGNORE INTO humor_migration_complete(id) VALUES(1);
