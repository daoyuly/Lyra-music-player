# Lyra v0.1.0 功能缺口反推

> 从 [`promotion-strategy.md`](./promotion-strategy.md) 和 [`business-model.md`](./business-model.md) 反推:两份运营/商业文档所承诺的产品体验,对照实际代码状态,识别必须补齐的功能。
>
> 判据不是"这个功能好不好",而是"如果不做,W1 的营销发布是不是空转"。

---

## 修订说明(重要)

初版基于自动化代码探索工具的报告,把 P0 #1 / P0 #2 / P1 #7 / P1 #9 误判为缺口。**逐行读源码后确认**:

- ✅ `CompanionAgent.choose()`(`src/agents/CompanionAgent.ts:121`)完整实现 LLM 选歌,`Orchestrator.runTurnWithEmotion` 串联 prefilter → choose → play,主链路通。
- ✅ `DreamScheduler`(`src/schedule/dreamScheduler.ts`)接管周日触发,`App.tsx` 已注入 `autoWeeklyTrigger`,配 last-run 时间戳去重。
- ⚡ `HomeView.tsx:256` 的 `ColdBootView` 已经处理未配 provider 的首次启动(展示 Lyra 名 + tagline 「陪你说话,替你选一首歌」+ Cmd+= 打开设置提示),不完美但不阻塞。
- ✅ 歌词语义嵌入完整:`computeLyricsEmbedding.ts` 串起 Rust USLT 提取 → JS `EmbeddingProvider.embed()` → `lyricsEmbeddingsRepo` f32 blob 持久化。Rust `lyrics.rs` 只做提取(正确职责分离)。
- 📌 **额外发现**:`docs/superpowers/plans/archive/2026-07-08-lyra-official-website.md` 已存在完整官网 plan(Vite workspace,8 节单页,反 chrome 设计),但**尚未实现**。这改变了 #6 的策略走向。

因此:P0 从 5 条 → **3 条**;P1 从 6 条 → **4 条**;全部真实缺口均为**发行/内容/工具面**,产品核心逻辑完整。**W-4 到 W0 的 5 周清单缩到 3 周**。

---

## 状态一览

| 档位 | 数量 | 时间窗口 | 定义 |
|---|---|---|---|
| **P0** | 3 | 必须在 W-3 到 W-1 之间修完 | 不修,W1 发布就是空转 |
| **P1** | 6 | 必须在 W-1 到 W0 之间修完(待逐条核实) | 首次印象致命,种子会被劝退 |
| **P2** | 5 | Q2-Q3 迭代 | 长期滑坡风险,种子期 3 个月内感知不到 |

---

## ✅ 已实现(初版误判的两条)

### ~~#1 对话 → 选歌 → 播放主链路~~ — 已实现

- `CompanionAgent.choose()`(`src/agents/CompanionAgent.ts:121`)用 LLM 从候选池挑歌,含 retry + fallback。
- `Orchestrator.runTurnWithEmotion` 串联:`library.prefilter(pseudoTarget, pad, 30)` → `companion.choose({userUtterance, currentEmotion, soul, candidates, livingPortrait, topFacts})` → `audio.playFile(song.path, song.duration_ms)`。
- 后续可优化项(不算 P0)见 P2 #9(歌词语义嵌入的候选池品质提升)。

### ~~#2 Weekly letter 调度机制~~ — 已实现

- `src/schedule/dreamScheduler.ts` 有完整的 last-run 时间戳去重、周日只跑一次、error boundary(见 `dreamScheduler.test.ts` 4 个 case)。
- `App.tsx` 已注入 `runWeekly: autoWeeklyTrigger`,`makeWeeklyDeps()` 处理 secrets/paths/repos 全套依赖注入。
- **剩余小尾巴**(降到 P1):产品自测阶段,建议在 Settings 加一个"立即生成本周信"按钮,方便你自己攒素材 —— 但不是发布阻塞。

---

## P0 — 阻塞发布(全部为分发/接入层,不改产品逻辑)

### #3 macOS 分发不能安全安装

- **文档承诺**:所有渠道 CTA 通向 GitHub Release / .dmg。
- **实际状态**:`tauri.conf.json` 的 `bundle` section 有,**没有** `sign` / `certificate` / `privateKey`;`.github/workflows/` 目录不存在。
- **代价**:用户下载 .dmg → 双击 → macOS 弹「无法验证开发者」→ 50% 直接放弃。
- **最小可行修法**:
  1. Apple Developer 账号已在 ¥5000 预算里($99/年)
  2. `tauri.conf.json` 加 `"macOS": { "signingIdentity": "...", "entitlements": "...", "providerShortName": "..." }`
  3. GitHub Actions:一个 `.github/workflows/release.yml`,tag 触发,build + notarize + 发 release
