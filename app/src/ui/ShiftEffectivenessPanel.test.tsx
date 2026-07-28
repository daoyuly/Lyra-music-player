import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ShiftEffectivenessPanel } from "./ShiftEffectivenessPanel";
import * as shiftFeedbackRepo from "../db/repo/shiftFeedbackRepo";
import type { ShiftFeedback } from "../perception/shiftFeedback";
import type { Shift } from "../agents/shiftLogic";

vi.mock("../db/repo/shiftFeedbackRepo");

function makeFeedback(
  shift: Shift,
  action: "complete" | "skip" | "proactive_dismiss",
  timeToActionMs = 60_000,
): ShiftFeedback {
  return {
    turnId: `t-${Math.random().toString(36).slice(2, 8)}`,
    recommendedShift: shift,
    userAction: action,
    padAtTime: { p: 0, a: 0, d: 0 },
    timeToActionMs,
    timestamp: Date.now(),
  };
}

describe("ShiftEffectivenessPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows loading state initially", () => {
    vi.spyOn(shiftFeedbackRepo, "listRecent").mockReturnValue(new Promise(() => {}));
    render(<ShiftEffectivenessPanel />);
    expect(screen.getByText(/加载中/)).toBeTruthy();
  });

  it("shows empty state when no feedback data", async () => {
    vi.spyOn(shiftFeedbackRepo, "listRecent").mockResolvedValue([]);
    render(<ShiftEffectivenessPanel />);
    await waitFor(() => {
      expect(screen.getByTestId("shift-panel-empty")).toBeTruthy();
    });
  });

  it("renders bar chart when data available", async () => {
    vi.spyOn(shiftFeedbackRepo, "listRecent").mockResolvedValue([
      makeFeedback("接住", "complete"),
      makeFeedback("接住", "complete"),
      makeFeedback("接住", "skip"),
      makeFeedback("点燃", "complete"),
      makeFeedback("陪着", "skip"),
    ]);

    render(<ShiftEffectivenessPanel />);
    await waitFor(() => {
      expect(screen.getByTestId("shift-bar-chart")).toBeTruthy();
    });

    // All 4 shifts should have bars (even 打断 with 0 samples)
    expect(screen.getByTestId("shift-bar-接住")).toBeTruthy();
    expect(screen.getByTestId("shift-bar-点燃")).toBeTruthy();
    expect(screen.getByTestId("shift-bar-陪着")).toBeTruthy();
    expect(screen.getByTestId("shift-bar-打断")).toBeTruthy();
  });

  it("renders stats table with all 4 shifts", async () => {
    vi.spyOn(shiftFeedbackRepo, "listRecent").mockResolvedValue([
      makeFeedback("接住", "complete"),
    ]);

    render(<ShiftEffectivenessPanel />);
    await waitFor(() => {
      expect(screen.getByTestId("shift-stats-table")).toBeTruthy();
    });

    // Table headers
    expect(screen.getByText("Shift")).toBeTruthy();
    expect(screen.getByText("总次数")).toBeTruthy();
    expect(screen.getByText("成功率")).toBeTruthy();
  });

  it("displays success rate percentage", async () => {
    vi.spyOn(shiftFeedbackRepo, "listRecent").mockResolvedValue([
      makeFeedback("接住", "complete"),
      makeFeedback("接住", "complete"),
      makeFeedback("接住", "complete"),
      makeFeedback("接住", "skip"),
    ]);

    render(<ShiftEffectivenessPanel />);
    await waitFor(() => {
      // 3/4 = 75%; appears in both bar chart and table
      const percents = screen.getAllByText(/75%/);
      expect(percents.length).toBeGreaterThan(0);
    });
  });

  it("shows average listen time in seconds", async () => {
    vi.spyOn(shiftFeedbackRepo, "listRecent").mockResolvedValue([
      makeFeedback("陪着", "complete", 45_000),
      makeFeedback("陪着", "complete", 75_000),
    ]);

    render(<ShiftEffectivenessPanel />);
    await waitFor(() => {
      // avg (45+75)/2 = 60s
      expect(screen.getByText(/60s/)).toBeTruthy();
    });
  });

  it("handles fetch errors gracefully", async () => {
    vi.spyOn(shiftFeedbackRepo, "listRecent").mockRejectedValue(new Error("db error"));

    render(<ShiftEffectivenessPanel />);
    await waitFor(() => {
      expect(screen.getByTestId("shift-panel-empty")).toBeTruthy();
    });
  });
});
