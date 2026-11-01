import type { DialogueTurn, LibraryTrack, PAD, CurrentEmotion } from "../types";
import type { EmotionAgent } from "../agents/EmotionAgent";
import type { CompanionAgent } from "../agents/CompanionAgent";
import type { LibraryAgent } from "../agents/LibraryAgent";
import type { SoulState } from "../types";
import { foldReactionEvents, computeEmotionDelta } from "./reactionCapture";
import type { ReactionEvent } from "./reactionCapture";
import { getMemoryContext } from "../memory/context";
import { detectSalientMoment } from "../moments/salient";
import { currentTagsFor } from "./currentTags";
import { insertSharedMemory } from "../db/repo/sharedMemoryRepo";
import { appendSalientMomentToMemoryMd } from "../memory/appendSalient";
import type { ProactiveIntent } from "../proactive/types";
import { setBreathing } from "../tray/trayBridge";
import type { PerceptionBias } from "../perception/PerceptionAgent";
import type { EventBus } from "../perception/events";
// ── Pi migration prep imports (Phase 1) ──────────────────────────────────────
import type { ToolContextFactory } from "./toolContextFactory";
import type { TurnCancellationManager } from "./turnCancellation";
import type { AgentRunSink } from "./agentRunSink";
import { parseIntent } from "../agents/intentParser";
import { inferShift } from "../agents/shiftLogic";
import type { ActiveIntent } from "../db/repo/activeIntentRepo";
import * as productEventsRepo from "../db/repo/productEventsRepo";
import {
  classifyError,
  formatErrorDetail,
  logLyraError,
  userFacingErrorMessage,
} from "../lib/formatError";
import { lyraLog } from "../lib/lyraLog";
import { writeTrace } from "../reasoning/writeTrace";
import { parseShowCommand } from "../show/parseShowCommand";
import { formatShowClock } from "../show/context";
import { formatShowScript, type ShowBeat, type ShowLine } from "../show/rundown";
import type { ShowBrief } from "../show/ShowAgent";

/** How long the two hosts' lines stay on screen before the song starts. */
export const SHOW_TALK_BEFORE_PLAY_MS = 3200;

/** Songs that must not repeat inside one continuous playback. */
export const SESSION_NO_REPEAT_WINDOW = 24;
/** How far down the intent + emotion ranking a session queue may reach. */
export const SESSION_RANK_LIMIT = 10_000;

export type SoulStoreLike = {
  load(): Promise<SoulState>;
  apply?: (delta: PAD) => Promise<SoulState>;
};

type SoulStore = SoulStoreLike;

export type OrchestratorState =
  | { kind: "idle" }
  | { kind: "thinking"; user_utterance: string }
  | { kind: "playing"; turn: DialogueTurn; song: LibraryTrack; aside?: string }
  | { kind: "error"; message: string }
  | { kind: "proactive-pending"; intent: ProactiveIntent; song: LibraryTrack; rationale: string }
  | {
      kind: "show-talk";
      guestName: string;
      lines: ShowLine[];
      song: LibraryTrack;
      beatIndex: number;
      beatCount: number;
      pad: PAD;
      note?: string;
    };

export type OrchestratorDeps = {
  emotion: EmotionAgent;
  companion: CompanionAgent;
  library: LibraryAgent;
  soulStore: SoulStore;
  turnRepo: {
    insertTurn(t: DialogueTurn): Promise<void>;
    updateTurn?(t: DialogueTurn): Promise<void>;
    setTurnLatency?(id: string, ms: number): Promise<void>;
  };
  audio: {
    // playFile may return the Rust playback id (a number) so the caller can
    // correlate the "audio-complete" event. Orchestrator itself doesn't use
    // the id; the correlation is done at the App/subscriber level.
    // `durationMs` is a hint used by Rust to arm a duration-based safety
    // net so auto-advance still fires on tracks where Sink::empty() never
    // flips. Null/undefined skips it.
    playFile(path: string, durationMs?: number | null): Promise<number | void>;
    stop(): Promise<void>;
  };
  /** Optional perception event bus — if provided, Orchestrator emits
   * input_submit / skip / complete events for the aggregator. */
  eventBus?: EventBus;
  /** Sprint 17: optional persister for shift-feedback records. If provided,
   *  every skip/complete writes a ShiftFeedback row for ReflectAgent. */
  shiftFeedbackRepo?: {
    insert(f: import("../perception/shiftFeedback").ShiftFeedback): Promise<void>;
  };
  /** Sprint 19: optional library features repo. If provided, CompanionAgent
   *  receives real bpm/energy/valence for shift-based ranking. */
  libraryFeaturesRepo?: {
    getBatch(ids: string[]): Promise<Map<string, import("../db/repo/libraryFeaturesRepo").LibraryFeatures>>;
  };
  /** Sticky listening intent store (persists across app restarts). */
  activeIntentRepo?: {
    load(): Promise<ActiveIntent | null>;
    save(intent: ActiveIntent): Promise<void>;
    clear(): Promise<void>;
  };
  /** Writes a two-host rundown. Absent in tests that never start a show. */
  showAgent?: { write(brief: ShowBrief): Promise<ShowBeat[]> };
  /** Rewrites host lines with song context and a rotating color. Optional. */
  showBoundary?: {
    color(input: {
      topic: string;
      beats: ShowBeat[];
      songs: ShowBrief["candidates"];
      toneOffset?: number;
    }): Promise<ShowBeat[]>;
  };
  /** Speaks the current beat. When absent, the beat waits on a timer. */
  showVoice?: {
    speak(lines: ShowLine[]): Promise<void>;
    cancel(): void;
  };
  /** Cached weather line, or null when location/weather is unknown. */
  readWeather?: () => Promise<string | null>;
  /** DJ agent track profiles for candidate display + intent filtering. */
  trackProfilesRepo?: {
    getBatch(
      ids: string[],
    ): Promise<Map<string, import("../db/repo/trackProfilesRepo").TrackProfile>>;
  };
  clock?: () => number;
  idGen?: () => string;
  // ── Pi migration prep hooks (Phase 1) ──────────────────────────────────────
  // These three deps are optional throughout Phase 1 (pi Agent not yet wired).
  // Phase 2 (EmotionAgent migration) will make them required in the pi path.
  // Passing them in Phase 1 is a no-op at runtime — they are accepted but not
  // yet called. This lets callers begin constructing and injecting them before
  // any behavioural change occurs.
  //
  // Wiring sequence (Phase 2, onUserInput):
  //   turnCancellation.abortAndStart(newTurnId)   → AbortSignal for pi Agent
  //   toolContextFactory.build(newTurnId)          → ToolContext for pi Agent
  //   new Agent({...})
  //   agent.subscribe(e => agentRunSink.record(runId, e))
  //   await agent.prompt(...)
  //   agentRunSink.end(runId, "ok" | "aborted_by_user")
  //   turnCancellation.finish(newTurnId)
  /** Factory that produces a per-turn ToolContext for pi Agent tool calls. */
  toolContextFactory?: ToolContextFactory;
  /** Manages the AbortController lifecycle across concurrent pi Agent turns. */
  turnCancellation?: TurnCancellationManager;
  /** Sink that records pi Agent event streams to agent_runs + EventBus. */
  agentRunSink?: AgentRunSink;
};

