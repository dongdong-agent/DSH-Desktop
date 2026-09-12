# dsh-balance 输入框下方显示 DeepSeek 余额

在 DSH WebUI 的**对话输入框下方**(输入卡片下沿那条 dock)追加一行 DeepSeek 官方账户余额。

```
正在打开引擎界面…
┌────────────────────────────────────────────┐
│  (输入框)                                   │
└────────────────────────────────────────────┘
        0 steps | 1.2s | 8.1K | 12.3K        ← 官方 StatsLine(id 'stats', order 0)
        DeepSeek 余额 ¥63.48 · 缓存           ← 本插件(id 'balance', order 100)
```

## 它落在哪

官方 slot `conversation.composer.dock`(`kind: list` / `scope: session`),slot 目录里的定位是
"The band under the composer card, inside the bar's width column — the seat for an ambient
readout about the conversation(the shipped stats line lives here)",`replaceRisk: none`。

因为它是 list,本插件用**自己的 id**(`balance`)追加一格,**不替换官方统计行**。

## 数据从哪来

```
浏览器(dock 组件)  --fetch /api/dsh/balance(同源, credentials: same-origin)-->
  宿主插件路由     --Bearer <DEEPSEEK_API_KEY>-->
    api.deepseek.com/user/balance
```

密钥全程只在宿主进程,客户端只拿到四个数字(总余额/充值/赠送/币种)。

- 宿主侧:同源只读路由 `GET /api/dsh/balance`。
  - 凭证优先走 cordis `credentials` 服务(`~/.dsh/.credentials.yaml`,引擎热监听),
    取不到再回落环境变量 `DEEPSEEK_API_KEY`。
  - 上游 `GET https://api.deepseek.com/user/balance`,8s 超时。
  - 60s 服务端缓存 + 在途请求去重;上游失败时回退最近一次成功值并标 `stale`(最多 30 分钟)。
- 客户端:每 60s(页面可见时)轮询该路由。
  - 首次成功前不占位;`available: false` 显示"余额不可用";低于 5 时用警示色。

## 构建与安装

源码随本仓库一起版本管理(`tools/dsh-balance/`),但**安装到 DSH profile 才算生效**——
profile 通过 `link:` 指回这个目录,所以改完代码只要重新 build,不必重新安装。

```sh
cd tools/dsh-balance
npm install                 # 只装 esbuild
npm run build               # 产出 lib/index.js + lib/client.js
dsh plugin --profile web add <本目录的绝对路径>
```

`dsh plugin` 就是「在 profile 目录里跑 pnpm + 对账 `dsh.profile.bundles`」;
本包声明了 `dsh.bundle.patch`,因此会被自动并入 bundle 列表。

### 生效条件(重要)

**必须重启一次 `dsh web`**,然后刷新页面。前端 boot graph
(`window.__DSH_BOOT__`) 是引擎启动时按 loader 树组合的,新装的 bundle 不会进入
运行中进程的图里——只刷新页面是不够的。

注意桌面壳的「重启引擎」会**优先复用已有实例**;要真正生效,先停掉在跑的
`dsh --profile web` 进程再启动,或用托盘/管理界面停服务后重启。

验收:

```sh
node tests/smoke-host.mjs        # 宿主路由:真实取数 / 缓存 / 跨站 403 / 无凭证降级
node tests/probe-boot-graph.mjs  # 自签会话 Cookie 取 3080 页面,确认 boot graph 已含 dsh-balance
```

## 卸载

```sh
dsh plugin --profile web remove dsh-balance
```

## 已知边界

- 只覆盖 DeepSeek **官方**账户余额(`api.deepseek.com`)。走第三方中转
  (whale2api / opencode-go / ARK 等)时该接口不代表你的实际额度。
- 余额是"账户级"读数,不是本次会话花费;会话花费由官方 StatsLine 的 token 统计承担。
- 上游接口失败时宁可不显示/显示缓存,也不会在输入框下面弹错误。
