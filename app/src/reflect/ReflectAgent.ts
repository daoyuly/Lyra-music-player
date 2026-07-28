import type { ModelProvider, DialogueTurn, ChatMessage } from "../types";
import type { ParsedMemory } from "../memory/types";
import type { PerceptionTuning } from "../perception/tuning";
import { clampTuning } from "../perception/tuning";
import { REFLECT_SYSTEM_PROMPT } from "./prompt";
import { routeProvider } from "../agents/route";
import { writeTrace } from "../reasoning/writeTrace";
import { parseLooseJson } from "../lib/parseLooseJson";
import type { ShiftFeedback } from "../perception/shiftFeedback";
import { computeShiftStats, summarizeShiftStats } from "../perception/shiftFeedback";

/** Compact form of one perception_audit row for the Reflect prompt. */
export type PerceptionObservation = {
  ts: number;
  source: "rule" | "llm";
  reason: string;
  confidence: number;
};

export type ReflectInput = {
  recentTurns: DialogueTurn[];
  currentMemory: ParsedMemory;
  todayISO: string;
  /** Sprint 8: last N perception_audit summaries for self-tuning. Optional
   *  so existing call sites (tests) don't have to construct it. */
  recentPerception?: PerceptionObservation[];
  /** Sprint 14: shift recommendation feedback for learning shift effectiveness. */
  shiftFeedback?: ShiftFeedback[];
};

export type FactMutation =
  | { op: "add"; tags: string[]; conclusion: string; startConfidence?: number }
  | { op: "increment"; tags: string[]; conclusion: string; deltaN?: number }
  | { op: "adjust"; tags: string[]; conclusion: string; newConfidence: number };

export type ReflectResult = {
  livingPortrait: string;
  factMutations: FactMutation[];
  dreamNarrative: string;
  /** Sprint 8: optional threshold overrides for RulePerceptionAgent.
   *  Absent means "no change". Values are pre-clamped to ±50% of defaults. */
  perceptionTuning?: PerceptionTuning;
};

export class ReflectAgentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReflectAgentError";
  }
}

function extractJson(raw: string): unknown {
  try {
    return parseLooseJson(raw);
  } catch {
    throw new ReflectAgentError(`bad JSON: ${raw.slice(0, 200)}`);
  }
}

function validateResult(obj: unknown): ReflectResult {
  if (typeof obj !== "object" || obj === null) {
    throw new ReflectAgentError("bad JSON: expected object");
  }
  const o = obj as Record<string, unknown>;

  if (typeof o.livingPortrait !== "string" || o.livingPortrait.trim() === "") {
    throw new ReflectAgentError("missing required field: livingPortrait");
  }
  if (!Array.isArray(o.factMutations)) {
    throw new ReflectAgentError("missing required field: factMutations");
  }
  if (typeof o.dreamNarrative !== "string" || o.dreamNarrative.trim() === "") {
    throw new ReflectAgentError("missing required field: dreamNarrative");
  }

  const factMutations: FactMutation[] = (o.factMutations as unknown[]).map((m, i) => {
    if (typeof m !== "object" || m === null) {
      throw new ReflectAgentError(`factMutations[${i}]: expected object`);
    }
    const mut = m as Record<string, unknown>;
    const op = mut.op;
    if (op !== "add" && op !== "increment" && op !== "adjust") {
      throw new ReflectAgentError(`factMutations[${i}]: invalid op "${String(op)}"`);
    }
    if (!Array.isArray(mut.tags) || !mut.tags.every((t) => typeof t === "string")) {
      throw new ReflectAgentError(`factMutations[${i}]: tags must be string[]`);
    }
    if (typeof mut.conclusion !== "string") {
      throw new ReflectAgentError(`factMutations[${i}]: conclusion must be string`);
    }
    if (op === "add") {
      return {
        op: "add",
        tags: mut.tags as string[],
        conclusion: mut.conclusion,
        ...(typeof mut.startConfidence === "number" ? { startConfidence: mut.startConfidence } : {}),
      } satisfies FactMutation;
    }
    if (op === "increment") {
      return {
        op: "increment",
        tags: mut.tags as string[],
        conclusion: mut.conclusion,
        ...(typeof mut.deltaN === "number" ? { deltaN: mut.deltaN } : {}),
      } satisfies FactMutation;
    }
    // op === "adjust"
    if (typeof mut.newConfidence !== "number") {
      throw new ReflectAgentError(`factMutations[${i}]: adjust requires newConfidence number`);
    }
    return {
      op: "adjust",
      tags: mut.tags as string[],
      conclusion: mut.conclusion,
      newConfidence: mut.newConfidence,
    } satisfies FactMutation;
  });

  // Sprint 8: optional perception_tuning. Malformed → drop silently.
  let perceptionTuning: PerceptionTuning | undefined;
  if (o.perception_tuning && typeof o.perception_tuning === "object") {
    const raw = o.perception_tuning as Record<string, unknown>;
    const numeric: PerceptionTuning = {};
    for (const key of [
      "skipRatio",
      "idleRatio",
      "submitGapMs",
      "dismissThreshold",
      "completionThreshold",
    ] as const) {
      const v = raw[key];
      if (typeof v === "number" && Number.isFinite(v)) numeric[key] = v;
    }
    const clamped = clampTuning(numeric);
    if (Object.keys(clamped).length > 0) perceptionTuning = clamped;
  }

  return {
    livingPortrait: o.livingPortrait,
    factMutations,
    dreamNarrative: o.dreamNarrative,
    ...(perceptionTuning !== undefined ? { perceptionTuning } : {}),
  };
}

