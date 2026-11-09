-- Phase 4: retention games, archived results and anonymous participation.
-- Run only AFTER 0002_categories_report_moderation.sql, once against production D1.
-- Non-personal, browser-keyed game activity. No user-account credentials.
CREATE TABLE IF NOT EXISTS jury_daily_checkins (
  voter_key_hash TEXT NOT NULL,
  eastern_day TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (voter_key_hash, eastern_day)
);
CREATE INDEX IF NOT EXISTS idx_jury_checkins_day ON jury_daily_checkins(eastern_day);

CREATE TABLE IF NOT EXISTS weekly_awards (
  week_start INTEGER NOT NULL,
  category TEXT NOT NULL,
  rank INTEGER NOT NULL CHECK(rank BETWEEN 1 AND 3),
  incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  off_votes INTEGER NOT NULL,
  pass_votes INTEGER NOT NULL,
  recorded_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (week_start, category, rank),
  UNIQUE (week_start, incident_id)
);
CREATE INDEX IF NOT EXISTS idx_weekly_awards_incident ON weekly_awards(incident_id);

CREATE TABLE IF NOT EXISTS battle_votes (
  left_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  right_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  voter_key_hash TEXT NOT NULL,
  winner_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  CHECK(left_id < right_id),
  CHECK(winner_id = left_id OR winner_id = right_id),
  PRIMARY KEY (left_id, right_id, voter_key_hash)
);
CREATE INDEX IF NOT EXISTS idx_battle_votes_browser
  ON battle_votes(voter_key_hash, created_at DESC);

CREATE TABLE IF NOT EXISTS weekly_predictions (
  week_start INTEGER NOT NULL,
  voter_key_hash TEXT NOT NULL,
  predicted_category TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (week_start, voter_key_hash)
);
CREATE INDEX IF NOT EXISTS idx_weekly_predictions_category
  ON weekly_predictions(week_start, predicted_category);

CREATE TABLE IF NOT EXISTS weekly_category_results (
  week_start INTEGER NOT NULL,
  category TEXT NOT NULL,
  incident_count INTEGER NOT NULL,
  recorded_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (week_start, category)
);
