import { useEffect, useRef } from "react";
import { readSpectrum, type PlaybackSpectrum } from "../audio/player";
import type { PAD } from "../lib/color";
import {
  SESSION_BG,
  type BgAnimationConfig,
  type BgRipple,
  type BgWaterfall,
  type BgSunBreathe,
  type BgBirds,
  type BgWind,
  type BgWaterShimmer,
} from "./bgManifest";

// 照片动效叠加层
// 只画当前照片 config 声明过的东西。
// 没在放的时候,画面按自己的节奏慢慢动。
// 在放的时候,时间跟着中频走,水波的起伏跟着低频,风的摆幅跟着高频。
// 亮度不跟鼓点跳,避免空白和绢上闪白。
// PAD 情绪继续渗透:
//   arousal (a) → 波光自己的起伏
//   valence (p) → 涟漪 / 波光暖冷偏移

export type MusicMotion = {
  /** 幅度。低频。空房间时是 1。 */
  amp: number;
  /** 时间走多快。中频,带一点低频。空房间时是 1。 */
  speed: number;
  /** 风的摆幅。高频。空房间时是 1。 */
  air: number;
  /** 低音刚抬起来的一瞬,0..1。空房间时是 0。 */
  pulse: number;
};

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

/** 把正在响的三个频段收成画面能用的四个数。没在放就回到房间自己的节奏。 */
export function motionFromSpectrum(
  playing: boolean,
  spec: PlaybackSpectrum,
): MusicMotion {
  if (!playing) return { amp: 1, speed: 1, air: 1, pulse: 0 };
  const low = clamp01(spec.low);
  const mid = clamp01(spec.mid);
  const high = clamp01(spec.high);
  return {
    amp: 1.15 + low * 2.8,
    speed: 0.8 + mid * 2.6 + low * 0.7,
    air: 1.05 + high * 2.6,
    pulse: clamp01(spec.pulse),
  };
}

export type ShanShuiCanvasProps = {
  pad: PAD;
  playing?: boolean;
  /** Override config for tests. */
  configOverride?: BgAnimationConfig | null;
};

type SmoothedPad = { p: number; a: number; d: number };

