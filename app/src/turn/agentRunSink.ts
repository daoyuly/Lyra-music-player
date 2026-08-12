/**
 * agentRunSink.ts — Phase 4
 *
 * AgentRunSink records pi Agent event streams into the `agent_runs` SQLite
 * table AND maintains an in-memory Map for fast UI reads.
 *
 * Dual-write strategy:
 *   - In-memory Map → fast reads for DataExplorer / tests; GC'd after 30 min.
 *   - SQLite via agentRunsRepo → persistent across restarts.
 *   - All repo calls are fire-and-forget; DB failure does NOT crash the agent.
 *
 * Dependency-injection: the constructor accepts an optional `repo` parameter
 * so tests can pass a mock repo without touching the real SQLite layer.
 *
 * Usage pattern:
 *   const sink = new AgentRunSink();
 *   const runId = crypto.randomUUID();
 *   sink.start(runId, turnId, "emotion", Date.now());
 *   agent.subscribe((event) => sink.record(runId, event));
 *   await agent.prompt(...);
 *   sink.end(runId, "ok");  // or "aborted_by_user" if signal fired
 *
 * Module boundary (v3.1 §module 边界):
 *   Orchestrator passes sink to Agent — it does NOT handle events directly.
 *   AgentRunSink is the single owner of all agent run accounting.
 */

import * as defaultRepo from "../db/repo/agentRunsRepo";
import type { AgentRunEvent as RepoAgentRunEvent } from "../db/repo/agentRunsRepo";

export type AgentRunEvent = { type: string; [k: string]: unknown };

export type StopReason = "ok" | "sli_exceeded" | "error" | "aborted_by_user";

type RunRecord = {
  turnId: string;
  agentKind: "emotion" | "companion";
  startedAt: number;
  endedAt: number | null;
  stopReason: StopReason | null;
  events: AgentRunEvent[];
};

/** Minimal repo interface — allows DI of mock in tests. */
export type AgentRunRepo = {
  insertStart(run: {
    id: string;
    turn_id: string;
    agent_kind: "emotion" | "companion";
    started_at: number;
  }): Promise<void>;
  appendEvent(runId: string, event: RepoAgentRunEvent): Promise<void>;
  markEnded(runId: string, ended_at: number, stop_reason: string): Promise<void>;
};

/** In-memory entries older than this are eligible for GC. */
const GC_TTL_MS = 30 * 60 * 1000; // 30 minutes

export class AgentRunSink {
  /** In-memory run store. Keys are runId strings. */
  private runs: Map<string, RunRecord> = new Map();
  private repo: AgentRunRepo;

  constructor(repo: AgentRunRepo = defaultRepo) {
    this.repo = repo;
  }

  /**
   * Mark the start of a new agent run. Call once per turn before subscribing
   * the agent event stream.
   *
   * @param runId      Unique id for this run (caller provides, e.g. crypto.randomUUID()).
   * @param turnId     The dialogue turn this run belongs to.
   * @param agentKind  Which agent is running ("emotion" | "companion").
   * @param now        Timestamp in ms (injectable for tests).
   */
  start(
    runId: string,
    turnId: string,
    agentKind: "emotion" | "companion",
    now: number,
  ): void {
    this.runs.set(runId, {
      turnId,
      agentKind,
      startedAt: now,
      endedAt: null,
      stopReason: null,
      events: [],
    });
    void this.repo
      .insertStart({ id: runId, turn_id: turnId, agent_kind: agentKind, started_at: now })
      .catch((err) => console.warn(`[agentRunSink] insertStart failed:`, err));
    console.debug(`[agentRunSink] start runId=${runId} kind=${agentKind} turnId=${turnId}`);
    this._gc();
  }

  /**
   * Record a single event from the agent's event stream.
   * Call this as the subscriber callback: `agent.subscribe(e => sink.record(runId, e))`.
   *
   * Unknown runId is a no-op with a warning (handles race where end() was
   * called before a late event arrives).
   */
  record(runId: string, event: AgentRunEvent): void {
    const run = this.runs.get(runId);
    if (!run) {
      console.warn(`[agentRunSink] record: unknown runId=${runId}`);
      return;
    }
    run.events.push(event);
    void this.repo
      .appendEvent(runId, event as RepoAgentRunEvent)
      .catch((err) => console.warn(`[agentRunSink] appendEvent failed:`, err));
    console.debug(`[agentRunSink] record runId=${runId} event.type=${event.type}`);
  }

  /**
   * Mark the run as ended. Call after agent.prompt() resolves (or rejects /
   * aborts). For aborted turns, pass stopReason = "aborted_by_user".
   *
   * Unknown runId is a no-op with a warning.
   */
  end(runId: string, stopReason: StopReason): void {
    const run = this.runs.get(runId);
    if (!run) {
      console.warn(`[agentRunSink] end: unknown runId=${runId}`);
      return;
    }
    const endedAt = Date.now();
    run.endedAt = endedAt;
    run.stopReason = stopReason;
    void this.repo
      .markEnded(runId, endedAt, stopReason)
      .catch((err) => console.warn(`[agentRunSink] markEnded failed:`, err));
    console.debug(
      `[agentRunSink] end runId=${runId} reason=${stopReason} events=${run.events.length}`,
    );
  }

  /**
   * Retrieve a run record (for tests and DataExplorer — read-only snapshot).
   * Returns undefined if the runId is unknown.
   */
  getRunSnapshot(runId: string): Readonly<RunRecord> | undefined {
    return this.runs.get(runId);
  }

  /** Return the total number of runs tracked (for tests). */
  runCount(): number {
    return this.runs.size;
  }

  /**
   * Evict in-memory entries whose endedAt is older than GC_TTL_MS.
   * Called on every start() so GC happens lazily without a timer.
   */
  private _gc(): void {
    const cutoff = Date.now() - GC_TTL_MS;
    for (const [id, run] of this.runs) {
      if (run.endedAt !== null && run.endedAt < cutoff) {
        this.runs.delete(id);
      }
    }
  }
}
