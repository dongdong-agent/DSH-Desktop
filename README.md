# DeepSeek Harness Desktop

> **DSH Desktop** — A native desktop client for [DeepSeek Harness](https://www.deepseek.com/harness/), built with Tauri 2 + React 19. It embeds the official DeepSeek Harness WebUI and manages the local engine for you.

<p align="center">
  <img alt="Platform: Windows" src="https://img.shields.io/badge/platform-Windows%20x64-0078D6?logo=windows&logoColor=white"/>
  <img alt="Version" src="https://img.shields.io/badge/version-0.1.0-purple"/>
  <img alt="Built with Tauri" src="https://img.shields.io/badge/Tauri-2.0-24C8D8?logo=tauri&logoColor=white"/>
  <img alt="React 19" src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white"/>
  <img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-green"/>
</p>

**Read this in other languages:** [简体中文](README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md)

---

## ✨ What is it?

DeepSeek Harness Desktop is a **thin native shell** around the official DeepSeek Harness WebUI. Instead of reinventing the UI, it embeds the official web interface in an `iframe` and adds what a desktop app should have:

- **One-click engine startup** — detects your local environment (`node` + `dsh`), picks a free port, and spawns the engine with the right profile.
- **Reuse existing instances** — if a DeepSeek Harness web instance is already running on your machine, the app connects to it directly instead of starting a duplicate (no more fighting over `~/.dsh` session storage).
- **Environment self-check + one-click install** — missing Node.js or the `dsh` engine? The launcher tells you exactly what's missing and can install it for you.
- **Frameless window** — custom title bar (drag / minimize / maximize / close) and a status bar showing engine state, port, and session count.
- **Local persistence** — all sessions live on disk under `~/.dsh/sessions/`, so closing the app never loses your work.

Everything else — sessions, trajectories, plugins, agent presets, settings — is the **official DeepSeek Harness WebUI** at its full fidelity, since the app simply hosts it.

## 🚀 Quick start

1. **Download** the latest installer from [Releases](https://github.com/dongdong-agent/DSH-Desktop/releases) (`DSH Desktop_0.1.0_x64-setup.exe`, Windows x64), or copy the portable `dsh-desktop.exe` anywhere.
2. **Launch** the app. The launcher page shows your environment status (Node.js / npx / dsh engine).
3. Click **启动引擎 (Start Engine)**. The app spawns the engine (`dsh --profile web` on `127.0.0.1:17800` or another free port) and loads the official WebUI automatically.
4. Use it like the web version — sessions, plugins, trajectories, everything is there.

> First run: if Node.js or `dsh` is missing, use the **one-click install** buttons on the launcher page.

## 🖥 Platform support

| Platform | Status | How to use |
|---|---|---|
| **Windows x64** | ✅ **Officially supported** | Download from [Releases](https://github.com/dongdong-agent/DSH-Desktop/releases) or run the portable exe |
| **macOS (Apple Silicon / Intel)** | 🚧 Build from source | See below |
| **Linux (x64)** | 🚧 Build from source | See below |

**Windows is the primary platform** — installers and CI builds target it first. macOS and Linux builds work with Tauri 2 but are not yet shipped as prebuilt artifacts; build them from source:

```bash
# Prerequisites (any platform)
# - Node.js ≥ 18 (https://nodejs.org) — provides node + npx
# - Rust stable toolchain (https://rustup.rs)
# - Platform system deps for Tauri:
#   macOS:  Xcode Command Line Tools
#   Linux:  sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
#           libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev

# Clone and build
git clone https://github.com/dongdong-agent/DSH-Desktop.git
cd DSH-Desktop
npm install
npm run tauri build     # produces .app (macOS) / .deb/.AppImage (Linux) in src-tauri/target/release/bundle/
```

**Cross-platform notes**:

- The app shell (Tauri 2) is fully cross-platform. The engine is the official `@deepseek-ai/dsh` npm package, which runs on all three platforms via Node.js.
- On macOS/Linux the engine is spawned through the `node` + `npx` fallback chain (the Windows-specific `dsh.cmd` / local `bin.js` paths are probed at runtime and skipped when absent).
- Engine sessions live in `~/.dsh/` on every platform — your sessions, profiles and credentials are portable across OSes.
- Want prebuilt macOS/Linux artifacts? Open an [issue](https://github.com/dongdong-agent/DSH-Desktop/issues) — the CI workflow can be extended to publish them.

## 🏗 Architecture

```
┌────────────────────────────────────────────────────┐
│  TitleBar  (custom frameless title bar + status dot)│
├────────────────────────────────────────────────────┤
│  iframe (full-screen) → official DeepSeek Harness  │
│  WebUI — sessions / trajectories / plugins /        │
│  settings, all official functionality              │
├────────────────────────────────────────────────────┤
│  StatusBar (engine state · port · session count)    │
└────────────────────────────────────────────────────┘
```

- **Frontend**: React 19 + TypeScript + Vite 6 + Tailwind CSS 4 + Zustand
- **Desktop shell**: Tauri 2 (Rust), frameless window with custom title bar
- **Engine lifecycle** (`src/lib/dshEngine.ts`): scan for existing instances → pick a free port → spawn (`node` + local `bin.js`, with `npx` / `dsh` / `dsh.cmd` fallbacks) → health-check → stop
- **Networking**: HTTP RPC (`POST /api/<method>`) + WebSocket event streams via `@tauri-apps/plugin-http` (avoids WebView2 CORS entirely)
- **Diagnostics**: spawn attempts and failures are logged to `%TEMP%\dsh-spawn.log`

## 🧰 Tech stack

| Layer | Choice |
|---|---|
| Desktop shell | Tauri 2 (Rust), frameless + custom title bar |
| Frontend | React 19 + TypeScript + Vite 6 |
| Styling | Tailwind CSS 4 |
| State | Zustand 5 (engine / session / chat / ui stores) |
| Embedded UI | Official DeepSeek Harness WebUI via iframe |

## 🛠 Development

```bash
npm install
npm run tauri dev          # dev mode (Vite on port 1422)
```

## 📦 Build

```bash
npm run build              # tsc + vite build
npm run tauri build        # production bundle (NSIS installer + portable exe)
```

Output: `src-tauri/target/release/bundle/nsis/DSH Desktop_0.1.0_x64-setup.exe`

## 📁 Project layout

```
src/
├── App.tsx                 # shell layout: TitleBar + iframe(official UI) + StatusBar
├── lib/
│   ├── dshEngine.ts        # ★ engine lifecycle: findExistingInstance / startEngine / stopEngine
│   │                       #   + candidateCommands (spawn fallback chain) + probePort + diag log
│   └── api.ts              # HTTP RPC + WS event streams (plugin-http fetch)
├── stores/                 # zustand stores (engine / ui / session / chat)
└── components/
    ├── TitleBar.tsx        # custom title bar (drag / minimize / maximize / close)
    ├── StatusBar.tsx       # engine state · port · session count
    └── EngineLauncher.tsx  # launcher: environment check + one-click install + start
src-tauri/
├── capabilities/default.json  # ★ permissions (shell spawn scope, window controls)
├── tauri.conf.json            # window / bundle config
└── src/lib.rs                 # plugin registration (shell / fs / dialog / http)
```

## 🔍 Troubleshooting

- **Title bar buttons or dragging don't work** — `core:window:*` permissions (`allow-minimize` / `allow-toggle-maximize` / `allow-close` / `allow-start-dragging`) must be present in `src-tauri/capabilities/default.json`. Capabilities are compiled into the binary, so rebuild after editing.
- **Engine fails to spawn** — check `%TEMP%\dsh-spawn.log`. Common causes: missing `shell:allow-spawn`, missing program scope entries, or scope entries without the `cmd` field (non-sidecar entries require `cmd`). See the log for the exact error.
- **WebUI blank** — the app uses `@tauri-apps/plugin-http` for all requests because WebView2 blocks cross-origin fetch (CORS). Don't replace it with native `fetch`.

## 📄 License

[MIT](LICENSE) © 2026 dongdong-agent
