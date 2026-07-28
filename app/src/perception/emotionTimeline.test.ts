import { describe, it, expect } from "vitest";
import {
  filterToWindow,
  averagePad,
  computeVolatility,
  buildTimeline,
  summarizeTimeline,
} from "./emotionTimeline";
import type { EmotionSnapshot } from "./emotionTimeline";

function snap(at: number, p: number, a: number, d: number, confidence = 0.5): EmotionSnapshot {
  return { at, pad: { p, a, d }, confidence };
}

const DAY = 24 * 60 * 60 * 1000;

describe("emotionTimeline", () => {
  describe("filterToWindow", () => {
    it("filters snapshots within 7d window", () => {
      const now = 100 * DAY;
      const snapshots = [
        snap(now - 10 * DAY, 0.1, 0.1, 0), // out of window
        snap(now - 5 * DAY, 0.2, 0.2, 0), // in 7d
        snap(now - 1 * DAY, 0.3, 0.3, 0), // in 7d
      ];
      const filtered = filterToWindow(snapshots, "7d", now);
      expect(filtered).toHaveLength(2);
    });

    it("includes all snapshots for 30d window", () => {
      const now = 100 * DAY;
      const snapshots = [
        snap(now - 25 * DAY, 0.1, 0.1, 0),
        snap(now - 5 * DAY, 0.2, 0.2, 0),
      ];
      const filtered = filterToWindow(snapshots, "30d", now);
      expect(filtered).toHaveLength(2);
    });

    it("handles 1y window correctly", () => {
      const now = 500 * DAY;
      const snapshots = [
        snap(now - 400 * DAY, 0.1, 0.1, 0), // out of 1y
        snap(now - 200 * DAY, 0.2, 0.2, 0), // in 1y
      ];
      const filtered = filterToWindow(snapshots, "1y", now);
      expect(filtered).toHaveLength(1);
    });

    it("returns empty for no matching snapshots", () => {
      const snapshots = [snap(1000, 0.1, 0.1, 0)];
      const filtered = filterToWindow(snapshots, "7d", 100 * DAY);
      expect(filtered).toHaveLength(0);
    });
  });

  describe("averagePad", () => {
    it("returns zero PAD for empty snapshots", () => {
      const avg = averagePad([]);
      expect(avg).toEqual({ p: 0, a: 0, d: 0 });
    });

    it("computes weighted average by confidence", () => {
      const snapshots = [
        snap(0, 1, 0, 0, 0.5),
        snap(1, 0, 1, 0, 0.5),
      ];
      const avg = averagePad(snapshots);
      expect(avg.p).toBeCloseTo(0.5, 2);
      expect(avg.a).toBeCloseTo(0.5, 2);
    });

    it("gives more weight to higher-confidence snapshots", () => {
      const snapshots = [
        snap(0, 1, 0, 0, 0.9), // high confidence
        snap(1, -1, 0, 0, 0.1), // low confidence
      ];
      const avg = averagePad(snapshots);
      expect(avg.p).toBeGreaterThan(0.5); // Weighted toward 1
    });
  });

  describe("computeVolatility", () => {
    it("returns 0 for single snapshot", () => {
      expect(computeVolatility([snap(0, 0.5, 0.5, 0)])).toBe(0);
    });

    it("returns 0 for consistent snapshots", () => {
      const snapshots = [
        snap(0, 0.5, 0.5, 0),
        snap(1, 0.5, 0.5, 0),
        snap(2, 0.5, 0.5, 0),
      ];
      expect(computeVolatility(snapshots)).toBeCloseTo(0, 3);
    });

    it("returns high value for variable snapshots", () => {
      const snapshots = [
        snap(0, 0.9, 0.9, 0.9),
        snap(1, -0.9, -0.9, -0.9),
        snap(2, 0.9, 0.9, 0.9),
      ];
      const volatility = computeVolatility(snapshots);
      expect(volatility).toBeGreaterThan(0);
    });

    it("clamps volatility to [0, 1]", () => {
      const snapshots = [
        snap(0, 1, 1, 1),
        snap(1, -1, -1, -1),
      ];
      const volatility = computeVolatility(snapshots);
      expect(volatility).toBeLessThanOrEqual(1);
      expect(volatility).toBeGreaterThanOrEqual(0);
    });
  });

  describe("buildTimeline", () => {
    const now = 100 * DAY;

    it("returns empty timeline for no data", () => {
      const timeline = buildTimeline([], "7d", now);
      expect(timeline.sampleCount).toBe(0);
      expect(timeline.avgPad).toEqual({ p: 0, a: 0, d: 0 });
      expect(timeline.pleasureTrend).toBe("stable");
      expect(timeline.firstSampleAt).toBeNull();
    });

    it("detects 'improving' pleasure trend", () => {
      const snapshots = [
        snap(now - 6 * DAY, -0.3, 0, 0),
        snap(now - 4 * DAY, -0.1, 0, 0),
        snap(now - 2 * DAY, 0.2, 0, 0),
        snap(now, 0.5, 0, 0),
      ];
      const timeline = buildTimeline(snapshots, "7d", now);
      expect(timeline.pleasureTrend).toBe("improving");
    });

    it("detects 'declining' arousal trend", () => {
      const snapshots = [
        snap(now - 6 * DAY, 0, 0.5, 0),
        snap(now - 4 * DAY, 0, 0.3, 0),
        snap(now - 2 * DAY, 0, 0, 0),
        snap(now, 0, -0.3, 0),
      ];
      const timeline = buildTimeline(snapshots, "7d", now);
      expect(timeline.arousalTrend).toBe("declining");
    });

    it("detects 'stable' trend for consistent values", () => {
      const snapshots = [
        snap(now - 6 * DAY, 0.2, 0.2, 0.2),
        snap(now - 4 * DAY, 0.21, 0.19, 0.2),
        snap(now - 2 * DAY, 0.19, 0.21, 0.19),
        snap(now, 0.2, 0.2, 0.21),
      ];
      const timeline = buildTimeline(snapshots, "7d", now);
      expect(timeline.pleasureTrend).toBe("stable");
      expect(timeline.arousalTrend).toBe("stable");
    });

    it("returns 'stable' when insufficient data (< 3 points)", () => {
      const snapshots = [
        snap(now - 2 * DAY, 0, 0, 0),
        snap(now, 1, 1, 1),
      ];
      const timeline = buildTimeline(snapshots, "7d", now);
      expect(timeline.pleasureTrend).toBe("stable"); // Not enough data
    });

    it("sets firstSampleAt and lastSampleAt correctly", () => {
      const snapshots = [
        snap(now - 5 * DAY, 0, 0, 0),
        snap(now - 3 * DAY, 0, 0, 0),
        snap(now - 1 * DAY, 0, 0, 0),
      ];
      const timeline = buildTimeline(snapshots, "7d", now);
      expect(timeline.firstSampleAt).toBe(now - 5 * DAY);
      expect(timeline.lastSampleAt).toBe(now - 1 * DAY);
    });
  });

  describe("summarizeTimeline", () => {
    it("returns 'no data' for empty timeline", () => {
      const timeline = buildTimeline([], "7d");
      const summary = summarizeTimeline(timeline);
      expect(summary).toContain("无数据");
    });

    it("includes sample count and PAD averages", () => {
      const now = 100 * DAY;
      const snapshots = [
        snap(now - 3 * DAY, 0.3, 0.2, 0.1),
        snap(now - 2 * DAY, 0.3, 0.2, 0.1),
        snap(now - 1 * DAY, 0.3, 0.2, 0.1),
      ];
      const timeline = buildTimeline(snapshots, "7d", now);
      const summary = summarizeTimeline(timeline);
      expect(summary).toContain("3 样本");
      expect(summary).toContain("0.30");
      expect(summary).toContain("愉悦度");
      expect(summary).toContain("兴奋度");
    });

    it("formats volatility as percentage", () => {
      const now = 100 * DAY;
      const snapshots = [
        snap(now - 3 * DAY, 0.9, 0.9, 0.9),
        snap(now - 2 * DAY, -0.9, -0.9, -0.9),
        snap(now - 1 * DAY, 0.9, 0.9, 0.9),
      ];
      const timeline = buildTimeline(snapshots, "7d", now);
      const summary = summarizeTimeline(timeline);
      expect(summary).toMatch(/波动性: \d+%/);
    });
  });
});
