// ============================================================
// 引擎内核自更新（GUI 托管版本化内核目录）
//
// 设计：
//   - 检测：GET registry.npmjs.org/@deepseek-ai/dsh/latest（纯 HTTP，不依赖 npm CLI；
//     带 10s 超时与 5 分钟 TTL 缓存，registry 不可达时快速失败并给出友好提示）
//   - 安装：npm install --prefix <内核目录>/<version> @deepseek-ai/dsh@<version>
//     内核目录 = %APPDATA%\com.dsh.desktop\kernel\<version>\（Tauri appDataDir()）
//   - 版本并存：旧内核目录不删除 → 回滚 = 切换目录，秒级完成，不污染 pnpm/npm 全局
//   - 冒烟：装完后 node bin.js --version，从输出中提取版本号与目标版本【精确】比对
//     （字符串 includes 会把 0.1.1-rc.20 误判为 0.1.1-rc.2，必须精确匹配）
//   - 并发安全：installKernel 模块级互斥锁，标题栏升级与状态栏回滚不会同时执行
// ============================================================
import { Command, type Child } from "@tauri-apps/plugin-shell";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { appDataDir, homeDir } from "@tauri-apps/api/path";
import { exists, mkdir, readDir, remove } from "@tauri-apps/plugin-fs";

const DSH_PKG = "@deepseek-ai/dsh";
/** npm registry latest 端点（返回 {"version":"0.1.1-rc.2",...}） */
const REGISTRY_LATEST = "https://registry.npmjs.org/@deepseek-ai/dsh/latest";
/** registry 请求超时（10s：网络断开/被墙时快速失败，不无限转圈） */
const REGISTRY_TIMEOUT_MS = 10_000;
/** registry 最新版缓存 TTL（5 分钟：重复点击检测不重复打 registry，升级成功后立即清除） */
const LATEST_CACHE_TTL_MS = 5 * 60_000;
/** npm install 超时（dsh 依赖树 500+ 包，metadata 拉取阶段实测就要 5-15 分钟——放宽到 20 分钟） */
const INSTALL_TIMEOUT_MS = 20 * 60_000;
/** 冒烟校验（node bin.js --version）超时 */
const SMOKE_TIMEOUT_MS = 30_000;

/** 统一 fetch：Tauri 环境走 plugin-http（走 capabilities http:allow-fetch 白名单），浏览器环境回退原生 fetch */
async function httpFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  try {
    return await tauriFetch(input as never, init as never);
  } catch {
    return fetch(input, init);
  }
}

// ---------- 版本解析与比较 ----------

/** prerelease 档位权重：alpha < beta < rc（npm 语义化顺序） */
const PRERELEASE_RANK: Record<string, number> = { alpha: 1, beta: 2, rc: 3 };
/** dsh 版本号正则：v0.1.0 / 0.1.0-rc.6 / 0.1.1-beta.2 / 0.1.0-rc6（rc 后可省略点号） */
const DSH_VERSION_RE = /^v?\d+\.\d+\.\d+(?:-(?:rc|beta|alpha)\.?\d+)?$/i;

interface ParsedVersion {
  seg: number[];
  pre: { kind: number; num: number } | null;
}

/** 版本号是否为合法的 dsh 版本格式（v 前缀可选，prerelease 支持 rc/beta/alpha） */
export function isValidDshVersion(v: string): boolean {
  return DSH_VERSION_RE.test(v.trim());
}

/** 归一化版本号：去首尾空白与 v 前缀（v0.1.0 → 0.1.0） */
export function normalizeDshVersion(v: string): string {
  return v.trim().replace(/^v/i, "");
}

