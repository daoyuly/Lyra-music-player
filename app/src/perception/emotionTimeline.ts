/**
 * perception/emotionTimeline.ts — Long-term PAD trajectory analysis
 *
 * Given a list of PAD snapshots over time, computes trends (improving/
 * declining/stable) and aggregate summaries for 7d/30d/1y windows.
 * Used by CompanionAgent to understand the user's long-term emotional arc.
 *
 * Sprint 14 Task 5
 */

import type { PAD } from "../types";

export type EmotionSnapshot = {
  at: number; // Unix ms timestamp
  pad: PAD;
  confidence: number;
};

export type EmotionTrend = "improving" | "declining" | "stable";

export type EmotionTimelineWindow = "7d" | "30d" | "1y";

export type EmotionTimeline = {
  window: EmotionTimelineWindow;
  sampleCount: number;
  avgPad: PAD;
  pleasureTrend: EmotionTrend;
  arousalTrend: EmotionTrend;
  dominanceTrend: EmotionTrend;
  volatility: number; // 0-1, higher = more mood swings
  firstSampleAt: number | null;
  lastSampleAt: number | null;
};

const WINDOW_MS: Record<EmotionTimelineWindow, number> = {
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
  "1y": 365 * 24 * 60 * 60 * 1000,
};

const TREND_THRESHOLD = 0.15; // Slope > 0.15 (in PAD units per window) = trend

/**
 * Filter snapshots to a specific window.
 */
export function filterToWindow(
  snapshots: EmotionSnapshot[],
  window: EmotionTimelineWindow,
  now: number = Date.now(),
): EmotionSnapshot[] {
  const cutoff = now - WINDOW_MS[window];
  return snapshots.filter((s) => s.at >= cutoff);
}

/**
 * Compute average PAD across snapshots (weighted by confidence).
 */
export function averagePad(snapshots: EmotionSnapshot[]): PAD {
  if (snapshots.length === 0) return { p: 0, a: 0, d: 0 };

  let totalWeight = 0;
  let sumP = 0;
  let sumA = 0;
  let sumD = 0;

  for (const s of snapshots) {
    const w = Math.max(0.01, s.confidence); // Ensure non-zero weight
    totalWeight += w;
    sumP += s.pad.p * w;
    sumA += s.pad.a * w;
    sumD += s.pad.d * w;
  }

  return {
    p: sumP / totalWeight,
    a: sumA / totalWeight,
    d: sumD / totalWeight,
  };
}

/**
 * Determine trend for a single PAD dimension using linear regression slope.
 */
function trendForDimension(
  snapshots: EmotionSnapshot[],
  getValue: (pad: PAD) => number,
): EmotionTrend {
  if (snapshots.length < 3) return "stable"; // Need at least 3 points

  // Simple linear regression: y = mx + b
  // Normalize x to [0, 1] range across the window
  const times = snapshots.map((s) => s.at);
  const minT = Math.min(...times);
  const maxT = Math.max(...times);
  const range = maxT - minT || 1;

  const points = snapshots.map((s) => ({
    x: (s.at - minT) / range,
    y: getValue(s.pad),
  }));

  const meanX = points.reduce((sum, p) => sum + p.x, 0) / points.length;
  const meanY = points.reduce((sum, p) => sum + p.y, 0) / points.length;

  let numerator = 0;
  let denominator = 0;
  for (const p of points) {
    numerator += (p.x - meanX) * (p.y - meanY);
    denominator += (p.x - meanX) ** 2;
  }

  const slope = denominator === 0 ? 0 : numerator / denominator;

  if (slope > TREND_THRESHOLD) return "improving";
  if (slope < -TREND_THRESHOLD) return "declining";
  return "stable";
}

/**
 * Compute volatility (standard deviation of PAD magnitude) as a 0-1 score.
 */
export function computeVolatility(snapshots: EmotionSnapshot[]): number {
  if (snapshots.length < 2) return 0;

  const magnitudes = snapshots.map((s) =>
    Math.sqrt(s.pad.p ** 2 + s.pad.a ** 2 + s.pad.d ** 2),
  );
  const mean = magnitudes.reduce((sum, m) => sum + m, 0) / magnitudes.length;
  const variance =
    magnitudes.reduce((sum, m) => sum + (m - mean) ** 2, 0) / magnitudes.length;
  const stdDev = Math.sqrt(variance);

  // Normalize: max theoretical stdDev is ~1 (PAD is bounded [-1, 1])
  return Math.min(1, stdDev);
}

/**
 * Build a complete EmotionTimeline for a given window.
 */
export function buildTimeline(
  snapshots: EmotionSnapshot[],
  window: EmotionTimelineWindow,
  now: number = Date.now(),
): EmotionTimeline {
  const filtered = filterToWindow(snapshots, window, now);

  if (filtered.length === 0) {
    return {
      window,
      sampleCount: 0,
      avgPad: { p: 0, a: 0, d: 0 },
      pleasureTrend: "stable",
      arousalTrend: "stable",
      dominanceTrend: "stable",
      volatility: 0,
      firstSampleAt: null,
      lastSampleAt: null,
    };
  }

  const times = filtered.map((s) => s.at);
  return {
    window,
    sampleCount: filtered.length,
    avgPad: averagePad(filtered),
    pleasureTrend: trendForDimension(filtered, (p) => p.p),
    arousalTrend: trendForDimension(filtered, (p) => p.a),
    dominanceTrend: trendForDimension(filtered, (p) => p.d),
    volatility: computeVolatility(filtered),
    firstSampleAt: Math.min(...times),
    lastSampleAt: Math.max(...times),
  };
}

/**
 * Format an EmotionTimeline as a human-readable summary for LLM prompts.
 */
export function summarizeTimeline(timeline: EmotionTimeline): string {
  if (timeline.sampleCount === 0) {
    return `${timeline.window} 窗口: 无数据`;
  }

  const pad = timeline.avgPad;
  const parts = [
    `${timeline.window} 窗口 (${timeline.sampleCount} 样本):`,
    `平均 PAD=(p=${pad.p.toFixed(2)}, a=${pad.a.toFixed(2)}, d=${pad.d.toFixed(2)})`,
    `愉悦度: ${timeline.pleasureTrend}`,
    `兴奋度: ${timeline.arousalTrend}`,
    `波动性: ${(timeline.volatility * 100).toFixed(0)}%`,
  ];
  return parts.join(" · ");
}
