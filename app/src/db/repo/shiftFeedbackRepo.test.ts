import { describe, it, expect, vi, beforeEach } from "vitest";

const executeMock = vi.fn();
const selectMock = vi.fn();
const getDbMock = vi.fn();

vi.mock("../client", () => ({
  getDb: () => getDbMock(),
}));

import { insert, listRecent, listByWindow, MAX_ROWS } from "./shiftFeedbackRepo";
import type { ShiftFeedback } from "../../perception/shiftFeedback";

const sample: ShiftFeedback = {
  turnId: "turn-01",
  recommendedShift: "接住",
  userAction: "complete",
  padAtTime: { p: 0.2, a: -0.1, d: 0.05 },
  timeToActionMs: 45_000,
  timestamp: 1_720_000_000_000,
};

beforeEach(() => {
  executeMock.mockReset();
  selectMock.mockReset();
  getDbMock.mockReset();
  getDbMock.mockResolvedValue({ execute: executeMock, select: selectMock });
});

describe("shiftFeedbackRepo — insert", () => {
  it("inserts 8 columns", async () => {
    executeMock.mockResolvedValue({ rowsAffected: 1, lastInsertId: 0 });
    await insert(sample);
    expect(executeMock).toHaveBeenCalledTimes(2); // insert + prune
    const [sql, args] = executeMock.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO shift_feedback/i);
    expect(args).toHaveLength(8);
    expect(args[0]).toBe("turn-01");
    expect(args[2]).toBe("接住");
    expect(args[3]).toBe("complete");
  });

  it("prunes to MAX_ROWS", async () => {
    executeMock.mockResolvedValue({ rowsAffected: 1, lastInsertId: 0 });
    await insert(sample);
    const [pruneSql, pruneArgs] = executeMock.mock.calls[1];
    expect(pruneSql).toMatch(/DELETE FROM shift_feedback/i);
    expect(pruneArgs).toEqual([MAX_ROWS]);
  });

  it("preserves PAD values in insert args", async () => {
    executeMock.mockResolvedValue({ rowsAffected: 1, lastInsertId: 0 });
    await insert(sample);
    const [, args] = executeMock.mock.calls[0];
    expect(args[4]).toBe(0.2); // pad_p
    expect(args[5]).toBe(-0.1); // pad_a
    expect(args[6]).toBe(0.05); // pad_d
    expect(args[7]).toBe(45_000); // time_to_action_ms
  });
});

describe("shiftFeedbackRepo — listRecent", () => {
  it("returns feedback via SELECT ORDER BY ts DESC LIMIT", async () => {
    selectMock.mockResolvedValue([
      {
        id: 1,
        turn_id: "t1",
        ts: 1000,
        shift: "点燃",
        user_action: "skip",
        pad_p: 0,
        pad_a: 0.3,
        pad_d: 0,
        time_to_action_ms: 5000,
      },
    ]);
    const rows = await listRecent(10);
    const [sql, args] = selectMock.mock.calls[0];
    expect(sql).toMatch(/SELECT.*FROM shift_feedback.*ORDER BY ts DESC/is);
    expect(args).toEqual([10]);
    expect(rows).toHaveLength(1);
    expect(rows[0].recommendedShift).toBe("点燃");
    expect(rows[0].userAction).toBe("skip");
    expect(rows[0].padAtTime).toEqual({ p: 0, a: 0.3, d: 0 });
  });

  it("returns empty array when no rows", async () => {
    selectMock.mockResolvedValue([]);
    const rows = await listRecent(10);
    expect(rows).toEqual([]);
  });
});

describe("shiftFeedbackRepo — listByWindow", () => {
  it("filters by cutoff ts", async () => {
    selectMock.mockResolvedValue([]);
    await listByWindow(1_000_000);
    const [sql, args] = selectMock.mock.calls[0];
    expect(sql).toMatch(/WHERE ts >= \?/i);
    expect(args).toEqual([1_000_000]);
  });

  it("returns rows in ASC order (chronological for stats)", async () => {
    selectMock.mockResolvedValue([]);
    await listByWindow(0);
    const [sql] = selectMock.mock.calls[0];
    expect(sql).toMatch(/ORDER BY ts ASC/i);
  });
});
