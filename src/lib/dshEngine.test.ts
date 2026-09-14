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

// 关键：dshEngine 的 httpFetch 在 plugin-http 失败时会回退原生 fetch——
// 测试环境不 stub 的话，probePort 会真连 127.0.0.1:17800（东哥的引擎正在跑！），
// killPortOwner 会误判「端口未释放」进入 6s 等待循环导致测试挂起。
vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("测试环境网络不可用"); }));

import {
  isVerifiedVersion,
  rollbackVersion,
  pinEngineVersion,
  getPinnedEngineVersion,
  getDshVersion,
  loadVerifiedVersions,
  addVerifiedVersion,
  restartEngine,
  startEngine,
  clearStaleProfileLocks,
  managedCredentialEnv,
  buildEngineArgs,
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

  it("回归：appDataDir 无尾反斜杠时白名单路径仍拼对（tauri 2.11 实测返回无尾斜杠）", async () => {
    pathMocks.appDataDir.mockResolvedValue("C:\\Users\\demo\\AppData\\Roaming\\com.dsh.desktop");
    await addVerifiedVersion("0.1.1-rc.2");
    // 不能拼成 ...com.dsh.desktopverified-versions.json
    expect(fsMocks.writeTextFile).toHaveBeenCalledWith(
      "C:\\Users\\demo\\AppData\\Roaming\\com.dsh.desktop\\verified-versions.json",
      expect.any(String),
    );
  });
});

// ---------- 强制重启（外部实例场景） ----------

