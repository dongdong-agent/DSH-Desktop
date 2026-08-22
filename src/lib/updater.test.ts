// ============================================================
// updater.ts 单元测试：版本比较 / registry 检测（缓存与超时）/ 内核安装（幂等、
// 冒烟精确匹配、并发锁）
//
// mock 策略：node 环境无 Tauri 运行时，把 plugin-* 全部 mock 掉；
// httpFetch 在 tauriFetch 抛错后会回退原生 fetch —— 用 vi.stubGlobal("fetch")
// 控制 registry 响应，正好模拟 dev/浏览器环境。
// ============================================================
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---- mock Tauri 运行时 ----
const shellMocks = vi.hoisted(() => ({ create: vi.fn() }));
const fsMocks = vi.hoisted(() => ({ exists: vi.fn(), mkdir: vi.fn(), readDir: vi.fn(), remove: vi.fn() }));
const httpMocks = vi.hoisted(() => ({ tauriFetch: vi.fn() }));
const pathMocks = vi.hoisted(() => ({ appDataDir: vi.fn(), homeDir: vi.fn() }));

vi.mock("@tauri-apps/plugin-shell", () => ({
  Command: { create: shellMocks.create },
}));
vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: fsMocks.exists,
  mkdir: fsMocks.mkdir,
  readDir: fsMocks.readDir,
  remove: fsMocks.remove,
}));
vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: httpMocks.tauriFetch,
}));
vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: pathMocks.appDataDir,
  homeDir: pathMocks.homeDir,
}));

import {
  compareVersions,
  isValidDshVersion,
  normalizeDshVersion,
  checkForUpdate,
  fetchLatestVersion,
  installKernel,
  clearLatestVersionCache,
  listInstalledKernels,
  removeKernel,
} from "./updater";

/** 默认 Tauri appDataDir 返回值（Windows 带尾反斜杠） */
const APP_DATA = "C:\\Users\\demo\\AppData\\Roaming\\com.dsh.desktop\\";

/** 用「按程序名匹配」的方式 stub 一次 shell 执行（模拟 spawn → stdout → close 生命周期） */
function stubShell(
  handlers: Array<{ prog: string; code?: number; stdout?: string; stderr?: string; hang?: boolean }>,
) {
  shellMocks.create.mockImplementation((prog: string, _args: string[]) => {
    const h = handlers.find((x) => x.prog === prog) ?? { prog, code: 0, stdout: "", stderr: "" };
    const cmd = {
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn(),
      spawn: vi.fn(async () => {
        // 先喂 stdout/stderr，再触发 close（与真实插件行为一致）
        cmd.stdout.on.mock.calls
          .filter((call: unknown[]) => call[0] === "data")
          .forEach((call: unknown[]) => (call[1] as (d: string) => void)?.(h.stdout ?? ""));
        cmd.stderr.on.mock.calls
          .filter((call: unknown[]) => call[0] === "data")
          .forEach((call: unknown[]) => (call[1] as (d: string) => void)?.(h.stderr ?? ""));
        if (!h.hang) {
          const closeCb = cmd.on.mock.calls.find((call: unknown[]) => call[0] === "close")?.[1] as
            | ((payload: { code: number; signal: unknown }) => void)
            | undefined;
          closeCb?.({ code: h.code ?? 0, signal: null });
        }
        return { pid: 123, kill: vi.fn() };
      }),
    };
    return cmd;
  });
}

/** registry 返回给定版本（每次调用生成新的 Response，body 只可读一次） */
function stubRegistry(version: string, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Response(JSON.stringify({ version }), { status })),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  shellMocks.create.mockReset();
  fsMocks.exists.mockReset().mockResolvedValue(false); // 默认「未安装」
  fsMocks.mkdir.mockReset().mockResolvedValue(undefined);
  fsMocks.readDir.mockReset().mockResolvedValue([]);
  fsMocks.remove.mockReset().mockResolvedValue(undefined);
  httpMocks.tauriFetch.mockReset().mockRejectedValue(new Error("无 Tauri 运行时（浏览器/dev 环境）"));
  pathMocks.appDataDir.mockReset().mockResolvedValue(APP_DATA);
  pathMocks.homeDir.mockReset().mockResolvedValue("C:\\Users\\demo\\");
  clearLatestVersionCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// ---------- 版本比较 ----------

