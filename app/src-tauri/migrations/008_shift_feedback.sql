-- Sprint 17 · Shift feedback persistence
-- Records the outcome of each shift recommendation so ReflectAgent can
-- learn which shift strategy works best for the user across sessions.

CREATE TABLE shift_feedback (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  turn_id         TEXT    NOT NULL,
  ts              INTEGER NOT NULL,
  shift           TEXT    NOT NULL,
  user_action     TEXT    NOT NULL,
  pad_p           REAL    NOT NULL,
  pad_a           REAL    NOT NULL,
  pad_d           REAL    NOT NULL,
  time_to_action_ms INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_shift_feedback_ts ON shift_feedback(ts DESC);
CREATE INDEX idx_shift_feedback_shift ON shift_feedback(shift);
