/**
 * companion-aux-tools.test.ts — Phase 3b
 *
 * Tests for the three read-only auxiliary tool factories:
 *   makeGetRecentPlaysTool
 *   makeGetSoulFactsTool
 *   makeGetSongFeaturesTool
 *
 * Each factory is tested for:
 *   - normal result (mock ToolContext returns data → isError absent)
 *   - parameter validation failure (n > 20 or ids > 10 → isError:true)
 *   - repo throw → isError:true, no throw propagation
 */

import { describe, it, expect, vi } from "vitest";
import {
  makeGetRecentPlaysTool,
  makeGetSoulFactsTool,
  makeGetSongFeaturesTool,
  makeAuxTools,
} from "./companion-aux-tools";
import type { ToolContext } from "./toolContext";
import type { SoulState } from "../../types/soul";
import type { DialogueTurn } from "../../types/dialogue";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const fakeTurns: DialogueTurn[] = [
  {
    id: "turn-1",
    timestamp: 1000,
    current_emotion: {
      pad: { p: -0.3, a: -0.2, d: 0.0 },
      labels: ["疲惫"],
      confidence: 0.7,
      source: "emotion-agent-inferred",
    },
    user_utterance: { modality: "text", content: "有点累" },
    agent_response: { song_id: "t1", rationale: "接住" },
    user_reaction: {
      behavioral: {
        listen_duration_ms: 60000,
        completed: true,
        skipped: false,
        repeated: 0,
        volume_delta: 0,
      },
      silence_positive: true,
    },
    emotion_delta: { p: 0.1, a: 0.0, d: 0.0 },
  },
];

const fakeSoul: SoulState = {
  agent_id: "lyra_001",
  created_at: "2026-01-01",
  musical_taste_base: {
    aesthetic_axes: {
      restraint_vs_expression: 0.7,
      narrative_vs_atmospheric: 0.6,
      polished_vs_raw: -0.3,
      novelty_seeking: 0.5,
    },
    affinity_genres: ["post-rock", "ambient"],
    aversion_signals: [],
    backbone: "quiet and contemplative",
  },
  dynamic_mood: { current_pad: { p: 0, a: 0, d: 0 }, attention_to_user: 0.85, recent_bias: "" },
  shared_memory: [
    {
      timestamp: "2026-01-01T12:00:00Z",
      song_id: "t1",
      context: "rain",
      significance: "first song together",
    },
  ],
  evolution_log: [],
  proactive_budget: {
    daily_limit: 3,
    sulk_until: null,
    kind_budgets: { morning: 1, care: 1, anniversary: 1, share: 1, rhythm: 2 },
  },
};

const fakeFeatures = new Map([
  ["t1", { track_id: "t1", bpm: 72, energy: 0.3, valence: 0.4 }],
  ["t2", { track_id: "t2", bpm: 120, energy: 0.8, valence: 0.7 }],
]);

function makeMockCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    libraryRepo: {
      getTrack: vi.fn(async () => null),
      listAll: vi.fn(async () => []),
    },
    libraryFeaturesRepo: {
      getBatch: vi.fn(async () => fakeFeatures),
    },
    turnRepo: {
      listRecentTurns: vi.fn(async () => fakeTurns),
    },
    soulStore: {
      load: vi.fn(async () => fakeSoul),
    },
    clock: () => 12345,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// makeGetRecentPlaysTool
// ---------------------------------------------------------------------------

describe("makeGetRecentPlaysTool", () => {
  it("returns recent plays as JSON text on success", async () => {
    const ctx = makeMockCtx();
    const tool = makeGetRecentPlaysTool(ctx);
    const result = await tool.execute("tc1", { n: 5 });

    expect(result.isError).toBeFalsy();
    expect(result.content[0].type).toBe("text");
    const rows = JSON.parse(result.content[0].text);
    expect(Array.isArray(rows)).toBe(true);
    expect(rows[0].song_id).toBe("t1");
    expect(rows[0].emotion.labels).toContain("疲惫");
    expect(ctx.turnRepo.listRecentTurns).toHaveBeenCalledWith(5);
  });

  it("uses default n=5 when n is omitted", async () => {
    const ctx = makeMockCtx();
    const tool = makeGetRecentPlaysTool(ctx);
    await tool.execute("tc1", {});
    expect(ctx.turnRepo.listRecentTurns).toHaveBeenCalledWith(5);
  });

  it("returns isError:true when n > 20", async () => {
    const ctx = makeMockCtx();
    const tool = makeGetRecentPlaysTool(ctx);
    const result = await tool.execute("tc1", { n: 21 });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/Error/);
  });

  it("returns isError:true when n < 1", async () => {
    const ctx = makeMockCtx();
    const tool = makeGetRecentPlaysTool(ctx);
    const result = await tool.execute("tc1", { n: 0 });
    expect(result.isError).toBe(true);
  });

  it("returns isError:true (no throw) when turnRepo throws", async () => {
    const ctx = makeMockCtx({
      turnRepo: { listRecentTurns: vi.fn(async () => { throw new Error("db down"); }) },
    });
    const tool = makeGetRecentPlaysTool(ctx);
    const result = await tool.execute("tc1", { n: 3 });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("db down");
  });
});

