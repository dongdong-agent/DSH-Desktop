# DeepSeek Harness Desktop (dsh-desktop)

高性能桌面 GUI —— 用 OneWork 同款架构（Tauri 2 + React 19 + TS + Vite 6 + Tailwind 4 + Zustand）为 [DeepSeek Harness](https://www.deepseek.com/harness/) 打造的原生桌面客户端。

## 核心特性

- **引擎复用，绝不双开**：启动时扫描已有 dsh web 实例（网页版正在跑则直接复用），避免双实例争抢 `~/.dsh` 会话存储
- **原生协议对接**：HTTP `POST /api/<method>` RPC（`client-request` 信封）+ WebSocket `/api/events.mux`、`/api/events.host` 事件流（自动重连）
- **四模式切换**：standard（标准）/ code（PTC）/ minimal（极简）/ cordis（创造）
- **Trajectory 轨迹视图**：按来源查看系统提示词、思维链、工具调用、子代理调度
- **性能优化**：manualChunks 分包（react-vendor / markdown-render / icons 独立 chunk）、RPC 超时控制、事件流断线重连

## 技术栈（对齐 OneWork）

| 层 | 选型 |
|---|---|
| 桌面壳 | Tauri 2（Rust），无边框窗口 + 自定义标题栏 |
| 前端 | React 19 + TypeScript 5.6 + Vite 6 |
| 样式 | Tailwind CSS 4 |
| 状态 | Zustand 5（engine / session / chat / ui 四个 store） |
| 渲染 | react-markdown + remark-gfm + rehype-highlight |

## 目录结构

```
src/
  App.tsx              应用壳（标题栏 + 侧栏 + 会话列 + 主区 + 状态栏）
  lib/
    api.ts             HTTP RPC 客户端 + WebSocket 事件流（协议契约层）
    dshEngine.ts       引擎生命周期：扫描复用 / spawn / 健康检查 / 停止
    types.ts           协议类型（对齐 dsh-host-apiproxy 真实结构）
  stores/
    engineStore.ts     引擎状态
    sessionStore.ts    会话列表 / 活动会话 / 模式
    chatStore.ts       消息流 / 轨迹事件 / 草稿
    uiStore.ts         视图与布局
  components/
    TitleBar.tsx       无边框标题栏（最小化/最大化/关闭）
    Sidebar.tsx        图标导航（对话 / 模式 / 设置）
    SessionList.tsx    会话列表（新建/重命名/运行状态）
    ChatPanel.tsx      聊天主区（发送/取消/分叉/轨迹切换）
    MessageBubble.tsx  消息气泡（markdown + 工具调用卡片）
    TrajectoryView.tsx 轨迹视图
    SettingsPanel.tsx  常规 / 模式 / 引擎
    EngineLauncher.tsx 引擎启动页
    StatusBar.tsx      状态栏
```

## 开发

```bash
npm install
npm run tauri dev        # 开发模式（vite 1422 端口，避让 OneWork 的 1420）
```

## 构建

```bash
npm run build            # tsc + vite build
cd src-tauri && cargo check
npm run tauri build      # 生产打包（nsis/msi）
```

> 注：crates.io 走 rsproxy.cn 镜像（`~/.cargo/config.toml`），因本机 Clash 代理锁定系统代理导致 cargo 直连失败。

## 引擎对接说明

- 引擎 = `dsh --profile web`（`dsh` 全局 CLI，`~/.dsh/profiles/web` 已配置 opencode-go + deepseek-v4-flash）
- RPC 信封：`{rpcId, type:"client-request", method:"session.list", payload:{...}}`
- 响应：`{type:"server-response", rpcId, result:{ok:true, value} | {ok:false, error}}`
- 会话摘要字段：`sessionId` / `agentPreset` / `running` / `projections.values.title` / `projections.values.sessionStats`
- `session.prompt` 契约：`{sessionId, mode:"queue", content:[{type:"text", text}]}`
# DSH-Desktop
DeepSeek Harness Desktop-开发者预览版的桌面版