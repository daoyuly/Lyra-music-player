import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ZhipuProvider } from "./zhipu";
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

describe("ZhipuProvider", () => {
  const originalFetch = globalThis.fetch;
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("id is 'zhipu'", () => {
    expect(new ZhipuProvider({ apiKey: "x" }).id).toBe("zhipu");
  });

  it("posts to open.bigmodel.cn /api/paas/v4/chat/completions with Bearer auth", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { role: "assistant", content: "你好" } }],
        usage: { prompt_tokens: 5, completion_tokens: 2 },
      }),
    });
    const p = new ZhipuProvider({ apiKey: "sk-zp" });
    const res = await p.chat([{ role: "user", content: "hi" }]);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://open.bigmodel.cn/api/paas/v4/chat/completions");
    expect((init as any).headers["authorization"]).toBe("Bearer sk-zp");
    const body = JSON.parse((init as any).body);
    expect(body.model).toBe("glm-5.2");
    expect(body.messages).toEqual([{ role: "user", content: "hi" }]);

    expect(res.content).toBe("你好");
    expect(res.usage).toEqual({ input_tokens: 5, output_tokens: 2 });
  });

  it("preserves system role inline in messages (Zhipu uses OpenAI-compat)", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "ok" } }] }),
    });
    const p = new ZhipuProvider({ apiKey: "x" });
    await p.chat([
      { role: "system", content: "你是 Lyra" },
      { role: "user", content: "hi" },
    ]);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
    expect(body.messages).toEqual([
      { role: "system", content: "你是 Lyra" },
      { role: "user", content: "hi" },
    ]);
  });

  it("forwards response_format when caller requests JSON mode", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"a":1}' } }] }),
    });
    const p = new ZhipuProvider({ apiKey: "x" });
    await p.chat([{ role: "user", content: "hi" }], {
      response_format: { type: "json_object" },
    });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
    expect(body.response_format).toEqual({ type: "json_object" });
  });

  it("forwards enable_thinking:false to disable GLM-5.x reasoning phase", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"ok":1}' } }] }),
    });
    const p = new ZhipuProvider({ apiKey: "x" });
    await p.chat([{ role: "user", content: "hi" }], { enable_thinking: false });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
    expect(body.enable_thinking).toBe(false);
  });

  it("omits enable_thinking when caller does not set it", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "ok" } }] }),
    });
    const p = new ZhipuProvider({ apiKey: "x" });
    await p.chat([{ role: "user", content: "hi" }]);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
    expect("enable_thinking" in body).toBe(false);
  });

  it("omits response_format when caller does not set it", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "ok" } }] }),
    });
    const p = new ZhipuProvider({ apiKey: "x" });
    await p.chat([{ role: "user", content: "hi" }]);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
    expect(body.response_format).toBeUndefined();
  });

  it("throws on non-ok status with body text and status code", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => "invalid api key",
    });
    const p = new ZhipuProvider({ apiKey: "bad" });
    await expect(p.chat([{ role: "user", content: "hi" }])).rejects.toThrow(/401/);
  });

  // -------------------------------------------------------------------------
  // chatStream tests
  // -------------------------------------------------------------------------

  describe("chatStream", () => {
    it("emits text chunks and stop:end from OpenAI-compat SSE", async () => {
      const sseLines = [
        `data: ${JSON.stringify({ choices: [{ delta: { content: "你好" }, finish_reason: null }] })}`,
        `data: ${JSON.stringify({ choices: [{ delta: { content: "！" }, finish_reason: null }] })}`,
        `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}`,
      ];
      fetchMock.mockResolvedValueOnce({
        ok: true,
        body: makeSseStream(sseLines),
      });

      const p = new ZhipuProvider({ apiKey: "sk-zp" });
      const chunks = await collectChunks(
        p.chatStream([{ role: "user", content: "hi" }], {}),
      );

      expect(chunks.filter((c) => c.type === "text")).toEqual([
        { type: "text", delta: "你好" },
        { type: "text", delta: "！" },
      ]);
      expect(chunks[chunks.length - 1]).toEqual({ type: "stop", reason: "end" });
    });

    it("emits tool_call chunks with accumulated args and stop:tool_use", async () => {
      const sseLines = [
        `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "tc_1", function: { name: "get_song_features", arguments: "" } }] }, finish_reason: null }] })}`,
        `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"id"' } }] }, finish_reason: null }] })}`,
        `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ':42}' } }] }, finish_reason: null }] })}`,
        `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }] })}`,
      ];
      fetchMock.mockResolvedValueOnce({
        ok: true,
        body: makeSseStream(sseLines),
      });

      const p = new ZhipuProvider({ apiKey: "sk-zp" });
      const chunks = await collectChunks(
        p.chatStream([{ role: "user", content: "hi" }], { tools: [{}] }),
      );

      const toolChunks = chunks.filter((c) => c.type === "tool_call") as Extract<Chunk, { type: "tool_call" }>[];
      expect(toolChunks[0]).toMatchObject({ type: "tool_call", id: "tc_1", name: "get_song_features" });
      expect(toolChunks[1]).toMatchObject({ type: "tool_call", argsDelta: '{"id"' });
      expect(toolChunks[2]).toMatchObject({ type: "tool_call", argsDelta: ":42}" });
      expect(toolChunks[2].argsAccum).toBe('{"id":42}');
      expect(chunks[chunks.length - 1]).toEqual({ type: "stop", reason: "tool_use" });
    });

    it("when opts.tools is non-empty: first chunk is warning and request body has enable_thinking:false", async () => {
      const sseLines = [
        `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}`,
      ];
      fetchMock.mockResolvedValueOnce({
        ok: true,
        body: makeSseStream(sseLines),
      });

      const p = new ZhipuProvider({ apiKey: "sk-zp" });
      const chunks = await collectChunks(
        p.chatStream(
          [{ role: "user", content: "hi" }],
          { tools: [{ name: "search_library" }], enable_thinking: true },
        ),
      );

      // First emitted chunk must be the warning
      expect(chunks[0]).toEqual({
        type: "warning",
        message: "Zhipu: enable_thinking forced to false because tools were requested",
      });

      // Request body must have enable_thinking:false
      const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
      expect(body.enable_thinking).toBe(false);
      expect(body.tools).toBeDefined();
    });

    it("does NOT emit warning and does NOT set enable_thinking when no tools", async () => {
      const sseLines = [
        `data: ${JSON.stringify({ choices: [{ delta: { content: "ok" }, finish_reason: null }] })}`,
        `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}`,
      ];
      fetchMock.mockResolvedValueOnce({
        ok: true,
        body: makeSseStream(sseLines),
      });

      const p = new ZhipuProvider({ apiKey: "sk-zp" });
      const chunks = await collectChunks(
        p.chatStream([{ role: "user", content: "hi" }], {}),
      );

      expect(chunks.some((c) => c.type === "warning")).toBe(false);
      const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
      expect("enable_thinking" in body).toBe(false);
    });

    it("emits error chunk then stop:error on non-ok HTTP response", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: async () => "forbidden",
      });

      const p = new ZhipuProvider({ apiKey: "sk-zp" });
      const chunks = await collectChunks(
        p.chatStream([{ role: "user", content: "hi" }], {}),
      );

      expect(chunks[0]).toMatchObject({ type: "error", message: /403/ });
      expect(chunks[1]).toEqual({ type: "stop", reason: "error" });
    });

    it("emits stop:aborted when AbortSignal fires before fetch resolves", async () => {
      fetchMock.mockRejectedValueOnce(
        Object.assign(new DOMException("aborted", "AbortError"), {}),
      );

      const controller = new AbortController();
      controller.abort();

      const p = new ZhipuProvider({ apiKey: "sk-zp" });
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

      const p = new ZhipuProvider({ apiKey: "sk-zp" });
      await collectChunks(p.chatStream([{ role: "user", content: "hi" }], {}));

      const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
      expect(body.stream).toBe(true);
    });
  });
});
