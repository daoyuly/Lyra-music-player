import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.reject(new Error("not in tauri"))),
}));

import { invoke } from "@tauri-apps/api/core";
import { lyraHttp, iterSseDataLines } from "./lyraHttp";

describe("lyraHttp", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockRejectedValue(new Error("not in tauri"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        status: 200,
        text: async () => '{"ok":1}',
      })),
    );
  });

  it("falls back to fetch when invoke fails", async () => {
    const r = await lyraHttp("https://example.com/x", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(r).toEqual({ status: 200, body: '{"ok":1}' });
    expect(fetch).toHaveBeenCalled();
  });

  it("uses invoke result when Tauri bridge works", async () => {
    vi.mocked(invoke).mockResolvedValue({ status: 201, body: "from-rust" });
    const r = await lyraHttp("https://example.com/y", { method: "POST", body: "{}" });
    expect(r).toEqual({ status: 201, body: "from-rust" });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("iterSseDataLines", () => {
  it("yields data payloads", () => {
    const body = [
      "data: {\"a\":1}",
      "",
      "data: [DONE]",
      "ignore: me",
    ].join("\n");
    expect([...iterSseDataLines(body)]).toEqual(['{"a":1}', "[DONE]"]);
  });
});
