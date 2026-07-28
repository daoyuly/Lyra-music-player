import { describe, it, expect, vi, beforeEach } from "vitest";
import { Orchestrator } from "./Orchestrator";
import type { CurrentEmotion, LibraryTrack, DialogueTurn, SoulState } from "../types";
import * as memoryContext from "../memory/context";
import { EMPTY_MEMORY } from "../memory/parser";
import * as sharedMemoryRepo from "../db/repo/sharedMemoryRepo";
import * as appendSalientMod from "../memory/appendSalient";

// ── Mocks for salient moment wiring ──────────────────────────────────────────
vi.mock("../db/repo/sharedMemoryRepo", () => ({
  insertSharedMemory: vi.fn(async () => {}),
  listRecent: vi.fn(async () => []),
}));

vi.mock("../memory/appendSalient", () => ({
  appendSalientMomentToMemoryMd: vi.fn(async () => {}),
}));

// ── Mock tray bridge (no Tauri runtime in tests) ──────────────────────────────
vi.mock("../tray/trayBridge", () => ({
  setBreathing: vi.fn(async () => {}),
}));

import { setBreathing } from "../tray/trayBridge";

function makeDeps(overrides: Partial<any> = {}) {
  const emotion = {
    analyze: vi.fn(async () => ({
      pad: { p: -0.3, a: -0.2, d: 0 },
      labels: ["疲惫"],
      confidence: 0.7,
      source: "emotion-agent-inferred",
    }) as CurrentEmotion),
  };
  const companion = {
    choose: vi.fn(async () => ({
      song_id: "t1",
      target_profile: "x",
      rationale: "y",
      needed_shift: "接住" as const,
    })),
  };
  const track: LibraryTrack = { id: "t1", path: "/x.mp3", origin: "local", added_at: 0, title: "T1" };
  const library = { prefilter: vi.fn(async () => [track]) };
  const soul: SoulState = {
    agent_id: "lyra_001",
    created_at: "2026-07-06",
    musical_taste_base: {
      aesthetic_axes: {
        restraint_vs_expression: 0,
        narrative_vs_atmospheric: 0,
        polished_vs_raw: 0,
        novelty_seeking: 0.5,
      },
      affinity_genres: [],
      aversion_signals: [],
      backbone: "",
    },
    dynamic_mood: { current_pad: { p: 0, a: 0, d: 0 }, attention_to_user: 0.85, recent_bias: "" },
    shared_memory: [],
    evolution_log: [],
    proactive_budget: {
      daily_limit: 3,
      sulk_until: null,
      kind_budgets: { morning: 1, care: 1, anniversary: 1, share: 1, rhythm: 2 },
    },
  };
  const soulStore = { load: vi.fn(async () => soul), apply: vi.fn(async () => {}) };
  const turnRepo = { insertTurn: vi.fn(async () => {}) };
  const audio = { playFile: vi.fn(async () => {}), stop: vi.fn(async () => {}) };
  return {
    emotion,
    companion,
    library,
    soulStore,
    turnRepo,
    audio,
    clock: () => 1730_000_000_000,
    idGen: () => "turn-1",
    ...overrides,
  };
}

beforeEach(() => {
  // Reset memory context to empty before each test so tests are isolated
  memoryContext.setMemoryContext(EMPTY_MEMORY);
  vi.mocked(sharedMemoryRepo.insertSharedMemory).mockReset();
  vi.mocked(sharedMemoryRepo.insertSharedMemory).mockResolvedValue(undefined);
  vi.mocked(appendSalientMod.appendSalientMomentToMemoryMd).mockReset();
  vi.mocked(appendSalientMod.appendSalientMomentToMemoryMd).mockResolvedValue(undefined);
  vi.mocked(setBreathing).mockClear();
});

