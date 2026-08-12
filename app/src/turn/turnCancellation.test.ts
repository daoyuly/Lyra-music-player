import { describe, it, expect } from "vitest";
import { TurnCancellationManager } from "./turnCancellation";

describe("TurnCancellationManager", () => {
  it("currentSignal() returns undefined when no turn has started", () => {
    const mgr = new TurnCancellationManager();
    expect(mgr.currentSignal()).toBeUndefined();
  });

  it("abortAndStart() returns a live AbortSignal for the new turn", () => {
    const mgr = new TurnCancellationManager();
    const signal = mgr.abortAndStart("turn-1");
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal.aborted).toBe(false);
    expect(mgr.currentSignal()).toBe(signal);
    expect(mgr._currentTurnId()).toBe("turn-1");
  });

  it("abortAndStart() aborts the previous turn's signal before starting the new one", () => {
    const mgr = new TurnCancellationManager();
    const oldSignal = mgr.abortAndStart("turn-1");
    expect(oldSignal.aborted).toBe(false);

    const newSignal = mgr.abortAndStart("turn-2");
    // Old signal must now be aborted
    expect(oldSignal.aborted).toBe(true);
    // New signal is fresh
    expect(newSignal.aborted).toBe(false);
    expect(mgr.currentSignal()).toBe(newSignal);
    expect(mgr._currentTurnId()).toBe("turn-2");
  });

  it("finish() clears state when called with the current turnId", () => {
    const mgr = new TurnCancellationManager();
    mgr.abortAndStart("turn-1");
    mgr.finish("turn-1");
    expect(mgr.currentSignal()).toBeUndefined();
    expect(mgr._currentTurnId()).toBeNull();
  });

  it("finish() is a no-op when called with a stale (superseded) turnId", () => {
    const mgr = new TurnCancellationManager();
    mgr.abortAndStart("turn-1");
    const newSignal = mgr.abortAndStart("turn-2");

    // Old turn finishes late — must NOT clear the new turn's controller
    mgr.finish("turn-1");

    expect(mgr.currentSignal()).toBe(newSignal);
    expect(mgr._currentTurnId()).toBe("turn-2");
    expect(newSignal.aborted).toBe(false);
  });
});
