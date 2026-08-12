import { invoke } from "@tauri-apps/api/core";
import {
  deleteTrackCascade,
  findByPath,
  insertTrack,
  listAll,
} from "../db/repo/libraryRepo";
import { upsert as upsertFeatures } from "../db/repo/libraryFeaturesRepo";
import { extractFeatures } from "./extractFeatures";
import type { LibraryTrack } from "../types";

export type ScannedTrack = {
  path: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  duration_ms: number | null;
};

export async function scanLibrary(rootPath: string): Promise<ScannedTrack[]> {
  return await invoke<ScannedTrack[]>("library_scan", { path: rootPath });
}

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

function trackId(path: string, at: number): string {
  return `track-${at}-${Math.abs(hashCode(path))}`;
}

/** Sprint 9: run audio_extract_features against each newly-imported track and
 *  persist the result. Sequential (concurrency 1) so a large library doesn't
 *  fan out N decoders at once. Failures are per-track: one bad decode never
 *  blocks the rest. Returns the number of tracks that got features. */
export async function extractFeaturesForTracks(
  tracks: LibraryTrack[],
): Promise<number> {
  let extracted = 0;
  for (const t of tracks) {
    const f = await extractFeatures(t.path);
    if (!f) continue;
    try {
      await upsertFeatures({
        track_id: t.id,
        // Sprint 12: 0 means "detection inconclusive" — treat as unavailable
        // downstream rather than pretending 0 BPM is meaningful.
        bpm: f.bpm > 0 ? f.bpm : null,
        energy: f.energy,
        valence: f.valence,
      });
      extracted++;
    } catch {
      // best-effort; move on
    }
  }
  return extracted;
}

/** Sprint 10: run lyrics embedding pass. Sequential (concurrency 1) mirrors
 *  extractFeaturesForTracks. Missing lyrics / missing provider / network
 *  failure per-track → skip, keep going. Returns count embedded. */
export async function extractLyricsForTracks(
  tracks: LibraryTrack[],
): Promise<number> {
  const { computeLyricsEmbedding } = await import("./computeLyricsEmbedding");
  const { createEmbeddingProvider } = await import(
    "../providers/embeddingProvider"
  );
  const provider = await createEmbeddingProvider();
  if (!provider) return 0;
  let n = 0;
  for (const t of tracks) {
    if (await computeLyricsEmbedding(t.id, t.path, provider)) n++;
  }
  return n;
}

export type ImportOptions = {
  /** Await feature extraction before returning. Off by default so imports
   *  stay snappy; tests turn it on for determinism. */
  awaitFeatures?: boolean;
};

export type ImportResult = {
  imported: number;
  pruned: number;
};

/** Normalise a directory path for prefix matching. Adds a trailing slash so
 *  that "/A" doesn't accidentally match a track under "/Apple".
 *
 *  Scope: POSIX-shape paths only (macOS / Linux). The Rust scanner
 *  canonicalizes to forward-slash form, so this matches how paths land in
 *  the DB on those platforms. If Windows support is added later, both
 *  the scan-side canonicalisation and this guard need path.normalize
 *  treatment; the prune pass silently no-ops rather than misbehaving. */
function withTrailingSlash(p: string): string {
  return p.endsWith("/") ? p : `${p}/`;
}

export async function importLibrary(
  rootPath: string,
  opts: ImportOptions = {},
): Promise<ImportResult> {
  const scanned = await scanLibrary(rootPath);
  const newTracks: LibraryTrack[] = [];
  const now = Date.now();
  for (const s of scanned) {
    const existing = await findByPath(s.path);
    if (existing) continue;
    const track: LibraryTrack = {
      id: trackId(s.path, now),
      path: s.path,
      origin: "local",
      title: s.title ?? undefined,
      artist: s.artist ?? undefined,
      album: s.album ?? undefined,
      duration_ms: s.duration_ms ?? undefined,
      added_at: now,
    };
    await insertTrack(track);
    newTracks.push(track);
  }

  // Self-heal dangling rows. Guarded so a bad scan can't nuke the library:
  //   - empty scan usually means the folder is unreachable, not that
  //     every file vanished — skip entirely
  //   - only touch rows under this rootPath; the user may still revisit
  //     tracks that came from a different root
  let pruned = 0;
  if (scanned.length > 0) {
    const scannedPaths = new Set(scanned.map((s) => s.path));
    const rootPrefix = withTrailingSlash(rootPath);
    const allTracks = await listAll();
    for (const t of allTracks) {
      if (scannedPaths.has(t.path)) continue;
      if (!t.path.startsWith(rootPrefix)) continue;
      try {
        await deleteTrackCascade(t.id);
        pruned++;
      } catch {
        // best-effort; a single failing delete shouldn't stop the sweep
      }
    }
  }

  // Sprint 9 + 10 + DJ: feature extraction + lyrics embedding + track profiles.
  // Fire-and-forget so the "Imported N tracks" toast lands immediately.
  if (newTracks.length > 0) {
    const pf = extractFeaturesForTracks(newTracks);
    const pl = extractLyricsForTracks(newTracks);
    const { annotateProfilesForTracks } = await import("./annotateProfiles");
    const pd = annotateProfilesForTracks(newTracks);
    if (opts.awaitFeatures) await Promise.all([pf, pl, pd]);
    else {
      void pf.catch(() => {});
      void pl.catch(() => {});
      void pd.catch(() => {});
    }
  }
  return { imported: newTracks.length, pruned };
}
