import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AnthropicProvider, toAnthropicTools } from "./anthropic";
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

describe("AnthropicProvider", () => {
  const originalFetch = globalThis.fetch;
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("has id 'anthropic'", () => {
    const p = new AnthropicProvider({ apiKey: "sk-x" });
    expect(p.id).toBe("anthropic");
  });

  it("posts messages to /v1/messages with x-api-key", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [{ type: "text", text: "hi" }],
        usage: { input_tokens: 3, output_tokens: 1 },
      }),
    });

    const p = new AnthropicProvider({ apiKey: "sk-abc", model: "claude-opus-4-7" });
    const res = await p.chat([
      { role: "user", content: "hello" },
    ]);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect((init as any).method).toBe("POST");
    expect((init as any).headers["x-api-key"]).toBe("sk-abc");
    expect((init as any).headers["anthropic-version"]).toBe("2023-06-01");
    const body = JSON.parse((init as any).body);
    expect(body.model).toBe("claude-opus-4-7");
    expect(body.messages).toEqual([{ role: "user", content: "hello" }]);
    expect(body.max_tokens).toBeGreaterThan(0);

    expect(res.content).toBe("hi");
    expect(res.usage).toEqual({ input_tokens: 3, output_tokens: 1 });
  });

  it("throws on non-ok response with body text", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => "bad key",
    });
    const p = new AnthropicProvider({ apiKey: "sk-bad" });
    await expect(p.chat([{ role: "user", content: "hi" }])).rejects.toThrow(/401/);
  });

  it("passes system messages via top-level 'system' field", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: [{ type: "text", text: "ok" }] }),
    });
    const p = new AnthropicProvider({ apiKey: "sk-x" });
    await p.chat([
      { role: "system", content: "you are lyra" },
      { role: "user", content: "hi" },
    ]);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
    expect(body.system).toBe("you are lyra");
    expect(body.messages).toEqual([{ role: "user", content: "hi" }]);
  });

  // -------------------------------------------------------------------------
  // chatStream tests
  // -------------------------------------------------------------------------

  describe("chatStream", () => {
    it("emits text chunks and stop:end from SSE stream", async () => {
      const sseLines = [
        `data: ${JSON.stringify({ type: "message_start", message: {} })}`,
        `data: ${JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } })}`,
        `data: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello" } })}`,
        `data: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: " world" } })}`,
        `data: ${JSON.stringify({ type: "content_block_stop", index: 0 })}`,
        `data: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn" } })}`,
      ];
      fetchMock.mockResolvedValueOnce({
        ok: true,
        body: makeSseStream(sseLines),
      });

      const p = new AnthropicProvider({ apiKey: "sk-x" });
      const chunks = await collectChunks(
        p.chatStream([{ role: "user", content: "hi" }], {}),
      );

      expect(chunks.filter((c) => c.type === "text")).toEqual([
        { type: "text", delta: "Hello" },
        { type: "text", delta: " world" },
      ]);
      expect(chunks[chunks.length - 1]).toEqual({ type: "stop", reason: "end" });
    });

    it("emits tool_call chunks with name and argsDelta, then stop:tool_use", async () => {
      const sseLines = [
        `data: ${JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "call_1", name: "search_library" } })}`,
        `data: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"q"' } })}`,
        `data: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: ':"rain"}' } })}`,
        `data: ${JSON.stringify({ type: "content_block_stop", index: 0 })}`,
        `data: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "tool_use" } })}`,
      ];
      fetchMock.mockResolvedValueOnce({
        ok: true,
        body: makeSseStream(sseLines),
      });

      const p = new AnthropicProvider({ apiKey: "sk-x" });
      const chunks = await collectChunks(
        p.chatStream([{ role: "user", content: "hi" }], { tools: [{}] }),
      );

      const toolChunks = chunks.filter((c) => c.type === "tool_call");
      // First chunk from content_block_start: name present, argsDelta empty
      expect(toolChunks[0]).toMatchObject({ type: "tool_call", name: "search_library", argsDelta: "" });
      // Subsequent chunks carry argsDelta increments
      expect(toolChunks[1]).toMatchObject({ type: "tool_call", argsDelta: '{"q"' });
      expect(toolChunks[2]).toMatchObject({ type: "tool_call", argsDelta: ':"rain"}' });
      // argsAccum should be the full accumulated string on the last delta chunk
      expect((toolChunks[2] as Extract<Chunk, { type: "tool_call" }>).argsAccum).toBe('{"q":"rain"}');
      expect(chunks[chunks.length - 1]).toEqual({ type: "stop", reason: "tool_use" });
    });

    it("emits error chunk then stop:error on non-ok HTTP response", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => "rate limited",
      });

      const p = new AnthropicProvider({ apiKey: "sk-x" });
      const chunks = await collectChunks(
        p.chatStream([{ role: "user", content: "hi" }], {}),
      );

      expect(chunks[0]).toMatchObject({ type: "error", message: /429/ });
      expect(chunks[1]).toEqual({ type: "stop", reason: "error" });
    });

    it("emits stop:aborted when AbortSignal is already aborted before fetch", async () => {
      fetchMock.mockRejectedValueOnce(
        Object.assign(new DOMException("aborted", "AbortError"), {}),
      );

      const controller = new AbortController();
      controller.abort();

      const p = new AnthropicProvider({ apiKey: "sk-x" });
      const chunks = await collectChunks(
        p.chatStream([{ role: "user", content: "hi" }], {}, controller.signal),
      );

      expect(chunks).toEqual([{ type: "stop", reason: "aborted" }]);
    });

    it("sets stream:true in the request body", async () => {
      const sseLines = [
        `data: ${JSON.stringify({ type: "message_stop" })}`,
      ];
      fetchMock.mockResolvedValueOnce({
        ok: true,
        body: makeSseStream(sseLines),
      });

      const p = new AnthropicProvider({ apiKey: "sk-x" });
      await collectChunks(p.chatStream([{ role: "user", content: "hi" }], {}));

      const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
      expect(body.stream).toBe(true);
    });
  });
});