describe("compareVersions（语义化比较）", () => {
  it("主版本优先：0.1.1-rc.2 > 0.1.0-rc.8", () => {
    expect(compareVersions("0.1.1-rc.2", "0.1.0-rc.8")).toBeGreaterThan(0);
  });

  it("rc 数字按数值比较：0.1.0-rc.10 > 0.1.0-rc.9（非字符串序）", () => {
    expect(compareVersions("0.1.0-rc.10", "0.1.0-rc.9")).toBeGreaterThan(0);
  });

  it("rc 数字比较：0.1.0-rc.2 < 0.1.0-rc.9", () => {
    expect(compareVersions("0.1.0-rc.2", "0.1.0-rc.9")).toBeLessThan(0);
  });

  it("正式版大于同号 rc：0.1.0 > 0.1.0-rc.9", () => {
    expect(compareVersions("0.1.0", "0.1.0-rc.9")).toBeGreaterThan(0);
    expect(compareVersions("0.1.0-rc.9", "0.1.0")).toBeLessThan(0);
  });

  it("v 前缀等价：v0.1.0 === 0.1.0", () => {
    expect(compareVersions("v0.1.0", "0.1.0")).toBe(0);
  });

  it("完全相同版本返回 0", () => {
    expect(compareVersions("0.1.0-rc.7", "0.1.0-rc.7")).toBe(0);
  });

  it("正式版与正式版相等时不产生 NaN", () => {
    const r = compareVersions("0.2.0", "0.2.0");
    expect(Number.isNaN(r)).toBe(false);
    expect(r).toBe(0);
  });

  it("rc > beta > alpha 档位顺序", () => {
    expect(compareVersions("0.1.0-rc.1", "0.1.0-beta.99")).toBeGreaterThan(0);
    expect(compareVersions("0.1.0-beta.1", "0.1.0-alpha.99")).toBeGreaterThan(0);
    expect(compareVersions("0.1.0-alpha.1", "0.1.0-rc.1")).toBeLessThan(0);
  });

  it("rc 后点号可省略：0.1.0-rc6 === 0.1.0-rc.6", () => {
    expect(compareVersions("0.1.0-rc6", "0.1.0-rc.6")).toBe(0);
  });

  it("非法版本回退字符串比较且结果非 NaN（调用方不会因 NaN 崩溃）", () => {
    const r = compareVersions("unknown", "0.1.0");
    expect(Number.isNaN(r)).toBe(false);
    // 字典序兜底：'0'(48) < 'u'(117)，且非法版本之间相等
    expect(compareVersions("unknown", "unknown")).toBe(0);
    expect(Number.isNaN(compareVersions("0.1.0", "unknown"))).toBe(false);
  });
});

// ---------- 版本格式校验 ----------

describe("isValidDshVersion / normalizeDshVersion", () => {
  it("接受正式版 / rc / v 前缀", () => {
    expect(isValidDshVersion("0.1.0")).toBe(true);
    expect(isValidDshVersion("0.1.1-rc.2")).toBe(true);
    expect(isValidDshVersion("v0.1.0")).toBe(true);
    expect(isValidDshVersion(" 0.1.0-rc.7 ")).toBe(true); // 容忍空白
  });

  it("拒绝非法输入", () => {
    expect(isValidDshVersion("unknown")).toBe(false);
    expect(isValidDshVersion("")).toBe(false);
    expect(isValidDshVersion("0.1")).toBe(false);
    expect(isValidDshVersion("0.1.0.1")).toBe(false);
    expect(isValidDshVersion("foo")).toBe(false);
  });

  it("normalizeDshVersion 去 v 前缀与空白", () => {
    expect(normalizeDshVersion("v0.1.0-rc.7")).toBe("0.1.0-rc.7");
    expect(normalizeDshVersion(" 0.1.0 ")).toBe("0.1.0");
  });
});

// ---------- registry 检测 ----------

