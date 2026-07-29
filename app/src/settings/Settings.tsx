import { useEffect, useState } from "react";
import { SECRET_KEYS, setSecret, getSecret } from "./secrets";
import { importLibrary } from "../library/libraryScan";
import { lyricsRefill } from "../library/lyricsRefill";
import { reflectNow } from "../reflect/trigger";

type EmbeddingChoice = "" | "zhipu" | "openai";

export type SettingsProps = {
  open: boolean;
  onClose: () => void;
  onSchedulerUpdate?: (dailyTime: string, idleMinutes: number, weeklyTime: string) => void;
};

export function Settings({ open, onClose, onSchedulerUpdate }: SettingsProps) {
  const [libraryPath, setLibraryPath] = useState("");
  const [anthropic, setAnthropic] = useState("");
  const [deepseek, setDeepseek] = useState("");
  const [zhipu, setZhipu] = useState("");
  const [dreamDailyTime, setDreamDailyTime] = useState("03:14");
  const [dreamIdleMinutes, setDreamIdleMinutes] = useState("30");
  const [weeklyTime, setWeeklyTime] = useState("09:00");
  const [perceptionEnabled, setPerceptionEnabled] = useState(true);
  const [perceptionMode, setPerceptionMode] = useState<"rule" | "llm">("rule");
  const [weatherEnabled, setWeatherEnabled] = useState(true);
  const [weatherLat, setWeatherLat] = useState("");
  const [weatherLon, setWeatherLon] = useState("");
  const [embeddingChoice, setEmbeddingChoice] = useState<EmbeddingChoice>("");
  const [zhipuEmbeddingKey, setZhipuEmbeddingKey] = useState("");
  const [openaiKey, setOpenaiKey] = useState("");
  const [weeklyDir, setWeeklyDir] = useState("");
  const [weeklyAuto, setWeeklyAuto] = useState(true);
  const [embeddingDirty, setEmbeddingDirty] = useState(false);
  const [refilling, setRefilling] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [scanStatus, setScanStatus] = useState<string>("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const [a, d, z, lib, dt, dim, pe, pm, ep, zek, ok, wd, wa, we, wlat, wlon, wt] = await Promise.all([
        getSecret(SECRET_KEYS.anthropicApiKey),
        getSecret(SECRET_KEYS.deepseekApiKey),
        getSecret(SECRET_KEYS.zhipuApiKey),
        getSecret(SECRET_KEYS.libraryRootPath),
        getSecret(SECRET_KEYS.dreamDailyTime),
        getSecret(SECRET_KEYS.dreamIdleMinutes),
        getSecret(SECRET_KEYS.perceptionEnabled),
        getSecret(SECRET_KEYS.perceptionMode),
        getSecret(SECRET_KEYS.embeddingProvider),
        getSecret(SECRET_KEYS.zhipuEmbeddingApiKey),
        getSecret(SECRET_KEYS.openaiApiKey),
        getSecret(SECRET_KEYS.weeklyDirOverride),
        getSecret(SECRET_KEYS.weeklyAutoEnabled),
        getSecret(SECRET_KEYS.weatherEnabled),
        getSecret(SECRET_KEYS.weatherLat),
        getSecret(SECRET_KEYS.weatherLon),
        getSecret(SECRET_KEYS.weeklyTime),
      ]);
      if (cancelled) return;
      setAnthropic(a ?? "");
      setDeepseek(d ?? "");
      setZhipu(z ?? "");
      setLibraryPath(lib ?? "");
      setDreamDailyTime(dt ?? "03:14");
      setDreamIdleMinutes(dim ?? "30");
      setWeeklyTime(wt ?? "09:00");
      // Default to enabled; only disable when explicitly stored as "false"
      setPerceptionEnabled(pe !== "false");
      setPerceptionMode(pm === "llm" ? "llm" : "rule");
      setWeatherEnabled(we !== "false");
      setWeatherLat(wlat ?? "");
      setWeatherLon(wlon ?? "");
      setEmbeddingChoice(ep === "zhipu" || ep === "openai" ? ep : "");
      setZhipuEmbeddingKey(zek ?? "");
      setOpenaiKey(ok ?? "");
      setWeeklyDir(wd ?? "");
      setWeeklyAuto(wa !== "false");
      setEmbeddingDirty(false);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) return null;

  const onSave = async () => {
    setSaving(true);
    try {
      const validCoord = (raw: string): string => {
        if (!raw || !raw.trim()) return "";
        const n = Number(raw);
        return Number.isFinite(n) ? raw.trim() : "";
      };
      await setSecret(SECRET_KEYS.anthropicApiKey, anthropic);
      await setSecret(SECRET_KEYS.deepseekApiKey, deepseek);
      await setSecret(SECRET_KEYS.zhipuApiKey, zhipu);
      await setSecret(SECRET_KEYS.libraryRootPath, libraryPath);
      await setSecret(SECRET_KEYS.dreamDailyTime, dreamDailyTime);
      await setSecret(SECRET_KEYS.dreamIdleMinutes, dreamIdleMinutes);
      await setSecret(SECRET_KEYS.weeklyTime, weeklyTime);
      await setSecret(SECRET_KEYS.perceptionEnabled, perceptionEnabled ? "true" : "false");
      await setSecret(SECRET_KEYS.perceptionMode, perceptionMode);
      await setSecret(SECRET_KEYS.weatherEnabled, weatherEnabled ? "true" : "false");
      await setSecret(SECRET_KEYS.weatherLat, validCoord(weatherLat));
      await setSecret(SECRET_KEYS.weatherLon, validCoord(weatherLon));
      await setSecret(SECRET_KEYS.embeddingProvider, embeddingChoice);
      await setSecret(SECRET_KEYS.zhipuEmbeddingApiKey, zhipuEmbeddingKey);
      await setSecret(SECRET_KEYS.openaiApiKey, openaiKey);
      await setSecret(SECRET_KEYS.weeklyDirOverride, weeklyDir);
      await setSecret(SECRET_KEYS.weeklyAutoEnabled, weeklyAuto ? "true" : "false");
      setEmbeddingDirty(false);
      if (libraryPath) {
        setScanStatus("Scanning…");
        try {
          const { imported, pruned } = await importLibrary(libraryPath);
          const impMsg = `Imported ${imported} new track${imported === 1 ? "" : "s"}.`;
          const pruneMsg = pruned > 0
            ? ` Pruned ${pruned} stale row${pruned === 1 ? "" : "s"}.`
            : "";
          setScanStatus(`${impMsg}${pruneMsg}`);
        } catch (err) {
          setScanStatus(`Scan failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      onSchedulerUpdate?.(dreamDailyTime, Number(dreamIdleMinutes) || 0, weeklyTime);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const onRefill = () => {
    if (refilling) return;
    setRefilling(true);
    setScanStatus("Refilling lyrics embeddings…");
    void lyricsRefill()
      .then((r) => {
        setScanStatus(
          `Refill: ${r.succeeded} succeeded, ${r.failed} failed (of ${r.started}).`,
        );
      })
      .catch(() => setScanStatus("Refill failed silently — check console."))
      .finally(() => setRefilling(false));
  };

  const onReflect = async () => {
    setSaving(true);
    try {
      const { appliedFacts, dreamAdded } = await reflectNow();
      setScanStatus(
        `Reflected — ${appliedFacts} fact update${appliedFacts === 1 ? "" : "s"}${dreamAdded ? " + one dream" : ""}.`
      );
    } catch (err) {
      setScanStatus(`Reflect failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div role="dialog" aria-label="Settings" className="settings-modal">
      <h2>Settings</h2>
      <label>
        Music library folder
        <input
          type="text"
          placeholder="/Users/you/Music"
          value={libraryPath}
          onChange={(e) => setLibraryPath(e.target.value)}
          disabled={!loaded}
        />
      </label>
      {scanStatus && (
        <p style={{ opacity: 0.7, fontSize: "0.85em" }}>{scanStatus}</p>
      )}
      <label>
        Anthropic API Key
        <input
          type="password"
          value={anthropic}
          onChange={(e) => setAnthropic(e.target.value)}
          disabled={!loaded}
        />
      </label>
      <label>
        DeepSeek API Key
        <input
          type="password"
          value={deepseek}
          onChange={(e) => setDeepseek(e.target.value)}
          disabled={!loaded}
        />
      </label>
      <label>
        Zhipu API Key
        <input
          type="password"
          value={zhipu}
          onChange={(e) => setZhipu(e.target.value)}
          disabled={!loaded}
        />
      </label>
      <label>
        Daily dream time (HH:MM)
        <input
          type="text"
          placeholder="03:14"
          value={dreamDailyTime}
          onChange={(e) => setDreamDailyTime(e.target.value)}
          disabled={!loaded}
        />
      </label>
      <label>
        Idle threshold (minutes, 0 = off)
        <input
          type="number"
          min="0"
          value={dreamIdleMinutes}
          onChange={(e) => setDreamIdleMinutes(e.target.value)}
          disabled={!loaded}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={perceptionEnabled}
          onChange={(e) => setPerceptionEnabled(e.target.checked)}
          disabled={!loaded}
        />
        Perception (privacy) — local behavioral signals bias next song
      </label>
      <label>
        Perception mode
        <select
          value={perceptionMode}
          onChange={(e) =>
            setPerceptionMode(e.target.value === "llm" ? "llm" : "rule")
          }
          disabled={!loaded || !perceptionEnabled}
        >
          <option value="rule">规则式（离线，免费）</option>
          <option value="llm">LLM 式（Zhipu/DeepSeek，每 60 秒一次调用）</option>
        </select>
      </label>
      <label>
        <input
          type="checkbox"
          checked={weatherEnabled}
          onChange={(e) => setWeatherEnabled(e.target.checked)}
          disabled={!loaded || !perceptionEnabled}
        />
        Weather mood (Open-Meteo) — soft PAD bias from local weather
      </label>
      <p style={{ opacity: 0.7, fontSize: "0.85em", margin: "0 0 8px 0" }}>
        ⓘ 未填写手动坐标时会请求系统定位权限
      </p>
      <label>
        Weather lat (optional fallback)
        <input
          type="text"
          value={weatherLat}
          onChange={(e) => setWeatherLat(e.target.value)}
          disabled={!loaded || !perceptionEnabled || !weatherEnabled}
          placeholder="e.g. 31.23"
        />
      </label>
      <label>
        Weather lon (optional fallback)
        <input
          type="text"
          value={weatherLon}
          onChange={(e) => setWeatherLon(e.target.value)}
          disabled={!loaded || !perceptionEnabled || !weatherEnabled}
          placeholder="e.g. 121.47"
        />
      </label>
      <label>
        Lyrics embedding provider
        <select
          value={embeddingChoice}
          onChange={(e) => {
            setEmbeddingChoice(e.target.value as EmbeddingChoice);
            setEmbeddingDirty(true);
          }}
          disabled={!loaded}
        >
          <option value="">（未启用）</option>
          <option value="zhipu">Zhipu embedding-3</option>
          <option value="openai">OpenAI text-embedding-3-small</option>
        </select>
      </label>
      {embeddingChoice === "zhipu" && (
        <label>
          Zhipu Embedding API Key
          <input
            type="password"
            value={zhipuEmbeddingKey}
            onChange={(e) => {
              setZhipuEmbeddingKey(e.target.value);
              setEmbeddingDirty(true);
            }}
            disabled={!loaded}
          />
        </label>
      )}
      {embeddingChoice === "openai" && (
        <label>
          OpenAI API Key
          <input
            type="password"
            value={openaiKey}
            onChange={(e) => {
              setOpenaiKey(e.target.value);
              setEmbeddingDirty(true);
            }}
            disabled={!loaded}
          />
        </label>
      )}
      <fieldset className="settings-weekly">
        <legend>周报</legend>
        <label>
          保存目录(留空则默认 <code>&lt;appData&gt;/weeklies</code>)
          <input
            type="text"
            value={weeklyDir}
            onChange={(e) => setWeeklyDir(e.target.value)}
            placeholder=""
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={weeklyAuto}
            onChange={(e) => setWeeklyAuto(e.target.checked)}
          />
          周日 {weeklyTime} 自动生成
        </label>
        <label>
          周报生成时间 (HH:MM，周日触发)
          <input
            type="text"
            placeholder="09:00"
            value={weeklyTime}
            onChange={(e) => setWeeklyTime(e.target.value)}
            disabled={!loaded || !weeklyAuto}
          />
        </label>
      </fieldset>
      <div className="settings-actions">
        <button
          onClick={onRefill}
          disabled={
            refilling || !loaded || !embeddingChoice || embeddingDirty
          }
          title={
            embeddingDirty
              ? "Save first — the provider/key isn't persisted yet."
              : undefined
          }
        >
          {refilling ? "Refilling…" : "Refill missing lyrics embeddings"}
        </button>
      </div>
      <div className="settings-actions">
        <button onClick={onReflect} disabled={saving || !loaded}>
          Reflect now
        </button>
      </div>
      <div className="settings-actions">
        <button onClick={onClose} disabled={saving}>
          Cancel
        </button>
        <button onClick={onSave} disabled={saving || !loaded}>
          Save
        </button>
      </div>
    </div>
  );
}
