import { describe, it, expect } from "vitest";
import {
  parseAuditSnapshot,
  auditRowsToSnapshots,
  buildTimelineFromAudit,
} from "./emotionTimelineFromAudit";
import type { PerceptionAuditRow } from "../db/repo/perceptionAuditRepo";

function makeRow(ts: number, bias: unknown): PerceptionAuditRow {
  return {
    id: `r-${ts}`,
    ts,
    source: "rule",
    features_json: "{}",
    bias_json: JSON.stringify(bias),
  };
}

const DAY = 24 * 60 * 60 * 1000;

describe("emotionTimelineFromAudit", () => {
  describe("parseAuditSnapshot", () => {
    it("extracts valid PAD + confidence from bias_json", () => {
      const row = makeRow(1000, {
        pad_bias: { p: 0.2, a: -0.1, d: 0.05 },
        confidence: 0.6,
        reason: "test",
      });
      const snap = parseAuditSnapshot(row);
      expect(snap).toEqual({
        at: 1000,
        pad: { p: 0.2, a: -0.1, d: 0.05 },
        confidence: 0.6,
      });
    });

    it("uses default confidence of 0.5 when missing", () => {
      const row = makeRow(1000, {
        pad_bias: { p: 0, a: 0, d: 0 },
      });
      expect(parseAuditSnapshot(row)?.confidence).toBe(0.5);
    });

    it("returns null for malformed JSON", () => {
      const row: PerceptionAuditRow = {
        id: "r-bad",
        ts: 100,
        source: "rule",
        features_json: "{}",
        bias_json: "not json at all",
      };
      expect(parseAuditSnapshot(row)).toBeNull();
    });

    it("returns null when pad_bias missing", () => {
      const row = makeRow(1000, { confidence: 0.5 });
      expect(parseAuditSnapshot(row)).toBeNull();
    });

    it("returns null when pad values are not numbers", () => {
      const row = makeRow(1000, {
        pad_bias: { p: "high", a: 0, d: 0 },
      });
      expect(parseAuditSnapshot(row)).toBeNull();
    });
  });

  describe("auditRowsToSnapshots", () => {
    it("converts multiple valid rows", () => {
      const rows = [
        makeRow(100, { pad_bias: { p: 0.1, a: 0, d: 0 }, confidence: 0.5 }),
        makeRow(200, { pad_bias: { p: 0.2, a: 0, d: 0 }, confidence: 0.6 }),
      ];
      const snapshots = auditRowsToSnapshots(rows);
      expect(snapshots).toHaveLength(2);
      expect(snapshots[0].pad.p).toBe(0.1);
      expect(snapshots[1].pad.p).toBe(0.2);
    });

    it("silently drops malformed rows", () => {
      const rows = [
        makeRow(100, { pad_bias: { p: 0.1, a: 0, d: 0 }, confidence: 0.5 }),
        {
          id: "bad",
          ts: 200,
          source: "rule" as const,
          features_json: "{}",
          bias_json: "corrupted",
        },
        makeRow(300, { pad_bias: { p: 0.3, a: 0, d: 0 }, confidence: 0.7 }),
      ];
      const snapshots = auditRowsToSnapshots(rows);
      expect(snapshots).toHaveLength(2); // Bad row dropped
    });

    it("returns empty array for no valid rows", () => {
      const rows = [
        {
          id: "bad-1",
          ts: 100,
          source: "rule" as const,
          features_json: "{}",
          bias_json: "junk",
        },
      ];
      expect(auditRowsToSnapshots(rows)).toEqual([]);
    });
  });

  describe("buildTimelineFromAudit", () => {
    const now = 100 * DAY;

    it("builds a 7d timeline from audit rows", () => {
      const rows = [
        makeRow(now - 6 * DAY, { pad_bias: { p: -0.3, a: 0, d: 0 }, confidence: 0.5 }),
        makeRow(now - 4 * DAY, { pad_bias: { p: -0.1, a: 0, d: 0 }, confidence: 0.5 }),
        makeRow(now - 2 * DAY, { pad_bias: { p: 0.2, a: 0, d: 0 }, confidence: 0.5 }),
        makeRow(now, { pad_bias: { p: 0.5, a: 0, d: 0 }, confidence: 0.5 }),
      ];
      const timeline = buildTimelineFromAudit(rows, "7d", now);
      expect(timeline.sampleCount).toBe(4);
      expect(timeline.pleasureTrend).toBe("improving"); // -0.3 → 0.5
    });

    it("handles empty audit rows", () => {
      const timeline = buildTimelineFromAudit([], "30d", now);
      expect(timeline.sampleCount).toBe(0);
      expect(timeline.pleasureTrend).toBe("stable");
    });

    it("filters rows outside the window", () => {
      const rows = [
        makeRow(now - 30 * DAY, { pad_bias: { p: 0, a: 0, d: 0 }, confidence: 0.5 }), // out of 7d
        makeRow(now - 3 * DAY, { pad_bias: { p: 0, a: 0, d: 0 }, confidence: 0.5 }), // in
      ];
      const timeline = buildTimelineFromAudit(rows, "7d", now);
      expect(timeline.sampleCount).toBe(1);
    });
  });
});
