import { describe, it, expect, vi } from "vitest";
import { DjAgent } from "./DjAgent";
import type { ModelProvider } from "../types";

describe("DjAgent.annotate", () => {
  it("parses structured DJ profile from provider JSON", async () => {
    const provider: ModelProvider = {
      id: "zhipu",
      chat: vi.fn(async () => ({
        content: JSON.stringify({
          language: "yue",
          genres: ["粤语流行", "ballad"],
          mood: ["温柔"],
          scenes: ["深夜"],
          era: "90s",
          vocal: "male",
          energy_check: "low",
          one_liner: "凌晨三点的计程车窗,雨丝贴着玻璃。",
        }),
        usage: { input_tokens: 1, output_tokens: 1 },
      })),
    };
    const agent = new DjAgent({ provider });
    const profile = await agent.annotate({
      track: {
        id: "t1",
        title: "富士山下",
        artist: "陈奕迅",
        album: null as unknown as string,
        path: "/a.mp3",
      },
    });
    expect(profile.language).toBe("yue");
    expect(profile.genres).toContain("粤语流行");
    expect(profile.one_liner).toContain("计程车");
    expect(profile.model).toBe("dj-v1");
    expect(profile.track_id).toBe("t1");
  });

  it("falls back to safe defaults on bad JSON", async () => {
    const provider: ModelProvider = {
      id: "zhipu",
      chat: vi.fn(async () => ({
        content: "not-json",
        usage: { input_tokens: 1, output_tokens: 1 },
      })),
    };
    const agent = new DjAgent({ provider });
    const profile = await agent.annotate({
      track: { id: "t2", title: "X", artist: "Y", path: "/b.mp3" },
    });
    expect(profile.language).toBe("other");
    expect(profile.track_id).toBe("t2");
    expect(profile.one_liner.length).toBeGreaterThan(0);
  });
});
