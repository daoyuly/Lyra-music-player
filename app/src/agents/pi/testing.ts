/**
 * testing.ts — Test helpers for the pi agent layer (Phase 1 sub-thread B)
 *
 * Exports:
 *   makeMockProvider(chunks)   — a mock StreamableProvider whose chatStream
 *                                 yields the provided chunks then returns.
 *   makeMockStreamFn(chunks)   — convenience shortcut: makeMockProvider wrapped
 *                                 with lyraStreamFn, returns a StreamFn directly.
 *
 * These helpers are test-only; they are never imported by production code.
 * Import only in *.test.ts files.
 */

import { lyraStreamFn, type StreamableProvider } from "./streamFn";
import type { Chunk } from "../../providers/chunk";
import type { StreamFn } from "./pi-types.d.ts";

// ---------------------------------------------------------------------------
// makeMockProvider
// ---------------------------------------------------------------------------

/**
 * Returns a StreamableProvider whose chatStream method yields the provided
 * chunks and then completes.
 *
 * Pass signal to verify abort propagation: the generator checks
 * signal.aborted before each chunk and stops early if true, then yields a
 * stop/aborted chunk.
 */
export function makeMockProvider(chunks: Chunk[]): StreamableProvider {
  return {
    chatStream: async function* (
      _messages,
      _opts,
      signal?: AbortSignal,
    ): AsyncIterable<Chunk> {
      for (const chunk of chunks) {
        if (signal?.aborted) {
          yield { type: "stop", reason: "aborted" };
          return;
        }
        yield chunk;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// makeMockStreamFn
// ---------------------------------------------------------------------------

/**
 * Returns a StreamFn that internally uses makeMockProvider(chunks).
 *
 * Usage in tests:
 *   const streamFn = makeMockStreamFn([
 *     { type: "text", delta: "hello" },
 *     { type: "stop", reason: "end" },
 *   ]);
 *   const stream = await streamFn(model, context, options);
 *   for await (const event of stream) { ... }
 */
export function makeMockStreamFn(chunks: Chunk[]): StreamFn {
  return lyraStreamFn(makeMockProvider(chunks));
}
