import { Orchestrator } from "./Orchestrator";
import { EmotionAgent } from "../agents/EmotionAgent";
import { CompanionAgent } from "../agents/CompanionAgent";
import { LibraryAgent } from "../agents/LibraryAgent";
import { createSoulStore } from "./soulStore";
import * as turnRepo from "../db/repo/turnRepo";
import * as shiftFeedbackRepo from "../db/repo/shiftFeedbackRepo";
import { playFile, stopPlayback } from "../audio/player";
import { registry } from "../providers/registry";
import { bus as perceptionBus } from "../perception/events";

/**
 * createDefaultOrchestrator — factory that wires all Sprint 1b-β agents.
 *
 * Returns null when no provider is registered (no API key configured),
 * which HomeView renders as the cold-boot "needs API key" state.
 */
export function createDefaultOrchestrator(): Orchestrator | null {
  if (registry.list().length === 0) {
    return null;
  }

  let emotion: EmotionAgent;
  let companion: CompanionAgent;

  try {
    emotion = new EmotionAgent();
    companion = new CompanionAgent();
  } catch {
    // routeProvider throws when neither primary nor fallback is registered
    return null;
  }

  const library = new LibraryAgent();
  const soulStore = createSoulStore();

  const audio = {
    playFile,
    stop: stopPlayback,
  };

  return new Orchestrator({
    emotion,
    companion,
    library,
    soulStore,
    turnRepo: {
      insertTurn: turnRepo.insertTurn,
      updateTurn: turnRepo.updateTurn,
      setTurnLatency: turnRepo.setTurnLatency,
    },
    audio,
    eventBus: perceptionBus,
    shiftFeedbackRepo: { insert: shiftFeedbackRepo.insert },
  });
}
