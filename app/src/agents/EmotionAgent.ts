import type { ModelProvider, CurrentEmotion, ChatMessage } from "../types";
import { EMOTION_SYSTEM_PROMPT } from "./prompts/emotion";
import { writeTrace } from "../reasoning/writeTrace";
import { routeProvider } from "./route";
import { parseLooseJson } from "../lib/parseLooseJson";
import type { EmotionInput } from "./types";
import type { AgentRunSink } from "../turn/agentRunSink";
import { lyraStreamFn, type StreamableProvider } from "./pi/streamFn";
import type { Model, Api, Context, AssistantMessage } from "./pi/pi-types.d.ts";

export class EmotionAgentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmotionAgentError";
  }
}

const IN_RANGE = (n: unknown): n is number =>
  typeof n === "number" && n >= -1 && n <= 1;

function extractJson(raw: string): unknown {
  try {
    return parseLooseJson(raw);
  } catch {
    const preview = raw.length === 0 ? "<empty>" : raw.slice(0, 200);
    throw new EmotionAgentError(`bad JSON: ${preview}`);
  }
}

function validateEmotion(obj: unknown): CurrentEmotion {
  if (typeof obj !== "object" || obj === null) {
    throw new EmotionAgentError("bad JSON: expected object");
  }
  const o = obj as Record<string, unknown>;
  const pad = o.pad as Record<string, unknown> | undefined;
  if (!pad || typeof pad !== "object") {
    throw new EmotionAgentError("missing pad field");
  }
  const p = pad.p, a = pad.a, d = pad.d;
  if (!IN_RANGE(p) || !IN_RANGE(a) || !IN_RANGE(d)) {
    throw new EmotionAgentError(
      `pad values out of range [-1, 1]: ${JSON.stringify(pad)}`,
    );
  }
  const labels = Array.isArray(o.labels)
    ? o.labels.filter((l): l is string => typeof l === "string")
    : [];
  const confidence =
    typeof o.confidence === "number" && o.confidence >= 0 && o.confidence <= 1
      ? o.confidence
      : 0.5;
  const source =
    o.source === "user-declared" || o.source === "ring-signal"
      ? o.source
      : "emotion-agent-inferred";

  // Validate optional predicted_trajectory; drop (don't throw) if malformed
  let predicted_trajectory: CurrentEmotion["predicted_trajectory"] | undefined;
  if (o.predicted_trajectory !== undefined) {
    const pt = o.predicted_trajectory as Record<string, unknown>;
    const horizonMin = pt.horizon_min;
    const predictedPad = pt.predicted_pad as Record<string, unknown> | undefined;
    const validHorizon =
      typeof horizonMin === "number" &&
      Number.isInteger(horizonMin) &&
      horizonMin >= 5 &&
      horizonMin <= 120;
    const pp = predictedPad?.p, pa = predictedPad?.a, pd = predictedPad?.d;
    const validPad =
      predictedPad !== undefined &&
      typeof predictedPad === "object" &&
      IN_RANGE(pp) && IN_RANGE(pa) && IN_RANGE(pd);
    if (validHorizon && validPad) {
      predicted_trajectory = {
        horizon_min: horizonMin as number,
        predicted_pad: { p: pp as number, a: pa as number, d: pd as number },
      };
    }
    // else: silently drop malformed field
  }

  return {
    pad: { p, a, d },
    labels,
    confidence,
    source,
    ...(predicted_trajectory !== undefined ? { predicted_trajectory } : {}),
  };
}

/**
 * Extract the concatenated text content from a pi AssistantMessage.
 * Joins all TextContent blocks; returns "" if none are present.
 */
function extractTextFromAssistantMessage(msg: AssistantMessage): string {
  return msg.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("");
}

// ---------------------------------------------------------------------------
// Minimal pi model descriptor used for the emotion pi path.
// EmotionAgent is single-turn and tool-free, so the model id is a placeholder —
// the actual model is selected by the provider's chatStream implementation.
// ---------------------------------------------------------------------------
const EMOTION_PI_MODEL: Model<Api> = {
  id: "lyra-emotion",
  name: "Lyra Emotion",
  api: "openai" as Api,
  provider: "lyra",
};

