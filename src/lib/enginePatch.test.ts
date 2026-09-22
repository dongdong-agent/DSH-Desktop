// ============================================================
// enginePatch.ts 单元测试：引擎启动覆盖层的落盘、幂等与 tauri 插件跳过
// ============================================================
import { describe, it, expect, vi, beforeEach } from "vitest";

const fsMocks = vi.hoisted(() => ({
  exists: vi.fn(),
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
}));
const pathMocks = vi.hoisted(() => ({
  appDataDir: vi.fn(),
  homeDir: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: fsMocks.exists,
  readTextFile: fsMocks.readTextFile,
  writeTextFile: fsMocks.writeTextFile,
}));
vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: pathMocks.appDataDir,
  homeDir: pathMocks.homeDir,
}));

import {
  BILLING_GUARD_FILENAME,
  DIRECTORY_PICKER_PIN_PATCH,
  ENGINE_PATCH_FILENAME,
  OFFICIAL_BILLING_SETTING_FILENAME,
  WEB_SEARCH_PLUGIN_ID,
  ensureEnginePatchFile,
  ensureOfficialBillingGuardPatch,
  isTauriDirPickerMounted,
  officialBillingGuardPatch,
  readOfficialBillingAllowed,
  setOfficialBillingAllowed,
} from "./enginePatch";

const APP_DATA = "C:\\Users\\demo\\AppData\\Roaming\\com.dsh.desktop\\";
const PATCH_PATH = `${APP_DATA.replace(/\\$/, "")}\\${ENGINE_PATCH_FILENAME}`;
const HOME = "C:\\Users\\demo";
const PROFILE_PKG = `${HOME}\\.dsh\\profiles\\web\\package.json`;

