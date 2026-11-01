import { invoke } from "@tauri-apps/api/core";
import { appDataDir, join } from "@tauri-apps/api/path";
import * as turnRepo from "../db/repo/turnRepo";
import * as sharedMemoryRepo from "../db/repo/sharedMemoryRepo";
import * as libraryRepo from "../db/repo/libraryRepo";
import * as weeklyRepo from "../db/repo/weeklyRepo";
import { getSecret, SECRET_KEYS } from "../settings/secrets";
import { WeeklyAgent } from "./WeeklyAgent";
import { runWeekly, type RunWeeklyDeps, type RunWeeklyResult } from "./runWeekly";

export async function makeWeeklyDeps(): Promise<RunWeeklyDeps> {
  const dirOverride = (await getSecret(SECRET_KEYS.weeklyDirOverride)) || null;
  const autoRaw = await getSecret(SECRET_KEYS.weeklyAutoEnabled);
  const autoEnabled = autoRaw !== "false";
  const agent = new WeeklyAgent();
  return {
    settings: { dirOverride, autoEnabled },
    appDataDir,
    pathJoin: join,
    writeWeeklyHtml: (path, content) => invoke("write_weekly_html", { path, content }),
    turnRepo: { listRecentTurns: (limit) => turnRepo.listRecentTurns(limit ?? 500) },
    sharedMemoryRepo: {
      listRecentSalient: async (limit) => {
        const moments = await sharedMemoryRepo.listRecent(limit ?? 500);
        // SalientMoment doesn't carry a stable DB id; timestampISO uniquely
        // orders salient moments in practice, and dataGather only needs a
        // key for de-dupe + LLM prompt reference. Kind derived from first tag.
        return moments.map((m, idx) => ({
          id: `${m.timestampISO}#${idx}`,
          ts: new Date(m.timestampISO).getTime(),
          kind: m.tags[0] ?? "salient",
          text: m.narrative,
        }));
      },
    },
    libraryRepo: {
      getById: async (id) => {
        const t = await libraryRepo.getTrack(id);
        if (!t) return null;
        return {
          id: t.id,
          title: t.title ?? t.id,
          artist: t.artist ?? null,
          path: t.path,
        };
      },
    },
    memoryRead: () => invoke<string>("memory_file_read"),
    weeklyRepo: {
      insert: weeklyRepo.insert,
      latest: weeklyRepo.latest,
      findByWindow: weeklyRepo.findByWindow,
      deleteByWindow: weeklyRepo.deleteByWindow,
    },
    agent,
  };
}

/** Auto-trigger entry — resolves settings each call so a user toggling
 *  auto-off in Settings takes effect on the next Sunday tick. */
export async function autoWeeklyTrigger(): Promise<RunWeeklyResult | null> {
  try {
    const deps = await makeWeeklyDeps();
    return await runWeekly({ now: new Date(), onDemand: false, deps });
  } catch (e) {
    console.error("[weekly] autoWeeklyTrigger error:", e);
    return null;
  }
}

/** On-demand entry (from /week slash). Returns the letter's HTML string
 *  for the App shell to render in an in-app modal. Idempotent per window
 *  — reuses the file on disk if it exists (reads it back rather than
 *  invoking Claude again). Returns null on failure or true-skip. */
export async function onDemandWeeklyOpen(): Promise<string | null> {
  try {
    const deps = await makeWeeklyDeps();
    const win = (await import("./weeklyPaths")).rolling7dWindow(new Date());
    const existing = await deps.weeklyRepo.findByWindow(win.start, win.end);
    if (existing) {
      const exists = await invoke<boolean>("path_exists", { path: existing.html_path });
      if (exists) {
        return await invoke<string>("read_weekly_html", { path: existing.html_path });
      }
      await deps.weeklyRepo.deleteByWindow(win.start, win.end);
    }
    const out = await runWeekly({ now: new Date(), onDemand: true, deps });
    if (out.skipped) return null;
    return out.html;
  } catch (e) {
    console.error("[weekly] onDemandWeeklyOpen error:", e);
    return null;
  }
}
