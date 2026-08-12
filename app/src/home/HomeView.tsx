import { useEffect, useRef, useState } from "react";
import { pausePlayback, resumePlayback } from "../audio/player";
import { AmbientBackground } from "./AmbientBackground";
import { BackgroundPhoto } from "./BackgroundPhoto";
import { ShanShuiCanvas } from "./ShanShuiCanvas";
import { EmotionLightBand } from "./EmotionLightBand";
import { SongInfo } from "./SongInfo";
import { SmallNote } from "./SmallNote";
import { InputBox } from "./InputBox";
import { bindGlobalKeys } from "./keyboard";
import { parseSlashCommand } from "./slashCommand";
import { useTurn } from "../turn/useTurn";
import type { Orchestrator } from "../turn/Orchestrator";
import * as turnRepo from "../db/repo/turnRepo";
import { songDisplayTitle, songDisplayArtist } from "../library/display";
import { reloadLibrary, type ReloadProgress } from "../library/reloadLibrary";
import type { PAD } from "../types";
import { DemoMode } from "./DemoMode";

const ZERO_PAD: PAD = { p: 0, a: 0, d: 0 };

// Voice: first-person, matches Lyra's tone in the rest of the UI.
function reloadNoteText(p: ReloadProgress): string {
  switch (p.kind) {
    case "starting": return "我正在准备重新加载曲库…";
    case "clearing": return "我把旧曲目记录清了…";
    case "scanning": return "我在扫描曲库,请稍等…";
    case "done": {
      const pruneTail = p.pruned > 0 ? ` · 清 ${p.pruned} 行` : "";
      return `曲库重新加载完成:${p.imported} 首${pruneTail}`;
    }
    case "no-root": return "还没设置曲库路径 — /settings 里填一下";
    case "failed": return `重新加载失败:${p.message}`;
  }
}

export type DataExplorerTabId =
  | "playback" | "turns" | "soul" | "salient" | "library" | "lyrics_emb"
  | "perception" | "roadmap" | "features_req" | "engineer"
  | "llm_usage" | "reasoning" | "memory_md";

type HomeViewProps = {
  onOpenSettings: () => void;
  onOpenDataExplorer: (tab?: DataExplorerTabId) => void;
  onOpenHelp: () => void;
  onWeek?: () => Promise<void>;
  orchestrator: Orchestrator | null;
};

export type { HomeViewProps };

// ── Inner component wired to a live orchestrator ─────────────────────────────

