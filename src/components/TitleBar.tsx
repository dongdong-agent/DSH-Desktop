import { useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { confirm } from "@tauri-apps/plugin-dialog";
import { Minus, Square, X, RotateCw, KeyRound } from "lucide-react";
import { useEngineStore } from "../stores/engineStore";
import { restartEngine } from "../lib/dshEngine";

/** 无边框窗口标题栏（窗口控制统一在右上角，左侧标题 + 引擎状态） */
export function TitleBar({ onOpenKeyManager }: { onOpenKeyManager: () => void }) {
  const health = useEngineStore((s) => s.health);
  const appWindow = getCurrentWindow();
  const [restarting, setRestarting] = useState(false);

  const handleRestart = async () => {
    if (restarting || health.status !== "running") return;
    // 二次确认：重启会中断正在运行的 agent 任务
    const ok = await confirm(
      "确认重启引擎？\n\n正在运行的 agent 任务会被中断，重启后会重新加载配置，\n环境变量 / API Key 等改动将立即生效。",
      { title: "重启引擎", kind: "warning", okLabel: "重启", cancelLabel: "取消" },
    );
    if (!ok) return;
    setRestarting(true);
    try {
      await restartEngine();
    } catch {
      /* 错误状态已通过 health 广播 */
    }
    setRestarting(false);
  };

  const dot =
    health.status === "running"
      ? "bg-emerald-400"
      : health.status === "starting"
        ? "bg-amber-400 animate-pulse"
        : health.status === "error"
          ? "bg-red-400"
          : "bg-gray-500";

  return (
    <div
      data-tauri-drag-region
      className="flex h-9 shrink-0 items-center gap-2 border-b border-white/[0.06] bg-[rgb(16_16_19)] px-2"
    >
      {/* 左侧：状态点 + 标题 */}
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      <span className="text-xs font-medium text-gray-300">DeepSeek Harness</span>
      <span className="text-[11px] text-gray-500">Desktop</span>

      {/* 模型密钥管理（读写受管存储，热生效） */}
      <button
        onClick={onOpenKeyManager}
        title="模型密钥管理（修改 opencode 等 API Key）"
        className="flex h-6 w-7 items-center justify-center rounded text-gray-400 transition-colors hover:bg-white/[0.08] hover:text-purple-300"
      >
        <KeyRound size={13} />
      </button>
      <button
        onClick={() => void handleRestart()}
        disabled={restarting || health.status !== "running"}
        title="重启引擎（使配置、API Key 等改动生效）"
        className={`flex h-6 w-7 items-center justify-center rounded text-gray-400 transition-colors ${
          restarting
            ? "cursor-wait text-gray-500"
            : health.status === "running"
              ? "hover:bg-white/[0.08] hover:text-purple-300"
              : "cursor-not-allowed opacity-40"
        }`}
      >
        <RotateCw size={13} className={restarting ? "animate-spin" : ""} />
      </button>

      <div className="flex-1" data-tauri-drag-region />

      {/* 右侧：窗口控制（最小化 / 最大化 / 关闭） */}
      <button
        onClick={() => appWindow.minimize()}
        className="flex h-6 w-7 items-center justify-center rounded text-gray-400 hover:bg-white/[0.08] hover:text-gray-100"
        title="最小化"
      >
        <Minus size={13} />
      </button>
      <button
        onClick={() => appWindow.toggleMaximize()}
        className="flex h-6 w-7 items-center justify-center rounded text-gray-400 hover:bg-white/[0.08] hover:text-gray-100"
        title="最大化/还原"
      >
        <Square size={11} />
      </button>
      <button
        onClick={() => appWindow.close()}
        className="flex h-6 w-7 items-center justify-center rounded text-gray-400 hover:bg-red-500/90 hover:text-white"
        title="关闭"
      >
        <X size={14} />
      </button>
    </div>
  );
}
