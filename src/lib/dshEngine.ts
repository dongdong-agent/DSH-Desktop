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
import { exists, readDir, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { appDataDir, homeDir } from "@tauri-apps/api/path";
import { compareVersions, kernelRootDir, normalizeDshVersion, runCommand } from "./updater";
import { readCredentials } from "./credentials";
import { ensureEnginePatchFile } from "./enginePatch";
import type { EngineHealth } from "./types";

/** 诊断日志（落盘系统临时目录 dsh-spawn.log；WebView console 不输出到终端，靠文件看错误） */
const DIAG_LOG = "C:\\Windows\\Temp\\dsh-spawn.log";
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
/**
 * 单个候选命令的最长等待时间。
 *
 * 为什么从 30s 拉长（2026-09-14 实测坐实的根因）：引擎**首次启动**要执行
 * `healProfilesModuleFallback`（修复 profiles 的 node_modules，本质是长任务；对照 updater.ts
 * 里同类 npm 操作给了 20 分钟）。旧值 30s 会在 heal 中途把引擎 kill 掉，而引擎此时**可能正持有**
 * `~/.dsh/profiles/node_modules.lock` —— 被杀后锁不释放，残留锁让之后**每一次**启动都抛
 * `atomic-write: timed out waiting for the writer lock`，界面表现为「所有候选命令均无法启动」，
 * 且用户按提示重装引擎完全无效（重装不解决锁）。
 *
 * 拉长不会让"真失败"变慢：候选进程**退出**会被立即感知（见 startEngine 里的 close/error 监听），
 * 只有"进程还活着"才继续等——活着就说明它还在干活，不该打断它。
 *
 * 再放宽（180s → **600s**）：2026-09-14 现场实测，冷缓存下首次 heal 的依赖安装**跑满 180s 仍未完成**
 * （`~/.dsh/profiles/node_modules` 正在逐个落包，最后写入时刻恰是超时那一刻）；把安装打断除了留锁，
 * 还会让下一次启动**从零重来**，形成"永远装不完"的循环。装完一次之后（包已缓存）实测 **15~60s** 即可就绪，
 * 所以这个上限只影响"真正的第一次"。
 */
const MAX_START_WAIT_MS = 600_000;

/** npm 自带 npx-cli.js（新用户零安装兜底：npx --yes @deepseek-ai/dsh 自动下载） */
const NPX_CLI_JS = "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npx-cli.js";

/**
 * 已验版本清单：与当前 GUI 协议 / 自装插件验证过兼容的引擎版本。
 * 官方发新内核后，新版本不在清单里 → UI 会提示「新内核未验证」并可一键回滚到本清单中
 * 最后一个版本；确认新版本兼容后，UI 点「标记已验证」即可追加（写入配置文件
 * %APPDATA%\com.dsh.desktop\verified-versions.json，无需改代码重新打包）。
 * 配置文件不存在/损坏时回退内置默认清单。
 */
const DEFAULT_VERIFIED_VERSIONS = ["0.1.0-rc.7"];

/** 已验证版本白名单（内存缓存：启动时从配置文件加载，运行时可追加） */
let verifiedVersions: string[] = [...DEFAULT_VERIFIED_VERSIONS];

/** 白名单配置文件路径（JSON 字符串数组）——appDataDir 无尾斜杠，必须显式补分隔符 */
async function verifiedVersionsPath(): Promise<string> {
  return `${(await appDataDir()).replace(/\\+$/, "")}\\verified-versions.json`;
}

/** 从配置文件加载白名单（应用启动时调用一次；失败/不存在时用内置默认） */
export async function loadVerifiedVersions(): Promise<string[]> {
  try {
    const raw = await readTextFile(await verifiedVersionsPath());
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) {
      verifiedVersions = parsed.map((s) => normalizeDshVersion(s));
      return [...verifiedVersions];
    }
  } catch {
    /* 配置文件缺失/损坏 → 默认清单 */
  }
  verifiedVersions = [...DEFAULT_VERIFIED_VERSIONS];
  return [...verifiedVersions];
}

