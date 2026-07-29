# Lyra 用户手册

> Between the things you say. 未成曲调先有情。

Lyra 不是普通的音乐播放器。它是一个**会读你、记你、陪你成长的音乐 agent**。

---

## 快速开始

### 首次启动

打开 Lyra 后，会有一个简洁的主界面。第一次使用需要配置：

1. 按 `Cmd+,`（或点右上齿轮）打开设置。
2. Music library folder：填入你的音乐文件夹路径（如 `/Users/you/Music`）。
3. Anthropic / DeepSeek / Zhipu API Key：至少填一个。
4. 点保存。Lyra 会扫描曲库并提取音频特征。

### 开始对话

在主界面输入框里对 Lyra 说话，比如"今天有点累"或"想听点新的"。它不会用文字回复——它会**选一首歌回给你**，并在旁边写一句小注告诉你为什么选这首。

---

## 核心功能

### 情绪驱动的推荐

Lyra 会推导你此刻需要**哪种转变方向**：

| 转变 | 含义 | 什么时候会推 |
|------|------|-------------|
| 接住 | 陪伴、理解、缓解 | 你在下沉、犹豫、离线 |
| 点燃 | 激发、能量、打破沉闷 | 你能量低但跳过率高 |
| 陪着 | 同频共鸣、跟随节奏 | 你状态平稳 |
| 打断 | 打破循环、制造惊喜 | 你陷入某种高焦虑循环 |

它不会盲目哄你——*它会诚实*。

### 十五种感知信号

Lyra 通过窗口事件读懂你的状态：
- 键盘、鼠标活跃度
- 提交次数、字数、间隔
- 跳过率、完整播放率
- 主动推荐被驳回的次数
- 悬停、滚动、犹豫输入
- 窗口失焦、静默在场时间
- 本地天气（Open-Meteo）

### 长期情感档案

Lyra 会记住你 7 天、30 天、1 年的情绪轨迹：
- 愉悦度趋势（improving / declining / stable）
- 兴奋度轨迹
- 波动性
- 平均 PAD

它会用这些信息在长期上陪你，而不只是响应此刻。

### 情绪仪表盘

按 `Cmd+Shift+D` 打开 Data Explorer，切到"情绪仪表盘"：

- PAD 时间序列图，可切换 7d / 30d / 1y
- 趋势指示器与波动性百分比
- 最近推理（Lyra 每次的判断依据）
- Shift 推荐效率（各种转变的成功率）
- 规则触发热图（哪些规则被触发得最多）

### 周报

每周日凌晨 03:14，Lyra 会自动写一封信总结这一周。
- 用 `/week` 命令在应用内查看。
- 也可以在设置里配置自动打开。

---

## 键盘快捷键

| 快捷键 | 功能 |
|--------|------|
| `Cmd+,` | 打开设置 |
| `Cmd+Shift+D` | 打开 Data Explorer |
| `Cmd+Shift+R` | 立即触发反思（Reflect Now）|
| `Cmd+Shift+P` | 打开 Roadmap |
| `Escape` | 关闭 Modal |
| `Enter`（输入框）| 提交消息 |
| `/help` | 查看斜杠命令 |
| `/week` | 打开本周周报 |

---

## 隐私

> Lyra 的核心承诺：你的行为数据只属于你。

- 所有感知数据在本地 SQLite 中。
- 四种广谱信号（scroll、hover、hesitation、quiet-presence）经过**粗化**（low / medium / high）后才发送给 LLM，原始数值永不离开本地。
- 音频特征（bpm、energy、valence）本地提取，只用于本地推荐排序。
- 曲库、听歌历史、情绪快照全部本地存储。
- LLM 请求会发送对话上下文和情绪状态到你配置的 provider。

坐标（用于天气）存储在 macOS Keychain，不写入 SQLite。

---

## 常见问题

### 没有 API Key 怎么办？

Lyra 需要一个 LLM provider 来选歌。免费选择：
- Zhipu GLM-4-Flash（bigmodel.cn，注册送额度）
- DeepSeek V3（deepseek.com）

### 推荐感觉不准？

前几十次推荐 Lyra 还在读懂你。它会通过：
- 你的 skip / complete 反馈学习哪种 shift 对你有效
- 感知规则不断累积
- 每周反思更新你的画像

建议至少用一周，让它有机会调整。

### PAD 是什么意思？

PAD 即 Pleasure（愉悦度）、Arousal（兴奋度）、Dominance（支配感），是心理学中描述情绪状态的三维模型。

Lyra 用它作为情绪的量化表达，取值都在 [-1, 1] 之间。

### 如何查看 Lyra 在"想什么"？

打开 Data Explorer（`Cmd+Shift+D`）：
- 推理轨迹：每个 agent 的 LLM 请求 / 响应完整记录
- 感知审计：每 60 秒一次的行为快照与推理原因
- 情绪仪表盘：整体状态可视化
- 对话回合：完整对话历史与情绪转变

---

## 反馈

- GitHub Issues：[欢迎报告问题](https://github.com/daoyuly/lyra/issues)
- Roadmap：应用内按 `Cmd+Shift+P` 查看

---

*用歌回话的朋友*