const ZERO_PAD: PAD = { p: 0, a: 0, d: 0 };

export class Orchestrator {
  private state: OrchestratorState = { kind: "idle" };
  private subs = new Set<(s: OrchestratorState) => void>();
  private deps: OrchestratorDeps;

  /** The turn that is currently playing, accumulating reaction events. */
  private currentTurn: DialogueTurn | null = null;
  /** The song that is currently playing (paired with currentTurn). */
  private currentSong: LibraryTrack | null = null;
  /** Pending reaction events for the current turn. */
  private pendingEvents: ReactionEvent[] = [];
  /** Latest perception bias — blended into onUserInput emotion when set. */
  private perceptionBias: PerceptionBias | null = null;
  /** Sprint 15: latest behavioral signals for CompanionAgent shift inference. */
  private perceptionSignals: {
    skipRatio: number;
    isBlurred: boolean;
    inputHesitation: "none" | "some" | "many";
  } = { skipRatio: 0, isBlurred: false, inputHesitation: "none" };
  /** Guard against concurrent fulfillProactive calls. */
  private proactiveInFlight = false;
  /** Sprint 17: track shift recommendation + start time for the current song. */
  private currentShiftMeta: {
    turnId: string;
    shift: "接住" | "点燃" | "陪着" | "打断";
    padAtTime: PAD;
    startedAt: number;
  } | null = null;
  /** Rolling window of song ids we've just picked (oldest→newest).
   *  Auto-advance will not play any of these again until 24 other songs
   *  have passed (or the library is smaller than that). Session-scoped. */
  private recentSongIds: string[] = [];
  /** Remaining songs for this intent + emotion bucket, already sorted. */
  private sessionQueue: LibraryTrack[] = [];
  private sessionRankKey = "";
  /** Next continuation song, chosen while the current one is still playing. */
  private preparedNext: { song: LibraryTrack; rankKey: string } | null = null;
  private prepareGen = 0;
  private queueEpoch = 0;
  private prepareTask: Promise<void> | null = null;
  /** Sticky listening intent (e.g. 粤语). Loaded lazily from activeIntentRepo. */
  private activeIntent: ActiveIntent | null = null;
  private activeIntentLoaded = false;
  /** Ignores the completion event that stopping the previous song can emit. */
  private suppressComplete = false;
  /** Starts the current show beat after the lines have been readable. */
  private showPlayTimer: ReturnType<typeof setTimeout> | null = null;
  /** Bumped when speech is cancelled so a late speak() cannot start the song. */
  private showSpeakGen = 0;
  /** Live two-host show. Null when the listener is in ordinary chat. */
  private show: {
    rundown: { topic: string; guestName: string; beats: ShowBeat[] };
    beatIndex: number;
    songs: Map<string, LibraryTrack>;
    emotion: CurrentEmotion;
  } | null = null;

  constructor(deps: OrchestratorDeps) {
    this.deps = deps;
    // Phase 2/3a: wire agentRunSink into pi-capable agents so their pi paths
    // can record telemetry without requiring callers to reconstruct them.
    if (deps.agentRunSink) {
      deps.emotion.setAgentRunSink(deps.agentRunSink);
      deps.companion.setAgentRunSink?.(deps.agentRunSink);
    }
  }

  /**
   * Store the latest PerceptionBias derived by the App-level PerceptionAgent.
   * Pass `null` to clear. onUserInput consumes this to blend PAD before
   * running companion song selection.
   */
  setPerceptionBias(bias: PerceptionBias | null): void {
    this.perceptionBias = bias;
  }

  /**
   * Sprint 15: update behavioral signals derived from the perception loop.
   * CompanionAgent uses these for shift inference on next choose().
   */
  setPerceptionSignals(signals: {
    skipRatio: number;
    isBlurred: boolean;
    inputHesitation: "none" | "some" | "many";
  }): void {
    this.perceptionSignals = signals;
  }

  getState(): OrchestratorState {
    return this.state;
  }

  subscribe(cb: (s: OrchestratorState) => void): () => void {
    this.subs.add(cb);
    return () => this.subs.delete(cb);
  }

  private emit(s: OrchestratorState): void {
    this.state = s;
    for (const cb of this.subs) cb(s);
  }

  /** Push a picked song id onto the rolling exclude window. Move-to-front:
   *  a repeated id gets refreshed to the tail rather than duplicated. */
  private trackSongPicked(songId: string): void {
    const idx = this.recentSongIds.indexOf(songId);
    if (idx !== -1) this.recentSongIds.splice(idx, 1);
    this.recentSongIds.push(songId);
    if (this.recentSongIds.length > SESSION_NO_REPEAT_WINDOW) {
      this.recentSongIds.shift();
    }
  }

  /** Coarse mood + sticky intent. Tiny PAD drift must not rebuild the queue,
   *  or auto-advance collapses back to "always play the current #1". */
  private sessionRankKeyFor(emotion: import("../types").CurrentEmotion): string {
    const bucket = (v: number) => Math.round(v * 2) / 2;
    const c = this.activeIntent?.constraints;
    return [
      bucket(emotion.pad.p),
      bucket(emotion.pad.a),
      bucket(emotion.pad.d),
      emotion.labels.join(","),
      this.activeIntent?.rawText ?? "",
      (c?.languages ?? []).join(","),
      (c?.genres ?? []).join(","),
      (c?.scenes ?? []).join(","),
      (c?.artists ?? []).join(","),
    ].join("|");
  }

  /** Drop a queued continuation. In-flight ranking must not write back. */
  private clearSessionQueue(): void {
    this.queueEpoch++;
    this.prepareGen++;
    this.preparedNext = null;
    this.sessionQueue = [];
    this.sessionRankKey = "";
  }

