// ============================================================
// dsh 引擎生命周期管理：扫描已有实例复用 / spawn 兜底 / 健康检查 / 停止
//
// 关键设计：**绝不双开**。用户网页版 dsh web 正在跑时，GUI 直接复用其
// 端口（HTTP + WebSocket 全走同一实例），避免争抢 ~/.dsh 会话存储。
// 仅当无任何实例时才 spawn 一个兜底实例。
//
// spawn 调用链（Windows 原生 exe 兼容）：
//   1. node + bin.js 绝对路径（pnpm 安装的真实入口，已验证可执行）
//   2. `dsh`（PATH 里的 shim，git-bash 环境下可用）
//   3. `dsh.cmd`（npm 的 cmd shim）
// ============================================================
import { Command, type Child } from "@tauri-apps/plugin-shell";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { exists, writeTextFile } from "@tauri-apps/plugin-fs";
import type { EngineHealth } from "./types";

/** 诊断日志（落盘 %TEMP%\dsh-spawn.log；WebView console 不输出到终端，靠文件看错误） */
const DIAG_LOG = "C:\\Users\\vista\\AppData\\Local\\Temp\\dsh-spawn.log";
let diagBuf = "";
function diag(...parts: unknown[]) {
  diagBuf += `[${new Date().toISOString()}] ${parts.map((p) => (typeof p === "string" ? p : JSON.stringify(p))).join(" ")}\n`;
  if (diagBuf.length > 20_000) diagBuf = diagBuf.slice(-10_000);
  try {
    void writeTextFile(DIAG_LOG, diagBuf).catch(() => {});
  } catch {
    /* diag best-effort */
  }
  console.log("[dsh-diag]", ...parts);
}

/** 统一 fetch：Tauri 环境走 plugin-http（无 CORS），浏览器环境回退原生 fetch */
async function httpFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  try {
    return await tauriFetch(input as never, init as never);
  } catch {
    return fetch(input, init);
  }
}

const DEFAULT_PORT = 17800;
/** 用户可能已在跑的 dsh web 常见端口（网页版实际端口以进程为准） */
const KNOWN_DHS_PORTS = [3080, 8080, 8081, 3000, 5173, 17800, 18080];
const MAX_START_WAIT_MS = 30_000;

/** pnpm 安装的真实 bin.js（本机东哥路径，MSYS 下 pnpm 把 /c/ 写成 C:\c\，路径自洽） */
const DSH_BIN_JS =
  "C:\\c\\Users\\vista\\AppData\\Local\\pnpm\\global\\5\\.pnpm\\@deepseek-ai+dsh@0.1.0-rc.6_4b02b31f4347d42e02dd8ae2631af2b2\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js";

/** npm 自带 npx-cli.js（新用户零安装兜底：npx --yes @deepseek-ai/dsh 自动下载） */
const NPX_CLI_JS = "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npx-cli.js";

/** 候选启动命令（按优先级）：
 * 直接 spawn 简单命令名（capabilities 的 shell:allow-execute 里用
 * `cmd` 字段映射绝对路径，如 name=node → C:\Program Files\nodejs\node.exe）。
 * 注意：不要用 cmd.exe /C 包装——cmd 的引号转义会破坏含空格路径；
 * 也不要传绝对路径给 Command.create（Tauri 按 name 匹配权限）。
 * 1. node + 本机已装 bin.js（最快，零下载）
 * 2. node + npx-cli.js --yes @deepseek-ai/dsh（新用户开箱：自动下载引擎）
 * 3. `dsh`（PATH 里的 shim）
 * 4. `dsh.cmd`（npm 的 cmd shim）
 */
function candidateCommands(args: string[]): Array<[string, string[]]> {
  return [
    ["node", [DSH_BIN_JS, ...args]],
    ["node", [NPX_CLI_JS, "--yes", "@deepseek-ai/dsh", ...args]],
    ["dsh", args],
    ["dsh.cmd", args],
  ];
}

/** 环境探测：node / npx / 本机 dsh bin.js 是否可用（供启动页展示给新用户） */
export interface DshEnvironment {
  nodeAvailable: boolean;
  npxAvailable: boolean;
  localDshAvailable: boolean;
  nodeVersion: string;
}

