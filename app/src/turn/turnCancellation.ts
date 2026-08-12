/**
 * turnCancellation.ts — Phase 1 子线 C (新增功能)
 *
 * TurnCancellationManager manages the AbortController lifecycle for pi-agent
 * turns. This is NEW functionality — Orchestrator.ts currently has zero
 * AbortController references (`grep AbortController app/src/turn/Orchestrator.ts`
 * returns nothing, confirmed in spike 2026-08-03).
 *
 * Concurrency semantics (v3.1 §并发语义 mini-spec):
 *   Strategy: ABORT. When a new user input arrives, the running agent turn
 *   (if any) is immediately aborted — no queue, no reject. This is a
 *   single-user desktop product; new input == new intent.
 *
 *   Abort accounting: the aborted turn is recorded in agent_runs with
 *   stop_reason = "aborted_by_user" (handled by AgentRunSink, not here).
 *
 *   Legacy path: current legacy provider.chat has no abort capability.
 *   When a new turn arrives, the old HTTP response is silently discarded
 *   once it lands (state machine has already advanced). No change from
 *   current behaviour.
 *
 * Module boundary (v3.1 §module 边界):
 *   - TurnCancellationManager owns the AbortController.
 *   - Orchestrator calls manager.currentSignal() / manager.abortAndStart().
 *   - AgentRunSink observes the signal to record aborted runs.
 *   - Orchestrator does NOT own or create AbortController directly.
 *
 * Phase 2 wiring point: Orchestrator.onUserInput will call
 *   abortAndStart(newTurnId) before constructing the new pi Agent.
 */

export class TurnCancellationManager {
  private controller: AbortController | null = null;
  private currentTurnId: string | null = null;

  /**
   * Returns the AbortSignal for the currently running turn, or undefined
   * if no turn is active.
   */
  currentSignal(): AbortSignal | undefined {
    return this.controller?.signal;
  }

  /**
   * Call when a new turn begins. Immediately aborts the currently running
   * turn (if any), then creates a fresh AbortController for the new turn.
   *
   * Returns the AbortSignal for the new turn — pass this into the pi Agent
   * so it can honour cancellation.
   *
   * Strategy: abort (not queue, not reject) — see §并发语义 mini-spec above.
   */
  abortAndStart(newTurnId: string): AbortSignal {
    if (this.controller) {
      try {
        this.controller.abort();
      } catch {
        // AbortController.abort() should never throw, but guard defensively.
      }
    }
    this.controller = new AbortController();
    this.currentTurnId = newTurnId;
    return this.controller.signal;
  }

  /**
   * Call when the turn identified by `turnId` completes normally (not via
   * abort). Clears internal state so currentSignal() returns undefined.
   *
   * If `turnId` does not match the current turn (i.e. the turn was already
   * superseded by a newer abortAndStart call), this is a no-op — the newer
   * turn's controller must not be touched.
   */
  finish(turnId: string): void {
    if (this.currentTurnId === turnId) {
      this.controller = null;
      this.currentTurnId = null;
    }
    // Old turn finishing after being superseded → intentional no-op.
  }

  /** Exposed for testing only: returns the current tracked turn id. */
  _currentTurnId(): string | null {
    return this.currentTurnId;
  }
}