  /** Rank the library by intent then emotion, drop songs played in the last
   *  24, and keep that order for the rest of this mood. When every remaining
   *  song is inside the window, replay the one that has waited the longest.
   *  Returns false when a newer clear superseded this ranking. */
  private async rebuildSessionQueue(
    target: string,
    emotion: import("../types").CurrentEmotion,
    key: string,
  ): Promise<boolean> {
    const epoch = this.queueEpoch;
    const ranked = await this.deps.library.prefilter(
      target,
      emotion.pad,
      SESSION_RANK_LIMIT,
      undefined,
      this.activeIntent ?? undefined,
      "intent-emotion",
    );
    if (epoch !== this.queueEpoch) return false;
    const recent = new Set(this.recentSongIds);
    const eligible = ranked.filter((t) => !recent.has(t.id));
    if (eligible.length > 0) {
      this.sessionQueue = eligible;
    } else if (ranked.length > 0) {
      const age = new Map(this.recentSongIds.map((id, i) => [id, i]));
      const oldest = [...ranked].sort(
        (a, b) =>
          (age.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
          (age.get(b.id) ?? Number.MAX_SAFE_INTEGER),
      )[0];
      this.sessionQueue = oldest ? [oldest] : [];
    } else {
      this.sessionQueue = [];
    }
    this.sessionRankKey = key;
    return true;
  }

  private continuationTarget(emotion: import("../types").CurrentEmotion): string {
    return this.buildPseudoTarget(
      "",
      emotion.labels,
      `${emotion.labels.join(" ")} 延续`.trim(),
    );
  }

  /** Emotion the next song should follow once this turn ends. Uses the
   *  predicted pad only when the song's own length lands inside the window,
   *  so the choice made during playback matches the choice at completion. */
  private emotionForContinuation(
    emotion: import("../types").CurrentEmotion,
    startedAt: number,
    atMs: number,
  ): import("../types").CurrentEmotion {
    const elapsedMin = (atMs - startedAt) / 60_000;
    const pt = emotion.predicted_trajectory;
    if (pt !== undefined && elapsedMin >= 3 && elapsedMin <= pt.horizon_min) {
      return {
        pad: pt.predicted_pad,
        labels: emotion.labels,
        confidence: emotion.confidence,
        source: "emotion-agent-inferred",
      };
    }
    return emotion;
  }

  /** Pick the following song while the current one is audible. */
  private schedulePrepareNext(): void {
    const emotion = this.currentTurn?.current_emotion;
    const startedAt = this.currentTurn?.timestamp;
    if (!emotion || startedAt === undefined) return;
    const gen = this.prepareGen;
    const durationMs = this.currentSong?.duration_ms ?? 0;
    const atEnd = startedAt + durationMs;
    const task = this.prepareNextSong(gen, emotion, startedAt, atEnd).catch((err) => {
      console.warn("[lyra] prepare next song failed:", err);
    });
    this.prepareTask = task;
    void task.finally(() => {
      if (this.prepareTask === task) this.prepareTask = null;
    });
  }

  private async prepareNextSong(
    gen: number,
    emotion: import("../types").CurrentEmotion,
    startedAt: number,
    atMs: number,
  ): Promise<void> {
    const nextEmotion = this.emotionForContinuation(emotion, startedAt, atMs);
    const target = this.continuationTarget(nextEmotion);
    const key = this.sessionRankKeyFor(nextEmotion);
    if (this.sessionQueue.length === 0 || this.sessionRankKey !== key) {
      const ok = await this.rebuildSessionQueue(target, nextEmotion, key);
      if (!ok || gen !== this.prepareGen) return;
    }
    if (gen !== this.prepareGen) return;
    const song = this.sessionQueue[0];
    this.preparedNext = song ? { song, rankKey: this.sessionRankKey } : null;
  }

  private async takeNextRankedSong(
    target: string,
    emotion: import("../types").CurrentEmotion,
  ): Promise<LibraryTrack | null> {
    const key = this.sessionRankKeyFor(emotion);
    if (this.sessionQueue.length === 0 || this.sessionRankKey !== key) {
      await this.rebuildSessionQueue(target, emotion, key);
    }
    return this.sessionQueue.shift() ?? null;
  }

  /** Hydrate sticky intent from DB once per Orchestrator lifetime. */
  private async ensureActiveIntentLoaded(): Promise<void> {
    if (this.activeIntentLoaded) return;
    this.activeIntentLoaded = true;
    const repo = this.deps.activeIntentRepo;
    if (!repo) return;
    try {
      this.activeIntent = await repo.load();
    } catch (e) {
      console.warn("[lyra] activeIntentRepo.load failed:", e);
      this.activeIntent = null;
    }
  }

  getActiveIntent(): ActiveIntent | null {
    return this.activeIntent;
  }

  /** Persist or clear sticky intent. Fire-and-forget safe for callers. */
  async setActiveIntent(intent: ActiveIntent | null): Promise<void> {
    this.activeIntentLoaded = true;
    this.activeIntent = intent;
    const repo = this.deps.activeIntentRepo;
    if (!repo) return;
    try {
      if (intent) await repo.save(intent);
      else await repo.clear();
    } catch (e) {
      console.warn("[lyra] activeIntentRepo persist failed:", e);
    }
  }

  /**
   * Apply deterministic IntentParser result to the sticky-intent slot.
   * clear → wipe; hit with constraints → upsert; miss → keep prior.
   */
  private async applyParsedIntent(
    text: string,
    turnId: string,
    now: number,
  ): Promise<void> {
    await this.ensureActiveIntentLoaded();
    const parsed = parseIntent(text);
    if (!parsed.hit) return;

    if (parsed.clear) {
      await this.setActiveIntent(null);
      void productEventsRepo
        .record("active_intent_cleared", { via: "intent_parser", text })
        .catch(() => {});
      return;
    }

    const next: ActiveIntent = {
      rawText: text.trim(),
      constraints: parsed.constraints,
      persistence: parsed.persistence,
      source: "user-explicit",
      createdAt: now,
      turnId,
    };
    await this.setActiveIntent(next);
    void productEventsRepo
      .record("active_intent_set", {
        via: "intent_parser",
        persistence: next.persistence,
        languages: next.constraints.languages ?? [],
        genres: next.constraints.genres ?? [],
      })
      .catch(() => {});
  }

  /** Build pseudoTarget, always appending sticky intent rawText when present. */
  private buildPseudoTarget(
    userUtterance: string,
    emotionLabels: string[],
    override?: string,
  ): string {
    const intentText = this.activeIntent?.rawText?.trim() ?? "";
    const base =
      override !== undefined
        ? override
        : `${userUtterance} ${emotionLabels.join(" ")}`.trim();
    if (!intentText) return base.trim();
    // Avoid duplicating when the utterance itself already is the intent text
    if (base.includes(intentText)) return base.trim();
    return `${base} ${intentText}`.trim();
  }

  /** Finalise the previous turn: fold events, optionally apply verbal, update soul, persist.
   *  Clears the live turn first so a continuation can start playing while this write finishes. */
  private async finalisePreviousTurn(verbalText?: string, postPad?: PAD): Promise<void> {
    if (!this.currentTurn) return;

    let events = [...this.pendingEvents];
    const hasVerbal = this.currentTurn.user_reaction.verbal !== undefined
      || events.some((e) => e.kind === "verbal_next");
    if (verbalText !== undefined && !hasVerbal) {
      events.push({
        kind: "verbal_next",
        content: verbalText,
        parsed_valence: "neutral",
      });
    }
    const folded = foldReactionEvents(this.currentTurn, events);
    const song = this.currentSong;
    this.currentTurn = null;
    this.currentSong = null;
    this.pendingEvents = [];
    await this.persistFinishedTurn(folded, song, postPad);
  }

  /** Write a turn that has already left the live slot. Does not touch currentTurn. */
  private async persistFinishedTurn(
    folded: DialogueTurn,
    song: LibraryTrack | null,
    postPad?: PAD,
  ): Promise<void> {
    const { soulStore, turnRepo } = this.deps;

    if (postPad !== undefined && soulStore.apply) {
      await soulStore.load();
      const prePad = folded.current_emotion.pad;
      const delta = computeEmotionDelta(prePad, postPad);
      await soulStore.apply(delta);
    }

    const finalTurn: DialogueTurn = postPad !== undefined
      ? {
          ...folded,
          emotion_delta: computeEmotionDelta(folded.current_emotion.pad, postPad),
        }
      : folded;

    if (turnRepo.updateTurn) {
      await turnRepo.updateTurn(finalTurn);
    }

    if (song) {
      try {
        const moment = detectSalientMoment({
          turn: finalTurn,
          song,
          currentTags: currentTagsFor(new Date()),
        });
        if (moment) {
          try {
            await insertSharedMemory(moment);
          } catch (e) {
            console.warn("[lyra] sharedMemoryRepo.insertSharedMemory failed:", e);
          }
          try {
            await appendSalientMomentToMemoryMd(moment);
          } catch (e) {
            console.warn("[lyra] appendSalientMomentToMemoryMd failed:", e);
          }
        }
      } catch (e) {
        console.warn("[lyra] detectSalientMoment failed:", e);
      }
    }
  }

  /**
   * Run a full turn given an already-analysed emotion + a user utterance +
   * a modality. Shared between `onUserInput` (modality "text", with a fresh
   * EmotionAgent analysis) and `autoAdvance` (modality "proactive-open",
   * carrying the ended turn's emotion forward).
   *
   * Assumes `finalisePreviousTurn` has already been called by the caller.
   * Does NOT emit `thinking` — the caller emits it (to preserve the correct
   * `user_utterance` in the state).
   */
  private async runTurnWithEmotion(
    emotion: import("../types").CurrentEmotion,
    userUtterance: string,
    modality: "text" | "voice" | "proactive-open",
    pseudoTargetOverride?: string,
    excludeIds?: ReadonlySet<string>,
  ): Promise<void> {
    const { companion, library, soulStore, turnRepo, audio } = this.deps;
    const clock = this.deps.clock ?? Date.now;
    const idGen = this.deps.idGen ?? (() => crypto.randomUUID());

    // Sprint 11: end-to-end turn latency — from entering runTurnWithEmotion
    // (which the caller enters immediately after user input) through the
    // moment audio.playFile resolves. Recorded via a best-effort UPDATE
    // so a failing write never blocks the turn.
    const t0 = performance.now();

    const soul = await soulStore.load();

    await this.ensureActiveIntentLoaded();
    const pseudoTarget = this.buildPseudoTarget(
      userUtterance,
      emotion.labels,
      pseudoTargetOverride,
    );

    // A new utterance starts a fresh ranking. Continuous playback keeps the
    // queue so we walk down the list instead of re-picking the current #1.
    const rankedPlayback = modality === "proactive-open";
    if (!rankedPlayback) {
      this.clearSessionQueue();
    }

    let song: LibraryTrack;
    let chosen: {
      song_id: string;
      rationale: string;
      target_profile: string;
      needed_shift: "接住" | "点燃" | "陪着" | "打断";
      verbal_intent?: "switch" | "repeat" | "adjust_calmer" | "adjust_livelier" | "similar" | "clear_intent" | null;
    };

    if (rankedPlayback) {
      const next = await this.takeNextRankedSong(pseudoTarget, emotion);
      if (!next) {
        this.emit({
          kind: "error",
          message: "library is empty; add music in Settings",
        });
        return;
      }
      song = next;
      chosen = {
        song_id: next.id,
        target_profile: pseudoTarget,
        rationale: "顺着此刻的意图和情绪，往下听。",
        needed_shift: inferShift(
          emotion.pad,
          emotion.confidence,
          this.perceptionSignals.isBlurred,
          this.perceptionSignals.skipRatio,
          this.perceptionSignals.inputHesitation,
        ),
      };
    } else {
      let candidates = await library.prefilter(
        pseudoTarget,
        emotion.pad,
        30,
        excludeIds,
        this.activeIntent ?? undefined,
      );
      // Fallback: if excludeIds emptied the library (e.g., only one track exists
      // and it's the one we just played), retry without the exclusion so we
      // still play something rather than erroring.
      if (candidates.length === 0 && excludeIds && excludeIds.size > 0) {
        candidates = await library.prefilter(
          pseudoTarget,
          emotion.pad,
          30,
          undefined,
          this.activeIntent ?? undefined,
        );
      }
      if (candidates.length === 0) {
        this.emit({
          kind: "error",
          message: "library is empty; add music in Settings",
        });
        return;
      }

      const ctx = await this.buildCompanionContext(candidates.map((c) => c.id));
      chosen = await companion.choose({
        userUtterance,
        currentEmotion: emotion,
        soul,
        candidates,
        handoff: "user-spoke",
        // Phase 3a: pass currently-playing song so verbal_intent ("换一个"/"再来一遍") works.
        ...(this.currentSong != null ? { lastSong: this.currentSong } : {}),
        ...ctx,
      });

      // Companion LLM may clear sticky intent when IntentParser missed the cue.
      if (chosen.verbal_intent === "clear_intent") {
        await this.setActiveIntent(null);
        void productEventsRepo
          .record("active_intent_cleared", { via: "companion_verbal_intent" })
          .catch(() => {});
      }

      song = candidates.find((c) => c.id === chosen.song_id)!;
    }

    const turnId = idGen();
    const turnTs = clock();
    // Sprint 17: capture shift meta so skip/complete can persist feedback
    this.currentShiftMeta = {
      turnId,
      shift: chosen.needed_shift,
      padAtTime: emotion.pad,
      startedAt: turnTs,
    };

    const turn: DialogueTurn = {
      id: turnId,
      timestamp: turnTs,
      current_emotion: emotion,
      user_utterance: { modality, content: userUtterance },
      agent_response: {
        song_id: chosen.song_id,
        rationale: chosen.rationale,
        target_profile: chosen.target_profile,
      },
      user_reaction: {
        behavioral: {
          listen_duration_ms: 0,
          completed: false,
          skipped: false,
          repeated: 0,
          volume_delta: 0,
        },
        silence_positive: false,
      },
      emotion_delta: ZERO_PAD,
    };

    await turnRepo.insertTurn(turn);
    await audio.playFile(song.path, song.duration_ms ?? null);

    // Sprint 11: fire-and-forget latency write. The chained UPDATE isn't in
    // the critical path — user sees the song already; we just record the
    // observation.
    const turn_latency_ms = Math.round(performance.now() - t0);
    if (turnRepo.setTurnLatency) {
      void turnRepo.setTurnLatency(turn.id, turn_latency_ms).catch(() => {});
    }

    this.currentTurn = turn;
    this.currentSong = song;
    this.pendingEvents = [];
    this.trackSongPicked(song.id);

    // Consume once-intent after the first successful play.
    if (this.activeIntent?.persistence === "once") {
      await this.setActiveIntent(null);
    }

    this.emit({ kind: "playing", turn, song });
    this.schedulePrepareNext();
  }

  /**
   * Install a proactive-pending state without playing audio. The song will
   * only start when the user interacts (types or clicks). Does NOT call
   * audio.playFile — presentation only.
   */
  startProactiveIntent(
    intent: ProactiveIntent,
    song: LibraryTrack,
    rationale: string,
  ): void {
    this.emit({ kind: "proactive-pending", intent, song, rationale });
  }

  /**
   * Select a song for a proactive intent and enter `proactive-pending`.
   * Does NOT play audio. No-ops when busy, library empty, or selection fails.
   */
  async fulfillProactive(intent: ProactiveIntent): Promise<void> {
    const kind = this.state.kind;
    if (
      kind === "thinking" ||
      kind === "playing" ||
      kind === "proactive-pending" ||
      kind === "show-talk" ||
      this.proactiveInFlight
    ) {
      console.debug(
        `[lyra] fulfillProactive skipped: busy state=${kind} inFlight=${this.proactiveInFlight} kind=${intent.kind}`,
      );
      return;
    }

    this.proactiveInFlight = true;
    try {
      const { companion, library, soulStore } = this.deps;

      const soul = await soulStore.load();
      const pad = soul.dynamic_mood.current_pad;
      const pseudoTarget = [
        intent.targetProfile,
        intent.hint,
        intent.seed?.songHint,
      ]
        .filter((s): s is string => Boolean(s && s.trim()))
        .join(" ")
        .trim();

      const candidates = await library.prefilter(pseudoTarget || intent.hint, pad, 30);
      if (candidates.length === 0) {
        console.debug("[lyra] fulfillProactive skipped: empty library");
        return;
      }

      const emotion: CurrentEmotion = {
        pad,
        labels: [],
        confidence: 0.2,
        source: "emotion-agent-inferred",
      };
      const ctx = await this.buildCompanionContext(candidates.map((c) => c.id));
      const chosen = await companion.choose({
        userUtterance: "",
        currentEmotion: emotion,
        soul,
        candidates,
        handoff: "cold-open",
        ...ctx,
      });
      const song = candidates.find((c) => c.id === chosen.song_id);
      if (!song) {
        console.warn(`[lyra] fulfillProactive: companion chose missing song_id=${chosen.song_id}`);
        return;
      }
      this.startProactiveIntent(intent, song, chosen.rationale);
    } catch (err) {
      console.warn("[lyra] fulfillProactive failed:", err);
    } finally {
      this.proactiveInFlight = false;
    }
  }

  async onUserInput(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) {
      if (this.state.kind === "show-talk") await this.playCurrentShowBeat();
      return;
    }
    const showCmd = parseShowCommand(trimmed);
    if (showCmd?.kind === "off") {
      this.endShow();
      return;
    }
    if (showCmd?.kind === "start") {
      await this.startShow(showCmd.topic, showCmd.guestName);
      return;
    }
    if (this.show && (this.state.kind === "show-talk" || this.state.kind === "playing")) {
      await this.rewriteShowTail(trimmed);
      return;
    }

    const emotionAgent = this.deps.emotion;

    // If we have a proactive-pending intent, commit it as a real turn first
    // (backdated with modality "proactive-open"), then process the utterance.
    const currentState = this.state;
    if (currentState.kind === "proactive-pending") {
      // User is consuming the proactive intent — stop the breathing animation
      setBreathing(false).catch(() => {/* best-effort; tray unavailable in tests */});

      const { song, rationale } = currentState;
      const clock = this.deps.clock ?? Date.now;
      const idGen = this.deps.idGen ?? (() => crypto.randomUUID());
      const { soulStore, turnRepo } = this.deps;

      try {
        const soul = await soulStore.load();
        const pendingTurn: DialogueTurn = {
          id: idGen(),
          timestamp: clock(),
          current_emotion: {
            pad: soul.dynamic_mood.current_pad,
            labels: [],
            confidence: 0,
            source: "emotion-agent-inferred" as const,
          },
          user_utterance: { modality: "proactive-open", content: "" },
          agent_response: { song_id: song.id, rationale },
          user_reaction: {
            behavioral: {
              listen_duration_ms: 0,
              completed: false,
              skipped: false,
              repeated: 0,
              volume_delta: 0,
            },
            silence_positive: false,
          },
          emotion_delta: ZERO_PAD,
        };
        await turnRepo.insertTurn(pendingTurn);
        // Set as current turn (no audio yet — user consumed it by typing)
        this.currentTurn = pendingTurn;
        this.currentSong = song;
        this.pendingEvents = [];
        this.trackSongPicked(song.id);
      } catch (err) {
        console.warn("[lyra] failed to commit proactive-pending turn:", err);
      }
    }

    // Clear sulk on any user input (user is actively engaging)
    // (SulkStore instance is not held here; callers wire clearSulk separately
    //  via the proactive engine's recordOutcome path — this is the Orchestrator's
    //  responsibility boundary in v0.2.)

    this.emit({ kind: "thinking", user_utterance: text });

    // Emit input_submit event for perception aggregator (best-effort, optional).
    try {
      const clock = this.deps.clock ?? Date.now;
      this.deps.eventBus?.emit({
        kind: "input_submit",
        at: clock(),
        charCount: text.length,
      });
    } catch {
      /* bus errors are non-fatal */
    }

    const clock = this.deps.clock ?? Date.now;
    const idGen = this.deps.idGen ?? (() => crypto.randomUUID());
    const diagId = idGen().slice(0, 8);
    const t0 = performance.now();
    let phase: "intent" | "emotion" | "finalize" | "companion" = "intent";

    lyraLog("turn", "info", "start", {
      diagId,
      utteranceLen: text.length,
    });

    try {
      // Sticky intent must be applied BEFORE emotion/prefilter so the same
      // turn's candidate pool already reflects "一直播放粤语歌曲".
      lyraLog("turn", "info", "phase", { diagId, phase: "intent" });
      await this.applyParsedIntent(text, idGen(), clock());

      phase = "emotion";
      lyraLog("turn", "info", "phase", { diagId, phase: "emotion" });
      const emotion = await emotionAgent.analyze({ userUtterance: text });
      const blended = blendEmotionWithBias(emotion, this.perceptionBias);

      phase = "finalize";
      lyraLog("turn", "info", "phase", { diagId, phase: "finalize" });
      await this.finalisePreviousTurn(text, blended.pad);

      phase = "companion";
      lyraLog("turn", "info", "phase", { diagId, phase: "companion" });
      await this.runTurnWithEmotion(blended, text, "text");

      lyraLog("turn", "info", "ok", {
        diagId,
        ms: Math.round(performance.now() - t0),
      });
    } catch (err) {
      const code = classifyError(err);
      const detail = formatErrorDetail(err);
      const ms = Math.round(performance.now() - t0);
      logLyraError("orchestrator error", err, {
        diagId,
        phase,
        code,
        utteranceLen: text.length,
        ms,
      });
      lyraLog("turn", "error", "failed", { diagId, phase, code, ms });
      // Persist so DataExplorer can show failures that never produced a response.
      writeTrace({
        agent_kind: phase === "companion" ? "companion" : "emotion",
        prompt_text: text,
        raw_response: "",
        parsed_json: {
          __turn_error__: true,
          code,
          phase,
          diagId,
          message: detail.message,
          name: detail.name,
        },
        duration_ms: ms,
      });
      this.emit({ kind: "error", message: userFacingErrorMessage(err) });
    }
  }

