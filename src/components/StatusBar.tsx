import { useEffect, useState } from "react";
import { useEngineStore } from "../stores/engineStore";
import { useSessionStore } from "../stores/sessionStore";
import { useChatStore } from "../stores/chatStore";
import {
  getDshVersion,
  restartEngine,
  isVerifiedVersion,
  pinEngineVersion,
  rollbackVersion,
} from "../lib/dshEngine";

/** 底部状态栏：引擎状态 / 模型 / 会话数 / 缩放级别 */
export function StatusBar({
  zoom = 1,
  onZoomChange,
}: {
  zoom?: number;
  onZoomChange?: (next: number) => void;
}) {
  const health = useEngineStore((s) => s.health);
  const sessions = useSessionStore((s) => s.sessions);
  const generating = useChatStore((s) => s.generating);
  const [version, setVersion] = useState("");
  const [rolling, setRolling] = useState(false);

  const refreshVersion = () => void getDshVersion().then(setVersion);
  useEffect(refreshVersion, []);

  const newKernel = version && !isVerifiedVersion(version);
  const rollback = rollbackVersion();

  // 回滚到已验证版本：pin 版本 → 重启引擎（新 process 用固定版本启动）
  const handleRollback = async () => {
    if (!rollback || rolling) return;
    setRolling(true);
    pinEngineVersion(rollback);
    try {
      await restartEngine();
    } catch {
      /* 错误状态已通过 health 广播 */
    }
    setVersion(rollback);
    setRolling(false);
  };

  const statusText =
    health.status === "running"
      ? `dsh ${version || ""} · :${health.port}`
      : health.status === "starting"
        ? "引擎启动中…"
        : health.status === "error"
          ? "引擎错误"
          : "引擎未启动";

  const dot =
    health.status === "running"
      ? "bg-emerald-400"
      : health.status === "starting"
        ? "bg-amber-400 animate-pulse"
        : health.status === "error"
          ? "bg-red-400"
          : "bg-gray-600";

  return (
    <div className="flex h-6 shrink-0 items-center gap-3 border-t border-white/[0.06] bg-[rgb(13_13_16)] px-3 text-[10.5px] text-gray-500">
      <span className="flex items-center gap-1.5">
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
        {statusText}
      </span>
      {newKernel && (
        <>
          <span className="text-gray-700">|</span>
          <span className="flex items-center gap-1.5 text-amber-300" title="官方发布了新引擎内核，此版本尚未验证兼容性；如遇插件/功能异常可一键回滚">
            ⚠ 新内核未验证
            {rollback && (
              <button
                onClick={() => void handleRollback()}
                disabled={rolling}
                className={`rounded border border-amber-500/40 px-1.5 py-0.5 text-[10px] text-amber-300 transition-colors ${
                  rolling ? "cursor-wait opacity-60" : "hover:bg-amber-500/15"
                }`}
              >
                {rolling ? "回滚中…" : `回滚到 ${rollback}`}
              </button>
            )}
          </span>
        </>
      )}
      <span className="text-gray-700">|</span>
      <span>{sessions.length} 个会话</span>
      {generating && (
        <>
          <span className="text-gray-700">|</span>
          <span className="text-purple-400">● 生成中</span>
        </>
      )}
      <div className="flex-1" />
      {onZoomChange && (
        <>
          <button
            onClick={() => onZoomChange(Math.round((zoom - 0.1) * 10) / 10)}
            title="缩小 (Ctrl+-)"
            className="rounded px-1.5 text-gray-500 hover:bg-white/[0.08] hover:text-gray-200"
          >
            −
          </button>
          <button
            onClick={() => onZoomChange(1)}
            title="重置 100% (Ctrl+0)"
            className={`rounded px-1.5 hover:bg-white/[0.08] ${zoom !== 1 ? "text-gray-500 hover:text-gray-200" : "text-gray-300"}`}
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            onClick={() => onZoomChange(Math.round((zoom + 0.1) * 10) / 10)}
            title="放大 (Ctrl++)"
            className="rounded px-1.5 text-gray-500 hover:bg-white/[0.08] hover:text-gray-200"
          >
            +
          </button>
          <span className="text-gray-700">|</span>
        </>
      )}
      <span className="text-gray-600">DeepSeek Harness Desktop</span>
    </div>
  );
}
