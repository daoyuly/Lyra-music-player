import { rolling7dWindow, filenameFor, resolveWeeklyDir } from "./weeklyPaths";
import { collectWindow } from "./dataGather";
import { letterOpening, render, type WeeklyLetterJson } from "./weeklyRenderer";
import type { WeeklyAgent } from "./WeeklyAgent";
import type { WeeklySnapshotRow } from "../db/repo/weeklyRepo";

const SPARSE_TURN_THRESHOLD = 3;

export type RunWeeklyDeps = {
  settings: { dirOverride: string | null; autoEnabled: boolean };
  appDataDir: () => Promise<string>;
  pathJoin: (a: string, b: string) => Promise<string>;
  writeWeeklyHtml: (path: string, content: string) => Promise<void>;
  turnRepo: { listRecentTurns: (limit?: number) => Promise<any[]> };
  sharedMemoryRepo: { listRecentSalient: (limit?: number) => Promise<Array<{ id: string; ts: number; kind: string; text: string }>> };
  libraryRepo: { getById: (id: string) => Promise<{ id: string; title: string; artist: string | null; path: string } | null> };
  memoryRead: () => Promise<string>;
  weeklyRepo: {
    insert: (row: WeeklySnapshotRow) => Promise<void>;
    latest: () => Promise<WeeklySnapshotRow | null>;
    findByWindow: (start: string, end: string) => Promise<WeeklySnapshotRow | null>;
    deleteByWindow: (start: string, end: string) => Promise<void>;
  };
  agent: Pick<WeeklyAgent, "run">;
};

export type RunWeeklyResult =
  | { skipped: true; reason: "sparse_week" | "auto_disabled" }
  | {
      skipped: false;
      html_path: string;
      fallback: boolean;
      html: string;
      /** First thing Lyra can say about this letter. */
      greeting: string;
    };

export async function runWeekly(opts: {
  now: Date;
  onDemand?: boolean;
  deps: RunWeeklyDeps;
}): Promise<RunWeeklyResult> {
  const { deps, now, onDemand = false } = opts;

  if (!onDemand && !deps.settings.autoEnabled) {
    return { skipped: true, reason: "auto_disabled" };
  }

  const window = rolling7dWindow(now);
  const memoryText = await deps.memoryRead().catch(() => "");
  const lastSnapshot = await deps.weeklyRepo.latest();

  const raw = await collectWindow({
    window,
    memoryText,
    lastPortraitAtClose: lastSnapshot?.living_portrait_at_close ?? null,
    turnRepo: deps.turnRepo,
    sharedMemoryRepo: deps.sharedMemoryRepo,
    libraryRepo: deps.libraryRepo,
  });

  const sparse = raw.turns.length < SPARSE_TURN_THRESHOLD;
  if (sparse && !onDemand) {
    return { skipped: true, reason: "sparse_week" };
  }

  let letter: WeeklyLetterJson;
  let fallback: boolean;
  if (sparse && onDemand) {
    // on-demand sparse: skip LLM entirely, go straight to fallback letter
    letter = {
      greeting: "", body: "",
      songs: raw.songs_played.slice(0, 5).map((s) => ({ song_id: s.song_id, one_liner: s.small_note ?? "" })),
      moments: raw.salient.slice(0, 3).map((m) => ({ moment_id: m.moment_id, whisper: m.text })),
      portrait_change: "",
      closing: "",
    };
    fallback = true;
  } else {
    const out = await deps.agent.run({ raw, onDemand });
    letter = out.letter;
    fallback = out.fallback;
  }

  const html = render(letter, raw, { fallback });

  const dir = await resolveWeeklyDir(deps.settings.dirOverride, deps.pathJoin, deps.appDataDir);
  const filename = filenameFor(window);
  const html_path = await deps.pathJoin(dir, filename);

  await deps.writeWeeklyHtml(html_path, html);

  await deps.weeklyRepo.insert({
    window_start: window.start,
    window_end: window.end,
    html_path,
    living_portrait_at_close: raw.living_portrait_now,
    turn_count: raw.turns.length,
    fallback: fallback ? 1 : 0,
  });

  return {
    skipped: false,
    html_path,
    fallback,
    html,
    greeting: letterOpening(letter, fallback),
  };
}