export async function checkEnvironment(): Promise<DshEnvironment> {
  const env: DshEnvironment = {
    nodeAvailable: false,
    npxAvailable: false,
    localDshAvailable: false,
    nodeVersion: "",
  };
  // 用文件系统探测（fs.exists），不依赖 shell PATH 解析——
  // Command.create("node") 在 Tauri WebView 里可能因 PATH 差异失败导致误报缺失。
  try {
    const nodeExe = await exists("C:\\Program Files\\nodejs\\node.exe");
    env.nodeAvailable = nodeExe;
    env.nodeVersion = nodeExe ? "已安装" : "";
  } catch {
    /* fs unavailable */
  }
  try {
    env.npxAvailable = await exists(NPX_CLI_JS);
  } catch {
    /* fs unavailable */
  }
  try {
    env.localDshAvailable = await exists(DSH_BIN_JS);
  } catch {
    /* fs unavailable */
  }
  // 若 fs 探测失败（如浏览器环境），退回 shell 探测
  if (!env.nodeAvailable && !env.npxAvailable && !env.localDshAvailable) {
    try {
      const c = Command.create("node", ["--version"]);
      const out = await c.execute();
      env.nodeVersion = (out.stdout || out.stderr || "").trim();
      env.nodeAvailable = /^v?\d+\.\d+/.test(env.nodeVersion);
    } catch {
      /* node missing */
    }
    try {
      const c = Command.create("node", [NPX_CLI_JS, "--version"]);
      const out = await c.execute();
      env.npxAvailable = /^\d+\.\d+/.test((out.stdout || out.stderr || "").trim());
    } catch {
      /* npx missing */
    }
    try {
      const c = Command.create("node", [DSH_BIN_JS, "--version"]);
      const out = await c.execute();
      env.localDshAvailable = /^\d+\.\d+/.test((out.stdout || out.stderr || "").trim());
    } catch {
      /* local dsh missing */
    }
  }
  return env;
}

/** 一键安装 Node.js LTS（winget，Windows 10 1809+ 自带） */
export async function installNode(): Promise<{ ok: boolean; output: string }> {
  try {
    const c = Command.create("winget", [
      "install",
      "--id", "OpenJS.NodeJS.LTS",
      "--silent",
      "--accept-package-agreements",
      "--accept-source-agreements",
      "--disable-interactivity",
    ]);
    const out = await c.execute();
    return { ok: out.code === 0, output: (out.stdout || out.stderr || "").slice(-300) };
  } catch (e) {
    return { ok: false, output: e instanceof Error ? e.message : String(e) };
  }
}

/** 一键安装 dsh（npm 全局） */
export async function installDsh(): Promise<{ ok: boolean; output: string }> {
  try {
    const c = Command.create("npm", ["install", "-g", "@deepseek-ai/dsh"]);
    const out = await c.execute();
    return { ok: out.code === 0, output: (out.stdout || out.stderr || "").slice(-300) };
  } catch (e) {
    return { ok: false, output: e instanceof Error ? e.message : String(e) };
  }
}

let child: Child | null = null;
let currentPort = DEFAULT_PORT;
let listeners = new Set<(h: EngineHealth) => void>();

function emit(health: EngineHealth) {
  listeners.forEach((fn) => {
    try {
      fn(health);
    } catch {
      /* noop */
    }
  });
}

/** 订阅引擎健康状态变化 */
export function onEngineHealth(fn: (h: EngineHealth) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 探测端口是否已有 dsh web 服务在跑（根路径含 __DSH_BOOT__ 即 dsh）
 * 必须用 plugin-http fetch（WebView2 跨源被 CORS 拦截，原生 fetch 恒失败）
 */
export async function probePort(port: number, timeoutMs = 1500): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await httpFetch(`http://127.0.0.1:${port}/`, {
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timer);
    if (!res.ok) return false;
    const text = await res.text().catch(() => "");
    return text.includes("__DSH_BOOT__");
  } catch {
    return false;
  }
}

/** 扫描用户已有 dsh web 实例（网页版正在跑的话直接复用，避免双实例抢 ~/.dsh） */
export async function findExistingInstance(): Promise<number | null> {
  const results = await Promise.all(
    KNOWN_DHS_PORTS.map((p) => probePort(p, 900).then((ok) => (ok ? p : null))),
  );
  return results.find((p) => p !== null) ?? null;
}

