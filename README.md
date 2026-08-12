# Lyra

**English** · [简体中文](./README.zh-CN.md)

> **Between the things you say. 未成曲调先有情。**

A music agent that sings to you, remembers you, and grows on its own. **Not just another music player.**

Lyra is a desktop music agent built with **Tauri 2** + **React 19** + **TypeScript 5**. It manages a personal music library, maintains emotional state, and uses LLM backends to recommend and generate song selections in real time — adapting to your mood and preferences as you interact with it.

## Repository Layout

```
Lyra-music-player/
├── app/          # Tauri desktop application (React + Rust)
├── website/      # Official website (Vite)
├── docs/         # Product docs, plans, specs, and design notes
│   ├── business-model.md
│   ├── emotional-computing.md
│   ├── feature-gaps.md
│   ├── music-licensing-policy.md
│   ├── promotion-strategy.md
│   └── superpowers/    # plans, specs, tuning notes
├── start.sh      # Convenience launcher — cd app && pnpm tauri dev
└── 需求.md       # Original product requirements (Chinese)
```

The full app-level developer guide lives in [`app/README.md`](./app/README.md).

## Key Features

- **Personal Music Library** — SQLite-backed local storage with metadata and listening history
- **Emotional Agent State** — Tracks mood (PAD model), listening patterns, and aesthetic preferences
- **pi Agent Runtime** — EmotionAgent and CompanionAgent run on the new pi streaming runtime; toggle between the pi path and the legacy path via Settings. Agent runs are persisted to SQLite and visible in the DataExplorer "Agent runtime" tab
- **Multi-LLM Support** — Pluggable model providers (Anthropic, DeepSeek, Zhipu, DouBao, OpenAI, local Ollama)
- **ShanShui Home** — Ink-wash canvas + photographic background layer set the tone of the room
- **Weekly Letter** — Lyra writes you a first-person weekly reflection every Sunday
- **System Integration** — Native keychain via `keyring`; file dialogs and URIs via Tauri plugins

## Tech Stack

### Frontend
- **React 19** + **TypeScript 5**
- **Vite 7** for bundling and dev server
- **Vitest 1.6** + **Testing Library** for unit/component tests
- **@tauri-apps/api** for IPC to the backend

### Backend (Rust)
- **Tauri 2** desktop framework
- **SQLite** via `tauri-plugin-sql` for persistent storage
- **rodio** for audio playback (symphonia backend)
- **keyring** for secure credential storage (Apple native)

### Tooling
- **pnpm 10.27** package manager
- **@tauri-apps/cli** for building and packaging

## Getting Started

### Prerequisites

- **Node.js** 18+ with **pnpm 10.27**
- **Rust 1.70+** (for Tauri backend compilation)
- **Xcode Command Line Tools** (macOS) or platform equivalent

### Quick Start

```bash
# Clone
git clone git@github.com:daoyuly/Lyra-music-player.git
cd Lyra-music-player

# Install app dependencies
cd app && pnpm install && cd ..

# Run the desktop app in dev mode
sh start.sh
# — equivalent to:
#   cd app && pnpm tauri dev
```

### Common Commands (from `app/`)

```bash
pnpm tauri dev       # Run the desktop app with hot reload
pnpm typecheck       # TypeScript check
pnpm test            # Run all tests once
pnpm test:watch      # Vitest watch mode
pnpm build           # Vite production build
pnpm tauri build     # Package a distributable binary
```

## Persistence & Configuration

- **SQLite database** — `~/Library/Application Support/com.daoyu.lyra/lyra.db`
- **Keychain** — API keys and secrets stored via the macOS native keychain (`keyring` crate)
- **Bundle ID** — `com.daoyu.lyra`

## Commit Conventions

All commits follow conventional commits with the `lyra` scope:

```
feat(lyra):     new feature
fix(lyra):      bug fix
docs(lyra):     documentation
refactor(lyra): refactor with no behavior change
test(lyra):     tests
chore(lyra):    build, dependencies, tooling
```

## Contributing

1. Branch off `main`: `git checkout -b feat/lyra-my-feature`
2. Make changes with proper commit scope
3. Verify: `pnpm typecheck && pnpm test`
4. Open a pull request

## Documentation

- [App developer guide](./app/README.md) — setup, project structure, IPC, and internals
- [Business model](./docs/business-model.md)
- [Emotional computing](./docs/emotional-computing.md)
- [Feature gaps](./docs/feature-gaps.md)
- [Music licensing policy](./docs/music-licensing-policy.md)
- [Promotion strategy](./docs/promotion-strategy.md)
- [Design specs & plans](./docs/superpowers/)

## License

Proprietary — all rights reserved unless a top-level LICENSE file states otherwise.

## Notes for Maintainers

- **Agent personality**: Lyra is a music *agent* — not a player, not a recommender tool, but a conversational entity that learns and grows through dialogue. Design decisions reflect this agency model.
- **Rust crate names**: `Cargo.toml` uses `name = "app"` and `lib.name = "lyra_lib"` pending a future rename sweep. Product/project name is consistently "Lyra".
