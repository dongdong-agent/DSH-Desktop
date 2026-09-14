# codebuddy-mcp

把腾讯 **CodeBuddy CN CLI** 包装成 MCP 工具服务器，让 DeepSeek Harness（dsh）的 agent 能把重活外包给 CodeBuddy，从而消费 CodeBuddy 的免费额度 / 订阅额度。

- **零依赖**：只用 Node 内置模块。MCP stdio 传输就是"换行分隔的 JSON-RPC"，无需 `@modelcontextprotocol/sdk`。
- **不搬运 token**：鉴权完全由 `codebuddy` CLI 自己管理（凭据在 `~/.codebuddy/`），本进程不接触、不转发任何密钥。
- **不改 dsh 内核**：通过 dsh 官方自带的 `@deepseek-ai/dsh-mcp-client` 插件挂载。

## 提供的工具

| 工具（模型侧名称） | 用途 |
|---|---|
| `mcp__codebuddy__codebuddy_task` | 无头执行一个编码/调研任务（`codebuddy -p`），返回最终结论 |
| `mcp__codebuddy__codebuddy_status` | 自检：CLI 入口、版本、默认模型、CLI 自报的官方模型清单（不消耗额度） |

`codebuddy_task` 参数：`prompt`（必填）、`cwd`、`model`、`permissionMode`、`maxTurns`、`timeoutMs`。

## 安装

源码在本仓库 `tools/codebuddy-mcp/`，**运行时安装位置**遵循本机其它 MCP server 的既有约定（`%USERPROFILE%\.<name>-mcp\server\`），避免依赖仓库所在盘符：

```powershell
$dst = "$env:USERPROFILE\.codebuddy-mcp\server"
New-Item -ItemType Directory -Force -Path $dst | Out-Null
Copy-Item .\tools\codebuddy-mcp\server.mjs,.\tools\codebuddy-mcp\test-client.mjs $dst -Force
```

改动本仓库源码后需要重新执行上面的复制才能生效。

## 前置条件

```powershell
npm i -g @tencent-ai/codebuddy-code   # 已装则跳过
codebuddy                             # 首次运行完成登录（浏览器授权）
codebuddy -p "只回复两个字：可用"       # 确认无头模式可用
```

## 自测

```powershell
cd "$env:USERPROFILE\.codebuddy-mcp\server"
node test-client.mjs                # 只测协议层 + status，不消耗额度
node test-client.mjs --with-task    # 额外跑一次真实 codebuddy_task
node test-client.mjs --with-task --model hy3   # 用免费模型跑
```

`test-client.mjs` 会以子进程方式启动 `server.mjs`，按 MCP 协议走
`initialize → notifications/initialized → tools/list → tools/call` 并逐项断言。

## 接入 dsh

写入 **profile 级** patch（不要写 `~/.dsh/cordis.patch.yml`——那是 dsh-skin 自动托管文件，会被覆盖）：

`~/.dsh/profiles/web/cordis.patch.yml`

```yaml
- insert:
    - id: mcp-codebuddy
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: codebuddy
        transport: stdio
        command: node
        args:
          - 'C:\Users\<你>\.codebuddy-mcp\server\server.mjs'
        cwd: 'C:\Users\<你>\.codebuddy-mcp\server'
        env:
          CODEBUDDY_MCP_DEFAULT_MODEL: deepseek-v4.1-flash
          CODEBUDDY_MCP_DEFAULT_PERMISSION: acceptEdits
        toolCallTimeoutMs: 1800000
        failOnStartupError: false
```

**改完必须重启 dsh 引擎**：本 profile 未启用 `patchReload: live`，patch 只在启动时应用一次。

静态校验（不启动引擎、不影响正在运行的实例）：

```powershell
node "$env:LOCALAPPDATA\pnpm\global\5\.pnpm\@deepseek-ai+dsh@<版本>\node_modules\@deepseek-ai\dsh\lib\bin.js" `
  --profile web --dump-config | Select-String -Context 0,14 'id: mcp-codebuddy'
```

重启后模型侧应出现 `mcp__codebuddy__codebuddy_task` / `mcp__codebuddy__codebuddy_status`。

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `CODEBUDDY_MCP_BIN` | 自动探测 | 自定义 `codebuddy` 入口（`.js` 用 node 跑，其它当裸命令） |
| `CODEBUDDY_MCP_DEFAULT_MODEL` | `deepseek-v4.1-flash` | 默认模型 |
| `CODEBUDDY_MCP_DEFAULT_PERMISSION` | `acceptEdits` | 默认权限模式 |
| `CODEBUDDY_MCP_TIMEOUT_MS` | `1800000`（30 分钟） | 默认任务超时 |
| `CODEBUDDY_MCP_MAX_OUTPUT_CHARS` | `40000` | 回传给模型的输出上限（超出保留首尾） |

## 三个必须知道的坑

1. **`toolCallTimeoutMs` 必须调大**。`dsh-mcp-client` 默认只有 **60 秒**，而 CodeBuddy agent 任务实测常跑数分钟——沿用默认必然超时失败。上面配置成 30 分钟。
2. **必须显式传 `--model`**。否则会沿用 `~/.codebuddy/settings.json` 里可能配置的第三方 provider（例如指向 AMD 端点），**静默烧用户自己的 key 而不是 CodeBuddy 额度**。本 server 始终显式传 `--model`，默认 `deepseek-v4.1-flash`。
3. **环境清洗**。`dsh-mcp-client` 的 stdio 子进程会删掉匹配 `/KEY|PASSWORD|SECRET|TOKEN/i` 的环境变量与所有 `DSH_*`。本方案不依赖任何密钥类环境变量（CodeBuddy 从 `~/.codebuddy/` 文件读凭据），所以清洗无影响——已实测验证。

## 模型与额度

`codebuddy_status` 会列出 CLI 自报的官方模型。截至 codebuddy `2.143.0`，CLI 缓存目录中标注的 credits：

| 模型 | credits | 备注 |
|---|---|---|
| `hy3` | **0.00** | 免费 |
| `deepseek-v4.1-flash` | 0.03 | 1M 上下文、原生多模态（本 server 默认值） |
| `glm-5.3-flash` | 0.06 | |
| `deepseek-v4-flash` | 0.17 | |
| `deepseek-v4-pro` | 0.51 | |
| `glm-5.3` / `glm-5.2` | 0.79 | |
| `kimi-k3-1` | 1.62 | |

在 `codebuddy_task` 调用里传 `model: "hy3"` 即可走免费模型。

## 权限模式

| 模式 | 行为 |
|---|---|
| `acceptEdits`（默认） | 自动放行文件编辑，Bash 等仍受管控 |
| `bypassPermissions` | 全放行（HIGH/CRITICAL 仍会问）——需要 CodeBuddy 执行命令时使用 |
| `default` / `plan` / `dontAsk` / `auto` | 透传给 CodeBuddy |

若返回里出现 `⚠ 被权限拒绝的操作`，说明任务需要更高权限，改用 `permissionMode: "bypassPermissions"` 重试。
