import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DeepSeekProvider } from "./deepseek";
import type { Chunk } from "./chunk";

// ---------------------------------------------------------------------------
// SSE stream helpers
// ---------------------------------------------------------------------------

function makeSseStream(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(line + "\n"));
      }
      controller.close();
    },
  });
}

async function collectChunks(iterable: AsyncIterable<Chunk>): Promise<Chunk[]> {
  const chunks: Chunk[] = [];
  for await (const c of iterable) {
    chunks.push(c);
  }
  return chunks;
}

describe("DeepSeekProvider", () => {
  const originalFetch = globalThis.fetch;
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("id is 'deepseek'", () => {
    expect(new DeepSeekProvider({ apiKey: "x" }).id).toBe("deepseek");
  });

  it("posts to /v1/chat/completions with Bearer", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { role: "assistant", content: "hi" } }],
        usage: { prompt_tokens: 3, completion_tokens: 1 },
      }),
    });
    const p = new DeepSeekProvider({ apiKey: "sk-d" });
    const res = await p.chat([{ role: "user", content: "hello" }]);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.deepseek.com/v1/chat/completions");
    expect((init as any).headers["authorization"]).toBe("Bearer sk-d");
    const body = JSON.parse((init as any).body);
    expect(body.model).toBe("deepseek-chat");
    expect(body.messages).toEqual([{ role: "user", content: "hello" }]);

    expect(res.content).toBe("hi");
    expect(res.usage).toEqual({ input_tokens: 3, output_tokens: 1 });
  });

  it("preserves system role in the messages array", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "ok" } }] }),
    });
    const p = new DeepSeekProvider({ apiKey: "x" });
    await p.chat([
      { role: "system", content: "sys" },
      { role: "user", content: "u" },
    ]);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
    expect(body.messages).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "u" },
    ]);
  });

  it("throws on non-ok status", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: async () => "rate limit",
    });
    const p = new DeepSeekProvider({ apiKey: "x" });
    await expect(p.chat([{ role: "user", content: "hi" }])).rejects.toThrow(/429/);
  });

  // -------------------------------------------------------------------------
  // chatStream tests
  // -------------------------------------------------------------------------

  describe("chatStream", () => {
    it("emits text chunks and stop:end from OpenAI-compat SSE", async () => {
      const sseLines = [
        `data: ${JSON.stringify({ choices: [{ delta: { content: "Hello" }, finish_reason: null }] })}`,
        `data: ${JSON.stringify({ choices: [{ delta: { content: " world" }, finish_reason: null }] })}`,
        `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}`,
      ];
      fetchMock.mockResolvedValueOnce({
        ok: true,
        body: makeSseStream(sseLines),
      });

      const p = new DeepSeekProvider({ apiKey: "sk-d" });
      const chunks = await collectChunks(
        p.chatStream([{ role: "user", content: "hi" }], {}),
      );

      expect(chunks.filter((c) => c.type === "text")).toEqual([
        { type: "text", delta: "Hello" },
        { type: "text", delta: " world" },
      ]);
      expect(chunks[chunks.length - 1]).toEqual({ type: "stop", reason: "end" });
    });

    it("emits tool_call chunks with accumulated args and stop:tool_use", async () => {
      const sseLines = [
        `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_42", function: { name: "search_library", arguments: "" } }] }, finish_reason: null }] })}`,
        `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"q"' } }] }, finish_reason: null }] })}`,
        `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ':"rain"}' } }] }, finish_reason: null }] })}`,
        `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }] })}`,
      ];
      fetchMock.mockResolvedValueOnce({
        ok: true,
        body: makeSseStream(sseLines),
      });

      const p = new DeepSeekProvider({ apiKey: "sk-d" });
      const chunks = await collectChunks(
        p.chatStream([{ role: "user", content: "hi" }], { tools: [{}] }),
      );

      const toolChunks = chunks.filter((c) => c.type === "tool_call") as Extract<Chunk, { type: "tool_call" }>[];
      expect(toolChunks[0]).toMatchObject({ type: "tool_call", id: "call_42", name: "search_library" });
      expect(toolChunks[1]).toMatchObject({ type: "tool_call", argsDelta: '{"q"' });
      expect(toolChunks[2]).toMatchObject({ type: "tool_call", argsDelta: ':"rain"}' });
      expect(toolChunks[2].argsAccum).toBe('{"q":"rain"}');
      expect(chunks[chunks.length - 1]).toEqual({ type: "stop", reason: "tool_use" });
    });

    it("emits error chunk then stop:error on non-ok HTTP response", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "internal error",
      });

      const p = new DeepSeekProvider({ apiKey: "sk-d" });
      const chunks = await collectChunks(
        p.chatStream([{ role: "user", content: "hi" }], {}),
      );

      expect(chunks[0]).toMatchObject({ type: "error", message: /500/ });
      expect(chunks[1]).toEqual({ type: "stop", reason: "error" });
    });

    it("emits stop:aborted when AbortSignal fires before fetch resolves", async () => {
      fetchMock.mockRejectedValueOnce(
        Object.assign(new DOMException("aborted", "AbortError"), {}),
      );

      const controller = new AbortController();
      controller.abort();

      const p = new DeepSeekProvider({ apiKey: "sk-d" });
      const chunks = await collectChunks(
        p.chatStream([{ role: "user", content: "hi" }], {}, controller.signal),
      );

      expect(chunks).toEqual([{ type: "stop", reason: "aborted" }]);
    });

    it("sets stream:true in the request body", async () => {
      const sseLines = [
        `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}`,
      ];
      fetchMock.mockResolvedValueOnce({
        ok: true,
        body: makeSseStream(sseLines),
      });

      const p = new DeepSeekProvider({ apiKey: "sk-d" });
      await collectChunks(p.chatStream([{ role: "user", content: "hi" }], {}));

      const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
      expect(body.stream).toBe(true);
    });
  });
});
