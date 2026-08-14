import { useEffect, useState } from "react";
import {
  Settings2,
  Layers,
  Server,
  RefreshCw,
  Check,
  Cpu,
  Plug,
  ShieldCheck,
} from "lucide-react";
import { useSessionStore } from "../stores/sessionStore";
import { useEngineStore } from "../stores/engineStore";
import { getDshVersion, startEngine, stopEngine } from "../lib/dshEngine";
import {
  checkHealth,
  listAgentPresets,
  selectAgentPreset,
} from "../lib/api";
import type { EngineHealth } from "../lib/types";

type Tab = "general" | "presets" | "engine";

const PRESET_META: Record<string, { desc: string; icon: string }> = {
  standard: { desc: "功能完整的编码 Agent：文件编辑、Shell、网页检索、Skills、计划、子代理", icon: "🛠️" },
  code: { desc: "标准模式全部能力，模型用 TypeScript 程序组合多步操作", icon: "🧩" },
  minimal: { desc: "仅 bash + str_replace_editor 双工具，最小环境基准测试", icon: "⚡" },
  cordis: { desc: "运行时检查、插件实验、自定义 Agent preset 创作", icon: "🎨" },
};

export function SettingsPanel({ initialTab = "general" }: { initialTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const presets = useSessionStore((s) => s.presets);
  const activePreset = useSessionStore((s) => s.activePreset);
  const setPresets = useSessionStore((s) => s.setPresets);
  const setActivePreset = useSessionStore((s) => s.setActivePreset);
  const health = useEngineStore((s) => s.health);
  const setHealth = useEngineStore((s) => s.setHealth);
  const [dshVersion, setDshVersion] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void getDshVersion().then(setDshVersion);
    void loadPresets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadPresets = async () => {
    const list = await listAgentPresets();
    if (list.length > 0) {
      setPresets(list);
    }
  };

  const handleStart = async () => {
    setBusy(true);
    try {
      await startEngine();
    } finally {
      setBusy(false);
    }
  };

  const handleStop = async () => {
    setBusy(true);
    try {
      await stopEngine();
    } finally {
      setBusy(false);
    }
  };

  const pickPreset = async (name: string) => {
    const sessionId = useSessionStore.getState().activeSessionId;
    if (!sessionId) {
      // 无活动会话时仅记录选择（新建会话后生效）
      setActivePreset(name);
      return;
    }
    const ok = await selectAgentPreset(sessionId, name);
    if (ok) {
      setActivePreset(name);
      // 刷新预设列表
      void loadPresets();
    }
  };

  const tabs: Array<{ id: Tab; label: string; icon: React.ReactNode }> = [
    { id: "general", label: "常规", icon: <Settings2 size={14} /> },
    { id: "presets", label: "模式", icon: <Layers size={14} /> },
    { id: "engine", label: "引擎", icon: <Server size={14} /> },
  ];

  return (
    <div className="flex h-full min-w-0">
      {/* 设置侧导航 */}
      <div className="flex w-40 shrink-0 flex-col gap-0.5 border-r border-white/[0.06] bg-[rgb(12_12_15)] p-2">
        <div className="px-2 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
          设置
        </div>
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-[12.5px] transition-colors ${
              tab === t.id
                ? "bg-[rgb(168_85_247_/_0.16)] text-purple-200"
                : "text-gray-400 hover:bg-white/[0.05] hover:text-gray-200"
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* 内容区 */}
      <div className="min-w-0 flex-1 overflow-y-auto px-6 py-5">
        {tab === "general" && (
          <div className="mx-auto max-w-2xl">
            <h2 className="mb-4 text-base font-semibold text-gray-100">常规</h2>
            <div className="flex flex-col gap-3">
              <div className="rounded-xl border border-white/[0.07] bg-[rgb(16_16_20)] p-4">
                <div className="flex items-center gap-2 text-[13px] font-medium text-gray-200">
                  <Cpu size={15} className="text-purple-400" /> 引擎版本
                </div>
                <div className="mt-2 text-[12.5px] text-gray-400">
                  DeepSeek Harness {dshVersion || "读取中…"} · 一切皆插件（Cordis 内核）
                </div>
              </div>
              <div className="rounded-xl border border-white/[0.07] bg-[rgb(16_16_20)] p-4">
                <div className="flex items-center gap-2 text-[13px] font-medium text-gray-200">
                  <ShieldCheck size={15} className="text-emerald-400" /> 权限
                </div>
                <div className="mt-2 text-[12.5px] leading-5 text-gray-400">
                  当前默认权限预设：<code className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[11px] text-gray-300">danger-full-access</code>
                  <br />
                  可在 <code className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[11px] text-gray-300">~/.dsh/settings.yaml</code> 中调整
                </div>
              </div>
              <div className="rounded-xl border border-white/[0.07] bg-[rgb(16_16_20)] p-4">
                <div className="flex items-center gap-2 text-[13px] font-medium text-gray-200">
                  <Plug size={15} className="text-cyan-400" /> 插件
                </div>
                <div className="mt-2 text-[12.5px] leading-5 text-gray-400">
                  模型、工具、技能、会话、沙箱、存储、循环、调度、UI 均由插件提供。
                  <br />
                  管理：<code className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[11px]">dsh plugin --profile web</code>
                </div>
              </div>
            </div>
          </div>
        )}

        {tab === "presets" && (
          <div className="mx-auto max-w-2xl">
            <h2 className="mb-1 text-base font-semibold text-gray-100">Agent 模式</h2>
            <p className="mb-4 text-[12px] text-gray-500">选择会话运行模式，无需改源码即可在配置层替换能力</p>
            <div className="flex flex-col gap-2.5">
              {presets.length === 0 ? (
                <div className="rounded-xl border border-white/[0.07] bg-[rgb(16_16_20)] p-4 text-[12.5px] text-gray-500">
                  正在读取预设…
                </div>
              ) : (
                presets.map((p) => {
                  const meta = PRESET_META[p.id] ?? { desc: p.description ?? "", icon: "📦" };
                  const active = activePreset === p.id;
                  return (
                    <button
                      key={p.id}
                      onClick={() => void pickPreset(p.id)}
                      className={`group flex items-start gap-3 rounded-xl border p-4 text-left transition-colors ${
                        active
                          ? "border-purple-500/40 bg-[rgb(168_85_247_/_0.10)]"
                          : "border-white/[0.07] bg-[rgb(16_16_20)] hover:border-white/[0.14]"
                      }`}
                    >
                      <div className="text-xl">{meta.icon}</div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] font-medium text-gray-100">{p.name}</span>
                          {active && (
                            <span className="flex items-center gap-1 rounded-full bg-purple-500/20 px-2 py-px text-[10px] text-purple-300">
                              <Check size={10} /> 当前
                            </span>
                          )}
                          {p.isDefault && (
                            <span className="rounded-full bg-white/[0.06] px-2 py-px text-[10px] text-gray-500">
                              默认
                            </span>
                          )}
                        </div>
                        <div className="mt-1 text-[12px] leading-5 text-gray-400">{meta.desc}</div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        )}

        {tab === "engine" && (
          <div className="mx-auto max-w-2xl">
            <h2 className="mb-4 text-base font-semibold text-gray-100">引擎</h2>
            <div className="rounded-xl border border-white/[0.07] bg-[rgb(16_16_20)] p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2 text-[13px] font-medium text-gray-200">
                    <span
                      className={`h-2 w-2 rounded-full ${
                        health.status === "running"
                          ? "bg-emerald-400"
                          : health.status === "starting"
                            ? "bg-amber-400 animate-pulse"
                            : health.status === "error"
                              ? "bg-red-400"
                              : "bg-gray-500"
                      }`}
                    />
                    dsh web 引擎
                  </div>
                  <div className="mt-1 text-[11.5px] text-gray-500">
                    状态：{health.status} · 端口：{health.port}
                    {health.url ? ` · ${health.url}` : ""}
                  </div>
                  {health.error && (
                    <div className="mt-1 max-w-md text-[11.5px] text-red-400">{health.error}</div>
                  )}
                </div>
                <div className="flex gap-2">
                  {health.status !== "running" ? (
                    <button
                      onClick={() => void handleStart()}
                      disabled={busy}
                      className="flex items-center gap-1.5 rounded-lg bg-purple-500/85 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-purple-500 disabled:opacity-50"
                    >
                      {busy ? <RefreshCw size={12} className="animate-spin" /> : <Server size={12} />}
                      启动
                    </button>
                  ) : (
                    <button
                      onClick={() => void handleStop()}
                      disabled={busy}
                      className="flex items-center gap-1.5 rounded-lg bg-white/[0.07] px-3 py-1.5 text-[12px] text-gray-300 hover:bg-white/[0.12] disabled:opacity-50"
                    >
                      停止
                    </button>
                  )}
                  <button
                    onClick={() => void checkHealth().then((h: EngineHealth | null) => h && setHealth(h))}
                    className="flex items-center gap-1.5 rounded-lg bg-white/[0.05] px-3 py-1.5 text-[12px] text-gray-400 hover:bg-white/[0.1]"
                  >
                    <RefreshCw size={12} /> 检测
                  </button>
                </div>
              </div>
            </div>
            <div className="mt-3 rounded-xl border border-white/[0.07] bg-[rgb(16_16_20)] p-4 text-[12px] leading-5 text-gray-500">
              引擎由 <code className="rounded bg-white/[0.06] px-1 font-mono text-[11px]">dsh --profile web</code>{" "}
              提供：HTTP <code className="rounded bg-white/[0.06] px-1 font-mono text-[11px]">/api</code> RPC +
              WebSocket 事件流（/api/events.mux、/api/events.host）。若 17800 端口已有实例将自动复用。
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
