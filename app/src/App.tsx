import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import "./App.css";
import { Settings } from "./settings/Settings";
import { HomeView } from "./home/HomeView";
import { bootProviders } from "./providers/boot";
import { createDefaultOrchestrator } from "./turn/createOrchestrator";
import type { Orchestrator } from "./turn/Orchestrator";
import { bindGlobalKeys } from "./home/keyboard";
import { reflectNow } from "./reflect/trigger";
import { readMemoryFile } from "./memory/fileIO";
import { parseMemoryMd, EMPTY_MEMORY } from "./memory/parser";
import { setMemoryContext } from "./memory/context";
import { onSongComplete } from "./audio/player";
import { DreamScheduler } from "./schedule/dreamScheduler";
import { autoWeeklyTrigger, onDemandWeeklyOpen } from "./weekly/wire";
import { SECRET_KEYS, getSecret, setSecret } from "./settings/secrets";
import { ProactiveEngine } from "./proactive/engine";
import { createSulkStore } from "./proactive/sulkStore";
import { readPersistedSulkUntil, persistSulkSnapshot } from "./proactive/sulkPersistence";
import { morningRule, careRule, anniversaryRule, shareRule, rhythmRule } from "./proactive/rules";
import type { PolitenessState, RuleContext } from "./proactive/types";
import { listRecent as listRecentSharedMemory } from "./db/repo/sharedMemoryRepo";
import { bus as perceptionBus } from "./perception/events";
import { installPerceptionListeners } from "./perception/install";
import { aggregate as aggregatePerception } from "./perception/aggregator";
import { ensureWeatherSnapshot } from "./perception/weather";
import { createPerceptionAgent, type PerceptionMode } from "./perception/PerceptionAgent";
import { routeProvider } from "./agents/route";
import { insert as insertPerceptionAudit } from "./db/repo/perceptionAuditRepo";
import { loadSoulState } from "./db/repo/soulRepo";
import { RoadmapBoard } from "./ui/RoadmapBoard";
import { DataExplorer } from "./ui/DataExplorer";
import { HelpOverlay } from "./home/HelpOverlay";
import { WeeklyReader } from "./home/WeeklyReader";

async function bootMemory(): Promise<void> {
  try {
    const content = await readMemoryFile();
    const parsed = parseMemoryMd(content);
    setMemoryContext(parsed);
  } catch {
    setMemoryContext(EMPTY_MEMORY);
  }
}

