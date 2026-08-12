-- ActiveIntent: session-sticky listening intent (e.g. "一直播放粤语歌曲")
-- Single-row table: at most one active intent at a time. Survives app restart.
CREATE TABLE IF NOT EXISTS active_intent (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  raw_text TEXT NOT NULL,
  constraints_json TEXT NOT NULL DEFAULT '{}',
  persistence TEXT NOT NULL CHECK (persistence IN ('sticky', 'once')),
  source TEXT NOT NULL CHECK (source IN ('user-explicit', 'agent-inferred')),
  created_at INTEGER NOT NULL,
  turn_id TEXT NOT NULL
);
