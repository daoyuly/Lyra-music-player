// agentRunsRepo — Phase 4
// Persistence layer for pi Agent event streams. Written by AgentRunSink on
// every start / record / end call. Read by the DataExplorer "Agent runtime" tab.

import { getDb } from "../client";

export type AgentRun = {
  id: string;
  turn_id: string;
  agent_kind: "emotion" | "companion";
  started_at: number;
  ended_at: number | null;
  stop_reason: "ok" | "sli_exceeded" | "error" | "aborted_by_user" | null;
  events_jsonl: string; // one JSON-stringified event per line
};

export type AgentRunEvent = { type: string; [k: string]: unknown };

export async function insertStart(run: {
  id: string;
  turn_id: string;
  agent_kind: "emotion" | "companion";
  started_at: number;
}): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO agent_runs (id, turn_id, agent_kind, started_at)
     VALUES (?, ?, ?, ?)`,
    [run.id, run.turn_id, run.agent_kind, run.started_at],
  );
}

/** Appends one JSONL row to events_jsonl. */
export async function appendEvent(
  runId: string,
  event: AgentRunEvent,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE agent_runs SET events_jsonl = events_jsonl || ? WHERE id = ?`,
    [JSON.stringify(event) + "\n", runId],
  );
}

export async function markEnded(
  runId: string,
  ended_at: number,
  stop_reason: string,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE agent_runs SET ended_at = ?, stop_reason = ? WHERE id = ?`,
    [ended_at, stop_reason, runId],
  );
}

export async function listRecent(limit: number): Promise<AgentRun[]> {
  const db = await getDb();
  return db.select<AgentRun[]>(
    `SELECT id, turn_id, agent_kind, started_at, ended_at, stop_reason, events_jsonl
     FROM agent_runs ORDER BY started_at DESC LIMIT ?`,
    [limit],
  );
}

/** Delete rows started_at < cutoffMs. Returns row count deleted. */
export async function purgeOlderThan(cutoffMs: number): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
    `DELETE FROM agent_runs WHERE started_at < ?`,
    [cutoffMs],
  );
  return result.rowsAffected;
}