describe("Orchestrator.onUserInput happy path", () => {
  it("emits thinking then playing", async () => {
    const deps = makeDeps();
    const orc = new Orchestrator(deps as any);
    const seen: string[] = [];
    orc.subscribe((s) => seen.push(s.kind));
    await orc.onUserInput("最近有点累");
    expect(seen).toEqual(["thinking", "playing"]);
  });

  it("calls emotion, then companion, then plays audio", async () => {
    const deps = makeDeps();
    const orc = new Orchestrator(deps as any);
    await orc.onUserInput("最近有点累");
    expect(deps.emotion.analyze).toHaveBeenCalledOnce();
    expect(deps.companion.choose).toHaveBeenCalledOnce();
    expect(deps.audio.playFile).toHaveBeenCalledWith("/x.mp3", null);
  });

  it("inserts a DialogueTurn with all the right fields", async () => {
    const deps = makeDeps();
    const orc = new Orchestrator(deps as any);
    await orc.onUserInput("最近有点累");
    expect(deps.turnRepo.insertTurn).toHaveBeenCalledOnce();
    const turn = (deps.turnRepo.insertTurn.mock.calls[0] as unknown[])[0] as DialogueTurn;
    expect(turn.id).toBe("turn-1");
    expect(turn.timestamp).toBe(1730_000_000_000);
    expect(turn.user_utterance).toEqual({ modality: "text", content: "最近有点累" });
    expect(turn.agent_response.song_id).toBe("t1");
    expect(turn.agent_response.rationale).toBe("y");
    expect(turn.current_emotion.labels).toContain("疲惫");
  });

  it("threads livingPortrait and topFacts from MemoryContext into companion.choose", async () => {
    const portrait = "她偏爱深夜的宁静，古典钢琴是她的庇护所。";
    const fact = {
      tags: ["#时段:深夜"],
      conclusion: "慢速古典钢琴",
      confidence: 0.87,
      n: 9,
      lastVerifiedISO: "2026-07-07",
    };
    memoryContext.setMemoryContext({
      ...EMPTY_MEMORY,
      facts: [fact],
      livingPortrait: { paragraphs: [portrait] },
    });

    const deps = makeDeps();
    const orc = new Orchestrator(deps as any);
    await orc.onUserInput("来一首歌");

    expect(deps.companion.choose).toHaveBeenCalledOnce();
    const chooseArg = (deps.companion.choose as any).mock.calls[0][0];
    expect(chooseArg.livingPortrait).toBe(portrait);
    expect(chooseArg.topFacts).toHaveLength(1);
    expect(chooseArg.topFacts[0].conclusion).toBe("慢速古典钢琴");
  });
});

describe("Orchestrator.onUserInput error paths", () => {
  it("emits error when library is empty", async () => {
    const deps = makeDeps({ library: { prefilter: vi.fn(async () => []) } });
    const orc = new Orchestrator(deps as any);
    let last: any = null;
    orc.subscribe((s) => (last = s));
    await orc.onUserInput("hi");
    expect(last.kind).toBe("error");
    expect(last.message).toMatch(/library/i);
  });

  it("emits error when emotion agent throws", async () => {
    const deps = makeDeps({
      emotion: { analyze: vi.fn(async () => { throw new Error("nope"); }) },
    });
    const orc = new Orchestrator(deps as any);
    let last: any = null;
    orc.subscribe((s) => (last = s));
    await orc.onUserInput("hi");
    expect(last.kind).toBe("error");
  });
});

