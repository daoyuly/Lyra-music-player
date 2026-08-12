import type { ModelProvider, ChatMessage } from "../types";
import { COMPANION_SYSTEM_PROMPT } from "./prompts/companion";
import { routeProvider } from "./route";
import { writeTrace } from "../reasoning/writeTrace";
import { parseLooseJson } from "../lib/parseLooseJson";
import { songDisplayTitle } from "../library/display";
import type { ChosenSong, CompanionInput, VerbalIntent } from "./types";
import * as productEventsRepo from "../db/repo/productEventsRepo";
import { inferShift, getShiftConfidence } from "./shiftLogic";
import { rankByShift } from "../library/shiftRanker";
import { Agent } from "./pi/pi-runtime";
import { lyraStreamFn } from "./pi/streamFn";
import type { StreamableProvider } from "./pi/streamFn";
import { makePickSongTool } from "./pi/companion-tools";
import { makeAuxTools } from "./pi/companion-aux-tools";
import type { AgentRunSink } from "../turn/agentRunSink";
import type { ToolContextFactory } from "../turn/toolContextFactory";
import type { Api, Model, AgentTool } from "./pi/pi-types.d.ts";

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

// 按触发场景生成开场段落。三种 handoff 的语义完全不同,把话说清楚,
// LLM 才不会退回"你还没开口,我先..."这种自证式元叙述。
function scenePreamble(i: CompanionInput): string {
  const handoff = i.handoff ?? (i.userUtterance ? "user-spoke" : "cold-open");

  if (handoff === "user-spoke") {
    return `用户的话: ${i.userUtterance}`;
  }

  if (handoff === "auto-advance") {
    return [
      `场景: 上一首歌的尾音刚散,她/他没说话——她/他在听。你现在续下一首。`,
      `写 rationale 时的口吻: 像一位老禅师和你品茗听琴对弈,间隙里自然地讲一句,`,
      `不着痕迹地解构这首歌 + 她/他此刻的情绪,不解释你在做什么,不问她/他要不要,不宣布自己。`,
      `严禁模板: 不要以"你还没开口"/"我先..."/"她/他刚打开 app"/"我给你放一首"开头,不要出现任何"因为你 X 所以我 Y"的因果说明。`,
      `示例(好): "古琴的泛音像下午茶杯沿上的光,不催你说话。" / "这段慢板正好接住刚才那阵风。"`,
      `示例(坏): "你还没开口,我先放一首彩云追月。" / "你还没说话,我先把茶倒上,琴声替我坐着就好。"`,
    ].join("\n");
  }

  // cold-open
  return [
    `场景: 她/他刚坐下来,今天你们还没交换过一句话。你主动开一首歌。`,
    `写 rationale 时的口吻: 像老禅师给刚到的客人斟第一杯茶,不寒暄、不解释,只让茶的温度自己说话。`,
    `严禁模板: 不要以"你还没开口"/"我先..."/"欢迎回来"开头,不要说破你在"开场"。`,
    `示例(好): "先来一段云门夜话,让屋里的空气慢下来。" / "今天从这段口琴的呼吸开始。"`,
  ].join("\n");
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
    scenePreamble(i),
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

  // Sprint 14 Task 5: long-term emotional arc context
  if (i.emotionTimelineSummary) {
    parts.push("");
    parts.push(`长期情感轨迹: ${i.emotionTimelineSummary}`);
  }

  // Phase 3a: inject last song context so verbal intent ("换一个"/"再来一遍") works
  if (i.lastSong) {
    parts.push("");
    parts.push(`上一首刚播完的是《${i.lastSong.title ?? i.lastSong.id}》— ${i.lastSong.artist ?? "(无艺人)"}`);
  }

  parts.push("");
  parts.push(`候选歌单(${i.candidates.length} 首):`);
  parts.push(candidateBlock);

  return parts.join("\n");
}

const VERBAL_INTENTS = ["switch", "repeat", "adjust_calmer", "adjust_livelier", "similar"] as const;

