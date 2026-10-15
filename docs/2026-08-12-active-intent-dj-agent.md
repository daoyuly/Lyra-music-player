# 任务收尾报告：粘性听歌意图 + DJ 曲库档案

> 日期：2026-08-12 → 2026-08-13  
> 提交：`f9b5a21` — `fix(lyra): 粘性听歌意图跨续播保留，并引入 DJ 曲库档案`  
> 触发 case：用户输入「一直播放粤语歌曲」后，仅第一首为粤语，后续自动续播丢失意图

---

## 1. 问题定性

Lyra **没有播放队列**。下一首由 `Orchestrator.onSongComplete` → 再次 `LibraryAgent.prefilter` + `CompanionAgent.choose` 决定（电台式推荐）。

根因链：

| # | 根因 | 证据 |
|---|------|------|
| 1 | 意图无载体 | `pseudoTarget` 用完即弃；auto-advance 时 `userUtterance=""`，覆盖为 `labels + "延续"`（`Orchestrator.ts`） |
| 2 | 意图无结构化 | 「粤语」从未解析成可过滤约束；`VerbalIntent` 仅有 switch/repeat/adjust_* |
| 3 | 曲库无语种维度 | `library_tracks` 无 language 列；prefilter 只查 title/artist/album |
| 4 | 软画像不落盘 | `target_profile` 生成后不写入 `DialogueTurn.agent_response` |

第一首命中粤语，靠的是 Companion LLM 在 brief 里看到原话后的**世界知识碰运气**，不是机制。

---

## 2. 设计决策（评审锁定）

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 意图提取 | 确定性词典优先，LLM 兜底 | 语种/流派是封闭集；零延迟、可靠 |
| ActiveIntent 持久化 | **落库**（跨 app 重启） | 用户选择；配套撤销为一等能力 |
| Agent 拆分粒度 | 逻辑三层、**物理零新增在线 LLM** | 播放是确定性动作；避免串行延迟 ×3 |
| 曲库语种 | DJ agent 批量标注 → 独立表 | `metadata_json` 不够支撑 SQL 级过滤 |
| DJ 定位 | **离线入库管线**，非在线选歌 agent | 智慧灌注成档案；在线只读 |

架构角色（逻辑）：

```
Chat 层     IntentParser + EmotionAgent + Companion 输出扩展
推荐层      LibraryAgent.prefilter（召回）+ rankByShift（重排）
播放层      Orchestrator + audio.playFile（不变）
离线感知    DjAgent → library_track_profiles（第三环入库管线）
```

---

## 3. 交付清单

### P0 — ActiveIntent（止血）

| 产物 | 路径 |
|------|------|
| Migration | `app/src-tauri/migrations/011_active_intent.sql` |
| Repo | `app/src/db/repo/activeIntentRepo.ts` |
| 解析器 | `app/src/agents/intentParser.ts`（语种/风格/场景 + 一直/撤销） |
| 编排接线 | `Orchestrator.ts`：输入先解析 → sticky 拼入 pseudoTarget → brief 双路径注入 |
| Prompt | `prompts/companion.ts` 新增 `clear_intent`；活跃意图必优先满足 |
| Turn 软载体 | `AgentResponse.target_profile` 可选落盘 |

### P1 — DJ agent（可靠召回）

| 产物 | 路径 |
|------|------|
| Migration | `app/src-tauri/migrations/012_track_profiles.sql` |
| Repo | `app/src/db/repo/trackProfilesRepo.ts` |
| Agent | `app/src/agents/DjAgent.ts`（language / genres / mood / scenes / one_liner） |
| 批量管线 | `app/src/library/annotateProfiles.ts`；接入 `libraryScan` 新歌入库 |
| Settings | 「DJ 重新听一遍曲库」按钮 |
| 召回 | `LibraryAgent.prefilter`：语种硬过滤（档案足够时）+ intent 加权 |
| 候选展示 | Companion brief 附带 `language + genres + one_liner` |
| 导出 | `data_export.rs` 纳入 `active_intent` / `library_track_profiles` |

### 测试

关键路径 106 测通过（含 ActiveIntent 续播回归、语种硬过滤、DjAgent JSON 解析、IntentParser 词典）。

---

## 4. 运行时数据流（修复后）

```
用户：「一直播放粤语歌曲」
  → IntentParser → ActiveIntent{ languages:["yue"], persistence:"sticky" } 落库
  → EmotionAgent.analyze（PAD 不变）
  → prefilter(pseudoTarget 含意图原文, intent)  ← 有档案则硬过滤 yue
  → Companion.choose(brief 含「当前活跃意图」)
  → play

歌结束 onSongComplete：
  → userUtterance=""，但 pseudoTarget / brief / prefilter 仍携带 ActiveIntent
  → 续播不再蒸发「粤语」

用户：「别放粤语了 / 随便来点」
  → IntentParser.clear 或 Companion verbal_intent=clear_intent → 清库
```

---

## 5. 验收步骤

1. 重启 app（跑 migration 011 / 012）
2. Settings → **DJ 重新听一遍曲库**（灌满语种档案；未标注前仍依赖 LLM 世界知识续命）
3. 输入「一直播放粤语歌曲」→ 听完第一首，确认后续仍偏粤语
4. 输入「别放粤语了，随便来点」→ 意图解除，选曲恢复开放
5. 杀进程再开 → sticky 意图仍在（落库）

---

## 6. 未做（P2）

- sticky 意图过期提示 UI（如 7 天温和确认，防幽灵意图）
- pi 路径写工具 `set_active_intent`
- 意图命中率产品埋点面板化（已有 `active_intent_set` / `active_intent_cleared` 事件写入）
- DJ 档案在 DataExplorer 可视化

---

## 7. 风险与过渡态

- **P0→P1 之间**：曲库未标注完时，续播靠 brief 注入 + LLM 世界知识，仍是概率性命中；DJ 灌库后才进入硬过滤。
- **幽灵意图**：跨重启 sticky 若无撤销/过期 UI，可能造成「为什么只放粤语」；P2 过期提示是配套，非可选项。
- **DJ 成本**：每首歌 1 次小模型调用（走 emotion 路由 provider）；Settings 可中断续跑（按 `model` 字段判缺）。

---

## 8. 相关文件速查

```
app/src/agents/intentParser.ts
app/src/agents/DjAgent.ts
app/src/db/repo/activeIntentRepo.ts
app/src/db/repo/trackProfilesRepo.ts
app/src/library/annotateProfiles.ts
app/src/turn/Orchestrator.ts
app/src/agents/LibraryAgent.ts
app/src/agents/CompanionAgent.ts
app/src-tauri/migrations/011_active_intent.sql
app/src-tauri/migrations/012_track_profiles.sql
```