export type EmotionAgentOpts = {
  /** Legacy provider for the chat() path (default: routeProvider("emotion")). */
  provider?: ModelProvider;
  /**
   * Streaming provider for the pi path. Must implement chatStream().
   * When omitted and piAgentEnabled returns true, a warning is logged and the
   * legacy path is used as fallback.
   */
  streamableProvider?: StreamableProvider;
  /**
   * Feature flag reader. Injected for testability; defaults to async () => false
   * so all existing tests run the legacy path without any change.
   */
  getPiAgentEnabled?: () => Promise<boolean>;
  /**
   * Optional sink for recording agent run telemetry. When provided, the pi
   * path records start / end events with agentKind = "emotion".
   */
  agentRunSink?: AgentRunSink;
};

export class EmotionAgent {
  /** Resolved lazily on first legacy-path call so pi-only construction doesn't throw. */
  private _provider: ModelProvider | undefined;
  private _providerOpt: ModelProvider | undefined;
  private streamableProvider: StreamableProvider | undefined;
  private getPiAgentEnabled: () => Promise<boolean>;
  private agentRunSink: AgentRunSink | undefined;

  constructor(opts: EmotionAgentOpts = {}) {
    this._providerOpt = opts.provider;
    this.streamableProvider = opts.streamableProvider;
    this.getPiAgentEnabled = opts.getPiAgentEnabled ?? (async () => false);
    this.agentRunSink = opts.agentRunSink;
  }

  /** Returns the legacy provider, resolving via routeProvider on first call. */
  private get provider(): ModelProvider {
    if (!this._provider) {
      this._provider = this._providerOpt ?? routeProvider("emotion");
    }
    return this._provider;
  }

  /**
   * Allow Orchestrator (or other wiring code) to inject the AgentRunSink after
   * construction. Called from Orchestrator constructor when agentRunSink is
   * present in OrchestratorDeps.
   */
  setAgentRunSink(sink: AgentRunSink): void {
    this.agentRunSink = sink;
  }

  async analyze(input: EmotionInput): Promise<CurrentEmotion> {
    const piEnabled = await this.getPiAgentEnabled();

    if (piEnabled) {
      return this._analyzePi(input);
    }
    return this._analyzeLegacy(input);
  }

  // ---------------------------------------------------------------------------
  // Legacy path — one-shot provider.chat(), unchanged from before Phase 2.
  // ---------------------------------------------------------------------------

