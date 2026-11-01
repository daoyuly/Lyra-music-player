// 背景画 → 裁切与动效
// 每张画只声明画面里已经有的东西：水波、风、日晕、船边涟漪。
// 坐标是视口的 [0..1]，不是原图像素。position 决定 cover 时留下哪一段。

import angler from "../assets/bg/Angler_on_a_Wintry_Lake,_by_Ma_Yuan,_1195.jpg";
import autumnFlood from "../assets/bg/Ma_Yuan_-_Water_Album_-_The_Waving_Surface_of_the_Autumn_Flood.jpg";
import sixGentlemen from "../assets/bg/Ni_Zan_-_Six_Gentlemen.jpg";
import pineTrees from "../assets/bg/pine-trees.jpg";
import norham from "../assets/bg/Joseph_Mallord_William_Turner_-_Norham_Castle,_Sunrise_-_WGA23182.jpg";

export type BgRipple = {
  xFrac: number;
  yFrac: number;
  radiusPx: number;
  periodS: number;
};

export type BgWaterfall = {
  xFrac: number;
  yFrac: number;
  heightPx: number;
};

export type BgSunBreathe = {
  xFrac: number;
  yFrac: number;
  radiusPx: number;
  /** rgb() body — alpha is added at draw time. */
  color: string;
};

export type BgBirds = {
  yFrac: number;
  count: number;
  /** px per second, positive = left→right. */
  speed: number;
};

/** 风经过的一带。画的是墨线在摆，不是白雾。 */
export type BgWind = {
  topFrac: number;
  bottomFrac: number;
};

export type BgWaterShimmer = {
  topFrac: number;
  bottomFrac: number;
};

export type BgAnimationConfig = {
  ripples?: BgRipple[];
  waterfalls?: BgWaterfall[];
  sunBreathe?: BgSunBreathe;
  birds?: BgBirds;
  wind?: BgWind;
  waterShimmer?: BgWaterShimmer;
};

export type BgEntry = {
  url: string;
  /** CSS background-position. Keeps the quiet band inside a landscape window. */
  position: string;
  /**
   * How hard the bottom darkens, 0–1.
   * Aged silk is already dark; pale paper only needs a light edge.
   */
  vignette: number;
  config: BgAnimationConfig;
  /**
   * Where the sentence and the input sit.
   * Top, sides, bottom. A larger bottom padding lifts both off the lower water.
   */
  contentPadding?: string;
};

export const BG_ENTRIES: BgEntry[] = [
  // 马远《寒江独钓图》横幅。船在中下偏左，左右是空绢。
  {
    url: angler,
    position: "center center",
    vignette: 0.22,
    // 船在中段。字和输入框留在上空，水波只走船底下的水面。
    contentPadding: "3vh 56px 24vh",
    config: {
      ripples: [{ xFrac: 0.42, yFrac: 0.95, radiusPx: 22, periodS: 7.5 }],
      waterShimmer: { topFrac: 0.9, bottomFrac: 1 },
    },
  },
  // 马远《水图·秋水回波》。几乎整幅都是水纹，题字在左上。
  {
    url: autumnFlood,
    position: "center center",
    vignette: 0.4,
    config: {
      waterShimmer: { topFrac: 0.42, bottomFrac: 0.92 },
    },
  },
  // 倪瓒《六君子图》立轴。空白在中段，树在下、山在上。
  // 横窗只露出约三分之一高度，把视点放在空白湖面，树梢还留在下沿。
  {
    url: sixGentlemen,
    position: "center 28%",
    vignette: 0.35,
    config: {
      wind: { topFrac: 0.12, bottomFrac: 0.5 },
    },
  },
  // 长谷川等伯《松林图》左扇。pine-trees.jpg 是 3600px 宽的屏幕用图，
  // 原件约 47MB，不放进窗口解码。
  {
    url: pineTrees,
    position: "center center",
    vignette: 0.3,
    config: {
      wind: { topFrac: 0.18, bottomFrac: 0.72 },
    },
  },
  // 透纳《诺勒姆城堡，日出》。光在中上，水在下半。
  {
    url: norham,
    position: "center center",
    vignette: 0.35,
    config: {
      sunBreathe: { xFrac: 0.52, yFrac: 0.33, radiusPx: 220, color: "255, 214, 140" },
      waterShimmer: { topFrac: 0.62, bottomFrac: 0.94 },
    },
  },
];

// 一个进程固定一张。重新打开应用才换。?bg=1..N 可锁定某一张。
function pickSessionBg(): BgEntry | null {
  if (BG_ENTRIES.length === 0) return null;
  const search = typeof window !== "undefined" ? window.location.search : "";
  const m = search.match(/[?&]bg=(\d+)/);
  if (m) {
    const idx = parseInt(m[1], 10) - 1;
    if (idx >= 0 && idx < BG_ENTRIES.length) return BG_ENTRIES[idx] ?? null;
  }
  return BG_ENTRIES[Math.floor(Math.random() * BG_ENTRIES.length)] ?? null;
}

export const SESSION_BG: BgEntry | null = pickSessionBg();

/** Bottom-weighted scrim. `strength` 1 matches the old photo vignette. */
export function vignetteGradient(strength: number): string {
  const top = (0.1 * strength).toFixed(3);
  const mid = (0.04 * strength).toFixed(3);
  const bottom = (0.5 * strength).toFixed(3);
  return `linear-gradient(to bottom, rgba(0,0,0,${top}) 0%, rgba(0,0,0,${mid}) 42%, rgba(0,0,0,${bottom}) 100%)`;
}
