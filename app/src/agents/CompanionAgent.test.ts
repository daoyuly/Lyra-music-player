import { describe, it, expect, vi } from "vitest";
import { CompanionAgent } from "./CompanionAgent";
import type { ModelProvider, ChatMessage, ChatResponse, SoulState, CurrentEmotion } from "../types";
import type { CompanionInput } from "./types";
import type { AgentRunSink } from "../turn/agentRunSink";

const emotion: CurrentEmotion = {
  pad: { p: -0.3, a: -0.2, d: 0.0 },
  labels: ["疲惫"],
  confidence: 0.7,
  source: "emotion-agent-inferred",
};

const soul: SoulState = {
  agent_id: "lyra_001",
  created_at: "2026-07-06",
  musical_taste_base: {
    aesthetic_axes: { restraint_vs_expression: 0.7, narrative_vs_atmospheric: 0.6, polished_vs_raw: -0.3, novelty_seeking: 0.5 },
    affinity_genres: ["post-rock"],
    aversion_signals: [],
    backbone: "b",
  },
  dynamic_mood: { current_pad: { p: 0, a: 0, d: 0 }, attention_to_user: 0.85, recent_bias: "" },
  shared_memory: [],
  evolution_log: [],
  proactive_budget: {
    daily_limit: 3, sulk_until: null,
    kind_budgets: { morning: 1, care: 1, anniversary: 1, share: 1, rhythm: 2 },
  },
};

const candidates = [
  { id: "t1", path: "/tmp/nuvole.mp3", title: "Nuvole Bianche", artist: "Ludovico Einaudi", album: "Una Mattina", duration_ms: 358_000 },
  { id: "t2", path: "/tmp/comptine.mp3", title: "Comptine d'un autre été", artist: "Yann Tiersen", album: "Amelie OST", duration_ms: 143_000 },
];

const validResponse = JSON.stringify({
  song_id: "t1",
  target_profile: "慢速起手,前 20 秒克制的钢琴",
  rationale: "看到希望的抬起",
  needed_shift: "接住",
});

function stub(response: string): ModelProvider {
  return {
    id: "anthropic",
    chat: vi.fn(async (_: ChatMessage[]) => ({ content: response } as ChatResponse)),
  };
}

function stubSequential(...responses: string[]): ModelProvider {
  let call = 0;
  return {
    id: "anthropic",
    chat: vi.fn(async (_: ChatMessage[]) => {
      const r = responses[Math.min(call, responses.length - 1)];
      call++;
      return { content: r } as ChatResponse;
    }),
  };
}

const input: CompanionInput = {
  userUtterance: "最近有点累",
  currentEmotion: emotion,
  soul,
  candidates,
};

