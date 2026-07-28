import { describe, it, expect } from "vitest";
import { inferShift, getShiftConfidence, describeShift } from "./shiftLogic";

describe("shiftLogic", () => {
  describe("inferShift", () => {
    it("returns '接住' when user is low arousal + high hesitation + offline", () => {
      const shift = inferShift(
        { p: 0, a: -0.5, d: 0 }, // low arousal
        0.7, // high confidence
        true, // offline
        0.3, // moderate skip
        "many", // high hesitation
      );
      expect(shift).toBe("接住");
    });

    it("returns '接住' with low arousal + some hesitation + offline", () => {
      const shift = inferShift(
        { p: -0.2, a: -0.3, d: 0 },
        0.6,
        true,
        0.4,
        "some",
      );
      expect(shift).toBe("接住");
    });

    it("returns '点燃' when user has low arousal + high skip ratio", () => {
      const shift = inferShift(
        { p: -0.3, a: -0.2, d: 0 }, // low arousal
        0.5, // confidence
        false, // online
        0.6, // high skip ratio
        "none", // no hesitation
      );
      expect(shift).toBe("点燃");
    });

    it("returns '点燃' with very high skip ratio", () => {
      const shift = inferShift(
        { p: 0, a: -0.1, d: 0 },
        0.4,
        false,
        0.8, // very high skip
        "none",
      );
      expect(shift).toBe("点燃");
    });

    it("returns '打断' when user has high arousal + focus + low skip ratio", () => {
      const shift = inferShift(
        { p: 0.3, a: 0.5, d: 0 }, // high arousal
        0.6, // confidence
        false, // focused (not blurred)
        0.1, // low skip
        "none",
      );
      expect(shift).toBe("打断");
    });

    it("returns '打断' when user is in sustained high engagement", () => {
      const shift = inferShift(
        { p: 0.4, a: 0.6, d: 0.2 },
        0.7,
        false, // very focused
        0.05, // almost no skips
        "none",
      );
      expect(shift).toBe("打断");
    });

    it("returns '陪着' as default when no strong signal", () => {
      const shift = inferShift(
        { p: 0.1, a: 0, d: 0 }, // neutral
        0.3, // low confidence
        false,
        0.4, // moderate skip
        "none",
      );
      expect(shift).toBe("陪着");
    });

    it("returns '陪着' when conditions are mixed/neutral", () => {
      const shift = inferShift(
        { p: 0, a: 0.1, d: 0 }, // slightly positive arousal
        0.5,
        true,
        0.3,
        "some",
      );
      expect(shift).toBe("陪着");
    });

    it("prioritizes low arousal + high skip over offline signal", () => {
      // Even though offline, high arousal suppresses '接住'
      const shift = inferShift(
        { p: 0.2, a: -0.3, d: 0 }, // low arousal
        0.5,
        true, // online status doesn't matter here
        0.65, // strong skip signal
        "none", // no hesitation
      );
      expect(shift).toBe("点燃");
    });

    it("low confidence should not trigger strong shifts", () => {
      // Low confidence in PAD reading → default to '陪着'
      const shift = inferShift(
        { p: -0.5, a: -0.5, d: 0 },
        0.1, // very low confidence
        true,
        0.3,
        "none",
      );
      expect(shift).toBe("陪着");
    });
  });

  describe("getShiftConfidence", () => {
    it("returns high confidence for strong '接住' signals", () => {
      const conf = getShiftConfidence(
        { p: 0, a: -0.5, d: 0 },
        0.6,
        true,
        0.3,
        "many",
      );
      expect(conf).toBeGreaterThan(0.8);
      expect(conf).toBeLessThanOrEqual(1);
    });

    it("returns boosted confidence for high skip ratio '点燃'", () => {
      const conf = getShiftConfidence(
        { p: 0, a: -0.2, d: 0 },
        0.5,
        false,
        0.8, // very high skip
        "none",
      );
      expect(conf).toBeGreaterThan(0.7);
    });

    it("returns boosted confidence for sustained high arousal '打断'", () => {
      const conf = getShiftConfidence(
        { p: 0.2, a: 0.6, d: 0 },
        0.7,
        false,
        0.05, // almost no skips
        "none",
      );
      expect(conf).toBeGreaterThan(0.8);
    });

    it("returns low confidence for neutral signals", () => {
      const conf = getShiftConfidence(
        { p: 0, a: 0, d: 0 },
        0.3, // low PAD confidence
        false,
        0.4,
        "none",
      );
      expect(conf).toBeLessThan(0.5);
    });

    it("clamps confidence between 0 and 1", () => {
      const conf1 = getShiftConfidence(
        { p: 1, a: 1, d: 1 },
        1, // max everything
        false,
        0,
        "none",
      );
      expect(conf1).toBeLessThanOrEqual(1);

      const conf2 = getShiftConfidence(
        { p: -1, a: -1, d: -1 },
        0, // min everything
        true,
        1,
        "many",
      );
      expect(conf2).toBeGreaterThanOrEqual(0);
    });
  });

  describe("describeShift", () => {
    it("returns human-readable description", () => {
      const desc = describeShift("接住", 0.75);
      expect(desc).toContain("接住");
      expect(desc).toContain("75");
    });

    it("rounds confidence to nearest percent", () => {
      const desc1 = describeShift("点燃", 0.456);
      expect(desc1).toContain("46");

      const desc2 = describeShift("打断", 0.994);
      expect(desc2).toContain("99");
    });

    it("works for all shift types", () => {
      const shifts = ["接住", "点燃", "陪着", "打断"] as const;
      shifts.forEach((shift) => {
        const desc = describeShift(shift, 0.5);
        expect(desc).toContain(shift);
      });
    });
  });
});
