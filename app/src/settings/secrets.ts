import { invoke } from "@tauri-apps/api/core";

export const SECRET_KEYS = {
  anthropicApiKey: "provider.anthropic.apiKey",
  deepseekApiKey: "provider.deepseek.apiKey",
  zhipuApiKey: "provider.zhipu.apiKey",
  libraryRootPath: "library.rootPath",
  dreamDailyTime: "dream.dailyTime",
  dreamIdleMinutes: "dream.idleMinutes",
  perceptionEnabled: "perception.enabled",
  perceptionMode: "perception.mode",
  embeddingProvider: "embedding.provider",
  zhipuEmbeddingApiKey: "embedding.zhipu.apiKey",
  openaiApiKey: "embedding.openai.apiKey",
  weeklyDirOverride: "weekly.dirOverride",
  weeklyAutoEnabled: "weekly.autoEnabled",
  weeklyTime: "weekly.time",
  dreamLastReflectDate: "dream.lastReflectDate",
  weeklyLastRunDate: "weekly.lastRunDate",
  weatherEnabled: "perception.weatherEnabled",
  weatherLat: "perception.weatherLat",
  weatherLon: "perception.weatherLon",
} as const;

export async function setSecret(key: string, value: string): Promise<void> {
  await invoke("secret_set", { key, value });
}

export async function getSecret(key: string): Promise<string | null> {
  const v = await invoke<string | null>("secret_get", { key });
  return v ?? null;
}

export async function deleteSecret(key: string): Promise<void> {
  await invoke("secret_delete", { key });
}
