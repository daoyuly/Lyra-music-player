// productEventsRepo — Iter Phase 0.1
// Local-only product analytics events. Never uploaded. Written fire-and-forget
// via record(). Read by the DataExplorer "产品埋点" tab and by future Iter phases.

import { getDb } from "../client";

export type ProductEvent = {
  id: string;
  ts: number;
  kind: string;
  payload_json: string;
};

/** Record one analytics event. Fire-and-forget safe: caller may use
 *  `void record(...).catch((e) => console.warn(e))`. */
export async function record(
  kind: string,
  payload: Record<string, unknown> = {},
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO product_events (id, ts, kind, payload_json) VALUES (?, ?, ?, ?)`,
    [crypto.randomUUID(), Date.now(), kind, JSON.stringify(payload)],
  );
}

/** Count events of `kind` recorded at or after `since` (Unix ms). */
export async function count(kind: string, since: number): Promise<number> {
  const db = await getDb();
  const rows = await db.select<[{ n: number }]>(
    `SELECT COUNT(*) AS n FROM product_events WHERE kind = ? AND ts >= ?`,
    [kind, since],
  );
  return rows[0]?.n ?? 0;
}

/** Most recent `limit` events of a specific kind (newest first). */
export async function listByKind(
  kind: string,
  limit: number,
): Promise<ProductEvent[]> {
  const db = await getDb();
  return db.select<ProductEvent[]>(
    `SELECT id, ts, kind, payload_json FROM product_events
     WHERE kind = ? ORDER BY ts DESC LIMIT ?`,
    [kind, limit],
  );
}

/** Most recent `limit` events across all kinds (newest first). DataExplorer use. */
export async function listRecent(limit: number): Promise<ProductEvent[]> {
  const db = await getDb();
  return db.select<ProductEvent[]>(
    `SELECT id, ts, kind, payload_json FROM product_events
     ORDER BY ts DESC LIMIT ?`,
    [limit],
  );
}

/** Delete events with ts < cutoffMs. Returns number of rows deleted. */
export async function purgeOlderThan(cutoffMs: number): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
    `DELETE FROM product_events WHERE ts < ?`,
    [cutoffMs],
  );
  return result.rowsAffected;
}
