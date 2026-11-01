import type { Bulletin } from "./bulletin";

/** Same quiet hours as the idle reflect: don't talk between 22:00 and 06:00. */
const SLEEP_START_H = 22;
const SLEEP_END_H = 6;
const HELD_LIMIT = 8;

export function inSleepWindow(now: Date): boolean {
  const hour = now.getHours();
  return hour >= SLEEP_START_H || hour < SLEEP_END_H;
}

/**
 * When a bulletin goes on air. Awake: speak now. Asleep: hold a task
 * result or the news until the first minute after 06:00, and drop a chime
 * — the hour it names would be wrong by then. All three come in through `post`.
 */
export class AirDesk {
  private held: Bulletin[] = [];

  constructor(
    private readonly air: (bulletin: Bulletin) => Promise<void>,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  post(bulletin: Bulletin): void {
    if (bulletin.lines.length === 0) return;
    if (inSleepWindow(this.clock())) {
      // A chime says the hour. Saying it after dawn would name the wrong one.
      if (bulletin.occasion === "chime") return;
      this.held.push(bulletin);
      if (this.held.length > HELD_LIMIT) this.held.shift();
      return;
    }
    void this.air(bulletin).catch(() => {});
  }

  /** Call once a minute. Speaks anything held overnight once we're awake. */
  tick(now: Date = this.clock()): void {
    if (inSleepWindow(now) || this.held.length === 0) return;
    const due = this.held;
    this.held = [];
    for (const bulletin of due) {
      void this.air(bulletin).catch(() => {});
    }
  }
}
