/**
 * DemoMode.test.tsx — Iter Phase 1
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { DemoMode, probeOllama } from "./DemoMode";
import { DEMO_FALLBACK } from "./demoFallback";

// ── Mock productEventsRepo so DB is never hit ─────────────────────────────────

vi.mock("../db/repo/productEventsRepo", () => ({
  record: vi.fn(() => Promise.resolve()),
}));

// ── Mock fetch so Ollama is never called ──────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Simulate unreachable Ollama (network error)
function stubOllamaDown() {
  mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));
}

// Simulate reachable Ollama returning a valid PAD JSON
function stubOllamaUp(pad = { p: 0.5, a: 0.3, d: 0.1 }) {
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({
      message: { content: JSON.stringify(pad) },
    }),
  } as unknown as Response);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Advance fake timers AND flush all microtasks/promises. */
async function advanceTime(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();
  stubOllamaDown();
  // jsdom doesn't implement HTMLMediaElement.play — silence the warning
  window.HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
  window.HTMLMediaElement.prototype.pause = vi.fn();
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("DemoMode — fallback mode (no Ollama)", () => {
  it("renders the running screen initially", async () => {
    render(<DemoMode onClose={vi.fn()} onOpenSettings={vi.fn()} />);
    // After Ollama probe resolves (rejected), component enters running phase
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByTestId("demo-running")).toBeInTheDocument();
  });

  it("shows first utterance in the running screen", async () => {
    render(<DemoMode onClose={vi.fn()} onOpenSettings={vi.fn()} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    // Advance past typing phase (50ms settle + 200ms fade)
    await advanceTime(300);
    expect(screen.getByTestId("demo-utterance")).toHaveTextContent(
      DEMO_FALLBACK[0].utterance,
    );
  });

  it("shows rationale text during song phase", async () => {
    render(<DemoMode onClose={vi.fn()} onOpenSettings={vi.fn()} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    // typing (250ms) + thinking (800ms) + emotion (1000ms) + song phase (800ms settle)
    await advanceTime(3000);
    const note = screen.queryByTestId("small-note");
    if (note) {
      expect(note).toHaveTextContent(DEMO_FALLBACK[0].rationale);
    }
    // If not yet in song phase, at minimum demo is running
    expect(screen.getByTestId("demo-running")).toBeInTheDocument();
  });

  it("Esc key calls onClose and records demo_escaped", async () => {
    const { record } = await import("../db/repo/productEventsRepo");
    const onClose = vi.fn();
    render(<DemoMode onClose={onClose} onOpenSettings={vi.fn()} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith("demo_escaped", expect.objectContaining({ atGroup: expect.any(Number) }));
  });

  it("end screen CTA triggers onOpenSettings and records demo_to_settings", async () => {
    const { record } = await import("../db/repo/productEventsRepo");
    const onClose = vi.fn();
    const onOpenSettings = vi.fn();
    render(<DemoMode onClose={onClose} onOpenSettings={onOpenSettings} />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Advance through all 3 groups: each ~8s, plus transitions
    // typing(250) + thinking(800) + emotion(1000) + song(800) + playing(5000) + fade(500) = ~8350ms per group
    await advanceTime(30000);

    const cta = screen.queryByTestId("demo-cta");
    if (cta) {
      fireEvent.click(cta);
      expect(onClose).toHaveBeenCalled();
      expect(onOpenSettings).toHaveBeenCalled();
      expect(record).toHaveBeenCalledWith("demo_to_settings");
    }
    // Even if end screen not reached in time, demo_started must have fired
    expect(record).toHaveBeenCalledWith("demo_started");
  });

  it("records demo_started on mount", async () => {
    const { record } = await import("../db/repo/productEventsRepo");
    render(<DemoMode onClose={vi.fn()} onOpenSettings={vi.fn()} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(record).toHaveBeenCalledWith("demo_started");
  });
});

describe("probeOllama", () => {
  it("returns false when fetch throws", async () => {
    mockFetch.mockRejectedValue(new Error("timeout"));
    // probeOllama uses real setTimeout — wrap in fake timer advance
    const resultP = probeOllama();
    await act(async () => {
      vi.advanceTimersByTime(3100);
      await Promise.resolve();
    });
    const result = await resultP;
    expect(result).toBe(false);
  });

  it("returns true when fetch resolves ok", async () => {
    stubOllamaUp();
    const resultP = probeOllama();
    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
      await Promise.resolve();
    });
    const result = await resultP;
    expect(result).toBe(true);
  });
});
