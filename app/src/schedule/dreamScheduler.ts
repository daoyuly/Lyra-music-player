/**
 * DreamScheduler — fires reflectNow() on:
 *   1. A daily fixed time (HH:MM), once per calendar day.
 *   2. An idle-fallback: user has been inactive for ≥ idleMinutes, not in
 *      22:00–06:00 sleep window, and the last idle run was > 6 h ago.
 *
 * Both triggers are guarded by a single `_running` bool so concurrent
 * reflect calls are impossible.
 */

export type DreamSchedulerConfig = {
  /** "03:14" format — default daily reflect time */
  dailyTimeHHMM: string;
  /** Minutes of inactivity before idle trigger fires; 0 = disabled */
  idleMinutes: number;
  runReflect: () => Promise<void>;
  /** Sprint weekly: fires on Sunday. Independent error boundary — a
   *  runWeekly throw does not affect reflect state. */
  runWeekly?: () => Promise<void>;
  /** "HH:MM" — weekly letter generation time on Sundays. Defaults to
   *  dailyTimeHHMM when absent (backwards compatible). Recommended
   *  default is a waking hour (09:00) so users can read it fresh. */
  weeklyTimeHHMM?: string;
  /** Injectable clock for tests; defaults to `() => new Date()` */
  clock?: () => Date;
  /**
   * Injectable activity listener for tests.
   * Receives a callback that should be invoked whenever the user is active.
   * Returns an unlisten function.
   * Defaults to attaching mousemove/keydown/focus on window.
   */
  onActivityListen?: (cb: () => void) => () => void;
};

export type ParsedHHMM = { h: number; m: number };

/**
 * Parse a "HH:MM" string strictly (zero-padded hours and minutes required).
 * Returns null for any invalid input.
 */
export function parseHHMM(s: string): ParsedHHMM | null {
  if (typeof s !== "string") return null;
  const match = /^(\d{2}):(\d{2})$/.exec(s);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h < 0 || h > 23) return null;
  if (m < 0 || m > 59) return null;
  return { h, m };
}

const TICK_MS = 60_000; // 1 minute

/**
 * Format a Date as a local-calendar ISO date string ("YYYY-MM-DD") using
 * local getFullYear/getMonth/getDate rather than UTC-based toISOString().
 * This ensures the daily-run guard uses the same calendar day as
 * getDay() / getHours() / getMinutes() — all of which are local-time.
 * (Review finding C1: UTC toISOString().slice(0,10) disagrees with local
 * weekday on non-UTC systems, causing duplicate or missed Sunday runs.)
 */
function localISO(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${dd}`;
}
const IDLE_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6 hours
const SLEEP_START_H = 22;
const SLEEP_END_H = 6; // exclusive upper bound for morning

function defaultActivityListen(cb: () => void): () => void {
  const events = ["mousemove", "keydown", "focus"] as const;
  for (const ev of events) {
    window.addEventListener(ev, cb, { passive: true });
  }
  return () => {
    for (const ev of events) {
      window.removeEventListener(ev, cb);
    }
  };
}

export class DreamScheduler {
  private _config: DreamSchedulerConfig;
  private _running = false;
  private _timerId: ReturnType<typeof setInterval> | null = null;
  private _unlistenActivity: (() => void) | null = null;

  /** ISO date string of the last daily run (e.g. "2026-07-07") */
  private _lastDailyRunISO = "";
  /** ISO date string of the last Sunday we ran runWeekly (e.g. "2026-07-05") */
  private _lastWeeklyRunISO = "";
  /** Timestamp ms of last idle-triggered run */
  private _lastIdleRunAt = 0;
  /** Timestamp ms of the last detected user activity */
  private _activitySince: number;

  constructor(config: DreamSchedulerConfig) {
    this._config = config;
    // Initialise activity timestamp to now so we don't fire immediately on start.
    this._activitySince = this._now().getTime();
  }

  /** True while a reflect run is in progress. */
  isRunning(): boolean {
    return this._running;
  }

  /** Begin the 60-second tick and attach the activity listener. */
  start(): void {
    if (this._timerId !== null) return; // already started
    this._activitySince = this._now().getTime();

    // Attach activity listener
    const listenFn =
      this._config.onActivityListen ?? defaultActivityListen;
    this._unlistenActivity = listenFn(() => {
      this._activitySince = this._now().getTime();
    });

    // Start the ticker
    this._timerId = setInterval(() => this._tick(), TICK_MS);
  }

  /** Stop the ticker and detach the activity listener. */
  stop(): void {
    if (this._timerId !== null) {
      clearInterval(this._timerId);
      this._timerId = null;
    }
    if (this._unlistenActivity) {
      this._unlistenActivity();
      this._unlistenActivity = null;
    }
  }

  // ── private ──────────────────────────────────────────────────────────────

  private _now(): Date {
    return this._config.clock ? this._config.clock() : new Date();
  }

  private async _tick(): Promise<void> {
    const now = this._now();
    await this._checkDaily(now);
    await this._checkWeekly(now);
    await this._checkIdle(now);
  }

  private async _checkDaily(now: Date): Promise<void> {
    const parsed = parseHHMM(this._config.dailyTimeHHMM);
    if (!parsed) return;

    const { h, m } = parsed;
    if (now.getHours() !== h || now.getMinutes() !== m) return;

    const todayISO = localISO(now);
    if (this._lastDailyRunISO === todayISO) return;

    await this._runReflect(() => {
      this._lastDailyRunISO = todayISO;
    });
  }

  private async _checkWeekly(now: Date): Promise<void> {
    const runWeekly = this._config.runWeekly;
    if (!runWeekly) return;
    if (now.getDay() !== 0) return; // 0 = Sunday

    // Weekly time defaults to dailyTime when not set (backwards compatible).
    const raw = this._config.weeklyTimeHHMM ?? this._config.dailyTimeHHMM;
    const parsed = parseHHMM(raw);
    if (!parsed) return;
    if (now.getHours() !== parsed.h || now.getMinutes() !== parsed.m) return;

    const todayISO = localISO(now);
    if (this._lastWeeklyRunISO === todayISO) return;

    try {
      await runWeekly();
      this._lastWeeklyRunISO = todayISO;
    } catch (err) {
      console.warn("[DreamScheduler] runWeekly threw:", err);
      // Do NOT set _lastWeeklyRunISO on failure — allow retry next tick
      // within the same day. Per-Sunday guard resets next Sunday.
    }
  }

  private async _checkIdle(now: Date): Promise<void> {
    if (this._config.idleMinutes === 0) return;

    // Sleep window: 22:00 – 06:00
    const h = now.getHours();
    if (h >= SLEEP_START_H || h < SLEEP_END_H) return;

    const nowMs = now.getTime();
    const idleMs = this._config.idleMinutes * 60_000;
    if (nowMs - this._activitySince < idleMs) return;

    if (nowMs - this._lastIdleRunAt < IDLE_COOLDOWN_MS) return;

    await this._runReflect(() => {
      this._lastIdleRunAt = nowMs;
    });
  }

  /**
   * Execute runReflect under the concurrency lock.
   * `onSuccess` is called synchronously before releasing the lock so
   * state is updated even if something else calls tick concurrently.
   */
  private async _runReflect(onSuccess: () => void): Promise<void> {
    if (this._running) return;
    this._running = true;
    try {
      await this._config.runReflect();
      onSuccess();
    } catch (err) {
      console.warn("[DreamScheduler] runReflect threw:", err);
    } finally {
      this._running = false;
    }
  }
}
