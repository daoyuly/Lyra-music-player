/**
 * ui/RuleTriggerHeatmap.tsx — Show which perception rules fire most
 *
 * Reads perception_audit rows and extracts which rules were triggered
 * (matched by canonical reason substrings). Displays a horizontal bar
 * chart of counts per rule.
 *
 * Sprint 20 Task 1
 */

import { useState, useEffect } from "react";
import * as perceptionAuditRepo from "../db/repo/perceptionAuditRepo";
import type { PerceptionAuditRow } from "../db/repo/perceptionAuditRepo";

/**
 * Rules with canonical reason substrings from RulePerceptionAgent.
 * Keep in sync with app/src/perception/RulePerceptionAgent.ts:buildRules.
 */
export const RULE_PATTERNS: { name: string; label: string; pattern: string }[] = [
  { name: "high_skip_ratio", label: "跳过频繁 (frustration)", pattern: "high skip ratio" },
  { name: "long_idle", label: "长时间闲置", pattern: "extended blur/idle" },
  { name: "rapid_submits", label: "快速提交 (engaged)", pattern: "rapid succession" },
  { name: "proactive_dismissed", label: "拒绝主动打招呼", pattern: "user dismissing" },
  { name: "high_completion", label: "持续听完 (resonance)", pattern: "sustained listens" },
  { name: "attentive_hover", label: "悬停关注", pattern: "hover dwell" },
  { name: "hesitant_input", label: "犹豫输入", pattern: "typed-then-discarded" },
  { name: "quiet_presence", label: "在场安静 (presence)", pattern: "in the room" },
  { name: "fatigue_high", label: "疲劳", pattern: "sustained keyboard/mouse" },
  { name: "weather", label: "天气影响", pattern: "weather" },
];

/**
 * Count triggers per rule from a set of audit rows.
 */
export function countRuleTriggers(rows: PerceptionAuditRow[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const pattern of RULE_PATTERNS) counts.set(pattern.name, 0);

  for (const row of rows) {
    let reason = "";
    try {
      const bias = JSON.parse(row.bias_json);
      reason = typeof bias.reason === "string" ? bias.reason : "";
    } catch {
      continue;
    }
    for (const p of RULE_PATTERNS) {
      if (reason.includes(p.pattern)) {
        counts.set(p.name, (counts.get(p.name) ?? 0) + 1);
      }
    }
  }

  return counts;
}

export function RuleTriggerHeatmap() {
  const [rows, setRows] = useState<PerceptionAuditRow[] | null>(null);

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
      <div
        data-testid="rule-heatmap-empty"
        style={{ opacity: 0.6, padding: "1rem" }}
      >
        感知层还没写入数据。
      </div>
    );
  }

  const counts = countRuleTriggers(rows);
  const maxCount = Math.max(...Array.from(counts.values()), 1);

  return (
    <div data-testid="rule-trigger-heatmap" style={{ padding: "0.5rem" }}>
      <div style={{ fontSize: "0.85rem", opacity: 0.7, marginBottom: "0.75rem" }}>
        规则触发频率 ({rows.length} 条审计记录)
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
        {RULE_PATTERNS.map((rule) => {
          const count = counts.get(rule.name) ?? 0;
          const intensity = count / maxCount;
          const bg = intensityColor(intensity);
          return (
            <div
              key={rule.name}
              data-testid={`rule-row-${rule.name}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                fontSize: "0.8rem",
              }}
            >
              <div style={{ minWidth: 180, opacity: 0.85 }}>{rule.label}</div>
              <div
                style={{
                  flex: 1,
                  height: 20,
                  background: "rgba(0,0,0,0.03)",
                  borderRadius: "3px",
                  overflow: "hidden",
                  position: "relative",
                }}
              >
                <div
                  data-testid={`rule-bar-${rule.name}`}
                  style={{
                    width: `${Math.max(2, intensity * 100)}%`,
                    height: "100%",
                    background: bg,
                    transition: "width 0.2s",
                  }}
                />
              </div>
              <div style={{ minWidth: 40, textAlign: "right", opacity: 0.75 }}>
                {count}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Yellow → orange → red gradient based on intensity 0-1. */
function intensityColor(intensity: number): string {
  if (intensity <= 0) return "rgba(0,0,0,0.05)";
  if (intensity < 0.3) return "#FFECB3";
  if (intensity < 0.6) return "#FFB74D";
  if (intensity < 0.85) return "#FF8A65";
  return "#E57373";
}
