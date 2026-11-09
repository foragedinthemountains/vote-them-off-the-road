-- Vote Them Off the Road: initial database schema for Cloudflare D1.
-- IDs and voter identifiers must be generated and validated in the Worker.
-- Do not expose this database directly to browsers or store raw IPs as voter keys.

CREATE TABLE IF NOT EXISTS incidents (
  id TEXT PRIMARY KEY,
  state_code TEXT NOT NULL DEFAULT 'NH' CHECK (length(state_code) = 2),
  location_label TEXT,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 5 AND 160),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 3000),
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'hidden', 'removed')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_incidents_public_feed
  ON incidents (state_code, status, created_at DESC);

CREATE TABLE IF NOT EXISTS incident_media (
  id TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  media_type TEXT NOT NULL CHECK (media_type IN ('image', 'video')),
  storage_provider TEXT NOT NULL CHECK (storage_provider IN ('r2', 'stream')),
  storage_key TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0 CHECK (display_order >= 0),
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_incident_media_incident
  ON incident_media (incident_id, display_order);

CREATE TABLE IF NOT EXISTS votes (
  incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  voter_key_hash TEXT NOT NULL,
  choice TEXT NOT NULL CHECK (choice IN ('off', 'pass')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (incident_id, voter_key_hash)
);

CREATE INDEX IF NOT EXISTS idx_votes_choice
  ON votes (incident_id, choice);

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK (reason IN ('harassment', 'private_info', 'false_claim', 'copyright', 'removal_request', 'other')),
  details TEXT NOT NULL DEFAULT '' CHECK (length(details) <= 3000),
  contact_email TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewing', 'resolved', 'dismissed')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  resolved_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_reports_queue
  ON reports (status, created_at);
