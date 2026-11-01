import type { ModelProvider, ChatMessage } from "../types";
import { routeProvider } from "../agents/route";
import { parseLooseJson } from "../lib/parseLooseJson";
import { groundBeats, validateRundown, type ShowBeat } from "./rundown";
import type { ShowCandidate } from "./ShowAgent";

export type ShowTone = "欢快" | "幽默" | "悲伤";

const TONES: ShowTone[] = ["欢快", "幽默", "悲伤"];

/** Rotate the three colors so a segment is not one mood all the way through. */
export function assignShowTones(count: number, offset = 0): ShowTone[] {
  return Array.from({ length: count }, (_, i) => TONES[(offset + i) % TONES.length]);
}

const SYSTEM = `你是这档音乐节目的边界。歌已经选定，你只重写每一拍的台词，不改 song_id，不增删拍，不调换顺序。

以 STRICT JSON 返回:
{
  "beats": [
    {
      "song_id": "原样复制",
      "lines": [
        {"speaker": "lyra", "text": "一句"},
        {"speaker": "guest", "text": "一句"}
      ]
    }
  ]
}

规则:
- 每一拍按给你的颜色写：欢快、幽默、悲伤。颜色是主持的口气，不是把歌说成另一种歌
- 从这首歌的一句话、心情、场景、曲风、年代里取一个具体细节当新鲜料，写进对话。不要只报歌名，不要空泛说好听
- 台词仍须原文写出这一拍的歌名或歌手
- 语种若提到，必须和 language 一致
- 每一拍 2 到 4 句，lyra 和 guest 都要说话
- 不要编听众的经历，不要提新闻，不要猜测听众在哪里
- 中文，短句。不要在 JSON 前后加任何文本`;

function songBlock(song: ShowCandidate, tone: ShowTone, beat: ShowBeat): string {
  const lines = [
    `song_id: ${song.id}`,
    `颜色: ${tone}`,
    `歌: ${song.artist} — ${song.title}`,
  ];
  if (song.language) lines.push(`language: ${song.language}`);
  if (song.oneLiner) lines.push(`一句话: ${song.oneLiner}`);
  if (song.mood?.length) lines.push(`心情: ${song.mood.join("、")}`);
  if (song.scenes?.length) lines.push(`场景: ${song.scenes.join("、")}`);
  if (song.genres?.length) lines.push(`曲风: ${song.genres.join("、")}`);
  if (song.era) lines.push(`年代: ${song.era}`);
  if (song.energy) lines.push(`能量: ${song.energy}`);
  lines.push("现有台词（重写，不要原样复读）:");
  for (const line of beat.lines) lines.push(`- ${line.speaker}: ${line.text}`);
  return lines.join("\n");
}

export class BoundaryAgent {
  private provider: ModelProvider;

  constructor(opts: { provider?: ModelProvider } = {}) {
    this.provider = opts.provider ?? routeProvider("companion");
  }

  /** Rewrite host lines. A beat that no longer names its song keeps the draft. */
  async color(input: {
    topic: string;
    beats: ShowBeat[];
    songs: ShowCandidate[];
    toneOffset?: number;
  }): Promise<ShowBeat[]> {
    const { beats, songs } = input;
    if (beats.length === 0) return beats;
    const byId = new Map(songs.map((song) => [song.id, song]));
    const tones = assignShowTones(beats.length, input.toneOffset ?? 0);
    const blocks = beats.map((beat, i) => {
      const song = byId.get(beat.song_id);
      if (!song) return `song_id: ${beat.song_id}\n颜色: ${tones[i]}`;
      return songBlock(song, tones[i], beat);
    });
    const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: `题目: ${input.topic}\n\n${blocks.join("\n\n")}`,
      },
    ];
    try {
      const res = await this.provider.chat(messages, {
        max_tokens: 1400,
        temperature: 0.85,
        response_format: { type: "json_object" },
        enable_thinking: false,
        agent: "boundary",
      });
      const allowed = new Set(beats.map((beat) => beat.song_id));
      const known = beats
        .map((beat) => byId.get(beat.song_id))
        .filter((song): song is ShowCandidate => song !== undefined);
      const rewritten = groundBeats(
        validateRundown(parseLooseJson(res.content), allowed),
        known,
      );
      const next = new Map(rewritten.map((beat) => [beat.song_id, beat]));
      return beats.map((beat) => next.get(beat.song_id) ?? beat);
    } catch (err) {
      console.warn("[lyra] show boundary failed:", err);
      return beats;
    }
  }
}
