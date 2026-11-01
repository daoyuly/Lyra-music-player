import { describe, expect, it } from "vitest";
import { describeWeather, formatShowClock } from "./context";

describe("formatShowClock", () => {
  it("formats a local weekday and time", () => {
    expect(formatShowClock(new Date(2026, 9, 28, 19, 5))).toBe("周三 19:05");
  });
});

describe("describeWeather", () => {
  it("names the sky and rounds the temperature", () => {
    expect(describeWeather(61, 14.4)).toBe("雨，14°C");
    expect(describeWeather(0, 26.6)).toBe("晴，27°C");
  });
});
