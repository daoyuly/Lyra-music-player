import type { ProviderId } from "../types";
import { getSecret, SECRET_KEYS } from "../settings/secrets";
import { AnthropicProvider } from "./anthropic";
import { DeepSeekProvider } from "./deepseek";
import { ZhipuProvider } from "./zhipu";
import { OllamaProvider, DEFAULT_OLLAMA_ENDPOINT, DEFAULT_OLLAMA_MODEL } from "./ollama";
import { registry } from "./registry";
import { withUsageLogging } from "./usageLogging";
import { lyraLog } from "../lib/lyraLog";

export type SkipReason = "no-key" | "keychain-error";

export interface BootReport {
  registered: ProviderId[];
  skipped: { id: ProviderId; reason: SkipReason }[];
}

type ProviderSpec = {
  id: ProviderId;
  keyName: string;
  build: (apiKey: string) => void;
};

const SPECS: ProviderSpec[] = [
  {
    id: "anthropic",
    keyName: SECRET_KEYS.anthropicApiKey,
    build: (apiKey) =>
      registry.register(withUsageLogging(new AnthropicProvider({ apiKey }))),
  },
  {
    id: "deepseek",
    keyName: SECRET_KEYS.deepseekApiKey,
    build: (apiKey) =>
      registry.register(withUsageLogging(new DeepSeekProvider({ apiKey }))),
  },
  {
    id: "zhipu",
    keyName: SECRET_KEYS.zhipuApiKey,
    build: (apiKey) =>
      registry.register(withUsageLogging(new ZhipuProvider({ apiKey }))),
  },
];

/**
 * bootProviders — reads API keys from keychain and registers available
 * providers into the global registry. Called once at app startup.
 *
 * Returns { registered, skipped } — skipped carries a reason so the UI
 * can distinguish "no key configured" from "keychain locked / IPC failure".
 * Open list of providers: adding a new one only requires appending to SPECS.
 */
export async function bootProviders(): Promise<BootReport> {
  const registered: ProviderId[] = [];
  const skipped: { id: ProviderId; reason: SkipReason }[] = [];

  await Promise.all(
    SPECS.map(async (spec) => {
      let key: string | null;
      try {
        key = await getSecret(spec.keyName);
      } catch {
        skipped.push({ id: spec.id, reason: "keychain-error" });
        return;
      }
      if (!key) {
        skipped.push({ id: spec.id, reason: "no-key" });
        return;
      }
      spec.build(key);
      registered.push(spec.id);
    }),
  );

  // Ollama: no API key required — registered when ollamaEnabled === "true".
  try {
    const ollamaEnabled = await getSecret(SECRET_KEYS.ollamaEnabled);
    if (ollamaEnabled === "true") {
      const endpoint = (await getSecret(SECRET_KEYS.ollamaEndpoint)) ?? DEFAULT_OLLAMA_ENDPOINT;
      const model = (await getSecret(SECRET_KEYS.ollamaModel)) ?? DEFAULT_OLLAMA_MODEL;
      registry.register(withUsageLogging(new OllamaProvider({ endpoint, model })));
      registered.push("local-ollama");
    } else {
      skipped.push({ id: "local-ollama", reason: "no-key" });
    }
  } catch {
    skipped.push({ id: "local-ollama", reason: "keychain-error" });
  }

  // Sort for stable output regardless of Promise resolution order.
  registered.sort();
  skipped.sort((a, b) => a.id.localeCompare(b.id));

  lyraLog("boot", "info", "providers ready", {
    registered: registered.length ? registered.join(",") : "(none)",
    skipped: skipped.length
      ? skipped.map((s) => `${s.id}:${s.reason}`).join(",")
      : "(none)",
  });
  lyraLog(
    "boot",
    "info",
    "tip: WebView console stays in DevTools; greppable lines use [lyra:] in this terminal",
  );

  return { registered, skipped };
}
