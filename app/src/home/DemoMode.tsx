/**
 * DemoMode.tsx — Iter Phase 1
 *
 * 30-second onboarding demo for visitors with no API key configured.
 * Cycles through 3 pre-authored utterances, showing emotion → song selection.
 *
 * Ollama reachable  → real emotion call + fallback song/rationale
 * Ollama absent     → fully pre-authored (pad + rationale from demoFallback.ts)
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { EmotionLightBand } from "./EmotionLightBand";
import { SongInfo } from "./SongInfo";
import { SmallNote } from "./SmallNote";
import { AmbientBackground } from "./AmbientBackground";
import { DEMO_FALLBACK, DEMO_SONGS } from "./demoFallback";
import type { PAD } from "../lib/color";
import * as productEvents from "../db/repo/productEventsRepo";

// ── Ollama probe ──────────────────────────────────────────────────────────────

const OLLAMA_ENDPOINT = "http://localhost:11434";

/**
 * Attempts a minimal Ollama chat with a 3-second timeout.
 * Returns true if reachable.
 */
export async function probeOllama(): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 3000);
  try {
    const res = await fetch(`${OLLAMA_ENDPOINT}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "qwen2.5:latest",
        stream: false,
        messages: [{ role: "user", content: "hi" }],
      }),
      signal: ctrl.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ask Ollama to estimate a PAD vector from an utterance.
 * Returns null on any failure — caller falls back to pre-authored data.
 */
async function ollamaPad(utterance: string): Promise<PAD | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(`${OLLAMA_ENDPOINT}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "qwen2.5:latest",
        stream: false,
        messages: [
          {
            role: "system",
            content:
              'You are an emotion analyst. Reply ONLY with a JSON object {"p": <-1 to 1>, "a": <-1 to 1>, "d": <-1 to 1>}. p=pleasantness, a=arousal, d=dominance.',
          },
          { role: "user", content: utterance },
        ],
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      message?: { content?: string };
    };
    const text = data.message?.content ?? "";
    const match = text.match(/\{[^}]+\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]) as { p?: number; a?: number; d?: number };
    if (
      typeof parsed.p === "number" &&
      typeof parsed.a === "number" &&
      typeof parsed.d === "number"
    ) {
      return { p: parsed.p, a: parsed.a, d: parsed.d };
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

type DemoPhase =
  | "idle"
  | "typing"      // utterance fades in
  | "thinking"    // "..." 800ms
  | "emotion"     // EmotionLightBand lights up
  | "song"        // SongInfo + SmallNote fade in
  | "playing"     // 5s audio
  | "fading"      // cross-fade to next group
  | "end";        // completion screen

// ── Asset path helper ─────────────────────────────────────────────────────────

function demoAssetPath(filename: string): string {
  // Vite imports assets from src/assets — use a URL import string.
  // At runtime in Tauri we need an absolute file path for audio_play.
  // We resolve at runtime by checking window.__TAURI_INTERNALS__ presence.
  // In tests this returns a fake path.
  return `/demo/${filename}`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export type DemoModeProps = {
  onClose: () => void;
  onOpenSettings: () => void;
};

export function DemoMode({ onClose, onOpenSettings }: DemoModeProps) {
  const [phase, setPhase] = useState<DemoPhase>("idle");
  const [groupIndex, setGroupIndex] = useState(0);
  const [ollamaAvailable, setOllamaAvailable] = useState<boolean | null>(null);
  const [currentPad, setCurrentPad] = useState<PAD>({ p: 0, a: 0, d: 0 });
  const [padHistory, setPadHistory] = useState<PAD[]>([]);
  const [opacity, setOpacity] = useState(0);
  const cancelRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Esc → close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        void productEvents
          .record("demo_escaped", { atGroup: groupIndex + 1 })
          .catch(() => {});
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [groupIndex, onClose]);

  // Stop audio on unmount
  useEffect(() => {
    return () => {
      cancelRef.current = true;
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  // ── Demo sequence ────────────────────────────────────────────────────────────

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      const t = setTimeout(resolve, ms);
      // Store timer id to cancel? We use cancelRef instead.
      void t;
    });

  const runGroup = useCallback(
    async (idx: number, hasOllama: boolean) => {
      if (cancelRef.current) return;
      const entry = DEMO_FALLBACK[idx];

      // Step 1: utterance fade in (200ms)
      setPhase("typing");
      setOpacity(0);
      await sleep(50);
      setOpacity(1);
      await sleep(200);
      if (cancelRef.current) return;

      // Step 2: thinking 800ms — optionally call Ollama
      setPhase("thinking");
      let pad: PAD = entry.pad;
      if (hasOllama) {
        const [ollamaPadResult] = await Promise.all([
          ollamaPad(entry.utterance),
          sleep(800),
        ]);
        if (ollamaPadResult) pad = ollamaPadResult;
      } else {
        await sleep(800);
      }
      if (cancelRef.current) return;

      // Step 3: EmotionLightBand
      setCurrentPad(pad);
      setPadHistory((prev) => [...prev, pad]);
      setPhase("emotion");
      await sleep(1000);
      if (cancelRef.current) return;

      // Step 4: SongInfo + SmallNote
      setPhase("song");
      await sleep(800);
      if (cancelRef.current) return;

      // Step 5: Play audio (5 seconds)
      setPhase("playing");
      const song = DEMO_SONGS[entry.songIndex];
      try {
        const audio = new Audio(demoAssetPath(song.file));
        audioRef.current = audio;
        audio.volume = 0.5;
        // seek to middle of 20s track
        audio.currentTime = 7;
        await audio.play().catch(() => {});
        await sleep(5000);
        audio.pause();
        audioRef.current = null;
      } catch {
        await sleep(5000);
      }
      if (cancelRef.current) return;

      // Step 6: Fade out before next group
      setPhase("fading");
      setOpacity(0);
      await sleep(500);
      if (cancelRef.current) return;
    },
    [],
  );

  // Main orchestrator
  useEffect(() => {
    let mounted = true;

    async function run() {
      // Probe Ollama
      const hasOllama = await probeOllama();
      if (!mounted) return;
      setOllamaAvailable(hasOllama);

      void productEvents.record("demo_started").catch(() => {});

      // Fade in the whole demo shell
      setOpacity(1);
      setPhase("idle");

      for (let i = 0; i < DEMO_FALLBACK.length; i++) {
        if (!mounted || cancelRef.current) return;
        setGroupIndex(i);
        await runGroup(i, hasOllama);
        if (!mounted || cancelRef.current) return;
      }

      // End screen
      setPhase("end");
      setOpacity(1);
      void productEvents
        .record("demo_completed", { ollamaWas: hasOllama })
        .catch(() => {});
    }

    void run();
    return () => {
      mounted = false;
    };
  }, [runGroup]);

  // ── Derived display values ────────────────────────────────────────────────────

  const entry = DEMO_FALLBACK[groupIndex];
  const song = DEMO_SONGS[entry?.songIndex ?? 0];
  const showUtterance = phase === "typing" || phase === "thinking" || phase === "emotion" || phase === "song" || phase === "playing";
  const showThinking = phase === "thinking";
  const showBand = phase === "emotion" || phase === "song" || phase === "playing";
  const showSong = phase === "song" || phase === "playing";

  // ── End screen ────────────────────────────────────────────────────────────────

  if (phase === "end") {
    const hasOllama = ollamaAvailable === true;
    return (
      <AmbientBackground pad={currentPad}>
        <div
          data-testid="demo-end-screen"
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "var(--lyra-viewport-padding)",
            textAlign: "center",
            gap: "1rem",
            opacity: 1,
            transition: "opacity 0.4s",
          }}
        >
          <p
            style={{
              opacity: 0.85,
              fontSize: "1rem",
              lineHeight: 1.7,
              maxWidth: "22rem",
            }}
          >
            {hasOllama
              ? "这就是 Lyra。想让她记住你，配一个曲库路径。"
              : "这只是 demo。装个 Ollama 或配 API key，Lyra 会真的懂你。"}
          </p>
          <p
            data-testid="demo-cta"
            onClick={() => {
              void productEvents.record("demo_to_settings").catch(() => {});
              onClose();
              onOpenSettings();
            }}
            style={{
              opacity: 0.6,
              fontSize: "0.85rem",
              cursor: "pointer",
              textDecoration: "underline",
              fontFamily: "var(--lyra-note-family, monospace)",
            }}
          >
            打开设置 →
          </p>
          <p
            data-testid="demo-close"
            onClick={onClose}
            style={{
              opacity: 0.35,
              fontSize: "0.75rem",
              cursor: "pointer",
              marginTop: "0.5rem",
            }}
          >
            关闭
          </p>
        </div>
      </AmbientBackground>
    );
  }

  // ── Running screen ────────────────────────────────────────────────────────────

  return (
    <AmbientBackground pad={currentPad}>
      <div
        data-testid="demo-running"
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "var(--lyra-viewport-padding)",
          gap: "1rem",
          opacity,
          transition: "opacity 0.3s",
          textAlign: "center",
        }}
      >
        {/* Utterance */}
        {showUtterance && (
          <p
            data-testid="demo-utterance"
            style={{
              fontSize: "1.05rem",
              opacity: 0.8,
              fontStyle: "italic",
              transition: "opacity 0.2s",
            }}
          >
            {entry?.utterance}
          </p>
        )}

        {/* Thinking indicator */}
        {showThinking && (
          <p
            data-testid="demo-thinking"
            style={{ opacity: 0.5, fontSize: "0.9rem", letterSpacing: "0.2em" }}
          >
            ...
          </p>
        )}

        {/* Emotion band */}
        {showBand && (
          <div
            data-testid="demo-band"
            style={{ transition: "opacity 0.5s", opacity: showBand ? 1 : 0 }}
          >
            <EmotionLightBand samples={padHistory} />
          </div>
        )}

        {/* Song info + rationale */}
        {showSong && (
          <>
            <div
              data-testid="demo-song"
              style={{ opacity: 1, transition: "opacity 0.4s" }}
            >
              <SongInfo title={song.title} artist={song.artist} />
            </div>
            <SmallNote text={entry.rationale} />
          </>
        )}

        {/* Group indicator dots */}
        <div
          style={{
            display: "flex",
            gap: "0.4rem",
            marginTop: "1.5rem",
            opacity: 0.3,
          }}
        >
          {DEMO_FALLBACK.map((_, i) => (
            <div
              key={i}
              style={{
                width: 5,
                height: 5,
                borderRadius: "50%",
                background: "currentColor",
                opacity: i === groupIndex ? 1 : 0.4,
              }}
            />
          ))}
        </div>

        {/* Esc hint */}
        <p
          style={{
            opacity: 0.2,
            fontSize: "0.7rem",
            fontFamily: "var(--lyra-note-family, monospace)",
            marginTop: "0.25rem",
          }}
        >
          Esc 退出
        </p>
      </div>
    </AmbientBackground>
  );
}
