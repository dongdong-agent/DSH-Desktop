// ============================================================
// dsh API 客户端：HTTP /api RPC 上行 + WebSocket 事件流下行
// 协议：四象限 RPC（rpcId 相关 + 方法名 payload）
//
// 重要：必须用 @tauri-apps/plugin-http 的 fetch（Rust 侧 reqwest，
// 无 CORS 限制）。WebView2 页面源是 tauri://localhost，用浏览器
// 原生 fetch 请求 http://127.0.0.1:3080 会被 CORS 拦截 → API 全失败。
// ============================================================
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import type {
  AgentPreset,
  DownlinkFrame,
  EngineHealth,
  RpcOutcome,
  SessionId,
  SessionModels,
  SessionSummary,
} from "./types";

/** 统一 fetch：Tauri 环境走 plugin-http（无 CORS），浏览器环境回退原生 fetch */
async function httpFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  try {
    return await tauriFetch(input as never, init as never);
  } catch {
    return fetch(input, init);
  }
}

let baseUrl = "http://127.0.0.1:17800";
let wsMux: WebSocket | null = null;
let wsHost: WebSocket | null = null;
let rpcSeq = 0;

const DEFAULT_RPC_TIMEOUT_MS = 120_000;

export function setApiBase(url: string) {
  baseUrl = url.replace(/\/$/, "");
}

export function getApiBase(): string {
  return baseUrl;
}

function nextRpcId(): string {
  rpcSeq += 1;
  return `gui-${Date.now().toString(36)}-${rpcSeq.toString(36)}`;
}

/** 单次 RPC 调用（上行 HTTP）
 * 信封：{rpcId, type:"client-request", method, payload}
 * 路径：POST /api/<method>（method 为点分隔，如 session.list）
 */