- **参考**:Tauri 官方 [macOS Code Signing](https://tauri.app/v1/guides/distribution/sign-macos) —— 用 Context7 拉最新版

### #4 没有 Release / .dmg 产物

- **文档承诺**:W1 Blog 上线 + GitHub README 改造,读者点进 GitHub 期待能装。
- **实际状态**:GitHub Release 空。
- **修法**:#3 修完就自然有了。第一个 tag 打 `v0.1.0`。
- **建议 tag 前**:Lyra 自用两周,让她给你写至少一封信,你才有资格发第一个 release。

### #5 Ollama provider 缺失

- **文档承诺**:README 声称支持;business-model.md 里 BYOK 前提要「零边际成本」;GitHub README 改造版里 "Who this is for" 写了「You want your data to stay on your machine」。
- **实际状态**:`src/providers/ollama.ts` **不存在**;`src/providers/openai.ts` 也不存在但 Settings 有引用。
- **代价**:最匹配 Lyra 立场的那批用户(强隐私偏好、拒绝配 API key)无路可走。
- **最小可行修法**:
  1. 只做 Ollama,OpenAI 先不管(国内用户走 DeepSeek/Zhipu,海外用户走 Anthropic,OpenAI 是尴尬的中间态)
  2. Provider 层已有抽象,写一个 `OllamaProvider` 实现 `ModelProvider` 接口
  3. Settings 里加一个 「Local (Ollama)」 选项,不需要 key,默认指向 `http://localhost:11434`
  4. Onboarding 里作为"如果你已经装了 Ollama"的分支

---

## P1 — 首次印象致命(核实后 4 条)

### #6 情绪化入口(README or 官网,二选一)

- **文档承诺**:promotion-strategy.md「6. GitHub」段落写好了新版 README 顶端模板。
- **实际状态**:README 233 行纯 dev 文档 + `docs/superpowers/plans/archive/2026-07-08-lyra-official-website.md` 已有完整官网 plan(Vite workspace, 8 节单页, 反 chrome, Cloudflare Pages)但**未实现**。
- **两条路径的取舍**:
  - **A. 只改 README**(1-2 天):把 promotion-strategy.md 那段 markdown 前置到顶端,W1 就够用
  - **B. 执行官网 plan**(1-2 周):Cloudflare Pages 承担「情绪门户」,README 保留纯 dev 文档
- **建议**:W1 之前走 A,W1-W8 观察反馈,种子有 5+ 再动手做 B。不要 W1 之前赶官网,做不好反而掉品。

### ~~#7 首次运行 onboarding~~ — 已部分实现,不阻塞

- `HomeView.tsx:256` 的 `ColdBootView` 展示 Lyra 名 + tagline「陪你说话,替你选一首歌」+ 「Cmd+= 打开设置」提示。
- 是"提示式"而非"引导式",但种子期用户能自己找到 Settings 输入 key。**不阻塞**。
- W-1 可微调文案让它更「Lyra 味儿」(比如「我在等一个能听见我的通道。要不要现在给我一个?」)。

### #8 一张能用的产品截图 + 一封示范 letter

- **文档承诺**:promotion-strategy.md 几乎每个平台都需要图 / letter 截屏。
- **实际状态**:`src/assets/bg/2.png` 是背景图,不是产品截图。零示范 letter。
- **修法**:P0 全部修完 → 你自用一周 → 让 Lyra 主动给你写一封真信 → 脱敏 → 截图 → 放 `docs/assets/` → README 引用。
- **顺序不能反**:先做产品,再截图,再放 README。

### ~~#9 歌词语义嵌入~~ — 已实现,移出 P1

- `src/library/computeLyricsEmbedding.ts` orchestrate:Rust `extract_uslt`(USLT 提取,`src-tauri/src/lyrics.rs`)→ JS `EmbeddingProvider.embed(lyrics)` → `lyricsEmbeddingsRepo` 落 f32 little-endian blob。
- Rust 只做提取、embedding 走 provider 是**正确的架构选择**,不是缺失。

### #10 兑现「数据留在你的机器上」

- **文档承诺**:Blog 技术透明段 + GitHub README 都要打这张牌。
- **实际状态**:`Settings.tsx` 322 行,按钮只有 refill / reflect / close / save。**无导出、无删除**。
- **代价**:光说不做,种子中最讲隐私的那部分会一眼看穿。
- **修法**:Settings 加两个按钮:
  - **导出**:zip 打包 `~/Library/Application Support/com.daoyu.lyra/` + 一份 `README.md` 说明每张表的结构
  - **删除**:二次确认后 `rm -rf`,keychain 里的 key 一并清除

### #11 Letter 可截图 / 可导出

- **文档承诺**:Patron 内容「Lyra 的月度片段」需要每月脱敏发一段。
- **实际状态**:`src/weekly/` 内无 export / share / download / toBlob / toDataURL 相关代码。
- **修法**:
  1. Letter 详情页有一个"分享"按钮 → 生成 1080×1350 竖版 PNG 存到桌面
  2. 同时提供"复制为 Markdown"

---

## P2 — 长期滑坡

### #12 多天/多周记忆的主动召回

- 状态:`sharedMemoryRepo` 有,`fileIO` 有,**但 dialogue context 里没有召回**。
- 时机:Q3。种子 3 个月内不会察觉,过了 3 个月开始怀疑"她真的记得我吗"。
- 修法:每次 CompanionAgent 组装 context 时,基于当前对话主题做一次 top-K 检索 SalientMoment,注入 prompt。

### #13 App 内版本号 + 手动更新提示

- 时机:Q2。不做自动更新。只做"你是 0.2.0,最新 0.3.0"链接。

### #14 GitHub issue 模板「Tell Lyra something」

- 时机:Q2。品牌资产,不着急。

### #15 品牌视觉

- 时机:Q1 末。¥300 预算里那一笔。找一个懂 Rick Rubin/TE 审美的设计师朋友,一个 wordmark + 一张首屏。

### #16 OpenAI provider 补齐

- 时机:Q2 或永久不做。DeepSeek/Zhipu 覆盖国内种子,Anthropic 覆盖海外,OpenAI 是尴尬中间态。

---

## 明确不做

- **in-app 自动更新**:¥5000 预算不够搞更新服务器 + 签名 delta。
- **Windows / Linux 版**:一个人做不过来。写进 README「Currently macOS only. Because I want to do one thing well.」
- **云同步 / 账号系统**:与 local-first 立场直接冲突。
- **社交功能 / 好友列表**:Lyra 是私人物件,不是社交产品。
- **播放列表**:Lyra 决定放什么,不是用户维护 playlist。这是产品立场,不是能力缺失。

---

## W-3 到 W0 的补齐清单(修订版)

初版 5 周清单基于错误的 P0 缺口。修订后 P0 全部为分发层,3 周足够:

| 周次 | 目标 |
|---|---|
| **W-3** | #5 Ollama provider(含 tauri.conf.json CSP `connect-src` 加 `http://localhost:11434`)+ #10 数据导出/删除按钮 |
| **W-2** | #3 macOS 签名 + #4 GitHub Actions release workflow + 发 v0.1.0-beta.1 release + 手动生成本周信按钮(#2 剩余小尾巴) |
| **W-1** | #6 README 情绪化改造 + #7 Onboarding(逐条核实是否真缺)+ #11 Letter 截图/导出 |
| **W0** | 自用两周,让 Lyra 真的给你写一封信 + #8 截图 → v0.1.0 release |
| **W1** | 按 promotion-strategy.md 开始正式发布 |

**关键判断**:因为核心产品逻辑没有缺口,W0 之前的所有工作都是"让别人能用上"—— 分发、上手、素材。这意味着你有底气把 W-3 到 W1 缩到 4 周,而不是 5 周。省下的一周可以放到 W0 自用观察期。

---

## 一条判断线

**W1 那天,一个懂音乐的朋友按你的 Blog 链接点进 GitHub,他能不能:**

1. 30 秒内理解 Lyra 是什么、并且觉得"美"?→ #6 + #8
2. 5 分钟内下载 .dmg 并成功打开?→ #3 + #4 + #7
3. 15 分钟内跟 Lyra 说一句话,让她放一首合适的歌?→ #1(+ #5 或 API key)
4. 一周后收到一封 Lyra 写给他的信?→ #2

任何一步答"不能",营销文案就是空转。**这四件事定义了 Lyra v0.1.0 的最小可发布版本**。
