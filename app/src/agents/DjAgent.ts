/**
 * DjAgent — offline "senior DJ" that annotates each track with language,
 * genre, mood, scene, and a one-liner profile. Runs in the import/refill
 * pipeline, NEVER on the online turn path (zero extra LLM latency for users).
 */

import type { ModelProvider, ChatMessage, LibraryTrack } from "../types";
import type { LibraryFeatures } from "../db/repo/libraryFeaturesRepo";
import type { TrackProfile, TrackLanguage } from "../db/repo/trackProfilesRepo";
import { parseLooseJson } from "../lib/parseLooseJson";
import { routeProvider } from "./route";
import { invoke } from "@tauri-apps/api/core";

export const DJ_MODEL_ID = "dj-v1";

export const DJ_SYSTEM_PROMPT = `你是一位资深音乐 DJ / 唱片收藏家。给你一首歌的元数据、可选歌词片段、可选音频特征,请判断它的特点。

以 STRICT JSON 返回,形如:
{
  "language": "yue|cmn|en|ja|ko|instrumental|other",
  "genres": ["最多3个中文或英文风格标签"],
  "mood": ["最多3个情绪标签"],
  "scenes": ["最多3个场景:深夜/雨天/驾驶/专注/运动/..."],
  "era": "如 90s / 2000s / 当代,不确定则 null",
  "vocal": "male|female|group|instrumental|other",
  "energy_check": "low|mid|high",
  "one_liner": "30字以内的 DJ 口吻画像,具象、不套话"
}

规则:
- 粤语流行/广东歌 → language=yue; 国语/华语 → cmn; 纯音乐 → instrumental
- 艺人是明确的粤语歌手(张国荣、陈奕迅、Beyond、杨千嬅、王菲粤语作品等)时优先 yue
- one_liner 像资深 DJ 对客人说的一句,忌"温暖的""好听的"这类空话
- 不要在 JSON 前后加任何文本`;

const LANGS = new Set([
  "yue",
  "cmn",
  "en",
  "ja",
  "ko",
  "instrumental",
  "other",
]);
const VOCALS = new Set(["male", "female", "group", "instrumental", "other"]);
const ENERGIES = new Set(["low", "mid", "high"]);

export type DjAnnotateInput = {
  track: Pick<LibraryTrack, "id" | "title" | "artist" | "album" | "path">;
  features?: LibraryFeatures | null;
  lyricsExcerpt?: string | null;
};

function asStringArray(v: unknown, max: number): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .map((x) => x.trim())
    .slice(0, max);
}

function buildUserBrief(input: DjAnnotateInput): string {
  const { track, features, lyricsExcerpt } = input;
  const lines = [
    `title: ${track.title ?? "(unknown)"}`,
    `artist: ${track.artist ?? "(unknown)"}`,
    `album: ${track.album ?? "(unknown)"}`,
  ];
  if (features) {
    lines.push(
      `audio: bpm=${features.bpm ?? "?"} energy=${features.energy ?? "?"} valence=${features.valence ?? "?"}`,
    );
  }
  if (lyricsExcerpt && lyricsExcerpt.trim()) {
    const clip = lyricsExcerpt.trim().slice(0, 600);
    lines.push(`lyrics_excerpt:\n${clip}`);
  }
  return lines.join("\n");
}

export class DjAgent {
  private provider: ModelProvider;

  constructor(opts: { provider?: ModelProvider } = {}) {
    this.provider = opts.provider ?? routeProvider("emotion");
  }

  async annotate(input: DjAnnotateInput): Promise<TrackProfile> {
    const messages: ChatMessage[] = [
      { role: "system", content: DJ_SYSTEM_PROMPT },
      { role: "user", content: buildUserBrief(input) },
    ];
    const res = await this.provider.chat(messages, {
      max_tokens: 500,
      temperature: 0.3,
      response_format: { type: "json_object" },
      enable_thinking: false,
      agent: "dj",
    });

    let obj: Record<string, unknown> = {};
    try {
      obj = parseLooseJson(res.content) as Record<string, unknown>;
    } catch {
      obj = {};
    }

    const language: TrackLanguage = LANGS.has(String(obj.language))
      ? (obj.language as TrackLanguage)
      : "other";
    const vocal = VOCALS.has(String(obj.vocal))
      ? (obj.vocal as TrackProfile["vocal"])
      : "other";
    const energy_check = ENERGIES.has(String(obj.energy_check))
      ? (obj.energy_check as TrackProfile["energy_check"])
      : "mid";
    const one_liner =
      typeof obj.one_liner === "string" && obj.one_liner.trim()
        ? obj.one_liner.trim().slice(0, 80)
        : `${trackTitle(input)} · ${language}`;

    return {
      track_id: input.track.id,
      language,
      genres: asStringArray(obj.genres, 3),
      mood: asStringArray(obj.mood, 3),
      scenes: asStringArray(obj.scenes, 3),
      era: typeof obj.era === "string" && obj.era.trim() ? obj.era.trim() : null,
      vocal,
      energy_check,
      one_liner,
      annotated_at: Date.now(),
      model: DJ_MODEL_ID,
    };
  }
}

function trackTitle(input: DjAnnotateInput): string {
  return input.track.title ?? input.track.artist ?? input.track.id;
}

/** Best-effort lyrics extract via Tauri. Returns null on any failure. */
export async function extractLyricsExcerpt(path: string): Promise<string | null> {
  try {
    const text = await invoke<string | null>("lyrics_extract", { path });
    return text && text.trim() ? text : null;
  } catch {
    return null;
  }
}