function LiveHomeView({
  onOpenSettings,
  onOpenDataExplorer,
  onOpenHelp,
  onWeek,
  orchestrator,
}: {
  onOpenSettings: () => void;
  onOpenDataExplorer: (tab?: DataExplorerTabId) => void;
  onOpenHelp: () => void;
  onWeek?: () => Promise<void>;
  orchestrator: Orchestrator;
}) {
  const { state, submit: rawSubmit } = useTurn(orchestrator);
  const [reloadStatus, setReloadStatus] = useState<string | null>(null);

  // Slash commands intercept before the Orchestrator runs. Known commands
  // dispatch a UI action and never become a DialogueTurn — no LLM call,
  // no memory write. Falls through for anything else so normal chat still
  // flows to Lyra.
  const submit = (text: string): Promise<void> => {
    const cmd = parseSlashCommand(text);
    if (cmd === null) return rawSubmit(text);
    if (cmd.kind === "settings") onOpenSettings();
    else if (cmd.kind === "stats") onOpenDataExplorer("llm_usage");
    else if (cmd.kind === "explorer") onOpenDataExplorer();
    else if (cmd.kind === "help") onOpenHelp();
    else if (cmd.kind === "reload-musics") void handleReload();
    else if (cmd.kind === "week") void onWeek?.();
    return Promise.resolve();
  };

  const handleReload = async () => {
    await reloadLibrary((p) => setReloadStatus(reloadNoteText(p)));
    // Leave the terminal status visible briefly, then let the normal
    // SmallNote text take over again.
    setTimeout(() => setReloadStatus(null), 5000);
  };
  const [historicalPads, setHistoricalPads] = useState<PAD[]>([]);
  const [songInfoVisible, setSongInfoVisible] = useState(false);

  // 每首新歌开头亮 3s 交代"我在听什么",随后淡出。哲学:听音乐和心情,不是看具体歌曲。
  // proactive-pending 则持续展示邀约歌名，直到用户回应或状态离开。
  const playingSongId = state.kind === "playing" ? state.song.id : null;
  const pendingSongId = state.kind === "proactive-pending" ? state.song.id : null;
  useEffect(() => {
    if (pendingSongId !== null) {
      setSongInfoVisible(true);
      return;
    }
    if (playingSongId === null) {
      setSongInfoVisible(false);
      return;
    }
    setSongInfoVisible(true);
    const t = setTimeout(() => setSongInfoVisible(false), 3000);
    return () => clearTimeout(t);
  }, [playingSongId, pendingSongId]);

  // Refresh emotion history whenever state transitions to playing
  useEffect(() => {
    if (state.kind === "playing") {
      turnRepo.listRecentTurns(20).then((turns) => {
        // Reverse so oldest is drawn first, newest last (right side of band)
        setHistoricalPads(
          turns.map((t) => t.current_emotion.pad).reverse(),
        );
      }).catch(() => {});
    }
  }, [state.kind]);

  // Track pause locally so Space can toggle without an extra IPC round-trip.
  // Reset whenever the playing song changes — a fresh track always starts
  // unpaused on the Rust side (play_file zeroes the pause bookkeeping).
  const [isPausedLocal, setIsPausedLocal] = useState(false);
  useEffect(() => {
    setIsPausedLocal(false);
  }, [playingSongId]);

  // Ref pattern so the keydown binding doesn't rebind on every state tick.
  const togglePlaybackRef = useRef<() => void>(() => {});
  togglePlaybackRef.current = () => {
    if (state.kind !== "playing") return;
    if (isPausedLocal) {
      setIsPausedLocal(false);
      void resumePlayback().catch((e) =>
        console.warn("[lyra] resumePlayback failed:", e),
      );
    } else {
      setIsPausedLocal(true);
      void pausePlayback().catch((e) =>
        console.warn("[lyra] pausePlayback failed:", e),
      );
    }
  };

  useEffect(() => {
    return bindGlobalKeys({
      onOpenSettings,
      onTogglePlayback: () => togglePlaybackRef.current(),
    });
  }, [onOpenSettings]);

  // Derive display values from state
  const pad: PAD =
    state.kind === "playing"
      ? state.turn.current_emotion.pad
      : ZERO_PAD;

  // Keep the band painted while thinking (song switch) so we don't flash the
  // empty-state hairline. proactive-pending uses the same history if any.
  const padSamples: PAD[] =
    (state.kind === "playing" ||
      state.kind === "thinking" ||
      state.kind === "proactive-pending") &&
    historicalPads.length >= 1
      ? historicalPads
      : [];

  const title: string =
    state.kind === "playing" || state.kind === "proactive-pending"
      ? songDisplayTitle(state.song)
      : "";

  const artist: string =
    state.kind === "playing" || state.kind === "proactive-pending"
      ? songDisplayArtist(state.song)
      : "";

  const noteText: string =
    reloadStatus ??
    (state.kind === "idle"
      ? "Lyra 在等你说一句话"
      : state.kind === "thinking"
        ? "…"
        : state.kind === "playing"
          ? state.turn.agent_response.rationale
          : state.kind === "proactive-pending"
            ? state.rationale
            : state.kind === "error"
              ? state.message
              : "");

  const noteColor: string | undefined =
    state.kind === "error" && reloadStatus === null
      ? "rgba(200,80,80,0.75)"
      : undefined;

  // §7 idle empty state — sparser layout when no turns yet.
  // historicalPads is only populated on state→playing, so on cold boot it's
  // empty and we render the sparse "Lyra 在听" view.
  const isSparseIdle = state.kind === "idle" && historicalPads.length === 0;

  if (isSparseIdle) {
    return (
      <AmbientBackground pad={pad}>
        <BackgroundPhoto />
        <ShanShuiCanvas pad={pad} playing={false} />
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "var(--lyra-viewport-padding)",
            gap: 0,
            position: "relative",
            zIndex: 1,
          }}
        >
          <div
            data-testid="lyra-idle-slogan"
            style={{
              color: "var(--lyra-color-song-info)",
              fontSize: "var(--lyra-song-font-size)",
              fontFamily: "var(--lyra-note-family)",
              fontStyle: "italic",
              letterSpacing: "0.04em",
              marginBottom: "var(--lyra-space-note-to-input)",
              opacity: 0.7,
            }}
          >
            {reloadStatus ?? "Lyra 在听"}
          </div>
          <InputBox onSubmit={submit} />
        </div>
      </AmbientBackground>
    );
  }

  return (
    <AmbientBackground pad={pad}>
      <BackgroundPhoto />
      <ShanShuiCanvas pad={pad} playing={state.kind === "playing"} />
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          padding: "var(--lyra-viewport-padding)",
          gap: 0,
          position: "relative",
          zIndex: 1,
        }}
      >
        <div style={{ flex: 1 }} />
        <EmotionLightBand samples={padSamples} />
        <div style={{ height: "var(--lyra-space-band-to-song)" }} />
        {state.kind === "playing" || state.kind === "proactive-pending" ? (
          <div
            data-testid="song-info-fade"
            style={{
              opacity: songInfoVisible ? 1 : 0,
              transition: "opacity 1.4s ease-out",
              pointerEvents: songInfoVisible ? "auto" : "none",
            }}
          >
            <SongInfo title={title} artist={artist} />
          </div>
        ) : (
          <SongInfo title="" artist="" />
        )}
        <div style={{ height: "var(--lyra-space-song-to-note)" }} />
        <SmallNote text={noteText} color={noteColor} />
        <div style={{ flex: 1 }} />
        <div style={{ height: "var(--lyra-space-note-to-input)" }} />
        <InputBox onSubmit={submit} />
      </div>
    </AmbientBackground>
  );
}

