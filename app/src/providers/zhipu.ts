import type {
  ModelProvider,
  ChatMessage,
  ChatOptions,
  ChatResponse,
} from "../types";
import type { Chunk, ChatStreamOptions } from "./chunk";

const DEFAULT_MODEL = "glm-5.2";
// Hard-coded to match the CSP connect-src allowlist in tauri.conf.json.
// If this ever changes, update the CSP simultaneously.
const ENDPOINT = "https://open.bigmodel.cn/api/paas/v4/chat/completions";

/**
 * ZhipuProvider — 智谱 GLM adapter, OpenAI-compat wire format.
 * Recommended per spec §3.5 as the emotion agent's primary model.
 */
export class ZhipuProvider implements ModelProvider {
  readonly id = "zhipu" as const;
  private apiKey: string;
  private defaultModel: string;

  constructor(opts: { apiKey: string; model?: string }) {
    if (!opts.apiKey) throw new Error("ZhipuProvider requires apiKey");
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
    if (opts?.enable_thinking != null) body.enable_thinking = opts.enable_thinking;

    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Zhipu ${res.status}: ${text}`);
    }

    const data = await res.json();
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
    // v3.1 §Phase 1 子线 A: tools + enable_thinking conflict resolution.
    // If tools are requested, enable_thinking MUST be false.
    // Emit a warning chunk FIRST so the caller is not silently surprised.
    const hasTools = opts.tools != null && (opts.tools as unknown[]).length > 0;
    if (hasTools && opts.enable_thinking !== false) {
      yield {
        type: "warning",
        message:
          "Zhipu: enable_thinking forced to false because tools were requested",
      };
    }
    const effectiveEnableThinking = hasTools ? false : opts.enable_thinking;

    const body: Record<string, unknown> = {
      model: this.defaultModel,
      stream: true,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    };
    if (opts.max_tokens != null) body.max_tokens = opts.max_tokens;
    if (opts.temperature != null) body.temperature = opts.temperature;
    if (opts.tools != null) body.tools = opts.tools;
    if (effectiveEnableThinking != null)
      body.enable_thinking = effectiveEnableThinking;

    let res: Response;
    try {
      res = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      if (signal?.aborted) {
        yield { type: "stop", reason: "aborted" };
        return;
      }
      yield { type: "error", message: String(err) };
      yield { type: "stop", reason: "error" };
      return;
    }

    if (!res.ok) {
      const text = await res.text();
      yield { type: "error", message: `Zhipu ${res.status}: ${text}` };
      yield { type: "stop", reason: "error" };
      return;
    }

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    // Accumulate tool_call args per OpenAI-compat index
    const argsAccum: Record<number, string> = {};

    outer: while (true) {
      if (signal?.aborted) {
        reader.cancel();
        yield { type: "stop", reason: "aborted" };
        return;
      }

      let done: boolean;
      let value: Uint8Array | undefined;
      try {
        ({ done, value } = await reader.read());
      } catch {
        if (signal?.aborted) {
          yield { type: "stop", reason: "aborted" };
          return;
        }
        yield { type: "error", message: "Stream read error" };
        yield { type: "stop", reason: "error" };
        return;
      }

      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const raw = trimmed.slice(5).trim();
        if (raw === "[DONE]") break outer;

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

        // Tool call deltas (OpenAI-compat)
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
    }

    yield { type: "stop", reason: "end" };
  }
}
