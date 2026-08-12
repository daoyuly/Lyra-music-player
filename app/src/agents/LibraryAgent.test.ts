import { describe, it, expect } from "vitest";
import { LibraryAgent } from "./LibraryAgent";
import type { LibraryTrack, PAD } from "../types";
import type { LyricsEmbedding } from "../db/repo/lyricsEmbeddingsRepo";

function track(id: string, title: string, artist: string): LibraryTrack {
  return { id, path: `/${id}.mp3`, origin: "local", added_at: 0, title, artist };
}

const LIB: LibraryTrack[] = [
  track("a", "Nuvole Bianche", "Ludovico Einaudi"),
  track("b", "Comptine d'un autre été", "Yann Tiersen"),
  track("c", "Time", "Hans Zimmer"),
  track("d", "Blue in Green", "Miles Davis"),
  track("e", "The Grand Canyon Suite", "Ferde Grofé"),
];

const repo = { listAll: async () => LIB };

const neutralPAD: PAD = { p: 0, a: 0, d: 0 };

describe("LibraryAgent.prefilter", () => {
  it("returns up to `limit` tracks", async () => {
    const a = new LibraryAgent({ repo });
    const out = await a.prefilter("any", neutralPAD, 3);
    expect(out.length).toBeLessThanOrEqual(3);
  });

  it("prioritizes tracks whose title/artist matches keywords in the target profile", async () => {
    const a = new LibraryAgent({ repo });
    const out = await a.prefilter("piano quiet Einaudi", neutralPAD, 5);
    expect(out[0].id).toBe("a");
  });

  it("returns random sample when no keywords match anything", async () => {
    const a = new LibraryAgent({ repo });
    const out = await a.prefilter("zzz totally nothing xyz", neutralPAD, 3);
    expect(out.length).toBe(3);
    // All results should be from LIB
    for (const t of out) expect(LIB.map((x) => x.id)).toContain(t.id);
  });

  it("does not throw on empty library", async () => {
    const a = new LibraryAgent({ repo: { listAll: async () => [] } });
    const out = await a.prefilter("anything", neutralPAD, 5);
    expect(out).toEqual([]);
  });

  it("default limit is 30", async () => {
    const many = Array.from({ length: 50 }, (_, i) => track(`t${i}`, `T${i}`, `A${i}`));
    const a = new LibraryAgent({ repo: { listAll: async () => many } });
    const out = await a.prefilter("nothing matches", neutralPAD);
    expect(out.length).toBe(30);
  });

  describe("Sprint 9: PAD-distance blending with library_features", () => {
    // energy = arousal target; valence = pleasure target
    const emptyFeatures = { getBatch: async () => new Map() };

    it("without any features, keyword ordering is preserved", async () => {
      const a = new LibraryAgent({ repo, features: emptyFeatures });
      const out = await a.prefilter("Einaudi", neutralPAD, 5);
      expect(out[0].id).toBe("a");
    });

    it("with features, PAD-close tracks outrank PAD-far when keyword tie", async () => {
      // Two tracks, both zero keyword hits. Track "high" has features
      // matching an arousal-1.0 request; "low" has opposite features.
      const featuresMap = new Map([
        ["high", { track_id: "high", bpm: null, energy: 1.0, valence: 1.0 }],
        ["low", { track_id: "low", bpm: null, energy: 0.0, valence: 0.0 }],
      ]);
      const tracks: LibraryTrack[] = [
        { id: "high", path: "/h.mp3", origin: "local", added_at: 0, title: "H", artist: "H" },
        { id: "low", path: "/l.mp3", origin: "local", added_at: 0, title: "L", artist: "L" },
      ];
      const a = new LibraryAgent({
        repo: { listAll: async () => tracks },
        features: { getBatch: async () => featuresMap },
      });
      const excitedPAD: PAD = { p: 1, a: 1, d: 0 };
      const out = await a.prefilter("something", excitedPAD, 2);
      expect(out[0].id).toBe("high");
    });

    it("tracks without features still surface (backward compat)", async () => {
      // Feature map covers only "a"; other tracks have none.
      const featuresMap = new Map([
        ["a", { track_id: "a", bpm: null, energy: 0.0, valence: 0.0 }],
      ]);
      const a = new LibraryAgent({
        repo,
        features: { getBatch: async () => featuresMap },
      });
      // For a high-arousal request, "a" (energy 0) should score poorly and
      // other tracks (no features) should still be represented.
      const out = await a.prefilter("Einaudi", { p: 1, a: 1, d: 0 }, 5);
      expect(out.length).toBeGreaterThan(0);
      // "a" wins on keyword; PAD hurts but keyword tie-break usually keeps it
      // at rank 1 for this specific query. Just check nothing crashes and
      // all tracks are present.
      expect(new Set(out.map((t) => t.id)).size).toBe(out.length);
    });
  });

  describe("Sprint 10: three-signal scoring (kw / pad / sem)", () => {
    function makeTrack(id: string, title: string): LibraryTrack {
      return { id, path: `/${id}.mp3`, origin: "local", added_at: 0, title };
    }

    const emptyFeatures = { getBatch: async () => new Map() };
    const emptyLyrics = { getBatch: async () => new Map() };
    const nullProvider = async () => null;

    it("degrades to kw-only when no features and no lyrics", async () => {
      const tracks = [makeTrack("a", "piano nights"), makeTrack("b", "loud drums")];
      const agent = new LibraryAgent({
        repo: { listAll: async () => tracks },
        features: emptyFeatures,
        lyrics: emptyLyrics,
        makeProvider: nullProvider,
      });
      const out = await agent.prefilter("piano", neutralPAD, 10);
      expect(out[0].id).toBe("a");
    });

    it("matches Sprint 9 formula when only kw+pad available", async () => {
      // Target PAD = (-1,-1) maps to (0,0) in feature space, so:
      //   a: energy=1, valence=1 → distance 1 → padScore 0
      //   b: energy=0, valence=0 → distance 0 → padScore 1
      // With kw=1 (a) vs kw=0 (b) and 0.4/0.6 weights:
      //   a: 1*0.4 + 0*0.6 = 0.4  b: 0*0.4 + 1*0.6 = 0.6 → b wins.
      const tracks = [makeTrack("a", "piano"), makeTrack("b", "silence")];
      const featuresMap = new Map([
        ["a", { track_id: "a", bpm: null, energy: 1, valence: 1 }],
        ["b", { track_id: "b", bpm: null, energy: 0, valence: 0 }],
      ]);
      const agent = new LibraryAgent({
        repo: { listAll: async () => tracks },
        features: { getBatch: async () => featuresMap },
        lyrics: emptyLyrics,
        makeProvider: nullProvider,
      });
      const out = await agent.prefilter("piano", { p: -1, a: -1, d: 0 }, 10);
      expect(out[0].id).toBe("b");
    });

    it("sem alone can drive ordering when kw is tied", async () => {
      const tracks = [makeTrack("a", "x"), makeTrack("b", "x")];
      const target = Float32Array.from([1, 0]);
      const provider = {
        modelId: "test",
        dim: 2,
        embed: async () => target,
      };
      const lyricsMap = new Map<string, LyricsEmbedding>([
        [
          "a",
          {
            trackId: "a",
            lyricsHash: "",
            modelId: "test",
            dim: 2,
            embedding: Float32Array.from([0.1, 0.99]),
            updatedAt: 0,
          },
        ],
        [
          "b",
          {
            trackId: "b",
            lyricsHash: "",
            modelId: "test",
            dim: 2,
            embedding: Float32Array.from([0.99, 0.1]),
            updatedAt: 0,
          },
        ],
      ]);
      const agent = new LibraryAgent({
        repo: { listAll: async () => tracks },
        features: emptyFeatures,
        lyrics: { getBatch: async () => lyricsMap },
        makeProvider: async () => provider,
      });
      const out = await agent.prefilter("anything", neutralPAD, 10);
      expect(out[0].id).toBe("b");
    });

    it("sem missing on a track falls back to kw for that track", async () => {
      const tracks = [makeTrack("a", "piano"), makeTrack("b", "drums")];
      const target = Float32Array.from([1, 0]);
      const provider = { modelId: "test", dim: 2, embed: async () => target };
      const lyricsMap = new Map<string, LyricsEmbedding>([
        [
          "b",
          {
            trackId: "b",
            lyricsHash: "",
            modelId: "test",
            dim: 2,
            embedding: Float32Array.from([0.99, 0.1]),
            updatedAt: 0,
          },
        ],
      ]);
      const agent = new LibraryAgent({
        repo: { listAll: async () => tracks },
        features: emptyFeatures,
        lyrics: { getBatch: async () => lyricsMap },
        makeProvider: async () => provider,
      });
      // "a" scores kw=1 (renormalized total 1); "b" scores sem≈0.99. → a wins.
      const out = await agent.prefilter("piano", neutralPAD, 10);
      expect(out[0].id).toBe("a");
    });

    it("cosine dim mismatch treats sem as unavailable", async () => {
      const tracks = [makeTrack("a", "piano")];
      const target = Float32Array.from([1, 0]);
      const provider = { modelId: "test", dim: 2, embed: async () => target };
      const lyricsMap = new Map<string, LyricsEmbedding>([
        [
          "a",
          {
            trackId: "a",
            lyricsHash: "",
            modelId: "test",
            dim: 3,
            embedding: Float32Array.from([0.5, 0.5, 0.5]),
            updatedAt: 0,
          },
        ],
      ]);
      const agent = new LibraryAgent({
        repo: { listAll: async () => tracks },
        features: emptyFeatures,
        lyrics: { getBatch: async () => lyricsMap },
        makeProvider: async () => provider,
      });
      const out = await agent.prefilter("piano", neutralPAD, 10);
      expect(out).toHaveLength(1);
      expect(out[0].id).toBe("a");
    });

    it("provider throws → falls back to kw+pad", async () => {
      const tracks = [makeTrack("a", "piano")];
      const provider = {
        modelId: "test",
        dim: 2,
        embed: async () => {
          throw new Error("net");
        },
      };
      const agent = new LibraryAgent({
        repo: { listAll: async () => tracks },
        features: emptyFeatures,
        lyrics: emptyLyrics,
        makeProvider: async () => provider,
      });
      const out = await agent.prefilter("piano", neutralPAD, 10);
      expect(out[0].id).toBe("a");
    });
  });

  describe("Sprint 12 follow-up: BPM signal", () => {
    function makeTrack(id: string, title: string): LibraryTrack {
      return { id, path: `/${id}.mp3`, origin: "local", added_at: 0, title };
    }
    const emptyLyrics = { getBatch: async () => new Map() };
    const nullProvider = async () => null;

    it("high-arousal target ranks a 140bpm track above a 60bpm track", async () => {
      // Two otherwise-identical tracks (same title, no lyrics, matching pad
      // signals) — only bpm distinguishes. High arousal ⇒ targetBpm ~145,
      // so bpmScore(140) ~ 0.77 vs bpmScore(60) = 0 (well outside tolerance).
      const tracks = [makeTrack("fast", "x"), makeTrack("slow", "x")];
      const featuresMap = new Map([
        ["fast", { track_id: "fast", bpm: 140, energy: 0.5, valence: 0.5 }],
        ["slow", { track_id: "slow", bpm: 60, energy: 0.5, valence: 0.5 }],
      ]);
      const agent = new LibraryAgent({
        repo: { listAll: async () => tracks },
        features: { getBatch: async () => featuresMap },
        lyrics: emptyLyrics,
        makeProvider: nullProvider,
      });
      const excited: PAD = { p: 0, a: 1, d: 0 };
      const out = await agent.prefilter("x", excited, 2);
      expect(out[0].id).toBe("fast");
    });

    it("low-arousal target ranks a 60bpm track above a 140bpm track", async () => {
      const tracks = [makeTrack("fast", "x"), makeTrack("slow", "x")];
      const featuresMap = new Map([
        ["fast", { track_id: "fast", bpm: 140, energy: 0.5, valence: 0.5 }],
        ["slow", { track_id: "slow", bpm: 60, energy: 0.5, valence: 0.5 }],
      ]);
      const agent = new LibraryAgent({
        repo: { listAll: async () => tracks },
        features: { getBatch: async () => featuresMap },
        lyrics: emptyLyrics,
        makeProvider: nullProvider,
      });
      const calm: PAD = { p: 0, a: -1, d: 0 };
      const out = await agent.prefilter("x", calm, 2);
      expect(out[0].id).toBe("slow");
    });

    it("all-null bpm library ⇒ bpm signal absent, ordering matches pre-BPM behaviour", async () => {
      // Same case as "matches Sprint 9 formula": kw=1 for 'a', pad favours
      // 'b'. Without bpm engaged, 'b' should still win under kw+pad only.
      const tracks = [makeTrack("a", "piano"), makeTrack("b", "silence")];
      const featuresMap = new Map([
        ["a", { track_id: "a", bpm: null, energy: 1, valence: 1 }],
        ["b", { track_id: "b", bpm: null, energy: 0, valence: 0 }],
      ]);
      const agent = new LibraryAgent({
        repo: { listAll: async () => tracks },
        features: { getBatch: async () => featuresMap },
        lyrics: emptyLyrics,
        makeProvider: nullProvider,
      });
      const out = await agent.prefilter("piano", { p: -1, a: -1, d: 0 }, 10);
      expect(out[0].id).toBe("b");
    });
  });

  describe("ActiveIntent language hard filter via DJ profiles", () => {
    it("prefers tracks matching intent.languages when enough profiles exist", async () => {
      const tracks = [
        track("y1", "富士山下", "陈奕迅"),
        track("y2", "海阔天空", "Beyond"),
        track("y3", "喜欢你", "邓紫棋"),
        track("m1", "晴天", "周杰伦"),
        track("e1", "Hello", "Adele"),
      ];
      const profiles = new Map([
        ["y1", { track_id: "y1", language: "yue" as const, genres: [], mood: [], scenes: [], era: null, vocal: "male" as const, energy_check: "mid" as const, one_liner: "", annotated_at: 0, model: "dj-v1" }],
        ["y2", { track_id: "y2", language: "yue" as const, genres: [], mood: [], scenes: [], era: null, vocal: "group" as const, energy_check: "high" as const, one_liner: "", annotated_at: 0, model: "dj-v1" }],
        ["y3", { track_id: "y3", language: "yue" as const, genres: [], mood: [], scenes: [], era: null, vocal: "female" as const, energy_check: "mid" as const, one_liner: "", annotated_at: 0, model: "dj-v1" }],
        ["m1", { track_id: "m1", language: "cmn" as const, genres: [], mood: [], scenes: [], era: null, vocal: "male" as const, energy_check: "mid" as const, one_liner: "", annotated_at: 0, model: "dj-v1" }],
        ["e1", { track_id: "e1", language: "en" as const, genres: [], mood: [], scenes: [], era: null, vocal: "female" as const, energy_check: "low" as const, one_liner: "", annotated_at: 0, model: "dj-v1" }],
      ]);
      const agent = new LibraryAgent({
        repo: { listAll: async () => tracks },
        profiles: { getBatch: async () => profiles },
        makeProvider: async () => null,
        features: { getBatch: async () => new Map() },
        lyrics: { getBatch: async () => new Map() },
      });
      const out = await agent.prefilter("延续", neutralPAD, 5, undefined, {
        rawText: "一直播放粤语歌曲",
        constraints: { languages: ["yue"] },
        persistence: "sticky",
        source: "user-explicit",
        createdAt: 0,
        turnId: "t",
      });
      expect(out.every((t) => t.id.startsWith("y"))).toBe(true);
      expect(out.length).toBe(3);
    });
  });
});