describe("Orchestrator T7: reaction capture", () => {
  it("onSkip folds skip event into current turn", async () => {
    const deps = makeDeps();
    const updateTurn = vi.fn(async () => {});
    deps.turnRepo = { insertTurn: deps.turnRepo.insertTurn, updateTurn } as any;
    const orc = new Orchestrator(deps as any);

    await orc.onUserInput("来一首歌");
    // Verify we're in playing state with a currentTurn
    expect(orc.getState().kind).toBe("playing");

    await orc.onSkip();

    // On next input, finalise previous turn — updateTurn should be called
    await orc.onUserInput("再来一首");
    expect(updateTurn).toHaveBeenCalled();
    const updatedTurn = (updateTurn.mock.calls[0] as unknown as [DialogueTurn])[0];
    expect(updatedTurn.user_reaction.behavioral.skipped).toBe(true);
  });

  it("verbal from next input is attributed to previous turn", async () => {
    const deps = makeDeps();
    const updateTurn = vi.fn(async () => {});
    deps.turnRepo = { insertTurn: deps.turnRepo.insertTurn, updateTurn } as any;
    const orc = new Orchestrator(deps as any);

    await orc.onUserInput("来一首歌");
    // No skip or complete — just provide verbal via next input
    await orc.onUserInput("这首歌真好听");

    expect(updateTurn).toHaveBeenCalled();
    const updatedTurn = (updateTurn.mock.calls[0] as unknown as [DialogueTurn])[0];
    expect(updatedTurn.user_reaction.verbal).toBeDefined();
    expect(updatedTurn.user_reaction.verbal?.content).toBe("这首歌真好听");
  });

  it("soul dynamic_mood updates after next turn (soulStore.apply called)", async () => {
    const deps = makeDeps();
    const updateTurn = vi.fn(async () => {});
    deps.turnRepo = { insertTurn: deps.turnRepo.insertTurn, updateTurn } as any;
    const orc = new Orchestrator(deps as any);

    await orc.onUserInput("来一首歌");
    await orc.onSongComplete();

    // Second input triggers soul.apply with delta
    await orc.onUserInput("好的，再来一首");

    expect(deps.soulStore.apply).toHaveBeenCalled();
    const delta = (deps.soulStore.apply as any).mock.calls[0][0];
    // delta should be a PAD object
    expect(typeof delta.p).toBe("number");
    expect(typeof delta.a).toBe("number");
    expect(typeof delta.d).toBe("number");
  });

  it("onListenProgress accumulates max ms on current turn", async () => {
    const deps = makeDeps();
    const updateTurn = vi.fn(async () => {});
    deps.turnRepo = { insertTurn: deps.turnRepo.insertTurn, updateTurn } as any;
    const orc = new Orchestrator(deps as any);

    await orc.onUserInput("来一首歌");
    orc.onListenProgress(5000);
    orc.onListenProgress(12000);
    orc.onListenProgress(8000);

    await orc.onUserInput("继续");

    expect(updateTurn).toHaveBeenCalled();
    const updatedTurn = (updateTurn.mock.calls[0] as unknown as [DialogueTurn])[0];
    expect(updatedTurn.user_reaction.behavioral.listen_duration_ms).toBe(12000);
  });
});

describe("Orchestrator.fulfillProactive", () => {
  const morningIntent = (): import("../proactive/types").ProactiveIntent => ({
    id: "i1",
    createdAt: 1000,
    validUntil: 1000 + 30 * 60_000,
    kind: "morning",
    urgency: 0.5,
    hint: "早上第一次打开",
  });

  it("prefilters + chooses then emits proactive-pending without playing audio", async () => {
    const deps = makeDeps();
    const orc = new Orchestrator(deps as any);
    const seen: string[] = [];
    orc.subscribe((s) => seen.push(s.kind));

    await orc.fulfillProactive(morningIntent());

    expect(deps.library.prefilter).toHaveBeenCalledOnce();
    expect(deps.companion.choose).toHaveBeenCalledOnce();
    expect(deps.audio.playFile).not.toHaveBeenCalled();
    expect(seen).toEqual(["proactive-pending"]);
    const state = orc.getState();
    expect(state.kind).toBe("proactive-pending");
    if (state.kind === "proactive-pending") {
      expect(state.song.id).toBe("t1");
      expect(state.rationale).toBe("y");
      expect(state.intent.kind).toBe("morning");
    }
  });

  it("no-ops when library is empty", async () => {
    const deps = makeDeps();
    (deps.library as any).prefilter = vi.fn(async () => []);
    const orc = new Orchestrator(deps as any);

    await orc.fulfillProactive(morningIntent());

    expect(deps.companion.choose).not.toHaveBeenCalled();
    expect(orc.getState().kind).toBe("idle");
  });

  it("no-ops when already playing", async () => {
    const deps = makeDeps();
    const orc = new Orchestrator(deps as any);
    await orc.onUserInput("来首歌");
    expect(orc.getState().kind).toBe("playing");
    deps.library.prefilter.mockClear();
    deps.companion.choose.mockClear();

    await orc.fulfillProactive(morningIntent());

    expect(deps.library.prefilter).not.toHaveBeenCalled();
    expect(deps.companion.choose).not.toHaveBeenCalled();
    expect(orc.getState().kind).toBe("playing");
  });
});

