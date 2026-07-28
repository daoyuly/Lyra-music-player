import type { CurrentEmotion, LibraryTrack, SoulState } from "../types";
import type { Fact } from "../memory/types";

export type TargetProfile = string;

export type ChosenSong = {
  song_id: string;
  rationale: string;
  target_profile: TargetProfile;
  needed_shift: "接住" | "点燃" | "陪着" | "打断";
};

export type CompanionInput = {
  userUtterance: string;
  currentEmotion: CurrentEmotion;
  soul: SoulState;
  candidates: Pick<LibraryTrack, "id" | "path" | "title" | "artist" | "album" | "duration_ms">[];
  livingPortrait?: string;
  topFacts?: Fact[];
  // Sprint 14: behavioral signals for shift inference
  skipRatio?: number;
  isBlurred?: boolean;
  inputHesitation?: "none" | "some" | "many";
  // Sprint 14 Task 5: long-term emotion arc as summary string
  emotionTimelineSummary?: string;
  // Sprint 15: real bpm/energy/valence per track for shift ranking
  candidateFeatures?: Map<string, { track_id: string; bpm: number | null; energy: number | null; valence: number | null }>;
};

export type EmotionInput = {
  userUtterance: string;
};
