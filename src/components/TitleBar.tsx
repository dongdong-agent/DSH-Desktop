import { useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { confirm, message } from "@tauri-apps/plugin-dialog";
import { Minus, Square, X, RotateCw, KeyRound, Bug, DownloadCloud, Loader2, Maximize2, Minimize2 } from "lucide-react";
import { useEngineStore } from "../stores/engineStore";
import { getDshVersion, pinEngineVersion, restartEngine } from "../lib/dshEngine";
import { checkForUpdate, clearLatestVersionCache, installKernel, isValidDshVersion, type KernelUpdateInfo } from "../lib/updater";

/** 无边框窗口标题栏（窗口控制统一在右上角，左侧标题 + 引擎状态） */
export function TitleBar({
  onOpenKeyManager,
  immersive = false,
  onToggleImmersive,
}: {
  onOpenKeyManager: () => void;
  /** 沉浸模式下标题栏本身会被隐藏；此参数仅用于按钮图标/高亮状态 */
  immersive?: boolean;
  /** 沉浸模式开关（隐藏/显示标题栏与状态栏） */
  onToggleImmersive?: () => void;
}) {
  const health = useEngineStore((s) => s.health);
  const appWindow = getCurrentWindow();
  const [restarting, setRestarting] = useState(false);
  const [devtoolsOpen, setDevtoolsOpen] = useState(false);

  // 检测并升级内核：常驻按钮，点击后对比 npm registry 最新版
  const [updatePhase, setUpdatePhase] = useState<"idle" | "checking" | "installing">("idle");
  const [updateInfo, setUpdateInfo] = useState<KernelUpdateInfo | null>(null);
  /** 安装进度：阶段 / 包管理器实时输出行 / 已运行秒数（浮层展示） */
  const [installProgress, setInstallProgress] = useState("");
  const [installLog, setInstallLog] = useState<string[]>([]);
  const [installElapsed, setInstallElapsed] = useState(0);
  const installTimerRef = useRef(0);

  const handleUpdate = async () => {
    if (updatePhase !== "idle") return;
    setUpdatePhase("checking");
    try {
      // 1. 探测当前内核版本（引擎未安装 / 探测失败时明确提示，绝不误报「已是最新」）
      const current = await getDshVersion();
      if (!current || current === "unknown" || !isValidDshVersion(current)) {
        await message("无法获取当前内核版本（dsh 引擎未安装或探测失败），请先确认引擎可用后再试。", {
          title: "检查更新",
          kind: "error",
        });
        return;
      }
      // 2. 请求 npm registry 对比最新版
      const info = await checkForUpdate(current);
      setUpdateInfo(info);
      if (!info.hasUpdate) {
        await message(`当前 dsh ${info.current} 已是最新版本`, {
          title: "检查更新",
          kind: "info",
          okLabel: "知道了",
        });
        return;
      }
      // 3. 用户确认（说明升级后果与注意事项）
      const ok = await confirm(
        `发现新内核：\n\n当前  dsh ${info.current}\n最新  dsh ${info.latest}\n\n` +
          "升级后会自动重启引擎（进程级切换，配置与 API Key 保持不变）。\n" +
          "若浏览器里开着网页版 dsh（如端口 3080），请先关闭它——重启会优先复用已有实例，升级将不生效。\n" +
          "新版本若尚未验证兼容性，底部状态栏可一键回滚到已验证版本。",
        {
          title: "升级内核",
          kind: "info",
          okLabel: "下载并升级",
          cancelLabel: "取消",
        },
      );
      if (!ok) return;
      // 4. 下载安装到 GUI 内核目录（幂等 + 冒烟校验，失败给出具体原因）
      setUpdatePhase("installing");
      setInstallLog([]);
      setInstallElapsed(0);
      const t0 = Date.now();
      installTimerRef.current = window.setInterval(
        () => setInstallElapsed(Math.round((Date.now() - t0) / 1000)),
        1000,
      );
      const res = await installKernel(info.latest, (msg) => {
        setInstallProgress(msg);
        setInstallLog((prev) => [...prev.slice(-40), msg]);
      });
      if (!res.ok) {
        await message(`升级失败：${res.error ?? "未知错误"}`, {
          title: "升级内核",
          kind: "error",
        });
        return;
      }
      // 5. 切换 pin + 重启引擎（新进程用新内核启动）
      pinEngineVersion(info.latest);
      try {
        await restartEngine();
      } catch {
        await message("新内核已安装完成，但引擎重启失败（错误已显示在状态栏）。可手动点击「重启引擎」按钮重试。", {
          title: "升级内核",
          kind: "warning",
        });
        return;
      }
      // 6. 成功收尾：清 registry 缓存（下次检测立即拿最新）+ 熄灭红点
      clearLatestVersionCache();
      setUpdateInfo(null);
      await message(`内核已升级到 dsh ${info.latest} ✅`, {
        title: "升级完成",
        kind: "info",
      });
    } catch (e) {
      await message(`检查更新失败：${e instanceof Error ? e.message : String(e)}`, {
        title: "检查更新",
        kind: "error",
      });
    } finally {
      window.clearInterval(installTimerRef.current);
      setUpdatePhase("idle");
      setInstallLog([]);
      setInstallProgress("");
    }
  };

  // 打开 / 关闭 WebView 开发者调试器（F12）
  const toggleDevtools = () => {
    setDevtoolsOpen((open) => {
      if (open) {
        void webviewClose();
        return false;
      }
      void invoke("open_devtools").catch(() => {});
      return true;
    });
  };
  const webviewClose = () => void invoke("close_devtools").catch(() => {});

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

      {/* 检测并升级内核（对比 npm registry；有新版时右上角显示红点徽标） */}
      <button
        onClick={() => void handleUpdate()}
        disabled={updatePhase === "checking" || updatePhase === "installing"}
        title={
          updateInfo?.hasUpdate
            ? `发现新内核 dsh ${updateInfo.latest}，点击下载并升级`
            : "检测并升级引擎内核"
        }
        className={`relative flex h-6 w-7 items-center justify-center rounded transition-colors ${
          updatePhase === "checking" || updatePhase === "installing"
            ? "cursor-wait text-gray-500"
            : updateInfo?.hasUpdate
              ? "text-purple-300 hover:bg-purple-500/20"
              : "text-gray-400 hover:bg-white/[0.08] hover:text-purple-300"
        }`}
      >
        {updatePhase === "checking" || updatePhase === "installing" ? (
          <Loader2 size={13} className="animate-spin" />
        ) : (
          <DownloadCloud size={13} />
        )}
        {updateInfo?.hasUpdate && updatePhase === "idle" && (
          <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-red-500" />
        )}
      </button>
      {/* 检测 / 安装阶段文字（窄窗口自动隐藏，避免挤压标题） */}
      {updatePhase !== "idle" && (
        <span className="hidden min-[760px]:inline text-[10px] text-gray-500">
          {updatePhase === "checking"
            ? "检测中…"
            : `正在安装 dsh ${updateInfo?.latest ?? ""}…（${installElapsed}s）`}
        </span>
      )}

      {/* 内核安装进度浮层：阶段 + 包管理器实时输出（安装可能持续数分钟，必须给反馈） */}
      {updatePhase === "installing" && (
        <div className="fixed right-3 top-10 z-50 w-[420px] rounded-lg border border-white/10 bg-[rgb(20_20_24)] p-3 shadow-2xl">
          <div className="flex items-center gap-2 text-xs text-gray-200">
            <Loader2 size={13} className="animate-spin text-purple-300" />
            <span>
              正在安装 dsh {updateInfo?.latest ?? ""}（已运行 {installElapsed}s）
            </span>
          </div>
          <div className="mt-1 truncate text-[10px] text-gray-500">{installProgress || "准备中…"}</div>
          <div className="mt-2 h-20 overflow-y-auto rounded bg-black/40 p-2 font-mono text-[10px] leading-4 text-gray-400">
            {installLog.length === 0
              ? "等待包管理器输出…"
              : installLog
                  .slice(-6)
                  .map((l, i) => (
                    <div key={`${i}-${l}`} className="truncate" title={l}>
                      {l}
                    </div>
                  ))}
          </div>
        </div>
      )}

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

      {/* 开发者调试开关（F12） */}
      <button
        onClick={toggleDevtools}
        title={devtoolsOpen ? "关闭开发者调试 (F12)" : "打开开发者调试 (F12)"}
        className={`flex h-6 w-7 items-center justify-center rounded transition-colors ${
          devtoolsOpen
            ? "bg-amber-500/20 text-amber-300"
            : "text-gray-400 hover:bg-white/[0.08] hover:text-amber-300"
        }`}
      >
        <Bug size={13} />
      </button>

      <div className="flex-1" data-tauri-drag-region />

      {/* 沉浸模式开关：隐藏/显示标题栏与状态栏（Ctrl+Shift+H 或鼠标贴边唤出） */}
      <button
        onClick={onToggleImmersive}
        title={
          immersive
            ? "退出沉浸模式（还原标题栏/状态栏）"
            : "沉浸模式：隐藏标题栏与状态栏（Ctrl+Shift+H 或鼠标移到屏幕边缘唤出）"
        }
        className={`flex h-6 w-7 items-center justify-center rounded transition-colors ${
          immersive
            ? "bg-purple-500/20 text-purple-300"
            : "text-gray-400 hover:bg-white/[0.08] hover:text-purple-300"
        }`}
      >
        {immersive ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
      </button>

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
