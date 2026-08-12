// trackProfilesRepo — DJ agent song characteristic archives

import { getDb } from "../client";

export type TrackLanguage =
  | "yue"
  | "cmn"
  | "en"
  | "ja"
  | "ko"
  | "instrumental"
  | "other";

export type TrackProfile = {
  track_id: string;
  language: TrackLanguage;
  genres: string[];
  mood: string[];
  scenes: string[];
  era: string | null;
  vocal: "male" | "female" | "group" | "instrumental" | "other";
  energy_check: "low" | "mid" | "high";
  one_liner: string;
  annotated_at: number;
  model: string;
};

type Row = {
  track_id: string;
  language: string;
  genres_json: string;
  mood_json: string;
  scenes_json: string;
  era: string | null;
  vocal: string;
  energy_check: string;
  one_liner: string;
  annotated_at: number;
  model: string;
};

function parseJsonArray(s: string): string[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function fromRow(r: Row): TrackProfile {
  return {
    track_id: r.track_id,
    language: (r.language as TrackLanguage) || "other",
    genres: parseJsonArray(r.genres_json),
    mood: parseJsonArray(r.mood_json),
    scenes: parseJsonArray(r.scenes_json),
    era: r.era,
    vocal: (r.vocal as TrackProfile["vocal"]) || "other",
    energy_check: (r.energy_check as TrackProfile["energy_check"]) || "mid",
    one_liner: r.one_liner ?? "",
    annotated_at: r.annotated_at,
    model: r.model,
  };
}

export async function upsert(p: TrackProfile): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO library_track_profiles
       (track_id, language, genres_json, mood_json, scenes_json, era,
        vocal, energy_check, one_liner, annotated_at, model)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(track_id) DO UPDATE SET
       language = excluded.language,
       genres_json = excluded.genres_json,
       mood_json = excluded.mood_json,
       scenes_json = excluded.scenes_json,
       era = excluded.era,
       vocal = excluded.vocal,
       energy_check = excluded.energy_check,
       one_liner = excluded.one_liner,
       annotated_at = excluded.annotated_at,
       model = excluded.model`,
    [
      p.track_id,
      p.language,
      JSON.stringify(p.genres),
      JSON.stringify(p.mood),
      JSON.stringify(p.scenes),
      p.era,
      p.vocal,
      p.energy_check,
      p.one_liner,
      p.annotated_at,
      p.model,
    ],
  );
}

export async function getByTrackId(id: string): Promise<TrackProfile | null> {
  const db = await getDb();
  const rows = await db.select<Row[]>(
    `SELECT track_id, language, genres_json, mood_json, scenes_json, era,
            vocal, energy_check, one_liner, annotated_at, model
     FROM library_track_profiles WHERE track_id = ?`,
    [id],
  );
  return rows.length === 0 ? null : fromRow(rows[0]);
}

export async function getBatch(ids: string[]): Promise<Map<string, TrackProfile>> {
  if (ids.length === 0) return new Map();
  const db = await getDb();
  const placeholders = ids.map(() => "?").join(",");
  const rows = await db.select<Row[]>(
    `SELECT track_id, language, genres_json, mood_json, scenes_json, era,
            vocal, energy_check, one_liner, annotated_at, model
     FROM library_track_profiles WHERE track_id IN (${placeholders})`,
    ids,
  );
  const out = new Map<string, TrackProfile>();
  for (const r of rows) out.set(r.track_id, fromRow(r));
  return out;
}

/** Track ids in library_tracks that have no profile yet (or stale model). */
export async function listMissing(model?: string): Promise<string[]> {
  const db = await getDb();
  if (model) {
    const rows = await db.select<{ id: string }[]>(
      `SELECT t.id FROM library_tracks t
       LEFT JOIN library_track_profiles p ON p.track_id = t.id
       WHERE p.track_id IS NULL OR p.model != ?
       ORDER BY t.added_at DESC`,
      [model],
    );
    return rows.map((r) => r.id);
  }
  const rows = await db.select<{ id: string }[]>(
    `SELECT t.id FROM library_tracks t
     LEFT JOIN library_track_profiles p ON p.track_id = t.id
     WHERE p.track_id IS NULL
     ORDER BY t.added_at DESC`,
  );
  return rows.map((r) => r.id);
}
