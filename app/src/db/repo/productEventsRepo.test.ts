import { describe, it, expect, vi, beforeEach } from "vitest";

const executeMock = vi.fn();
const selectMock = vi.fn();
const getDbMock = vi.fn();

vi.mock("../client", () => ({
  getDb: () => getDbMock(),
}));

import {
  record,
  count,
  listByKind,
  listRecent,
  purgeOlderThan,
} from "./productEventsRepo";

beforeEach(() => {
  executeMock.mockReset();
  selectMock.mockReset();
  getDbMock.mockReset();
  getDbMock.mockResolvedValue({ execute: executeMock, select: selectMock });
});

describe("productEventsRepo — record", () => {
  it("inserts id, ts, kind, payload_json into product_events", async () => {
    executeMock.mockResolvedValue({ rowsAffected: 1, lastInsertId: 0 });
    await record("demo_started", { song: "abc" });
    expect(executeMock).toHaveBeenCalledOnce();
    const [sql, args] = executeMock.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO product_events/i);
    expect(args).toHaveLength(4);
    // id is a UUID — just check it's a non-empty string
    expect(typeof args[0]).toBe("string");
    expect(args[0].length).toBeGreaterThan(0);
    // ts is a recent Unix ms
    expect(args[1]).toBeGreaterThan(0);
    expect(args[2]).toBe("demo_started");
    expect(args[3]).toBe(JSON.stringify({ song: "abc" }));
  });

  it("defaults payload to {} when not supplied", async () => {
    executeMock.mockResolvedValue({ rowsAffected: 1, lastInsertId: 0 });
    await record("hint_shown");
    const [, args] = executeMock.mock.calls[0];
    expect(args[3]).toBe("{}");
  });
});

describe("productEventsRepo — listRecent", () => {
  it("selects all columns ordered by ts DESC with LIMIT", async () => {
    const fakeRow = {
      id: "evt-1",
      ts: 1_000_000,
      kind: "demo_started",
      payload_json: "{}",
    };
    selectMock.mockResolvedValue([fakeRow]);
    const rows = await listRecent(50);
    expect(selectMock).toHaveBeenCalledOnce();
    const [sql, args] = selectMock.mock.calls[0];
    expect(sql).toMatch(/ORDER BY ts DESC LIMIT/i);
    expect(args).toEqual([50]);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("evt-1");
  });
});

describe("productEventsRepo — count", () => {
  it("counts events by kind and since timestamp", async () => {
    selectMock.mockResolvedValue([{ n: 7 }]);
    const n = await count("demo_started", 500_000);
    expect(selectMock).toHaveBeenCalledOnce();
    const [sql, args] = selectMock.mock.calls[0];
    expect(sql).toMatch(/COUNT\(\*\)/i);
    expect(sql).toMatch(/kind = \?/i);
    expect(sql).toMatch(/ts >= \?/i);
    expect(args).toEqual(["demo_started", 500_000]);
    expect(n).toBe(7);
  });

  it("returns 0 when no rows match", async () => {
    selectMock.mockResolvedValue([{ n: 0 }]);
    const n = await count("verbal_intent_detected", 9_999_999_999);
    expect(n).toBe(0);
  });
});

describe("productEventsRepo — listByKind", () => {
  it("filters by kind and returns newest first", async () => {
    const rows = [
      { id: "a", ts: 2_000, kind: "hint_shown", payload_json: "{}" },
      { id: "b", ts: 1_000, kind: "hint_shown", payload_json: "{}" },
    ];
    selectMock.mockResolvedValue(rows);
    const result = await listByKind("hint_shown", 10);
    expect(selectMock).toHaveBeenCalledOnce();
    const [sql, args] = selectMock.mock.calls[0];
    expect(sql).toMatch(/WHERE kind = \?/i);
    expect(sql).toMatch(/ORDER BY ts DESC LIMIT/i);
    expect(args).toEqual(["hint_shown", 10]);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("a");
  });
});

describe("productEventsRepo — purgeOlderThan", () => {
  it("deletes rows with ts < cutoff and returns rowsAffected", async () => {
    executeMock.mockResolvedValue({ rowsAffected: 3, lastInsertId: 0 });
    const deleted = await purgeOlderThan(1_000_000);
    expect(executeMock).toHaveBeenCalledOnce();
    const [sql, args] = executeMock.mock.calls[0];
    expect(sql).toMatch(/DELETE FROM product_events WHERE ts < \?/i);
    expect(args).toEqual([1_000_000]);
    expect(deleted).toBe(3);
  });

  it("returns 0 when nothing is deleted", async () => {
    executeMock.mockResolvedValue({ rowsAffected: 0, lastInsertId: 0 });
    const deleted = await purgeOlderThan(0);
    expect(deleted).toBe(0);
  });
});

describe("productEventsRepo — payload_json round-trip", () => {
  it("stores payload as JSON string and the stored value parses back correctly", async () => {
    executeMock.mockResolvedValue({ rowsAffected: 1, lastInsertId: 0 });
    const payload = { score: 42, tags: ["a", "b"], nested: { x: true } };
    await record("demo_completed", payload);
    const [, args] = executeMock.mock.calls[0];
    const stored = args[3] as string;
    expect(JSON.parse(stored)).toEqual(payload);
  });
});