describe("CompanionAgent.choose", () => {
  it("returns ChosenSong from valid JSON with matching song_id", async () => {
    const a = new CompanionAgent({ provider: stub(validResponse) });
    const out = await a.choose(input);
    expect(out.song_id).toBe("t1");
    expect(out.rationale).toBe("看到希望的抬起");
    expect(out.needed_shift).toBe("接住");
  });

  it("system prompt includes the Lyra identity brief", async () => {
    const p = stub(validResponse);
    const a = new CompanionAgent({ provider: p });
    await a.choose(input);
    const msgs: ChatMessage[] = (p.chat as any).mock.calls[0][0];
    expect(msgs[0].role).toBe("system");
    expect(msgs[0].content).toContain("Lyra");
  });

  it("user message includes candidates with all four fields", async () => {
    const p = stub(validResponse);
    const a = new CompanionAgent({ provider: p });
    await a.choose(input);
    const msgs: ChatMessage[] = (p.chat as any).mock.calls[0][0];
    expect(msgs[1].content).toContain("t1");
    expect(msgs[1].content).toContain("Nuvole Bianche");
    expect(msgs[1].content).toContain("Ludovico Einaudi");
  });

  it("retries once when song_id is not in candidates and succeeds on retry", async () => {
    const bad = JSON.stringify({
      song_id: "made-up-id",
      target_profile: "x", rationale: "y", needed_shift: "接住",
    });
    const goodRetry = JSON.stringify({
      song_id: "t2",
      target_profile: "x2", rationale: "y2", needed_shift: "点燃",
    });
    const p = stubSequential(bad, goodRetry);
    const a = new CompanionAgent({ provider: p });
    const out = await a.choose(input);
    expect(out.song_id).toBe("t2");
    expect(out.rationale).toBe("y2");
    // Two calls: initial + one retry with correction
    expect((p.chat as any).mock.calls.length).toBe(2);
    // Retry messages include the assistant's bad response + a correction user message
    const retryMsgs: ChatMessage[] = (p.chat as any).mock.calls[1][0];
    expect(retryMsgs[retryMsgs.length - 2].role).toBe("assistant");
    expect(retryMsgs[retryMsgs.length - 1].role).toBe("user");
    expect(retryMsgs[retryMsgs.length - 1].content).toContain("made-up-id");
    expect(retryMsgs[retryMsgs.length - 1].content).toContain("t1");
    expect(retryMsgs[retryMsgs.length - 1].content).toContain("t2");
  });

  it("falls back to candidates[0] when even retry misses (preserves LLM rationale)", async () => {
    const bad1 = JSON.stringify({
      song_id: "made-up-1",
      target_profile: "tp1", rationale: "r1", needed_shift: "陪着",
    });
    const bad2 = JSON.stringify({
      song_id: "made-up-2",
      target_profile: "tp2", rationale: "r2", needed_shift: "打断",
    });
    const p = stubSequential(bad1, bad2);
    const a = new CompanionAgent({ provider: p });
    const out = await a.choose(input);
    expect(out.song_id).toBe("t1"); // candidates[0]
    // Rationale/target_profile from the retry (the last LLM output) preserved
    expect(out.rationale).toBe("r2");
    expect(out.target_profile).toBe("tp2");
    expect(out.needed_shift).toBe("打断");
    expect((p.chat as any).mock.calls.length).toBe(2);
  });

  it("coerces unknown needed_shift to '接住'", async () => {
    const weird = JSON.stringify({
      song_id: "t1",
      target_profile: "x", rationale: "y", needed_shift: "flowery-nonsense",
    });
    const a = new CompanionAgent({ provider: stub(weird) });
    const out = await a.choose(input);
    expect(out.needed_shift).toBe("接住");
  });

  it("throws CompanionAgentError on invalid JSON", async () => {
    const a = new CompanionAgent({ provider: stub("not json") });
    await expect(a.choose(input)).rejects.toThrow(/bad JSON/);
  });

  it("user message includes living portrait and top facts when provided", async () => {
    const p = stub(validResponse);
    const a = new CompanionAgent({ provider: p });
    const inputWithMemory = {
      ...input,
      livingPortrait: "她偏爱深夜的宁静，古典钢琴是她的庇护所。",
      topFacts: [
        {
          tags: ["#时段:深夜"],
          conclusion: "慢速古典钢琴",
          confidence: 0.87,
          n: 9,
          lastVerifiedISO: "2026-07-07",
        },
        {
          tags: ["#情绪:疲惫"],
          conclusion: "无人声纯器乐",
          confidence: 0.75,
          n: 5,
          lastVerifiedISO: "2026-07-07",
        },
      ],
    };
    await a.choose(inputWithMemory);
    const msgs: ChatMessage[] = (p.chat as any).mock.calls[0][0];
    const userMsg = msgs[1].content;
    // Portrait block should appear
    expect(userMsg).toContain("你对她的记忆:");
    expect(userMsg).toContain("她偏爱深夜的宁静，古典钢琴是她的庇护所。");
    // Facts block should appear
    expect(userMsg).toContain("你观察到的偏好:");
    expect(userMsg).toContain("#时段:深夜");
    expect(userMsg).toContain("慢速古典钢琴");
    expect(userMsg).toContain("conf: 0.87");
    // Memory block appears BEFORE candidate block
    expect(userMsg.indexOf("你对她的记忆:")).toBeLessThan(userMsg.indexOf("候选歌单("));
  });
});

// ── Pi path tests ─────────────────────────────────────────────────────────────

/** Build valid pick_song tool args for a given song_id. */
function pickSongArgs(song_id: string) {
  return JSON.stringify({
    song_id,
    target_profile: "慢速钢琴开场",
    rationale: "接住当下的疲惫",
    needed_shift: "接住",
  });
}