/** 按路径分流的 readTextFile：profile package.json 返回给定 JSON，其余返回 patch 内容。 */
function routeRead(profilePkgJson: string | Error, patchContent: string | Error = "") {
  fsMocks.readTextFile.mockImplementation((path: string) => {
    const value = path === PROFILE_PKG ? profilePkgJson : patchContent;
    return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  pathMocks.appDataDir.mockResolvedValue(APP_DATA);
  pathMocks.homeDir.mockResolvedValue(HOME);
  fsMocks.writeTextFile.mockResolvedValue(undefined);
  fsMocks.exists.mockResolvedValue(false);
  // 默认：profile 未挂载 tauri 插件
  routeRead(JSON.stringify({ dsh: { profile: { bundles: ["dsh-wecom"] } } }));
});

describe("isTauriDirPickerMounted", () => {
  it("bundles 列表含 dsh-tauri-dir-picker 时判定已挂载", async () => {
    routeRead(JSON.stringify({ dsh: { profile: { bundles: ["dsh-tauri-dir-picker"] } } }));
    expect(await isTauriDirPickerMounted()).toBe(true);
  });

  it("profile 文件缺失 / JSON 非法一律按未挂载处理", async () => {
    routeRead(new Error("文件不存在"));
    expect(await isTauriDirPickerMounted()).toBe(false);
    routeRead("{ 不是合法 JSON");
    expect(await isTauriDirPickerMounted()).toBe(false);
  });
});

describe("ensureEnginePatchFile", () => {
  it("tauri 插件已挂载时跳过覆盖层（返回 null，不写盘）", async () => {
    routeRead(JSON.stringify({ dsh: { profile: { bundles: ["dsh-tauri-dir-picker"] } } }));
    expect(await ensureEnginePatchFile()).toBeNull();
    expect(fsMocks.writeTextFile).not.toHaveBeenCalled();
  });

  it("覆盖层不存在时写盘并返回绝对路径", async () => {
    fsMocks.exists.mockResolvedValue(false);
    expect(await ensureEnginePatchFile()).toBe(PATCH_PATH);
    expect(fsMocks.writeTextFile).toHaveBeenCalledWith(PATCH_PATH, DIRECTORY_PICKER_PIN_PATCH);
  });

  it("内容一致时不重复写盘（幂等）", async () => {
    fsMocks.exists.mockResolvedValue(true);
    routeRead(JSON.stringify({ dsh: { profile: { bundles: [] } } }), DIRECTORY_PICKER_PIN_PATCH);
    expect(await ensureEnginePatchFile()).toBe(PATCH_PATH);
    expect(fsMocks.writeTextFile).not.toHaveBeenCalled();
  });

  it("内容过期时重写（升级后覆盖层随之更新）", async () => {
    fsMocks.exists.mockResolvedValue(true);
    routeRead(JSON.stringify({ dsh: { profile: { bundles: [] } } }), "# 旧版本覆盖层\n");
    expect(await ensureEnginePatchFile()).toBe(PATCH_PATH);
    expect(fsMocks.writeTextFile).toHaveBeenCalledWith(PATCH_PATH, DIRECTORY_PICKER_PIN_PATCH);
  });

  it("写盘失败时返回 null，让引擎按无覆盖层启动而不是起不来", async () => {
    fsMocks.exists.mockRejectedValue(new Error("fs 不可用"));
    expect(await ensureEnginePatchFile()).toBeNull();
  });
});

describe("覆盖层内容", () => {
  it("关掉自适应选择器并插入 browse 的宿主半与客户端半", () => {
    expect(DIRECTORY_PICKER_PIN_PATCH).toContain("- id: directory-picker\n  disabled: true");
    expect(DIRECTORY_PICKER_PIN_PATCH).toContain("'@deepseek-ai/dsh-host-directory-picker-browse'");
    expect(DIRECTORY_PICKER_PIN_PATCH).toContain("'@deepseek-ai/dsh-client-ui-directory-picker-browse'");
    // 同时挂 auto 与具体后端会因重复 directoryPicker 服务报错，覆盖层必须只留一个
    expect(DIRECTORY_PICKER_PIN_PATCH).not.toContain("dsh-host-directory-picker-native");
  });
});

// ---------- 官方 DeepSeek 计费护栏 ----------

const SETTING_PATH = `${APP_DATA.replace(/\\$/, "")}\\${OFFICIAL_BILLING_SETTING_FILENAME}`;
const GUARD_PATH = `${APP_DATA.replace(/\\$/, "")}\\${BILLING_GUARD_FILENAME}`;

/** 让 readTextFile 按路径分流：开关配置 / 护栏覆盖层 / profile package.json */
function routeGuardRead(setting: string | Error, guard: string | Error = "") {
  fsMocks.readTextFile.mockImplementation((path: string) => {
    const value = path === SETTING_PATH ? setting : path === GUARD_PATH ? guard : PROFILE_ABSENT;
    return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
  });
}
const PROFILE_ABSENT = new Error("profile package.json 不存在");

describe("readOfficialBillingAllowed", () => {
  it("配置文件缺失时默认 false（护栏生效）", async () => {
    routeGuardRead(new Error("不存在"));
    expect(await readOfficialBillingAllowed()).toBe(false);
  });

  it("配置文件损坏时同样按 false 处理，绝不因为读失败就放行计费", async () => {
    routeGuardRead("{ 非法 JSON");
    expect(await readOfficialBillingAllowed()).toBe(false);
  });

  it("allow:true 才放行", async () => {
    routeGuardRead(JSON.stringify({ allow: true }));
    expect(await readOfficialBillingAllowed()).toBe(true);
  });
});

describe("setOfficialBillingAllowed", () => {
  it("写入 { allow } JSON 并回报成功", async () => {
    routeGuardRead(new Error("不存在"));
    expect(await setOfficialBillingAllowed(true)).toBe(true);
    expect(fsMocks.writeTextFile).toHaveBeenCalledWith(SETTING_PATH, JSON.stringify({ allow: true }, null, 2));
  });

  it("写盘失败返回 false（界面据此提示不会持久）", async () => {
    routeGuardRead(new Error("不存在"));
    fsMocks.writeTextFile.mockRejectedValueOnce(new Error("无权限"));
    expect(await setOfficialBillingAllowed(true)).toBe(false);
  });
});

describe("ensureOfficialBillingGuardPatch", () => {
  it("默认（开关缺失）写出 disabled: true，摘掉写死官方端点的搜索后端", async () => {
    routeGuardRead(new Error("不存在"));
    expect(await ensureOfficialBillingGuardPatch()).toBe(GUARD_PATH);
    expect(fsMocks.writeTextFile).toHaveBeenCalledWith(GUARD_PATH, officialBillingGuardPatch(false));
    expect(officialBillingGuardPatch(false)).toContain(`- id: ${WEB_SEARCH_PLUGIN_ID}\n  disabled: true`);
  });

  it("开关放行时写 disabled: false（显式知情，而不是不留痕迹）", () => {
    expect(officialBillingGuardPatch(true)).toContain(`- id: ${WEB_SEARCH_PLUGIN_ID}\n  disabled: false`);
  });

  it("内容未变时不重复写盘（幂等）", async () => {
    fsMocks.exists.mockResolvedValue(true);
    routeGuardRead(new Error("不存在"), officialBillingGuardPatch(false));
    expect(await ensureOfficialBillingGuardPatch()).toBe(GUARD_PATH);
    expect(fsMocks.writeTextFile).not.toHaveBeenCalled();
  });
});
