// ============================================================
// enginePatch.ts 单元测试：引擎启动覆盖层文件的落盘与幂等
// ============================================================
import { describe, it, expect, vi, beforeEach } from "vitest";

const fsMocks = vi.hoisted(() => ({
  exists: vi.fn(),
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
}));
const pathMocks = vi.hoisted(() => ({ appDataDir: vi.fn() }));

vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: fsMocks.exists,
  readTextFile: fsMocks.readTextFile,
  writeTextFile: fsMocks.writeTextFile,
}));
vi.mock("@tauri-apps/api/path", () => ({ appDataDir: pathMocks.appDataDir }));

import { DIRECTORY_PICKER_PIN_PATCH, ENGINE_PATCH_FILENAME, ensureEnginePatchFile } from "./enginePatch";

const APP_DATA = "C:\\Users\\demo\\AppData\\Roaming\\com.dsh.desktop\\";
const PATCH_PATH = `${APP_DATA.replace(/\\$/, "")}\\${ENGINE_PATCH_FILENAME}`;

beforeEach(() => {
  vi.clearAllMocks();
  pathMocks.appDataDir.mockResolvedValue(APP_DATA);
  fsMocks.writeTextFile.mockResolvedValue(undefined);
});

describe("ensureEnginePatchFile", () => {
  it("覆盖层不存在时写盘并返回绝对路径", async () => {
    fsMocks.exists.mockResolvedValue(false);
    expect(await ensureEnginePatchFile()).toBe(PATCH_PATH);
    expect(fsMocks.writeTextFile).toHaveBeenCalledWith(PATCH_PATH, DIRECTORY_PICKER_PIN_PATCH);
  });

  it("内容一致时不重复写盘（幂等）", async () => {
    fsMocks.exists.mockResolvedValue(true);
    fsMocks.readTextFile.mockResolvedValue(DIRECTORY_PICKER_PIN_PATCH);
    expect(await ensureEnginePatchFile()).toBe(PATCH_PATH);
    expect(fsMocks.writeTextFile).not.toHaveBeenCalled();
  });

  it("内容过期时重写（升级后覆盖层随之更新）", async () => {
    fsMocks.exists.mockResolvedValue(true);
    fsMocks.readTextFile.mockResolvedValue("# 旧版本覆盖层\n");
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
