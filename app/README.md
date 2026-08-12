# Lyra

> **Between the things you say. 未成曲调先有情。**

A music agent that sings to you, remembers you, and grows on its own. **Not yet another music player.**

Design docs and decisions are in `../docs/superpowers/specs/`.

## Overview

Lyra is a desktop music agent built with **Tauri 2** + **React 19** + **TypeScript 5**. It manages a personal music library, maintains emotional state, and uses LLM backends to recommend and generate song selections in real time—adapting to your mood and preferences as you interact with it.

### Key Features

- **Personal Music Library**: SQLite-backed local storage with metadata and listening history
- **Emotional Agent State**: Tracks mood (PAD model), listening patterns, and aesthetic preferences
- **Multi-LLM Support**: Pluggable model providers (Anthropic, DeepSeek, Zhipu, DouBao, OpenAI, local Ollama)
- **Responsive UI**: React components with Vite hot-reload and Testing Library coverage
- **System Integration**: Native keychain via `keyring` crate; file dialogs and URIs via Tauri plugins

## Tech Stack

### Frontend
- **React 19** + **TypeScript 5** for UI
- **Vite 7** for bundling and dev server
- **Vitest 1.6** + **Testing Library** for unit/component tests
- **@tauri-apps/api** for IPC to the backend

### Backend (Rust)
- **Tauri 2** desktop framework
- **SQLite** via `tauri-plugin-sql` for persistent storage
- **rodio** for audio playback (symphonia backend)
- **keyring** for secure credential storage (Apple native)
- **serde** + **serde_json** for serialization

### Build & Development
- **pnpm 10.27** package manager
- **@tauri-apps/cli** for building and packaging
- **tsconfig.json** with strict type checking enabled

## Getting Started

### Prerequisites

- **Node.js** 18+ (we use pnpm 10.27)
- **Rust 1.70+** (for Tauri backend compilation)
- **Xcode Command Line Tools** (macOS) or equivalent build tools

## 本地无 API key 使用（Ollama）

