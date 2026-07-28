/**
 * ui/EmotionDashboard.tsx — Visualize the user's emotional state
 *
 * Reads perception_audit rows and renders:
 * 1. PAD time-series (SVG line chart, 7d window)
 * 2. Emotion timeline summary (trend + volatility)
 * 3. Recent bias reasons (top 5)
 *
 * Sprint 16 Task 1
 */

import { useState, useEffect } from "react";
import * as perceptionAuditRepo from "../db/repo/perceptionAuditRepo";
import type { PerceptionAuditRow } from "../db/repo/perceptionAuditRepo";
import {
  buildTimelineFromAudit,
  auditRowsToSnapshots,
} from "../perception/emotionTimelineFromAudit";
import type { EmotionSnapshot, EmotionTimelineWindow } from "../perception/emotionTimeline";
import { ShiftEffectivenessPanel } from "./ShiftEffectivenessPanel";

const WINDOW_OPTIONS: { id: EmotionTimelineWindow; label: string }[] = [
  { id: "7d", label: "7 天" },
  { id: "30d", label: "30 天" },
  { id: "1y", label: "1 年" },
];

const CHART_WIDTH = 640;
const CHART_HEIGHT = 200;
const CHART_PADDING = 32;

export function EmotionDashboard() {
  const [rows, setRows] = useState<PerceptionAuditRow[] | null>(null);
  const [window, setWindow] = useState<EmotionTimelineWindow>("7d");

  useEffect(() => {
    perceptionAuditRepo
      .listRecent(500)
      .then(setRows)
      .catch(() => setRows([]));
  }, []);

  if (rows === null) {
    return <div style={{ opacity: 0.6, padding: "1rem" }}>加载中…</div>;
  }

  if (rows.length === 0) {
    return (
      <div style={{ opacity: 0.6, padding: "1rem" }}>
        感知层还没写入过数据。开启 Perception 后每 60 秒会写入一条。
      </div>
    );
  }

  const snapshots = auditRowsToSnapshots(rows);
  const timeline = buildTimelineFromAudit(rows, window);

  return (
    <div data-testid="emotion-dashboard" style={{ padding: "0.5rem" }}>
      {/* Window selector */}
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
        {WINDOW_OPTIONS.map((opt) => (
          <button
            key={opt.id}
            data-testid={`window-btn-${opt.id}`}
            onClick={() => setWindow(opt.id)}
            style={{
              background: window === opt.id ? "#3c5aa6" : "transparent",
              color: window === opt.id ? "#fff" : "#666",
              border: "1px solid #3c5aa6",
              borderRadius: "4px",
              padding: "0.35rem 0.75rem",
              cursor: "pointer",
              fontSize: "0.85rem",
            }}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Summary card */}
      <div
        data-testid="dashboard-summary"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
          gap: "0.5rem",
          marginBottom: "1rem",
          padding: "0.75rem",
          background: "rgba(60, 90, 166, 0.05)",
          borderRadius: "6px",
        }}
      >
        <SummaryStat label="样本数" value={String(timeline.sampleCount)} />
        <SummaryStat
          label="愉悦度"
          value={timeline.avgPad.p.toFixed(2)}
          trend={timeline.pleasureTrend}
        />
        <SummaryStat
          label="兴奋度"
          value={timeline.avgPad.a.toFixed(2)}
          trend={timeline.arousalTrend}
        />
        <SummaryStat
          label="支配感"
          value={timeline.avgPad.d.toFixed(2)}
          trend={timeline.dominanceTrend}
        />
        <SummaryStat
          label="波动性"
          value={`${(timeline.volatility * 100).toFixed(0)}%`}
        />
      </div>

      {/* PAD Chart */}
      <PadTimeChart snapshots={snapshots} window={window} />

      {/* Recent reasons (last 5) */}
      <RecentReasons rows={rows.slice(0, 5)} />

      {/* Sprint 18: shift effectiveness panel */}
      <div style={{ marginTop: "1.5rem", borderTop: "1px solid rgba(0,0,0,0.1)", paddingTop: "1rem" }}>
        <ShiftEffectivenessPanel />
      </div>
    </div>
  );
}

function SummaryStat({
  label,
  value,
  trend,
}: {
  label: string;
  value: string;
  trend?: "improving" | "declining" | "stable";
}) {
  const trendColor =
    trend === "improving" ? "#4CAF50" : trend === "declining" ? "#E57373" : "#888";
  const trendMark =
    trend === "improving" ? "↑" : trend === "declining" ? "↓" : trend === "stable" ? "→" : "";
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: "0.7rem", opacity: 0.6, marginBottom: "0.15rem" }}>
        {label}
      </div>
      <div style={{ fontSize: "1rem", fontWeight: 500 }}>
        {value}{" "}
        {trendMark && (
          <span style={{ color: trendColor, fontSize: "0.85rem" }}>{trendMark}</span>
        )}
      </div>
    </div>
  );
}

