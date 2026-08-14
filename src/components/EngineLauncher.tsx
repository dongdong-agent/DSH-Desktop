import { useEffect, useState } from "react";
import {
  Play,
  Rocket,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Download,
  RefreshCw,
} from "lucide-react";
import { useEngineStore } from "../stores/engineStore";
import {
  checkEnvironment,
  installDsh,
  installNode,
  startEngine,
  type DshEnvironment,
} from "../lib/dshEngine";

type InstallTarget = "node" | "dsh" | null;

/** 引擎启动页：环境检测 → 一键安装缺失项 → 启动引擎 */
export function EngineLauncher() {
  const health = useEngineStore((s) => s.health);
  const setLaunchRequested = useEngineStore((s) => s.setLaunchRequested);
  const launchRequested = useEngineStore((s) => s.launchRequested);
  const [env, setEnv] = useState<DshEnvironment | null>(null);
  const [envChecked, setEnvChecked] = useState(false);
  const [installing, setInstalling] = useState<InstallTarget>(null);
  const [installMsg, setInstallMsg] = useState("");

  const runCheck = async () => {
    setEnvChecked(false);
    const e = await checkEnvironment();
    setEnv(e);
    setEnvChecked(true);
  };

  useEffect(() => {
    void runCheck();
  }, []);

  const handleInstall = async (target: Exclude<InstallTarget, null>) => {
    setInstalling(target);
    setInstallMsg("");
    const result = target === "node" ? await installNode() : await installDsh();
    setInstallMsg(result.ok ? "✅ 安装完成" : `❌ 安装失败：${result.output.slice(-200)}`);
    setInstalling(null);
    // 安装后重新检测
    await runCheck();
  };

  const handleLaunch = async () => {
    setLaunchRequested(true);
    try {
      await startEngine();
    } catch {
      // 错误状态已通过 health 广播
    }
  };

  const launching = health.status === "starting" || launchRequested;
  const allReady = env?.nodeAvailable && env?.localDshAvailable;

  const EnvRow = ({
    ok,
    label,
    hint,
    action,
    actionLabel,
  }: {
    ok: boolean;
    label: string;
    hint: string;
    action?: () => void;
    actionLabel?: string;
  }) => (
    <div className="flex items-center gap-2 text-[12.5px]">
      {ok ? (
        <CheckCircle2 size={14} className="shrink-0 text-emerald-400" />
      ) : (
        <XCircle size={14} className="shrink-0 text-red-400" />
      )}
      <span className={ok ? "text-gray-300" : "text-gray-400"}>{label}</span>
      {!ok ? (
        <>
          <span className="truncate text-[11px] text-gray-600">{hint}</span>
          {action && (
            <button
              onClick={action}
              disabled={installing !== null}
              className="ml-auto flex shrink-0 items-center gap-1 rounded-md bg-purple-500/20 px-2 py-0.5 text-[11px] text-purple-300 hover:bg-purple-500/30 disabled:opacity-50"
            >
              {installing === "node" || installing === "dsh" ? (
                <Loader2 size={10} className="animate-spin" />
              ) : (
                <Download size={10} />
              )}
              {actionLabel}
            </button>
          )}
        </>
      ) : null}
    </div>
  );

  return (
    <div className="flex h-full items-center justify-center bg-[rgb(10_10_12)]">
      <div className="w-full max-w-md px-8 text-center">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-[rgb(168_85_247_/_0.15)] ring-1 ring-purple-500/30">
          <Rocket size={28} className="text-purple-300" />
        </div>
        <h1 className="text-xl font-semibold text-gray-100">DeepSeek Harness Desktop</h1>
        <p className="mt-2 text-[13px] leading-6 text-gray-400">
          一切皆插件 · 模型 / 工具 / 技能 / 会话 / 沙箱 / 存储 / 循环 / 调度 / UI
        </p>

        {/* 环境检测 + 一键安装 */}
        <div className="mt-6 flex flex-col gap-2 rounded-xl border border-white/[0.07] bg-[rgb(15_15_19)] p-4 text-left">
          <div className="mb-1 flex items-center justify-between">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
              <HelpCircle size={12} /> 运行环境
            </div>
            <button
              onClick={() => void runCheck()}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] text-gray-500 hover:bg-white/[0.06] hover:text-gray-300"
            >
              <RefreshCw size={10} /> 重新检测
            </button>
          </div>
          {!envChecked ? (
            <div className="flex items-center gap-2 text-[12.5px] text-gray-500">
              <Loader2 size={13} className="animate-spin" /> 检测中…
            </div>
          ) : (
            <>
              <EnvRow
                ok={env?.nodeAvailable ?? false}
                label={`Node.js${env?.nodeVersion ? ` ${env.nodeVersion}` : ""}`}
                hint="缺失，需安装"
                action={env?.nodeAvailable ? undefined : () => void handleInstall("node")}
                actionLabel={installing === "node" ? "安装中…" : "一键安装"}
              />
              <EnvRow
                ok={env?.npxAvailable ?? false}
                label="npx（npm 自带）"
                hint="装完 Node 即有"
              />
              <EnvRow
                ok={env?.localDshAvailable ?? false}
                label="dsh 引擎（本机）"
                hint="缺失，需安装"
                action={env?.localDshAvailable ? undefined : () => void handleInstall("dsh")}
                actionLabel={installing === "dsh" ? "安装中…" : "一键安装"}
              />
            </>
          )}
          {installMsg && (
            <div className="mt-1 text-[11px] text-gray-400">{installMsg}</div>
          )}
        </div>

        <div className="mt-3 flex flex-col gap-2 rounded-xl border border-white/[0.07] bg-[rgb(15_15_19)] p-4 text-left">
          <div className="flex items-center gap-2 text-[12.5px] text-gray-300">
            <span className="text-emerald-400">●</span> 复用已有实例（若 dsh web 正在运行）
          </div>
          <div className="flex items-center gap-2 text-[12.5px] text-gray-300">
            <span className="text-purple-400">●</span> 自动探测空闲端口并启动引擎
          </div>
          <div className="flex items-center gap-2 text-[12.5px] text-gray-300">
            <span className="text-cyan-400">●</span> 连接 HTTP RPC + WebSocket 事件流
          </div>
        </div>

        {health.status === "error" && (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-left text-[12px] leading-5 text-red-300">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <div>引擎启动失败：{health.error}</div>
          </div>
        )}

        <button
          onClick={handleLaunch}
          disabled={launching}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-purple-500 py-3 text-sm font-semibold text-white transition-colors hover:bg-purple-400 disabled:opacity-60"
        >
          {launching ? (
            <>
              <Loader2 size={16} className="animate-spin" /> 正在启动引擎…
            </>
          ) : (
            <>
              <Play size={15} /> 启动引擎
            </>
          )}
        </button>
        <div className="mt-3 text-[11px] leading-5 text-gray-600">
          {allReady
            ? "环境就绪，点击启动引擎"
            : "首次使用请先完成环境安装（Node.js / dsh 引擎）"}
        </div>
      </div>
    </div>
  );
}
