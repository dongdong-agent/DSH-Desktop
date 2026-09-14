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
// 文件格式（引擎 credentials-local 的 version 1 文档）：
//   version: 1
//   refs:                       # 凭据引用：KEY: value
//     DEEPSEEK_API_KEY: sk-...
//   records:                    # 记录：<scope>/<id> + 标签化字段
//     client-connection/browser-session:
//       kind: grant
//       payload:
//         version: 1
//         secret: <浏览器会话签名密钥>
//
// **写入必须结构化**（2026-09-12 修复）：本模块早期实现把所有行当成
// `KEY: value` 平铺后整体重写，会把 refs/records 的嵌套结构压平，写出
// 引擎解析器直接拒绝的文档（重复的顶层 version → DUPLICATE_KEY，且
// renderFlatLayoutMigration 也救不回来）——后果是引擎下次启动
// 「plugin tree failed to load」，同时壳自己再也读不到 browser-session
// 密钥、无法自签会话 Cookie。现在只改 refs 段里自己的那一行，其余字节
// （注释、records、缩进）原样保留；无法确证的布局一律大声报错而不是重写。
// ============================================================
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { appDataDir, homeDir } from "@tauri-apps/api/path";

export interface CredEntry {
  key: string;
  value: string;
}

/** 凭据引用名文法，与引擎 credentialRef 的 REF_PATTERN 一致 */
const REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** refs 段内的行（两个空格缩进 + 引用名 + 值） */
const REF_LINE_PATTERN = /^(\s+)([A-Za-z_][A-Za-z0-9_]*):[ \t]*(.*)$/;
/** 顶层键行（无缩进） */
const TOP_LINE_PATTERN = /^([^\s#][^:]*):[ \t]*(.*)$/;

/** 受管存储文件路径：~/.dsh/.credentials.yaml */
async function credentialsFile(): Promise<string> {
  const home = await homeDir();
  return `${home}.dsh\\.credentials.yaml`;
}

type Layout = "empty" | "canonical" | "legacy-flat";

/** 追加一条 refs 条目：同名重复时后出现的值覆盖先出现的（与 YAML 语义一致） */
function pushRef(refs: CredEntry[], key: string, value: string): void {
  const existing = refs.findIndex((entry) => entry.key === key);
  if (existing >= 0) refs[existing] = { key, value };
  else refs.push({ key, value });
}

interface CredentialsDocument {
  layout: Layout;
  /** 原始行（不含换行符） */
  lines: string[];
  /** canonical：refs 段头行下标；-1 表示不存在 */
  refsHeader: number;
  /** canonical：refs 段结束（不含）下标 */
  refsEnd: number;
  /** canonical：records 段头行下标；-1 表示不存在 */
  recordsHeader: number;
  refs: CredEntry[];
}

/**
 * 解析受管存储文档，识别布局并取出 refs 条目。
 * 只做「引擎文档」这一种格式的结构识别：
 *   - canonical：顶层 version: 1 + 可选 refs/records 段；
 *   - legacy-flat：无 version 的预发布平铺布局（引擎自身也会迁移它）；
 *   - empty：空文件 / 只有注释。
 * 其它任何形状（重复顶层键、未知顶层键、平铺里混入非引用名）都抛错——
 * 引擎对这种文档是**整体拒绝**的，GUI 更不能猜着重写。
 * @param text 文档全文
 * @returns 解析结果
 */
function parseCredentialsDocument(text: string): CredentialsDocument {
  const lines = text.split(/\r?\n/);
  const doc: CredentialsDocument = { layout: "empty", lines, refsHeader: -1, refsEnd: -1, recordsHeader: -1, refs: [] };
  const topKeys: Array<{ key: string; index: number }> = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.trim() === "" || raw.trimStart().startsWith("#")) continue;
    if (/^\s/.test(raw)) continue; // 缩进行：段内内容，稍后按段处理
    const m = TOP_LINE_PATTERN.exec(raw);
    if (!m) throw new Error(`credentials: unrecognized top-level line ${i + 1}`);
    topKeys.push({ key: m[1].trim(), index: i });
  }

  if (topKeys.length === 0) return doc;

  const versionEntry = topKeys[0];
  if (versionEntry.key !== "version") {
    // 预发布平铺布局：全部顶层行都是「引用名: 非空值」
    for (const { key, index } of topKeys) {
      if (!REF_PATTERN.test(key)) throw new Error(`credentials: unrecognized flat entry "${key}" at line ${index + 1}`);
      const m = TOP_LINE_PATTERN.exec(lines[index]);
      if (m === null || m[2].trim() === "") throw new Error(`credentials: flat entry "${key}" has no value at line ${index + 1}`);
      pushRef(doc.refs, key, unquote(m[2].trim()));
    }
    doc.layout = "legacy-flat";
    return doc;
  }

  // canonical：version 必须是字面量 1，且顶层键只允许 version/refs/records
  const versionValue = TOP_LINE_PATTERN.exec(lines[versionEntry.index])?.[2].trim();
  if (versionValue !== "1") throw new Error(`credentials: unsupported document version ${String(versionValue)}`);
  for (const { key, index } of topKeys) {
    if (key === "version" || key === "refs" || key === "records") continue;
    throw new Error(`credentials: unknown top-level key "${key}" at line ${index + 1}（文件结构已被破坏，拒绝重写）`);
  }
  if (topKeys.filter((e) => e.key === "version").length > 1) throw new Error("credentials: duplicate top-level version key");
  doc.recordsHeader = topKeys.find((e) => e.key === "records")?.index ?? -1;
  const refsHeader = topKeys.find((e) => e.key === "refs");
  doc.layout = "canonical";
  if (refsHeader === undefined) return doc;

  doc.refsHeader = refsHeader.index;
  // refs 段 = 到下一个顶层行为止
  let end = lines.length;
  for (const { index } of topKeys) {
    if (index > refsHeader.index) {
      end = index;
      break;
    }
  }
  doc.refsEnd = end;
  for (let i = refsHeader.index + 1; i < end; i++) {
    const raw = lines[i];
    if (raw.trim() === "" || raw.trimStart().startsWith("#")) continue;
    const m = REF_LINE_PATTERN.exec(raw);
    if (m === null || !REF_PATTERN.test(m[2])) throw new Error(`credentials: unrecognized refs entry at line ${i + 1}`);
    pushRef(doc.refs, m[2], unquote(m[3].trim()));
  }
  return doc;
}