/** 把版本追加进白名单（更新内存 + 写配置文件；写失败不阻断本次生效） */
export async function addVerifiedVersion(v: string): Promise<string[]> {
  const norm = normalizeDshVersion(v);
  if (!verifiedVersions.includes(norm)) verifiedVersions.push(norm);
  try {
    await writeTextFile(await verifiedVersionsPath(), JSON.stringify(verifiedVersions, null, 2));
  } catch {
    /* 写失败仅影响下次启动（回退默认），内存清单照常生效 */
  }
  return [...verifiedVersions];
}

/** 固定引擎版本：null = 跟随官方最新（默认）；非 null = 只使用该版本 */
let pinnedVersion: string | null = null;

/** 固定引擎到指定版本（null 恢复跟随最新） */
export function pinEngineVersion(v: string | null): void {
  pinnedVersion = v;
  versionCache = null; // 版本缓存失效，下次重新探测
  dshBinJsCache = undefined; // bin.js 探测结果随版本变化，一并失效
}

export function getPinnedEngineVersion(): string | null {
  return pinnedVersion;
}

/** 该版本是否在已验证兼容清单里（版本号先归一化，避免 v 前缀导致误判未验证） */
export function isVerifiedVersion(v: string): boolean {
  return verifiedVersions.includes(normalizeDshVersion(v));
}

/** 回滚目标：已验证清单最后一个版本 */
export function rollbackVersion(): string | null {
  return verifiedVersions.length > 0 ? verifiedVersions[verifiedVersions.length - 1] : null;
}
/** 候选启动命令（按优先级）：
 * 直接 spawn 简单命令名（capabilities 的 shell:allow-execute 里用
 * `cmd` 字段映射绝对路径，如 name=node → C:\Program Files\nodejs\node.exe）。
 * 1. node + 本机已装 bin.js（运行时探测 pnpm 全局目录，最快零下载）
 * 2. node + npx-cli.js --yes @deepseek-ai/dsh（新用户开箱：自动下载引擎）
 * 3. `dsh`（PATH 里的 shim）
 * 4. `dsh.cmd`（npm 的 cmd shim）
 */

/** 运行时探测 dsh bin.js（candidateCommands 的最高优先级）：
 *  1. GUI 托管内核目录 %APPDATA%\com.dsh.desktop\kernel\<ver>\...（版本并存，优先最高/指定版本）
 *  2. 本机 pnpm 全局目录 @deepseek-ai+dsh@*（用户手动 pnpm add -g 的版本）
 *  targetVersion 省略 → 探测「当前最优」版本（结果缓存）；
 *  给定 → 精确匹配该版本（pin/回滚时使用，不命中缓存）。
 */