describe("fetchLatestVersion", () => {
  it("解析 registry latest 端点返回的版本号", async () => {
    stubRegistry("0.1.1-rc.2");
    expect(await fetchLatestVersion()).toBe("0.1.1-rc.2");
  });

  it("TTL 内重复调用只请求一次 registry（响应缓存）", async () => {
    const fetchMock = vi.fn(
      () => new Response(JSON.stringify({ version: "0.1.1-rc.2" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchLatestVersion()).toBe("0.1.1-rc.2");
    expect(await fetchLatestVersion()).toBe("0.1.1-rc.2");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("clearLatestVersionCache 后重新请求 registry", async () => {
    const fetchMock = vi.fn(
      () => new Response(JSON.stringify({ version: "0.1.1-rc.2" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await fetchLatestVersion();
    clearLatestVersionCache();
    await fetchLatestVersion();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("registry 返回非 200 时抛错", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not found", { status: 404 })));
    await expect(fetchLatestVersion()).rejects.toThrow(/HTTP 404/);
  });

  it("registry 响应缺 version 字段时抛错", async () => {
    stubRegistry("", 200); // 无法构造非 version 字段……单独 mock 一个无 version 的响应
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ name: "x" }), { status: 200 })));
    await expect(fetchLatestVersion()).rejects.toThrow(/version 字段/);
  });

  it("请求超时（10s）时抛出友好错误而不是无限等待", async () => {
    // registry 永不返回，但响应 abort signal
    const fetchMock = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();
    const p = fetchLatestVersion();
    // 先挂上断言再推进时钟，避免 rejection 在 handler 附加前被判定为 unhandled
    const assertion = expect(p).rejects.toThrow(/超时/);
    await vi.advanceTimersByTimeAsync(10_001); // 越过 10s 超时
    await assertion;
  });

  it("完全无网络（fetch 直接失败）时抛错不崩溃", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(fetchLatestVersion()).rejects.toThrow(/Failed to fetch|超时/);
  });
});

// ---------- 检测入口 ----------

describe("checkForUpdate", () => {
  it("有新版：hasUpdate=true 且 current 归一化", async () => {
    stubRegistry("0.1.1-rc.2");
    const info = await checkForUpdate("v0.1.0-rc.6");
    expect(info.hasUpdate).toBe(true);
    expect(info.current).toBe("0.1.0-rc.6");
    expect(info.latest).toBe("0.1.1-rc.2");
  });

  it("已是最新：hasUpdate=false", async () => {
    stubRegistry("0.1.0-rc.7");
    const info = await checkForUpdate("0.1.0-rc.7");
    expect(info.hasUpdate).toBe(false);
  });

  it("当前版本不可识别（unknown）时抛错，绝不误报已最新", async () => {
    stubRegistry("0.1.1-rc.2");
    await expect(checkForUpdate("unknown")).rejects.toThrow(/无法识别当前内核版本/);
  });
});

// ---------- 内核安装 ----------

describe("installKernel", () => {
  it("已安装（bin.js 存在）时幂等返回成功，不执行 npm", async () => {
    fsMocks.exists.mockResolvedValue(true);
    const res = await installKernel("0.1.0-rc.7");
    expect(res.ok).toBe(true);
    expect(shellMocks.create).not.toHaveBeenCalled();
  });

  it("npm 安装成功 + 冒烟输出一致 → ok", async () => {
    stubShell([
      { prog: "npm", code: 0, stdout: "", stderr: "" },
      { prog: "node", code: 0, stdout: "0.1.1-rc.2\n", stderr: "" },
    ]);
    const res = await installKernel("0.1.1-rc.2");
    expect(res.ok).toBe(true);
    // npm 11 的 --prefix 要求目录已存在：安装前必须已 mkdir 目标版本目录
    expect(fsMocks.mkdir).toHaveBeenCalledWith(
      "C:\\Users\\demo\\AppData\\Roaming\\com.dsh.desktop\\kernel\\0.1.1-rc.2",
      { recursive: true },
    );
    // npm 必须带 --prefix 指向内核目录（GUI 托管，不污染全局）
    const npmArgs = shellMocks.create.mock.calls.find(([p]: string[]) => p === "npm")?.[1] as string[];
    expect(npmArgs).toContain("--prefix");
    expect(npmArgs.join(" ")).toContain("com.dsh.desktop\\kernel\\0.1.1-rc.2");
    // 冒烟用 node + bin.js 绝对路径
    const nodeArgs = shellMocks.create.mock.calls.find(([p]: string[]) => p === "node")?.[1] as string[];
    expect(nodeArgs?.[0]).toContain("kernel\\0.1.1-rc.2\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js");
  });

  it("本机有 pnpm 时优先用 pnpm add --dir 安装（规避 npm 装 dsh 依赖树死循环的实测问题）", async () => {
    // pnpm shim 存在 → detectPackageManager 返回 pnpm
    fsMocks.exists.mockImplementation((p: string) => {
      if (p.includes("AppData\\Roaming\\npm\\pnpm.cmd")) return Promise.resolve(true);
      return Promise.resolve(false);
    });
    stubShell([
      { prog: "pnpm", code: 0, stdout: "", stderr: "" },
      { prog: "node", code: 0, stdout: "0.1.1-rc.2\n", stderr: "" },
    ]);
    const res = await installKernel("0.1.1-rc.2");
    expect(res.ok).toBe(true);
    // pnpm 用 add --dir 指向内核目录
    const pnpmArgs = shellMocks.create.mock.calls.find(([p]: string[]) => p === "pnpm")?.[1] as string[];
    expect(pnpmArgs).toContain("add");
    expect(pnpmArgs).toContain("--dir");
    expect(pnpmArgs.join(" ")).toContain("kernel\\0.1.1-rc.2");
    // npm 不被调用
    expect(shellMocks.create.mock.calls.some(([p]: string[]) => p === "npm")).toBe(false);
  });

  it("无 pnpm 时回退 npm install --prefix", async () => {
    // exists 默认全 false（pnpm.cmd 不存在）→ npm 分支
    stubShell([
      { prog: "npm", code: 0, stdout: "", stderr: "" },
      { prog: "node", code: 0, stdout: "0.1.1-rc.2\n", stderr: "" },
    ]);
    const res = await installKernel("0.1.1-rc.2");
    expect(res.ok).toBe(true);
    const npmArgs = shellMocks.create.mock.calls.find(([p]: string[]) => p === "npm")?.[1] as string[];
    expect(npmArgs).toContain("install");
    expect(npmArgs).toContain("--prefix");
    expect(shellMocks.create.mock.calls.some(([p]: string[]) => p === "pnpm")).toBe(false);
  });

  it("创建内核目录失败（mkdir 抛错）→ 返回具体错误，不执行 npm", async () => {
    fsMocks.mkdir.mockRejectedValue(new Error("EACCES: permission denied"));
    const res = await installKernel("0.1.1-rc.2");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/创建内核目录失败/);
    expect(res.error).toMatch(/EACCES/);
    expect(shellMocks.create).not.toHaveBeenCalled();
  });

  it("冒烟输出 0.1.1-rc.20 时安装 0.1.1-rc.2 判失败（字符串 includes 误报防护）", async () => {
    stubShell([
      { prog: "npm", code: 0, stdout: "", stderr: "" },
      { prog: "node", code: 0, stdout: "0.1.1-rc.20\n", stderr: "" },
    ]);
    const res = await installKernel("0.1.1-rc.2");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/校验失败/);
  });

  it("冒烟输出带前缀文字也能正确提取版本号", async () => {
    stubShell([
      { prog: "npm", code: 0 },
      { prog: "node", code: 0, stdout: "dsh version 0.1.1-rc.2 (built 2026-08-22)\n" },
    ]);
    const res = await installKernel("0.1.1-rc.2");
    expect(res.ok).toBe(true);
  });

  it("npm 安装失败返回具体错误信息", async () => {
    stubShell([{ prog: "npm", code: 1, stderr: "npm error EACCES: permission denied" }]);
    const res = await installKernel("0.1.1-rc.2");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/EACCES/);
  });

  it("并发锁：安装进行中时第二次调用直接失败，不并发执行 npm", async () => {
    // 第一次安装的 npm 命令挂起（不触发 close）
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    shellMocks.create.mockImplementation((_prog: string) => {
      const cmd = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn(),
        spawn: vi.fn(async () => {
          await gate; // 挂起，直到测试释放
          const closeCb = cmd.on.mock.calls.find(([e]: string[]) => e === "close")?.[1];
          closeCb?.({ code: 0, signal: null });
          return { pid: 1, kill: vi.fn() };
        }),
      };
      return cmd;
    });
    const p1 = installKernel("0.1.1-rc.2");
    // 第二次调用应被互斥锁挡下
    const p2 = await installKernel("0.1.0-rc.7");
    expect(p2.ok).toBe(false);
    expect(p2.error).toMatch(/已有内核安装任务/);
    // 释放第一次安装，让它正常收尾
    release();
    const r1 = await p1;
    expect(r1.ok).toBe(false); // node 冒烟无输出 → 失败，但不影响锁的断言
  });
});

