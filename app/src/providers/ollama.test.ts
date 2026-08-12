import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OllamaProvider, DEFAULT_OLLAMA_ENDPOINT, DEFAULT_OLLAMA_MODEL } from "./ollama";

// ── fetch mock helpers ────────────────────────────────────────────────────────

function mockFetch(response: { ok: boolean; status?: number; body?: string | null; ndjson?: string[] }) {
  return vi.fn().mockResolvedValue({
    ok: response.ok,
    status: response.status ?? 200,
    text: () => Promise.resolve(response.body ?? ""),
    json: () => Promise.resolve(JSON.parse(response.body ?? "{}")),
    body: response.ndjson
      ? makeNdjsonReadableStream(response.ndjson)
      : null,
  });
}

function makeNdjsonReadableStream(lines: string[]) {
  const encoder = new TextEncoder();
  const chunks = lines.map((l) => encoder.encode(l + "\n"));
  let idx = 0;
  return {
    getReader: () => ({
      read: () => {
        if (idx < chunks.length) return Promise.resolve({ done: false, value: chunks[idx++] });
        return Promise.resolve({ done: true, value: undefined });
      },
      cancel: () => Promise.resolve(),
    }),
  };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("OllamaProvider", () => {
  let provider: OllamaProvider;

  beforeEach(() => {
    provider = new OllamaProvider();
    vi.stubGlobal("fetch", undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses default endpoint and model", () => {
    expect(provider.id).toBe("local-ollama");
  });

  it("chat() returns content from Ollama response", async () => {
    const payload = JSON.stringify({
      message: { role: "assistant", content: "Hello!" },
      prompt_eval_count: 5,
      eval_count: 3,
      done: true,
    });
    vi.stubGlobal("fetch", mockFetch({ ok: true, body: payload }));

    const result = await provider.chat([{ role: "user", content: "hi" }]);
    expect(result.content).toBe("Hello!");
    expect(result.usage?.input_tokens).toBe(5);
    expect(result.usage?.output_tokens).toBe(3);

    const fetchCall = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(fetchCall[0]).toBe(`${DEFAULT_OLLAMA_ENDPOINT}/api/chat`);
    const body = JSON.parse(fetchCall[1].body as string);
    expect(body.model).toBe(DEFAULT_OLLAMA_MODEL);
    expect(body.stream).toBe(false);
  });

  it("chat() throws descriptive error when Ollama is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(provider.chat([{ role: "user", content: "hi" }])).rejects.toThrow(
      /Ollama unreachable/,
    );
  });

  it("chat() throws on non-ok HTTP response", async () => {
    vi.stubGlobal("fetch", mockFetch({ ok: false, status: 404, body: "model not found" }));
    await expect(provider.chat([{ role: "user", content: "hi" }])).rejects.toThrow(
      /Ollama 404/,
    );
  });

  it("chatStream() yields text deltas and stop chunk", async () => {
    const lines = [
      JSON.stringify({ message: { role: "assistant", content: "Hi" }, done: false }),
      JSON.stringify({ message: { role: "assistant", content: " there" }, done: false }),
      JSON.stringify({ message: { role: "assistant", content: "" }, done: true }),
    ];
    vi.stubGlobal("fetch", mockFetch({ ok: true, ndjson: lines }));

    const chunks: { type: string; delta?: string }[] = [];
    for await (const chunk of provider.chatStream([{ role: "user", content: "hi" }], {})) {
      chunks.push(chunk);
    }

    const textChunks = chunks.filter((c) => c.type === "text");
    expect(textChunks.map((c) => c.delta).join("")).toBe("Hi there");
    const stop = chunks.find((c) => c.type === "stop");
    expect(stop).toEqual({ type: "stop", reason: "end" });
  });

  it("chatStream() yields error+stop when Ollama is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    const chunks: { type: string }[] = [];
    for await (const chunk of provider.chatStream([{ role: "user", content: "hi" }], {})) {
      chunks.push(chunk);
    }

    expect(chunks[0].type).toBe("error");
    expect(chunks[0]).toMatchObject({ type: "error", message: expect.stringContaining("Ollama unreachable") });
    expect(chunks[1]).toEqual({ type: "stop", reason: "error" });
  });

  it("chatStream() yields aborted stop when signal is aborted before fetch", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(Object.assign(new Error("aborted"), { name: "AbortError" })),
    );

    const chunks: { type: string; reason?: string }[] = [];
    for await (const chunk of provider.chatStream([{ role: "user", content: "hi" }], {}, ctrl.signal)) {
      chunks.push(chunk);
    }

    expect(chunks[0]).toEqual({ type: "stop", reason: "aborted" });
  });

  it("respects custom endpoint and model from constructor", async () => {
    const custom = new OllamaProvider({
      endpoint: "http://192.168.1.10:11434",
      model: "llama3:8b",
    });
    const payload = JSON.stringify({ message: { role: "assistant", content: "ok" }, done: true });
    vi.stubGlobal("fetch", mockFetch({ ok: true, body: payload }));

    await custom.chat([{ role: "user", content: "test" }]);
    const fetchCall = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(fetchCall[0]).toBe("http://192.168.1.10:11434/api/chat");
    const body = JSON.parse(fetchCall[1].body as string);
    expect(body.model).toBe("llama3:8b");
  });
});
