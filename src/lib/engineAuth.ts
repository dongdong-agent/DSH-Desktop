// ============================================================
// 引擎（dsh web）浏览器会话鉴权：自签 Cookie
//
// 背景（引擎 ≥ 0.1.5）：
//   - 未携带会话 Cookie 的请求一律 401（"dsh web authentication required"）；
//   - 唯一合法入口是 `dsh web` 启动时打印的 /?token=<进程内随机 token>，
//     该请求 303 并下发 SameSite=Strict 的 HttpOnly Cookie；
//   - token 不落盘、不对外暴露，GUI 拿不到；且壳页面（tauri.localhost）里用
//     iframe 加载 127.0.0.1 属于跨站上下文，Strict Cookie 不会随请求发送。
//
// 做法：签名密钥本身是**落盘**的（受管凭据 records 里的
//   client-connection/browser-session → payload.secret），因此 GUI 可以自签
//   一份引擎能校验通过的 Cookie，注入到承载引擎页面的子 webview 里
//   （子 webview 是顶层文档，站点为 127.0.0.1，Cookie 生效）。
//
// 校验规则对齐引擎侧实现（@deepseek-ai/dsh-client-connection）：
//   name  = "dsh-auth-" + base64url(sha256(authority))
//   value = "v1." + base64url(JSON{version,authority,issuedAt,expiresAt})
//                 + "." + base64url(hmac_sha256(secret, <上一步的 base64url 串>))
// ============================================================
import { readTextFile } from "@tauri-apps/plugin-fs";
import { homeDir } from "@tauri-apps/api/path";

/** 受管凭据里浏览器会话记录的键（引擎写入 ~/.dsh/.credentials.yaml） */
const SECRET_RECORD = "client-connection/browser-session";
/** Cookie 名前缀（与引擎一致） */
const COOKIE_PREFIX = "dsh-auth-";
/** 引擎默认 cookieMaxAgeDays = 30，这里留 1 天余量 */
const COOKIE_MAX_AGE_SECONDS = 29 * 24 * 60 * 60;
const SECRET_BYTES = 32;

function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(value) || value.length % 4 === 1) return null;
  const pad = "=".repeat((4 - (value.length % 4)) % 4);
  try {
    const bin = atob(value.replace(/-/g, "+").replace(/_/g, "/") + pad);
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/**
 * 读取浏览器会话签名密钥（base64url 字符串）。
 * 只做定向解析：定位 records 下的 client-connection/browser-session 块，
 * 取其缩进更深的第一处 `secret:`（不引入 YAML 依赖）。
 */
export async function readBrowserSessionSecret(): Promise<string | null> {
  try {
    // 与 credentials.ts 采用同一约定：homeDir() 不带尾分隔符，normalize 后统一补一个。
    // 旧写法 `${home}\\.dsh\\...` 只在"不带尾"时才正确；一旦拼出双分隔符
    // （`C:\Users\x\\.dsh\...`），字符串 glob scope（$HOME/.dsh/**）未必匹配，
    // 读不到就静默返回 null，页面会退化成 401。
    const home = (await homeDir()).replace(/[\\/]+$/, "");
    const txt = await readTextFile(`${home}\\.dsh\\.credentials.yaml`);
    const lines = txt.split(/\r?\n/);
    const start = lines.findIndex((l) => l.trim().startsWith(`${SECRET_RECORD}:`));
    if (start < 0) return null;
    const baseIndent = lines[start].length - lines[start].trimStart().length;
    for (let i = start + 1; i < lines.length; i++) {
      const raw = lines[i];
      if (!raw.trim() || raw.trim().startsWith("#")) continue;
      const indent = raw.length - raw.trimStart().length;
      if (indent <= baseIndent) break; // 已走出该记录块
      const m = raw.trim().match(/^secret:\s*(.+)$/);
      if (m) return m[1].trim().replace(/^["']|["']$/g, "");
    }
    return null;
  } catch {
    return null;
  }
}

/** 自签结果：Cookie 名/值，以及注入子 webview 的「缺 Cookie 就补上并重载」脚本 */
export interface EngineAuth {
  name: string;
  value: string;
  js: string;
}

/**
 * 生成引擎可校验的会话 Cookie 与注入脚本。
 * @param port 引擎监听端口（authority 取 127.0.0.1:<port>，与请求 Host 一致）
 * @param secretB64Url 受管凭据里的签名密钥
 * @returns 密钥不可用时返回 null（调用方退化为不带鉴权加载，页面会显示 401 文案）
 */
export async function buildEngineAuth(port: number, secretB64Url: string): Promise<EngineAuth | null> {
  try {
    const authority = `127.0.0.1:${port}`;
    const secret = b64urlDecode(secretB64Url);
    if (secret === null || secret.byteLength !== SECRET_BYTES) return null;

    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(authority));
    const name = `${COOKIE_PREFIX}${b64urlEncode(new Uint8Array(digest))}`;

    const issuedAt = Date.now();
    const payload = JSON.stringify({
      version: 1,
      authority,
      issuedAt,
      expiresAt: issuedAt + COOKIE_MAX_AGE_SECONDS * 1000,
    });
    const body = b64urlEncode(new TextEncoder().encode(payload));
    const key = await crypto.subtle.importKey(
      "raw",
      secret,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
    const value = `v1.${body}.${b64urlEncode(new Uint8Array(signature))}`;

    const rootUrl = `http://${authority}/`;
    // 幂等：已经有该 Cookie 且页面已不是 401 文案时不动；否则写入 Cookie 并重新加载根路径。
    //
    // 2026-09-16 修复：旧判据只看「Cookie 是否存在」。若 Cookie 存在但**已失效**
    // （签名密钥轮换 / Cookie 被写到了别的域 / 手动清过引擎数据），脚本就会认定
    // 「无需动作」而不再重试 —— 页面被永久钉在 401 文本页，刷新与重启都不会自愈。
    // 引擎的 401 正文是 "dsh web authentication required"，据此补一条判据：
    // **只要落地页仍是 401 文案，就无条件重设 Cookie 并重载**（脚本本身幂等，重复执行安全）。
    // document.body 在极早执行时可能为 null，故取文本前做空值保护。
    const js =
      "(function(){try{var n=" +
      JSON.stringify(name) +
      ",v=" +
      JSON.stringify(value) +
      ",u=" +
      JSON.stringify(rootUrl) +
      ";var has=document.cookie.indexOf(n+'=')!==-1" +
      ";var t=(document.body&&document.body.textContent)||''" +
      ";var unauthorized=t.indexOf('authentication required')!==-1" +
      ";if(!has||unauthorized){document.cookie=n+'='+v+'; path=/; max-age=" +
      COOKIE_MAX_AGE_SECONDS +
      "';location.replace(u);}}catch(e){}})();";

    return { name, value, js };
  } catch {
    return null;
  }
}