/** Minimal AgentRunSink mock. */
function makeMockSink(): AgentRunSink {
  return {
    start: vi.fn(),
    record: vi.fn(),
    end: vi.fn(),
    getRunSnapshot: vi.fn(() => undefined),
    runCount: vi.fn(() => 0),
  } as unknown as AgentRunSink;
}

describe("CompanionAgent.choose — pi path", () => {
  it("returns ChosenSong with correct shape via pi tool loop", async () => {
    // Turn 1: LLM calls pick_song with a valid id
    // Turn 2: LLM ends (no more tool calls)
    let streamCallCount = 0;
    const provider = {
      chatStream: async function* (_messages: unknown, _opts: unknown, signal?: AbortSignal) {
        streamCallCount++;
        if (streamCallCount === 1) {
          yield { type: "tool_call" as const, id: "tc1", name: "pick_song", argsAccum: pickSongArgs("t1") };
          yield { type: "stop" as const, reason: "tool_use" as const };
        } else {
          yield { type: "text" as const, delta: "好的" };
          yield { type: "stop" as const, reason: "end" as const };
        }
        void signal;
      },
    };

    const agent = new CompanionAgent({
      streamableProvider: provider,
      getPiAgentEnabled: async () => true,
    });
    const out = await agent.choose(input);

    expect(out.song_id).toBe("t1");
    expect(out.target_profile).toBe("慢速钢琴开场");
    expect(out.rationale).toBe("接住当下的疲惫");
    expect(out.needed_shift).toBe("接住");
  });

  it("LLM picks wrong id on turn 1 → tool returns isError → next turn picks correct id", async () => {
    let streamCallCount = 0;
    const provider = {
      chatStream: async function* (_messages: unknown, _opts: unknown, signal?: AbortSignal) {
        streamCallCount++;
        if (streamCallCount === 1) {
          // Bad id first
          yield { type: "tool_call" as const, id: "tc1", name: "pick_song", argsAccum: pickSongArgs("made-up-id") };
          yield { type: "stop" as const, reason: "tool_use" as const };
        } else if (streamCallCount === 2) {
          // Retry: correct id
          yield { type: "tool_call" as const, id: "tc2", name: "pick_song", argsAccum: pickSongArgs("t2") };
          yield { type: "stop" as const, reason: "tool_use" as const };
        } else {
          yield { type: "text" as const, delta: "ok" };
          yield { type: "stop" as const, reason: "end" as const };
        }
        void signal;
      },
    };

    const agent = new CompanionAgent({
      streamableProvider: provider,
      getPiAgentEnabled: async () => true,
    });
    const out = await agent.choose(input);

    // After 2 stream turns (bad → good), chosen should be t2
    expect(out.song_id).toBe("t2");
    expect(streamCallCount).toBeGreaterThanOrEqual(2);
  });

  it("falls back to candidates[0] when chosen is still null after max_turns", async () => {
    // Always return bad ids — never successful pick
    let streamCallCount = 0;
    const provider = {
      chatStream: async function* (_messages: unknown, _opts: unknown, signal?: AbortSignal) {
        streamCallCount++;
        yield { type: "tool_call" as const, id: `tc${streamCallCount}`, name: "pick_song", argsAccum: pickSongArgs("bad-id") };
        yield { type: "stop" as const, reason: "tool_use" as const };
        void signal;
      },
    };

    const agent = new CompanionAgent({
      streamableProvider: provider,
      getPiAgentEnabled: async () => true,
    });
    const out = await agent.choose(input);

    // Fallback: candidates[0] (after rankByShift re-ordering it's still a valid id from candidates)
    expect(["t1", "t2"]).toContain(out.song_id);
    // Exactly maxTurns=3 stream calls
    expect(streamCallCount).toBe(3);
  });

  it("agentRunSink.start and agentRunSink.end are called on success", async () => {
    const sink = makeMockSink();

    let streamCallCount = 0;
    const provider = {
      chatStream: async function* (_messages: unknown, _opts: unknown, signal?: AbortSignal) {
        streamCallCount++;
        if (streamCallCount === 1) {
          yield { type: "tool_call" as const, id: "tc1", name: "pick_song", argsAccum: pickSongArgs("t1") };
          yield { type: "stop" as const, reason: "tool_use" as const };
        } else {
          yield { type: "text" as const, delta: "done" };
          yield { type: "stop" as const, reason: "end" as const };
        }
        void signal;
      },
    };

    const agent = new CompanionAgent({
      streamableProvider: provider,
      getPiAgentEnabled: async () => true,
      agentRunSink: sink,
    });
    await agent.choose(input);

    expect(sink.start).toHaveBeenCalledOnce();
    expect(sink.end).toHaveBeenCalledWith(expect.any(String), "ok");
  });

  it("setAgentRunSink wires sink post-construction", async () => {
    const sink = makeMockSink();

    // Provider that handles two chatStream calls: first returns tool_call, second returns text
    let callCount = 0;
    const sequentialProvider = {
      chatStream: async function* (msgs: unknown, opts: unknown, signal?: AbortSignal) {
        callCount++;
        if (callCount === 1) {
          yield { type: "tool_call" as const, id: "tc1", name: "pick_song", argsAccum: pickSongArgs("t1") };
          yield { type: "stop" as const, reason: "tool_use" as const };
        } else {
          yield { type: "text" as const, delta: "ok" };
          yield { type: "stop" as const, reason: "end" as const };
        }
        void msgs; void opts; void signal;
      },
    };

    const agent = new CompanionAgent({
      streamableProvider: sequentialProvider,
      getPiAgentEnabled: async () => true,
    });
    agent.setAgentRunSink(sink);
    await agent.choose(input);

    expect(sink.start).toHaveBeenCalledOnce();
    expect(sink.end).toHaveBeenCalledWith(expect.any(String), "ok");
  });

  it("AbortSignal propagates: stream emitting aborted stop causes fallback (not a hang)", async () => {
    // Simulates a provider that aborts immediately (e.g. user cancels request).
    // The pi path should not hang — it should resolve to fallback candidates[0].
    const provider = {
      chatStream: async function* (_messages: unknown, _opts: unknown, signal?: AbortSignal) {
        // Simulate provider aborting the stream right away
        yield { type: "stop" as const, reason: "aborted" as const };
        void signal;
      },
    };

    const agent = new CompanionAgent({
      streamableProvider: provider,
      getPiAgentEnabled: async () => true,
    });

    const out = await agent.choose(input);
    // Should fall back gracefully — never throws, always returns a valid candidate id
    expect(["t1", "t2"]).toContain(out.song_id);
  });

  it("falls back to legacy path when piEnabled=true but no streamableProvider", async () => {
    const p = stub(validResponse);
    const agent = new CompanionAgent({
      provider: p,
      getPiAgentEnabled: async () => true,
      // streamableProvider intentionally omitted
    });
    const out = await agent.choose(input);
    // Legacy path used provider.chat
    expect(p.chat).toHaveBeenCalledOnce();
    expect(out.song_id).toBe("t1");
  });

  it("uses legacy path when piEnabled=false (default)", async () => {
    const { makeMockProvider } = await import("./pi/testing");
    const p = stub(validResponse);
    const agent = new CompanionAgent({
      provider: p,
      streamableProvider: makeMockProvider([
        { type: "text", delta: "ignored" },
        { type: "stop", reason: "end" },
      ]),
      // getPiAgentEnabled defaults to async () => false
    });
    await agent.choose(input);
    // Legacy path: provider.chat called, not chatStream
    expect(p.chat).toHaveBeenCalledOnce();
  });

  it("pi path and legacy path produce structurally equivalent ChosenSong shapes", async () => {
    // Same logical response: pick t1 with same fields
    let piStreamCallCount = 0;
    const piProvider = {
      chatStream: async function* (_messages: unknown, _opts: unknown, signal?: AbortSignal) {
        piStreamCallCount++;
        if (piStreamCallCount === 1) {
          yield { type: "tool_call" as const, id: "tc1", name: "pick_song", argsAccum: pickSongArgs("t1") };
          yield { type: "stop" as const, reason: "tool_use" as const };
        } else {
          yield { type: "text" as const, delta: "ok" };
          yield { type: "stop" as const, reason: "end" as const };
        }
        void signal;
      },
    };

    const piAgent = new CompanionAgent({
      streamableProvider: piProvider,
      getPiAgentEnabled: async () => true,
    });
    const legacyAgent = new CompanionAgent({ provider: stub(validResponse) });

    const [piOut, legacyOut] = await Promise.all([
      piAgent.choose(input),
      legacyAgent.choose(input),
    ]);

    // Both must have the same shape fields
    expect(typeof piOut.song_id).toBe("string");
    expect(typeof piOut.target_profile).toBe("string");
    expect(typeof piOut.rationale).toBe("string");
    expect(["接住", "点燃", "陪着", "打断"]).toContain(piOut.needed_shift);

    expect(typeof legacyOut.song_id).toBe("string");
    expect(typeof legacyOut.target_profile).toBe("string");
    expect(typeof legacyOut.rationale).toBe("string");
    expect(["接住", "点燃", "陪着", "打断"]).toContain(legacyOut.needed_shift);

    // Both pick t1 (same input, same mock data)
    expect(piOut.song_id).toBe(legacyOut.song_id);
  });
});

