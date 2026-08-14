import { useEffect, useState } from "react";
import { useEngineStore } from "../stores/engineStore";
import { useSessionStore } from "../stores/sessionStore";
import { useChatStore } from "../stores/chatStore";
import { getDshVersion } from "../lib/dshEngine";

/** 底部状态栏：引擎状态 / 模型 / 会话数 / 事件计数 */
export function StatusBar() {
  const health = useEngineStore((s) => s.health);
  const sessions = useSessionStore((s) => s.sessions);
  const generating = useChatStore((s) => s.generating);
  const [version, setVersion] = useState("");

  useEffect(() => {
    void getDshVersion().then(setVersion);
  }, []);

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
      <span className="text-gray-700">|</span>
      <span>{sessions.length} 个会话</span>
      {generating && (
        <>
          <span className="text-gray-700">|</span>
          <span className="text-purple-400">● 生成中</span>
        </>
      )}
      <div className="flex-1" />
      <span className="text-gray-600">DeepSeek Harness Desktop</span>
    </div>
  );
}
