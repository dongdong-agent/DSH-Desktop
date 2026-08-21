// ============================================================
// dsh 模型密钥管理：统一读写 ~/.dsh/.credentials.yaml（受管存储）。
//
// dsh 引擎会热监听该文件（credentials-local watch），改动后无需重启引擎
// 即生效（resolve 每次操作实时取值）。因此这是「第三方程序 / 用户」修改
// provider key 最稳定、可热生效的入口。
//
// 注意 resolve 优先级：进程环境变量 > 受管存储 > .env。
// 因此要保证受管存储生效，进程环境里不能残留同名 apiKeyEnv 变量
// （比如用户级 OPENCODE_GO_API_KEY，否则 GUI 写入会被环境变量遮蔽）。
//
// 文件格式：YAML 映射 `KEY: value`（引擎 credentials-local 用 YAML 解析，
// 官方 WebUI 的 Models 页写入的就是这种格式）。兼容历史 `::` 分隔写法。
// ============================================================
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { appDataDir, homeDir } from "@tauri-apps/api/path";

export interface CredEntry {
  key: string;
  value: string;
}

/** 受管存储文件路径：~/.dsh/.credentials.yaml */
async function credentialsFile(): Promise<string> {
  const home = await homeDir();
  return `${home}.dsh\\.credentials.yaml`;
}

/**
 * 读取全部凭据条目（跳过注释/空行）。
 * 引擎写入的是 YAML `KEY: value`（单冒号）；历史版本 GUI 写过 `KEY:: value`，
 * 两种都兼容解析，写回统一用单冒号。
 */
