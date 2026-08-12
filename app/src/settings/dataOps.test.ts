import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @tauri-apps/api/core before importing the module under test
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

// Mock @tauri-apps/plugin-dialog before importing the module under test
vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { exportAllData, wipeAllData } from "./dataOps";

const mockInvoke = vi.mocked(invoke);
const mockSave = vi.mocked(save);

describe("exportAllData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("opens save dialog, calls data_export, returns path and size", async () => {
    mockSave.mockResolvedValue("/Users/test/lyra-export-2026-08-05.json");
    mockInvoke.mockResolvedValue(1024 * 512); // 512 KB

    const result = await exportAllData();

    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.stringContaining("导出"),
        filters: expect.arrayContaining([
          expect.objectContaining({ extensions: ["json"] }),
        ]),
      }),
    );
    expect(mockInvoke).toHaveBeenCalledWith("data_export", {
      targetPath: "/Users/test/lyra-export-2026-08-05.json",
    });
    expect(result.path).toBe("/Users/test/lyra-export-2026-08-05.json");
    expect(result.size).toBe(1024 * 512);
  });

  it("throws 'Export cancelled' when save dialog is cancelled (null path)", async () => {
    mockSave.mockResolvedValue(null);

    await expect(exportAllData()).rejects.toThrow("Export cancelled");
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("propagates error from data_export command", async () => {
    mockSave.mockResolvedValue("/tmp/lyra.json");
    mockInvoke.mockRejectedValue(new Error("write /tmp/lyra.json: permission denied"));

    await expect(exportAllData()).rejects.toThrow("permission denied");
  });
});

describe("wipeAllData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls data_wipe command", async () => {
    mockInvoke.mockResolvedValue(undefined);

    await wipeAllData();

    expect(mockInvoke).toHaveBeenCalledWith("data_wipe");
  });

  it("propagates error from data_wipe command", async () => {
    mockInvoke.mockRejectedValue(new Error("remove lyra.db: file locked"));

    await expect(wipeAllData()).rejects.toThrow("file locked");
  });
});