如果你安装了 [Ollama](https://ollama.com)，不需要任何云服务 API key 也能使用 Lyra。

1. 安装并启动 Ollama，拉取一个模型（例如 `ollama pull qwen2.5`）。
2. 打开 Lyra → Settings，勾选 **Ollama（本地，无需 API key）**。
3. Endpoint 默认 `http://localhost:11434`，Model 默认 `qwen2.5:latest`，按需修改后点 Save 即生效。
4. 关闭 Ollama 时 Lyra 会捕获网络错误并给出明确提示，不会崩溃。

### Installation

1. Clone and navigate to the app directory:
   ```bash
   cd /Users/daoyu/Documents/my-github/Lyra-music-player/app
   ```

2. Install dependencies:
   ```bash
   pnpm install
   ```

3. Verify TypeScript and build setup:
   ```bash
   pnpm typecheck
   ```

### Development

#### Running in Dev Mode
```bash
pnpm tauri dev
```
This starts both the Vite dev server (hot reload) and the Tauri backend.

#### TypeScript Checking
```bash
pnpm typecheck
```

#### Testing
```bash
pnpm test              # Run all tests once
pnpm test:watch       # Watch mode
pnpm test:ui          # Vitest UI dashboard
```

#### Building for Distribution
```bash
pnpm build            # TypeScript + Vite build
pnpm tauri build      # Package as macOS .app (or platform-specific binary)
```

## Project Structure

```
app/
├── src/                         # TypeScript/React frontend
│   ├── audio/                   # Tauri IPC → rodio audio playback
│   │   ├── player.ts            # playFile / stopPlayback / isPlaying wrappers
│   │   └── player.test.ts
│   ├── db/                      # SQLite client + codec + repository
│   │   ├── client.ts            # Database.load() + getDb() memoization + invalidateDb()
│   │   ├── codec/               # Domain type ↔ SQL row translation
│   │   │   ├── dialogueTurn.ts
│   │   │   ├── soulState.ts
│   │   │   ├── emotionSnapshot.ts
│   │   │   └── libraryTrack.ts
│   │   └── repo/                # CRUD helpers on top of the codec
│   │       ├── turnRepo.ts
│   │       ├── soulRepo.ts
│   │       ├── emotionRepo.ts
│   │       └── libraryRepo.ts
│   ├── providers/               # Model provider abstraction + adapters
│   │   ├── registry.ts          # ProviderRegistry singleton
│   │   ├── anthropic.ts         # AnthropicProvider adapter
│   │   ├── deepseek.ts          # DeepSeekProvider adapter
│   │   └── boot.ts              # bootProviders() reads keychain, registers
│   ├── settings/                # API key modal + secret storage wrapper
│   │   ├── secrets.ts           # SECRET_KEYS + setSecret / getSecret / deleteSecret
│   │   └── Settings.tsx         # Modal for entering keys
│   ├── types/                   # Shared TypeScript interfaces
│   │   ├── dialogue.ts          # DialogueTurn, PAD, CurrentEmotion, ProactiveKind
│   │   ├── soul.ts              # SoulState, MusicalTasteBase, DynamicMood
│   │   ├── song.ts              # LibraryTrack, TrackFeatures
│   │   ├── provider.ts          # ModelProvider interface, ChatMessage, ChatResponse
│   │   └── index.ts             # Barrel export
│   ├── App.tsx                  # Full-screen hero (Lyra + slogans + Settings)
│   ├── App.test.tsx
│   └── main.tsx                 # React entry point
├── src-tauri/                   # Rust backend
│   ├── src/
│   │   ├── main.rs              # Tauri entry point
│   │   ├── lib.rs               # Plugin registration + Tauri command handlers
│   │   ├── audio.rs             # rodio-based playback (Arc<AudioPlayer>)
│   │   └── secrets.rs           # keyring-backed secret CRUD
│   ├── migrations/
│   │   └── 001_initial.sql      # 10-table schema
│   ├── tests/
│   │   ├── audio_test.rs
│   │   ├── secrets_test.rs
│   │   └── fixtures/silence_1s.wav
│   ├── capabilities/default.json
│   ├── Cargo.toml
│   └── tauri.conf.json
├── public/                      # Static assets
├── index.html                   # HTML entry point
├── vite.config.ts               # Vite bundler config
├── vitest.config.ts             # Vitest test runner config
├── tsconfig.json                # TypeScript compiler options
├── package.json                 # Node dependencies & scripts
└── README.md                    # This file
```

## Persistence & Configuration

### SQLite Database
- **Path**: `~/Library/Application Support/com.daoyu.lyra/lyra.db`
- **Schema**: Defined in migration scripts within Rust backend
- **Tables**: Likely includes `songs`, `dialogue_turns`, `soul_state`, listening history, etc.

### Keychain Integration
- Credentials and API keys are stored securely in the system keychain (macOS native)
- Accessed via the `keyring` Rust crate

## Commit Conventions

All commits follow conventional commits with the `lyra` scope:

```
docs(lyra): update README for developer setup
feat(lyra): add new LLM provider adapter
fix(lyra): resolve song selection race condition
refactor(lyra): simplify dialogue turn handling
test(lyra): add unit tests for soul state evolution
```

### Commit Prefix Reference
- `feat(lyra):` — New feature
- `fix(lyra):` — Bug fix
- `docs(lyra):` — Documentation
- `refactor(lyra):` — Code refactoring (no behavior change)
- `test(lyra):` — Tests
- `chore(lyra):` — Build, dependencies, tooling

## Recommended IDE Setup

- **[VS Code](https://code.visualstudio.com/)**
  - [Tauri Extension](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode)
  - [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
  - [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint)

## Contributing

1. Create a feature branch off `main`:
   ```bash
   git checkout -b feat/lyra-my-feature
   ```

2. Make changes, commit with proper scope:
   ```bash
   git add .
   git commit -m "feat(lyra): describe your change"
   ```

3. Run tests and typecheck before pushing:
   ```bash
   pnpm typecheck && pnpm test
   ```

4. Open a pull request with a clear description.

## Troubleshooting

### "Failed to resolve plugin"
- Run `pnpm install` to ensure all Tauri plugins are installed
- Check that `@tauri-apps/cli` matches your Tauri 2.x version

### Type errors in IDE
- Run `pnpm typecheck` to see all errors
- Ensure `node_modules/.bin/tsc` is up to date

### Vite dev server not hot-reloading
- Check that `vite.config.ts` has the correct port and host
- Restart the dev server with `pnpm tauri dev`

## License

Proprietary — see parent project LICENSE if applicable.

## Notes for Maintainers

- **Rust crate names**: The Cargo.toml still uses `name = "app"` and `lib.name = "lyra_lib"` for now (pending a future rename sweep to fully align with the Lyra branding). The README uses "Lyra" consistently for the product/project name.
- **Bundle ID**: `com.daoyu.lyra` (see `src-tauri/tauri.conf.json`)
- **Agent personality**: Lyra is a music agent—not a player, not a recommender tool, but a conversational entity that learns and grows through dialogue. Design decisions reflect this agency model.