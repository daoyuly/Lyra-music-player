/**
 * ui/ShiftEffectivenessPanel.tsx — Visualize shift recommendation success
 *
 * Reads shift_feedback rows and renders a bar chart + stats table showing
 * which shifts (接住/点燃/陪着/打断) most often lead to complete vs skip.
 *
 * Sprint 18 Task 1
 */

import { useState, useEffect } from "react";
import * as shiftFeedbackRepo from "../db/repo/shiftFeedbackRepo";
import type { ShiftFeedback } from "../perception/shiftFeedback";
import { computeShiftStats } from "../perception/shiftFeedback";
import type { ShiftStats } from "../perception/shiftFeedback";

const SHIFT_COLORS: Record<string, string> = {
  接住: "#4CAF50",
  点燃: "#FF7043",
  陪着: "#64B5F6",
  打断: "#BA68C8",
};

const BAR_WIDTH = 60;
const BAR_MAX_HEIGHT = 120;

export function ShiftEffectivenessPanel() {
  const [feedback, setFeedback] = useState<ShiftFeedback[] | null>(null);

  useEffect(() => {
    shiftFeedbackRepo
      .listRecent(500)
      .then(setFeedback)
      .catch(() => setFeedback([]));
  }, []);

  if (feedback === null) {
    return <div style={{ opacity: 0.6, padding: "1rem" }}>加载中…</div>;
  }

  if (feedback.length === 0) {
    return (
      <div
        data-testid="shift-panel-empty"
        style={{ opacity: 0.6, padding: "1rem" }}
      >
        还没有 shift 反馈数据。听几首歌后就会有数据了。
      </div>
    );
  }

  const stats = computeShiftStats(feedback);

  return (
    <div data-testid="shift-effectiveness-panel" style={{ padding: "0.5rem" }}>
      <div style={{ fontSize: "0.85rem", opacity: 0.7, marginBottom: "0.75rem" }}>
        Shift 推荐效率（{feedback.length} 条反馈）
      </div>
      <BarChart stats={stats} />
      <StatsTable stats={stats} />
    </div>
  );
}

function BarChart({ stats }: { stats: ShiftStats[] }) {
  const maxTotal = Math.max(...stats.map((s) => s.totalRecommendations), 1);
  const chartWidth = stats.length * (BAR_WIDTH + 24) + 40;
  const chartHeight = BAR_MAX_HEIGHT + 50;

  return (
    <div data-testid="shift-bar-chart" style={{ marginBottom: "1rem" }}>
      <svg
        width={chartWidth}
        height={chartHeight}
        style={{ background: "rgba(0,0,0,0.02)", borderRadius: "4px" }}
      >
        {stats.map((s, i) => {
          const totalHeight = (s.totalRecommendations / maxTotal) * BAR_MAX_HEIGHT;
          const completeHeight = (s.completes / maxTotal) * BAR_MAX_HEIGHT;
          const x = 20 + i * (BAR_WIDTH + 24);
          const yBase = 20 + BAR_MAX_HEIGHT;
          const color = SHIFT_COLORS[s.shift] ?? "#888";
          return (
            <g key={s.shift} data-testid={`shift-bar-${s.shift}`}>
              {/* Total bar (background) */}
              <rect
                x={x}
                y={yBase - totalHeight}
                width={BAR_WIDTH}
                height={totalHeight}
                fill={color}
                opacity={0.25}
                rx={3}
              />
              {/* Complete portion (foreground) */}
              <rect
                x={x}
                y={yBase - completeHeight}
                width={BAR_WIDTH}
                height={completeHeight}
                fill={color}
                rx={3}
              />
              {/* Label */}
              <text
                x={x + BAR_WIDTH / 2}
                y={yBase + 18}
                textAnchor="middle"
                fontSize="12"
                fill="#333"
              >
                {s.shift}
              </text>
              {/* Success rate above bar */}
              {s.totalRecommendations > 0 && (
                <text
                  x={x + BAR_WIDTH / 2}
                  y={yBase - totalHeight - 6}
                  textAnchor="middle"
                  fontSize="11"
                  fill="#555"
                  fontWeight={500}
                >
                  {(s.successRate * 100).toFixed(0)}%
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div style={{ fontSize: "0.7rem", opacity: 0.6, marginTop: "0.25rem" }}>
        实心 = 完整播放；淡色 = 跳过。数字为成功率。
      </div>
    </div>
  );
}

function StatsTable({ stats }: { stats: ShiftStats[] }) {
  return (
    <div data-testid="shift-stats-table">
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: "0.8rem",
        }}
      >
        <thead>
          <tr style={{ opacity: 0.7 }}>
            <th style={cellStyle}>Shift</th>
            <th style={cellStyle}>总次数</th>
            <th style={cellStyle}>完成</th>
            <th style={cellStyle}>跳过</th>
            <th style={cellStyle}>成功率</th>
            <th style={cellStyle}>平均听时</th>
          </tr>
        </thead>
        <tbody>
          {stats.map((s) => (
            <tr key={s.shift}>
              <td style={{ ...cellStyle, color: SHIFT_COLORS[s.shift] }}>
                <strong>{s.shift}</strong>
              </td>
              <td style={cellStyle}>{s.totalRecommendations}</td>
              <td style={cellStyle}>{s.completes}</td>
              <td style={cellStyle}>{s.skips}</td>
              <td style={cellStyle}>
                {s.totalRecommendations > 0
                  ? `${(s.successRate * 100).toFixed(0)}%`
                  : "-"}
              </td>
              <td style={cellStyle}>
                {s.completes > 0
                  ? `${Math.round(s.avgTimeToComplete / 1000)}s`
                  : "-"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const cellStyle: React.CSSProperties = {
  padding: "0.35rem 0.5rem",
  textAlign: "left",
  borderBottom: "1px solid rgba(0,0,0,0.08)",
};
