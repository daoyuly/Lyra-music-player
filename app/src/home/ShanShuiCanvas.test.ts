import { describe, expect, it } from "vitest";
import { motionFromSpectrum } from "./ShanShuiCanvas";

const still = { low: 0, mid: 0, high: 0, pulse: 0 };

describe("motionFromSpectrum", () => {
  it("keeps the room's own pace when nothing is playing", () => {
    expect(motionFromSpectrum(false, { low: 1, mid: 1, high: 1, pulse: 1 })).toEqual({
      amp: 1,
      speed: 1,
      air: 1,
      pulse: 0,
    });
  });

  it("lets bass lift the water and mids carry the tempo", () => {
    const quiet = motionFromSpectrum(true, still);
    const loud = motionFromSpectrum(true, { low: 1, mid: 1, high: 1, pulse: 0.8 });
    expect(loud.amp).toBeGreaterThan(quiet.amp);
    expect(loud.speed).toBeGreaterThan(quiet.speed);
    expect(loud.air).toBeGreaterThan(quiet.air);
    expect(loud.pulse).toBeCloseTo(0.8);
  });

  it("ignores a band that is not a number", () => {
    const motion = motionFromSpectrum(true, {
      low: Number.NaN,
      mid: 0.5,
      high: 2,
      pulse: -1,
    });
    expect(motion.amp).toBeCloseTo(1.15);
    expect(motion.speed).toBeGreaterThan(0.8);
    expect(motion.air).toBeCloseTo(3.65);
    expect(motion.pulse).toBe(0);
  });
});