  /** Record listen progress — keeps running maximum of ms listened. */
  onListenProgress(ms: number): void {
    this.pendingEvents.push({ kind: "listen_progress", ms });
  }

  /** Sprint 20: assemble the perception/memory/feature context that both
   *  companion.choose call sites need. Keeps the two paths in sync. */
  private async buildCompanionContext(
    candidateIds: string[],
  ): Promise<{
    livingPortrait: string | undefined;
    topFacts: import("../memory/types").Fact[] | undefined;
    skipRatio: number;
    isBlurred: boolean;
    inputHesitation: "none" | "some" | "many";
    emotionTimelineSummary: string | undefined;
    candidateFeatures:
      | Map<string, import("../db/repo/libraryFeaturesRepo").LibraryFeatures>
      | undefined;
    candidateProfiles:
      | Map<string, import("../db/repo/trackProfilesRepo").TrackProfile>
      | undefined;
    activeIntent: ActiveIntent | null;
  }> {
    await this.ensureActiveIntentLoaded();
    const { livingPortrait, topFacts, emotionTimeline } = getMemoryContext();
    const candidateFeatures = await (this.deps.libraryFeaturesRepo
      ?.getBatch(candidateIds)
      .catch(() => undefined));
    const candidateProfiles = await (this.deps.trackProfilesRepo
      ?.getBatch(candidateIds)
      .catch(() => undefined));
    return {
      livingPortrait,
      topFacts,
      skipRatio: this.perceptionSignals.skipRatio,
      isBlurred: this.perceptionSignals.isBlurred,
      inputHesitation: this.perceptionSignals.inputHesitation,
      emotionTimelineSummary: emotionTimeline
        ? `${emotionTimeline.window} 窗口: pleasure ${emotionTimeline.pleasureTrend}, arousal ${emotionTimeline.arousalTrend}, volatility ${(emotionTimeline.volatility * 100).toFixed(0)}%`
        : undefined,
      candidateFeatures,
      candidateProfiles,
      activeIntent: this.activeIntent,
    };
  }

