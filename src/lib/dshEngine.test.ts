// ============================================================
// dshEngine.ts 单元测试：白名单判定 / 回滚目标 / pin 切换 /
// getDshVersion 使用被 pin 版本的 bin.js（回滚 bug 修复的核心断言）
// ============================================================
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---- mock Tauri 运行时 ----
const shellMocks = vi.hoisted(() => ({ create: vi.fn() }));
const fsMocks = vi.hoisted(() => ({
  exists: vi.fn(),
  readDir: vi.fn(),
  writeTextFile: vi.fn(),
  mkdir: vi.fn(),
  readTextFile: vi.fn(),
  remove: vi.fn(),
}));
const httpMocks = vi.hoisted(() => ({ tauriFetch: vi.fn() }));
const pathMocks = vi.hoisted(() => ({ homeDir: vi.fn(), appDataDir: vi.fn() }));

vi.mock("@tauri-apps/plugin-shell", () => ({
  Command: { create: shellMocks.create },
}));
vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: fsMocks.exists,
  readDir: fsMocks.readDir,
  writeTextFile: fsMocks.writeTextFile,
  mkdir: fsMocks.mkdir,
  readTextFile: fsMocks.readTextFile,
  remove: fsMocks.remove,
}));
vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: httpMocks.tauriFetch,
}));
vi.mock("@tauri-apps/api/path", () => ({
  homeDir: pathMocks.homeDir,
  appDataDir: pathMocks.appDataDir,
}));

import {
  isVerifiedVersion,
  rollbackVersion,
  pinEngineVersion,
  getPinnedEngineVersion,
  getDshVersion,
  loadVerifiedVersions,
  addVerifiedVersion,
} from "./dshEngine";

const APP_DATA = "C:\\Users\\demo\\AppData\\Roaming\\com.dsh.desktop\\";
const HOME = "C:\\Users\\demo\\";

/** 内核目录里已有的版本（目录名 → 是否含有效 bin.js）。注意：readDir 必须返回 Promise（源码里 .catch 链） */
function stubKernelDir(versions: string[]) {
  fsMocks.readDir.mockImplementation((p: string) => {
    if (p.includes("com.dsh.desktop\\kernel")) {
      return Promise.resolve(versions.map((name) => ({ name, isDirectory: true })));
    }
    return Promise.resolve([]);
  });
  // bin.js 存在性：路径含 kernel\<version>\ 且版本在列表中 → 存在。
  // 注意：必须返回 Promise——源码里是 exists(root).catch(...) 链式调用，裸布尔会炸
  fsMocks.exists.mockImplementation((p: string) => {
    if (p.includes("com.dsh.desktop\\kernel")) {
      const m = /kernel\\([^\\]+)\\node_modules/.exec(p as string);
      return Promise.resolve(m ? versions.includes(m[1]) : true);
    }
    return Promise.resolve(false);
  });
}