describe("Orchestrator T2: proactive-pending state", () => {
  it("startProactiveIntent emits proactive-pending WITHOUT playing audio", () => {
    const deps = makeDeps();
    const orc = new Orchestrator(deps as any);
    const seen: string[] = [];
    orc.subscribe((s) => seen.push(s.kind));

    const track: import("../types").LibraryTrack = {
      id: "t1",
      path: "/x.mp3",
      origin: "local",
      added_at: 0,
      title: "T1",
    };
    const intent: import("../proactive/types").ProactiveIntent = {
      id: "i1",
      createdAt: 1000,
      validUntil: 1000 + 30 * 60_000,
      kind: "morning",
      urgency: 0.5,
      hint: "早上第一次打开",
    };

    orc.startProactiveIntent(intent, track, "morning greeting");

    expect(seen).toEqual(["proactive-pending"]);
    expect(deps.audio.playFile).not.toHaveBeenCalled();

    const state = orc.getState();
    expect(state.kind).toBe("proactive-pending");
    if (state.kind === "proactive-pending") {
      expect(state.intent).toBe(intent);
      expect(state.song).toBe(track);
      expect(state.rationale).toBe("morning greeting");
    }
  });

  it("onUserInput after proactive-pending commits the pending turn then processes utterance", async () => {
    const deps = makeDeps();
    const updateTurn = vi.fn(async () => {});
    deps.turnRepo = { insertTurn: deps.turnRepo.insertTurn, updateTurn } as any;
    const orc = new Orchestrator(deps as any);

    const track: import("../types").LibraryTrack = {
      id: "t1",
      path: "/x.mp3",
      origin: "local",
      added_at: 0,
      title: "T1",
    };
    const intent: import("../proactive/types").ProactiveIntent = {
      id: "i1",
      createdAt: 1000,
      validUntil: 1000 + 30 * 60_000,
      kind: "morning",
      urgency: 0.5,
      hint: "早上第一次打开",
    };

    orc.startProactiveIntent(intent, track, "morning greeting");
    expect(orc.getState().kind).toBe("proactive-pending");

    await orc.onUserInput("好的");

    // Should have inserted the proactive-pending turn + the new user turn
    expect(deps.turnRepo.insertTurn).toHaveBeenCalledTimes(2);
    // First call: the proactive-pending turn with modality "proactive-open"
    const firstTurn = (deps.turnRepo.insertTurn.mock.calls[0] as unknown[])[0] as import("../types").DialogueTurn;
    expect(firstTurn.user_utterance.modality).toBe("proactive-open");
    expect(firstTurn.agent_response.song_id).toBe("t1");

    // Should end in playing state
    expect(orc.getState().kind).toBe("playing");
    // Audio should have been called once (for the new utterance turn)
    expect(deps.audio.playFile).toHaveBeenCalledOnce();
  });

  it("onUserInput from idle state (no proactive-pending) still works normally", async () => {
    const deps = makeDeps();
    const orc = new Orchestrator(deps as any);
    const seen: string[] = [];
    orc.subscribe((s) => seen.push(s.kind));

    await orc.onUserInput("来首歌");
    expect(seen).toEqual(["thinking", "playing"]);
    expect(deps.turnRepo.insertTurn).toHaveBeenCalledOnce();
    expect(deps.audio.playFile).toHaveBeenCalledOnce();
  });

  it("onUserInput after proactive-pending calls setBreathing(false) to stop animation", async () => {
    const deps = makeDeps();
    const updateTurn = vi.fn(async () => {});
    deps.turnRepo = { insertTurn: deps.turnRepo.insertTurn, updateTurn } as any;
    const orc = new Orchestrator(deps as any);

    const track: import("../types").LibraryTrack = {
      id: "t1",
      path: "/x.mp3",
      origin: "local",
      added_at: 0,
      title: "T1",
    };
    const intent: import("../proactive/types").ProactiveIntent = {
      id: "i1",
      createdAt: 1000,
      validUntil: 1000 + 30 * 60_000,
      kind: "morning",
      urgency: 0.5,
      hint: "早上第一次打开",
    };

    orc.startProactiveIntent(intent, track, "morning greeting");
    await orc.onUserInput("好的");

    expect(setBreathing).toHaveBeenCalledWith(false);
  });

  it("onUserInput from idle does NOT call setBreathing", async () => {
    const deps = makeDeps();
    const orc = new Orchestrator(deps as any);

    await orc.onUserInput("来首歌");

    expect(setBreathing).not.toHaveBeenCalled();
  });
});

