import { describe, expect, it, vi } from "vitest";
import { ShowAgent, type ShowBrief } from "./ShowAgent";
import type { ModelProvider } from "../types";

const brief: ShowBrief = {
  topic: "今晚的雨",
  guestName: "林",
  when: "周三 19:05",
  weather: "雨，14°C",
  emotionLabels: ["沉静"],
  pad: { p: -0.2, a: -0.3, d: 0.1 },
  livingPortrait: "她把旧歌听成时间锚点。",
  facts: [{ tags: ["雨天"], conclusion: "雨天偏慢歌" }],
  candidates: [
    { id: "a", title: "富士山下", artist: "陈奕迅", language: "yue", oneLiner: "窗上的水痕" },
    { id: "b", title: "明年今日", artist: "陈奕迅", language: "yue" },
  ],
};

function provider(content: string): ModelProvider {
  return {
    id: "deepseek",
    chat: vi.fn(async () => ({ content })),
  };
}

describe("ShowAgent", () => {
  it("asks for a two-host rundown and keeps only library songs", async () => {
    const p = provider(
      JSON.stringify({
        beats: [
          {
            song_id: "a",
            lines: [
              { speaker: "lyra", text: "雨还在，先听陈奕迅的富士山下。" },
              { speaker: "guest", text: "粤语，就这首。" },
            ],
          },
          {
            song_id: "nope",
            lines: [
              { speaker: "lyra", text: "库外。" },
              { speaker: "guest", text: "丢掉。" },
            ],
          },
        ],
      }),
    );
    const agent = new ShowAgent({ provider: p });
    const beats = await agent.write(brief);
    expect(beats.map((b) => b.song_id)).toEqual(["a"]);
    const messages = vi.mocked(p.chat).mock.calls[0][0];
    expect(messages[1].content).toContain("今晚的雨");
    expect(messages[1].content).toContain("雨，14°C");
    expect(messages[1].content).toContain("雨天偏慢歌");
    expect(messages[0].content).toContain("不要猜测用户在哪里");
    expect(messages[0].content).toContain("歌名或歌手");
    expect(messages[1].content).toContain("language=yue");
  });

  it("retries once when the first draft cites no playable song", async () => {
    const p = {
      id: "deepseek" as const,
      chat: vi
        .fn()
        .mockResolvedValueOnce({
          content: JSON.stringify({
            beats: [
              {
                song_id: "missing",
                lines: [
                  { speaker: "lyra", text: "空。" },
                  { speaker: "guest", text: "空。" },
                ],
              },
            ],
          }),
        })
        .mockResolvedValueOnce({
          content: JSON.stringify({
            beats: [
              {
                song_id: "b",
                lines: [
                  { speaker: "lyra", text: "换成明年今日。" },
                  { speaker: "guest", text: "陈奕迅这首可以。" },
                ],
              },
            ],
          }),
        }),
    };
    const beats = await new ShowAgent({ provider: p }).write(brief);
    expect(beats.map((b) => b.song_id)).toEqual(["b"]);
    expect(p.chat).toHaveBeenCalledTimes(2);
  });

  it("drops a Cantonese introduction of an English song and asks again", async () => {
    const p = {
      id: "deepseek" as const,
      chat: vi
        .fn()
        .mockResolvedValueOnce({
          content: JSON.stringify({
            beats: [
              {
                song_id: "a",
                lines: [
                  { speaker: "lyra", text: "你说她上次沉了很久才浮上来。" },
                  { speaker: "guest", text: "但这次她开口了，说想要粤语歌。" },
                ],
              },
            ],
          }),
        })
        .mockResolvedValueOnce({
          content: JSON.stringify({
            beats: [
              {
                song_id: "a",
                lines: [
                  { speaker: "lyra", text: "这次听陈奕迅的富士山下。" },
                  { speaker: "guest", text: "粤语，对得上。" },
                ],
              },
            ],
          }),
        }),
    };
    const beats = await new ShowAgent({ provider: p }).write(brief);
    expect(beats.map((beat) => beat.song_id)).toEqual(["a"]);
    expect(p.chat).toHaveBeenCalledTimes(2);
  });
});