/** 解析 dsh 版本号（0.1.0-rc.6 / 0.1.1-rc.2 / v0.1.0 / 0.1.0-beta.2） */
function parseDshVersion(v: string): ParsedVersion {
  const s = normalizeDshVersion(v).toLowerCase();
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-(rc|beta|alpha)\.?(\d+))?$/.exec(s);
  if (!m) return { seg: [], pre: null };
  return {
    seg: [Number(m[1]), Number(m[2]), Number(m[3])],
    pre: m[4] !== undefined ? { kind: PRERELEASE_RANK[m[4]], num: Number(m[5]) } : null,
  };
}

/**
 * 语义化比较 dsh 版本：>0 表示 a 更新，<0 表示 b 更新，0 相等。
 * 规则：major.minor.patch 逐段比较 → prerelease 档位（rc>beta>alpha）→ prerelease 数字；
 * 正式版大于同号 rc（0.1.0 > 0.1.0-rc.9）。非法版本回退字符串比较（结果恒为非 NaN）。
 */
export function compareVersions(a: string, b: string): number {
  const pa = parseDshVersion(a);
  const pb = parseDshVersion(b);
  if (pa.seg.length === 0 || pb.seg.length === 0) return a.localeCompare(b);
  for (let i = 0; i < 3; i++) {
    if (pa.seg[i] !== pb.seg[i]) return pa.seg[i] - pb.seg[i];
  }
  // 主版本相同 → 比较 prerelease：正式版（无 prerelease）> 任何 prerelease 版本
  const apre = pa.pre;
  const bpre = pb.pre;
  if (apre && !bpre) return -1;
  if (!apre && bpre) return 1;
  if (!apre && !bpre) return 0;
  // 走到这里两者都非空（前面分支已穷尽 null 组合）——显式收窄让 TS 满意
  if (apre && bpre) {
    if (apre.kind !== bpre.kind) return apre.kind - bpre.kind;
    return apre.num - bpre.num;
  }
  return 0;
}

// ---------- 内核目录 ----------

/**
 * 内核根目录（%APPDATA%\com.dsh.desktop\kernel\）。
 * ⚠️ Tauri 2 的 appDataDir() 返回「无尾反斜杠」的绝对路径（实测 tauri 2.11.5：
 * dirs::data_dir().join(identifier) 的结果不带尾斜杠）——拼接子路径必须显式补分隔符，
 * 否则会拼成 ...\com.dsh.desktopkernel（少一个反斜杠）导致探测静默失败。
 */
export async function kernelRootDir(): Promise<string> {
  return `${(await appDataDir()).replace(/\\+$/, "")}\\kernel`;
}

/** 列出内核目录中已安装的所有版本（按版本号升序；目录损坏/不可读时返回空） */
export async function listInstalledKernels(): Promise<string[]> {
  try {
    const root = await kernelRootDir();
    const entries = await readDir(root).catch(() => []);
    return entries
      .filter((e) => e.isDirectory && isValidDshVersion(e.name))
      .map((e) => normalizeDshVersion(e.name))
      .sort(compareVersions);
  } catch {
    return [];
  }
}

/**
 * 删除指定版本的内核目录（递归）。
 * 注意：任务约定「不删除旧版本内核目录」是指升级流程不自动删（回滚依赖版本并存），
 * 用户显式执行清理时仍可删——调用方必须保证不删当前使用/回滚目标的版本。
 */
