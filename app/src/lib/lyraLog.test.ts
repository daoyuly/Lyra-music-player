import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve()),
}));

import { invoke } from "@tauri-apps/api/core";
import { lyraLog } from "./lyraLog";

describe("lyraLog", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockClear();
  });

  it("mirrors info lines to frontend_log", () => {
    lyraLog("turn", "info", "phase", { diagId: "abc", phase: "emotion" });
    expect(invoke).toHaveBeenCalledWith("frontend_log", {
      level: "info",
      scope: "turn",
      message: "phase · diagId=abc phase=emotion",
    });
  });
});
