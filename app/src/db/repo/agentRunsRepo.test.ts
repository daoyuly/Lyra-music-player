import { describe, it, expect, vi, beforeEach } from "vitest";

const executeMock = vi.fn();
const selectMock = vi.fn();
const getDbMock = vi.fn();

vi.mock("../client", () => ({
  getDb: () => getDbMock(),
}));

import {
  insertStart,
  appendEvent,
  markEnded,
  listRecent,
  purgeOlderThan,
} from "./agentRunsRepo";

beforeEach(() => {
  executeMock.mockReset();
  selectMock.mockReset();
  getDbMock.mockReset();
  getDbMock.mockResolvedValue({ execute: executeMock, select: selectMock });
});

describe("agentRunsRepo — insertStart", () => {
  it("inserts 4 columns: id, turn_id, agent_kind, started_at", async () => {
    executeMock.mockResolvedValue({ rowsAffected: 1, lastInsertId: 0 });
    await insertStart({
      id: "run-1",
      turn_id: "turn-1",
      agent_kind: "emotion",
      started_at: 1_000_000,
    });
    expect(executeMock).toHaveBeenCalledOnce();
    const [sql, args] = executeMock.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO agent_runs/i);
    expect(args).toEqual(["run-1", "turn-1", "emotion", 1_000_000]);
  });
});

describe("agentRunsRepo — appendEvent", () => {
  it("appends JSONL row via UPDATE events_jsonl = events_jsonl || ?", async () => {
    executeMock.mockResolvedValue({ rowsAffected: 1, lastInsertId: 0 });
    await appendEvent("run-1", { type: "text_delta", delta: "hello" });
    expect(executeMock).toHaveBeenCalledOnce();
    const [sql, args] = executeMock.mock.calls[0];
    expect(sql).toMatch(/events_jsonl = events_jsonl \|\|/i);
    expect(args[0]).toBe(JSON.stringify({ type: "text_delta", delta: "hello" }) + "\n");
    expect(args[1]).toBe("run-1");
  });

  it("multiple appendEvent calls each issue their own UPDATE", async () => {
    executeMock.mockResolvedValue({ rowsAffected: 1, lastInsertId: 0 });
    await appendEvent("run-2", { type: "tool_use", tool: "search" });
    await appendEvent("run-2", { type: "tool_result", content: "ok" });
    expect(executeMock).toHaveBeenCalledTimes(2);
    const firstLine = executeMock.mock.calls[0][1][0] as string;
    const secondLine = executeMock.mock.calls[1][1][0] as string;
    expect(firstLine).toContain("tool_use");
    expect(secondLine).toContain("tool_result");
    expect(firstLine).toMatch(/\n$/);
    expect(secondLine).toMatch(/\n$/);
  });
});

describe("agentRunsRepo — markEnded", () => {
  it("updates ended_at and stop_reason for the given runId", async () => {
    executeMock.mockResolvedValue({ rowsAffected: 1, lastInsertId: 0 });
    await markEnded("run-3", 2_000_000, "ok");
    expect(executeMock).toHaveBeenCalledOnce();
    const [sql, args] = executeMock.mock.calls[0];
    expect(sql).toMatch(/UPDATE agent_runs SET ended_at/i);
    expect(args).toEqual([2_000_000, "ok", "run-3"]);
  });

  it("accepts all valid stop_reason values", async () => {
    executeMock.mockResolvedValue({ rowsAffected: 1, lastInsertId: 0 });
    await markEnded("run-4", 3_000_000, "aborted_by_user");
    const [, args] = executeMock.mock.calls[0];
    expect(args[1]).toBe("aborted_by_user");
  });
});

describe("agentRunsRepo — listRecent", () => {
  it("selects all columns ordered by started_at DESC with LIMIT", async () => {
    const fakeRow = {
      id: "run-1",
      turn_id: "turn-1",
      agent_kind: "emotion",
      started_at: 1_000_000,
      ended_at: 2_000_000,
      stop_reason: "ok",
      events_jsonl: '{"type":"stop"}\n',
    };
    selectMock.mockResolvedValue([fakeRow]);
    const rows = await listRecent(50);
    expect(selectMock).toHaveBeenCalledOnce();
    const [sql, args] = selectMock.mock.calls[0];
    expect(sql).toMatch(/ORDER BY started_at DESC LIMIT/i);
    expect(args).toEqual([50]);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("run-1");
  });
});

describe("agentRunsRepo — purgeOlderThan", () => {
  it("deletes rows with started_at < cutoff and returns rowsAffected", async () => {
    executeMock.mockResolvedValue({ rowsAffected: 5, lastInsertId: 0 });
    const deleted = await purgeOlderThan(1_000_000);
    expect(executeMock).toHaveBeenCalledOnce();
    const [sql, args] = executeMock.mock.calls[0];
    expect(sql).toMatch(/DELETE FROM agent_runs WHERE started_at < \?/i);
    expect(args).toEqual([1_000_000]);
    expect(deleted).toBe(5);
  });

  it("returns 0 when nothing is deleted", async () => {
    executeMock.mockResolvedValue({ rowsAffected: 0, lastInsertId: 0 });
    const deleted = await purgeOlderThan(0);
    expect(deleted).toBe(0);
  });
});