describe("Orchestrator T8: emotion prediction channel (auto-advance)", () => {
  it("uses predicted_pad when elapsed_min is in [3, horizon_min]", async () => {
    // Turn timestamp = 1730_000_000_000; clock for autoAdvance = timestamp + 10 min
    const turnTs = 1730_000_000_000;
    const advanceTs = turnTs + 10 * 60_000; // 10 min later → within horizon 30
    let callCount = 0;
    const clockFn = () => {
      callCount++;
      // First few calls come from runTurnWithEmotion (idGen, etc) — we need the
      // advance clock only for the onSongComplete path.  Return turnTs for the
      // first call (turn insert), advanceTs for subsequent calls.
      return callCount === 1 ? turnTs : advanceTs;
    };

    const emotionWithPrediction: CurrentEmotion = {
      pad: { p: 0.1, a: 0.2, d: 0.0 },
      labels: ["平静"],
      confidence: 0.8,
      source: "emotion-agent-inferred",
      predicted_trajectory: { horizon_min: 30, predicted_pad: { p: -0.7, a: -0.8, d: -0.2 } },
    };
    const deps = makeDeps({
      clock: clockFn,
      emotion: { analyze: vi.fn(async () => emotionWithPrediction) },
    });
    const updateTurn = vi.fn(async () => {});
    deps.turnRepo = { insertTurn: deps.turnRepo.insertTurn, updateTurn } as any;
    const orc = new Orchestrator(deps as any);

    await orc.onUserInput("我准备去睡觉了");
    // Now trigger auto-advance (song complete)
    await orc.onSongComplete();

    // The second insertTurn call (auto-advance turn) should use predicted_pad
    expect(deps.turnRepo.insertTurn).toHaveBeenCalledTimes(2);
    const autoTurn = (deps.turnRepo.insertTurn.mock.calls[1] as unknown[])[0] as DialogueTurn;
    expect(autoTurn.current_emotion.pad).toEqual({ p: -0.7, a: -0.8, d: -0.2 });
    // predicted_trajectory should NOT be carried forward
    expect(autoTurn.current_emotion.predicted_trajectory).toBeUndefined();
  });

  it("falls back to endedEmotion.pad when elapsed_min < 3", async () => {
    const turnTs = 1730_000_000_000;
    const advanceTs = turnTs + 1 * 60_000; // only 1 min — below window
    let callCount = 0;
    const clockFn = () => (callCount++ === 0 ? turnTs : advanceTs);

    const emotionWithPrediction: CurrentEmotion = {
      pad: { p: 0.1, a: 0.2, d: 0.0 },
      labels: ["平静"],
      confidence: 0.8,
      source: "emotion-agent-inferred",
      predicted_trajectory: { horizon_min: 30, predicted_pad: { p: -0.7, a: -0.8, d: -0.2 } },
    };
    const deps = makeDeps({
      clock: clockFn,
      emotion: { analyze: vi.fn(async () => emotionWithPrediction) },
    });
    const updateTurn = vi.fn(async () => {});
    deps.turnRepo = { insertTurn: deps.turnRepo.insertTurn, updateTurn } as any;
    const orc = new Orchestrator(deps as any);

    await orc.onUserInput("准备睡觉");
    await orc.onSongComplete();

    const autoTurn = (deps.turnRepo.insertTurn.mock.calls[1] as unknown[])[0] as DialogueTurn;
    // Should use original pad, not predicted_pad
    expect(autoTurn.current_emotion.pad).toEqual({ p: 0.1, a: 0.2, d: 0.0 });
  });

  it("auto-advance without predicted_trajectory uses endedEmotion verbatim", async () => {
    const deps = makeDeps();
    const updateTurn = vi.fn(async () => {});
    deps.turnRepo = { insertTurn: deps.turnRepo.insertTurn, updateTurn } as any;
    const orc = new Orchestrator(deps as any);

    await orc.onUserInput("随便来首歌");
    await orc.onSongComplete();

    expect(deps.turnRepo.insertTurn).toHaveBeenCalledTimes(2);
    const autoTurn = (deps.turnRepo.insertTurn.mock.calls[1] as unknown[])[0] as DialogueTurn;
    // Default mock emotion pad
    expect(autoTurn.current_emotion.pad).toEqual({ p: -0.3, a: -0.2, d: 0 });
    expect(autoTurn.current_emotion.predicted_trajectory).toBeUndefined();
  });

  // Regression: without exclusion the same emotion + same pseudoTarget yields
  // the same top-ranked song, and the LLM re-picks it every time. That produced
  // "song ends → same song replays" instead of auto-advance.
  it("auto-advance excludes the just-played song from prefilter candidates", async () => {
    const t1: LibraryTrack = { id: "t1", path: "/a.mp3", origin: "local", added_at: 0, title: "T1" };
    const t2: LibraryTrack = { id: "t2", path: "/b.mp3", origin: "local", added_at: 0, title: "T2" };
    const prefilter = vi.fn(
      async (
        _target: unknown,
        _pad: unknown,
        _limit: unknown,
        exclude?: ReadonlySet<string>,
      ) => {
        const all = [t1, t2];
        return exclude ? all.filter((t) => !exclude.has(t.id)) : all;
      },
    );
    const choose = vi.fn(async (input: { candidates: LibraryTrack[] }) => ({
      song_id: input.candidates[0].id,
      target_profile: "x",
      rationale: "y",
      needed_shift: "接住" as const,
    }));
    const deps = makeDeps({
      library: { prefilter },
      companion: { choose },
    });
    const orc = new Orchestrator(deps as any);

    // First turn → t1 (first candidate)
    await orc.onUserInput("start");
    expect(deps.audio.playFile).toHaveBeenLastCalledWith("/a.mp3", null);

    // Song completes → auto-advance must exclude t1 and pick t2
    await orc.onSongComplete();

    // 2nd prefilter call is auto-advance: 4th arg must exclude t1
    const secondCall = prefilter.mock.calls[1] as unknown as [
      unknown, unknown, unknown, ReadonlySet<string>,
    ];
    expect(secondCall[3]).toBeInstanceOf(Set);
    expect(secondCall[3].has("t1")).toBe(true);

    // And audio played the OTHER song
    expect(deps.audio.playFile).toHaveBeenLastCalledWith("/b.mp3", null);
  });
});

