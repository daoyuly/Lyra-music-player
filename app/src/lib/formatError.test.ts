import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve()),
}));

import { invoke } from "@tauri-apps/api/core";
import {
  classifyError,
  formatErrorDetail,
  isOpaqueNetworkError,
  userFacingErrorMessage,
  logLyraError,
  providerFetchErrorMessage,
} from "./formatError";

describe("formatErrorDetail", () => {
  it("flattens Error with cause", () => {
    const err = new Error("outer");
    err.cause = new TypeError("Load failed");
    expect(formatErrorDetail(err)).toMatchObject({
      name: "Error",
      message: "outer",
      cause: "TypeError: Load failed",
    });
  });

  it("stringifies non-Error values", () => {
    expect(formatErrorDetail("boom")).toEqual({
      name: "string",
      message: "boom",
    });
  });
});

describe("classifyError / userFacingErrorMessage", () => {
  it("detects WebKit Load failed", () => {
    expect(isOpaqueNetworkError("Load failed")).toBe(true);
    expect(isOpaqueNetworkError("Failed to fetch")).toBe(true);
    expect(isOpaqueNetworkError("Zhipu 429: quota")).toBe(false);
  });

  it("assigns stable error codes", () => {
    expect(classifyError(new TypeError("Load failed"))).toBe("E_LLM_NETWORK");
    expect(classifyError(new Error("Zhipu 429: rate"))).toBe("E_LLM_HTTP");
    expect(classifyError(new Error("library is empty; add music"))).toBe(
      "E_LIBRARY_EMPTY",
    );
    expect(classifyError(new Error("no provider registered for agent emotion"))).toBe(
      "E_NO_PROVIDER",
    );
  });

  it("prefixes UI messages with the code", () => {
    expect(userFacingErrorMessage(new TypeError("Load failed"))).toMatch(
      /^\[E_LLM_NETWORK\].*LLM 网络请求失败/,
    );
    expect(userFacingErrorMessage(new Error("Zhipu 401: nope"))).toBe(
      "[E_LLM_HTTP] Zhipu 401: nope",
    );
  });
});

describe("logLyraError", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockClear();
  });

  it("mirrors a summary to frontend_log with code", () => {
    logLyraError("orchestrator error", new TypeError("Load failed"), {
      phase: "onUserInput",
    });
    expect(invoke).toHaveBeenCalledWith(
      "frontend_log",
      expect.objectContaining({
        level: "error",
        scope: "orchestrator error",
        message: expect.stringMatching(/Load failed.*E_LLM_NETWORK|E_LLM_NETWORK.*Load failed/),
      }),
    );
  });
});

describe("providerFetchErrorMessage", () => {
  it("names provider + endpoint", () => {
    const msg = providerFetchErrorMessage(
      "Zhipu",
      "https://open.bigmodel.cn/api/paas/v4/chat/completions",
      new TypeError("Load failed"),
    );
    expect(msg).toMatch(/^Zhipu unreachable at https:\/\/open\.bigmodel\.cn/);
    expect(msg).toContain("Load failed");
  });
});
