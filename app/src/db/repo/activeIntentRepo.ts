// activeIntentRepo — sticky listening intent (e.g. "一直播放粤语歌曲")
// Single-row table. Survives app restart. Cleared on explicit cancel or once-consumed.

import { getDb } from "../client";

export type IntentConstraints = {
  languages?: string[];
  artists?: string[];
  genres?: string[];
  scenes?: string[];
};

export type ActiveIntent = {
  rawText: string;
  constraints: IntentConstraints;
  persistence: "sticky" | "once";
  source: "user-explicit" | "agent-inferred";
  createdAt: number;
  turnId: string;
};

type Row = {
  id: number;
  raw_text: string;
  constraints_json: string;
  persistence: string;
  source: string;
  created_at: number;
  turn_id: string;
};

function fromRow(r: Row): ActiveIntent {
  let constraints: IntentConstraints = {};
  try {
    constraints = JSON.parse(r.constraints_json) as IntentConstraints;
  } catch {
    constraints = {};
  }
  return {
    rawText: r.raw_text,
    constraints,
    persistence: r.persistence === "once" ? "once" : "sticky",
    source: r.source === "agent-inferred" ? "agent-inferred" : "user-explicit",
    createdAt: r.created_at,
    turnId: r.turn_id,
  };
}

/** Load the single active intent, or null if none. */
export async function load(): Promise<ActiveIntent | null> {
  const db = await getDb();
  const rows = await db.select<Row[]>(
    `SELECT id, raw_text, constraints_json, persistence, source, created_at, turn_id
     FROM active_intent WHERE id = 1`,
  );
  return rows.length === 0 ? null : fromRow(rows[0]);
}

/** Upsert the single active intent row. */
export async function save(intent: ActiveIntent): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO active_intent
       (id, raw_text, constraints_json, persistence, source, created_at, turn_id)
     VALUES (1, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       raw_text = excluded.raw_text,
       constraints_json = excluded.constraints_json,
       persistence = excluded.persistence,
       source = excluded.source,
       created_at = excluded.created_at,
       turn_id = excluded.turn_id`,
    [
      intent.rawText,
      JSON.stringify(intent.constraints),
      intent.persistence,
      intent.source,
      intent.createdAt,
      intent.turnId,
    ],
  );
}

/** Clear the active intent (if any). */
export async function clear(): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM active_intent WHERE id = 1`);
}
