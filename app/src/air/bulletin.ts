/**
 * A bulletin is one short piece said on air, apart from introducing a song.
 * A task result, an hourly chime, and collected news are the same shape.
 * The mouth only sees lines.
 */

export type AirRole = "lyra" | "guest";

export type AirLine = {
  role: AirRole;
  text: string;
};

export type BulletinOccasion = "task" | "chime" | "news";

export type Bulletin = {
  /** Why we're speaking. The mouth ignores this. */
  occasion: BulletinOccasion;
  lines: AirLine[];
};

function firstSentence(text: string, max: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  const cut = normalized.split(/[。！？.!?]/)[0]?.trim() ?? "";
  const body = cut.replace(/[。！？.!?]+$/g, "").trim();
  if (!body) return "";
  return body.length <= max ? body : body.slice(0, max);
}

function spoken(text: string, max: number): string {
  const body = firstSentence(text, max);
  return body ? `${body}。` : "";
}

/** What Lyra says after the night reflect. The dream's first sentence, or a count. */
export function reflectSpoken(dreamNarrative: string, appliedFacts: number): string {
  const dream = spoken(dreamNarrative, 80);
  if (dream) return dream;
  if (appliedFacts > 0) return `夜里记下了${appliedFacts}件新的事。`;
  return "夜里看过了，没有新的要记。";
}

/** What Lyra says after the Sunday letter. Silence when the user turned it off. */
export function weeklySpoken(
  result:
    | { skipped: true; reason: "sparse_week" | "auto_disabled" }
    | { skipped: false; greeting: string },
): string | null {
  if (result.skipped) {
    return result.reason === "sparse_week" ? "这周听得少，信先不写。" : null;
  }
  return spoken(result.greeting, 80) || "这周的信写好了。";
}

export function taskBulletin(summary: string): Bulletin | null {
  const text = spoken(summary, 120);
  if (!text) return null;
  return { occasion: "task", lines: [{ role: "lyra", text }] };
}

const HOUR_NAME = [
  "零", "一", "两", "三", "四", "五", "六", "七", "八", "九",
  "十", "十一", "十二", "十三", "十四", "十五", "十六", "十七", "十八", "十九",
  "二十", "二十一", "二十二", "二十三",
] as const;

/** "现在是八点整。" Post this when the minute is 0. */
export function chimeBulletin(now: Date): Bulletin {
  const name = HOUR_NAME[now.getHours()] ?? "零";
  return {
    occasion: "chime",
    lines: [{ role: "lyra", text: `现在是${name}点整。` }],
  };
}

const NEWS_ITEMS = 5;
const NEWS_ITEM_CHARS = 40;

/**
 * Read headlines that something else already collected.
 * One voice, a handful of lines, no second host.
 */
export function newsBulletin(items: readonly string[]): Bulletin | null {
  const headlines = items
    .map((item) => firstSentence(item, NEWS_ITEM_CHARS))
    .filter((item) => item.length > 0)
    .slice(0, NEWS_ITEMS);
  if (headlines.length === 0) return null;
  const text =
    headlines.length === 1
      ? `${headlines[0]}。`
      : `这几条刚收集到。${headlines.join("。")}。`;
  return { occasion: "news", lines: [{ role: "lyra", text }] };
}
