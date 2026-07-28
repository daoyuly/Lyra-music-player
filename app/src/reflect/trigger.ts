import { parseMemoryMd, EMPTY_MEMORY } from "../memory/parser";
import { serializeMemoryMd } from "../memory/writer";
import { readMemoryFile, writeMemoryFile } from "../memory/fileIO";
import { listRecentTurns } from "../db/repo/turnRepo";
import { listRecent as listRecentPerception } from "../db/repo/perceptionAuditRepo";
import { listByWindow as listShiftFeedbackWindow } from "../db/repo/shiftFeedbackRepo";
import { loadSoulState, upsertSoulState } from "../db/repo/soulRepo";
import { ReflectAgent, type PerceptionObservation } from "./ReflectAgent";
import { applyReflectResult } from "./apply";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

const AGENT_ID = "lyra_001";

export async function reflectNow(): Promise<{
  appliedFacts: number;
  dreamAdded: boolean;
  tuningApplied: boolean;
}> {
  // 1. Read memory file
  const raw = await readMemoryFile();

  // 2. Parse — empty string yields EMPTY_MEMORY
  const currentMemory = raw.trim() ? parseMemoryMd(raw) : { ...EMPTY_MEMORY, raw };

  // 3. Fetch recent turns
  const recentTurns = await listRecentTurns(30);

  // 4. Fetch recent perception observations (Sprint 8)
  const recentPerception: PerceptionObservation[] = await listRecentPerception(20)
    .then((rows) =>
      rows.map((r) => {
        let confidence = 0;
        let reason = "";
        try {
          const bias = JSON.parse(r.bias_json);
          confidence = typeof bias.confidence === "number" ? bias.confidence : 0;
          reason = typeof bias.reason === "string" ? bias.reason : "";
        } catch {
          // malformed audit row — pass minimal placeholder
        }
        return { ts: r.ts, source: r.source, reason, confidence };
      }),
    )
    .catch(() => []);

  // 4b. Sprint 17: fetch shift feedback for last 7 days
  const shiftFeedback = await listShiftFeedbackWindow(Date.now() - SEVEN_DAYS_MS).catch(() => []);

  // 5. Run ReflectAgent
  const todayISO = new Date().toISOString().slice(0, 10);
  const agent = new ReflectAgent();
  const result = await agent.run({
    recentTurns,
    currentMemory,
    todayISO,
    recentPerception,
    shiftFeedback,
  });

  // 6. Apply memory result
  const updatedMemory = applyReflectResult(currentMemory, result, todayISO);

  // 7. Serialize + write memory
  const newContent = serializeMemoryMd(updatedMemory);
  await writeMemoryFile(newContent);

  // 8. Persist perceptionTuning (Sprint 8 T5) — merged with existing so
  // partial suggestions layer over prior tuning, not overwrite it.
  let tuningApplied = false;
  if (result.perceptionTuning) {
    try {
      const soul = await loadSoulState(AGENT_ID);
      if (soul) {
        await upsertSoulState({
          ...soul,
          perception_tuning: { ...soul.perception_tuning, ...result.perceptionTuning },
        });
        tuningApplied = true;
      }
    } catch {
      // best-effort — a missed persist just means next reflect can try again
    }
  }

  return {
    appliedFacts: result.factMutations.length,
    dreamAdded: true,
    tuningApplied,
  };
}