export function ShanShuiCanvas({
  pad,
  playing = false,
  configOverride,
}: ShanShuiCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const padRef = useRef<PAD>(pad);
  const playingRef = useRef<boolean>(playing);
  const smoothedRef = useRef<SmoothedPad>({ p: pad.p, a: pad.a, d: pad.d });
  const specTargetRef = useRef<PlaybackSpectrum>({ low: 0, mid: 0, high: 0, pulse: 0 });

  const config: BgAnimationConfig =
    configOverride ?? SESSION_BG?.config ?? {};

  useEffect(() => {
    padRef.current = pad;
  }, [pad]);

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  useEffect(() => {
    if (!playing) {
      specTargetRef.current = { low: 0, mid: 0, high: 0, pulse: 0 };
      return;
    }
    let cancelled = false;
    const pull = () => {
      void readSpectrum()
        .then((s) => {
          if (!cancelled) specTargetRef.current = s;
        })
        .catch(() => {});
    };
    pull();
    const id = window.setInterval(pull, 80);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [playing]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // jsdom (test env) throws on getContext; degrade to a no-op there.
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = canvas.getContext("2d");
    } catch {
      return;
    }
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    let tMusic = 0;
    let lastNow = performance.now();
    const spec = { low: 0, mid: 0, high: 0, pulse: 0 };

    const draw = (now: number) => {
      const dt = Math.min(0.05, Math.max(0, (now - lastNow) / 1000));
      lastNow = now;
      if (playingRef.current) {
        const target = specTargetRef.current;
        // 抬起来跟手，落下去慢一点，鼓点才留得住。
        const follow = (cur: number, next: number) =>
          cur + (next - cur) * (next > cur ? 0.72 : 0.16);
        spec.low = follow(spec.low, target.low);
        spec.mid = follow(spec.mid, target.mid);
        spec.high = follow(spec.high, target.high);
        spec.pulse = follow(spec.pulse, target.pulse);
      } else {
        spec.low = 0;
        spec.mid = 0;
        spec.high = 0;
        spec.pulse = 0;
      }
      const motion = motionFromSpectrum(playingRef.current, spec);
      tMusic += dt * motion.speed;
      const t = tMusic;

      // PAD 低通滤波,画面比音乐慢半拍
      const target = padRef.current;
      const s = smoothedRef.current;
      const alpha = 0.015;
      s.p += (target.p - s.p) * alpha;
      s.a += (target.a - s.a) * alpha;
      s.d += (target.d - s.d) * alpha;

      const rect = canvas.getBoundingClientRect();
      const W = rect.width;
      const H = rect.height;
      if (W < 2 || H < 2) {
        rafRef.current = requestAnimationFrame(draw);
        return;
      }

      ctx.clearRect(0, 0, W, H);

      const warm = (s.p + 1) / 2; // 0..1
      const arousalAbs = Math.min(1, Math.abs(s.a));

      // 顺序:风 → 水波 → 瀑布 → 日晕 → 涟漪 → 飞鸟
      if (config.wind) drawWind(ctx, W, H, t, config.wind, motion);
      if (config.waterShimmer)
        drawWaterShimmer(ctx, W, H, t, config.waterShimmer, arousalAbs, motion, warm);
      if (config.waterfalls) {
        for (const wf of config.waterfalls) drawWaterfall(ctx, W, H, t, wf, motion);
      }
      if (config.sunBreathe) drawSunBreathe(ctx, W, H, t, config.sunBreathe, motion);
      if (config.ripples) {
        for (const rp of config.ripples) drawRipple(ctx, W, H, t, rp, motion, warm);
      }
      if (config.birds) drawBirds(ctx, W, H, t, config.birds, motion);

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);

    return () => {
      window.removeEventListener("resize", resize);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      data-testid="shanshui-canvas"
      style={{
        position: "fixed",
        inset: 0,
        width: "100%",
        height: "100%",
        zIndex: 0,
        pointerEvents: "none",
      }}
    />
  );
}

// ── 效果绘制 ─────────────────────────────────────────────

// 涟漪:焦点位置向外扩散的三层同心椭圆 (椭圆压扁模拟水面视角)
function drawRipple(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  t: number,
  rp: BgRipple,
  motion: MusicMotion,
  warm: number,
) {
  const cx = rp.xFrac * W;
  const cy = rp.yFrac * H;
  const period = rp.periodS;
  const nRings = 4;
  const tint = 210 + warm * 12;
  const reach = rp.radiusPx * (1.7 + Math.max(0, motion.amp - 1) * 0.85);
  for (let i = 0; i < nRings; i++) {
    const phase = (((t / period) + i / nRings) % 1 + 1) % 1;
    const r = Math.max(1, phase * reach);
    const alpha = (1 - phase) * 0.32;
    ctx.strokeStyle = `rgba(${tint}, ${tint}, ${tint - 6}, ${alpha})`;
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    // yr 小是"水面透视"效果
    ctx.ellipse(cx, cy, r, r * 0.32, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
}

// 瀑布:多段短白丝逐帧向下,首尾用正弦淡入淡出
function drawWaterfall(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  t: number,
  wf: BgWaterfall,
  motion: MusicMotion,
) {
  const x = wf.xFrac * W;
  const y = wf.yFrac * H;
  const h = wf.heightPx;
  const strands = 6;
  const speed = 0.55;
  const segLen = 10;
  for (let s = 0; s < 2; s++) {
    // 两股水:左右微错
    const xOff = s === 0 ? -1 : 2;
    for (let i = 0; i < strands; i++) {
      const phase = ((t * speed + i / strands) % 1 + 1) % 1;
      const yPos = y + phase * h;
      const alpha = Math.min(0.85, Math.sin(phase * Math.PI) * 0.42 * motion.amp);
      ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x + xOff, yPos);
      ctx.lineTo(x + xOff, yPos + segLen);
      ctx.stroke();
    }
  }
}

// 太阳/月呼吸:径向渐变的双层光晕,周期 ~8s
function drawSunBreathe(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  t: number,
  su: BgSunBreathe,
  motion: MusicMotion,
) {
  const cx = su.xFrac * W;
  const cy = su.yFrac * H;
  // 画里已经有一轮日。这里只加一层薄光，跟着高频慢慢呼吸，不跟鼓点闪。
  const breath = 0.7 + Math.sin(t * 0.4) * 0.18;
  const glow = 0.85 + Math.min(0.4, Math.max(0, motion.air - 1) * 0.16);
  const radius = su.radiusPx;
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  grad.addColorStop(0, `rgba(${su.color}, ${Math.min(0.22, 0.16 * breath * glow)})`);
  grad.addColorStop(0.55, `rgba(${su.color}, ${Math.min(0.08, 0.06 * breath * glow)})`);
  grad.addColorStop(1, `rgba(${su.color}, 0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
}

// 飞鸟:一排小 V 从左向右缓飞,y 上轻微波动
function drawBirds(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  t: number,
  bi: BgBirds,
  _motion: MusicMotion,
) {
  const baseY = bi.yFrac * H;
  const speed = bi.speed;
  ctx.strokeStyle = `rgba(45, 45, 55, 0.75)`;
  ctx.lineWidth = 1.1;
  ctx.lineCap = "round";
  for (let i = 0; i < bi.count; i++) {
    const seed = i * 47;
    const rawX = ((t * speed + seed) % (W + 80)) - 40;
    const y = baseY + Math.sin(t * 0.9 + i * 1.3) * 6 + i * 3;
    // V 形,张角约 30°,size 3-5
    const size = 4 + (i % 2);
    ctx.beginPath();
    ctx.moveTo(rawX - size, y + size * 0.3);
    ctx.lineTo(rawX, y - size * 0.4);
    ctx.lineTo(rawX + size, y + size * 0.3);
    ctx.stroke();
  }
}

// 风:几条墨线在带子里左右起伏。透明度不动,只有摆幅跟着高频。
function drawWind(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  t: number,
  band: BgWind,
  motion: MusicMotion,
) {
  const top = band.topFrac * H;
  const height = Math.max(8, (band.bottomFrac - band.topFrac) * H);
  const gust = 0.7 + Math.min(1.6, Math.max(0, motion.air - 1) * 0.55);
  const sway = (7 + Math.min(18, Math.max(0, motion.amp - 1) * 6)) * gust;
  const rows = 6;
  ctx.lineWidth = 1.15;
  ctx.lineCap = "round";
  for (let i = 0; i < rows; i++) {
    const y0 = top + ((i + 0.35) / rows) * height;
    const phase = t * (0.42 + i * 0.05) + i * 1.6;
    const alpha = 0.2 + (i % 3) * 0.05;
    ctx.strokeStyle = `rgba(48, 52, 56, ${alpha})`;
    ctx.beginPath();
    for (let x = -24; x <= W + 24; x += 10) {
      const y =
        y0 +
        Math.sin(x * 0.007 + phase) * sway +
        Math.sin(x * 0.019 + phase * 1.25 + i) * sway * 0.32;
      if (x === -24) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

// 水面波光:多条横向正弦扫动,营造"水在动"的错觉,不改照片本体
function drawWaterShimmer(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  t: number,
  ws: BgWaterShimmer,
  arousal: number,
  motion: MusicMotion,
  warm: number,
) {
  const top = ws.topFrac * H;
  const height = (ws.bottomFrac - ws.topFrac) * H;
  const flowSpeed = 0.7 + arousal * 1.2;
  const amp = (8 + arousal * 10) * (0.9 + Math.min(1.5, Math.max(0, motion.amp - 1) * 0.4));
  const tint = 206 + warm * 10;
  ctx.lineWidth = 1.15;
  const rows = 8;
  for (let i = 0; i < rows; i++) {
    const rowY = top + ((i + 0.5) / rows) * height;
    // 越靠上 (远) 越透明。透明度不跟鼓点变。
    const perspective = 0.45 + (i / (rows - 1)) * 0.55;
    const alpha = 0.2 * perspective;
    ctx.strokeStyle = `rgba(${tint}, ${tint}, ${tint - 8}, ${alpha})`;
    ctx.beginPath();
    for (let x = 0; x <= W; x += 6) {
      const y =
        rowY +
        Math.sin(x * 0.020 + t * flowSpeed + i * 0.7) * amp * perspective +
        Math.sin(x * 0.055 + t * flowSpeed * 1.3 + i) * amp * 0.4 * perspective;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}