describe("Orchestrator T6: salient moment wiring", () => {
  it("significant turn triggers repo insert + memory.md append", async () => {
    const salientModule = await import("../moments/salient");
    const fakeMoment = {
      timestampISO: "2026-07-07T02:30:00.000Z",
      songTitle: "《T1》",
      narrative: "《T1》完整听完，沉默正向。",
      tags: ["#时段:深夜"],
    };
    const detectSpy = vi.spyOn(salientModule, "detectSalientMoment").mockReturnValue(fakeMoment);

    const deps = makeDeps();
    const updateTurn = vi.fn(async () => {});
    deps.turnRepo = { insertTurn: deps.turnRepo.insertTurn, updateTurn } as any;
    const orc = new Orchestrator(deps as any);

    // First input: establish a playing turn + current song
    await orc.onUserInput("来一首歌");
    // Second input: finalises previous turn → detectSalientMoment returns fakeMoment
    await orc.onUserInput("继续");

    expect(vi.mocked(sharedMemoryRepo.insertSharedMemory)).toHaveBeenCalledOnce();
    expect(vi.mocked(sharedMemoryRepo.insertSharedMemory)).toHaveBeenCalledWith(fakeMoment);
    expect(vi.mocked(appendSalientMod.appendSalientMomentToMemoryMd)).toHaveBeenCalledOnce();
    expect(vi.mocked(appendSalientMod.appendSalientMomentToMemoryMd)).toHaveBeenCalledWith(fakeMoment);

    detectSpy.mockRestore();
  });

  it("non-significant turn does NOT call repo insert or memory.md append", async () => {
    const salientModule = await import("../moments/salient");
    const detectSpy = vi.spyOn(salientModule, "detectSalientMoment").mockReturnValue(null);

    const deps = makeDeps();
    const updateTurn = vi.fn(async () => {});
    deps.turnRepo = { insertTurn: deps.turnRepo.insertTurn, updateTurn } as any;
    const orc = new Orchestrator(deps as any);

    await orc.onUserInput("来一首歌");
    await orc.onUserInput("继续");

    expect(vi.mocked(sharedMemoryRepo.insertSharedMemory)).not.toHaveBeenCalled();
    expect(vi.mocked(appendSalientMod.appendSalientMomentToMemoryMd)).not.toHaveBeenCalled();

    detectSpy.mockRestore();
  });
});

