import type {
  ModelProvider,
  ChatMessage,
  ChatOptions,
  ChatResponse,
} from "../types";
import type { Chunk, ChatStreamOptions } from "./chunk";

export const DEFAULT_OLLAMA_ENDPOINT = "http://localhost:11434";
export const DEFAULT_OLLAMA_MODEL = "qwen2.5:latest";

// Hard-coded to match the CSP connect-src allowlist in tauri.conf.json.
// If this ever changes, update the CSP simultaneously.
const CHAT_PATH = "/api/chat";

export class OllamaProvider implements ModelProvider {
  readonly id = "local-ollama" as const;
  private endpoint: string;
  private defaultModel: string;

  constructor(opts?: { endpoint?: string; model?: string }) {
    this.endpoint = (opts?.endpoint ?? DEFAULT_OLLAMA_ENDPOINT).replace(/\/$/, "");
    this.defaultModel = opts?.model ?? DEFAULT_OLLAMA_MODEL;
  }

  async chat(messages: ChatMessage[], opts?: ChatOptions): Promise<ChatResponse> {
    const model = opts?.model ?? this.defaultModel;
    const body: Record<string, unknown> = {
      model,
      stream: false,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    };
    if (opts?.temperature != null) body.options = { temperature: opts.temperature };

    let res: Response;
    try {
      res = await fetch(`${this.endpoint}${CHAT_PATH}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new Error(
        `Ollama unreachable at ${this.endpoint} — is Ollama running? (${String(err)})`,
      );
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Ollama ${res.status}: ${text}`);
    }

    const data = await res.json();
    const content: string = data.message?.content ?? "";
    const usage = data.prompt_eval_count != null
      ? {
          input_tokens: data.prompt_eval_count as number,
          output_tokens: (data.eval_count as number) ?? 0,
        }
      : undefined;

    return { content, model, usage, raw: data };
  }

  async *chatStream(
    messages: ChatMessage[],
    opts: ChatStreamOptions,
    signal?: AbortSignal,
  ): AsyncIterable<Chunk> {
    const model = this.defaultModel;
    const body: Record<string, unknown> = {
      model,
      stream: true,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    };
    if (opts.temperature != null) body.options = { temperature: opts.temperature };
    // Ollama 0.3+ tool calling: forward tools if provided
    if (opts.tools != null) body.tools = opts.tools;

    let res: Response;
    try {
      res = await fetch(`${this.endpoint}${CHAT_PATH}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      if (signal?.aborted) {
        yield { type: "stop", reason: "aborted" };
        return;
      }
      yield {
        type: "error",
        message: `Ollama unreachable at ${this.endpoint} — is Ollama running? (${String(err)})`,
      };
      yield { type: "stop", reason: "error" };
      return;
    }

    if (!res.ok) {
      const text = await res.text();
      yield { type: "error", message: `Ollama ${res.status}: ${text}` };
      yield { type: "stop", reason: "error" };
      return;
    }

    // Ollama streaming: NDJSON — each line is a JSON object
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    // Accumulate tool_call args per index (Ollama 0.3+)
    const argsAccum: Record<number, string> = {};

    while (true) {
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

      // NDJSON: split on newlines
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        let event: Record<string, unknown>;
        try {
          event = JSON.parse(trimmed) as Record<string, unknown>;
        } catch {
          continue;
        }

        // Text delta
        const msg = event.message as Record<string, unknown> | undefined;
        if (msg?.content != null && msg.content !== "") {
          yield { type: "text", delta: String(msg.content) };
        }

        // Tool calls (Ollama 0.3+ format, similar to OpenAI compat)
        const toolCalls = msg?.tool_calls as Array<Record<string, unknown>> | undefined;
        if (toolCalls) {
          for (let idx = 0; idx < toolCalls.length; idx++) {
            const tc = toolCalls[idx];
            argsAccum[idx] = argsAccum[idx] ?? "";
            const fn = tc.function as Record<string, unknown> | undefined;
            const id = tc.id != null ? String(tc.id) : String(idx);
            const name = fn?.name != null ? String(fn.name) : undefined;
            const argsDelta =
              fn?.arguments != null
                ? typeof fn.arguments === "string"
                  ? fn.arguments
                  : JSON.stringify(fn.arguments)
                : "";
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

        if (event.done === true) {
          // Check if done reason was tool_calls
          if (toolCalls?.length) {
            yield { type: "stop", reason: "tool_use" };
          } else {
            yield { type: "stop", reason: "end" };
          }
          return;
        }
      }
    }

    yield { type: "stop", reason: "end" };
  }
}
