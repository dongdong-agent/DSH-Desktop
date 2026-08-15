# DeepSeek Harness Desktop

> **DSH Desktop** —— 为 [DeepSeek Harness](https://www.deepseek.com/harness/) 打造的原生桌面客户端，基于 Tauri 2 + React 19。内嵌官方 DeepSeek Harness WebUI，并替你管理本地引擎。

<p align="center">
  <img alt="平台: Windows" src="https://img.shields.io/badge/platform-Windows%20x64-0078D6?logo=windows&logoColor=white"/>
  <img alt="版本" src="https://img.shields.io/badge/version-0.1.0-purple"/>
  <img alt="Tauri" src="https://img.shields.io/badge/Tauri-2.0-24C8D8?logo=tauri&logoColor=white"/>
  <img alt="React 19" src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white"/>
  <img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-green"/>
</p>

**其他语言版本：** [English](README.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md)

---

## ✨ 这是什么？

DeepSeek Harness Desktop 是一个**围绕官方 DeepSeek Harness WebUI 的轻量原生壳**。它不重新发明轮子，而是用 `iframe` 内嵌官方 Web 界面，再补齐桌面应用该有的能力：

- **一键启动引擎** —— 自动检测本机环境（`node` + `dsh`）、挑选空闲端口、以正确 profile 启动引擎。
- **复用已有实例** —— 本机已有 dsh web 实例在跑时直接连接，绝不双开（不再争抢 `~/.dsh` 会话存储）。
- **环境自检 + 一键安装** —— 缺 Node.js 或缺 `dsh` 引擎？启动页会明确指出缺什么，并可一键安装。
- **无边框窗口** —— 自定义标题栏（拖动 / 最小化 / 最大化 / 关闭）+ 状态栏（引擎状态 · 端口 · 会话数）。
- **本地持久化** —— 会话数据全部落盘在 `~/.dsh/sessions/`，关掉应用不丢任何工作。

其余的——会话、轨迹、插件、Agent 预设、设置——都是**官方 DeepSeek Harness WebUI** 的原生功能，由应用完整托管，零功能阉割。

## 🚀 快速开始

1. 从 [Releases](https://github.com/dongdong-agent/DSH-Desktop/releases) 下载最新安装包（`DSH Desktop_0.1.0_x64-setup.exe`，Windows x64），或直接复制绿色版 `dsh-desktop.exe` 到任意位置。
2. **启动应用**。启动页会显示环境检测结果（Node.js / npx / dsh 引擎）。
3. 点击 **启动引擎**。应用会自动 spawn 引擎（`dsh --profile web`，监听 `127.0.0.1:17800` 或其他空闲端口）并自动加载官方 WebUI。
4. 像网页版一样使用——会话、插件、轨迹，应有尽有。

> 首次使用：若 Node.js 或 `dsh` 缺失，用启动页上的**一键安装**按钮即可。

---

## 📦 发布版本说明（三版对比）

仓库发布三种版本，按需选择：

| 版本 | 是什么 | 大小 | 需要 Node.js | 默认对话语言 |
|---|---|---|---|---|
| **v0.1.0** | **Tauri 桌面壳**——原生 GUI（标题栏/状态栏/缩放），内嵌官方 WebUI | 2.5 MB | ✅ 需要（引擎运行时拉取） | 跟随引擎 |
| **v0.1.0-chinese** | **中文全量便携版**——内置 Node.js + dsh + 中文 persona（简体中文思考/对话） | 52 MB | ❌ 不需要 | 🇨🇳 **中文** |
| **v0.1.0-chinese-lite** | **中文简版**——dsh + 中文 persona，用系统 Node.js | 31 MB | ✅ 需要 | 🇨🇳 **中文** |
| **v0.1.0-full-english** | **英文全量便携版**——内置 Node.js + dsh（官方原版，未修改） | 52 MB | ❌ 不需要 | 🇬🇧 英文 |

**怎么选？**
- **学员没装 Node.js** → `v0.1.0-chinese`（`DSH-Desktop-Chinese-Setup-v0.1.0.exe`）或 `v0.1.0-full-english`（`DSH-Desktop-Full-English-v0.1.0.exe`）——零依赖，双击即用
- **想要中文对话、已装 Node.js** → `v0.1.0-chinese-lite`（31 MB，最小中文包）
- **想要中文对话、没装 Node.js** → `v0.1.0-chinese`
- **已有 Node 环境 / 想要原生 GUI 壳** → `v0.1.0`（2.5 MB）

> 三个版本共用同一引擎（`@deepseek-ai/dsh@0.1.0-rc.6`），数据都在 `~/.dsh/`，互不影响。

---

## 🖥 平台支持

| 平台 | 状态 | 使用方法 |
|---|---|---|
| **Windows x64** | ✅ **官方支持** | 从 [Releases](https://github.com/dongdong-agent/DSH-Desktop/releases) 下载安装包，或直接运行便携版 exe |
| **macOS（Apple Silicon / Intel）** | 🚧 源码构建 | 见下文 |
| **Linux（x64）** | 🚧 源码构建 | 见下文 |

**Windows 是主支持平台**——安装包和 CI 构建优先产出 Windows 版本。macOS 和 Linux 在 Tauri 2 下可以构建运行，但目前还未发布预编译产物，需从源码构建：

```bash
# 前置要求（全平台通用）
# - Node.js ≥ 18（https://nodejs.org）— 提供 node 和 npx
# - Rust 稳定版工具链（https://rustup.rs）
# - Tauri 平台系统依赖：
#   macOS：  Xcode Command Line Tools
#   Linux：  sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
#            libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev

# 克隆并构建
git clone https://github.com/dongdong-agent/DSH-Desktop.git
cd DSH-Desktop
npm install
npm run tauri build     # 产出 .app（macOS）/ .deb、.AppImage（Linux）到 src-tauri/target/release/bundle/
```

**跨平台说明**：

- 桌面壳（Tauri 2）完全跨平台；引擎是官方 `@deepseek-ai/dsh` npm 包，三平台都能通过 Node.js 运行。
- macOS/Linux 上引擎通过 `node` + `npx` 兜底链启动（Windows 专属的 `dsh.cmd` / 本地 `bin.js` 路径会在运行时探测，缺失则自动跳过）。
- 引擎会话数据存于 `~/.dsh/`——三个平台的会话、配置、凭据互通。
- 需要 macOS/Linux 预编译产物？在 [Issues](https://github.com/dongdong-agent/DSH-Desktop/issues) 提需求——CI 工作流可扩展发布它们。

## 🏗 架构

```
┌────────────────────────────────────────────────────┐
│  TitleBar（自定义无边框标题栏 + 引擎状态点）          │
├────────────────────────────────────────────────────┤
│  iframe 全屏 → 官方 DeepSeek Harness WebUI          │
│  会话 / 轨迹 / 插件 / 设置，全部官方功能              │
├────────────────────────────────────────────────────┤
│  StatusBar（引擎状态 · 端口 · 会话数）               │
└────────────────────────────────────────────────────┘
```

- **前端**：React 19 + TypeScript + Vite 6 + Tailwind CSS 4 + Zustand
- **桌面壳**：Tauri 2（Rust），无边框窗口 + 自定义标题栏
- **引擎生命周期**（`src/lib/dshEngine.ts`）：扫描已有实例 → 挑选空闲端口 → spawn（`node` + 本机 `bin.js`，备选 `npx` / `dsh` / `dsh.cmd`）→ 健康检查 → 停止
- **网络**：HTTP RPC（`POST /api/<method>`）+ WebSocket 事件流，走 `@tauri-apps/plugin-http`（彻底绕开 WebView2 的 CORS）
- **诊断**：spawn 过程与失败原因写入 `%TEMP%\dsh-spawn.log`

## 🧰 技术栈

| 层 | 选型 |
|---|---|
| 桌面壳 | Tauri 2（Rust），无边框 + 自定义标题栏 |
| 前端 | React 19 + TypeScript + Vite 6 |
| 样式 | Tailwind CSS 4 |
| 状态 | Zustand 5（engine / session / chat / ui 四个 store） |
| 内嵌 UI | 官方 DeepSeek Harness WebUI（iframe） |

## 🛠 开发

```bash
npm install
npm run tauri dev          # 开发模式（Vite 端口 1422）
```

## 📦 构建

```bash
npm run build              # tsc + vite build
npm run tauri build        # 生产打包（NSIS 安装包 + 绿色版 exe）
```

产物：`src-tauri/target/release/bundle/nsis/DSH Desktop_0.1.0_x64-setup.exe`

## 📁 项目结构

```
src/
├── App.tsx                 # 壳布局：TitleBar + iframe(官方UI) + StatusBar
├── lib/
│   ├── dshEngine.ts        # ★ 引擎生命周期：findExistingInstance / startEngine / stopEngine
│   │                       #   + candidateCommands（spawn 候选链）+ probePort + 诊断日志
│   └── api.ts              # HTTP RPC + WS 事件流（plugin-http fetch）
├── stores/                 # zustand stores（engine / ui / session / chat）
└── components/
    ├── TitleBar.tsx        # 自定义标题栏（拖动 / 最小化 / 最大化 / 关闭）
    ├── StatusBar.tsx       # 引擎状态 · 端口 · 会话数
    └── EngineLauncher.tsx  # 启动页：环境检测 + 一键安装 + 启动引擎
src-tauri/
├── capabilities/default.json  # ★ 权限（shell spawn scope、窗口控制）
├── tauri.conf.json            # 窗口 / 打包配置
└── src/lib.rs                 # 插件注册（shell / fs / dialog / http）
```

## 🔍 疑难排查

- **标题栏按钮或拖动无反应** —— 需在 `src-tauri/capabilities/default.json` 配置 `core:window:*` 权限（`allow-minimize` / `allow-toggle-maximize` / `allow-close` / `allow-start-dragging`）。capabilities 编译进二进制，改后必须重新构建。
- **引擎 spawn 失败** —— 查看 `%TEMP%\dsh-spawn.log`。常见原因：缺 `shell:allow-spawn`、scope 程序白名单缺失、scope 条目缺 `cmd` 字段（非 sidecar 条目必填）。日志里是精确错误信息。
- **WebUI 空白** —— 应用所有请求走 `@tauri-apps/plugin-http`（WebView2 会拦截跨源 fetch，即 CORS）。不要把它换成原生 fetch。

## 📄 开源协议

[MIT](LICENSE) © 2026 dongdong-agent