  /** Sprint 17: persist a ShiftFeedback row based on currentShiftMeta. */
  private recordShiftFeedback(userAction: "complete" | "skip" | "proactive_dismiss"): void {
    const meta = this.currentShiftMeta;
    const repo = this.deps.shiftFeedbackRepo;
    if (!meta || !repo) return;
    const clock = this.deps.clock ?? Date.now;
    const now = clock();
    void repo
      .insert({
        turnId: meta.turnId,
        recommendedShift: meta.shift,
        userAction,
        padAtTime: meta.padAtTime,
        timeToActionMs: Math.max(0, now - meta.startedAt),
        timestamp: now,
      })
      .catch((err) => console.warn("[lyra] shiftFeedback insert failed:", err));
  }

  /** User skipped the song. Fold skip event into current turn. */
  async onSkip(): Promise<void> {
    // Emit perception skip event (best-effort, optional bus).
    try {
      const clock = this.deps.clock ?? Date.now;
      this.deps.eventBus?.emit({
        kind: "skip",
        at: clock(),
        turnId: this.currentTurn?.id ?? "",
      });
    } catch {
      /* bus errors are non-fatal */
    }

    this.recordShiftFeedback("skip");

    this.pendingEvents.push({ kind: "skip" });
    await this.deps.audio.stop();
    // Fold immediately so currentTurn reflects skip
    if (this.currentTurn) {
      this.currentTurn = foldReactionEvents(this.currentTurn, this.pendingEvents);
      this.pendingEvents = [];
    }
  }