// ── Cold-boot placeholder (no providers configured) ───────────────────────────

function ColdBootView({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [showDemo, setShowDemo] = useState(false);

  useEffect(() => {
    return bindGlobalKeys({
      onOpenSettings,
      onTogglePlayback: () => {},
    });
  }, [onOpenSettings]);

  if (showDemo) {
    return (
      <DemoMode
        onClose={() => setShowDemo(false)}
        onOpenSettings={() => {
          setShowDemo(false);
          onOpenSettings();
        }}
      />
    );
  }

  return (
    <AmbientBackground pad={ZERO_PAD}>
      <div
        className="lyra-hero"
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "var(--lyra-viewport-padding)",
          gap: 0,
          textAlign: "center",
        }}
      >
        <h1
          style={{
            fontSize: "2.5rem",
            fontWeight: 700,
            letterSpacing: "0.05em",
            margin: 0,
          }}
        >
          Lyra
        </h1>
        <p
          style={{
            marginTop: "0.5rem",
            opacity: 0.6,
            fontSize: "0.95rem",
          }}
        >
          Your emotional music companion
        </p>
        <p
          style={{
            marginTop: "0.25rem",
            opacity: 0.45,
            fontSize: "0.85rem",
          }}
        >
          陪你说话，替你选一首歌
        </p>
        <p
          data-testid="cold-boot-hint"
          onClick={onOpenSettings}
          style={{
            marginTop: "2rem",
            opacity: 0.5,
            fontSize: "0.85rem",
            cursor: "pointer",
          }}
        >
          Lyra needs an API key to talk.{" "}
          <span style={{ textDecoration: "underline" }}>
            Cmd+= to open Settings.
          </span>
        </p>
        <p
          data-testid="cold-boot-demo-link"
          onClick={() => setShowDemo(true)}
          style={{
            marginTop: "0.75rem",
            opacity: 0.5,
            fontSize: "0.8rem",
            cursor: "pointer",
            fontFamily: "var(--lyra-note-family, monospace)",
          }}
        >
          先试 30 秒 →
        </p>
      </div>
    </AmbientBackground>
  );
}

// ── Public export ─────────────────────────────────────────────────────────────

export function HomeView({
  onOpenSettings,
  onOpenDataExplorer,
  onOpenHelp,
  onWeek,
  orchestrator,
}: HomeViewProps) {
  if (orchestrator === null) {
    return <ColdBootView onOpenSettings={onOpenSettings} />;
  }
  return (
    <LiveHomeView
      onOpenSettings={onOpenSettings}
      onOpenDataExplorer={onOpenDataExplorer}
      onOpenHelp={onOpenHelp}
      onWeek={onWeek}
      orchestrator={orchestrator}
    />
  );
}