function PadTimeChart({
  snapshots,
  window,
}: {
  snapshots: EmotionSnapshot[];
  window: EmotionTimelineWindow;
}) {
  const WINDOW_MS_MAP: Record<EmotionTimelineWindow, number> = {
    "7d": 7 * 24 * 60 * 60 * 1000,
    "30d": 30 * 24 * 60 * 60 * 1000,
    "1y": 365 * 24 * 60 * 60 * 1000,
  };
  const now = Date.now();
  const cutoff = now - WINDOW_MS_MAP[window];
  const inWindow = snapshots.filter((s) => s.at >= cutoff);

  if (inWindow.length === 0) {
    return (
      <div
        data-testid="pad-chart-empty"
        style={{ opacity: 0.6, textAlign: "center", padding: "2rem" }}
      >
        {window} 窗口内无数据
      </div>
    );
  }

  const minT = Math.min(...inWindow.map((s) => s.at));
  const maxT = Math.max(...inWindow.map((s) => s.at));
  const tRange = maxT - minT || 1;

  const xFor = (t: number) =>
    CHART_PADDING + ((t - minT) / tRange) * (CHART_WIDTH - 2 * CHART_PADDING);
  const yFor = (v: number) =>
    CHART_HEIGHT / 2 - v * (CHART_HEIGHT / 2 - CHART_PADDING);

  const pathFor = (get: (s: EmotionSnapshot) => number) =>
    inWindow
      .map((s, i) => `${i === 0 ? "M" : "L"} ${xFor(s.at)},${yFor(get(s))}`)
      .join(" ");

  return (
    <div data-testid="pad-chart" style={{ marginBottom: "1rem" }}>
      <div style={{ fontSize: "0.85rem", opacity: 0.7, marginBottom: "0.5rem" }}>
        PAD 时间轴 ({inWindow.length} 样本)
      </div>
      <svg
        width={CHART_WIDTH}
        height={CHART_HEIGHT}
        style={{ background: "rgba(0,0,0,0.02)", borderRadius: "4px" }}
      >
        {/* Zero line */}
        <line
          x1={CHART_PADDING}
          x2={CHART_WIDTH - CHART_PADDING}
          y1={CHART_HEIGHT / 2}
          y2={CHART_HEIGHT / 2}
          stroke="rgba(0,0,0,0.15)"
          strokeDasharray="3,3"
        />
        {/* PAD paths */}
        <path
          data-testid="pad-line-p"
          d={pathFor((s) => s.pad.p)}
          fill="none"
          stroke="#FFB74D"
          strokeWidth={1.5}
        />
        <path
          data-testid="pad-line-a"
          d={pathFor((s) => s.pad.a)}
          fill="none"
          stroke="#E57373"
          strokeWidth={1.5}
        />
        <path
          data-testid="pad-line-d"
          d={pathFor((s) => s.pad.d)}
          fill="none"
          stroke="#64B5F6"
          strokeWidth={1.5}
        />
      </svg>
      {/* Legend */}
      <div style={{ display: "flex", gap: "0.75rem", fontSize: "0.75rem", marginTop: "0.35rem" }}>
        <LegendMark color="#FFB74D" label="愉悦度 (P)" />
        <LegendMark color="#E57373" label="兴奋度 (A)" />
        <LegendMark color="#64B5F6" label="支配感 (D)" />
      </div>
    </div>
  );
}

function LegendMark({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
      <span
        style={{
          display: "inline-block",
          width: "10px",
          height: "10px",
          background: color,
          borderRadius: "2px",
        }}
      />
      <span style={{ opacity: 0.75 }}>{label}</span>
    </span>
  );
}

function RecentReasons({ rows }: { rows: PerceptionAuditRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div data-testid="recent-reasons">
      <div style={{ fontSize: "0.85rem", opacity: 0.7, marginBottom: "0.35rem" }}>
        最近推理
      </div>
      <div
        style={{
          border: "1px solid rgba(0,0,0,0.1)",
          borderRadius: "4px",
          overflow: "hidden",
        }}
      >
        {rows.map((r) => {
          let reason = "(no reason)";
          let confidence = 0;
          try {
            const bias = JSON.parse(r.bias_json);
            reason = bias.reason ?? reason;
            confidence = bias.confidence ?? 0;
          } catch {
            /* ignore */
          }
          return (
            <div
              key={r.id}
              style={{
                display: "flex",
                gap: "0.5rem",
                padding: "0.35rem 0.6rem",
                borderBottom: "1px solid rgba(0,0,0,0.05)",
                fontSize: "0.75rem",
                alignItems: "center",
              }}
            >
              <span style={{ opacity: 0.4, minWidth: 140 }}>{formatDateTime(r.ts)}</span>
              <span style={{ opacity: 0.5, minWidth: 40 }}>{r.source}</span>
              <span style={{ flex: 1 }}>{reason}</span>
              <span style={{ opacity: 0.6 }}>{confidence.toFixed(2)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatDateTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
