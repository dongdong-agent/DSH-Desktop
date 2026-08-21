import { useEffect, useState } from "react";
import {
  KeyRound,
  Eye,
  EyeOff,
  Save,
  X,
  RotateCw,
  RefreshCw,
  Check,
  Database,
  CheckCircle2,
} from "lucide-react";
import {
  readCredentials,
  writeCredential,
  maskKey,
  readKeySwitchVault,
  credentialRefFor,
  type CredEntry,
  type KeySwitchVault,
} from "../lib/credentials";
import { restartEngine } from "../lib/dshEngine";

/**
 * 模型密钥管理：
 * 1. 受管存储（~/.dsh/.credentials.yaml）——引擎热生效的当前生效 key；
 * 2. KeySwitch 密钥库（%APPDATA%/KeySwitch/config.toml）——第三方程序
 *    （apikey-switcher-rust）维护的全部候选 key，可一键「设为当前」。
 */
export function KeyManagerDialog({ onClose }: { onClose: () => void }) {
  const [entries, setEntries] = useState<CredEntry[]>([]);
  const [vault, setVault] = useState<KeySwitchVault | null>(null);
  const [show, setShow] = useState<Record<string, boolean>>({});
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);

  const load = async () => {
    const [list, v] = await Promise.all([readCredentials(), readKeySwitchVault()]);
    setEntries(list);
    setVault(v);
    setShow({});
    setDraft(Object.fromEntries(list.map((e) => [e.key, ""])));
  };
  useEffect(() => {
    void load();
  }, []);

  /** 某个 provider 当前生效的 key 值（受管存储里对应凭据引用的值） */
  const activeValueFor = (providerId: string): string | undefined => {
    const ref = credentialRefFor(providerId);
    return entries.find((e) => e.key === ref)?.value;
  };

  /** 一键把 KeySwitch 里的候选 key 设为当前（写入受管存储，引擎热生效） */
  const setActive = async (providerId: string, keyValue: string, keyLabel: string) => {
    const ref = credentialRefFor(providerId);
    setSwitching(`${providerId}:${keyLabel}`);
    setMsg(null);
    try {
      await writeCredential(ref, keyValue);
      setMsg({ ok: true, text: `已切换 ${providerId} → ${keyLabel}（${ref} 已热生效；若仍读到旧 key，请确认进程环境没有残留同名环境变量）` });
      await load();
    } catch {
      setMsg({ ok: false, text: `写入 ${ref} 失败，请检查 ~/.dsh 目录权限` });
    } finally {
      setSwitching(null);
    }
  };

  const save = async () => {
    setSaving(true);
    setMsg(null);
    const changed: string[] = [];
    for (const key of Object.keys(draft)) {
      const v = draft[key];
      if (v && v.trim()) {
        await writeCredential(key, v.trim());
        changed.push(key);
      }
    }
    if (changed.length > 0) {
      setMsg({ ok: true, text: `已写入受管存储：${changed.join("、")}（引擎已热生效，无需重启）` });
    } else {
      setMsg({ ok: true, text: "没有需要保存的修改（未填写新值）" });
    }
    await load();
    setSaving(false);
  };

  const handleRestart = async () => {
    if (restarting) return;
    setRestarting(true);
    try {
      await restartEngine();
      setMsg({ ok: true, text: "已重启引擎（如仍读到旧 key，请确认进程环境里没有残留同名环境变量）" });
    } catch {
      setMsg({ ok: false, text: "重启失败，请稍后再试" });
    }
    setRestarting(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-white/[0.08] bg-[rgb(15_15_19)] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center gap-2">
          <KeyRound size={16} className="text-purple-300" />
          <h2 className="text-sm font-semibold text-gray-100">模型密钥管理</h2>
        </div>
        <p className="mb-4 text-[12px] leading-5 text-gray-500">
          这里读写 <code className="text-gray-400">~/.dsh/.credentials.yaml</code>
          （受管存储，引擎<strong className="text-gray-400">热生效</strong>）。
          下方「KeySwitch 密钥库」展示第三方程序维护的全部候选 key，可一键设为当前。
        </p>

        {/* ================= KeySwitch 密钥库 ================= */}
        <div className="mb-4 rounded-lg border border-cyan-500/20 bg-cyan-500/[0.04] p-3">
          <div className="mb-2 flex items-center gap-2">
            <Database size={14} className="text-cyan-300" />
            <span className="text-[12.5px] font-semibold text-cyan-200">KeySwitch 密钥库</span>
            <span className="text-[10.5px] text-gray-500">
              %APPDATA%/KeySwitch/config.toml（只读，改动需在 KeySwitch 里做）
            </span>
          </div>

          {vault === null ? (
            <div className="text-[12px] text-gray-500">密钥库加载中…</div>
          ) : !vault.available || vault.providers.length === 0 ? (
            <div className="rounded-md border border-white/[0.06] p-2.5 text-[12px] text-gray-500">
              未找到 KeySwitch 配置（%APPDATA%/KeySwitch/config.toml）。可先安装
              <span className="text-gray-400"> apikey-switcher-rust </span>
              并在其中录入 key；或直接在下方受管存储里手动维护。
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {vault.providers.map((p) => {
                const ref = credentialRefFor(p.id);
                const active = activeValueFor(p.id);
                return (
                  <div key={p.id} className="rounded-lg border border-white/[0.06] bg-[rgb(20_20_25)] p-2.5">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="text-[12.5px] font-semibold text-gray-100">{p.id}</span>
                      <span className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[10px] text-gray-400">
                        {ref}
                      </span>
                      {p.baseUrl && (
                        <span className="max-w-[240px] truncate font-mono text-[10px] text-gray-600" title={p.baseUrl}>
                          {p.baseUrl}
                        </span>
                      )}
                      {p.keys.length > 1 && (
                        <span className="ml-auto text-[10px] text-gray-500">{p.keys.length} 个候选 key</span>
                      )}
                    </div>

                    <div className="mt-1.5 flex flex-col gap-1">
                      {p.keys.map((k) => {
                        const isActive = active !== undefined && active === k.key;
                        const switchingNow = switching === `${p.id}:${k.id}`;
                        return (
                          <div
                            key={k.id}
                            className={`flex items-center gap-2 rounded-md border px-2 py-1 ${
                              isActive
                                ? "border-emerald-500/30 bg-emerald-500/[0.07]"
                                : "border-white/[0.05] bg-[rgb(14_14_18)]"
                            }`}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <span className="truncate font-mono text-[11px] text-gray-300">{k.id}</span>
                                {isActive && (
                                  <span className="flex shrink-0 items-center gap-0.5 rounded bg-emerald-500/15 px-1 py-px text-[9.5px] text-emerald-300">
                                    <CheckCircle2 size={9} /> 当前
                                  </span>
                                )}
                              </div>
                              <div className="truncate text-[10px] text-gray-600">
                                {maskKey(k.key)}
                                {k.note ? ` · ${k.note}` : ""}
                              </div>
                            </div>
                            <button
                              onClick={() => void setActive(p.id, k.key, k.id)}
                              disabled={isActive || switchingNow || switching !== null}
                              className={`flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] transition-colors ${
                                isActive
                                  ? "cursor-default bg-white/[0.04] text-emerald-400/70"
                                  : "bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/25 disabled:opacity-40"
                              }`}
                            >
                              {isActive ? (
                                <>
                                  <Check size={11} /> 已启用
                                </>
                              ) : switchingNow ? (
                                "切换中…"
                              ) : (
                                "设为当前"
                              )}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ================= 受管存储（手动编辑） ================= */}
        <div className="mb-2 flex items-center gap-2">
          <KeyRound size={13} className="text-gray-400" />
          <span className="text-[12px] font-semibold text-gray-300">受管存储（手动编辑）</span>
        </div>
        <div className="flex flex-col gap-2">
          {entries.length === 0 && (
            <div className="rounded-lg border border-white/[0.06] p-3 text-[12px] text-gray-500">
              未找到凭据文件或暂无条目。
            </div>
          )}
          {entries.map((e) => (
            <div key={e.key} className="rounded-lg border border-white/[0.06] bg-[rgb(22_22_27)] p-3">
              <div className="flex items-center justify-between">
                <span className="text-[12.5px] font-medium text-gray-200">{e.key}</span>
                <button
                  onClick={() => setShow((s) => ({ ...s, [e.key]: !s[e.key] }))}
                  className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-200"
                >
                  {show[e.key] ? <EyeOff size={12} /> : <Eye size={12} />}
                  {show[e.key] ? "隐藏" : "显示"}
                </button>
              </div>
              <div className="mt-1 text-[11px] text-gray-500">当前：{maskKey(e.value)}</div>
              <input
                type={show[e.key] ? "text" : "password"}
                placeholder="留空则不修改；填新值即覆盖保存"
                value={draft[e.key] ?? ""}
                onChange={(ev) => setDraft((d) => ({ ...d, [e.key]: ev.target.value }))}
                className="mt-2 w-full rounded-md border border-white/[0.08] bg-[rgb(12_12_16)] px-2 py-1.5 text-[12.5px] text-gray-100 outline-none focus:border-purple-500/60"
              />
            </div>
          ))}
        </div>

        {msg && (
          <div
            className={`mt-3 rounded-lg border p-2.5 text-[12px] leading-5 ${
              msg.ok
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                : "border-red-500/30 bg-red-500/10 text-red-300"
            }`}
          >
            {msg.text}
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            onClick={() => void save()}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-lg bg-purple-500 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-purple-400 disabled:opacity-60"
          >
            <Save size={13} /> {saving ? "保存中…" : "保存密钥"}
          </button>
          <button
            onClick={() => void handleRestart()}
            disabled={restarting}
            className="flex items-center gap-1.5 rounded-lg border border-white/[0.1] px-3 py-1.5 text-[12px] text-gray-300 hover:bg-white/[0.06] disabled:opacity-60"
            title="写文件若被进程环境变量覆盖，可用此重启引擎用干净环境"
          >
            <RotateCw size={13} className={restarting ? "animate-spin" : ""} /> 重启引擎
          </button>
          <button
            onClick={() => void load()}
            className="flex items-center gap-1.5 rounded-lg border border-white/[0.1] px-3 py-1.5 text-[12px] text-gray-300 hover:bg-white/[0.06]"
            title="重新读取受管存储与 KeySwitch 密钥库"
          >
            <RefreshCw size={13} /> 刷新
          </button>
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] text-gray-400 hover:bg-white/[0.06]"
          >
            <X size={13} /> 关闭
          </button>
        </div>
      </div>
    </div>
  );
}
