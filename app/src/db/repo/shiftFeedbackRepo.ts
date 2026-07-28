/**
 * db/repo/shiftFeedbackRepo — Sprint 17
 *
 * Persist ShiftFeedback records (turn + shift + user action + PAD + timing)
 * so ReflectAgent can learn shift effectiveness across sessions.
 */

import { getDb } from "../client";
import type { Shift } from "../../agents/shiftLogic";
import type { ShiftFeedback } from "../../perception/shiftFeedback";

export type ShiftFeedbackRow = {
  id: number;
  turn_id: string;
  ts: number;
  shift: string;
  user_action: string;
  pad_p: number;
  pad_a: number;
  pad_d: number;
  time_to_action_ms: number;
};

/** Rolling cap. Prevents unbounded table growth. */
export const MAX_ROWS = 500;

export async function insert(feedback: ShiftFeedback): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO shift_feedback
       (turn_id, ts, shift, user_action, pad_p, pad_a, pad_d, time_to_action_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      feedback.turnId,
      feedback.timestamp,
      feedback.recommendedShift,
      feedback.userAction,
      feedback.padAtTime.p,
      feedback.padAtTime.a,
      feedback.padAtTime.d,
      feedback.timeToActionMs,
    ],
  );
  // Cheap prune — DELETE the oldest rows beyond MAX_ROWS.
  await db.execute(
    `DELETE FROM shift_feedback WHERE id IN (
       SELECT id FROM shift_feedback ORDER BY ts DESC LIMIT -1 OFFSET ?
     )`,
    [MAX_ROWS],
  );
}

export async function listRecent(limit: number): Promise<ShiftFeedback[]> {
  const db = await getDb();
  const rows = await db.select<ShiftFeedbackRow[]>(
    `SELECT id, turn_id, ts, shift, user_action, pad_p, pad_a, pad_d, time_to_action_ms
     FROM shift_feedback ORDER BY ts DESC LIMIT ?`,
    [limit],
  );
  return rows.map(rowToFeedback);
}

export async function listByWindow(cutoffMs: number): Promise<ShiftFeedback[]> {
  const db = await getDb();
  const rows = await db.select<ShiftFeedbackRow[]>(
    `SELECT id, turn_id, ts, shift, user_action, pad_p, pad_a, pad_d, time_to_action_ms
     FROM shift_feedback WHERE ts >= ? ORDER BY ts ASC`,
    [cutoffMs],
  );
  return rows.map(rowToFeedback);
}

function rowToFeedback(r: ShiftFeedbackRow): ShiftFeedback {
  return {
    turnId: r.turn_id,
    recommendedShift: r.shift as Shift,
    userAction: r.user_action as ShiftFeedback["userAction"],
    padAtTime: { p: r.pad_p, a: r.pad_a, d: r.pad_d },
    timeToActionMs: r.time_to_action_ms,
    timestamp: r.ts,
  };
}