describe("Orchestrator Sprint 4: perception bias blending", () => {
  it("without setPerceptionBias, companion.choose receives emotion.pad verbatim", async () => {
    const deps = makeDeps();
    const orc = new Orchestrator(deps as any);
    await orc.onUserInput("hi");
    const chooseArg = (deps.companion.choose as any).mock.calls[0][0];
    expect(chooseArg.currentEmotion.pad).toEqual({ p: -0.3, a: -0.2, d: 0 });
  });

  it("setPerceptionBias(bias) blends pad_bias * confidence into next onUserInput", async () => {
    const deps = makeDeps();
    const orc = new Orchestrator(deps as any);
    orc.setPerceptionBias({
      pad_bias: { p: 0.4, a: -0.2, d: 0.1 },
      confidence: 0.5,
      reason: "test",
    });
    await orc.onUserInput("hi");
    const chooseArg = (deps.companion.choose as any).mock.calls[0][0];
    // Base pad = -0.3, -0.2, 0; bias scaled = 0.2, -0.1, 0.05
    expect(chooseArg.currentEmotion.pad.p).toBeCloseTo(-0.1, 5);
    expect(chooseArg.currentEmotion.pad.a).toBeCloseTo(-0.3, 5);
    expect(chooseArg.currentEmotion.pad.d).toBeCloseTo(0.05, 5);
  });

  it("blended pad is clamped to [-1, 1]", async () => {
    const deps = makeDeps({
      emotion: {
        analyze: vi.fn(async () => ({
          pad: { p: 0.9, a: 0.9, d: -0.9 },
          labels: [],
          confidence: 0.5,
          source: "emotion-agent-inferred",
        }) as CurrentEmotion),
      },
    });
    const orc = new Orchestrator(deps as any);
    orc.setPerceptionBias({
      pad_bias: { p: 1, a: 1, d: -1 },
      confidence: 1,
      reason: "extreme",
    });
    await orc.onUserInput("hi");
    const chooseArg = (deps.companion.choose as any).mock.calls[0][0];
    expect(chooseArg.currentEmotion.pad.p).toBe(1);
    expect(chooseArg.currentEmotion.pad.a).toBe(1);
    expect(chooseArg.currentEmotion.pad.d).toBe(-1);
  });

  it("setPerceptionBias(null) clears an earlier bias", async () => {
    const deps = makeDeps();
    const orc = new Orchestrator(deps as any);
    orc.setPerceptionBias({
      pad_bias: { p: 0.4, a: 0, d: 0 },
      confidence: 0.5,
      reason: "x",
    });
    orc.setPerceptionBias(null);
    await orc.onUserInput("hi");
    const chooseArg = (deps.companion.choose as any).mock.calls[0][0];
    expect(chooseArg.currentEmotion.pad).toEqual({ p: -0.3, a: -0.2, d: 0 });
  });

  it("emits input_submit / skip / complete on optional eventBus", async () => {
    const emitted: any[] = [];
    const eventBus = { emit: (e: any) => emitted.push(e) };
    const deps = makeDeps({ eventBus });
    const orc = new Orchestrator(deps as any);

    await orc.onUserInput("hello world");
    await orc.onSkip();
    // Reset state for a fresh song we can complete
    await orc.onUserInput("more");
    await orc.onSongComplete();

    const kinds = emitted.map((e) => e.kind);
    expect(kinds).toContain("input_submit");
    expect(kinds).toContain("skip");
    expect(kinds).toContain("complete");

    const inputEv = emitted.find((e) => e.kind === "input_submit");
    expect(inputEv.charCount).toBe("hello world".length);
  });
});

describe("Orchestrator Sprint 15: perception signals for CompanionAgent", () => {
  it("companion.choose receives default signals when setPerceptionSignals not called", async () => {
    const deps = makeDeps();
    const orc = new Orchestrator(deps as any);
    await orc.onUserInput("hi");
    const chooseArg = (deps.companion.choose as any).mock.calls[0][0];
    expect(chooseArg.skipRatio).toBe(0);
    expect(chooseArg.isBlurred).toBe(false);
    expect(chooseArg.inputHesitation).toBe("none");
  });

  it("setPerceptionSignals is passed to companion.choose on next onUserInput", async () => {
    const deps = makeDeps();
    const orc = new Orchestrator(deps as any);
    orc.setPerceptionSignals({
      skipRatio: 0.7,
      isBlurred: true,
      inputHesitation: "many",
    });
    await orc.onUserInput("hi");
    const chooseArg = (deps.companion.choose as any).mock.calls[0][0];
    expect(chooseArg.skipRatio).toBe(0.7);
    expect(chooseArg.isBlurred).toBe(true);
    expect(chooseArg.inputHesitation).toBe("many");
  });

  it("emotionTimelineSummary is omitted when memory context has no timeline", async () => {
    const deps = makeDeps();
    const orc = new Orchestrator(deps as any);
    await orc.onUserInput("hi");
    const chooseArg = (deps.companion.choose as any).mock.calls[0][0];
    expect(chooseArg.emotionTimelineSummary).toBeUndefined();
  });
});

