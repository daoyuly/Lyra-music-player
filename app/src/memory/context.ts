import type { ParsedMemory, Fact } from "./types";
import type { EmotionTimeline } from "../perception/emotionTimeline";

export type MemoryContext = {
  livingPortrait: string;
  topFacts: Fact[];
  /** Sprint 14: long-term emotion trajectory (7d/30d/1y). Populated by
   *  ReflectAgent or perception loop. Absent when no historical data. */
  emotionTimeline?: EmotionTimeline;
};

let _ctx: MemoryContext = { livingPortrait: "", topFacts: [] };

export function getMemoryContext(): MemoryContext {
  return _ctx;
}

export function setMemoryContext(memory: ParsedMemory, topN = 5): void {
  const facts = [...memory.facts]
    .sort((a, b) => b.n * b.confidence - a.n * a.confidence)
    .slice(0, topN);
  const portrait = memory.livingPortrait.paragraphs.join("\n\n");
  _ctx = { livingPortrait: portrait, topFacts: facts, emotionTimeline: _ctx.emotionTimeline };
}

export function setEmotionTimeline(timeline: EmotionTimeline | undefined): void {
  _ctx = { ..._ctx, emotionTimeline: timeline };
}
