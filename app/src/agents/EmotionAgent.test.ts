import { describe, it, expect, vi } from "vitest";
import { EmotionAgent } from "./EmotionAgent";
import type { ModelProvider, ChatMessage, ChatResponse } from "../types";
import type { AgentRunSink } from "../turn/agentRunSink";

function stubProvider(response: string): ModelProvider {
  return {
    id: "deepseek",
    chat: vi.fn(async (_: ChatMessage[]) => ({ content: response } as ChatResponse)),
  };
}

// ── Legacy path (9 existing tests, unchanged) ────────────────────────────────

describe("EmotionAgent.analyze", () => {
  it("returns CurrentEmotion parsed from valid JSON", async () => {
    const p = stubProvider(
      JSON.stringify({
        pad: { p: -0.3, a: -0.2, d: 0.0 },
        labels: ["疲惫", "轻微焦虑"],
        confidence: 0.75,
        source: "emotion-agent-inferred",
      }),
    );
    const agent = new EmotionAgent({ provider: p });
    const out = await agent.analyze({ userUtterance: "最近有点累" });
    expect(out.pad).toEqual({ p: -0.3, a: -0.2, d: 0.0 });
    expect(out.labels).toEqual(["疲惫", "轻微焦虑"]);
    expect(out.confidence).toBe(0.75);
    expect(out.source).toBe("emotion-agent-inferred");
  });

  it("sends the system prompt + user message to the provider", async () => {
    const p = stubProvider(
      JSON.stringify({ pad: { p: 0, a: 0, d: 0 }, labels: [], confidence: 0.5, source: "emotion-agent-inferred" }),
    );
    const agent = new EmotionAgent({ provider: p });
    await agent.analyze({ userUtterance: "hello" });
    const call = (p.chat as any).mock.calls[0];
    const messages: ChatMessage[] = call[0];
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("Lyra's emotion perception");
    expect(messages[1].role).toBe("user");
    expect(messages[1].content).toBe("hello");
  });

  it("throws EmotionAgentError on invalid JSON", async () => {
    const p = stubProvider("not json at all");
    const agent = new EmotionAgent({ provider: p });
    await expect(agent.analyze({ userUtterance: "x" })).rejects.toThrow(/bad JSON/);
  });

  it("throws when JSON shape is wrong (missing pad)", async () => {
    const p = stubProvider(JSON.stringify({ labels: [], confidence: 0.5 }));
    const agent = new EmotionAgent({ provider: p });
    await expect(agent.analyze({ userUtterance: "x" })).rejects.toThrow(/pad/i);
  });

  it("throws when pad values are out of [-1, 1]", async () => {
    const p = stubProvider(
      JSON.stringify({
        pad: { p: 5, a: 0, d: 0 },
        labels: [],
        confidence: 0.5,
        source: "emotion-agent-inferred",
      }),
    );
    const agent = new EmotionAgent({ provider: p });
    await expect(agent.analyze({ userUtterance: "x" })).rejects.toThrow(/range/i);
  });

  it("strips leading/trailing whitespace and markdown fences before parsing", async () => {
    const p = stubProvider(
      "```json\n" +
        JSON.stringify({ pad: { p: 0, a: 0, d: 0 }, labels: [], confidence: 0.5, source: "emotion-agent-inferred" }) +
        "\n```",
    );
    const agent = new EmotionAgent({ provider: p });
    const out = await agent.analyze({ userUtterance: "x" });
    expect(out.confidence).toBe(0.5);
  });

  it("passes through a valid predicted_trajectory", async () => {
    const p = stubProvider(
      JSON.stringify({
        pad: { p: 0.1, a: 0.2, d: 0.0 },
        labels: ["平静"],
        confidence: 0.8,
        source: "emotion-agent-inferred",
        predicted_trajectory: {
          horizon_min: 30,
          predicted_pad: { p: -0.5, a: -0.6, d: -0.1 },
        },
      }),
    );
    const agent = new EmotionAgent({ provider: p });
    const out = await agent.analyze({ userUtterance: "我准备去睡觉了" });
    expect(out.predicted_trajectory).toEqual({
      horizon_min: 30,
      predicted_pad: { p: -0.5, a: -0.6, d: -0.1 },
    });
  });

  it("drops predicted_trajectory when horizon_min is out of range (malformed)", async () => {
    const p = stubProvider(
      JSON.stringify({
        pad: { p: 0.1, a: 0.2, d: 0.0 },
        labels: ["平静"],
        confidence: 0.8,
        source: "emotion-agent-inferred",
        predicted_trajectory: {
          horizon_min: 200, // out of [5, 120]
          predicted_pad: { p: -0.5, a: -0.6, d: -0.1 },
        },
      }),
    );
    const agent = new EmotionAgent({ provider: p });
    const out = await agent.analyze({ userUtterance: "x" });
    expect(out.predicted_trajectory).toBeUndefined();
  });

  it("missing predicted_trajectory is fine — field absent on result", async () => {
    const p = stubProvider(
      JSON.stringify({
        pad: { p: 0.0, a: 0.0, d: 0.0 },
        labels: [],
        confidence: 0.5,
        source: "emotion-agent-inferred",
      }),
    );
    const agent = new EmotionAgent({ provider: p });
    const out = await agent.analyze({ userUtterance: "x" });
    expect(out.predicted_trajectory).toBeUndefined();
  });
});