/** 去掉值两侧的成对引号（引擎写入的是裸标量，这里兼容手工编辑） */
function unquote(value: string): string {
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
    return value.slice(1, -1);
  }
  return value;
}

/** 把预发布平铺布局迁移成 canonical（缩进两格挂到 refs: 之下，逐行原样保留） */
function migrateFlatLayout(doc: CredentialsDocument): void {
  const body = doc.lines.map((line) => (line.trim() === "" ? "" : `  ${line}`));
  doc.lines = ["version: 1", "refs:", ...body];
  doc.recordsHeader = -1; // 平铺文档没有 records 段
  doc.refsHeader = 1;
  doc.refsEnd = doc.lines.length;
  doc.layout = "canonical";
}

/** refs 段内追加新条目的位置：跳过段尾的空行/注释，避免新行落在空行之后 */
function refInsertionIndex(doc: CredentialsDocument): number {
  let idx = doc.refsEnd;
  while (idx > doc.refsHeader + 1) {
    const line = doc.lines[idx - 1];
    if (line.trim() === "" || line.trimStart().startsWith("#")) idx -= 1;
    else break;
  }
  return idx;
}

/**
 * 补一个空的 refs 段（文档只有 records 或只有 version 时）。
 * @param doc 已解析的 canonical 文档
 */
function ensureRefsSection(doc: CredentialsDocument): void {
  if (doc.refsHeader >= 0) return;
  const insertAt = doc.recordsHeader >= 0 ? doc.recordsHeader : doc.lines.length;
  doc.lines.splice(insertAt, 0, "refs:");
  if (doc.recordsHeader >= insertAt) doc.recordsHeader += 1;
  doc.refsHeader = insertAt;
  doc.refsEnd = insertAt + 1;
}

