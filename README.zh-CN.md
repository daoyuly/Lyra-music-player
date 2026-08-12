# Lyra

[English](./README.md) · **简体中文**

> **Between the things you say. 未成曲调先有情。**

一个会为你歌唱、记得你、自我成长的音乐 agent。**不只是一个音乐播放器。**

Lyra 是一款桌面音乐 agent，基于 **Tauri 2** + **React 19** + **TypeScript 5** 构建。它管理你的本地音乐库、维护情绪状态，并通过 LLM 后端实时推荐与编排歌曲——随着你与它的互动，逐步理解你的心境与审美。

## 仓库结构

```
Lyra-music-player/
├── app/          # Tauri 桌面应用（React + Rust）
├── website/      # 官方网站（Vite）
├── docs/         # 产品文档、计划、规格与设计笔记
│   ├── business-model.md
│   ├── emotional-computing.md
│   ├── feature-gaps.md
│   ├── music-licensing-policy.md
│   ├── promotion-strategy.md
│   └── superpowers/    # plans / specs / tuning notes
├── start.sh      # 便捷启动脚本 — cd app && pnpm tauri dev
└── 需求.md       # 原始产品需求（中文）
```

应用层的开发者指南见 [`app/README.md`](./app/README.md)。

## 核心特性

- **本地音乐库** — 基于 SQLite 存储元数据与收听历史
- **情感 agent 状态** — 用 PAD 模型追踪心境、收听模式与审美偏好
- **多 LLM 支持** — 可插拔的模型 provider（Anthropic、DeepSeek、智谱、豆包、OpenAI、本地 Ollama）
- **山水首页** — 水墨 Canvas 叠加摄影背景，营造房间的整体气质
- **每周信件** — 每个星期天，Lyra 以第一人称给你写一封本周回顾
- **系统集成** — 通过 `keyring` 访问系统钥匙串，通过 Tauri 插件处理文件对话框与 URI

## 技术栈

### 前端
- **React 19** + **TypeScript 5**
- **Vite 7** 打包与开发服务器
- **Vitest 1.6** + **Testing Library** 单元与组件测试
- **@tauri-apps/api** 与后端 IPC 通信

### 后端（Rust）
- **Tauri 2** 桌面框架
- **SQLite**（通过 `tauri-plugin-sql`）持久化存储
- **rodio**（symphonia 后端）音频播放
- **keyring** 安全存储凭据（macOS 原生）

### 工具链
- **pnpm 10.27** 包管理器
- **@tauri-apps/cli** 构建与打包

## 快速开始

### 环境要求

- **Node.js** 18+，配合 **pnpm 10.27**
- **Rust 1.70+**（Tauri 后端编译）
- **Xcode 命令行工具**（macOS）或对应平台的构建工具

### 快速运行

```bash
# 克隆
git clone git@github.com:daoyuly/Lyra-music-player.git
cd Lyra-music-player

# 安装应用依赖
cd app && pnpm install && cd ..

# 启动桌面应用（开发模式）
sh start.sh
# — 等价于：
#   cd app && pnpm tauri dev
```

### 常用命令（在 `app/` 目录下执行）

```bash
pnpm tauri dev       # 热重载启动桌面应用
pnpm typecheck       # TypeScript 类型检查
pnpm test            # 一次性运行全部测试
pnpm test:watch      # Vitest 监听模式
pnpm build           # Vite 生产构建
pnpm tauri build     # 打包可分发的二进制
```

## 持久化与配置

- **SQLite 数据库** — `~/Library/Application Support/com.daoyu.lyra/lyra.db`
- **钥匙串** — API key 与机密通过 macOS 原生钥匙串存储（`keyring` crate）
- **Bundle ID** — `com.daoyu.lyra`

## 提交规范

所有提交使用 conventional commits 风格，scope 固定为 `lyra`：

```
feat(lyra):     新功能
fix(lyra):      bug 修复
docs(lyra):     文档
refactor(lyra): 无行为变化的重构
test(lyra):     测试
chore(lyra):    构建、依赖、工具
```

## 安装包
- 右键 -> 打开
- xattr Lyra.app` 去掉 Gatekeeper 隔离。


## 贡献

1. 从 `main` 拉出分支：`git checkout -b feat/lyra-my-feature`
2. 按规范提交
3. 验证：`pnpm typecheck && pnpm test`
4. 提交 PR

## 文档

- [应用开发者指南](./app/README.md) — 环境、结构、IPC 与内部细节
- [商业模式](./docs/business-model.md)
- [情感计算](./docs/emotional-computing.md)
- [功能缺口](./docs/feature-gaps.md)
- [音乐授权策略](./docs/music-licensing-policy.md)
- [推广策略](./docs/promotion-strategy.md)
- [设计规格与计划](./docs/superpowers/)

## 许可

专有 — 除非仓库根目录存在 LICENSE 文件另作说明，否则保留一切权利。

## 维护者备忘

- **Agent 定位**：Lyra 是一个音乐 *agent* — 不是播放器，也不是推荐工具，而是一个会通过对话学习与成长的对话实体。设计决策围绕这一 agency 模型展开。
- **Rust crate 名称**：`Cargo.toml` 目前仍使用 `name = "app"` 与 `lib.name = "lyra_lib"`，将在后续统一重命名扫荡中调整。产品/项目名统一为 "Lyra"。