  private async _analyzeLegacy(input: EmotionInput): Promise<CurrentEmotion> {
    const messages: ChatMessage[] = [
      { role: "system", content: EMOTION_SYSTEM_PROMPT },
      { role: "user", content: input.userUtterance },
    ];
    const t0 = performance.now();
    const res = await this.provider.chat(messages, {
      // Raised from 400 → 2048 because GLM-5.x reasoning models can burn the
      // whole budget in `reasoning_content` before writing `content`. Emotion
      // JSON output is small (<500 tokens); the headroom is free (it's a cap,
      // not consumption).
      max_tokens: 2048,
      temperature: 0.3,
      response_format: { type: "json_object" },
      // Emotion analysis doesn't benefit from chain-of-thought; disable it on
      // Zhipu GLM-5.x so `content` is generated directly (faster + cheaper).
      // Other providers ignore this option.
      enable_thinking: false,
      agent: "emotion",
    });
    const duration_ms = Math.round(performance.now() - t0);
    try {
      const obj = extractJson(res.content);
      const parsed = validateEmotion(obj);
      writeTrace({
        agent_kind: "emotion",
        prompt_text: input.userUtterance,
        raw_response: res.content,
        parsed_json: parsed,
        duration_ms,
      });
      return parsed;
    } catch (err) {
      // Persist the failure so DataExplorer 推理轨迹 tab can show the raw
      // response when parse/validate fails — otherwise the raw is invisible
      // to the user and we can only guess at the root cause.
      const errMessage = err instanceof Error ? err.message : String(err);
      writeTrace({
        agent_kind: "emotion",
        prompt_text: input.userUtterance,
        raw_response: res.content,
        parsed_json: { __parse_error__: errMessage, raw_len: res.content.length },
        duration_ms,
      });
      console.error(
        `[lyra] EmotionAgent parse failed (raw_len=${res.content.length}, provider=${this.provider.id}):`,
        errMessage,
        "| raw content:",
        JSON.stringify(res.content),
        "| provider raw payload:",
        res.raw,
      );
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // Pi path — iterate AssistantMessageEventStream via lyraStreamFn.
  //
  // EmotionAgent is single-turn + tool-free, so we don't need the full Agent
  // state machine. We directly call lyraStreamFn(provider)(model, context) and
  // await stream.result() to get the final AssistantMessage, then extract text
  // and parse JSON. This avoids adding @earendil-works/pi-agent-core to
  // package.json (Phase 2 stays fully vendored, same as Phase 1).
  // ---------------------------------------------------------------------------

  private async _analyzePi(input: EmotionInput): Promise<CurrentEmotion> {
    if (!this.streamableProvider) {
      console.warn(
        "[lyra] EmotionAgent: piAgentEnabled=true but no streamableProvider injected — " +
          "falling back to legacy path",
      );
      return this._analyzeLegacy(input);
    }

    const context: Context = {
      systemPrompt: EMOTION_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: input.userUtterance,
          timestamp: Date.now(),
        },
      ],
    };

    const streamFn = lyraStreamFn(this.streamableProvider);
    const runId = crypto.randomUUID();
    const turnId = crypto.randomUUID();
    const t0 = performance.now();

    this.agentRunSink?.start(runId, turnId, "emotion", t0);

    let finalMessage: AssistantMessage;
    try {
      const stream = await streamFn(EMOTION_PI_MODEL, context, {
        temperature: 0.3,
        maxTokens: 2048,
      });
      finalMessage = await stream.result();
    } catch (err) {
      const duration_ms = Math.round(performance.now() - t0);
      this.agentRunSink?.end(runId, "error");
      const errMessage = err instanceof Error ? err.message : String(err);
      writeTrace({
        agent_kind: "emotion",
        prompt_text: input.userUtterance,
        raw_response: "",
        parsed_json: { __pi_stream_error__: errMessage },
        duration_ms,
      });
      console.error("[lyra] EmotionAgent (pi) stream error:", errMessage);
      throw err;
    }

    const duration_ms = Math.round(performance.now() - t0);

    if (finalMessage.stopReason === "error" || finalMessage.stopReason === "aborted") {
      this.agentRunSink?.end(runId, finalMessage.stopReason === "aborted" ? "aborted_by_user" : "error");
      const errMsg = finalMessage.errorMessage ?? `pi stream ended with stopReason=${finalMessage.stopReason}`;
      writeTrace({
        agent_kind: "emotion",
        prompt_text: input.userUtterance,
        raw_response: "",
        parsed_json: { __pi_stop_error__: errMsg },
        duration_ms,
      });
      console.error("[lyra] EmotionAgent (pi) stream stop error:", errMsg);
      throw new EmotionAgentError(errMsg);
    }

    const rawText = extractTextFromAssistantMessage(finalMessage);
    try {
      const obj = extractJson(rawText);
      const parsed = validateEmotion(obj);
      this.agentRunSink?.end(runId, "ok");
      writeTrace({
        agent_kind: "emotion",
        prompt_text: input.userUtterance,
        raw_response: rawText,
        parsed_json: parsed,
        duration_ms,
      });
      return parsed;
    } catch (err) {
      this.agentRunSink?.end(runId, "error");
      const errMessage = err instanceof Error ? err.message : String(err);
      writeTrace({
        agent_kind: "emotion",
        prompt_text: input.userUtterance,
        raw_response: rawText,
        parsed_json: { __parse_error__: errMessage, raw_len: rawText.length },
        duration_ms,
      });
      console.error(
        `[lyra] EmotionAgent (pi) parse failed (raw_len=${rawText.length}):`,
        errMessage,
        "| raw content:",
        JSON.stringify(rawText),
      );
      throw err;
    }
  }
}