/** 所有 shell 命令都返回固定版本输出（spawn + close 事件模式，配合 runCommand） */
function stubShellPrint(version: string) {
  shellMocks.create.mockImplementation(() => {
    const cmd = {
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn(),
      spawn: vi.fn(async () => {
        cmd.stdout.on.mock.calls
          .filter((c: unknown[]) => c[0] === "data")
          .forEach((c: unknown[]) => (c[1] as (d: string) => void)?.(`${version}\n`));
        const closeCb = cmd.on.mock.calls.find((c: unknown[]) => c[0] === "close")?.[1] as
          | ((p: { code: number; signal: unknown }) => void)
          | undefined;
        closeCb?.({ code: 0, signal: null });
        return { pid: 1, kill: vi.fn() };
      }),
    };
    return cmd;
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  shellMocks.create.mockReset();
  fsMocks.exists.mockReset().mockResolvedValue(false);
  fsMocks.readDir.mockReset().mockResolvedValue([]);
  fsMocks.writeTextFile.mockReset().mockResolvedValue(undefined);
  fsMocks.readTextFile.mockReset().mockRejectedValue(new Error("文件不存在"));
  fsMocks.remove.mockReset().mockResolvedValue(undefined);
  httpMocks.tauriFetch.mockReset().mockRejectedValue(new Error("无 Tauri 运行时"));
  pathMocks.homeDir.mockReset().mockResolvedValue(HOME);
  pathMocks.appDataDir.mockReset().mockResolvedValue(APP_DATA);
  // pin 置空并清空版本缓存（pinEngineVersion 内部同时清 bin.js 缓存与版本缓存）
  pinEngineVersion(null);
  // 白名单重置为内置默认（配置文件 mock 不存在 → 走默认分支）
  await loadVerifiedVersions();
});

// ---------- 白名单 / 回滚目标 ----------

describe("isVerifiedVersion", () => {
  it("白名单内的版本视为已验证", () => {
    expect(isVerifiedVersion("0.1.0-rc.7")).toBe(true);
  });

  it("白名单外的版本视为未验证", () => {
    expect(isVerifiedVersion("0.1.0-rc.6")).toBe(false);
    expect(isVerifiedVersion("0.1.1-rc.2")).toBe(false);
  });

  it("容忍 v 前缀（探测输出带 v 时不会误判未验证）", () => {
    expect(isVerifiedVersion("v0.1.0-rc.7")).toBe(true);
  });

  it("unknown（探测失败）不是已验证版本", () => {
    expect(isVerifiedVersion("unknown")).toBe(false);
  });
});

describe("rollbackVersion", () => {
  it("返回白名单最后一个版本", () => {
    expect(rollbackVersion()).toBe("0.1.0-rc.7");
  });
});

// ---------- 白名单配置化 ----------

describe("verified-versions.json 配置化", () => {
  it("配置文件存在时从文件加载白名单", async () => {
    fsMocks.readTextFile.mockResolvedValue(JSON.stringify(["0.1.0-rc.7", "0.1.1-rc.2"]));
    const list = await loadVerifiedVersions();
    expect(list).toEqual(["0.1.0-rc.7", "0.1.1-rc.2"]);
    expect(isVerifiedVersion("0.1.1-rc.2")).toBe(true);
    expect(rollbackVersion()).toBe("0.1.1-rc.2"); // 回滚目标跟随配置
  });

  it("配置文件损坏时回退内置默认", async () => {
    fsMocks.readTextFile.mockResolvedValue("{{{ 不是 JSON");
    const list = await loadVerifiedVersions();
    expect(list).toEqual(["0.1.0-rc.7"]);
    expect(isVerifiedVersion("0.1.0-rc.7")).toBe(true);
  });

  it("addVerifiedVersion 追加版本并写配置文件（isVerifiedVersion 立即生效）", async () => {
    const list = await addVerifiedVersion("0.1.1-rc.2");
    expect(list).toContain("0.1.1-rc.2");
    expect(isVerifiedVersion("0.1.1-rc.2")).toBe(true);
    // 写入 verified-versions.json
    expect(fsMocks.writeTextFile).toHaveBeenCalledWith(
      "C:\\Users\\demo\\AppData\\Roaming\\com.dsh.desktop\\verified-versions.json",
      expect.stringContaining("0.1.1-rc.2"),
    );
  });

  it("addVerifiedVersion 去重：重复添加不产生重复项", async () => {
    await addVerifiedVersion("0.1.1-rc.2");
    await addVerifiedVersion("0.1.1-rc.2");
    const written = fsMocks.writeTextFile.mock.calls[fsMocks.writeTextFile.mock.calls.length - 1][1] as string;
    expect(written.match(/0\.1\.1-rc\.2/g)?.length).toBe(1);
  });
});

// ---------- pin 切换 ----------

describe("pinEngineVersion", () => {
  it("pin 后读取到新值，清空后恢复跟随最新", () => {
    pinEngineVersion("0.1.1-rc.2");
    expect(getPinnedEngineVersion()).toBe("0.1.1-rc.2");
    pinEngineVersion(null);
    expect(getPinnedEngineVersion()).toBeNull();
  });
});

// ---------- getDshVersion 使用被 pin 版本的 bin.js（回滚修复核心） ----------

describe("getDshVersion", () => {
  it("未 pin 时使用 GUI 内核目录里最高版本", async () => {
    stubKernelDir(["0.1.0-rc.6", "0.1.1-rc.2"]);
    stubShellPrint("0.1.1-rc.2");
    const v = await getDshVersion();
    expect(v).toContain("0.1.1-rc.2");
    // 断言 node 参数用的是 0.1.1-rc.2 的 bin.js（最高版本）
    const nodeArgs = shellMocks.create.mock.calls.find(([p]: string[]) => p === "node")?.[1] as string[];
    expect(nodeArgs?.[0]).toContain("kernel\\0.1.1-rc.2\\node_modules");
  });

  it("pin 到旧版本后，getDshVersion 使用被 pin 版本的 bin.js（修复回滚 bug）", async () => {
    stubKernelDir(["0.1.0-rc.7", "0.1.1-rc.2"]);
    stubShellPrint("0.1.0-rc.7");
    pinEngineVersion("0.1.0-rc.7");
    const v = await getDshVersion();
    expect(v).toContain("0.1.0-rc.7");
    // 关键断言：node 参数是 0.1.0-rc.7 的 bin.js，而不是更高的 0.1.1-rc.2
    const nodeArgs = shellMocks.create.mock.calls.find(([p]: string[]) => p === "node")?.[1] as string[];
    expect(nodeArgs?.[0]).toContain("kernel\\0.1.0-rc.7\\node_modules");
    expect(nodeArgs?.[0]).not.toContain("0.1.1-rc.2");
  });

  it("版本探测候选全部挂起（npx 死循环场景）时限时返回 unknown，不无限等待", async () => {
    // 内核目录为空 + pnpm 探测失败 → findDshBinJs 返回 null → 候选链只剩 npx/dsh/dsh.cmd
    fsMocks.readDir.mockReset().mockResolvedValue([]);
    fsMocks.exists.mockReset().mockResolvedValue(false);
    // 所有 shell 命令挂起：spawn 返回子进程但永不触发 close（模拟 npx 卡死）
    shellMocks.create.mockImplementation(() => ({
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn(),
      spawn: vi.fn(async () => ({ pid: 1, kill: vi.fn() })),
    }));
    vi.useFakeTimers();
    const p = getDshVersion();
    const assertion = p.then((v) => expect(v).toBe("unknown"));
    // 3 个候选 × 15s 超时 = 45s；留余量推进 60s
    await vi.advanceTimersByTimeAsync(60_000);
    await assertion;
    vi.useRealTimers();
    // 每个候选都应触发超时 kill（不残留死循环进程）
    expect(shellMocks.create).toHaveBeenCalledTimes(3); // npx / dsh / dsh.cmd
  });

  it("内核目录无该版本时回退 pnpm 全局目录精确匹配", async () => {
    // 内核目录为空
    fsMocks.readDir.mockImplementation((p: string) => {
      if (p.includes("com.dsh.desktop\\kernel")) return Promise.resolve([]);
      if (p.includes("AppData\\Local\\pnpm\\global\\5\\.pnpm")) {
        return Promise.resolve([{ name: "@deepseek-ai+dsh@0.1.0-rc.6_abc123", isDirectory: true }]);
      }
      return Promise.resolve([]);
    });
    fsMocks.exists.mockImplementation((p: string) => {
      // pnpm 全局目录里只有 @deepseek-ai+dsh@0.1.0-rc.6_ 匹配（Promise，源码 .catch 链）
      return Promise.resolve(
        p.includes("@deepseek-ai+dsh@0.1.0-rc.6_") || p.includes("AppData\\Local\\pnpm\\global\\5\\.pnpm"),
      );
    });
    stubShellPrint("0.1.0-rc.6");
    pinEngineVersion("0.1.0-rc.6");
    const v = await getDshVersion();
    expect(v).toContain("0.1.0-rc.6");
    const nodeArgs = shellMocks.create.mock.calls.find(([p]: string[]) => p === "node")?.[1] as string[];
    expect(nodeArgs?.[0]).toContain("@deepseek-ai+dsh@0.1.0-rc.6_");
  });
});
