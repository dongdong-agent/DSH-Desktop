// ============================================================
// 引擎启动覆盖层（--patch）：把「添加工作区」的目录选择固定为**应用内**浏览选择器。
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
// 注意：`--patch` 是 dsh 的**父级**选项，必须出现在 web app 自己的
//   `--port/--host` 之前（commander passThroughOptions 之后的一切都会
//   原样交给 web app，父级选项不再解析）。
// ============================================================
import { exists, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { appDataDir } from "@tauri-apps/api/path";

/** 覆盖层文件名（落在 %APPDATA%/com.dsh.desktop 下，Tauri fs 权限已覆盖） */
export const ENGINE_PATCH_FILENAME = "directory-picker-browse.patch.yml";

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
 * 确保引擎覆盖层文件存在且内容为最新，返回其绝对路径。
 * 幂等：内容一致时不写盘（避免每次都触发文件写入）。
 * @returns 覆盖层绝对路径；写入失败返回 null（调用方退化为不带覆盖层启动，
 *   并在诊断日志里留痕——绝不能因为一个覆盖层让引擎起不来）
 */
export async function ensureEnginePatchFile(): Promise<string | null> {
  try {
    const dir = await appDataDir(); // %APPDATA%\com.dsh.desktop\
    const path = `${dir.replace(/[\\/]+$/, "")}\\${ENGINE_PATCH_FILENAME}`;
    if (await exists(path)) {
      const current = await readTextFile(path).catch(() => null);
      if (current === DIRECTORY_PICKER_PIN_PATCH) return path;
    }
    await writeTextFile(path, DIRECTORY_PICKER_PIN_PATCH);
    return path;
  } catch {
    return null;
  }
}
