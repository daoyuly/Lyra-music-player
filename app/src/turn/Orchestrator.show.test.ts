import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { Orchestrator, SHOW_TALK_BEFORE_PLAY_MS } from "./Orchestrator";
import type { CurrentEmotion, LibraryTrack } from "../types";
import type { ShowBrief } from "../show/ShowAgent";
import * as memoryContext from "../memory/context";
import { EMPTY_MEMORY } from "../memory/parser";

vi.mock("../db/repo/sharedMemoryRepo", () => ({
  insertSharedMemory: vi.fn(async () => {}),
  listRecent: vi.fn(async () => []),
}));

vi.mock("../memory/appendSalient", () => ({
  appendSalientMomentToMemoryMd: vi.fn(async () => {}),
}));

vi.mock("../tray/trayBridge", () => ({
  setBreathing: vi.fn(async () => {}),
}));

const emotion: CurrentEmotion = {
  pad: { p: -0.2, a: -0.3, d: 0.1 },
  labels: ["沉静"],
  confidence: 0.8,
  source: "emotion-agent-inferred",
};

function track(id: string, title: string): LibraryTrack {
  return { id, path: `/${id}.mp3`, origin: "local", added_at: 0, title };
}

function duo(songId: string) {
  return {
    song_id: songId,
    lines: [
      { speaker: "lyra" as const, text: "雨还在下。" },
      { speaker: "guest" as const, text: "先放这首。" },
    ],
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  memoryContext.setMemoryContext(EMPTY_MEMORY);
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("Orchestrator show", () => {
  it("shows the lines before playing, then the next beat after the song", async () => {
    const a = track("a", "雨");
    const b = track("b", "晴");
    const write = vi.fn(async (_brief: ShowBrief) => [duo("a"), duo("b")]);
    const audio = { playFile: vi.fn(async () => {}), stop: vi.fn(async () => {}) };
    const orc = new Orchestrator({
      emotion: { analyze: vi.fn(async () => emotion) },
      companion: { choose: vi.fn() },
      library: { prefilter: vi.fn(async () => [a, b]) },
      soulStore: { load: vi.fn(async () => ({ dynamic_mood: { current_pad: emotion.pad } })) },
      turnRepo: { insertTurn: vi.fn(async () => {}), updateTurn: vi.fn(async () => {}) },
      audio,
      clock: () => Date.parse("2026-10-28T19:05:00"),
      idGen: () => "turn-1",
      showAgent: { write },
      readWeather: async () => "雨，14°C",
    } as never);

    await orc.onUserInput("/show 今晚的雨");
    const talked = orc.getState();
    expect(talked.kind).toBe("show-talk");
    if (talked.kind === "show-talk") {
      expect(talked.song.id).toBe("a");
      expect(talked.guestName).toBe("林");
      expect(talked.lines[0].text).toBe("雨还在下。");
    }
    expect(audio.playFile).not.toHaveBeenCalled();
    const first = write.mock.calls[0][0];
    expect(first.weather).toBe("雨，14°C");
    expect(first.topic).toBe("今晚的雨");

    await vi.advanceTimersByTimeAsync(SHOW_TALK_BEFORE_PLAY_MS);
    expect(audio.playFile).toHaveBeenCalledWith("/a.mp3", null);
    expect(orc.getState().kind).toBe("playing");

    await orc.onSongComplete();
    const next = orc.getState();
    expect(next.kind).toBe("show-talk");
    if (next.kind === "show-talk") expect(next.song.id).toBe("b");
    expect(audio.playFile).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(SHOW_TALK_BEFORE_PLAY_MS);
    expect(audio.playFile).toHaveBeenLastCalledWith("/b.mp3", null);
  });

  it("loads the soul before applying the shift when a show song ends", async () => {
    const a = track("a", "雨");
    const b = track("b", "晴");
    let loaded = false;
    const load = vi.fn(async () => {
      loaded = true;
      return { dynamic_mood: { current_pad: emotion.pad } };
    });
    const apply = vi.fn(async () => {
      if (!loaded) throw new Error("soulStore.apply() called before load()");
      return { dynamic_mood: { current_pad: emotion.pad } };
    });
    const orc = new Orchestrator({
      emotion: { analyze: vi.fn(async () => emotion) },
      companion: { choose: vi.fn() },
      library: { prefilter: vi.fn(async () => [a, b]) },
      soulStore: { load, apply },
      turnRepo: { insertTurn: vi.fn(async () => {}), updateTurn: vi.fn(async () => {}) },
      audio: { playFile: vi.fn(async () => {}), stop: vi.fn(async () => {}) },
      showAgent: { write: vi.fn(async () => [duo("a"), duo("b")]) },
      readWeather: async () => null,
    } as never);

    await orc.onUserInput("/show 今晚的雨");
    await vi.advanceTimersByTimeAsync(SHOW_TALK_BEFORE_PLAY_MS);
    await orc.onSongComplete();

    expect(apply).toHaveBeenCalled();
    expect(orc.getState().kind).toBe("show-talk");
  });

  it("rewrites only the tail when the listener cuts in, and keeps the current song", async () => {
    const a = track("a", "雨");
    const b = track("b", "晴");
    const c = track("c", "静");
    const write = vi.fn(async (brief: ShowBrief) => (brief.steer ? [duo("c")] : [duo("a"), duo("b")]));
    const prefilter = vi.fn(async () => [a, b, c]);
    const audio = { playFile: vi.fn(async () => {}), stop: vi.fn(async () => {}) };
    const orc = new Orchestrator({
      emotion: { analyze: vi.fn(async () => emotion) },
      companion: { choose: vi.fn() },
      library: { prefilter },
      soulStore: { load: vi.fn(async () => ({})) },
      turnRepo: { insertTurn: vi.fn(async () => {}), updateTurn: vi.fn(async () => {}) },
      audio,
      showAgent: { write },
      readWeather: async () => null,
    } as never);

    await orc.onUserInput("/show 阿禾 / 今晚的雨");
    await orc.onUserInput("");
    await orc.onUserInput("换成安静的");

    expect(audio.stop).toHaveBeenCalledTimes(1);
    const playing = orc.getState();
    expect(playing.kind).toBe("playing");
    if (playing.kind === "playing") {
      expect(playing.aside).toBe("后半段按你刚才的话改了。");
    }
    const steered = write.mock.calls[1][0];
    expect(steered.steer).toBe("换成安静的");
    expect(steered.guestName).toBe("阿禾");
  });

  it("ends the talk without playing when the listener turns the show off", async () => {
    const a = track("a", "雨");
    const orc = new Orchestrator({
      emotion: { analyze: vi.fn(async () => emotion) },
      companion: { choose: vi.fn() },
      library: { prefilter: vi.fn(async () => [a]) },
      soulStore: { load: vi.fn(async () => ({})) },
      turnRepo: { insertTurn: vi.fn(async () => {}) },
      audio: { playFile: vi.fn(async () => {}), stop: vi.fn(async () => {}) },
      showAgent: { write: vi.fn(async () => [duo("a")]) },
    } as never);

    await orc.onUserInput("/show 今晚的雨");
    await orc.onUserInput("/show off");
    expect(orc.getState().kind).toBe("idle");
  });

  it("plays the song after the hosts finish speaking", async () => {
    const a = track("a", "雨");
    let finish = () => {};
    const speak = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const audio = { playFile: vi.fn(async () => {}), stop: vi.fn(async () => {}) };
    const orc = new Orchestrator({
      emotion: { analyze: vi.fn(async () => emotion) },
      companion: { choose: vi.fn() },
      library: { prefilter: vi.fn(async () => [a]) },
      soulStore: { load: vi.fn(async () => ({})) },
      turnRepo: { insertTurn: vi.fn(async () => {}) },
      audio,
      showAgent: { write: vi.fn(async () => [duo("a")]) },
      showVoice: { speak, cancel: vi.fn() },
    } as never);

    await orc.onUserInput("/show 今晚的雨");
    expect(audio.playFile).not.toHaveBeenCalled();
    expect(speak).toHaveBeenCalledWith(duo("a").lines);
    finish();
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(audio.playFile).toHaveBeenCalledWith("/a.mp3", null);
  });

  it("plays once when enter cuts the hosts off", async () => {
    const a = track("a", "雨");
    let rejectSpeak: (err: Error) => void = () => {};
    const speak = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectSpeak = reject;
        }),
    );
    const audio = { playFile: vi.fn(async () => {}), stop: vi.fn(async () => {}) };
    const orc = new Orchestrator({
      emotion: { analyze: vi.fn(async () => emotion) },
      companion: { choose: vi.fn() },
      library: { prefilter: vi.fn(async () => [a]) },
      soulStore: { load: vi.fn(async () => ({})) },
      turnRepo: { insertTurn: vi.fn(async () => {}) },
      audio,
      showAgent: { write: vi.fn(async () => [duo("a")]) },
      showVoice: {
        speak,
        cancel: () => {
          rejectSpeak(new Error("cancelled"));
        },
      },
    } as never);

    await orc.onUserInput("/show 今晚的雨");
    await orc.onUserInput("");
    for (let i = 0; i < 8; i++) await Promise.resolve();
    await vi.advanceTimersByTimeAsync(SHOW_TALK_BEFORE_PLAY_MS);
    expect(audio.playFile).toHaveBeenCalledTimes(1);
  });

  it("writes the next segment when the current one ends, and stays in the show", async () => {
    const a = track("a", "雨");
    const b = track("b", "晴");
    const c = track("c", "静");
    const write = vi.fn(async (brief: ShowBrief) =>
      brief.continuing ? [duo("c")] : [duo("a"), duo("b")],
    );
    const choose = vi.fn();
    const audio = { playFile: vi.fn(async () => {}), stop: vi.fn(async () => {}) };
    const orc = new Orchestrator({
      emotion: { analyze: vi.fn(async () => emotion) },
      companion: { choose },
      library: { prefilter: vi.fn(async () => [a, b, c]) },
      soulStore: { load: vi.fn(async () => ({ dynamic_mood: { current_pad: emotion.pad } })) },
      turnRepo: { insertTurn: vi.fn(async () => {}), updateTurn: vi.fn(async () => {}) },
      audio,
      showAgent: { write },
      readWeather: async () => null,
    } as never);

    await orc.onUserInput("/show 今晚的雨");
    await vi.advanceTimersByTimeAsync(SHOW_TALK_BEFORE_PLAY_MS);
    await orc.onSongComplete();
    await vi.advanceTimersByTimeAsync(SHOW_TALK_BEFORE_PLAY_MS);
    await orc.onSongComplete();

    expect(write).toHaveBeenCalledTimes(2);
    expect(write.mock.calls[1][0].continuing).toBe(true);
    expect(choose).not.toHaveBeenCalled();
    const next = orc.getState();
    expect(next.kind).toBe("show-talk");
    if (next.kind === "show-talk") expect(next.song.id).toBe("c");
  });

  it("speaks the boundary rewrite, not the first draft", async () => {
    const a = track("a", "雨");
    const color = vi.fn(async () => [
      {
        song_id: "a",
        lines: [
          { speaker: "lyra" as const, text: "窗上的水痕还在，这首先放。" },
          { speaker: "guest" as const, text: "听着有点好笑，也有点难过。" },
        ],
      },
    ]);
    const orc = new Orchestrator({
      emotion: { analyze: vi.fn(async () => emotion) },
      companion: { choose: vi.fn() },
      library: { prefilter: vi.fn(async () => [a]) },
      soulStore: { load: vi.fn(async () => ({})) },
      turnRepo: { insertTurn: vi.fn(async () => {}) },
      audio: { playFile: vi.fn(async () => {}), stop: vi.fn(async () => {}) },
      showAgent: { write: vi.fn(async () => [duo("a")]) },
      showBoundary: { color },
    } as never);

    await orc.onUserInput("/show 今晚的雨");
    const talked = orc.getState();
    expect(color).toHaveBeenCalledOnce();
    expect(talked.kind).toBe("show-talk");
    if (talked.kind === "show-talk") expect(talked.lines[0].text).toContain("水痕");
  });
});
