/**
 * intentParser — deterministic extraction of sticky listening constraints
 * from a user utterance. Zero LLM cost; LLM only covers cases this misses
 * (via CompanionAgent verbal_intent = clear_intent / similar).
 */

import type { IntentConstraints } from "../db/repo/activeIntentRepo";

export type ParsedIntent = {
  /** True when utterance cancels an active sticky intent. */
  clear: boolean;
  /** Non-empty constraints extracted from the utterance. */
  constraints: IntentConstraints;
  /** Sticky when user said 一直/只要/只放…; once for a one-shot request. */
  persistence: "sticky" | "once";
  /** True when we found at least one actionable signal (language/genre/…). */
  hit: boolean;
};

const LANGUAGE_RULES: Array<{ re: RegExp; code: string }> = [
  { re: /粤语|广东话|廣東話|cantonese/i, code: "yue" },
  { re: /国语|國語|普通话|普通話|华语|華語|mandarin/i, code: "cmn" },
  { re: /英语|英語|英文|english/i, code: "en" },
  { re: /日语|日語|日文|japanese/i, code: "ja" },
  { re: /韩语|韓語|韩文|韓文|korean/i, code: "ko" },
  { re: /纯音乐|純音樂|无人声|無人聲|instrumental/i, code: "instrumental" },
];

const GENRE_RULES: Array<{ re: RegExp; tag: string }> = [
  { re: /摇滚|搖滾|rock/i, tag: "摇滚" },
  { re: /爵士|jazz/i, tag: "爵士" },
  { re: /古典|classical/i, tag: "古典" },
  { re: /电子|電子|edm|electronic/i, tag: "电子" },
  { re: /民谣|民謠|folk/i, tag: "民谣" },
  { re: /流行|pop/i, tag: "流行" },
  { re: /嘻哈|说唱|說唱|hip[\s-]?hop|rap/i, tag: "嘻哈" },
  { re: /蓝调|藍調|blues/i, tag: "蓝调" },
  { re: /金属|金屬|metal/i, tag: "金属" },
  { re: /古风|國風|国风/i, tag: "古风" },
];

const SCENE_RULES: Array<{ re: RegExp; tag: string }> = [
  { re: /深夜|夜里|夜裡|失眠/i, tag: "深夜" },
  { re: /雨天|下雨/i, tag: "雨天" },
  { re: /开车|開車|驾驶|駕駛/i, tag: "驾驶" },
  { re: /工作|学习|學習|专注|專注/i, tag: "专注" },
  { re: /运动|運動|跑步|健身/i, tag: "运动" },
];

const STICKY_RE = /一直|持续|持續|不停|只要|只放|只听|只聽|接着放|接著放|循环|循環/;
const CLEAR_RE =
  /别放|別放|不要(?:再)?(?:放|听|聽)|换成别的|換成別的|随便来点|隨便來點|不限语种|不限語種|清空意图|清空意圖|解除(?:这个|這個)?(?:限制|意图|意圖)/;

function uniq(xs: string[]): string[] {
  return [...new Set(xs)];
}

/**
 * Parse a user utterance into structured listening constraints.
 * Returns `hit: false` when nothing actionable was found (caller keeps prior intent).
 */
export function parseIntent(text: string): ParsedIntent {
  const t = text.trim();
  if (!t) {
    return { clear: false, constraints: {}, persistence: "once", hit: false };
  }

  if (CLEAR_RE.test(t)) {
    return { clear: true, constraints: {}, persistence: "once", hit: true };
  }

  const languages = uniq(
    LANGUAGE_RULES.filter((r) => r.re.test(t)).map((r) => r.code),
  );
  const genres = uniq(GENRE_RULES.filter((r) => r.re.test(t)).map((r) => r.tag));
  const scenes = uniq(SCENE_RULES.filter((r) => r.re.test(t)).map((r) => r.tag));

  const constraints: IntentConstraints = {};
  if (languages.length > 0) constraints.languages = languages;
  if (genres.length > 0) constraints.genres = genres;
  if (scenes.length > 0) constraints.scenes = scenes;

  const hit =
    (constraints.languages?.length ?? 0) > 0 ||
    (constraints.genres?.length ?? 0) > 0 ||
    (constraints.scenes?.length ?? 0) > 0;

  const stickyHint = STICKY_RE.test(t);
  // Explicit language/genre request without "来一首" one-shot framing → sticky
  // when paired with sticky adverbs; otherwise once.
  const persistence: "sticky" | "once" = stickyHint ? "sticky" : "once";

  return { clear: false, constraints, persistence, hit };
}
