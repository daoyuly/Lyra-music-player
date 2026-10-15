/**
 * lyraHttp — outbound HTTP for LLM providers.
 *
 * Prefer the Rust `http_fetch` command (reqwest) so requests leave the
 * process directly. WKWebView `fetch` on macOS often fails with the opaque
 * TypeError "Load failed" even when curl/reqwest succeed (CSP/CORS/ATS).
 *
 * Falls back to global `fetch` only when the Tauri bridge itself is missing
 * (vitest / vite-only). Real `http_fetch …` errors are rethrown.
 *
 * Emits `[lyra:llm]` lines (via=rust|webview, host, status, ms) on the
 * Rust path and on failures so the `tauri dev` terminal is greppable.
 */

import { invoke } from "@tauri-apps/api/core";
import { lyraLog } from "./lyraLog";

export type LyraHttpResult = {
  status: number;
  body: string;
};

export type LyraHttpInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
  /** Optional label for logs, e.g. provider id. */
  label?: string;
};

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

async function readFetchResponse(res: Response): Promise<LyraHttpResult> {
  const status =
    typeof res.status === "number"
      ? res.status
      : res.ok === false
        ? 500
        : 200;

  if (typeof res.text === "function") {
    try {
      return { status, body: await res.text() };
    } catch {
      /* vitest stream mocks may not implement text(); fall through */
    }
  }

  // Provider unit tests historically mock `json()` without `text()`.
  if (typeof (res as Response & { json?: () => Promise<unknown> }).json === "function") {
    try {
      const data = await (res as Response & { json: () => Promise<unknown> }).json();
      return { status, body: JSON.stringify(data) };
    } catch {
      /* fall through */
    }
  }

  if (res.body && typeof res.body.getReader === "function") {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let body = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    return { status, body };
  }

  return { status, body: "" };
}

export async function lyraHttp(
  url: string,
  init: LyraHttpInit = {},
): Promise<LyraHttpResult> {
  if (init.signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  const host = hostOf(url);
  const method = init.method ?? "GET";
  const t0 = performance.now();

  try {
    const result = await invoke<LyraHttpResult>("http_fetch", {
      method,
      url,
      headers: init.headers ?? {},
      body: init.body ?? null,
    });
    if (init.signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    const ms = Math.round(performance.now() - t0);
    const level = result.status >= 400 ? "warn" : "info";
    lyraLog("llm", level, result.status >= 400 ? "http error" : "ok", {
      via: "rust",
      host,
      method,
      status: result.status,
      ms,
      ...(init.label ? { label: init.label } : {}),
      bodyChars: result.body.length,
    });
    return result;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    const msg = err instanceof Error ? err.message : String(err);
    // Rust command failed after IPC — do not mask with WebView fetch.
    if (/http_fetch/i.test(msg)) {
      lyraLog("llm", "error", "rust fetch failed", {
        via: "rust",
        host,
        method,
        ms: Math.round(performance.now() - t0),
        error: msg.slice(0, 200),
        ...(init.label ? { label: init.label } : {}),
      });
      throw err instanceof Error ? err : new Error(msg);
    }
    // Outside Tauri (unit tests): use global fetch so existing mocks keep working.
    try {
      const res = await fetch(url, {
        method,
        headers: init.headers,
        body: init.body,
        signal: init.signal,
      });
      const result = await readFetchResponse(res);
      // Avoid spamming vitest: only log webview path on HTTP errors.
      if (result.status >= 400) {
        lyraLog("llm", "warn", "http error", {
          via: "webview",
          host,
          method,
          status: result.status,
          ms: Math.round(performance.now() - t0),
          ...(init.label ? { label: init.label } : {}),
        });
      }
      return result;
    } catch (fetchErr) {
      if (
        fetchErr instanceof DOMException &&
        fetchErr.name === "AbortError"
      ) {
        throw fetchErr;
      }
      lyraLog("llm", "error", "webview fetch failed", {
        via: "webview",
        host,
        method,
        ms: Math.round(performance.now() - t0),
        error: (fetchErr instanceof Error ? fetchErr.message : String(fetchErr)).slice(0, 200),
        ...(init.label ? { label: init.label } : {}),
      });
      throw fetchErr;
    }
  }
}

/**
 * Parse an SSE (`text/event-stream`) body collected in one shot into
 * the same `data: …` payloads a streaming reader would see line-by-line.
 */
export function* iterSseDataLines(body: string): Generator<string> {
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    yield trimmed.slice(5).trim();
  }
}
