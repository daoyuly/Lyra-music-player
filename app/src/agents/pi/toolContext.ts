/**
 * toolContext.ts — ToolContext interface (v3.1 §ToolContext)
 *
 * Defines the explicit dependency surface that pi-layer tools are allowed to
 * touch. All tool implementations receive a ToolContext and must NOT import
 * repo modules directly (review checklist enforcement, not lint).
 *
 * Lifecycle: per-turn. Created by toolContextFactory.build(turnId) at the
 * start of each turn; discarded when the turn ends. Do not share across turns.
 *
 * Sub-thread C (turn/toolContextFactory.ts) provides the concrete factory.
 * This file only defines the interface.
 */

import type { LibraryTrack } from "../../types/song";
import type { LibraryFeatures } from "../../db/repo/libraryFeaturesRepo";
import type { DialogueTurn } from "../../types/dialogue";
import type { SoulState } from "../../types/soul";

export interface ToolContext {
  /**
   * Access to the music library.
   * Tools may call getTrack / listAll; they must not call write operations.
   */
  libraryRepo: {
    getTrack(id: string): Promise<LibraryTrack | null>;
    listAll(): Promise<LibraryTrack[]>;
  };

  /**
   * Batch-fetch audio features (bpm, energy, valence) for a set of track ids.
   */
  libraryFeaturesRepo: {
    getBatch(ids: string[]): Promise<Map<string, LibraryFeatures>>;
  };

  /**
   * Recent conversation history. Tools may call listRecentTurns(n) to inject
   * history context; they must not write turns.
   */
  turnRepo: {
    listRecentTurns(n: number): Promise<DialogueTurn[]>;
  };

  /**
   * Soul/personality state for the current session.
   * Read-only from the tool's perspective.
   */
  soulStore: {
    load(): Promise<SoulState>;
  };

  /**
   * Monotonic clock. Returns current Unix-millisecond timestamp.
   * Injected so tools are deterministic in tests (replace with () => fixedMs).
   */
  clock: () => number;
}
