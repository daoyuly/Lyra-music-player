/**
 * agents/shiftLogic.ts — Infer user's shift need from PAD + behavioral signals
 *
 * Based on the user's current emotional state and actions, deduce which of
 * the 4 shift types ("接住", "点燃", "陪着", "打断") they likely need.
 * This inference guides CompanionAgent's LLM call.
 */

import type { PAD } from "../types";

export type Shift = "接住" | "点燃" | "陪着" | "打断";

/**
 * Infer the emotional shift type based on PAD and behavioral signals.
 *
 * @param pad - Current PAD (pleasure, arousal, dominance)
 * @param confidence - Confidence in the PAD reading (0-1)
 * @param isBlurred - True if window is unfocused
 * @param skipRatio - Ratio of skips to total (skips + completions)
 * @param inputHesitation - "none" | "some" | "many"
 * @returns The recommended shift type
 */
export function inferShift(
  pad: PAD,
  confidence: number,
  isBlurred: boolean,
  skipRatio: number,
  inputHesitation: "none" | "some" | "many",
): Shift {
  // 接住 (comfort/hold): user needs accompaniment, reassurance
  // Triggered by: low arousal + high hesitation + offline/blurred
  if (pad.a < -0.2 && inputHesitation !== "none" && isBlurred) {
    return "接住";
  }

  // 点燃 (energize): user needs stimulation, motivation
  // Triggered by: low arousal + high skip ratio (rejecting current recommendations)
  if (pad.a < 0 && skipRatio > 0.5 && confidence > 0.3) {
    return "点燃";
  }

  // 打断 (interrupt): user is caught in a loop, needs disruption
  // Triggered by: high arousal + sustained focus + low skip ratio (stuck pattern)
  if (pad.a > 0.3 && !isBlurred && skipRatio < 0.2 && confidence > 0.4) {
    return "打断";
  }

  // 陪着 (accompany): default — go with the user's current mood
  return "陪着";
}

/**
 * Compute a shift confidence score (0-1) indicating how certain the
 * inference is. Used by CompanionAgent to decide how strongly to suggest the shift to LLM.
 */
export function getShiftConfidence(
  pad: PAD,
  confidence: number,
  isBlurred: boolean,
  skipRatio: number,
  inputHesitation: "none" | "some" | "many",
): number {
  let score = confidence; // Start with PAD confidence

  // 接住: hesitation + offline is a strong signal
  if (pad.a < -0.2 && inputHesitation === "many" && isBlurred) {
    score = Math.min(1, score + 0.3);
  }

  // 点燃: high skip ratio is a strong rejection signal
  if (skipRatio > 0.7 && pad.a < -0.1) {
    score = Math.min(1, score + 0.25);
  }

  // 打断: sustained high arousal + focus is a clear pattern
  if (pad.a > 0.4 && !isBlurred && skipRatio < 0.1) {
    score = Math.min(1, score + 0.2);
  }

  return Math.max(0, Math.min(1, score));
}

/**
 * Return a natural language description of the shift recommendation for debugging.
 */
export function describeShift(shift: Shift, confidence: number): string {
  const conf = (confidence * 100).toFixed(0);
  return `${shift} (confidence: ${conf}%)`;
}
