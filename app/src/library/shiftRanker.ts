/**
 * library/shiftRanker.ts — Rank candidate songs by shift affinity
 *
 * Given a shift type (接住/点燃/陪着/打断) and user's current PAD,
 * score and re-rank candidate songs so the best matches come first.
 * Ranking uses heuristics based on available metadata (bpm, tags, etc).
 *
 * Sprint 14 Task 3
 */

import type { LibraryTrack, PAD } from "../types";

export type Shift = "接住" | "点燃" | "陪着" | "打断";

/**
 * Compute a shift-affinity score for a single track.
 * Higher score = better match for the given shift.
 *
 * @param track - Candidate track
 * @param shift - Target shift type
 * @param pad - User's current PAD
 * @returns Score in range [0, 100]
 */
export function scoreTrackForShift(
  track: LibraryTrack,
  shift: Shift,
  pad: PAD,
): number {
  let score = 50; // Base score (neutral)

  // Extract heuristic features from metadata
  // In a real system, these would come from TrackFeatures DB
  const meta = track.metadata ?? {};
  const bpm = typeof meta.bpm === "number" ? meta.bpm : 120;
  const mood = typeof meta.mood === "string" ? meta.mood : "neutral";
  const genre = typeof meta.genre === "string" ? meta.genre : "unknown";
  const tags = Array.isArray(meta.tags) ? meta.tags : [];

  // 接住 (comfort): low energy, acoustic, calming moods
  if (shift === "接住") {
    if (bpm < 90) score += 15; // Slow songs are comforting
    if (mood === "calm" || mood === "melancholic" || mood === "introspective") score += 15;
    if (genre === "folk" || genre === "acoustic" || genre === "piano") score += 10;
    if (tags.includes("acoustic") || tags.includes("slow")) score += 10;
    // Negative: avoid high energy
    if (bpm > 140) score -= 20;
    if (mood === "energetic" || mood === "aggressive") score -= 15;
  }

  // 点燃 (energize): high energy, upbeat, motivating
  if (shift === "点燃") {
    if (bpm > 120) score += 15; // Fast tempo energizes
    if (mood === "energetic" || mood === "uplifting" || mood === "aggressive") score += 15;
    if (genre === "electronic" || genre === "rock" || genre === "pop") score += 10;
    if (tags.includes("energetic") || tags.includes("fast") || tags.includes("uplifting"))
      score += 10;
    // Negative: avoid slow/sad
    if (bpm < 80) score -= 15;
    if (mood === "melancholic" || mood === "sad") score -= 15;
  }

  // 陪着 (accompany): balanced, medium tempo, neutral mood
  if (shift === "陪着") {
    if (bpm >= 90 && bpm <= 130) score += 15; // Medium tempo
    if (mood === "neutral" || mood === "calm" || mood === "uplifting") score += 10;
    if (genre === "indie" || genre === "alternative" || genre === "soul") score += 8;
    // Less preference for extremes
    if (bpm < 70 || bpm > 150) score -= 8;
  }

  // 打断 (interrupt): unexpected, unique, contrast with current state
  if (shift === "打断") {
    // Prefer music that contrasts with current PAD
    if (pad.a < -0.2 && (mood === "energetic" || bpm > 130)) score += 15; // Contrast to low arousal
    if (pad.p < -0.2 && (mood === "uplifting" || mood === "energetic")) score += 12; // Contrast to low pleasure
    // Prefer unusual genres/tags
    if (
      genre === "experimental" ||
      genre === "ambient" ||
      genre === "noise" ||
      tags.includes("unconventional")
    )
      score += 12;
    // Avoid safe/generic
    if (genre === "pop" || genre === "mainstream") score -= 8;
  }

  // Ensure score stays in bounds
  return Math.max(0, Math.min(100, score));
}

/**
 * Rank candidates by shift affinity.
 * Returns a new array sorted by score (highest first).
 *
 * @param candidates - List of candidate tracks
 * @param shift - Target shift type
 * @param pad - User's current PAD for context
 * @returns Re-ranked candidates
 */
export function rankByShift(
  candidates: LibraryTrack[],
  shift: Shift,
  pad: PAD,
): LibraryTrack[] {
  const scored = candidates.map((track) => ({
    track,
    score: scoreTrackForShift(track, shift, pad),
  }));

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  return scored.map((item) => item.track);
}

/**
 * Get a human-readable explanation for a track's score.
 * (Useful for debugging/tracing)
 */
export function explainScore(
  track: LibraryTrack,
  shift: Shift,
  pad: PAD,
): string {
  const score = scoreTrackForShift(track, shift, pad);
  const meta = track.metadata ?? {};
  const bpm = typeof meta.bpm === "number" ? meta.bpm : "?";
  const mood = typeof meta.mood === "string" ? meta.mood : "?";

  return `${track.title || track.id} @ ${score}/100 (bpm=${bpm}, mood=${mood}, shift=${shift})`;
}
