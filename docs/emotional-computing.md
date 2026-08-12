# 情感计算（Emotional Computing）架构梳理

> 落地日期：2026-07-13
> 覆盖范围：Lyra 从「感知情绪」到「用音乐回应情绪」到「反馈修正」的整条闭环
> 目的：让新贡献者 / 未来的自己在 10 分钟内建立完整心智模型

---

## 0. 设计哲学

需求文档（`需求.md`）里定下的两条锚：

- **理论来源**：《共情力》(NVC/罗森伯格) + 《How Emotions Are Made》(Barrett 建构论)
  → 情绪不是被"识别"的固定实体，而是被"构建"的当下体验；系统对用户话语的解读必须留出**不确定性空间**。
- **表达载体**：界面 = 一幅山水画，河流水流与云朵动效体现当前音乐调性
  → 情感不仅要"算得出"，还要能**被看见**——UI 是情绪的第二身体。

由此形成的工程原则：

1. **PAD 三维（Pleasure–Arousal–Dominance）作为通用坐标系** — 所有子系统（LLM、音频、UI、反馈）都在这个空间里对齐。
2. **中文情绪含蓄性作为一等公民** — "还好"/"有点累"/"随便" 不是噪声，是信号。
3. **闭环 > 单点精度** — 单次识别可以错，只要反馈能修正就行。

---

## 1. 数据流全景

```
用户话语 ──┐
           ▼
     EmotionAgent (Zhipu GLM-5.x)
           │  CurrentEmotion { pad, labels, confidence, source }
           ▼
     CompanionAgent  ── 判定 needed_shift："接住"|"点燃"|"陪着"|"打断"
           │  target_profile: string
           ▼
     LibraryAgent.prefilter(target, pad)
           │  ┌─ 关键词  0.15
           │  ├─ PAD 距离 0.25   ← energy/valence (audio features)
           │  ├─ 歌词语义 0.40   ← lyrics embedding (最重信号)
           │  └─ BPM 距离 0.20   ← padToBpm(arousal, dominance)
           ▼
     选曲播放 → 用户反应 (skip / like / verbal_next)
           │
           ▼
     foldReactionEvents → computeEmotionDelta(prePad, postPad)
           │
           ▼
     soulStore.apply(delta)   ── 长期"灵魂"累积
     emotion_snapshots 表     ── 逐 turn 快照
           │
           ▼
     UI: ShanShuiCanvas / EmotionLightBand / BackgroundPhoto 实时响应
```

---

## 2. 模块清单

### 2.1 感知层：把话语变成 PAD

| 文件 | 职责 |
|---|---|
| `app/src/agents/EmotionAgent.ts` (151) | LLM 调用 + JSON 严格校验（p/a/d ∈ [-1,1]） |
| `app/src/agents/prompts/emotion.ts` (96) | 提示词、中文含蓄表 `CN_UNDERSTATEMENT_TABLE`、few-shot `CN_FEWSHOT` |
| `app/src/agents/EmotionAgent.test.ts` | 9 个回归用例 |

**输出契约**（`agents/types.ts`）：

```typescript
CurrentEmotion {
  pad: { p, a, d }                             // 三轴，各 [-1, 1]
  labels: string[]                             // 2-3 个中文标签
  confidence: number                           // [0, 1]
  source: "emotion-agent-inferred" | "user-declared" | "ring-signal"
  predicted_trajectory?: {                     // 5-120 分钟前瞻预测
    horizon_min: number
    predicted_pad: { p, a, d }
  }
}
```

**中文情绪捕获的关键设计**（`prompts/emotion.ts:6–24`）：

- **含蓄映射表**（14 条）："有点累" → (-0.30, -0.40, -0.30)，confidence 上限 0.80
- **判定守则**：
  - 累 → 掉 **A**（唤醒），不动 P（愉悦）
  - 想哭 → A ∈ [0.2, 0.4]，不是高唤醒（崩溃 ≠ 亢奋）
  - 短且模糊 → confidence ≤ 0.75