type PartialChosen = {
  song_id: string;
  target_profile: string;
  rationale: string;
  needed_shift: Shift;
  verbal_intent: VerbalIntent;
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
  const verbal_intent: VerbalIntent = (VERBAL_INTENTS as readonly string[]).includes(
    o.verbal_intent as string,
  )
    ? (o.verbal_intent as VerbalIntent)
    : null;
  return { song_id, target_profile, rationale, needed_shift, verbal_intent };
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

// Minimal pi model descriptor for CompanionAgent pi path.
const COMPANION_PI_MODEL: Model<Api> = {
  id: "lyra-companion",
  name: "Lyra Companion",
  api: "openai" as Api,
  provider: "lyra",
};

export type CompanionAgentOpts = {
  /** Legacy provider for the chat() path (default: routeProvider("companion")). */
  provider?: ModelProvider;
  /**
   * Streaming provider for the pi path. Must implement chatStream().
   * When omitted and piAgentEnabled returns true, a warning is logged and the
   * legacy path is used as fallback.
   */
  streamableProvider?: StreamableProvider;
  /**
   * Feature flag reader. Defaults to async () => false so all existing tests
   * run the legacy path without any change.
   */
  getPiAgentEnabled?: () => Promise<boolean>;
  /**
   * Optional sink for recording agent run telemetry. When provided, the pi
   * path records start / end events with agentKind = "companion".
   */
  agentRunSink?: AgentRunSink;
  /**
   * Phase 3b: optional factory that provides a per-turn ToolContext for the
   * auxiliary tools (get_recent_plays, get_soul_facts, get_song_features).
   * When omitted the pi path runs with only the pick_song tool (backward-compatible).
   */
  toolContextFactory?: ToolContextFactory;
};

export class CompanionAgent {
  /** Resolved lazily on first legacy-path call. */
  private _provider: ModelProvider | undefined;
  private _providerOpt: ModelProvider | undefined;
  private streamableProvider: StreamableProvider | undefined;
  private getPiAgentEnabled: () => Promise<boolean>;
  private agentRunSink: AgentRunSink | undefined;
  private toolContextFactory: ToolContextFactory | undefined;

  constructor(opts: CompanionAgentOpts = {}) {
    this._providerOpt = opts.provider;
    this.streamableProvider = opts.streamableProvider;
    this.getPiAgentEnabled = opts.getPiAgentEnabled ?? (async () => false);
    this.agentRunSink = opts.agentRunSink;
    this.toolContextFactory = opts.toolContextFactory;
  }

  /** Returns the legacy provider, resolving via routeProvider on first call. */
  private get provider(): ModelProvider {
    if (!this._provider) {
      this._provider = this._providerOpt ?? routeProvider("companion");
    }
    return this._provider;
  }

  /**
   * Allow Orchestrator (or other wiring code) to inject the AgentRunSink after
   * construction. Mirrors EmotionAgent.setAgentRunSink().
   */
  setAgentRunSink(sink: AgentRunSink): void {
    this.agentRunSink = sink;
  }

  /**
   * Phase 3b: allow Orchestrator to inject the ToolContextFactory after
   * construction. Mirrors setAgentRunSink pattern.
   */
  setToolContextFactory(factory: ToolContextFactory): void {
    this.toolContextFactory = factory;
  }

  async choose(input: CompanionInput): Promise<ChosenSong> {
    // Sprint 14: Infer shift + rank candidates by affinity.
    // This deterministic pre-sort runs on BOTH paths — pi path inherits the
    // same ranked order so the A/B comparison is fair.
    const { pad } = input.currentEmotion;
    const skipRatio = input.skipRatio ?? 0;
    const isBlurred = input.isBlurred ?? false;
    const inputHesitation = input.inputHesitation ?? "none";
    const recommendedShift = inferShift(
      pad,
      input.currentEmotion.confidence,
      isBlurred,
      skipRatio,
      inputHesitation,
    );
    const rankedCandidates = rankByShift(
      input.candidates,
      recommendedShift,
      pad,
      input.candidateFeatures,
    );

    const piEnabled = await this.getPiAgentEnabled();
    if (piEnabled) {
      return this._choosePi(input, rankedCandidates);
    }
    return this._chooseLegacy(input, rankedCandidates);
  }

  // ---------------------------------------------------------------------------
  // Legacy path — one-shot provider.chat() with manual correction retry.
  // Unchanged from before Phase 3a (moved here from choose()).
  // ---------------------------------------------------------------------------

  private async _chooseLegacy(
    input: CompanionInput,
    rankedCandidates: CompanionInput["candidates"],
  ): Promise<ChosenSong> {
    // Phase 3a: for switch intent, pre-filter lastSong out of candidates so
    // the single LLM call already has the right pool. We still run one LLM
    // call and then enforce the exclusion post-parse if the LLM ignores it.
    const lastSongId = input.lastSong?.id;
    const effectiveCandidates =
      lastSongId !== undefined && rankedCandidates.length > 1
        ? rankedCandidates  // we apply exclusion after seeing verbal_intent
        : rankedCandidates;

    const inputWithRanked = { ...input, candidates: effectiveCandidates };
    const candidateIds = effectiveCandidates.map((c) => c.id);
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

    // Phase 3a: emit telemetry for any detected verbal intent.
    if (picked.verbal_intent !== null) {
      void productEventsRepo
        .record("verbal_intent_detected", {
          intent: picked.verbal_intent,
          agent_kind: "companion",
        })
        .catch((e) => console.warn("[lyra] productEventsRepo.record failed:", e));
    }

    // Phase 3a: repeat — override song_id with lastSong, no retry needed.
    if (picked.verbal_intent === "repeat" && input.lastSong) {
      return {
        song_id: input.lastSong.id,
        target_profile: picked.target_profile || "重放上一首",
        rationale: picked.rationale || "再听一遍。",
        needed_shift: picked.needed_shift,
        verbal_intent: "repeat",
      };
    }

    // Phase 3a: switch — if LLM still chose lastSong, retry with exclusion hint.
    if (picked.verbal_intent === "switch" && lastSongId && picked.song_id === lastSongId) {
      console.warn(
        `[lyra] CompanionAgent: switch intent but LLM chose lastSong (${lastSongId}), retrying with exclusion`,
      );
      const filteredIds = candidateIds.filter((id) => id !== lastSongId);
      const retryMessages: ChatMessage[] = [
        ...messages,
        { role: "assistant", content: res.content },
        {
          role: "user",
          content: buildCorrectionBrief(picked, filteredIds.length > 0 ? filteredIds : candidateIds),
        },
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

  // ---------------------------------------------------------------------------
  // Pi path — Agent tool loop with pick_song tool (Alt B pattern).
  //
  // The pre-sorted rankedCandidates are passed in from choose() so that the
  // same deterministic order is used for both legacy and pi paths (A/B parity).
  // The Agent runs at most 3 turns (hardcap). On failure → fallback to
  // candidates[0] mirroring the legacy fallback behaviour.
  // ---------------------------------------------------------------------------

  private async _choosePi(
    input: CompanionInput,
    rankedCandidates: CompanionInput["candidates"],
  ): Promise<ChosenSong> {
    if (!this.streamableProvider) {
      console.warn(
        "[lyra] CompanionAgent: piAgentEnabled=true but no streamableProvider injected — " +
          "falling back to legacy path",
      );
      return this._chooseLegacy(input, rankedCandidates);
    }

    const candidateIds = rankedCandidates.map((c) => c.id);
    const idSet = new Set(candidateIds);
    const inputWithRanked = { ...input, candidates: rankedCandidates };
    const brief = buildBrief(inputWithRanked);

    let chosen: ChosenSong | null = null;
    const pickTool = makePickSongTool(idSet, candidateIds, (r) => {
      chosen = r;
    });

    // Phase 3b: if a ToolContextFactory is available, build a per-turn ctx and
    // append aux tools so the LLM can gather more context before picking.
    const turnId = crypto.randomUUID();
    const auxTools: AgentTool[] =
      this.toolContextFactory != null
        ? makeAuxTools(this.toolContextFactory.build(turnId))
        : [];
    const tools: AgentTool[] = [pickTool as AgentTool, ...auxTools];

    // Hint message injected only when aux tools are available so the LLM knows
    // it can call them first (max_turns=3 hardcap still enforced by pi-runtime).
    const auxHint =
      auxTools.length > 0
        ? "\n\n(可选) 你可以先调 get_recent_plays / get_soul_facts / get_song_features 收集更多信息，再调 pick_song 定案。max 3 turns 内完成。"
        : "";

    const agent = new Agent({
      streamFn: lyraStreamFn(this.streamableProvider),
      initialState: {
        systemPrompt: COMPANION_SYSTEM_PROMPT,
        model: COMPANION_PI_MODEL,
        tools,
        messages: [{ role: "user", content: brief + auxHint, timestamp: Date.now() }],
      },
      maxTurns: 3,
    });

    const runId = crypto.randomUUID();
    const t0 = performance.now();

    this.agentRunSink?.start(runId, turnId, "companion", t0);

    try {
      await agent.prompt("");
      this.agentRunSink?.end(runId, "ok");
    } catch (err) {
      this.agentRunSink?.end(runId, "error");
      console.warn("[lyra] CompanionAgent pi path error:", err);
      // Fall through to fallback below
    }

    if (!chosen) {
      console.warn(
        "[lyra] CompanionAgent pi: no song selected within max_turns; falling back to candidates[0]",
      );
      // 用户可见字段:Lyra 语气,不暴露 "fallback" 之类的调试名。
      // 内部诊断走 console.warn + agent_runs.stop_reason("sli_exceeded"/"error")。
      return {
        song_id: candidateIds[0],
        target_profile: "候选中最贴近此刻情绪的一支",
        rationale: "这一首和你此刻的气息最像。",
        needed_shift: "接住",
      };
    }

    // Phase 3a: emit telemetry for detected verbal intent.
    const vi = chosen.verbal_intent ?? null;
    if (vi !== null) {
      void productEventsRepo
        .record("verbal_intent_detected", { intent: vi, agent_kind: "companion" })
        .catch((e) => console.warn("[lyra] productEventsRepo.record failed:", e));
    }

    // Phase 3a: repeat — override song_id with lastSong.
    if (vi === "repeat" && input.lastSong) {
      return {
        ...chosen,
        song_id: input.lastSong.id,
        verbal_intent: "repeat",
      };
    }

    // Phase 3a: switch — if pi tool chose lastSong despite intent, pick next candidate.
    if (vi === "switch" && input.lastSong && chosen.song_id === input.lastSong.id) {
      const alt = candidateIds.find((id) => id !== input.lastSong!.id);
      if (alt) {
        return { ...chosen, song_id: alt };
      }
    }

    return chosen;
  }
}