function buildUserMessage(input: ReflectInput): string {
  const turnsJson = JSON.stringify(
    input.recentTurns.map((t) => ({
      id: t.id,
      timestamp: t.timestamp,
      userUtterance: t.user_utterance.content,
      emotion: t.current_emotion.labels,
      songId: t.agent_response.song_id,
      reaction: {
        completed: t.user_reaction.behavioral.completed,
        skipped: t.user_reaction.behavioral.skipped,
        verbal: t.user_reaction.verbal?.content,
      },
    })),
    null,
    2,
  );

  const factsJson = JSON.stringify(input.currentMemory.facts, null, 2);
  const portrait = input.currentMemory.livingPortrait.paragraphs.join("\n\n");
  const perceptionJson =
    input.recentPerception && input.recentPerception.length > 0
      ? JSON.stringify(input.recentPerception, null, 2)
      : "(暂无)";

  const shiftStatsSummary =
    input.shiftFeedback && input.shiftFeedback.length > 0
      ? summarizeShiftStats(computeShiftStats(input.shiftFeedback))
      : "(暂无)";

  return [
    `todayISO: ${input.todayISO}`,
    ``,
    `## 最近对话回合`,
    turnsJson,
    ``,
    `## 已有 Facts 库`,
    factsJson,
    ``,
    `## 已有 Living Portrait`,
    portrait || "(空)",
    ``,
    `## 感知层最近观测（用于评估规则敏感度）`,
    perceptionJson,
    ``,
    `## Shift 推荐效率（Sprint 14）`,
    shiftStatsSummary,
  ].join("\n");
}

export class ReflectAgent {
  private provider: ModelProvider;

  constructor(opts: { provider?: ModelProvider } = {}) {
    this.provider = opts.provider ?? routeProvider("companion");
  }

  async run(input: ReflectInput): Promise<ReflectResult> {
    const brief = buildUserMessage(input);
    const messages: ChatMessage[] = [
      { role: "system", content: REFLECT_SYSTEM_PROMPT },
      { role: "user", content: brief },
    ];
    const t0 = performance.now();
    const res = await this.provider.chat(messages, {
      max_tokens: 4096,
      temperature: 0.5,
      response_format: { type: "json_object" },
      enable_thinking: false,
      agent: "reflect",
    });
    const obj = extractJson(res.content);
    const parsed = validateResult(obj);
    writeTrace({
      agent_kind: "reflect",
      prompt_text: brief,
      raw_response: res.content,
      parsed_json: parsed,
      duration_ms: Math.round(performance.now() - t0),
    });
    return parsed;
  }
}