export async function rpc<TReq extends object = object, TRes = unknown>(
  method: string,
  payload: TReq,
  timeoutMs = DEFAULT_RPC_TIMEOUT_MS,
): Promise<RpcOutcome<TRes>> {
  const rpcId = nextRpcId();
  const body = {
    rpcId,
    type: "client-request" as const,
    method,
    payload,
  };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await httpFetch(`${baseUrl}/api/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timer);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        ok: false,
        error: { code: `http-${res.status}`, message: text.slice(0, 500) || res.statusText },
      };
    }
    // 响应信封：{type:"server-response", rpcId, result:{ok:true,value} | {ok:false,error}}
    const data = (await res.json()) as {
      type?: string;
      result?: RpcOutcome<TRes> | { ok: true; value: TRes } | { ok: false; error: RpcOutcome<TRes> extends never ? never : { code: string; message: string } };
    };
    if (data.type !== "server-response" || !data.result) {
      return { ok: false, error: { code: "malformed", message: "意外响应信封" } };
    }
    const result = data.result as { ok: boolean; value?: TRes; error?: { code: string; message: string } };
    if (result.ok && "value" in result) {
      return { ok: true, response: { rpcId: rpcId as never, payload: result.value as TRes } };
    }
    return {
      ok: false,
      error: { code: result.error?.code ?? "unknown", message: result.error?.message ?? "RPC 失败" },
    };
  } catch (e) {
    return {
      ok: false,
      error: {
        code: "network",
        message: e instanceof Error ? e.message : String(e),
      },
    };
  }
}

// ============================================================
// WebSocket 下行事件流
// ============================================================

type EventHandler = (frame: DownlinkFrame) => void;

const muxHandlers = new Set<EventHandler>();
const hostHandlers = new Set<EventHandler>();

export function onMuxEvent(fn: EventHandler): () => void {
  muxHandlers.add(fn);
  return () => muxHandlers.delete(fn);
}
export function onHostEvent(fn: EventHandler): () => void {
  hostHandlers.add(fn);
  return () => hostHandlers.delete(fn);
}

function dispatch(handlers: Set<EventHandler>, frame: DownlinkFrame) {
  handlers.forEach((fn) => {
    try {
      fn(frame);
    } catch {
      /* noop */
    }
  });
}

function connectWs(path: string, handlers: Set<EventHandler>): WebSocket {
  const ws = new WebSocket(`ws://${baseUrl.replace(/^https?:\/\//, "")}${path}`);
  ws.onmessage = (ev) => {
    try {
      const frame = JSON.parse(ev.data as string) as DownlinkFrame;
      dispatch(handlers, frame);
    } catch {
      /* ignore malformed */
    }
  };
  ws.onclose = () => {
    // 自动重连（引擎重启后恢复订阅）
    setTimeout(() => {
      if (ws === (path.endsWith("mux") ? wsMux : wsHost)) {
        const next = connectWs(path, handlers);
        if (path.endsWith("mux")) wsMux = next;
        else wsHost = next;
      }
    }, 2000);
  };
  return ws;
}

/** 建立两条下行事件流 */
export function connectEventStreams(): void {
  if (!wsMux) wsMux = connectWs("/api/events.mux", muxHandlers);
  if (!wsHost) wsHost = connectWs("/api/events.host", hostHandlers);
}

/** 断开事件流 */
export function disconnectEventStreams(): void {
  wsMux?.close();
  wsHost?.close();
  wsMux = null;
  wsHost = null;
}

// ============================================================
// 域名方法封装（对齐 ApiProxy 契约）
// ============================================================

/** 会话列表 */
export async function listSessions(cursor?: string): Promise<SessionSummary[]> {
  const out = await rpc<{ cursor?: string }, { items: SessionSummary[] }>("session.list", { cursor });
  if (out.ok) return out.response.payload.items;
  return [];
}

/** 创建会话 */
export async function createSession(agentPreset?: string): Promise<SessionSummary | null> {
  const out = await rpc<{ agentPreset?: string }, { session: SessionSummary }>("session.create", {
    agentPreset,
  });
  if (out.ok) return out.response.payload.session;
  return null;
}

/** 会话模型信息 */
export async function getSessionModels(sessionId: SessionId): Promise<SessionModels | null> {
  const out = await rpc<{ sessionId: SessionId }, SessionModels>("session.models", { sessionId });
  if (out.ok) return out.response.payload;
  return null;
}

/** 选择会话模型 */
export async function selectSessionModel(sessionId: SessionId, provider: string, model: string): Promise<boolean> {
  const out = await rpc<{ sessionId: SessionId; provider: string; model: string }, { accepted: true }>(
    "session.selectModel",
    { sessionId, provider, model },
  );
  return out.ok;
}

/** 重命名会话 */
export async function renameSession(sessionId: SessionId, title: string): Promise<boolean> {
  const out = await rpc<{ sessionId: SessionId; title: string }, { accepted: true }>("session.rename", {
    sessionId,
    title,
  });
  return out.ok;
}

/** 分叉会话 */
export async function forkSession(sessionId: SessionId): Promise<SessionSummary | null> {
  const out = await rpc<{ sessionId: SessionId }, { session: SessionSummary }>("session.fork", { sessionId });
  if (out.ok) return out.response.payload.session;
  return null;
}

/** 发送 prompt（核心对话入口）
 * 契约：content 为 content-part 数组 [{type:"text", text}]，mode=queue 排队执行
 */
export async function sendPrompt(
  sessionId: SessionId,
  content: string,
  options?: { mode?: "queue" | "steer" },
): Promise<boolean> {
  const out = await rpc<
    { sessionId: SessionId; mode: "queue" | "steer"; content: Array<{ type: "text"; text: string }> },
    { accepted: true }
  >("session.prompt", {
    sessionId,
    mode: options?.mode ?? "queue",
    content: [{ type: "text", text: content }],
  });
  return out.ok;
}

/** 取消当前生成 */
export async function cancelSession(sessionId: SessionId): Promise<boolean> {
  const out = await rpc<{ sessionId: SessionId }, { accepted: true }>("session.cancel", { sessionId });
  return out.ok;
}

/** Agent 预设列表（模式：standard/code/minimal/cordis） */
export async function listAgentPresets(): Promise<AgentPreset[]> {
  const out = await rpc<Record<string, never>, { presets: AgentPreset[] }>("agentPreset.list", {});
  if (out.ok) return out.response.payload.presets;
  return [];
}

/** 选择会话的 Agent 预设（会话级：切换模式需指定 sessionId） */
export async function selectAgentPreset(sessionId: SessionId, preset: string): Promise<boolean> {
  const out = await rpc<{ sessionId: SessionId; agentPreset: string }, { agentPreset: string }>(
    "agentPreset.select",
    { sessionId, agentPreset: preset },
  );
  return out.ok;
}

/** 引擎健康（探测用）：根路径含 __DSH_BOOT__ 即 dsh web */
export async function checkHealth(timeoutMs = 2000): Promise<EngineHealth | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await httpFetch(`${baseUrl}/`, { signal: controller.signal, cache: "no-store" });
    clearTimeout(timer);
    if (!res.ok) return null;
    const text = await res.text().catch(() => "");
    if (!text.includes("__DSH_BOOT__")) return null;
    return {
      status: "running",
      port: Number(new URL(baseUrl).port) || 17800,
      url: baseUrl,
    };
  } catch {
    return null;
  }
}
