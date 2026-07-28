/**
 * perception/emotionTimelineFromAudit.ts — Build EmotionTimeline from
 * persisted perception_audit rows.
 *
 * Bridges the storage layer (perception_audit table) to the analysis layer
 * (emotionTimeline). Handles JSON parsing safely — silently skips malformed
 * rows so a single bad row can't break the timeline.
 *
 * Sprint 15 Task 2
 */

import type { PerceptionAuditRow } from "../db/repo/perceptionAuditRepo";
import type { EmotionSnapshot, EmotionTimeline, EmotionTimelineWindow } from "./emotionTimeline";
import { buildTimeline } from "./emotionTimeline";

/**
 * Extract PAD + confidence from an audit row's bias_json.
 * Returns null if the JSON is malformed or missing required fields.
 */
export function parseAuditSnapshot(row: PerceptionAuditRow): EmotionSnapshot | null {
  try {
    const bias = JSON.parse(row.bias_json) as {
      pad_bias?: { p?: number; a?: number; d?: number };
      confidence?: number;
    };
    const pad = bias.pad_bias;
    if (
      !pad ||
      typeof pad.p !== "number" ||
      typeof pad.a !== "number" ||
      typeof pad.d !== "number"
    ) {
      return null;
    }
    const confidence = typeof bias.confidence === "number" ? bias.confidence : 0.5;
    return {
      at: row.ts,
      pad: { p: pad.p, a: pad.a, d: pad.d },
      confidence,
    };
  } catch {
    return null;
  }
}

/**
 * Convert a list of audit rows into snapshots, dropping malformed ones.
 */
export function auditRowsToSnapshots(rows: PerceptionAuditRow[]): EmotionSnapshot[] {
  const out: EmotionSnapshot[] = [];
  for (const row of rows) {
    const snap = parseAuditSnapshot(row);
    if (snap) out.push(snap);
  }
  return out;
}

/**
 * End-to-end: audit rows → EmotionTimeline for a given window.
 */
export function buildTimelineFromAudit(
  rows: PerceptionAuditRow[],
  window: EmotionTimelineWindow,
  now?: number,
): EmotionTimeline {
  const snapshots = auditRowsToSnapshots(rows);
  return buildTimeline(snapshots, window, now);
}
