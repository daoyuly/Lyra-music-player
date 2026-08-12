/**
 * generate-placeholder.ts
 *
 * Generates 5 WAV placeholder audio files using pure Node stdlib (no deps).
 * Each file is a 20-second sine wave tone at a distinct frequency.
 *
 * Usage (from repo root):
 *   npx ts-node app/src/assets/demo/generate-placeholder.ts
 *   # or
 *   node -e "$(cat app/src/assets/demo/generate-placeholder.ts)"
 *
 * Output → app/src/assets/demo/tone_{freq}hz.wav (5 files, ~312 KB each)
 */

import * as fs from "fs";
import * as path from "path";

const SAMPLE_RATE = 8000; // 8 kHz mono
const DURATION_S = 20;
const BITS = 16;
const NUM_SAMPLES = SAMPLE_RATE * DURATION_S;
const NUM_CHANNELS = 1;
const BYTE_RATE = SAMPLE_RATE * NUM_CHANNELS * (BITS / 8);
const BLOCK_ALIGN = NUM_CHANNELS * (BITS / 8);
const DATA_SIZE = NUM_SAMPLES * BLOCK_ALIGN;
const HEADER_SIZE = 44;
const TOTAL_SIZE = HEADER_SIZE + DATA_SIZE;

const TONES: Array<{ freq: number; name: string }> = [
  { freq: 220, name: "tone_220hz.wav" },
  { freq: 275, name: "tone_275hz.wav" },
  { freq: 330, name: "tone_330hz.wav" },
  { freq: 440, name: "tone_440hz.wav" },
  { freq: 550, name: "tone_550hz.wav" },
];

const outDir = path.resolve(__dirname);

function writeWav(filePath: string, freq: number): number {
  const buf = Buffer.alloc(TOTAL_SIZE);

  // RIFF header
  buf.write("RIFF", 0);
  buf.writeUInt32LE(TOTAL_SIZE - 8, 4);
  buf.write("WAVE", 8);

  // fmt chunk (16 bytes)
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(NUM_CHANNELS, 22);
  buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE(BYTE_RATE, 28);
  buf.writeUInt16LE(BLOCK_ALIGN, 32);
  buf.writeUInt16LE(BITS, 34);

  // data chunk
  buf.write("data", 36);
  buf.writeUInt32LE(DATA_SIZE, 40);

  // PCM samples — gentle 0.25 amplitude sine with 1s attack/release
  for (let i = 0; i < NUM_SAMPLES; i++) {
    const t = i / SAMPLE_RATE;
    const env = Math.min(1, Math.min(t, DURATION_S - t));
    const sample = Math.round(
      env * 0.25 * 32767 * Math.sin(2 * Math.PI * freq * t),
    );
    buf.writeInt16LE(sample, HEADER_SIZE + i * 2);
  }

  fs.writeFileSync(filePath, buf);
  return buf.length;
}

let total = 0;
for (const { freq, name } of TONES) {
  const p = path.join(outDir, name);
  const size = writeWav(p, freq);
  total += size;
  console.log(`${name}: ${(size / 1024).toFixed(1)} KB`);
}
console.log(`Total: ${(total / 1024 / 1024).toFixed(2)} MB`);
