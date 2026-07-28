import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { EmotionDashboard } from "./EmotionDashboard";
import * as perceptionAuditRepo from "../db/repo/perceptionAuditRepo";

vi.mock("../db/repo/perceptionAuditRepo");

const now = Date.now();

function makeRow(id: string, hoursAgo: number, p: number, a: number, d: number, confidence = 0.5) {
  return {
    id,
    ts: now - hoursAgo * 60 * 60 * 1000,
    source: "rule" as const,
    features_json: "{}",
    bias_json: JSON.stringify({
      pad_bias: { p, a, d },
      confidence,
      reason: `test reason ${id}`,
    }),
  };
}

describe("EmotionDashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows loading state initially", () => {
    vi.spyOn(perceptionAuditRepo, "listRecent").mockReturnValue(new Promise(() => {}));
    render(<EmotionDashboard />);
    expect(screen.getByText(/加载中/)).toBeTruthy();
  });

  it("shows empty state when no audit data", async () => {
    vi.spyOn(perceptionAuditRepo, "listRecent").mockResolvedValue([]);
    render(<EmotionDashboard />);
    await waitFor(() => {
      expect(screen.getByText(/感知层还没写入过/)).toBeTruthy();
    });
  });

  it("renders summary stats when data available", async () => {
    const rows = [
      makeRow("r1", 24, 0.3, 0.1, 0),
      makeRow("r2", 12, 0.4, 0.2, 0.05),
      makeRow("r3", 1, 0.5, 0.15, 0.1),
    ];
    vi.spyOn(perceptionAuditRepo, "listRecent").mockResolvedValue(rows);

    render(<EmotionDashboard />);
    await waitFor(() => {
      expect(screen.getByTestId("dashboard-summary")).toBeTruthy();
    });

    expect(screen.getByText("样本数")).toBeTruthy();
    expect(screen.getByText("愉悦度")).toBeTruthy();
    expect(screen.getByText("兴奋度")).toBeTruthy();
    expect(screen.getByText("支配感")).toBeTruthy();
    expect(screen.getByText("波动性")).toBeTruthy();
  });

  it("renders PAD chart when data has enough samples", async () => {
    const rows = [
      makeRow("r1", 24, 0.1, 0.05, 0),
      makeRow("r2", 12, 0.2, 0.1, 0.02),
      makeRow("r3", 1, 0.3, 0.15, 0.05),
    ];
    vi.spyOn(perceptionAuditRepo, "listRecent").mockResolvedValue(rows);

    render(<EmotionDashboard />);
    await waitFor(() => {
      expect(screen.getByTestId("pad-chart")).toBeTruthy();
    });

    expect(screen.getByTestId("pad-line-p")).toBeTruthy();
    expect(screen.getByTestId("pad-line-a")).toBeTruthy();
    expect(screen.getByTestId("pad-line-d")).toBeTruthy();
  });

  it("switches window when button clicked", async () => {
    const rows = [makeRow("r1", 24, 0.1, 0.05, 0)];
    vi.spyOn(perceptionAuditRepo, "listRecent").mockResolvedValue(rows);

    render(<EmotionDashboard />);
    await waitFor(() => {
      expect(screen.getByTestId("window-btn-7d")).toBeTruthy();
    });

    // Click 30d button
    fireEvent.click(screen.getByTestId("window-btn-30d"));
    // Should still render dashboard (just with different data window)
    expect(screen.getByTestId("dashboard-summary")).toBeTruthy();
  });

  it("shows empty chart message when window has no data", async () => {
    // Only one very old sample - falls outside 7d
    const rows = [makeRow("r1", 30 * 24, 0.1, 0.05, 0)]; // 30 days ago
    vi.spyOn(perceptionAuditRepo, "listRecent").mockResolvedValue(rows);

    render(<EmotionDashboard />);
    await waitFor(() => {
      expect(screen.getByTestId("pad-chart-empty")).toBeTruthy();
    });
  });

  it("renders recent reasons list", async () => {
    const rows = [
      makeRow("r1", 1, 0.1, 0.05, 0),
      makeRow("r2", 2, 0.2, 0.1, 0.02),
    ];
    vi.spyOn(perceptionAuditRepo, "listRecent").mockResolvedValue(rows);

    render(<EmotionDashboard />);
    await waitFor(() => {
      expect(screen.getByTestId("recent-reasons")).toBeTruthy();
    });
    expect(screen.getByText(/test reason r1/)).toBeTruthy();
    expect(screen.getByText(/test reason r2/)).toBeTruthy();
  });

  it("handles fetch errors gracefully", async () => {
    vi.spyOn(perceptionAuditRepo, "listRecent").mockRejectedValue(new Error("db error"));

    render(<EmotionDashboard />);
    await waitFor(() => {
      expect(screen.getByText(/感知层还没写入过/)).toBeTruthy();
    });
  });
});
