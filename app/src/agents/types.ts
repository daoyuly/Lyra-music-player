import type { CurrentEmotion, LibraryTrack, SoulState } from "../types";
import type { Fact } from "../memory/types";
import type { ActiveIntent } from "../db/repo/activeIntentRepo";

export type TargetProfile = string;

export type VerbalIntent =
  | "switch"
  | "repeat"
  | "adjust_calmer"
  | "adjust_livelier"
  | "similar"
  | "clear_intent"
  | null;

export type ChosenSong = {
  song_id: string;
  rationale: string;
  target_profile: TargetProfile;
  needed_shift: "接住" | "点燃" | "陪着" | "打断";
  verbal_intent?: VerbalIntent;
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
  /** DJ agent profiles for candidate display + intent-aware picking. */
  candidateProfiles?: Map<string, import("../db/repo/trackProfilesRepo").TrackProfile>;
  /** 这一次 companion.choose 是被什么触发的。用于让 rationale 的口吻贴合场景：
   *   - user-spoke: 用户说了一句话，正常回应
   *   - auto-advance: 上一首刚播完，自然续下一首，用户在听，不在说
   *   - cold-open: app 或 proactive engine 主动开场，用户还没进入对话
   *  未指定时按 user-spoke 处理。 */
  handoff?: "user-spoke" | "cold-open" | "auto-advance";
  /** Phase 3a: 上一首正在播（或刚播完）的歌。第一次 turn 或 orchestrator 没传时为 undefined。
   *  用于 verbal_intent 处理：repeat → 直接返回这首；switch → 从候选中排除这首。 */
  lastSong?: LibraryTrack;
  /** Sticky listening intent that must survive auto-advance (e.g. 粤语). */
  activeIntent?: ActiveIntent | null;
};

export type EmotionInput = {
  userUtterance: string;
};
