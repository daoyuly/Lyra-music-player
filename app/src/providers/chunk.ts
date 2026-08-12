/**
 * Unified streaming chunk types for all Lyra providers.
 * Consumed by pi-agent-core's streamFn adapter (Phase 1 子线 B).
 *
 * Design constraints (v3.1 §Phase 1 子线 A):
 * - tool_call args are INCREMENTAL deltas; accumulation is the caller's responsibility.
 * - Error conditions are encoded in-stream as {type:"error"} + {type:"stop"} — no throws.
 * - AbortSignal termination yields {type:"stop", reason:"aborted"}.
 */
export type Chunk =
  | { type: "text"; delta: string }
  | {
      type: "tool_call";
      id: string;
      name?: string;
      argsDelta?: string;
      argsAccum?: string;
    }
  | { type: "stop"; reason: "end" | "tool_use" | "error" | "aborted" }
  | { type: "error"; message: string }
  | { type: "warning"; message: string };

export type ChatStreamOptions = {
  temperature?: number;
  max_tokens?: number;
  tools?: unknown[]; // provider-specific tool schema pass-through
  enable_thinking?: boolean; // Zhipu-specific
};
