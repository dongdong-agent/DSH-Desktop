// ============================================================
// dsh 模型密钥管理：统一读写 ~/.dsh/.credentials.yaml（受管存储）。
//
// dsh 引擎会 chokidar 热监听该文件，改动后无需重启引擎即生效
// （resolve 每次操作实时取值）。因此这是「第三方程序 / 用户」修改
// provider key 最稳定、可热生效的入口。
//
// 注意 resolve 优先级：进程环境变量 > 受管存储 > .env。
// 因此要保证受管存储生效，进程环境里不能残留同名 apiKeyEnv 变量。
// ============================================================
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { homeDir } from "@tauri-apps/api/path";

export interface CredEntry {
  key: string;
  value: string;
}

/** 受管存储文件路径：~/.dsh/.credentials.yaml */
async function credentialsFile(): Promise<string> {
  const home = await homeDir();
  return `${home}.dsh\\.credentials.yaml`;
}

/** 读取全部凭据条目（跳过注释/空行），解析 `KEY:: VALUE` 格式 */
export async function readCredentials(): Promise<CredEntry[]> {
  try {
    const txt = await readTextFile(await credentialsFile());
    const entries: CredEntry[] = [];
    for (const raw of txt.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const i = line.indexOf("::");
      if (i < 0) continue;
      entries.push({ key: line.slice(0, i).trim(), value: line.slice(i + 2).trim() });
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
  const txt = entries.map((e) => `${e.key}:: ${e.value}`).join("\n") + "\n";
  await writeTextFile(await credentialsFile(), txt);
}

/** 脱敏显示：超长 key 只显示首尾，避免明文常亮 */
export function maskKey(value: string): string {
  if (!value) return "（未设置）";
  if (value.length <= 10) return value;
  return `${value.slice(0, 4)}••••••${value.slice(-4)}`;
}
