import { useEffect, useState } from "react";
import { SECRET_KEYS, setSecret, getSecret } from "./secrets";
import { importLibrary } from "../library/libraryScan";
import { lyricsRefill } from "../library/lyricsRefill";
import { profilesRefill } from "../library/annotateProfiles";
import { reflectNow } from "../reflect/trigger";
import { enableDynamicVolume, disableDynamicVolume } from "../audio/dynamicVolume";
import { exportAllData, wipeAllData } from "./dataOps";
import { DEFAULT_OLLAMA_ENDPOINT, DEFAULT_OLLAMA_MODEL } from "../providers/ollama";

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
  const [dynamicVolume, setDynamicVolume] = useState(false);
  const [piAgentEnabled, setPiAgentEnabled] = useState(false);
  const [ollamaEnabled, setOllamaEnabled] = useState(false);
  const [ollamaEndpoint, setOllamaEndpoint] = useState(DEFAULT_OLLAMA_ENDPOINT);
  const [ollamaModel, setOllamaModel] = useState(DEFAULT_OLLAMA_MODEL);
  const [embeddingDirty, setEmbeddingDirty] = useState(false);
  const [refilling, setRefilling] = useState(false);
  const [djRefilling, setDjRefilling] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [scanStatus, setScanStatus] = useState<string>("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const [a, d, z, lib, dt, dim, pe, pm, ep, zek, ok, wd, wa, we, wlat, wlon, wt, dv, pia, oe, oep, om] = await Promise.all([
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
        getSecret(SECRET_KEYS.dynamicVolumeEnabled),
        getSecret(SECRET_KEYS.piAgentEnabled),
        getSecret(SECRET_KEYS.ollamaEnabled),
        getSecret(SECRET_KEYS.ollamaEndpoint),
        getSecret(SECRET_KEYS.ollamaModel),
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
      // 动态音量默认关(需要辅助功能权限,不能默认开)
      setDynamicVolume(dv === "true");
      // pi Agent 默认关 — 实验性功能
      setPiAgentEnabled(pia === "true");
      // Ollama 默认关 — 用户明确启用才生效
      setOllamaEnabled(oe === "true");
      setOllamaEndpoint(oep ?? DEFAULT_OLLAMA_ENDPOINT);
      setOllamaModel(om ?? DEFAULT_OLLAMA_MODEL);
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
      await setSecret(SECRET_KEYS.dynamicVolumeEnabled, dynamicVolume ? "true" : "false");
      await setSecret(SECRET_KEYS.piAgentEnabled, piAgentEnabled ? "true" : "false");
      await setSecret(SECRET_KEYS.ollamaEnabled, ollamaEnabled ? "true" : "false");
      await setSecret(SECRET_KEYS.ollamaEndpoint, ollamaEndpoint || DEFAULT_OLLAMA_ENDPOINT);
      await setSecret(SECRET_KEYS.ollamaModel, ollamaModel || DEFAULT_OLLAMA_MODEL);
      // 立即生效,不用重启。enable 会触发 macOS 辅助功能权限请求(仅首次)。
      // 出错不阻塞保存流程 —— 用户下次开 app 会通过 boot hook 再试一次。
      try {
        if (dynamicVolume) await enableDynamicVolume();
        else await disableDynamicVolume();
      } catch (err) {
        console.warn("[lyra] dynamic volume toggle failed:", err);
      }
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

  const onDjRefill = () => {
    if (djRefilling) return;
    setDjRefilling(true);
    setScanStatus("DJ is listening through the library…");
    void profilesRefill()
      .then((r) => {
        setScanStatus(
          `DJ profiles: ${r.succeeded} annotated, ${r.failed} failed (of ${r.started}).`,
        );
      })
      .catch(() => setScanStatus("DJ annotate failed — check console / API key."))
      .finally(() => setDjRefilling(false));
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

  const onExport = async () => {
    try {
      const { path, size } = await exportAllData();
      const mb = (size / (1024 * 1024)).toFixed(2);
      setScanStatus(`已导出到 ${path}，${mb} MB`);
    } catch (err) {
      if (err instanceof Error && err.message === "Export cancelled") return;
      setScanStatus(`导出失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const onWipe = async () => {
    const confirmed = window.prompt(
      '此操作将清空全部 Lyra 数据（对话记录、记忆、状态等）且不可恢复。\n确认请输入 "delete"：',
    );
    if (confirmed !== "delete") return;
    try {
      await wipeAllData();
      setScanStatus("数据已清空。重启 Lyra 后生效。");
    } catch (err) {
      setScanStatus(`清空失败: ${err instanceof Error ? err.message : String(err)}`);
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
        <input
          type="checkbox"
          checked={ollamaEnabled}
          onChange={(e) => setOllamaEnabled(e.target.checked)}
          disabled={!loaded}
        />
        Ollama（本地，无需 API key）
      </label>
      {ollamaEnabled && (
        <>
          <label>
            Ollama endpoint
            <input
              type="text"
              value={ollamaEndpoint}
              onChange={(e) => setOllamaEndpoint(e.target.value)}
              disabled={!loaded}
              placeholder={DEFAULT_OLLAMA_ENDPOINT}
            />
          </label>
          <label>
            Ollama model
            <input
              type="text"
              value={ollamaModel}
              onChange={(e) => setOllamaModel(e.target.value)}
              disabled={!loaded}
              placeholder={DEFAULT_OLLAMA_MODEL}
            />
          </label>
        </>
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
        <input
          type="checkbox"
          checked={dynamicVolume}
          onChange={(e) => setDynamicVolume(e.target.checked)}
          disabled={!loaded}
        />
        Dynamic volume — 键盘越忙，音乐越轻（首次启用需在系统设置里授予辅助功能权限）
      </label>
      <label>
        <input
          type="checkbox"
          checked={piAgentEnabled}
          onChange={(e) => setPiAgentEnabled(e.target.checked)}
          disabled={!loaded}
        />
        Pi Agent（实验性）— EmotionAgent + CompanionAgent 走 pi 运行时（tool calling + 事件流可见于 <code>/explorer</code> → Agent runtime），出问题关掉即回退 legacy
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
        <button
          onClick={onDjRefill}
          disabled={djRefilling || !loaded}
          title="让资深 DJ agent 批量标注曲库语种/风格/场景档案"
        >
          {djRefilling ? "DJ listening…" : "DJ 重新听一遍曲库"}
        </button>
      </div>
      <div className="settings-actions">
        <button onClick={onReflect} disabled={saving || !loaded}>
          Reflect now
        </button>
      </div>
      <div className="settings-actions">
        <button onClick={onExport} disabled={!loaded}>
          导出全部数据
        </button>
        <button
          onClick={onWipe}
          disabled={!loaded}
          style={{ color: "var(--color-danger, #c0392b)" }}
        >
          清空全部数据
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
      <p
        data-testid="settings-footer-easter-egg"
        style={{
          marginTop: "1.5rem",
          textAlign: "center",
          opacity: 0.42,
          fontSize: "0.72rem",
          letterSpacing: "0.06em",
          fontStyle: "italic",
        }}
      >
        960 · 8849 &nbsp;—&nbsp; 一寸国土，一座珠峰
      </p>
    </div>
  );
}