### 2.2 匹配层：把 PAD 变成歌

| 文件 | 职责 |
|---|---|
| `app/src/agents/LibraryAgent.ts` (200) | 4 信号加权排序，权重智能重归一化 |
| `app/src/agents/padToBpm.ts` (34) | `bpm = clamp(100 + a×45 + d×5, 50, 180)`，tolerance = 22 |
| `app/src/db/repo/libraryFeaturesRepo.ts` | `library_features` 表：bpm / energy / valence |
| `app/src/library/libraryScan.ts` | 触发 Rust `audio_extract_features` 提取音频特征 |
| `app/src-tauri/src/audio.rs` | Rust 后端：BPM + energy + valence |

**PAD ↔ 音频特征映射**：

```
energy  (0..1)  ↔  arousal   (-1..1)     targetA = (a + 1) / 2
valence (0..1)  ↔  pleasure  (-1..1)     targetP = (p + 1) / 2
```

**信号权重（缺失时重归一化）**：关键词 0.15、PAD 距离 0.25、歌词语义 **0.40**、BPM 0.20。
歌词语义权重最高，因为它承载了"歌在说什么"的直接语义，比纯音频特征更贴近情绪意图。

### 2.3 语义层：歌词 embedding（Sprint 10）

| 文件 | 职责 |
|---|---|
| `app/src/library/computeLyricsEmbedding.ts` | 提取 USLT → 调 embedding-3 → SHA-256 版本化 |
| `app/src/db/repo/lyricsEmbeddingsRepo.ts` | `library_lyrics_embeddings` 表 CRUD |
| `app/src-tauri/migrations/004_lyrics_embeddings.sql` | Schema |
| `app/src-tauri/src/lyrics.rs` | Rust：ID3/USLT 抽取 |

流水线：ID3 USLT 抽取 → Zhipu embedding-3 → `Float32Array` + 歌词 hash → upsert。Settings 里有"重灌缺失 embedding"入口（换 provider 后用）。

### 2.4 持久层：情绪的时间维度

| 文件 | 表 |
|---|---|
| `app/src/db/codec/emotionSnapshot.ts` | `emotion_snapshots(id, timestamp, turn_id, pad_p/a/d, labels_json, confidence, source)` |
| `app/src/db/repo/emotionRepo.ts` | `insertSnapshot` / `listSnapshotsForTurn` |

**注意**：`predicted_trajectory` 字段**目前不落盘**（codec 第 38 行显式跳过）。Sprint 1a 只存已发生的 PAD，预测轨迹仅用于当次决策。

### 2.5 编排层：情绪 → 音乐 → 反馈 闭环

`app/src/turn/Orchestrator.ts` 是这条链的编排者：

1. `onUserInput` → `EmotionAgent.analyze` 得 PAD
2. `CompanionAgent` 决 `needed_shift`（接住 / 点燃 / 陪着 / 打断）
3. `LibraryAgent.prefilter` 出 ~30 首候选
4. 选曲、播放、收集反应事件
5. `foldReactionEvents` 合并到 turn
6. `computeEmotionDelta(prePad, postPad)` → `soulStore.apply(delta)` 长期人格累积

**pi Agent runtime（Phase 4 引入）**

EmotionAgent 和 CompanionAgent 现在各自有两条执行路径：

| 路径 | 触发条件 | 实现 |
|---|---|---|
| `legacy` | Settings toggle 关闭 pi 时 | `_analyzeLegacy` / `_chooseLegacy`（单次 provider.chat） |
| `pi` | Settings toggle 开启 pi 时 | `agents/pi/pi-runtime.ts` 的 Agent + tool loop，通过 event stream 驱动 |

两条路径在 `providers/` 层永久共存，不存在废弃计划。`AgentRunSink`（`app/src/turn/agentRunSink.ts`）统一接收 pi 路径的 event stream，双写到内存 Map（快速 UI 读取）和 `agent_runs` SQLite 表（持久化）。DataExplorer 的 **Agent runtime** 标签页可实时查看最近 100 条运行记录，包含时间 / agent_kind / stop_reason / 耗时 / event 数，点击展开可查看完整 JSONL 事件流。`agent_runs` 表保留 30 天，由 DreamScheduler 每日 trigger 时顺带清理。

