import { describe, it, expect, vi, beforeEach } from "vitest";

const executeMock = vi.fn();
const selectMock = vi.fn();
const getDbMock = vi.fn();

vi.mock("../client", () => ({
  getDb: () => getDbMock(),
}));

import { load, save, clear, type ActiveIntent } from "./activeIntentRepo";

beforeEach(() => {
  executeMock.mockReset();
  selectMock.mockReset();
  getDbMock.mockReset();
  getDbMock.mockResolvedValue({ execute: executeMock, select: selectMock });
});

const sample: ActiveIntent = {
  rawText: "一直播放粤语歌曲",
  constraints: { languages: ["yue"] },
  persistence: "sticky",
  source: "user-explicit",
  createdAt: 1_700_000_000_000,
  turnId: "turn-1",
};

describe("activeIntentRepo", () => {
  it("load returns null when empty", async () => {
    selectMock.mockResolvedValue([]);
    expect(await load()).toBeNull();
  });

  it("load hydrates from row", async () => {
    selectMock.mockResolvedValue([
      {
        id: 1,
        raw_text: sample.rawText,
        constraints_json: JSON.stringify(sample.constraints),
        persistence: "sticky",
        source: "user-explicit",
        created_at: sample.createdAt,
        turn_id: sample.turnId,
      },
    ]);
    const got = await load();
    expect(got).toEqual(sample);
  });

  it("save upserts id=1", async () => {
    executeMock.mockResolvedValue({ rowsAffected: 1 });
    await save(sample);
    const [sql, args] = executeMock.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO active_intent/i);
    expect(args[0]).toBe(sample.rawText);
    expect(args[1]).toBe(JSON.stringify(sample.constraints));
    expect(args[2]).toBe("sticky");
    expect(args[3]).toBe("user-explicit");
    expect(args[4]).toBe(sample.createdAt);
    expect(args[5]).toBe(sample.turnId);
  });

  it("clear deletes id=1", async () => {
    executeMock.mockResolvedValue({ rowsAffected: 1 });
    await clear();
    const [sql] = executeMock.mock.calls[0];
    expect(sql).toMatch(/DELETE FROM active_intent/i);
  });
});