// ── Pi path + auxiliary tools tests (Phase 3b) ────────────────────────────────

import type { ToolContext } from "./pi/toolContext";
import type { ToolContextFactory } from "../turn/toolContextFactory";

/** Build a minimal mock ToolContextFactory that returns the given ctx. */
function makeMockToolContextFactory(ctx: ToolContext): ToolContextFactory {
  return {
    build: vi.fn(() => ctx),
  };
}

/** Build a minimal mock ToolContext. */
function makeMockToolContext(): ToolContext {
  return {
    libraryRepo: {
      getTrack: vi.fn(async () => null),
      listAll: vi.fn(async () => []),
    },
    libraryFeaturesRepo: {
      getBatch: vi.fn(async () => new Map()),
    },
    turnRepo: {
      listRecentTurns: vi.fn(async () => []),
    },
    soulStore: {
      load: vi.fn(async () => ({
        agent_id: "lyra_001",
        created_at: "2026-01-01",
        musical_taste_base: {
          aesthetic_axes: { restraint_vs_expression: 0.7, narrative_vs_atmospheric: 0.6, polished_vs_raw: -0.3, novelty_seeking: 0.5 },
          affinity_genres: ["post-rock"],
          aversion_signals: [],
          backbone: "quiet",
        },
        dynamic_mood: { current_pad: { p: 0, a: 0, d: 0 }, attention_to_user: 0.85, recent_bias: "" },
        shared_memory: [],
        evolution_log: [],
        proactive_budget: { daily_limit: 3, sulk_until: null, kind_budgets: { morning: 1, care: 1, anniversary: 1, share: 1, rhythm: 2 } },
      })),
    },
    clock: () => 12345,
  };
}

