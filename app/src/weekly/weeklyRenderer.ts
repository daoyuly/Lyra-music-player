import type { PAD } from "../types";
import type { WeeklyRawData, PadPoint } from "./dataGather";

export type WeeklyLetterJson = {
  greeting: string;
  body: string;
  songs: Array<{ song_id: string; one_liner: string }>;
  moments: Array<{ moment_id: string; whisper: string }>;
  portrait_change: string;
  closing: string;
};

// PAD → HSL. Hue from P (blue-cool for low, warm for high). Saturation
// scales with |A|. Lightness stays high so the band reads muted, not loud.
export function padToHsl(pad: PAD): string {
  const h = Math.round(210 - 210 * clamp(pad.p, -1, 1)); // -1 → 210 (blue), +1 → 0 (red)
  const s = Math.round(20 + 40 * Math.abs(clamp(pad.a, -1, 1)));
  const l = Math.round(70 + 10 * clamp(pad.d, -1, 1));
  return `hsl(${h}, ${s}%, ${l}%)`;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const FALLBACK_COPY = {
  greeting: "这一周我有点跟不上,没写出信来。",
  body: "数据都在,下面这些是本周和你有关的东西。等我下周再好好写。",
  closing: "我在这里。",
} as const;

/** The sentence a bulletin can read aloud. Fallback letters use the standing apology. */
export function letterOpening(letter: WeeklyLetterJson, fallback: boolean): string {
  return (fallback ? FALLBACK_COPY.greeting : letter.greeting).trim();
}

export function render(
  letter: WeeklyLetterJson,
  raw: WeeklyRawData,
  opts: { fallback: boolean },
): string {
  const g = letterOpening(letter, opts.fallback);
  const b = opts.fallback ? FALLBACK_COPY.body : letter.body;
  const c = opts.fallback ? FALLBACK_COPY.closing : letter.closing;

  const startDate = raw.window.start.slice(0, 10);
  const endDate = raw.window.end.slice(0, 10);

  const songByLetter = new Map(letter.songs.map((s) => [s.song_id, s.one_liner]));
  const momentByLetter = new Map(letter.moments.map((m) => [m.moment_id, m.whisper]));

  return `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<title>${escapeHtml(startDate)} → ${escapeHtml(endDate)}</title>
<style>${STYLE}</style>
</head>
<body>
<article>
  <header class="win">${escapeHtml(startDate)} → ${escapeHtml(endDate)}</header>
  <section class="greeting">${escapeHtml(g)}</section>
  <section class="pad-band">${renderPadBand(raw.pad_series)}</section>
  <section class="body">${escapeHtml(b)}</section>
  <ul class="songs">${
    raw.songs_played.map((s) => `
    <li>
      <span class="title">${escapeHtml(s.title)}</span>
      <span class="note">${escapeHtml(songByLetter.get(s.song_id) ?? s.small_note)}</span>
    </li>`).join("")
  }</ul>
  <ul class="moments">${
    raw.salient.map((m) => `
    <li>${escapeHtml(momentByLetter.get(m.moment_id) ?? m.text)}</li>`).join("")
  }</ul>
  ${
    !opts.fallback && letter.portrait_change.trim().length > 0
      ? `<section class="portrait">${escapeHtml(letter.portrait_change)}</section>`
      : ""
  }
  <footer class="closing">${escapeHtml(c)}</footer>
</article>
</body>
</html>`;
}

function renderPadBand(series: PadPoint[]): string {
  if (series.length === 0) {
    return `<svg viewBox="0 0 100 6" preserveAspectRatio="none"></svg>`;
  }
  const stops = series.map((p, i) => {
    const off = series.length === 1 ? 50 : Math.round((i / (series.length - 1)) * 100);
    return `<stop offset="${off}%" stop-color="${padToHsl(p.pad)}" />`;
  }).join("");
  return `<svg viewBox="0 0 100 6" preserveAspectRatio="none">
    <defs><linearGradient id="pb" x1="0" x2="1">${stops}</linearGradient></defs>
    <rect x="0" y="0" width="100" height="6" fill="url(#pb)" />
  </svg>`;
}

// Inline CSS. No @import, no external font — system stack falls back cleanly.
const STYLE = `
  :root { color-scheme: light dark; }
  body { margin: 0; background: #fafaf7; color: #222; font-family: system-ui, "PingFang SC", "Noto Serif CJK SC", serif; line-height: 1.8; }
  article { max-width: 640px; margin: 6rem auto; padding: 0 1.5rem; }
  header.win { font-size: 0.9rem; color: #888; letter-spacing: 0.05em; margin-bottom: 3rem; }
  .greeting { font-size: 1.1rem; margin-bottom: 2rem; }
  .pad-band svg { width: 100%; height: 6px; display: block; margin: 2rem 0; opacity: 0.7; }
  .body { margin-bottom: 3rem; white-space: pre-wrap; }
  ul.songs, ul.moments { list-style: none; padding: 0; margin: 0 0 2rem; }
  ul.songs li { padding: 0.5rem 0; border-bottom: 1px dashed #eee; }
  ul.songs .title { display: block; font-weight: 500; }
  ul.songs .note { color: #888; font-style: italic; font-size: 0.9rem; }
  ul.moments li { padding: 0.3rem 0; color: #666; font-style: italic; }
  .portrait { margin: 3rem 0; padding: 1rem 1.5rem; background: #f5f5f0; border-left: 2px solid #ddd; }
  footer.closing { margin-top: 4rem; color: #888; font-style: italic; }
  @media print { body { background: white; } article { margin: 2rem auto; } }
`;
