// 照片 → 动效配方
// 每张背景照片声明一组"这张画面里已经存在的元素该怎么活起来":
//   ripples    — 局部涟漪扩散圈 (船位 / 水面焦点)
//   waterfalls — 竖向白丝流线 (照片里的瀑布)
//   sunBreathe — 径向呼吸光晕 (红日 / 月)
//   birds      — 一队缓飞的小 V (照片里的鸟阵)
//   mist       — 缓慢起伏的横向淡雾带
//   waterShimmer — 水面横向波光,多条随时间扫动
// 坐标一律用 [0..1] 归一化,渲染时乘以 canvas 宽高。

import bg1 from "../assets/bg/1.jpg";
import bg2 from "../assets/bg/2.png";
import bg3 from "../assets/bg/3.jpg";
import bg4 from "../assets/bg/4.jpg";

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

export type BgMist = {
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
  mist?: BgMist;
  waterShimmer?: BgWaterShimmer;
};

export type BgEntry = {
  url: string;
  config: BgAnimationConfig;
};

export const BG_ENTRIES: BgEntry[] = [
  // 1.jpg — 水墨江上舟 (船在左下 ~32%,87%)
  {
    url: bg1,
    config: {
      ripples: [{ xFrac: 0.32, yFrac: 0.87, radiusPx: 55, periodS: 6 }],
      waterShimmer: { topFrac: 0.62, bottomFrac: 1.0 },
    },
  },
  // 2.png — 彩色湖 + 船 + 右侧瀑布
  {
    url: bg2,
    config: {
      ripples: [{ xFrac: 0.60, yFrac: 0.78, radiusPx: 42, periodS: 5.5 }],
      waterfalls: [{ xFrac: 0.85, yFrac: 0.30, heightPx: 90 }],
      waterShimmer: { topFrac: 0.60, bottomFrac: 1.0 },
    },
  },
  // 3.jpg — 水墨江上舟 (船在左下 ~18%,85%)
  {
    url: bg3,
    config: {
      ripples: [{ xFrac: 0.18, yFrac: 0.86, radiusPx: 45, periodS: 6.5 }],
      waterShimmer: { topFrac: 0.72, bottomFrac: 1.0 },
    },
  },
  // 4.jpg — 楼阁密林 + 双瀑布（沿用旧 4.jpeg 的动效配方；若已换图请重配）
  {
    url: bg4,
    config: {
      waterfalls: [
        { xFrac: 0.10, yFrac: 0.36, heightPx: 100 },
        { xFrac: 0.88, yFrac: 0.42, heightPx: 80 },
      ],
      mist: { topFrac: 0.35, bottomFrac: 0.55 },
    },
  },
];

// 模块级随机选中 — 一个 App 会话固定一张。冷启动重新求值 → 每次开 App 换图。
// Dev 覆盖:URL 上带 ?bg=1..N 时锁定到指定序号(用于逐张验证背景)。
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