let dshBinJsCache: string | null | undefined;
async function findDshBinJs(targetVersion?: string | null): Promise<string | null> {
  if (targetVersion == null && dshBinJsCache !== undefined) return dshBinJsCache;
  if (targetVersion == null) dshBinJsCache = null;
  try {
    // 1) GUI 托管内核目录（版本并存：已装版本里选最高，或精确指定版本）
    try {
      const root = await kernelRootDir();
      diag("findDshBinJs 内核目录探测:", root);
      if (await exists(root).catch(() => false)) {
        const entries = await readDir(root).catch(() => []);
        diag("内核目录 readDir 条目:", entries.length, entries.map((e) => `${e.name}(dir=${e.isDirectory})`).join(", "));
        const dirs = entries.filter((e) => e.isDirectory && /^\d+\.\d+\.\d+/.test(e.name));
        if (targetVersion) {
          if (dirs.some((d) => d.name === targetVersion)) {
            const bin = `${root}\\${targetVersion}\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js`;
            if (await exists(bin).catch(() => false)) return bin;
            diag("精确版本 bin.js 不存在:", bin);
          }
        } else {
          // 版本目录按高→低排序，取第一个真正含 bin.js 的目录。
          // 必须有这一层校验：内核升级被中断时会留下「只有空目录、没有 bin.js」的半成品，
          // 旧实现取最高版本后一旦 bin.js 缺失就直接放弃，白名单里可用的版本反而用不上。
          const sorted = dirs.map((d) => d.name).sort((a, b) => compareVersions(b, a));
          for (const ver of sorted) {
            const bin = `${root}\\${ver}\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js`;
            if (await exists(bin).catch(() => false)) {
              diag("选中内核版本:", ver, "bin:", bin);
              dshBinJsCache = bin;
              return bin;
            }
            diag("内核目录缺少 bin.js，跳过:", ver, bin);
          }
        }
      } else {
        diag("内核目录不存在（exists=false）:", root);
      }
    } catch (e) {
      diag("内核目录分支异常:", String(e));
    }

    // 2) 本机 pnpm 全局目录（Tauri 环境：homeDir() 返回当前用户主目录，跨用户通用）
    // 注意：homeDir() 不带尾反斜杠（dirs crate），且 Windows 上 pnpm 装在 MSYS 路径变体
    // C:\c\Users\<user>\...（真实存在）——两处候选都要拼对用户名，否则探测静默失败
    const home = (await homeDir().catch(() => "")) || "";
    const userName = home.split(/[\\/]/).filter(Boolean).pop() ?? "";
    const candidates = home
      ? [
          `${home.replace(/\\$/, "")}\\AppData\\Local\\pnpm\\global\\5\\.pnpm`,
          `C:\\c\\Users\\${userName}\\AppData\\Local\\pnpm\\global\\5\\.pnpm`,
        ]
      : [];
    for (const base of candidates) {
      try {
        if (await exists(base)) {
          // 扫描 @deepseek-ai+dsh@* 目录（pin 时只匹配对应版本目录）
          const entries = await readDir(base).catch(() => []);
          const dshDir = targetVersion
            ? entries.find((e) => e.name.startsWith(`@deepseek-ai+dsh@${targetVersion}_`))
            : entries.find((e) => e.name.startsWith("@deepseek-ai+dsh@"));
          if (dshDir) {
            const bin = `${base}\\${dshDir.name}\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js`;
            if (await exists(bin).catch(() => false)) {
              if (targetVersion == null) dshBinJsCache = bin;
              return bin;
            }
          }
        }
      } catch {
        /* skip candidate */
      }
    }
  } catch {
    /* env unavailable */
  }
  return null;
}

/** 受管存储凭据清单：启动引擎时为这些键注入受管存储里的真值。
 *
 * 背景：引擎凭据优先级是「进程环境变量 > 受管存储 > .env」。
 * 若用户级/系统级环境里残留同名变量（如 KeySwitch 的 env_var 适配器写入的
 * OPENCODE_GO_API_KEY），GUI 面板写入受管存储会被静默遮蔽——改 key 不生效。
 *
 * 早期实现是把它们一律置空来保证受管存储生效，但引擎派生的 MCP 子进程
 * （agnes-mcp / rkapi-mcp 等）只认环境变量、不读受管存储，一律置空会让它们
 * 启动即失败。现在改为「受管存储有值就写真值，无值才置空」：残留的遮蔽值仍被
 * 覆盖（受管存储依旧是唯一取值源），只读环境变量的子进程也能拿到可用密钥。 */
const MANAGED_CREDENTIAL_KEYS = [
  "OPENCODE_GO_API_KEY",
  "DEEPSEEK_API_KEY",
  "AGNES_API_KEY",
  "RKAPI_API_KEY",
  "VOLCENGINE_API_KEY",
  "WECOM_BOT_SECRET",
  "OPENROUTER_API_KEY",
];

/** 解析 spawn 引擎时要注入的凭据环境变量（读不到受管存储时全部置空） */
export async function managedCredentialEnv(): Promise<Record<string, string>> {
  const stored = await readCredentials().catch(() => []);
  const byKey = new Map(stored.map((e) => [e.key, e.value]));
  const env: Record<string, string> = {};
  for (const key of MANAGED_CREDENTIAL_KEYS) env[key] = byKey.get(key)?.trim() ?? "";
  return env;
}