function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [roadmapOpen, setRoadmapOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [weeklyHtml, setWeeklyHtml] = useState<string | null>(null);
  const [dataExplorerOpen, setDataExplorerOpen] = useState(false);
  const [dataExplorerInitialTab, setDataExplorerInitialTab] = useState<
    import("./ui/DataExplorer").DataExplorerProps["initialTab"]
  >(undefined);
  const [bootDone, setBootDone] = useState(false);
  const [reflecting, setReflecting] = useState(false);
  const schedulerRef = useRef<DreamScheduler | null>(null);
  const sulkStoreRef = useRef(
    createSulkStore({
      onChange: (snap) => {
        void persistSulkSnapshot(snap);
      },
    }),
  );
  const politenessStateRef = useRef<PolitenessState>({
    todayProactiveCount: 0,
    todayKindCount: {},
    lastKindFireAt: {},
    isFocusOrSleep: () => false,
    isPlayingOtherSource: () => false,
  });
  const proactiveEngineRef = useRef<ProactiveEngine | null>(null);
  const todayFirstOpenRef = useRef(true);

  useEffect(() => {
    bootProviders()
      .catch(() => {})
      .then(() => bootMemory())
      .catch(() => {})
      .then(async () => {
        // Rehydrate sulk state from persisted SoulState so a 3-day sulk
        // survives an app restart. Expired sulks are dropped by hydrate().
        const persistedSulkMs = await readPersistedSulkUntil();
        sulkStoreRef.current.hydrate({ sulkUntil: persistedSulkMs });
      })
      .catch(() => {})
      .then(async () => {
        // Load scheduler config from keychain, fall back to defaults
        const [dt, dim, wt] = await Promise.all([
          getSecret(SECRET_KEYS.dreamDailyTime).catch(() => null),
          getSecret(SECRET_KEYS.dreamIdleMinutes).catch(() => null),
          getSecret(SECRET_KEYS.weeklyTime).catch(() => null),
        ]);
        const dailyTimeHHMM = dt ?? "03:14";
        const idleMinutes = dim !== null ? (Number(dim) || 0) : 30;
        const weeklyTimeHHMM = wt ?? "09:00";
        const sched = new DreamScheduler({
          dailyTimeHHMM,
          idleMinutes,
          weeklyTimeHHMM,
          runReflect: () => reflectNow().then(() => undefined),
          runWeekly: autoWeeklyTrigger,
          getLastReflectDate: () => getSecret(SECRET_KEYS.dreamLastReflectDate),
          setLastReflectDate: (iso) => setSecret(SECRET_KEYS.dreamLastReflectDate, iso),
          getLastWeeklyDate: () => getSecret(SECRET_KEYS.weeklyLastRunDate),
          setLastWeeklyDate: (iso) => setSecret(SECRET_KEYS.weeklyLastRunDate, iso),
        });
        schedulerRef.current = sched;
        sched.start();
      })
      .catch(() => {})
      .then(async () => {
        // Sprint 11: TTL trace cleanup. Prompts are large; keep 7 days of
        // reasoning traces. Non-blocking — if the delete fails we skip
        // this pass and try again on next boot.
        const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
        const repo = await import("./db/repo/reasoningTracesRepo");
        await repo.deleteOlderThan(cutoff).catch(() => {});
      })
      .catch(() => {})
      .finally(() => setBootDone(true));

    return () => {
      schedulerRef.current?.stop();
      schedulerRef.current = null;
    };
  }, []);

  const handleSchedulerUpdate = useCallback(
    (dailyTime: string, idleMinutes: number, weeklyTime: string) => {
      schedulerRef.current?.stop();
      const sched = new DreamScheduler({
        dailyTimeHHMM: dailyTime,
        idleMinutes,
        weeklyTimeHHMM: weeklyTime,
        runReflect: () => reflectNow().then(() => undefined),
        runWeekly: autoWeeklyTrigger,
        getLastReflectDate: () => getSecret(SECRET_KEYS.dreamLastReflectDate),
        setLastReflectDate: (iso) => setSecret(SECRET_KEYS.dreamLastReflectDate, iso),
        getLastWeeklyDate: () => getSecret(SECRET_KEYS.weeklyLastRunDate),
        setLastWeeklyDate: (iso) => setSecret(SECRET_KEYS.weeklyLastRunDate, iso),
      });
      schedulerRef.current = sched;
      sched.start();
    },
    [],
  );

  // Re-evaluate after bootProviders completes so the orchestrator sees registered providers
  const orchestrator: Orchestrator | null = useMemo(
    () => (bootDone ? createDefaultOrchestrator() : null),
    [bootDone],
  );

  const runProactiveEngineTick = useCallback(async (todayFirstOpen: boolean) => {
    const engine = proactiveEngineRef.current;
    if (!engine) return;
    let sharedMemories: RuleContext["sharedMemories"] = [];
    try {
      sharedMemories = await listRecentSharedMemory(20);
    } catch {
      /* best-effort */
    }
    await engine.tick({
      now: new Date(),
      lastAppOpenAt: null,
      todayFirstOpen,
      sharedMemories,
      dreamSeeds: [],
      todayKindCount: { ...politenessStateRef.current.todayKindCount },
    });
  }, []);

  // Construct ProactiveEngine once orchestrator is ready
  useEffect(() => {
    if (!orchestrator) return;

    const engine = new ProactiveEngine({
      rules: [morningRule, careRule, anniversaryRule, shareRule, rhythmRule],
      politenessState: politenessStateRef.current,
      sulkStore: sulkStoreRef.current,
      fulfill: async (intent) => {
        await orchestrator.fulfillProactive(intent);
      },
    });
    proactiveEngineRef.current = engine;

    // Tick once after boot (in case app opened fresh this morning)
    void runProactiveEngineTick(todayFirstOpenRef.current).finally(() => {
      todayFirstOpenRef.current = false;
    });
  }, [orchestrator, runProactiveEngineTick]);

  // Tick on window focus
  useEffect(() => {
    const handleFocus = () => {
      const firstOpen = todayFirstOpenRef.current;
      todayFirstOpenRef.current = false;
      void runProactiveEngineTick(firstOpen);
    };
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [runProactiveEngineTick]);

  const handleReflectNow = useCallback(() => {
    if (reflecting) return;
    setReflecting(true);
    reflectNow().finally(() => setReflecting(false));
  }, [reflecting]);

  useEffect(() => {
    return bindGlobalKeys({
      onTogglePlayback: () => {},
      onOpenSettings: () => setSettingsOpen(true),
      onReflectNow: handleReflectNow,
      onOpenRoadmap: () => setRoadmapOpen(true),
      onOpenDataExplorer: () => setDataExplorerOpen(true),
    });
  }, [handleReflectNow]);

  // Subscribe to Rust's audio-complete event so the orchestrator can
  // finalise the ended turn and continue to the next song. Rust only emits
  // this for NATURAL completions (not for stop() or superseded playbacks),
  // so the handler doesn't need to guard against "was this stopped?".
  useEffect(() => {
    if (!orchestrator) return;
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    onSongComplete(() => {
      if (!orchestrator) return;
      // Fire and forget — the orchestrator handles its own errors.
      void orchestrator.onSongComplete();
    })
      .then((off) => {
        if (cancelled) off();
        else unlisten = off;
      })
      .catch((err) => {
        console.warn("[lyra] failed to subscribe to audio-complete:", err);
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [orchestrator]);

  // Perception loop: install window listeners, tick every 60s to infer a
  // PerceptionBias from the rolling event window, and push the latest bias
  // to the Orchestrator. Respects SECRET_KEYS.perceptionEnabled (default ON).
  useEffect(() => {
    if (!orchestrator) return;
    let cancelled = false;
    let uninstallListeners: (() => void) | null = null;
    let tickTimer: ReturnType<typeof setInterval> | null = null;

    (async () => {
      const stored = await getSecret(SECRET_KEYS.perceptionEnabled).catch(() => null);
      const enabled = stored !== "false";
      if (!enabled || cancelled) return;

      uninstallListeners = installPerceptionListeners(perceptionBus);
      const modeStored = await getSecret(SECRET_KEYS.perceptionMode).catch(() => null);
      const mode: PerceptionMode = modeStored === "llm" ? "llm" : "rule";
      const provider =
        mode === "llm"
          ? (() => {
              try {
                return routeProvider("perception");
              } catch {
                return undefined;
              }
            })()
          : undefined;
      // Pull persisted PerceptionTuning so ReflectAgent's earlier suggestions
      // take effect for this session's rule agent (Sprint 8 T5).
      const soul = await loadSoulState("lyra_001").catch(() => null);
      const tuning = soul?.perception_tuning;
      const agent = createPerceptionAgent({ mode, provider, tuning });
      console.debug("[lyra] perception agent mode:", mode, "tuning:", tuning ?? "(defaults)");

      const weatherStored = await getSecret(SECRET_KEYS.weatherEnabled).catch(() => null);
      const weatherEnabled = weatherStored !== "false";
      const latRaw = await getSecret(SECRET_KEYS.weatherLat).catch(() => null);
      const lonRaw = await getSecret(SECRET_KEYS.weatherLon).catch(() => null);
      const parseCoord = (raw: string | null): number | null => {
        if (raw == null || raw === "") return null;
        const n = Number(raw);
        return Number.isFinite(n) ? n : null;
      };
      const manualLat = parseCoord(latRaw);
      const manualLon = parseCoord(lonRaw);

      const tick = async () => {
        try {
          const features = aggregatePerception(perceptionBus);
          const weather = await ensureWeatherSnapshot({
            enabled: weatherEnabled,
            manualLat,
            manualLon,
          });
          if (weather) features.weatherCode = weather.weatherCode;
          const bias = await agent.infer(features);
          orchestrator.setPerceptionBias(bias.confidence > 0 ? bias : null);
          if (bias.confidence > 0) {
            console.debug("[lyra] perception bias:", bias);
          }
          // Sprint 15: expose behavioral signals for CompanionAgent shift inference
          const hesitationLevel: "none" | "some" | "many" =
            (features.abandonedInputs ?? 0) === 0
              ? "none"
              : (features.abandonedInputs ?? 0) < 3
                ? "some"
                : "many";
          orchestrator.setPerceptionSignals({
            skipRatio: features.skipRatio,
            isBlurred: features.isBlurred,
            inputHesitation: hesitationLevel,
          });
          // Sprint 8: rolling audit so ReflectAgent can tune thresholds.
          void insertPerceptionAudit({
            id: `pa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            ts: Date.now(),
            source: mode,
            features_json: JSON.stringify(features),
            bias_json: JSON.stringify(bias),
          }).catch(() => {});
        } catch (err) {
          console.warn("[lyra] perception tick failed:", err);
        }
      };
      // Prime once and then tick every 60s.
      tick();
      tickTimer = setInterval(tick, 60_000);
    })().catch(() => {});

    return () => {
      cancelled = true;
      uninstallListeners?.();
      if (tickTimer) clearInterval(tickTimer);
      orchestrator.setPerceptionBias(null);
    };
  }, [orchestrator]);

  return (
    <>
      {reflecting && (
        <div
          data-testid="reflecting-overlay"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
          }}
        >
          <span style={{ color: "#fff", fontSize: "1.5rem" }}>Lyra is dreaming…</span>
        </div>
      )}
      <HomeView
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenDataExplorer={(tab) => {
          setDataExplorerInitialTab(tab);
          setDataExplorerOpen(true);
        }}
        onOpenHelp={() => setHelpOpen(true)}
        orchestrator={orchestrator}
        onWeek={async () => {
          const html = await onDemandWeeklyOpen();
          if (html) setWeeklyHtml(html);
        }}
      />
      <Settings open={settingsOpen} onClose={() => setSettingsOpen(false)} onSchedulerUpdate={handleSchedulerUpdate} />
      <RoadmapBoard open={roadmapOpen} onClose={() => setRoadmapOpen(false)} />
      <DataExplorer
        open={dataExplorerOpen}
        onClose={() => setDataExplorerOpen(false)}
        initialTab={dataExplorerInitialTab}
      />
      <HelpOverlay open={helpOpen} onClose={() => setHelpOpen(false)} />
      <WeeklyReader html={weeklyHtml} onClose={() => setWeeklyHtml(null)} />
    </>
  );
}

export default App;
