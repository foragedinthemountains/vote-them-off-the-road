-- 0007: Optional public juror profiles and per-incident author credit.
-- Apply after 0006 to the production D1 database. No existing post is
-- attributed publicly by default. Existing users can choose pseudonyms.
CREATE TABLE IF NOT EXISTS public_profiles (
  owner_user_id TEXT PRIMARY KEY REFERENCES public_members(id) ON DELETE CASCADE,
  handle TEXT COLLATE NOCASE UNIQUE,
  avatar_preset INTEGER NOT NULL DEFAULT 0 CHECK(avatar_preset BETWEEN 0 AND 7),
  avatar_key TEXT UNIQUE,
  avatar_type TEXT CHECK(avatar_type IN ('image/jpeg','image/png','image/webp')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  CHECK (avatar_key IS NULL OR avatar_type IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS incident_attribution (
  incident_id TEXT PRIMARY KEY REFERENCES incidents(id) ON DELETE CASCADE,
  show_author INTEGER NOT NULL DEFAULT 0 CHECK(show_author IN (0,1))
);
-- Final marker only after the full schema is ready.
CREATE TABLE IF NOT EXISTS profile_migration_complete (
  id INTEGER PRIMARY KEY CHECK(id=1),
  completed_at INTEGER NOT NULL DEFAULT (unixepoch())
);
INSERT OR IGNORE INTO profile_migration_complete (id) VALUES (1);
