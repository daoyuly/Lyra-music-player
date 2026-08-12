// DataExplorer — full-screen read-only view of every persisted Lyra state.
// Opened via Cmd+Shift+D. Purely for observability; nothing here mutates.

import { useState, useEffect, useCallback } from "react";
import type { DialogueTurn, LibraryTrack, SoulState } from "../types";
import { songDisplayTitle } from "../library/display";
import type { SalientMoment } from "../memory/types";
import * as turnRepo from "../db/repo/turnRepo";
import * as soulRepo from "../db/repo/soulRepo";
import * as sharedMemoryRepo from "../db/repo/sharedMemoryRepo";
import * as libraryRepo from "../db/repo/libraryRepo";
import * as libraryFeaturesRepo from "../db/repo/libraryFeaturesRepo";
import type { LibraryFeatures } from "../db/repo/libraryFeaturesRepo";
import * as lyricsEmbeddingsRepo from "../db/repo/lyricsEmbeddingsRepo";
import * as reasoningTracesRepo from "../db/repo/reasoningTracesRepo";
import type { ReasoningTrace } from "../db/repo/reasoningTracesRepo";
import * as perceptionAuditRepo from "../db/repo/perceptionAuditRepo";
import type { PerceptionAuditRow } from "../db/repo/perceptionAuditRepo";
import * as engineerAuditRepo from "../db/repo/engineerAuditRepo";
import type { EngineerAuditEntry } from "../engineer/types";
import * as roadmapRepo from "../db/repo/roadmapRepo";
import type { RoadmapItem } from "../engineer/types";
import * as featureRequestRepo from "../db/repo/featureRequestRepo";
import type { FeatureRequest } from "../engineer/types";
import * as llmUsageRepo from "../db/repo/llmUsageRepo";
import type {
  LlmUsageEntry,
  UsageAggregate,
} from "../db/repo/llmUsageRepo";
import { readMemoryFile } from "../memory/fileIO";
import { EmotionDashboard } from "./EmotionDashboard";
import * as agentRunsRepo from "../db/repo/agentRunsRepo";
import type { AgentRun } from "../db/repo/agentRunsRepo";
import * as productEventsRepo from "../db/repo/productEventsRepo";
import type { ProductEvent } from "../db/repo/productEventsRepo";

type TabId =
  | "playback"
  | "turns"
  | "soul"
  | "salient"
  | "library"
  | "lyrics_emb"
  | "emotion_dashboard"
  | "perception"
  | "roadmap"
  | "features_req"
  | "engineer"
  | "llm_usage"
  | "reasoning"
  | "memory_md"
  | "agent_runtime"
  | "product_events";

const TABS: { id: TabId; label: string }[] = [
  { id: "playback", label: "播放记录" },
  { id: "agent_runtime", label: "Agent runtime" },
  { id: "product_events", label: "产品埋点" },
  { id: "turns", label: "对话回合" },
  { id: "soul", label: "灵魂状态" },
  { id: "salient", label: "显著时刻" },
  { id: "library", label: "曲库 + 特征" },
  { id: "lyrics_emb", label: "歌词 embedding" },
  { id: "emotion_dashboard", label: "情绪仪表盘" },
  { id: "perception", label: "感知审计" },
  { id: "roadmap", label: "Roadmap" },
  { id: "features_req", label: "功能请求" },
  { id: "engineer", label: "工程师审计" },
  { id: "llm_usage", label: "LLM 用量" },
  { id: "reasoning", label: "推理轨迹" },
  { id: "memory_md", label: "memory.md" },
];

export type DataExplorerProps = {
  open: boolean;
  onClose: () => void;
  initialTab?: TabId;
};

