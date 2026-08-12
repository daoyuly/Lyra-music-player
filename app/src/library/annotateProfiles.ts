// annotateProfiles — DJ agent batch annotation for import + Settings refill

import type { LibraryTrack } from "../types";
import { DjAgent, DJ_MODEL_ID, extractLyricsExcerpt } from "../agents/DjAgent";
import * as trackProfilesRepo from "../db/repo/trackProfilesRepo";
import * as featuresRepo from "../db/repo/libraryFeaturesRepo";
import { getTrack } from "../db/repo/libraryRepo";
import { routeProvider } from "../agents/route";

/** Annotate a list of tracks sequentially (concurrency 1). Per-track failure
 *  never blocks the rest. Returns success count. */
export async function annotateProfilesForTracks(
  tracks: LibraryTrack[],
  opts: { agent?: DjAgent } = {},
): Promise<number> {
  if (tracks.length === 0) return 0;
  let agent = opts.agent;
  if (!agent) {
    try {
      agent = new DjAgent({ provider: routeProvider("emotion") });
    } catch {
      return 0; // no provider configured
    }
  }

  let n = 0;
  for (const t of tracks) {
    try {
      const [features, lyrics] = await Promise.all([
        featuresRepo.getByTrackId(t.id).catch(() => null),
        extractLyricsExcerpt(t.path),
      ]);
      const profile = await agent.annotate({
        track: t,
        features,
        lyricsExcerpt: lyrics,
      });
      await trackProfilesRepo.upsert(profile);
      n++;
    } catch (e) {
      console.warn(`[lyra] DJ annotate failed for ${t.id}:`, e);
    }
  }
  return n;
}

/** Settings "DJ 重新听一遍曲库" — refill missing / stale-model profiles. */
export async function profilesRefill(
  opts: { agent?: DjAgent } = {},
): Promise<{ started: number; succeeded: number; failed: number }> {
  const ids = await trackProfilesRepo.listMissing(DJ_MODEL_ID);
  let succeeded = 0;
  let failed = 0;
  const tracks: LibraryTrack[] = [];
  for (const id of ids) {
    const t = await getTrack(id).catch(() => null);
    if (t) tracks.push(t);
    else failed++;
  }
  const annotated = await annotateProfilesForTracks(tracks, opts);
  succeeded = annotated;
  failed += tracks.length - annotated;
  return { started: ids.length, succeeded, failed };
}
