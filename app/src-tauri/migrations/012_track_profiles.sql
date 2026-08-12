-- DJ agent track profiles: semantic, filterable song characteristics
CREATE TABLE IF NOT EXISTS library_track_profiles (
  track_id TEXT PRIMARY KEY,
  language TEXT NOT NULL,
  genres_json TEXT NOT NULL DEFAULT '[]',
  mood_json TEXT NOT NULL DEFAULT '[]',
  scenes_json TEXT NOT NULL DEFAULT '[]',
  era TEXT,
  vocal TEXT NOT NULL DEFAULT 'other',
  energy_check TEXT NOT NULL DEFAULT 'mid',
  one_liner TEXT NOT NULL DEFAULT '',
  annotated_at INTEGER NOT NULL,
  model TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_track_profiles_language
  ON library_track_profiles(language);