  /**
   * Song played to completion. The next track was chosen while this one was
   * still playing, so it starts before the finished turn is saved.
   * Nothing auto-advances if there's no `currentTurn` (stale event).
   */
  async onSongComplete(): Promise<void> {
    if (this.suppressComplete) return;
    if (!this.currentTurn) return;

    if (this.show && this.show.beatIndex + 1 < this.show.rundown.beats.length) {
      await this.advanceShowToNextTalk();
      return;
    }
    if (this.show && (await this.extendShow())) {
      await this.advanceShowToNextTalk();
      return;
    }
    this.show = null;

    // Emit perception complete event (best-effort, optional bus).
    try {
      const clockFn = this.deps.clock ?? Date.now;
      this.deps.eventBus?.emit({
        kind: "complete",
        at: clockFn(),
        turnId: this.currentTurn.id,
      });
    } catch {
      /* bus errors are non-fatal */
    }

    this.recordShiftFeedback("complete");

    this.pendingEvents.push({ kind: "complete" });
    const endedTurn = foldReactionEvents(this.currentTurn, this.pendingEvents);
    this.pendingEvents = [];
    const endedSong = this.currentSong;
    const endedEmotion = endedTurn.current_emotion;
    const turnTimestamp = endedTurn.timestamp;

    try {
      if (this.prepareTask) await this.prepareTask;

      const clock = this.deps.clock ?? Date.now;
      const now = clock();
      const baseEmotion = this.emotionForContinuation(endedEmotion, turnTimestamp, now);
      const pseudoTarget = this.continuationTarget(baseEmotion);
      const key = this.sessionRankKeyFor(baseEmotion);

      let song: LibraryTrack | null = null;
      if (
        this.preparedNext &&
        this.preparedNext.rankKey === key &&
        this.sessionQueue[0]?.id === this.preparedNext.song.id
      ) {
        song = this.sessionQueue.shift() ?? null;
        this.preparedNext = null;
      } else {
        this.preparedNext = null;
        song = await this.takeNextRankedSong(pseudoTarget, baseEmotion);
      }
      if (!song) {
        this.currentTurn = null;
        this.currentSong = null;
        this.emit({
          kind: "error",
          message: "library is empty; add music in Settings",
        });
        return;
      }

      const { turnRepo, audio } = this.deps;
      const idGen = this.deps.idGen ?? (() => crypto.randomUUID());
      const turnId = idGen();
      const neededShift = inferShift(
        baseEmotion.pad,
        baseEmotion.confidence,
        this.perceptionSignals.isBlurred,
        this.perceptionSignals.skipRatio,
        this.perceptionSignals.inputHesitation,
      );
      const turn: DialogueTurn = {
        id: turnId,
        timestamp: now,
        current_emotion: baseEmotion,
        user_utterance: { modality: "proactive-open", content: "" },
        agent_response: {
          song_id: song.id,
          rationale: "顺着此刻的意图和情绪，往下听。",
          target_profile: pseudoTarget,
        },
        user_reaction: {
          behavioral: {
            listen_duration_ms: 0,
            completed: false,
            skipped: false,
            repeated: 0,
            volume_delta: 0,
          },
          silence_positive: false,
        },
        emotion_delta: ZERO_PAD,
      };

      await audio.playFile(song.path, song.duration_ms ?? null);

      this.currentShiftMeta = {
        turnId,
        shift: neededShift,
        padAtTime: baseEmotion.pad,
        startedAt: now,
      };
      this.currentTurn = turn;
      this.currentSong = song;
      this.pendingEvents = [];
      this.trackSongPicked(song.id);
      if (this.activeIntent?.persistence === "once") {
        await this.setActiveIntent(null);
      }
      this.emit({ kind: "playing", turn, song });

      await this.persistFinishedTurn(endedTurn, endedSong, endedEmotion.pad);
      await turnRepo.insertTurn(turn);
      this.schedulePrepareNext();
    } catch (err) {
      const code = classifyError(err);
      const detail = formatErrorDetail(err);
      logLyraError("auto-advance error", err, {
        phase: "onSongComplete",
        code,
      });
      lyraLog("turn", "error", "auto-advance failed", { code });
      writeTrace({
        agent_kind: "companion",
        prompt_text: "(auto-advance)",
        raw_response: "",
        parsed_json: {
          __turn_error__: true,
          code,
          phase: "onSongComplete",
          message: detail.message,
          name: detail.name,
        },
      });
      this.emit({ kind: "error", message: userFacingErrorMessage(err) });
    }
  }