export function DataExplorer({
  open,
  onClose,
  initialTab,
}: DataExplorerProps) {
  const [tab, setTab] = useState<TabId>(initialTab ?? "playback");
  // If parent passes a fresh initialTab when opening, honor it.
  useEffect(() => {
    if (open && initialTab) setTab(initialTab);
  }, [open, initialTab]);
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);

  const toggleRow = useCallback((id: string) => {
    setExpandedRowId((cur) => (cur === id ? null : id));
  }, []);

  // Reset expansion when tab changes
  useEffect(() => setExpandedRowId(null), [tab]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      data-testid="data-explorer"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.9)",
        zIndex: 8500,
        display: "flex",
        flexDirection: "column",
        color: "#fff",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        fontSize: "0.875rem",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          padding: "1rem 1.5rem",
          borderBottom: "1px solid rgba(255,255,255,0.1)",
        }}
      >
        <h2 style={{ margin: 0, fontWeight: 400, letterSpacing: "0.03em" }}>
          Data Explorer
        </h2>
        <span style={{ marginLeft: "1rem", opacity: 0.5, fontSize: "0.8rem" }}>
          Cmd+Shift+D · read-only · Esc to close
        </span>
        <button
          onClick={onClose}
          style={{
            marginLeft: "auto",
            padding: "6px 14px",
            borderRadius: 4,
            border: "1px solid rgba(255,255,255,0.2)",
            background: "transparent",
            color: "#fff",
            cursor: "pointer",
          }}
        >
          Close
        </button>
      </div>

      {/* Tabs */}
      <div
        style={{
          display: "flex",
          padding: "0 1.5rem",
          gap: "0.25rem",
          borderBottom: "1px solid rgba(255,255,255,0.1)",
          overflowX: "auto",
        }}
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            data-testid={`tab-${t.id}`}
            onClick={() => setTab(t.id)}
            style={{
              padding: "0.75rem 1rem",
              background: "transparent",
              border: "none",
              borderBottom:
                tab === t.id
                  ? "2px solid #4caf50"
                  : "2px solid transparent",
              color: tab === t.id ? "#fff" : "rgba(255,255,255,0.6)",
              cursor: "pointer",
              whiteSpace: "nowrap",
              fontSize: "0.875rem",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div
        data-lyra-scroll="data_explorer"
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "1rem 1.5rem",
        }}
      >
        {tab === "playback" && (
          <PlaybackLogPanel expandedId={expandedRowId} onToggle={toggleRow} />
        )}
        {tab === "turns" && (
          <TurnsPanel expandedId={expandedRowId} onToggle={toggleRow} />
        )}
        {tab === "soul" && <SoulPanel />}
        {tab === "salient" && (
          <SalientPanel expandedId={expandedRowId} onToggle={toggleRow} />
        )}
        {tab === "library" && (
          <LibraryPanel expandedId={expandedRowId} onToggle={toggleRow} />
        )}
        {tab === "lyrics_emb" && <LyricsEmbeddingsPanel />}
        {tab === "emotion_dashboard" && <EmotionDashboard />}
        {tab === "perception" && (
          <PerceptionAuditPanel expandedId={expandedRowId} onToggle={toggleRow} />
        )}
        {tab === "roadmap" && (
          <RoadmapPanel expandedId={expandedRowId} onToggle={toggleRow} />
        )}
        {tab === "features_req" && (
          <FeatureRequestsPanel expandedId={expandedRowId} onToggle={toggleRow} />
        )}
        {tab === "engineer" && (
          <EngineerAuditPanel expandedId={expandedRowId} onToggle={toggleRow} />
        )}
        {tab === "llm_usage" && (
          <LlmUsagePanel expandedId={expandedRowId} onToggle={toggleRow} />
        )}
        {tab === "reasoning" && (
          <ReasoningTracesPanel expandedId={expandedRowId} onToggle={toggleRow} />
        )}
        {tab === "memory_md" && <MemoryMdPanel />}
        {tab === "agent_runtime" && (
          <AgentRuntimePanel expandedId={expandedRowId} onToggle={toggleRow} />
        )}
        {tab === "product_events" && (
          <ProductEventsPanel expandedId={expandedRowId} onToggle={toggleRow} />
        )}
      </div>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatTs(ms: number): string {
  return new Date(ms).toLocaleString();
}