// ---------------------------------------------------------------------------
// makeGetSoulFactsTool
// ---------------------------------------------------------------------------

describe("makeGetSoulFactsTool", () => {
  it("returns soul snapshot as JSON text on success", async () => {
    const ctx = makeMockCtx();
    const tool = makeGetSoulFactsTool(ctx);
    const result = await tool.execute("tc2", {});

    expect(result.isError).toBeFalsy();
    const snapshot = JSON.parse(result.content[0].text);
    expect(snapshot.backbone).toBe("quiet and contemplative");
    expect(snapshot.affinity_genres).toContain("post-rock");
    expect(snapshot.dynamic_mood.attention_to_user).toBe(0.85);
    expect(Array.isArray(snapshot.shared_memory_recent)).toBe(true);
    expect(snapshot.shared_memory_recent[0].song_id).toBe("t1");
  });

  it("shared_memory_recent is capped at 3 entries", async () => {
    const soulWithMany: SoulState = {
      ...fakeSoul,
      shared_memory: Array.from({ length: 10 }, (_, i) => ({
        timestamp: `2026-01-0${i + 1}T00:00:00Z`,
        song_id: `s${i}`,
        context: "ctx",
        significance: `sig${i}`,
      })),
    };
    const ctx = makeMockCtx({
      soulStore: { load: vi.fn(async () => soulWithMany) },
    });
    const tool = makeGetSoulFactsTool(ctx);
    const result = await tool.execute("tc2", {});
    const snapshot = JSON.parse(result.content[0].text);
    expect(snapshot.shared_memory_recent.length).toBeLessThanOrEqual(3);
  });

  it("returns isError:true (no throw) when soulStore throws", async () => {
    const ctx = makeMockCtx({
      soulStore: { load: vi.fn(async () => { throw new Error("soul corrupted"); }) },
    });
    const tool = makeGetSoulFactsTool(ctx);
    const result = await tool.execute("tc2", {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("soul corrupted");
  });
});

// ---------------------------------------------------------------------------
// makeGetSongFeaturesTool
// ---------------------------------------------------------------------------

describe("makeGetSongFeaturesTool", () => {
  it("returns bpm/energy/valence for valid ids", async () => {
    const ctx = makeMockCtx();
    const tool = makeGetSongFeaturesTool(ctx);
    const result = await tool.execute("tc3", { ids: ["t1", "t2"] });

    expect(result.isError).toBeFalsy();
    const features = JSON.parse(result.content[0].text);
    expect(features["t1"].bpm).toBe(72);
    expect(features["t1"].energy).toBe(0.3);
    expect(features["t2"].valence).toBe(0.7);
  });

  it("returns null for ids not found in the repo", async () => {
    const ctx = makeMockCtx({
      libraryFeaturesRepo: {
        getBatch: vi.fn(async () => new Map()),
      },
    });
    const tool = makeGetSongFeaturesTool(ctx);
    const result = await tool.execute("tc3", { ids: ["unknown-id"] });
    const features = JSON.parse(result.content[0].text);
    expect(features["unknown-id"]).toBeNull();
  });

  it("returns isError:true when ids.length > 10", async () => {
    const ctx = makeMockCtx();
    const tool = makeGetSongFeaturesTool(ctx);
    const result = await tool.execute("tc3", { ids: Array.from({ length: 11 }, (_, i) => `id${i}`) });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/Error/);
  });

  it("returns isError:true when ids is empty", async () => {
    const ctx = makeMockCtx();
    const tool = makeGetSongFeaturesTool(ctx);
    const result = await tool.execute("tc3", { ids: [] });
    expect(result.isError).toBe(true);
  });

  it("returns isError:true (no throw) when getBatch throws", async () => {
    const ctx = makeMockCtx({
      libraryFeaturesRepo: {
        getBatch: vi.fn(async () => { throw new Error("features db error"); }),
      },
    });
    const tool = makeGetSongFeaturesTool(ctx);
    const result = await tool.execute("tc3", { ids: ["t1"] });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("features db error");
  });
});

// ---------------------------------------------------------------------------
// makeAuxTools — convenience array builder
// ---------------------------------------------------------------------------

describe("makeAuxTools", () => {
  it("returns exactly 3 tools with correct names", () => {
    const ctx = makeMockCtx();
    const tools = makeAuxTools(ctx);
    expect(tools).toHaveLength(3);
    const names = tools.map((t) => t.name);
    expect(names).toContain("get_recent_plays");
    expect(names).toContain("get_soul_facts");
    expect(names).toContain("get_song_features");
  });
});
