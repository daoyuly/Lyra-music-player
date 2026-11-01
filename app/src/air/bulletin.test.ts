import { describe, expect, it } from "vitest";
import {
  chimeBulletin,
  newsBulletin,
  reflectSpoken,
  taskBulletin,
  weeklySpoken,
} from "./bulletin";

describe("reflectSpoken", () => {
  it("reads the dream's first sentence", () => {
    expect(reflectSpoken("昨夜我看见她坐在窗边，窗外下着雨。后面还有一句。", 0)).toBe(
      "昨夜我看见她坐在窗边，窗外下着雨。",
    );
  });

  it("counts new facts when the dream is empty", () => {
    expect(reflectSpoken("  ", 3)).toBe("夜里记下了3件新的事。");
  });

  it("says so when the night added nothing", () => {
    expect(reflectSpoken("", 0)).toBe("夜里看过了，没有新的要记。");
  });
});

describe("weeklySpoken", () => {
  it("stays quiet when the letter is turned off", () => {
    expect(weeklySpoken({ skipped: true, reason: "auto_disabled" })).toBeNull();
  });

  it("says the week was too thin to write", () => {
    expect(weeklySpoken({ skipped: true, reason: "sparse_week" })).toBe(
      "这周听得少，信先不写。",
    );
  });

  it("reads the letter's greeting", () => {
    expect(weeklySpoken({ skipped: false, greeting: "这周你常在雨里听歌。后面是正文。" })).toBe(
      "这周你常在雨里听歌。",
    );
  });
});

describe("bulletins", () => {
  it("wraps a task result as one line from Lyra", () => {
    expect(taskBulletin("夜里记下了两件新的事。")).toEqual({
      occasion: "task",
      lines: [{ role: "lyra", text: "夜里记下了两件新的事。" }],
    });
  });

  it("drops an empty task result", () => {
    expect(taskBulletin("   ")).toBeNull();
  });

  it("names the hour", () => {
    expect(chimeBulletin(new Date(2026, 6, 7, 8, 0, 0))).toEqual({
      occasion: "chime",
      lines: [{ role: "lyra", text: "现在是八点整。" }],
    });
    expect(chimeBulletin(new Date(2026, 6, 7, 2, 0, 0)).lines[0].text).toBe(
      "现在是两点整。",
    );
    expect(chimeBulletin(new Date(2026, 6, 7, 0, 0, 0)).lines[0].text).toBe(
      "现在是零点整。",
    );
  });

  it("reads collected headlines in one breath", () => {
    expect(newsBulletin(["  ", "城南的雨停了。", "港口有雾"])).toEqual({
      occasion: "news",
      lines: [{ role: "lyra", text: "这几条刚收集到。城南的雨停了。港口有雾。" }],
    });
  });

  it("says a single headline without the stack phrase", () => {
    expect(newsBulletin(["只有这一条"])).toEqual({
      occasion: "news",
      lines: [{ role: "lyra", text: "只有这一条。" }],
    });
  });

  it("says nothing when nothing was collected", () => {
    expect(newsBulletin(["", "  "])).toBeNull();
  });
});
