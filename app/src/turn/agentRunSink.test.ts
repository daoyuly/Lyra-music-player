import { describe, it, expect, vi, beforeEach } from "vitest";
import { AgentRunSink } from "./agentRunSink";
import type { AgentRunRepo } from "./agentRunSink";

// ─── Mock repo factory ───────────────────────────────────────────────────────

function makeMockRepo(): AgentRunRepo & {
  insertStart: ReturnType<typeof vi.fn>;
  appendEvent: ReturnType<typeof vi.fn>;
  markEnded: ReturnType<typeof vi.fn>;
} {
  return {
    insertStart: vi.fn().mockResolvedValue(undefined),
    appendEvent: vi.fn().mockResolvedValue(undefined),
    markEnded: vi.fn().mockResolvedValue(undefined),
  };
}

// ─── In-memory Map behaviour (original tests, pass mock repo so no real DB) ──

describe("AgentRunSink — in-memory state", () => {
  it("start() registers a run; getRunSnapshot() returns the initial state", () => {
    const sink = new AgentRunSink(makeMockRepo());
    sink.start("run-1", "turn-1", "emotion", 1000);

    const snap = sink.getRunSnapshot("run-1");
    expect(snap).toBeDefined();
    expect(snap!.turnId).toBe("turn-1");
    expect(snap!.agentKind).toBe("emotion");
    expect(snap!.startedAt).toBe(1000);
    expect(snap!.endedAt).toBeNull();
    expect(snap!.stopReason).toBeNull();
    expect(snap!.events).toHaveLength(0);
  });

  it("record() appends events to the correct run", () => {
    const sink = new AgentRunSink(makeMockRepo());
    sink.start("run-2", "turn-2", "companion", 2000);

    sink.record("run-2", { type: "text_delta", delta: "hello" });
    sink.record("run-2", { type: "text_delta", delta: " world" });

    const snap = sink.getRunSnapshot("run-2");
    expect(snap!.events).toHaveLength(2);
    expect(snap!.events[0]).toMatchObject({ type: "text_delta", delta: "hello" });
    expect(snap!.events[1]).toMatchObject({ type: "text_delta", delta: " world" });
  });

  it("end() sets endedAt and stopReason on the run", () => {
    const sink = new AgentRunSink(makeMockRepo());
    sink.start("run-3", "turn-3", "emotion", 3000);
    sink.record("run-3", { type: "stop", reason: "end_turn" });
    sink.end("run-3", "ok");

    const snap = sink.getRunSnapshot("run-3");
    expect(snap!.stopReason).toBe("ok");
    expect(snap!.endedAt).not.toBeNull();
  });

  it("end() with aborted_by_user records the correct stop_reason", () => {
    const sink = new AgentRunSink(makeMockRepo());
    sink.start("run-4", "turn-4", "emotion", 4000);
    sink.end("run-4", "aborted_by_user");

    const snap = sink.getRunSnapshot("run-4");
    expect(snap!.stopReason).toBe("aborted_by_user");
  });

  it("multiple runs are tracked independently with no cross-contamination", () => {
    const sink = new AgentRunSink(makeMockRepo());
    sink.start("run-a", "turn-a", "emotion", 100);
    sink.start("run-b", "turn-b", "companion", 200);

    sink.record("run-a", { type: "text_delta", delta: "A" });
    sink.record("run-b", { type: "text_delta", delta: "B" });
    sink.record("run-b", { type: "text_delta", delta: "B2" });

    sink.end("run-a", "ok");
    sink.end("run-b", "sli_exceeded");

    expect(sink.runCount()).toBe(2);

    const snapA = sink.getRunSnapshot("run-a");
    expect(snapA!.events).toHaveLength(1);
    expect(snapA!.stopReason).toBe("ok");

    const snapB = sink.getRunSnapshot("run-b");
    expect(snapB!.events).toHaveLength(2);
    expect(snapB!.stopReason).toBe("sli_exceeded");
  });
});

// ─── Repo delegation (Phase 4 new tests) ────────────────────────────────────

describe("AgentRunSink — repo delegation", () => {
  let repo: ReturnType<typeof makeMockRepo>;
  let sink: AgentRunSink;

  beforeEach(() => {
    repo = makeMockRepo();
    sink = new AgentRunSink(repo);
  });

  it("start() calls repo.insertStart with correct fields", async () => {
    sink.start("run-x", "turn-x", "emotion", 5000);
    await Promise.resolve(); // flush microtasks
    expect(repo.insertStart).toHaveBeenCalledOnce();
    expect(repo.insertStart).toHaveBeenCalledWith({
      id: "run-x",
      turn_id: "turn-x",
      agent_kind: "emotion",
      started_at: 5000,
    });
  });

  it("record() calls repo.appendEvent with the event", async () => {
    sink.start("run-y", "turn-y", "companion", 6000);
    await Promise.resolve();
    repo.appendEvent.mockClear();

    sink.record("run-y", { type: "tool_use", tool: "search" });
    await Promise.resolve();
    expect(repo.appendEvent).toHaveBeenCalledOnce();
    expect(repo.appendEvent).toHaveBeenCalledWith("run-y", {
      type: "tool_use",
      tool: "search",
    });
  });

  it("end() calls repo.markEnded with runId, timestamp, and stopReason", async () => {
    sink.start("run-z", "turn-z", "emotion", 7000);
    await Promise.resolve();
    sink.end("run-z", "ok");
    await Promise.resolve();
    expect(repo.markEnded).toHaveBeenCalledOnce();
    const [runId, , stopReason] = repo.markEnded.mock.calls[0] as [string, number, string];
    expect(runId).toBe("run-z");
    expect(stopReason).toBe("ok");
  });

  it("repo failure in start() does not throw or reject", () => {
    repo.insertStart.mockRejectedValue(new Error("DB offline"));
    expect(() => sink.start("run-err", "turn-err", "emotion", 8000)).not.toThrow();
  });

  it("repo failure in record() does not throw or reject", async () => {
    sink.start("run-err2", "turn-err2", "emotion", 9000);
    await Promise.resolve();
    repo.appendEvent.mockRejectedValue(new Error("DB offline"));
    expect(() => sink.record("run-err2", { type: "stop" })).not.toThrow();
  });

  it("repo failure in end() does not throw or reject", async () => {
    sink.start("run-err3", "turn-err3", "emotion", 10000);
    await Promise.resolve();
    repo.markEnded.mockRejectedValue(new Error("DB offline"));
    expect(() => sink.end("run-err3", "error")).not.toThrow();
  });
});
