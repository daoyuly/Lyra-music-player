import { describe, expect, it, vi } from "vitest";
import { BoundaryAgent, assignShowTones } from "./BoundaryAgent";
import type { ShowBeat } from "./rundown";
import type { ShowCandidate } from "./ShowAgent";
import type { ModelProvider } from "../types";

const songs: ShowCandidate[] = [
  {
    id: "a",
    title: "富士山下",
    artist: "陈奕迅",
    language: "yue",
    oneLiner: "窗上的水痕还没干",
    mood: ["离别"],
    scenes: ["雨夜"],
  },
  {
    id: "b",
    title: "明年今日",
    artist: "陈奕迅",
    language: "yue",
    oneLiner: "同一天再听一次",
  },
];

const draft: ShowBeat[] = [
  {
    song_id: "a",
    lines: [
      { speaker: "lyra", text: "先放陈奕迅的富士山下。" },
      { speaker: "guest", text: "好。" },
    ],
  },
  {
    song_id: "b",
    lines: [
      { speaker: "lyra", text: "接着是明年今日。" },
      { speaker: "guest", text: "陈奕迅。" },
    ],
  },
];

describe("assignShowTones", () => {
  it("cycles 欢快, 幽默, 悲伤, and continues from an offset", () => {
    expect(assignShowTones(4)).toEqual(["欢快", "幽默", "悲伤", "欢快"]);
    expect(assignShowTones(2, 2)).toEqual(["悲伤", "欢快"]);
  });
});

describe("BoundaryAgent", () => {
  it("rewrites lines from the song detail and the assigned color", async () => {
    const chat = vi.fn(async () => ({
      content: JSON.stringify({
        beats: [
          {
            song_id: "a",
            lines: [
              { speaker: "lyra", text: "窗上的水痕还没干，陈奕迅这首富士山下先放。" },
              { speaker: "guest", text: "雨夜听这个，人会安静下来。" },
            ],
          },
          {
            song_id: "b",
            lines: [
              { speaker: "lyra", text: "明年今日，陈奕迅把同一天又唱了一遍。" },
              { speaker: "guest", text: "你听，他像在跟去年的自己开玩笑。" },
            ],
          },
        ],
      }),
    }));
    const agent = new BoundaryAgent({ provider: { id: "deepseek", chat } as ModelProvider });
    const beats = await agent.color({ topic: "今晚的雨", beats: draft, songs });
    expect(beats[0].lines[0].text).toContain("水痕");
    expect(beats[1].lines[1].text).toContain("开玩笑");
    const prompt = String(chat.mock.calls[0][0][1].content);
    expect(prompt).toContain("颜色: 欢快");
    expect(prompt).toContain("颜色: 幽默");
    expect(prompt).toContain("窗上的水痕还没干");
    expect(prompt).toContain("雨夜");
    expect(chat.mock.calls[0][1]).toMatchObject({ agent: "boundary" });
  });

  it("keeps the draft when the rewrite no longer names the song", async () => {
    const chat = vi.fn(async () => ({
      content: JSON.stringify({
        beats: [
          {
            song_id: "a",
            lines: [
              { speaker: "lyra", text: "这首真好听。" },
              { speaker: "guest", text: "是挺好听。" },
            ],
          },
        ],
      }),
    }));
    const agent = new BoundaryAgent({ provider: { id: "deepseek", chat } as ModelProvider });
    const beats = await agent.color({
      topic: "今晚的雨",
      beats: [draft[0]],
      songs,
    });
    expect(beats[0].lines[0].text).toBe("先放陈奕迅的富士山下。");
  });
});
