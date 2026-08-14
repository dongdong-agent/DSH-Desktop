// ============================================================
// DeepSeek Harness 协议契约（dsh-host-apiproxy 四象限 RPC 模型）
// 上行 HTTP /api，下行 WebSocket /api/events.mux + /api/events.host
// ============================================================

/** 会话 ID（品牌字符串） */
export type SessionId = string & { __sessionId?: never };
/** 消息 ID */
export type MessageId = string & { __messageId?: never };
/** RPC 相关 ID */
export type RpcId = string & { __rpcId?: never };

/** RPC 请求信封（客户端 → 宿主） */
export interface RpcRequest<T = unknown> {
  rpcId: RpcId;
  payload: T;
}

/** RPC 响应信封（宿主 → 客户端） */
export interface RpcResponse<T = unknown> {
  rpcId: RpcId;
  payload: T;
}

/** 统一 RPC 结果 */
export interface RpcResult<T = unknown> {
  ok: true;
  response: RpcResponse<T>;
}
export interface RpcError {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}
export type RpcOutcome<T = unknown> = RpcResult<T> | RpcError;

/** 会话摘要（对齐 dsh 真实返回结构） */
export interface SessionSummary {
  sessionId: SessionId;
  agentPreset: string;
  running: boolean;
  blank: boolean;
  cwd?: string;
  updatedAt: number;
  createdAt?: number;
  projections?: {
    asOfSeq?: number;
    values?: {
      title?: string;
      sessionStats?: {
        turns?: number;
        steps?: number;
        llmMs?: number;
        toolMs?: number;
      };
      goal?: { goal?: { objective?: string } };
      model?: { provider?: string; model?: string };
    };
  };
}

/** 便捷访问器：会话标题（从 projections 提取） */
export function sessionTitle(s: SessionSummary): string {
  return s.projections?.values?.title ?? s.cwd ?? "未命名会话";
}

/** 会话消息（事件流中的消息帧） */
export interface SessionMessage {
  id: MessageId;
  sessionId: SessionId;
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  createdAt: number;
  toolCalls?: ToolCallInfo[];
  metadata?: Record<string, unknown>;
}

/** 工具调用信息 */
export interface ToolCallInfo {
  id: string;
  name: string;
  input?: unknown;
  output?: unknown;
  status: "pending" | "running" | "success" | "error";
  startedAt?: number;
  finishedAt?: number;
  error?: string;
}

/** 轨迹事件（Trajectory 视图） */
export interface TrajectoryEvent {
  id: string;
  sessionId: SessionId;
  source: "system" | "user" | "assistant" | "tool" | "subagent" | "context";
  kind: string;
  content: string;
  timestamp: number;
  subagentId?: string;
}

/** 会话模型 */
export interface SessionModels {
  providers: string[];
  available: Array<{ provider: string; model: string }>;
  selected?: { provider: string; model: string };
}

/** 引擎状态 */
export type EngineStatus = "stopped" | "starting" | "running" | "error";

/** 引擎健康信息 */
export interface EngineHealth {
  status: EngineStatus;
  port: number;
  url: string;
  version?: string;
  error?: string;
}

/** Agent 预设（模式，对齐真实返回：standard/code/minimal/cordis） */
export interface AgentPreset {
  id: string;
  name: string;
  description?: string;
  trust: "system" | "user";
  isDefault: boolean;
}

/** 事件流帧（下行） */
export type DownlinkFrame =
  | { type: "server-request"; rpcId: RpcId; method: string; payload: unknown }
  | { type: "stream/event"; rpcId: RpcId; payload: unknown }
  | { type: "stream/error"; rpcId: RpcId; error: { code: string; message: string; details?: unknown } };