// ---------- 内核版本清单与清理 ----------

describe("listInstalledKernels / removeKernel", () => {
  it("listInstalledKernels 列出内核目录中已装的版本（按版本号升序，忽略非版本目录）", async () => {
    fsMocks.readDir.mockResolvedValue([
      { name: "0.1.1-rc.2", isDirectory: true },
      { name: "random.txt", isDirectory: false },
      { name: "0.1.0-rc.6", isDirectory: true },
      { name: "__temp__", isDirectory: true },
    ]);
    const list = await listInstalledKernels();
    expect(list).toEqual(["0.1.0-rc.6", "0.1.1-rc.2"]); // 升序 + 过滤非版本目录
  });

  it("listInstalledKernels 目录不可读时返回空数组", async () => {
    fsMocks.readDir.mockRejectedValue(new Error("ACL denied"));
    expect(await listInstalledKernels()).toEqual([]);
  });

  it("removeKernel 删除指定版本目录（递归）并归一化版本号", async () => {
    const r = await removeKernel("v0.1.0-rc.6");
    expect(r.ok).toBe(true);
    expect(fsMocks.remove).toHaveBeenCalledWith(
      "C:\\Users\\demo\\AppData\\Roaming\\com.dsh.desktop\\kernel\\0.1.0-rc.6",
      { recursive: true },
    );
  });

  it("removeKernel 删除失败返回具体错误", async () => {
    fsMocks.remove.mockRejectedValue(new Error("EACCES: 文件被占用"));
    const r = await removeKernel("0.1.0-rc.6");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/EACCES/);
  });
});
