import { describe, it, expect } from "vitest";
import { scoreTrackForShift, rankByShift, explainScore } from "./shiftRanker";
import type { LibraryTrack, PAD } from "../types";

// Helper to create test tracks
function makeTrack(id: string, meta: Record<string, unknown> = {}): LibraryTrack {
  return {
    id,
    path: `/music/${id}.mp3`,
    origin: "local",
    title: `Song ${id}`,
    added_at: Date.now(),
    metadata: meta,
  };
}

describe("shiftRanker", () => {
  describe("scoreTrackForShift", () => {
    const neutralPad: PAD = { p: 0, a: 0, d: 0 };
    const lowArousalPad: PAD = { p: -0.2, a: -0.3, d: 0 };
    const highArousalPad: PAD = { p: 0.3, a: 0.5, d: 0 };

    it("scores slow, calm tracks high for '接住' shift", () => {
      const track = makeTrack("slow-piano", {
        bpm: 60,
        mood: "calm",
        genre: "piano",
      });
      const score = scoreTrackForShift(track, "接住", neutralPad);
      expect(score).toBeGreaterThan(70);
    });

    it("scores fast, energetic tracks low for '接住' shift", () => {
      const track = makeTrack("fast-rock", {
        bpm: 160,
        mood: "aggressive",
        genre: "rock",
      });
      const score = scoreTrackForShift(track, "接住", neutralPad);
      expect(score).toBeLessThan(50);
    });

    it("scores fast, energetic tracks high for '点燃' shift", () => {
      const track = makeTrack("energetic-pop", {
        bpm: 140,
        mood: "energetic",
        genre: "pop",
        tags: ["uplifting"],
      });
      const score = scoreTrackForShift(track, "点燃", neutralPad);
      expect(score).toBeGreaterThan(70);
    });

    it("scores slow, sad tracks low for '点燃' shift", () => {
      const track = makeTrack("sad-ballad", {
        bpm: 70,
        mood: "melancholic",
        genre: "ballad",
      });
      const score = scoreTrackForShift(track, "点燃", neutralPad);
      expect(score).toBeLessThan(50);
    });

    it("scores medium-tempo, neutral tracks high for '陪着' shift", () => {
      const track = makeTrack("indie-song", {
        bpm: 110,
        mood: "neutral",
        genre: "indie",
      });
      const score = scoreTrackForShift(track, "陪着", neutralPad);
      expect(score).toBeGreaterThan(60);
    });

    it("scores experimental tracks high for '打断' shift", () => {
      const track = makeTrack("experimental", {
        bpm: 120,
        mood: "experimental",
        genre: "experimental",
        tags: ["unconventional"],
      });
      const score = scoreTrackForShift(track, "打断", neutralPad);
      expect(score).toBeGreaterThan(60);
    });

    it("considers PAD context for '打断' shift", () => {
      const slowPadTrack = makeTrack("energetic-pop", {
        bpm: 130,
        mood: "energetic",
      });
      // Low arousal user → energetic song is good contrast
      const lowArousalScore = scoreTrackForShift(slowPadTrack, "打断", lowArousalPad);
      // High arousal user → energetic song is less contrasting
      const highArousalScore = scoreTrackForShift(slowPadTrack, "打断", highArousalPad);
      expect(lowArousalScore).toBeGreaterThan(highArousalScore);
    });

    it("returns score in range [0, 100]", () => {
      const extremeMeta = {
        bpm: 1000, // unrealistic
        mood: "unknown",
        genre: "unknown",
      };
      const track = makeTrack("extreme", extremeMeta);
      const score = scoreTrackForShift(track, "陪着", neutralPad);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    });

    it("handles missing metadata gracefully", () => {
      const track = makeTrack("minimal");
      expect(() => scoreTrackForShift(track, "接住", neutralPad)).not.toThrow();
      const score = scoreTrackForShift(track, "接住", neutralPad);
      expect(typeof score).toBe("number");
    });
  });

  describe("rankByShift", () => {
    const neutralPad: PAD = { p: 0, a: 0, d: 0 };

    it("ranks '接住' candidates with slow songs first", () => {
      const slow = makeTrack("slow", { bpm: 60, mood: "calm" });
      const fast = makeTrack("fast", { bpm: 150, mood: "energetic" });
      const candidates = [fast, slow]; // Unsorted input

      const ranked = rankByShift(candidates, "接住", neutralPad);
      expect(ranked[0].id).toBe("slow");
      expect(ranked[1].id).toBe("fast");
    });

    it("ranks '点燃' candidates with fast songs first", () => {
      const slow = makeTrack("slow", { bpm: 60 });
      const fast = makeTrack("fast", { bpm: 150, mood: "energetic" });
      const candidates = [slow, fast];

      const ranked = rankByShift(candidates, "点燃", neutralPad);
      expect(ranked[0].id).toBe("fast");
      expect(ranked[1].id).toBe("slow");
    });

    it("ranks '陪着' candidates with medium-tempo songs first", () => {
      const slow = makeTrack("slow", { bpm: 60 });
      const medium = makeTrack("medium", { bpm: 110, genre: "indie" });
      const fast = makeTrack("fast", { bpm: 150 });
      const candidates = [fast, slow, medium];

      const ranked = rankByShift(candidates, "陪着", neutralPad);
      expect(ranked[0].id).toBe("medium");
    });

    it("preserves all candidates in output", () => {
      const candidates = [
        makeTrack("a", { bpm: 80 }),
        makeTrack("b", { bpm: 120 }),
        makeTrack("c", { bpm: 140 }),
      ];

      const ranked = rankByShift(candidates, "点燃", neutralPad);
      expect(ranked).toHaveLength(3);
      expect(ranked.map((t) => t.id).sort()).toEqual(["a", "b", "c"]);
    });

    it("handles empty candidates list", () => {
      const ranked = rankByShift([], "接住", neutralPad);
      expect(ranked).toHaveLength(0);
    });
  });

  describe("explainScore", () => {
    it("returns human-readable explanation", () => {
      const track = makeTrack("test", { bpm: 100, mood: "calm" });
      const explanation = explainScore(track, "接住", { p: 0, a: 0, d: 0 });

      expect(explanation).toContain("test");
      expect(explanation).toContain("接住");
      expect(explanation).toContain("bpm");
      expect(explanation).toContain("mood");
    });

    it("includes score in explanation", () => {
      const track = makeTrack("test", { bpm: 60, mood: "calm" });
      const explanation = explainScore(track, "接住", { p: 0, a: 0, d: 0 });
      expect(explanation).toMatch(/\d+\/100/);
    });

    it("works with missing metadata", () => {
      const track = makeTrack("minimal");
      const explanation = explainScore(track, "陪着", { p: 0, a: 0, d: 0 });
      expect(explanation).toContain("minimal");
      expect(explanation).toContain("?"); // Unknown values
    });
  });
});
