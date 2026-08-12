import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock secrets before importing boot
const getSecretMock = vi.fn();
vi.mock("../settings/secrets", () => ({
  SECRET_KEYS: {
    anthropicApiKey: "provider.anthropic.apiKey",
    deepseekApiKey: "provider.deepseek.apiKey",
    zhipuApiKey: "provider.zhipu.apiKey",
    ollamaEnabled: "provider.ollama.enabled",
    ollamaEndpoint: "provider.ollama.endpoint",
    ollamaModel: "provider.ollama.model",
  },
  getSecret: (...args: unknown[]) => getSecretMock(...args),
}));

// Mock registry so we can inspect register calls
const registerMock = vi.fn();
vi.mock("./registry", () => ({
  registry: { register: (...args: unknown[]) => registerMock(...args) },
}));

import { bootProviders } from "./boot";

beforeEach(() => {
  getSecretMock.mockReset();
  registerMock.mockReset();
});

describe("bootProviders", () => {
  it("registers only anthropic when only its key is present", async () => {
    getSecretMock.mockImplementation((key: string) =>
      key === "provider.anthropic.apiKey"
        ? Promise.resolve("sk-ant-123")
        : Promise.resolve(null),
    );

    const report = await bootProviders();

    expect(report.registered).toEqual(["anthropic"]);
    expect(report.skipped).toEqual([
      { id: "deepseek", reason: "no-key" },
      { id: "local-ollama", reason: "no-key" },
      { id: "zhipu", reason: "no-key" },
    ]);
    expect(registerMock).toHaveBeenCalledOnce();
    expect(registerMock.mock.calls[0][0].id).toBe("anthropic");
  });

  it("registers only deepseek when only its key is present", async () => {
    getSecretMock.mockImplementation((key: string) =>
      key === "provider.deepseek.apiKey"
        ? Promise.resolve("ds-key-456")
        : Promise.resolve(null),
    );

    const report = await bootProviders();

    expect(report.registered).toEqual(["deepseek"]);
    expect(report.skipped).toEqual([
      { id: "anthropic", reason: "no-key" },
      { id: "local-ollama", reason: "no-key" },
      { id: "zhipu", reason: "no-key" },
    ]);
    expect(registerMock).toHaveBeenCalledOnce();
    expect(registerMock.mock.calls[0][0].id).toBe("deepseek");
  });

  it("registers only zhipu when only its key is present", async () => {
    getSecretMock.mockImplementation((key: string) =>
      key === "provider.zhipu.apiKey"
        ? Promise.resolve("zp-key-789")
        : Promise.resolve(null),
    );

    const report = await bootProviders();

    expect(report.registered).toEqual(["zhipu"]);
    expect(report.skipped).toEqual([
      { id: "anthropic", reason: "no-key" },
      { id: "deepseek", reason: "no-key" },
      { id: "local-ollama", reason: "no-key" },
    ]);
    expect(registerMock).toHaveBeenCalledOnce();
    expect(registerMock.mock.calls[0][0].id).toBe("zhipu");
  });

  it("registers all three providers when all keys are present", async () => {
    getSecretMock.mockImplementation((key: string) => {
      if (key === "provider.anthropic.apiKey") return Promise.resolve("sk-ant-abc");
      if (key === "provider.deepseek.apiKey") return Promise.resolve("ds-xyz");
      if (key === "provider.zhipu.apiKey") return Promise.resolve("zp-abc");
      return Promise.resolve(null);
    });

    const report = await bootProviders();

    expect(report.registered).toEqual(["anthropic", "deepseek", "zhipu"]);
    expect(report.skipped).toEqual([{ id: "local-ollama", reason: "no-key" }]);
    expect(registerMock).toHaveBeenCalledTimes(3);
  });

  it("returns empty registered + all skipped as no-key when no keys exist", async () => {
    getSecretMock.mockResolvedValue(null);

    const report = await bootProviders();

    expect(report.registered).toEqual([]);
    expect(report.skipped).toEqual([
      { id: "anthropic", reason: "no-key" },
      { id: "deepseek", reason: "no-key" },
      { id: "local-ollama", reason: "no-key" },
      { id: "zhipu", reason: "no-key" },
    ]);
    expect(registerMock).not.toHaveBeenCalled();
  });

  it("reports keychain-error distinctly from no-key when getSecret rejects", async () => {
    getSecretMock.mockImplementation((key: string) => {
      if (key === "provider.anthropic.apiKey") {
        return Promise.reject(new Error("keychain locked"));
      }
      if (key === "provider.zhipu.apiKey") return Promise.resolve("zp");
      return Promise.resolve(null);
    });

    const report = await bootProviders();

    expect(report.registered).toEqual(["zhipu"]);
    expect(report.skipped).toEqual([
      { id: "anthropic", reason: "keychain-error" },
      { id: "deepseek", reason: "no-key" },
      { id: "local-ollama", reason: "no-key" },
    ]);
  });
});
