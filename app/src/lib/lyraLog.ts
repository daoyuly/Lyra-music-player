/**
 * lyraLog — structured diagnostics that reach the `tauri dev` terminal.
 *
 * WebView `console.*` stays in DevTools only. This helper also invokes the
 * Rust `frontend_log` command so lines appear as `[lyra:<scope>] …` on stderr.
 */

import { invoke } from "@tauri-apps/api/core";

export type LyraLogLevel = "info" | "warn" | "error";

function formatFields(fields?: Record<string, unknown>): string {
  if (!fields) return "";
  return Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join(" ");
}

/** Best-effort mirror to Rust stderr. No-op outside Tauri. */
export function mirrorToTerminal(
  level: LyraLogLevel,
  scope: string,
  message: string,
): void {
  void invoke("frontend_log", { level, scope, message }).catch(() => {
    /* vitest / vite-only */
  });
}

/**
 * Log with a stable `[lyra]` prefix (DevTools) + terminal mirror.
 * Prefer short `scope` tokens: `boot` | `turn` | `llm` | `orchestrator`.
 */
export function lyraLog(
  scope: string,
  level: LyraLogLevel,
  message: string,
  fields?: Record<string, unknown>,
): void {
  const fieldStr = formatFields(fields);
  const line = fieldStr ? `${message} · ${fieldStr}` : message;
  if (level === "error") console.error(`[lyra] ${scope}`, fields ?? {}, message);
  else if (level === "warn") console.warn(`[lyra] ${scope}`, fields ?? {}, message);
  else console.info(`[lyra] ${scope}`, fields ?? {}, message);
  mirrorToTerminal(level, scope, line);
}
