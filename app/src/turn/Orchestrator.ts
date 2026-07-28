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

export type SoulStoreLike = {
  load(): Promise<SoulState>;
  apply?: (delta: PAD) => Promise<SoulState>;
};

type SoulStore = SoulStoreLike;

export type OrchestratorState =
  | { kind: "idle" }
  | { kind: "thinking"; user_utterance: string }
  | { kind: "playing"; turn: DialogueTurn; song: LibraryTrack }
  | { kind: "error"; message: string }
  | { kind: "proactive-pending"; intent: ProactiveIntent; song: LibraryTrack; rationale: string };

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
  clock?: () => number;
  idGen?: () => string;
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

  constructor(deps: OrchestratorDeps) {
    this.deps = deps;
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

  /** Finalise the previous turn: fold events, optionally apply verbal, update soul, persist. */
  private async finalisePreviousTurn(verbalText?: string, postPad?: PAD): Promise<void> {
    if (!this.currentTurn) return;

    const { soulStore, turnRepo } = this.deps;
    let events = [...this.pendingEvents];

    // If there's a verbal follow-up from the next utterance and the turn has no verbal yet
    const hasVerbal = this.currentTurn.user_reaction.verbal !== undefined
      || events.some((e) => e.kind === "verbal_next");

    if (verbalText !== undefined && !hasVerbal) {
      events.push({
        kind: "verbal_next",
        content: verbalText,
        parsed_valence: "neutral",
      });
    }

    // Fold all events into the turn
    const folded = foldReactionEvents(this.currentTurn, events);

    // Compute emotion delta and update soul
    if (postPad !== undefined && soulStore.apply) {
      const prePad = folded.current_emotion.pad;
      const delta = computeEmotionDelta(prePad, postPad);
      await soulStore.apply(delta);
    }

    // Update the turn's emotion_delta if we have postPad
    const finalTurn: DialogueTurn = postPad !== undefined
      ? {
          ...folded,
          emotion_delta: computeEmotionDelta(folded.current_emotion.pad, postPad),
        }
      : folded;

    // Persist the updated turn
    if (turnRepo.updateTurn) {
      await turnRepo.updateTurn(finalTurn);
    }

    // Detect salient moment and persist to shared_memory + memory.md
    const currentSong = this.currentSong;
    if (currentSong) {
      try {
        const moment = detectSalientMoment({
          turn: finalTurn,
          song: currentSong,
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

    this.currentTurn = null;
    this.currentSong = null;
    this.pendingEvents = [];
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

    const pseudoTarget =
      pseudoTargetOverride ??
      `${userUtterance} ${emotion.labels.join(" ")}`.trim();
    let candidates = await library.prefilter(
      pseudoTarget,
      emotion.pad,
      30,
      excludeIds,
    );
    // Fallback: if excludeIds emptied the library (e.g., only one track exists
    // and it's the one we just played), retry without the exclusion so we
    // still play something rather than erroring.
    if (candidates.length === 0 && excludeIds && excludeIds.size > 0) {
      candidates = await library.prefilter(pseudoTarget, emotion.pad, 30);
    }
    if (candidates.length === 0) {
      this.emit({
        kind: "error",
        message: "library is empty; add music in Settings",
      });
      return;
    }

    const { livingPortrait, topFacts, emotionTimeline } = getMemoryContext();
    // Sprint 19: fetch libraryFeatures for candidates so shiftRanker uses
    // real bpm/energy/valence, not just metadata.
    const candidateFeatures = await (this.deps.libraryFeaturesRepo
      ?.getBatch(candidates.map((c) => c.id))
      .catch(() => undefined));
    const chosen = await companion.choose({
      userUtterance,
      currentEmotion: emotion,
      soul,
      candidates,
      livingPortrait,
      topFacts,
      skipRatio: this.perceptionSignals.skipRatio,
      isBlurred: this.perceptionSignals.isBlurred,
      inputHesitation: this.perceptionSignals.inputHesitation,
      emotionTimelineSummary: emotionTimeline
        ? `${emotionTimeline.window} 窗口: pleasure ${emotionTimeline.pleasureTrend}, arousal ${emotionTimeline.arousalTrend}, volatility ${(emotionTimeline.volatility * 100).toFixed(0)}%`
        : undefined,
      candidateFeatures,
    });
    const song = candidates.find((c) => c.id === chosen.song_id)!;

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
      agent_response: { song_id: chosen.song_id, rationale: chosen.rationale },
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
    this.emit({ kind: "playing", turn, song });
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
    if (kind === "thinking" || kind === "playing" || kind === "proactive-pending" || this.proactiveInFlight) {
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

      const { livingPortrait, topFacts, emotionTimeline } = getMemoryContext();
      const emotion: CurrentEmotion = {
        pad,
        labels: [],
        confidence: 0.2,
        source: "emotion-agent-inferred",
      };
      // Sprint 19: same feature enrichment for proactive path
      const candidateFeatures = await (this.deps.libraryFeaturesRepo
        ?.getBatch(candidates.map((c) => c.id))
        .catch(() => undefined));
      const chosen = await companion.choose({
        userUtterance: "",
        currentEmotion: emotion,
        soul,
        candidates,
        livingPortrait,
        topFacts,
        skipRatio: this.perceptionSignals.skipRatio,
        isBlurred: this.perceptionSignals.isBlurred,
        inputHesitation: this.perceptionSignals.inputHesitation,
        emotionTimelineSummary: emotionTimeline
          ? `${emotionTimeline.window} 窗口: pleasure ${emotionTimeline.pleasureTrend}, arousal ${emotionTimeline.arousalTrend}, volatility ${(emotionTimeline.volatility * 100).toFixed(0)}%`
          : undefined,
        candidateFeatures,
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

    try {
      const emotion = await emotionAgent.analyze({ userUtterance: text });
      const blended = blendEmotionWithBias(emotion, this.perceptionBias);
      await this.finalisePreviousTurn(text, blended.pad);
      await this.runTurnWithEmotion(blended, text, "text");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[lyra] orchestrator error:", err);
      this.emit({ kind: "error", message: msg });
    }
  }

  /** Record listen progress — keeps running maximum of ms listened. */
  onListenProgress(ms: number): void {
    this.pendingEvents.push({ kind: "listen_progress", ms });
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
   * Song played to completion. Fold the `complete` event into the current
   * turn, finalise it (soul mood update, Salient Moment detection), then
   * auto-advance to the next song using the ended turn's emotion as the
   * baseline. "Prediction" in v0.1 is honestly "carry the previous emotion
   * forward" — soul.dynamic_mood has already been shifted by the delta.
   *
   * The user experience is: song ends → tiny "…" thinking state → new
   * song plays. Nothing auto-advances if there's no `currentTurn` (i.e.,
   * we're in idle/error state and the event arrived stale).
   */
  async onSongComplete(): Promise<void> {
    if (!this.currentTurn) return;

    // Capture the ended song id BEFORE finalisePreviousTurn wipes currentSong,
    // so auto-advance can exclude it from candidates and we don't loop on the
    // same track (with same emotion + same pseudoTarget, prefilter otherwise
    // ranks the just-played song first every time).
    const endedSongId = this.currentSong?.id ?? null;

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

    // Fold complete event into current turn's reaction
    this.pendingEvents.push({ kind: "complete" });
    this.currentTurn = foldReactionEvents(this.currentTurn, this.pendingEvents);
    this.pendingEvents = [];

    // Remember what emotion we were on so the next turn can continue from it
    const endedEmotion = this.currentTurn.current_emotion;
    // Capture timestamp before finalisePreviousTurn clears currentTurn
    const turnTimestamp = this.currentTurn.timestamp;

    // Emit thinking so UI shows "…" while we pick the next song
    this.emit({ kind: "thinking", user_utterance: "" });

    try {
      // Finalise: no verbal (user is silent), no emotion shift (no new signal)
      await this.finalisePreviousTurn(undefined, endedEmotion.pad);

      // If endedEmotion carries a predicted_trajectory and the elapsed time
      // since the turn started falls within the prediction window, use the
      // predicted_pad as the baseline emotion for the next turn.
      const clock = this.deps.clock ?? Date.now;
      const now = clock();
      const elapsed_min = (now - turnTimestamp) / 60_000;
      const pt = endedEmotion.predicted_trajectory;
      const baseEmotion: import("../types").CurrentEmotion =
        pt !== undefined && elapsed_min >= 3 && elapsed_min <= pt.horizon_min
          ? {
              pad: pt.predicted_pad,
              labels: endedEmotion.labels,
              confidence: endedEmotion.confidence,
              source: "emotion-agent-inferred",
              // predicted_trajectory intentionally omitted — it is stale after use
            }
          : endedEmotion;

      // Continue the flow: use the baseline emotion, empty utterance, proactive-open modality
      await this.runTurnWithEmotion(
        baseEmotion,
        "",
        "proactive-open",
        // For pseudo-target we lean on the baseline emotion's labels + a hint
        `${baseEmotion.labels.join(" ")} 延续`.trim(),
        endedSongId ? new Set([endedSongId]) : undefined,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[lyra] auto-advance error:", err);
      this.emit({ kind: "error", message: msg });
    }
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
