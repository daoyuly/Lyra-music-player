import type { ModelProvider, ChatMessage } from "../types";
import { COMPANION_SYSTEM_PROMPT } from "./prompts/companion";
import { routeProvider } from "./route";
import { writeTrace } from "../reasoning/writeTrace";
import { parseLooseJson } from "../lib/parseLooseJson";
import { songDisplayTitle } from "../library/display";
import type { ChosenSong, CompanionInput } from "./types";
import { inferShift, getShiftConfidence } from "./shiftLogic";
import { rankByShift } from "../library/shiftRanker";

const SHIFTS = ["接住", "点燃", "陪着", "打断"] as const;
type Shift = (typeof SHIFTS)[number];

export class CompanionAgentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompanionAgentError";
  }
}

function extractJson(raw: string): unknown {
  try {
    return parseLooseJson(raw);
  } catch {
    throw new CompanionAgentError(`bad JSON: ${raw.slice(0, 200)}`);
  }
}

function buildMemoryBlock(i: CompanionInput): string {
  const portrait = i.livingPortrait ?? "";
  const facts = i.topFacts ?? [];
  if (!portrait && facts.length === 0) return "";

  const lines: string[] = ["你对她的记忆:"];
  if (portrait) {
    lines.push(portrait);
  }
  if (facts.length > 0) {
    if (portrait) lines.push("");
    lines.push("你观察到的偏好:");
    for (const f of facts) {
      lines.push(`- ${f.tags.join(" ")} → ${f.conclusion} (conf: ${f.confidence.toFixed(2)})`);
    }
  }
  return lines.join("\n");
}

function buildBrief(i: CompanionInput): string {
  const { pad, labels, confidence } = i.currentEmotion;
  const soul = i.soul;
  const memoryLine =
    soul.shared_memory.length > 0
      ? `- 共同记忆(最近一条): ${soul.shared_memory[soul.shared_memory.length - 1].significance}`
      : "- 共同记忆: (无)";
  const candidateBlock = i.candidates
    .map(
      (c, idx) =>
        `[${idx + 1}] id=${c.id} · ${songDisplayTitle(c)} · ${c.artist ?? "(无艺人)"} · ${
          c.album ?? "-"
        } · ${c.duration_ms ? Math.round(c.duration_ms / 1000) + "s" : "-"}`,
    )
    .join("\n");

  const memoryBlock = buildMemoryBlock(i);

  // Sprint 14: Infer recommended shift based on behavioral signals
  const skipRatio = i.skipRatio ?? 0;
  const isBlurred = i.isBlurred ?? false;
  const inputHesitation = i.inputHesitation ?? "none";
  const recommendedShift = inferShift(pad, confidence, isBlurred, skipRatio, inputHesitation);
  const shiftConfidence = getShiftConfidence(
    pad,
    confidence,
    isBlurred,
    skipRatio,
    inputHesitation,
  );

  const parts = [
    `用户的话: ${i.userUtterance || "(她/他刚打开 app,还没说话)"}`,
    `此刻情绪: PAD=(p=${pad.p.toFixed(2)}, a=${pad.a.toFixed(2)}, d=${pad.d.toFixed(2)}), labels=[${labels.join(",")}], confidence=${confidence.toFixed(2)}`,
    `推荐的转变方向: ${recommendedShift} (推导置信度: ${(shiftConfidence * 100).toFixed(0)}%) — 你可以参考这个建议，也可以根据用户说的话调整`,
    `你的灵魂状态:`,
    `- backbone: ${soul.musical_taste_base.backbone}`,
    `- affinity_genres: ${soul.musical_taste_base.affinity_genres.join(", ")}`,
    `- 当下 recent_bias: ${soul.dynamic_mood.recent_bias || "(无)"}`,
    memoryLine,
  ];

  if (memoryBlock) {
    parts.push("");
    parts.push(memoryBlock);
  }

  parts.push("");
  parts.push(`候选歌单(${i.candidates.length} 首):`);
  parts.push(candidateBlock);

  return parts.join("\n");
}

type PartialChosen = {
  song_id: string;
  target_profile: string;
  rationale: string;
  needed_shift: Shift;
};

