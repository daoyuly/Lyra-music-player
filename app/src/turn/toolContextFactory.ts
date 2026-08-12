/**
 * toolContextFactory.ts — Phase 1 子线 C
 *
 * Factory that produces a per-turn ToolContext. Orchestrator calls
 * `factory.build(turnId)` at the start of each pi-agent turn; the resulting
 * object is scoped to that turn and discarded when the turn ends.
 *
 * Motivation: keeps Orchestrator from needing to know which repos each tool
 * consumes. The factory owns that wiring; Orchestrator only holds the factory.
 *
 * Lifecycle: per-turn (see v3.1 §module 间调用契约).
 *   Orchestrator.onUserInput
 *     → turnCancellation.abortAndStart(newTurnId)
 *     → toolContextFactory.build(newTurnId)   ← this module
 *     → new Agent({...})
 *     → agent.subscribe(agentRunSink.record)
 *     → agent.prompt(...)
 *
 * ToolContext 接口的**唯一权威定义**在 `agents/pi/toolContext.ts` (子线 B)。
 * 本文件只做 factory,不重复定义接口 —— 见 v3.1 §ToolContext 显式接口。
 */

import type { LibraryFeatures } from "../db/repo/libraryFeaturesRepo";
import type { SoulStoreLike } from "./Orchestrator";
import type { ToolContext } from "../agents/pi/toolContext";

// Re-export so existing imports of `ToolContext` from this module keep working.
export type { ToolContext };

// ── Deps ─────────────────────────────────────────────────────────────────────
// Subset of repos that ToolContext needs. Passed in by Orchestrator constructor
// so the factory never directly imports concrete repos (avoids coupling).

export type ToolContextDeps = {
  libraryRepo: {
    getTrack(id: string): Promise<import("../types").LibraryTrack | null>;
    listAll(): Promise<import("../types").LibraryTrack[]>;
  };
  libraryFeaturesRepo: {
    getBatch(ids: string[]): Promise<Map<string, LibraryFeatures>>;
  };
  turnRepo: {
    listRecentTurns(n: number): Promise<import("../types").DialogueTurn[]>;
  };
  soulStore: SoulStoreLike;
  clock?: () => number;
};

// ── Factory ───────────────────────────────────────────────────────────────────

export type ToolContextFactory = ReturnType<typeof createToolContextFactory>;

/**
 * Create a factory bound to the given deps. The factory is long-lived
 * (constructed once by Orchestrator); individual ToolContext objects are
 * short-lived (one per turn).
 */
export function createToolContextFactory(deps: ToolContextDeps): {
  build(turnId: string): ToolContext;
} {
  return {
    build(_turnId: string): ToolContext {
      // _turnId is intentionally unused in Phase 1.
      // Future: use it to key a per-turn cache (e.g. memoize getBatch
      // results within one turn) without leaking across turns.
      return {
        libraryRepo: {
          getTrack: (id) => deps.libraryRepo.getTrack(id),
          listAll: () => deps.libraryRepo.listAll(),
        },
        libraryFeaturesRepo: {
          getBatch: (ids) => deps.libraryFeaturesRepo.getBatch(ids),
        },
        turnRepo: {
          listRecentTurns: (n) => deps.turnRepo.listRecentTurns(n),
        },
        soulStore: deps.soulStore,
        clock: deps.clock ?? Date.now,
      };
    },
  };
}
