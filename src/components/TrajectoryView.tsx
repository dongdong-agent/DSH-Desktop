import { useMemo } from "react";
import { useChatStore } from "../stores/chatStore";
import type { TrajectoryEvent } from "../lib/types";

const SOURCE_STYLES: Record<string, { label: string; color: string }> = {
  system: { label: "系统", color: "bg-gray-500/20 text-gray-400 border-gray-500/20" },
  user: { label: "用户", color: "bg-purple-500/20 text-purple-300 border-purple-500/20" },
  assistant: { label: "助手", color: "bg-blue-500/20 text-blue-300 border-blue-500/20" },
  tool: { label: "工具", color: "bg-emerald-500/20 text-emerald-300 border-emerald-500/20" },
  subagent: { label: "子代理", color: "bg-amber-500/20 text-amber-300 border-amber-500/20" },
  context: { label: "上下文", color: "bg-cyan-500/20 text-cyan-300 border-cyan-500/20" },
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("zh-CN", { hour12: false });
}

function EventRow({ ev }: { ev: TrajectoryEvent }) {
  const style = SOURCE_STYLES[ev.source] ?? SOURCE_STYLES.system;
  const truncated =
    ev.content.length > 600 ? ev.content.slice(0, 600) + "…" : ev.content;

  return (
    <div className="group flex gap-2.5 rounded-lg px-2 py-1.5 hover:bg-white/[0.03]">
      <div className="w-14 shrink-0 pt-0.5 text-right font-mono text-[10px] text-gray-600">
        {formatTime(ev.timestamp)}
      </div>
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex items-center gap-1.5">
          <span className={`rounded border px-1.5 py-px text-[10px] font-medium ${style.color}`}>
            {style.label}
          </span>
          <span className="font-mono text-[10.5px] text-gray-500">{ev.kind}</span>
          {ev.subagentId && (
            <span className="rounded bg-amber-500/10 px-1 py-px font-mono text-[10px] text-amber-300">
              {ev.subagentId.slice(0, 8)}
            </span>
          )}
        </div>
        <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-4.5 text-gray-300">
          {truncated}
        </pre>
      </div>
    </div>
  );
}

/** Trajectory 视图：按来源查看模型看到的一切（append-only 事件流） */
export function TrajectoryView() {
  const trajectory = useChatStore((s) => s.trajectory);
  const clearTrajectory = useChatStore((s) => s.clearTrajectory);

  const grouped = useMemo(() => {
    return trajectory;
  }, [trajectory]);

  if (trajectory.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-gray-600">
        <div className="text-3xl">🛤️</div>
        <div className="text-sm">暂无轨迹事件</div>
        <div className="text-xs">模型看到的一切（提示词、思维链、工具调用、子代理调度）都会记录在这里</div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-white/[0.05] px-4 py-1.5">
        <span className="text-[11px] font-medium text-gray-500">
          Trajectory · {grouped.length} 个事件 · 仅追加
        </span>
        <button
          onClick={clearTrajectory}
          className="rounded px-1.5 py-0.5 text-[11px] text-gray-500 hover:bg-white/[0.06] hover:text-gray-300"
        >
          清空
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1">
        <div className="flex flex-col gap-0.5">
          {grouped.map((ev) => (
            <EventRow key={ev.id} ev={ev} />
          ))}
        </div>
      </div>
    </div>
  );
}
