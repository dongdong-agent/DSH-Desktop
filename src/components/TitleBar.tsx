import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X } from "lucide-react";
import { useEngineStore } from "../stores/engineStore";

/** 无边框窗口标题栏（窗口控制统一在右上角，左侧标题 + 引擎状态） */
export function TitleBar() {
  const health = useEngineStore((s) => s.health);
  const appWindow = getCurrentWindow();

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
