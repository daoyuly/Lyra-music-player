// llmUsageRepo — one row per provider.chat call. Written by the
// usage-logging decorator (providers/usageLogging.ts). Read by the
// Data Explorer "LLM 用量" tab.
//
// Phase 4: agent_kind column is now live (migration 009_agent_runs.sql adds it
// via ALTER TABLE llm_usage ADD COLUMN agent_kind TEXT).
// "legacy" = classic provider.chat() path; "pi" = pi Agent path.

import { getDb } from "../client";

export type LlmUsageEntry = {
  id: number;
  ts: number;
  provider: string;
  model: string;
  agent: string | null;
  input_tokens: number;
  output_tokens: number;
  duration_ms: number | null;
  /** Path discriminator added in migration 009. NULL for rows written before Phase 4. */
  agent_kind?: "legacy" | "pi" | null;
};

export type LlmUsageInsert = Omit<LlmUsageEntry, "id"> & {
  /**
   * Path discriminator: "legacy" for provider.chat(), "pi" for pi Agent.
   * Written to the agent_kind column (added in migration 009).
   */
  agentKind?: "legacy" | "pi";
};

export async function insert(entry: LlmUsageInsert): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO llm_usage
       (ts, provider, model, agent, input_tokens, output_tokens, duration_ms, agent_kind)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entry.ts,
      entry.provider,
      entry.model,
      entry.agent,
      entry.input_tokens,
      entry.output_tokens,
      entry.duration_ms,
      entry.agentKind ?? null,
    ],
  );
}

export async function listRecent(limit = 200): Promise<LlmUsageEntry[]> {
  const db = await getDb();
  return db.select<LlmUsageEntry[]>(
    `SELECT id, ts, provider, model, agent,
            input_tokens, output_tokens, duration_ms, agent_kind
     FROM llm_usage
     ORDER BY ts DESC
     LIMIT ?`,
    [limit],
  );
}

export type UsageAggregate = {
  provider: string;
  model: string;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  avg_ms: number | null;
  p50_ms: number | null;
  p99_ms: number | null;
};

/** Aggregate per (provider, model). SQLite has no percentile_cont(), so we
 *  compute p50/p99 in JS from a sorted duration list. Rows without
 *  duration_ms simply contribute 0 to averages. */
export async function aggregateByModel(): Promise<UsageAggregate[]> {
  const db = await getDb();
  const groups = await db.select<
    Array<{
      provider: string;
      model: string;
      calls: number;
      input_tokens: number;
      output_tokens: number;
    }>
  >(
    `SELECT provider,
            model,
            COUNT(*) AS calls,
            SUM(input_tokens)  AS input_tokens,
            SUM(output_tokens) AS output_tokens
     FROM llm_usage
     GROUP BY provider, model
     ORDER BY provider, model`,
  );

  const out: UsageAggregate[] = [];
  for (const g of groups) {
    const durationRows = await db.select<Array<{ duration_ms: number | null }>>(
      `SELECT duration_ms FROM llm_usage
       WHERE provider = ? AND model = ? AND duration_ms IS NOT NULL
       ORDER BY duration_ms ASC`,
      [g.provider, g.model],
    );
    const durations = durationRows
      .map((r) => r.duration_ms)
      .filter((v): v is number => v !== null);
    const avg =
      durations.length === 0
        ? null
        : Math.round(
            durations.reduce((s, v) => s + v, 0) / durations.length,
          );
    const p50 =
      durations.length === 0
        ? null
        : durations[Math.floor(durations.length * 0.5)] ?? null;
    const p99 =
      durations.length === 0
        ? null
        : durations[Math.max(0, Math.ceil(durations.length * 0.99) - 1)] ??
          null;
    out.push({ ...g, avg_ms: avg, p50_ms: p50, p99_ms: p99 });
  }
  return out;
}