// ── Pi path tests ─────────────────────────────────────────────────────────────

/** Build a valid CurrentEmotion JSON string for the mock stream to emit. */
function piJsonResponse(override: Record<string, unknown> = {}): string {
  return JSON.stringify({
    pad: { p: 0.2, a: 0.1, d: 0.0 },
    labels: ["平静"],
    confidence: 0.8,
    source: "emotion-agent-inferred",
    ...override,
  });
}

/** Minimal AgentRunSink mock — tracks calls for assertion. */
function makeMockSink(): AgentRunSink {
  return {
    start: vi.fn(),
    record: vi.fn(),
    end: vi.fn(),
    getRunSnapshot: vi.fn(() => undefined),
    runCount: vi.fn(() => 0),
  } as unknown as AgentRunSink;
}

describe("EmotionAgent.analyze — pi path", () => {
  it("returns correct CurrentEmotion shape via pi stream", async () => {
    const { makeMockProvider } = await import("./pi/testing");
    const agent = new EmotionAgent({
      streamableProvider: makeMockProvider([
        { type: "text", delta: piJsonResponse() },
        { type: "stop", reason: "end" },
      ]),
      getPiAgentEnabled: async () => true,
    });
    const out = await agent.analyze({ userUtterance: "感觉还不错" });
    expect(out.pad).toEqual({ p: 0.2, a: 0.1, d: 0.0 });
    expect(out.labels).toEqual(["平静"]);
    expect(out.confidence).toBe(0.8);
    expect(out.source).toBe("emotion-agent-inferred");
  });

  it("agentRunSink.start and agentRunSink.end are called on success", async () => {
    const { makeMockProvider } = await import("./pi/testing");
    const sink = makeMockSink();
    const agent = new EmotionAgent({
      streamableProvider: makeMockProvider([
        { type: "text", delta: piJsonResponse() },
        { type: "stop", reason: "end" },
      ]),
      getPiAgentEnabled: async () => true,
      agentRunSink: sink,
    });
    await agent.analyze({ userUtterance: "测试" });
    expect(sink.start).toHaveBeenCalledOnce();
    expect(sink.end).toHaveBeenCalledWith(expect.any(String), "ok");
  });

  it("agentRunSink.end is called with 'error' on parse failure", async () => {
    const { makeMockProvider } = await import("./pi/testing");
    const sink = makeMockSink();
    const agent = new EmotionAgent({
      streamableProvider: makeMockProvider([
        { type: "text", delta: "not valid json" },
        { type: "stop", reason: "end" },
      ]),
      getPiAgentEnabled: async () => true,
      agentRunSink: sink,
    });
    await expect(agent.analyze({ userUtterance: "x" })).rejects.toThrow(/bad JSON/);
    expect(sink.end).toHaveBeenCalledWith(expect.any(String), "error");
  });

  it("falls back to legacy path when piAgentEnabled=true but no streamableProvider", async () => {
    const p = stubProvider(piJsonResponse());
    const agent = new EmotionAgent({
      provider: p,
      getPiAgentEnabled: async () => true,
      // streamableProvider intentionally omitted
    });
    const out = await agent.analyze({ userUtterance: "fallback test" });
    expect(out.source).toBe("emotion-agent-inferred");
    expect(p.chat).toHaveBeenCalledOnce();
  });

  it("uses legacy path when piAgentEnabled=false (default)", async () => {
    const { makeMockProvider } = await import("./pi/testing");
    const p = stubProvider(piJsonResponse());
    const agent = new EmotionAgent({
      provider: p,
      streamableProvider: makeMockProvider([
        { type: "text", delta: piJsonResponse() },
        { type: "stop", reason: "end" },
      ]),
      // getPiAgentEnabled defaults to async () => false
    });
    await agent.analyze({ userUtterance: "默认走 legacy" });
    // Legacy path uses provider.chat, not chatStream
    expect(p.chat).toHaveBeenCalledOnce();
  });

  it("pi path throws when stream emits stopReason=error", async () => {
    const { makeMockProvider } = await import("./pi/testing");
    const agent = new EmotionAgent({
      streamableProvider: makeMockProvider([
        { type: "error", message: "provider error" },
        { type: "stop", reason: "error" },
      ]),
      getPiAgentEnabled: async () => true,
    });
    await expect(agent.analyze({ userUtterance: "x" })).rejects.toThrow();
  });

  it("setAgentRunSink wires the sink post-construction (Orchestrator wiring path)", async () => {
    const { makeMockProvider } = await import("./pi/testing");
    const sink = makeMockSink();
    const agent = new EmotionAgent({
      streamableProvider: makeMockProvider([
        { type: "text", delta: piJsonResponse() },
        { type: "stop", reason: "end" },
      ]),
      getPiAgentEnabled: async () => true,
    });
    agent.setAgentRunSink(sink);
    await agent.analyze({ userUtterance: "wired post-construction" });
    expect(sink.start).toHaveBeenCalledOnce();
    expect(sink.end).toHaveBeenCalledWith(expect.any(String), "ok");
  });

  it("pi path result has same shape as legacy (structural equivalence)", async () => {
    const { makeMockProvider } = await import("./pi/testing");
    const json = piJsonResponse({
      pad: { p: -0.1, a: 0.3, d: 0.2 },
      labels: ["兴奋", "期待"],
      confidence: 0.9,
      predicted_trajectory: {
        horizon_min: 15,
        predicted_pad: { p: 0.0, a: 0.1, d: 0.1 },
      },
    });
    const piAgent = new EmotionAgent({
      streamableProvider: makeMockProvider([
        { type: "text", delta: json },
        { type: "stop", reason: "end" },
      ]),
      getPiAgentEnabled: async () => true,
    });
    const legacyAgent = new EmotionAgent({ provider: stubProvider(json) });
    const [piOut, legacyOut] = await Promise.all([
      piAgent.analyze({ userUtterance: "shape test" }),
      legacyAgent.analyze({ userUtterance: "shape test" }),
    ]);
    expect(piOut.pad).toEqual(legacyOut.pad);
    expect(piOut.labels).toEqual(legacyOut.labels);
    expect(piOut.confidence).toBe(legacyOut.confidence);
    expect(piOut.source).toBe(legacyOut.source);
    expect(piOut.predicted_trajectory).toEqual(legacyOut.predicted_trajectory);
  });
});
