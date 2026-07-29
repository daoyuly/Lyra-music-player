import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { RuleTriggerHeatmap, countRuleTriggers, RULE_PATTERNS } from "./RuleTriggerHeatmap";
import * as perceptionAuditRepo from "../db/repo/perceptionAuditRepo";
import type { PerceptionAuditRow } from "../db/repo/perceptionAuditRepo";

vi.mock("../db/repo/perceptionAuditRepo");

function makeRow(id: string, reason: string, ts = Date.now()): PerceptionAuditRow {
  return {
    id,
    ts,
    source: "rule",
    features_json: "{}",
    bias_json: JSON.stringify({
      pad_bias: { p: 0, a: 0, d: 0 },
      confidence: 0.5,
      reason,
    }),
  };
}

describe("countRuleTriggers", () => {
  it("returns zero counts for empty rows", () => {
    const counts = countRuleTriggers([]);
    expect(counts.size).toBe(RULE_PATTERNS.length);
    for (const p of RULE_PATTERNS) {
      expect(counts.get(p.name)).toBe(0);
    }
  });

  it("counts single-rule matches", () => {
    const rows = [
      makeRow("r1", "high skip ratio suggests frustration"),
      makeRow("r2", "high skip ratio suggests frustration"),
    ];
    const counts = countRuleTriggers(rows);
    expect(counts.get("high_skip_ratio")).toBe(2);
    expect(counts.get("long_idle")).toBe(0);
  });

  it("counts multiple rules in a joined reason", () => {
    const rows = [
      makeRow("r1", "high skip ratio suggests frustration; hover dwell suggests attention to ambient"),
    ];
    const counts = countRuleTriggers(rows);
    expect(counts.get("high_skip_ratio")).toBe(1);
    expect(counts.get("attentive_hover")).toBe(1);
  });

  it("skips rows with malformed bias_json", () => {
    const badRow: PerceptionAuditRow = {
      id: "bad",
      ts: 0,
      source: "rule",
      features_json: "{}",
      bias_json: "not json",
    };
    const rows = [badRow, makeRow("good", "high skip ratio")];
    const counts = countRuleTriggers(rows);
    expect(counts.get("high_skip_ratio")).toBe(1);
  });

  it("skips rules that don't match any pattern", () => {
    const rows = [makeRow("r1", "unknown reason not matching any rule")];
    const counts = countRuleTriggers(rows);
    for (const p of RULE_PATTERNS) {
      expect(counts.get(p.name)).toBe(0);
    }
  });
});

describe("RuleTriggerHeatmap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows loading state initially", () => {
    vi.spyOn(perceptionAuditRepo, "listRecent").mockReturnValue(new Promise(() => {}));
    render(<RuleTriggerHeatmap />);
    expect(screen.getByText(/加载中/)).toBeTruthy();
  });

  it("shows empty state when no audit data", async () => {
    vi.spyOn(perceptionAuditRepo, "listRecent").mockResolvedValue([]);
    render(<RuleTriggerHeatmap />);
    await waitFor(() => {
      expect(screen.getByTestId("rule-heatmap-empty")).toBeTruthy();
    });
  });

  it("renders all rules with counts", async () => {
    vi.spyOn(perceptionAuditRepo, "listRecent").mockResolvedValue([
      makeRow("r1", "high skip ratio suggests frustration"),
      makeRow("r2", "hover dwell suggests attention"),
    ]);

    render(<RuleTriggerHeatmap />);
    await waitFor(() => {
      expect(screen.getByTestId("rule-trigger-heatmap")).toBeTruthy();
    });

    // Each rule should have a row
    for (const p of RULE_PATTERNS) {
      expect(screen.getByTestId(`rule-row-${p.name}`)).toBeTruthy();
    }
  });

  it("displays the total audit row count in header", async () => {
    vi.spyOn(perceptionAuditRepo, "listRecent").mockResolvedValue([
      makeRow("r1", "test"),
      makeRow("r2", "test"),
      makeRow("r3", "test"),
    ]);

    render(<RuleTriggerHeatmap />);
    await waitFor(() => {
      expect(screen.getByText(/3 条审计记录/)).toBeTruthy();
    });
  });

  it("handles fetch errors gracefully", async () => {
    vi.spyOn(perceptionAuditRepo, "listRecent").mockRejectedValue(new Error("db error"));

    render(<RuleTriggerHeatmap />);
    await waitFor(() => {
      expect(screen.getByTestId("rule-heatmap-empty")).toBeTruthy();
    });
  });
});