function parsePartial(obj: unknown): PartialChosen {
  if (typeof obj !== "object" || obj === null) throw new CompanionAgentError("expected object");
  const o = obj as Record<string, unknown>;
  const song_id = typeof o.song_id === "string" ? o.song_id : "";
  const target_profile = typeof o.target_profile === "string" ? o.target_profile.trim() : "";
  const rationale = typeof o.rationale === "string" ? o.rationale.trim() : "";
  const needed_shift: Shift = (SHIFTS as readonly string[]).includes(o.needed_shift as string)
    ? (o.needed_shift as Shift)
    : "接住";
  return { song_id, target_profile, rationale, needed_shift };
}

function buildCorrectionBrief(bad: PartialChosen, candidateIds: string[]): string {
  return [
    `你上次返回的 song_id 是 ${JSON.stringify(bad.song_id)}，但它不在候选列表里。`,
    `候选列表里只有这些 id (从上一条 user message 里挑一个):`,
    candidateIds.map((id) => `- ${id}`).join("\n"),
    ``,
    `请重新返回 JSON，target_profile / rationale / needed_shift 可以保留你原本的判断，只要把 song_id 换成上面列表里真实存在的那个（选一个和你的 target_profile 最贴的）。同样只返回 JSON，不要 markdown。`,
  ].join("\n");
}

export class CompanionAgent {
  private provider: ModelProvider;
  constructor(opts: { provider?: ModelProvider } = {}) {
    this.provider = opts.provider ?? routeProvider("companion");
  }

  async choose(input: CompanionInput): Promise<ChosenSong> {
    // Sprint 14: Infer shift + rank candidates by affinity
    const { pad } = input.currentEmotion;
    const skipRatio = input.skipRatio ?? 0;
    const isBlurred = input.isBlurred ?? false;
    const inputHesitation = input.inputHesitation ?? "none";
    const recommendedShift = inferShift(pad, input.currentEmotion.confidence, isBlurred, skipRatio, inputHesitation);

    // Re-rank candidates by shift affinity before LLM sees them
    const rankedCandidates = rankByShift(input.candidates, recommendedShift, pad);

    // Use ranked candidates for LLM context (but keep original list for validation)
    const inputWithRanked = { ...input, candidates: rankedCandidates };
    const candidateIds = rankedCandidates.map((c) => c.id);
    const idSet = new Set(candidateIds);
    const brief = buildBrief(inputWithRanked);
    const messages: ChatMessage[] = [
      { role: "system", content: COMPANION_SYSTEM_PROMPT },
      { role: "user", content: brief },
    ];

    const t0 = performance.now();
    const res = await this.provider.chat(messages, {
      // Bumped 1024 → 3000 to survive GLM-5.x reasoning burn on the Zhipu
      // fallback path. Anthropic (primary) treats this as an upper cap.
      max_tokens: 3000,
      temperature: 0.7,
      response_format: { type: "json_object" },
      enable_thinking: false,
      agent: "companion",
    });
    let picked = parsePartial(extractJson(res.content));

    writeTrace({
      agent_kind: "companion",
      prompt_text: brief,
      raw_response: res.content,
      parsed_json: picked,
      duration_ms: Math.round(performance.now() - t0),
    });

    // Retry once if the LLM picked a song_id outside the candidate set.
    if (!idSet.has(picked.song_id)) {
      console.warn(
        `[lyra] CompanionAgent: bad song_id ${JSON.stringify(picked.song_id)}, retrying with correction`,
      );
      const retryMessages: ChatMessage[] = [
        ...messages,
        { role: "assistant", content: res.content },
        { role: "user", content: buildCorrectionBrief(picked, candidateIds) },
      ];
      const retryRes = await this.provider.chat(retryMessages, {
        max_tokens: 1500,
        temperature: 0.3,
        response_format: { type: "json_object" },
        enable_thinking: false,
        agent: "companion",
      });
      picked = parsePartial(extractJson(retryRes.content));
    }

    // Fallback: if even the retry missed, use the first candidate rather than
    // failing the turn. Preserve the LLM's rationale/target_profile since those
    // are still useful.
    if (!idSet.has(picked.song_id)) {
      console.warn(
        `[lyra] CompanionAgent: retry still bad (${JSON.stringify(picked.song_id)}); falling back to candidates[0]`,
      );
      picked = { ...picked, song_id: candidateIds[0] };
    }

    return picked;
  }
}
