import { Orchestrator } from "./Orchestrator";
import { EmotionAgent } from "../agents/EmotionAgent";
import { CompanionAgent } from "../agents/CompanionAgent";
import { LibraryAgent } from "../agents/LibraryAgent";
import { createSoulStore } from "./soulStore";
import * as turnRepo from "../db/repo/turnRepo";
import * as shiftFeedbackRepo from "../db/repo/shiftFeedbackRepo";
import * as libraryFeaturesRepo from "../db/repo/libraryFeaturesRepo";
import { playFile, stopPlayback } from "../audio/player";
import { registry } from "../providers/registry";
import { bus as perceptionBus } from "../perception/events";
// Phase 2 pi wiring
import { routeProvider } from "../agents/route";
import { getPiAgentEnabled } from "../agents/piFlag";
import { AgentRunSink } from "./agentRunSink";
import type { StreamableProvider } from "../agents/pi/streamFn";
// Phase 3b: aux tools wiring
import { createToolContextFactory } from "./toolContextFactory";
import * as libraryRepo from "../db/repo/libraryRepo";

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
  let emotionProvider: ReturnType<typeof routeProvider>;
  let companionProvider: ReturnType<typeof routeProvider>;

  try {
    // Route once and pass the same instance as both legacy chat & pi stream.
    // The provider satisfies both ModelProvider (chat) and StreamableProvider
    // (chatStream) structurally after Phase 1 子线 A.
    emotionProvider = routeProvider("emotion");
    emotion = new EmotionAgent({
      provider: emotionProvider,
      streamableProvider: emotionProvider as unknown as StreamableProvider,
      getPiAgentEnabled,
    });
    // Phase 3a: route companion provider for pi path wiring.
    companionProvider = routeProvider("companion");
    companion = new CompanionAgent({
      provider: companionProvider,
      streamableProvider: companionProvider as unknown as StreamableProvider,
      getPiAgentEnabled,
    });
  } catch {
    // routeProvider throws when neither primary nor fallback is registered
    return null;
  }

  const library = new LibraryAgent();
  const soulStore = createSoulStore();
  // AgentRunSink shared across EmotionAgent and CompanionAgent pi paths.
  const agentRunSink = new AgentRunSink();

  // Phase 3b: build a ToolContextFactory so CompanionAgent can provision
  // per-turn ToolContext objects for auxiliary tools (get_recent_plays, etc.).
  const toolContextFactory = createToolContextFactory({
    libraryRepo: {
      getTrack: (id) => libraryRepo.getTrack(id),
      listAll: () => libraryRepo.listAll(),
    },
    libraryFeaturesRepo: { getBatch: (ids) => libraryFeaturesRepo.getBatch(ids) },
    turnRepo: { listRecentTurns: (n) => turnRepo.listRecentTurns(n) },
    soulStore,
  });
  companion.setToolContextFactory(toolContextFactory);

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
    libraryFeaturesRepo: { getBatch: libraryFeaturesRepo.getBatch },
    agentRunSink,
  });
}
