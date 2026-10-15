import type {
  ModelProvider,
  ChatMessage,
  ChatOptions,
  ChatResponse,
} from "../types";
import type { Chunk, ChatStreamOptions } from "./chunk";
import { providerFetchErrorMessage } from "../lib/formatError";
import { lyraHttp, iterSseDataLines } from "../lib/lyraHttp";

const DEFAULT_MODEL = "deepseek-chat";
// Hard-coded to match the CSP connect-src allowlist in tauri.conf.json.
// If this ever changes, update the CSP simultaneously.
const ENDPOINT = "https://api.deepseek.com/v1/chat/completions";

export class DeepSeekProvider implements ModelProvider {
  readonly id = "deepseek" as const;
  private apiKey: string;
  private defaultModel: string;

  constructor(opts: { apiKey: string; model?: string }) {
    if (!opts.apiKey) throw new Error("DeepSeekProvider requires apiKey");
    this.apiKey = opts.apiKey;
    this.defaultModel = opts.model ?? DEFAULT_MODEL;
  }

  async chat(messages: ChatMessage[], opts?: ChatOptions): Promise<ChatResponse> {
    const body: Record<string, unknown> = {
      model: opts?.model ?? this.defaultModel,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    };
    if (opts?.max_tokens != null) body.max_tokens = opts.max_tokens;
    if (opts?.temperature != null) body.temperature = opts.temperature;
    if (opts?.response_format) body.response_format = opts.response_format;

    let result: { status: number; body: string };
    try {
      result = await lyraHttp(ENDPOINT, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        label: "deepseek",
      });
    } catch (err) {
      throw new Error(providerFetchErrorMessage("DeepSeek", ENDPOINT, err));
    }

    if (result.status < 200 || result.status >= 300) {
      throw new Error(`DeepSeek ${result.status}: ${result.body}`);
    }

    const data = JSON.parse(result.body);
    const content: string = data.choices?.[0]?.message?.content ?? "";
    const usage = data.usage
      ? {
          input_tokens: data.usage.prompt_tokens ?? 0,
          output_tokens: data.usage.completion_tokens ?? 0,
        }
      : undefined;

    return { content, model: opts?.model ?? this.defaultModel, usage, raw: data };
  }

  async *chatStream(
    messages: ChatMessage[],
    opts: ChatStreamOptions,
    signal?: AbortSignal,
  ): AsyncIterable<Chunk> {
    const body: Record<string, unknown> = {
      model: this.defaultModel,
      stream: true,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    };
    if (opts.max_tokens != null) body.max_tokens = opts.max_tokens;
    if (opts.temperature != null) body.temperature = opts.temperature;
    if (opts.tools != null) body.tools = opts.tools;

    let result: { status: number; body: string };
    try {
      result = await lyraHttp(ENDPOINT, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal,
        label: "deepseek",
      });
    } catch (err) {
      if (signal?.aborted) {
        yield { type: "stop", reason: "aborted" };
        return;
      }
      yield {
        type: "error",
        message: providerFetchErrorMessage("DeepSeek", ENDPOINT, err),
      };
      yield { type: "stop", reason: "error" };
      return;
    }

    if (result.status < 200 || result.status >= 300) {
      yield { type: "error", message: `DeepSeek ${result.status}: ${result.body}` };
      yield { type: "stop", reason: "error" };
      return;
    }

    // Accumulate tool_call args per OpenAI-compat index
    const argsAccum: Record<number, string> = {};

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

      const choices = event.choices as Array<Record<string, unknown>> | undefined;
      if (!choices?.length) continue;

      const choice = choices[0];
      const delta = choice.delta as Record<string, unknown> | undefined;
      const finishReason = choice.finish_reason as string | null | undefined;

      // Text delta
      if (delta?.content != null && delta.content !== "") {
        yield { type: "text", delta: String(delta.content) };
      }

      // Tool call deltas (OpenAI-compat: array of {index, id?, function: {name?, arguments?}})
      const toolCalls = delta?.tool_calls as Array<Record<string, unknown>> | undefined;
      if (toolCalls) {
        for (const tc of toolCalls) {
          const idx = (tc.index as number) ?? 0;
          argsAccum[idx] = argsAccum[idx] ?? "";
          const fn = tc.function as Record<string, unknown> | undefined;
          const id = tc.id != null ? String(tc.id) : String(idx);
          const name = fn?.name != null ? String(fn.name) : undefined;
          const argsDelta = fn?.arguments != null ? String(fn.arguments) : "";
          argsAccum[idx] += argsDelta;
          yield {
            type: "tool_call",
            id,
            ...(name != null ? { name } : {}),
            argsDelta,
            argsAccum: argsAccum[idx],
          };
        }
      }

      if (finishReason === "tool_calls") {
        yield { type: "stop", reason: "tool_use" };
        return;
      }
      if (finishReason === "stop") {
        yield { type: "stop", reason: "end" };
        return;
      }
    }

    yield { type: "stop", reason: "end" };
  }
}
