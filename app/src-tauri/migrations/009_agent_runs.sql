-- Phase 4: agent_runs table for pi Agent event stream persistence
CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  turn_id TEXT NOT NULL,
  agent_kind TEXT NOT NULL,           -- "emotion" | "companion" | future
  started_at INTEGER NOT NULL,        -- Unix ms
  ended_at INTEGER,                   -- Unix ms, NULL while running
  stop_reason TEXT,                   -- "ok" | "sli_exceeded" | "error" | "aborted_by_user"
  events_jsonl TEXT NOT NULL DEFAULT ''  -- one JSONL row per event (append-friendly)
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_turn ON agent_runs(turn_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_started ON agent_runs(started_at);

-- Phase 2 TODO closure: llm_usage.agent_kind column for legacy vs pi telemetry
ALTER TABLE llm_usage ADD COLUMN agent_kind TEXT;
