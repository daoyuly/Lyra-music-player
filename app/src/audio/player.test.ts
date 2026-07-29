import { describe, it, expect, vi, beforeEach } from "vitest";

const invokeMock = vi.fn();
const listenMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => listenMock(...args),
}));

import {
  playFile,
  stopPlayback,
  isPlaying,
  onSongComplete,
  pausePlayback,
  resumePlayback,
  isPaused,
} from "./player";

beforeEach(() => {
  invokeMock.mockReset();
  listenMock.mockReset();
});

describe("audio/player", () => {
  it("playFile calls audio_play command with path (no duration) and returns the playback id", async () => {
    invokeMock.mockResolvedValueOnce(42);
    const id = await playFile("/tmp/song.mp3");
    expect(invokeMock).toHaveBeenCalledWith("audio_play", {
      path: "/tmp/song.mp3",
      durationMs: null,
    });
    expect(id).toBe(42);
  });

  it("playFile forwards the duration hint to Rust when provided", async () => {
    invokeMock.mockResolvedValueOnce(43);
    await playFile("/tmp/song.mp3", 180_000);
    expect(invokeMock).toHaveBeenCalledWith("audio_play", {
      path: "/tmp/song.mp3",
      durationMs: 180_000,
    });
  });

  it("stopPlayback calls audio_stop", async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    await stopPlayback();
    expect(invokeMock).toHaveBeenCalledWith("audio_stop");
  });

  it("isPlaying returns boolean from audio_is_playing", async () => {
    invokeMock.mockResolvedValueOnce(true);
    await expect(isPlaying()).resolves.toBe(true);
    expect(invokeMock).toHaveBeenCalledWith("audio_is_playing");
  });

  it("pausePlayback calls audio_pause", async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    await pausePlayback();
    expect(invokeMock).toHaveBeenCalledWith("audio_pause");
  });

  it("resumePlayback calls audio_resume", async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    await resumePlayback();
    expect(invokeMock).toHaveBeenCalledWith("audio_resume");
  });

  it("isPaused returns boolean from audio_is_paused", async () => {
    invokeMock.mockResolvedValueOnce(true);
    await expect(isPaused()).resolves.toBe(true);
    expect(invokeMock).toHaveBeenCalledWith("audio_is_paused");
  });

  it("playFile propagates errors from Rust", async () => {
    invokeMock.mockRejectedValueOnce("not initialized");
    await expect(playFile("/x")).rejects.toBe("not initialized");
  });

  it("onSongComplete subscribes to the audio-complete event and forwards the payload id", async () => {
    const unlisten = vi.fn();
    let capturedHandler: ((event: { payload: number }) => void) | undefined;
    listenMock.mockImplementation(async (_event: string, handler) => {
      capturedHandler = handler;
      return unlisten;
    });

    const cb = vi.fn();
    const off = await onSongComplete(cb);
    expect(listenMock).toHaveBeenCalledWith("audio-complete", expect.any(Function));

    // Simulate Rust firing the event
    capturedHandler?.({ payload: 7 });
    expect(cb).toHaveBeenCalledWith(7);

    expect(off).toBe(unlisten);
  });
});