export async function removeKernel(version: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const root = await kernelRootDir();
    await remove(`${root}\\${normalizeDshVersion(version)}`, { recursive: true });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 指定版本内核的 bin.js 绝对路径 */
export async function kernelBinPath(version: string): Promise<string> {
  return `${await kernelRootDir()}\\${version}\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js`;
}

/** 该版本是否已装入内核目录（以 bin.js 存在为准） */
export async function isKernelInstalled(version: string): Promise<boolean> {
  try {
    return await exists(await kernelBinPath(version));
  } catch {
    return false;
  }
}

// ---------- 检测 ----------

/** registry 最新版缓存（TTL 内重复点击不重复打 registry） */
let latestCache: { version: string; ts: number } | null = null;

/** 清除 registry 最新版缓存（升级/回滚成功后调用，保证下次检测拿到最新结果） */
export function clearLatestVersionCache(): void {
  latestCache = null;
}

/** 查询 npm registry 上 @deepseek-ai/dsh 的最新版本号（10s 超时 + 5 分钟 TTL 缓存） */
export async function fetchLatestVersion(): Promise<string> {
  if (latestCache && Date.now() - latestCache.ts < LATEST_CACHE_TTL_MS) {
    return latestCache.version;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REGISTRY_TIMEOUT_MS);
  let res: Response;
  try {
    res = await httpFetch(REGISTRY_LATEST, { cache: "no-store", signal: controller.signal });
  } catch (e) {
    // 超时 abort：httpFetch 的回退 fetch 带同一已中止 signal 也会立即抛 → 统一转成友好提示
    if (controller.signal.aborted) throw new Error("请求 npm registry 超时，请检查网络后重试", { cause: e });
    throw e instanceof Error ? e : new Error(String(e), { cause: e });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`npm registry 响应异常（HTTP ${res.status}）`);
  const data = (await res.json()) as { version?: unknown };
  if (typeof data.version !== "string" || !isValidDshVersion(data.version)) {
    throw new Error("npm registry 响应缺少有效的 version 字段");
  }
  latestCache = { version: data.version, ts: Date.now() };
  return data.version;
}

export interface KernelUpdateInfo {
  current: string;
  latest: string;
  hasUpdate: boolean;
}

/**
 * 检测是否有新内核：对比当前版本与 registry latest。
 * 当前版本无法识别（未安装 / 探测失败返回 unknown）时直接抛错，由调用方给出明确提示，
 * 绝不误报「已是最新」（旧实现的坑：unknown 会被字符串比较判成无更新）。
 */
export async function checkForUpdate(currentVersion: string): Promise<KernelUpdateInfo> {
  if (!isValidDshVersion(currentVersion)) {
    throw new Error(`无法识别当前内核版本「${currentVersion}」，请先确认引擎已安装`);
  }
  const latest = await fetchLatestVersion();
  return {
    current: normalizeDshVersion(currentVersion),
    latest,
    hasUpdate: compareVersions(latest, currentVersion) > 0,
  };
}

// ---------- 安装 ----------

/**
 * 带超时地执行一条 shell 命令（spawn + 事件收集输出，超时自动 kill）。
 * 相比 Command.execute()：execute 无超时且无法取消，网络挂起会无限等待
 * （实测：npx 兜底在 Windows 无缓存时会触发 npm 下载 dsh 依赖树死循环，必须限时）。
 * 导出供 dshEngine 的版本探测复用。
 */
export async function runCommand(
  prog: string,
  args: string[],
  timeoutMs: number,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const c = Command.create(prog, args);
    let child: Child | null = null;
    let settled = false;
    let stdout = "";
    let stderr = "";
    // close 事件必须在 spawn 之前注册：命令毫秒级退出时，spawn 的 promise 与 close 可能竞争丢失
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child?.kill();
      } catch {
        /* already dead */
      }
      resolve({ code: -1, stdout, stderr: stderr + `\n命令执行超时（${Math.round(timeoutMs / 1000)}s），已终止` });
    }, timeoutMs);
    c.stdout.on("data", (line) => {
      stdout += line;
    });
    c.stderr.on("data", (line) => {
      stderr += line;
    });
    c.on("close", ({ code }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
    c.on("error", (errMsg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // plugin-shell 的 error 事件载荷是字符串消息（非 Error 对象）
      resolve({ code: -1, stdout, stderr: typeof errMsg === "string" ? errMsg : String(errMsg) });
    });
    c.spawn()
      .then((ch) => {
        if (settled) {
          // 命令已在超时后才返回：立刻回收子进程
          try {
            ch.kill();
          } catch {
            /* already dead */
          }
          return;
        }
        child = ch;
      })
      .catch((e) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        resolve({ code: -1, stdout, stderr: e instanceof Error ? e.message : String(e) });
      });
  });
}

