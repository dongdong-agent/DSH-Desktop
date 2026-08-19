import { Minimize2, X, Power } from "lucide-react";

/** 关闭窗口三选一：最小化到托盘 / 关闭窗口（保留服务）/ 关闭服务并退出 */
export function CloseDialog({
  onMinimizeToTray,
  onCloseWindow,
  onStopAndExit,
  onCancel,
}: {
  onMinimizeToTray: () => void;
  onCloseWindow: () => void;
  onStopAndExit: () => void;
  onCancel: () => void;
}) {
  const Option = ({
    icon,
    title,
    desc,
    onClick,
    accent = "text-gray-200",
  }: {
    icon: React.ReactNode;
    title: string;
    desc: string;
    onClick: () => void;
    accent?: string;
  }) => (
    <button
      onClick={onClick}
      className="group flex w-full items-center gap-3 rounded-lg border border-white/[0.06] bg-[rgb(22_22_27)] p-3 text-left transition-colors hover:border-purple-500/40 hover:bg-[rgb(28_28_34)]"
    >
      <span className={`shrink-0 ${accent}`}>{icon}</span>
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-gray-200">{title}</span>
        <span className="block truncate text-[11px] text-gray-500">{desc}</span>
      </span>
    </button>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-xl border border-white/[0.08] bg-[rgb(15_15_19)] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center gap-2">
          <Power size={16} className="text-gray-400" />
          <h2 className="text-sm font-semibold text-gray-100">关闭 DeepSeek Harness</h2>
        </div>
        <p className="mb-4 text-[12px] leading-5 text-gray-500">
          引擎正在后台运行，请选择关闭方式：
        </p>

        <div className="flex flex-col gap-2">
          <Option
            icon={<Minimize2 size={16} />}
            title="最小化到托盘"
            desc="窗口隐藏到系统托盘，引擎继续运行"
            onClick={onMinimizeToTray}
            accent="text-cyan-300"
          />
          <Option
            icon={<X size={16} />}
            title="关闭窗口"
            desc="结束窗口，引擎保持后台运行"
            onClick={onCloseWindow}
            accent="text-amber-300"
          />
          <Option
            icon={<Power size={16} />}
            title="关闭服务并退出"
            desc="停止引擎进程，彻底退出应用"
            onClick={onStopAndExit}
            accent="text-red-300"
          />
        </div>

        <div className="mt-4 flex justify-end">
          <button
            onClick={onCancel}
            className="rounded-lg px-4 py-1.5 text-[12px] text-gray-400 transition-colors hover:bg-white/[0.06] hover:text-gray-200"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
