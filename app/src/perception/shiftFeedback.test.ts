import { describe, it, expect } from "vitest";
import {
  computeShiftStats,
  filterByWindow,
  bestPerformingShift,
  summarizeShiftStats,
} from "./shiftFeedback";
import type { ShiftFeedback } from "./shiftFeedback";
import type { Shift } from "../agents/shiftLogic";

function makeFeedback(
  shift: Shift,
  action: "complete" | "skip" | "proactive_dismiss",
  timestamp: number = Date.now(),
  timeToActionMs: number = 30_000,
): ShiftFeedback {
  return {
    turnId: `t-${Math.random().toString(36).slice(2, 8)}`,
    recommendedShift: shift,
    userAction: action,
    padAtTime: { p: 0, a: 0, d: 0 },
    timeToActionMs,
    timestamp,
  };
}

describe("shiftFeedback", () => {
  describe("computeShiftStats", () => {
    it("returns zero stats for empty feedback", () => {
      const stats = computeShiftStats([]);
      expect(stats).toHaveLength(4); // 4 shift types
      stats.forEach((s) => {
        expect(s.totalRecommendations).toBe(0);
        expect(s.completes).toBe(0);
        expect(s.skips).toBe(0);
        expect(s.successRate).toBe(0);
      });
    });

    it("computes success rate correctly", () => {
      const feedback = [
        makeFeedback("接住", "complete"),
        makeFeedback("接住", "complete"),
        makeFeedback("接住", "skip"),
      ];
      const stats = computeShiftStats(feedback);
      const 接住Stats = stats.find((s) => s.shift === "接住")!;
      expect(接住Stats.totalRecommendations).toBe(3);
      expect(接住Stats.completes).toBe(2);
      expect(接住Stats.skips).toBe(1);
      expect(接住Stats.successRate).toBeCloseTo(2 / 3, 3);
    });

    it("computes stats for all 4 shifts independently", () => {
      const feedback = [
        makeFeedback("接住", "complete"),
        makeFeedback("点燃", "skip"),
        makeFeedback("陪着", "complete"),
        makeFeedback("打断", "proactive_dismiss"),
      ];
      const stats = computeShiftStats(feedback);
      expect(stats.find((s) => s.shift === "接住")?.completes).toBe(1);
      expect(stats.find((s) => s.shift === "点燃")?.skips).toBe(1);
      expect(stats.find((s) => s.shift === "陪着")?.completes).toBe(1);
      expect(stats.find((s) => s.shift === "打断")?.dismisses).toBe(1);
    });

    it("computes average time to action correctly", () => {
      const feedback = [
        makeFeedback("接住", "complete", Date.now(), 60_000),
        makeFeedback("接住", "complete", Date.now(), 120_000),
        makeFeedback("接住", "skip", Date.now(), 10_000),
      ];
      const stats = computeShiftStats(feedback);
      const 接住Stats = stats.find((s) => s.shift === "接住")!;
      expect(接住Stats.avgTimeToComplete).toBe(90_000); // (60000 + 120000) / 2
      expect(接住Stats.avgTimeToSkip).toBe(10_000);
    });

    it("handles all skips (success rate 0)", () => {
      const feedback = [
        makeFeedback("点燃", "skip"),
        makeFeedback("点燃", "skip"),
      ];
      const stats = computeShiftStats(feedback);
      const 点燃Stats = stats.find((s) => s.shift === "点燃")!;
      expect(点燃Stats.successRate).toBe(0);
    });

    it("handles all completes (success rate 1)", () => {
      const feedback = [
        makeFeedback("陪着", "complete"),
        makeFeedback("陪着", "complete"),
      ];
      const stats = computeShiftStats(feedback);
      const 陪着Stats = stats.find((s) => s.shift === "陪着")!;
      expect(陪着Stats.successRate).toBe(1);
    });
  });

  describe("filterByWindow", () => {
    it("filters out records older than window", () => {
      const now = 1_000_000;
      const feedback = [
        makeFeedback("接住", "complete", now - 8 * 24 * 60 * 60 * 1000), // 8 days ago (out)
        makeFeedback("接住", "skip", now - 1 * 24 * 60 * 60 * 1000), // 1 day ago (in)
        makeFeedback("接住", "complete", now), // now (in)
      ];
      const windowMs = 7 * 24 * 60 * 60 * 1000; // 7 days
      const filtered = filterByWindow(feedback, windowMs, now);
      expect(filtered).toHaveLength(2);
    });

    it("returns all records when window is very large", () => {
      const now = 1_000_000;
      const feedback = [
        makeFeedback("接住", "complete", now - 500),
        makeFeedback("接住", "skip", now - 100),
      ];
      const filtered = filterByWindow(feedback, 100_000_000, now);
      expect(filtered).toHaveLength(2);
    });

    it("returns empty when all records are older than window", () => {
      const now = 1_000_000;
      const feedback = [
        makeFeedback("接住", "complete", 0),
      ];
      const filtered = filterByWindow(feedback, 1000, now);
      expect(filtered).toHaveLength(0);
    });
  });

  describe("bestPerformingShift", () => {
    it("returns null when insufficient data", () => {
      const feedback = [
        makeFeedback("接住", "complete"),
        makeFeedback("接住", "complete"),
      ]; // Only 2 records for '接住'
      expect(bestPerformingShift(feedback, 3)).toBeNull();
    });

    it("returns the shift with highest success rate", () => {
      const feedback = [
        // 接住: 100% success (3 completes)
        makeFeedback("接住", "complete"),
        makeFeedback("接住", "complete"),
        makeFeedback("接住", "complete"),
        // 点燃: 33% success (1 complete, 2 skips)
        makeFeedback("点燃", "complete"),
        makeFeedback("点燃", "skip"),
        makeFeedback("点燃", "skip"),
      ];
      expect(bestPerformingShift(feedback, 3)).toBe("接住");
    });

    it("returns null when no shift has enough samples", () => {
      const feedback = [
        makeFeedback("接住", "complete"),
        makeFeedback("点燃", "complete"),
      ];
      expect(bestPerformingShift(feedback, 5)).toBeNull();
    });
  });

  describe("summarizeShiftStats", () => {
    it("returns 'no data' message when empty", () => {
      const summary = summarizeShiftStats(computeShiftStats([]));
      expect(summary).toContain("no shift feedback");
    });

    it("formats each shift with success rate", () => {
      const feedback = [
        makeFeedback("接住", "complete"),
        makeFeedback("接住", "complete"),
        makeFeedback("接住", "skip"),
      ];
      const summary = summarizeShiftStats(computeShiftStats(feedback));
      expect(summary).toContain("接住");
      expect(summary).toContain("2/3");
      expect(summary).toContain("67%");
    });

    it("only includes shifts with data", () => {
      const feedback = [makeFeedback("陪着", "complete")];
      const summary = summarizeShiftStats(computeShiftStats(feedback));
      expect(summary).toContain("陪着");
      expect(summary).not.toContain("接住");
      expect(summary).not.toContain("点燃");
    });
  });
});