/** 找一个空闲端口 */
export async function findFreePort(start: number): Promise<number> {
  for (let p = start; p < start + 50; p++) {
    if (!(await probePort(p))) return p;
  }
  return start + 99;
}

/** 读取 dsh 版本（一次调用，缓存；多级回退） */
let versionCache: string | null = null;
export async function getDshVersion(): Promise<string> {
  if (versionCache) return versionCache;
  for (const [prog, cmdArgs] of candidateCommands(["--version"])) {
    try {
      const c = Command.create(prog, cmdArgs);
      const out = await c.execute();
      const v = out.stdout?.trim() || out.stderr?.trim();
      if (v && /v?\d+\.\d+/.test(v)) {
        versionCache = v;
        return v;
      }
    } catch {
      /* try next candidate */
    }
  }
  versionCache = "unknown";
  return versionCache;
}

/**
 * 启动 dsh web 引擎。
 * 安全策略：先扫描用户已有实例（网页版 dsh 正在跑则直接复用，绝不 spawn 第二个
 * 实例——双实例会争抢 ~/.dsh 的会话存储，可能破坏正在运行的任务）。
 */
export async function startEngine(preferredPort = DEFAULT_PORT): Promise<EngineHealth> {
  // 1. 扫描并复用已有实例（用户网页版正在跑的端口优先）
  const existing = await findExistingInstance();
  if (existing !== null) {
    currentPort = existing;
    const h: EngineHealth = { status: "running", port: currentPort, url: `http://127.0.0.1:${currentPort}` };
    emit(h);
    return h;
  }

  // 2. 指定端口已有则复用（用户可能刚好用了默认端口）
  if (await probePort(preferredPort, 800)) {
    currentPort = preferredPort;
    const h: EngineHealth = { status: "running", port: currentPort, url: `http://127.0.0.1:${currentPort}` };
    emit(h);
    return h;
  }

  // 3. 无已有实例：探测空闲端口并 spawn（多级候选命令）
  const port = await findFreePort(preferredPort);
  currentPort = port;
  emit({ status: "starting", port, url: `http://127.0.0.1:${port}` });

  const args = ["--profile", "web", "--port", String(port), "--host", "127.0.0.1"];

  for (const [prog, cmdArgs] of candidateCommands(args)) {
    diag("尝试候选:", prog, cmdArgs);
    try {
      const c = Command.create(prog, cmdArgs);
      c.stdout.on("data", (line) => {
        console.log("[dsh]", line);
      });
      c.stderr.on("data", (line) => {
        console.error("[dsh]", line);
      });
      child = await c.spawn();
      diag("spawn 成功:", prog, "pid=", child.pid);

      // 等待健康
      const deadline = Date.now() + MAX_START_WAIT_MS;
      while (Date.now() < deadline) {
        if (await probePort(port, 600)) {
          const h: EngineHealth = { status: "running", port, url: `http://127.0.0.1:${port}` };
          emit(h);
          return h;
        }
        await new Promise((r) => setTimeout(r, 400));
      }
      diag("候选超时:", prog);
      // 该候选启动超时：杀掉并试下一个
      try {
        await child.kill();
      } catch {
        /* already dead */
      }
      child = null;
    } catch (e) {
      diag("spawn 失败:", prog, String(e));
      console.warn(`[dsh] spawn candidate failed: ${prog}`, e);
    }
  }

  const msg = `dsh web 启动失败：所有候选命令均无法启动（请在 git-bash 中执行 pnpm install -g @deepseek-ai/dsh 后重试）`;
  emit({ status: "error", port, url: `http://127.0.0.1:${port}`, error: msg });
  throw new Error(msg);
}

/** 停止引擎（仅当实例由本应用 spawn 时才有意义；复用用户实例时不停止） */
export async function stopEngine(): Promise<void> {
  if (child) {
    try {
      await child.kill();
    } catch {
      /* already dead */
    }
    child = null;
  }
  emit({ status: "stopped", port: currentPort, url: `http://127.0.0.1:${currentPort}` });
}

/** 当前端口 */
export function getEnginePort(): number {
  return currentPort;
}
