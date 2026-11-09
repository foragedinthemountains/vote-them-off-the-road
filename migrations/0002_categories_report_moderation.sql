-- Phase 3: behavior categories and deduplicated report moderation.
-- Run ONCE on production D1. Existing records remain valid.
ALTER TABLE incidents ADD COLUMN category TEXT NOT NULL DEFAULT 'other';
ALTER TABLE incidents ADD COLUMN auto_hidden_at INTEGER;
ALTER TABLE incidents ADD COLUMN reviewed_at INTEGER;
ALTER TABLE reports ADD COLUMN reporter_key_hash TEXT;
ALTER TABLE reports ADD COLUMN network_key_hash TEXT;
-- Existing reports with NULL reporter hashes do not count toward auto-hiding.
CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_browser_incident
 ON reports(incident_id, reporter_key_hash) WHERE reporter_key_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_reports_moderation
 ON reports(incident_id, created_at DESC, reporter_key_hash, network_key_hash);
CREATE INDEX IF NOT EXISTS idx_incidents_category_week
 ON incidents(state_code, status, category, created_at DESC);
