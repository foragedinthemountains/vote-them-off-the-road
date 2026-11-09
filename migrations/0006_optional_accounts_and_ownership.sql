-- 0006: optional public accounts and guest-owned incidents.
-- Apply only after the new Worker deployment is Ready and migrations 0001-0005.
-- Does not modify existing incidents, votes, reports, or administrative Access.
-- Existing incidents deliberately remain unclaimed; do NOT guess prior owners.
CREATE TABLE IF NOT EXISTS incident_ownership (
  incident_id TEXT PRIMARY KEY REFERENCES incidents(id) ON DELETE CASCADE,
  owner_user_id TEXT,
  owner_token_hash TEXT UNIQUE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  claimed_at INTEGER,
  CHECK(owner_user_id IS NOT NULL OR owner_token_hash IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_incident_ownership_user
  ON incident_ownership(owner_user_id, created_at DESC);

-- Tracks browser-keyed participation when someone signs in. This DOES NOT
-- automatically merge votes; one person's different browsers need reconciliation.
CREATE TABLE IF NOT EXISTS account_voter_links (
  owner_user_id TEXT NOT NULL,
  voter_key_hash TEXT NOT NULL UNIQUE,
  linked_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY(owner_user_id, voter_key_hash)
);
CREATE INDEX IF NOT EXISTS idx_account_voter_links_user
  ON account_voter_links(owner_user_id);

-- Keep an audit of substantive author edits, especially after voting starts.
CREATE TABLE IF NOT EXISTS incident_author_edits (
  id TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  actor_type TEXT NOT NULL CHECK(actor_type IN ('guest','account')),
  previous_title TEXT NOT NULL,
  previous_description TEXT NOT NULL,
  previous_category TEXT NOT NULL,
  previous_location_label TEXT,
  previous_status TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_incident_author_edits_case
  ON incident_author_edits(incident_id,created_at DESC);

-- Enable guest ownership ONLY after the whole migration succeeds.
CREATE TABLE IF NOT EXISTS ownership_migration_complete (
  id INTEGER PRIMARY KEY CHECK(id=1),
  completed_at INTEGER NOT NULL DEFAULT (unixepoch())
);
INSERT OR IGNORE INTO ownership_migration_complete(id) VALUES(1);
