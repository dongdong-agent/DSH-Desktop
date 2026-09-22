// ============================================================
// 引擎启动覆盖层（--patch，可重复传多份）：
//   1. 目录选择覆盖层——把「添加工作区」的目录选择固定为**应用内**浏览选择器；
//   2. 官方计费护栏——默认摘掉写死官方端点的联网搜索后端（见文件末尾）。
//
// 背景（2026-09-12 实测）：
//   dsh web bundle 的 `directory-picker` 行挂的是 host-directory-picker-auto，
//   它在「回环绑定 + 非 SSH + Windows」下判定为 native：宿主用 Win32
//   IFileOpenDialog 打开系统文件夹选择框，而 Show(null) **没有 owner 窗口**，
//   位置与置顶完全交给 Windows 决定。结果是宽屏/多显示器上选择框跑到应用窗口
//   之外、且不置顶——用户看到的现象就是「左侧添加工作区按钮无法正常使用」。
//
// 修法：seam 的官方固定方式不是配置字段，而是直接组合另一个后端
//   （README：「固定某种交互就是直接组合那个后端」）。browse 后端把目录浏览
//   渲染在 WebUI 内部（Miller 分栏的「选择工作区目录」对话框），不依赖任何
//   宿主窗口几何，远程访问/任意屏幕尺寸都一致。
//
// 落地方式：本文件把覆盖层写成磁盘上的 patch 文件，启动引擎时以
//   `--patch <file>` 传入（profile 层之后应用）。**不修改** ~/.dsh 下用户
//   自己的 cordis.patch.yml / profile 配置，随桌面版升级即可整体替换。
//
// 例外（2026-09-22）：当 profile 已挂载 tools/dsh-tauri-dir-picker（bundle 自带
//   同效覆盖层，且客户端半接管 directoryFlow 的 single 洞）时，本覆盖层必须
//   **整体跳过**——再插一份 browse 客户端半会与之重复占用，引擎启动明确报错。
//
// 注意：`--patch` 是 dsh 的**父级**选项，必须出现在 web app 自己的
//   `--port/--host` 之前（commander passThroughOptions 之后的一切都会
//   原样交给 web app，父级选项不再解析）。
// ============================================================
import { exists, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { appDataDir, homeDir } from "@tauri-apps/api/path";

/** 覆盖层文件名（落在 %APPDATA%/com.dsh.desktop 下，Tauri fs 权限已覆盖） */
export const ENGINE_PATCH_FILENAME = "directory-picker-browse.patch.yml";

/** 接管目录选择流程的 profile bundle（tools/dsh-tauri-dir-picker） */
export const TAURI_DIR_PICKER_BUNDLE = "dsh-tauri-dir-picker";

/**
 * 覆盖层内容：
 *   1. 关掉自适应选择器（同时挂 auto 和具体后端会因重复 directoryPicker
 *      服务 / single slot 重复占用而明确报错）；
 *   2. 插入 browse 后端的 host 半与 client 半（一行同时换两面的 seam 不变式）。
 */
export const DIRECTORY_PICKER_PIN_PATCH = `# DSH Desktop 生成（引擎启动覆盖层，勿手改；由 src/lib/enginePatch.ts 对应）
#
# 把工作区「添加/选择目录」流程固定为应用内浏览选择器（browse）。
# 原生后端（native）用 Show(null) 打开 Win32 IFileOpenDialog，没有 owner 窗口，
# Windows 会自行决定位置与层叠：宽屏/多显示器上会跑到应用窗口之外且不置顶。
# browse 后端把「选择工作区目录」渲染在 WebUI 内部，与窗口位置无关。
- id: directory-picker
  disabled: true
- insert:
    - id: directory-picker-browse
      name: '@deepseek-ai/dsh-host-directory-picker-browse'
    - id: ui-directory-picker-browse
      name: '@deepseek-ai/dsh-client-ui-directory-picker-browse'
`;

/**
 * 检测 web profile 是否已挂载 dsh-tauri-dir-picker bundle。
 * 判据：~/.dsh/profiles/web/package.json 的 dsh.profile.bundles 数组含该包名
 * （`dsh plugin add` 维护的就是这个列表）。读不到/解析失败一律按未挂载处理
 * ——宁可多写一份覆盖层（顶多启动报错可见），不可错判已挂载导致选择器双双失效。
 */
export async function isTauriDirPickerMounted(): Promise<boolean> {
  try {
    const home = (await homeDir()).replace(/[\\/]+$/, "");
    const txt = await readTextFile(`${home}\\.dsh\\profiles\\web\\package.json`);
    const bundles: unknown = JSON.parse(txt)?.dsh?.profile?.bundles;
    return Array.isArray(bundles) && bundles.includes(TAURI_DIR_PICKER_BUNDLE);
  } catch {
    return false;
  }
}

/**
 * 确保引擎覆盖层文件存在且内容为最新，返回其绝对路径。
 * 幂等：内容一致时不写盘（避免每次都触发文件写入）。
 * profile 已挂载 tauri 目录选择插件时返回 null（跳过覆盖层，见文件头注释）。
 * @returns 覆盖层绝对路径；写入失败返回 null（调用方退化为不带覆盖层启动，
 *   并在诊断日志里留痕——绝不能因为一个覆盖层让引擎起不来）
 */
export async function ensureEnginePatchFile(): Promise<string | null> {
  if (await isTauriDirPickerMounted()) return null;
  return ensurePatchFile(ENGINE_PATCH_FILENAME, DIRECTORY_PICKER_PIN_PATCH);
}

/** 把覆盖层写到 appDataDir 下（内容一致则跳过写盘）；任何异常都退化为 null */
async function ensurePatchFile(filename: string, content: string): Promise<string | null> {
  try {
    const dir = await appDataDir(); // %APPDATA%\com.dsh.desktop\
    const path = `${dir.replace(/[\\/]+$/, "")}\\${filename}`;
    if (await exists(path)) {
      const current = await readTextFile(path).catch(() => null);
      if (current === content) return path;
    }
    await writeTextFile(path, content);
    return path;
  } catch {
    return null;
  }
}

// ============================================================
// 官方 DeepSeek 计费护栏
//
// 真因（2026-09-22 从 ~/.dsh/sessions 实测取证）：dsh 的联网搜索后端
// `@deepseek-ai/dsh-web-search-deepseek` 把端点**写死**为
//   https://api.deepseek.com/anthropic/v1/messages
// 且刻意不跟随 $DEEPSEEK_BASE_URL（它的注释写明：搜索走 Anthropic Messages
// 协议，与 chat-completions 不是一个 base，见其 lib/index.js:282）。
// 而 @deepseek-ai/dsh-base 自带的 cordis.patch.yml 把 dsh-web 的
// `searchProvider` **显式**钉成 `deepseek-official`（--dump-config 里看得见），
// 所以这不是"没配置才撞上"，而是默认装配就是官方；available() 又几乎恒为真
// （dsh-web/lib/index.js:127-131 的解析规则）——于是：
//   对话全程走套餐（commandcode / opencode-go）＋ 每次 web_search 按 token
//   扣 DeepSeek 官方余额，界面上没有任何提示。本月仅搜索就打了 2631 次官方。
//
// 修法：默认把该后端从启动树里摘掉（`disabled: true` 是插件加载器支持的
// 入口字段）。摘掉后 dsh-web 解析 `searchProvider: deepseek-official` 会抛
// WEB_PROVIDER_CONFIGURED_MISSING，联网搜索变成**显式报错**而不是静默扣费。
// 用户在密钥管理面板知情后可打开开关恢复（见 readOfficialBillingAllowed）。
// 只写覆盖层，不动 ~/.dsh 下用户自己的配置。
// ============================================================

/** 联网搜索后端的注册 id（@deepseek-ai/dsh-base/cordis.patch.yml 里挂上官方端点的就是它） */
export const WEB_SEARCH_PLUGIN_ID = "web-search-deepseek";

/** 护栏覆盖层文件名 */
export const BILLING_GUARD_FILENAME = "official-billing-guard.patch.yml";

/** 护栏开关的持久化文件名（JSON `{ allow: boolean }`） */
export const OFFICIAL_BILLING_SETTING_FILENAME = "official-billing.json";

/** 护栏覆盖层内容：allow=true 显式放行（disabled: false），allow=false 摘掉后端 */
export function officialBillingGuardPatch(allowOfficialBilling: boolean): string {
  return `# DSH Desktop 生成（官方 DeepSeek 计费护栏，勿手改；由 src/lib/enginePatch.ts 对应）
#
# 联网搜索后端 ${WEB_SEARCH_PLUGIN_ID} 的端点写死为
# https://api.deepseek.com/anthropic/v1/messages，不跟随套餐地址（$DEEPSEEK_BASE_URL），
# 而 dsh-base 默认就把 dsh-web 的 searchProvider 钉在 deepseek-official 上。
# 结果：对话走套餐，搜索却按 token 扣 DeepSeek 官方余额。
#
# 当前策略：allow=${allowOfficialBilling ? "true（知情放行，联网搜索会计入官方余额）" : "false（摘掉该后端，联网搜索显式报错，不产生官方用量）"}
# 改这个值请在桌面版「模型密钥管理」里切换开关，不要手改本文件。
- id: ${WEB_SEARCH_PLUGIN_ID}
  disabled: ${allowOfficialBilling ? "false" : "true"}
`;
}

/**
 * 读护栏开关。**默认 false（护栏生效）**——配置文件缺失/损坏时按保守值处理，
 * 宁可搜索不可用，也不让用户在不知情的情况下被扣费。
 */
export async function readOfficialBillingAllowed(): Promise<boolean> {
  try {
    const dir = await appDataDir();
    const raw = await readTextFile(`${dir.replace(/[\\/]+$/, "")}\\${OFFICIAL_BILLING_SETTING_FILENAME}`);
    return JSON.parse(raw)?.allow === true;
  } catch {
    return false;
  }
}

/**
 * 写护栏开关。
 * @returns 是否写入成功（失败时界面要提示"重启后会退回默认（护栏生效）"）
 */
export async function setOfficialBillingAllowed(allow: boolean): Promise<boolean> {
  try {
    const dir = await appDataDir();
    await writeTextFile(
      `${dir.replace(/[\\/]+$/, "")}\\${OFFICIAL_BILLING_SETTING_FILENAME}`,
      JSON.stringify({ allow }, null, 2),
    );
    return true;
  } catch {
    return false;
  }
}

/** 按当前开关写出护栏覆盖层，返回其绝对路径（写盘失败返回 null → 本次不带护栏启动） */
export async function ensureOfficialBillingGuardPatch(): Promise<string | null> {
  const allow = await readOfficialBillingAllowed();
  return ensurePatchFile(BILLING_GUARD_FILENAME, officialBillingGuardPatch(allow));
}