  private clearShowPlayTimer(): void {
    if (this.showPlayTimer !== null) {
      clearTimeout(this.showPlayTimer);
      this.showPlayTimer = null;
    }
  }

  private cancelShowSpeech(): void {
    this.showSpeakGen += 1;
    this.clearShowPlayTimer();
    this.deps.showVoice?.cancel();
  }

  private armShowPlayTimer(): void {
    this.clearShowPlayTimer();
    if (this.state.kind !== "show-talk") return;
    this.showPlayTimer = setTimeout(() => {
      this.showPlayTimer = null;
      void this.playCurrentShowBeat();
    }, SHOW_TALK_BEFORE_PLAY_MS);
  }

  private armShowPlay(): void {
    this.clearShowPlayTimer();
    if (this.state.kind !== "show-talk") return;
    const voice = this.deps.showVoice;
    if (voice) {
      const gen = this.showSpeakGen;
      const lines = this.state.lines;
      void voice.speak(lines).then(
        () => {
          if (gen !== this.showSpeakGen || this.state.kind !== "show-talk") return;
          void this.playCurrentShowBeat();
        },
        () => {
          if (gen !== this.showSpeakGen || this.state.kind !== "show-talk") return;
          this.armShowPlayTimer();
        },
      );
      return;
    }
    this.armShowPlayTimer();
  }

  private endShow(): void {
    this.cancelShowSpeech();
    const had = this.show !== null;
    this.show = null;
    if (!had) return;
    if (this.state.kind === "show-talk") {
      this.emit({ kind: "idle" });
      return;
    }
    if (this.state.kind === "playing") {
      this.emit({
        kind: "playing",
        turn: this.state.turn,
        song: this.state.song,
        aside: "这期到这里。后面我自己接着放。",
      });
    }
  }

  private async startShow(topic: string, guestName: string): Promise<void> {
    const trimmed = topic.trim();
    if (!trimmed) {
      this.emit({ kind: "error", message: "给这期一个题目" });
      return;
    }
    if (!this.deps.showAgent) {
      this.emit({ kind: "error", message: "节目还没接上" });
      return;
    }

    this.cancelShowSpeech();
    this.emit({ kind: "thinking", user_utterance: `/show ${trimmed}` });
    this.suppressComplete = true;
    try {
      try {
        await this.deps.audio.stop();
      } catch {
        /* nothing was playing */
      }
      await this.finalisePreviousTurn(trimmed);
    } finally {
      this.suppressComplete = false;
    }
    this.show = null;
    this.clearSessionQueue();

    try {
      const emotion = await this.deps.emotion.analyze({ userUtterance: trimmed });
      const blended = blendEmotionWithBias(emotion, this.perceptionBias);
      const candidates = await this.deps.library.prefilter(trimmed, blended.pad, 30);
      if (candidates.length === 0) {
        this.emit({ kind: "error", message: "library is empty; add music in Settings" });
        return;
      }
      const beats = await this.writeShowBeats(trimmed, guestName, blended, candidates);
      if (beats.length === 0) {
        this.emit({ kind: "error", message: "这期没有能放的歌" });
        return;
      }
      this.show = {
        rundown: { topic: trimmed, guestName, beats },
        beatIndex: 0,
        songs: new Map(candidates.map((song) => [song.id, song])),
        emotion: blended,
      };
      this.emitShowTalk();
    } catch (err) {
      this.emit({ kind: "error", message: userFacingErrorMessage(err) });
    }
  }

  private async rewriteShowTail(steer: string): Promise<void> {
    const session = this.show;
    if (!session || !this.deps.showAgent) return;
    const playing = this.state.kind === "playing" ? this.state : null;
    const from = playing ? session.beatIndex + 1 : session.beatIndex;
    const kept = session.rundown.beats.slice(0, from);
    const used = new Set(kept.map((beat) => beat.song_id));
    if (!playing) {
      this.cancelShowSpeech();
      this.emit({ kind: "thinking", user_utterance: steer });
    }
    try {
      const candidates = await this.deps.library.prefilter(
        `${session.rundown.topic} ${steer}`,
        session.emotion.pad,
        30,
        used,
      );
      const fresh = candidates.filter((song) => !used.has(song.id));
      if (fresh.length === 0) {
        this.restoreShowSurface(playing, "后面没有别的歌了");
        return;
      }
      const beats = await this.writeShowBeats(
        session.rundown.topic,
        session.rundown.guestName,
        session.emotion,
        fresh,
        steer,
        false,
        kept.length,
      );
      if (beats.length === 0) {
        this.restoreShowSurface(playing, "这句我没接住，节目还在");
        return;
      }
      for (const song of fresh) session.songs.set(song.id, song);
      session.rundown.beats = [...kept, ...beats];
      if (playing) {
        this.emit({
          kind: "playing",
          turn: playing.turn,
          song: playing.song,
          aside: "后半段按你刚才的话改了。",
        });
        return;
      }
      session.beatIndex = from;
      this.emitShowTalk();
    } catch (err) {
      this.restoreShowSurface(playing, userFacingErrorMessage(err));
    }
  }

  private restoreShowSurface(
    playing: Extract<OrchestratorState, { kind: "playing" }> | null,
    note: string,
  ): void {
    if (playing) {
      this.emit({ kind: "playing", turn: playing.turn, song: playing.song, aside: note });
      return;
    }
    this.emitShowTalk(note);
  }