function JsonBlock({ data }: { data: unknown }) {
  return (
    <pre
      style={{
        background: "rgba(0,0,0,0.4)",
        padding: "0.75rem",
        borderRadius: 4,
        fontSize: "0.75rem",
        margin: "0.5rem 0 0 0",
        overflowX: "auto",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}
    >
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}

type RowShellProps = {
  id: string;
  expanded: boolean;
  onToggle: (id: string) => void;
  summary: React.ReactNode;
  detail: unknown;
};

function RowShell({ id, expanded, onToggle, summary, detail }: RowShellProps) {
  return (
    <div
      data-testid="data-row"
      onClick={() => onToggle(id)}
      style={{
        padding: "0.75rem 1rem",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        cursor: "pointer",
        background: expanded ? "rgba(255,255,255,0.03)" : "transparent",
      }}
    >
      {summary}
      {expanded && <JsonBlock data={detail} />}
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <p style={{ opacity: 0.5, padding: "1rem 0" }}>{label}</p>
  );
}

// ─── Panels ─────────────────────────────────────────────────────────────────

type PanelProps = {
  expandedId: string | null;
  onToggle: (id: string) => void;
};

// "播放记录" — 一行一次播放:时间 / 曲目 / 用户query / 推荐理由 / 特征。
// 与"对话回合"tab 的区别:这里聚焦"我到底听了什么"这条线,而非 turn 原始 dump。
// 相邻行同曲会高亮,方便一眼看出"卡在同一首"的情况(见 Orchestrator auto-advance
// 只排除上一首的已知限制)。
function PlaybackLogPanel({ expandedId, onToggle }: PanelProps) {
  const [rows, setRows] = useState<
    | {
        turn: DialogueTurn;
        track: LibraryTrack | null;
        features: LibraryFeatures | null;
      }[]
    | null
  >(null);

  useEffect(() => {
    (async () => {
      try {
        const turns = await turnRepo.listRecentTurns(200);
        const songIds = Array.from(
          new Set(turns.map((t) => t.agent_response.song_id)),
        );
        // 曲库通常 <10k 首,一次 listAll 后做 Map 查找,和 LibraryPanel 一致。
        const [allTracks, features] = await Promise.all([
          libraryRepo.listAll(),
          libraryFeaturesRepo.getBatch(songIds),
        ]);
        const trackMap = new Map(allTracks.map((t) => [t.id, t]));
        setRows(
          turns.map((t) => ({
            turn: t,
            track: trackMap.get(t.agent_response.song_id) ?? null,
            features: features.get(t.agent_response.song_id) ?? null,
          })),
        );
      } catch {
        setRows([]);
      }
    })();
  }, []);

  if (rows === null) return <Empty label="加载中…" />;
  if (rows.length === 0) return <Empty label="还没有播放记录" />;

  return (
    <>
      <p style={{ opacity: 0.6, marginBottom: "0.75rem" }}>
        最近 {rows.length} 条播放(新→旧)。相邻行同曲会淡红高亮 —
        用来看"卡在同一首"的情况。
      </p>
      {rows.map((r, i) => {
        const prev = i > 0 ? rows[i - 1] : null;
        const repeatOfPrev =
          prev !== null &&
          prev.turn.agent_response.song_id === r.turn.agent_response.song_id;
        const query = r.turn.user_utterance.content;
        const isProactive =
          r.turn.user_utterance.modality === "proactive-open";
        const f = r.features;
        const featStr = f
          ? `bpm ${f.bpm ?? "—"} · energy ${(f.energy ?? 0).toFixed(2)} · valence ${(f.valence ?? 0).toFixed(2)}`
          : "no features";
        return (
          <RowShell
            key={r.turn.id}
            id={r.turn.id}
            expanded={expandedId === r.turn.id}
            onToggle={onToggle}
            summary={
              <div
                data-testid={
                  repeatOfPrev ? "playback-row-repeat" : "playback-row"
                }
                style={{
                  display: "flex",
                  gap: "0.75rem",
                  alignItems: "baseline",
                  background: repeatOfPrev
                    ? "rgba(229, 115, 115, 0.10)"
                    : undefined,
                  margin: repeatOfPrev ? "-0.75rem -1rem" : undefined,
                  padding: repeatOfPrev ? "0.75rem 1rem" : undefined,
                }}
              >
                <span
                  style={{
                    opacity: 0.5,
                    minWidth: 150,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {formatTs(r.turn.timestamp)}
                </span>
                <span style={{ flex: 1.4 }}>
                  {r.track ? (
                    <>
                      <strong>{songDisplayTitle(r.track)}</strong>
                      {" — "}
                      <span style={{ opacity: 0.7 }}>
                        {r.track.artist ?? "(无艺人)"}
                      </span>
                    </>
                  ) : (
                    <em style={{ opacity: 0.5 }}>
                      (missing track {r.turn.agent_response.song_id.slice(0, 8)}…)
                    </em>
                  )}
                </span>
                <span style={{ flex: 1, opacity: 0.75 }}>
                  {isProactive ? (
                    <em style={{ opacity: 0.55 }}>(自动衔接)</em>
                  ) : query ? (
                    query
                  ) : (
                    <em style={{ opacity: 0.5 }}>(空 query)</em>
                  )}
                </span>
                <span style={{ flex: 1.2, opacity: 0.7 }}>
                  {r.turn.agent_response.rationale || (
                    <em style={{ opacity: 0.5 }}>(no rationale)</em>
                  )}
                </span>
                <span
                  style={{
                    opacity: 0.55,
                    minWidth: 220,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {featStr}
                </span>
              </div>
            }
            detail={{
              turn: r.turn,
              track: r.track,
              features: r.features,
            }}
          />
        );
      })}
    </>
  );
}

function TurnsPanel({ expandedId, onToggle }: PanelProps) {
  const [rows, setRows] = useState<DialogueTurn[] | null>(null);
  useEffect(() => {
    turnRepo.listRecentTurns(100).then(setRows).catch(() => setRows([]));
  }, []);
  if (rows === null) return <Empty label="加载中…" />;
  if (rows.length === 0) return <Empty label="还没有对话回合" />;

  return (
    <>
      {rows.map((t) => (
        <RowShell
          key={t.id}
          id={t.id}
          expanded={expandedId === t.id}
          onToggle={onToggle}
          summary={
            <div style={{ display: "flex", gap: "0.75rem" }}>
              <span style={{ opacity: 0.5, minWidth: 160 }}>
                {formatTs(t.timestamp)}
              </span>
              <span style={{ flex: 1 }}>
                <strong>{t.user_utterance.modality}</strong>
                {" · "}
                {t.user_utterance.content
                  ? t.user_utterance.content.slice(0, 80)
                  : "(空 · autoAdvance)"}
              </span>
              <span style={{ opacity: 0.7 }}>
                → {t.agent_response.rationale?.slice(0, 40) ?? "no rationale"}
              </span>
              <span
                style={{
                  opacity: 0.5,
                  minWidth: 70,
                  textAlign: "right",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {t.turn_latency_ms != null ? `${t.turn_latency_ms}ms` : "—"}
              </span>
            </div>
          }
          detail={t}
        />
      ))}
    </>
  );
}

function SoulPanel() {
  const [soul, setSoul] = useState<SoulState | null | undefined>(undefined);
  useEffect(() => {
    soulRepo.loadSoulState("lyra_001").then(setSoul).catch(() => setSoul(null));
  }, []);
  if (soul === undefined) return <Empty label="加载中…" />;
  if (soul === null) return <Empty label="灵魂状态还没写入过" />;
  return <JsonBlock data={soul} />;
}

function SalientPanel({ expandedId, onToggle }: PanelProps) {
  const [rows, setRows] = useState<SalientMoment[] | null>(null);
  useEffect(() => {
    sharedMemoryRepo.listRecent(50).then(setRows).catch(() => setRows([]));
  }, []);
  if (rows === null) return <Empty label="加载中…" />;
  if (rows.length === 0) return <Empty label="还没有显著时刻" />;
  return (
    <>
      {rows.map((m, i) => {
        const rowId = `salient-${i}`;
        return (
          <RowShell
            key={rowId}
            id={rowId}
            expanded={expandedId === rowId}
            onToggle={onToggle}
            summary={
              <div style={{ display: "flex", gap: "0.75rem" }}>
                <span style={{ opacity: 0.5, minWidth: 200 }}>
                  {m.timestampISO}
                </span>
                <span style={{ flex: 1 }}>{m.songTitle}</span>
                <span style={{ opacity: 0.7 }}>{m.narrative}</span>
              </div>
            }
            detail={m}
          />
        );
      })}
    </>
  );
}

function LibraryPanel({ expandedId, onToggle }: PanelProps) {
  const [tracks, setTracks] = useState<LibraryTrack[] | null>(null);
  const [features, setFeatures] = useState<Map<string, LibraryFeatures>>(new Map());
  useEffect(() => {
    (async () => {
      try {
        const all = await libraryRepo.listAll();
        setTracks(all);
        const f = await libraryFeaturesRepo.getBatch(all.map((t) => t.id));
        setFeatures(f);
      } catch {
        setTracks([]);
      }
    })();
  }, []);
  if (tracks === null) return <Empty label="加载中…" />;
  if (tracks.length === 0) return <Empty label="曲库为空 — 先在 Settings 里导入一个文件夹" />;
  return (
    <>
      <p style={{ opacity: 0.6, marginBottom: "0.75rem" }}>
        共 {tracks.length} 首，有音频特征 {features.size} 首。
      </p>
      {tracks.map((t) => {
        const f = features.get(t.id);
        return (
          <RowShell
            key={t.id}
            id={t.id}
            expanded={expandedId === t.id}
            onToggle={onToggle}
            summary={
              <div style={{ display: "flex", gap: "0.75rem" }}>
                <span style={{ flex: 1 }}>
                  <strong>{songDisplayTitle(t)}</strong>
                  {" — "}
                  {t.artist ?? "(无艺人)"}
                </span>
                <span style={{ opacity: 0.6, minWidth: 200 }}>
                  {f
                    ? `energy ${(f.energy ?? 0).toFixed(2)} · valence ${(f.valence ?? 0).toFixed(2)} · bpm ${f.bpm ?? "—"}`
                    : "no features"}
                </span>
              </div>
            }
            detail={{ track: t, features: f ?? null }}
          />
        );
      })}
    </>
  );
}

function PerceptionAuditPanel({ expandedId, onToggle }: PanelProps) {
  const [rows, setRows] = useState<PerceptionAuditRow[] | null>(null);
  useEffect(() => {
    perceptionAuditRepo.listRecent(100).then(setRows).catch(() => setRows([]));
  }, []);
  if (rows === null) return <Empty label="加载中…" />;
  if (rows.length === 0) return <Empty label="感知层还没写入过（开启 perception 后每 60s 会有一条）" />;
  return (
    <>
      {rows.map((r) => {
        let bias: { reason?: string; confidence?: number } = {};
        try {
          bias = JSON.parse(r.bias_json);
        } catch { /* ignore */ }
        return (
          <RowShell
            key={r.id}
            id={r.id}
            expanded={expandedId === r.id}
            onToggle={onToggle}
            summary={
              <div style={{ display: "flex", gap: "0.75rem" }}>
                <span style={{ opacity: 0.5, minWidth: 160 }}>
                  {formatTs(r.ts)}
                </span>
                <span style={{ opacity: 0.7, minWidth: 60 }}>{r.source}</span>
                <span style={{ flex: 1 }}>
                  {bias.reason ?? "(no reason)"}
                </span>
                <span style={{ opacity: 0.6 }}>
                  conf {bias.confidence ?? 0}
                </span>
              </div>
            }
            detail={{
              ...r,
              features: (() => {
                try {
                  return JSON.parse(r.features_json);
                } catch {
                  return r.features_json;
                }
              })(),
              bias: bias,
            }}
          />
        );
      })}
    </>
  );
}

function RoadmapPanel({ expandedId, onToggle }: PanelProps) {
  const [rows, setRows] = useState<RoadmapItem[] | null>(null);
  useEffect(() => {
    roadmapRepo.listAll().then(setRows).catch(() => setRows([]));
  }, []);
  if (rows === null) return <Empty label="加载中…" />;
  if (rows.length === 0) return <Empty label="工程师 agent 还没提议过任何 roadmap item" />;
  return (
    <>
      {rows.map((r) => (
        <RowShell
          key={r.id}
          id={r.id}
          expanded={expandedId === r.id}
          onToggle={onToggle}
          summary={
            <div style={{ display: "flex", gap: "0.75rem" }}>
              <span style={{ opacity: 0.5, minWidth: 100 }}>{r.status}</span>
              <span style={{ opacity: 0.7, minWidth: 80 }}>
                {r.proposed_change.zone}
              </span>
              <span style={{ flex: 1 }}>{r.title}</span>
              <span style={{ opacity: 0.5 }}>P{r.priority}</span>
            </div>
          }
          detail={r}
        />
      ))}
    </>
  );
}

function FeatureRequestsPanel({ expandedId, onToggle }: PanelProps) {
  const [rows, setRows] = useState<FeatureRequest[] | null>(null);
  useEffect(() => {
    featureRequestRepo
      .listSince(0)
      .then(setRows)
      .catch(() => setRows([]));
  }, []);
  if (rows === null) return <Empty label="加载中…" />;
  if (rows.length === 0) return <Empty label="其他 agent 还没提过功能请求" />;
  return (
    <>
      {rows.map((r) => (
        <RowShell
          key={r.id}
          id={r.id}
          expanded={expandedId === r.id}
          onToggle={onToggle}
          summary={
            <div style={{ display: "flex", gap: "0.75rem" }}>
              <span style={{ opacity: 0.5, minWidth: 160 }}>
                {formatTs(r.created_at)}
              </span>
              <span style={{ opacity: 0.7, minWidth: 100 }}>{r.from_agent}</span>
              <span style={{ opacity: 0.6, minWidth: 60 }}>{r.urgency}</span>
              <span style={{ flex: 1 }}>{r.desire}</span>
              <span style={{ opacity: 0.5 }}>
                {r.consumed ? "consumed" : "pending"}
              </span>
            </div>
          }
          detail={r}
        />
      ))}
    </>
  );
}

function EngineerAuditPanel({ expandedId, onToggle }: PanelProps) {
  const [rows, setRows] = useState<EngineerAuditEntry[] | null>(null);
  useEffect(() => {
    engineerAuditRepo.listRecent(100).then(setRows).catch(() => setRows([]));
  }, []);
  if (rows === null) return <Empty label="加载中…" />;
  if (rows.length === 0) return <Empty label="工程师 agent 还没运行过" />;
  return (
    <>
      {rows.map((r) => (
        <RowShell
          key={r.id}
          id={r.id}
          expanded={expandedId === r.id}
          onToggle={onToggle}
          summary={
            <div style={{ display: "flex", gap: "0.75rem" }}>
              <span style={{ opacity: 0.5, minWidth: 160 }}>
                {formatTs(r.timestamp)}
              </span>
              <span style={{ opacity: 0.7, minWidth: 200 }}>{r.task_id}</span>
              <span style={{ flex: 1 }}>{r.phase}</span>
            </div>
          }
          detail={{
            ...r,
            payload: (() => {
              try {
                return JSON.parse(r.payload_json);
              } catch {
                return r.payload_json;
              }
            })(),
          }}
        />
      ))}
    </>
  );
}

function LlmUsagePanel({ expandedId, onToggle }: PanelProps) {
  const [rows, setRows] = useState<LlmUsageEntry[] | null>(null);
  const [agg, setAgg] = useState<UsageAggregate[]>([]);
  useEffect(() => {
    (async () => {
      try {
        const [recent, aggregate] = await Promise.all([
          llmUsageRepo.listRecent(200),
          llmUsageRepo.aggregateByModel(),
        ]);
        setRows(recent);
        setAgg(aggregate);
      } catch {
        setRows([]);
        setAgg([]);
      }
    })();
  }, []);
  if (rows === null) return <Empty label="加载中…" />;

  const totalIn = agg.reduce((s, a) => s + (a.input_tokens ?? 0), 0);
  const totalOut = agg.reduce((s, a) => s + (a.output_tokens ?? 0), 0);
  const totalCalls = agg.reduce((s, a) => s + (a.calls ?? 0), 0);

  return (
    <>
      {agg.length === 0 ? (
        <Empty label="还没有 LLM 调用记录 — 触发一次对话或 Reflect 后再来看" />
      ) : (
        <div style={{ marginBottom: "1.25rem" }}>
          <p style={{ opacity: 0.6, marginBottom: "0.5rem" }}>
            总计：{totalCalls} 次调用 · 输入 {totalIn.toLocaleString()} tokens · 输出{" "}
            {totalOut.toLocaleString()} tokens
          </p>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: "0.8rem",
            }}
          >
            <thead>
              <tr style={{ opacity: 0.6, textAlign: "left" }}>
                <th style={{ padding: "0.4rem 0.5rem" }}>Provider</th>
                <th style={{ padding: "0.4rem 0.5rem" }}>Model</th>
                <th style={{ padding: "0.4rem 0.5rem", textAlign: "right" }}>
                  Calls
                </th>
                <th style={{ padding: "0.4rem 0.5rem", textAlign: "right" }}>
                  Input
                </th>
                <th style={{ padding: "0.4rem 0.5rem", textAlign: "right" }}>
                  Output
                </th>
                <th style={{ padding: "0.4rem 0.5rem", textAlign: "right" }}>
                  Avg ms
                </th>
                <th style={{ padding: "0.4rem 0.5rem", textAlign: "right" }}>
                  p50 ms
                </th>
                <th style={{ padding: "0.4rem 0.5rem", textAlign: "right" }}>
                  p99 ms
                </th>
              </tr>
            </thead>
            <tbody>
              {agg.map((a) => (
                <tr
                  key={`${a.provider}::${a.model}`}
                  style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
                >
                  <td style={{ padding: "0.4rem 0.5rem" }}>{a.provider}</td>
                  <td style={{ padding: "0.4rem 0.5rem" }}>{a.model}</td>
                  <td
                    style={{ padding: "0.4rem 0.5rem", textAlign: "right" }}
                  >
                    {a.calls}
                  </td>
                  <td
                    style={{ padding: "0.4rem 0.5rem", textAlign: "right" }}
                  >
                    {(a.input_tokens ?? 0).toLocaleString()}
                  </td>
                  <td
                    style={{ padding: "0.4rem 0.5rem", textAlign: "right" }}
                  >
                    {(a.output_tokens ?? 0).toLocaleString()}
                  </td>
                  <td
                    style={{ padding: "0.4rem 0.5rem", textAlign: "right" }}
                  >
                    {a.avg_ms ?? "—"}
                  </td>
                  <td
                    style={{ padding: "0.4rem 0.5rem", textAlign: "right" }}
                  >
                    {a.p50_ms ?? "—"}
                  </td>
                  <td
                    style={{ padding: "0.4rem 0.5rem", textAlign: "right" }}
                  >
                    {a.p99_ms ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rows.length > 0 && (
        <>
          <p style={{ opacity: 0.6, marginBottom: "0.5rem" }}>
            最近 {rows.length} 次调用
          </p>
          {rows.map((r) => {
            const rowId = `llm-${r.id}`;
            return (
              <RowShell
                key={rowId}
                id={rowId}
                expanded={expandedId === rowId}
                onToggle={onToggle}
                summary={
                  <div style={{ display: "flex", gap: "0.75rem" }}>
                    <span style={{ opacity: 0.5, minWidth: 160 }}>
                      {formatTs(r.ts)}
                    </span>
                    <span style={{ opacity: 0.7, minWidth: 90 }}>
                      {r.provider}
                    </span>
                    <span style={{ opacity: 0.7, minWidth: 80 }}>
                      {r.agent ?? "—"}
                    </span>
                    <span style={{ flex: 1 }}>{r.model}</span>
                    <span style={{ opacity: 0.6 }}>
                      in {r.input_tokens.toLocaleString()} · out{" "}
                      {r.output_tokens.toLocaleString()}
                    </span>
                  </div>
                }
                detail={r}
              />
            );
          })}
        </>
      )}
    </>
  );
}

function MemoryMdPanel() {
  const [content, setContent] = useState<string | null>(null);
  useEffect(() => {
    readMemoryFile().then(setContent).catch(() => setContent(""));
  }, []);
  if (content === null) return <Empty label="加载中…" />;
  if (content.trim() === "") return <Empty label="memory.md 还是空的（第一次 Reflect 后会有内容）" />;
  return (
    <pre
      style={{
        background: "rgba(0,0,0,0.4)",
        padding: "1rem",
        borderRadius: 4,
        fontSize: "0.8rem",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}
    >
      {content}
    </pre>
  );
}

function ReasoningTracesPanel({ expandedId, onToggle }: PanelProps) {
  const [rows, setRows] = useState<ReasoningTrace[] | null>(null);
  useEffect(() => {
    (async () => {
      try {
        setRows(await reasoningTracesRepo.listRecent(200));
      } catch {
        setRows([]);
      }
    })();
  }, []);
  if (rows === null) return <Empty label="加载中…" />;
  if (rows.length === 0) {
    return (
      <Empty label="还没有推理轨迹 — 触发对话或 Reflect / Perception 后再来看" />
    );
  }

  return (
    <div>
      <p style={{ opacity: 0.6, marginBottom: "0.5rem" }}>
        最近 {rows.length} 条推理轨迹（新→旧）
      </p>
      {rows.map((r) => {
        const isOpen = expandedId === r.id;
        const summary = summariseTrace(r);
        return (
          <div
            key={r.id}
            data-testid="reasoning-row"
            style={{
              borderTop: "1px solid rgba(255,255,255,0.06)",
              padding: "0.5rem 0.25rem",
              cursor: "pointer",
            }}
            onClick={() => onToggle(r.id)}
          >
            <div
              style={{
                display: "flex",
                gap: "0.75rem",
                fontSize: "0.8rem",
                alignItems: "baseline",
              }}
            >
              <span style={{ opacity: 0.55, fontVariantNumeric: "tabular-nums" }}>
                {new Date(r.ts).toLocaleString("zh-CN")}
              </span>
              <span
                style={{
                  padding: "0.05rem 0.5rem",
                  borderRadius: 3,
                  background: "rgba(255,255,255,0.08)",
                  fontSize: "0.72rem",
                }}
              >
                {r.agent_kind}
              </span>
              <span style={{ opacity: 0.55, fontVariantNumeric: "tabular-nums" }}>
                {r.duration_ms !== null ? `${r.duration_ms}ms` : "—"}
              </span>
              <span style={{ opacity: 0.75, flex: 1 }}>{summary}</span>
            </div>
            {isOpen && (
              <div style={{ marginTop: "0.75rem", display: "grid", gap: "0.75rem" }}>
                <TraceBlock title="Prompt" content={r.prompt_text} />
                <TraceBlock title="Raw response" content={r.raw_response ?? "(none)"} />
                <TraceBlock title="Parsed" content={prettyJson(r.parsed_json)} />
                {r.turn_id && (
                  <p style={{ opacity: 0.55, fontSize: "0.75rem" }}>
                    turn_id: {r.turn_id}
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function summariseTrace(r: ReasoningTrace): string {
  if (!r.parsed_json) return "(no parsed output)";
  try {
    const obj = JSON.parse(r.parsed_json) as Record<string, unknown>;
    if (typeof obj.rationale === "string") return obj.rationale;
    if (Array.isArray(obj.labels) && obj.labels.every((x) => typeof x === "string")) {
      return (obj.labels as string[]).join(", ");
    }
    if (typeof obj.needed_shift === "string") return `→ ${obj.needed_shift}`;
    return `${Object.keys(obj).slice(0, 3).join(", ")}…`;
  } catch {
    return r.parsed_json.slice(0, 80);
  }
}

function prettyJson(raw: string | null): string {
  if (!raw) return "(none)";
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function TraceBlock({ title, content }: { title: string; content: string }) {
  return (
    <div>
      <p style={{ opacity: 0.55, fontSize: "0.75rem", margin: "0 0 0.25rem" }}>
        {title}
      </p>
      <pre
        style={{
          background: "rgba(0,0,0,0.4)",
          padding: "0.75rem",
          borderRadius: 4,
          fontSize: "0.75rem",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          maxHeight: "24rem",
          overflow: "auto",
        }}
      >
        {content}
      </pre>
    </div>
  );
}

function LyricsEmbeddingsPanel() {
  const [cov, setCov] = useState<{
    total: number;
    withEmbedding: number;
    modelId: string | null;
  } | null>(null);
  useEffect(() => {
    (async () => {
      try {
        setCov(await lyricsEmbeddingsRepo.countCoverage());
      } catch {
        setCov({ total: 0, withEmbedding: 0, modelId: null });
      }
    })();
  }, []);
  if (cov === null) return <Empty label="加载中…" />;
  const pct =
    cov.total === 0
      ? 0
      : Math.round((cov.withEmbedding / cov.total) * 100);
  return (
    <div data-testid="panel-lyrics_emb">
      <ul style={{ lineHeight: "1.9" }}>
        <li>曲库总数：{cov.total.toLocaleString()}</li>
        <li>
          已生成 embedding：{cov.withEmbedding.toLocaleString()}
          {cov.total > 0 ? ` (${pct}%)` : ""}
        </li>
        <li>缺失：{(cov.total - cov.withEmbedding).toLocaleString()}</li>
        <li>当前模型：{cov.modelId ?? "(未启用)"}</li>
      </ul>
      <p style={{ opacity: 0.55, fontSize: "0.8rem", marginTop: "1rem" }}>
        Sprint 10: 歌词从本地 ID3 USLT 抽取 → 云 embedding → 存
        library_lyrics_embeddings 表。切换 provider 后到 Settings 点 "Refill
        missing lyrics embeddings" 回填。
      </p>
    </div>
  );
}

// ─── Agent Runtime Panel ─────────────────────────────────────────────────────

// ─── Product Events Panel ─────────────────────────────────────────────────────

function ProductEventsPanel({ expandedId, onToggle }: PanelProps) {
  const [rows, setRows] = useState<ProductEvent[] | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setRows(await productEventsRepo.listRecent(200));
      } catch {
        setRows([]);
      }
    })();
  }, []);

  if (rows === null) return <Empty label="加载中…" />;
  if (rows.length === 0) return <Empty label="还没有产品埋点事件" />;

  // Aggregate count per kind
  const kindCounts = new Map<string, number>();
  for (const r of rows) {
    kindCounts.set(r.kind, (kindCounts.get(r.kind) ?? 0) + 1);
  }
  const kindEntries = Array.from(kindCounts.entries()).sort((a, b) => b[1] - a[1]);

  return (
    <>
      {/* Stats bar */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.5rem",
          marginBottom: "1rem",
        }}
      >
        {kindEntries.map(([kind, n]) => (
          <span
            key={kind}
            style={{
              padding: "0.2rem 0.6rem",
              borderRadius: 3,
              background: "rgba(255,255,255,0.08)",
              fontSize: "0.78rem",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {kind} <strong>{n}</strong>
          </span>
        ))}
      </div>

      <p style={{ opacity: 0.6, marginBottom: "0.75rem", fontSize: "0.8rem" }}>
        最近 {rows.length} 条（新→旧）。点击行展开完整 payload。
      </p>

      {rows.map((r) => {
        const rowId = `pe-${r.id}`;
        let parsed: unknown = r.payload_json;
        try {
          parsed = JSON.parse(r.payload_json);
        } catch { /* keep raw string */ }
        const preview = r.payload_json.slice(0, 60) + (r.payload_json.length > 60 ? "…" : "");
        return (
          <RowShell
            key={rowId}
            id={rowId}
            expanded={expandedId === rowId}
            onToggle={onToggle}
            summary={
              <div style={{ display: "flex", gap: "0.75rem", alignItems: "baseline" }}>
                <span
                  style={{
                    opacity: 0.5,
                    minWidth: 160,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {formatTs(r.ts)}
                </span>
                <span
                  style={{
                    padding: "0.05rem 0.5rem",
                    borderRadius: 3,
                    background: "rgba(255,255,255,0.08)",
                    fontSize: "0.72rem",
                    minWidth: 120,
                  }}
                >
                  {r.kind}
                </span>
                <span style={{ opacity: 0.6, flex: 1, fontSize: "0.8rem" }}>
                  {preview}
                </span>
              </div>
            }
            detail={parsed}
          />
        );
      })}
    </>
  );
}

function AgentRuntimePanel({ expandedId, onToggle }: PanelProps) {
  const [rows, setRows] = useState<AgentRun[] | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setRows(await agentRunsRepo.listRecent(100));
      } catch {
        setRows([]);
      }
    })();
  }, []);

  if (rows === null) return <Empty label="加载中…" />;
  if (rows.length === 0) return <Empty label="还没有 Agent 运行记录" />;

  return (
    <>
      {rows.map((r) => {
        const rowId = `agent-${r.id}`;
        const duration =
          r.ended_at !== null ? r.ended_at - r.started_at : null;
        const eventCount = r.events_jsonl
          ? r.events_jsonl.split("\n").filter(Boolean).length
          : 0;
        const parsedEvents: unknown[] = r.events_jsonl
          ? r.events_jsonl
              .split("\n")
              .filter(Boolean)
              .map((line) => {
                try {
                  return JSON.parse(line) as unknown;
                } catch {
                  return line;
                }
              })
          : [];

        return (
          <RowShell
            key={rowId}
            id={rowId}
            expanded={expandedId === rowId}
            onToggle={onToggle}
            summary={
              <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
                <span style={{ opacity: 0.5, minWidth: 160 }}>
                  {formatTs(r.started_at)}
                </span>
                <span
                  style={{
                    padding: "0.05rem 0.5rem",
                    borderRadius: 3,
                    background: "rgba(255,255,255,0.08)",
                    fontSize: "0.72rem",
                  }}
                >
                  {r.agent_kind}
                </span>
                <span
                  style={{
                    padding: "0.05rem 0.5rem",
                    borderRadius: 3,
                    fontSize: "0.72rem",
                    background:
                      r.stop_reason === "ok"
                        ? "rgba(76,175,80,0.25)"
                        : r.stop_reason === null
                          ? "rgba(255,193,7,0.2)"
                          : "rgba(244,67,54,0.2)",
                  }}
                >
                  {r.stop_reason ?? "running"}
                </span>
                <span style={{ opacity: 0.6, minWidth: 70, fontVariantNumeric: "tabular-nums" }}>
                  {duration !== null ? `${duration}ms` : "—"}
                </span>
                <span style={{ opacity: 0.55, fontSize: "0.8rem" }}>
                  {eventCount} events
                </span>
                <span style={{ opacity: 0.45, flex: 1, fontSize: "0.75rem" }}>
                  turn: {r.turn_id.slice(0, 8)}…
                </span>
              </div>
            }
            detail={parsedEvents}
          />
        );
      })}
    </>
  );
}