/**
 * 清理 `~/.dsh/profiles` 下**残留的写锁**（stale writer lock）的 node 脚本。
 *
 * 背景：引擎启动要执行 `healProfilesModuleFallback`（修 profiles 的 node_modules），须先获取
 * `~/.dsh/profiles/node_modules.lock`。GUI 旧实现 30s 等不到端口就 `child.kill()`，引擎**持锁时被
 * 杀** → 锁不释放 → 之后所有实例启动都抛 `atomic-write: timed out waiting for the writer lock`
 * 并退出 → 表现为「所有候选命令均无法启动」。
 *
 * 判据**宁可少删不可误删**：只处理 `*.lock`；内容须是**合法正整数 PID**（不是数字的可能正在被写，
 * 不动、只记名）；只有「PID 对应进程已不存在」才删——活着的锁绝不碰（可能是别的引擎正在 heal）。
 * `process.kill(pid, 0)` 在 Windows 上：进程不存在抛 ESRCH，无权限抛 EPERM（= 进程存在）。
 */
const LOCK_CLEAN_SCRIPT = [
  'const fs=require("fs"),path=require("path"),os=require("os");',
  'const dir=path.join(os.homedir(),".dsh","profiles");',
  "const out={checked:0,removed:[],alive:[],skipped:[]};",
  "let names=[];",
  "try{names=fs.readdirSync(dir)}catch(e){console.log(JSON.stringify(out));process.exit(0)}",
  "for(const n of names){",
  "  if(!/\\.lock$/i.test(n))continue;",
  "  out.checked++;",
  "  const p=path.join(dir,n);",
  "  let pid=NaN;",
  '  try{pid=parseInt(String(fs.readFileSync(p,"utf8")).trim(),10)}catch(e){}',
  "  if(!(pid>0)){out.skipped.push(n);continue}",
  "  let alive=false;",
  '  try{process.kill(pid,0);alive=true}catch(e){alive=!!(e&&e.code==="EPERM")}',
  '  if(alive){out.alive.push(n+"@"+pid);continue}',
  '  try{fs.unlinkSync(p);out.removed.push(n+"@"+pid)}catch(e){out.skipped.push(n)}',
  "}",
  "console.log(JSON.stringify(out));",
].join("\n");

export interface StaleLockCleanupResult {
  /** 扫到的 `*.lock` 数量 */
  checked: number;
  /** 判定为残留并删除的（`文件名@PID`） */
  removed: string[];
  /** 持有者仍存活、**故意没动**的 */
  alive: string[];
  /** 内容不是合法 PID（可能正在被写）而跳过的 */
  skipped: string[];
}

/**
 * 执行一次残留锁自愈（见 `LOCK_CLEAN_SCRIPT` 注释）。
 *
 * 为什么走 node 子进程而不是 Tauri fs API：capabilities 里 `fs:allow-remove` /
 * `fs:allow-read-dir` / `fs:allow-exists` 都**不覆盖 `~/.dsh`**（只有 allow-read-text-file 覆盖），
 * 扩 scope 等于放宽安全边界；而锁本来就是给引擎（node 进程）看的，用 node 处理最自然。
 *
 * **任何异常都降级为"没清理"，绝不阻断启动**（与外观/引擎的既有容错口径一致）。
 */
export async function clearStaleProfileLocks(): Promise<StaleLockCleanupResult> {
  const empty: StaleLockCleanupResult = { checked: 0, removed: [], alive: [], skipped: [] };
  try {
    const out = await runCommand("node", ["-e", LOCK_CLEAN_SCRIPT], 10_000);
    const raw = (out.stdout || "").trim().split(/\r?\n/).filter(Boolean).pop() ?? "";
    if (!raw) {
      diag("残留锁清理：无输出（node 不可用或脚本未执行）code=", out.code, out.stderr.slice(0, 200));
      return empty;
    }
    const parsed = JSON.parse(raw) as Partial<StaleLockCleanupResult>;
    const result: StaleLockCleanupResult = {
      checked: Number(parsed.checked) || 0,
      removed: Array.isArray(parsed.removed) ? parsed.removed : [],
      alive: Array.isArray(parsed.alive) ? parsed.alive : [],
      skipped: Array.isArray(parsed.skipped) ? parsed.skipped : [],
    };
    // 只在"确实扫到了锁"时记日志，避免每次正常启动都刷一行噪声
    if (result.checked > 0) diag("残留锁清理:", JSON.stringify(result));
    if (result.removed.length > 0) {
      console.warn("[dsh] 已清理残留写锁（上次引擎被强杀导致）:", result.removed.join(", "));
    }
    return result;
  } catch (e) {
    diag("残留锁清理异常（忽略，不阻断启动）:", String(e).slice(0, 200));
    return empty;
  }
}

