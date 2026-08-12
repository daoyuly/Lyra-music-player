import { padHSL, type PAD } from "../lib/color";

// 情绪光带 — 从条形图重构成"墨迹带"（禅空虚净·灵）
// 语义：
//   - 每个采样点是一滴晕开的墨（内实心 + 外柔光晕），非硬边矩形
//   - x：时间轴（左旧右新）
//   - y：以中线为轴，用愉悦度做微幅漂移（喜上浮/悲下沉，最多 ±5px），不做柱状
//   - 半径：兴奋度决定墨的湿度/体量
//   - 色相：来自 padHSL（冷↔暖）
// 最右侧那滴是"此刻的你"——多一圈极细的墨环，缓慢呼吸。
// 用户看着自己被音乐推着走，是第三人称视角。

const WIDTH = 400;
const HEIGHT = 32;
const MID = HEIGHT / 2;
const MAX_SAMPLES = 20;

export type EmotionLightBandProps = {
  samples: PAD[];
};

export function EmotionLightBand({ samples }: EmotionLightBandProps) {
  const drawn = samples.slice(-MAX_SAMPLES);
  const columnW = WIDTH / MAX_SAMPLES;
  const lastIdx = drawn.length - 1;

  return (
    <svg
      data-testid="emotion-light-band"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      style={{
        width: "var(--lyra-band-width)",
        height: "var(--lyra-band-height)",
        display: "block",
        // 允许墨的柔光晕溢出画面边缘，像宣纸上化开的墨
        overflow: "visible",
      }}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        {/* 墨的柔化：单遍高斯模糊足以把边缘化开，避免变成"色块" */}
        <filter id="lyra-ink-soft" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="0.55" />
        </filter>
      </defs>

      {drawn.map((s, i) => {
        const { h, s: sat, l } = padHSL(s);
        const displayL = Math.max(38, Math.min(70, l * 0.7));
        const displaySat = Math.max(30, Math.min(100, sat + 25));
        const color = `hsl(${h}, ${displaySat}%, ${displayL}%)`;

        const arousalAbs = Math.min(1, Math.abs(s.a));
        const inkAlpha = 0.35 + arousalAbs * 0.45; // 兴奋度 → 墨浓
        const r = 3.4 + arousalAbs * 3;            // 兴奋度 → 墨湿/体量
        const yOffset = -s.p * 5;                  // 愉悦度 → 上浮/下沉（微幅）

        const cx = i * columnW + columnW / 2;
        const cy = MID + yOffset;
        const isSelf = i === lastIdx;

        return (
          <g key={i} data-testid={`emotion-band-sample-${i}`}>
            {/* 外层柔光晕 */}
            <circle
              cx={cx}
              cy={cy}
              r={r * 1.75}
              fill={color}
              opacity={inkAlpha * 0.32}
              filter="url(#lyra-ink-soft)"
            />
            {/* 内层墨点 */}
            <circle cx={cx} cy={cy} r={r} fill={color} opacity={inkAlpha} />
            {/* "此刻的你" — 只出现在最新一滴上，绕自身缓慢呼吸 */}
            {isSelf && (
              <circle
                data-testid="emotion-band-self"
                cx={cx}
                cy={cy}
                r={r + 2.6}
                fill="none"
                stroke={color}
                strokeWidth={0.7}
                className="lyra-self-breath"
                style={{ transformOrigin: `${cx}px ${cy}px` }}
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}