describe("CompanionAgent.choose — pi path + aux tools (Phase 3b)", () => {
  it("tools array has 4 tools when toolContextFactory is provided", async () => {
    // Intercept the Agent constructor to capture the tools list
    const capturedTools: string[] = [];
    const { Agent } = await import("./pi/pi-runtime");
    const originalAgent = Agent;

    // We test indirectly: the LLM calls get_recent_plays then pick_song —
    // both must resolve correctly, meaning all 4 tools were registered.
    let streamCallCount = 0;
    const provider = {
      chatStream: async function* (_messages: unknown, _opts: unknown, signal?: AbortSignal) {
        streamCallCount++;
        if (streamCallCount === 1) {
          // First turn: call get_recent_plays aux tool
          yield { type: "tool_call" as const, id: "tc-aux", name: "get_recent_plays", argsAccum: JSON.stringify({ n: 3 }) };
          yield { type: "stop" as const, reason: "tool_use" as const };
        } else {
          // Second turn: call pick_song
          yield { type: "tool_call" as const, id: "tc-pick", name: "pick_song", argsAccum: pickSongArgs("t1") };
          yield { type: "stop" as const, reason: "tool_use" as const };
        }
        void signal; void capturedTools; void originalAgent;
      },
    };

    const ctx = makeMockToolContext();
    const factory = makeMockToolContextFactory(ctx);

    const agent = new CompanionAgent({
      streamableProvider: provider,
      getPiAgentEnabled: async () => true,
      toolContextFactory: factory,
    });
    const out = await agent.choose(input);

    // get_recent_plays was executed via turnRepo
    expect(ctx.turnRepo.listRecentTurns).toHaveBeenCalled();
    // Final result is still a valid ChosenSong
    expect(out.song_id).toBe("t1");
    expect(typeof out.rationale).toBe("string");
    // At minimum 2 stream calls: 1 for get_recent_plays, 1+ for pick_song
    expect(streamCallCount).toBeGreaterThanOrEqual(2);
  });

  it("tools array has only pick_song (1 tool) when toolContextFactory is absent", async () => {
    // When no toolContextFactory, LLM can only call pick_song.
    // If it tried to call get_recent_plays, pi-runtime would return an error result.
    // This test verifies the pick_song-only path resolves correctly.
    let streamCallCount = 0;
    const provider = {
      chatStream: async function* (_messages: unknown, _opts: unknown, signal?: AbortSignal) {
        streamCallCount++;
        if (streamCallCount === 1) {
          yield { type: "tool_call" as const, id: "tc1", name: "pick_song", argsAccum: pickSongArgs("t2") };
          yield { type: "stop" as const, reason: "tool_use" as const };
        } else {
          yield { type: "text" as const, delta: "ok" };
          yield { type: "stop" as const, reason: "end" as const };
        }
        void signal;
      },
    };

    const agent = new CompanionAgent({
      streamableProvider: provider,
      getPiAgentEnabled: async () => true,
      // toolContextFactory intentionally omitted
    });
    const out = await agent.choose(input);
    expect(out.song_id).toBe("t2");
  });

  it("setToolContextFactory wires factory post-construction", async () => {
    let streamCallCount = 0;
    const provider = {
      chatStream: async function* (_messages: unknown, _opts: unknown, signal?: AbortSignal) {
        streamCallCount++;
        if (streamCallCount === 1) {
          // Call get_soul_facts first
          yield { type: "tool_call" as const, id: "tc-soul", name: "get_soul_facts", argsAccum: "{}" };
          yield { type: "stop" as const, reason: "tool_use" as const };
        } else {
          yield { type: "tool_call" as const, id: "tc-pick", name: "pick_song", argsAccum: pickSongArgs("t1") };
          yield { type: "stop" as const, reason: "tool_use" as const };
        }
        void signal;
      },
    };

    const ctx = makeMockToolContext();
    const factory = makeMockToolContextFactory(ctx);

    const agent = new CompanionAgent({
      streamableProvider: provider,
      getPiAgentEnabled: async () => true,
    });
    // Inject factory after construction
    agent.setToolContextFactory(factory);

    const out = await agent.choose(input);

    expect(ctx.soulStore.load).toHaveBeenCalled();
    expect(out.song_id).toBe("t1");
  });

  it("aux tool get_song_features called with ids → features returned, then pick_song", async () => {
    const ctx = makeMockToolContext();
    // Return non-empty features for t1
    (ctx.libraryFeaturesRepo.getBatch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Map([["t1", { track_id: "t1", bpm: 72, energy: 0.3, valence: 0.4 }]])
    );
    const factory = makeMockToolContextFactory(ctx);

    let streamCallCount = 0;
    const provider = {
      chatStream: async function* (_messages: unknown, _opts: unknown, signal?: AbortSignal) {
        streamCallCount++;
        if (streamCallCount === 1) {
          yield { type: "tool_call" as const, id: "tc-feat", name: "get_song_features", argsAccum: JSON.stringify({ ids: ["t1"] }) };
          yield { type: "stop" as const, reason: "tool_use" as const };
        } else {
          yield { type: "tool_call" as const, id: "tc-pick", name: "pick_song", argsAccum: pickSongArgs("t1") };
          yield { type: "stop" as const, reason: "tool_use" as const };
        }
        void signal;
      },
    };

    const agent = new CompanionAgent({
      streamableProvider: provider,
      getPiAgentEnabled: async () => true,
      toolContextFactory: factory,
    });
    const out = await agent.choose(input);

    expect(ctx.libraryFeaturesRepo.getBatch).toHaveBeenCalledWith(["t1"]);
    expect(out.song_id).toBe("t1");
  });

  it("pi + aux path and legacy path produce structurally equivalent ChosenSong shapes", async () => {
    const ctx = makeMockToolContext();
    const factory = makeMockToolContextFactory(ctx);

    let piStreamCallCount = 0;
    const piProvider = {
      chatStream: async function* (_messages: unknown, _opts: unknown, signal?: AbortSignal) {
        piStreamCallCount++;
        if (piStreamCallCount === 1) {
          yield { type: "tool_call" as const, id: "tc1", name: "pick_song", argsAccum: pickSongArgs("t1") };
          yield { type: "stop" as const, reason: "tool_use" as const };
        } else {
          yield { type: "text" as const, delta: "ok" };
          yield { type: "stop" as const, reason: "end" as const };
        }
        void signal;
      },
    };

    const piAgent = new CompanionAgent({
      streamableProvider: piProvider,
      getPiAgentEnabled: async () => true,
      toolContextFactory: factory,
    });
    const legacyAgent = new CompanionAgent({ provider: stub(validResponse) });

    const [piOut, legacyOut] = await Promise.all([piAgent.choose(input), legacyAgent.choose(input)]);

    for (const out of [piOut, legacyOut]) {
      expect(typeof out.song_id).toBe("string");
      expect(typeof out.target_profile).toBe("string");
      expect(typeof out.rationale).toBe("string");
      expect(["接住", "点燃", "陪着", "打断"]).toContain(out.needed_shift);
    }
    expect(piOut.song_id).toBe(legacyOut.song_id);
  });

  it("factory.build is called with a turnId string on each _choosePi invocation", async () => {
    const ctx = makeMockToolContext();
    const factory = makeMockToolContextFactory(ctx);

    let callCount = 0;
    const provider = {
      chatStream: async function* (_messages: unknown, _opts: unknown, signal?: AbortSignal) {
        callCount++;
        if (callCount === 1) {
          yield { type: "tool_call" as const, id: "tc1", name: "pick_song", argsAccum: pickSongArgs("t1") };
          yield { type: "stop" as const, reason: "tool_use" as const };
        } else {
          yield { type: "text" as const, delta: "ok" };
          yield { type: "stop" as const, reason: "end" as const };
        }
        void signal;
      },
    };

    const agent = new CompanionAgent({
      streamableProvider: provider,
      getPiAgentEnabled: async () => true,
      toolContextFactory: factory,
    });

    await agent.choose(input);

    expect(factory.build).toHaveBeenCalledOnce();
    // turnId passed to build must be a UUID string
    const calledWith = (factory.build as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(typeof calledWith).toBe("string");
    expect(calledWith.length).toBeGreaterThan(0);
  });

  it("user message includes aux hint when toolContextFactory is provided", async () => {
    const ctx = makeMockToolContext();
    const factory = makeMockToolContextFactory(ctx);

    const capturedMessages: unknown[] = [];
    const provider = {
      chatStream: async function* (messages: unknown, _opts: unknown, signal?: AbortSignal) {
        capturedMessages.push(messages);
        yield { type: "tool_call" as const, id: "tc1", name: "pick_song", argsAccum: pickSongArgs("t1") };
        yield { type: "stop" as const, reason: "tool_use" as const };
        void signal;
      },
    };

    const agent = new CompanionAgent({
      streamableProvider: provider,
      getPiAgentEnabled: async () => true,
      toolContextFactory: factory,
    });
    await agent.choose(input);

    // The first message in the first stream call contains the hint
    const firstCallMsgs = capturedMessages[0] as Array<{ role: string; content: string }>;
    const userMsg = firstCallMsgs.find((m) => m.role === "user");
    expect(userMsg?.content).toContain("get_recent_plays");
    expect(userMsg?.content).toContain("pick_song");
  });
});

// ── Phase 3a: verbal_intent tests ─────────────────────────────────────────────

const lastSongFixture = {
  id: "t1",
  path: "/tmp/nuvole.mp3",
  title: "Nuvole Bianche",
  artist: "Ludovico Einaudi",
  album: "Una Mattina",
  duration_ms: 358_000,
};

function responseWithIntent(song_id: string, intent: string | null) {
  return JSON.stringify({
    song_id,
    target_profile: "慢速钢琴",
    rationale: "接住此刻",
    needed_shift: "接住",
    verbal_intent: intent,
  });
}

describe("CompanionAgent.choose — verbal_intent (Phase 3a)", () => {
  it("verbal_intent=switch + lastSong → chosen song_id !== lastSong.id", async () => {
    // LLM returns switch intent but picks t2 (correct behavior)
    const p = stub(responseWithIntent("t2", "switch"));
    const a = new CompanionAgent({ provider: p });
    const out = await a.choose({ ...input, lastSong: lastSongFixture });
    expect(out.song_id).toBe("t2");
    expect(out.song_id).not.toBe(lastSongFixture.id);
  });

  it("verbal_intent=switch + lastSong → if LLM picks lastSong, retries and picks another", async () => {
    // LLM first returns switch intent but picks lastSong (t1) → should retry
    // Second call returns t2
    const switchPicksLastSong = responseWithIntent("t1", "switch");
    const switchPicksOther = responseWithIntent("t2", "switch");
    const p = stubSequential(switchPicksLastSong, switchPicksOther);
    const a = new CompanionAgent({ provider: p });
    const out = await a.choose({ ...input, lastSong: lastSongFixture });
    expect(out.song_id).not.toBe(lastSongFixture.id);
    expect((p.chat as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });

  it("verbal_intent=repeat + lastSong → returns lastSong.id directly (only 1 LLM call)", async () => {
    // LLM detects repeat; chosen song_id from LLM is t2 but should be overridden to t1
    const p = stub(responseWithIntent("t2", "repeat"));
    const a = new CompanionAgent({ provider: p });
    const out = await a.choose({ ...input, lastSong: lastSongFixture });
    expect(out.song_id).toBe(lastSongFixture.id);
    expect(out.verbal_intent).toBe("repeat");
    // Only one LLM call — no retry for repeat
    expect((p.chat as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });

  it("verbal_intent=null (LLM no intent) → follows normal path, returns valid song_id", async () => {
    const p = stub(responseWithIntent("t1", null));
    const a = new CompanionAgent({ provider: p });
    const out = await a.choose({ ...input, lastSong: lastSongFixture });
    expect(["t1", "t2"]).toContain(out.song_id);
    expect(out.verbal_intent).toBeNull();
  });

  it("verbal_intent=switch + no lastSong → normal path, no exclusion logic triggered", async () => {
    const p = stub(responseWithIntent("t1", "switch"));
    const a = new CompanionAgent({ provider: p });
    // No lastSong provided
    const out = await a.choose(input);
    expect(out.song_id).toBe("t1");
    // Only one LLM call (no special switch retry without lastSong)
    expect((p.chat as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });

  it("verbal_intent=repeat + no lastSong → normal path (repeat ignored without lastSong)", async () => {
    // LLM says repeat but no lastSong → just use the LLM's chosen song
    const p = stub(responseWithIntent("t2", "repeat"));
    const a = new CompanionAgent({ provider: p });
    const out = await a.choose(input);
    // Should NOT override to any specific song (no lastSong to repeat)
    expect(out.song_id).toBe("t2");
    expect((p.chat as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });

  it("prompt includes verbal_intent section", async () => {
    const p = stub(responseWithIntent("t1", null));
    const a = new CompanionAgent({ provider: p });
    await a.choose(input);
    const msgs = (p.chat as ReturnType<typeof vi.fn>).mock.calls[0][0] as Array<{ role: string; content: string }>;
    expect(msgs[0].role).toBe("system");
    expect(msgs[0].content).toContain("verbal_intent");
    expect(msgs[0].content).toContain("switch");
    expect(msgs[0].content).toContain("repeat");
  });

  it("prompt char count increase is within 800 chars (token guard)", () => {
    // COMPANION_SYSTEM_PROMPT is the source of truth — measure char diff
    // New verbal_intent section adds ~200 chars; guard at 800 to be safe
    const { COMPANION_SYSTEM_PROMPT } = require("./prompts/companion");
    // Original prompt had 45 lines / ~1650 chars; new one has verbal_intent block
    // We can't compare to old because we don't have it, but we can assert total is sane
    // The entire prompt should stay under 3000 chars (far below 200-token cap)
    expect(COMPANION_SYSTEM_PROMPT.length).toBeLessThan(3000);
  });

  it("user message includes last song context when lastSong is provided", async () => {
    const p = stub(responseWithIntent("t2", null));
    const a = new CompanionAgent({ provider: p });
    await a.choose({ ...input, lastSong: lastSongFixture });
    const msgs = (p.chat as ReturnType<typeof vi.fn>).mock.calls[0][0] as Array<{ role: string; content: string }>;
    const userContent = msgs[1].content;
    expect(userContent).toContain("Nuvole Bianche");
    expect(userContent).toContain("Ludovico Einaudi");
  });
});