  /** Another segment of the same show. False when nothing new can be written. */
  private async extendShow(): Promise<boolean> {
    const session = this.show;
    if (!session || !this.deps.showAgent) return false;
    const used = new Set(session.rundown.beats.map((beat) => beat.song_id));
    try {
      const candidates = await this.deps.library.prefilter(
        session.rundown.topic,
        session.emotion.pad,
        30,
        used,
      );
      const fresh = candidates.filter((song) => !used.has(song.id));
      if (fresh.length === 0) return false;
      const beats = await this.writeShowBeats(
        session.rundown.topic,
        session.rundown.guestName,
        session.emotion,
        fresh,
        undefined,
        true,
        session.rundown.beats.length,
      );
      if (beats.length === 0) return false;
      for (const song of fresh) session.songs.set(song.id, song);
      session.rundown.beats = [...session.rundown.beats, ...beats];
      return true;
    } catch (err) {
      console.warn("[lyra] show extend failed:", err);
      return false;
    }
  }

  private async writeShowBeats(
    topic: string,
    guestName: string,
    emotion: CurrentEmotion,
    candidates: LibraryTrack[],
    steer?: string,
    continuing = false,
    toneOffset = 0,
  ): Promise<ShowBeat[]> {
    const ctx = await this.buildCompanionContext(candidates.map((song) => song.id));
    const clock = this.deps.clock ?? Date.now;
    const weather = (await this.deps.readWeather?.()) ?? null;
    const songs = candidates.map((song) => this.showCandidate(song, ctx.candidateProfiles));
    const beats = await this.deps.showAgent!.write({
      topic,
      guestName,
      ...(steer ? { steer } : {}),
      ...(continuing ? { continuing: true } : {}),
      when: formatShowClock(new Date(clock())),
      weather,
      emotionLabels: emotion.labels,
      pad: emotion.pad,
      ...(ctx.livingPortrait ? { livingPortrait: ctx.livingPortrait } : {}),
      facts: (ctx.topFacts ?? []).map((fact) => ({
        tags: fact.tags,
        conclusion: fact.conclusion,
      })),
      candidates: songs,
    });
    if (beats.length === 0 || !this.deps.showBoundary) return beats;
    try {
      return await this.deps.showBoundary.color({ topic, beats, songs, toneOffset });
    } catch (err) {
      console.warn("[lyra] show boundary failed:", err);
      return beats;
    }
  }

  private showCandidate(
    song: LibraryTrack,
    profiles: Map<string, import("../db/repo/trackProfilesRepo").TrackProfile> | undefined,
  ): ShowBrief["candidates"][number] {
    const profile = profiles?.get(song.id);
    return {
      id: song.id,
      title: song.title ?? "",
      artist: song.artist ?? "",
      ...(profile?.language ? { language: profile.language } : {}),
      ...(profile?.one_liner ? { oneLiner: profile.one_liner } : {}),
      ...(profile?.genres?.length ? { genres: profile.genres.slice(0, 3) } : {}),
      ...(profile?.mood?.length ? { mood: profile.mood.slice(0, 3) } : {}),
      ...(profile?.scenes?.length ? { scenes: profile.scenes.slice(0, 3) } : {}),
      ...(profile?.era ? { era: profile.era } : {}),
      ...(profile?.energy_check ? { energy: profile.energy_check } : {}),
    };
  }

  private emitShowTalk(note?: string): void {
    const session = this.show;
    if (!session) return;
    const beat = session.rundown.beats[session.beatIndex];
    const song = beat ? session.songs.get(beat.song_id) : undefined;
    if (!beat || !song) {
      this.emit({ kind: "error", message: "这期没有能放的歌" });
      return;
    }
    this.emit({
      kind: "show-talk",
      guestName: session.rundown.guestName,
      lines: beat.lines,
      song,
      beatIndex: session.beatIndex,
      beatCount: session.rundown.beats.length,
      pad: session.emotion.pad,
      ...(note ? { note } : {}),
    });
    this.armShowPlay();
  }

  private async playCurrentShowBeat(): Promise<void> {
    this.cancelShowSpeech();
    const session = this.show;
    if (!session || this.state.kind !== "show-talk") return;
    const beat = session.rundown.beats[session.beatIndex];
    if (!beat) return;
    const song = session.songs.get(beat.song_id);
    if (!song) {
      this.emit({ kind: "error", message: "这期没有能放的歌" });
      return;
    }
    const clock = this.deps.clock ?? Date.now;
    const idGen = this.deps.idGen ?? (() => crypto.randomUUID());
    const turn: DialogueTurn = {
      id: idGen(),
      timestamp: clock(),
      current_emotion: session.emotion,
      user_utterance: { modality: "text", content: session.rundown.topic },
      agent_response: {
        song_id: song.id,
        rationale: formatShowScript(beat.lines, session.rundown.guestName),
        target_profile: session.rundown.topic,
      },
      user_reaction: {
        behavioral: {
          listen_duration_ms: 0,
          completed: false,
          skipped: false,
          repeated: 0,
          volume_delta: 0,
        },
        silence_positive: false,
      },
      emotion_delta: ZERO_PAD,
    };
    await this.deps.turnRepo.insertTurn(turn);
    await this.deps.audio.playFile(song.path, song.duration_ms ?? null);
    this.currentShiftMeta = {
      turnId: turn.id,
      shift: "陪着",
      padAtTime: session.emotion.pad,
      startedAt: turn.timestamp,
    };
    this.currentTurn = turn;
    this.currentSong = song;
    this.pendingEvents = [];
    this.trackSongPicked(song.id);
    this.emit({ kind: "playing", turn, song });
  }

  private async advanceShowToNextTalk(): Promise<void> {
    if (!this.currentTurn || !this.show) return;
    try {
      const clockFn = this.deps.clock ?? Date.now;
      this.deps.eventBus?.emit({
        kind: "complete",
        at: clockFn(),
        turnId: this.currentTurn.id,
      });
    } catch {
      /* bus errors are non-fatal */
    }
    this.recordShiftFeedback("complete");
    this.pendingEvents.push({ kind: "complete" });
    const endedTurn = foldReactionEvents(this.currentTurn, this.pendingEvents);
    const endedSong = this.currentSong;
    const endedPad = endedTurn.current_emotion.pad;
    this.pendingEvents = [];
    this.currentTurn = null;
    this.currentSong = null;
    this.show.beatIndex += 1;
    this.emitShowTalk();
    await this.persistFinishedTurn(endedTurn, endedSong, endedPad);
  }
}

/**
 * Blend the user-utterance-derived emotion with a PerceptionBias.
 * The bias's pad values are scaled by its confidence before being added,
 * then clamped to [-1, 1]. When no bias is present, returns emotion as-is.
 */
export function blendEmotionWithBias(
  emotion: CurrentEmotion,
  bias: PerceptionBias | null,
): CurrentEmotion {
  if (!bias) return emotion;
  return {
    ...emotion,
    pad: {
      p: clampPad(emotion.pad.p + bias.pad_bias.p * bias.confidence),
      a: clampPad(emotion.pad.a + bias.pad_bias.a * bias.confidence),
      d: clampPad(emotion.pad.d + bias.pad_bias.d * bias.confidence),
    },
  };
}

function clampPad(v: number): number {
  return Math.max(-1, Math.min(1, v));
}
