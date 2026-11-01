export type ShowSpeaker = "lyra" | "guest";

export type ShowLine = {
  speaker: ShowSpeaker;
  text: string;
};

export type ShowBeat = {
  song_id: string;
  lines: ShowLine[];
};

function asLine(value: unknown): ShowLine | null {
  if (!value || typeof value !== "object") return null;
  const speaker = (value as { speaker?: unknown }).speaker;
  const text = (value as { text?: unknown }).text;
  if (speaker !== "lyra" && speaker !== "guest") return null;
  if (typeof text !== "string") return null;
  const trimmed = text.trim().slice(0, 80);
  if (!trimmed) return null;
  return { speaker, text: trimmed };
}

/** Keep only beats that name a candidate song, use each song once, and let
 *  both hosts speak. Invalid beats are dropped rather than repaired. */
export function validateRundown(raw: unknown, allowedIds: ReadonlySet<string>): ShowBeat[] {
  const beats = (raw as { beats?: unknown } | null)?.beats;
  if (!Array.isArray(beats)) return [];
  const used = new Set<string>();
  const out: ShowBeat[] = [];
  for (const beat of beats) {
    if (!beat || typeof beat !== "object") continue;
    const songId = (beat as { song_id?: unknown }).song_id;
    if (typeof songId !== "string" || !allowedIds.has(songId) || used.has(songId)) continue;
    const linesRaw = (beat as { lines?: unknown }).lines;
    if (!Array.isArray(linesRaw)) continue;
    const lines = linesRaw.map(asLine).filter((l): l is ShowLine => l !== null).slice(0, 4);
    const speakers = new Set(lines.map((l) => l.speaker));
    if (!speakers.has("lyra") || !speakers.has("guest")) continue;
    used.add(songId);
    out.push({ song_id: songId, lines });
    if (out.length >= 6) break;
  }
  return out;
}

export function formatShowScript(lines: ShowLine[], guestName: string): string {
  return lines
    .map((line) => `${line.speaker === "lyra" ? "Lyra" : guestName}  ${line.text}`)
    .join("\n");
}

const LANGUAGE_CLAIMS: { language: string; pattern: RegExp }[] = [
  { language: "yue", pattern: /粤语|广东话|廣東話/ },
  { language: "en", pattern: /英文歌|英语歌|英文曲|英语曲/ },
  { language: "cmn", pattern: /国语|普通话|國語/ },
  { language: "ja", pattern: /日语歌|日文歌|日語歌/ },
  { language: "ko", pattern: /韩语歌|韩文歌|韓語歌/ },
];

function mentionsName(blob: string, name: string): boolean {
  const trimmed = name.trim();
  if (trimmed.length < 2) return false;
  return blob.toLowerCase().includes(trimmed.toLowerCase());
}

/** Drop a beat when the hosts talk about a different language than the
 *  song, or never name that song. Memory-only patter with a mismatched
 *  track is how an English song gets a Cantonese introduction. */
export function groundBeats(
  beats: ShowBeat[],
  songs: { id: string; title: string; artist: string; language?: string }[],
): ShowBeat[] {
  const byId = new Map(songs.map((song) => [song.id, song]));
  return beats.filter((beat) => {
    const song = byId.get(beat.song_id);
    if (!song) return false;
    const blob = beat.lines.map((line) => line.text).join("\n");
    if (song.language) {
      const claimed = LANGUAGE_CLAIMS.find((claim) => claim.pattern.test(blob));
      if (claimed && claimed.language !== song.language) return false;
    }
    const named =
      mentionsName(blob, song.title) || mentionsName(blob, song.artist);
    const canCheck = song.title.trim().length >= 2 || song.artist.trim().length >= 2;
    return !canCheck || named;
  });
}
