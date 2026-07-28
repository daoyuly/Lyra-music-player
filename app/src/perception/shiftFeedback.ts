/**
 * perception/shiftFeedback.ts — Track and analyze shift recommendation effectiveness
 *
 * Records each shift recommendation + user's actual reaction (skip/complete).
 * Provides statistics for ReflectAgent to learn which shifts work best in
 * various contexts.
 *
 * Sprint 14 Task 4
 */

import type { PAD } from "../types";
import type { Shift } from "../agents/shiftLogic";

export type UserAction = "complete" | "skip" | "proactive_dismiss";

export type ShiftFeedback = {
  turnId: string;
  recommendedShift: Shift;
  userAction: UserAction;
  padAtTime: PAD;
  timeToActionMs: number; // Time from song start to skip/complete
  timestamp: number;
};

export type ShiftStats = {
  shift: Shift;
  totalRecommendations: number;
  completes: number;
  skips: number;
  dismisses: number;
  successRate: number; // completes / (completes + skips + dismisses)
  avgTimeToComplete: number; // ms
  avgTimeToSkip: number; // ms
};

const SHIFTS: Shift[] = ["接住", "点燃", "陪着", "打断"];

/**
 * Compute aggregated statistics per shift type.
 *
 * @param feedback - List of ShiftFeedback records (from any source)
 * @returns Statistics for each of the 4 shift types
 */
export function computeShiftStats(feedback: ShiftFeedback[]): ShiftStats[] {
  return SHIFTS.map((shift) => {
    const records = feedback.filter((f) => f.recommendedShift === shift);
    const completes = records.filter((f) => f.userAction === "complete");
    const skips = records.filter((f) => f.userAction === "skip");
    const dismisses = records.filter((f) => f.userAction === "proactive_dismiss");
    const total = records.length;
    const successRate = total > 0 ? completes.length / total : 0;

    const avgTimeToComplete =
      completes.length > 0
        ? completes.reduce((sum, f) => sum + f.timeToActionMs, 0) / completes.length
        : 0;
    const avgTimeToSkip =
      skips.length > 0
        ? skips.reduce((sum, f) => sum + f.timeToActionMs, 0) / skips.length
        : 0;

    return {
      shift,
      totalRecommendations: total,
      completes: completes.length,
      skips: skips.length,
      dismisses: dismisses.length,
      successRate,
      avgTimeToComplete,
      avgTimeToSkip,
    };
  });
}

/**
 * Filter feedback by time window.
 *
 * @param feedback - All feedback records
 * @param windowMs - Time window in milliseconds (e.g., 7 * 24 * 60 * 60 * 1000 for 7 days)
 * @param now - Current timestamp (default: Date.now())
 */
export function filterByWindow(
  feedback: ShiftFeedback[],
  windowMs: number,
  now?: number,
): ShiftFeedback[] {
  const currentTs = now ?? Date.now();
  const cutoff = currentTs - windowMs;
  return feedback.filter((f) => f.timestamp >= cutoff);
}

/**
 * Recommend the best shift based on historical success rates.
 * Returns null if there's insufficient data (< 3 samples per shift).
 *
 * @param feedback - Historical feedback records
 * @param minSamplesPerShift - Minimum samples required per shift (default: 3)
 * @returns The shift with highest success rate, or null if inconclusive
 */
export function bestPerformingShift(
  feedback: ShiftFeedback[],
  minSamplesPerShift: number = 3,
): Shift | null {
  const stats = computeShiftStats(feedback);
  const qualifying = stats.filter((s) => s.totalRecommendations >= minSamplesPerShift);
  if (qualifying.length === 0) return null;

  const best = qualifying.reduce((a, b) => (a.successRate >= b.successRate ? a : b));
  return best.shift;
}

/**
 * Format shift stats as a human-readable summary for ReflectAgent context.
 *
 * @param stats - Computed shift statistics
 * @returns Multi-line string summary
 */
export function summarizeShiftStats(stats: ShiftStats[]): string {
  const lines = stats
    .filter((s) => s.totalRecommendations > 0)
    .map((s) => {
      const rate = (s.successRate * 100).toFixed(0);
      return `${s.shift}: ${s.completes}/${s.totalRecommendations} (${rate}% success)`;
    });
  return lines.length > 0 ? lines.join("; ") : "no shift feedback data yet";
}
