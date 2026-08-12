/**
 * streamFn.test.ts — Unit tests for lyraStreamFn adapter
 *
 * Rules:
 * - No real fetch, no real pi Agent, no network calls.
 * - All providers are mock AsyncGenerators via makeMockProvider.
 * - Tests verify the event sequence emitted into AssistantMessageEventStream.
 */

import { describe, it, expect } from "vitest";
import { makeMockStreamFn } from "./testing";
import { lyraStreamFn } from "./streamFn";
import type { AssistantMessageEvent } from "./pi-types.d.ts";
import type { Chunk } from "../../providers/chunk";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal Model stub — only fields needed by makeMessage(). */
const MODEL = {
  id: "mock-model",
  name: "Mock",
  api: "openai-completions" as const,
  provider: "deepseek",
};

/** Minimal Context stub. */
const CTX = {
  messages: [{ role: "user" as const, content: "hello", timestamp: Date.now() }],
};

/** Collect all events from a StreamFn call into an array. */
async function collectEvents(
  chunks: Chunk[],
  signal?: AbortSignal,
): Promise<AssistantMessageEvent[]> {
  const streamFn = makeMockStreamFn(chunks);
  const stream = await streamFn(MODEL, CTX, { signal });
  const events: AssistantMessageEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

// ---------------------------------------------------------------------------
// Text chunks → start / text_start / text_delta / text_end / done
// ---------------------------------------------------------------------------

describe("lyraStreamFn — text chunks", () => {
  it("emits start → text_start → text_delta → text_end → done for a simple text response", async () => {
    const events = await collectEvents([
      { type: "text", delta: "Hello" },
      { type: "text", delta: " world" },
      { type: "stop", reason: "end" },
    ]);

    const types = events.map((e) => e.type);
    expect(types).toContain("start");
    expect(types).toContain("text_start");
    expect(types).toContain("text_delta");
    expect(types).toContain("text_end");
    expect(types).toContain("done");
  });

  it("accumulates text_delta into text_end.content", async () => {
    const events = await collectEvents([
      { type: "text", delta: "Hello" },
      { type: "text", delta: " world" },
      { type: "stop", reason: "end" },
    ]);

    const textEnd = events.find((e) => e.type === "text_end") as Extract<
      AssistantMessageEvent,
      { type: "text_end" }
    >;
    expect(textEnd.content).toBe("Hello world");
  });

  it("done event carries the full assembled text in message.content", async () => {
    const events = await collectEvents([
      { type: "text", delta: "Foo" },
      { type: "stop", reason: "end" },
    ]);

    const done = events.find((e) => e.type === "done") as Extract<
      AssistantMessageEvent,
      { type: "done" }
    >;
    expect(done.reason).toBe("stop");
    const textBlock = done.message.content.find((b) => b.type === "text") as
      | { type: "text"; text: string }
      | undefined;
    expect(textBlock?.text).toBe("Foo");
  });

  it("emits done with reason=stop for stop reason=end", async () => {
    const events = await collectEvents([
      { type: "text", delta: "x" },
      { type: "stop", reason: "end" },
    ]);
    const done = events.find((e) => e.type === "done")!;
    expect(done.type).toBe("done");
    expect((done as Extract<AssistantMessageEvent, { type: "done" }>).reason).toBe("stop");
  });
});

// ---------------------------------------------------------------------------
// Tool call chunks → toolcall_start / toolcall_delta / toolcall_end / done with toolUse
// ---------------------------------------------------------------------------

describe("lyraStreamFn — tool_call chunks", () => {
  it("emits toolcall_start / toolcall_delta / toolcall_end for a tool call", async () => {
    const events = await collectEvents([
      { type: "tool_call", id: "tc1", name: "search_library", argsDelta: '{"q"' },
      { type: "tool_call", id: "tc1", argsDelta: ':"jazz"}' },
      { type: "stop", reason: "tool_use" },
    ]);

    const types = events.map((e) => e.type);
    expect(types).toContain("start");
    expect(types).toContain("toolcall_start");
    expect(types).toContain("toolcall_delta");
    expect(types).toContain("toolcall_end");
    expect(types).toContain("done");
  });

  it("toolcall_end carries parsed arguments", async () => {
    const events = await collectEvents([
      { type: "tool_call", id: "tc1", name: "search_library", argsDelta: '{"q":' },
      { type: "tool_call", id: "tc1", argsDelta: '"jazz"}' },
      { type: "stop", reason: "tool_use" },
    ]);

    const tcEnd = events.find((e) => e.type === "toolcall_end") as Extract<
      AssistantMessageEvent,
      { type: "toolcall_end" }
    >;
    expect(tcEnd.toolCall.name).toBe("search_library");
    expect(tcEnd.toolCall.arguments).toEqual({ q: "jazz" });
  });

  it("done event has reason=toolUse when stop.reason is tool_use", async () => {
    const events = await collectEvents([
      { type: "tool_call", id: "tc1", name: "get_features", argsDelta: '{"id":"x"}' },
      { type: "stop", reason: "tool_use" },
    ]);
    const done = events.find((e) => e.type === "done") as Extract<
      AssistantMessageEvent,
      { type: "done" }
    >;
    expect(done.reason).toBe("toolUse");
  });

  it("done message.content includes ToolCall blocks", async () => {
    const events = await collectEvents([
      { type: "tool_call", id: "tc1", name: "foo", argsDelta: '{}' },
      { type: "stop", reason: "tool_use" },
    ]);
    const done = events.find((e) => e.type === "done") as Extract<
      AssistantMessageEvent,
      { type: "done" }
    >;
    const tcBlock = done.message.content.find((b) => b.type === "toolCall");
    expect(tcBlock).toBeDefined();
    expect((tcBlock as { type: "toolCall"; id: string }).id).toBe("tc1");
  });
});

// ---------------------------------------------------------------------------
// Error chunk → terminal error event
// ---------------------------------------------------------------------------

describe("lyraStreamFn — error chunk", () => {
  it("emits error terminal event on error chunk and does NOT throw", async () => {
    const events = await collectEvents([
      { type: "text", delta: "partial" },
      { type: "error", message: "network timeout" },
    ]);

    const errEvent = events.find((e) => e.type === "error") as Extract<
      AssistantMessageEvent,
      { type: "error" }
    > | undefined;
    expect(errEvent).toBeDefined();
    expect(errEvent!.reason).toBe("error");
    expect(errEvent!.error.stopReason).toBe("error");
    expect(errEvent!.error.errorMessage).toBe("network timeout");
  });

  it("error in stream does not reach caller as thrown exception", async () => {
    await expect(
      collectEvents([{ type: "error", message: "boom" }]),
    ).resolves.toBeDefined();
  });

  it("stop with reason=error also emits error terminal event", async () => {
    const events = await collectEvents([{ type: "stop", reason: "error" }]);
    const errEvent = events.find((e) => e.type === "error");
    expect(errEvent).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// AbortSignal → terminal aborted event
// ---------------------------------------------------------------------------

describe("lyraStreamFn — AbortSignal", () => {
  it("emits error event with reason=aborted when signal is already aborted before first chunk", async () => {
    const controller = new AbortController();
    controller.abort();

    const events = await collectEvents(
      [
        { type: "text", delta: "should not appear" },
        { type: "stop", reason: "end" },
      ],
      controller.signal,
    );

    // The mock provider checks signal.aborted and yields a stop/aborted chunk
    const errEvent = events.find((e) => e.type === "error") as Extract<
      AssistantMessageEvent,
      { type: "error" }
    > | undefined;
    expect(errEvent).toBeDefined();
    expect(errEvent!.reason).toBe("aborted");
  });

  it("aborted signal propagates through streamFn — no throw", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      collectEvents([{ type: "text", delta: "hi" }, { type: "stop", reason: "end" }], controller.signal),
    ).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Provider error (thrown exception) → error in stream
// ---------------------------------------------------------------------------

describe("lyraStreamFn — thrown exception from provider", () => {
  it("encodes thrown Error from chatStream as error terminal event, does not rethrow", async () => {
    const throwingProvider = {
      chatStream: async function* (): AsyncIterable<Chunk> {
        throw new Error("unexpected provider crash");
        // eslint-disable-next-line no-unreachable
        yield { type: "stop", reason: "end" } as Chunk;
      },
    };
    const streamFn = lyraStreamFn(throwingProvider);
    const stream = await streamFn(MODEL, CTX, {});
    const events: AssistantMessageEvent[] = [];
    for await (const event of stream) {
      events.push(event);
    }
    const errEvent = events.find((e) => e.type === "error") as Extract<
      AssistantMessageEvent,
      { type: "error" }
    > | undefined;
    expect(errEvent).toBeDefined();
    expect(errEvent!.error.errorMessage).toContain("unexpected provider crash");
  });
});

// ---------------------------------------------------------------------------
// Warning chunk
// ---------------------------------------------------------------------------

describe("lyraStreamFn — warning chunk", () => {
  it("forwards warning as text_delta (no dedicated warning event type in pi)", async () => {
    const events = await collectEvents([
      { type: "warning", message: "enable_thinking forced off" },
      { type: "stop", reason: "end" },
    ]);
    const deltas = events.filter((e) => e.type === "text_delta") as Array<
      Extract<AssistantMessageEvent, { type: "text_delta" }>
    >;
    expect(deltas.some((d) => d.delta.includes("warning"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Context message conversion
// ---------------------------------------------------------------------------

describe("lyraStreamFn — context.messages conversion", () => {
  it("passes converted messages to provider.chatStream", async () => {
    let capturedMessages: unknown = null;
    const capturingProvider = {
      chatStream: async function* (
        messages: unknown,
      ): AsyncIterable<Chunk> {
        capturedMessages = messages;
        yield { type: "text", delta: "ok" };
        yield { type: "stop", reason: "end" };
      },
    };

    const streamFn = lyraStreamFn(capturingProvider);
    const context = {
      messages: [
        {
          role: "user" as const,
          content: "Play jazz",
          timestamp: 0,
        },
        {
          role: "assistant" as const,
          content: [{ type: "text" as const, text: "Playing jazz" }],
          api: "openai-completions",
          provider: "deepseek",
          model: "m",
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: "stop" as const,
          timestamp: 0,
        },
      ],
    };

    const stream = await streamFn(MODEL, context, {});
    // Drain stream
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _ of stream) { /* drain */ }

    expect(Array.isArray(capturedMessages)).toBe(true);
    const msgs = capturedMessages as Array<{ role: string; content: string }>;
    expect(msgs[0].role).toBe("user");
    expect(msgs[0].content).toBe("Play jazz");
    expect(msgs[1].role).toBe("assistant");
    expect(msgs[1].content).toBe("Playing jazz");
  });

  it("drops toolResult messages during conversion", async () => {
    let capturedMessages: unknown = null;
    const capturingProvider = {
      chatStream: async function* (messages: unknown): AsyncIterable<Chunk> {
        capturedMessages = messages;
        yield { type: "stop", reason: "end" };
      },
    };

    const streamFn = lyraStreamFn(capturingProvider);
    const context = {
      messages: [
        { role: "user" as const, content: "hi", timestamp: 0 },
        {
          role: "toolResult" as const,
          toolCallId: "tc1",
          toolName: "foo",
          content: [],
          isError: false,
          timestamp: 0,
        },
      ],
    };

    const stream = await streamFn(MODEL, context, {});
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _ of stream) { /* drain */ }

    const msgs = capturedMessages as Array<{ role: string }>;
    expect(msgs.every((m) => m.role !== "toolResult")).toBe(true);
  });
});
