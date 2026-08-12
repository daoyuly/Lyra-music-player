-- Iter Phase 0.1: product analytics events (local-only, never uploaded)
CREATE TABLE IF NOT EXISTS product_events (
  id TEXT PRIMARY KEY,
  ts INTEGER NOT NULL,           -- Unix ms
  kind TEXT NOT NULL,            -- "demo_started" | "demo_completed" | "hint_shown" | "verbal_intent_detected" | ...
  payload_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_product_events_ts ON product_events(ts);
CREATE INDEX IF NOT EXISTS idx_product_events_kind ON product_events(kind);
