/**
 * demoFallback.ts — Iter Phase 1
 *
 * Hardcoded utterance→song mapping used when Ollama is unreachable.
 * PAD values and rationale are pre-authored to feel like Lyra's voice.
 */

import type { PAD } from "../lib/color";

export type DemoEntry = {
  utterance: string;
  /** Song index into DEMO_SONGS (0-4) */
  songIndex: number;
  pad: PAD;
  rationale: string;
};

/**
 * 5 placeholder song titles used in the demo.
 * These match the audio files in assets/demo/.
 */
export const DEMO_SONGS = [
  { title: "低声部", artist: "Lyra Demo", file: "tone_220hz.wav" },
  { title: "平原午后", artist: "Lyra Demo", file: "tone_275hz.wav" },
  { title: "山间回响", artist: "Lyra Demo", file: "tone_330hz.wav" },
  { title: "微光", artist: "Lyra Demo", file: "tone_440hz.wav" },
  { title: "晴天早晨", artist: "Lyra Demo", file: "tone_550hz.wav" },
] as const;

/**
 * 3 demo groups, one per utterance. Each maps to a song and a rationale.
 * Order matters — the demo cycles through these in sequence.
 */
export const DEMO_FALLBACK: DemoEntry[] = [
  {
    utterance: "今天有点累",
    songIndex: 0, // 低声部 220 Hz — slow, heavy
    pad: { p: -0.3, a: -0.2, d: -0.1 },
    rationale: "先让节奏慢下来。",
  },
  {
    utterance: "想要个安静的下午",
    songIndex: 2, // 山间回响 330 Hz — still, mid-range
    pad: { p: 0.1, a: -0.4, d: 0.0 },
    rationale: "不打扰，只陪着。",
  },
  {
    utterance: "有点开心",
    songIndex: 4, // 晴天早晨 550 Hz — bright, light
    pad: { p: 0.6, a: 0.3, d: 0.2 },
    rationale: "让它亮一点。",
  },
];