export async function readCredentials(): Promise<CredEntry[]> {
  try {
    const txt = await readTextFile(await credentialsFile());
    const entries: CredEntry[] = [];
    for (const raw of txt.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const i = line.indexOf(":");
      if (i < 0) continue;
      let key = line.slice(0, i).trim();
      let value = line.slice(i + 1).trim();
      // 兼容历史 `::` 分隔：key 后紧跟冒号属于旧格式
      if (key.endsWith(":")) key = key.slice(0, -1).trim();
      // 去掉值里可能残留的引号
      if (value.length >= 2 && (value.startsWith('"') && value.endsWith('"') || value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (key) entries.push({ key, value });
    }
    return entries;
  } catch {
    return [];
  }
}

/** 写入（新增或覆盖）一个凭据条目，保留其余条目；写后引擎热生效 */
export async function writeCredential(key: string, value: string): Promise<void> {
  const entries = await readCredentials();
  const idx = entries.findIndex((e) => e.key === key);
  if (idx >= 0) entries[idx] = { key, value };
  else entries.push({ key, value });
  const txt = entries.map((e) => `${e.key}: ${e.value}`).join("\n") + "\n";
  await writeTextFile(await credentialsFile(), txt);
}

/** 脱敏显示：超长 key 只显示首尾，避免明文常亮 */
export function maskKey(value: string): string {
  if (!value) return "（未设置）";
  if (value.length <= 10) return value;
  return `${value.slice(0, 4)}••••••${value.slice(-4)}`;
}

// ------------------------------------------------------------
// KeySwitch 密钥库（%APPDATA%/KeySwitch/config.toml）
// apikey-switcher-rust 把所有 provider 的 key 都存在这里，第三方程序
// 通过它切换 key。DSH 只读它作「候选 key 池」，选中后写入自己的受管存储。
// ------------------------------------------------------------

export interface VaultKey {
  id: string;
  key: string;
  note: string;
}

export interface VaultProvider {
  id: string;
  baseUrl: string;
  usageType: string;
  keys: VaultKey[];
}

export interface VaultTarget {
  name: string;
  label: string;
  adapter: string;
  env?: string;
  mapping: Record<string, string>;
}

export interface KeySwitchVault {
  providers: VaultProvider[];
  targets: VaultTarget[];
  /** KeySwitch 配置是否可读（文件不存在 / 无权限时为 false） */
  available: boolean;
}

/** provider → 受管存储凭据引用（apiKeyEnv），未列出的按大写规则推断 */
export function credentialRefFor(provider: string): string {
  const known: Record<string, string> = {
    "opencode-go": "OPENCODE_GO_API_KEY",
    deepseek: "DEEPSEEK_API_KEY",
    volcengine: "VOLCENGINE_API_KEY",
  };
  return known[provider] ?? `${provider.toUpperCase().replace(/-/g, "_")}_API_KEY`;
}

/** KeySwitch 配置文件路径：%APPDATA%/KeySwitch/config.toml */
export async function keySwitchConfigPath(): Promise<string | null> {
  try {
    // appDataDir() = %APPDATA%/<bundle-id>，父级即 %APPDATA%（Windows）
    const appData = await appDataDir();
    const base = appData.replace(/[\\/]+$/, "");
    const sep = base.includes("\\") ? "\\" : "/";
    const parent = base.slice(0, base.lastIndexOf(sep));
    if (!parent) return null;
    return `${parent}${sep}KeySwitch${sep}config.toml`;
  } catch {
    return null;
  }
}

/**
 * 解析 KeySwitch config.toml（只支持该文件实际用到的 TOML 子集：
 * `[section]` / `[[array-table]]` / `key = "str" | 裸值 | [ 多行数组 ]`）。
 * 任何解析异常都不抛错，返回 available=false，UI 降级为「密钥库不可用」。
 */
export async function readKeySwitchVault(): Promise<KeySwitchVault> {
  const empty: KeySwitchVault = { providers: [], targets: [], available: false };
  const path = await keySwitchConfigPath();
  if (!path) return empty;
  let txt: string;
  try {
    txt = await readTextFile(path);
  } catch {
    return empty;
  }
  try {
    const doc = parseTomlLite(txt);
    const providers: VaultProvider[] = [];
    const targets: VaultTarget[] = [];

    // providers.<id>（含 providers.<id>.keys 数组表）
    const provTable = doc["providers"] as Record<string, unknown> | undefined;
    if (provTable && typeof provTable === "object") {
      for (const [pid, pv] of Object.entries(provTable)) {
        if (!pv || typeof pv !== "object") continue;
        const p = pv as Record<string, unknown>;
        const keys: VaultKey[] = [];
        const rawKeys = p["keys"];
        if (Array.isArray(rawKeys)) {
          for (const k of rawKeys) {
            if (!k || typeof k !== "object") continue;
            const kk = k as Record<string, unknown>;
            keys.push({
              id: String(kk["id"] ?? ""),
              key: String(kk["key"] ?? ""),
              note: String(kk["note"] ?? ""),
            });
          }
        }
        providers.push({
          id: pid,
          baseUrl: String(p["base_url"] ?? p["baseURL"] ?? ""),
          usageType: String(p["usage_type"] ?? ""),
          keys,
        });
      }
    }

    // targets 数组表
    const rawTargets = doc["targets"];
    if (Array.isArray(rawTargets)) {
      for (const t of rawTargets) {
        if (!t || typeof t !== "object") continue;
        const tt = t as Record<string, unknown>;
        const mapping: Record<string, string> = {};
        const m = tt["mapping"];
        if (m && typeof m === "object") {
          for (const [prov, kid] of Object.entries(m as Record<string, unknown>)) {
            mapping[prov] = String(kid ?? "");
          }
        }
        targets.push({
          name: String(tt["name"] ?? ""),
          label: String(tt["label"] ?? ""),
          adapter: String(tt["adapter"] ?? ""),
          env: tt["env"] !== undefined ? String(tt["env"]) : undefined,
          mapping,
        });
      }
    }

    return { providers, targets, available: true };
  } catch {
    return empty;
  }
}

/**
 * 轻量 TOML 解析（KeySwitch 配置专用子集）。
 * 输出：{ [sectionPath]: value }，数组表归入同名数组。
 * 支持：`[a.b]` 普通表、`[[a.b]]` 数组表、`k = "str" | 裸值 | [ 多行数组 ]`。
 */
function parseTomlLite(text: string): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  const lines = text.split(/\r?\n/);
  // 当前路径栈（指向当前元素/表所在容器）
  let stack: string[] = [];

  // 导航到 path 指向的容器（普通段进对象；数组段取最后一个元素）
  const containerOf = (path: string[]): Record<string, unknown> => {
    let cur: Record<string, unknown> = root;
    for (let i = 0; i < path.length - 1; i++) {
      const seg = path[i];
      const next = cur[seg];
      if (Array.isArray(next)) {
        // 数组段：落到最后一个元素
        const last = next[next.length - 1];
        cur = last && typeof last === "object" ? (last as Record<string, unknown>) : {};
      } else if (typeof next !== "object" || next === null) {
        cur[seg] = {};
        cur = cur[seg] as Record<string, unknown>;
      } else {
        cur = next as Record<string, unknown>;
      }
    }
    return cur;
  };

  // 普通赋值：key = value 写入当前容器的最后一段
  const assign = (path: string[], value: unknown) => {
    const cur = containerOf(path);
    cur[path[path.length - 1]] = value;
  };

  // [[array-table]] 表头：往数组末尾追加一个新元素
  const pushArrayElement = (path: string[]) => {
    const cur = containerOf(path);
    const last = path[path.length - 1];
    if (!Array.isArray(cur[last])) cur[last] = [];
    (cur[last] as unknown[]).push({});
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    i++;
    if (!line || line.startsWith("#")) continue;

    // section 头
    if (line.startsWith("[") && line.endsWith("]")) {
      const inner = line.slice(1, -1).trim();
      const isArrayTable = inner.startsWith("[") && inner.endsWith("]");
      const header = isArrayTable ? inner.slice(1, -1).trim() : inner;
      stack = header.split(".").map((s) => s.trim());
      if (isArrayTable) pushArrayElement(stack);
      continue;
    }

    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let valuePart = stripInlineComment(line.slice(eq + 1).trim());

    // 多行数组 [ ... ]：收集到闭合 ] 为止
    if (valuePart.startsWith("[") && !valuePart.includes("]")) {
      let buf = valuePart;
      while (i < lines.length) {
        const nl = lines[i].trim();
        i++;
        if (!nl || nl.startsWith("#")) continue;
        buf += " " + nl;
        if (buf.includes("]")) break;
      }
      valuePart = buf;
    }

    assign([...stack, key], parseTomlValue(valuePart));
  }
  return root;
}

/** 解析 `[ ... ]` 数组字面量（可能跨行，已合并进 valuePart） */
function parseTomlArrayLiteral(inner: string): unknown[] {
  const body = inner.slice(inner.indexOf("[") + 1, inner.lastIndexOf("]"));
  const items = body
    .split(",")
    .map((s) => stripInlineComment(s.trim()))
    .filter((s) => s.length > 0);
  return items.map((s) => parseTomlValue(s));
}

function parseTomlValue(raw: string): unknown {
  const v = raw.trim();
  if (v === "") return "";
  if (v.startsWith("[") && v.includes("]")) return parseTomlArrayLiteral(v);
  if (v.startsWith('"')) {
    const m = v.match(/^"((?:[^"\\]|\\.)*)"/);
    return m ? m[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\") : v;
  }
  if (v.startsWith("'")) {
    const m = v.match(/^'([^']*)'/);
    return m ? m[1] : v;
  }
  if (v === "true") return true;
  if (v === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

/** 去掉行尾 # 注释（引号外） */
function stripInlineComment(s: string): string {
  let inS = false;
  let inD = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'" && !inD) inS = !inS;
    else if (c === '"' && !inS) inD = !inD;
    else if (c === "#" && !inS && !inD) return s.slice(0, i);
  }
  return s;
}
