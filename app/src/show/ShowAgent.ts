import type { ModelProvider, ChatMessage, PAD } from "../types";
import { routeProvider } from "../agents/route";
import { parseLooseJson } from "../lib/parseLooseJson";
import { groundBeats, validateRundown, type ShowBeat } from "./rundown";

export type ShowCandidate = {
  id: string;
  title: string;
  artist: string;
  /** yue | cmn | en | ja | ko | instrumental | other, when the library has a profile. */
  language?: string;
  oneLiner?: string;
  genres?: string[];
  mood?: string[];
  scenes?: string[];
  era?: string;
  energy?: string;
};

export type ShowBrief = {
  topic: string;
  guestName: string;
  /** Listener cut-in. Present only when rewriting the tail. */
  steer?: string;
  /** The current segment ended. Write the next one of the same show. */
  continuing?: boolean;
  when: string;
  weather: string | null;
  emotionLabels: string[];
  pad: PAD;
  livingPortrait?: string;
  facts: { tags: string[]; conclusion: string }[];
  candidates: ShowCandidate[];
};

const SYSTEM = `你在做一档双人音乐节目。Lyra 是主持之一，另一位是嘉宾。
听众先看完这一拍的台词，歌才开始，所以台词里不要说「正在放」。

以 STRICT JSON 返回:
{
  "beats": [
    {
      "song_id": "必须原样复制候选列表里的 id",
      "lines": [
        {"speaker": "lyra", "text": "一句"},
        {"speaker": "guest", "text": "一句"}
      ]
    }
  ]
}

规则:
- 新开一期写 4 拍
- 「节目继续」时再写 4 拍，接上同一题目，不要重讲开场
- 「听众插话」时只写后面 2 到 3 拍
- 每一拍 2 到 4 句，lyra 和 guest 都要说话
- song_id 只能来自候选，且整期不重复
- 每一拍的台词必须介绍即将播放的那一首：原文写出它的歌名或歌手。听的人要能对上曲子
- 候选里的 language 是这首歌的语种。台词若提到语种，必须和 language 一致。英文歌不能说成粤语或国语
- 记忆只能带一句，不能代替对这首歌的介绍
- 只使用给你的记忆、情绪、时间和天气。不要编用户的经历，不要提新闻，不要猜测用户在哪里
- 中文，短句，具体，不要套话
- 不要在 JSON 前后加任何文本`;

function buildUserMessage(brief: ShowBrief): string {
  const lines = [
    `题目: ${brief.topic}`,
    `嘉宾名: ${brief.guestName}`,
    `现在: ${brief.when}`,
  ];
  if (brief.weather) lines.push(`天气: ${brief.weather}`);
  if (brief.continuing) {
    lines.push("节目继续：这一段已经播完。按同一题目再写 4 拍，接下去，不要重讲开场。");
  } else if (brief.steer) {
    lines.push(`听众插话，从这里起重写后面: ${brief.steer}`);
  }
  const labels = brief.emotionLabels.filter(Boolean).join("、");
  lines.push(
    `情绪: ${labels || "未命名"} (p=${brief.pad.p.toFixed(2)} a=${brief.pad.a.toFixed(2)} d=${brief.pad.d.toFixed(2)})`,
  );
  if (brief.livingPortrait?.trim()) {
    lines.push(`记忆画像:\n${brief.livingPortrait.trim().slice(0, 400)}`);
  }
  if (brief.facts.length > 0) {
    lines.push("记住的事实:");
    for (const fact of brief.facts.slice(0, 5)) {
      lines.push(`- ${fact.tags.join(" ")} → ${fact.conclusion}`);
    }
  }
  lines.push("候选曲目（song_id 只能从这里抄，台词必须点出歌名或歌手）:");
  for (const song of brief.candidates) {
    const lang = song.language ? ` | language=${song.language}` : "";
    const liner = song.oneLiner ? ` · ${song.oneLiner}` : "";
    const bits = [
      song.mood?.length ? `心情=${song.mood.join("、")}` : "",
      song.scenes?.length ? `场景=${song.scenes.join("、")}` : "",
      song.genres?.length ? `曲风=${song.genres.join("、")}` : "",
      song.era ? `年代=${song.era}` : "",
      song.energy ? `能量=${song.energy}` : "",
    ].filter(Boolean);
    const extra = bits.length ? ` | ${bits.join(" ")}` : "";
    lines.push(`- ${song.id}${lang} | ${song.artist} — ${song.title}${liner}${extra}`);
  }
  return lines.join("\n");
}

export class ShowAgent {
  private provider: ModelProvider;

  constructor(opts: { provider?: ModelProvider } = {}) {
    this.provider = opts.provider ?? routeProvider("companion");
  }

  async write(brief: ShowBrief): Promise<ShowBeat[]> {
    const allowed = new Set(brief.candidates.map((c) => c.id));
    const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM },
      { role: "user", content: buildUserMessage(brief) },
    ];
    let beats = await this.once(messages, allowed, brief.candidates);
    if (beats.length > 0) return beats;
    messages.push({
      role: "user",
      content:
        "上一稿和歌曲对不上。只从候选 id 里重写，每一拍台词里写出该首的歌名或歌手原文，语种与 language 一致。英文歌不要说成粤语。",
    });
    beats = await this.once(messages, allowed, brief.candidates);
    return beats;
  }

  private async once(
    messages: ChatMessage[],
    allowed: Set<string>,
    candidates: ShowBrief["candidates"],
  ): Promise<ShowBeat[]> {
    const res = await this.provider.chat(messages, {
      max_tokens: 1800,
      temperature: 0.7,
      response_format: { type: "json_object" },
      enable_thinking: false,
      agent: "show",
    });
    messages.push({ role: "assistant", content: res.content });
    try {
      return groundBeats(validateRundown(parseLooseJson(res.content), allowed), candidates);
    } catch {
      return [];
    }
  }
}