function candidateCommands(args: string[], localBin: string | null): Array<[string, string[]]> {
  const cmds: Array<[string, string[]]> = [];
  // 若探测到 bin.js，作为最高优先级。
  // 注：localBin 由 findDshBinJs(pinnedVersion) 传入——pin 了版本时已精确匹配该版本的
  // bin.js（GUI 内核目录 / pnpm 全局对应版本），修复了旧实现「本地旧版本永远遮蔽
  // pin/npx 兜底、回滚不生效」的问题。
  if (localBin) {
    cmds.unshift(["node", [localBin, ...args]]);
  }
  // npx 兜底：默认跟随官方最新；若 pin 了版本，则固定到 @deepseek-ai/dsh@<version>
  const npxPkg = pinnedVersion ? `@deepseek-ai/dsh@${pinnedVersion}` : "@deepseek-ai/dsh";
  cmds.push(["node", [NPX_CLI_JS, "--yes", npxPkg, ...args]]);
  cmds.push(["dsh", args]);
  cmds.push(["dsh.cmd", args]);
  return cmds;
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
    env.localDshAvailable = (await findDshBinJs()) !== null;
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
      const localBin = await findDshBinJs();
      if (localBin) {
        const c = Command.create("node", [localBin, "--version"]);
        const out = await c.execute();
        env.localDshAvailable = /^\d+\.\d+/.test((out.stdout || out.stderr || "").trim());
      }
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

/** 一键安装 dsh（npm 全局）。Windows 上 npm 是 .cmd 批处理，spawn 必须带扩展名 */
export async function installDsh(): Promise<{ ok: boolean; output: string }> {
  try {
    const c = Command.create("npm.cmd", ["install", "-g", "@deepseek-ai/dsh"]);
    const out = await c.execute();
    return { ok: out.code === 0, output: (out.stdout || out.stderr || "").slice(-300) };
  } catch (e) {
    return { ok: false, output: e instanceof Error ? e.message : String(e) };
  }
}

let child: Child | null = null;
let currentPort = DEFAULT_PORT;
const listeners = new Set<(h: EngineHealth) => void>();

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
    // 引擎 ≥0.1.5 起 web 端启用浏览器会话鉴权：不带会话 Cookie 的请求一律 401
    // （正文为 "dsh web authentication required"）。401 同样证明该端口上 dsh web
    // 已经监听，不能判成「没有实例」——否则探测恒失败，启动流程会空转超时。
    if (res.status === 401) {
      diag("probePort 401（引擎已监听但需会话鉴权）:", port);
      return true;
    }
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

/** 版本探测缓存清理（pin 切换后调用） */
export function clearDshVersionCache(): void {
  versionCache = null;
}

/** 读取 dsh 版本（一次调用，缓存；多级回退）。pin 了版本时探测的是被 pin 的版本。
 * 每个候选命令限时 15s（runCommand 超时会 kill 子进程）——实测 npx 兜底在 Windows
 * 无缓存时会触发 npm 下载 dsh 依赖树（504 包）死循环，不限时 GUI 会永久卡在检测中。 */
const VERSION_PROBE_TIMEOUT_MS = 15_000;
let versionCache: string | null = null;
export async function getDshVersion(): Promise<string> {
  if (versionCache) return versionCache;
  const localBin = await findDshBinJs(pinnedVersion);
  for (const [prog, cmdArgs] of candidateCommands(["--version"], localBin)) {
    const out = await runCommand(prog, cmdArgs, VERSION_PROBE_TIMEOUT_MS);
    const v = out?.stdout?.trim() || out?.stderr?.trim() || "";
    if (out.code === 0 && v && /v?\d+\.\d+/.test(v)) {
      versionCache = v;
      return v;
    }
    if (out.code !== 0) {
      diag("版本探测候选失败:", prog, cmdArgs[0], "code=", out.code, out.stderr.slice(0, 200));
    }
  }
  versionCache = "unknown";
  return versionCache;
}

/**
 * 组装引擎启动参数。
 * @param port 监听端口
 * @param patchPath 覆盖层绝对路径（null 表示不带覆盖层）
 * @returns argv 数组
 *
 * 顺序有语义：`--patch` 是 dsh 的**父级**选项，`--port/--host` 属于 web app
 * 自己的参数（commander 的 passThroughOptions 会把它们之后的内容原样转交），
 * 因此父级选项必须排在前面。
 */
export function buildEngineArgs(port: number, patchPath: string | null): string[] {
  return [
    "--profile",
    "web",
    ...(patchPath === null ? [] : ["--patch", patchPath]),
    "--port",
    String(port),
    "--host",
    "127.0.0.1",
  ];
}

/**
 * 强杀一个进程**及其整棵子树**。
 *
 * 为什么不能只用 `child.kill()`：Windows 上它只终止直接子进程，引擎派生的工作进程会存活，
 * 并继续持有 `~/.dsh/profiles/node_modules.lock` —— 于是**下一个候选**必然卡在
 * `atomic-write: timed out waiting for the writer lock`。
 * （2026-09-14 实测：候选 1 被 kill 后，候选 2 / 4 全部因锁失败，日志里 `pid=3136` 的进程
 * 在超时后仍活着持锁。）
 *
 * 用 `taskkill /T /F`（capabilities 已声明 taskkill）。杀完调用方**必须再清一次残留锁**
 * ——强杀时引擎来不及释放锁（见 startEngine 超时分支里的 clearStaleProfileLocks）。
 */
async function killProcessTree(pid: number | undefined): Promise<void> {
  if (typeof pid !== "number" || !Number.isFinite(pid) || pid <= 0) return;
  try {
    await Command.create("taskkill", ["/PID", String(pid), "/T", "/F"]).execute();
  } catch {
    /* 进程可能已退出（taskkill 对不存在的 PID 返回非 0） */
  }
  // taskkill 返回 ≠ 句柄已回收：给内核一点时间真正退出，避免"锁的持有者还活着"导致清锁被拒
  await new Promise((r) => setTimeout(r, 800));
}

/**
 * 启动 dsh web 引擎。
 * 安全策略：先扫描用户已有实例（网页版 dsh 正在跑则直接复用，绝不 spawn 第二个
 * 实例——双实例会争抢 ~/.dsh 的会话存储，可能破坏正在运行的任务）。
 */
/**
 * 启动引擎。
 * @param preferredPort 首选端口
 * @param force 强制启动：跳过「复用已有实例」探测（restartEngine 专用——先杀旧进程再传 true，
 *   否则 findExistingInstance 会命中还在跑的旧实例直接复用，等于没重启）
 */
export async function startEngine(preferredPort = DEFAULT_PORT, force = false): Promise<EngineHealth> {
  if (!force) {
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
  }

  // 3. 无已有实例：探测空闲端口并 spawn（多级候选命令）
  const port = force ? currentPort || preferredPort : await findFreePort(preferredPort);
  currentPort = port;
  emit({ status: "starting", port, url: `http://127.0.0.1:${port}` });

  // 3.5 **启动前自愈**：清掉上一次引擎被强杀留下的残留写锁。
  // 少了这一步，残留锁会让**每一个**候选都卡在 "timed out waiting for the writer lock" 而失败，
  // 界面表现为「所有候选命令均无法启动」。（幂等、只删死进程持有的锁，见 clearStaleProfileLocks）
  await clearStaleProfileLocks();

  // 启动覆盖层：把工作区目录选择固定为应用内 browse 选择器（原生选择框没有
  // owner 窗口，宽屏上会跑到应用窗口之外且不置顶）。写盘失败则退化为无覆盖层。
  const patchPath = await ensureEnginePatchFile();
  if (patchPath === null) diag("覆盖层写入失败，按无覆盖层启动（目录选择回退为原生选择框）");
  const args = buildEngineArgs(port, patchPath);
  // 候选命令共用同一份凭据环境：受管存储有值即写真值（见 MANAGED_CREDENTIAL_KEYS）
  const managedEnv = await managedCredentialEnv();

  /** 每个候选的真实结果——拼进最终错误信息（替代过去那句会把用户带偏的「重装引擎」提示） */
  const attempts: string[] = [];
  /** 引擎最近的输出（stdout+stderr 合并的环形缓冲）——失败时给用户看最后几行真因 */
  const engineTail: string[] = [];
  const pushTail = (line: unknown) => {
    const t = String(line).trim();
    if (!t) return;
    engineTail.push(t.slice(0, 200));
    if (engineTail.length > 30) engineTail.shift();
  };

  for (const [prog, cmdArgs] of candidateCommands(args, await findDshBinJs(pinnedVersion))) {
    diag("尝试候选:", prog, cmdArgs);
    try {
      const c = Command.create(prog, cmdArgs, { env: managedEnv });
      // **进程退出感知**：必须在 spawn 之前注册——毫秒级退出会与 spawn 竞争，事件一旦丢失
      // 就退化成"傻等到 deadline"，这正是旧实现每次硬等满 30s 的原因（引擎其实早就报错退出了）。
      let exited = false;
      c.on("close", ({ code }) => {
        exited = true;
        diag("候选进程退出:", prog, "code=", code);
      });
      c.on("error", (errMsg) => {
        exited = true;
        diag("候选进程 error:", prog, String(errMsg));
      });
      c.stdout.on("data", (line) => {
        pushTail(line);
        console.log("[dsh]", line);
      });
      c.stderr.on("data", (line) => {
        pushTail(line);
        // 引擎的真实错误（如 `atomic-write: timed out waiting for the writer lock`）走 stderr，
        // **必须落进诊断日志**：否则 dsh-spawn.log 里只剩 "spawn 成功 / 候选超时"，真因完全不可见
        // （2026-09-14 排查时最大的障碍就是这条）。
        diag("引擎stderr:", String(line).trim().slice(0, 300));
        console.error("[dsh]", line);
      });
      child = await c.spawn();
      diag("spawn 成功:", prog, "pid=", child.pid);

      // 等待健康：**进程活着就继续等**（首次启动要 heal profiles，可能较久，不该打断）；
      // 进程退出则立即换下一个候选，不再空等满 deadline。
      const deadline = Date.now() + MAX_START_WAIT_MS;
      while (Date.now() < deadline) {
        if (await probePort(port, 600)) {
          const h: EngineHealth = { status: "running", port, url: `http://127.0.0.1:${port}` };
          emit(h);
          return h;
        }
        if (exited) break;
        await new Promise((r) => setTimeout(r, 400));
      }
      if (exited) {
        attempts.push(`${prog}（进程已退出）`);
        diag("候选进程已退出，试下一个:", prog);
      } else {
        attempts.push(`${prog}（等待 ${Math.round(MAX_START_WAIT_MS / 1000)}s 仍无端口）`);
        diag("候选超时:", prog);
        // 超时说明进程**还活着**：必须连子树一起强杀，否则它的子进程会继续持有写锁
        await killProcessTree(child?.pid);
      }
      child = null;
      // 无论"进程自己退出"还是"被我们杀掉"，都可能留下写锁（崩溃 / 强杀时来不及释放）——
      // 不清掉的话，下一个候选会直接死在锁上（2026-09-14 实测的连锁失败）。
      await clearStaleProfileLocks();
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      attempts.push(`${prog}（${why.slice(0, 80)}）`);
      diag("spawn 失败:", prog, why);
      console.warn(`[dsh] spawn candidate failed: ${prog}`, e);
    }
  }

  // 失败信息给**真因**：逐个候选的结果 + 引擎最后几行 + 日志位置。
  // 过去那句「请在 git-bash 中执行 pnpm install -g @deepseek-ai/dsh 后重试」会把人带偏——
  // 实际往往是**本机已装引擎**、真正原因是残留锁或引擎自身报错，重装无效。
  const tail = engineTail.slice(-3).join(" / ");
  const lockHint = /writer lock|timed out waiting/i.test(engineTail.join(" "))
    ? "；引擎在等 ~/.dsh/profiles 的写锁（多为上次引擎被强杀留下的残留锁，本次已尝试自动清理）"
    : "";
  const msg = `dsh web 启动失败：${attempts.join("；")}${lockHint}${tail ? `。引擎最后输出：${tail}` : ""}（完整日志：${DIAG_LOG}）`;
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

/**
 * 强杀占用指定端口的进程（无论它是不是本应用 spawn 的——旧版 GUI / 外部实例都算）。
 * netstat -ano 查 LISTENING 的 PID → taskkill /F；杀完轮询等端口彻底释放（最多 ~6s）。
 * taskkill 参数是 Windows 原样（Tauri Command 不经过 MSYS，/F 不会被转义破坏）。
 */
async function killPortOwner(port: number): Promise<void> {
  try {
    const out = await Command.create("netstat", ["-ano"]).execute();
    const lines = (out.stdout || "").split(/\r?\n/);
    const line = lines.find((l) => l.includes(`:${port}`) && l.includes("LISTENING"));
    const pid = line?.trim().split(/\s+/).pop();
    if (pid && pid !== "0") {
      try {
        await Command.create("taskkill", ["/PID", pid, "/F"]).execute();
      } catch {
        /* 进程可能已退出 */
      }
    }
  } catch {
    /* netstat 不可用（浏览器环境）→ 放弃强杀，仅依赖 child.kill */
  }
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    if (!(await probePort(port, 400))) return;
    await new Promise((r) => setTimeout(r, 200));
  }
}

/**
 * 重启引擎：让配置 / 环境变量 / API Key / 内核版本等改动真正生效。
 *
 * dsh 引擎在**进程启动时**一次性读取环境变量与配置，运行中不会重读。
 * 因此只有把引擎进程真正杀掉再重新 spawn 才会生效。
 *
 * 关键修复（2026-08-22 实测）：旧实现只 kill 自己 spawn 的 child——如果当前引擎是
 * 外部实例（如旧版 GUI 留下的进程），child 为 null，stopEngine 杀不掉它，
 * startEngine 又命中 findExistingInstance 直接复用 → 版本/配置永远不更新。
 * 现在改用 killPortOwner 强杀端口进程（netstat+taskkill，不分内外），
 * 再 force start（跳过复用探测）重新 spawn，真正换内核。
 */
export async function restartEngine(preferredPort = DEFAULT_PORT): Promise<EngineHealth> {
  const targetPort = currentPort || preferredPort;
  emit({ status: "starting", port: targetPort, url: `http://127.0.0.1:${targetPort}` });

  // 1. 停掉自己 spawn 的实例（若有）
  if (child) {
    try {
      await child.kill();
    } catch {
      /* already dead */
    }
    child = null;
  }

  // 2. 强杀占用端口的进程（外部实例/旧 GUI 实例）并等端口释放
  await killPortOwner(targetPort);

  // 3. force 启动：跳过复用探测，用原端口重新 spawn（新 bin.js / 新配置生效）
  return startEngine(targetPort, true);
}

/**
 * 按**指定端口**重启引擎（托盘「重启引擎」专用入口）。
 *
 * 为什么不能直接调 `restartEngine(port)`：它的目标端口取自 `currentPort || preferredPort`，
 * 而壳被托盘导航回来时是**冷加载**，`currentPort` 还是模块默认值 17800；
 * 若引擎实际跑在别的端口（例如复用了用户网页版正在跑的 3080），
 * 那个默认值会赢过入参 —— 结果是旧实例没被杀掉、又在 17800 新起一个，变成双实例
 * （双实例会争抢 `~/.dsh` 会话存储，是本项目明令禁止的状态）。
 * 这里先把端口接管为**事实端口**，再走既有重启链路：清残留写锁 → 强杀端口占用者 → force 启动。
 */
export async function restartEngineOnPort(port: number): Promise<EngineHealth> {
  currentPort = port;
  return restartEngine(port);
}

/** 当前端口 */
export function getEnginePort(): number {
  return currentPort;
}