### 2.6 表达层：把 PAD 画出来

| 文件 | 表现形式 |
|---|---|
| `app/src/home/ShanShuiCanvas.tsx` (300+) | 中式山水画动态：**arousal → 全局速度**（播放中 ×1.3）；**valence → 波纹/微光的暖冷**（p=1 暖，p=-1 冷）；低通平滑 α=0.015（UI 滞后 ~1 拍） |
| `app/src/home/EmotionLightBand.tsx` (80) | 最近 20 个 PAD 采样的 SVG 色带：色相=valence，饱和度=arousal，条高=pleasure |
| `app/src/home/BackgroundPhoto.tsx` (42) | 心情标签驱动的背景照（`bgManifest.ts`） + 上下 vignette 蒙层保可读性 |

**动效克制原则**（源自 `需求.md`）：不做大量动效，保持克制但有设计感。速度平滑刻意做慢，避免 UI 抽搐式跳变。

---

## 3. 中文情绪捕获技能（skill 化）

已抽取为独立 skill，规格见 `docs/superpowers/specs/archive/2026-07-08-emotion-capture-cn-skill.md`（297 行）。

**baseline 指标（2026-07-08）**：

| 指标 | 值 | 目标 |
|---|---|---|
| 平均 PAD L1 距离 | **0.338** | < 0.5 |
| 平均 \|Δconfidence\| | **0.054** | < 0.10 |
| 最差 L1 | **0.88** | < 1.0 |

回归集：12 条 held-out 中文用例，覆盖直接正向 / 间接负向 / 中性模糊 / 反例 / 反讽。

---

## 4. 已知缺口 / TODO

以下四项是当前 emotional computing 的显性 gap，任何后续 sprint 都应从这里挑：

1. **`predicted_trajectory` 未落盘** — 类型已定义，codec 显式跳过；后果：无法做跨 turn 的预测精度评估。
2. **Confidence calibration** — `pad-scoring-rubric.md` 的评分细则尚未接入 prompt；等 7 天使用观察后再调。
3. **多模态融合** — 智能戒指 HRV / 心率作为 **arousal 轴** 的物理校准输入（`需求.md` 已列为创新方向），尚未接线。
4. **Appraisal-theoretic 推理** — CAPE 数据集"先描述事件、再推情绪"的路径未尝试；对复杂事件驱动情绪的准确率有潜在提升。

---

## 5. 关键引用（file:line）

| 概念 | 位置 |
|---|---|
| PAD 三维契约 | `app/src/agents/types.ts` |
| LLM 提示词 & 中文含蓄表 | `app/src/agents/prompts/emotion.ts:6–24` |
| 4 信号加权排序 | `app/src/agents/LibraryAgent.ts:prefilter` |
| PAD → BPM 公式 | `app/src/agents/padToBpm.ts` |
| 情绪快照 codec | `app/src/db/codec/emotionSnapshot.ts:38` (轨迹跳过) |
| 情绪 → 音乐主循环 | `app/src/turn/Orchestrator.ts` |
| 山水画 PAD 映射 | `app/src/home/ShanShuiCanvas.tsx` |
| 中文技能规格 & baseline | `docs/superpowers/specs/archive/2026-07-08-emotion-capture-cn-skill.md` |
| 歌词 embedding 设计 | `docs/superpowers/specs/archive/2026-07-08-v0.2-sprint-10-lyrics-embedding-design.md` |

---

## 6. 一句话总结

**Lyra 的情感计算 = PAD 坐标系 × 中文含蓄语义 × 音频/歌词双通道匹配 × 闭环反馈修正 × 山水画共振表达。** 约 2,800 行代码，已具备回归评估框架，中文场景已上线专用优化。
