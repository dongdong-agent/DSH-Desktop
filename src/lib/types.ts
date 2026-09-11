// ============================================================
// 共享类型：仅保留壳（GUI）自身需要的契约。
// 说明：壳不再代理 dsh 的 RPC / WS 流量（官方 WebUI 由子 webview
// 直接承载并自行与引擎通信），因此自研 UI 时代的 RPC 契约类型已移除。
// ============================================================

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
