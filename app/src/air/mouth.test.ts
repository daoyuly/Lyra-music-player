import { describe, expect, it } from "vitest";
import { createSpeechMouth } from "./mouth";
import { createBroadcaster, bulletinSpeech } from "./broadcast";
import { taskBulletin } from "./bulletin";
import { createShowVoice, LYRA_VOICE } from "../show/voices";

function gate() {
  let open: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open: () => open() };
}

describe("bulletinSpeech", () => {
  it("maps Lyra onto her voice", () => {
    const bulletin = taskBulletin("夜里看过了，没有新的要记。");
    expect(bulletinSpeech(bulletin!)).toEqual([
      { voice: LYRA_VOICE, text: "夜里看过了，没有新的要记。" },
    ]);
  });
});

describe("createSpeechMouth", () => {
  it("lets a show finish before a bulletin starts", async () => {
    const spoken: string[] = [];
    const first = gate();
    let calls = 0;
    const mouth = createSpeechMouth({
      speak: async (lines) => {
        calls += 1;
        spoken.push(lines.map((line) => line.text).join(""));
        if (calls === 1) await first.promise;
      },
      cancel: () => {},
    });
    const show = createShowVoice(mouth);
    const broadcaster = createBroadcaster(mouth);

    const showDone = show.speak([{ speaker: "lyra", text: "先说节目。" }]);
    const bulletin = taskBulletin("夜里记下了两件新的事。");
    const airDone = broadcaster.air(bulletin!);

    await Promise.resolve();
    expect(spoken).toEqual(["先说节目。"]);

    first.open();
    await showDone;
    await airDone;
    expect(spoken).toEqual(["先说节目。", "夜里记下了两件新的事。"]);
  });

  it("drops a queued line when cancelled, then accepts the next one", async () => {
    const spoken: string[] = [];
    const first = gate();
    let entered: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const mouth = createSpeechMouth({
      speak: async (lines) => {
        spoken.push(lines[0].text);
        entered();
        if (spoken.length === 1) await first.promise;
      },
      cancel: () => {},
    });

    const inflight = mouth.speak([{ voice: "chuichui", text: "正在说。" }]);
    await started;
    const queued = mouth.speak([{ voice: "chuichui", text: "不该再说。" }]);
    mouth.cancel();
    const next = mouth.speak([{ voice: "chuichui", text: "重新说。" }]);
    first.open();

    await expect(inflight).rejects.toThrow(/cancelled/);
    await expect(queued).rejects.toThrow(/cancelled/);
    await next;
    expect(spoken).toEqual(["正在说。", "重新说。"]);
  });
});
