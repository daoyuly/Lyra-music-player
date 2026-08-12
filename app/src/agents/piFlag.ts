/**
 * piFlag.ts — thin helper for reading the pi Agent feature flag.
 *
 * Returns true only when SECRET_KEYS.piAgentEnabled is explicitly stored as
 * "true". Defaults to false (flag absent or any other value → legacy path).
 *
 * Usage: inject as a dep into EmotionAgent at construction time so tests can
 * swap it with a sync stub without touching the Tauri invoke layer.
 */
import { getSecret, SECRET_KEYS } from "../settings/secrets";

export async function getPiAgentEnabled(): Promise<boolean> {
  const v = await getSecret(SECRET_KEYS.piAgentEnabled);
  return v === "true";
}
