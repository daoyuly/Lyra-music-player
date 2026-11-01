import { describe, expect, it } from "vitest";
import { formatShowScript, groundBeats, validateRundown } from "./rundown";

const allowed = new Set(["a", "b", "c"]);

describe("validateRundown", () => {
  it("keeps beats whose song is in the library and both hosts speak", () => {
    const beats = validateRundown(
      {
        beats: [
          {
            song_id: "a",
            lines: [
              { speaker: "lyra", text: "雨还在下。" },
              { speaker: "guest", text: "那就从这首开始。" },
            ],
          },
        ],
      },
      allowed,
    );
    expect(beats).toEqual([
      {
        song_id: "a",
        lines: [
          { speaker: "lyra", text: "雨还在下。" },
          { speaker: "guest", text: "那就从这首开始。" },
        ],
      },
    ]);
  });

  it("drops beats that cite a song outside the candidate pool or repeat a song", () => {
    const beats = validateRundown(
      {
        beats: [
          {
            song_id: "missing",
            lines: [
              { speaker: "lyra", text: "没有这首。" },
              { speaker: "guest", text: "跳过。" },
            ],
          },
          {
            song_id: "a",
            lines: [
              { speaker: "lyra", text: "这首在。" },
              { speaker: "guest", text: "放吧。" },
            ],
          },
          {
            song_id: "a",
            lines: [
              { speaker: "lyra", text: "又是这首。" },
              { speaker: "guest", text: "算了。" },
            ],
          },
        ],
      },
      allowed,
    );
    expect(beats.map((b) => b.song_id)).toEqual(["a"]);
  });

  it("drops a beat when only one host speaks", () => {
    expect(
      validateRundown(
        {
          beats: [
            {
              song_id: "b",
              lines: [{ speaker: "lyra", text: "只有我一个人。" }],
            },
          ],
        },
        allowed,
      ),
    ).toEqual([]);
  });
});

describe("formatShowScript", () => {
  it("names Lyra and the guest on separate lines", () => {
    expect(
      formatShowScript(
        [
          { speaker: "lyra", text: "雨还在下。" },
          { speaker: "guest", text: "那就从这首开始。" },
        ],
        "阿禾",
      ),
    ).toBe("Lyra  雨还在下。\n阿禾  那就从这首开始。");
  });
});

describe("groundBeats", () => {
  it("drops an English song introduced as Cantonese", () => {
    const beats = groundBeats(
      [
        {
          song_id: "en",
          lines: [
            { speaker: "lyra", text: "你说她上次沉了很久才浮上来。" },
            { speaker: "guest", text: "但这次她开口了，说想要粤语歌。" },
          ],
        },
      ],
      [{ id: "en", title: "Holocene", artist: "Bon Iver", language: "en" }],
    );
    expect(beats).toEqual([]);
  });

  it("keeps a beat that names the song it will play", () => {
    const beats = groundBeats(
      [
        {
          song_id: "y",
          lines: [
            { speaker: "lyra", text: "这次用陈奕迅的富士山下接上。" },
            { speaker: "guest", text: "粤语歌，就这首。" },
          ],
        },
      ],
      [{ id: "y", title: "富士山下", artist: "陈奕迅", language: "yue" }],
    );
    expect(beats.map((beat) => beat.song_id)).toEqual(["y"]);
  });
});
