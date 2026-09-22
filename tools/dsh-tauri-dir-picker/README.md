# dsh-tauri-dir-picker

工作区「添加/选择目录」流程的替代占用方：**桌面壳内弹真·系统文件夹选择框，
外部浏览器回落到应用内浏览对话框。**

## 为什么需要它

- 引擎自带原生选择器后端（`dsh-host-directory-picker-native`）在 Windows 上用
  `IFileOpenDialog.Show(null)`——没有 owner 窗口，宽屏/多显示器上选择框会跑到
  应用窗口之外且不置顶（2026-09-12 实测），表现为「添加工作区按钮无法正常使用」。
- 桌面壳当时的对策是用 `--patch` 把整个流程钉死为应用内 browse 选择器
  （`src/lib/enginePatch.ts`）。但 browse 后端按设计**从家目录起步、不枚举盘符根**
  （其 README 已知限制），跨盘只能靠面包屑栏的铅笔路径输入——发现性极差，
  用户反馈「没办法选择本地硬盘的任意文件夹」。
- 本包接管 directoryFlow 两个 single 洞：桌面壳（Tauri WebView）里改走
  `plugin:dialog|open` 的原生文件夹选择框——它是主窗口的 owned dialog，
  天然置顶、居中、可浏览任意盘符/网络位置；外部浏览器没有 `__TAURI__`，
  回落到自带轻量浏览对话框（路径输入 + 单栏列表 + 新建文件夹），
  数据面仍走 browse 宿主后端。

## 生效前提（桌面壳侧）

1. `src-tauri/capabilities/default.json` 的 `remote.urls` 覆盖引擎页 origin
   （`http://127.0.0.1:*`），否则页面拿不到 `__TAURI__`，本包自动走回落路径
   ——功能不坏，只是回到应用内选择器。
2. `tauri-plugin-dialog` 已注册且 capability 含 `dialog:default`（现状已满足）。

## 构建与安装

与 `tools/dsh-balance` 同一工程形态（源码随本仓库版本管理，安装到 profile 才生效）：

```sh
cd tools/dsh-tauri-dir-picker
npm install                 # 只装 esbuild
npm run build               # 产出 lib/index.js + lib/client.js
dsh plugin --profile web add <本目录的绝对路径>
```

本包声明了 `dsh.bundle.patch`（cordis.patch.yml）：关掉自适应选择器、
挂 browse 宿主半。**安装后必须重启一次 `dsh --profile web`**（boot graph 是
引擎启动时组合的），再刷新页面。

同时桌面壳的 `src/lib/enginePatch.ts` 会检测到本包已挂载（读
`profiles/web/package.json` 的 `dsh.profile.bundles`），**跳过**自己那份
browse 钉死覆盖层——否则 browse 客户端半与本包对同一 single 洞重复占用，
引擎会明确报错。

## 卸载

```sh
dsh plugin --profile web remove dsh-tauri-dir-picker
```

卸载后桌面壳下次启动引擎会自动恢复写 browse 覆盖层（enginePatch 的检测回落）。