/** 内核安装互斥锁：标题栏升级与状态栏回滚不会同时执行（两个 npm install --prefix 并发会互相破坏） */
let installBusy = false;

/** 当前是否有内核安装任务在跑（UI 可据此禁用入口） */
export function isKernelInstalling(): boolean {
  return installBusy;
}

/**
 * 探测本机可用的包管理器：
 * - pnpm 存在则优先——实测（2026-08-22）npm 11.6.2 + node 24 安装 dsh 依赖树（504 包）会
 *   100% CPU 死循环且永不写 node_modules，pnpm 10 同包 58s 完成；
 * - npm 兜底（其他机器 npm 可能正常）。
 */
async function detectPackageManager(): Promise<"pnpm" | "npm"> {
  try {
    const home = await homeDir().catch(() => "");
    // pnpm 的 npm 全局 shim 位置（pnpm.cmd 比 pnpm 更稳：不依赖 bash shim）
    const pnpmCmd = home ? `${home}AppData\\Roaming\\npm\\pnpm.cmd` : "";
    if (pnpmCmd && (await exists(pnpmCmd).catch(() => false))) return "pnpm";
  } catch {
    /* 探测失败走 npm */
  }
  return "npm";
}

/**
 * 把指定版本安装进 GUI 内核目录（幂等：已安装直接返回成功）。
 * 装完执行冒烟：node bin.js --version 输出中提取的版本号必须与目标版本精确相等
 * （includes 会把 0.1.1-rc.20 误判为 0.1.1-rc.2，必须精确匹配）。
 * 包管理器：优先 pnpm（--dir），npm 兜底（--prefix，需先建目录）。
 */
export async function installKernel(version: string): Promise<{ ok: boolean; error?: string }> {
  if (installBusy) return { ok: false, error: "已有内核安装任务进行中，请稍候" };
  installBusy = true;
  try {
    if (await isKernelInstalled(version)) return { ok: true };
    const root = await kernelRootDir();
    const target = `${root}\\${version}`;
    // npm 11 的 --prefix 要求目标目录已存在（不会自动创建，实测 ENOENT）——先建目录（pnpm --dir 同样需要）
    try {
      await mkdir(target, { recursive: true });
    } catch (e) {
      return { ok: false, error: `创建内核目录失败：${e instanceof Error ? e.message : String(e)}` };
    }
    const pm = await detectPackageManager();
    const install =
      pm === "pnpm"
        ? await runCommand(
            "pnpm",
            ["add", "--dir", target, `${DSH_PKG}@${version}`],
            INSTALL_TIMEOUT_MS,
          )
        : await runCommand(
            "npm",
            ["install", "--prefix", target, `${DSH_PKG}@${version}`, "--no-audit", "--no-fund", "--loglevel=error"],
            INSTALL_TIMEOUT_MS,
          );
    if (install.code !== 0) {
      return { ok: false, error: (install.stdout || install.stderr || "").slice(-300) || `${pm} 安装退出码 ${install.code}` };
    }
    // 冒烟校验：node bin.js --version，从输出中提取版本号精确比对
    const bin = await kernelBinPath(version);
    const smoke = await runCommand("node", [bin, "--version"], SMOKE_TIMEOUT_MS);
    const printed = (smoke.stdout || smoke.stderr || "").trim();
    const m = /v?\d+\.\d+\.\d+(?:-(?:rc|beta|alpha)\.?\d+)?/i.exec(printed);
    const detected = m ? normalizeDshVersion(m[0]) : "";
    if (smoke.code !== 0 || !detected || compareVersions(detected, version) !== 0) {
      return { ok: false, error: `安装后校验失败：${printed || `无输出（退出码 ${smoke.code}）`}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    installBusy = false;
  }
}
