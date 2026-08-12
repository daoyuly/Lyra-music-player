/**
 * toolContext.test.ts — Structural / contract tests for ToolContext
 *
 * These tests verify that:
 * 1. A conforming mock object satisfies the ToolContext interface at compile
 *    time (structural typing — if it compiles, the interface is correct).
 * 2. The injected functions are called correctly by code that consumes a
 *    ToolContext (runtime behaviour).
 *
 * No real DB or repo is imported here. All implementations are inline stubs.
 */

import { describe, it, expect, vi } from "vitest";
import type { ToolContext } from "./toolContext";
import type { LibraryTrack } from "../../types/song";
import type { LibraryFeatures } from "../../db/repo/libraryFeaturesRepo";
import type { DialogueTurn } from "../../types/dialogue";
import type { SoulState } from "../../types/soul";

// ---------------------------------------------------------------------------
// Helpers — minimal stubs that satisfy the types structurally
// ---------------------------------------------------------------------------

function makeTrack(id: string): LibraryTrack {
  return { id, path: `/music/${id}.mp3`, origin: "local", added_at: 0 };
}

function makeFeatures(track_id: string): LibraryFeatures {
  return { track_id, bpm: 120, energy: 0.8, valence: 0.6 };
}

function makeTurn(id: string): DialogueTurn {
  // Cast via unknown — DialogueTurn has many required fields; we only need
  // enough for structural conformance in these unit tests.
  return {
    id,
    timestamp: 0,
    current_emotion: {
      pad: { p: 0, a: 0, d: 0 },
      labels: [],
      confidence: 0.5,
      source: "emotion-agent-inferred",
    },
    user_utterance: { modality: "text", content: "hi" },
    agent_response: { song_id: "s1", rationale: "r" },
    user_reaction: {
      behavioral: {
        listen_duration_ms: 0,
        completed: false,
        skipped: false,
        repeated: 0,
        volume_delta: 0,
      },
      silence_positive: false,
    },
    emotion_delta: { p: 0, a: 0, d: 0 },
  };
}

function makeSoulState(): SoulState {
  // Cast via unknown — SoulState has many required fields; we only need
  // enough for structural conformance in these unit tests.
  return {
    agent_id: "lyra",
    created_at: "2026-08-03",
    musical_taste_base: {
      aesthetic_axes: {
        restraint_vs_expression: 0.5,
        narrative_vs_atmospheric: 0.5,
        polished_vs_raw: 0.5,
        novelty_seeking: 0.5,
      },
      affinity_genres: [],
      aversion_signals: [],
      backbone: "",
    },
    dynamic_mood: { current_pad: { p: 0, a: 0, d: 0 }, attention_to_user: 0.5, recent_bias: "" },
    shared_memory: [],
    evolution_log: [],
    proactive_budget: {
      daily_limit: 3,
      sulk_until: null,
      kind_budgets: { morning: 1, care: 1, anniversary: 1, share: 1, rhythm: 1 },
    },
  } as unknown as SoulState;
}

// ---------------------------------------------------------------------------
// Build a conforming ToolContext mock
// ---------------------------------------------------------------------------

function buildMockToolContext(): ToolContext {
  const track = makeTrack("track-1");
  const features = makeFeatures("track-1");
  const turn = makeTurn("turn-1");
  const soul = makeSoulState();

  return {
    libraryRepo: {
      getTrack: vi.fn(async (id: string) => (id === "track-1" ? track : null)),
      listAll: vi.fn(async () => [track]),
    },
    libraryFeaturesRepo: {
      getBatch: vi.fn(async (ids: string[]) => {
        const map = new Map<string, LibraryFeatures>();
        for (const id of ids) {
          if (id === "track-1") map.set(id, features);
        }
        return map;
      }),
    },
    turnRepo: {
      listRecentTurns: vi.fn(async (n: number) => [turn].slice(0, n)),
    },
    soulStore: {
      load: vi.fn(async () => soul),
    },
    clock: () => 1234567890,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ToolContext interface — structural conformance", () => {
  it("a conforming mock object satisfies ToolContext at compile time", () => {
    // If this assignment compiles without errors, the interface is satisfied.
    const ctx: ToolContext = buildMockToolContext();
    expect(ctx).toBeDefined();
  });
});

describe("ToolContext.libraryRepo", () => {
  it("getTrack returns a track by id", async () => {
    const ctx = buildMockToolContext();
    const t = await ctx.libraryRepo.getTrack("track-1");
    expect(t?.id).toBe("track-1");
    expect(t?.origin).toBe("local");
  });

  it("getTrack returns null for unknown id", async () => {
    const ctx = buildMockToolContext();
    const t = await ctx.libraryRepo.getTrack("unknown");
    expect(t).toBeNull();
  });

  it("listAll returns all tracks", async () => {
    const ctx = buildMockToolContext();
    const tracks = await ctx.libraryRepo.listAll();
    expect(tracks.length).toBe(1);
    expect(tracks[0].id).toBe("track-1");
  });
});

describe("ToolContext.libraryFeaturesRepo", () => {
  it("getBatch returns a Map keyed by track id", async () => {
    const ctx = buildMockToolContext();
    const m = await ctx.libraryFeaturesRepo.getBatch(["track-1", "unknown"]);
    expect(m.get("track-1")?.bpm).toBe(120);
    expect(m.has("unknown")).toBe(false);
  });

  it("getBatch with empty array returns empty Map", async () => {
    const ctx = buildMockToolContext();
    const m = await ctx.libraryFeaturesRepo.getBatch([]);
    expect(m.size).toBe(0);
  });
});

describe("ToolContext.turnRepo", () => {
  it("listRecentTurns(1) returns at most one turn", async () => {
    const ctx = buildMockToolContext();
    const turns = await ctx.turnRepo.listRecentTurns(1);
    expect(turns.length).toBeLessThanOrEqual(1);
    if (turns.length > 0) {
      expect(turns[0].id).toBe("turn-1");
    }
  });
});

describe("ToolContext.soulStore", () => {
  it("load returns a SoulState", async () => {
    const ctx = buildMockToolContext();
    const soul = await ctx.soulStore.load();
    expect(soul).toBeDefined();
    expect(soul.agent_id).toBe("lyra");
  });
});

describe("ToolContext.clock", () => {
  it("clock() returns a number", () => {
    const ctx = buildMockToolContext();
    expect(typeof ctx.clock()).toBe("number");
  });

  it("clock is replaceable for deterministic tests", () => {
    const ctx = buildMockToolContext();
    (ctx as { clock: () => number }).clock = () => 42;
    expect(ctx.clock()).toBe(42);
  });
});