describe("restartEngine 强杀外部实例", () => {
  it("netstat 查端口 PID + taskkill 强杀 + force 启动新内核，不复用旧进程", async () => {
    // 内核目录分支命中（0.1.1-rc.2 已装）→ findDshBinJs 返回新内核 bin.js
    fsMocks.exists.mockImplementation((p: string) => Promise.resolve(String(p).includes("kernel")));
    fsMocks.readDir.mockImplementation((p: string) => {
      if (String(p).includes("kernel"))
        return Promise.resolve([{ name: "0.1.1-rc.2", isDirectory: true }]);
      return Promise.resolve([]);
    });
    // netstat 显示 17800 被外部 PID 1234 占用；taskkill 成功；其他命令 spawn 输出版本
    shellMocks.create.mockImplementation((prog: string) => {
      if (prog === "netstat") {
        return {
          execute: vi.fn().mockResolvedValue({
            code: 0,
            stdout: "  TCP    127.0.0.1:17800    0.0.0.0:0    LISTENING    1234\r\n",
            stderr: "",
          }),
        };
      }
      if (prog === "taskkill") {
        return { execute: vi.fn().mockResolvedValue({ code: 0, stdout: "SUCCESS", stderr: "" }) };
      }
      const cmd = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn(),
        spawn: vi.fn(async () => {
          cmd.stdout.on.mock.calls
            .filter(([e]: string[]) => e === "data")
            .forEach(([, cb]) => cb("0.1.1-rc.2\n"));
          const closeCb = cmd.on.mock.calls.find(([e]: string[]) => e === "close")?.[1];
          closeCb?.({ code: 0, signal: null });
          return { pid: 99, kill: vi.fn() };
        }),
      };
      return cmd;
    });
    // probePort 用 httpFetch（= tauriFetch）——按调用次数控制返回值：
    // 第 1 次（killPortOwner 等端口释放）→ reject → false → 立即放行；
    // 第 2 次起（startEngine 健康检查）→ 返回 __DSH_BOOT__ 页 → true → 启动成功，
    // restartEngine 正常 settle（不会卡 30s×3 候选超时，也不泄漏到后续测试）
    let fetchCount = 0;
    httpMocks.tauriFetch.mockImplementation(() => {
      fetchCount++;
      if (fetchCount === 1) return Promise.reject(new Error("端口未就绪"));
      return Promise.resolve({ ok: true, text: () => Promise.resolve("__DSH_BOOT__") });
    });

    await restartEngine(17800);

    const progs = shellMocks.create.mock.calls.map(([x]: string[]) => x);
    // 1. 强杀外部实例：netstat + taskkill 都被调用
    expect(progs).toContain("netstat");
    expect(progs).toContain("taskkill");
    // 2. 启动候选用的 node + 新内核 bin.js（0.1.1-rc.2），而不是复用旧进程
    const nodeArgs = shellMocks.create.mock.calls.find(
      (c: unknown[]) => c[0] === "node" && Array.isArray(c[1]) && String((c[1] as string[])[0]).includes("kernel"),
    )?.[1] as string[];
    expect(nodeArgs?.[0]).toContain("kernel\\0.1.1-rc.2\\node_modules");
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

describe("managedCredentialEnv（受管凭据注入引擎子进程环境）", () => {
  /** 受管存储真实格式：密钥嵌在 refs 下，另有 version 结构字段 */
  const CRED_YAML = [
    "version: 1",
    "refs:",
    "  DEEPSEEK_API_KEY: sk-managed-deepseek",
    "  AGNES_API_KEY:  sk-managed-agnes  ",
    "  RKAPI_API_KEY: sk-managed-rkapi",
    "",
  ].join("\n");

  it("受管存储里有值的键注入真值，让只读环境变量的 MCP 子进程能启动", async () => {
    fsMocks.readTextFile.mockResolvedValue(CRED_YAML);
    const env = await managedCredentialEnv();
    expect(env.DEEPSEEK_API_KEY).toBe("sk-managed-deepseek");
    expect(env.AGNES_API_KEY).toBe("sk-managed-agnes");
    expect(env.RKAPI_API_KEY).toBe("sk-managed-rkapi");
  });

  it("受管存储里没有的受管键仍置空，防止用户级残留值遮蔽受管存储", async () => {
    fsMocks.readTextFile.mockResolvedValue(CRED_YAML);
    const env = await managedCredentialEnv();
    expect(env.OPENROUTER_API_KEY).toBe("");
    expect(env.WECOM_BOT_SECRET).toBe("");
  });

  it("只注入受管清单里的键，version/refs 等结构字段不混入", async () => {
    fsMocks.readTextFile.mockResolvedValue(CRED_YAML);
    const env = await managedCredentialEnv();
    expect(Object.keys(env).sort()).toEqual(
      [
        "AGNES_API_KEY",
        "DEEPSEEK_API_KEY",
        "OPENCODE_GO_API_KEY",
        "OPENROUTER_API_KEY",
        "RKAPI_API_KEY",
        "VOLCENGINE_API_KEY",
        "WECOM_BOT_SECRET",
      ].sort(),
    );
  });

  it("受管存储读不到时全部置空且不抛错（引擎仍可启动）", async () => {
    fsMocks.readTextFile.mockRejectedValue(new Error("文件不存在"));
    const env = await managedCredentialEnv();
    expect(Object.values(env).every((v) => v === "")).toBe(true);
  });
});

// ---------- 启动参数：目录选择覆盖层 ----------

describe("buildEngineArgs（--patch 必须排在 web app 自己的参数之前）", () => {
  it("带覆盖层时 --patch 紧跟 --profile，位于 --port/--host 之前", () => {
    expect(buildEngineArgs(3080, "C:\\patch\\pin.yml")).toEqual([
      "--profile",
      "web",
      "--patch",
      "C:\\patch\\pin.yml",
      "--port",
      "3080",
      "--host",
      "127.0.0.1",
    ]);
  });

  it("覆盖层不可用时退化为不带 --patch 的启动参数", () => {
    expect(buildEngineArgs(3080, null)).toEqual(["--profile", "web", "--port", "3080", "--host", "127.0.0.1"]);
  });
});

// ---------- 残留写锁自愈（2026-09-14 实测的启动失败真因） ----------

/**
 * 复刻真实故障：引擎启动要 heal profiles（须先拿 `~/.dsh/profiles/node_modules.lock`），
 * 若上次引擎**持锁时被强杀**，锁残留 → 之后每个实例启动都抛
 * `atomic-write: timed out waiting for the writer lock` 并退出 → 「所有候选命令均无法启动」。
 */
describe("残留写锁自愈（stale writer lock）", () => {
  /** spawn 后立刻输出给定 stdout/stderr 行并以 code 退出 —— 复刻"引擎起不来"的最短路径 */
  function stubShellExitsWith(code: number, out: { stdout?: string[]; stderr?: string[] } = {}) {
    shellMocks.create.mockImplementation(() => {
      const cmd = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn(),
        spawn: vi.fn(async () => {
          cmd.stdout.on.mock.calls
            .filter((c: unknown[]) => c[0] === "data")
            .forEach((c: unknown[]) => {
              (out.stdout ?? []).forEach((l) => (c[1] as (d: string) => void)?.(`${l}\n`));
            });
          cmd.stderr.on.mock.calls
            .filter((c: unknown[]) => c[0] === "data")
            .forEach((c: unknown[]) => {
              (out.stderr ?? []).forEach((l) => (c[1] as (d: string) => void)?.(`${l}\n`));
            });
          cmd.on.mock.calls.find((c: unknown[]) => c[0] === "close")?.[1]?.({ code, signal: null });
          return { pid: 1, kill: vi.fn() };
        }),
      };
      return cmd;
    });
  }

  it("解析脚本输出：残留锁（持有者已死）被删除，活锁保留", async () => {
    stubShellExitsWith(0, {
      stdout: ['{"checked":2,"removed":["node_modules.lock@25016"],"alive":["other.lock@999"],"skipped":[]}'],
    });

    const r = await clearStaleProfileLocks();

    expect(r.removed).toEqual(["node_modules.lock@25016"]);
    expect(r.alive).toEqual(["other.lock@999"]);
    // 脚本必须**真的**做「探活 + 删除」，而不是打印一个假结果（否则"自愈"是空转）
    const script = (shellMocks.create.mock.calls[0][1] as string[])[1];
    expect(script).toContain("process.kill(pid,0)");
    expect(script).toContain("unlinkSync");
    // 且只动 ~/.dsh/profiles 目录
    expect(script).toContain('".dsh"');
    expect(script).toContain('"profiles"');
  });

  it("脚本无输出 / 非 JSON（node 不可用等）时降级为空结果，不抛错也不阻断启动", async () => {
    stubShellExitsWith(0, { stdout: ["not-json"] });
    expect(await clearStaleProfileLocks()).toEqual({ checked: 0, removed: [], alive: [], skipped: [] });

    // 连 stdout 都没有（例如 node 不存在）
    stubShellExitsWith(1, {});
    expect(await clearStaleProfileLocks()).toEqual({ checked: 0, removed: [], alive: [], skipped: [] });
  });

  it("所有候选都失败时：错误信息给出每个候选的真实结果 + 引擎 stderr + 锁提示，且不再出现误导性的「重装引擎」", async () => {
    stubKernelDir(["0.1.1-rc.2"]); // 本机**已装**内核 —— 所以旧提示"重装引擎"是错的方向
    const LOCK_ERR =
      "Error: atomic-write: timed out waiting for the writer lock at C:\\Users\\demo\\.dsh\\profiles\\node_modules.lock";
    stubShellExitsWith(1, { stderr: [LOCK_ERR] });
    httpMocks.tauriFetch.mockRejectedValue(new Error("没有引擎在跑"));

    const err = (await startEngine(17800).catch((e: unknown) => e)) as Error;

    // ① 不再把用户带偏（旧文案："请在 git-bash 中执行 pnpm install -g @deepseek-ai/dsh 后重试"）
    expect(err.message).not.toContain("pnpm install -g");
    // ② 逐个候选的真实结果（进程退出会被立即感知，而不是傻等满 deadline）
    expect(err.message).toContain("进程已退出");
    // ③ 真因可见：引擎自己的 stderr 里那句写锁超时被带出来
    expect(err.message).toContain("writer lock");
    // ④ 引擎 stderr 必须**落进诊断日志**（旧实现只 console.error，日志里看不到真因）
    const loggedEngineStderr = fsMocks.writeTextFile.mock.calls.some(
      (c: unknown[]) => c[0] === "C:\\Windows\\Temp\\dsh-spawn.log" && String(c[1]).includes("引擎stderr"),
    );
    expect(loggedEngineStderr).toBe(true);
  });

  it("回归：单个候选的等待上限不会再缩回小值（旧值会让 heal 中途的引擎被杀，从而产生残留锁）", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(new URL("./dshEngine.ts", import.meta.url), "utf8");
    const m = /const MAX_START_WAIT_MS = ([\d_]+);/.exec(src);
    expect(m).not.toBeNull();
    // 2026-09-14 实测冷启动 heal 会跑满 180s 仍未完成 → 上限必须给足（当前 600s）
    expect(Number(m![1].replace(/_/g, ""))).toBeGreaterThanOrEqual(300_000);
  });

  it("候选超时：taskkill /T /F 连子树强杀，且每个候选之后都重新清一次残留锁", async () => {
    vi.useFakeTimers();
    try {
      stubKernelDir(["0.1.1-rc.2"]); // 有本地内核 → 候选 1 是 node + bin.js
      const LOCK_OK = '{"checked":0,"removed":[],"alive":[],"skipped":[]}';
      const isLockScript = (prog: unknown, args: unknown) =>
        prog === "node" && Array.isArray(args) && args[0] === "-e";
      shellMocks.create.mockImplementation((prog: string, args: unknown) => {
        if (prog === "taskkill") {
          return { execute: vi.fn().mockResolvedValue({ code: 0, stdout: "", stderr: "" }) };
        }
        const cmd = {
          stdout: { on: vi.fn() },
          stderr: { on: vi.fn() },
          on: vi.fn(),
          spawn: vi.fn(async () => {
            if (isLockScript(prog, args)) {
              // 清锁脚本：立刻输出结果并退出
              cmd.stdout.on.mock.calls
                .filter((c: unknown[]) => c[0] === "data")
                .forEach((c: unknown[]) => (c[1] as (d: string) => void)?.(`${LOCK_OK}\n`));
              cmd.on.mock.calls.find((c: unknown[]) => c[0] === "close")?.[1]?.({ code: 0, signal: null });
            }
            // 引擎候选：spawn 成功、但**永不退出也永不开端口** → 只能由 deadline 结束
            return { pid: 4242, kill: vi.fn() };
          }),
        };
        return cmd;
      });
      httpMocks.tauriFetch.mockRejectedValue(new Error("无引擎在跑"));

      const settled = startEngine(17800).catch((e: unknown) => e);
      // 4 个候选 ×（上限 + 收尾等待）全部推进完
      await vi.advanceTimersByTimeAsync(4 * (600_000 + 5_000));
      const err = (await settled) as Error;

      // ① 必须用 taskkill /T /F 连子树强杀 —— 旧实现只 child.kill()，
      //    引擎的工作进程会活下来继续持有 ~/.dsh/profiles 的写锁
      const tk = shellMocks.create.mock.calls.filter((c: unknown[]) => c[0] === "taskkill");
      expect(tk.length).toBeGreaterThan(0);
      expect(tk[0][1] as string[]).toEqual(expect.arrayContaining(["/T", "/F", "4242"]));
      // ② 每个候选之后都重新清锁（否则下一个候选直接死在锁上）
      const cleans = shellMocks.create.mock.calls.filter((c: unknown[]) => isLockScript(c[0], c[1]));
      expect(cleans.length).toBeGreaterThan(1);
      // ③ 错误信息仍可读
      expect(err.message).toContain("仍无端口");
    } finally {
      vi.useRealTimers();
    }
  });
});
