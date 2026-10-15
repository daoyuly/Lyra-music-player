/**
 * formatError — structured error helpers for Lyra's turn/provider paths.
 *
 * WebKit (Tauri) often surfaces network/CSP/CORS failures as the opaque
 * message "Load failed". These helpers expand that into greppable terminal
 * lines and short UI error codes (`E_LLM_NETWORK`, …).
 */

import { lyraLog, mirrorToTerminal } from "./lyraLog";

export type ErrorDetail = {
  name: string;
  message: string;
  stack?: string;
  cause?: string;
};

/** Stable codes shown in the UI and searchable in the terminal. */
export type LyraErrorCode =
  | "E_LLM_NETWORK"
  | "E_LLM_HTTP"
  | "E_LLM_UNREACHABLE"
  | "E_NO_PROVIDER"
  | "E_LIBRARY_EMPTY"
  | "E_PARSE"
  | "E_UNKNOWN";

/** Flatten an unknown thrown value into name/message/stack/cause. */
export function formatErrorDetail(err: unknown): ErrorDetail {
  if (err instanceof Error) {
    const cause =
      err.cause !== undefined && err.cause !== null
        ? err.cause instanceof Error
          ? `${err.cause.name}: ${err.cause.message}`
          : String(err.cause)
        : undefined;
    return {
      name: err.name || "Error",
      message: err.message || String(err),
      stack: err.stack,
      cause,
    };
  }
  return { name: typeof err, message: String(err) };
}

/** True for WebKit/Chromium opaque network-ish failures. */
export function isOpaqueNetworkError(message: string): boolean {
  const m = message.trim().toLowerCase();
  return (
    m === "load failed" ||
    m === "failed to fetch" ||
    m === "networkerror when attempting to fetch resource." ||
    m === "networkerror when attempting to fetch resource" ||
    m.endsWith(": load failed") ||
    m.endsWith(": failed to fetch") ||
    /http_fetch network error/i.test(message)
  );
}

export function classifyError(err: unknown): LyraErrorCode {
  const msg = formatErrorDetail(err).message;
  if (isOpaqueNetworkError(msg)) return "E_LLM_NETWORK";
  if (/unreachable at /i.test(msg)) return "E_LLM_UNREACHABLE";
  if (
    /\b([45]\d{2})\b/.test(msg) &&
    /(Anthropic|Zhipu|DeepSeek|Ollama|http_fetch)/i.test(msg)
  ) {
    return "E_LLM_HTTP";
  }
  if (/no provider registered/i.test(msg)) return "E_NO_PROVIDER";
  if (/library is empty/i.test(msg)) return "E_LIBRARY_EMPTY";
  if (/bad JSON|parse failed|__parse_error__/i.test(msg)) return "E_PARSE";
  return "E_UNKNOWN";
}

/**
 * UI-facing message. Prefixed with a stable error code for cross-ref with
 * terminal `[lyra:…]` lines.
 */
export function userFacingErrorMessage(err: unknown): string {
  const code = classifyError(err);
  const { message } = formatErrorDetail(err);
  if (code === "E_LLM_NETWORK") {
    return (
      `[${code}] Load failed — LLM 网络请求失败` +
      "（检查 API Key / 网络 / 代理，或 CSP connect-src）"
    );
  }
  return `[${code}] ${message}`;
}

/**
 * Console log with a stable `[lyra]` prefix and structured fields.
 * Also mirrors a one-line summary to the Tauri process stderr.
 */
export function logLyraError(
  scope: string,
  err: unknown,
  extra?: Record<string, unknown>,
): void {
  const detail = formatErrorDetail(err);
  const code = classifyError(err);
  const payload = {
    code,
    name: detail.name,
    message: detail.message,
    cause: detail.cause,
    opaque_network: isOpaqueNetworkError(detail.message),
    ...(extra ?? {}),
    stack: detail.stack,
  };
  console.error(`[lyra] ${scope}`, payload, err);

  const extraBits = Object.entries({ code, ...extra })
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join(" ");
  const line = [
    `${detail.name}: ${detail.message}`,
    detail.cause ? `cause=${detail.cause}` : "",
    extraBits,
    isOpaqueNetworkError(detail.message) ? "opaque_network=true" : "",
    detail.stack ? `stack=${detail.stack.split("\n").slice(0, 3).join(" | ")}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  mirrorToTerminal("error", scope, line);
}

/**
 * Provider fetch failure: log + return a message that names the provider
 * and endpoint (mirrors OllamaProvider's existing pattern).
 */
export function providerFetchErrorMessage(
  providerLabel: string,
  endpoint: string,
  err: unknown,
): string {
  const detail = formatErrorDetail(err);
  let host = endpoint;
  try {
    host = new URL(endpoint).host;
  } catch {
    /* keep raw */
  }
  logLyraError(`${providerLabel} fetch failed`, err, { endpoint: host });
  lyraLog("llm", "error", "provider unreachable", {
    provider: providerLabel,
    host,
    code: classifyError(err),
  });
  return `${providerLabel} unreachable at ${endpoint} (${detail.name}: ${detail.message})`;
}