describe("toAnthropicTools", () => {
  it("renames parameters → input_schema for OpenAI-compat tools", () => {
    const openaiTool = {
      name: "pick_song",
      description: "Pick a song",
      parameters: { type: "object", properties: { song_id: { type: "string" } } },
    };
    const [converted] = toAnthropicTools([openaiTool]) as [Record<string, unknown>];
    expect(converted.name).toBe("pick_song");
    expect(converted.description).toBe("Pick a song");
    expect(converted.input_schema).toEqual(openaiTool.parameters);
    expect("parameters" in converted).toBe(false);
  });

  it("passes through tools already in Anthropic format (input_schema present)", () => {
    const anthropicTool = {
      name: "search",
      description: "Search",
      input_schema: { type: "object", properties: { q: { type: "string" } } },
    };
    const [out] = toAnthropicTools([anthropicTool]) as [Record<string, unknown>];
    expect(out).toEqual(anthropicTool);
  });

  it("handles empty array", () => {
    expect(toAnthropicTools([])).toEqual([]);
  });

  it("preserves other tool fields", () => {
    const tool = {
      name: "x",
      description: "y",
      parameters: { type: "object" },
      customField: 42,
    };
    const [out] = toAnthropicTools([tool]) as [Record<string, unknown>];
    expect(out.customField).toBe(42);
  });

  it("chatStream body includes translated tools", async () => {
    // Sanity: real chatStream path applies the translation, not just direct call.
    // We only assert body shape here — SSE parsing covered by other tests above.
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("event: message_stop\ndata: {}\n\n"));
          controller.close();
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const p = new AnthropicProvider({ apiKey: "k" });
    const iter = p.chatStream(
      [{ role: "user", content: "hi" }],
      { tools: [{ name: "t", description: "d", parameters: { type: "object" } }] },
    );
    for await (const _ of iter) { /* drain */ }

    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0].input_schema).toEqual({ type: "object" });
    expect("parameters" in body.tools[0]).toBe(false);

    vi.unstubAllGlobals();
  });
});