describe("Orchestrator Sprint 17: shift feedback persistence", () => {
  it("does nothing when shiftFeedbackRepo is not provided", async () => {
    const deps = makeDeps();
    const orc = new Orchestrator(deps as any);
    await orc.onUserInput("hi");
    // No repo, so nothing to assert on. Just ensure onSkip doesn't throw.
    await expect(orc.onSkip()).resolves.toBeUndefined();
  });

  it("writes a skip feedback record when onSkip is called after onUserInput", async () => {
    const insertMock: any = vi.fn(async (_: unknown) => {});
    const deps = makeDeps({ shiftFeedbackRepo: { insert: insertMock } });
    const orc = new Orchestrator(deps as any);
    await orc.onUserInput("hi");
    await orc.onSkip();
    expect(insertMock).toHaveBeenCalledOnce();
    const record = insertMock.mock.calls[0][0];
    expect(record.userAction).toBe("skip");
    expect(record.recommendedShift).toBeTruthy();
    expect(record.padAtTime).toBeDefined();
    expect(record.turnId).toBeTruthy();
  });

  it("writes a complete feedback record when onSongComplete is called", async () => {
    const insertMock: any = vi.fn(async (_: unknown) => {});
    const deps = makeDeps({ shiftFeedbackRepo: { insert: insertMock } });
    const orc = new Orchestrator(deps as any);
    await orc.onUserInput("hi");
    await orc.onSongComplete();
    expect(insertMock).toHaveBeenCalled();
    const record = insertMock.mock.calls[0][0];
    expect(record.userAction).toBe("complete");
  });

  it("swallows repo errors so playback flow is not broken", async () => {
    const insertMock = vi.fn(async () => {
      throw new Error("db down");
    });
    const deps = makeDeps({ shiftFeedbackRepo: { insert: insertMock } });
    const orc = new Orchestrator(deps as any);
    await orc.onUserInput("hi");
    await expect(orc.onSkip()).resolves.toBeUndefined();
  });
});

describe("Orchestrator Sprint 19: libraryFeatures for CompanionAgent", () => {
  it("passes candidateFeatures to companion.choose when libraryFeaturesRepo is provided", async () => {
    const featuresMap = new Map([
      ["t1", { track_id: "t1", bpm: 120, energy: 0.5, valence: 0.4 }],
    ]);
    const getBatchMock: any = vi.fn(async (_: string[]) => featuresMap);
    const deps = makeDeps({ libraryFeaturesRepo: { getBatch: getBatchMock } });
    const orc = new Orchestrator(deps as any);
    await orc.onUserInput("hi");
    expect(getBatchMock).toHaveBeenCalledOnce();
    const chooseArg = (deps.companion.choose as any).mock.calls[0][0];
    expect(chooseArg.candidateFeatures).toBe(featuresMap);
  });

  it("passes candidateFeatures=undefined when libraryFeaturesRepo is not provided", async () => {
    const deps = makeDeps();
    const orc = new Orchestrator(deps as any);
    await orc.onUserInput("hi");
    const chooseArg = (deps.companion.choose as any).mock.calls[0][0];
    expect(chooseArg.candidateFeatures).toBeUndefined();
  });

  it("swallows getBatch errors and proceeds without features", async () => {
    const getBatchMock: any = vi.fn(async () => {
      throw new Error("db down");
    });
    const deps = makeDeps({ libraryFeaturesRepo: { getBatch: getBatchMock } });
    const orc = new Orchestrator(deps as any);
    await expect(orc.onUserInput("hi")).resolves.toBeUndefined();
    const chooseArg = (deps.companion.choose as any).mock.calls[0][0];
    expect(chooseArg.candidateFeatures).toBeUndefined();
  });
});
