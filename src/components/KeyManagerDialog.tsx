import { useEffect, useState } from "react";
import { KeyRound, Eye, EyeOff, Save, X, RotateCw, RefreshCw } from "lucide-react";
import { readCredentials, writeCredential, maskKey, type CredEntry } from "../lib/credentials";
import { restartEngine } from "../lib/dshEngine";

/** 模型密钥管理：读写 ~/.dsh/.credentials.yaml（受管存储），保存后引擎热生效 */
export function KeyManagerDialog({ onClose }: { onClose: () => void }) {
  const [entries, setEntries] = useState<CredEntry[]>([]);
  const [show, setShow] = useState<Record<string, boolean>>({});
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [restarting, setRestarting] = useState(false);

  const load = async () => {
    const list = await readCredentials();
    setEntries(list);
    setShow({});
    setDraft(Object.fromEntries(list.map((e) => [e.key, ""])));
  };
  useEffect(() => {
    void load();
  }, []);

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
        className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-xl border border-white/[0.08] bg-[rgb(15_15_19)] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center gap-2">
          <KeyRound size={16} className="text-purple-300" />
          <h2 className="text-sm font-semibold text-gray-100">模型密钥管理</h2>
        </div>
        <p className="mb-4 text-[12px] leading-5 text-gray-500">
          这里读写 <code className="text-gray-400">~/.dsh/.credentials.yaml</code>
          （受管存储）。保存后引擎<strong>立即热生效</strong>，无需重启。填入新值覆盖即可。
        </p>

        <div className="flex flex-col gap-2">
          {entries.length === 0 && (
            <div className="rounded-lg border border-white/[0.06] p-3 text-[12px] text-gray-500">
              未找到凭据文件或暂无条目。
            </div>
          )}
          {entries.map((e) => (
            <div
              key={e.key}
              className="rounded-lg border border-white/[0.06] bg-[rgb(22_22_27)] p-3"
            >
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
            title="重新读取受管存储"
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