/**
 * 把文档调整成可写的 canonical 骨架：
 *   - empty：新建 `version: 1` + `refs:`（原有注释保留在文件头）；
 *   - legacy-flat：迁移成 canonical；
 *   - canonical：必要时补一个空 refs 段。
 * @param doc 已解析的文档
 */
function ensureWritableSkeleton(doc: CredentialsDocument): void {
  if (doc.layout === "empty") {
    const comments = doc.lines.filter((line) => line.trim() !== "");
    doc.lines = [...comments, "version: 1", "refs:"];
    doc.recordsHeader = -1;
    doc.refsHeader = comments.length + 1;
    doc.refsEnd = doc.lines.length;
    doc.layout = "canonical";
    return;
  }
  if (doc.layout === "legacy-flat") migrateFlatLayout(doc);
  ensureRefsSection(doc);
}

/** 读取失败是否只是「文件不存在」；其余失败必须上抛，绝不能当空文档覆盖 */
function isNotFound(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /ENOENT|no such file|not found|os error 2/i.test(message);
}

/** 一个值写回 YAML 时的形态：纯标量，含特殊字符时加双引号转义 */
function renderRefValue(value: string): string {
  if (value !== "" && !/^[\s]|[\s]$|[:#]|^[-?*&!|>%@`"'[\]{}]/.test(value) && !value.includes("\n")) return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
}

/**
 * 读取全部凭据引用（refs 段；预发布平铺布局则为其全部条目）。
 * 解析失败返回空列表——读取方（密钥管理面板 / 引擎环境注入）不该因为
 * 一份损坏的文档而崩，但写入方会明确报错（见 writeCredential）。
 */
export async function readCredentials(): Promise<CredEntry[]> {
  let txt: string;
  try {
    txt = await readTextFile(await credentialsFile());
  } catch {
    return [];
  }
  try {
    return parseCredentialsDocument(txt).refs;
  } catch {
    return [];
  }
}

/**
 * 写入（新增或覆盖）一个凭据引用，保留其余内容。
 * 只改 refs 段中目标键所在的那一行（缺失则追加到 refs 段末尾），
 * records 段、注释与无关条目的字节全部原样保留；写后引擎热生效。
 * @param key 凭据引用名（`DEEPSEEK_API_KEY` 这类 POSIX 标识符）
 * @param value 凭据值（非空）
 * @throws 引用名不合法、值为空、或文档结构无法确证（绝不猜着重写）
 */
export async function writeCredential(key: string, value: string): Promise<void> {
  if (!REF_PATTERN.test(key)) throw new TypeError(`credentials: "${key}" is not a valid credential reference name`);
  if (value === "") throw new TypeError(`credentials: value for "${key}" must not be empty`);
  const file = await credentialsFile();
  let txt = "";
  try {
    txt = await readTextFile(file);
  } catch (error) {
    // 只有「文件不存在」才当成空文档起步；读不动（权限/编码）必须上抛，
    // 否则会把一份读不到的凭据文档当成空的整体覆盖掉。
    if (!isNotFound(error)) throw error;
  }
  const doc = parseCredentialsDocument(txt);
  ensureWritableSkeleton(doc);
  const rendered = `  ${key}: ${renderRefValue(value)}`;
  // 同名重复条目：YAML 重复键会让引擎整体拒绝文档，写入时收敛成一条
  // （保留本次写入的值，位置沿用第一条出现处）。
  const matches: number[] = [];
  for (let i = doc.refsHeader + 1; i < doc.refsEnd; i++) {
    const m = REF_LINE_PATTERN.exec(doc.lines[i]);
    if (m !== null && m[2] === key) matches.push(i);
  }
  if (matches.length === 0) {
    doc.lines.splice(refInsertionIndex(doc), 0, rendered);
  } else {
    doc.lines[matches[0]] = rendered;
    for (const index of matches.slice(1).reverse()) doc.lines.splice(index, 1);
  }
  const out = doc.lines.join("\n").replace(/\n*$/, "\n");
  await writeTextFile(file, out);
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
