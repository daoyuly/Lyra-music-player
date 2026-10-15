import type {
  ModelProvider,
  ChatMessage,
  ChatOptions,
  ChatResponse,
} from "../types";
import type { Chunk, ChatStreamOptions } from "./chunk";
import { providerFetchErrorMessage } from "../lib/formatError";
import { lyraHttp, iterSseDataLines } from "../lib/lyraHttp";

const DEFAULT_MODEL = "claude-opus-4-7";
const DEFAULT_MAX_TOKENS = 1024;
// Hard-coded to match the CSP connect-src allowlist in tauri.conf.json.
// If this ever changes, update the CSP simultaneously.
const ENDPOINT = "https://api.anthropic.com/v1/messages";

export class AnthropicProvider implements ModelProvider {
  readonly id = "anthropic" as const;
  private apiKey: string;
  private defaultModel: string;

  constructor(opts: { apiKey: string; model?: string }) {
    if (!opts.apiKey) throw new Error("AnthropicProvider requires apiKey");
    this.apiKey = opts.apiKey;
    this.defaultModel = opts.model ?? DEFAULT_MODEL;
  }

  async chat(messages: ChatMessage[], opts?: ChatOptions): Promise<ChatResponse> {
    const systemParts = messages
      .filter((m) => m.role === "system")
      .map((m) => m.content);
    const nonSystem = messages.filter((m) => m.role !== "system");

    const body: Record<string, unknown> = {
      model: opts?.model ?? this.defaultModel,
      max_tokens: opts?.max_tokens ?? DEFAULT_MAX_TOKENS,
      messages: nonSystem.map((m) => ({ role: m.role, content: m.content })),
    };
    if (systemParts.length > 0) body.system = systemParts.join("\n\n");
    if (opts?.temperature != null) body.temperature = opts.temperature;

    let result: { status: number; body: string };
    try {
      result = await lyraHttp(ENDPOINT, {
        method: "POST",
        headers: {
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        label: "anthropic",
      });
    } catch (err) {
      throw new Error(providerFetchErrorMessage("Anthropic", ENDPOINT, err));
    }

    if (result.status < 200 || result.status >= 300) {
      throw new Error(`Anthropic ${result.status}: ${result.body}`);
    }

    const data = JSON.parse(result.body);
    const content = (data.content ?? [])
      .filter((b: { type: string }) => b.type === "text")
      .map((b: { text: string }) => b.text)
      .join("");

    return {
      content,
      model: opts?.model ?? this.defaultModel,
      usage: data.usage,
      raw: data,
    };
  }

  async *chatStream(
    messages: ChatMessage[],
    opts: ChatStreamOptions,
    signal?: AbortSignal,
  ): AsyncIterable<Chunk> {
    const systemParts = messages
      .filter((m) => m.role === "system")
      .map((m) => m.content);
    const nonSystem = messages.filter((m) => m.role !== "system");

    const body: Record<string, unknown> = {
      model: this.defaultModel,
      max_tokens: opts.max_tokens ?? DEFAULT_MAX_TOKENS,
      stream: true,
      messages: nonSystem.map((m) => ({ role: m.role, content: m.content })),
    };
    if (systemParts.length > 0) body.system = systemParts.join("\n\n");
    if (opts.temperature != null) body.temperature = opts.temperature;
    if (opts.tools != null) body.tools = toAnthropicTools(opts.tools);

    let result: { status: number; body: string };
    try {
      result = await lyraHttp(ENDPOINT, {
        method: "POST",
        headers: {
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal,
        label: "anthropic",
      });
    } catch (err) {
      if (signal?.aborted) {
        yield { type: "stop", reason: "aborted" };
        return;
      }
      yield {
        type: "error",
        message: providerFetchErrorMessage("Anthropic", ENDPOINT, err),
      };
      yield { type: "stop", reason: "error" };
      return;
    }

    if (result.status < 200 || result.status >= 300) {
      yield { type: "error", message: `Anthropic ${result.status}: ${result.body}` };
      yield { type: "stop", reason: "error" };
      return;
    }

    // Track accumulated args per tool_call index so we can provide argsAccum
    const argsAccum: Record<string, string> = {};

    for (const raw of iterSseDataLines(result.body)) {
      if (signal?.aborted) {
        yield { type: "stop", reason: "aborted" };
        return;
      }
      if (raw === "[DONE]") break;

      let event: Record<string, unknown>;
      try {
        event = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        continue;
      }

      const evType = event.type as string | undefined;

      if (evType === "error") {
        const errObj = event.error as Record<string, unknown> | undefined;
        yield { type: "error", message: String(errObj?.message ?? raw) };
        yield { type: "stop", reason: "error" };
        return;
      }

      if (evType === "content_block_delta") {
        const delta = event.delta as Record<string, unknown> | undefined;
        const deltaType = delta?.type as string | undefined;
        const index = event.index as number | undefined;
        const idxKey = String(index ?? 0);

        if (deltaType === "text_delta") {
          yield { type: "text", delta: String(delta?.text ?? "") };
        } else if (deltaType === "input_json_delta") {
          const argsDelta = String(delta?.partial_json ?? "");
          argsAccum[idxKey] = (argsAccum[idxKey] ?? "") + argsDelta;
          // id and name come from the content_block_start event; we
          // re-use idxKey as the id placeholder until we have the real one.
          yield {
            type: "tool_call",
            id: idxKey,
            argsDelta,
            argsAccum: argsAccum[idxKey],
          };
        }
      }

      if (evType === "content_block_start") {
        const block = event.content_block as Record<string, unknown> | undefined;
        if (block?.type === "tool_use") {
          const id = String(block.id ?? "");
          const name = String(block.name ?? "");
          const index = event.index as number | undefined;
          const idxKey = String(index ?? 0);
          argsAccum[idxKey] = "";
          yield { type: "tool_call", id, name, argsDelta: "", argsAccum: "" };
        }
      }

      if (evType === "message_delta") {
        const delta = event.delta as Record<string, unknown> | undefined;
        const stopReason = delta?.stop_reason as string | undefined;
        if (stopReason === "tool_use") {
          yield { type: "stop", reason: "tool_use" };
          return;
        }
        if (stopReason === "end_turn") {
          yield { type: "stop", reason: "end" };
          return;
        }
      }

      if (evType === "message_stop") {
        yield { type: "stop", reason: "end" };
        return;
      }
    }

    yield { type: "stop", reason: "end" };
  }
}

// ── Tool schema translation ─────────────────────────────────────────────────
//
// Lyra's agent layer uses OpenAI-compatible tool format internally
// ({ name, description, parameters }). Anthropic expects
// ({ name, description, input_schema }). This function is the boundary
// translator — called only by anthropic.chatStream, keeps the rest of the
// stack provider-agnostic.
//
// If the input already looks like Anthropic native (has `input_schema`),
// it's passed through untouched — future-proofs against callers that
// explicitly build for Anthropic.
export function toAnthropicTools(tools: unknown[]): unknown[] {
  return tools.map((t) => {
    if (typeof t !== "object" || t === null) return t;
    const rec = t as Record<string, unknown>;
    if ("input_schema" in rec) return rec; // already Anthropic-native
    if ("parameters" in rec) {
      const { parameters, ...rest } = rec;
      return { ...rest, input_schema: parameters };
    }
    return rec;
  });
}
